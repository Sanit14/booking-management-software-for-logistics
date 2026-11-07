import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { blankReason, decideOpen, inspectBeforeOpen, markRunning, markerPath, readMarkerClean, readMarkerRows, writeMarker } from './guard';

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
  writeMarker(programDir, root, dbPath, 0);
  assert.deepEqual(inspectBeforeOpen(programDir, root, dbPath), { action: 'open' });

  fs.writeFileSync(dbPath, '');
  assert.equal(inspectBeforeOpen(programDir, root, dbPath).action, 'safe-mode');

  fs.rmSync(dbPath);
  assert.equal(inspectBeforeOpen(programDir, root, dbPath).action, 'safe-mode');
});

test('blankReason: records before, none now = safe mode; otherwise carry on', () => {
  assert.equal(blankReason(5, 0), 'marker-with-no-rows');
  assert.equal(blankReason(5, 1), null);
  assert.equal(blankReason(5, 5), null);
  assert.equal(blankReason(0, 0), null); // a genuinely new database
});

test('the marker keeps the business row count; a 1.2 marker or a damaged one counts as 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-guard-'));
  const root = 'D:\\BM';
  assert.equal(readMarkerRows(dir, root), 0); // no marker
  writeMarker(dir, root, 'D:\\BM\\booking.db', 5);
  assert.equal(readMarkerRows(dir, root), 5);
  fs.writeFileSync(markerPath(dir, root), JSON.stringify({ root, dbPath: 'x', at: 'then' })); // written by 1.2
  assert.equal(readMarkerRows(dir, root), 0);
  fs.writeFileSync(markerPath(dir, root), '{not json');
  assert.equal(readMarkerRows(dir, root), 0);
});

test('the marker says "clean" only after a clean stop: running, no marker, an old marker and a broken one all ask for the full check', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-clean-'));
  const root = 'D:\\BookingManagerData';
  const db = path.join(dir, 'booking.db');
  fs.writeFileSync(db, 'x'.repeat(5000));
  assert.equal(readMarkerClean(dir, root, db), false, 'no marker');
  writeMarker(dir, root, db, 5);
  assert.equal(readMarkerClean(dir, root, db), false, 'written while running');
  writeMarker(dir, root, db, 5, true);
  assert.equal(readMarkerClean(dir, root, db), true, 'written by a clean stop');
  assert.equal(readMarkerRows(dir, root), 5, 'the row count is still there');
  fs.appendFileSync(db, 'y');
  assert.equal(readMarkerClean(dir, root, db), false, 'the file is not the one that was closed (a copy pasted over it, cut, or written to)');
  writeMarker(dir, root, db, 5, true);
  fs.writeFileSync(`${db}-wal`, '');
  assert.equal(readMarkerClean(dir, root, db), false, 'a -wal beside it: something opened it');
  fs.rmSync(`${db}-wal`);
  assert.equal(readMarkerClean(dir, root, db), true);
  markRunning(dir, root, db);
  assert.equal(readMarkerClean(dir, root, db), false, 'about to be opened: running again');
  assert.equal(readMarkerRows(dir, root), 5, 'markRunning keeps the row count');
  writeMarker(dir, root, path.join(dir, 'missing.db'), 5, true);
  assert.equal(readMarkerClean(dir, root, db), false, 'a clean stop with no file to vouch for is not clean');
  fs.writeFileSync(markerPath(dir, root), JSON.stringify({ businessRows: 5 }));
  assert.equal(readMarkerClean(dir, root, db), false, 'a marker from before the flag');
  fs.writeFileSync(markerPath(dir, root), 'not json');
  assert.equal(readMarkerClean(dir, root, db), false);
  markRunning(dir, root, db);
  assert.equal(readMarkerRows(dir, root), 0);
  assert.equal(JSON.parse(fs.readFileSync(markerPath(dir, root), 'utf8')).clean, false, 'an unreadable marker is rewritten as a valid running one');
  fs.rmSync(dir, { recursive: true, force: true });
});
