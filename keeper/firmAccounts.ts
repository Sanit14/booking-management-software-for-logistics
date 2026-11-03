// Firm Accounts (3.5): what a firm sent and received in a period. Five named reads, nothing written, no event. The period is by LR
// date, both days included, cancelled LRs left out. Every figure is added up here in SQL; the screen only formats. The money
// expressions are the SQL twin of `lrAmounts` (tax per LR, round half up, then summed) — firmAccounts.dbtest.ts compares them.
import type {
  FirmAccountCursor, FirmAccountFilters, FirmAccountPage, FirmAccountRow, FirmFigures, FirmKpis, FirmMonth, FirmRole, KeeperResult, ResultCode,
  StatementCursor, StatementPage, StatementQuery, StatementRow, StatementTop, StatementTotals, TopItem,
} from '../shared';
import type { Db } from './db';
import { growthPct, monthRows, previousPeriod } from './firmRules';
import { localDate } from './lrRules';
import { nameKey } from './names';

type Refusal = Extract<KeeperResult<never>, { ok: false }>;
const refuse = (code: ResultCode): Refusal => ({ ok: false, code });
const ok = <T>(value: T): KeeperResult<T> => ({ ok: true, value });

const PAGE = 100;
const TOP = 5;
const marks = (n: number): string => Array.from({ length: n }, () => '?').join(', ');
/** Named values for a statement; a statement with none takes no argument at all. */
const bind = (args: Record<string, string | number>): [Record<string, string | number>] | [] => (Object.keys(args).length > 0 ? [args] : []);

// ---- the LRs of one firm in a period ----

const LIVE = "l.status != 'cancelled'";
/**
 * The firm's LRs, as a WHERE on `lrs l` with @f (firm), @from, @to. One index range per side; for both sides the ids of the two
 * ranges are joined with UNION, so an LR with the firm on both sides is one row.
 */
const RANGE = 'l.lr_date BETWEEN @from AND @to';
function setOf(role: FirmRole): string {
  if (role === 'consignor') return `l.consignor_id = @f AND ${RANGE} AND ${LIVE}`;
  if (role === 'consignee') return `l.consignee_id = @f AND ${RANGE} AND ${LIVE}`;
  const side = (col: string) => `SELECT id FROM lrs WHERE ${col} = @f AND lr_date BETWEEN @from AND @to`;
  return `l.id IN (${side('consignor_id')} UNION ${side('consignee_id')}) AND ${LIVE}`;
}

const CHARGES = 'l.godown_bhada_paise + l.godown_insurance_paise + l.delivery_charges_paise + l.hamali_paise + l.pf_paise';
const FREIGHT = '(l.topay_paise + l.paid_paise)';
/** Tax on freight only, per LR, rounded half up: the same arithmetic as `taxPaise`. */
const STAX = `((${FREIGHT} * l.stax_bp + 5000) / 10000)`;
const TOTAL = `(${FREIGHT} + ${CHARGES} + ${STAX})`;

const SUMS = `COUNT(*) AS lrs, COALESCE(SUM(l.qty), 0) AS qty, COALESCE(SUM(l.topay_paise), 0) AS toPayPaise, COALESCE(SUM(l.paid_paise), 0) AS paidPaise,
    COALESCE(SUM(${CHARGES}), 0) AS chargesPaise, COALESCE(SUM(${STAX}), 0) AS staxPaise, COALESCE(SUM(${TOTAL}), 0) AS totalPaise,
    COALESCE(SUM(w.amount_paise), 0) AS wasuliOwedPaise, COALESCE(SUM(w.collected_paise), 0) AS wasuliCollectedPaise`;
const ROW_COLUMNS = `l.id AS lrId, l.lr_no AS lrNo, l.lr_year AS lrYear, l.lr_date AS date,
    CASE WHEN l.consignor_id = @f AND l.consignee_id = @f THEN 'both' WHEN l.consignor_id = @f THEN 'consignor' ELSE 'consignee' END AS role,
    CASE WHEN l.consignor_id = @f THEN l.consignee_name ELSE l.consignor_name END AS party,
    fs.name AS fromStation, ts.name AS toStation, l.particular, l.qty, l.topay_paise AS toPayPaise, l.paid_paise AS paidPaise,
    ${CHARGES} AS chargesPaise, ${STAX} AS staxPaise, ${TOTAL} AS totalPaise, l.status, l.memo_id AS memoId, m.challan_no AS challanNo,
    w.status AS wasuliStatus, COALESCE(w.amount_paise, 0) AS wasuliPaise, COALESCE(w.collected_paise, 0) AS wasuliCollectedPaise`;

/** Every statement the page needs for one role, built from fixed text: only values are bound (@f, @from, @to; @cd and @cn after a cursor). */
export function firmSql(role: FirmRole) {
  const set = setOf(role);
  const top = (name: string, from: string, group: string) =>
    `SELECT ${name} AS name, COUNT(*) AS lrs FROM lrs l ${from} WHERE ${set} GROUP BY ${group} ORDER BY lrs DESC, name LIMIT ${TOP}`;
  return {
    // The page of LRs is picked first (a firm may have thousands) and the joins are made for those 101 only. Each side picks its own first
    // 101 by its index (it reads about that many rows, not all of the firm's); for both sides the two are merged and cut to 101 again, and
    // an LR with the firm on both sides, picked by both, is one row (UNION).
    rows: (afterCursor: boolean) => {
      const pick = (col: string) =>
        `SELECT id, d, n FROM (SELECT l.id AS id, l.lr_date AS d, l.lr_no AS n FROM lrs l WHERE l.${col} = @f AND ${RANGE} AND ${LIVE}${afterCursor ? ' AND (l.lr_date, l.lr_no) > (@cd, @cn)' : ''} ORDER BY l.lr_date, l.lr_no LIMIT ${PAGE + 1})`;
      const picked =
        role === 'consignor' ? pick('consignor_id') : role === 'consignee' ? pick('consignee_id') : `${pick('consignor_id')} UNION ${pick('consignee_id')} ORDER BY d, n LIMIT ${PAGE + 1}`;
      return `SELECT ${ROW_COLUMNS}
       FROM (${picked}) p JOIN lrs l ON l.id = p.id
       JOIN stations fs ON fs.id = l.from_station_id JOIN stations ts ON ts.id = l.to_station_id
       LEFT JOIN memos m ON m.id = l.memo_id LEFT JOIN wasuli w ON w.lr_id = l.id
       ORDER BY l.lr_date, l.lr_no`;
    },
    totals: `SELECT ${SUMS} FROM lrs l LEFT JOIN wasuli w ON w.lr_id = l.id WHERE ${set}`,
    kpis: `SELECT COUNT(*) AS lrs, COUNT(DISTINCT l.memo_id) AS trips, COALESCE(SUM(l.qty), 0) AS qty, COALESCE(SUM(${FREIGHT}), 0) AS freightPaise,
      COALESCE(SUM(${TOTAL}), 0) AS totalPaise, COALESCE(SUM(w.collected_paise), 0) AS wasuliCollectedPaise
      FROM lrs l LEFT JOIN wasuli w ON w.lr_id = l.id WHERE ${set}`,
    months: `SELECT substr(l.lr_date, 1, 7) AS month, COUNT(*) AS lrs, COALESCE(SUM(${FREIGHT}), 0) AS freightPaise FROM lrs l WHERE ${set} GROUP BY month LIMIT 13`,
    // The other party as booked: the consignee when the firm is the consignor, else the consignor.
    parties: top('CASE WHEN l.consignor_id = @f THEN l.consignee_name ELSE l.consignor_name END', '', 'name'),
    stations: top('ts.name', 'JOIN stations ts ON ts.id = l.to_station_id', 'l.to_station_id'),
    trucks: top('t.number', 'JOIN memos m ON m.id = l.memo_id JOIN trucks t ON t.id = m.truck_id', 'm.truck_id'),
  };
}

// ---- the firm list ----

/**
 * One page of firms by name (a row over, to know there is a next one) and the count of the whole filter. The LRs of the page's
 * firms are counted afterwards (`countsSql`), so a filter that only looks at firms never touches `lrs`, and "has LRs in the period"
 * is an index lookup per firm.
 */
export function accountsSql(f: FirmAccountFilters, afterCursor: boolean) {
  const parts = ['1 = 1'];
  const args: Record<string, string | number> = {};
  if (!f.showInactive) parts.push('f.active = 1');
  if (f.stationId !== null) {
    parts.push('f.station_id = @station');
    args.station = f.stationId;
  }
  const key = nameKey(f.text);
  if (key !== '') {
    // instr, not LIKE: a % or _ typed is just a character
    parts.push('instr(f.name_key, @k) > 0');
    args.k = key;
  }
  if (f.period) {
    const side = (col: string) => `EXISTS (SELECT 1 FROM lrs x WHERE x.${col} = f.id AND x.lr_date BETWEEN @pf AND @pt AND x.status != 'cancelled')`;
    parts.push(`(${side('consignor_id')} OR ${side('consignee_id')})`);
    args.pf = f.period.from;
    args.pt = f.period.to;
  }
  const where = parts.join(' AND ');
  return {
    args,
    rows: `SELECT f.id, f.name, f.name_key AS key, s.name AS station, f.phone, f.active FROM firms f LEFT JOIN stations s ON s.id = f.station_id
      WHERE ${where}${afterCursor ? ' AND f.name_key > @after' : ''} ORDER BY f.name_key LIMIT ${PAGE + 1}`,
    count: `SELECT COUNT(*) AS count FROM firms f WHERE ${where}`,
  };
}

/** Each of these firms' LRs on one side, with the latest date: an index lookup per firm. */
export const countsSql = (col: 'consignor_id' | 'consignee_id', n: number): string =>
  `SELECT ${col} AS id, COUNT(*) AS n, MAX(lr_date) AS last FROM lrs WHERE ${col} IN (${marks(n)}) AND status != 'cancelled' GROUP BY ${col}`;

const FIGURE_KEYS = ['lrs', 'trips', 'qty', 'freightPaise', 'totalPaise', 'wasuliCollectedPaise'] as const;

export function makeFirmAccounts(now: () => Date = () => new Date()) {
  const firmExists = (db: Db, id: number): boolean => db.prepare('SELECT 1 FROM firms WHERE id = ?').get(id) !== undefined;
  const argsOf = (q: StatementQuery) => ({ f: q.firmId, from: q.from, to: q.to });

  return {
    /** Every firm (active and inactive), by name, 100 a page, each with its LRs as consignor and as consignee. */
    accounts(db: Db, f: FirmAccountFilters, cursor: FirmAccountCursor | null): KeeperResult<FirmAccountPage> {
      const q = accountsSql(f, cursor !== null);
      const raw = db.prepare(q.rows).all(...bind(cursor ? { ...q.args, after: cursor.key } : q.args)) as {
        id: number; name: string; key: string; station: string | null; phone: string; active: number;
      }[];
      const page = raw.slice(0, PAGE);
      const side = (col: 'consignor_id' | 'consignee_id') =>
        new Map(
          (page.length === 0 ? [] : (db.prepare(countsSql(col, page.length)).all(...page.map((r) => r.id)) as { id: number; n: number; last: string }[])).map((r) => [r.id, r] as const),
        );
      const [asConsignor, asConsignee] = [side('consignor_id'), side('consignee_id')];
      const rows = page.map((r): FirmAccountRow => {
        const [a, b] = [asConsignor.get(r.id), asConsignee.get(r.id)];
        const lastLrDate = [a?.last, b?.last].filter((d): d is string => d !== undefined).sort().pop() ?? null;
        return { id: r.id, name: r.name, station: r.station, phone: r.phone, active: r.active === 1, asConsignor: a?.n ?? 0, asConsignee: b?.n ?? 0, lastLrDate };
      });
      const count = (db.prepare(q.count).get(...bind(q.args)) as { count: number }).count;
      return ok({ rows, next: raw.length > PAGE ? { key: page[page.length - 1].key } : null, count });
    },

    /** The firm's LRs in the period by (date, number), 100 a page, and the totals of the whole period. */
    statement(db: Db, q: StatementQuery, cursor: StatementCursor | null): KeeperResult<StatementPage> {
      if (!firmExists(db, q.firmId)) return refuse('master-missing');
      const sql = firmSql(q.role);
      const raw = db.prepare(sql.rows(cursor !== null)).all(cursor ? { ...argsOf(q), cd: cursor.date, cn: cursor.no } : argsOf(q)) as StatementRow[];
      const rows = raw.slice(0, PAGE);
      const last = rows[rows.length - 1];
      const totals = db.prepare(sql.totals).get(argsOf(q)) as StatementTotals;
      return ok({ rows, next: raw.length > PAGE && last ? { date: last.date, no: last.lrNo } : null, totals });
    },

    /** The five most frequent other parties, To stations and trucks (through memos) in the period, with their LR counts. */
    statementTop(db: Db, q: StatementQuery): KeeperResult<StatementTop> {
      if (!firmExists(db, q.firmId)) return refuse('master-missing');
      const sql = firmSql(q.role);
      const all = (text: string) => db.prepare(text).all(argsOf(q)) as TopItem[];
      return ok({ parties: all(sql.parties), stations: all(sql.stations), trucks: all(sql.trucks) });
    },

    /** The period and the one of the same length just before it, with the growth of each figure. */
    kpis(db: Db, q: StatementQuery): KeeperResult<FirmKpis> {
      if (!firmExists(db, q.firmId)) return refuse('master-missing');
      const sql = firmSql(q.role).kpis;
      const previous = previousPeriod(q);
      const figures = (from: string, to: string) => db.prepare(sql).get({ f: q.firmId, from, to }) as FirmFigures;
      const [now, before] = [figures(q.from, q.to), figures(previous.from, previous.to)];
      const growth = Object.fromEntries(FIGURE_KEYS.map((k) => [k, growthPct(now[k], before[k])])) as FirmKpis['growth'];
      return ok({ range: { from: q.from, to: q.to }, previous, now, before, growth });
    },

    /** The 12 months of a calendar year (December before it is read too, for January's growth). */
    months(db: Db, firmId: number, year: number, role: FirmRole): KeeperResult<FirmMonth[]> {
      if (!firmExists(db, firmId)) return refuse('master-missing');
      const found = db.prepare(firmSql(role).months).all({ f: firmId, from: `${year - 1}-12-01`, to: `${year}-12-31` }) as { month: string; lrs: number; freightPaise: number }[];
      return ok(monthRows(year, new Map(found.map((r) => [r.month, r])), localDate(now())));
    },
  };
}
