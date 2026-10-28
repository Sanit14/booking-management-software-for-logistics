// Money is integer paise everywhere. This is the only place amounts are parsed, taxed and added up.
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

const PERCENT = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

/** "5" -> 500, "2.5" -> 250 (basis points). "" -> 0. Over 100, negative, 3 decimals or text throws. */
export function parsePercent(text: string): number {
  const t = text.trim();
  if (t === '') return 0;
  const m = PERCENT.exec(t);
  const bp = m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : NaN;
  if (!(bp <= 10000)) throw new Error(`invalid percent: ${JSON.stringify(text)}`);
  return bp;
}

/** 250 -> "2.5", 500 -> "5": basis points as the text a person would type. */
export function percentText(bp: number): string {
  if (!Number.isInteger(bp) || bp < 0 || bp > 10000) throw new Error(`invalid tax rate: ${String(bp)}`);
  return `${Math.floor(bp / 100)}${bp % 100 ? `.${String(bp % 100).padStart(2, '0').replace(/0$/, '')}` : ''}`;
}

/** Service tax on `basePaise` at `bp` basis points (500 = 5%), rounded half up. The only tax code. */
export function taxPaise(basePaise: number, bp: number): number {
  whole(basePaise, 'tax base');
  if (!Number.isInteger(bp) || bp < 0 || bp > 10000) throw new Error(`invalid tax rate: ${String(bp)}`);
  return Math.floor((whole(basePaise * bp, 'tax base') + 5000) / 10000);
}

/** A charge option from Settings, in paise. Same shape as DM's CartageRule. */
export interface ChargeRule {
  godownBhadaPaise: number;
  godownInsurancePaise: number;
  deliveryChargesPaise: number;
  hamaliPerDagPaise: number;
  hamaliFlatPaise: number;
  hamaliMode: 'perDag' | 'flat' | 'none';
}

/** What a rule fills into a new LR. Only hamali depends on the quantity (per dag); the rest is flat. */
export function chargesFor(rule: ChargeRule, qty: number) {
  whole(qty, 'quantity');
  const hamali =
    rule.hamaliMode === 'perDag' ? rule.hamaliPerDagPaise * qty : rule.hamaliMode === 'flat' ? rule.hamaliFlatPaise : 0;
  return {
    godownBhada: whole(rule.godownBhadaPaise, 'godown bhada'),
    godownInsurance: whole(rule.godownInsurancePaise, 'godown insurance'),
    deliveryCharges: whole(rule.deliveryChargesPaise, 'delivery charges'),
    hamali: whole(hamali, 'hamali'),
  };
}

/** The money columns of an LR row. */
export interface LrMoney {
  topay_paise: number;
  paid_paise: number;
  godown_bhada_paise: number;
  godown_insurance_paise: number;
  delivery_charges_paise: number;
  hamali_paise: number;
  pf_paise: number;
  stax_bp: number;
}

/** Freight is to pay or paid (never both); tax is on freight only; the total is the same for either mode. */
export function lrAmounts(lr: LrMoney) {
  if (lr.topay_paise > 0 && lr.paid_paise > 0) throw new Error('an LR cannot be both to pay and paid');
  const freight = whole(lr.topay_paise, 'to pay') + whole(lr.paid_paise, 'paid');
  const charges =
    whole(lr.godown_bhada_paise, 'godown bhada') +
    whole(lr.godown_insurance_paise, 'godown insurance') +
    whole(lr.delivery_charges_paise, 'delivery charges') +
    whole(lr.hamali_paise, 'hamali') +
    whole(lr.pf_paise, 'pf');
  const stax = taxPaise(freight, lr.stax_bp);
  return { freight, charges, stax, total: freight + charges + stax };
}
