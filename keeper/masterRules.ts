// Pure rules for master data (stations, firms, trucks, drivers). No database, no I/O: tested with node:test.
import { nameKey } from './names';

const MAX_NAME = 100;
const MAX_PHONE_DIGITS = 15;

/** Trimmed, inner spaces collapsed, 1 to 100 characters; null when blank or too long. */
export function cleanName(text: string): string | null {
  const name = text.normalize('NFC').trim().replace(/\s+/g, ' ');
  return name === '' || name.length > MAX_NAME ? null : name;
}

/** The unique key of a truck: upper-case with spaces, dots and dashes removed (`mh-29 be 1234` → `MH29BE1234`). */
export const truckKey = (text: string): string => text.normalize('NFC').toUpperCase().replace(/[\s.-]/g, '');

/** A truck number as shown: cleaned like a name, upper-cased; null when nothing is left once the key is made ("-", ". ."). */
export function cleanTruck(text: string): string | null {
  const number = cleanName(text)?.toUpperCase() ?? null;
  return number === null || truckKey(number) === '' ? null : number;
}

/** Digits only, stored as text. Spaces, dashes, dots, brackets and a leading + are dropped; '' is fine (optional); null = refused. */
export function cleanPhone(text: string): string | null {
  const digits = text.trim().replace(/^\+/, '').replace(/[\s\-.()]/g, '');
  return /^\d*$/.test(digits) && digits.length <= MAX_PHONE_DIGITS ? digits : null;
}

/**
 * Names that start like the candidate, or that the candidate starts like (prefix both ways on `nameKey`).
 * An equal name counts too: callers refuse exact matches first (firms) or treat them as similar (drivers).
 */
export function findSimilar(existing: string[], candidate: string): string[] {
  const key = nameKey(candidate);
  if (key === '') return [];
  return existing.filter((name) => {
    const other = nameKey(name);
    return other !== '' && (other.startsWith(key) || key.startsWith(other));
  });
}
