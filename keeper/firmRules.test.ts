import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, asAccountCursor, asAccountFilters, asRange, asStatementCursor, asStatementQuery, asYear, growthPct, monthRows, previousPeriod } from './firmRules';

test('addDays moves a date by whole days across month, year and leap day', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(addDays('2025-03-01', -1), '2025-02-28');
});

test('previousPeriod is the same number of days just before (DM: previousPeriod)', () => {
  assert.deepEqual(previousPeriod({ from: '2026-10-01', to: '2026-10-31' }), { from: '2026-08-31', to: '2026-09-30' });
  assert.deepEqual(previousPeriod({ from: '2026-10-15', to: '2026-10-15' }), { from: '2026-10-14', to: '2026-10-14' });
  assert.deepEqual(previousPeriod({ from: '2026-01-01', to: '2026-01-31' }), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(previousPeriod({ from: '2024-03-01', to: '2024-03-31' }), { from: '2024-01-30', to: '2024-02-29' }, 'leap February');
  assert.deepEqual(previousPeriod({ from: '2025-02-01', to: '2025-02-28' }), { from: '2025-01-04', to: '2025-01-31' });
  assert.deepEqual(previousPeriod({ from: '2026-01-01', to: '2026-12-31' }), { from: '2025-01-01', to: '2025-12-31' }, 'a whole year');
});

test('growthPct: whole percent, round half up, null on a zero base', () => {
  assert.equal(growthPct(150, 100), 50);
  assert.equal(growthPct(50, 100), -50);
  assert.equal(growthPct(100, 100), 0);
  assert.equal(growthPct(0, 100), -100);
  assert.equal(growthPct(300, 100), 200);
  assert.equal(growthPct(5, 0), null);
  assert.equal(growthPct(0, 0), null);
  // thirds
  assert.equal(growthPct(1, 3), -67);
  assert.equal(growthPct(2, 3), -33);
  assert.equal(growthPct(4, 3), 33);
  // exactly half: up (towards +infinity), for a rise and for a fall
  assert.equal(growthPct(299, 200), 50, '49.5 -> 50');
  assert.equal(growthPct(301, 200), 51, '50.5 -> 51');
  assert.equal(growthPct(101, 200), -49, '-49.5 -> -49');
  assert.equal(growthPct(3, 8), -62, '-62.5 -> -62');
  assert.equal(growthPct(1, 8), -87, '-87.5 -> -87');
  // paise-sized numbers
  assert.equal(growthPct(1_234_500_00, 1_000_000_00), 23, '23.45 -> 23');
});

test('monthRows: 12 months, each against the month before; the month in progress and later have no growth', () => {
  const by = new Map([
    ['2025-12', { lrs: 4, freightPaise: 100 }],
    ['2026-01', { lrs: 6, freightPaise: 150 }],
    ['2026-02', { lrs: 0, freightPaise: 0 }],
    ['2026-03', { lrs: 5, freightPaise: 200 }],
    ['2026-04', { lrs: 9, freightPaise: 300 }],
    ['2026-05', { lrs: 2, freightPaise: 10 }],
  ]);
  const rows = monthRows(2026, by, '2026-05-10');
  assert.equal(rows.length, 12);
  assert.deepEqual(rows.map((r) => r.month), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
  assert.deepEqual(rows[0], { month: '2026-01', lrs: 6, freightPaise: 150, growth: 50 }, 'January against last December');
  assert.equal(rows[1].growth, -100, 'a month with nothing');
  assert.equal(rows[2].growth, null, 'the month before had nothing');
  assert.equal(rows[3].growth, 50);
  assert.equal(rows[4].growth, null, 'May is in progress');
  assert.deepEqual(rows[5], { month: '2026-06', lrs: 0, freightPaise: 0, growth: null }, 'a month with no row is zero');
  // a past year is all compared; a future year none
  assert.equal(monthRows(2025, new Map(), '2026-05-10').every((r) => r.growth === null), true, 'all zero bases');
  assert.equal(monthRows(2027, by, '2026-05-10').every((r) => r.growth === null), true);
  assert.equal(monthRows(2025, new Map([['2025-11', { lrs: 1, freightPaise: 100 }], ['2025-12', { lrs: 1, freightPaise: 50 }]]), '2026-05-10')[11].growth, -50, 'December of a past year is compared');
});

test('asRange needs two real dates, from not after to', () => {
  assert.deepEqual(asRange({ from: '2026-10-01', to: '2026-10-31' }), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(asRange({ from: '2026-10-05', to: '2026-10-05' }), { from: '2026-10-05', to: '2026-10-05' });
  for (const bad of [null, 'x', {}, { from: '2026-10-31', to: '2026-10-01' }, { from: '2026-02-30', to: '2026-03-01' }, { from: '01-10-2026', to: '31-10-2026' }, { from: '2026-10-01' }, { from: 5, to: 6 }]) {
    assert.equal(asRange(bad), null, JSON.stringify(bad));
  }
});

test('asStatementQuery: firm, range and role (both when missing); anything else is refused', () => {
  const q = { firmId: 3, from: '2026-10-01', to: '2026-10-31', role: 'consignee' };
  assert.deepEqual(asStatementQuery(q), q);
  assert.equal(asStatementQuery({ ...q, role: undefined })?.role, 'both');
  for (const bad of [null, {}, { ...q, firmId: 0 }, { ...q, firmId: 1.5 }, { ...q, firmId: '3' }, { ...q, role: 'agent' }, { ...q, from: 'x' }, { ...q, to: '2026-09-01' }]) {
    assert.equal(asStatementQuery(bad), null, JSON.stringify(bad));
  }
});

test('the firm list filters fall back instead of failing', () => {
  const none = { text: '', stationId: null, showInactive: false, period: null };
  assert.deepEqual(asAccountFilters(undefined), none);
  assert.deepEqual(asAccountFilters({ text: '  Kale  ', stationId: 4, showInactive: true, period: { from: '2026-10-01', to: '2026-10-31' } }), {
    text: 'Kale', stationId: 4, showInactive: true, period: { from: '2026-10-01', to: '2026-10-31' },
  });
  assert.deepEqual(asAccountFilters({ text: 5, stationId: 0, showInactive: 'yes', period: { from: '2026-10-31', to: '2026-10-01' } }), none);
  assert.equal(asAccountFilters({ text: 'x'.repeat(500) }).text.length, 100);
});

test('cursors need their parts', () => {
  assert.deepEqual(asAccountCursor({ key: 'kale brothers' }), { key: 'kale brothers' });
  for (const bad of [null, {}, { key: '' }, { key: 5 }]) assert.equal(asAccountCursor(bad), null, JSON.stringify(bad));
  assert.deepEqual(asStatementCursor({ date: '2026-10-24', no: 7 }), { date: '2026-10-24', no: 7 });
  for (const bad of [null, {}, { date: '24-10-2026', no: 7 }, { date: '2026-10-24', no: 0 }, { date: '2026-10-24' }]) assert.equal(asStatementCursor(bad), null, JSON.stringify(bad));
});

test('asYear is a plain four-digit year', () => {
  assert.equal(asYear(2026), 2026);
  for (const bad of [null, '2026', 26, 2026.5, 1999, 10000]) assert.equal(asYear(bad), null, String(bad));
});
