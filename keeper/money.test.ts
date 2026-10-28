import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargesFor, lrAmounts, parsePercent, parseRupees, percentText, taxPaise, type ChargeRule, type LrMoney } from './money';

test('parsePercent: a percentage with at most 2 decimals becomes basis points; empty is 0', () => {
  assert.equal(parsePercent(''), 0);
  assert.equal(parsePercent(' 0 '), 0);
  assert.equal(parsePercent('5'), 500);
  assert.equal(parsePercent('2.5'), 250);
  assert.equal(parsePercent('12.75'), 1275);
  assert.equal(parsePercent('100'), 10000);
  assert.equal(parsePercent('0.05'), 5);
});

test('parsePercent: more than 100, negative, 3 decimals or text is an error', () => {
  for (const bad of ['100.01', '101', '-1', '5.123', 'abc', '5%', '.5', '5.', '1,5']) {
    assert.throws(() => parsePercent(bad), /invalid percent/, bad);
  }
});

test('percentText is the way back from basis points, without trailing zeros', () => {
  assert.equal(percentText(0), '0');
  assert.equal(percentText(500), '5');
  assert.equal(percentText(250), '2.5');
  assert.equal(percentText(1275), '12.75');
  assert.equal(percentText(5), '0.05');
  for (const bp of [0, 5, 250, 500, 1275, 10000]) assert.equal(parsePercent(percentText(bp)), bp);
});

test('parseRupees: valid amounts become paise', () => {
  assert.equal(parseRupees('0'), 0);
  assert.equal(parseRupees(''), 0);
  assert.equal(parseRupees('   '), 0);
  assert.equal(parseRupees('1250'), 125000);
  assert.equal(parseRupees('1,250.5'), 125050);
  assert.equal(parseRupees('1,250.50'), 125050);
  assert.equal(parseRupees('0.05'), 5);
  assert.equal(parseRupees(' 12 '), 1200);
  assert.equal(parseRupees('12,50,000'), 125000000); // Indian grouping
});

test('parseRupees: anything else is an error, never a guess', () => {
  for (const bad of ['12.345', '-5', 'abc', '1,2,3', '.5', '5.', '1e3', '1 250', '₹5', '--1', '99999999999999999999']) {
    assert.throws(() => parseRupees(bad), /invalid amount/, bad);
  }
});

test('taxPaise: 0%, 5% of Rs 1000, 100%', () => {
  assert.equal(taxPaise(100000, 0), 0);
  assert.equal(taxPaise(100000, 500), 5000);
  assert.equal(taxPaise(12345, 10000), 12345);
});

test('taxPaise: a half paisa rounds up, less than half rounds down', () => {
  assert.equal(taxPaise(10, 500), 1); // 0.50 paise -> 1
  assert.equal(taxPaise(9, 500), 0); // 0.45 paise -> 0
  assert.equal(taxPaise(11, 500), 1); // 0.55 paise -> 1
  assert.equal(taxPaise(30, 500), 2); // 1.50 paise -> 2
});

test('taxPaise: refuses what is not a whole non-negative paise amount or a valid basis-point rate', () => {
  assert.throws(() => taxPaise(-1, 500), /invalid/);
  assert.throws(() => taxPaise(1.5, 500), /invalid/);
  assert.throws(() => taxPaise(100, 10001), /invalid/);
  assert.throws(() => taxPaise(100, -1), /invalid/);
  assert.throws(() => taxPaise(100, 5.5), /invalid/);
});

const option1: ChargeRule = {
  godownBhadaPaise: 500,
  godownInsurancePaise: 500,
  deliveryChargesPaise: 200,
  hamaliPerDagPaise: 1000,
  hamaliFlatPaise: 0,
  hamaliMode: 'perDag',
};

test('chargesFor: hamali per dag is multiplied by quantity, the rest is flat', () => {
  assert.deepEqual(chargesFor(option1, 3), { godownBhada: 500, godownInsurance: 500, deliveryCharges: 200, hamali: 3000 });
});

test('chargesFor: flat hamali ignores quantity; none is zero even if a per-dag value is left in the rule', () => {
  const flat: ChargeRule = { ...option1, hamaliMode: 'flat', hamaliFlatPaise: 2500 };
  assert.equal(chargesFor(flat, 7).hamali, 2500);
  const none: ChargeRule = { ...option1, hamaliMode: 'none' };
  assert.equal(chargesFor(none, 7).hamali, 0);
});

test('chargesFor: quantity 0 gives no per-dag hamali; a bad quantity is an error', () => {
  assert.equal(chargesFor(option1, 0).hamali, 0);
  assert.throws(() => chargesFor(option1, -1), /invalid/);
  assert.throws(() => chargesFor(option1, 1.5), /invalid/);
});

const zeroLr: LrMoney = {
  topay_paise: 0,
  paid_paise: 0,
  godown_bhada_paise: 0,
  godown_insurance_paise: 0,
  delivery_charges_paise: 0,
  hamali_paise: 0,
  pf_paise: 0,
  stax_bp: 0,
};

test('lrAmounts: a to pay LR', () => {
  const lr: LrMoney = { ...zeroLr, topay_paise: 100000, godown_bhada_paise: 500, godown_insurance_paise: 500, delivery_charges_paise: 200, hamali_paise: 3000, pf_paise: 100, stax_bp: 500 };
  assert.deepEqual(lrAmounts(lr), { freight: 100000, charges: 4300, stax: 5000, total: 109300 });
});

test('lrAmounts: a paid LR totals the same as the same to pay LR', () => {
  const lr: LrMoney = { ...zeroLr, paid_paise: 100000, godown_bhada_paise: 500, godown_insurance_paise: 500, delivery_charges_paise: 200, hamali_paise: 3000, pf_paise: 100, stax_bp: 500 };
  assert.deepEqual(lrAmounts(lr), { freight: 100000, charges: 4300, stax: 5000, total: 109300 });
});

test('lrAmounts: a charges-only LR has no freight and so no service tax', () => {
  const lr: LrMoney = { ...zeroLr, godown_bhada_paise: 500, delivery_charges_paise: 500, stax_bp: 500 };
  assert.deepEqual(lrAmounts(lr), { freight: 0, charges: 1000, stax: 0, total: 1000 });
});

test('lrAmounts: a zero LR is all zeros', () => {
  assert.deepEqual(lrAmounts(zeroLr), { freight: 0, charges: 0, stax: 0, total: 0 });
});

test('lrAmounts: both to pay and paid is refused', () => {
  assert.throws(() => lrAmounts({ ...zeroLr, topay_paise: 100, paid_paise: 100 }), /both/);
});
