// Pure matching for the TypeAhead list. No React, no DOM: tested with node:test.

export interface Option {
  id: string;
  label: string;
  hint?: string; // e.g. the station next to a firm
}

export type Row = { kind: 'option'; option: Option } | { kind: 'walk-in' };

// Same rules as keeper/names.ts nameKey, so what the clerk types matches the way masters are stored.
// Copied, not imported: the screen never shares logic with the keeper (typeAhead.test.ts proves they agree).
export const matchKey = (text: string): string => text.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Options whose name starts with the text, then those that only contain it (caller order kept inside each group),
 * cut to `limit`. The walk-in row, when asked for, always comes last and only once something is typed.
 * Empty text lists the first `limit` options as given.
 */
export function buildRows(options: Option[], query: string, limit: number, walkIn: boolean): Row[] {
  const q = matchKey(query);
  const starts: Option[] = [];
  const contains: Option[] = [];
  for (const option of options) {
    const k = matchKey(option.label);
    if (q === '' || k.startsWith(q)) starts.push(option);
    else if (k.includes(q)) contains.push(option);
  }
  const rows: Row[] = [...starts, ...contains].slice(0, limit).map((option) => ({ kind: 'option', option }));
  if (walkIn && q !== '') rows.push({ kind: 'walk-in' });
  return rows;
}
