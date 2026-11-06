import { test } from 'node:test';
import assert from 'node:assert/strict';
import { START_VIEW, addDays, parseNumber, periodFor, queryOf, type HistoryView } from './historyQuery';

const TODAY = '2026-11-06';
const view = (over: Partial<HistoryView> = {}): HistoryView => ({ ...START_VIEW, ...over });
const typed = (over: Partial<Pick<HistoryView, 'seat' | 'lr' | 'challan'>> = {}) => ({ seat: '', lr: '', challan: '', ...over });

test('days are moved on the calendar, across months and years', () => {
  assert.equal(addDays('2026-11-06', -6), '2026-10-31');
  assert.equal(addDays('2026-01-03', -6), '2025-12-28');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('the periods: the last 7 days are today and the six before; the other presets are the Firm Accounts ones; custom is what was typed', () => {
  assert.deepEqual(periodFor(view(), TODAY), { from: '2026-10-31', to: TODAY });
  assert.deepEqual(periodFor(view({ preset: 'today' }), TODAY), { from: TODAY, to: TODAY });
  assert.deepEqual(periodFor(view({ preset: 'month' }), TODAY), { from: '2026-11-01', to: TODAY });
  assert.deepEqual(periodFor(view({ preset: 'lastMonth' }), TODAY), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(periodFor(view({ preset: 'custom', from: '2026-10-05', to: '2026-10-09' }), TODAY), { from: '2026-10-05', to: '2026-10-09' });
});

test('a number box: empty, a number, number/year; anything else is invalid', () => {
  assert.equal(parseNumber(''), 'empty');
  assert.equal(parseNumber('   '), 'empty');
  assert.deepEqual(parseNumber('12'), { no: 12, year: null });
  assert.deepEqual(parseNumber(' 12 / 2025 '), { no: 12, year: 2025 });
  assert.deepEqual(parseNumber('12/2025'), { no: 12, year: 2025 });
  for (const bad of ['0', 'abc', '12/25', '12/', '/2025', '1.5', '-3', '12 2025', '12/20255']) assert.equal(parseNumber(bad), 'invalid', bad);
});

test('the request for a view: the period, the filters that are set, the numbers split into number and year', () => {
  assert.deepEqual(queryOf(view(), TODAY, typed()), {
    from: '2026-10-31', to: TODAY, seat: '', kind: null, verb: null, lrNo: null, lrYear: null, challanNo: null, challanYear: null, showPrints: false,
  });
  assert.deepEqual(queryOf(view({ kind: 'lr', verb: 'cancelled', showPrints: true }), TODAY, typed({ seat: ' PC03 ', lr: '12', challan: '7/2025' })), {
    from: '2026-10-31', to: TODAY, seat: 'PC03', kind: 'lr', verb: 'cancelled', lrNo: 12, lrYear: null, challanNo: 7, challanYear: 2025, showPrints: true,
  });
});

test('no request while the period or a number is not usable: the page asks nothing and says what is wrong', () => {
  assert.equal(queryOf(view({ preset: 'custom', from: '', to: '' }), TODAY, typed()), null);
  assert.equal(queryOf(view({ preset: 'custom', from: '2026-11-07', to: '2026-11-06' }), TODAY, typed()), null);
  assert.equal(queryOf(view(), TODAY, typed({ lr: 'x' })), null);
  assert.equal(queryOf(view(), TODAY, typed({ challan: '0' })), null);
});
