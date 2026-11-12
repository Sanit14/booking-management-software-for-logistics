// History (4.2): the audit log, read. A page of rows newest first, filtered by SQL, each row turned into data the screen can word: the record it
// is about, the facts around it and what changed (old -> new) with names instead of ids. Nothing here writes, and nothing is logged (names and
// amounts are not for the log). The sentences are the screen's job (src/logic/historySentence.ts); the keeper sends data, not wording.
import {
  type HistoryChange, type HistoryCursor, type HistoryFacts, type HistoryFilters, type HistoryPage, type HistoryRecord, type HistoryRow, type HistoryUnit,
  type KeeperResult,
} from '../shared';
import { parseJson } from './audit';
import type { Db } from './db';
import { classify, conditionsFor, utcBounds } from './historyRules';
import { lrEntry } from './lrs';
import { localDate } from './lrRules';
import { memoEntry } from './memos';
import { percentText } from './memoSettlement';

const PAGE = 100;

// The audit row with the numbers of what it is about. Each join is tied to its own entity, so an LR id, a memo id and a firm id that are the
// same number can never meet. A wasuli row reaches its LR through the collection (a removed collection is read from the row's own JSON).
const SELECT = `SELECT a.id, a.at, a.seat, a.action, a.entity, a.entity_id AS entityId, a.before_json AS before, a.after_json AS after,
  l.lr_no AS lrNo, l.lr_year AS lrYear, m.challan_no AS challanNo, m.challan_year AS challanYear,
  wl.lr_no AS wLrNo, wl.lr_year AS wLrYear, w.amount_paise AS wAmount
FROM audit_log a
LEFT JOIN lrs l ON a.entity = 'lrs' AND l.id = CAST(a.entity_id AS INTEGER)
LEFT JOIN memos m ON a.entity = 'memos' AND m.id = CAST(a.entity_id AS INTEGER)
LEFT JOIN wasuli w ON a.entity = 'wasuli' AND w.id = CAST(a.entity_id AS INTEGER)
LEFT JOIN lrs wl ON wl.id = w.lr_id`;

interface Raw {
  id: number;
  at: string;
  seat: string;
  action: string;
  entity: string;
  entityId: string;
  before: string | null;
  after: string | null;
  lrNo: number | null;
  lrYear: number | null;
  challanNo: number | null;
  challanYear: number | null;
  wLrNo: number | null;
  wLrYear: number | null;
  wAmount: number | null;
}

const asciiLower = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase()); // SQLite's lower() is ASCII only

/**
 * The statement for one page, from fixed fragments: only values are bound. `lrId` / `memoId` are the records the LR no. / Challan no. boxes
 * found (null = that box is empty). 101 rows are read to know whether there is a next page.
 */
export function pageSql(f: HistoryFilters, scope: { lrId: number | null; memoId: number | null }, after: HistoryCursor | null): { sql: string; args: unknown[] } {
  const where = ['a.at >= ? AND a.at < ?'];
  const { fromAt, toAt } = utcBounds(f.from, f.to);
  const args: unknown[] = [fromAt, toAt];
  if (f.seat !== '') {
    where.push('instr(lower(a.seat), ?) > 0');
    args.push(asciiLower(f.seat));
  }
  if (f.kind !== null || f.verb !== null) {
    const terms = conditionsFor(f.kind, f.verb).map((c) => {
      args.push(c.action);
      if (c.entity === null) return 'a.action = ?';
      args.push(c.entity);
      return '(a.action = ? AND a.entity = ?)';
    });
    where.push(terms.length > 0 ? `(${terms.join(' OR ')})` : '0');
  }
  if (!(f.showPrints || f.kind === 'print' || f.verb === 'printed')) where.push("a.action NOT LIKE 'print.%'");
  if (scope.lrId !== null) {
    where.push(
      `a.id IN (SELECT id FROM audit_log WHERE entity = 'lrs' AND entity_id = ?
        UNION ALL SELECT x.id FROM wasuli w2 JOIN audit_log x ON x.entity = 'wasuli' AND x.entity_id = CAST(w2.id AS TEXT) WHERE w2.lr_id = ?)`,
    );
    args.push(String(scope.lrId), scope.lrId);
  }
  if (scope.memoId !== null) {
    where.push("a.entity = 'memos' AND a.entity_id = ?");
    args.push(String(scope.memoId));
  }
  if (after) {
    where.push('(a.at < ? OR (a.at = ? AND a.id < ?))');
    args.push(after.at, after.at, after.id);
  }
  return { sql: `${SELECT} WHERE ${where.join(' AND ')} ORDER BY a.at DESC, a.id DESC LIMIT ${PAGE + 1}`, args };
}

// ---- turning a row into data ----

// How a changed value is written. Fields not named here are shown as they are.
const UNIT: Record<string, HistoryUnit> = {
  toPay: 'paise', paid: 'paise', hamali: 'paise', wasuli: 'paise', truckHire: 'paise', loadingHamali: 'paise', amount: 'paise', date: 'date',
  // Only the rows saved before 4.5 name these: the charges and service tax of an LR and of a memo recalculation, and the LR defaults.
  godownBhada: 'paise', godownInsurance: 'paise', deliveryCharges: 'paise', charges: 'paise', stax: 'paise', staxPercent: 'percent', chargeOption: 'option',
  // The memo settlement (4.6): the rate per article in paise, the round figure in whole rupees; the commission is turned into its % text below.
  hamaliRate: 'paise', roundFigure: 'rupees',
};
const percentOf = (v: HistoryChange['from']): HistoryChange['from'] => (typeof v === 'number' ? percentText(v) : v);
const change = (field: string, from: HistoryChange['from'], to: HistoryChange['to']): HistoryChange =>
  field === 'commission' ? { field, from: percentOf(from), to: percentOf(to), unit: 'percent' } : UNIT[field] ? { field, from, to, unit: UNIT[field] } : { field, from, to };

const MASTER_RECORD: Record<string, HistoryRecord> = { stations: 'station', firms: 'firm', trucks: 'truck', drivers: 'driver', agents: 'agent' };
const NAME_COLUMN = { stations: 'name', firms: 'name', agents: 'name', drivers: 'name', trucks: 'number' } as const;
type NamedTable = keyof typeof NAME_COLUMN;

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** What a row's ids are looked up with, once each per page. */
interface Look {
  nameOf: (table: NamedTable, id: unknown) => string | null;
  challanNo: (id: unknown) => number | null;
  lrOf: (id: unknown) => { no: number; year: number } | null;
  /** The LR of a collection that was removed since: read from the row that made it. */
  lrOfWasuli: (wasuliId: number) => { no: number; year: number } | null;
}

function describe(db: Db, r: Raw, { nameOf, challanNo, lrOf, lrOfWasuli }: Look): HistoryRow {
  const { kind, verb } = classify(r.action, r.entity);
  const before = parseJson(r.before);
  const after = parseJson(r.after);
  const row: HistoryRow = {
    id: r.id, at: r.at, seat: r.seat, action: r.action, kind, verb, record: null, openId: null,
    lrNo: null, lrYear: null, challanNo: null, challanYear: null, name: null, changes: [], facts: {},
  };
  const f: HistoryFacts = row.facts;
  const id = Number(r.entityId);
  const open = (record: HistoryRecord) => {
    row.record = record;
    row.openId = Number.isInteger(id) ? id : null;
  };
  if (r.action === 'print.report') {
    row.name = r.entityId;
    f.how = text(after.how) ?? undefined;
    f.from = text(after.from) ?? undefined;
    f.to = text(after.to) ?? undefined;
    f.report = r.entityId;
    return row;
  }
  if (r.action === 'print.firm') {
    open('firm');
    row.name = nameOf('firms', id);
    f.how = text(after.how) ?? undefined;
    f.from = text(after.from) ?? undefined;
    f.to = text(after.to) ?? undefined;
    f.role = text(after.role) ?? undefined;
    return row;
  }

  if (r.entity === 'lrs') {
    open('lr');
    row.lrNo = r.lrNo;
    row.lrYear = r.lrYear;
    if (r.action === 'lrs.create') {
      f.consignor = text(after.consignor_name) ?? undefined;
      f.consignee = text(after.consignee_name) ?? undefined;
      f.station = nameOf('stations', after.to_station_id) ?? undefined;
      f.qty = num(after.qty) ?? undefined;
    } else if (r.action.startsWith('print.')) {
      f.how = text(after.how) ?? undefined;
    } else if (r.action.startsWith('lrs.memo-')) {
      f.challanNo = challanNo(before.memoId) ?? undefined;
      if (r.action === 'lrs.memo-move') f.otherChallanNo = challanNo(after.memoId) ?? undefined;
      if (r.action === 'lrs.memo-add') f.challanNo = challanNo(after.memoId) ?? undefined;
    } else {
      const e = lrEntry(db, { at: r.at, seat: r.seat, action: r.action, before: r.before, after: r.after });
      if (e) {
        row.changes = e.changes.map((c) => change(c.field, c.from, c.to));
        if (e.reason !== undefined) f.reason = e.reason;
      }
    }
    return row;
  }

  if (r.entity === 'memos') {
    open('memo');
    row.challanNo = r.challanNo;
    row.challanYear = r.challanYear;
    if (r.action === 'memos.create') {
      f.truck = nameOf('trucks', after.truckId) ?? undefined;
      f.driver = nameOf('drivers', after.driverId) ?? undefined;
      f.fromStation = nameOf('stations', after.fromStationId) ?? undefined;
      f.toStation = nameOf('stations', after.toStationId) ?? undefined;
      f.lrCount = Array.isArray(after.lrIds) ? after.lrIds.length : undefined;
      // A memo saved from 4.6 says the rate, the % and the round figure it was saved with (an older row has none of them).
      row.changes = (memoEntry(db, { at: r.at, seat: r.seat, action: r.action, before: r.before, after: r.after })?.changes ?? []).map((c) => change(c.field, c.from, c.to));
    } else if (r.action === 'print.memo') {
      f.how = text(after.how) ?? undefined;
    } else {
      const e = memoEntry(db, { at: r.at, seat: r.seat, action: r.action, before: r.before, after: r.after });
      if (e) {
        row.changes = e.changes.map((c) => change(c.field, c.from, c.to));
        if (e.reason !== undefined) f.reason = e.reason;
        if (e.lrNos.length > 0) f.lrNos = e.lrNos;
        if (e.otherNo !== undefined) f.otherChallanNo = e.otherNo;
      }
    }
    return row;
  }

  if (r.entity === 'wasuli') {
    // A removed collection is no longer in the table: its LR is in the row that removed it, or in the row that made it.
    const lr = r.wLrNo !== null && r.wLrYear !== null ? { no: r.wLrNo, year: r.wLrYear } : (lrOf(before.lr_id ?? after.lr_id) ?? lrOfWasuli(id));
    row.lrNo = lr?.no ?? null;
    row.lrYear = lr?.year ?? null;
    if (lr) open('wasuli');
    const agentAfter = nameOf('agents', after.agent_id) ?? undefined;
    const agentBefore = nameOf('agents', before.agent_id) ?? undefined;
    switch (r.action) {
      case 'wasuli.create':
        f.amountPaise = num(after.amount_paise) ?? undefined;
        break;
      case 'wasuli.update':
        row.changes = [change('amount', num(before.amount_paise), num(after.amount_paise))];
        break;
      case 'wasuli.remove':
        f.amountPaise = num(before.amount_paise) ?? undefined;
        f.agent = agentBefore;
        break;
      case 'wasuli.assign':
        f.agent = agentAfter;
        break;
      case 'wasuli.reassign':
        f.fromAgent = agentBefore;
        f.agent = agentAfter;
        break;
      case 'wasuli.to-pool':
        f.fromAgent = agentBefore;
        break;
      case 'wasuli.collect':
        f.agent = agentAfter;
        f.amountPaise = num(after.collected_paise) ?? undefined;
        f.owedPaise = r.wAmount ?? undefined;
        f.mode = text(after.mode) ?? undefined;
        if (text(after.remark)) f.remark = text(after.remark) ?? undefined;
        break;
      case 'wasuli.uncollect':
        f.agent = agentBefore;
        f.amountPaise = num(before.collected_paise) ?? undefined;
        break;
      case 'wasuli.remark':
        row.changes = [change('remark', text(before.remark), text(after.remark))];
        break;
    }
    return row;
  }

  const master = MASTER_RECORD[r.entity];
  if (master && r.action.startsWith('masters.')) {
    open(master);
    row.name = text(after.name) ?? text(after.number) ?? text(before.name) ?? text(before.number);
    if (r.action === 'masters.update') {
      // A master row has only its own fields: what the kind does not have is undefined on both sides and shows no line.
      const pairs: [string, string | number | null | undefined, string | number | null | undefined][] = [
        ['name', text(before.name) ?? undefined, text(after.name) ?? undefined],
        ['number', text(before.number) ?? undefined, text(after.number) ?? undefined],
        ['phone', text(before.phone) ?? undefined, text(after.phone) ?? undefined],
        ['station', nameOf('stations', before.stationId) ?? (before.stationId === null ? null : undefined), nameOf('stations', after.stationId) ?? (after.stationId === null ? null : undefined)],
      ];
      for (const [field, from, to] of pairs) if (from !== to) row.changes.push(change(field, from ?? null, to ?? null));
    }
    return row;
  }

  switch (r.action) {
    case 'pins.locked':
      f.pin = text(after.kind) ?? undefined;
      break;
    case 'settings.lr-defaults': {
      // A row written now carries the booking station only; the option and the tax % are in rows saved before 4.5.
      const station = (v: unknown) => (v === null || v === undefined ? null : (nameOf('stations', v) ?? `#${String(v)}`));
      const plain = (v: unknown) => (v === null || v === undefined ? null : String(v));
      const pairs = [
        ['bookingStation', station(before.bookingStationId), station(after.bookingStationId)],
        ['chargeOption', plain(before.chargeOption), plain(after.chargeOption)],
        ['staxPercent', plain(before.staxPercent), plain(after.staxPercent)],
      ] as const;
      for (const [field, from, to] of pairs) if (from !== to) row.changes.push(change(field, from, to));
      break;
    }
    case 'settings.company':
      for (const key of ['name', 'address', 'phone', 'gstin']) if (before[key] !== after[key]) row.changes.push(change(key, text(before[key]), text(after[key])));
      break;
    case 'settings.backup-dir':
      row.changes = [change('backupDir', text(before.dir), text(after.dir))];
      break;
    case 'seat.rename':
      row.changes = [change('seatName', text(before.name), text(after.name))];
      break;
    case 'app.update':
      row.changes = [change('version', text(before.version), text(after.version))];
      break;
    case 'backup.restore':
      f.file = text(after.file) ?? undefined;
      f.savedAs = text(after.savedAs) ?? undefined;
      break;
  }
  return row;
}

export function makeHistory(now: () => Date = () => new Date()) {
  return {
    /** One page of the audit log, newest first, 100 rows, with the cursor of the next page (null at the end). */
    list(db: Db, f: HistoryFilters, cursor: HistoryCursor | null): KeeperResult<HistoryPage> {
      const year = Number(localDate(now()).slice(0, 4));
      const lr = f.lrNo === null ? null : (db.prepare('SELECT id FROM lrs WHERE lr_year = ? AND lr_no = ?').get(f.lrYear ?? year, f.lrNo) as { id: number } | undefined) ?? 'none';
      const memo =
        f.challanNo === null ? null : (db.prepare('SELECT id FROM memos WHERE challan_year = ? AND challan_no = ?').get(f.challanYear ?? year, f.challanNo) as { id: number } | undefined) ?? 'none';
      if (lr === 'none' || memo === 'none') return { ok: true, value: { rows: [], next: null } }; // a number nobody was ever given
      const { sql, args } = pageSql(f, { lrId: lr?.id ?? null, memoId: memo?.id ?? null }, cursor);
      const raw = db.prepare(sql).all(...args) as Raw[];

      const names = new Map<string, string | null>();
      const nameOf = (table: NamedTable, id: unknown): string | null => {
        if (typeof id !== 'number') return null;
        const key = `${table}:${id}`;
        if (!names.has(key)) names.set(key, (db.prepare(`SELECT ${NAME_COLUMN[table]} AS n FROM ${table} WHERE id = ?`).get(id) as { n: string } | undefined)?.n ?? null);
        return names.get(key) ?? null;
      };
      const challanNo = (id: unknown): number | null =>
        typeof id === 'number' ? ((db.prepare('SELECT challan_no AS n FROM memos WHERE id = ?').get(id) as { n: number } | undefined)?.n ?? null) : null;
      const lrOf = (id: unknown): { no: number; year: number } | null =>
        typeof id === 'number' ? ((db.prepare('SELECT lr_no AS no, lr_year AS year FROM lrs WHERE id = ?').get(id) as { no: number; year: number } | undefined) ?? null) : null;

      const lrOfWasuli = (wasuliId: number) => {
        const made = db.prepare("SELECT after_json AS after FROM audit_log WHERE entity = 'wasuli' AND entity_id = ? AND action = 'wasuli.create'").get(String(wasuliId)) as { after: string | null } | undefined;
        return made ? lrOf(parseJson(made.after).lr_id) : null;
      };
      const look: Look = { nameOf, challanNo, lrOf, lrOfWasuli };
      const page = raw.slice(0, PAGE);
      const last = page[page.length - 1];
      return {
        ok: true,
        value: { rows: page.map((r) => describe(db, r, look)), next: raw.length > PAGE && last ? { at: last.at, id: last.id } : null },
      };
    },
  };
}
