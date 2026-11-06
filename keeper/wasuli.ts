// Wasuli (collections): one row per LR that has a wasuli amount. Two halves, both here so the rules sit together:
//  - `followLr`: an LR save, edit, cancel or restore keeps its row in step, inside the LR's own transaction;
//  - `makeWasuli`: assign, collect, undo and the lists (the Wasuli page).
// Every change is compare-and-set: the screen sends the state it saw (status, agent, version) and the UPDATE applies only
// if the row is still exactly so, so a lagging or second seat can never act on a row that has moved on.
import type {
  AgentStat, KeeperResult, ResultCode, WasuliChanged, WasuliCollectInput, WasuliCursor, WasuliFilters, WasuliPage, WasuliPeriod, WasuliRow, WasuliSeen, WasuliStatus,
} from '../shared';
import { writeAudit } from './audit';
import type { Db } from './db';
import { localDate } from './lrRules';
import type { makePins } from './pins';
import { cleanCollect, cleanRemark, daysBetween, periodStart } from './wasuliRules';

type Refusal = Extract<KeeperResult<never>, { ok: false }>;
const refuse = (code: ResultCode, extra: Omit<Refusal, 'ok' | 'code'> = {}): Refusal => ({ ok: false, code, ...extra });
const ok = <T>(value: T): KeeperResult<T> => ({ ok: true, value });
/** Thrown inside the transaction so everything written so far is rolled back; caught right outside it. */
class Stop extends Error {
  constructor(readonly refusal: Refusal) {
    super('refused');
  }
}

const PAGE = 100;
const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
const marks = (ids: number[]): string => ids.map(() => '?').join(', ');
/** Named values for a statement; a statement with none takes no argument at all. */
const bind = (args: Record<string, string | number>): [Record<string, string | number>] | [] => (Object.keys(args).length > 0 ? [args] : []);

interface Row {
  id: number;
  amount_paise: number;
  status: WasuliStatus;
}

/**
 * Brings the wasuli row of an LR to `amount` (paise; 0 = no row): made when there is none, the amount changed on an
 * unassigned or assigned row (it keeps its agent), removed when the amount is nothing. One audit row per change.
 * A collected row is never changed here: an amount that differs from it refuses with `lr-wasuli-collected` (detail =
 * the LR's number) and writes nothing. Runs inside the caller's transaction. Returns whether a row was touched.
 */
export function followLr(db: Db, seat: string, lrId: number, amount: number): Refusal | boolean {
  const row = db.prepare('SELECT id, amount_paise, status FROM wasuli WHERE lr_id = ?').get(lrId) as Row | undefined;
  if (!row) {
    if (amount === 0) return false;
    const made = db.prepare('INSERT INTO wasuli (lr_id, amount_paise, seat) VALUES (?, ?, ?)').run(lrId, amount, seat);
    writeAudit(db, { seat, action: 'wasuli.create', entity: 'wasuli', entityId: Number(made.lastInsertRowid), after: { lr_id: lrId, amount_paise: amount } });
    return true;
  }
  if (row.amount_paise === amount) return false;
  if (row.status === 'collected') {
    const lr = db.prepare('SELECT lr_no AS no FROM lrs WHERE id = ?').get(lrId) as { no: number };
    return refuse('lr-wasuli-collected', { detail: String(lr.no) });
  }
  if (amount === 0) {
    // The whole row goes into the audit log: who it was assigned to is not lost with it.
    const was = db.prepare('SELECT * FROM wasuli WHERE id = ?').get(row.id);
    db.prepare('DELETE FROM wasuli WHERE id = ?').run(row.id);
    writeAudit(db, { seat, action: 'wasuli.remove', entity: 'wasuli', entityId: row.id, before: was });
    return true;
  }
  db.prepare(`UPDATE wasuli SET amount_paise = ?, seat = ?, version = version + 1, updated_at = ${NOW} WHERE id = ?`).run(amount, seat, row.id);
  writeAudit(db, { seat, action: 'wasuli.update', entity: 'wasuli', entityId: row.id, before: { amount_paise: row.amount_paise }, after: { amount_paise: amount } });
  return true;
}

// A row as the screen shows it: the collection with its LR, agent and (once loaded) challan. `days` is added afterwards.
const COLUMNS = `w.id, w.version, w.status, w.lr_id AS lrId, l.lr_no AS lrNo, l.lr_year AS lrYear, l.lr_date AS lrDate,
  l.consignor_name AS consignor, l.consignee_name AS consignee, s.name AS toStation, m.challan_no AS challanNo,
  w.amount_paise AS amountPaise, w.agent_id AS agentId, a.name AS agent, w.assigned_date AS assignedDate,
  w.collected_date AS collectedDate, w.collected_paise AS collectedPaise, w.mode, w.remark, w.seat`;
const FROM = `FROM wasuli w JOIN lrs l ON l.id = w.lr_id JOIN stations s ON s.id = l.to_station_id
  LEFT JOIN memos m ON m.id = l.memo_id LEFT JOIN agents a ON a.id = w.agent_id`;
type Raw = Omit<WasuliRow, 'days'>;

/** What the audit log keeps of a row's state. */
const SNAP = 'SELECT status, agent_id, assigned_date, collected_date, collected_paise, mode, remark FROM wasuli WHERE id = ?';
/** The compare-and-set: the row must still be as the screen saw it. */
const CAS = 'WHERE id = ? AND status = ? AND agent_id IS ? AND version = ?';
const BUMP = `seat = ?, version = version + 1, updated_at = ${NOW}`;

/**
 * A tab's SQL, built from fixed text: only values are bound. `rows` is one page after the cursor (one row over, to know
 * there is a next one); `total` is for the whole filter, so it is bound without the cursor.
 */
export function listSql(tab: WasuliStatus, cursor: WasuliCursor | null, agent: number, since: string) {
  const where =
    tab === 'unassigned'
      ? "w.status = 'unassigned'"
      : tab === 'assigned'
        ? "w.status = 'assigned' AND w.agent_id = @agent"
        : "w.status = 'collected' AND w.agent_id = @agent AND w.collected_date >= @since";
  const order =
    tab === 'unassigned'
      ? 'l.lr_date, l.lr_no'
      : tab === 'assigned'
        ? 'w.assigned_date, l.lr_date, l.lr_no'
        : 'w.collected_date DESC, l.lr_date DESC, l.lr_no DESC';
  const after =
    tab === 'unassigned'
      ? '(l.lr_date, l.lr_no) > (@cd, @cn)'
      : tab === 'assigned'
        ? '(w.assigned_date, l.lr_date, l.lr_no) > (@ca, @cd, @cn)'
        : '(w.collected_date, l.lr_date, l.lr_no) < (@ca, @cd, @cn)';
  const whereArgs: Record<string, string | number> = tab === 'unassigned' ? {} : tab === 'assigned' ? { agent } : { agent, since };
  const cursorArgs: Record<string, string | number> = !cursor ? {} : tab === 'unassigned' ? { cd: cursor.date, cn: cursor.no } : { ca: cursor.a, cd: cursor.date, cn: cursor.no };
  return {
    rowsArgs: { ...whereArgs, ...cursorArgs },
    rows: `SELECT ${COLUMNS} ${FROM} WHERE ${where}${cursor ? ` AND ${after}` : ''} ORDER BY ${order} LIMIT ${PAGE + 1}`,
    totalArgs: whereArgs,
    total: `SELECT COUNT(*) AS count, COALESCE(SUM(w.${tab === 'collected' ? 'collected_paise' : 'amount_paise'}), 0) AS amountPaise FROM wasuli w WHERE ${where}`,
  };
}

/** Per agent: what is assigned now, and what was collected today and in the period (the rows joined are only those two sets). */
export const AGENT_STATS_SQL = `SELECT a.id AS agentId, a.name, a.active,
             COUNT(w.id) FILTER (WHERE w.status = 'assigned') AS assignedCount,
             COALESCE(SUM(w.amount_paise) FILTER (WHERE w.status = 'assigned'), 0) AS assignedPaise,
             COUNT(w.id) FILTER (WHERE w.status = 'collected' AND w.collected_date = @today) AS collectedTodayCount,
             COALESCE(SUM(w.collected_paise) FILTER (WHERE w.status = 'collected' AND w.collected_date = @today), 0) AS collectedTodayPaise,
             COUNT(w.id) FILTER (WHERE w.status = 'collected') AS collectedPeriodCount,
             COALESCE(SUM(w.collected_paise) FILTER (WHERE w.status = 'collected'), 0) AS collectedPeriodPaise
           FROM agents a LEFT JOIN (
             SELECT id, agent_id, status, amount_paise, collected_paise, collected_date FROM wasuli WHERE status = 'assigned'
             UNION ALL
             SELECT id, agent_id, status, amount_paise, collected_paise, collected_date FROM wasuli WHERE status = 'collected' AND collected_date >= @since
           ) w ON w.agent_id = a.id
           GROUP BY a.id ORDER BY a.name_key`;

export function makeWasuli(pins: Pick<ReturnType<typeof makePins>, 'verify'>, now: () => Date = () => new Date()) {
  const today = () => localDate(now());

  const withDays = (rows: Raw[]): WasuliRow[] => {
    const t = today();
    return rows.map((r) => ({ ...r, days: r.status === 'collected' ? 0 : daysBetween(r.status === 'assigned' ? (r.assignedDate as string) : r.lrDate, t) }));
  };
  /** The rows with these ids as they are now (a removed row is simply not there), by LR date and number. */
  const rowsOf = (db: Db, ids: number[]): WasuliRow[] =>
    ids.length === 0 ? [] : withDays(db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE w.id IN (${marks(ids)}) ORDER BY l.lr_date, l.lr_no`).all(...ids) as Raw[]);

  /** A change: one IMMEDIATE transaction; a `Stop` thrown inside undoes everything written so far. */
  const change = (db: Db, body: () => KeeperResult<WasuliChanged>): KeeperResult<WasuliChanged> => {
    try {
      return db.transaction(body).immediate();
    } catch (e) {
      if (e instanceof Stop) return e.refusal;
      throw e;
    }
  };

  interface Move {
    /** The status the rows must have been seen in. */
    legal: WasuliStatus;
    action: string;
    /** Fixed SQL, never from a request. */
    set: string;
    args: unknown[];
    /** A rule that needs the row (its amount); a refusal here undoes the whole change. */
    check?: (amountPaise: number) => Refusal | null;
  }
  /**
   * The compare-and-set on each row seen, all or nothing: a row that moved on since (another status, agent or version, or
   * gone) stops the whole change with `wasuli-stale` and the rows as they are now. One audit row for each row changed.
   */
  function step(db: Db, seat: string, seens: WasuliSeen[], m: Move): KeeperResult<WasuliChanged> {
    const moved: number[] = [];
    for (const s of seens) {
      const cur = db.prepare('SELECT status, agent_id AS agentId, version, amount_paise AS amount FROM wasuli WHERE id = ?').get(s.id) as
        | { status: WasuliStatus; agentId: number | null; version: number; amount: number }
        | undefined;
      if (!cur || s.status !== m.legal || cur.status !== s.status || cur.agentId !== s.agentId || cur.version !== s.version) {
        moved.push(s.id);
        continue;
      }
      const bad = m.check?.(cur.amount);
      if (bad) throw new Stop(bad);
      const before = db.prepare(SNAP).get(s.id);
      const done = db.prepare(`UPDATE wasuli SET ${m.set}, ${BUMP} ${CAS}`).run(...m.args, seat, s.id, s.status, s.agentId, s.version);
      if (done.changes !== 1) {
        moved.push(s.id); // cannot happen inside the transaction that read the row; if it ever does, nothing written so far stays
        continue;
      }
      writeAudit(db, { seat, action: `wasuli.${m.action}`, entity: 'wasuli', entityId: s.id, before, after: db.prepare(SNAP).get(s.id) });
    }
    if (moved.length > 0) throw new Stop(refuse('wasuli-stale', { wasuli: rowsOf(db, moved) }));
    return ok({ rows: rowsOf(db, seens.map((s) => s.id)), changed: true });
  }

  const activeAgent = (db: Db, id: number): boolean => db.prepare('SELECT 1 FROM agents WHERE id = ? AND active = 1').get(id) !== undefined;

  return {
    /** One page of a tab, with the totals of the whole filter and the three tab counts. */
    list(db: Db, f: WasuliFilters, cursor: WasuliCursor | null): KeeperResult<WasuliPage> {
      const since = periodStart(today(), f.period);
      const counts = db
        .prepare(
          `SELECT (SELECT COUNT(*) FROM wasuli WHERE status = 'unassigned') AS unassigned,
             (SELECT COUNT(*) FROM wasuli WHERE status = 'assigned' AND agent_id = @agent) AS assigned,
             (SELECT COUNT(*) FROM wasuli WHERE status = 'collected' AND agent_id = @agent AND collected_date >= @since) AS collected`,
        )
        .get({ agent: f.agentId, since }) as WasuliPage['counts'];
      // Assigned and Collected belong to one agent: with none picked there is nothing to list.
      if (f.tab !== 'unassigned' && f.agentId === null) return ok({ rows: [], next: null, count: 0, amountPaise: 0, counts });
      const q = listSql(f.tab, cursor, f.agentId ?? 0, since);
      const raw = db.prepare(q.rows).all(...bind(q.rowsArgs)) as Raw[];
      const rows = withDays(raw.slice(0, PAGE));
      const last = rows[rows.length - 1];
      const total = db.prepare(q.total).get(...bind(q.totalArgs)) as { count: number; amountPaise: number };
      const resume = f.tab === 'assigned' ? last?.assignedDate : f.tab === 'collected' ? last?.collectedDate : '';
      return ok({
        rows,
        next: raw.length > PAGE && last ? { a: resume as string, date: last.lrDate, no: last.lrNo } : null,
        count: total.count,
        amountPaise: total.amountPaise,
        counts,
      });
    },

    /** The collection of an LR by its number: this year's LR first, then last year's (as the search box does), or exactly `only`'s year (a History row knows it). */
    find(db: Db, no: number, only?: number): KeeperResult<WasuliRow> {
      const year = Number(today().slice(0, 4));
      for (const y of only === undefined ? [year, year - 1] : [only]) {
        const lr = db.prepare('SELECT id FROM lrs WHERE lr_year = ? AND lr_no = ?').get(y, no) as { id: number } | undefined;
        if (!lr) continue;
        const row = db.prepare('SELECT id FROM wasuli WHERE lr_id = ?').get(lr.id) as { id: number } | undefined;
        return row ? ok(rowsOf(db, [row.id])[0]) : refuse('wasuli-missing', { detail: 'no-wasuli' });
      }
      return refuse('wasuli-missing', { detail: 'no-lr' });
    },

    /** Every agent with what is assigned to them now and what they collected today and in the period: one GROUP BY. */
    agentStats(db: Db, period: WasuliPeriod): KeeperResult<AgentStat[]> {
      const t = today();
      const stats = db
        .prepare(AGENT_STATS_SQL)
        .all({ today: t, since: periodStart(t, period) }) as (Omit<AgentStat, 'active'> & { active: number })[];
      return ok(stats.map((s) => ({ ...s, active: s.active === 1 })));
    },

    /** Hand these unassigned rows to an agent. All or nothing. */
    assign(db: Db, seat: string, seens: WasuliSeen[], agentId: number): KeeperResult<WasuliChanged> {
      return change(db, () => {
        if (!activeAgent(db, agentId)) return refuse('wasuli-invalid', { wasuliFields: { agent: 'missing' } });
        return step(db, seat, seens, { legal: 'unassigned', action: 'assign', set: "status = 'assigned', agent_id = ?, assigned_date = ?", args: [agentId, today()] });
      });
    },

    /** An assigned row to another agent. */
    reassign(db: Db, seat: string, seen: WasuliSeen, agentId: number): KeeperResult<WasuliChanged> {
      return change(db, () => {
        if (agentId === seen.agentId) return refuse('wasuli-invalid', { wasuliFields: { agent: 'same' } });
        if (!activeAgent(db, agentId)) return refuse('wasuli-invalid', { wasuliFields: { agent: 'missing' } });
        return step(db, seat, [seen], { legal: 'assigned', action: 'reassign', set: 'agent_id = ?, assigned_date = ?', args: [agentId, today()] });
      });
    },

    /** An assigned row back to the unassigned pool. */
    toPool(db: Db, seat: string, seen: WasuliSeen): KeeperResult<WasuliChanged> {
      return change(db, () => step(db, seat, [seen], { legal: 'assigned', action: 'to-pool', set: "status = 'unassigned', agent_id = NULL, assigned_date = NULL", args: [] }));
    },

    /** The agent brought money: the amount (at most the wasuli amount; less is a part payment), how, and a remark. No PIN. */
    collect(db: Db, seat: string, seen: WasuliSeen, input: WasuliCollectInput): KeeperResult<WasuliChanged> {
      const c = cleanCollect(input);
      return change(db, () =>
        step(db, seat, [seen], {
          legal: 'assigned',
          action: 'collect',
          set: "status = 'collected', collected_date = ?, collected_paise = ?, mode = ?, remark = ?",
          args: [today(), c.paise, c.mode, c.remark],
          // A row that moved on is refused first (in step); then what was typed; then the amount against what is owed.
          check: (amountPaise) => {
            const errors = { ...c.errors };
            if (errors.amount === undefined && c.paise > amountPaise) errors.amount = 'over';
            return Object.keys(errors).length > 0 ? refuse('wasuli-invalid', { wasuliFields: errors }) : null;
          },
        }),
      );
    },

    /** Undo a collection (System PIN): back to Assigned to the same agent, what was collected and its remark cleared (the audit log keeps them). */
    uncollect(db: Db, seat: string, seen: WasuliSeen, systemPin: string): KeeperResult<WasuliChanged> {
      const gate = pins.verify(db, 'system', systemPin);
      if (!gate.ok) return gate;
      return change(db, () =>
        step(db, seat, [seen], { legal: 'collected', action: 'uncollect', set: "status = 'assigned', collected_date = NULL, collected_paise = NULL, mode = NULL, remark = ''", args: [] }),
      );
    },

    /** Edit the remark of a collected row (System PIN). The same text writes nothing. */
    remark(db: Db, seat: string, seen: WasuliSeen, text: string, systemPin: string): KeeperResult<WasuliChanged> {
      const gate = pins.verify(db, 'system', systemPin);
      if (!gate.ok) return gate;
      const remark = cleanRemark(text);
      if (remark === null) return refuse('wasuli-invalid', { wasuliFields: { remark: 'long' } });
      return change(db, () => {
        const cur = db.prepare('SELECT remark FROM wasuli WHERE id = ? AND status = ? AND agent_id IS ? AND version = ?').get(seen.id, seen.status, seen.agentId, seen.version) as { remark: string } | undefined;
        if (cur && seen.status === 'collected' && cur.remark === remark) return ok({ rows: rowsOf(db, [seen.id]), changed: false });
        return step(db, seat, [seen], { legal: 'collected', action: 'remark', set: 'remark = ?', args: [remark] });
      });
    },
  };
}
