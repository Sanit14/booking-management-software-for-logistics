import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strings } from '../strings';

test('a file problem reaches the clerk as plain words; an unknown code, or none, gives the plain message with no raw text (O9)', () => {
  assert.equal(strings.result('failed', 'ENOSPC'), 'It did not work: The disk is full.');
  assert.equal(strings.result('backup-dir-unusable', 'EACCES'), 'A backup could not be written to that folder: Windows did not allow access to a file or folder.');
  for (const code of ['EPERM', 'ENOENT', 'EBUSY']) assert.match(strings.result('failed', code), /^It did not work: .+\.$/);
  assert.equal(strings.result('failed', 'EWEIRD'), 'It did not work');
  assert.equal(strings.result('failed'), 'It did not work');
  assert.equal(strings.result('keeper-unreachable', 'ECONNREFUSED'), 'The database service did not answer');
});

test('a detail that is not an OS code is shown as before: names, numbers and the sentences from strings.ts', () => {
  assert.equal(strings.result('restore-others-online', 'PC02'), 'Another seat has Booking Manager open. Close it there first: PC02');
  assert.equal(strings.result('seat-name-taken', 'ENTRY2'), 'Another seat already has that name: ENTRY2', 'a seat called ENTRY2 is a name, not an OS code');
  assert.equal(strings.result('lr-wasuli-collected', '12'), 'Wasuli already collected for LR 12 — undo the collection first.');
  assert.equal(strings.result('pin-locked', '40'), 'Too many wrong tries. Try again in 40 seconds.');
});
