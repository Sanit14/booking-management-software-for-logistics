import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decideOpen, inspectBeforeOpen, markerPath, writeMarker } from './guard';

test('no marker + no file: create', () => {
  assert.deepEqual(decideOpen(false, null), { action: 'create' });
});

test('marker + file: open', () => {
  assert.deepEqual(decideOpen(true, 8192), { action: 'open' });
});

test('marker + missing file: safe mode', () => {
  assert.deepEqual(decideOpen(true, null), { action: 'safe-mode', reason: 'marker-without-database' });
});

test('marker + 0-byte file: safe mode', () => {
  assert.deepEqual(decideOpen(true, 0), { action: 'safe-mode', reason: 'marker-with-empty-database' });
});

test('no marker + existing file: open (a database from before the marker existed)', () => {
  assert.deepEqual(decideOpen(false, 4096), { action: 'open' });
});

test('marker file name is per data root and case-insensitive', () => {
  const a = markerPath('C:\\ProgramData\\BookingManager', 'C:\\BookingManagerData');
  const b = markerPath('C:\\ProgramData\\BookingManager', 'c:\\bookingmanagerdata');
  const c = markerPath('C:\\ProgramData\\BookingManager', 'D:\\Other');
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('inspectBeforeOpen reads the real marker and file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-guard-'));
  const programDir = path.join(dir, 'pd');
  const root = path.join(dir, 'data');
  const dbPath = path.join(root, 'booking.db');
  assert.deepEqual(inspectBeforeOpen(programDir, root, dbPath), { action: 'create' });

  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(dbPath, 'x'.repeat(100));
  writeMarker(programDir, root, dbPath);
  assert.deepEqual(inspectBeforeOpen(programDir, root, dbPath), { action: 'open' });

  fs.writeFileSync(dbPath, '');
  assert.equal(inspectBeforeOpen(programDir, root, dbPath).action, 'safe-mode');

  fs.rmSync(dbPath);
  assert.equal(inspectBeforeOpen(programDir, root, dbPath).action, 'safe-mode');
});
