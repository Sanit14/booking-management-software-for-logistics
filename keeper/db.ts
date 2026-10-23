import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

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
    // Real tables arrive with migrations in session 1.3.
    db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  } catch (e) {
    db.close();
    throw e;
  }
  return db;
}

// Fold the WAL back into booking.db so the file alone is complete, then close.
export function closeDatabase(db: Db): void {
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
}
