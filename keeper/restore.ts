// Restoring a backup over booking.db. The keeper (server.ts) closes its own handle around restoreFiles(); this
// file holds the file work and the rules for what may be restored, so they can be tested without a server.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DbSummary, RestorePreview, RestoreRefusal } from '../shared';
import { removeWithSidecars, summarizeInChild } from './backup';
import { beforeRestoreName, parseBackupName } from './backupNames';

export type Gate = { ok: true } | { ok: false; code: RestoreRefusal };

const rows = (s: DbSummary): number => s.lrs + s.memos + s.masters;

// Every check of a whole file runs in summarizeInChild: on the keeper's own thread it stopped every seat for as long as it took (16-21 s on a 3-year book).

/** The live database as a restore sees it: what it holds, or that it is missing (or empty file) or damaged. */
export async function readLive(dbPath: string): Promise<DbSummary | 'missing' | 'damaged'> {
  let size: number;
  try {
    size = fs.statSync(dbPath).size;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw e;
  }
  if (size === 0) return 'missing';
  return (await summarizeInChild(dbPath)) ?? 'damaged';
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

export async function previewRestore(
  dbPath: string,
  backupDir: string,
  file: string,
  tokens: Tokens,
  latestSchema: number,
): Promise<{ ok: true; value: RestorePreview } | { ok: false; code: RestoreRefusal }> {
  const found = locate(backupDir, file);
  if (!found) return { ok: false, code: 'backup-missing' };
  const [backup, live] = await Promise.all([summarizeInChild(found.full), readLive(dbPath)]);
  const gate = checkRestore(backup, live, latestSchema);
  if (!gate.ok) return gate;
  return { ok: true, value: { file, token: tokens.issue(file, found.fingerprint), backup: backup as DbSummary, live } };
}

// The chosen backup, copied beside the live file (same drive, so the final move is a rename). It is the copy that gets checked and moved.
const stagedPath = (dbPath: string): string => `${dbPath}.restoring`;
export const dropStaged = (dbPath: string): void => removeWithSidecars(stagedPath(dbPath));

/**
 * The last look before restoreFiles(): the token (single use, taken as soon as it matches), then the backup is copied beside the live file and
 * THE COPY is checked, in a process of its own, every refusal again on what is on disk now. On ok the copy stays as booking.db.restoring for
 * restoreFiles() to move into place; on a refusal or an error it is gone. The keeper's thread is free throughout (the copy goes through the
 * thread pool), and the book stays open: nothing is closed until this has said ok.
 */
export async function verifyApply(dbPath: string, backupDir: string, file: string, token: string, tokens: Tokens, latestSchema: number): Promise<Gate> {
  const found = locate(backupDir, file);
  if (!found) return { ok: false, code: 'backup-missing' };
  if (!tokens.matches(file, token, found.fingerprint)) return { ok: false, code: 'bad-token' };
  tokens.clear();
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    dropStaged(dbPath);
    await fs.promises.copyFile(found.full, stagedPath(dbPath));
    const [copy, live] = await Promise.all([summarizeInChild(stagedPath(dbPath)), readLive(dbPath)]);
    const gate = checkRestore(copy, live, latestSchema);
    if (!gate.ok) dropStaged(dbPath);
    return gate;
  } catch (e) {
    dropStaged(dbPath);
    throw e;
  }
}

/**
 * Puts the copy that verifyApply() staged in place of the live file. The caller has closed its handle. The live file (and its -wal) is first
 * copied to booking-before-restore-<time>.db in the backup folder; COPYFILE_EXCL, so an earlier copy is never overwritten. Returns that copy's
 * path, or undefined when there was no live file. If anything fails before the final rename the live file is untouched and the staged copy is
 * gone. The copies are asynchronous (the keeper answers 'starting' meanwhile); no request touches the book while it is closed.
 */
export async function restoreFiles(dbPath: string, backupDir: string, now = new Date()): Promise<string | undefined> {
  let saved: string | undefined;
  try {
    if (fs.existsSync(dbPath)) {
      saved = path.join(backupDir, beforeRestoreName(now));
      await fs.promises.copyFile(dbPath, saved, fs.constants.COPYFILE_EXCL);
      if (fs.existsSync(`${dbPath}-wal`)) await fs.promises.copyFile(`${dbPath}-wal`, `${saved}-wal`, fs.constants.COPYFILE_EXCL);
    }
    // A -wal or -shm left by the old file must not be replayed onto the restored one; neither must one left by the check of the copy.
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
    ['-wal', '-shm', '-journal'].forEach((suffix) => fs.rmSync(stagedPath(dbPath) + suffix, { force: true }));
    fs.renameSync(stagedPath(dbPath), dbPath);
  } catch (e) {
    dropStaged(dbPath);
    throw e;
  }
  return saved;
}
