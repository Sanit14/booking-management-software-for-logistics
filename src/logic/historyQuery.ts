// What the History screen asks the keeper for. Pure: the dates come from the keeper PC's today (the screen reads no clock of its own), and
// the keeper still checks every period and filter — nothing here is a business rule.
import type { FirmRange, HistoryFilters, HistoryKind, HistoryVerb } from '../../shared';
import { isRange, periodOf } from './firmPeriod';

export type HistoryPreset = 'week' | 'today' | 'month' | 'lastMonth' | 'custom';

/** What was chosen on the History page, as typed / picked. '' = no filter. */
export interface HistoryView {
  preset: HistoryPreset;
  from: string;
  to: string;
  seat: string;
  kind: '' | Exclude<HistoryKind, 'other'>;
  verb: '' | Exclude<HistoryVerb, 'other'>;
  /** "12" or "12/2025". */
  lr: string;
  challan: string;
  showPrints: boolean;
}

export const START_VIEW: HistoryView = { preset: 'week', from: '', to: '', seat: '', kind: '', verb: '', lr: '', challan: '', showPrints: false };

/** `iso` (YYYY-MM-DD) moved by `days`, calendar days. */
export const addDays = (iso: string, days: number): string => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + days)).toISOString().slice(0, 10);

/** The period a view means on `today`: the last 7 days are today and the six before. A custom period is whatever was typed (check it with `isRange`). */
export function periodFor(v: Pick<HistoryView, 'preset' | 'from' | 'to'>, today: string): FirmRange {
  if (v.preset === 'custom') return { from: v.from, to: v.to };
  if (v.preset === 'week') return { from: addDays(today, -6), to: today };
  return periodOf(v.preset, today);
}

/** A number box: empty (no filter), "12" (this year's) or "12/2025", else invalid. */
export function parseNumber(text: string): { no: number; year: number | null } | 'empty' | 'invalid' {
  const t = text.trim();
  if (t === '') return 'empty';
  const m = /^(\d{1,9})\s*(?:\/\s*(\d{4}))?$/.exec(t);
  if (!m || Number(m[1]) < 1) return 'invalid';
  return { no: Number(m[1]), year: m[2] === undefined ? null : Number(m[2]) };
}

/**
 * The request for a view, or null while the period is not two real days in order or a number box is not a number. `typed` is the text
 * boxes after their short wait.
 */
export function queryOf(v: HistoryView, today: string, typed: Pick<HistoryView, 'seat' | 'lr' | 'challan'>): HistoryFilters | null {
  const range = periodFor(v, today);
  if (!isRange(range.from, range.to)) return null;
  const lr = parseNumber(typed.lr);
  const challan = parseNumber(typed.challan);
  if (lr === 'invalid' || challan === 'invalid') return null;
  return {
    ...range,
    seat: typed.seat.trim(),
    kind: v.kind === '' ? null : v.kind,
    verb: v.verb === '' ? null : v.verb,
    lrNo: lr === 'empty' ? null : lr.no,
    lrYear: lr === 'empty' ? null : lr.year,
    challanNo: challan === 'empty' ? null : challan.no,
    challanYear: challan === 'empty' ? null : challan.year,
    showPrints: v.showPrints,
  };
}
