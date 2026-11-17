// "Details of report" on the screen (4.6): what the window and the saved memo's card show, and the small decisions the window makes. Pure. The keeper works
// every figure out (`keeper/memoSettlement.ts`); this only picks the words and places the decimal point and the minus sign.
import type { MemoFieldError, MemoSettlement, PendingTotals, SettlementPreview } from '../../shared';
import { strings } from '../strings';
import type { Box } from './memoPick';
import { formatFixed, formatWhole } from './rupees';
import { matchKey } from './typeAhead';

const t = strings.memo.details;

/** The commission as typed: 1000 → "10", 825 → "8.25", 850 → "8.5" (the keeper has the same rule for paper and History). Display only. */
export function percentText(bp: number): string {
  const percent = Math.floor(bp / 100);
  const frac = String(bp % 100).padStart(2, '0').replace(/0+$/, '');
  return frac === '' ? String(percent) : `${percent}.${frac}`;
}

export interface SettlementLine {
  key: 'toPay' | 'hamaliLess' | 'total1' | 'commissionLess' | 'total2' | 'wasuli' | 'net';
  label: string;
  /** "177 × 0.40" next to hamali, "10 %" next to commission; null for the other lines. */
  how: string | null;
  /** The amount with two decimals and a minus sign when below zero. */
  value: string;
  /** `rule`: a line under it (something was taken off); `total`: a running total, bold. */
  weight: 'plain' | 'rule' | 'total';
}

/** The steps of a settlement in the old paper's order, for the window and for the card on a saved memo. Paid is not a step: it only sets the commission's base. */
export function settlementLines(s: MemoSettlement): SettlementLine[] {
  return [
    { key: 'toPay', label: t.toPay, how: null, value: formatFixed(s.toPayPaise), weight: 'plain' },
    { key: 'hamaliLess', label: t.hamaliLess, how: t.hamaliHow(s.articles, formatFixed(s.ratePaise)), value: formatFixed(s.hamaliLessPaise), weight: 'rule' },
    { key: 'total1', label: t.total, how: null, value: formatFixed(s.total1Paise), weight: 'total' },
    { key: 'commissionLess', label: t.commissionLess, how: t.commissionHow(percentText(s.commissionBp)), value: formatFixed(s.commissionLessPaise), weight: 'rule' },
    { key: 'total2', label: t.total, how: null, value: formatFixed(s.total2Paise), weight: 'total' },
    { key: 'wasuli', label: t.plusWasuli, how: null, value: formatFixed(s.wasuliPaise), weight: 'rule' },
    { key: 'net', label: t.net, how: null, value: formatFixed(s.netPaise), weight: 'total' },
  ];
}

/** The window before any figure has come back (or while the text is not a number): the known totals, every step a dash. */
export function blankLines(totals: PendingTotals): SettlementLine[] {
  const zero: MemoSettlement = {
    articles: totals.qty, paidPaise: totals.paidPaise, toPayPaise: totals.toPayPaise, wasuliPaise: totals.wasuliPaise, ratePaise: 0, commissionBp: 0, commissionBasePaise: 0,
    hamaliLessPaise: 0, total1Paise: 0, commissionLessPaise: 0, total2Paise: 0, netPaise: 0, roundRupees: 0,
  };
  return settlementLines(zero).map((l) => (l.key === 'toPay' || l.key === 'wasuli' ? l : { ...l, how: null, value: strings.memo.none }));
}

/** The round figure: whole rupees, Indian grouping, a minus sign when below zero. */
export const roundText = (s: MemoSettlement): string => formatWhole(s.roundRupees);

/** What the keeper answered for the text that was typed then. */
export interface SettlementAnswer {
  rate: string;
  commission: string;
  preview: SettlementPreview;
}

/** The answer is for exactly what is typed now, has no error and has its figures: a memo may be saved. Any other text typed since makes it not ready. */
export function previewReady(a: SettlementAnswer | null, rate: string, commission: string): boolean {
  return a !== null && a.rate === rate && a.commission === commission && a.preview.settlement !== null && Object.keys(a.preview.errors).length === 0;
}

/**
 * The messages to show under the two boxes: a wrong value at once, an empty one only after the clerk tried to save (`attempted`), and nothing from an
 * answer to text that is not what is typed now.
 */
export function windowErrors(a: SettlementAnswer | null, rate: string, commission: string, attempted: boolean): { hamaliRate?: string; commission?: string } {
  if (!a || a.rate !== rate || a.commission !== commission) return {};
  const out: { hamaliRate?: string; commission?: string } = {};
  const r = a.preview.errors.hamaliRate;
  const c = a.preview.errors.commission;
  if (r && (rate.trim() !== '' || attempted)) out.hamaliRate = t.fieldError.rate[r] ?? r;
  if (c && (commission.trim() !== '' || attempted)) out.commission = t.fieldError.commission[c] ?? c;
  return out;
}

/**
 * The seat's save key in the window: one press, one try. Not a held key, not while a save is in flight, not when another dialog (a PIN) is in front. What the
 * try does when the figures are not ready (mark the boxes, go to the first one to fix) is the caller's.
 */
export const saveKeyWanted = (e: { isSaveKey: boolean; repeat: boolean; topmost: boolean; saving: boolean }): boolean => e.isSaveKey && !e.repeat && e.topmost && !e.saving;

/** The words for a refused rate or commission (the keeper's `memoFields`): the rate first, else the commission. */
export function settlementRefusal(fields: Partial<Record<string, MemoFieldError>> | undefined): string {
  const rate = fields?.hamaliRate;
  return rate ? (t.fieldError.rate[rate] ?? rate) : (t.fieldError.commission[fields?.commission ?? 'amount'] ?? 'amount');
}

// ---- the truck boxes of a new memo, now inside the window (4.7) ----

/** A master row offered in a box. */
interface Opt {
  id: string;
  label: string;
}
export interface HeaderBoxes {
  truck: Box;
  driver: Box;
  from: Box;
  to: Box;
}
export interface HeaderOptions {
  trucks: Opt[];
  drivers: Opt[];
  stations: Opt[];
}
export interface HeaderIds {
  truckId: number;
  driverId: number;
  fromId: number;
  toId: number;
}
export type HeaderField = 'truck' | 'driver' | 'fromStation' | 'toStation';

/**
 * The four boxes as master rows: the one picked, else a name typed in full that is exactly in the list. A box that is empty is `required`, one that is
 * typed but is not in its list is `missing` (the clerk fixes it before anything is sent). Nothing is sent from here.
 */
export function resolveHeader(b: HeaderBoxes, o: HeaderOptions): { ok: true; ids: HeaderIds } | { ok: false; problems: Partial<Record<HeaderField, 'required' | 'missing'>> } {
  const find = (box: Box, options: Opt[]): number | null => {
    if (box.id !== null) return box.id;
    const hit = options.find((x) => matchKey(x.label) === matchKey(box.text));
    return hit ? Number(hit.id) : null;
  };
  const ids = { truckId: find(b.truck, o.trucks), driverId: find(b.driver, o.drivers), fromId: find(b.from, o.stations), toId: find(b.to, o.stations) };
  const problems: Partial<Record<HeaderField, 'required' | 'missing'>> = {};
  const need = (field: HeaderField, box: Box, id: number | null) => {
    if (id === null) problems[field] = box.text.trim() === '' ? 'required' : 'missing';
  };
  need('truck', b.truck, ids.truckId);
  need('driver', b.driver, ids.driverId);
  need('fromStation', b.from, ids.fromId);
  need('toStation', b.to, ids.toId);
  if (ids.truckId === null || ids.driverId === null || ids.fromId === null || ids.toId === null) return { ok: false, problems };
  return { ok: true, ids: { truckId: ids.truckId, driverId: ids.driverId, fromId: ids.fromId, toId: ids.toId } };
}

/** What the screen does with the keeper's refusal of a save from the window. */
export type RefusalStep =
  | 'recheck' // only the rate or the % was refused: the window stays and asks for its figures again
  | 'mark' // a header box was refused: the window stays open and the boxes are marked
  | 'taken' // another seat loaded a ticked LR first: the window closes and says which
  | 'open' // the memo was saved already: show it
  | 'forget-date' // the PIN that unlocked the date no longer works: back to today
  | 'toast';

export function refusalStep(code: string, memoFields?: Partial<Record<string, MemoFieldError>>): RefusalStep {
  if (code === 'memo-already-saved') return 'open';
  if (code === 'memo-conflict') return 'taken';
  if (code === 'wrong-pin' || code === 'pin-locked') return 'forget-date';
  if (code === 'memo-invalid') {
    const keys = Object.keys(memoFields ?? {});
    return keys.length > 0 && keys.every((k) => k === 'hamaliRate' || k === 'commission') ? 'recheck' : 'mark';
  }
  return 'toast';
}

/** "Next: memo details" works only with at least one LR ticked (and not past what a memo can carry: the caller says). */
export const nextEnabled = (ticked: number, limit: number): boolean => ticked > 0 && ticked <= limit;
