import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MEMO_LRS, type MemoHeaderInput, type MemoInput } from '../shared';
import { asCursor, asHeaderInput, asIds, asLrIds, asMemoInput, asPendingFilters, asSavedFilters, cleanHeader, cleanIds, cleanMemo } from './memoRules';

const TODAY = '2026-10-31';
const good: MemoInput = {
  uid: 'u1',
  date: null,
  truckId: 1,
  driverId: 2,
  fromStationId: 3,
  toStationId: 4,
  truckHire: '1,200.50',
  loadingHamali: '',
  lrIds: [10, 11, 12],
};

test('a memo input needs a uid; a value of the wrong type becomes an empty one that the rules then refuse by name', () => {
  assert.equal(asMemoInput(null), null);
  assert.equal(asMemoInput({}), null);
  assert.equal(asMemoInput({ uid: 'x'.repeat(65) }), null);
  const i = asMemoInput({ uid: 'u', date: 5, truckId: '1', driverId: 1.5, fromStationId: null, truckHire: 7, lrIds: 'all' });
  assert.deepEqual(i, { uid: 'u', date: null, systemPin: '', truckId: null, driverId: null, fromStationId: null, toStationId: null, truckHire: '', loadingHamali: '', lrIds: [] });
});

test('an LR id that is not a whole number above 0 is kept as 0, so it is refused and never dropped', () => {
  assert.deepEqual(asMemoInput({ uid: 'u', lrIds: [3, '4', 5.5, -1, null, 6] })?.lrIds, [3, 0, 0, 0, 0, 6]);
  assert.deepEqual(asIds([3, '4', 5.5, 0, 6]), [3, 6]);
  assert.deepEqual(asIds('x'), []);
  assert.equal(asIds(Array.from({ length: 800 }, (_, k) => k + 1)).length, MAX_MEMO_LRS);
});

test('a good memo: today, money in paise, the LR ids once each', () => {
  const c = cleanMemo({ ...good, lrIds: [10, 11, 10, 12] }, TODAY);
  assert.deepEqual(c.errors, {});
  assert.equal(c.date, TODAY);
  assert.equal(c.hirePaise, 120050);
  assert.equal(c.hamaliPaise, 0, 'an empty box is 0');
  assert.deepEqual(c.ids, [10, 11, 12]);
});

test('truck, driver and both stations are required; From must differ from To', () => {
  const c = cleanMemo({ ...good, truckId: null, driverId: null, fromStationId: null, toStationId: null }, TODAY);
  assert.deepEqual(c.errors, { truck: 'required', driver: 'required', fromStation: 'required', toStation: 'required' });
  assert.deepEqual(cleanMemo({ ...good, fromStationId: 4 }, TODAY).errors, { toStation: 'same' });
});

test('money must be a rupee amount, and not absurdly big', () => {
  assert.deepEqual(cleanMemo({ ...good, truckHire: '12x', loadingHamali: '-5' }, TODAY).errors, { truckHire: 'amount', loadingHamali: 'amount' });
  assert.deepEqual(cleanMemo({ ...good, truckHire: '99,99,99,99,99,999' }, TODAY).errors, { truckHire: 'amount' });
  assert.deepEqual(cleanMemo({ ...good, truckHire: '0', loadingHamali: '0.00' }, TODAY).errors, {});
});

test('the date: a real day, not in the future', () => {
  assert.deepEqual(cleanMemo({ ...good, date: '2026-11-01' }, TODAY).errors, { date: 'future' });
  assert.deepEqual(cleanMemo({ ...good, date: '2026-02-30' }, TODAY).errors, { date: 'date' });
  assert.deepEqual(cleanMemo({ ...good, date: 'yesterday' }, TODAY).errors, { date: 'date' });
  assert.deepEqual(cleanMemo({ ...good, date: '2026-10-30' }, TODAY).errors, {});
  assert.equal(cleanMemo({ ...good, date: '2026-10-30' }, TODAY).date, '2026-10-30');
});

test('1 to 500 distinct LRs; an id that cannot be an LR is refused', () => {
  assert.deepEqual(cleanMemo({ ...good, lrIds: [] }, TODAY).errors, { lrs: 'required' });
  const ids = (n: number) => Array.from({ length: n }, (_, k) => k + 1);
  assert.deepEqual(cleanMemo({ ...good, lrIds: ids(MAX_MEMO_LRS) }, TODAY).errors, {});
  assert.deepEqual(cleanMemo({ ...good, lrIds: ids(MAX_MEMO_LRS + 1) }, TODAY).errors, { lrs: 'many' });
  assert.deepEqual(cleanMemo({ ...good, lrIds: [...ids(MAX_MEMO_LRS), 7, 7] }, TODAY).errors, {}, 'repeats are one LR');
  assert.deepEqual(cleanMemo({ ...good, lrIds: [10, 0] }, TODAY).errors, { lrs: 'missing' });
});

test('filters: bad dates mean no bound; a picked firm beats typed text; empty text is no filter', () => {
  assert.deepEqual(asPendingFilters({}), { from: null, to: null, toStationId: null, consignor: null, consignee: null });
  const f = asPendingFilters({
    from: '2026-10-01', to: 'soon', toStationId: 4.5,
    consignor: { firmId: 9, text: 'ignored' }, consignee: { firmId: null, text: '  Kale  ' },
  });
  assert.deepEqual(f, { from: '2026-10-01', to: null, toStationId: null, consignor: { firmId: 9, text: '' }, consignee: { firmId: null, text: 'Kale' } });
  assert.equal(asPendingFilters({ consignor: { firmId: null, text: '   ' } }).consignor, null);
  assert.equal(asPendingFilters({ consignee: 'Kale' }).consignee, null);
  assert.equal(asPendingFilters({ consignee: { firmId: null, text: 'k'.repeat(300) } }).consignee?.text.length, 100);
});

test('a cursor is a real date and a whole number above 0, or nothing', () => {
  assert.deepEqual(asCursor({ date: '2026-10-20', no: 41 }), { date: '2026-10-20', no: 41 });
  assert.equal(asCursor({ date: '2026-10-20', no: 0 }), null);
  assert.equal(asCursor({ date: '20-10-2026', no: 4 }), null);
  assert.equal(asCursor(null), null);
});

test('a header edit: the same rules as a new memo without the LRs; a request that is not an object has no header', () => {
  assert.equal(asHeaderInput('x'), null);
  const h = asHeaderInput({ date: '2026-10-20', truckId: 1, driverId: '2', fromStationId: 3, toStationId: 3, truckHire: '10', loadingHamali: 5 });
  assert.deepEqual(h, { date: '2026-10-20', truckId: 1, driverId: null, fromStationId: 3, toStationId: 3, truckHire: '10', loadingHamali: '' });
  const c = cleanHeader(h as MemoHeaderInput, TODAY);
  assert.deepEqual(c.errors, { driver: 'required', toStation: 'same' });
  assert.deepEqual([c.date, c.hirePaise, c.hamaliPaise], ['2026-10-20', 1000, 0]);
  assert.equal(cleanHeader({ ...good, date: '2026-11-01' }, TODAY).errors.date, 'future');
  assert.equal(cleanHeader({ ...good, truckHire: '1.234' }, TODAY).errors.truckHire, 'amount');
});

test('the LR ids of a take-off / move / add: 1 to 500 whole numbers, each once; the rest is refused by name', () => {
  assert.deepEqual(cleanIds([3, 3, 4]), { ids: [3, 4], error: null });
  assert.equal(cleanIds([]).error, 'required');
  assert.equal(cleanIds([1, 0]).error, 'missing');
  assert.equal(cleanIds(Array.from({ length: MAX_MEMO_LRS + 1 }, (_, i) => i + 1)).error, 'many');
  assert.deepEqual(asLrIds([3, '4', 1.5, -1]), [3, 0, 0, 0]);
  assert.deepEqual(asLrIds('x'), []);
});

test('the saved-memos filters: a bad date or id means no bound, never an error', () => {
  assert.deepEqual(asSavedFilters(null), { from: null, to: null, truckId: null, toStationId: null });
  assert.deepEqual(asSavedFilters({ from: '2026-10-01', to: 'soon', truckId: 4, toStationId: '2' }), { from: '2026-10-01', to: null, truckId: 4, toStationId: null });
});
