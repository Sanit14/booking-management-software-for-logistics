// The settlement of a loading memo ("Details of report", 4.6). Pure: no database, no clock. It is the ONE place the steps are worked out: the keeper
// stores its net and round figure on the memo, and the screen, the print and History show what the keeper hands out from here. There is no SQL twin
// (the memo freezes net and round figure when it is saved, so SQL only reads them) and no copy in the screen (CLAUDE.md rule 2).
//
// Everything is whole paise. Only this function and its formatters may be negative: `money.ts` still refuses a negative amount.
//   hamali less = articles × rate         total 1 = to pay − hamali less          (paid is NOT added)
//   commission  = % × (to pay + paid), rounded half up to the paisa (DM's rule)    total 2 = total 1 − commission
//   net         = total 2 + wasuli        round figure = net to the rupee, .50 away from zero (DM's `roundRupee`)
import { MAX_MEMO_LRS, type MemoSettlement } from '../shared';
import { MAX_PAISE } from './lrRules';
import { inr } from './money';

/** The frozen totals of a memo that the settlement is worked from (a `MemoTotals` fits). */
export interface SettlementInput {
  qty: number;
  toPayPaise: number;
  paidPaise: number;
  wasuliPaise: number;
}

function whole(n: number, what: string): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`invalid ${what}: ${String(n)}`);
  return n;
}

/** The most a memo's hamali less can be: what 500 LRs at the largest LR amount add up to. Past it a figure is refused, never stored. */
const LIMIT = BigInt(MAX_MEMO_LRS) * BigInt(MAX_PAISE);

/** Net paise to whole rupees, .50 away from zero: 1,024,050 → 10,241 · 1,024,049 → 10,240 · −12,050 → −121. A small negative net is 0, never −0. */
export function roundRupees(netPaise: number): number {
  if (!Number.isSafeInteger(netPaise)) throw new Error(`invalid net: ${String(netPaise)}`);
  const rupees = Math.floor((Math.abs(netPaise) + 50) / 100);
  return netPaise < 0 && rupees > 0 ? -rupees : rupees;
}

/**
 * Every step in integer paise, or null when the hamali less is past what a memo can hold (the caller refuses it as a rate error). The inputs must be
 * whole and non-negative (they are sums of LR amounts); `commissionBp` is the % × 100, 0 to 10 000. The two products are BigInt: 500 LRs at the
 * limit times 10 000 passes 2^53, where a plain number would round without saying so.
 */
export function memoSettlement(t: SettlementInput, ratePaise: number, commissionBp: number): MemoSettlement | null {
  const articles = whole(t.qty, 'quantity');
  const toPay = whole(t.toPayPaise, 'to pay');
  const paid = whole(t.paidPaise, 'paid');
  const wasuli = whole(t.wasuliPaise, 'wasuli');
  const rate = whole(ratePaise, 'rate');
  const bp = whole(commissionBp, 'commission');
  if (bp > 10000) throw new Error(`invalid commission: ${String(bp)}`);

  const hamali = BigInt(articles) * BigInt(rate);
  if (hamali > LIMIT) return null;
  const hamaliLess = Number(hamali);
  const base = BigInt(toPay) + BigInt(paid);
  const commissionLess = Number((base * BigInt(bp) + BigInt(5000)) / BigInt(10000)); // + 5000 of 10 000 = round half up
  const total1 = toPay - hamaliLess;
  const total2 = total1 - commissionLess;
  const net = total2 + wasuli;
  return {
    articles, paidPaise: paid, toPayPaise: toPay, wasuliPaise: wasuli, ratePaise: rate, commissionBp: bp, commissionBasePaise: Number(base),
    hamaliLessPaise: hamaliLess, total1Paise: total1, commissionLessPaise: commissionLess, total2Paise: total2, netPaise: net, roundRupees: roundRupees(net),
  };
}

/** 10240.90 as "10,240.90", −12050 as "-120.50": `money.inr` (Indian grouping, two decimals) with a minus sign allowed. */
export function signedInr(paise: number): string {
  if (!Number.isSafeInteger(paise)) throw new Error(`invalid amount: ${String(paise)}`);
  return paise < 0 ? `-${inr(-paise)}` : inr(paise);
}

/** Whole rupees with Indian grouping and a minus sign allowed: 10241 → "10,241", −121 → "-121". */
export function signedRupees(rupees: number): string {
  if (!Number.isSafeInteger(rupees)) throw new Error(`invalid rupees: ${String(rupees)}`);
  return signedInr(rupees * 100).slice(0, -3);
}

/** The commission as typed: 1000 → "10", 825 → "8.25", 850 → "8.5", 5 → "0.05" (no trailing zeros). */
export function percentText(bp: number): string {
  const percent = Math.floor(bp / 100);
  const frac = String(bp % 100).padStart(2, '0').replace(/0+$/, '');
  return frac === '' ? String(percent) : `${percent}.${frac}`;
}
