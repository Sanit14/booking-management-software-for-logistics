// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { listBackups, makeBackup, migrateSafely, pruneBackups, readSummary } from './backup';
import { backupName } from './backupNames';
import { currentVersion, MIGRATIONS, type Migration } from './migrations';
import { nextNumber } from './numbering';
import { freshDb, insert, insertLr, insertStation, tempDir } from './testing';
import { nameKey } from './names';
import { openDatabase } from './db';

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);
const tick = () => new Promise<void>((r) => setImmediate(r));

test('a backup taken while inserts keep running is whole, verified and consistent', async () => {
  const db = freshDb();
  db.transaction(() => {
    for (let i = 0; i < 20000; i++) insertStation(db, `Prefill ${i}`);
  })();
  const dir = path.join(tempDir(), 'backups');

  // Each iteration writes a station and a firm that points at it in ONE transaction; a backup that caught a
  // transaction half-way would hold a firm without its station (or one more station than firms).
  let inserted = 0;
  const writer = (async () => {
    for (let i = 0; i < 500; i++) {
      db.transaction(() => {
        const station = insertStation(db, `Loop ${i}`);
        insert(db, 'firms', { name: `Firm ${i}`, name_key: nameKey(`Firm ${i}`), station_id: station, seat: 'test' });
      })();
      inserted++;
      await tick();
    }
  })();
  const made = await makeBackup(db, dir, at(2026, 10, 24, 9, 30));
  await writer;
  assert.equal(inserted, 500);

  assert.equal(path.basename(made.file), 'booking-20261024-0930.db');
  const copy = new Database(made.file, { readonly: true });
  assert.equal(copy.pragma('quick_check', { simple: true }), 'ok');
  const stations = (copy.prepare('SELECT COUNT(*) AS n FROM stations').get() as { n: number }).n - 20000;
  const firms = (copy.prepare('SELECT COUNT(*) AS n FROM firms').get() as { n: number }).n;
  assert.equal(stations, firms, 'a station and its firm are in the backup together or not at all');
  assert.equal((copy.prepare('SELECT COUNT(*) AS n FROM firms WHERE station_id NOT IN (SELECT id FROM stations)').get() as { n: number }).n, 0);
  assert.equal(made.rows, 20000 + stations + firms, 'the row count reported is the count inside the file');
  copy.close();
});

test('only the finished .db is left in the folder: no temp file, no -wal, no -shm', async () => {
  const db = freshDb();
  insertLr(db);
  const dir = path.join(tempDir(), 'backups');
  await makeBackup(db, dir, at(2026, 10, 24, 9, 30));
  assert.deepEqual(fs.readdirSync(dir), ['booking-20261024-0930.db']);
  readSummary(path.join(dir, 'booking-20261024-0930.db')); // reading it must not leave files either
  assert.deepEqual(fs.readdirSync(dir), ['booking-20261024-0930.db']);
});

test('a backup that fails verification is deleted and reported, never kept', async () => {
  const db = freshDb();
  const dir = path.join(tempDir(), 'backups');
  await assert.rejects(
    makeBackup(db, dir, at(2026, 10, 24, 9, 30), () => {
      throw new Error('verify said no');
    }),
    /verify said no/,
  );
  assert.deepEqual(fs.readdirSync(dir), [], 'neither the temp file nor the final name remains');
});

test('an unwritable backup folder rejects with the reason and the database keeps working', async () => {
  const db = freshDb();
  const blocker = path.join(tempDir(), 'not-a-folder');
  fs.writeFileSync(blocker, 'x'); // a file where the folder should be
  await assert.rejects(makeBackup(db, path.join(blocker, 'backups'), at(2026, 10, 24, 9, 30)));
  insertStation(db, 'Still writable');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM stations').get() as { n: number }).n, 1);
});

test('readSummary reports counts, newest LR date and the last numbers per series and year', () => {
  const db = freshDb();
  insertLr(db, { lr_date: '2026-10-20' });
  const memo = insertLr(db, { lr_date: '2026-10-24' });
  assert.ok(memo > 0);
  db.transaction(() => {
    nextNumber(db, 'lr', '2026-10-24');
    nextNumber(db, 'lr', '2026-10-24');
    nextNumber(db, 'challan', '2026-10-24');
    nextNumber(db, 'lr', '2025-12-31');
  })();
  db.pragma('wal_checkpoint(TRUNCATE)');
  const file = db.name;
  const r = readSummary(file);
  assert.ok(r);
  assert.equal(r.schemaVersion, 1);
  assert.equal(r.lrs, 2);
  assert.equal(r.memos, 0);
  assert.equal(r.masters, 4); // each insertLr makes its own two stations
  assert.equal(r.newestLrDate, '2026-10-24');
  assert.deepEqual(r.lastNumbers, [
    { name: 'challan', year: 2026, last: 1 },
    { name: 'lr', year: 2025, last: 1 },
    { name: 'lr', year: 2026, last: 2 },
  ]);
});

test('readSummary is null for garbage and for a file that does not exist', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'junk.db'), Buffer.alloc(5000, 7));
  assert.equal(readSummary(path.join(dir, 'junk.db')), null);
  assert.equal(readSummary(path.join(dir, 'nope.db')), null);
});

test('listBackups is newest first, marks a damaged backup unusable and ignores temp and other files', async () => {
  const db = freshDb();
  insertLr(db);
  const dir = path.join(tempDir(), 'backups');
  await makeBackup(db, dir, at(2026, 10, 24, 8, 0));
  await makeBackup(db, dir, at(2026, 10, 24, 10, 0));
  fs.writeFileSync(path.join(dir, 'booking-20261024-0900.db'), Buffer.alloc(9000, 1)); // garbage with a backup's name
  fs.writeFileSync(path.join(dir, 'booking-20261024-1100.db.tmp'), 'half');
  fs.writeFileSync(path.join(dir, 'booking-before-restore-20261024-100000.db'), 'keep me');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'hi');

  const list = listBackups(dir);
  assert.deepEqual(list.map((b) => b.file), ['booking-20261024-1000.db', 'booking-20261024-0900.db', 'booking-20261024-0800.db']);
  assert.deepEqual(list.map((b) => b.damaged), [false, true, false]);
  assert.equal(list[1].summary, undefined);
  assert.equal(list[0].summary?.lrs, 1);
  assert.equal(list[0].sizeBytes, fs.statSync(path.join(dir, list[0].file)).size);
  assert.equal(list[0].at, at(2026, 10, 24, 10, 0).toISOString());
  assert.deepEqual(listBackups(path.join(dir, 'missing-folder')), [], 'no folder = no backups, not an error');
});

test('pruneBackups deletes what the rule drops, keeps the newest, and never touches other files', async () => {
  const dir = tempDir();
  const now = at(2026, 10, 24, 12, 0);
  for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(dir, backupName(new Date(now.getTime() - i * 3600_000))), 'x');
  fs.writeFileSync(path.join(dir, 'booking-before-restore-20200101-000000.db'), 'keep');
  pruneBackups(dir, now);
  const left = fs.readdirSync(dir);
  assert.ok(left.includes(backupName(now)), 'the newest is kept');
  assert.ok(left.includes('booking-before-restore-20200101-000000.db'));
  // 60 hourly files run 01:00 on the 22nd .. 12:00 on the 24th. Newest 48 stay (13:00 on the 22nd onwards, which
  // already holds the first of the 23rd and of the 24th); the first of the 22nd (01:00) stays as the day's first.
  assert.equal(left.filter((n) => n.startsWith('booking-2')).length, 48 + 1);
});

const v2: Migration = { version: 2, up: (db) => void db.exec('CREATE TABLE later (x TEXT) STRICT') };

test('migrateSafely backs up an existing database before a pending migration runs', async () => {
  const db = freshDb(); // at schema v1
  insertLr(db);
  const dir = path.join(tempDir(), 'backups');
  const r = await migrateSafely(db, dir, at(2026, 10, 24, 9, 30), [...MIGRATIONS, v2]);
  assert.equal(r.version, 2);
  assert.equal(r.backupError, undefined);
  const file = path.join(dir, 'booking-20261024-0930.db');
  assert.equal(readSummary(file)?.schemaVersion, 1, 'the backup is the database as it was BEFORE the migration');
  assert.equal(readSummary(file)?.lrs, 1);
  assert.equal(currentVersion(db), 2);
});

test('migrateSafely makes no backup for a brand-new database or when nothing is pending', async () => {
  const dir = path.join(tempDir(), 'backups');
  const fresh = openDatabase(path.join(tempDir(), 'booking.db'));
  assert.equal((await migrateSafely(fresh, dir, at(2026, 10, 24, 9, 30))).version, 1);
  assert.equal(fs.existsSync(dir), false, 'nothing to lose in an empty new file');
  assert.equal((await migrateSafely(fresh, dir, at(2026, 10, 24, 9, 31))).version, 1);
  assert.equal(fs.existsSync(dir), false, 'already up to date');
});

test('migrateSafely still migrates when the backup cannot be written, and says why', async () => {
  const db = freshDb();
  const blocker = path.join(tempDir(), 'file');
  fs.writeFileSync(blocker, 'x');
  const r = await migrateSafely(db, path.join(blocker, 'b'), at(2026, 10, 24, 9, 30), [...MIGRATIONS, v2]);
  assert.equal(r.version, 2);
  assert.ok(r.backupError, 'the failure is reported, not swallowed');
});
