// What makes a History request acceptable (4.2), and how an audit action is classified. Pure: no database, no clock.
// A wrong period is refused; a wrong filter value means "no filter" (as the Reports filters).
import { HISTORY_ACTIONS, HISTORY_KINDS, HISTORY_VERBS, type HistoryCursor, type HistoryFilters, type HistoryKind, type HistoryVerb } from '../shared';
import { asRange } from './firmRules';
import { obj } from './lrRules';

const MAX_SEAT = 50;

const int = (o: Record<string, unknown>, k: string): number | null => (Number.isInteger(o[k]) ? (o[k] as number) : null);
const number = (o: Record<string, unknown>, k: string): number | null => {
  const n = int(o, k);
  return n !== null && n >= 1 ? n : null;
};
const year = (o: Record<string, unknown>, k: string): number | null => {
  const n = int(o, k);
  return n !== null && n >= 2000 && n <= 2999 ? n : null;
};

/** The period and the filters of a History request; null when the period is not two real dates. */
export function asHistoryFilters(v: unknown): HistoryFilters | null {
  const o = obj(v);
  const range = asRange(v);
  if (!o || !range) return null;
  return {
    ...range,
    seat: typeof o.seat === 'string' ? o.seat.trim().slice(0, MAX_SEAT) : '',
    kind: HISTORY_KINDS.find((k) => k === o.kind) ?? null,
    verb: HISTORY_VERBS.find((x) => x === o.verb) ?? null,
    lrNo: number(o, 'lrNo'),
    lrYear: year(o, 'lrYear'),
    challanNo: number(o, 'challanNo'),
    challanYear: year(o, 'challanYear'),
    showPrints: o.showPrints === true,
  };
}

/** Where the next page starts (the last row shown), or null for the first page. */
export function asHistoryCursor(v: unknown): HistoryCursor | null {
  const o = obj(v);
  const id = o && int(o, 'id');
  return o && typeof o.at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(o.at) && id !== null && id >= 1 ? { at: o.at, id } : null;
}

/**
 * Two local days (both included) as the stored time: UTC, `YYYY-MM-DDTHH:mm:ss.sssZ`, so they compare as text with `audit_log.at`.
 * `toAt` is the start of the day after `to` (exclusive). "Local" is the keeper PC's clock, the one every date in the books uses.
 */
export function utcBounds(from: string, to: string): { fromAt: string; toAt: string } {
  const start = (day: string, plus: number) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + plus).toISOString();
  return { fromAt: start(from, 0), toAt: start(to, 1) };
}

const TABLE = new Map(Object.entries(HISTORY_ACTIONS));
const OTHER = { kind: 'other', verb: 'other' } as const;

/** The kind and verb of an audit row. A master change is told apart by its table (entity); any unknown action is `other`. */
export function classify(action: string, entity: string): { kind: HistoryKind; verb: HistoryVerb } {
  return TABLE.get(action.startsWith('masters.') ? `${action}:${entity}` : action) ?? OTHER;
}

/** The (action, entity) pairs a kind and / or verb stand for; `entity` is null where the action alone says it. */
export function conditionsFor(kind: HistoryKind | null, verb: HistoryVerb | null): { action: string; entity: string | null }[] {
  return [...TABLE]
    .filter(([, e]) => (kind === null || e.kind === kind) && (verb === null || e.verb === verb))
    .map(([key]) => {
      const [action, entity] = key.split(':');
      return { action, entity: entity ?? null };
    });
}
