// Backups of booking.db: made with SQLite's online backup (safe while seats write), verified before they count,
// and pruned by backupNames.pickToPrune. Needs better-sqlite3, so its tests are *.dbtest.ts.
import { spawn } from 'node:child_process';
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

/**
 * What is in a database file, null when it cannot be opened or fails `quick_check` (readSummary, in a process of its own). The check reads the
 * whole file (4 s for 450 MB, 16 s cold), and the keeper has one thread: done here it stopped every save for that long. So it runs in
 * verifyChild.ts, started the way the keeper itself is (this executable as plain Node). Rejects only when the process cannot be started.
 */
export function summarizeInChild(file: string): Promise<DbSummary | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'verifyChild.js'), file], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let out = '';
    const hung = setTimeout(() => child.kill(), 15 * 60 * 1000); // a check that never ends (a locked file) must not hold the backup, and the stop behind it, for ever
    child.stdout.on('data', (c: Buffer) => (out += c.toString('utf8')));
    child.on('error', (e) => {
      clearTimeout(hung);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(hung);
      try {
        resolve(code === 0 ? (JSON.parse(out) as DbSummary | null) : null);
      } catch {
        resolve(null); // no summary = failed
      }
    });
  });
}

/** Rejects unless the file opens read-only and passes `quick_check`; resolves with its business-row count. */
export async function verifyBackup(file: string): Promise<number> {
  const s = await summarizeInChild(file);
  if (!s) throw new Error('the backup failed its integrity check');
  return s.lrs + s.memos + s.masters;
}

/** Deletes a database file and any -wal / -shm / -journal a read of it may have left beside it. */
export const SIDECARS = ['-wal', '-shm', '-journal'];
export const removeWithSidecars = (file: string): void => ['', ...SIDECARS].forEach((suffix) => fs.rmSync(file + suffix, { force: true }));

export interface MadeBackup {
  file: string;
  rows: number;
  bytes: number;
}

/**
 * Writes `booking-YYYYMMDD-HHmm.db` into `dir`: to a temp name first, verified, then renamed, so a half-written
 * file never looks like a backup. A backup that fails is deleted and the error thrown. `dir` is created if needed.
 */
export async function makeBackup(db: Db, dir: string, now = new Date(), verify: (file: string) => number | Promise<number> = verifyBackup): Promise<MadeBackup> {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, backupName(now));
  const tmp = `${file}.tmp`;
  const dropTmp = () => removeWithSidecars(tmp);
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
    const rows = await verify(tmp);
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

/**
 * Backups in `dir`, newest first: name, time and size. Nothing is opened: a check of every backup ran on the keeper's thread (16 s for one
 * 450 MB file), so the check comes with the restore preview, in a process of its own.
 */
export function listBackups(dir: string): BackupInfo[] {
  return backupFiles(dir).map(({ file, at }) => ({ file, at: at.toISOString(), sizeBytes: fs.statSync(path.join(dir, file)).size }));
}

/** Deletes the backups the retention rule drops. Returns their names. */
export function pruneBackups(dir: string, now = new Date()): string[] {
  const drop = pickToPrune(fs.readdirSync(dir), now);
  for (const name of drop) fs.rmSync(path.join(dir, name), { force: true });
  return drop;
}

const RECENT_BACKUP_MS = 60 * 60 * 1000;

/**
 * The newest backup in `dir` when it is under an hour old and holds schema version `version`, else undefined. A migration that throws makes the
 * keeper exit and start again: the first start's backup is the book as it was, so the starts after it need none (one a minute filled the disk).
 */
function recentBackup(dir: string, version: number, now: Date): string | undefined {
  let newest: ReturnType<typeof backupFiles>[number] | undefined;
  try {
    newest = backupFiles(dir)[0];
  } catch {
    return undefined; // a folder that cannot be read has no backup in it: makeBackup then fails and says why (backupError), and the migration still runs
  }
  const age = newest ? now.getTime() - newest.at.getTime() : -1;
  if (!newest || age < 0 || age >= RECENT_BACKUP_MS) return undefined;
  let db: Db | undefined;
  try {
    db = new Database(path.join(dir, newest.file), { readonly: true, fileMustExist: true });
    return (hasTable(db, 'schema_version') ? currentVersion(db) : 0) === version ? newest.file : undefined;
  } catch {
    return undefined; // an unreadable backup is no backup: make a new one
  } finally {
    if (db?.open) db.close();
  }
}

/**
 * migrate(), after a backup when the database already has a schema and a migration is pending, so a bad
 * migration can always be undone. If that backup cannot be written the migration still runs (a machine without
 * its backup drive must not be left with a dead app) and the failure comes back in `backupError`. A backup of the
 * same schema version made in the last hour is not repeated (`backupSkipped` names it).
 */
export async function migrateSafely(
  db: Db,
  dir: string,
  now = new Date(),
  migrations: Migration[] = MIGRATIONS,
): Promise<{ version: number; backup?: MadeBackup; backupError?: string; backupSkipped?: string }> {
  const latest = migrations[migrations.length - 1]?.version ?? 0;
  const out: { version: number; backup?: MadeBackup; backupError?: string; backupSkipped?: string } = { version: 0 };
  const at = hasTable(db, 'schema_version') ? currentVersion(db) : 0;
  if (at > 0 && at < latest) {
    const recent = recentBackup(dir, at, now);
    if (recent) out.backupSkipped = recent;
    else {
      try {
        out.backup = await makeBackup(db, dir, now);
      } catch (e) {
        out.backupError = String((e as Error)?.message ?? e);
      }
    }
  }
  out.version = migrate(db, migrations);
  return out;
}
