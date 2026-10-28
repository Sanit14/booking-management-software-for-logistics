import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextIndex, type FieldInfo } from './nextField';

const ok: FieldInfo = { disabled: false, readOnly: false, hidden: false, tabIndex: 0 };
const f = (over: Partial<FieldInfo> = {}): FieldInfo => ({ ...ok, ...over });

test('moves to the next field', () => {
  assert.equal(nextIndex([f(), f(), f()], 0), 1);
  assert.equal(nextIndex([f(), f(), f()], 1), 2);
});

test('skips disabled, read-only, hidden and tabindex=-1 fields', () => {
  const fields = [f(), f({ disabled: true }), f({ readOnly: true }), f({ hidden: true }), f({ tabIndex: -1 }), f()];
  assert.equal(nextIndex(fields, 0), 5);
});

test('a field marked skipEnter is walked past (it stays reachable by Tab, which this logic does not touch)', () => {
  assert.equal(nextIndex([f(), f({ skipEnter: true }), f()], 0), 2);
  assert.equal(nextIndex([f({ skipEnter: true }), f()], -1), 1);
});

test('after the last usable field there is no next: the form submits', () => {
  assert.equal(nextIndex([f(), f()], 1), null);
  assert.equal(nextIndex([f(), f({ disabled: true })], 0), null);
});

test('an empty list gives null; -1 (focus not on a listed field) gives the first usable one', () => {
  assert.equal(nextIndex([], 0), null);
  assert.equal(nextIndex([f()], -1), 0);
});
