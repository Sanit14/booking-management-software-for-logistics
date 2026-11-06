// What makes a Reports request acceptable (4.1). Pure: no database, no clock. A wrong period is refused; a wrong filter value is
// "no filter" (as the Firm Accounts filters); which filters a report actually uses is the keeper's business (reports.ts).
import { REPORT_FILTERS, type ReportCursor, type ReportKind, type ReportLrCursor, type ReportLrsFor, type ReportLrsRequest, type ReportQuery } from '../shared';
import { asRange } from './firmRules';
import { isDate, obj } from './lrRules';

/** The seven reports, in the order the screen lists them (the keys of REPORT_FILTERS). */
export const REPORT_KINDS = Object.keys(REPORT_FILTERS) as ReportKind[];
const MAX_TEXT = 100;
const MAX_KEY = 300;
/** A walk-in name as booked; the LR form allows far less, this only bounds what a request may carry. */
const MAX_NAME = 200;

const int = (o: Record<string, unknown>, k: string): number | null => (Number.isInteger(o[k]) ? (o[k] as number) : null);
const id = (o: Record<string, unknown>, k: string): number | null => {
  const n = int(o, k);
  return n !== null && n >= 1 ? n : null;
};

export const asReportKind = (v: unknown): ReportKind | null => REPORT_KINDS.find((k) => k === v) ?? null;
export const asPartySide = (v: unknown): 'consignor' | 'consignee' | null => (v === 'consignor' || v === 'consignee' ? v : null);

/** A real period and the filters; a filter of the wrong type is not set. Null when the period is not a real one. */
export function asReportQuery(v: unknown): ReportQuery | null {
  const o = obj(v);
  const range = asRange(v);
  if (!o || !range) return null;
  return {
    ...range,
    toStationId: id(o, 'toStationId'),
    text: typeof o.text === 'string' ? o.text.trim().slice(0, MAX_TEXT) : '',
    truckId: id(o, 'truckId'),
    agentId: id(o, 'agentId'),
  };
}

/** Where the next page of a report starts, or null for the first page. */
export function asReportCursor(v: unknown): ReportCursor | null {
  const o = obj(v);
  const no = o && int(o, 'no');
  return o && typeof o.key === 'string' && o.key !== '' && o.key.length <= MAX_KEY && no !== null && no >= 0 ? { key: o.key, no } : null;
}

/** Where the next page of a report's LRs starts (date, then number), or null for the first page. */
export function asReportLrCursor(v: unknown): ReportLrCursor | null {
  const o = obj(v);
  const no = o && int(o, 'no');
  return o && typeof o.date === 'string' && isDate(o.date) && no !== null && no >= 1 ? { date: o.date, no } : null;
}

function asLrsFor(v: unknown): ReportLrsFor | null {
  const o = obj(v);
  if (!o) return null;
  if (o.kind === 'stationWise') {
    const stationId = id(o, 'stationId');
    return stationId === null ? null : { kind: 'stationWise', stationId };
  }
  if (o.kind !== 'consignorWise' && o.kind !== 'consigneeWise') return null;
  if (o.firmId === null || o.firmId === undefined) {
    // A walk-in is matched on the name exactly as booked, so it is not trimmed.
    return typeof o.name === 'string' && o.name !== '' && o.name.length <= MAX_NAME ? { kind: o.kind, firmId: null, name: o.name } : null;
  }
  const firmId = id(o, 'firmId');
  return firmId === null ? null : { kind: o.kind, firmId, name: '' };
}

/** Which row's LRs, under which period and filters. */
export function asLrsRequest(v: unknown): ReportLrsRequest | null {
  const o = obj(v);
  const of = o && asLrsFor(o.of);
  const query = o && asReportQuery(o.query);
  return of && query ? { of, query } : null;
}
