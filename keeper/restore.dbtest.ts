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
type Scene = Awaited<ReturnType<typeof scene>>;

// A book big enough that checking it takes a while, so a check done on the keeper's own thread shows as a stalled event loop.
async function bigScene() {
  const db = freshDb();
  db.transaction(() => {
    for (let i = 0; i < 20000; i++) insertStation(db, `Prefill ${i}`);
  })();
  const dbPath = db.name;
  const backupDir = path.join(tempDir(), 'backups');
  const made = await makeBackup(db, backupDir, at(2026, 10, 24, 9, 0));
  insertLr(db);
  closeDatabase(db);
  return { dbPath, backupDir, file: path.basename(made.file), tokens: makeTokens() };
}

/** What the keeper does: preview, then apply's last look (which stages the copy), then the move into place. Returns the set-aside copy. */
async function swap(s: Scene, now: Date, dbPath = s.dbPath): Promise<string | undefined> {
  const p = await previewRestore(dbPath, s.backupDir, s.file, s.tokens, LATEST);
  assert.ok(p.ok);
  if (!p.ok) return undefined;
  assert.deepEqual(await verifyApply(dbPath, s.backupDir, s.file, p.value.token, s.tokens, LATEST), { ok: true });
  return restoreFiles(dbPath, s.backupDir, now);
}

test('the preview and the apply check the files in other processes: the keeper keeps answering meanwhile', async () => {
  const s = await bigScene();
  let ticks = 0;
  const timer = setInterval(() => ticks++, 5);
  const p = await previewRestore(s.dbPath, s.backupDir, s.file, s.tokens, LATEST);
  const afterPreview = ticks;
  assert.ok(p.ok);
  if (!p.ok) return clearInterval(timer);
  const gate = await verifyApply(s.dbPath, s.backupDir, s.file, p.value.token, s.tokens, LATEST);
  clearInterval(timer);
  assert.deepEqual(gate, { ok: true });
  assert.ok(afterPreview >= 3, `the event loop ran ${afterPreview} times while the preview checked both files`);
  assert.ok(ticks - afterPreview >= 3, `the event loop ran ${ticks - afterPreview} times while the apply checked the copy`);
});

test('preview shows the backup next to the live database, counts matching the files', async () => {
  const s = await scene();
  const r = await previewRestore(s.dbPath, s.backupDir, s.file, s.tokens, LATEST);
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
  const damaged = await previewRestore(s.dbPath, s.backupDir, s.file, s.tokens, LATEST);
  assert.ok(damaged.ok && damaged.value.live === 'damaged');
  fs.rmSync(s.dbPath);
  const missing = await previewRestore(s.dbPath, s.backupDir, s.file, s.tokens, LATEST);
  assert.ok(missing.ok && missing.value.live === 'missing');
});

test('apply swaps the file, keeps the old one as booking-before-restore-*, and the result reopens and migrates', async () => {
  const s = await scene();
  const saved = await swap(s, at(2026, 10, 24, 11, 5, 9));
  assert.equal(path.basename(saved ?? ''), 'booking-before-restore-20261024-110509.db');
  assert.equal(readSummary(saved ?? '')?.lrs, 2, 'the set-aside copy is the live database as it was');
  assert.equal(readSummary(s.dbPath)?.lrs, 1, 'the live file is now the backup');
  assert.equal(fs.existsSync(`${s.dbPath}.restoring`), false, 'no temp file left');

  const next: Migration = { version: MIGRATIONS.length + 1, up: (db) => void db.exec('CREATE TABLE later (x TEXT) STRICT') };
  const opened = openChecked(s.dbPath);
  assert.ok('db' in opened);
  if ('db' in opened) {
    assert.equal(opened.db.pragma('journal_mode', { simple: true }), 'wal', 'back in WAL mode once the keeper opens it');
    assert.equal(migrate(opened.db, [...MIGRATIONS, next]), next.version);
    assert.equal(currentVersion(opened.db), next.version);
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
  const saved = (await swap(s, at(2026, 10, 24, 11, 5, 9))) as string;
  assert.equal(fs.readFileSync(`${saved}-wal`, 'utf8'), 'stale wal');
  assert.equal(fs.existsSync(`${s.dbPath}-wal`), false);
  assert.equal(fs.existsSync(`${s.dbPath}-shm`), false);
  assert.equal(readSummary(s.dbPath)?.lrs, 1);
});

test('restoring when there is no live file just puts the backup in place (creating the folder)', async () => {
  const s = await scene();
  const dbPath = path.join(tempDir(), 'new-root', 'booking.db');
  assert.equal(await swap(s, at(2026, 10, 24, 11, 5, 9), dbPath), undefined);
  assert.equal(readSummary(dbPath)?.lrs, 1);
  assert.deepEqual(fs.readdirSync(s.backupDir).filter((n) => n.includes('before-restore')), []);
});

test('a restore that cannot set the old file aside changes nothing and leaves no copy beside the live file', async () => {
  const s = await scene();
  const p = await previewRestore(s.dbPath, s.backupDir, s.file, s.tokens, LATEST);
  assert.ok(p.ok);
  if (!p.ok) return;
  assert.deepEqual(await verifyApply(s.dbPath, s.backupDir, s.file, p.value.token, s.tokens, LATEST), { ok: true });
  assert.equal(fs.existsSync(`${s.dbPath}.restoring`), true, 'the checked copy waits beside the live file');
  fs.mkdirSync(path.join(s.backupDir, 'booking-before-restore-20261024-110509.db')); // a folder where the set-aside copy goes
  await assert.rejects(restoreFiles(s.dbPath, s.backupDir, at(2026, 10, 24, 11, 5, 9)));
  assert.equal(readSummary(s.dbPath)?.lrs, 2, 'the live file is as it was');
  assert.equal(fs.existsSync(`${s.dbPath}.restoring`), false);
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

  const over = await previewRestore(live.name, backupDir, file, tokens, LATEST);
  assert.deepEqual(over, { ok: false, code: 'backup-empty' });

  fs.writeFileSync(live.name, Buffer.alloc(5000, 9));
  assert.ok((await previewRestore(live.name, backupDir, file, tokens, LATEST)).ok);
  fs.rmSync(live.name);
  assert.ok((await previewRestore(live.name, backupDir, file, tokens, LATEST)).ok);
});

test('refused: a backup with a newer schema than this keeper, a damaged backup, a missing or oddly named one', async () => {
  const s = await scene();
  const newer = freshDb();
  insertLr(newer);
  newer.exec('INSERT INTO schema_version (version) VALUES (99)');
  const nm = await makeBackup(newer, s.backupDir, at(2026, 10, 24, 10, 0));
  assert.deepEqual(await previewRestore(s.dbPath, s.backupDir, path.basename(nm.file), s.tokens, LATEST), { ok: false, code: 'backup-newer-schema' });

  fs.writeFileSync(path.join(s.backupDir, backupName(at(2026, 10, 24, 11, 0))), Buffer.alloc(9000, 3));
  assert.deepEqual(await previewRestore(s.dbPath, s.backupDir, backupName(at(2026, 10, 24, 11, 0)), s.tokens, LATEST), { ok: false, code: 'backup-damaged' });

  assert.deepEqual(await previewRestore(s.dbPath, s.backupDir, backupName(at(2026, 10, 24, 12, 0)), s.tokens, LATEST), { ok: false, code: 'backup-missing' });
  for (const odd of ['..\\booking.db', '../x/booking-20261024-0900.db', s.dbPath, 'booking.db']) {
    assert.deepEqual(await previewRestore(s.dbPath, s.backupDir, odd, s.tokens, LATEST), { ok: false, code: 'backup-missing' }, odd);
  }
});

test('refused: apply without the preview, with a wrong, reused or another file’s token, or after the backup changed', async () => {
  const s = await scene();
  const second = freshDb();
  insertLr(second);
  const other = path.basename((await makeBackup(second, s.backupDir, at(2026, 10, 24, 10, 0))).file);
  const bad = { ok: false, code: 'bad-token' };

  assert.deepEqual(await verifyApply(s.dbPath, s.backupDir, s.file, 'never-issued', s.tokens, LATEST), bad);

  const p = await previewRestore(s.dbPath, s.backupDir, s.file, s.tokens, LATEST);
  assert.ok(p.ok);
  if (!p.ok) return;
  assert.deepEqual(await verifyApply(s.dbPath, s.backupDir, s.file, 'wrong', s.tokens, LATEST), bad);
  assert.deepEqual(await verifyApply(s.dbPath, s.backupDir, other, p.value.token, s.tokens, LATEST), bad, 'a token is for the file it was issued for');

  // A newer preview replaces the older token.
  const p2 = await previewRestore(s.dbPath, s.backupDir, s.file, s.tokens, LATEST);
  assert.ok(p2.ok);
  if (!p2.ok) return;
  assert.deepEqual(await verifyApply(s.dbPath, s.backupDir, s.file, p.value.token, s.tokens, LATEST), bad);
  assert.deepEqual(await verifyApply(s.dbPath, s.backupDir, s.file, p2.value.token, s.tokens, LATEST), { ok: true });
  assert.deepEqual(await verifyApply(s.dbPath, s.backupDir, s.file, p2.value.token, s.tokens, LATEST), bad, 'a token works once');

  // The file changed after the preview: the screen showed something that is no longer what is there.
  const p3 = await previewRestore(s.dbPath, s.backupDir, s.file, s.tokens, LATEST);
  assert.ok(p3.ok);
  if (!p3.ok) return;
  fs.appendFileSync(path.join(s.backupDir, s.file), 'x');
  assert.deepEqual(await verifyApply(s.dbPath, s.backupDir, s.file, p3.value.token, s.tokens, LATEST), bad);
});

test('apply re-checks the refusals, not only the token, and a refusal leaves no copy beside the live file', async () => {
  const s = await scene();
  const p = await previewRestore(s.dbPath, s.backupDir, s.file, s.tokens, LATEST);
  assert.ok(p.ok);
  if (!p.ok) return;
  fs.rmSync(path.join(s.backupDir, s.file));
  assert.deepEqual(await verifyApply(s.dbPath, s.backupDir, s.file, p.value.token, s.tokens, LATEST), { ok: false, code: 'backup-missing' });

  // A live database that got records after the preview made an empty backup fine: the apply looks again.
  const live = freshDb();
  insertStation(live, 'Pune');
  closeDatabase(live);
  const spare = path.join(tempDir(), 'spare.db');
  fs.copyFileSync(live.name, spare);
  fs.rmSync(live.name);
  const emptyDb = freshDb();
  const made = await makeBackup(emptyDb, path.join(tempDir(), 'backups'), at(2026, 10, 24, 9, 0));
  const dir = path.dirname(made.file);
  const file = path.basename(made.file);
  const tokens = makeTokens();
  const q = await previewRestore(live.name, dir, file, tokens, LATEST);
  assert.ok(q.ok, 'over a missing live file an empty backup is fine');
  if (!q.ok) return;
  fs.copyFileSync(spare, live.name);
  assert.deepEqual(await verifyApply(live.name, dir, file, q.value.token, tokens, LATEST), { ok: false, code: 'backup-empty' });
  assert.equal(fs.existsSync(`${live.name}.restoring`), false);
});
