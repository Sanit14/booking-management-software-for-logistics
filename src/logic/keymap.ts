// The rules for keys. A key is a string: "F4", "Ctrl+Q", "Alt+7", and "Escape" (a default only).
// Pure: the seat's file (main) and the screen both use these functions, so they cannot disagree.
// The action list and the defaults are in shared/keys.ts.
import { ACTIONS, DEFAULT_KEYS, type ActionId, type Keymap } from '../../shared';

export { ACTIONS, DEFAULT_KEYS };
export type { ActionId, Keymap };

/** What a key event gives us; a real KeyboardEvent fits. */
export interface KeyEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

// Windows and the app itself, plus the text-editing keys: an action must never take these over.
const RESERVED = new Set(['Alt+F4', 'Ctrl+W', 'Ctrl+R', 'Tab', 'Enter', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+Z', 'Ctrl+Y']);
const ALLOWED = /^(F([1-9]|1[0-2])|(Ctrl|Alt)\+[A-Z0-9])$/;
const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph']);

/** The key a clerk pressed as a name, or null while only a modifier is down. By `code`, so the keyboard layout (and AltGr) does not change it. */
export function eventToKey(e: KeyEventLike): string | null {
  if (MODIFIERS.has(e.key)) return null;
  const letter = /^Key([A-Z])$/.exec(e.code)?.[1] ?? /^Digit(\d)$/.exec(e.code)?.[1];
  const name = letter ?? (/^F\d+$/.test(e.code) ? e.code : e.key);
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
  return [...mods, name].join('+');
}

export const matches = (key: string, e: KeyEventLike) => eventToKey(e) === key;

export type KeyCheck = { ok: true } | { ok: false; why: 'invalid' | 'reserved' } | { ok: false; why: 'used'; by: ActionId };

/** May `action` take `key`? F1-F12 or Ctrl/Alt + a letter or digit, not reserved, not another action's. */
export function checkChange(keys: Keymap, action: ActionId, key: string): KeyCheck {
  if (RESERVED.has(key)) return { ok: false, why: 'reserved' };
  if (!ALLOWED.test(key)) return { ok: false, why: 'invalid' };
  const by = ACTIONS.find((a) => a !== action && keys[a] === key);
  return by ? { ok: false, why: 'used', by } : { ok: true };
}

export const keyLabel = (key: string) => (key === 'Escape' ? 'Esc' : key);

/** Whatever a seat's file held, as a usable keymap: a wrong or missing entry gets its default; two actions on one key = the defaults. */
export function sanitize(raw: unknown): Keymap {
  const given = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const keys = { ...DEFAULT_KEYS };
  for (const a of ACTIONS) {
    const v = given[a];
    if (typeof v === 'string' && (v === DEFAULT_KEYS[a] || (ALLOWED.test(v) && !RESERVED.has(v)))) keys[a] = v;
  }
  return new Set(Object.values(keys)).size === ACTIONS.length ? keys : { ...DEFAULT_KEYS };
}
