// Runs under Electron's Node via scripts/test-db.cjs (needs the rebuilt better-sqlite3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeBackup, pruneBackups, readSummary } from './backup';
import { backupName } from './backupNames';
import { closeDatabase, openChecked } from './db';
import { currentVersion, MIGRATIONS, migrate, type Migration } from './migrations';
import { makeTokens, previewRestore, restoreFiles, verifyApply } from './restore';
import { freshDb, insertLr, insertStation, tempDir } from './testing';

const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s);
const LATEST = MIGRATIONS[MIGRATIONS.length - 1].version;

// A live database with one LR, backed up; then a second LR is added, so live and backup differ.
async function scene() {
  const db = freshDb();
  insertLr(db);
  const dbPath = db.name;
  const backupDir = path.join(tempDir(), 'backups');
  const made = await makeBackup(db, backupDir, at(2026, 10, 24, 9, 0));
  insertLr(db);
  closeDatabase(db);
  return { dbPath, backupDir, file: path.basename(made.file), tokens: makeTokens() };
}

test('preview shows the backup next to the live database, counts matching the files', async () => {
  const s = await scene();
  const r = previewRestore(s.dbPath, s.backupDir, s.file, s.tokens, LATEST);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.value.backup, readSummary(path.join(s.backupDir, s.file)));
  assert.deepEqual(r.value.live, readSummary(s.dbPath));
  assert.equal(r.value.backup.lrs, 1);
  assert.equal((r.value.live as { lrs: number }).lrs, 2);
  assert.ok(r.value.token.length >= 16);
});

test('preview of a live database that is missing or damaged says so', async () => {
  const s = await scene();
  fs.writeFileSync(s.dbPath, Buffer.alloc(5000, 9));
  const damaged = previewRestore(s.dbPath, s.backupDir, s.file, s.tokens, LATEST);
  assert.ok(damaged.ok && damaged.value.live === 'damaged');
  fs.rmSync(s.dbPath);
  const missing = previewRestore(s.dbPath, s.backupDir, s.file, s.tokens, LATEST);
  assert.ok(missing.ok && missing.value.live === 'missing');
});

test('apply swaps the file, keeps the old one as booking-before-restore-*, and the result reopens and migrates', async () => {
  const s = await scene();
  const p = previewRestore(s.dbPath, s.backupDir, s.file, s.tokens, LATEST);
  assert.ok(p.ok);
  if (!p.ok) return;
  assert.deepEqual(verifyApply(s.dbPath, s.backupDir, s.file, p.value.token, s.tokens, LATEST), { ok: true });

  const saved = restoreFiles(s.dbPath, s.backupDir, s.file, at(2026, 10, 24, 11, 5, 9));
  assert.equal(path.basename(saved ?? ''), 'booking-before-restore-20261024-110509.db');
  assert.equal(readSummary(saved ?? '')?.lrs, 2, 'the set-aside copy is the live database as it was');
  assert.equal(readSummary(s.dbPath)?.lrs, 1, 'the live file is now the backup');
  assert.equal(fs.existsSync(`${s.dbPath}.restoring`), false, 'no temp file left');

  const v2: Migration = { version: 2, up: (db) => void db.exec('CREATE TABLE later (x TEXT) STRICT') };
  const opened = openChecked(s.dbPath);
  assert.ok('db' in opened);
  if ('db' in opened) {
    assert.equal(opened.db.pragma('journal_mode', { simple: true }), 'wal', 'back in WAL mode once the keeper opens it');
    assert.equal(migrate(opened.db, [...MIGRATIONS, v2]), 2);
    assert.equal(currentVersion(opened.db), 2);
    opened.db.close();
  }

  // Pruning, even years later, leaves the set-aside copy alone.
  pruneBackups(s.backupDir, at(2031, 1, 1));
  assert.ok(fs.existsSync(saved ?? ''));
  assert.ok(fs.existsSync(path.join(s.backupDir, s.file)), 'the newest backup stays too');
});

test('restoring over a damaged live file sets aside its -wal as well and removes stale -wal/-shm', async () => {
  const s = await scene();
  fs.writeFileSync(s.dbPath, Buffer.alloc(5000, 9));
  fs.writeFileSync(`${s.dbPath}-wal`, 'stale wal');
  fs.writeFileSync(`${s.dbPath}-shm`, 'stale shm');
  const saved = restoreFiles(s.dbPath, s.backupDir, s.file, at(2026, 10, 24, 11, 5, 9)) as string;
  assert.equal(fs.readFileSync(`${saved}-wal`, 'utf8'), 'stale wal');
  assert.equal(fs.existsSync(`${s.dbPath}-wal`), false);
  assert.equal(fs.existsSync(`${s.dbPath}-shm`), false);
  assert.equal(readSummary(s.dbPath)?.lrs, 1);
});

test('restoring when there is no live file just puts the backup in place (creating the folder)', async () => {
  const s = await scene();
  const dbPath = path.join(tempDir(), 'new-root', 'booking.db');
  assert.equal(restoreFiles(dbPath, s.backupDir, s.file, at(2026, 10, 24, 11, 5, 9)), undefined);
  assert.equal(readSummary(dbPath)?.lrs, 1);
  assert.deepEqual(fs.readdirSync(s.backupDir).filter((n) => n.includes('before-restore')), []);
});

test('refused: an empty backup over a live database with records, but not over a damaged or missing one', async () => {
  const live = freshDb();
  insertStation(live, 'Pune');
  closeDatabase(live);
  const emptyDb = freshDb();
  const backupDir = path.join(tempDir(), 'backups');
  const made = await makeBackup(emptyDb, backupDir, at(2026, 10, 24, 9, 0));
  const file = path.basename(made.file);
  const tokens = makeTokens();

  const over = previewRestore(live.name, backupDir, file, tokens, LATEST);
  assert.deepEqual(over, { ok: false, code: 'backup-empty' });

  fs.writeFileSync(live.name, Buffer.alloc(5000, 9));
  assert.ok(previewRestore(live.name, backupDir, file, tokens, LATEST).ok);
  fs.rmSync(live.name);
  assert.ok(previewRestore(live.name, backupDir, file, tokens, LATEST).ok);
});

test('refused: a backup with a newer schema than this keeper, a damaged backup, a missing or oddly named one', async () => {
  const s = await scene();
  const newer = freshDb();
  insertLr(newer);
  newer.exec('INSERT INTO schema_version (version) VALUES (99)');
  const nm = await makeBackup(newer, s.backupDir, at(2026, 10, 24, 10, 0));
  assert.deepEqual(previewRestore(s.dbPath, s.backupDir, path.basename(nm.file), s.tokens, LATEST), { ok: false, code: 'backup-newer-schema' });

  fs.writeFileSync(path.join(s.backupDir, backupName(at(2026, 10, 24, 11, 0))), Buffer.alloc(9000, 3));
  assert.deepEqual(previewRestore(s.dbPath, s.backupDir, backupName(at(2026, 10, 24, 11, 0)), s.tokens, LATEST), { ok: false, code: 'backup-damaged' });

  assert.deepEqual(previewRestore(s.dbPath, s.backupDir, backupName(at(2026, 10, 24, 12, 0)), s.tokens, LATEST), { ok: false, code: 'backup-missing' });
  for (const odd of ['..\\booking.db', '../x/booking-20261024-0900.db', s.dbPath, 'booking.db']) {
    assert.deepEqual(previewRestore(s.dbPath, s.backupDir, odd, s.tokens, LATEST), { ok: false, code: 'backup-missing' }, odd);
  }
});

test('refused: apply without the preview, with a wrong, reused or another file’s token, or after the backup changed', async () => {
  const s = await scene();
  const second = freshDb();
  insertLr(second);
  const other = path.basename((await makeBackup(second, s.backupDir, at(2026, 10, 24, 10, 0))).file);
  const bad = { ok: false, code: 'bad-token' };

  assert.deepEqual(verifyApply(s.dbPath, s.backupDir, s.file, 'never-issued', s.tokens, LATEST), bad);

  const p = previewRestore(s.dbPath, s.backupDir, s.file, s.tokens, LATEST);
  assert.ok(p.ok);
  if (!p.ok) return;
  assert.deepEqual(verifyApply(s.dbPath, s.backupDir, s.file, 'wrong', s.tokens, LATEST), bad);
  assert.deepEqual(verifyApply(s.dbPath, s.backupDir, other, p.value.token, s.tokens, LATEST), bad, 'a token is for the file it was issued for');

  // A newer preview replaces the older token.
  const p2 = previewRestore(s.dbPath, s.backupDir, s.file, s.tokens, LATEST);
  assert.ok(p2.ok);
  if (!p2.ok) return;
  assert.deepEqual(verifyApply(s.dbPath, s.backupDir, s.file, p.value.token, s.tokens, LATEST), bad);
  assert.deepEqual(verifyApply(s.dbPath, s.backupDir, s.file, p2.value.token, s.tokens, LATEST), { ok: true });
  assert.deepEqual(verifyApply(s.dbPath, s.backupDir, s.file, p2.value.token, s.tokens, LATEST), bad, 'a token works once');

  // The file changed after the preview: the screen showed something that is no longer what is there.
  const p3 = previewRestore(s.dbPath, s.backupDir, s.file, s.tokens, LATEST);
  assert.ok(p3.ok);
  if (!p3.ok) return;
  fs.appendFileSync(path.join(s.backupDir, s.file), 'x');
  assert.deepEqual(verifyApply(s.dbPath, s.backupDir, s.file, p3.value.token, s.tokens, LATEST), bad);
});

test('apply re-checks the refusals, not only the token', async () => {
  const s = await scene();
  const p = previewRestore(s.dbPath, s.backupDir, s.file, s.tokens, LATEST);
  assert.ok(p.ok);
  if (!p.ok) return;
  fs.rmSync(path.join(s.backupDir, s.file));
  assert.deepEqual(verifyApply(s.dbPath, s.backupDir, s.file, p.value.token, s.tokens, LATEST), { ok: false, code: 'backup-missing' });
});
