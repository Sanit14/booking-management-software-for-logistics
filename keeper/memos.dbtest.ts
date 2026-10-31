// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MemoFilters, MemoInput } from '../shared';
import { makeDashboard } from './dashboard';
import type { Db } from './db';
import { FROZEN_SQL, pendingSql } from './memos';
import { lrAmounts } from './money';
import { SYSTEM, book, create, memoInput, now, refused, saved, setUp, type Set } from './memoTesting';
import { fastest, insertStation } from './testing';

const none: MemoFilters = { from: null, to: null, toStationId: null, consignor: null, consignee: null };
const nos = (s: Set, f: MemoFilters) => {
  const r = s.memos.pending(s.db, f, null);
  assert.ok(r.ok);
  return r.value.rows.map((x) => x.lrNo);
};
const nextNo = (s: Set, date: string | null = null): number => {
  const r = s.memos.defaults(s.db, date);
  assert.ok(r.ok);
  return r.value.nextNo;
};
const n = (s: Set, table: string) => (s.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
/** Everything a memo save may write. */
const footprint = (s: Set) =>
  JSON.stringify({
    memos: n(s, 'memos'),
    audit: n(s, 'audit_log'),
    counters: s.db.prepare('SELECT name, year, last FROM counters ORDER BY name, year').all(),
    lrs: s.db.prepare('SELECT id, status, memo_id, version FROM lrs ORDER BY id').all(),
  });

/** Plain booked LRs, fast, for the tests that need hundreds. */
function bulk(db: Db, count: number, to: number, from: number, opts: { first?: number; date?: (i: number) => string } = {}): number[] {
  const first = opts.first ?? 100000;
  const put = db.prepare(
    `INSERT INTO lrs (uid, lr_year, lr_no, lr_date, consignor_name, consignee_name, from_station_id, to_station_id, particular, qty, seat)
     VALUES (?, 2026, ?, ?, 'A', 'B', ?, ?, 'Cloth', 2, 't')`,
  );
  const ids: number[] = [];
  db.transaction(() => {
    for (let i = 0; i < count; i++) ids.push(Number(put.run(`bulk-${first}-${i}`, first + i, opts.date ? opts.date(i) : '2026-10-30', from, to).lastInsertRowid));
  })();
  return ids;
}

// ---- the pending list ----

/** Five booked LRs on different days, firms, walk-ins and stations; the creation order is not the date order. */
function seedPending(s: Set) {
  const lr = {
    one: book(s, { date: '2026-10-20', toStationId: s.nagpur, consignee: { firmId: null, name: 'Kale Brothers', addToFirms: false }, qty: '1' }),
    two: book(s, { date: '2026-10-29', consignor: { firmId: s.patil, name: '', addToFirms: false }, consignee: { firmId: s.ganesh, name: '', addToFirms: false }, toStationId: s.amravati, qty: '2' }),
    three: book(s, { consignor: { firmId: null, name: 'Ravi Traders', addToFirms: false }, toStationId: s.nagpur, qty: '4' }),
    four: book(s, { consignee: { firmId: null, name: 'KALE & Sons', addToFirms: false }, toStationId: s.nagpur, qty: '8' }),
    five: book(s, { date: '2026-10-20', consignor: { firmId: s.patil, name: '', addToFirms: false }, toStationId: s.amravati, qty: '16' }),
  };
  return lr;
}

test('pending: only booked LRs, ordered by date then number (not by id), with the count and quantity of the whole filter', () => {
  const s = setUp();
  const lr = seedPending(s);
  const cancelled = book(s);
  const tick = book(s);
  s.lrs.cancel(s.db, 'seat-1', cancelled.id, 1, 'wrong party', SYSTEM);
  saved(create(s, [tick.id]));
  const page = s.memos.pending(s.db, none, null);
  assert.ok(page.ok);
  // 10-20: LR 1 then LR 5; 10-29: LR 2; today: LR 3, 4. The cancelled one and the loaded one are not there.
  assert.deepEqual(page.value.rows.map((r) => r.lrNo), [lr.one.no, lr.five.no, lr.two.no, lr.three.no, lr.four.no]);
  assert.deepEqual([page.value.count, page.value.qty, page.value.next], [5, 31, null]);
  const first = page.value.rows[0];
  assert.deepEqual(Object.keys(first).sort(), ['consignee', 'consignor', 'date', 'id', 'lrNo', 'paidPaise', 'qty', 'toPayPaise', 'toStation'].sort());
  assert.equal(first.toStation, 'Nagpur');
  assert.equal(first.toPayPaise, 180000);
});

test('pending: every filter on its own, and together', () => {
  const s = setUp();
  const lr = seedPending(s);
  const [one, two, three, four, five] = [lr.one.no, lr.two.no, lr.three.no, lr.four.no, lr.five.no];
  const f = (over: Partial<MemoFilters>): MemoFilters => ({ ...none, ...over });
  assert.deepEqual(nos(s, f({ from: '2026-10-29' })), [two, three, four]);
  assert.deepEqual(nos(s, f({ to: '2026-10-29' })), [one, five, two]);
  assert.deepEqual(nos(s, f({ from: '2026-10-29', to: '2026-10-29' })), [two]);
  assert.deepEqual(nos(s, f({ toStationId: s.nagpur })), [one, three, four]);
  assert.deepEqual(nos(s, f({ toStationId: s.amravati })), [five, two]);
  assert.deepEqual(nos(s, f({ consignor: { firmId: s.ganesh, text: '' } })), [one, four]);
  assert.deepEqual(nos(s, f({ consignee: { firmId: s.patil, text: '' } })), [five, three]);
  // typed text: any part of the name the LR was booked with, any ASCII case, a firm's name or a walk-in's
  assert.deepEqual(nos(s, f({ consignor: { firmId: null, text: 'ravi' } })), [three]);
  assert.deepEqual(nos(s, f({ consignee: { firmId: null, text: 'KALE' } })), [one, four]);
  assert.deepEqual(nos(s, f({ consignor: { firmId: null, text: 'ganesh' } })), [one, four], 'a firm typed but not picked still finds its LRs');
  assert.deepEqual(nos(s, f({ consignee: { firmId: null, text: '100%' } })), [], '% is plain text');
  assert.deepEqual(nos(s, f({ toStationId: s.nagpur, consignee: { firmId: null, text: 'kale' }, from: '2026-10-25' })), [four]);
  const some = s.memos.pending(s.db, f({ toStationId: s.nagpur }), null);
  assert.ok(some.ok);
  assert.deepEqual([some.value.count, some.value.qty], [3, 13]);
});

test('pending: 100 rows a page, the cursor goes on exactly where the page ended, count and quantity are for the whole filter', () => {
  const s = setUp();
  bulk(s.db, 250, s.nagpur, s.yavatmal, { date: (i) => `2026-10-${String(10 + (i % 3)).padStart(2, '0')}` }); // three days, interleaved numbers
  const seen: number[] = [];
  let cursor = null as { date: string; no: number } | null;
  for (let page = 1; page <= 3; page++) {
    const r = s.memos.pending(s.db, none, cursor);
    assert.ok(r.ok);
    assert.equal(r.value.rows.length, page < 3 ? 100 : 50);
    assert.deepEqual([r.value.count, r.value.qty], [250, 500], 'the same on every page');
    assert.equal(r.value.next === null, page === 3);
    seen.push(...r.value.rows.map((x) => x.lrNo));
    cursor = r.value.next;
  }
  assert.equal(new Set(seen).size, 250, 'no row twice, none missing');
  const rows = s.db.prepare('SELECT lr_no AS no FROM lrs ORDER BY lr_date, lr_no').all() as { no: number }[];
  assert.deepEqual(seen, rows.map((r) => r.no), 'the order is (date, number) all the way');
});

test('pending: the cursor goes on across 1 January (the numbers restart with the year, the date keeps the order)', () => {
  const s = setUp();
  const put = s.db.prepare(
    `INSERT INTO lrs (uid, lr_year, lr_no, lr_date, consignor_name, consignee_name, from_station_id, to_station_id, particular, qty, seat)
     VALUES (?, ?, ?, ?, 'A', 'B', ?, ?, 'Cloth', 1, 't')`,
  );
  s.db.transaction(() => {
    for (let i = 0; i < 100; i++) put.run(`old-${i}`, 2025, 901 + i, '2025-12-31', s.yavatmal, s.nagpur); // LR 901 to 1000 of 2025
    for (let i = 1; i <= 5; i++) put.run(`new-${i}`, 2026, i, '2026-01-01', s.yavatmal, s.nagpur); // LR 1 to 5 of 2026
  })();
  const first = s.memos.pending(s.db, none, null);
  assert.ok(first.ok);
  assert.deepEqual([first.value.rows.length, first.value.next], [100, { date: '2025-12-31', no: 1000 }]);
  const second = s.memos.pending(s.db, none, first.value.next);
  assert.ok(second.ok);
  assert.deepEqual(second.value.rows.map((r) => r.lrNo), [1, 2, 3, 4, 5], 'LR 1 of the new year follows LR 1000 of the old one');
  assert.equal(second.value.next, null);
});

test('pending: exactly 100 rows have no next page; 101 have one, and the first page still holds 100', () => {
  const s = setUp();
  bulk(s.db, 100, s.nagpur, s.yavatmal);
  const exact = s.memos.pending(s.db, none, null);
  assert.ok(exact.ok);
  assert.deepEqual([exact.value.rows.length, exact.value.next], [100, null]);
  bulk(s.db, 1, s.nagpur, s.yavatmal, { first: 200000 });
  const more = s.memos.pending(s.db, none, null);
  assert.ok(more.ok);
  assert.deepEqual([more.value.rows.length, more.value.next !== null, more.value.count], [100, true, 101]);
  const last = s.memos.pending(s.db, none, more.value.next);
  assert.ok(last.ok);
  assert.deepEqual([last.value.rows.map((r) => r.lrNo), last.value.next], [[200000], null]);
});

test('totals: only the ticked LRs that are still booked, added up by the keeper', () => {
  const s = setUp();
  const a = book(s, { qty: '2', toPay: '100' });
  const b = book(s, { qty: '3', toPay: '', paid: '250.50' });
  const c = book(s, { qty: '5' });
  const gone = book(s, { qty: '7' });
  saved(create(s, [gone.id]));
  const t = s.memos.totals(s.db, [a.id, b.id, gone.id, 99999]);
  assert.ok(t.ok);
  assert.deepEqual(t.value, { lrs: 2, qty: 5, toPayPaise: 10000, paidPaise: 25050 });
  const all = s.memos.totals(s.db, [a.id, b.id, c.id]);
  assert.ok(all.ok);
  assert.equal(all.value.qty, 10);
  const nothing = s.memos.totals(s.db, []);
  assert.ok(nothing.ok);
  assert.deepEqual(nothing.value, { lrs: 0, qty: 0, toPayPaise: 0, paidPaise: 0 });
});

// ---- saving a memo ----

test('a memo takes the next challan number, loads its LRs and freezes totals equal to the sum of lrAmounts', () => {
  const s = setUp();
  const a = book(s, { toPay: '333.33', staxPercent: '2.5', chargeOption: 'option1', godownBhada: '5', godownInsurance: '5', deliveryCharges: '2', hamali: '30' });
  const b = book(s, { toPay: '', paid: '100.10', staxPercent: '5', chargeOption: 'option2', godownBhada: '1.50' });
  const c = book(s, { toPay: '999.99', staxPercent: '12.36', hamali: '0.01', qty: '5' });
  const outside = book(s);
  assert.equal(nextNo(s), 1);

  const memo = saved(create(s, [c.id, a.id, b.id], { truckHire: '4,500', loadingHamali: '250.75' }));
  assert.deepEqual([memo.challanYear, memo.challanNo, memo.date, memo.truck, memo.toStation, memo.lrCount, memo.status, memo.again], [2026, 1, '2026-10-31', 'MH 29 BE 1234', 'Nagpur', 3, 'saved', false]);

  const rows = s.db.prepare('SELECT * FROM lrs WHERE memo_id = ? ORDER BY id').all(memo.id) as (Parameters<typeof lrAmounts>[0] & { id: number; status: string; version: number; qty: number })[];
  assert.deepEqual(rows.map((r) => r.id), [a.id, b.id, c.id]);
  assert.ok(rows.every((r) => r.status === 'loaded' && r.version === 2));
  const out = s.db.prepare('SELECT status, memo_id, version FROM lrs WHERE id = ?').get(outside.id);
  assert.deepEqual(out, { status: 'booked', memo_id: null, version: 1 });

  const sum = (pick: (m: ReturnType<typeof lrAmounts>) => number) => rows.reduce((t, r) => t + pick(lrAmounts(r)), 0);
  const row = s.db.prepare('SELECT * FROM memos WHERE id = ?').get(memo.id) as Record<string, number | string>;
  assert.equal(row.frozen_lr_count, 3);
  assert.equal(row.frozen_qty, rows.reduce((t, r) => t + r.qty, 0));
  assert.equal(row.frozen_topay_paise, 33333 + 99999);
  assert.equal(row.frozen_paid_paise, 10010);
  assert.equal(row.frozen_charges_paise, sum((m) => m.charges));
  assert.equal(row.frozen_stax_paise, sum((m) => m.stax));
  assert.ok((row.frozen_stax_paise as number) > 0 && (row.frozen_charges_paise as number) > 0);
  assert.deepEqual([row.truck_hire_paise, row.loading_hamali_paise, row.seat, row.version], [450000, 25075, 'seat-1', 1]);
  assert.deepEqual(s.db.prepare(FROZEN_SQL).get(memo.id), {
    lrs: 3, qty: row.frozen_qty, toPayPaise: row.frozen_topay_paise, paidPaise: row.frozen_paid_paise, chargesPaise: row.frozen_charges_paise, staxPaise: row.frozen_stax_paise,
  });

  const audit = s.db.prepare("SELECT seat, entity, entity_id AS entityId, after_json AS after FROM audit_log WHERE action = 'memos.create'").all() as { seat: string; entity: string; entityId: string; after: string }[];
  assert.equal(audit.length, 1);
  assert.deepEqual([audit[0].seat, audit[0].entity, audit[0].entityId], ['seat-1', 'memos', String(memo.id)]);
  const after = JSON.parse(audit[0].after) as { challanNo: number; lrIds: number[]; frozen: { lrs: number } };
  assert.deepEqual([after.challanNo, [...after.lrIds].sort(), after.frozen.lrs], [1, [a.id, b.id, c.id].sort(), 3]);

  assert.equal(nextNo(s), 2);
});

test('frozen tax is the same as lrAmounts for many odd amounts and rates (the SQL twin of taxPaise)', () => {
  const s = setUp();
  const ids: number[] = [];
  for (let i = 0; i < 40; i++) {
    const rupees = `${17 + i * 37}.${String((i * 7) % 100).padStart(2, '0')}`;
    ids.push(book(s, { toPay: i % 2 === 0 ? rupees : '', paid: i % 2 === 1 ? rupees : '', staxPercent: ['0', '2.5', '5', '12.36', '18', '0.01'][i % 6] }).id);
  }
  const memo = saved(create(s, ids));
  const rows = s.db.prepare('SELECT * FROM lrs WHERE memo_id = ?').all(memo.id) as Parameters<typeof lrAmounts>[0][];
  const frozen = s.db.prepare(FROZEN_SQL).get(memo.id) as { staxPaise: number };
  assert.equal(frozen.staxPaise, rows.reduce((t, r) => t + lrAmounts(r).stax, 0));
});

test('challan numbers run per year: a backdated memo takes its own year\'s number and does not disturb this year\'s', () => {
  const s = setUp();
  assert.equal(saved(create(s, [book(s).id])).challanNo, 1);
  const old = saved(create(s, [book(s).id], { date: '2025-12-30', systemPin: SYSTEM }));
  assert.deepEqual([old.challanYear, old.challanNo], [2025, 1]);
  assert.equal(saved(create(s, [book(s).id], { date: '2025-12-31', systemPin: SYSTEM })).challanNo, 2);
  assert.equal(saved(create(s, [book(s).id])).challanNo, 2);
  assert.equal(nextNo(s, '2025-12-31'), 3);
  assert.equal(nextNo(s), 3, 'this year went on from 2');
});

test('a refused save writes nothing and uses no number', () => {
  const s = setUp();
  const a = book(s);
  const b = book(s);
  const dead = s.made(s.masters.create(s.db, 'seat-1', 'trucks', { number: 'MH 30 ZZ 9' }));
  const gone = s.made(s.masters.create(s.db, 'seat-1', 'drivers', { name: 'Gone Driver' }));
  const off = s.made(s.masters.create(s.db, 'seat-1', 'stations', { name: 'Closed Town' }));
  assert.ok(s.masters.setActive(s.db, 'seat-1', 'trucks', dead.id, dead.version, false, SYSTEM).ok);
  assert.ok(s.masters.setActive(s.db, 'seat-1', 'drivers', gone.id, gone.version, false, SYSTEM).ok);
  assert.ok(s.masters.setActive(s.db, 'seat-1', 'stations', off.id, off.version, false, SYSTEM).ok);
  const ids = (k: number) => Array.from({ length: k }, (_, i) => a.id + i + 1000);
  const cases: [string, Partial<MemoInput>, Record<string, string>][] = [
    ['no LRs', { lrIds: [] }, { lrs: 'required' }],
    ['over 500 LRs', { lrIds: ids(501) }, { lrs: 'many' }],
    ['an LR that does not exist', { lrIds: [a.id, 987654] }, { lrs: 'missing' }],
    ['inactive truck', { truckId: dead.id }, { truck: 'missing' }],
    ['no such truck', { truckId: 98765 }, { truck: 'missing' }],
    ['inactive driver', { driverId: gone.id }, { driver: 'missing' }],
    ['inactive To station', { toStationId: off.id }, { toStation: 'missing' }],
    ['no truck', { truckId: null }, { truck: 'required' }],
    ['no To station', { toStationId: null }, { toStation: 'required' }],
    ['From = To', { toStationId: s.yavatmal }, { toStation: 'same' }],
    ['negative hire', { truckHire: '-1' }, { truckHire: 'amount' }],
    ['hamali not a number', { loadingHamali: 'abc' }, { loadingHamali: 'amount' }],
    ['a date in the future', { date: '2026-11-01', systemPin: SYSTEM }, { date: 'future' }],
  ];
  const before = footprint(s);
  for (const [name, over, fields] of cases) {
    const r = refused(create(s, [a.id, b.id], over));
    assert.equal(r.code, 'memo-invalid', name);
    assert.deepEqual(r.memoFields, fields, name);
    assert.equal(footprint(s), before, `${name} wrote something`);
  }
  // another day needs the System PIN, checked before anything is written
  for (const pin of [undefined, '', '0000']) {
    const r = refused(create(s, [a.id, b.id], { date: '2026-10-30', systemPin: pin }));
    assert.ok(r.code === 'wrong-pin' || r.code === 'bad-pin', String(r.code));
    assert.equal(footprint(s), before);
  }
  assert.equal(saved(create(s, [a.id, b.id], { date: '2026-10-30', systemPin: SYSTEM })).date, '2026-10-30', 'the right PIN saves');
});

test('an invalid memo is refused before the PIN is looked at: no wrong try is counted, so the right PIN still works afterwards', () => {
  const s = setUp();
  const a = book(s);
  // Six refusals with a wrong PIN: had the PIN been checked first, five of them would have locked it.
  for (let i = 0; i < 6; i++) assert.equal(refused(create(s, [], { date: '2026-10-30', systemPin: '0000' })).code, 'memo-invalid');
  assert.equal(saved(create(s, [a.id], { date: '2026-10-30', systemPin: SYSTEM })).date, '2026-10-30');
});

test('a retry of a backdated save returns the first memo without the PIN', () => {
  const s = setUp();
  const a = book(s);
  const input = memoInput(s, [a.id], { date: '2026-10-30', systemPin: SYSTEM });
  const one = saved(s.memos.create(s.db, 'seat-1', input));
  const again = saved(s.memos.create(s.db, 'seat-1', { ...input, systemPin: '' }));
  assert.deepEqual([again.id, again.again, again.date], [one.id, true, '2026-10-30']);
});

test('the claim guard: an LR already loaded stops the whole save, names the LR, the challan and the truck, and burns no number', () => {
  const s = setUp();
  const a = book(s);
  const b = book(s);
  const c = book(s);
  const first = saved(create(s, [a.id])); // challan 1 on MH 29 BE 1234
  const before = footprint(s);
  const r = refused(create(s, [a.id, b.id, c.id], { truckId: s.truck2 }));
  assert.equal(r.code, 'memo-conflict');
  assert.deepEqual(r.taken, [{ id: a.id, lrNo: a.no, state: 'loaded', challanNo: first.challanNo, truck: 'MH 29 BE 1234' }]);
  assert.equal(footprint(s), before, 'b and c are still booked, no memo, no number, no audit row');
  assert.equal(saved(create(s, [b.id, c.id])).challanNo, 2, 'the next memo gets the number the failed one did not use');
});

test('a cancelled LR cannot be ticked in; with several taken, all are named and the good ones stay booked', () => {
  const s = setUp();
  const a = book(s);
  const b = book(s);
  const c = book(s);
  const d = book(s);
  saved(create(s, [a.id]));
  assert.ok(s.lrs.cancel(s.db, 'seat-1', b.id, 1, 'wrong party', SYSTEM).ok);
  const before = footprint(s);
  const r = refused(create(s, [d.id, c.id, b.id, a.id]));
  assert.deepEqual(r.taken, [
    { id: a.id, lrNo: a.no, state: 'loaded', challanNo: 1, truck: 'MH 29 BE 1234' },
    { id: b.id, lrNo: b.no, state: 'cancelled', challanNo: null, truck: null },
  ]);
  assert.equal(footprint(s), before);
});

test('the same uid twice is one memo: the first one comes back, nothing more is written', () => {
  const s = setUp();
  const a = book(s);
  const input = memoInput(s, [a.id]);
  const one = saved(s.memos.create(s.db, 'seat-1', input));
  const before = footprint(s);
  const again = saved(s.memos.create(s.db, 'seat-2', input));
  assert.deepEqual([again.id, again.challanNo, again.again], [one.id, one.challanNo, true]);
  assert.equal(footprint(s), before);
  // even when the LRs are loaded by now, the retry is not a conflict
  assert.equal(saved(s.memos.create(s.db, 'seat-1', { ...input, lrIds: [a.id, 1] })).again, true);
});

test('500 LRs make a memo; the 501st is refused', () => {
  const s = setUp();
  const ids = bulk(s.db, 501, s.nagpur, s.yavatmal);
  assert.equal(refused(create(s, ids)).code, 'memo-invalid');
  const memo = saved(create(s, ids.slice(0, 500)));
  assert.equal(memo.lrCount, 500);
  const got = s.memos.get(s.db, memo.id);
  assert.ok(got.ok);
  assert.equal(got.value.lrs.length, 500);
  assert.equal(got.value.frozen.qty, 1000);
  const rest = s.memos.pending(s.db, none, null);
  assert.ok(rest.ok);
  assert.equal(rest.value.count, 1, 'the 501st is still booked');
});

// ---- reading a saved memo ----

test('get: header with names, the frozen totals and its LRs in (date, number) order; an unknown id is memo-missing', () => {
  const s = setUp();
  const late = book(s, { toPay: '200', qty: '2' });
  const early = book(s, { date: '2026-10-20', toPay: '', paid: '50', qty: '3' });
  const memo = saved(create(s, [late.id, early.id], { truckHire: '1000', loadingHamali: '50', toStationId: s.amravati }));
  const got = s.memos.get(s.db, memo.id);
  assert.ok(got.ok);
  const m = got.value;
  assert.deepEqual([m.challanNo, m.truck, m.driver, m.fromStation, m.toStation, m.truckHirePaise, m.loadingHamaliPaise, m.version, m.status], [1, 'MH 29 BE 1234', 'Ramesh Pawar', 'Yavatmal', 'Amravati', 100000, 5000, 1, 'saved']);
  assert.deepEqual(m.frozen, { lrs: 2, qty: 5, toPayPaise: 20000, paidPaise: 5000, chargesPaise: 0, staxPaise: 0 });
  assert.deepEqual(m.lrs.map((r) => r.lrNo), [early.no, late.no]);
  const missing = s.memos.get(s.db, 12345);
  assert.deepEqual([missing.ok, !missing.ok && missing.code], [false, 'memo-missing']);
});

test('byDate: that day\'s memos, newest challan first', () => {
  const s = setUp();
  const m1 = saved(create(s, [book(s).id]));
  const m2 = saved(create(s, [book(s).id, book(s).id], { truckId: s.truck2 }));
  saved(create(s, [book(s).id], { date: '2026-10-30', systemPin: SYSTEM }));
  const today = s.memos.byDate(s.db, null);
  assert.ok(today.ok);
  assert.deepEqual(today.value.map((r) => [r.challanNo, r.truck, r.lrCount]), [[m2.challanNo, 'MH 29 AB 1', 2], [m1.challanNo, 'MH 29 BE 1234', 1]]);
  const yesterday = s.memos.byDate(s.db, '2026-10-30');
  assert.ok(yesterday.ok);
  assert.equal(yesterday.value.length, 1);
});

test('the Dashboard counts real memos and the trucks on them', () => {
  const s = setUp();
  const dash = makeDashboard(now);
  saved(create(s, [book(s).id]));
  saved(create(s, [book(s).id], { truckId: s.truck2 }));
  saved(create(s, [book(s).id]));
  book(s);
  const d = dash.summary(s.db, null);
  assert.ok(d.ok);
  assert.deepEqual([d.value.memos, d.value.trucksOut, d.value.loaded, d.value.pending], [3, 2, 3, 1]);
});

// ---- plans and speed ----

test('the pending statements are answered from an index, never a scan of lrs', () => {
  const s = setUp();
  const filters: MemoFilters[] = [
    none,
    { ...none, toStationId: s.nagpur, from: '2026-10-01', to: '2026-10-31' },
    { ...none, consignor: { firmId: s.ganesh, text: '' }, consignee: { firmId: null, text: 'kale' } },
  ];
  for (const f of filters) {
    const q = pendingSql(f, true);
    for (const [name, sql] of [['rows', q.rows], ['count', q.count]] as const) {
      const args = name === 'rows' ? { ...q.args, cd: '2026-10-01', cn: 1 } : q.args;
      const plan = (s.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(args) as { detail: string }[]).map((r) => r.detail);
      // "SCAN l" is the newer wording, "SCAN TABLE lrs AS l" the older one
      assert.ok(!plan.some((l) => /^SCAN (TABLE lrs\b|l\b)/.test(l)), `${name}: ${plan.join(' | ')}`);
      assert.ok(plan.some((l) => /^SEARCH (TABLE lrs\b|l\b).* USING (COVERING )?INDEX/.test(l)), `${name}: ${plan.join(' | ')}`);
    }
  }
});

test('speed: the pending list over 20 000 booked LRs answers in under 100 ms; a 100-LR memo saves in under 300 ms', () => {
  const s = setUp();
  const towns = Array.from({ length: 30 }, (_, i) => insertStation(s.db, `Town ${i}`));
  const put = s.db.prepare(
    `INSERT INTO lrs (uid, lr_year, lr_no, lr_date, consignor_name, consignee_name, from_station_id, to_station_id, particular, qty, seat)
     VALUES (?, 2026, ?, ?, 'A', 'B', ?, ?, 'Cloth', 3, 't')`,
  );
  s.db.transaction(() => {
    for (let i = 1; i <= 20000; i++) put.run(`u${i}`, i, `2026-${i % 2 ? '09' : '10'}-${String(1 + (i % 28)).padStart(2, '0')}`, s.yavatmal, towns[i % 30]);
  })();
  const first = s.memos.pending(s.db, none, null);
  assert.ok(first.ok && first.value.count === 20000 && first.value.rows.length === 100);
  const took = fastest(5, () => void s.memos.pending(s.db, none, null));
  assert.ok(took < 100, `pending took ${took.toFixed(1)} ms at its fastest of 5`);
  const station = fastest(5, () => void s.memos.pending(s.db, { ...none, toStationId: towns[3] }, null));
  assert.ok(station < 100, `pending for one station took ${station.toFixed(1)} ms at its fastest of 5`);

  const batches = Array.from({ length: 5 }, (_, b) => bulk(s.db, 100, s.nagpur, s.yavatmal, { first: 500000 + b * 1000 }));
  let next = 0;
  const save = fastest(5, () => void saved(create(s, batches[next++], { truckHire: '1000', loadingHamali: '100' })));
  assert.ok(save < 300, `a 100-LR memo took ${save.toFixed(1)} ms at its fastest of 5`);
  console.log(`# pending over 20000 LRs: ${took.toFixed(1)} ms (one station ${station.toFixed(1)} ms); 100-LR memo: ${save.toFixed(1)} ms`);
});
