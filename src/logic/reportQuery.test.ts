import { test } from 'node:test';
import assert from 'node:assert/strict';
import { START_VIEW, periodFor, queryOf, type ReportsView } from './reportQuery';

const TODAY = '2026-11-06';
const view = (over: Partial<ReportsView> = {}): ReportsView => ({ ...START_VIEW, ...over });

test('the period of a view: a preset from the keeper\'s today, or the two dates typed', () => {
  assert.deepEqual(periodFor(view(), TODAY), { from: '2026-11-01', to: TODAY }, 'This month is the default');
  assert.deepEqual(periodFor(view({ preset: 'today' }), TODAY), { from: TODAY, to: TODAY });
  assert.deepEqual(periodFor(view({ preset: 'lastMonth' }), TODAY), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(periodFor(view({ preset: 'year' }), TODAY), { from: '2026-01-01', to: TODAY });
  assert.deepEqual(periodFor(view({ preset: 'custom', from: '2026-10-05', to: '2026-10-09' }), TODAY), { from: '2026-10-05', to: '2026-10-09' });
});

test('queryOf: null until a custom period is two real days, From not after To', () => {
  assert.equal(queryOf(view({ preset: 'custom', from: '', to: '' }), TODAY, ''), null);
  assert.equal(queryOf(view({ preset: 'custom', from: '2026-10-09', to: '2026-10-05' }), TODAY, ''), null);
  assert.equal(queryOf(view({ preset: 'custom', from: '2026-02-30', to: '2026-03-01' }), TODAY, ''), null);
  assert.deepEqual(queryOf(view({ preset: 'custom', from: '2026-10-05', to: '2026-10-05' }), TODAY, '')?.from, '2026-10-05');
});

test('queryOf: only the filters the report uses are sent, as ids or text; a box left on "All" is not a filter', () => {
  const all = { toStationId: '3', truckId: '7', agentId: '2' };
  const q = (kind: ReportsView['kind'], typed = 'kale') => queryOf(view({ kind, ...all }), TODAY, typed);
  assert.deepEqual(q('dateWise'), { from: '2026-11-01', to: TODAY, toStationId: 3, text: 'kale', truckId: null, agentId: null });
  assert.deepEqual(q('stationWise'), { from: '2026-11-01', to: TODAY, toStationId: null, text: 'kale', truckId: null, agentId: null });
  assert.deepEqual(q('truckWise'), { from: '2026-11-01', to: TODAY, toStationId: 3, text: '', truckId: 7, agentId: null });
  assert.deepEqual(q('wasuli'), { from: '2026-11-01', to: TODAY, toStationId: null, text: '', truckId: null, agentId: 2 });
  assert.deepEqual(q('firmWise'), { from: '2026-11-01', to: TODAY, toStationId: null, text: 'kale', truckId: null, agentId: null });
  assert.deepEqual(queryOf(view({ kind: 'dateWise' }), TODAY, ''), { from: '2026-11-01', to: TODAY, toStationId: null, text: '', truckId: null, agentId: null });
  assert.equal(queryOf(view({ kind: 'dateWise', toStationId: 'x' }), TODAY, '  ')?.toStationId, null, 'not a number = not a filter');
  assert.equal(queryOf(view({ kind: 'dateWise' }), TODAY, '  padded  ')?.text, 'padded', 'typed text is trimmed');
});
