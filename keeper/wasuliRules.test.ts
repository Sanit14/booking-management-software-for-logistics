import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asCollectInput, asWasuliCursor, asWasuliFilters, asPeriod, asSeen, asSeenList, cleanCollect, cleanRemark, daysBetween, periodStart } from './wasuliRules';

const seen = { id: 4, status: 'assigned', agentId: 2, version: 3 };

test('asSeen takes a well-formed row and nothing else', () => {
  assert.deepEqual(asSeen(seen), seen);
  assert.deepEqual(asSeen({ id: 1, status: 'unassigned', agentId: null, version: 1 }), { id: 1, status: 'unassigned', agentId: null, version: 1 });
  for (const bad of [null, 'x', [], {}, { ...seen, id: 0 }, { ...seen, id: 1.5 }, { ...seen, version: 0 }, { ...seen, status: 'done' }, { ...seen, agentId: 0 }, { ...seen, agentId: 'a' }, { id: 1, status: 'assigned', version: 1 }]) {
    assert.equal(asSeen(bad), null, JSON.stringify(bad));
  }
});

test('asSeenList is 1 to 500 distinct rows, all well formed', () => {
  assert.equal(asSeenList([]), null);
  assert.equal(asSeenList('x'), null);
  assert.equal(asSeenList([seen, seen]), null, 'a row twice');
  assert.equal(asSeenList([seen, { ...seen, id: 5, status: 'nope' }]), null);
  assert.equal(asSeenList([seen])?.length, 1);
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...seen, id: i + 1 }));
  assert.equal(asSeenList(many(500))?.length, 500);
  assert.equal(asSeenList(many(501)), null);
});

test('list filters fall back instead of failing', () => {
  assert.deepEqual(asWasuliFilters({ tab: 'collected', agentId: 3, period: 'month' }), { tab: 'collected', agentId: 3, period: 'month' });
  assert.deepEqual(asWasuliFilters(undefined), { tab: 'unassigned', agentId: null, period: 'week' });
  assert.deepEqual(asWasuliFilters({ tab: 'x', agentId: 0, period: 'year' }), { tab: 'unassigned', agentId: null, period: 'week' });
  assert.deepEqual(asWasuliFilters({ tab: 'assigned', agentId: '3' }), { tab: 'assigned', agentId: null, period: 'week' });
  assert.equal(asPeriod('month'), 'month');
  assert.equal(asPeriod('all'), 'week');
});

test('a cursor needs two dates (or an empty first one) and a number', () => {
  assert.deepEqual(asWasuliCursor({ a: '', date: '2026-10-24', no: 7 }), { a: '', date: '2026-10-24', no: 7 });
  assert.deepEqual(asWasuliCursor({ a: '2026-10-30', date: '2026-10-24', no: 7 }), { a: '2026-10-30', date: '2026-10-24', no: 7 });
  for (const bad of [null, {}, { a: '', date: '24-10-2026', no: 7 }, { a: 'x', date: '2026-10-24', no: 7 }, { a: '', date: '2026-10-24', no: 0 }, { date: '2026-10-24', no: 7 }]) {
    assert.equal(asWasuliCursor(bad), null, JSON.stringify(bad));
  }
});

test('"the last 7 / 30 days" counts today as one of them, across month and year ends', () => {
  assert.equal(periodStart('2026-10-31', 'week'), '2026-10-25');
  assert.equal(periodStart('2026-10-31', 'month'), '2026-10-02');
  assert.equal(periodStart('2026-01-03', 'week'), '2025-12-28');
  assert.equal(periodStart('2026-03-01', 'month'), '2026-01-31');
});

test('days waited are whole calendar days and never negative', () => {
  assert.equal(daysBetween('2026-10-24', '2026-10-24'), 0);
  assert.equal(daysBetween('2026-10-24', '2026-10-31'), 7);
  assert.equal(daysBetween('2025-12-30', '2026-01-02'), 3);
  assert.equal(daysBetween('2026-10-31', '2026-10-24'), 0);
});

test('a remark is trimmed, may be empty, and has at most 200 characters', () => {
  assert.equal(cleanRemark('  UPI   ref 4512 '), 'UPI ref 4512');
  assert.equal(cleanRemark(''), '');
  assert.equal(cleanRemark('x'.repeat(200))?.length, 200);
  assert.equal(cleanRemark('x'.repeat(201)), null);
  assert.equal(cleanRemark(5), null);
});

test('collect: an amount above 0, a mode, a short remark', () => {
  const ok = cleanCollect({ amount: '1,250.50', mode: 'upi', remark: ' part payment ' });
  assert.deepEqual(ok, { paise: 125050, mode: 'upi', remark: 'part payment', errors: {} });
  assert.deepEqual(cleanCollect({ amount: '0.01', mode: 'cash', remark: '' }).errors, {});
  assert.equal(cleanCollect({ amount: '', mode: 'cash', remark: '' }).errors.amount, 'required');
  for (const amount of ['0', '0.00', '-5', '12.345', 'abc', '₹5', '1e3', '99999999999999999999']) {
    assert.equal(cleanCollect({ amount, mode: 'cash', remark: '' }).errors.amount, 'amount', amount);
  }
  assert.equal(cleanCollect({ amount: '5', mode: null, remark: '' }).errors.mode, 'required');
  assert.equal(cleanCollect({ amount: '5', mode: 'cash', remark: 'x'.repeat(201) }).errors.remark, 'long');
  assert.deepEqual(Object.keys(cleanCollect({ amount: '', mode: null, remark: 'x'.repeat(201) }).errors).sort(), ['amount', 'mode', 'remark']);
});

test('the collect input of a request: a wrong type becomes an empty value, never a guess', () => {
  assert.deepEqual(asCollectInput({ amount: '5', mode: 'card', remark: 'r' }), { amount: '5', mode: 'card', remark: 'r' });
  assert.deepEqual(asCollectInput({ amount: 5, mode: 'cheque', remark: null }), { amount: '', mode: null, remark: '' });
  assert.deepEqual(asCollectInput('x'), { amount: '', mode: null, remark: '' });
});
