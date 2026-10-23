// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { businessRows, raiseMarker } from './db';
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
