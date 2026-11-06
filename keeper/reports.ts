// Reports (4.1): the LRs, memos and wasuli grouped for a period. Seven named reads, nothing written, no event. Every figure is added up
// here in SQL (money from lrSql.ts, the one twin of `lrAmounts`); the screen only formats. A report's rows are the groups, paged by their
// own key (100 a page, one row over to know there is a next page), and its totals are those of the whole filter, in the same answer.
//
// Periods: the LR date for every LR-based report (cancelled LRs left out, as Firm Accounts), the memo date for Truck-wise (cancelled
// memos left out), the collected date for the collected part of Wasuli. The LR-based reports share ONE `lrWhere`, so the same period and
// filters select the same LRs in every one of them and in the list of LRs behind a row (`lrs`).
import type {
  KeeperResult, ReportAgentRow, ReportAgentTotals, ReportCursor, ReportDateRow, ReportFirmRow, ReportFirmTotals, ReportLrCursor, ReportLrRow, ReportLrsPage,
  ReportLrsRequest, ReportMoney, ReportPage, ReportPartyRow, ReportQuery, ReportStationRow, ReportTruckRow, ReportTruckTotals, ReportWithWasuli,
} from '../shared';
import type { Db } from './db';
import { accountsSql } from './firmAccounts';
import { lrFiguresSql, lrMoneySql, lrSumsSql } from './lrSql';
import { DIFFERS_SQL, memoSumsSql } from './memos';
import { nameKey } from './names';

const ok = <T>(value: T): KeeperResult<T> => ({ ok: true, value });

const PAGE = 100;
type Args = Record<string, string | number>;
type LrReport = 'dateWise' | 'stationWise' | 'consignorWise' | 'consigneeWise';

const M = lrMoneySql('l.');
const FIGURES = lrFiguresSql('l.');
const WITH_TOTAL = `${lrSumsSql('l.')}, COALESCE(SUM(${M.total}), 0) AS totalPaise`;
const WASULI = 'COALESCE(SUM(l.wasuli_paise), 0) AS wasuliPaise';
/** SQLite's lower() lowers ASCII only; the same here, so a typed name and a stored one are compared alike. */
const asciiLower = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * The LRs a report counts: in the period, not cancelled, and the filters that make sense for that report (To station for Date-wise and
 * the party reports; typed text on either party for Date- and Station-wise, on that party for the party reports). Anything else in the
 * query is ignored. A fixed set of fragments: only values are bound.
 */
export function lrWhere(report: LrReport, q: ReportQuery): { where: string; args: Args } {
  const parts = ['l.lr_date BETWEEN @from AND @to', "l.status != 'cancelled'"];
  const args: Args = { from: q.from, to: q.to };
  if (q.toStationId !== null && report !== 'stationWise') {
    parts.push('l.to_station_id = @station');
    args.station = q.toStationId;
  }
  const text = asciiLower(q.text);
  if (text !== '') {
    const has = (who: 'consignor' | 'consignee') => `instr(lower(l.${who}_name), @text) > 0`;
    parts.push(report === 'consignorWise' ? has('consignor') : report === 'consigneeWise' ? has('consignee') : `(${has('consignor')} OR ${has('consignee')})`);
    args.text = text;
  }
  return { where: parts.join(' AND '), args };
}

/** The page's rows (a row over cut off) and where the next page starts. */
function paged<T>(raw: T[], at: (last: T) => ReportCursor): { rows: T[]; next: ReportCursor | null } {
  const rows = raw.slice(0, PAGE);
  return { rows, next: raw.length > PAGE ? at(rows[rows.length - 1]) : null };
}

/** Sum of the named number columns of some rows. */
function addUp<K extends string>(rows: Record<K, number>[], keys: readonly K[]): Record<K, number> {
  const total = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const r of rows) for (const k of keys) total[k] += r[k];
  return total;
}
const MONEY_KEYS = ['lrs', 'qty', 'toPayPaise', 'paidPaise', 'chargesPaise', 'staxPaise', 'totalPaise'] as const;
const WASULI_KEYS = ['lrs', 'qty', 'toPayPaise', 'paidPaise', 'wasuliPaise'] as const;

type Sorted<T> = T & { sortKey: string; sortNo: number };
const unsorted = <T>(r: Sorted<T>): T => {
  const { sortKey, sortNo, ...rest } = r;
  void sortKey;
  void sortNo;
  return rest as T;
};

// ---- the SQL of each report, exported for the EXPLAIN tests ----

export const dateSql = (q: ReportQuery, afterCursor: boolean) => {
  const w = lrWhere('dateWise', q);
  return {
    args: w.args,
    rows: `SELECT l.lr_date AS date, ${WITH_TOTAL} FROM lrs l WHERE ${w.where}${afterCursor ? ' AND l.lr_date > @after' : ''} GROUP BY l.lr_date ORDER BY l.lr_date LIMIT ${PAGE + 1}`,
    totals: `SELECT ${WITH_TOTAL} FROM lrs l WHERE ${w.where}`,
  };
};

export const stationSql = (q: ReportQuery, afterCursor: boolean) => {
  const w = lrWhere('stationWise', q);
  return {
    args: w.args,
    rows: `SELECT l.to_station_id AS stationId, s.name AS station, s.name_key AS sortKey, 0 AS sortNo, ${FIGURES}, ${WASULI}
      FROM lrs l JOIN stations s ON s.id = l.to_station_id WHERE ${w.where}${afterCursor ? ' AND s.name_key > @after' : ''}
      GROUP BY l.to_station_id ORDER BY s.name_key LIMIT ${PAGE + 1}`,
    totals: `SELECT ${FIGURES}, ${WASULI} FROM lrs l WHERE ${w.where}`,
  };
};

/**
 * A firm is one row by its id; a walk-in (no firm on that side) is one row by its name as booked, ASCII case ignored (the first spelling in
 * binary order is shown). Rows are ordered by the firm's name key or the walk-in's lower-cased name, then the firm id (0 for a walk-in),
 * which is unique, so the keyset cursor `(sortKey, sortNo)` never skips or repeats a row.
 */
export const partySql = (side: 'consignor' | 'consignee', q: ReportQuery, afterCursor: boolean) => {
  const w = lrWhere(side === 'consignor' ? 'consignorWise' : 'consigneeWise', q);
  const key = 'COALESCE(f.name_key, g.walkKey)';
  return {
    args: w.args,
    rows: `WITH g AS (
        SELECT l.${side}_id AS firmId, CASE WHEN l.${side}_id IS NULL THEN lower(l.${side}_name) END AS walkKey, MIN(l.${side}_name) AS walkName, ${FIGURES}, ${WASULI}
        FROM lrs l WHERE ${w.where} GROUP BY l.${side}_id, walkKey)
      SELECT g.firmId, COALESCE(f.name, g.walkName) AS name, st.name AS station, g.lrs, g.qty, g.toPayPaise, g.paidPaise, g.wasuliPaise,
        ${key} AS sortKey, COALESCE(g.firmId, 0) AS sortNo
      FROM g LEFT JOIN firms f ON f.id = g.firmId LEFT JOIN stations st ON st.id = f.station_id
      ${afterCursor ? `WHERE (${key}, COALESCE(g.firmId, 0)) > (@k, @n)` : ''}
      ORDER BY sortKey, sortNo LIMIT ${PAGE + 1}`,
    totals: `SELECT ${FIGURES}, ${WASULI} FROM lrs l WHERE ${w.where}`,
  };
};

/** Saved memos dated in the period. The page of memos is picked first; only those memos' LRs are added up (through `lrs_by_memo`) to tell "differs". */
export const truckSql = (q: ReportQuery, afterCursor: boolean) => {
  const parts = ["m.status = 'saved'", 'm.memo_date BETWEEN @from AND @to'];
  const args: Args = { from: q.from, to: q.to };
  if (q.truckId !== null) {
    parts.push('m.truck_id = @truck');
    args.truck = q.truckId;
  }
  if (q.toStationId !== null) {
    parts.push('m.to_station_id = @station');
    args.station = q.toStationId;
  }
  const where = parts.join(' AND ');
  return {
    args,
    rows: `WITH page AS (SELECT m.* FROM memos m WHERE ${where}${afterCursor ? ' AND (m.memo_date, m.challan_no) > (@k, @n)' : ''} ORDER BY m.memo_date, m.challan_no LIMIT ${PAGE + 1})
      SELECT m.id AS memoId, m.memo_date AS date, m.challan_year AS challanYear, m.challan_no AS challanNo, t.number AS truck, s.name AS toStation,
        m.frozen_lr_count AS lrs, m.frozen_topay_paise AS toPayPaise, m.frozen_paid_paise AS paidPaise,
        m.truck_hire_paise AS truckHirePaise, m.loading_hamali_paise AS loadingHamaliPaise, ${DIFFERS_SQL} AS differs
      FROM page m JOIN trucks t ON t.id = m.truck_id JOIN stations s ON s.id = m.to_station_id
      LEFT JOIN (${memoSumsSql('SELECT id FROM page')}) c ON c.memo_id = m.id
      ORDER BY m.memo_date, m.challan_no`,
    totals: `SELECT COUNT(*) AS memos, COALESCE(SUM(m.frozen_lr_count), 0) AS lrs, COALESCE(SUM(m.frozen_topay_paise), 0) AS toPayPaise, COALESCE(SUM(m.frozen_paid_paise), 0) AS paidPaise,
      COALESCE(SUM(m.truck_hire_paise), 0) AS truckHirePaise, COALESCE(SUM(m.loading_hamali_paise), 0) AS loadingHamaliPaise FROM memos m WHERE ${where}`,
  };
};

/**
 * For these firms (named placeholders @i0, @i1, …): their LRs in the period on either side, one line per firm and LR with a flag for each
 * side, so an LR with the firm on both sides adds its qty / to pay / paid once. Read through `lrs_by_consignor|consignee`.
 */
export const firmFiguresSql = (n: number): string => {
  const ids = Array.from({ length: n }, (_, i) => `@i${i}`).join(', ');
  const side = (col: string, c: number, e: number) =>
    `SELECT ${col} AS firm, id, ${c} AS isC, ${e} AS isE, qty, topay_paise AS topay, paid_paise AS paid FROM lrs
       WHERE ${col} IN (${ids}) AND lr_date BETWEEN @from AND @to AND status != 'cancelled'`;
  return `SELECT u.firm AS firmId, SUM(u.isC) AS asConsignor, SUM(u.isE) AS asConsignee, SUM(u.qty) AS qty, SUM(u.topay) AS toPayPaise, SUM(u.paid) AS paidPaise
    FROM (SELECT firm, id, MAX(isC) AS isC, MAX(isE) AS isE, MAX(qty) AS qty, MAX(topay) AS topay, MAX(paid) AS paid
          FROM (${side('consignor_id', 1, 0)} UNION ALL ${side('consignee_id', 0, 1)}) GROUP BY firm, id) u
    GROUP BY u.firm`;
};

/** The LRs of the period with a firm (or a walk-in) on each side, counted on the firm side only when its name matches the typed text. */
export const firmTotalsSql = (hasText: boolean): string =>
  `SELECT COUNT(f1.id) AS asConsignor, COUNT(f2.id) AS asConsignee, COALESCE(SUM(l.consignor_id IS NULL), 0) AS walkInConsignor, COALESCE(SUM(l.consignee_id IS NULL), 0) AS walkInConsignee
   FROM lrs l LEFT JOIN firms f1 ON f1.id = l.consignor_id${hasText ? ' AND instr(f1.name_key, @k) > 0' : ''}
   LEFT JOIN firms f2 ON f2.id = l.consignee_id${hasText ? ' AND instr(f2.name_key, @k) > 0' : ''}
   WHERE l.lr_date BETWEEN @from AND @to AND l.status != 'cancelled'`;

/** Collections assigned now, plus those collected in the period; one agent when asked. */
const wasuliRowsOf = (q: ReportQuery) => {
  const one = q.agentId !== null ? ' AND agent_id = @agent' : '';
  return `SELECT agent_id, status, amount_paise, collected_paise FROM wasuli WHERE status = 'assigned'${one}
    UNION ALL
    SELECT agent_id, status, amount_paise, collected_paise FROM wasuli WHERE status = 'collected' AND collected_date BETWEEN @from AND @to${one}`;
};
const AGENT_SUMS = `COUNT(*) FILTER (WHERE w.status = 'assigned') AS assignedCount, COALESCE(SUM(w.amount_paise) FILTER (WHERE w.status = 'assigned'), 0) AS assignedPaise,
  COUNT(*) FILTER (WHERE w.status = 'collected') AS collectedCount, COALESCE(SUM(w.collected_paise) FILTER (WHERE w.status = 'collected'), 0) AS collectedPaise`;
export const agentSql = (q: ReportQuery, afterCursor: boolean) => {
  const args: Args = { from: q.from, to: q.to };
  if (q.agentId !== null) args.agent = q.agentId;
  return {
    args,
    rows: `SELECT w.agent_id AS agentId, a.name AS agent, a.active, ${AGENT_SUMS}, a.name_key AS sortKey, 0 AS sortNo
      FROM (${wasuliRowsOf(q)}) w JOIN agents a ON a.id = w.agent_id ${afterCursor ? 'WHERE a.name_key > @after' : ''}
      GROUP BY w.agent_id ORDER BY a.name_key LIMIT ${PAGE + 1}`,
    totals: `SELECT ${AGENT_SUMS} FROM (${wasuliRowsOf(q)}) w`,
    pool: "SELECT COUNT(*) AS poolCount, COALESCE(SUM(amount_paise), 0) AS poolPaise FROM wasuli WHERE status = 'unassigned'",
  };
};

/** The LRs behind one row: the report's own `lrWhere` plus the row's group, so they add up to the row. */
export const lrsSql = (req: ReportLrsRequest, afterCursor: boolean) => {
  const w = lrWhere(req.of.kind, req.query);
  const args = { ...w.args };
  let group: string;
  if (req.of.kind === 'stationWise') {
    group = 'l.to_station_id = @gs';
    args.gs = req.of.stationId;
  } else {
    const side = req.of.kind === 'consignorWise' ? 'consignor' : 'consignee';
    if (req.of.firmId !== null) {
      group = `l.${side}_id = @gf`;
      args.gf = req.of.firmId;
    } else {
      group = `l.${side}_id IS NULL AND lower(l.${side}_name) = @gn`;
      args.gn = asciiLower(req.of.name);
    }
  }
  const where = `${w.where} AND ${group}`;
  return {
    args,
    rows: `SELECT l.id AS lrId, l.lr_no AS lrNo, l.lr_year AS lrYear, l.lr_date AS date, l.consignor_name AS consignor, l.consignee_name AS consignee, ts.name AS toStation,
        l.qty, l.topay_paise AS toPayPaise, l.paid_paise AS paidPaise, ${M.charges} AS chargesPaise, ${M.stax} AS staxPaise, ${M.total} AS totalPaise, l.status
      FROM lrs l JOIN stations ts ON ts.id = l.to_station_id WHERE ${where}${afterCursor ? ' AND (l.lr_date, l.lr_no) > (@cd, @cn)' : ''}
      ORDER BY l.lr_date, l.lr_no LIMIT ${PAGE + 1}`,
    totals: `SELECT ${WITH_TOTAL} FROM lrs l WHERE ${where}`,
  };
};

export function makeReports() {
  // The cursor under every name the statements use (better-sqlite3 ignores a named value a statement does not contain).
  const after = (cursor: ReportCursor | null, args: Args): Args => (cursor ? { ...args, after: cursor.key, k: cursor.key, n: cursor.no } : args);

  return {
    dateWise(db: Db, q: ReportQuery, cursor: ReportCursor | null): KeeperResult<ReportPage<ReportDateRow, ReportMoney>> {
      const s = dateSql(q, cursor !== null);
      const raw = db.prepare(s.rows).all(after(cursor, s.args)) as ReportDateRow[];
      // Every date on this one page: the totals are the sum of the rows, no second pass over the LRs (the card's 20,000-LR budget).
      const totals = cursor === null && raw.length <= PAGE ? addUp(raw, MONEY_KEYS) : (db.prepare(s.totals).get(s.args) as ReportMoney);
      return ok({ ...paged(raw, (r) => ({ key: r.date, no: 0 })), totals });
    },

    stationWise(db: Db, q: ReportQuery, cursor: ReportCursor | null): KeeperResult<ReportPage<ReportStationRow, ReportWithWasuli>> {
      const s = stationSql(q, cursor !== null);
      const raw = db.prepare(s.rows).all(after(cursor, s.args)) as Sorted<ReportStationRow>[];
      const totals = cursor === null && raw.length <= PAGE ? addUp(raw, WASULI_KEYS) : (db.prepare(s.totals).get(s.args) as ReportWithWasuli);
      const p = paged(raw, (r) => ({ key: r.sortKey, no: 0 }));
      return ok({ rows: p.rows.map(unsorted), next: p.next, totals });
    },

    partyWise(db: Db, side: 'consignor' | 'consignee', q: ReportQuery, cursor: ReportCursor | null): KeeperResult<ReportPage<ReportPartyRow, ReportWithWasuli>> {
      const s = partySql(side, q, cursor !== null);
      const raw = db.prepare(s.rows).all(after(cursor, s.args)) as Sorted<ReportPartyRow>[];
      const totals = cursor === null && raw.length <= PAGE ? addUp(raw, WASULI_KEYS) : (db.prepare(s.totals).get(s.args) as ReportWithWasuli);
      const p = paged(raw, (r) => ({ key: r.sortKey, no: r.sortNo }));
      return ok({ rows: p.rows.map(unsorted), next: p.next, totals });
    },

    truckWise(db: Db, q: ReportQuery, cursor: ReportCursor | null): KeeperResult<ReportPage<ReportTruckRow, ReportTruckTotals>> {
      const s = truckSql(q, cursor !== null);
      const raw = (db.prepare(s.rows).all(after(cursor, s.args)) as (Omit<ReportTruckRow, 'differs'> & { differs: number })[]).map((r): ReportTruckRow => ({ ...r, differs: r.differs === 1 }));
      const totals = db.prepare(s.totals).get(s.args) as ReportTruckTotals;
      return ok({ ...paged(raw, (r) => ({ key: r.date, no: r.challanNo })), totals });
    },

    /** Firms with an LR in the period, by name (the firm list's own page query), each with its LR counts per side and its figures. */
    firmWise(db: Db, q: ReportQuery, cursor: ReportCursor | null): KeeperResult<ReportPage<ReportFirmRow, ReportFirmTotals>> {
      const list = accountsSql({ text: q.text, stationId: null, showInactive: true, period: { from: q.from, to: q.to } }, cursor !== null);
      const firms = db.prepare(list.rows).all(cursor ? { ...list.args, after: cursor.key } : list.args) as { id: number; name: string; key: string; active: number }[];
      const page = firms.slice(0, PAGE);
      const figures = new Map(
        (page.length === 0
          ? []
          : (db.prepare(firmFiguresSql(page.length)).all({ from: q.from, to: q.to, ...Object.fromEntries(page.map((f, i) => [`i${i}`, f.id])) }) as Omit<ReportFirmRow, 'name' | 'active'>[])
        ).map((r) => [r.firmId, r] as const),
      );
      const rows = page.map((f): ReportFirmRow => {
        const x = figures.get(f.id);
        return { firmId: f.id, name: f.name, active: f.active === 1, asConsignor: x?.asConsignor ?? 0, asConsignee: x?.asConsignee ?? 0, qty: x?.qty ?? 0, toPayPaise: x?.toPayPaise ?? 0, paidPaise: x?.paidPaise ?? 0 };
      });
      const key = nameKey(q.text);
      const sides = db.prepare(firmTotalsSql(key !== ''))
        .get({ from: q.from, to: q.to, ...(key !== '' ? { k: key } : {}) }) as Omit<ReportFirmTotals, 'firms'>;
      const count = (db.prepare(list.count).get(list.args) as { count: number }).count;
      return ok({ rows, next: firms.length > PAGE ? { key: page[page.length - 1].key, no: 0 } : null, totals: { firms: count, ...sides } });
    },

    wasuli(db: Db, q: ReportQuery, cursor: ReportCursor | null): KeeperResult<ReportPage<ReportAgentRow, ReportAgentTotals>> {
      const s = agentSql(q, cursor !== null);
      const raw = (db.prepare(s.rows).all(after(cursor, s.args)) as Sorted<Omit<ReportAgentRow, 'active'> & { active: number }>[]).map(
        (r): Sorted<ReportAgentRow> => ({ ...r, active: r.active === 1 }),
      );
      const sums = db.prepare(s.totals).get(s.args) as Omit<ReportAgentTotals, 'poolCount' | 'poolPaise'>;
      const pool = db.prepare(s.pool).get() as Pick<ReportAgentTotals, 'poolCount' | 'poolPaise'>;
      const p = paged(raw, (r) => ({ key: r.sortKey, no: 0 }));
      return ok({ rows: p.rows.map(unsorted), next: p.next, totals: { ...sums, ...pool } });
    },

    /** The LRs of one row of Station-, Consignor- or Consignee-wise by (date, number), 100 a page, with their totals. */
    lrs(db: Db, req: ReportLrsRequest, cursor: ReportLrCursor | null): KeeperResult<ReportLrsPage> {
      const s = lrsSql(req, cursor !== null);
      const raw = db.prepare(s.rows).all(cursor ? { ...s.args, cd: cursor.date, cn: cursor.no } : s.args) as ReportLrRow[];
      const rows = raw.slice(0, PAGE);
      const last = rows[rows.length - 1];
      const totals = db.prepare(s.totals).get(s.args) as ReportMoney;
      return ok({ rows, next: raw.length > PAGE && last ? { date: last.date, no: last.lrNo } : null, totals });
    },
  };
}
