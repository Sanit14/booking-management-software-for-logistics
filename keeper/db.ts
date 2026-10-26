import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { writeMarker } from './guard';

export type Db = Database.Database;

export function openDatabase(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.pragma('busy_timeout = 5000');
    // WAL does not work on every filesystem (some network shares); better to refuse than to run unsafe.
    const mode = db.pragma('journal_mode = WAL', { simple: true });
    if (mode !== 'wal') throw new Error(`cannot use WAL journal mode here (got ${String(mode)})`);
    db.pragma('foreign_keys = ON');
  } catch (e) {
    db.close();
    throw e;
  }
  return db;
}

/**
 * Opens an existing file the way the keeper uses it, and checks it. `damaged` when SQLite says the file is not
 * a database (or corrupt) or `PRAGMA quick_check` is not `ok`; anything else (permissions, a locked file, no
 * WAL support) is thrown, because it says nothing about the data and must not be answered with a restore.
 */
export function openChecked(dbPath: string): { db: Db } | { damaged: string } {
  let db: Db | undefined;
  try {
    db = openDatabase(dbPath);
    const result = db.pragma('quick_check', { simple: true });
    if (result === 'ok') return { db };
    db.close();
    return { damaged: String(result) };
  } catch (e) {
    if (db?.open) db.close();
    if (isDamage(e)) return { damaged: String((e as Error).message) };
    throw e;
  }
}

/** SQLite's own words for "this file is not a healthy database" (a bad sector shows up as a failed read). */
export function isDamage(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && (code === 'SQLITE_NOTADB' || code === 'SQLITE_IOERR_READ' || code === 'SQLITE_IOERR_SHORT_READ' || code.startsWith('SQLITE_CORRUPT'));
}

export function hasTable(db: Pick<Db, 'prepare'>, table: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
}

/** Rows in a table; a table that does not exist yet (an older schema) counts as 0. */
export function tableCount(db: Db, table: string): number {
  return hasTable(db, table) ? (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n : 0;
}

const MASTER_TABLES = ['stations', 'firms', 'trucks', 'drivers'];

export function masterRows(db: Db): number {
  return MASTER_TABLES.reduce((sum, t) => sum + tableCount(db, t), 0);
}

/** LRs + memos + masters. */
export function businessRows(db: Db): number {
  return tableCount(db, 'lrs') + tableCount(db, 'memos') + masterRows(db);
}

/**
 * Raise the guard's baseline when the database has more records than the marker knows of. The marker is
 * otherwise written only at start and on a clean stop, so after a power cut on day one it would still say 0
 * and a wiped database would look new. Returns the count the marker now holds.
 */
export function raiseMarker(db: Db, programDirPath: string, root: string, dbPath: string, markedRows: number): number {
  const rows = businessRows(db);
  if (rows <= markedRows) return markedRows;
  writeMarker(programDirPath, root, dbPath, rows);
  return rows;
}

// Fold the WAL back into booking.db so the file alone is complete, then close.
export function closeDatabase(db: Db): void {
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
}
