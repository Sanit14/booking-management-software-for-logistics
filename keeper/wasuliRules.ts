// What makes a wasuli request acceptable. Pure: no database, no clock (the caller passes today). The collect amount
// arrives as the TEXT the clerk typed; this is where it becomes paise, so the screen never has to.
import { MAX_WASULI_BATCH, type WasuliCollectInput, type WasuliCursor, type WasuliField, type WasuliFieldError, type WasuliFilters, type WasuliMode, type WasuliPeriod, type WasuliSeen, type WasuliStatus } from '../shared';
import { localDate, MAX_PAISE, obj } from './lrRules';
import { parseRupees } from './money';

export const MAX_REMARK = 200;
const STATUSES: readonly WasuliStatus[] = ['unassigned', 'assigned', 'collected'];
const MODES: readonly WasuliMode[] = ['cash', 'upi', 'card'];
const PERIOD_DAYS: Record<WasuliPeriod, number> = { week: 7, month: 30 };

const text = (o: Record<string, unknown>, k: string): string => (typeof o[k] === 'string' ? (o[k] as string) : '');
const int = (o: Record<string, unknown>, k: string): number | null => (Number.isInteger(o[k]) ? (o[k] as number) : null);
const isStatus = (v: unknown): v is WasuliStatus => STATUSES.includes(v as WasuliStatus);
const isPeriod = (v: unknown): v is WasuliPeriod => v === 'week' || v === 'month';

/** What a screen saw of one row (id, status, agent, version), or null when the request does not say so properly. */
export function asSeen(v: unknown): WasuliSeen | null {
  const o = obj(v);
  const id = o && int(o, 'id');
  const version = o && int(o, 'version');
  if (!o || id === null || id < 1 || version === null || version < 1 || !isStatus(o.status)) return null;
  const agentId = o.agentId === null ? null : int(o, 'agentId');
  return o.agentId !== null && (agentId === null || agentId < 1) ? null : { id, status: o.status, agentId, version };
}

/** A batch of seen rows: 1 to 500, each row once; null when any is badly formed or there are too many. */
export function asSeenList(v: unknown): WasuliSeen[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_WASULI_BATCH) return null;
  const seen = v.map(asSeen);
  if (seen.some((s) => s === null)) return null;
  const rows = seen as WasuliSeen[];
  return new Set(rows.map((s) => s.id)).size === rows.length ? rows : null;
}

/** The list filters from a request body; a bad value falls back (first tab, no agent, last 7 days), it only shows less or more. */
export function asWasuliFilters(v: unknown): WasuliFilters {
  const o = obj(v) ?? {};
  const agentId = int(o, 'agentId');
  return { tab: isStatus(o.tab) ? o.tab : 'unassigned', agentId: agentId !== null && agentId >= 1 ? agentId : null, period: isPeriod(o.period) ? o.period : 'week' };
}

export const asPeriod = (v: unknown): WasuliPeriod => (isPeriod(v) ? v : 'week');

/** Where the next page starts, or null for the first page. */
export function asWasuliCursor(v: unknown): WasuliCursor | null {
  const o = obj(v);
  const no = o && int(o, 'no');
  if (!o || no === null || no < 1) return null;
  const day = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(text(o, k)) ? text(o, k) : null);
  const a = o.a === '' ? '' : day('a');
  const date = day('date');
  return a !== null && date !== null ? { a, date, no } : null;
}

/** The first day of "the last 7 / 30 days" counting today as one of them. */
export function periodStart(today: string, period: WasuliPeriod): string {
  const [y, m, d] = today.split('-').map(Number);
  return localDate(new Date(y, m - 1, d - (PERIOD_DAYS[period] - 1)));
}

/** Whole days from `from` to `today` (never below 0). */
export function daysBetween(from: string, today: string): number {
  const at = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.max(0, Math.round((at(today) - at(from)) / 86_400_000));
}

/** A remark: trimmed, runs of spaces made one, empty allowed, at most 200 characters; null when it is not acceptable. */
export function cleanRemark(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const remark = v.replace(/\s+/g, ' ').trim();
  return remark.length <= MAX_REMARK ? remark : null;
}

export interface CleanCollect {
  /** Paise; 0 when the amount is not acceptable (see `errors`). */
  paise: number;
  mode: WasuliMode;
  remark: string;
  errors: Partial<Record<WasuliField, WasuliFieldError>>;
}

/** The request body as a collect input. A value of the wrong type becomes an empty one, so the rules below refuse it by name. */
export function asCollectInput(v: unknown): WasuliCollectInput {
  const o = obj(v) ?? {};
  return { amount: text(o, 'amount'), mode: MODES.includes(o.mode as WasuliMode) ? (o.mode as WasuliMode) : null, remark: text(o, 'remark') };
}

/** Every rule of a collection that needs no database: an amount above 0, a mode, a short remark. "At most the wasuli amount" is checked where the row is. */
export function cleanCollect(i: WasuliCollectInput): CleanCollect {
  const errors: CleanCollect['errors'] = {};
  let paise = 0;
  if (i.amount.trim() === '') errors.amount = 'required';
  else {
    try {
      paise = parseRupees(i.amount);
      if (paise < 1 || paise > MAX_PAISE) throw new Error('out of range');
    } catch {
      paise = 0;
      errors.amount = 'amount';
    }
  }
  if (!MODES.includes(i.mode as WasuliMode)) errors.mode = 'required';
  const remark = cleanRemark(i.remark);
  if (remark === null) errors.remark = 'long';
  return { paise, mode: (i.mode ?? 'cash') as WasuliMode, remark: remark ?? '', errors };
}
