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

test('asPrintDone: a firm statement also names its period and role; without them, or with a wrong one, it is null', () => {
  const firm = { kind: 'firm', id: 3, how: 'pdf', from: '2026-10-01', to: '2026-10-31', role: 'consignee' };
  assert.deepEqual(asPrintDone({ ...firm, extra: 'ignored' }), firm);
  for (const bad of [{ ...firm, from: undefined }, { ...firm, to: '2026-09-01' }, { ...firm, from: '01-10-2026' }, { ...firm, role: 'agent' }, { ...firm, role: undefined }, { ...firm, id: 0.5 }]) {
    assert.equal(asPrintDone(bad), null, JSON.stringify(bad));
  }
  // a memo or an LR never carries a period
  assert.deepEqual(asPrintDone({ kind: 'lr', id: 12, how: 'pdf', from: '2026-10-01', to: '2026-10-31', role: 'both' }), { kind: 'lr', id: 12, how: 'pdf' });
});
