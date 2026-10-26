// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { businessRows, openChecked, openDatabase, raiseMarker } from './db';
import { markerPath, readMarkerRows } from './guard';
import { freshDb, insertLr, insertStation, tempDir } from './testing';

test('businessRows counts LRs, memos and masters, and counts an old schema as 0', () => {
  const db = freshDb();
  assert.equal(businessRows(db), 0);
  insertStation(db, 'Pune');
  insertLr(db); // also creates two stations
  assert.equal(businessRows(db), 4);
  db.exec('CREATE TABLE schema_version_copy (x)'); // an unrelated table changes nothing
  assert.equal(businessRows(db), 4);
});

test('raiseMarker raises the baseline when records appear, never lowers it, and skips needless writes', () => {
  const db = freshDb();
  const programDir = path.join(tempDir(), 'pd');
  const root = 'D:\\BM';
  const dbPath = 'D:\\BM\\booking.db';

  assert.equal(raiseMarker(db, programDir, root, dbPath, 0), 0); // nothing yet: no marker is written
  assert.equal(readMarkerRows(programDir, root), 0);

  insertStation(db, 'Pune');
  insertStation(db, 'Nagpur');
  assert.equal(raiseMarker(db, programDir, root, dbPath, 0), 2);
  assert.equal(readMarkerRows(programDir, root), 2);

  db.exec('DELETE FROM stations'); // rows vanish: the baseline stays, so a wipe is still noticed at the next start
  assert.equal(raiseMarker(db, programDir, root, dbPath, 2), 2);
  assert.equal(readMarkerRows(programDir, root), 2);
  assert.ok(markerPath(programDir, root).endsWith('.json'));
});

test('openChecked opens a healthy file and calls garbage bytes damaged, without throwing', () => {
  const dir = tempDir();
  const good = path.join(dir, 'good.db');
  openDatabase(good).close();
  const ok = openChecked(good);
  assert.ok('db' in ok);
  if ('db' in ok) ok.db.close();

  for (const [name, bytes] of [['few.db', Buffer.from('xyz')], ['many.db', Buffer.alloc(8192, 0xa7)]] as const) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, bytes);
    const r = openChecked(file);
    assert.ok('damaged' in r, name);
    assert.ok(fs.readFileSync(file).equals(bytes), 'a damaged file is left exactly as it was');
  }
});

test('openChecked calls a database with a broken page damaged', () => {
  const dir = tempDir();
  const file = path.join(dir, 'b.db');
  const db = openDatabase(file);
  db.exec('CREATE TABLE t (x TEXT); CREATE INDEX t_x ON t (x)');
  for (let i = 0; i < 2000; i++) db.prepare('INSERT INTO t VALUES (?)').run(`row ${i}`);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  // Overwrite a middle page with junk: the header is fine, the content is not.
  const bytes = fs.readFileSync(file);
  bytes.fill(0xff, 4096 * 3, 4096 * 4);
  fs.writeFileSync(file, bytes);
  assert.ok('damaged' in openChecked(file));
});
