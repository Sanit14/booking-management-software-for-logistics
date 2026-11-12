import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MEMO_LRS, type MemoSettlement } from '../shared';
import { MAX_PAISE } from './lrRules';
import { memoSettlement, percentText, roundRupees, signedInr, signedRupees, type SettlementInput } from './memoSettlement';

/** The settlement of figures that are within the limit (a null would be a failure of the test). */
const must = (t: SettlementInput, ratePaise: number, bp: number): MemoSettlement => {
  const s = memoSettlement(t, ratePaise, bp);
  assert.ok(s, 'within the limit');
  return s;
};

// The old paper's own example (docs/reference/old-memo-last-page.jpg): 177 articles, paid 220, to pay 6,953, wasuli 4,076,
// hamali rate 0.40, commission 10 %  ->  70.80, 6,882.20, 717.30, 6,164.90, 10,240.90, round figure 10,241.
const PAPER: SettlementInput = { qty: 177, paidPaise: 22000, toPayPaise: 695300, wasuliPaise: 407600 };

test('the old paper\'s example gives every step and exactly 10,241', () => {
  const s = must(PAPER, 40, 1000);
  assert.deepEqual(s, {
    articles: 177, paidPaise: 22000, toPayPaise: 695300, wasuliPaise: 407600, ratePaise: 40, commissionBp: 1000,
    commissionBasePaise: 717300, hamaliLessPaise: 7080, total1Paise: 688220, commissionLessPaise: 71730, total2Paise: 616490, netPaise: 1024090, roundRupees: 10241,
  });
});

test('round figure: .50 goes away from zero, as DM\'s roundRupee', () => {
  assert.equal(roundRupees(1024050), 10241);
  assert.equal(roundRupees(1024049), 10240);
  assert.equal(roundRupees(1024090), 10241);
  assert.equal(roundRupees(-12050), -121);
  assert.equal(roundRupees(-12049), -120);
  assert.equal(roundRupees(-12051), -121);
  assert.equal(roundRupees(50), 1);
  assert.equal(roundRupees(49), 0);
  assert.equal(roundRupees(-50), -1);
});

test('round figure: a small negative net rounds to 0, never to -0', () => {
  assert.ok(Object.is(roundRupees(-30), 0), 'net -0.30');
  assert.ok(Object.is(roundRupees(-49), 0), 'net -0.49');
  assert.ok(Object.is(roundRupees(0), 0));
});

test('rate 0 and commission 0: nothing is taken off, wasuli is still added', () => {
  const s = must(PAPER, 0, 0);
  assert.equal(s.hamaliLessPaise, 0);
  assert.equal(s.commissionLessPaise, 0);
  assert.equal(s.total1Paise, 695300);
  assert.equal(s.total2Paise, 695300);
  assert.equal(s.netPaise, 695300 + 407600);
});

test('commission 100 %: the whole of to pay + paid; paid is in the base but never added to the total', () => {
  const s = must(PAPER, 0, 10000);
  assert.equal(s.commissionLessPaise, 695300 + 22000);
  assert.equal(s.total2Paise, 695300 - (695300 + 22000)); // -22,000: the paid amount is taken as commission, not added back
  assert.equal(s.netPaise, -22000 + 407600);
});

test('a negative total 1 and a negative net are kept, not clamped', () => {
  // 100 articles at 0.20 = 20.00 off a to pay of 10.00; no wasuli.
  const s = must({ qty: 100, paidPaise: 0, toPayPaise: 1000, wasuliPaise: 0 }, 20, 0);
  assert.equal(s.hamaliLessPaise, 2000);
  assert.equal(s.total1Paise, -1000);
  assert.equal(s.netPaise, -1000);
  assert.equal(s.roundRupees, -10);
});

test('commission is rounded half up at the paisa', () => {
  const at = (base: number, bp: number) => must({ qty: 0, paidPaise: 0, toPayPaise: base, wasuliPaise: 0 }, 0, bp).commissionLessPaise;
  assert.equal(at(1050, 50), 5, '5.25 -> 5');
  assert.equal(at(1090, 50), 5, '5.45 -> 5');
  assert.equal(at(1100, 50), 6, '5.50 -> 6 (half up)');
  assert.equal(at(1110, 50), 6, '5.55 -> 6');
  assert.equal(at(1, 10000), 1);
  assert.equal(at(0, 825), 0);
});

test('the commission base is to pay + paid', () => {
  const s = must({ qty: 0, paidPaise: 300, toPayPaise: 700, wasuliPaise: 0 }, 0, 1000);
  assert.equal(s.commissionBasePaise, 1000);
  assert.equal(s.commissionLessPaise, 100); // 10 % of 1,000 paise
});

test('big amounts stay exact (a 500-LR memo at the limit: the product passes 2^53)', () => {
  const base = 500_000_000_000_001; // 5e14 + 1: times 9,999 it is far past 2^53, where a plain-number product would round without saying so
  const s = must({ qty: 0, paidPaise: 0, toPayPaise: base, wasuliPaise: 0 }, 0, 9999);
  assert.equal(s.commissionLessPaise, 499_950_000_000_001);
  assert.equal(s.total2Paise, base - 499_950_000_000_001);
});

test('a hamali less beyond what 500 LRs can add up to is refused (null), never stored', () => {
  const at = (qty: number) => memoSettlement({ qty, paidPaise: 0, toPayPaise: 0, wasuliPaise: 0 }, MAX_PAISE, 0);
  assert.notEqual(at(MAX_MEMO_LRS), null, 'exactly at the limit is allowed');
  assert.equal(at(MAX_MEMO_LRS + 1), null);
  assert.equal(at(1_000_000_000), null, 'a product far past 2^53 is refused, not rounded');
});

test('the inputs must be whole, non-negative paise and counts', () => {
  assert.throws(() => memoSettlement({ ...PAPER, qty: -1 }, 40, 1000), /invalid/);
  assert.throws(() => memoSettlement(PAPER, 0.5, 1000), /invalid/);
  assert.throws(() => memoSettlement(PAPER, 40, 10001), /invalid/);
  assert.throws(() => memoSettlement({ ...PAPER, toPayPaise: 1.5 }, 40, 1000), /invalid/);
});

test('signedInr and signedRupees: Indian grouping, a minus sign, nothing else changes', () => {
  assert.equal(signedInr(1024090), '10,240.90');
  assert.equal(signedInr(-12050), '-120.50');
  assert.equal(signedInr(-5), '-0.05');
  assert.equal(signedInr(0), '0.00');
  assert.equal(signedInr(-123456789), '-12,34,567.89');
  assert.equal(signedRupees(10241), '10,241');
  assert.equal(signedRupees(-121), '-121');
  assert.equal(signedRupees(0), '0');
  assert.equal(signedRupees(-1234567), '-12,34,567');
  assert.throws(() => signedInr(1.5), /invalid/);
});

test('percentText: the % as typed, no trailing zeros', () => {
  assert.equal(percentText(1000), '10');
  assert.equal(percentText(825), '8.25');
  assert.equal(percentText(850), '8.5');
  assert.equal(percentText(0), '0');
  assert.equal(percentText(10000), '100');
  assert.equal(percentText(5), '0.05');
});
