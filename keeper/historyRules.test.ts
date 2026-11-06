import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_ACTIONS, HISTORY_KINDS, HISTORY_VERBS } from '../shared';
import { asHistoryCursor, asHistoryFilters, classify, conditionsFor, utcBounds } from './historyRules';

const week = { from: '2026-10-30', to: '2026-11-06' };

test('a real period is all that is needed; every other filter has a harmless default', () => {
  assert.deepEqual(asHistoryFilters(week), {
    ...week, seat: '', kind: null, verb: null, lrNo: null, lrYear: null, challanNo: null, challanYear: null, showPrints: false,
  });
});

test('the period must be two real dates, from not after to', () => {
  for (const bad of [null, 'x', {}, { from: '2026-10-30' }, { from: '2026-13-01', to: '2026-11-06' }, { from: '2026-11-07', to: '2026-11-06' }, { from: 5, to: 6 }]) {
    assert.equal(asHistoryFilters(bad), null, JSON.stringify(bad));
  }
  assert.ok(asHistoryFilters({ from: '2026-11-06', to: '2026-11-06' }), 'one day is a period');
});

test('filters of the right kind are kept, trimmed and bounded; a wrong value means no filter', () => {
  const f = asHistoryFilters({
    ...week, seat: `  ${'PC03'.padEnd(80, 'x')}  `, kind: 'lr', verb: 'cancelled', lrNo: 12, lrYear: 2025, challanNo: 7, challanYear: 2026, showPrints: true,
  });
  assert.equal(f?.seat.length, 50);
  assert.equal(f?.seat.startsWith('PC03'), true);
  assert.deepEqual([f?.kind, f?.verb, f?.lrNo, f?.lrYear, f?.challanNo, f?.challanYear, f?.showPrints], ['lr', 'cancelled', 12, 2025, 7, 2026, true]);

  const bad = asHistoryFilters({ ...week, seat: 5, kind: 'other', verb: 'nonsense', lrNo: 0, lrYear: 1999, challanNo: 1.5, challanYear: '2026', showPrints: 'yes' });
  assert.deepEqual(bad, { ...week, seat: '', kind: null, verb: null, lrNo: null, lrYear: null, challanNo: null, challanYear: null, showPrints: false });
  assert.equal(asHistoryFilters({ ...week, kind: 'constructor' })?.kind, null, 'a name from Object.prototype is not a kind');
});

test('a page cursor is the last row shown: a time and an id', () => {
  assert.deepEqual(asHistoryCursor({ at: '2026-11-06T09:12:33.456Z', id: 7 }), { at: '2026-11-06T09:12:33.456Z', id: 7 });
  for (const bad of [null, {}, { at: 'x', id: 7 }, { at: '2026-11-06T09:12:33.456Z', id: 0 }, { at: '2026-11-06T09:12:33.456Z', id: 1.5 }, { at: 3, id: 3 }]) {
    assert.equal(asHistoryCursor(bad), null, JSON.stringify(bad));
  }
});

test('local days become UTC times in the stored format; the end is the start of the next day', () => {
  const a = utcBounds('2026-11-06', '2026-11-06');
  const shape = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  assert.match(a.fromAt, shape);
  assert.match(a.toAt, shape);
  assert.equal(new Date(a.fromAt).getTime(), new Date(2026, 10, 6).getTime(), 'local midnight');
  assert.equal(a.toAt, utcBounds('2026-11-07', '2026-11-07').fromAt, 'days join up');
  assert.equal(utcBounds('2026-10-30', '2026-11-06').toAt, a.toAt);
  assert.equal(utcBounds('2026-12-31', '2026-12-31').toAt, utcBounds('2027-01-01', '2027-01-01').fromAt, 'across the new year');
});

test('every action is classified; a master change by its table; anything else is "other", whatever it is called', () => {
  assert.deepEqual(classify('lrs.cancel', 'lrs'), { kind: 'lr', verb: 'cancelled' });
  assert.deepEqual(classify('print.lr', 'lrs'), { kind: 'print', verb: 'printed' }, 'a print of an LR is a print, not an LR change');
  assert.deepEqual(classify('masters.update', 'firms'), { kind: 'firm', verb: 'edited' });
  assert.deepEqual(classify('masters.deactivate', 'agents'), { kind: 'agent', verb: 'deactivated' });
  assert.deepEqual(classify('masters.update', 'planets'), { kind: 'other', verb: 'other' });
  assert.deepEqual(classify('lrs.teleport', 'lrs'), { kind: 'other', verb: 'other' });
  assert.deepEqual(classify('constructor', 'x'), { kind: 'other', verb: 'other' });
  assert.deepEqual(classify('__proto__', 'x'), { kind: 'other', verb: 'other' });
});

test('the table is whole: every kind and every verb the filters offer has an action, and nothing else is in it', () => {
  const entries = Object.values(HISTORY_ACTIONS);
  for (const k of HISTORY_KINDS) assert.ok(entries.some((e) => e.kind === k), `no action for kind ${k}`);
  for (const v of HISTORY_VERBS) assert.ok(entries.some((e) => e.verb === v), `no action for verb ${v}`);
  for (const e of entries) {
    assert.ok(HISTORY_KINDS.includes(e.kind), e.kind);
    assert.ok(HISTORY_VERBS.includes(e.verb), e.verb);
  }
});

test('conditionsFor: the actions a kind and / or verb stand for, a master change with its table', () => {
  const all = conditionsFor(null, null);
  assert.equal(all.length, Object.keys(HISTORY_ACTIONS).length);
  assert.deepEqual(conditionsFor('firm', 'edited'), [{ action: 'masters.update', entity: 'firms' }]);
  const edited = conditionsFor(null, 'edited');
  for (const t of ['stations', 'firms', 'trucks', 'drivers', 'agents']) assert.ok(edited.some((c) => c.action === 'masters.update' && c.entity === t), t);
  assert.ok(edited.some((c) => c.action === 'lrs.update' && c.entity === null));
  assert.ok(!conditionsFor('lr', null).some((c) => c.action.startsWith('print.') || c.action.startsWith('masters.')));
  assert.deepEqual(conditionsFor('settings', 'lockedOut'), [{ action: 'pins.locked', entity: null }]);
  assert.deepEqual(conditionsFor('print', 'created'), [], 'no such pair: nothing matches');
});
