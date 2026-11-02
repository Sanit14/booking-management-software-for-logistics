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
