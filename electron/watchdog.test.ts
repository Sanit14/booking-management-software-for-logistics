import assert from 'node:assert/strict';
import test from 'node:test';
import { APP_ID, type KeeperHealth } from '../shared';
import type { Probe } from '../keeper/client';
import { keeperAction, makeStartGuard } from './watchdog';

const up = (state: KeeperHealth['state'], keeperVersion: number): Probe => ({
  kind: 'up',
  health: { app: APP_ID, state, keeperVersion, pid: 1, dataRoot: 'C:\\x', dbPath: 'C:\\x\\booking.db', backupDir: 'D:\\b', startedAt: '2026-01-01T00:00:00Z' },
});

test('a ready keeper of the current version is ok', () => {
  assert.equal(keeperAction(up('ready', 5), 5), 'ok');
});

test('a safe-mode keeper is alive: ok', () => {
  assert.equal(keeperAction(up('safe-mode', 5), 5), 'ok');
});

test('a newer keeper is left alone', () => {
  assert.equal(keeperAction(up('ready', 6), 5), 'ok');
});

test('a keeper that is still starting is waited for', () => {
  assert.equal(keeperAction(up('starting', 5), 5), 'wait');
});

test('an older keeper is replaced, whatever its state', () => {
  assert.equal(keeperAction(up('ready', 4), 5), 'replace');
  assert.equal(keeperAction(up('starting', 4), 5), 'replace');
});

test('nothing listening: start one', () => {
  assert.equal(keeperAction({ kind: 'down', refused: true }, 5), 'start');
});

test('a listener that did not answer in time is waited for, not replaced', () => {
  assert.equal(keeperAction({ kind: 'down', refused: false }, 5), 'wait');
});

test('another program on the port is the wrong app', () => {
  assert.equal(keeperAction({ kind: 'foreign' }, 5), 'wrong-app');
});

const MIN = 60_000;

test('three failed starts within ten minutes stop the restarts, and they stay stopped until a keeper is seen working (O4)', () => {
  let t = 0;
  const guard = makeStartGuard(() => t);
  assert.equal(guard.gaveUp(), false);
  guard.failed();
  t += 3 * MIN;
  guard.failed();
  assert.equal(guard.gaveUp(), false, 'two are not enough');
  t += 3 * MIN;
  guard.failed();
  assert.equal(guard.gaveUp(), true);
  t += 60 * MIN; // an hour later it is still given up: it does not start trying again by itself (one backup of the book every try)
  assert.equal(guard.gaveUp(), true);
  guard.ok();
  assert.equal(guard.gaveUp(), false, 'a keeper that works clears it');
});

test('failed starts spread over more than ten minutes never add up, and a start that worked clears the count', () => {
  let t = 0;
  const guard = makeStartGuard(() => t);
  for (let i = 0; i < 6; i++) {
    guard.failed();
    t += 6 * MIN;
    assert.equal(guard.gaveUp(), false);
  }
  guard.failed();
  guard.failed();
  guard.ok(); // two within the window, then one that worked
  t += MIN;
  guard.failed();
  assert.equal(guard.gaveUp(), false, 'the count started again');
});
