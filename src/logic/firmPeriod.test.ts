import assert from 'node:assert/strict';
import { test } from 'node:test';
import { barHeight, growthLabel, isRange, periodOf, yearChoices } from './firmPeriod';

test('the presets, from the keeper PC\'s today: Today, This month (to today), Last month (whole), This year (to today)', () => {
  assert.deepEqual(periodOf('today', '2026-11-03'), { from: '2026-11-03', to: '2026-11-03' });
  assert.deepEqual(periodOf('month', '2026-11-03'), { from: '2026-11-01', to: '2026-11-03' });
  assert.deepEqual(periodOf('month', '2026-11-01'), { from: '2026-11-01', to: '2026-11-01' });
  assert.deepEqual(periodOf('lastMonth', '2026-11-03'), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(periodOf('year', '2026-11-03'), { from: '2026-01-01', to: '2026-11-03' });
});

test('last month crosses a year end and knows short and leap Februaries', () => {
  assert.deepEqual(periodOf('lastMonth', '2026-01-15'), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(periodOf('lastMonth', '2026-03-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(periodOf('lastMonth', '2024-03-02'), { from: '2024-02-01', to: '2024-02-29' });
  assert.deepEqual(periodOf('lastMonth', '2026-07-31'), { from: '2026-06-01', to: '2026-06-30' });
});

test('a custom range is only asked for when both days are real dates and from is not after to', () => {
  assert.equal(isRange('2026-10-01', '2026-10-31'), true);
  assert.equal(isRange('2026-10-05', '2026-10-05'), true);
  for (const [from, to] of [['', '2026-10-31'], ['2026-10-01', ''], ['2026-10-31', '2026-10-01'], ['2026-02-30', '2026-03-01'], ['x', 'y']]) assert.equal(isRange(from, to), false, `${from} ${to}`);
});

test('growth reads as an arrow and a whole percent; nothing before it is a dash', () => {
  assert.deepEqual(growthLabel(12), { text: '▲ 12%', tone: 'up' });
  assert.deepEqual(growthLabel(-8), { text: '▼ 8%', tone: 'down' });
  assert.deepEqual(growthLabel(0), { text: '0%', tone: 'flat' });
  assert.deepEqual(growthLabel(null), { text: '—', tone: 'flat' });
  assert.deepEqual(growthLabel(376), { text: '▲ 376%', tone: 'up' });
  assert.deepEqual(growthLabel(-100), { text: '▼ 100%', tone: 'down' });
});

test('a chart bar: 100% is the full height, a tiny change still shows, nothing is nothing', () => {
  assert.equal(barHeight(100, 60), 60);
  assert.equal(barHeight(-100, 60), 60);
  assert.equal(barHeight(50, 60), 30);
  assert.equal(barHeight(900, 60), 60, 'capped');
  assert.equal(barHeight(1, 60), 2, 'at least 2 px, so the bar can be seen');
  assert.equal(barHeight(0, 60), 0);
  assert.equal(barHeight(null, 60), 0);
});

test('the years the picker offers', () => {
  assert.deepEqual(yearChoices('2026-11-03'), [2026, 2025, 2024]);
});
