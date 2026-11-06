// The rules of the Admin settings that need no database (4.2). Pure.
import path from 'node:path';

/** The drive (or share) a Windows path is on, lower case: `c:\` for C:\Data, `\\server\share\` for a network folder. `path.win32` so it reads the same anywhere. */
export const driveOf = (p: string): string => path.win32.parse(path.win32.normalize(p)).root.toLowerCase();

/** Two paths on one drive (or one share): a backup there does not survive the drive the data is on. */
export const sameDrive = (a: string, b: string): boolean => driveOf(a) !== '' && driveOf(a) === driveOf(b);

export const isAbsoluteWindows = (p: string): boolean => path.win32.isAbsolute(p) && driveOf(p) !== '';

/** The same folder, however it was typed (case, a closing slash). */
export const sameFolder = (a: string, b: string): boolean => path.win32.resolve(a).toLowerCase() === path.win32.resolve(b).toLowerCase();

export const SEAT_NAME_MIN = 2;
export const SEAT_NAME_MAX = 20;

/** A seat's name as it will be kept: spaces trimmed and runs of them made one. Null when it is not 2 to 20 letters, digits, spaces or dashes. */
export function cleanSeatName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < SEAT_NAME_MIN || name.length > SEAT_NAME_MAX) return null;
  // \p{M}: the vowel signs and other marks that belong to a letter in Devanagari and other scripts.
  return /^[\p{L}\p{M}\p{N} -]+$/u.test(name) && /[\p{L}\p{N}]/u.test(name) ? name : null;
}

/** Names are compared with ASCII case ignored (as seats are in the keeper's list). */
export const seatKey = (name: string): string => name.replace(/[A-Z]/g, (c) => c.toLowerCase());
