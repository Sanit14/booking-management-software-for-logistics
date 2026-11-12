// What makes a loading memo acceptable. Pure: no database, no clock (the caller passes today). Money arrives as the
// TEXT the clerk typed; this is where it becomes paise, so the screen never has to.
import { MAX_MEMO_LRS, type MemoCursor, type MemoField, type MemoFieldError, type MemoFilters, type MemoHeaderInput, type MemoInput, type PartyFilter, type SavedMemoFilters } from '../shared';
import { isDate, MAX_PAISE, obj } from './lrRules';
import { parseRupees } from './money';

export type MemoErrors = Partial<Record<MemoField, MemoFieldError>>;

const MAX_TEXT = 100;

const text = (o: Record<string, unknown>, k: string): string => (typeof o[k] === 'string' ? (o[k] as string) : '');
const int = (o: Record<string, unknown>, k: string): number | null => (Number.isInteger(o[k]) ? (o[k] as number) : null);

/**
 * The request body as a MemoInput. A value of the wrong type becomes an empty one, so the rules below refuse it by
 * name (nothing is silently dropped): an LR id that is not a whole number above 0 is kept as 0, which no LR has.
 * Null only when there is no usable `uid`.
 */
export function asMemoInput(v: unknown): MemoInput | null {
  const o = obj(v);
  if (!o) return null;
  const uid = text(o, 'uid');
  if (uid === '' || uid.length > 64) return null;
  return {
    uid,
    date: typeof o.date === 'string' ? o.date : null,
    systemPin: text(o, 'systemPin'),
    truckId: int(o, 'truckId'),
    driverId: int(o, 'driverId'),
    fromStationId: int(o, 'fromStationId'),
    toStationId: int(o, 'toStationId'),
    truckHire: text(o, 'truckHire'),
    loadingHamali: text(o, 'loadingHamali'),
    hamaliRate: text(o, 'hamaliRate'),
    commission: text(o, 'commission'),
    lrIds: asLrIds(o.lrIds),
  };
}

/** The LR ids of a request. A value that is not a whole number above 0 is kept as 0, which no LR has, so the rules refuse it by name. */
export function asLrIds(v: unknown): number[] {
  return Array.isArray(v) ? v.map((id) => (Number.isInteger(id) && (id as number) >= 1 ? (id as number) : 0)) : [];
}

/** Ids for a read (the live totals): the whole numbers above 0, at most MAX_MEMO_LRS of them. */
export function asIds(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((id): id is number => Number.isInteger(id) && id >= 1).slice(0, MAX_MEMO_LRS) : [];
}

export interface CleanHeader {
  errors: MemoErrors;
  /** The date the memo is dated: the typed one, or today. */
  date: string;
  hirePaise: number;
  hamaliPaise: number;
}

/** The rules of a memo's header, for a new memo and for an edit alike. Existing (and active) truck, driver and stations are checked where the database is. */
export function cleanHeader(i: MemoHeaderInput, today: string): CleanHeader {
  const errors: MemoErrors = {};
  const paise = (field: 'truckHire' | 'loadingHamali'): number => {
    try {
      const n = parseRupees(i[field]);
      if (n > MAX_PAISE) throw new Error('too big');
      return n;
    } catch {
      errors[field] = 'amount';
      return 0;
    }
  };
  const hirePaise = paise('truckHire');
  const hamaliPaise = paise('loadingHamali');

  if (!Number.isInteger(i.truckId)) errors.truck = 'required';
  if (!Number.isInteger(i.driverId)) errors.driver = 'required';
  const from = Number.isInteger(i.fromStationId);
  const to = Number.isInteger(i.toStationId);
  if (!from) errors.fromStation = 'required';
  if (!to) errors.toStation = 'required';
  else if (from && i.fromStationId === i.toStationId) errors.toStation = 'same';

  const date = i.date ?? today;
  if (!isDate(date)) errors.date = 'date';
  else if (date > today) errors.date = 'future';

  return { errors, date, hirePaise, hamaliPaise };
}

export interface CleanSettlement {
  errors: MemoErrors;
  /** The hamali rate per article in paise, 0 when it is wrong. */
  ratePaise: number;
  /** The commission % × 100, 0 when it is wrong. */
  commissionBp: number;
}

// 1 to 6 digits and at most 2 decimals: "10", "8.25", "100.00". A value over 100 is a `percent` error, not an `amount` one.
const PERCENT = /^(\d{1,6})(?:\.(\d{1,2}))?$/;

/**
 * The two boxes of "Details of report": the hamali rate (rupees, at most 2 decimals) and the commission % (0 to 100, at most 2 decimals). Both must be
 * typed: an empty box is `required`, never read as 0 (a 0 is allowed, but the clerk has to type it).
 */
export function cleanSettlement(i: { hamaliRate: string; commission: string }): CleanSettlement {
  const errors: MemoErrors = {};
  let ratePaise = 0;
  let commissionBp = 0;

  const rate = i.hamaliRate.trim();
  if (rate === '') errors.hamaliRate = 'required';
  else {
    try {
      ratePaise = parseRupees(rate);
      if (ratePaise > MAX_PAISE) throw new Error('too big');
    } catch {
      errors.hamaliRate = 'amount';
      ratePaise = 0;
    }
  }

  const percent = i.commission.trim();
  if (percent === '') errors.commission = 'required';
  else {
    const m = PERCENT.exec(percent);
    if (!m) errors.commission = 'amount';
    else {
      const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
      if (bp > 10000) errors.commission = 'percent';
      else commissionBp = bp;
    }
  }
  return { errors, ratePaise, commissionBp };
}

export interface CleanMemo extends CleanHeader {
  /** The ticked LRs, each once. */
  ids: number[];
  ratePaise: number;
  commissionBp: number;
}

/** The LR ids of a request, each once: 1 to MAX_MEMO_LRS whole numbers above 0, else the error to answer with. */
export function cleanIds(lrIds: number[]): { ids: number[]; error: MemoFieldError | null } {
  const ids = [...new Set(lrIds)];
  const error = ids.length === 0 ? 'required' : ids.length > MAX_MEMO_LRS ? 'many' : ids.some((id) => !Number.isInteger(id) || id < 1) ? 'missing' : null;
  return { ids, error };
}

/** Every rule that needs no database. Truck, driver, stations and LRs existing (and being active / booked) is checked where the database is. */
export function cleanMemo(i: MemoInput, today: string): CleanMemo {
  const h = cleanHeader(i, today);
  const { ids, error } = cleanIds(i.lrIds);
  if (error) h.errors.lrs = error;
  const s = cleanSettlement(i);
  Object.assign(h.errors, s.errors);
  return { ...h, ids, ratePaise: s.ratePaise, commissionBp: s.commissionBp };
}

/** The request body as a header for an edit (a date left out keeps the memo's own). Null when it is not an object. */
export function asHeaderInput(v: unknown): MemoHeaderInput | null {
  const o = obj(v);
  if (!o) return null;
  return {
    date: typeof o.date === 'string' ? o.date : null,
    truckId: int(o, 'truckId'),
    driverId: int(o, 'driverId'),
    fromStationId: int(o, 'fromStationId'),
    toStationId: int(o, 'toStationId'),
    truckHire: text(o, 'truckHire'),
    loadingHamali: text(o, 'loadingHamali'),
  };
}

/** The saved-memos filters from a request body; like the pending filters, a bad value means "no bound". */
export function asSavedFilters(v: unknown): SavedMemoFilters {
  const o = obj(v) ?? {};
  return { from: day(o.from), to: day(o.to), truckId: int(o, 'truckId'), toStationId: int(o, 'toStationId') };
}

const day = (v: unknown): string | null => (typeof v === 'string' && isDate(v) ? v : null);

/** A consignor / consignee filter: a picked firm, else typed text (trimmed, at most 100 characters), else no filter. */
function party(v: unknown): PartyFilter | null {
  const o = obj(v);
  if (!o) return null;
  const firmId = int(o, 'firmId');
  if (firmId !== null) return { firmId, text: '' };
  const typed = text(o, 'text').trim().slice(0, MAX_TEXT);
  return typed === '' ? null : { firmId: null, text: typed };
}

/** The pending-list filters from a request body. A bad date or station means "no bound", never an error: it only shows more. */
export function asPendingFilters(v: unknown): MemoFilters {
  const o = obj(v) ?? {};
  return { from: day(o.from), to: day(o.to), toStationId: int(o, 'toStationId'), consignor: party(o.consignor), consignee: party(o.consignee) };
}

/** Where the next page of pending LRs starts, or null for the first page. */
export function asCursor(v: unknown): MemoCursor | null {
  const o = obj(v);
  const date = o && day(o.date);
  const no = o && int(o, 'no');
  return date && no !== null && no >= 1 ? { date, no } : null;
}
