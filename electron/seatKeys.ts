// This seat's keyboard shortcuts: `keys.json` next to `seat.json` in the Windows user's userData, so each clerk's keys stay on their seat.
// Not the database: a shortcut is not business data. No `electron` import, so it can be tested.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_KEYS, sanitize, type Keymap } from '../src/logic/keymap';

const fileIn = (userDataDir: string) => path.join(userDataDir, 'keys.json');

/** The saved keys, or the defaults when there is no file or it is unreadable. */
export function loadKeys(userDataDir: string): Keymap {
  try {
    return sanitize(JSON.parse(fs.readFileSync(fileIn(userDataDir), 'utf8')));
  } catch {
    return { ...DEFAULT_KEYS };
  }
}

/** Checks the keys again, writes them, and answers with what is now in force. Throws when the file cannot be written. */
export function saveKeys(userDataDir: string, raw: unknown): Keymap {
  const keys = sanitize(raw);
  fs.mkdirSync(userDataDir, { recursive: true });
  const file = fileIn(userDataDir);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(keys, null, 2)); // written whole, then switched in: a power cut leaves the old file
  fs.renameSync(`${file}.tmp`, file);
  return keys;
}
