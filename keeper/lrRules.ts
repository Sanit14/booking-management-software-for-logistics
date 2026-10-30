// What makes a typed LR acceptable. Pure: no database, no clock (the caller passes today). The money and quantity
// arrive as the TEXT the clerk typed; this is where they become numbers, so the screen never has to.
import type { ChargeOption, LrChange, LrDefaultsInput, LrEditField, LrField, LrFieldError, LrInput, LrParty } from '../shared';
import { cleanName } from './masterRules';
import { parsePercent, parseRupees, percentText } from './money';

export type LrErrors = Partial<Record<LrField, LrFieldError>>;

/** The typed numbers: paise, a count, basis points. A malformed one is 0 here and named in the errors. */
export interface LrNumbers {
  qty: number;
  toPay: number;
  paid: number;
  godownBhada: number;
  godownInsurance: number;
  deliveryCharges: number;
  hamali: number;
  wasuli: number;
  staxBp: number;
}

/** Rs 100 crore in paise: far above any LR, far below what `taxPaise` can multiply. */
const MAX_PAISE = 100_00_00_000 * 100;
const MONEY = ['toPay', 'paid', 'godownBhada', 'godownInsurance', 'deliveryCharges', 'hamali', 'wasuli'] as const;

const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const text = (o: Record<string, unknown>, k: string): string => (typeof o[k] === 'string' ? (o[k] as string) : '');
const int = (o: Record<string, unknown>, k: string): number | null => (Number.isInteger(o[k]) ? (o[k] as number) : null);

/**
 * The request body as an LrInput. A value of the wrong type becomes an empty one, so the rules above refuse it by
 * name (nothing is silently dropped); null only when there is no usable `uid`.
 */
export function asLrInput(v: unknown): LrInput | null {
  const o = obj(v);
  if (!o) return null;
  const uid = text(o, 'uid');
  if (uid === '' || uid.length > 64) return null;
  const partyOf = (k: string): LrParty => {
    const p = obj(o[k]) ?? {};
    return { firmId: int(p, 'firmId'), name: text(p, 'name'), addToFirms: p.addToFirms === true };
  };
  return {
    uid,
    date: typeof o.date === 'string' ? o.date : null,
    systemPin: text(o, 'systemPin'),
    fromStationId: int(o, 'fromStationId'),
    toStationId: int(o, 'toStationId'),
    consignor: partyOf('consignor'),
    consignee: partyOf('consignee'),
    particular: text(o, 'particular'),
    qty: text(o, 'qty'),
    toPay: text(o, 'toPay'),
    paid: text(o, 'paid'),
    chargeOption: text(o, 'chargeOption') as ChargeOption,
    godownBhada: text(o, 'godownBhada'),
    godownInsurance: text(o, 'godownInsurance'),
    deliveryCharges: text(o, 'deliveryCharges'),
    hamali: text(o, 'hamali'),
    wasuli: text(o, 'wasuli'),
    staxPercent: text(o, 'staxPercent'),
    confirmSimilar: o.confirmSimilar === true,
  };
}

export function asDefaultsInput(v: unknown): LrDefaultsInput {
  const o = obj(v) ?? {};
  return { bookingStationId: int(o, 'bookingStationId'), chargeOption: text(o, 'chargeOption') as ChargeOption, staxPercent: text(o, 'staxPercent') };
}

export const isChargeOption =(v: unknown): v is ChargeOption => v === 'option1' || v === 'option2' || v === 'blank';

/** Local calendar date, `YYYY-MM-DD` (not UTC: at 3 a.m. in India UTC is still yesterday). */
export function localDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** A real calendar date in `YYYY-MM-DD` form (2026-02-30 is not). */
export function isDate(text: string): boolean {
  const parsed = new Date(`${text}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

/** Only what is malformed in the typed numbers; an empty box is 0 (not "required"), so a preview can run on a half-filled form. */
export function parseNumbers(i: Pick<LrInput, 'qty' | 'staxPercent' | (typeof MONEY)[number]>): { n: LrNumbers; errors: LrErrors } {
  const errors: LrErrors = {};
  const n: LrNumbers = { qty: 0, toPay: 0, paid: 0, godownBhada: 0, godownInsurance: 0, deliveryCharges: 0, hamali: 0, wasuli: 0, staxBp: 0 };
  const qty = i.qty.trim();
  if (qty !== '') {
    if (/^\d{1,6}$/.test(qty) && Number(qty) >= 1) n.qty = Number(qty);
    else errors.qty = 'whole';
  }
  for (const f of MONEY) {
    try {
      n[f] = parseRupees(i[f]);
      // A stuck key must not reach the money maths (freight x tax would overflow a safe integer): refused by name.
      if (n[f] > MAX_PAISE) throw new Error('too big');
    } catch {
      n[f] = 0;
      errors[f] = 'amount';
    }
  }
  try {
    n.staxBp = parsePercent(i.staxPercent);
  } catch {
    errors.staxPercent = 'percent';
  }
  if (n.toPay > 0 && n.paid > 0) errors.paid = 'both';
  return { n, errors };
}

/** A consignor / consignee: a picked firm, or a walk-in name that cleans to 1-100 characters. `name` is null for a picked firm. */
function party(p: LrParty): { ok: boolean; name: string | null } {
  if (Number.isInteger(p.firmId)) return { ok: true, name: null };
  const name = cleanName(p.name);
  return { ok: name !== null, name };
}

/** Why an LR was cancelled: free text, trimmed, inner spaces collapsed, 1-200 characters; null when not acceptable. */
export function cleanReason(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const reason = v.replace(/\s+/g, ' ').trim();
  return reason.length >= 1 && reason.length <= 200 ? reason : null;
}

/** The columns an edit can change, in form order, with the box each one belongs to. The ids come with their names. */
const EDIT_COLUMNS: [LrEditField, string][] = [
  ['date', 'lr_date'], ['fromStation', 'from_station_id'], ['toStation', 'to_station_id'],
  ['consignor', 'consignor_name'], ['consignee', 'consignee_name'], ['particular', 'particular'], ['qty', 'qty'],
  ['chargeOption', 'charge_option'], ['toPay', 'topay_paise'], ['paid', 'paid_paise'], ['godownBhada', 'godown_bhada_paise'],
  ['godownInsurance', 'godown_insurance_paise'], ['deliveryCharges', 'delivery_charges_paise'], ['hamali', 'hamali_paise'],
  ['wasuli', 'wasuli_paise'], ['staxPercent', 'stax_bp'],
];
const EDIT_COLUMN_NAMES = [...EDIT_COLUMNS.map(([, c]) => c), 'consignor_id', 'consignee_id'];

type Row = Record<string, unknown>;

/** What an edit changed, as the audit row's before / after: only the columns that differ. Null when nothing differs. */
export function diffLr(was: object, now: object): { before: Row; after: Row } | null {
  const before: Row = {};
  const after: Row = {};
  for (const c of EDIT_COLUMN_NAMES) {
    const a = (was as Row)[c];
    const b = (now as Row)[c];
    if (a === b) continue;
    before[c] = a;
    after[c] = b;
  }
  return Object.keys(after).length > 0 ? { before, after } : null;
}

/**
 * An edit's audit pair as History lines in form order. `stationName` turns an id into a name; money stays paise
 * (the screen shows rupees). A firm picked for a walk-in of the same name changes an id only, which shows no line.
 */
export function changesOf(before: Row, after: Row, stationName: (id: unknown) => string | undefined): LrChange[] {
  const out: LrChange[] = [];
  for (const [field, column] of EDIT_COLUMNS) {
    if (!(column in after) || before[column] === after[column]) continue;
    const show = (v: unknown): string | number | null => {
      if (v === undefined || v === null) return null;
      if (field === 'fromStation' || field === 'toStation') return stationName(v) ?? String(v);
      if (field === 'staxPercent') return percentText(Number(v));
      return v as string | number;
    };
    out.push({ field, from: show(before[column]), to: show(after[column]) });
  }
  return out;
}

export interface CleanLr {
  errors: LrErrors;
  n: LrNumbers;
  /** The date the LR is dated: the typed one, or today. */
  date: string;
  /** The particular, trimmed. */
  particular: string;
  consignorName: string | null;
  consigneeName: string | null;
}

/** Every rule that needs no database. Stations and firms existing (and active) is checked where the database is. */
export function cleanLr(i: LrInput, today: string): CleanLr {
  const { n, errors } = parseNumbers(i);
  if (i.qty.trim() === '') errors.qty = 'required';

  const consignor = party(i.consignor);
  const consignee = party(i.consignee);
  if (!consignor.ok) errors.consignor = 'required';
  if (!consignee.ok) errors.consignee = 'required';

  const from = Number.isInteger(i.fromStationId);
  const to = Number.isInteger(i.toStationId);
  if (!from) errors.fromStation = 'required';
  if (!to) errors.toStation = 'required';
  else if (from && i.fromStationId === i.toStationId) errors.toStation = 'same';

  if (!isChargeOption(i.chargeOption)) errors.chargeOption = 'required';

  const particular = cleanName(i.particular);
  if (particular === null) errors.particular = 'required';

  const date = i.date ?? today;
  if (!isDate(date)) errors.date = 'date';
  else if (date > today) errors.date = 'future';

  return { errors, n, date, particular: particular ?? '', consignorName: consignor.name, consigneeName: consignee.name };
}
