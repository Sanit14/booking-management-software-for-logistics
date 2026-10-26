// Backups of booking.db: made with SQLite's online backup (safe while seats write), verified before they count,
// and pruned by backupNames.pickToPrune. Needs better-sqlite3, so its tests are *.dbtest.ts.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { BackupInfo, DbSummary } from '../shared';
import { backupName, parseBackupName, pickToPrune } from './backupNames';
import { hasTable, masterRows, tableCount, type Db } from './db';
import { currentVersion, MIGRATIONS, migrate, type Migration } from './migrations';

/** What is in a database file, opened read-only. null = it cannot be opened or fails `quick_check`. */
export function readSummary(file: string): DbSummary | null {
  let db: Db | undefined;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    if (db.pragma('quick_check', { simple: true }) !== 'ok') return null;
    return {
      schemaVersion: hasTable(db, 'schema_version') ? currentVersion(db) : 0,
      lrs: tableCount(db, 'lrs'),
      memos: tableCount(db, 'memos'),
      masters: masterRows(db),
      newestLrDate: hasTable(db, 'lrs') ? ((db.prepare('SELECT MAX(lr_date) AS d FROM lrs').get() as { d: string | null }).d) : null,
      lastNumbers: hasTable(db, 'counters')
        ? (db.prepare('SELECT name, year, last FROM counters ORDER BY name, year').all() as DbSummary['lastNumbers'])
        : [],
    };
  } catch {
    return null;
  } finally {
    if (db?.open) db.close();
  }
}

/** Throws unless the file opens read-only and passes `quick_check`; returns its business-row count. */
export function verifyBackup(file: string): number {
  const s = readSummary(file);
  if (!s) throw new Error('the backup failed its integrity check');
  return s.lrs + s.memos + s.masters;
}

export interface MadeBackup {
  file: string;
  rows: number;
  bytes: number;
}

/**
 * Writes `booking-YYYYMMDD-HHmm.db` into `dir`: to a temp name first, verified, then renamed, so a half-written
 * file never looks like a backup. A backup that fails is deleted and the error thrown. `dir` is created if needed.
 */
export async function makeBackup(db: Db, dir: string, now = new Date(), verify = verifyBackup): Promise<MadeBackup> {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, backupName(now));
  const tmp = `${file}.tmp`;
  const dropTmp = () => ['', '-wal', '-shm', '-journal'].forEach((suffix) => fs.rmSync(tmp + suffix, { force: true }));
  dropTmp(); // left behind by a crash
  try {
    await db.backup(tmp);
    // The copy inherits WAL mode, and a read-only open of a WAL file leaves -wal/-shm files beside it. A backup
    // is a single self-contained file; the keeper switches it back to WAL when it is restored and opened.
    const copy = new Database(tmp);
    try {
      copy.pragma('journal_mode = DELETE');
    } finally {
      copy.close();
    }
    const rows = verify(tmp);
    fs.renameSync(tmp, file);
    return { file, rows, bytes: fs.statSync(file).size };
  } catch (e) {
    dropTmp();
    throw e;
  }
}

/** The backup files in `dir` (by name only, nothing is opened), newest first. A folder that does not exist has none. */
export function backupFiles(dir: string): { file: string; at: Date }[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  return names
    .map((file) => ({ file, at: parseBackupName(file) }))
    .filter((b): b is { file: string; at: Date } => b.at !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** Backups in `dir`, newest first, each opened read-only for its summary. */
export function listBackups(dir: string): BackupInfo[] {
  return backupFiles(dir).map(({ file, at }) => {
    const full = path.join(dir, file);
    const summary = readSummary(full);
    const info: BackupInfo = { file, at: at.toISOString(), sizeBytes: fs.statSync(full).size, damaged: summary === null };
    if (summary) info.summary = summary;
    return info;
  });
}

/** Deletes the backups the retention rule drops. Returns their names. */
export function pruneBackups(dir: string, now = new Date()): string[] {
  const drop = pickToPrune(fs.readdirSync(dir), now);
  for (const name of drop) fs.rmSync(path.join(dir, name), { force: true });
  return drop;
}

/**
 * migrate(), after a backup when the database already has a schema and a migration is pending, so a bad
 * migration can always be undone. If that backup cannot be written the migration still runs (a machine without
 * its backup drive must not be left with a dead app) and the failure comes back in `backupError`.
 */
export async function migrateSafely(
  db: Db,
  dir: string,
  now = new Date(),
  migrations: Migration[] = MIGRATIONS,
): Promise<{ version: number; backup?: MadeBackup; backupError?: string }> {
  const latest = migrations[migrations.length - 1]?.version ?? 0;
  const out: { version: number; backup?: MadeBackup; backupError?: string } = { version: 0 };
  const at = hasTable(db, 'schema_version') ? currentVersion(db) : 0;
  if (at > 0 && at < latest) {
    try {
      out.backup = await makeBackup(db, dir, now);
    } catch (e) {
      out.backupError = String((e as Error)?.message ?? e);
    }
  }
  out.version = migrate(db, migrations);
  return out;
}
