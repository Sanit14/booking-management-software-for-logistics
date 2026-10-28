// Pure: which master rows the Masters list shows. Searching happens here, in memory, because the screen holds
// every master (masters.all). No React, no DOM: tested with node:test.
import type { MasterKind, MasterRow } from '../../shared';
import { matchKey } from './typeAhead';

/** What a row is searched by: its name, or for a truck its number. */
export const rowText = (row: MasterRow): string => ('number' in row ? row.number : row.name);

// A truck is found however it is typed: "mh29", "MH-29 BE" and "mh 29 be 1234" all match MH 29 BE 1234.
const searchKey = (kind: MasterKind, text: string): string => (kind === 'trucks' ? text.normalize('NFC').toLowerCase().replace(/[\s.-]/g, '') : matchKey(text));

/** Rows whose name contains the text, inactive ones only when asked for. Keeps the keeper's order. */
export function visibleRows(rows: MasterRow[], kind: MasterKind, query: string, showInactive: boolean): MasterRow[] {
  const q = searchKey(kind, query);
  return rows.filter((r) => (showInactive || r.active) && searchKey(kind, rowText(r)).includes(q));
}
