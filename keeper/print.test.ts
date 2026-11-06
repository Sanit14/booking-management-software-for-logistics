import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asPrintDone } from './print';

test('asPrintDone: a memo or an LR, a whole id and print or pdf; anything else is null', () => {
  assert.deepEqual(asPrintDone({ kind: 'memo', id: 3, how: 'print' }), { kind: 'memo', id: 3, how: 'print' });
  assert.deepEqual(asPrintDone({ kind: 'lr', id: 12, how: 'pdf', extra: 'ignored' }), { kind: 'lr', id: 12, how: 'pdf' });
  for (const bad of [null, undefined, 5, 'memo', {}, { kind: 'memo', id: 3 }, { kind: 'memo', id: 1.5, how: 'pdf' }, { kind: 'memo', id: '3', how: 'pdf' }, { kind: 'firm', id: 3, how: 'pdf' }, { kind: 'lr', id: 3, how: 'email' }]) {
    assert.equal(asPrintDone(bad), null, JSON.stringify(bad));
  }
});

test('asPrintDone: a report names which report, its period and its filters (it has no id of its own); anything wrong is null', () => {
  const filters = { toStationId: 3, text: 'kale', truckId: null, agentId: null };
  const report = { kind: 'report', id: 0, how: 'pdf', report: 'dateWise', from: '2026-10-01', to: '2026-10-31', filters };
  assert.deepEqual(asPrintDone({ ...report, extra: 'ignored' }), report);
  // no filters = none set; a wrong filter value is "not set", as in a report request
  assert.deepEqual(asPrintDone({ ...report, filters: undefined }), { ...report, filters: { toStationId: null, text: '', truckId: null, agentId: null } });
  assert.deepEqual(asPrintDone({ ...report, filters: { toStationId: 'x', text: 5 } })?.filters, { toStationId: null, text: '', truckId: null, agentId: null });
  for (const bad of [{ ...report, report: 'partyWise' }, { ...report, report: undefined }, { ...report, from: undefined }, { ...report, to: '2026-09-01' }, { ...report, how: 'email' }, { ...report, id: 'x' }]) {
    assert.equal(asPrintDone(bad), null, JSON.stringify(bad));
  }
});

test('asPrintDone: a firm statement also names its period and role; without them, or with a wrong one, it is null', () => {
  const firm = { kind: 'firm', id: 3, how: 'pdf', from: '2026-10-01', to: '2026-10-31', role: 'consignee' };
  assert.deepEqual(asPrintDone({ ...firm, extra: 'ignored' }), firm);
  for (const bad of [{ ...firm, from: undefined }, { ...firm, to: '2026-09-01' }, { ...firm, from: '01-10-2026' }, { ...firm, role: 'agent' }, { ...firm, role: undefined }, { ...firm, id: 0.5 }]) {
    assert.equal(asPrintDone(bad), null, JSON.stringify(bad));
  }
  // a memo or an LR never carries a period
  assert.deepEqual(asPrintDone({ kind: 'lr', id: 12, how: 'pdf', from: '2026-10-01', to: '2026-10-31', role: 'both' }), { kind: 'lr', id: 12, how: 'pdf' });
});
