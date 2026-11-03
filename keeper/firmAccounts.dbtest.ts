// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
// Firm Accounts (3.5): the firm list, the statement and its totals, the top lists, the KPIs and the 12 months.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FirmAccountFilters, FirmAccountPage, FirmRole, KeeperResult, StatementPage, StatementQuery, StatementRow } from '../shared';
import { accountsSql, countsSql, firmSql, makeFirmAccounts } from './firmAccounts';
import { ADMIN, book, create, now, saved, setUp, SYSTEM } from './memoTesting';
import { lrAmounts, type LrMoney } from './money';
import { makeWasuli } from './wasuli';
import { fastest } from './testing';
import type { Db } from './db';

const ROLES: FirmRole[] = ['both', 'consignor', 'consignee'];
const OCT = { from: '2026-10-01', to: '2026-10-31' };

const party = (firmId: number) => ({ firmId, name: '', addToFirms: false });
const walkIn = (name: string) => ({ firmId: null, name, addToFirms: false });
const ok = <T>(r: KeeperResult<T>): T => {
  assert.ok(r.ok, r.ok ? '' : `${r.code} ${r.detail ?? ''}`);
  return r.value;
};
const refused = <T>(r: KeeperResult<T>) => {
  assert.equal(r.ok, false);
  return r as Extract<KeeperResult<T>, { ok: false }>;
};

/**
 * One world, worked out by hand (paise in the comments are what the keeper must add up to). A = Shree Ganesh, B = Patil, C = Kale.
 *   LR1  A→B  10-05  qty 3  to pay 1,800.00  bhada 10.50  tax 5%      → tax 90.00      total 1,900.50
 *   LR2  A→C  10-10  qty 2  paid   2,000.50  hamali 12.25 tax 2.5%    → tax 50.01      total 2,062.76 (Amravati)
 *   LR3  B→A  10-12  qty 5  to pay   333.33  wasuli 500  tax 5%       → tax 16.67      total   350.00
 *   LR4  A→A  10-15  qty 1  to pay   100.00  tax 3%                  → tax  3.00      total   103.00 (the firm on both sides)
 *   LR5  A→B  10-20  cancelled
 *   LR6  A→B  09-30  qty 4  to pay   900.00                                           total   900.00
 *   LR7  A→B  10-31  qty 1  paid      50.00                                           total    50.00
 *   LR8  A→B  08-15  to pay 600.00        X1 A→B 2025-12-20 200.00   X2 2025-12-31 10.00   X3 2026-01-01 20.00   X4 2026-01-10 300.00
 * LR1 and LR2 ride on challan 1 (truck MH 29 BE 1234); LR3 on challan 2 (truck MH 29 AB 1).
 */
function world() {
  const s = setUp();
  const [A, B] = [s.ganesh, s.patil];
  const C = s.made(s.masters.create(s.db, 'seat-1', 'firms', { name: 'Kale Brothers', stationId: s.nagpur })).id;
  const lr = (over: Parameters<typeof book>[1]) => book(s, over);
  const l1 = lr({ date: '2026-10-05', qty: '3', toPay: '1,800', godownBhada: '10.50', staxPercent: '5', consignor: party(A), consignee: party(B) });
  const l2 = lr({ date: '2026-10-10', qty: '2', toPay: '', paid: '2,000.50', hamali: '12.25', staxPercent: '2.5', consignor: party(A), consignee: party(C), toStationId: s.amravati });
  const l3 = lr({ date: '2026-10-12', qty: '5', toPay: '333.33', wasuli: '500', staxPercent: '5', consignor: party(B), consignee: party(A) });
  const l4 = lr({ date: '2026-10-15', qty: '1', toPay: '100', staxPercent: '3', consignor: party(A), consignee: party(A) });
  const l5 = lr({ date: '2026-10-20', qty: '1', toPay: '77', consignor: party(A), consignee: party(B) });
  const l6 = lr({ date: '2026-09-30', qty: '4', toPay: '900', consignor: party(A), consignee: party(B) });
  const l7 = lr({ date: '2026-10-31', qty: '1', toPay: '', paid: '50', consignor: party(A), consignee: party(B) });
  const l8 = lr({ date: '2026-08-15', qty: '1', toPay: '600', consignor: party(A), consignee: party(B) });
  const x = ['2025-12-20', '2025-12-31', '2026-01-01', '2026-01-10'].map((date, i) => lr({ date, qty: '1', toPay: String([200, 10, 20, 300][i]), consignor: party(A), consignee: party(B) }));
  ok(s.lrs.cancel(s.db, 'seat-1', l5.id, 1, 'wrong entry', SYSTEM));
  const m1 = saved(create(s, [l1.id, l2.id]));
  const m2 = saved(create(s, [l3.id], { truckId: s.truck2 }));
  const firms = makeFirmAccounts(now);
  const statement = (firmId: number, role: FirmRole, range = OCT, cursor: StatementPage['next'] = null) => ok(firms.statement(s.db, { firmId, role, ...range }, cursor));
  return { ...s, A, B, C, l1, l2, l3, l4, l5, l6, l7, l8, x, m1, m2, firms, statement };
}
type World = ReturnType<typeof world>;

const lrNos = (rows: StatementRow[]): number[] => rows.map((r) => r.lrNo);
/** An LR's money as the keeper defines it everywhere else. */
const amountsOf = (db: Db, id: number) => lrAmounts(db.prepare('SELECT * FROM lrs WHERE id = ?').get(id) as LrMoney);

test('the statement of A as consignor: its LRs, no cancelled one, dates inclusive, with the figures worked out by hand', () => {
  const w = world();
  const p = w.statement(w.A, 'consignor');
  assert.deepEqual(p.rows.map((r) => r.lrId), [w.l1.id, w.l2.id, w.l4.id, w.l7.id], 'by date; LR5 (cancelled) and LR6 (September) are not in it');
  assert.equal(p.next, null);
  assert.deepEqual(p.totals, {
    lrs: 4, qty: 7, toPayPaise: 190000, paidPaise: 205050, chargesPaise: 2275, staxPaise: 14301, totalPaise: 411626, wasuliOwedPaise: 0, wasuliCollectedPaise: 0,
  });
  const [r1, r2, r4] = p.rows;
  assert.deepEqual(r1, {
    lrId: w.l1.id, lrNo: w.l1.no, lrYear: 2026, date: '2026-10-05', role: 'consignor', party: 'Patil Hardware', fromStation: 'Yavatmal', toStation: 'Nagpur', particular: 'Cloth bales', qty: 3,
    toPayPaise: 180000, paidPaise: 0, chargesPaise: 1050, staxPaise: 9000, totalPaise: 190050, status: 'loaded', memoId: w.m1.id, challanNo: w.m1.challanNo,
    wasuliStatus: null, wasuliPaise: 0, wasuliCollectedPaise: 0,
  });
  assert.equal(r2.toStation, 'Amravati');
  assert.equal(r2.totalPaise, 206276, 'tax 2.5% of 2,000.50 is 50.0125 -> 50.01');
  assert.equal(r4.role, 'both', 'the firm is on both sides of LR4');
  assert.equal(r4.party, 'Shree Ganesh Traders');
  assert.equal(p.rows[3].status, 'booked');
  assert.equal(p.rows[3].memoId, null);
  assert.equal(p.rows[3].challanNo, null);
});

test('as consignee, and both: an LR with the firm on both sides is counted once', () => {
  const w = world();
  const consignee = w.statement(w.A, 'consignee');
  assert.deepEqual(consignee.rows.map((r) => r.lrId), [w.l3.id, w.l4.id]);
  assert.equal(consignee.rows[0].party, 'Patil Hardware', 'the other party is the consignor');
  assert.equal(consignee.rows[0].role, 'consignee');
  assert.deepEqual(consignee.totals, { lrs: 2, qty: 6, toPayPaise: 43333, paidPaise: 0, chargesPaise: 0, staxPaise: 1967, totalPaise: 45300, wasuliOwedPaise: 50000, wasuliCollectedPaise: 0 });
  const both = w.statement(w.A, 'both');
  assert.deepEqual(both.rows.map((r) => r.lrId), [w.l1.id, w.l2.id, w.l3.id, w.l4.id, w.l7.id]);
  assert.deepEqual(both.totals, { lrs: 5, qty: 12, toPayPaise: 223333, paidPaise: 205050, chargesPaise: 2275, staxPaise: 15968, totalPaise: 446626, wasuliOwedPaise: 50000, wasuliCollectedPaise: 0 });
  // B and C see their own side of the same LRs
  assert.deepEqual(w.statement(w.B, 'consignor').rows.map((r) => r.lrId), [w.l3.id]);
  assert.deepEqual(w.statement(w.C, 'both').rows.map((r) => r.lrId), [w.l2.id]);
  assert.equal(w.statement(w.C, 'consignor').totals.lrs, 0);
});

test('a walk-in party is on the LR but has no firm: the firm sees the LR, the walk-in never appears', () => {
  const w = world();
  const lr = book(w, { date: '2026-10-08', consignor: walkIn('Road Side Traders'), consignee: party(w.A) });
  const rows = w.statement(w.A, 'consignee').rows;
  assert.ok(rows.some((r) => r.lrId === lr.id && r.party === 'Road Side Traders'));
  const names = ok(w.firms.accounts(w.db, { text: 'road side', stationId: null, showInactive: true, period: null }, null)).rows;
  assert.deepEqual(names, []);
});

test('period edges: from and to are both included, and a period can span 1 January', () => {
  const w = world();
  assert.deepEqual(lrNos(w.statement(w.A, 'consignor', { from: '2026-10-05', to: '2026-10-05' }).rows), [w.l1.no]);
  assert.deepEqual(w.statement(w.A, 'consignor', { from: '2026-10-06', to: '2026-10-30' }).rows.map((r) => r.lrId), [w.l2.id, w.l4.id]);
  assert.equal(w.statement(w.A, 'consignor', { from: '2026-10-31', to: '2026-10-31' }).rows[0].lrId, w.l7.id);
  assert.equal(w.statement(w.A, 'consignor', { from: '2026-11-01', to: '2026-11-30' }).totals.lrs, 0);
  const across = w.statement(w.A, 'consignor', { from: '2025-12-30', to: '2026-01-02' });
  assert.deepEqual(across.rows.map((r) => r.date), ['2025-12-31', '2026-01-01'], 'by date, not by number: the 2026 series restarts');
  assert.equal(across.rows[0].lrYear, 2025);
  assert.equal(across.rows[1].lrYear, 2026);
  // the cursor is (date, number): after the 2025 LR comes the 2026 one even though its number may be lower
  const after = w.statement(w.A, 'consignor', { from: '2025-12-30', to: '2026-01-02' }, { date: '2025-12-31', no: across.rows[0].lrNo });
  assert.deepEqual(after.rows.map((r) => r.date), ['2026-01-01']);
});

test('the wasuli of an LR: its state, what is owed, what came in', () => {
  const w = world();
  const before = w.statement(w.B, 'consignor').rows[0];
  assert.equal(before.wasuliStatus, 'unassigned');
  assert.equal(before.wasuliPaise, 50000);
  assert.equal(before.wasuliCollectedPaise, 0);
  const wasuli = makeWasuli(w.pins, now);
  const agent = w.made(w.masters.create(w.db, 'seat-1', 'agents', { name: 'Ramesh' })).id;
  const row = ok(wasuli.find(w.db, w.l3.no));
  const seen = (r: typeof row) => ({ id: r.id, status: r.status, agentId: r.agentId, version: r.version });
  const assigned = ok(wasuli.assign(w.db, 'seat-1', [seen(row)], agent)).rows[0];
  assert.equal(w.statement(w.B, 'consignor').rows[0].wasuliStatus, 'assigned');
  ok(wasuli.collect(w.db, 'seat-1', seen(assigned), { amount: '300', mode: 'cash', remark: 'part' }));
  const after = w.statement(w.B, 'consignor');
  assert.equal(after.rows[0].wasuliStatus, 'collected');
  assert.equal(after.rows[0].wasuliCollectedPaise, 30000, 'a part payment: 300 of 500');
  assert.equal(after.totals.wasuliOwedPaise, 50000);
  assert.equal(after.totals.wasuliCollectedPaise, 30000);
  assert.equal(w.statement(w.A, 'both').totals.wasuliCollectedPaise, 30000, 'the same LR seen from A');
});

test('the totals are the sum of lrAmounts of the rows: 40 odd LRs, six tax rates', () => {
  const w = world();
  const F = w.made(w.masters.create(w.db, 'seat-1', 'firms', { name: 'Odd Amounts Ltd' })).id;
  const rates = ['0', '2.5', '5', '12', '18', '3.33'];
  for (let i = 0; i < 40; i++) {
    const amount = `${100 + i * 37}.${String((i * 13) % 100).padStart(2, '0')}`;
    book(w, {
      date: '2026-10-0' + (1 + (i % 9)),
      qty: String(1 + (i % 6)),
      toPay: i % 2 === 0 ? amount : '',
      paid: i % 2 === 1 ? amount : '',
      godownBhada: `${i % 7}.${String((i * 7) % 100).padStart(2, '0')}`,
      hamali: `${i % 5}.${String((i * 11) % 100).padStart(2, '0')}`,
      staxPercent: rates[i % rates.length],
      consignor: party(F),
      consignee: party(w.B),
    });
  }
  const p = w.statement(F, 'consignor');
  assert.equal(p.rows.length, 40);
  const sums = { qty: 0, toPay: 0, paid: 0, charges: 0, stax: 0, total: 0 };
  for (const r of p.rows) {
    const a = amountsOf(w.db, r.lrId);
    assert.equal(r.chargesPaise, a.charges, `LR ${r.lrNo} charges`);
    assert.equal(r.staxPaise, a.stax, `LR ${r.lrNo} tax`);
    assert.equal(r.totalPaise, a.total, `LR ${r.lrNo} total`);
    assert.equal(r.toPayPaise + r.paidPaise, a.freight);
    sums.qty += r.qty;
    sums.toPay += r.toPayPaise;
    sums.paid += r.paidPaise;
    sums.charges += a.charges;
    sums.stax += a.stax;
    sums.total += a.total;
  }
  assert.deepEqual(
    [p.totals.lrs, p.totals.qty, p.totals.toPayPaise, p.totals.paidPaise, p.totals.chargesPaise, p.totals.staxPaise, p.totals.totalPaise],
    [40, sums.qty, sums.toPay, sums.paid, sums.charges, sums.stax, sums.total],
  );
  assert.equal(p.totals.totalPaise, p.totals.toPayPaise + p.totals.paidPaise + p.totals.chargesPaise + p.totals.staxPaise);
});

test('the top lists: other parties, To stations and trucks (through memos), 5 at most, most LRs first then name', () => {
  const w = world();
  const top = ok(w.firms.statementTop(w.db, { firmId: w.A, role: 'both', ...OCT }));
  assert.deepEqual(top.parties, [{ name: 'Patil Hardware', lrs: 3 }, { name: 'Kale Brothers', lrs: 1 }, { name: 'Shree Ganesh Traders', lrs: 1 }]);
  assert.deepEqual(top.stations, [{ name: 'Nagpur', lrs: 4 }, { name: 'Amravati', lrs: 1 }]);
  assert.deepEqual(top.trucks, [{ name: 'MH 29 BE 1234', lrs: 2 }, { name: 'MH 29 AB 1', lrs: 1 }], 'LR4 and LR7 are on no memo');
  const consignor = ok(w.firms.statementTop(w.db, { firmId: w.A, role: 'consignor', ...OCT }));
  assert.deepEqual(consignor.parties, [{ name: 'Patil Hardware', lrs: 2 }, { name: 'Kale Brothers', lrs: 1 }, { name: 'Shree Ganesh Traders', lrs: 1 }]);
  assert.deepEqual(ok(w.firms.statementTop(w.db, { firmId: w.A, role: 'both', from: '2026-02-01', to: '2026-02-28' })), { parties: [], stations: [], trucks: [] });
  // more than five stations: only five
  for (let i = 0; i < 7; i++) {
    const st = w.made(w.masters.create(w.db, 'seat-1', 'stations', { name: `Town ${String.fromCharCode(65 + i)}${i}` })).id;
    book(w, { date: '2026-10-02', toStationId: st, consignor: party(w.C), consignee: party(w.B) });
  }
  assert.equal(ok(w.firms.statementTop(w.db, { firmId: w.C, role: 'consignor', ...OCT })).stations.length, 5);
});

test('KPIs: the period and the one just before it, growth, and a null where the base was 0', () => {
  const w = world();
  const k = ok(w.firms.kpis(w.db, { firmId: w.A, role: 'both', ...OCT }));
  assert.deepEqual(k.range, OCT);
  assert.deepEqual(k.previous, { from: '2026-08-31', to: '2026-09-30' });
  assert.deepEqual(k.now, { lrs: 5, trips: 2, qty: 12, freightPaise: 428383, totalPaise: 446626, wasuliCollectedPaise: 0 });
  assert.deepEqual(k.before, { lrs: 1, trips: 0, qty: 4, freightPaise: 90000, totalPaise: 90000, wasuliCollectedPaise: 0 });
  assert.deepEqual(k.growth, { lrs: 400, trips: null, qty: 200, freightPaise: 376, totalPaise: 396, wasuliCollectedPaise: null });
  // trips counts a memo once, however many of the firm's LRs ride on it
  assert.equal(ok(w.firms.kpis(w.db, { firmId: w.A, role: 'consignor', ...OCT })).now.trips, 1);
  assert.equal(ok(w.firms.kpis(w.db, { firmId: w.A, role: 'consignee', ...OCT })).now.trips, 1);
  // cancelling challan 2 sends LR3 back to booked: it rides on nothing now
  ok(w.memos.cancel(w.db, 'seat-1', w.m2.id, ok(w.memos.get(w.db, w.m2.id)).version, 'wrong truck', ADMIN));
  assert.equal(ok(w.firms.kpis(w.db, { firmId: w.A, role: 'both', ...OCT })).now.trips, 1);
  // wasuli collected counts the LR's collected amount
  const wasuli = makeWasuli(w.pins, now);
  const agent = w.made(w.masters.create(w.db, 'seat-1', 'agents', { name: 'Suresh' })).id;
  const row = ok(wasuli.find(w.db, w.l3.no));
  const assigned = ok(wasuli.assign(w.db, 'seat-1', [{ id: row.id, status: row.status, agentId: null, version: row.version }], agent)).rows[0];
  ok(wasuli.collect(w.db, 'seat-1', { id: assigned.id, status: 'assigned', agentId: agent, version: assigned.version }, { amount: '500', mode: 'upi', remark: '' }));
  assert.equal(ok(w.firms.kpis(w.db, { firmId: w.A, role: 'both', ...OCT })).now.wasuliCollectedPaise, 50000);
  // a one-day period compares with the day before
  const day = ok(w.firms.kpis(w.db, { firmId: w.A, role: 'both', from: '2026-10-31', to: '2026-10-31' }));
  assert.deepEqual(day.previous, { from: '2026-10-30', to: '2026-10-30' });
  assert.equal(day.now.lrs, 1);
});

test('the 12 months of a year: LRs, freight, growth against the month before (January against December)', () => {
  const w = world();
  const m = ok(w.firms.months(w.db, w.A, 2026, 'both'));
  assert.equal(m.length, 12);
  assert.deepEqual(m[0], { month: '2026-01', lrs: 2, freightPaise: 32000, growth: 52 }, 'January 320.00 against December 210.00');
  assert.deepEqual(m[1], { month: '2026-02', lrs: 0, freightPaise: 0, growth: -100 });
  assert.equal(m[2].growth, null, 'the month before had nothing');
  assert.deepEqual(m[7], { month: '2026-08', lrs: 1, freightPaise: 60000, growth: null });
  assert.deepEqual(m[8], { month: '2026-09', lrs: 1, freightPaise: 90000, growth: 50 });
  assert.deepEqual(m[9], { month: '2026-10', lrs: 5, freightPaise: 428383, growth: null }, 'October is the month in progress');
  assert.equal(m[10].growth, null);
  // a whole past year is compared, December included
  const last = ok(w.firms.months(w.db, w.A, 2025, 'consignor'));
  assert.equal(last[11].lrs, 2);
  assert.equal(last[11].freightPaise, 21000);
  assert.equal(last[11].growth, null, 'November had nothing');
  // the role narrows it: B is the consignor of LR3 only
  assert.equal(ok(w.firms.months(w.db, w.B, 2026, 'consignor'))[9].lrs, 1);
  assert.equal(ok(w.firms.months(w.db, w.B, 2026, 'consignee'))[9].lrs, 2, 'LR1 and LR7: LR5 is cancelled, LR6 is September');
});

test('an unknown firm is refused by name, every read', () => {
  const w = world();
  const q: StatementQuery = { firmId: 9999, role: 'both', ...OCT };
  assert.equal(refused(w.firms.statement(w.db, q, null)).code, 'master-missing');
  assert.equal(refused(w.firms.statementTop(w.db, q)).code, 'master-missing');
  assert.equal(refused(w.firms.kpis(w.db, q)).code, 'master-missing');
  assert.equal(refused(w.firms.months(w.db, 9999, 2026, 'both')).code, 'master-missing');
});

test('reads write nothing: no audit row, no change to any table', () => {
  const w = world();
  const count = () => (w.db.prepare('SELECT (SELECT COUNT(*) FROM audit_log) + (SELECT COUNT(*) FROM lrs) + (SELECT COUNT(*) FROM memos) + (SELECT COUNT(*) FROM wasuli) AS n').get() as { n: number }).n;
  const before = count();
  const version = (w.db.prepare('SELECT SUM(version) AS v FROM lrs').get() as { v: number }).v;
  for (const role of ROLES) {
    w.statement(w.A, role);
    w.firms.statementTop(w.db, { firmId: w.A, role, ...OCT });
    w.firms.kpis(w.db, { firmId: w.A, role, ...OCT });
    w.firms.months(w.db, w.A, 2026, role);
  }
  w.firms.accounts(w.db, { text: '', stationId: null, showInactive: true, period: null }, null);
  assert.equal(count(), before);
  assert.equal((w.db.prepare('SELECT SUM(version) AS v FROM lrs').get() as { v: number }).v, version);
});

// ---- the firm list ----

const filters = (over: Partial<FirmAccountFilters> = {}): FirmAccountFilters => ({ text: '', stationId: null, showInactive: false, period: null, ...over });
const listOf = (w: World, over: Partial<FirmAccountFilters> = {}, cursor: Parameters<World['firms']['accounts']>[2] = null) => ok(w.firms.accounts(w.db, filters(over), cursor));
const withExtras = (w: World) => {
  const D = w.made(w.masters.create(w.db, 'seat-1', 'firms', { name: 'Deshmukh Agro' })).id;
  const Z = w.made(w.masters.create(w.db, 'seat-1', 'firms', { name: 'Ankit Stores' })).id;
  const row = ok(w.masters.setActive(w.db, 'seat-1', 'firms', Z, 1, false, SYSTEM));
  return { D, Z, row };
};

test('the firm list: every firm by name with its LRs as consignor and as consignee, cancelled LRs left out', () => {
  const w = world();
  const { D } = withExtras(w);
  const page = listOf(w);
  assert.deepEqual(page.rows.map((r) => r.name), ['Deshmukh Agro', 'Kale Brothers', 'Patil Hardware', 'Shree Ganesh Traders'], 'by name; the inactive firm is not listed');
  assert.equal(page.count, 4);
  assert.equal(page.next, null);
  const by = (name: string) => page.rows.find((r) => r.name === name);
  assert.deepEqual(by('Shree Ganesh Traders'), {
    id: w.A, name: 'Shree Ganesh Traders', station: null, phone: '', active: true, asConsignor: 10, asConsignee: 2, lastLrDate: '2026-10-31',
  });
  assert.equal(by('Patil Hardware')?.asConsignor, 1);
  assert.equal(by('Patil Hardware')?.asConsignee, 8, 'LR5 is cancelled');
  assert.deepEqual([by('Kale Brothers')?.asConsignor, by('Kale Brothers')?.asConsignee, by('Kale Brothers')?.lastLrDate, by('Kale Brothers')?.station], [0, 1, '2026-10-10', 'Nagpur']);
  assert.deepEqual([by('Deshmukh Agro')?.id, by('Deshmukh Agro')?.asConsignor, by('Deshmukh Agro')?.asConsignee, by('Deshmukh Agro')?.lastLrDate], [D, 0, 0, null]);
});

test('the firm list filters: text, station, inactive, and "has LRs in the period"', () => {
  const w = world();
  const { Z } = withExtras(w);
  assert.deepEqual(listOf(w, { showInactive: true }).rows.map((r) => r.name)[0], 'Ankit Stores');
  assert.equal(listOf(w, { showInactive: true }).rows.find((r) => r.id === Z)?.active, false);
  assert.deepEqual(listOf(w, { text: 'HARDWARE' }).rows.map((r) => r.name), ['Patil Hardware'], 'any part of the name, any case');
  assert.deepEqual(listOf(w, { text: '  ganesh   traders ' }).rows.map((r) => r.name), ['Shree Ganesh Traders'], 'spaces collapse like the name key');
  assert.deepEqual(listOf(w, { text: '%' }).rows, [], '% is a plain character');
  assert.deepEqual(listOf(w, { stationId: w.nagpur }).rows.map((r) => r.name), ['Kale Brothers']);
  assert.deepEqual(listOf(w, { period: OCT }).rows.map((r) => r.name), ['Kale Brothers', 'Patil Hardware', 'Shree Ganesh Traders']);
  assert.deepEqual(listOf(w, { period: { from: '2025-12-31', to: '2025-12-31' } }).rows.map((r) => r.name), ['Patil Hardware', 'Shree Ganesh Traders'], 'X2 only');
  assert.deepEqual(listOf(w, { period: { from: '2026-02-01', to: '2026-02-28' } }).rows, []);
  assert.deepEqual(listOf(w, { period: { from: '2026-10-20', to: '2026-10-20' } }).rows, [], 'LR5 on the 20th is cancelled');
  assert.equal(listOf(w, { period: OCT, text: 'kale' }).count, 1);
});

/** Plain rows, fast: the keeper only reads them. */
function bulkFirms(db: Db, n: number, prefix = 'Firm'): number[] {
  const put = db.prepare("INSERT INTO firms (name, name_key, seat) VALUES (?, ?, 'test')");
  return db.transaction(() => Array.from({ length: n }, (_, i) => {
    const name = `${prefix} ${String(i).padStart(5, '0')}`;
    return Number(put.run(name, name.toLowerCase()).lastInsertRowid);
  }))();
}

test('the firm list pages by name: 100, then the rest; exactly 100 has no next page, 101 has', () => {
  for (const [n, pages] of [[100, [100]], [101, [100, 1]], [250, [100, 100, 50]]] as const) {
    const s = setUp();
    const firms = makeFirmAccounts(now);
    bulkFirms(s.db, n - 2); // setUp already made two firms
    const seen: string[] = [];
    let cursor: Parameters<typeof firms.accounts>[2] = null;
    const sizes: number[] = [];
    for (;;) {
      const page: FirmAccountPage = ok(firms.accounts(s.db, filters(), cursor));
      assert.equal(page.count, n, 'the whole filter, on every page');
      sizes.push(page.rows.length);
      seen.push(...page.rows.map((r) => r.name));
      if (!page.next) break;
      cursor = page.next;
    }
    assert.deepEqual(sizes, [...pages], `${n} firms`);
    assert.equal(new Set(seen).size, n, 'no firm twice, none missed');
    assert.deepEqual(seen, [...seen].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)), 'in name order');
  }
});

// ---- plans and speed ----

const plan = (db: Db, sql: string, args: Record<string, unknown>) =>
  (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(Object.keys(args).length > 0 ? [args] : [])) as { detail: string }[]).map((r) => r.detail);
const noScan = (lines: string[], what: string) => {
  const scans = lines.filter((l) => /^SCAN (TABLE lrs\b|l\b|x\b|lrs\b)/.test(l)).length;
  // The statement picks its page of 101 LRs first (a CO-ROUTINE, read through an index) and reads that back once: a scan of 101 rows, not of the table.
  const pages = lines.filter((l) => /^CO-ROUTINE l\b/.test(l)).length;
  assert.ok(scans <= pages, `${what}: ${lines.join(' | ')}`);
};

test('EXPLAIN: no statement scans lrs (every role, with and without a cursor)', () => {
  const w = world();
  const base = { f: w.A, from: OCT.from, to: OCT.to };
  for (const role of ROLES) {
    const q = firmSql(role);
    noScan(plan(w.db, q.rows(false), base), `${role} rows`);
    noScan(plan(w.db, q.rows(true), { ...base, cd: '2026-10-05', cn: 1 }), `${role} rows after a cursor`);
    for (const name of ['totals', 'kpis', 'months', 'parties', 'stations', 'trucks'] as const) noScan(plan(w.db, q[name], base), `${role} ${name}`);
  }
  for (const f of [filters(), filters({ text: 'kale', stationId: 3, showInactive: true, period: OCT })]) {
    for (const after of [false, true]) {
      const q = accountsSql(f, after);
      noScan(plan(w.db, q.rows, after ? { ...q.args, after: 'k' } : q.args), 'firm page');
      noScan(plan(w.db, q.count, q.args), 'firm count');
    }
  }
  for (const col of ['consignor_id', 'consignee_id'] as const) {
    const lines = (w.db.prepare(`EXPLAIN QUERY PLAN ${countsSql(col, 3)}`).all(1, 2, 3) as { detail: string }[]).map((r) => r.detail);
    noScan(lines, `counts by ${col}`);
  }
});

/** LRs for speed tests: stations once, the rest in one transaction. */
function bulkLrs(db: Db, firmIds: number[], count: number, from: number, to: number): void {
  const put = db.prepare(
    `INSERT INTO lrs (uid, lr_year, lr_no, lr_date, consignor_id, consignor_name, consignee_id, consignee_name, from_station_id, to_station_id, particular, qty, topay_paise, paid_paise, godown_bhada_paise, stax_bp, seat)
     VALUES (?, 2026, ?, ?, ?, 'c', ?, 'd', ?, ?, 'Cloth', 2, ?, 0, 500, 500, 'test')`,
  );
  db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const day = String(1 + (i % 28)).padStart(2, '0');
      put.run(`bulk-${i}`, 100 + i, `2026-10-${day}`, firmIds[i % firmIds.length], firmIds[(i * 7 + 1) % firmIds.length], from, to, 10000 + (i % 977));
    }
  })();
}

test('speed: 3,000 firms and 20,000 LRs — the firm list and a big firm\'s statement each under 100 ms', () => {
  const s = setUp();
  const firms = makeFirmAccounts(now);
  const ids = bulkFirms(s.db, 3000);
  bulkLrs(s.db, ids, 20000, s.yavatmal, s.nagpur);
  const big = ids[0];
  const list = fastest(5, () => {
    const page = ok(firms.accounts(s.db, filters(), null));
    assert.equal(page.rows.length, 100);
    assert.equal(page.count, 3002);
  });
  assert.ok(list < 100, `firm list ${list.toFixed(1)} ms`);
  const withPeriod = fastest(5, () => assert.ok(ok(firms.accounts(s.db, filters({ period: OCT }), null)).rows.length > 0));
  assert.ok(withPeriod < 100, `firm list with a period ${withPeriod.toFixed(1)} ms`);
  // one firm with every one of the 20,000 LRs (the card: "a statement over 20 000 LRs for one firm")
  s.db.prepare('UPDATE lrs SET consignor_id = ?').run(big);
  const q: StatementQuery = { firmId: big, role: 'both', ...OCT };
  const statement = fastest(5, () => {
    const page = ok(firms.statement(s.db, q, null));
    assert.equal(page.rows.length, 100);
    assert.equal(page.totals.lrs, 20000);
  });
  assert.ok(statement < 100, `statement ${statement.toFixed(1)} ms`);
  const rest = fastest(3, () => {
    ok(firms.statementTop(s.db, q));
    ok(firms.kpis(s.db, q));
    ok(firms.months(s.db, big, 2026, 'both'));
  });
  assert.ok(rest < 300, `top + kpis + months ${rest.toFixed(1)} ms`);
});

test('both sides page across page edges: every LR once (one with the firm on both sides too), by (date, number)', () => {
  const s = setUp();
  const firms = makeFirmAccounts(now);
  const third = s.made(s.masters.create(s.db, 'seat-1', 'firms', { name: 'Third Firm' })).id;
  bulkLrs(s.db, [s.ganesh, s.patil, third], 310, s.yavatmal, s.nagpur);
  s.db.prepare('UPDATE lrs SET consignee_id = consignor_id WHERE consignor_id = ? AND lr_no % 4 = 0').run(s.ganesh); // the firm on both sides
  const expected = (s.db.prepare('SELECT lr_no AS no FROM lrs WHERE consignor_id = @f OR consignee_id = @f ORDER BY lr_date, lr_no').all({ f: s.ganesh }) as { no: number }[]).map((r) => r.no);
  assert.ok(expected.length > 200 && expected.length < 310, `${expected.length} LRs involve the firm`);
  const got: number[] = [];
  const roles = new Set<string>();
  let cursor: StatementPage['next'] = null;
  let pages = 0;
  for (;;) {
    const page: StatementPage = ok(firms.statement(s.db, { firmId: s.ganesh, role: 'both', ...OCT }, cursor));
    pages++;
    assert.equal(page.totals.lrs, expected.length);
    page.rows.forEach((r) => roles.add(r.role));
    got.push(...page.rows.map((r) => r.lrNo));
    if (!page.next) break;
    cursor = page.next;
  }
  assert.ok(pages >= 3, `${pages} pages`);
  assert.deepEqual(got, expected, 'each LR once, in order, none lost at a page edge');
  assert.deepEqual([...roles].sort(), ['both', 'consignee', 'consignor']);
});

test('the firm list with every filter pages by name: the same firms as a direct count, none twice, none lost at a page edge', () => {
  const s = setUp();
  const firms = makeFirmAccounts(now);
  const ids = bulkFirms(s.db, 400);
  s.db.prepare('UPDATE firms SET station_id = ? WHERE id % 2 = 0').run(s.nagpur);
  bulkLrs(s.db, ids, 900, s.yavatmal, s.nagpur);
  const f = filters({ text: 'FIRM 00', stationId: s.nagpur, period: { from: '2026-10-05', to: '2026-10-20' } });
  const expected = (
    s.db
      .prepare(
        `SELECT f.name FROM firms f WHERE f.active = 1 AND f.station_id = @st AND instr(f.name_key, 'firm 00') > 0 AND (
           f.id IN (SELECT consignor_id FROM lrs WHERE lr_date BETWEEN @a AND @b) OR f.id IN (SELECT consignee_id FROM lrs WHERE lr_date BETWEEN @a AND @b)) ORDER BY f.name_key`,
      )
      .all({ st: s.nagpur, a: '2026-10-05', b: '2026-10-20' }) as { name: string }[]
  ).map((r) => r.name);
  assert.ok(expected.length > 100 && expected.length <= 200, `${expected.length} firms match`);
  const got: string[] = [];
  let cursor: Parameters<typeof firms.accounts>[2] = null;
  let pages = 0;
  for (;;) {
    const page: FirmAccountPage = ok(firms.accounts(s.db, f, cursor));
    pages++;
    assert.equal(page.count, expected.length);
    got.push(...page.rows.map((r) => r.name));
    if (!page.next) break;
    cursor = page.next;
  }
  assert.equal(pages, 2);
  assert.deepEqual(got, expected);
});

test('the statement pages by (date, number): 100, 100, the rest; exactly 100 has no next page, 101 has', () => {
  for (const [n, sizes] of [[100, [100]], [101, [100, 1]], [250, [100, 100, 50]]] as const) {
    const s = setUp();
    const firms = makeFirmAccounts(now);
    bulkLrs(s.db, [s.ganesh, s.patil], n, s.yavatmal, s.nagpur);
    // every LR is A→B or B→A; take A as consignor of all: make it so
    s.db.prepare('UPDATE lrs SET consignor_id = ?, consignee_id = ?').run(s.ganesh, s.patil);
    const q: StatementQuery = { firmId: s.ganesh, role: 'consignor', ...OCT };
    let cursor: StatementPage['next'] = null;
    const got: number[] = [];
    const rowsPerPage: number[] = [];
    for (;;) {
      const page: StatementPage = ok(firms.statement(s.db, q, cursor));
      assert.equal(page.totals.lrs, n, 'the totals cover the whole period on every page');
      rowsPerPage.push(page.rows.length);
      got.push(...page.rows.map((r) => r.lrNo));
      if (!page.next) break;
      cursor = page.next;
    }
    assert.deepEqual(rowsPerPage, [...sizes], `${n} LRs`);
    assert.equal(new Set(got).size, n);
    const order = s.db.prepare("SELECT lr_no AS no FROM lrs ORDER BY lr_date, lr_no").all() as { no: number }[];
    assert.deepEqual(got, order.map((r) => r.no), 'by date then number, never by id');
  }
});
