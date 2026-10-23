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

export function writeMarker(programDirPath: string, root: string, dbPath: string): void {
  fs.mkdirSync(programDirPath, { recursive: true });
  fs.writeFileSync(markerPath(programDirPath, root), JSON.stringify({ root, dbPath, at: new Date().toISOString() }));
}
