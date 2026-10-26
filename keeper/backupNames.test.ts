import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupName, beforeRestoreName, parseBackupName, pickToPrune } from './backupNames';

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);

test('backupName is booking-YYYYMMDD-HHmm.db in local time and parses back', () => {
  const d = at(2026, 3, 5, 9, 7);
  assert.equal(backupName(d), 'booking-20260305-0907.db');
  assert.equal(parseBackupName('booking-20260305-0907.db')?.getTime(), d.getTime());
});

test('parseBackupName refuses anything that is not a backup name', () => {
  for (const n of ['booking.db', 'booking-20260305-0907.db.tmp', 'booking-before-restore-20260305-090700.db', 'booking-20261305-0907.db', 'booking-20260305-2507.db', 'x-20260305-0907.db']) {
    assert.equal(parseBackupName(n), null, n);
  }
});

const hourly = (from: Date, count: number): string[] =>
  Array.from({ length: count }, (_, i) => backupName(new Date(from.getTime() + i * 3600_000)));

test('pruning keeps the newest 48 and the first backup of each of the last 30 days', () => {
  const now = at(2026, 10, 24, 12, 0);
  // 40 days of hourly backups up to now.
  const names = hourly(new Date(now.getTime() - 40 * 24 * 3600_000), 40 * 24 + 1);
  const drop = new Set(pickToPrune(names, now));
  const kept = names.filter((n) => !drop.has(n));

  const newest48 = names.slice(-48);
  for (const n of newest48) assert.ok(kept.includes(n), `newest kept: ${n}`);
  assert.ok(kept.includes(names[names.length - 1]), 'the newest is always kept');

  // The first backup of an older day (00:00 each day) is kept; its 01:00 sibling is not.
  assert.ok(kept.includes('booking-20261010-0000.db'));
  assert.ok(!kept.includes('booking-20261010-0100.db'));
  // Older than 30 days: gone, even the first of its day.
  assert.ok(!kept.includes('booking-20260901-0000.db'));
  // 48 newest + the 00:00 of each day 25 Sep..24 Oct (30 days), two of which (23 and 24 Oct) are already among the newest.
  assert.equal(kept.length, 48 + 30 - 2);
});

test('pruning never lists the newest, ignores other files, and has nothing to do for few backups', () => {
  const now = at(2026, 10, 24, 12, 0);
  const few = hourly(at(2026, 10, 24, 0, 0), 5);
  assert.deepEqual(pickToPrune(few, now), []);
  const mixed = [...few, 'booking-before-restore-20260101-000000.db', 'notes.txt', 'booking-20260101-0000.db.tmp'];
  assert.deepEqual(pickToPrune(mixed, now), [], 'unrelated files are never touched');
  const lone = ['booking-20250101-0000.db'];
  assert.deepEqual(pickToPrune(lone, now), [], 'the only backup is the newest and stays, however old');
});

test('the before-restore copy has a name pruning and listing never mistake for a backup', () => {
  const name = beforeRestoreName(new Date(2026, 9, 24, 9, 7, 5));
  assert.equal(name, 'booking-before-restore-20261024-090705.db');
  assert.equal(parseBackupName(name), null);
  assert.deepEqual(pickToPrune([name], new Date(2030, 0, 1)), []);
});
