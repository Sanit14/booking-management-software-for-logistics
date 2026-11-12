// A row of the History as a person reads it. Pure: the keeper sends data (the record's number or name, the facts around it, what changed with
// names instead of ids); the words are in strings.history, this only picks and joins them. An action with no sentence shows its raw code.
import type { HistoryChange, HistoryRow } from '../../shared';
import type { SayCtx, strings } from '../strings';
import type { Jump } from './searchResults';
import { formatPaise, formatWhole } from './rupees';

type Words = typeof strings.history;
const rupees = (paise: number) => `₹${formatPaise(paise)}`;
const isoToDisplay = (iso: string) => iso.split('-').reverse().join('-');

/** The sentence for a row: "LR 1248 edited", "Wasuli LR 77 collected ₹500 cash by Ramesh", "Backup folder changed to E:\BM". */
export function sentence(row: HistoryRow, t: Words): string {
  // Masters share four sentences, the table says which by the action alone.
  const say = Object.prototype.hasOwnProperty.call(t.say, row.action) ? t.say[row.action] : undefined;
  if (!say) return row.action;
  const noun = row.record ? (t.nouns[row.record] ?? '') : '';
  const ctx: SayCtx = {
    lr: row.lrNo === null ? t.anLr : `LR ${row.lrNo}`,
    challan: row.challanNo === null ? t.aChallan : `Challan ${row.challanNo}`,
    wasuli: row.lrNo === null ? 'Wasuli' : `Wasuli LR ${row.lrNo}`,
    name: row.name ?? '?',
    noun,
    how: t.howPrinted[row.facts.how ?? ''] ?? row.facts.how ?? 'printed',
    pinName: t.pinNames[row.facts.pin ?? ''] ?? row.facts.pin ?? '?',
    reportName: t.reportName(row.facts.report ?? row.name ?? ''),
    f: { ...row.facts, mode: row.facts.mode === undefined ? undefined : (t.modes[row.facts.mode] ?? row.facts.mode) },
    changes: row.changes,
    rupees,
    amount: formatPaise,
    whole: formatWhole,
    nos: (list) => (list && list.length > 0 ? `LR ${list.join(', ')}` : 'LRs'),
    date: isoToDisplay,
  };
  return say(ctx);
}

/** One side of a changed field as a person reads it: rupees for money, the option's name, a date as dd-mm-yyyy, a dash for nothing. */
export function changeValue(c: HistoryChange, side: 'from' | 'to', t: Words): string {
  const v = c[side];
  if (v === null || v === undefined || v === '') return t.details.none;
  switch (c.unit) {
    case 'paise':
      return rupees(Number(v));
    case 'date':
      return isoToDisplay(String(v));
    case 'percent':
      return `${v}%`;
    case 'rupees':
      return `${Number(v) < 0 ? '-' : ''}₹${formatPaise(Math.abs(Number(v)) * 100)}`;
    case 'option':
      return t.chargeOptions[String(v)] ?? String(v);
    default:
      return String(v);
  }
}

/** "Quantity: 3 → 5" */
export const changeLine = (c: HistoryChange, t: Words): string => t.details.change(t.fields[c.field] ?? c.field, changeValue(c, 'from', t), changeValue(c, 'to', t));

const MASTER_OF = { station: 'stations', truck: 'trucks', driver: 'drivers', agent: 'agents' } as const;

/** Where the row leads (its record as it is now), or null for a row with nothing to open. */
export function jumpOf(row: HistoryRow): Jump | null {
  switch (row.record) {
    case 'lr':
      return row.openId === null ? null : { to: 'lr', id: row.openId };
    case 'memo':
      return row.openId === null ? null : { to: 'memo', id: row.openId };
    case 'wasuli':
      return row.lrNo === null ? null : { to: 'wasuli', no: row.lrNo, ...(row.lrYear === null ? {} : { year: row.lrYear }) };
    case 'firm':
      return row.openId === null ? null : { to: 'account', id: row.openId };
    case 'station':
    case 'truck':
    case 'driver':
    case 'agent':
      return row.openId === null ? null : { to: 'master', kind: MASTER_OF[row.record], id: row.openId };
    default:
      return null;
  }
}

/** The label of the button that opens the row's record, or null when there is none. */
export function openLabel(row: HistoryRow, t: Words): string | null {
  if (jumpOf(row) === null) return null;
  switch (row.record) {
    case 'lr':
      return t.open.lr(String(row.lrNo ?? ''));
    case 'memo':
      return t.open.memo(String(row.challanNo ?? ''));
    case 'wasuli':
      return t.open.wasuli(String(row.lrNo ?? ''));
    case 'firm':
      return t.open.firm(row.name ?? '');
    default:
      return t.open.master(t.nouns[row.record ?? ''] ?? '', row.name ?? '');
  }
}
