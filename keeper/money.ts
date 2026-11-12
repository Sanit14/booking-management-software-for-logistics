// Money is integer paise everywhere. This is the only place amounts are parsed and added up.
// Pure: no database. Every function refuses input that is not a whole, non-negative paise amount.

function whole(n: number, what: string): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`invalid ${what}: ${String(n)}`);
  return n;
}

// Western (1,250,000) or Indian (12,50,000) thousands commas, or none; at most 2 decimals.
const RUPEES = /^(\d{1,3}(?:,\d{3})*|\d{1,2}(?:,\d{2})*,\d{3}|\d+)(?:\.(\d{1,2}))?$/;

/** "1,250.50" -> 125050. "" -> 0. Anything else that is not an amount throws. */
export function parseRupees(text: string): number {
  const t = text.trim();
  if (t === '') return 0;
  const m = RUPEES.exec(t);
  if (!m) throw new Error(`invalid amount: ${JSON.stringify(text)}`);
  const paise = Number(m[1].replace(/,/g, '')) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(paise)) throw new Error(`invalid amount: ${JSON.stringify(text)}`);
  return paise;
}

/** 123456789 -> "12,34,567.89": the amount as printed on paper, Indian grouping, always two decimals, no sign. */
export function inr(paise: number): string {
  const rupees = String(Math.floor(whole(paise, 'amount') / 100));
  const head = rupees.length > 3 ? `${rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},` : '';
  return `${head}${rupees.slice(-3)}.${String(paise % 100).padStart(2, '0')}`;
}

/** The money columns of an LR row that count: freight (to pay or paid) and hamali. The older charge and tax columns stay in the table and count for nothing. */
export interface LrMoney {
  topay_paise: number;
  paid_paise: number;
  hamali_paise: number;
}

/** Freight is to pay or paid (never both); the total is freight + hamali, the same for either mode. No tax. */
export function lrAmounts(lr: LrMoney) {
  if (lr.topay_paise > 0 && lr.paid_paise > 0) throw new Error('an LR cannot be both to pay and paid');
  const freight = whole(lr.topay_paise, 'to pay') + whole(lr.paid_paise, 'paid');
  const hamali = whole(lr.hamali_paise, 'hamali');
  return { freight, hamali, total: freight + hamali };
}
