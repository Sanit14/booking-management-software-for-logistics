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

const BUSINESS_TABLES = ['lrs', 'memos', 'stations', 'firms', 'trucks', 'drivers'];

/** LRs + memos + masters. A table that does not exist yet (an older schema) counts as 0. */
export function businessRows(db: Db): number {
  const present = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
  return BUSINESS_TABLES.filter((t) => present.has(t)).reduce((sum, t) => sum + (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n, 0);
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
