import fs from 'node:fs';
import path, { win32 } from 'node:path';
import type { RootRefusal } from '../shared';

export const DEFAULT_ROOT = 'C:\\BookingManagerData';

export type RootCheck = { ok: true } | { ok: false; reason: RootRefusal };

// Pure and Windows-path-only (win32), so it gives the same answer in tests on any OS.
// Each NComputing seat is its own Windows user: a root inside a profile, OneDrive or DM's folder gives
// every seat its own private copy of the data (the DM bug this exists to stop).
export function checkDataRoot(root: string, profileDir: string | undefined = process.env.USERPROFILE): RootCheck {
  const full = win32.resolve(root);
  const low = full.toLowerCase();
  if (win32.parse(full).root.toLowerCase() === low) return { ok: false, reason: 'bare-drive' };
  if (low.includes('deliverymanager')) return { ok: false, reason: 'delivery-manager' };
  const profile = profileDir ? win32.resolve(profileDir).toLowerCase() : '';
  const inProfile =
    /^[a-z]:\\(users|documents and settings)(\\|$)/.test(low) ||
    (profile !== '' && (low === profile || low.startsWith(profile + '\\'))) ||
    low.split('\\').some((segment) => segment.startsWith('onedrive'));
  return inProfile ? { ok: false, reason: 'user-profile' } : { ok: true };
}

// BM_DATA_ROOT (dev and tests only, never persisted) -> shared pointer file -> default (and write the pointer).
// A pointer that exists but cannot be read is an error: replacing it could point the seats at a new, empty root.
// The result is always the resolved spelling (no trailing slash): it is hashed into the blank-database marker
// name, and two spellings of one folder must not get two markers.
export function resolveDataRoot(env: NodeJS.ProcessEnv, pointer: string): string {
  return win32.resolve(readRoot(env, pointer));
}

function readRoot(env: NodeJS.ProcessEnv, pointer: string): string {
  if (env.BM_DATA_ROOT) return env.BM_DATA_ROOT;
  let text: string;
  try {
    text = fs.readFileSync(pointer, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('root-pointer-unreadable');
    // Several seats may get here at once: write a temp file and rename, so nobody reads a half-written pointer.
    fs.mkdirSync(path.dirname(pointer), { recursive: true });
    const tmp = `${pointer}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify({ root: DEFAULT_ROOT }));
      fs.renameSync(tmp, pointer);
    } catch {
      fs.rmSync(tmp, { force: true }); // another seat won the race; it wrote the same default
    }
    return DEFAULT_ROOT;
  }
  let root: unknown;
  try {
    root = (JSON.parse(text) as { root?: unknown } | null)?.root;
  } catch {
    throw new Error('root-pointer-unreadable');
  }
  if (typeof root !== 'string' || root === '') throw new Error('root-pointer-unreadable');
  return root;
}
