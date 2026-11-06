import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asLrsRequest, asPartySide, asReportCursor, asReportKind, asReportLrCursor, asReportQuery, REPORT_KINDS } from './reportRules';

const OCT = { from: '2026-10-01', to: '2026-10-31' };
const NONE = { toStationId: null, text: '', truckId: null, agentId: null };

test('asReportQuery: a real period is needed; every filter falls back to "not set"', () => {
  assert.deepEqual(asReportQuery(OCT), { ...OCT, ...NONE });
  assert.deepEqual(asReportQuery({ ...OCT, toStationId: 3, text: ' kale ', truckId: 7, agentId: 2 }), { ...OCT, toStationId: 3, text: 'kale', truckId: 7, agentId: 2 });
  // a wrong type or a non-positive id is "no filter", never a guess
  assert.deepEqual(asReportQuery({ ...OCT, toStationId: '3', text: 5, truckId: 0, agentId: -1 }), { ...OCT, ...NONE });
  assert.deepEqual(asReportQuery({ ...OCT, toStationId: 1.5 }), { ...OCT, ...NONE });
  assert.equal(asReportQuery({ ...OCT, text: 'x'.repeat(300) })?.text.length, 100, 'text is cut at 100 characters');
  for (const bad of [null, undefined, 'x', [], {}, { from: '2026-10-01' }, { from: '2026-10-31', to: '2026-10-01' }, { from: '2026-02-30', to: '2026-03-01' }, { from: 1, to: 2 }]) {
    assert.equal(asReportQuery(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(asReportQuery({ from: '2026-10-05', to: '2026-10-05' }), { from: '2026-10-05', to: '2026-10-05', ...NONE }, 'one day is a period');
});

test('asReportKind and asPartySide accept only the known names', () => {
  assert.deepEqual([...REPORT_KINDS], ['dateWise', 'stationWise', 'consignorWise', 'consigneeWise', 'truckWise', 'firmWise', 'wasuli']);
  for (const k of REPORT_KINDS) assert.equal(asReportKind(k), k);
  for (const bad of ['', 'DateWise', 'partyWise', 5, null, undefined]) assert.equal(asReportKind(bad), null);
  assert.equal(asPartySide('consignor'), 'consignor');
  assert.equal(asPartySide('consignee'), 'consignee');
  for (const bad of ['both', '', null, 1]) assert.equal(asPartySide(bad), null);
});

test('asReportCursor: a key and a whole number from 0', () => {
  assert.deepEqual(asReportCursor({ key: '2026-10-05', no: 0 }), { key: '2026-10-05', no: 0 });
  assert.deepEqual(asReportCursor({ key: 'kale brothers', no: 12 }), { key: 'kale brothers', no: 12 });
  for (const bad of [null, {}, { key: '', no: 0 }, { key: 'a' }, { key: 'a', no: -1 }, { key: 'a', no: 1.5 }, { key: 1, no: 0 }, { key: 'x'.repeat(400), no: 0 }]) {
    assert.equal(asReportCursor(bad), null, JSON.stringify(bad));
  }
  assert.equal(asReportCursor(undefined), null, 'no cursor = the first page');
});

test('asReportLrCursor: a real date and an LR number', () => {
  assert.deepEqual(asReportLrCursor({ date: '2026-10-05', no: 3 }), { date: '2026-10-05', no: 3 });
  for (const bad of [null, {}, { date: '2026-13-01', no: 3 }, { date: '2026-10-05', no: 0 }, { date: '2026-10-05' }, { date: 5, no: 3 }]) assert.equal(asReportLrCursor(bad), null, JSON.stringify(bad));
});

test('asLrsRequest: a station, or a firm / a walk-in name on one side, with the report query', () => {
  const query = { ...OCT, ...NONE };
  assert.deepEqual(asLrsRequest({ of: { kind: 'stationWise', stationId: 4 }, query: OCT }), { of: { kind: 'stationWise', stationId: 4 }, query });
  assert.deepEqual(asLrsRequest({ of: { kind: 'consignorWise', firmId: 9, name: 'ignored' }, query: OCT })?.of, { kind: 'consignorWise', firmId: 9, name: '' }, 'a firm is its id; the name is not used');
  assert.deepEqual(asLrsRequest({ of: { kind: 'consigneeWise', firmId: null, name: 'Road Side Traders' }, query: OCT })?.of, { kind: 'consigneeWise', firmId: null, name: 'Road Side Traders' });
  const padded = asLrsRequest({ of: { kind: 'consigneeWise', firmId: null, name: '  Padded ' }, query: OCT });
  assert.deepEqual(padded?.of, { kind: 'consigneeWise', firmId: null, name: '  Padded ' }, 'a walk-in name is matched exactly as booked, so it is not trimmed');
  for (const bad of [
    null,
    {},
    { of: { kind: 'dateWise' }, query: OCT },
    { of: { kind: 'stationWise', stationId: 0 }, query: OCT },
    { of: { kind: 'stationWise' }, query: OCT },
    { of: { kind: 'consignorWise', firmId: null, name: '' }, query: OCT },
    { of: { kind: 'consignorWise', firmId: 'x', name: 'A' }, query: OCT },
    { of: { kind: 'stationWise', stationId: 4 }, query: { from: 'x', to: 'y' } },
    { of: { kind: 'stationWise', stationId: 4 } },
  ]) {
    assert.equal(asLrsRequest(bad), null, JSON.stringify(bad));
  }
});
