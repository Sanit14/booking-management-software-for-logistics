// Restoring a backup over booking.db. The keeper (server.ts) closes its own handle around restoreFiles(); this
// file holds the file work and the rules for what may be restored, so they can be tested without a server.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DbSummary, RestorePreview, RestoreRefusal } from '../shared';
import { readSummary } from './backup';
import { beforeRestoreName, parseBackupName } from './backupNames';

export type Gate = { ok: true } | { ok: false; code: RestoreRefusal };

const rows = (s: DbSummary): number => s.lrs + s.memos + s.masters;

/** The live database as a restore sees it: what it holds, or that it is missing (or empty file) or damaged. */
export function readLive(dbPath: string): DbSummary | 'missing' | 'damaged' {
  let size: number;
  try {
    size = fs.statSync(dbPath).size;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw e;
  }
  if (size === 0) return 'missing';
  return readSummary(dbPath) ?? 'damaged';
}

/** `latestSchema` = the highest schema version this keeper knows. */
export function checkRestore(backup: DbSummary | null, live: DbSummary | 'missing' | 'damaged', latestSchema: number): Gate {
  if (!backup) return { ok: false, code: 'backup-damaged' };
  if (backup.schemaVersion > latestSchema) return { ok: false, code: 'backup-newer-schema' };
  // An empty backup over a live database that has records would wipe the business. Over a damaged or missing
  // one there is nothing to lose.
  if (typeof live === 'object' && rows(backup) === 0 && rows(live) > 0) return { ok: false, code: 'backup-empty' };
  return { ok: true };
}

/** One outstanding preview. apply must present the token of the latest preview of the same, unchanged file. */
export function makeTokens() {
  let current: { file: string; token: string; fingerprint: string } | null = null;
  return {
    issue(file: string, fingerprint: string): string {
      current = { file, token: randomUUID(), fingerprint };
      return current.token;
    },
    matches: (file: string, token: string, fingerprint: string): boolean =>
      current !== null && current.file === file && current.token === token && current.fingerprint === fingerprint,
    clear(): void {
      current = null;
    },
  };
}
export type Tokens = ReturnType<typeof makeTokens>;

// Only names made by backupName() are restorable: nothing with a path in it, nothing that is not a backup.
function locate(backupDir: string, file: string): { full: string; fingerprint: string } | null {
  if (parseBackupName(file) === null) return null;
  const full = path.join(backupDir, file);
  try {
    const st = fs.statSync(full);
    return st.isFile() ? { full, fingerprint: `${st.size}:${st.mtimeMs}` } : null;
  } catch {
    return null;
  }
}

export function previewRestore(
  dbPath: string,
  backupDir: string,
  file: string,
  tokens: Tokens,
  latestSchema: number,
): { ok: true; value: RestorePreview } | { ok: false; code: RestoreRefusal } {
  const found = locate(backupDir, file);
  if (!found) return { ok: false, code: 'backup-missing' };
  const backup = readSummary(found.full);
  const live = readLive(dbPath);
  const gate = checkRestore(backup, live, latestSchema);
  if (!gate.ok) return gate;
  return { ok: true, value: { file, token: tokens.issue(file, found.fingerprint), backup: backup as DbSummary, live } };
}

/** The last look before restoreFiles(): the token, and every refusal again on what is on disk now. */
export function verifyApply(dbPath: string, backupDir: string, file: string, token: string, tokens: Tokens, latestSchema: number): Gate {
  const found = locate(backupDir, file);
  if (!found) return { ok: false, code: 'backup-missing' };
  if (!tokens.matches(file, token, found.fingerprint)) return { ok: false, code: 'bad-token' };
  const gate = checkRestore(readSummary(found.full), readLive(dbPath), latestSchema);
  if (gate.ok) tokens.clear();
  return gate;
}

/**
 * Synchronous on purpose: no request can be answered between closing the live file and having the new one in
 * place. The caller has closed its handle. The live file (and its -wal) is first copied to
 * booking-before-restore-<time>.db in the backup folder; COPYFILE_EXCL, so an earlier copy is never overwritten.
 * Returns that copy's path, or undefined when there was no live file. If anything fails before the final
 * rename the live file is untouched.
 */
export function restoreFiles(dbPath: string, backupDir: string, file: string, now = new Date()): string | undefined {
  const src = path.join(backupDir, file);
  let saved: string | undefined;
  if (fs.existsSync(dbPath)) {
    saved = path.join(backupDir, beforeRestoreName(now));
    fs.copyFileSync(dbPath, saved, fs.constants.COPYFILE_EXCL);
    if (fs.existsSync(`${dbPath}-wal`)) fs.copyFileSync(`${dbPath}-wal`, `${saved}-wal`, fs.constants.COPYFILE_EXCL);
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const tmp = `${dbPath}.restoring`;
  try {
    fs.copyFileSync(src, tmp);
    // A -wal or -shm left by the old file must not be replayed onto the restored one.
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
    fs.renameSync(tmp, dbPath);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  return saved;
}
