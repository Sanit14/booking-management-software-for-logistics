// "Details of report" on the screen (4.6): what the window and the saved memo's card show, and the small decisions the window makes. Pure. The keeper works
// every figure out (`keeper/memoSettlement.ts`); this only picks the words and places the decimal point and the minus sign.
import type { MemoFieldError, MemoSettlement, PendingTotals, SettlementPreview } from '../../shared';
import { strings } from '../strings';
import { formatFixed, formatWhole } from './rupees';

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
