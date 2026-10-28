import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCK_MS, MAX_TRIES, makeLockout } from './lockout';

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test('five wrong tries lock that kind for 60 seconds, then it opens again', () => {
  const c = clock();
  const lock = makeLockout(c.now);
  for (let i = 0; i < MAX_TRIES - 1; i++) {
    lock.fail('admin');
    assert.equal(lock.lockedFor('admin'), 0, `still open after ${i + 1} wrong`);
  }
  lock.fail('admin');
  assert.equal(lock.lockedFor('admin'), 60);
  c.advance(LOCK_MS - 1000);
  assert.equal(lock.lockedFor('admin'), 1);
  c.advance(1000);
  assert.equal(lock.lockedFor('admin'), 0);
  // the count starts again: one wrong try does not lock
  lock.fail('admin');
  assert.equal(lock.lockedFor('admin'), 0);
});

test('a correct PIN clears the count', () => {
  const lock = makeLockout(clock().now);
  for (let i = 0; i < MAX_TRIES - 1; i++) lock.fail('system');
  lock.ok('system');
  lock.fail('system');
  assert.equal(lock.lockedFor('system'), 0);
});

test('the kinds are locked separately', () => {
  const lock = makeLockout(clock().now);
  for (let i = 0; i < MAX_TRIES; i++) lock.fail('admin');
  assert.equal(lock.lockedFor('admin'), 60);
  assert.equal(lock.lockedFor('system'), 0);
  assert.equal(lock.lockedFor('recovery'), 0);
});
