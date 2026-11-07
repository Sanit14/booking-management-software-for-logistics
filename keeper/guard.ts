import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { GuardReason } from '../shared';

export type OpenDecision = { action: 'create' | 'open' } | { action: 'safe-mode'; reason: GuardReason };

// Blank-database guard. The marker says "a database lived at this root"; if it did and the file is now gone
// or empty, creating a fresh one would silently start the business over from zero.
// fileSize: bytes of booking.db, or null when it does not exist. A WAL database is never 0 bytes once opened.
export function decideOpen(markerExists: boolean, fileSize: number | null): OpenDecision {
  if (markerExists && fileSize === null) return { action: 'safe-mode', reason: 'marker-without-database' };
  if (markerExists && fileSize === 0) return { action: 'safe-mode', reason: 'marker-with-empty-database' };
  return { action: fileSize === null ? 'create' : 'open' };
}

// One marker per data root: a root changed on purpose must not trip the guard of the old one.
export function markerPath(programDirPath: string, root: string): string {
  const hash = crypto.createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 12);
  return path.join(programDirPath, `db-${hash}.json`);
}

// Size in bytes, or null when the file does not exist. Any other error (permissions...) is thrown: it must
// never be read as "no marker" or "no database", which would let a blank database be created.
function sizeOrNull(file: string): number | null {
  try {
    return fs.statSync(file).size;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    return null;
  }
}

export function inspectBeforeOpen(programDirPath: string, root: string, dbPath: string): OpenDecision {
  return decideOpen(sizeOrNull(markerPath(programDirPath, root)) !== null, sizeOrNull(dbPath));
}

function readMarker(programDirPath: string, root: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(fs.readFileSync(markerPath(programDirPath, root), 'utf8'));
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// businessRows = LRs + memos + masters at the time of writing; it lets the guard spot a database that opens
// fine but has been emptied or swapped for a blank one. `clean` is true only in the marker written by a clean stop (the database closed and
// checkpointed): the next start may then skip the full integrity check, which reads the whole file (16 s for 450 MB). It carries the size and
// modified time of the file it vouches for, so a file replaced or cut while the app was off is not taken for it. Every other write says
// "running" (false), so a crash, a power cut or a killed process leaves a marker that asks for the full check.
export function writeMarker(programDirPath: string, root: string, dbPath: string, businessRows: number, clean = false): void {
  fs.mkdirSync(programDirPath, { recursive: true });
  let file: fs.Stats | null = null;
  if (clean) {
    try {
      file = fs.statSync(dbPath);
    } catch {
      /* no file to vouch for: not clean */
    }
  }
  const stamp = file ? { dbSize: file.size, dbMtimeMs: file.mtimeMs } : {};
  fs.writeFileSync(markerPath(programDirPath, root), JSON.stringify({ root, dbPath, at: new Date().toISOString(), businessRows, clean: file !== null, ...stamp }));
}

/** True only when the last thing that happened to this root was a clean stop AND the file is still the one it closed (no -wal beside it). No marker, an older marker (no flag) or an unreadable one: false. */
export function readMarkerClean(programDirPath: string, root: string, dbPath: string): boolean {
  const m = readMarker(programDirPath, root);
  if (m.clean !== true) return false;
  try {
    const f = fs.statSync(dbPath);
    return f.size === m.dbSize && f.mtimeMs === m.dbMtimeMs && !fs.existsSync(`${dbPath}-wal`);
  } catch {
    return false;
  }
}

/** The database is about to be opened (or swapped): from here a crash must ask for the full check. Only rewrites a marker that exists, keeping its row count. */
export function markRunning(programDirPath: string, root: string, dbPath: string): void {
  if (fs.existsSync(markerPath(programDirPath, root))) writeMarker(programDirPath, root, dbPath, readMarkerRows(programDirPath, root));
}

/** Rows the marker says the database had; 0 for a marker from session 1.2 (no count) or one that cannot be read. */
export function readMarkerRows(programDirPath: string, root: string): number {
  const n = readMarker(programDirPath, root).businessRows;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/** The database opened, but had records before and has none now: do not carry on as if nothing happened. */
export function blankReason(markerRows: number, businessRows: number): GuardReason | null {
  return markerRows > 0 && businessRows === 0 ? 'marker-with-no-rows' : null;
}
