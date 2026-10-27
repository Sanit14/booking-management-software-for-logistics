// Pure "where does Enter go" logic for useEnterToNext. No DOM types: tested with node:test.

export interface FieldInfo {
  disabled: boolean;
  readOnly: boolean;
  hidden: boolean;
  tabIndex: number;
}

const usable = (f: FieldInfo) => !f.disabled && !f.readOnly && !f.hidden && f.tabIndex >= 0;

/**
 * Index of the next usable field after `from`, or null when there is none: Enter on the last field then does
 * what the form's own button does. `from` -1 = focus is not on a listed field.
 */
export function nextIndex(fields: FieldInfo[], from: number): number | null {
  for (let i = from + 1; i < fields.length; i++) {
    if (usable(fields[i])) return i;
  }
  return null;
}
