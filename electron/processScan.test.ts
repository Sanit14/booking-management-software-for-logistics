import { test } from 'node:test';
import assert from 'node:assert/strict';
import { otherInstanceRoots, parseProcessLines, type ProcessRow } from './processScan';

const row = (pid: number, parent: number, session: number): ProcessRow => ({ pid, parent, session });

// This seat: main 100 with GPU 101 and renderer 102, in session 2. The keeper, 900, is a loose process.
const own = [row(100, 1, 2), row(101, 100, 2), row(102, 100, 2)];

test('only this seat and the keeper: nobody else', () => {
  assert.deepEqual(otherInstanceRoots([...own, row(900, 5, 1)], 100, 900), []);
});

test('another seat is found once, with its session, however many processes it has', () => {
  const other = [row(200, 1, 3), row(201, 200, 3), row(202, 200, 3), row(203, 200, 3)];
  assert.deepEqual(otherInstanceRoots([...own, ...other, row(900, 5, 1)], 100, 900), [{ pid: 200, session: 3 }]);
});

test('two other seats are two entries', () => {
  const rows = [...own, row(200, 1, 3), row(201, 200, 3), row(300, 1, 4), row(900, 5, 1)];
  assert.deepEqual(otherInstanceRoots(rows, 100, 900).map((o) => o.session).sort(), [3, 4]);
});

test('a keeper that another seat started does not hide that seat', () => {
  // the keeper's parent (200) is still alive, so the keeper hangs under seat 200 in the process tree
  const rows = [...own, row(200, 1, 3), row(201, 200, 3), row(900, 200, 3)];
  assert.deepEqual(otherInstanceRoots(rows, 100, 900), [{ pid: 200, session: 3 }]);
});

test('a keeper that this seat started is not "another copy"', () => {
  assert.deepEqual(otherInstanceRoots([...own, row(900, 100, 2)], 100, 900), []);
});

test('a loop in the parent links does not hang', () => {
  assert.ok(otherInstanceRoots([row(200, 201, 3), row(201, 200, 3), ...own], 100, 900).length >= 1);
});

test('parseProcessLines reads "pid,parent,session" lines', () => {
  assert.deepEqual(parseProcessLines('100,1,2\r\n\r\n 101,100,2 \n'), [row(100, 1, 2), row(101, 100, 2)]);
  assert.deepEqual(parseProcessLines(''), []);
});

test('a line that is not three numbers means the list could not be read: the update must not go ahead', () => {
  assert.throws(() => parseProcessLines('100,1,2\nWARNING: something'), /could not read the process list/);
});
