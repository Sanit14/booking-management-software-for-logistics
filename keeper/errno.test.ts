import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errnoOf } from './errno';

test('the OS code is taken from an error, or from the start of its message; anything else has none', () => {
  assert.equal(errnoOf(Object.assign(new Error('x'), { code: 'EBUSY' })), 'EBUSY');
  assert.equal(errnoOf("EACCES: permission denied, open 'D:/BookingManagerBackups/x.db'"), 'EACCES');
  assert.equal(errnoOf(new Error("ENOSPC: no space left on device, write")), 'ENOSPC');
  assert.equal(errnoOf('connect ECONNREFUSED 127.0.0.1:47715'), undefined, 'a code in the middle is not the error');
  assert.equal(errnoOf('database or disk is full'), undefined);
  assert.equal(errnoOf(new Error('Error: it broke')), undefined, 'the word Error is not a code');
  assert.equal(errnoOf(undefined), undefined);
  assert.equal(errnoOf(Object.assign(new Error('x'), { code: 'ERR_INVALID_ARG_TYPE' })), undefined);
});
