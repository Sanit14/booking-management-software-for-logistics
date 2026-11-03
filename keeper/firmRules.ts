// What makes a Firm Accounts request acceptable, and the few numbers that are not SQL: the period before, growth %, the chart's
// months. Pure: no database, no clock (the caller passes today).
import type { FirmAccountCursor, FirmAccountFilters, FirmMonth, FirmRange, FirmRole, StatementCursor, StatementQuery } from '../shared';
import { isDate, obj } from './lrRules';

const ROLES: readonly FirmRole[] = ['both', 'consignor', 'consignee'];
const MAX_TEXT = 100;

const int = (o: Record<string, unknown>, k: string): number | null => (Number.isInteger(o[k]) ? (o[k] as number) : null);

/** `iso` moved by `n` whole days (negative = back). */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The period of the same number of days just before this one (DM's `previousPeriod`). */
export function previousPeriod(r: FirmRange): FirmRange {
  const days = Math.round((Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86_400_000) + 1;
  return { from: addDays(r.from, -days), to: addDays(r.from, -1) };
}

/**
 * How much `now` is above (+) or below (-) `before`, in whole percent, halves rounded up; null when there was nothing before.
 * Integer arithmetic only: exact while 200 × the amount stays under 2^53, that is up to about ₹45,000 crore (in paise).
 */
export function growthPct(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.floor((200 * (now - before) + before) / (2 * before));
}

/**
 * The 12 months of `year` for the growth chart. `byMonth` holds what SQL counted, keyed YYYY-MM, December of the year before
 * included (January is compared with it). The month in progress and later ones have no growth: half a month against a whole one
 * always looks like a fall.
 */
export function monthRows(year: number, byMonth: ReadonlyMap<string, { lrs: number; freightPaise: number }>, today: string): FirmMonth[] {
  const thisMonth = today.slice(0, 7);
  const at = (key: string) => byMonth.get(key) ?? { lrs: 0, freightPaise: 0 };
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`;
    const before = i === 0 ? `${year - 1}-12` : `${year}-${String(i).padStart(2, '0')}`;
    const { lrs, freightPaise } = at(month);
    return { month, lrs, freightPaise, growth: month >= thisMonth ? null : growthPct(freightPaise, at(before).freightPaise) };
  });
}

/** Two real dates, `from` not after `to`; null otherwise. */
export function asRange(v: unknown): FirmRange | null {
  const o = obj(v);
  if (!o || typeof o.from !== 'string' || typeof o.to !== 'string' || !isDate(o.from) || !isDate(o.to) || o.from > o.to) return null;
  return { from: o.from, to: o.to };
}

/** One firm, a period and a role (both when none is given); null when any of it is wrong. */
export function asStatementQuery(v: unknown): StatementQuery | null {
  const o = obj(v);
  const firmId = o && int(o, 'firmId');
  const range = asRange(v);
  const role = o?.role === undefined ? 'both' : ROLES.find((r) => r === o.role);
  return o && firmId !== null && firmId >= 1 && range && role ? { firmId, ...range, role } : null;
}

/** A calendar year as a number (2000 to 2999); null otherwise. */
export function asYear(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 2000 && v <= 2999 ? v : null;
}

export const asRole = (v: unknown): FirmRole | null => ROLES.find((r) => r === v) ?? null;

/** The firm list's filters from a request body; a bad value falls back (no text, no station, active only, any period). */
export function asAccountFilters(v: unknown): FirmAccountFilters {
  const o = obj(v) ?? {};
  const stationId = int(o, 'stationId');
  return {
    text: typeof o.text === 'string' ? o.text.trim().slice(0, MAX_TEXT) : '',
    stationId: stationId !== null && stationId >= 1 ? stationId : null,
    showInactive: o.showInactive === true,
    period: asRange(o.period),
  };
}

/** Where the next page of firms starts, or null for the first page. */
export function asAccountCursor(v: unknown): FirmAccountCursor | null {
  const o = obj(v);
  return o && typeof o.key === 'string' && o.key !== '' ? { key: o.key } : null;
}

/** Where the next page of the statement starts, or null for the first page. */
export function asStatementCursor(v: unknown): StatementCursor | null {
  const o = obj(v);
  const no = o && int(o, 'no');
  return o && no !== null && no >= 1 && typeof o.date === 'string' && isDate(o.date) ? { date: o.date, no } : null;
}
