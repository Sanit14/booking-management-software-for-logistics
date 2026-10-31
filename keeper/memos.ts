// Loading memos (challans): the number, the claim on the LRs and the frozen totals all happen here, inside ONE
// IMMEDIATE transaction per save. The screen sends what was ticked and typed (money as text) and gets the saved memo
// back; it never adds anything up. An LR can only be loaded while it is booked, and the claim is a single UPDATE that
// must change every ticked LR: if another seat got one first, the whole save is rolled back (no number used) and the
// answer names the LR, the challan it went on and the truck.
// A saved memo (3.2) is corrected the same way: header edit, LRs taken off / moved / added, recalculate and cancel are each
// ONE IMMEDIATE transaction with their audit rows. The frozen totals change only by a recalculation, or never.
import {
  MAX_MEMO_LRS,
  type KeeperResult, type MemoChange, type MemoChanged, type MemoCursor, type MemoDefaults, type MemoDetail, type MemoFilters, type MemoHeaderInput, type MemoHistoryEntry,
  type MemoInput, type MemoListRow, type MemoLrRow, type MemoSaved, type MemoTaken, type MemoTotals, type PendingPage, type PendingTotals, type ResultCode,
  type SavedMemoCursor, type SavedMemoFilters, type SavedMemoPage, type SavedMemoRow,
} from '../shared';
import { writeAudit } from './audit';
import type { Db } from './db';
import { cleanReason, isDate, localDate } from './lrRules';
import { cleanHeader, cleanIds, cleanMemo, type MemoErrors } from './memoRules';
import { nextNumber } from './numbering';
import type { makePins } from './pins';

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
const DAY_LIMIT = 200;
const HISTORY_LIMIT = 50;
const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
const marks = (ids: number[]): string => ids.map(() => '?').join(', ');

const LR_COLUMNS = `l.id, l.lr_no AS lrNo, l.lr_date AS date, l.consignor_name AS consignor, l.consignee_name AS consignee, s.name AS toStation,
  l.qty, l.topay_paise AS toPayPaise, l.paid_paise AS paidPaise`;
const MEMO_ROW = `SELECT m.id, m.challan_year AS challanYear, m.challan_no AS challanNo, m.memo_date AS date, t.number AS truck, s.name AS toStation,
  m.frozen_lr_count AS lrCount, m.status
  FROM memos m JOIN trucks t ON t.id = m.truck_id JOIN stations s ON s.id = m.to_station_id`;

const DETAIL = `SELECT m.id, m.challan_year AS challanYear, m.challan_no AS challanNo, m.memo_date AS date, m.status, m.frozen_lr_count AS lrCount, m.version,
  m.truck_id AS truckId, t.number AS truck, m.driver_id AS driverId, d.name AS driver,
  m.from_station_id AS fromStationId, fs.name AS fromStation, m.to_station_id AS toStationId, ts.name AS toStation,
  m.truck_hire_paise AS truckHirePaise, m.loading_hamali_paise AS loadingHamaliPaise,
  m.frozen_qty AS fQty, m.frozen_topay_paise AS fToPay, m.frozen_paid_paise AS fPaid, m.frozen_charges_paise AS fCharges, m.frozen_stax_paise AS fStax
  FROM memos m JOIN trucks t ON t.id = m.truck_id JOIN drivers d ON d.id = m.driver_id
  JOIN stations fs ON fs.id = m.from_station_id JOIN stations ts ON ts.id = m.to_station_id`;
type DetailRow = Omit<MemoDetail, 'frozen' | 'now' | 'differs' | 'lrs'> & { fQty: number; fToPay: number; fPaid: number; fCharges: number; fStax: number };

/**
 * The pending list's SQL, built from fixed pieces: only values are bound, a column name never comes from the request.
 * `rows` is one page after the cursor (one row over, to know there is a next page); `count` is the whole filter.
 * A firm filter is the LR's firm id; typed text is any part of the name the LR was booked with, a firm's or a walk-in's
 * (ASCII case ignored), so a name typed without picking it, or a firm closed since, still finds its LRs.
 */
export function pendingSql(f: MemoFilters, afterCursor: boolean) {
  const parts = ["l.status = 'booked'"];
  const args: Record<string, string | number> = {};
  if (f.from) {
    parts.push('l.lr_date >= @from');
    args.from = f.from;
  }
  if (f.to) {
    parts.push('l.lr_date <= @to');
    args.to = f.to;
  }
  if (f.toStationId !== null) {
    parts.push('l.to_station_id = @station');
    args.station = f.toStationId;
  }
  for (const [who, p] of [['consignor', f.consignor], ['consignee', f.consignee]] as const) {
    if (!p) continue;
    if (p.firmId !== null) {
      parts.push(`l.${who}_id = @${who}`);
      args[who] = p.firmId;
    } else {
      parts.push(`instr(lower(l.${who}_name), @${who}) > 0`);
      args[who] = p.text.replace(/[A-Z]/g, (c) => c.toLowerCase()); // SQLite's lower() is ASCII only
    }
  }
  const where = parts.join(' AND ');
  return {
    args,
    rows: `SELECT ${LR_COLUMNS} FROM lrs l JOIN stations s ON s.id = l.to_station_id WHERE ${where}${afterCursor ? ' AND (l.lr_date, l.lr_no) > (@cd, @cn)' : ''}
      ORDER BY l.lr_date, l.lr_no LIMIT ${PAGE + 1}`,
    count: `SELECT COUNT(*) AS count, COALESCE(SUM(l.qty), 0) AS qty FROM lrs l WHERE ${where}`,
  };
}

/** What the LRs of a memo add up to. `stax` is the SQL twin of `taxPaise` per LR (round half up), summed. */
const SUMS = `COUNT(*) AS lrs, COALESCE(SUM(qty), 0) AS qty,
    COALESCE(SUM(topay_paise), 0) AS toPayPaise, COALESCE(SUM(paid_paise), 0) AS paidPaise,
    COALESCE(SUM(godown_bhada_paise + godown_insurance_paise + delivery_charges_paise + hamali_paise + pf_paise), 0) AS chargesPaise,
    COALESCE(SUM(((topay_paise + paid_paise) * stax_bp + 5000) / 10000), 0) AS staxPaise`;
/** The totals frozen onto a memo, from the LRs now on it. */
export const FROZEN_SQL = `SELECT ${SUMS} FROM lrs WHERE memo_id = ?`;

const TOTAL_KEYS = ['lrs', 'qty', 'toPayPaise', 'paidPaise', 'chargesPaise', 'staxPaise'] as const;
/** A saved memo differs when its LRs no longer add up to the totals frozen on it; a cancelled memo never does. The same rule is in `savedSql` (for a page of memos): keep the two together. */
const differs = (status: string, now: MemoTotals, frozen: MemoTotals): boolean => status === 'saved' && TOTAL_KEYS.some((k) => now[k] !== frozen[k]);

/**
 * The saved-memos list's SQL, built from fixed pieces (only values are bound). One page (a row over, to know there is a next
 * one) is picked first; the LRs of just those memos are then added up through `lrs_by_memo` and compared with the frozen
 * columns, so "differs" is computed when read, the same way the totals were added up at the save.
 */
export function savedSql(f: SavedMemoFilters, afterCursor: boolean) {
  const parts = ['1 = 1'];
  const args: Record<string, string | number> = {};
  if (f.from) {
    parts.push('m.memo_date >= @from');
    args.from = f.from;
  }
  if (f.to) {
    parts.push('m.memo_date <= @to');
    args.to = f.to;
  }
  if (f.truckId !== null) {
    parts.push('m.truck_id = @truck');
    args.truck = f.truckId;
  }
  if (f.toStationId !== null) {
    parts.push('m.to_station_id = @station');
    args.station = f.toStationId;
  }
  if (afterCursor) parts.push('(m.memo_date, m.challan_no) < (@cd, @cn)');
  const sql = `WITH page AS (SELECT m.* FROM memos m WHERE ${parts.join(' AND ')} ORDER BY m.memo_date DESC, m.challan_no DESC LIMIT ${PAGE + 1})
    SELECT m.id, m.challan_year AS challanYear, m.challan_no AS challanNo, m.memo_date AS date, t.number AS truck, d.name AS driver, s.name AS toStation,
      m.frozen_lr_count AS lrCount, m.frozen_qty AS qty, m.status,
      m.status = 'saved' AND (COALESCE(c.lrs, 0) != m.frozen_lr_count OR COALESCE(c.qty, 0) != m.frozen_qty OR COALESCE(c.toPayPaise, 0) != m.frozen_topay_paise
        OR COALESCE(c.paidPaise, 0) != m.frozen_paid_paise OR COALESCE(c.chargesPaise, 0) != m.frozen_charges_paise OR COALESCE(c.staxPaise, 0) != m.frozen_stax_paise) AS differs
    FROM page m JOIN trucks t ON t.id = m.truck_id JOIN drivers d ON d.id = m.driver_id JOIN stations s ON s.id = m.to_station_id
    LEFT JOIN (SELECT memo_id, ${SUMS} FROM lrs WHERE memo_id IN (SELECT id FROM page) GROUP BY memo_id) c ON c.memo_id = m.id
    ORDER BY m.memo_date DESC, m.challan_no DESC`;
  return { args, sql };
}

/** A memo's own columns, as the checks of a change need them. */
interface MemoRow {
  id: number;
  status: 'saved' | 'cancelled';
  version: number;
  challanYear: number;
  challanNo: number;
  date: string;
  truckId: number;
  driverId: number;
  fromStationId: number;
  toStationId: number;
  truckHirePaise: number;
  loadingHamaliPaise: number;
}
const MEMO_COLUMNS = `id, status, version, challan_year AS challanYear, challan_no AS challanNo, memo_date AS date, truck_id AS truckId, driver_id AS driverId,
  from_station_id AS fromStationId, to_station_id AS toStationId, truck_hire_paise AS truckHirePaise, loading_hamali_paise AS loadingHamaliPaise`;
/** The header fields an edit can change, in form order: the name in the audit row and the column. Fixed, never from the request. */
const HEADER_COLUMNS = [
  ['date', 'memo_date'], ['truckId', 'truck_id'], ['driverId', 'driver_id'], ['fromStationId', 'from_station_id'], ['toStationId', 'to_station_id'],
  ['truckHirePaise', 'truck_hire_paise'], ['loadingHamaliPaise', 'loading_hamali_paise'],
] as const;
type HeaderKey = (typeof HEADER_COLUMNS)[number][0];
const HEADER_FIELD = { date: 'date', truckId: 'truck', driverId: 'driver', fromStationId: 'fromStation', toStationId: 'toStation', truckHirePaise: 'truckHire', loadingHamaliPaise: 'loadingHamali' } as const;
const TOTAL_FIELD = { lrs: 'lrs', qty: 'qty', toPayPaise: 'toPay', paidPaise: 'paid', chargesPaise: 'charges', staxPaise: 'stax' } as const;

const TOTALS_SQL = `SELECT COUNT(*) AS lrs, COALESCE(SUM(qty), 0) AS qty, COALESCE(SUM(topay_paise), 0) AS toPayPaise, COALESCE(SUM(paid_paise), 0) AS paidPaise
  FROM lrs WHERE status = 'booked' AND id IN`;

export function makeMemos(pins: Pick<ReturnType<typeof makePins>, 'verify'>, now: () => Date = () => new Date()) {
  const rowOf = (db: Db, id: number): MemoListRow => db.prepare(`${MEMO_ROW} WHERE m.id = ?`).get(id) as MemoListRow;

  /**
   * The LRs that were named but are not where the change needs them, for what to tell the clerk: not booked any more (and not
   * on `memoId`); with `booked` set, every one not on `memoId` whatever its state (an LR another seat took off the memo).
   */
  const takenOf = (db: Db, ids: number[], memoId: number, booked = false): MemoTaken[] =>
    db
      .prepare(
        `SELECT l.id, l.lr_no AS lrNo, l.status AS state, m.challan_no AS challanNo, t.number AS truck
         FROM lrs l LEFT JOIN memos m ON m.id = l.memo_id LEFT JOIN trucks t ON t.id = m.truck_id
         WHERE ${booked ? '' : "l.status != 'booked' AND "}l.memo_id IS NOT ? AND l.id IN (${marks(ids)}) ORDER BY l.lr_date, l.lr_no`,
      )
      .all(memoId, ...ids) as MemoTaken[];

  const memoRow = (db: Db, id: number): MemoRow | undefined => db.prepare(`SELECT ${MEMO_COLUMNS} FROM memos WHERE id = ?`).get(id) as MemoRow | undefined;
  const lrNosOf = (db: Db, ids: number[]) => db.prepare(`SELECT id, lr_no AS no FROM lrs WHERE id IN (${marks(ids)}) ORDER BY lr_date, lr_no`).all(...ids) as { id: number; no: number }[];
  const bump = (db: Db, id: number) => db.prepare(`UPDATE memos SET version = version + 1, updated_at = ${NOW} WHERE id = ?`).run(id);

  /** A memo with its LRs (at most 500), its frozen totals and the totals of its LRs now. */
  function detailOf(db: Db, id: number): MemoDetail | undefined {
    const m = db.prepare(`${DETAIL} WHERE m.id = ?`).get(id) as DetailRow | undefined;
    if (!m) return undefined;
    const lrs = db
      .prepare(`SELECT ${LR_COLUMNS} FROM lrs l JOIN stations s ON s.id = l.to_station_id WHERE l.memo_id = ? ORDER BY l.lr_date, l.lr_no LIMIT ${MAX_MEMO_LRS}`)
      .all(id) as MemoLrRow[];
    const { fQty, fToPay, fPaid, fCharges, fStax, ...head } = m;
    const frozen: MemoTotals = { lrs: m.lrCount, qty: fQty, toPayPaise: fToPay, paidPaise: fPaid, chargesPaise: fCharges, staxPaise: fStax };
    const current = db.prepare(FROZEN_SQL).get(id) as MemoTotals;
    return { ...head, frozen, now: current, differs: differs(m.status, current, frozen), lrs };
  }
  const detail = (db: Db, id: number): MemoDetail => detailOf(db, id) as MemoDetail;

  /** A change to a saved memo: one IMMEDIATE transaction; a `Stop` thrown inside undoes everything written so far. */
  const change = <T>(db: Db, body: () => KeeperResult<T>): KeeperResult<T> => {
    try {
      return db.transaction(body).immediate();
    } catch (e) {
      if (e instanceof Stop) return e.refusal;
      throw e;
    }
  };
  /** The memo a change is for: it must exist and be saved. */
  const savedMemo = (db: Db, id: number): MemoRow | Refusal => {
    const row = memoRow(db, id);
    if (!row) return refuse('memo-missing');
    return row.status === 'cancelled' ? refuse('memo-cancelled') : row;
  };
  const isRefusal = (v: MemoRow | Refusal): v is Refusal => 'ok' in v;
  /** One audit row for each LR that changed with the memo, written after the memo's own. */
  const auditLrs = (db: Db, seat: string, action: string, lrs: { id: number }[], before: object, after: object) => {
    for (const l of lrs) writeAudit(db, { seat, action, entity: 'lrs', entityId: l.id, before, after });
  };
  /** The LR ids of a take-off / move / add, each once, 1 to 500, all of them existing LRs: else the refusal. */
  const namedLrs = (db: Db, lrIds: number[]): { ids: number[] } | Refusal => {
    const { ids, error } = cleanIds(lrIds);
    if (error) return refuse('memo-invalid', { memoFields: { lrs: error } });
    const known = db.prepare(`SELECT COUNT(*) AS n FROM lrs WHERE id IN (${marks(ids)})`).get(...ids) as { n: number };
    return known.n === ids.length ? { ids } : refuse('memo-invalid', { memoFields: { lrs: 'missing' } });
  };
  const isIds = (v: { ids: number[] } | Refusal): v is { ids: number[] } => 'ids' in v;

  return {
    /** The challan number the next memo dated `date` will most likely get. */
    defaults(db: Db, date: string | null): KeeperResult<MemoDefaults> {
      const today = localDate(now());
      const on = date !== null && isDate(date) ? date : today;
      const last = db.prepare("SELECT last FROM counters WHERE name = 'challan' AND year = ?").get(Number(on.slice(0, 4))) as { last: number } | undefined;
      return ok({ today, nextNo: (last?.last ?? 0) + 1 });
    },

    /** Booked LRs by (date, number), 100 a page, with the count and quantity of the whole filter. */
    pending(db: Db, filters: MemoFilters, cursor: MemoCursor | null): KeeperResult<PendingPage> {
      const q = pendingSql(filters, cursor !== null);
      const rows = db.prepare(q.rows).all(cursor ? { ...q.args, cd: cursor.date, cn: cursor.no } : q.args) as MemoLrRow[];
      const total = db.prepare(q.count).get(q.args) as { count: number; qty: number };
      const last = rows[PAGE - 1];
      return ok({ rows: rows.slice(0, PAGE), next: rows.length > PAGE ? { date: last.date, no: last.lrNo } : null, ...total });
    },

    /** The ticked LRs that are still booked, added up in SQL. */
    totals(db: Db, ids: number[]): KeeperResult<PendingTotals> {
      return ok(db.prepare(`${TOTALS_SQL} (${marks(ids)})`).get(...ids) as PendingTotals);
    },

    /**
     * Save a memo (System PIN when dated other than today). One IMMEDIATE transaction: truck, driver, stations and LRs
     * checked → challan number → memo → claim of the LRs → totals frozen → audit row. The same `uid` returns the first memo.
     */
    create(db: Db, seat: string, input: MemoInput): KeeperResult<MemoSaved> {
      // A retry of a save that went through: the first memo again, nothing written, no PIN needed.
      const earlier = db.prepare('SELECT id FROM memos WHERE uid = ?').get(input.uid) as { id: number } | undefined;
      if (earlier) return ok({ ...rowOf(db, earlier.id), again: true });

      const today = localDate(now());
      const c = cleanMemo(input, today);
      if (Object.keys(c.errors).length > 0) return refuse('memo-invalid', { memoFields: c.errors });
      if (c.date !== today) {
        const gate = pins.verify(db, 'system', input.systemPin ?? '');
        if (!gate.ok) return gate;
      }

      return change(db, (): KeeperResult<MemoSaved> => {
        const usable = (table: 'trucks' | 'drivers' | 'stations', id: number | null) =>
          db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND active = 1`).get(id) !== undefined;
        const errors: MemoErrors = {};
        if (!usable('trucks', input.truckId)) errors.truck = 'missing';
        if (!usable('drivers', input.driverId)) errors.driver = 'missing';
        if (!usable('stations', input.fromStationId)) errors.fromStation = 'missing';
        if (!usable('stations', input.toStationId)) errors.toStation = 'missing';
        const known = db.prepare(`SELECT COUNT(*) AS n FROM lrs WHERE id IN (${marks(c.ids)})`).get(...c.ids) as { n: number };
        if (known.n !== c.ids.length) errors.lrs = 'missing';
        if (Object.keys(errors).length > 0) throw new Stop(refuse('memo-invalid', { memoFields: errors }));

        const { year, no } = nextNumber(db, 'challan', c.date);
        const memoId = Number(
          db
            .prepare(
              `INSERT INTO memos (uid, challan_year, challan_no, memo_date, truck_id, driver_id, from_station_id, to_station_id,
                 truck_hire_paise, loading_hamali_paise, seat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(input.uid, year, no, c.date, input.truckId, input.driverId, input.fromStationId, input.toStationId, c.hirePaise, c.hamaliPaise, seat).lastInsertRowid,
        );

        // The claim: only a booked LR can be loaded, and every ticked one must be. Anything less undoes the whole save.
        const claimed = db
          .prepare(`UPDATE lrs SET status = 'loaded', memo_id = ?, version = version + 1, updated_at = ${NOW} WHERE status = 'booked' AND id IN (${marks(c.ids)})`)
          .run(memoId, ...c.ids);
        if (claimed.changes !== c.ids.length) throw new Stop(refuse('memo-conflict', { taken: takenOf(db, c.ids, memoId) }));

        const frozen = db.prepare(FROZEN_SQL).get(memoId) as MemoTotals;
        db.prepare(
          `UPDATE memos SET frozen_lr_count = ?, frozen_qty = ?, frozen_topay_paise = ?, frozen_paid_paise = ?, frozen_charges_paise = ?, frozen_stax_paise = ? WHERE id = ?`,
        ).run(frozen.lrs, frozen.qty, frozen.toPayPaise, frozen.paidPaise, frozen.chargesPaise, frozen.staxPaise, memoId);

        writeAudit(db, {
          seat, action: 'memos.create', entity: 'memos', entityId: memoId,
          after: {
            challanYear: year, challanNo: no, date: c.date, truckId: input.truckId, driverId: input.driverId,
            fromStationId: input.fromStationId, toStationId: input.toStationId, truckHirePaise: c.hirePaise, loadingHamaliPaise: c.hamaliPaise,
            lrIds: c.ids, frozen,
          },
        });
        return ok({ ...rowOf(db, memoId), again: false });
      });
    },

    /** A saved memo: header, the totals frozen when it was saved, the totals now, and its LRs (at most 500). */
    get(db: Db, id: number): KeeperResult<MemoDetail> {
      const d = detailOf(db, id);
      return d ? ok(d) : refuse('memo-missing');
    },

    /** That day's saved memos (not the cancelled), newest first (null = today), at most 200. */
    byDate(db: Db, date: string | null): KeeperResult<MemoListRow[]> {
      const on = date !== null && isDate(date) ? date : localDate(now());
      return ok(db.prepare(`${MEMO_ROW} WHERE m.memo_date = ? AND m.status = 'saved' ORDER BY m.challan_year DESC, m.challan_no DESC LIMIT ${DAY_LIMIT}`).all(on) as MemoListRow[]);
    },

    /** Saved memos, newest first by (date, challan number), 100 a page, each with whether it differs from its LRs. */
    list(db: Db, filters: SavedMemoFilters, cursor: SavedMemoCursor | null): KeeperResult<SavedMemoPage> {
      const q = savedSql(filters, cursor !== null);
      const rows = (db.prepare(q.sql).all(cursor ? { ...q.args, cd: cursor.date, cn: cursor.no } : q.args) as (Omit<SavedMemoRow, 'differs'> & { differs: number })[]).map(
        (r): SavedMemoRow => ({ ...r, differs: r.differs === 1 }),
      );
      const last = rows[PAGE - 1];
      return ok({ rows: rows.slice(0, PAGE), next: rows.length > PAGE ? { date: last.date, no: last.challanNo } : null });
    },

    /**
     * Edit a saved memo's header (System PIN). Stale version refused with the current memo, then the rules of a new memo; the
     * date stays in the challan's year, the number never changes. A truck, driver or station the memo already has stays allowed
     * after it was deactivated. Only the changed fields are written, with a before / after audit row; nothing changed writes nothing.
     */
    editHeader(db: Db, seat: string, id: number, version: number, input: MemoHeaderInput, systemPin: string): KeeperResult<MemoChanged> {
      const gate = pins.verify(db, 'system', systemPin);
      if (!gate.ok) return gate;
      return change(db, (): KeeperResult<MemoChanged> => {
        const row = memoRow(db, id);
        if (!row) return refuse('memo-missing');
        if (row.version !== version) return refuse('memo-stale', { memo: detail(db, id) });
        if (row.status === 'cancelled') return refuse('memo-cancelled');

        const c = cleanHeader({ ...input, date: input.date ?? row.date }, localDate(now()));
        if (c.errors.date === undefined && c.date.slice(0, 4) !== String(row.challanYear)) c.errors.date = 'year';
        const usable = (table: 'trucks' | 'drivers' | 'stations', want: number | null, kept: number) =>
          want === kept || db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND active = 1`).get(want) !== undefined;
        if (c.errors.truck === undefined && !usable('trucks', input.truckId, row.truckId)) c.errors.truck = 'missing';
        if (c.errors.driver === undefined && !usable('drivers', input.driverId, row.driverId)) c.errors.driver = 'missing';
        if (c.errors.fromStation === undefined && !usable('stations', input.fromStationId, row.fromStationId)) c.errors.fromStation = 'missing';
        if (c.errors.toStation === undefined && !usable('stations', input.toStationId, row.toStationId)) c.errors.toStation = 'missing';
        if (Object.keys(c.errors).length > 0) return refuse('memo-invalid', { memoFields: c.errors });

        const next: Record<HeaderKey, string | number | null> = {
          date: c.date, truckId: input.truckId, driverId: input.driverId, fromStationId: input.fromStationId, toStationId: input.toStationId,
          truckHirePaise: c.hirePaise, loadingHamaliPaise: c.hamaliPaise,
        };
        const keys = HEADER_COLUMNS.filter(([k]) => next[k] !== row[k]);
        if (keys.length === 0) return ok({ memo: detail(db, id), changed: false });

        // The column names come from the fixed list above, never from the request.
        db.prepare(`UPDATE memos SET ${keys.map(([, col]) => `${col} = ?`).join(', ')}, version = version + 1, updated_at = ${NOW} WHERE id = ? AND version = ?`).run(
          ...keys.map(([k]) => next[k]),
          id,
          version,
        );
        writeAudit(db, {
          seat, action: 'memos.edit', entity: 'memos', entityId: id,
          before: Object.fromEntries(keys.map(([k]) => [k, row[k]])),
          after: Object.fromEntries(keys.map(([k]) => [k, next[k]])),
        });
        return ok({ memo: detail(db, id), changed: true });
      });
    },

    /**
     * Take LRs off a memo (System PIN): they go back to booked and reappear in pending on every seat. All named LRs must be on
     * the memo, and the memo keeps at least one (cancel it instead).
     */
    removeLrs(db: Db, seat: string, id: number, lrIds: number[], systemPin: string): KeeperResult<MemoDetail> {
      const gate = pins.verify(db, 'system', systemPin);
      if (!gate.ok) return gate;
      return change(db, (): KeeperResult<MemoDetail> => {
        const m = savedMemo(db, id);
        if (isRefusal(m)) return m;
        const named = namedLrs(db, lrIds);
        if (!isIds(named)) return named;
        const off = takenOf(db, named.ids, id, true);
        if (off.length > 0) return refuse('memo-conflict', { taken: off });
        const left = db.prepare('SELECT COUNT(*) AS n FROM lrs WHERE memo_id = ?').get(id) as { n: number };
        if (left.n - named.ids.length < 1) return refuse('memo-last-lr');

        const lrs = lrNosOf(db, named.ids);
        bump(db, id);
        writeAudit(db, { seat, action: 'memos.remove-lrs', entity: 'memos', entityId: id, after: { lrNos: lrs.map((l) => l.no) } });
        const done = db
          .prepare(`UPDATE lrs SET status = 'booked', memo_id = NULL, version = version + 1, updated_at = ${NOW} WHERE memo_id = ? AND status = 'loaded' AND id IN (${marks(named.ids)})`)
          .run(id, ...named.ids);
        if (done.changes !== named.ids.length) throw new Stop(refuse('memo-conflict', { taken: takenOf(db, named.ids, id, true) }));
        auditLrs(db, seat, 'lrs.memo-remove', lrs, { status: 'loaded', memoId: id }, { status: 'booked', memoId: null });
        return ok(detail(db, id));
      });
    },

    /**
     * Move LRs from this memo to another saved memo (System PIN), in one transaction: both memos then differ. The same
     * rules as taking them off: they must be on this memo, and it keeps at least one.
     */
    moveLrs(db: Db, seat: string, id: number, lrIds: number[], targetId: number, systemPin: string): KeeperResult<MemoDetail> {
      const gate = pins.verify(db, 'system', systemPin);
      if (!gate.ok) return gate;
      return change(db, (): KeeperResult<MemoDetail> => {
        const m = savedMemo(db, id);
        if (isRefusal(m)) return m;
        const target = targetId === id ? undefined : memoRow(db, targetId);
        if (!target || target.status !== 'saved') return refuse('memo-target');
        const named = namedLrs(db, lrIds);
        if (!isIds(named)) return named;
        const off = takenOf(db, named.ids, id, true);
        if (off.length > 0) return refuse('memo-conflict', { taken: off });
        const left = db.prepare('SELECT COUNT(*) AS n FROM lrs WHERE memo_id = ?').get(id) as { n: number };
        if (left.n - named.ids.length < 1) return refuse('memo-last-lr');
        const there = db.prepare('SELECT COUNT(*) AS n FROM lrs WHERE memo_id = ?').get(targetId) as { n: number };
        if (there.n + named.ids.length > MAX_MEMO_LRS) return refuse('memo-invalid', { memoFields: { lrs: 'many' } });

        const lrs = lrNosOf(db, named.ids);
        const nos = lrs.map((l) => l.no);
        bump(db, id);
        bump(db, targetId);
        writeAudit(db, { seat, action: 'memos.move-out', entity: 'memos', entityId: id, after: { lrNos: nos, toChallanNo: target.challanNo } });
        writeAudit(db, { seat, action: 'memos.move-in', entity: 'memos', entityId: targetId, after: { lrNos: nos, fromChallanNo: m.challanNo } });
        const done = db
          .prepare(`UPDATE lrs SET memo_id = ?, version = version + 1, updated_at = ${NOW} WHERE memo_id = ? AND status = 'loaded' AND id IN (${marks(named.ids)})`)
          .run(targetId, id, ...named.ids);
        if (done.changes !== named.ids.length) throw new Stop(refuse('memo-conflict', { taken: takenOf(db, named.ids, id, true) }));
        auditLrs(db, seat, 'lrs.memo-move', lrs, { memoId: id }, { memoId: targetId });
        return ok(detail(db, id));
      });
    },

    /**
     * Add pending LRs to a memo (System PIN), with the same claim guard as a new memo: an LR loaded or cancelled meanwhile (or
     * already on this memo) refuses the whole change and is named. A memo carries at most 500 LRs.
     */
    addLrs(db: Db, seat: string, id: number, lrIds: number[], systemPin: string): KeeperResult<MemoDetail> {
      const gate = pins.verify(db, 'system', systemPin);
      if (!gate.ok) return gate;
      return change(db, (): KeeperResult<MemoDetail> => {
        const m = savedMemo(db, id);
        if (isRefusal(m)) return m;
        const named = namedLrs(db, lrIds);
        if (!isIds(named)) return named;
        const taken = takenOf(db, named.ids, 0); // 0 is no memo: an LR already on this one is named too
        if (taken.length > 0) return refuse('memo-conflict', { taken });
        const have = db.prepare('SELECT COUNT(*) AS n FROM lrs WHERE memo_id = ?').get(id) as { n: number };
        if (have.n + named.ids.length > MAX_MEMO_LRS) return refuse('memo-invalid', { memoFields: { lrs: 'many' } });

        const lrs = lrNosOf(db, named.ids);
        bump(db, id);
        writeAudit(db, { seat, action: 'memos.add-lrs', entity: 'memos', entityId: id, after: { lrNos: lrs.map((l) => l.no) } });
        const claimed = db
          .prepare(`UPDATE lrs SET status = 'loaded', memo_id = ?, version = version + 1, updated_at = ${NOW} WHERE status = 'booked' AND id IN (${marks(named.ids)})`)
          .run(id, ...named.ids);
        if (claimed.changes !== named.ids.length) throw new Stop(refuse('memo-conflict', { taken: takenOf(db, named.ids, 0) }));
        auditLrs(db, seat, 'lrs.memo-add', lrs, { status: 'booked' }, { status: 'loaded', memoId: id });
        return ok(detail(db, id));
      });
    },

    /**
     * Recalculate (Admin PIN: it changes what was printed): the frozen totals become the totals of the LRs now, so the
     * "differs" flag goes. Audit row with the old and the new totals. Nothing to change writes nothing.
     */
    recalculate(db: Db, seat: string, id: number, version: number, adminPin: string): KeeperResult<MemoChanged> {
      const gate = pins.verify(db, 'admin', adminPin);
      if (!gate.ok) return gate;
      return change(db, (): KeeperResult<MemoChanged> => {
        const row = memoRow(db, id);
        if (!row) return refuse('memo-missing');
        if (row.version !== version) return refuse('memo-stale', { memo: detail(db, id) });
        if (row.status === 'cancelled') return refuse('memo-cancelled');
        const before = detail(db, id);
        if (!before.differs) return ok({ memo: before, changed: false });
        const n = before.now;
        db.prepare(
          `UPDATE memos SET frozen_lr_count = ?, frozen_qty = ?, frozen_topay_paise = ?, frozen_paid_paise = ?, frozen_charges_paise = ?, frozen_stax_paise = ?,
             version = version + 1, updated_at = ${NOW} WHERE id = ?`,
        ).run(n.lrs, n.qty, n.toPayPaise, n.paidPaise, n.chargesPaise, n.staxPaise, id);
        writeAudit(db, { seat, action: 'memos.recalculate', entity: 'memos', entityId: id, before: before.frozen, after: n });
        return ok({ memo: detail(db, id), changed: true });
      });
    },

    /**
     * Cancel a memo (Admin PIN and a reason): every LR goes back to booked, the memo is `cancelled`, its number is never used
     * again and its frozen totals stay as printed. There is no restore: a new memo is made from the pending LRs.
     */
    cancel(db: Db, seat: string, id: number, version: number, reason: string, adminPin: string): KeeperResult<MemoDetail> {
      const gate = pins.verify(db, 'admin', adminPin);
      if (!gate.ok) return gate;
      return change(db, (): KeeperResult<MemoDetail> => {
        const row = memoRow(db, id);
        if (!row) return refuse('memo-missing');
        if (row.version !== version) return refuse('memo-stale', { memo: detail(db, id) });
        if (row.status === 'cancelled') return refuse('memo-cancelled');
        const why = cleanReason(reason);
        if (why === null) return refuse('memo-invalid', { memoFields: { reason: 'required' } });

        const lrs = db.prepare('SELECT id, lr_no AS no FROM lrs WHERE memo_id = ? ORDER BY lr_date, lr_no').all(id) as { id: number; no: number }[];
        db.prepare(`UPDATE memos SET status = 'cancelled', version = version + 1, updated_at = ${NOW} WHERE id = ?`).run(id);
        writeAudit(db, {
          seat, action: 'memos.cancel', entity: 'memos', entityId: id,
          before: { status: 'saved' }, after: { status: 'cancelled', reason: why, lrNos: lrs.map((l) => l.no) },
        });
        db.prepare(`UPDATE lrs SET status = 'booked', memo_id = NULL, version = version + 1, updated_at = ${NOW} WHERE memo_id = ?`).run(id);
        auditLrs(db, seat, 'lrs.memo-cancel', lrs, { status: 'loaded', memoId: id }, { status: 'booked', memoId: null });
        return ok(detail(db, id));
      });
    },

    /** What happened to one memo, from the audit log: newest first, at most 50. */
    history(db: Db, id: number): KeeperResult<MemoHistoryEntry[]> {
      if (!memoRow(db, id)) return refuse('memo-missing');
      const rows = db
        .prepare(
          `SELECT at, seat, action, before_json AS before, after_json AS after FROM audit_log
           WHERE entity = 'memos' AND entity_id = ? ORDER BY at DESC, id DESC LIMIT ${HISTORY_LIMIT}`,
        )
        .all(String(id)) as { at: string; seat: string; action: string; before: string | null; after: string | null }[];
      const nameOf = (table: 'trucks' | 'drivers' | 'stations', value: unknown): string | null => {
        const col = table === 'trucks' ? 'number' : 'name';
        return (db.prepare(`SELECT ${col} AS name FROM ${table} WHERE id = ?`).get(value) as { name: string } | undefined)?.name ?? String(value);
      };
      const json = (text: string | null) => (text === null ? {} : (JSON.parse(text) as Record<string, unknown>));
      const names: Record<string, MemoHistoryEntry['action']> = {
        'memos.create': 'created', 'memos.edit': 'edited', 'memos.remove-lrs': 'removed', 'memos.add-lrs': 'added',
        'memos.move-out': 'moved-out', 'memos.move-in': 'moved-in', 'memos.recalculate': 'recalculated', 'memos.cancel': 'cancelled',
      };
      return ok(
        rows.flatMap((r) => {
          const action = names[r.action];
          if (!action) return [];
          const before = json(r.before);
          const after = json(r.after);
          const entry: MemoHistoryEntry = { at: r.at, seat: r.seat, action, changes: [], lrNos: Array.isArray(after.lrNos) ? (after.lrNos as number[]) : [] };
          if (action === 'edited') {
            const show = (key: HeaderKey, v: unknown): MemoChange['from'] =>
              v === null || v === undefined ? null : key === 'truckId' ? nameOf('trucks', v) : key === 'driverId' ? nameOf('drivers', v) : key === 'fromStationId' || key === 'toStationId' ? nameOf('stations', v) : (v as string | number);
            for (const [key] of HEADER_COLUMNS) if (key in after) entry.changes.push({ field: HEADER_FIELD[key], from: show(key, before[key]), to: show(key, after[key]) });
          } else if (action === 'recalculated') {
            for (const k of TOTAL_KEYS) if (before[k] !== after[k]) entry.changes.push({ field: TOTAL_FIELD[k], from: before[k] as number, to: after[k] as number });
          } else if (action === 'cancelled') entry.reason = String(after.reason ?? '');
          else if (action === 'moved-out') entry.otherNo = Number(after.toChallanNo);
          else if (action === 'moved-in') entry.otherNo = Number(after.fromChallanNo);
          return [entry];
        }),
      );
    },
  };
}
