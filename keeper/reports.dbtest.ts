// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
// Reports (4.1): the seven reports and the list of LRs behind a row — rows and totals worked out by hand, the same totals in every
// LR-based report, period edges, filters, paging, plans and speed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  MAX_REPORT_PRINT_ROWS, REPORT_FILTERS, type KeeperResult, type ReportCursor, type ReportKind, type ReportLrCursor, type ReportLrRow, type ReportLrsPage, type ReportLrsRequest, type ReportPage, type ReportQuery, type WasuliRow, type WasuliSeen,
} from '../shared';
import { openDatabase, type Db } from './db';
import { makeFirmAccounts } from './firmAccounts';
import { ADMIN, book, create, now, saved, setUp, SYSTEM } from './memoTesting';
import { lrAmounts, type LrMoney } from './money';
import { makePrint } from './print';
import { agentSql, dateSql, firmFiguresSql, firmTotalsSql, lrsSql, makeReports, partySql, stationSql, truckSql } from './reports';
import { fastest, tempDir } from './testing';
import { makeWasuli } from './wasuli';

const OCT = { from: '2026-10-01', to: '2026-10-31' };
const SEPT = { from: '2026-09-01', to: '2026-09-30' };
const ACROSS = { from: '2025-12-30', to: '2026-01-02' };
const YEAR = { from: '2026-01-01', to: '2026-12-31' };
const NOTHING = { from: '2026-02-01', to: '2026-02-28' };
const Q = (range: { from: string; to: string }, over: Partial<ReportQuery> = {}): ReportQuery => ({ ...range, toStationId: null, text: '', truckId: null, agentId: null, ...over });

const ok = <T>(r: KeeperResult<T>): T => {
  assert.ok(r.ok, r.ok ? '' : `${r.code} ${r.detail ?? ''}`);
  return r.value;
};

const party = (firmId: number) => ({ firmId, name: '', addToFirms: false });
const walkIn = (name: string) => ({ firmId: null, name, addToFirms: false });

/**
 * One world, worked out by hand. A = Shree Ganesh Traders, B = Patil Hardware, C = Kale Brothers (station Nagpur). All LRs go to Nagpur unless said.
 *   L1  A→B        10-05 qty 3 to pay 1,800.00  bhada 10.50  tax 5%     → tax 90.00   total 1,900.50
 *   L2  A→C        10-10 qty 2 paid   2,000.50  hamali 12.25 tax 2.5%   → tax 50.01   total 2,062.76 (Amravati)
 *   L3  B→A        10-12 qty 5 to pay   333.33  wasuli 500   tax 5%     → tax 16.67   total   350.00
 *   L4  A→A        10-15 qty 1 to pay   100.00  tax 3%                  → tax  3.00   total   103.00 (the firm on both sides; on a memo that was cancelled)
 *   L5  A→B        10-20 cancelled
 *   L6  A→B        09-30 qty 4 to pay   900.00  wasuli 700
 *   L7  A→B        10-31 qty 1 paid      50.00
 *   L8  walk-in "Road Side Traders" → B   10-12 qty 2 to pay 200.00 wasuli 100
 *   L9  walk-in "road side traders" → walk-in "Cash Customer"   10-12 qty 1 paid 60.00 (Amravati)
 *   L10 A → walk-in "Cash Customer"   10-20 qty 4 to pay 400.00 wasuli 50 (Amravati)
 *   X1  A→B 2025-12-31 to pay 10.00      X2  A→B 2026-01-01 to pay 20.00
 * Memos: challan 1 = L1+L2 (31 Oct, truck MH 29 BE 1234, hire 5,000, hamali 250.50); challan 2 = L3+L8 (12 Oct, truck MH 29 AB 1, hire 3,000, hamali 100; its frozen
 * to pay is then made 1.00 too high, so it differs); challan 3 = L6 (30 Sep); challan 4 = L4 (20 Oct, cancelled).
 * Wasuli: L3 assigned to Ramesh; L8 assigned to Suresh and 80.00 of 100.00 collected (31 Oct); L6 assigned to Ramesh and collected in full on 30 Sep; L10 unassigned.
 */
function build() {
  const s = setUp();
  const [A, B] = [s.ganesh, s.patil];
  const C = s.made(s.masters.create(s.db, 'seat-1', 'firms', { name: 'Kale Brothers', stationId: s.nagpur })).id;
  const l1 = book(s, { date: '2026-10-05', qty: '3', toPay: '1,800', godownBhada: '10.50', staxPercent: '5', consignor: party(A), consignee: party(B) });
  const l2 = book(s, { date: '2026-10-10', qty: '2', toPay: '', paid: '2,000.50', hamali: '12.25', staxPercent: '2.5', consignor: party(A), consignee: party(C), toStationId: s.amravati });
  const l3 = book(s, { date: '2026-10-12', qty: '5', toPay: '333.33', wasuli: '500', staxPercent: '5', consignor: party(B), consignee: party(A) });
  const l4 = book(s, { date: '2026-10-15', qty: '1', toPay: '100', staxPercent: '3', consignor: party(A), consignee: party(A) });
  const l5 = book(s, { date: '2026-10-20', qty: '1', toPay: '77', consignor: party(A), consignee: party(B) });
  const l6 = book(s, { date: '2026-09-30', qty: '4', toPay: '900', wasuli: '700', consignor: party(A), consignee: party(B) });
  const l7 = book(s, { date: '2026-10-31', qty: '1', toPay: '', paid: '50', consignor: party(A), consignee: party(B) });
  const l8 = book(s, { date: '2026-10-12', qty: '2', toPay: '200', wasuli: '100', consignor: walkIn('Road Side Traders'), consignee: party(B) });
  const l9 = book(s, { date: '2026-10-12', qty: '1', toPay: '', paid: '60', consignor: walkIn('road side traders'), consignee: walkIn('Cash Customer'), toStationId: s.amravati });
  const l10 = book(s, { date: '2026-10-20', qty: '4', toPay: '400', wasuli: '50', consignor: party(A), consignee: walkIn('Cash Customer'), toStationId: s.amravati });
  const x1 = book(s, { date: '2025-12-31', qty: '1', toPay: '10', consignor: party(A), consignee: party(B) });
  const x2 = book(s, { date: '2026-01-01', qty: '1', toPay: '20', consignor: party(A), consignee: party(B) });
  ok(s.lrs.cancel(s.db, 'seat-1', l5.id, 1, 'wrong entry', SYSTEM));

  const m1 = saved(create(s, [l1.id, l2.id], { truckHire: '5,000', loadingHamali: '250.50' }));
  const m2 = saved(create(s, [l3.id, l8.id], { date: '2026-10-12', systemPin: SYSTEM, truckId: s.truck2, truckHire: '3,000', loadingHamali: '100' }));
  const m3 = saved(create(s, [l6.id], { date: '2026-09-30', systemPin: SYSTEM }));
  const m4 = saved(create(s, [l4.id], { date: '2026-10-20', systemPin: SYSTEM }));
  ok(s.memos.cancel(s.db, 'seat-1', m4.id, ok(s.memos.get(s.db, m4.id)).version, 'wrong truck', ADMIN));
  s.db.prepare('UPDATE memos SET frozen_topay_paise = frozen_topay_paise + 100 WHERE id = ?').run(m2.id); // its LRs no longer add up to what was frozen

  const wasuli = makeWasuli(s.pins, now);
  const agent = (name: string) => s.made(s.masters.create(s.db, 'seat-1', 'agents', { name })).id;
  const [R, S] = [agent('Ramesh Pawar'), agent('Suresh Kale')];
  const seen = (r: WasuliRow): WasuliSeen => ({ id: r.id, status: r.status, agentId: r.agentId, version: r.version });
  const row = (no: number) => ok(wasuli.find(s.db, no));
  const move = (no: number, agentId: number) => ok(wasuli.assign(s.db, 'seat-1', [seen(row(no))], agentId)).rows[0];
  move(l3.no, R);
  ok(wasuli.collect(s.db, 'seat-1', seen(move(l8.no, S)), { amount: '80', mode: 'cash', remark: '' }));
  ok(wasuli.collect(s.db, 'seat-1', seen(move(l6.no, R)), { amount: '700', mode: 'upi', remark: '' }));
  s.db.prepare("UPDATE wasuli SET collected_date = '2026-09-30' WHERE lr_id = ?").run(l6.id);

  const reports = makeReports();
  return { ...s, A, B, C, R, S, l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, x1, x2, m1, m2, m3, m4, reports };
}
/**
 * The world above, built once per file and copied for each test: building it takes seconds (every backdated LR and memo checks a PIN with
 * scrypt), and a test may change what it gets (a recalculation, a deactivated firm). The copy is the same file, so every id is the same.
 */
let template: ReturnType<typeof build> | null = null;
function world() {
  template ??= build();
  const { db: source, ...rest } = template;
  source.pragma('wal_checkpoint(TRUNCATE)');
  const file = path.join(tempDir(), 'booking.db');
  fs.copyFileSync(source.name, file);
  return { ...rest, db: openDatabase(file) };
}
type World = ReturnType<typeof world>;

/** Every page of a report: the rows, the totals, and the size of each page. */
function readAll<R, T>(read: (cursor: ReportCursor | null) => KeeperResult<ReportPage<R, T>>) {
  const rows: R[] = [];
  const sizes: number[] = [];
  let totals: T | undefined;
  let cursor: ReportCursor | null = null;
  for (;;) {
    const page: ReportPage<R, T> = ok(read(cursor));
    rows.push(...page.rows);
    sizes.push(page.rows.length);
    totals = page.totals;
    if (!page.next) break;
    cursor = page.next;
  }
  return { rows, sizes, totals: totals as T };
}

/** What the LRs matching a WHERE add up to by the JS definition (`lrAmounts`): the check on the SQL. */
function byHand(db: Db, where: string, ...args: unknown[]) {
  const rows = db.prepare(`SELECT * FROM lrs WHERE ${where}`).all(...args) as (LrMoney & { qty: number; wasuli_paise: number })[];
  return rows.reduce(
    (t, r) => {
      const a = lrAmounts(r);
      return {
        lrs: t.lrs + 1, qty: t.qty + r.qty, toPayPaise: t.toPayPaise + r.topay_paise, paidPaise: t.paidPaise + r.paid_paise,
        chargesPaise: t.chargesPaise + a.charges, staxPaise: t.staxPaise + a.stax, totalPaise: t.totalPaise + a.total, wasuliPaise: t.wasuliPaise + r.wasuli_paise,
      };
    },
    { lrs: 0, qty: 0, toPayPaise: 0, paidPaise: 0, chargesPaise: 0, staxPaise: 0, totalPaise: 0, wasuliPaise: 0 },
  );
}
const LIVE_IN = "lr_date BETWEEN ? AND ? AND status != 'cancelled'";

const date = (w: World, q: ReportQuery) => readAll((c) => w.reports.dateWise(w.db, q, c));
const station = (w: World, q: ReportQuery) => readAll((c) => w.reports.stationWise(w.db, q, c));
const parties = (w: World, side: 'consignor' | 'consignee', q: ReportQuery) => readAll((c) => w.reports.partyWise(w.db, side, q, c));
const trucks = (w: World, q: ReportQuery) => readAll((c) => w.reports.truckWise(w.db, q, c));
const firmsOf = (w: World, q: ReportQuery) => readAll((c) => w.reports.firmWise(w.db, q, c));
const agents = (w: World, q: ReportQuery) => readAll((c) => w.reports.wasuli(w.db, q, c));

// ---- each report, by hand ----

test('Date-wise: one row per LR date, cancelled LRs and other months left out, with the figures worked out by hand', () => {
  const w = world();
  const { rows, totals } = date(w, Q(OCT));
  assert.deepEqual(
    rows.map((r) => [r.date, r.lrs, r.qty, r.toPayPaise, r.paidPaise, r.chargesPaise, r.staxPaise, r.totalPaise]),
    [
      ['2026-10-05', 1, 3, 180000, 0, 1050, 9000, 190050],
      ['2026-10-10', 1, 2, 0, 200050, 1225, 5001, 206276],
      ['2026-10-12', 3, 8, 53333, 6000, 0, 1667, 61000],
      ['2026-10-15', 1, 1, 10000, 0, 0, 300, 10300],
      ['2026-10-20', 1, 4, 40000, 0, 0, 0, 40000],
      ['2026-10-31', 1, 1, 0, 5000, 0, 0, 5000],
    ],
    'L5 (cancelled) is not on 10-20; L6 is September',
  );
  assert.deepEqual(totals, { lrs: 8, qty: 19, toPayPaise: 283333, paidPaise: 211050, chargesPaise: 2275, staxPaise: 15968, totalPaise: 512626 });
  const { wasuliPaise, ...money } = byHand(w.db, LIVE_IN, OCT.from, OCT.to);
  void wasuliPaise;
  assert.deepEqual(totals, money, 'the SQL adds up what lrAmounts adds up');
});

test('Station-wise: one row per To station, by name, with the wasuli booked on its LRs', () => {
  const w = world();
  const { rows, totals } = station(w, Q(OCT));
  assert.deepEqual(
    rows.map((r) => [r.station, r.lrs, r.qty, r.toPayPaise, r.paidPaise, r.wasuliPaise]),
    [['Amravati', 3, 7, 40000, 206050, 5000], ['Nagpur', 5, 12, 243333, 5000, 60000]],
  );
  assert.deepEqual(totals, { lrs: 8, qty: 19, toPayPaise: 283333, paidPaise: 211050, wasuliPaise: 65000 });
  assert.equal(rows[0].stationId, w.amravati);
});

test('Consignor-wise: a firm by its id, walk-ins by name as booked (case ignored), by name', () => {
  const w = world();
  const { rows, totals } = parties(w, 'consignor', Q(OCT));
  assert.deepEqual(
    rows.map((r) => [r.name, r.firmId, r.station, r.lrs, r.qty, r.toPayPaise, r.paidPaise, r.wasuliPaise]),
    [
      ['Patil Hardware', w.B, null, 1, 5, 33333, 0, 50000],
      ['Road Side Traders', null, null, 2, 3, 20000, 6000, 10000],
      ['Shree Ganesh Traders', w.A, null, 5, 11, 230000, 205050, 5000],
    ],
    'L8 "Road Side Traders" and L9 "road side traders" are one walk-in, shown with the first spelling; L5 is cancelled',
  );
  assert.deepEqual(totals, { lrs: 8, qty: 19, toPayPaise: 283333, paidPaise: 211050, wasuliPaise: 65000 });
});

test('Consignee-wise: the same on the other side, with the firm\'s station', () => {
  const w = world();
  const { rows, totals } = parties(w, 'consignee', Q(OCT));
  assert.deepEqual(
    rows.map((r) => [r.name, r.firmId, r.station, r.lrs, r.qty, r.toPayPaise, r.paidPaise, r.wasuliPaise]),
    [
      ['Cash Customer', null, null, 2, 5, 40000, 6000, 5000],
      ['Kale Brothers', w.C, 'Nagpur', 1, 2, 0, 200050, 0],
      ['Patil Hardware', w.B, null, 3, 6, 200000, 5000, 10000],
      ['Shree Ganesh Traders', w.A, null, 2, 6, 43333, 0, 50000],
    ],
  );
  assert.deepEqual(totals, { lrs: 8, qty: 19, toPayPaise: 283333, paidPaise: 211050, wasuliPaise: 65000 });
});

test('Truck-wise: saved memos of the period with their FROZEN figures, a Differs mark, cancelled and other months left out', () => {
  const w = world();
  const { rows, totals } = trucks(w, Q(OCT));
  assert.deepEqual(
    rows.map((r) => [r.date, r.challanNo, r.truck, r.toStation, r.lrs, r.toPayPaise, r.paidPaise, r.truckHirePaise, r.loadingHamaliPaise, r.differs]),
    [
      ['2026-10-12', 2, 'MH 29 AB 1', 'Nagpur', 2, 53433, 0, 300000, 10000, true],
      ['2026-10-31', 1, 'MH 29 BE 1234', 'Nagpur', 2, 180000, 200050, 500000, 25050, false],
    ],
    'challan 3 is September, challan 4 is cancelled; challan 2 shows what was frozen (53,433), not what its LRs add up to now (53,333)',
  );
  assert.deepEqual(totals, { memos: 2, lrs: 4, toPayPaise: 233433, paidPaise: 200050, truckHirePaise: 800000, loadingHamaliPaise: 35050 });
  assert.equal(rows[0].memoId, w.m2.id);
  // filters: a truck, a To station
  assert.deepEqual(trucks(w, Q(OCT, { truckId: w.truck2 })).rows.map((r) => r.challanNo), [2]);
  assert.deepEqual(trucks(w, Q(OCT, { toStationId: w.nagpur })).rows.map((r) => r.challanNo), [2, 1]);
  assert.deepEqual(trucks(w, Q(OCT, { toStationId: w.amravati })).rows, []);
  assert.deepEqual(trucks(w, Q(OCT, { truckId: w.truck2, toStationId: w.amravati })).totals, { memos: 0, lrs: 0, toPayPaise: 0, paidPaise: 0, truckHirePaise: 0, loadingHamaliPaise: 0 });
  // a recalculation makes it agree again
  ok(w.memos.recalculate(w.db, 'seat-1', w.m2.id, ok(w.memos.get(w.db, w.m2.id)).version, ADMIN));
  const again = trucks(w, Q(OCT)).rows[0];
  assert.deepEqual([again.toPayPaise, again.differs], [53333, false]);
});

test('Firm-wise: firms with an LR in the period, LRs per side, and each LR once in qty / to pay / paid — the same as the firm\'s own account', () => {
  const w = world();
  const { rows, totals } = firmsOf(w, Q(OCT));
  assert.deepEqual(
    rows.map((r) => [r.name, r.asConsignor, r.asConsignee, r.qty, r.toPayPaise, r.paidPaise]),
    [
      ['Kale Brothers', 0, 1, 2, 0, 200050],
      ['Patil Hardware', 1, 3, 11, 233333, 5000],
      ['Shree Ganesh Traders', 5, 2, 16, 263333, 205050],
    ],
    'A has L4 on both sides: two sides, one LR in qty',
  );
  assert.deepEqual(totals, { firms: 3, asConsignor: 6, asConsignee: 6, walkInConsignor: 2, walkInConsignee: 2 });
  const accounts = makeFirmAccounts(now);
  for (const r of rows) {
    const t = ok(accounts.statement(w.db, { firmId: r.firmId, role: 'both', ...OCT }, null)).totals;
    assert.deepEqual([r.qty, r.toPayPaise, r.paidPaise], [t.qty, t.toPayPaise, t.paidPaise], `${r.name} agrees with its Firm Accounts`);
    const consignor = ok(accounts.statement(w.db, { firmId: r.firmId, role: 'consignor', ...OCT }, null)).totals.lrs;
    const consignee = ok(accounts.statement(w.db, { firmId: r.firmId, role: 'consignee', ...OCT }, null)).totals.lrs;
    assert.deepEqual([r.asConsignor, r.asConsignee], [consignor, consignee]);
  }
  // text finds firms by name; the walk-in counts stay those of the period
  const kale = firmsOf(w, Q(OCT, { text: '  KALE ' }));
  assert.deepEqual(kale.rows.map((r) => r.name), ['Kale Brothers']);
  assert.deepEqual(kale.totals, { firms: 1, asConsignor: 0, asConsignee: 1, walkInConsignor: 2, walkInConsignee: 2 });
  // an inactive firm that had LRs still appears (it did business in the period)
  ok(w.masters.setActive(w.db, 'seat-1', 'firms', w.C, w.masters.all(w.db).firms.find((f) => f.id === w.C)?.version ?? 0, false, SYSTEM));
  const inactive = firmsOf(w, Q(OCT)).rows.find((r) => r.firmId === w.C);
  assert.equal(inactive?.active, false);
});

test('Wasuli: per agent, assigned now and collected in the period (by collected date), the pool in the totals', () => {
  const w = world();
  const oct = agents(w, Q(OCT));
  assert.deepEqual(
    oct.rows.map((r) => [r.agent, r.assignedCount, r.assignedPaise, r.collectedCount, r.collectedPaise]),
    [['Ramesh Pawar', 1, 50000, 0, 0], ['Suresh Kale', 0, 0, 1, 8000]],
    'Ramesh collected L6 on 30 September: not in October; Suresh collected 80 of 100 (the part payment is what counts)',
  );
  assert.deepEqual(oct.totals, { assignedCount: 1, assignedPaise: 50000, collectedCount: 1, collectedPaise: 8000, poolCount: 1, poolPaise: 5000 });
  const sep30 = agents(w, Q({ from: '2026-09-30', to: '2026-09-30' }));
  assert.deepEqual(sep30.rows.map((r) => [r.agent, r.assignedCount, r.collectedCount, r.collectedPaise]), [['Ramesh Pawar', 1, 1, 70000]], 'Suresh has nothing assigned and nothing collected that day: no row');
  assert.deepEqual(agents(w, Q(OCT, { agentId: w.S })).rows.map((r) => r.agent), ['Suresh Kale']);
  assert.deepEqual(agents(w, Q(OCT, { agentId: w.S })).totals, { assignedCount: 0, assignedPaise: 0, collectedCount: 1, collectedPaise: 8000, poolCount: 1, poolPaise: 5000 });
  assert.deepEqual(agents(w, Q(NOTHING)).rows.map((r) => r.agent), ['Ramesh Pawar'], 'what is assigned now does not depend on the period');
  // the pool is whatever is unassigned; an agent with nothing at all is not listed
  assert.equal(agents(w, Q(OCT)).rows.length, 2);
  // the wasuli amounts on the LR-based reports are the collection rows' amounts
  const owed = w.db
    .prepare("SELECT COALESCE(SUM(w.amount_paise), 0) AS n FROM wasuli w JOIN lrs l ON l.id = w.lr_id WHERE l.lr_date BETWEEN ? AND ? AND l.status != 'cancelled'")
    .get(OCT.from, OCT.to) as { n: number };
  assert.equal(station(w, Q(OCT)).totals.wasuliPaise, owed.n);
});

// ---- the same totals everywhere ----

test('for the same period the four LR-based reports add up to the same LRs, qty, to pay and paid; firms + walk-ins = the same LRs', () => {
  const w = world();
  for (const [name, range] of [['October', OCT], ['September', SEPT], ['across 1 January', ACROSS], ['the whole year', YEAR], ['an empty period', NOTHING]] as const) {
    const q = Q(range);
    const hand = byHand(w.db, LIVE_IN, range.from, range.to);
    const same = { lrs: hand.lrs, qty: hand.qty, toPayPaise: hand.toPayPaise, paidPaise: hand.paidPaise };
    const pick = ({ lrs, qty, toPayPaise, paidPaise }: typeof same) => ({ lrs, qty, toPayPaise, paidPaise });
    const reports = {
      date: pick(date(w, q).totals),
      station: pick(station(w, q).totals),
      consignor: pick(parties(w, 'consignor', q).totals),
      consignee: pick(parties(w, 'consignee', q).totals),
    };
    for (const [report, totals] of Object.entries(reports)) assert.deepEqual(totals, same, `${name}: ${report}-wise`);
    // the rows of each report add up to its own totals
    for (const rows of [date(w, q).rows, station(w, q).rows, parties(w, 'consignor', q).rows, parties(w, 'consignee', q).rows]) {
      assert.equal(rows.reduce((n, r) => n + r.lrs, 0), same.lrs, `${name}: rows`);
      assert.equal(rows.reduce((n, r) => n + r.toPayPaise, 0), same.toPayPaise);
    }
    const f = firmsOf(w, q).totals;
    assert.equal(f.asConsignor + f.walkInConsignor, same.lrs, `${name}: firms + walk-in consignors`);
    assert.equal(f.asConsignee + f.walkInConsignee, same.lrs, `${name}: firms + walk-in consignees`);
  }
});

test('with a To station, Date-, Consignor- and Consignee-wise agree with each other and with that station\'s row of Station-wise', () => {
  const w = world();
  for (const toStationId of [w.nagpur, w.amravati]) {
    const q = Q(OCT, { toStationId });
    const hand = byHand(w.db, `${LIVE_IN} AND to_station_id = ?`, OCT.from, OCT.to, toStationId);
    const same = { lrs: hand.lrs, qty: hand.qty, toPayPaise: hand.toPayPaise, paidPaise: hand.paidPaise };
    const pick = ({ lrs, qty, toPayPaise, paidPaise }: typeof same) => ({ lrs, qty, toPayPaise, paidPaise });
    assert.deepEqual(pick(date(w, q).totals), same);
    assert.deepEqual(pick(parties(w, 'consignor', q).totals), same);
    assert.deepEqual(pick(parties(w, 'consignee', q).totals), same);
    const row = station(w, Q(OCT)).rows.find((r) => r.stationId === toStationId);
    assert.deepEqual(row && pick(row), same);
  }
});

test('with typed text, Date- and Station-wise (either party) agree; the party reports look at their own side only', () => {
  const w = world();
  const q = Q(OCT, { text: 'RoAd Side' });
  const d = date(w, q);
  assert.deepEqual(d.rows.map((r) => [r.date, r.lrs]), [['2026-10-12', 2]], 'L8 and L9 (consignor, any case)');
  assert.deepEqual(station(w, q).rows.map((r) => [r.station, r.lrs]), [['Amravati', 1], ['Nagpur', 1]]);
  assert.equal(station(w, q).totals.lrs, d.totals.lrs);
  assert.equal(parties(w, 'consignor', q).totals.lrs, 2);
  assert.equal(parties(w, 'consignee', q).totals.lrs, 0, 'nobody was consigned to a Road Side Traders');
  assert.equal(parties(w, 'consignee', Q(OCT, { text: 'cash' })).totals.lrs, 2);
  assert.equal(date(w, Q(OCT, { text: 'cash' })).totals.lrs, 2, 'either party');
  assert.equal(date(w, Q(OCT, { text: '%' })).totals.lrs, 0, '% is a plain character');
});

test('period edges: both days are included, and a period can span 1 January', () => {
  const w = world();
  assert.deepEqual(date(w, Q({ from: '2026-10-05', to: '2026-10-05' })).rows.map((r) => r.date), ['2026-10-05']);
  assert.deepEqual(date(w, Q({ from: '2026-10-06', to: '2026-10-30' })).rows.map((r) => r.date), ['2026-10-10', '2026-10-12', '2026-10-15', '2026-10-20']);
  assert.equal(date(w, Q({ from: '2026-10-31', to: '2026-10-31' })).totals.lrs, 1);
  assert.equal(date(w, Q({ from: '2026-11-01', to: '2026-11-30' })).totals.lrs, 0);
  assert.deepEqual(date(w, Q(ACROSS)).rows.map((r) => [r.date, r.toPayPaise]), [['2025-12-31', 1000], ['2026-01-01', 2000]]);
  assert.deepEqual(parties(w, 'consignor', Q(ACROSS)).rows.map((r) => [r.name, r.lrs]), [['Shree Ganesh Traders', 2]]);
  // memos: the memo date, both days
  assert.deepEqual(trucks(w, Q({ from: '2026-10-12', to: '2026-10-12' })).rows.map((r) => r.challanNo), [2]);
  assert.deepEqual(trucks(w, Q({ from: '2026-09-30', to: '2026-10-11' })).rows.map((r) => r.challanNo), [3]);
  // collections: the collected date, both days
  assert.deepEqual(agents(w, Q({ from: '2026-10-31', to: '2026-10-31' })).rows.map((r) => [r.agent, r.collectedCount]), [['Ramesh Pawar', 0], ['Suresh Kale', 1]]);
});

test('a filter a report does not use changes nothing in it (REPORT_FILTERS says which it uses)', () => {
  const w = world();
  const stray: Record<'toStationId' | 'text' | 'truckId' | 'agentId', Partial<ReportQuery>> = {
    toStationId: { toStationId: w.amravati }, text: { text: 'kale' }, truckId: { truckId: w.truck2 }, agentId: { agentId: w.S },
  };
  const run: Record<ReportKind, (q: ReportQuery) => unknown> = {
    dateWise: (q) => date(w, q), stationWise: (q) => station(w, q), consignorWise: (q) => parties(w, 'consignor', q), consigneeWise: (q) => parties(w, 'consignee', q),
    truckWise: (q) => trucks(w, q), firmWise: (q) => firmsOf(w, q), wasuli: (q) => agents(w, q),
  };
  for (const kind of Object.keys(run) as ReportKind[]) {
    const plain = run[kind](Q(OCT));
    for (const filter of ['toStationId', 'text', 'truckId', 'agentId'] as const) {
      if (REPORT_FILTERS[kind].includes(filter)) assert.notDeepEqual(run[kind](Q(OCT, stray[filter])), plain, `${kind} uses ${filter}`);
      else assert.deepEqual(run[kind](Q(OCT, stray[filter])), plain, `${kind} ignores ${filter}`);
    }
  }
});

// ---- the LRs behind a row ----

test('reports.lrs: the LRs of a row by (date, number), adding up to the row, under the same period and filters', () => {
  const w = world();
  const lrs = (request: ReportLrsRequest) => {
    const rows: ReportLrRow[] = [];
    let cursor: ReportLrCursor | null = null;
    for (;;) {
      const p: ReportLrsPage = ok(w.reports.lrs(w.db, request, cursor));
      rows.push(...p.rows);
      if (!p.next) return { rows, totals: p.totals };
      cursor = p.next;
    }
  };
  const nagpur = lrs({ of: { kind: 'stationWise', stationId: w.nagpur }, query: Q(OCT) });
  assert.deepEqual(nagpur.rows.map((r) => r.lrId), [w.l1.id, w.l3.id, w.l8.id, w.l4.id, w.l7.id], 'by date, then LR number: L3 and L8 share 10-12');
  assert.deepEqual(nagpur.rows[0], {
    lrId: w.l1.id, lrNo: w.l1.no, lrYear: 2026, date: '2026-10-05', consignor: 'Shree Ganesh Traders', consignee: 'Patil Hardware', toStation: 'Nagpur', qty: 3,
    toPayPaise: 180000, paidPaise: 0, chargesPaise: 1050, staxPaise: 9000, totalPaise: 190050, status: 'loaded',
  });
  assert.equal(nagpur.rows[3].status, 'booked', 'L4 came off its cancelled memo');
  assert.deepEqual(nagpur.totals, { lrs: 5, qty: 12, toPayPaise: 243333, paidPaise: 5000, chargesPaise: 1050, staxPaise: 10967, totalPaise: 260350 });

  // a walk-in consignor: the two spellings are one party
  const walk = lrs({ of: { kind: 'consignorWise', firmId: null, name: 'ROAD SIDE TRADERS' }, query: Q(OCT) });
  assert.deepEqual(walk.rows.map((r) => r.lrId), [w.l8.id, w.l9.id]);
  assert.equal(lrs({ of: { kind: 'consignorWise', firmId: null, name: 'Shree Ganesh Traders' }, query: Q(OCT) }).rows.length, 0, 'a firm is found by its id; a walk-in of that name is another party');

  // every row of every LR-based report lists LRs that add up to the row, whatever the filters
  for (const query of [Q(OCT), Q(OCT, { toStationId: w.nagpur }), Q(OCT, { text: 'ganesh' }), Q(YEAR)]) {
    for (const r of station(w, query).rows) {
      const t = lrs({ of: { kind: 'stationWise', stationId: r.stationId }, query }).totals;
      assert.deepEqual([t.lrs, t.qty, t.toPayPaise, t.paidPaise], [r.lrs, r.qty, r.toPayPaise, r.paidPaise], `station ${r.station}`);
    }
    for (const side of ['consignor', 'consignee'] as const) {
      for (const r of parties(w, side, query).rows) {
        const t = lrs({ of: { kind: side === 'consignor' ? 'consignorWise' : 'consigneeWise', firmId: r.firmId, name: r.firmId === null ? r.name : '' }, query }).totals;
        assert.deepEqual([t.lrs, t.qty, t.toPayPaise, t.paidPaise], [r.lrs, r.qty, r.toPayPaise, r.paidPaise], `${side} ${r.name}`);
      }
    }
  }
});

// ---- paging ----

type Seed = { kind: ReportKind; query: ReportQuery; read: (w: World, c: ReportCursor | null) => KeeperResult<ReportPage<{ key: string }, unknown>>; expected: string[] };

/** Plain rows, fast: the keeper only reads them. */
function bulkLrs(db: Db, n: number, at: (i: number) => Partial<Record<string, string | number | null>>): number[] {
  const base = db.prepare('SELECT id FROM stations ORDER BY id').all() as { id: number }[];
  const from = base[0].id;
  const put = db.prepare(
    `INSERT INTO lrs (uid, lr_year, lr_no, lr_date, consignor_id, consignor_name, consignee_id, consignee_name, from_station_id, to_station_id, particular, qty, topay_paise, paid_paise, godown_bhada_paise, stax_bp, wasuli_paise, seat)
     VALUES (@uid, CAST(substr(@date, 1, 4) AS INTEGER), @no, @date, @cid, @cname, @eid, @ename, @from, @to, 'Cloth', 2, @topay, 0, 500, 500, @wasuli, 'test')`,
  );
  return db.transaction(() =>
    Array.from({ length: n }, (_, i) =>
      Number(put.run({ uid: `bulk-${i}`, no: 1000 + i, date: '2026-10-10', cid: null, cname: 'c', eid: null, ename: 'd', from, to: from, topay: 10000 + (i % 977), wasuli: 0, ...at(i) }).lastInsertRowid),
    ),
  )();
}
const nameOf = (prefix: string, i: number) => `${prefix} ${String(i).padStart(4, '0')}`;

/** n groups for each report, with the order they must come out in. */
function seeds(n: number): Record<ReportKind, (w: World) => Seed> {
  const w0 = (kind: ReportKind, query: ReportQuery, read: Seed['read'], expected: string[]): Seed => ({ kind, query, read, expected });
  return {
    dateWise: (w) => {
      const days = Array.from({ length: n }, (_, i) => new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10));
      bulkLrs(w.db, n, (i) => ({ date: days[i] }));
      return w0('dateWise', Q({ from: '2027-01-01', to: '2027-12-31' }), (x, c) => x.reports.dateWise(x.db, Q({ from: '2027-01-01', to: '2027-12-31' }), c) as never, days);
    },
    stationWise: (w) => {
      const ids = Array.from({ length: n }, (_, i) => w.made(w.masters.create(w.db, 'seat-1', 'stations', { name: nameOf('Stn', i) })).id);
      bulkLrs(w.db, n, (i) => ({ to: ids[i], date: '2027-02-01' }));
      const q = Q({ from: '2027-02-01', to: '2027-02-01' });
      return w0('stationWise', q, (x, c) => x.reports.stationWise(x.db, q, c) as never, ids.map((_, i) => nameOf('Stn', i)));
    },
    consignorWise: (w) => {
      // half firms, half walk-ins, interleaved by name
      const firms = Array.from({ length: Math.ceil(n / 2) }, (_, i) => w.made(w.masters.create(w.db, 'seat-1', 'firms', { name: nameOf('Name', 2 * i) }, true)).id);
      const walk = (i: number) => nameOf('name', 2 * i + 1);
      bulkLrs(w.db, n, (i) => (i % 2 === 0 ? { cid: firms[i / 2], cname: nameOf('Name', i), date: '2027-03-01' } : { cname: walk((i - 1) / 2), date: '2027-03-01' }));
      const q = Q({ from: '2027-03-01', to: '2027-03-01' });
      const keys = Array.from({ length: n }, (_, i) => nameOf('name', i));
      return w0('consignorWise', q, (x, c) => x.reports.partyWise(x.db, 'consignor', q, c) as never, keys);
    },
    consigneeWise: (w) => {
      bulkLrs(w.db, n, (i) => ({ ename: nameOf('Walk', i), date: '2027-04-01' }));
      const q = Q({ from: '2027-04-01', to: '2027-04-01' });
      return w0('consigneeWise', q, (x, c) => x.reports.partyWise(x.db, 'consignee', q, c) as never, Array.from({ length: n }, (_, i) => nameOf('Walk', i)).map((s) => s));
    },
    truckWise: (w) => {
      const q = Q({ from: '2027-05-01', to: '2027-05-31' });
      const put = w.db.prepare(
        `INSERT INTO memos (uid, challan_year, challan_no, memo_date, truck_id, driver_id, from_station_id, to_station_id, seat) VALUES (@uid, 2027, @no, @date, @truck, @driver, @from, @to, 'test')`,
      );
      w.db.transaction(() => {
        for (let i = 0; i < n; i++) put.run({ uid: `seed-memo-${i}`, no: 1 + i, date: `2027-05-${String(1 + (i % 28)).padStart(2, '0')}`, truck: w.truck, driver: w.driver, from: w.yavatmal, to: w.nagpur });
      })();
      const expected = Array.from({ length: n }, (_, i) => i).sort((a, b) => (a % 28) - (b % 28) || a - b).map((i) => `2027-05-${String(1 + (i % 28)).padStart(2, '0')}#${1 + i}`);
      return w0('truckWise', q, (x, c) => x.reports.truckWise(x.db, q, c) as never, expected);
    },
    firmWise: (w) => {
      const ids = Array.from({ length: n }, (_, i) => w.made(w.masters.create(w.db, 'seat-1', 'firms', { name: nameOf('Firm', i) })).id);
      bulkLrs(w.db, n, (i) => ({ cid: ids[i], eid: ids[(i + 1) % n], date: '2027-06-01' }));
      const q = Q({ from: '2027-06-01', to: '2027-06-01' });
      return w0('firmWise', q, (x, c) => x.reports.firmWise(x.db, q, c) as never, ids.map((_, i) => nameOf('Firm', i)));
    },
    wasuli: (w) => {
      w.db.prepare('DELETE FROM wasuli').run(); // the world's own collections are not part of this count
      const lrIds = bulkLrs(w.db, n, () => ({ date: '2027-07-01', wasuli: 1000 }));
      const agentIds = Array.from({ length: n }, (_, i) => w.made(w.masters.create(w.db, 'seat-1', 'agents', { name: nameOf('Agent', i) })).id);
      const put = w.db.prepare("INSERT INTO wasuli (lr_id, amount_paise, status, agent_id, assigned_date, seat) VALUES (?, 1000, 'assigned', ?, '2027-07-01', 'test')");
      w.db.transaction(() => lrIds.forEach((id, i) => put.run(id, agentIds[i])))();
      const q = Q({ from: '2027-07-01', to: '2027-07-01' });
      return w0('wasuli', q, (x, c) => x.reports.wasuli(x.db, q, c) as never, Array.from({ length: n }, (_, i) => nameOf('Agent', i)));
    },
  };
}

test('every report pages by its own key: 100, then the rest; exactly 100 has no next page, 101 has; none twice, none lost, in order', () => {
  for (const n of [100, 101, 250]) {
    const sizes = n === 100 ? [100] : n === 101 ? [100, 1] : [100, 100, 50];
    for (const kind of Object.keys(seeds(1)) as ReportKind[]) {
      const w = world();
      const seed = seeds(n)[kind](w);
      const got: string[] = [];
      const pageSizes: number[] = [];
      let cursor: ReportCursor | null = null;
      for (;;) {
        const page = ok(seed.read(w, cursor)) as { rows: Record<string, unknown>[]; next: ReportCursor | null; totals: Record<string, number> };
        pageSizes.push(page.rows.length);
        // the totals are those of the whole report on every page (the first page of a one-page report takes them from its rows, the others from a pass of their own)
        const counted = kind === 'truckWise' ? page.totals.memos : kind === 'firmWise' ? page.totals.firms : kind === 'wasuli' ? page.totals.assignedCount : page.totals.lrs;
        assert.equal(counted, n, `${kind}, ${n} groups: the totals count every group, on every page`);
        for (const r of page.rows) {
          got.push(
            kind === 'dateWise' ? (r.date as string)
              : kind === 'stationWise' ? (r.station as string)
                : kind === 'truckWise' ? `${r.date as string}#${r.challanNo as number}`
                  : kind === 'wasuli' ? (r.agent as string)
                    : (r.name as string),
          );
        }
        if (!page.next) break;
        cursor = page.next;
      }
      assert.deepEqual(pageSizes, sizes, `${kind}, ${n} groups`);
      // the walk-in "name nnnn" and the firm "Name nnnn" are different parties with the same key: compare case-insensitively, in order
      assert.deepEqual(got.map((s) => (kind === 'consignorWise' ? s.toLowerCase() : s)), seed.expected, `${kind}, ${n} groups: every group once, in key order`);
    }
  }
});

test('two parties with the same name key (a firm and a walk-in) are both listed across a page edge', () => {
  const w = world();
  // 99 other firms, then a firm and a walk-in both called "Same Name": they sit at places 100 and 101 of 101 groups, one on each side of the page edge
  const firms = Array.from({ length: 99 }, (_, i) => w.made(w.masters.create(w.db, 'seat-1', 'firms', { name: nameOf('A', i) })).id);
  const same = w.made(w.masters.create(w.db, 'seat-1', 'firms', { name: 'Same Name' })).id;
  const DAY = '2027-08-01';
  bulkLrs(w.db, 101, (i) => ({ date: DAY, ...(i < 99 ? { cid: firms[i], cname: nameOf('A', i) } : i === 99 ? { cid: same, cname: 'Same Name' } : { cname: 'same name' }) }));
  const rows = parties(w, 'consignor', Q({ from: DAY, to: DAY })).rows;
  assert.equal(rows.length, 101);
  assert.deepEqual(rows.filter((r) => r.name.toLowerCase() === 'same name').map((r) => r.firmId), [null, same], 'the walk-in (id 0) first, then the firm; neither skipped');
});

// ---- plans and speed ----

const plan = (db: Db, sql: string, args: Record<string, unknown>) =>
  (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(Object.keys(args).length > 0 ? [args] : [])) as { detail: string }[]).map((r) => r.detail);
/** Every "SCAN x" of the plan. A page or a union picked first and read back once is a scan of that small result, so a case says how many such read-backs it has; a scan of lrs, memos or wasuli would be one more. */
const scansOf = (lines: string[]): string[] => lines.filter((l) => l.startsWith('SCAN '));

test('EXPLAIN: no report statement scans lrs, memos or wasuli (with and without a cursor, with every filter)', () => {
  const w = world();
  const base = { from: OCT.from, to: OCT.to };
  const full = Q(OCT, { toStationId: w.nagpur, text: 'kale', truckId: w.truck2, agentId: w.R });
  /** [what, sql, args, the read-backs of a first-picked result the plan may have: the page of memos, the union of collections] */
  const cases: [string, string, Record<string, unknown>, number?][] = [];
  for (const q of [Q(OCT), full]) {
    for (const after of [false, true]) {
      const cur = after ? { after: 'k', k: 'k', n: 1 } : {};
      const tag = `${after ? 'cursor ' : ''}${q === full ? 'filters ' : ''}`;
      const d = dateSql(q, after);
      const st = stationSql(q, after);
      const tr = truckSql(q, after);
      const ag = agentSql(q, after);
      cases.push([`${tag}date rows`, d.rows, { ...d.args, ...cur }], [`${tag}date totals`, d.totals, d.args]);
      cases.push([`${tag}station rows`, st.rows, { ...st.args, ...cur }], [`${tag}station totals`, st.totals, st.args]);
      for (const side of ['consignor', 'consignee'] as const) {
        const p = partySql(side, q, after);
        cases.push([`${tag}${side} rows`, p.rows, { ...p.args, ...cur }, 1], [`${tag}${side} totals`, p.totals, p.args]);
      }
      cases.push([`${tag}truck rows`, tr.rows, { ...tr.args, ...cur }, 1], [`${tag}truck totals`, tr.totals, tr.args]);
      cases.push([`${tag}wasuli rows`, ag.rows, { ...ag.args, ...cur }, 1], [`${tag}wasuli totals`, ag.totals, ag.args, 1]);
      for (const of of [
        { kind: 'stationWise', stationId: w.nagpur }, { kind: 'consignorWise', firmId: w.A, name: '' }, { kind: 'consigneeWise', firmId: null, name: 'cash customer' },
      ] as const) {
        const l = lrsSql({ of, query: q }, after);
        cases.push([`${tag}lrs ${of.kind} rows`, l.rows, { ...l.args, ...(after ? { cd: '2026-10-05', cn: 1 } : {}) }], [`${tag}lrs ${of.kind} totals`, l.totals, l.args]);
      }
    }
  }
  cases.push(['wasuli pool', agentSql(Q(OCT), false).pool, {}]);
  cases.push(['firm totals', firmTotalsSql(false), base], ['firm totals with text', firmTotalsSql(true), { ...base, k: 'kale' }]);
  cases.push(['firm figures', firmFiguresSql(3), { ...base, i0: 1, i1: 2, i2: 3 }, 2]);
  for (const [what, sql, args, readBacks = 0] of cases) {
    const lines = plan(w.db, sql, args);
    assert.ok(scansOf(lines).length <= readBacks, `${what}: ${lines.join(' | ')}`);
  }
});

/** LRs for the speed test: 3,000 firms, 40 stations, 20,000 LRs over a month, a memo for every 60. */
function big() {
  const w = world();
  w.db.prepare('DELETE FROM wasuli').run(); // the world's own collections are not part of this count
  const stations = Array.from({ length: 40 }, (_, i) => w.made(w.masters.create(w.db, 'seat-1', 'stations', { name: nameOf('Stn', i) })).id);
  const firms = Array.from({ length: 3000 }, (_, i) => nameOf('Firm', i));
  const put = w.db.prepare("INSERT INTO firms (name, name_key, seat) VALUES (?, ?, 'test')");
  const firmIds = w.db.transaction(() => firms.map((n) => Number(put.run(n, n.toLowerCase()).lastInsertRowid)))();
  bulkLrs(w.db, 20000, (i) => ({
    date: `2027-01-${String(1 + (i % 28)).padStart(2, '0')}`, cid: i % 5 === 0 ? null : firmIds[i % 3000], cname: i % 5 === 0 ? nameOf('Walk', i % 700) : 'c',
    eid: firmIds[(i * 7 + 1) % 3000], ename: 'd', to: stations[i % 40], wasuli: i % 9 === 0 ? 5000 : 0,
  }));
  const memo = w.db.prepare("INSERT INTO memos (uid, challan_year, challan_no, memo_date, truck_id, driver_id, from_station_id, to_station_id, seat) VALUES (?, 2027, ?, ?, ?, ?, ?, ?, 'test')");
  w.db.transaction(() => {
    for (let i = 0; i < 400; i++) memo.run(`bm-${i}`, 1 + i, `2027-01-${String(1 + (i % 28)).padStart(2, '0')}`, w.truck, w.driver, w.yavatmal, stations[i % 40]);
  })();
  const agentIds = Array.from({ length: 60 }, (_, i) => w.made(w.masters.create(w.db, 'seat-1', 'agents', { name: nameOf('Agent', i) })).id);
  const rows = w.db.prepare("SELECT id FROM lrs WHERE wasuli_paise > 0 AND uid LIKE 'bulk-%'").all() as { id: number }[];
  const wput = w.db.prepare("INSERT INTO wasuli (lr_id, amount_paise, status, agent_id, assigned_date, seat) VALUES (?, 5000, 'assigned', ?, '2027-01-01', 'test')");
  w.db.transaction(() => rows.slice(0, 1500).forEach((r, i) => wput.run(r.id, agentIds[i % 60])))();
  return { w, stations };
}

test('speed: 20,000 LRs in a month, 3,000 firms — the first page of every report and of a row\'s LRs each under 100 ms', () => {
  const { w, stations } = big();
  const q = Q({ from: '2027-01-01', to: '2027-01-31' });
  const aFirm = ok(w.reports.partyWise(w.db, 'consignee', q, null)).rows[0].firmId;
  const timed: [string, () => unknown][] = [
    ['date-wise', () => assert.equal(ok(w.reports.dateWise(w.db, q, null)).totals.lrs, 20000)],
    ['station-wise', () => assert.equal(ok(w.reports.stationWise(w.db, q, null)).rows.length, 40)],
    ['consignor-wise', () => assert.equal(ok(w.reports.partyWise(w.db, 'consignor', q, null)).rows.length, 100)],
    ['consignee-wise', () => assert.equal(ok(w.reports.partyWise(w.db, 'consignee', q, null)).rows.length, 100)],
    ['truck-wise', () => assert.equal(ok(w.reports.truckWise(w.db, q, null)).rows.length, 100)],
    ['firm-wise', () => assert.equal(ok(w.reports.firmWise(w.db, q, null)).rows.length, 100)],
    ['wasuli', () => assert.equal(ok(w.reports.wasuli(w.db, q, null)).rows.length, 60)],
    ['a station\'s LRs', () => assert.equal(ok(w.reports.lrs(w.db, { of: { kind: 'stationWise', stationId: stations[3] }, query: q }, null)).rows.length, 100)],
    ['a firm\'s LRs', () => ok(w.reports.lrs(w.db, { of: { kind: 'consigneeWise', firmId: aFirm, name: '' }, query: q }, null))],
    ['a walk-in\'s LRs', () => ok(w.reports.lrs(w.db, { of: { kind: 'consignorWise', firmId: null, name: nameOf('Walk', 3) }, query: q }, null))],
  ];
  for (const [what, run] of timed) {
    const ms = fastest(5, run as () => void);
    assert.ok(ms < 100, `${what}: ${ms.toFixed(1)} ms`);
  }
});

// ---- as printed ----

const printer = (w: World) => makePrint(w.pins, w.memos, makeFirmAccounts(now), w.reports);

test('print.report: the whole report as formatted text — the screen\'s rows and totals, an amount that is nothing as a dash', () => {
  const w = world();
  const print = printer(w);
  const p = (kind: ReportKind, q = Q(OCT)) => ok(print.report(w.db, kind, q));
  const d = p('dateWise');
  assert.deepEqual(d.rows[0], ['05-10-2026', '1', '3', '1,800.00', '–', '10.50', '90.00', '1,900.50']);
  assert.deepEqual(d.rows[1], ['10-10-2026', '1', '2', '–', '2,000.50', '12.25', '50.01', '2,062.76']);
  assert.deepEqual(d.totals, ['8', '19', '2,833.33', '2,110.50', '22.75', '159.68', '5,126.26']);
  assert.deepEqual([d.report, d.from, d.to, d.rows.length, d.anyDiffers], ['dateWise', '01-10-2026', '31-10-2026', 6, false]);
  assert.equal(d.company.name, 'Sundeep Freight Movers');

  assert.deepEqual(p('stationWise').rows, [['Amravati', '3', '7', '400.00', '2,060.50', '50.00'], ['Nagpur', '5', '12', '2,433.33', '50.00', '600.00']]);
  assert.deepEqual(p('stationWise').totals, ['8', '19', '2,833.33', '2,110.50', '650.00']);
  assert.deepEqual(p('consignorWise').rows[1], ['Road Side Traders', '', '2', '3', '200.00', '60.00', '100.00']);
  assert.deepEqual(p('consigneeWise').rows[1], ['Kale Brothers', 'Nagpur', '1', '2', '–', '2,000.50', '–']);

  const t = p('truckWise');
  assert.deepEqual(t.rows[0], ['12-10-2026', '2*', 'MH 29 AB 1', 'Nagpur', '2', '534.33', '–', '3,000.00', '100.00'], 'a differing memo carries a *');
  assert.deepEqual(t.rows[1], ['31-10-2026', '1', 'MH 29 BE 1234', 'Nagpur', '2', '1,800.00', '2,000.50', '5,000.00', '250.50']);
  assert.deepEqual(t.totals, ['2', '4', '2,334.33', '2,000.50', '8,000.00', '350.50']);
  assert.equal(t.anyDiffers, true);

  assert.deepEqual(p('firmWise').rows[2], ['Shree Ganesh Traders', '5', '2', '16', '2,633.33', '2,050.50']);
  assert.deepEqual(p('firmWise').totals, ['3', '6', '6', '2', '2']);
  assert.deepEqual(p('wasuli').rows, [['Ramesh Pawar', '1', '500.00', '0', '–'], ['Suresh Kale', '0', '–', '1', '80.00']]);
  assert.deepEqual(p('wasuli').totals, ['1', '500.00', '1', '80.00', '1', '50.00']);
  // the same rows as the screen's: one per row of the report, whatever the page size
  assert.equal(p('consigneeWise').rows.length, parties(w, 'consignee', Q(OCT)).rows.length);
});

test('print.report: the filters in force are named — and only the ones the report uses', () => {
  const w = world();
  const print = printer(w);
  const all = Q(OCT, { toStationId: w.nagpur, text: 'ganesh', truckId: w.truck2, agentId: w.R });
  const filters = (kind: ReportKind) => ok(print.report(w.db, kind, all)).filters;
  assert.deepEqual(filters('dateWise'), { station: 'Nagpur', text: 'ganesh', truck: null, agent: null });
  assert.deepEqual(filters('stationWise'), { station: null, text: 'ganesh', truck: null, agent: null });
  assert.deepEqual(filters('truckWise'), { station: 'Nagpur', text: '', truck: 'MH 29 AB 1', agent: null });
  assert.deepEqual(filters('wasuli'), { station: null, text: '', truck: null, agent: 'Ramesh Pawar' });
  assert.deepEqual(filters('firmWise'), { station: null, text: 'ganesh', truck: null, agent: null });
  // and the rows are the filtered ones
  assert.deepEqual(ok(print.report(w.db, 'truckWise', all)).rows.map((r) => r[1]), ['2*']);
});

test('print.report: 1,000 rows print and 1,001 are refused; a shorter period prints', () => {
  const w = world();
  const print = printer(w);
  const days = Array.from({ length: MAX_REPORT_PRINT_ROWS + 1 }, (_, i) => new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10));
  bulkLrs(w.db, days.length - 1, (i) => ({ date: days[i] }));
  const q = Q({ from: '2027-01-01', to: days[days.length - 1] });
  assert.equal(ok(print.report(w.db, 'dateWise', q)).rows.length, MAX_REPORT_PRINT_ROWS);
  bulkLrs(w.db, 1, () => ({ date: days[days.length - 1], uid: 'extra-1', no: 9000 }));
  const refusal = print.report(w.db, 'dateWise', q);
  assert.deepEqual(refusal.ok ? null : refusal.code, 'report-too-long');
  assert.equal(ok(print.report(w.db, 'dateWise', Q({ from: '2027-01-01', to: '2027-12-31' }))).rows.length, 365);
});

test('done: a report writes print.report with which report, how, the period and the filters', () => {
  const w = world();
  const print = printer(w);
  const filters = { toStationId: w.nagpur, text: 'kale', truckId: null, agentId: null };
  ok(print.done(w.db, 'PC02', { kind: 'report', id: 0, how: 'pdf', report: 'dateWise', ...OCT, filters }));
  const rows = w.db.prepare("SELECT seat, entity, entity_id AS entityId, after_json AS after FROM audit_log WHERE action = 'print.report'").all() as { seat: string; entity: string; entityId: string; after: string }[];
  assert.deepEqual(rows.map((r) => [r.seat, r.entity, r.entityId, JSON.parse(r.after)]), [['PC02', 'reports', 'dateWise', { how: 'pdf', ...OCT, ...filters }]]);
});

// ---- the shortcut and the drill-down list at page size ----

test('a report that fits one page takes its totals from its rows: they equal the totals statement, with and without filters', () => {
  const w = world();
  for (const q of [Q(OCT), Q(OCT, { toStationId: w.nagpur }), Q(OCT, { text: 'ganesh' }), Q(OCT, { text: 'cash', toStationId: w.amravati }), Q(YEAR), Q(NOTHING)]) {
    const d = dateSql(q, false);
    assert.deepEqual(date(w, q).totals, w.db.prepare(d.totals).get(d.args), 'date-wise');
    const st = stationSql(q, false);
    assert.deepEqual(station(w, q).totals, w.db.prepare(st.totals).get(st.args), 'station-wise');
    for (const side of ['consignor', 'consignee'] as const) {
      const p = partySql(side, q, false);
      assert.deepEqual(parties(w, side, q).totals, w.db.prepare(p.totals).get(p.args), `${side}-wise`);
    }
  }
});

test('reports.lrs pages by (date, number): 100, then the rest; exactly 100 has no next page, 101 has; the totals cover every LR on every page', () => {
  for (const n of [100, 101, 250]) {
    const w = world();
    const stationId = w.made(w.masters.create(w.db, 'seat-1', 'stations', { name: 'Paging Station' })).id;
    bulkLrs(w.db, n, (i) => ({ to: stationId, date: `2027-09-0${1 + (i % 5)}`, no: 5000 + ((i * 7) % n) }));
    const request: ReportLrsRequest = { of: { kind: 'stationWise', stationId }, query: Q({ from: '2027-09-01', to: '2027-09-30' }) };
    const expected = (w.db.prepare('SELECT lr_no AS no FROM lrs WHERE to_station_id = ? ORDER BY lr_date, lr_no').all(stationId) as { no: number }[]).map((r) => r.no);
    const got: number[] = [];
    const sizes: number[] = [];
    let cursor: ReportLrCursor | null = null;
    for (;;) {
      const page: ReportLrsPage = ok(w.reports.lrs(w.db, request, cursor));
      assert.equal(page.totals.lrs, n, 'the totals are those of the whole filter');
      sizes.push(page.rows.length);
      got.push(...page.rows.map((r) => r.lrNo));
      if (!page.next) break;
      cursor = page.next;
    }
    assert.deepEqual(sizes, n === 100 ? [100] : n === 101 ? [100, 1] : [100, 100, 50], `${n} LRs`);
    assert.deepEqual(got, expected, `${n} LRs: by date then number, none twice, none lost`);
  }
});
