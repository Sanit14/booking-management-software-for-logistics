// This seat's name: `seat.json` in the Windows user's userData, so each seat keeps its own. The Windows user name until the Admin renames the
// seat (4.2); a rename is used from the next start. No `electron` import, so it can be tested.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fileIn = (userDataDir: string) => path.join(userDataDir, 'seat.json');

export function loadSeat(userDataDir: string): string {
  const file = fileIn(userDataDir);
  try {
    const name = (JSON.parse(fs.readFileSync(file, 'utf8')) as { name?: unknown }).name;
    if (typeof name === 'string' && name !== '') return name;
  } catch {
    /* no seat file yet */
  }
  let name = 'seat';
  try {
    name = os.userInfo().username || name;
  } catch {
    /* no user name available */
  }
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ name }));
  } catch {
    /* the default still works without the file */
  }
  return name;
}

/** Keeps `name` for the next start. Written whole, then switched in, so a power cut leaves the old name. Throws when it cannot be written. */
export function saveSeat(userDataDir: string, name: string): void {
  fs.mkdirSync(userDataDir, { recursive: true });
  const file = fileIn(userDataDir);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ name }));
  fs.renameSync(`${file}.tmp`, file);
}
