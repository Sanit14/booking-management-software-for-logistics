import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backupFootText, backupStatusLine } from './backupLine';

const NOW = new Date(2026, 10, 13, 16, 30); // 13 November 2026, local time
const at = (d: Date) => d.toISOString();

test('Settings: "Backed up today 14:00 · 11.1 MB" for a backup made today, with its date for an older one', () => {
  const today = backupStatusLine({ lastAt: at(new Date(2026, 10, 13, 14, 0)), lastBytes: 11.1 * 1048576 }, NOW);
  assert.deepEqual(today, { text: 'Backed up today 14:00 · 11.1 MB', bad: false });
  const old = backupStatusLine({ lastAt: at(new Date(2026, 10, 12, 9, 5)), lastBytes: 450 * 1048576 }, NOW);
  assert.deepEqual(old, { text: 'Backed up 12-11-2026 09:05 · 450.0 MB', bad: false });
});

test('Settings: a backup of a few bytes still says 0.1 MB, and one with no size leaves the size out', () => {
  assert.equal(backupStatusLine({ lastAt: at(new Date(2026, 10, 13, 8, 0)), lastBytes: 2000 }, NOW).text, 'Backed up today 08:00 · 0.1 MB');
  assert.equal(backupStatusLine({ lastAt: at(new Date(2026, 10, 13, 8, 0)) }, NOW).text, 'Backed up today 08:00');
});

test('failing backups are red in both places and say why; none yet is not red', () => {
  assert.deepEqual(backupStatusLine({ failing: 'D: is not ready', lastAt: at(NOW) }, NOW), { text: 'Backups failing: D: is not ready', bad: true });
  assert.deepEqual(backupFootText({ failing: 'D: is not ready' }), { text: 'Backups failing: D: is not ready', bad: true });
  assert.deepEqual(backupStatusLine(undefined, NOW), { text: 'No backup yet', bad: false });
  assert.deepEqual(backupFootText({}), { text: 'no backup yet', bad: false });
});

test('the sidebar foot says the time only', () => {
  assert.deepEqual(backupFootText({ lastAt: at(new Date(2026, 10, 13, 14, 0)), lastBytes: 99 }), { text: 'backed up 14:00', bad: false });
});
