import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inr, lrAmounts, parseRupees, type LrMoney } from './money';

test('inr: Indian grouping with two decimals, as printed on paper', () => {
  assert.equal(inr(0), '0.00');
  assert.equal(inr(5), '0.05');
  assert.equal(inr(99999), '999.99');
  assert.equal(inr(100000), '1,000.00');
  assert.equal(inr(12345678), '1,23,456.78');
  assert.equal(inr(123456789), '12,34,567.89');
  assert.equal(inr(1234567890000), '12,34,56,78,900.00');
  assert.equal(inr(parseRupees('1,250.50')), '1,250.50'); // what parseRupees reads, inr writes back
});

test('inr: refuses what is not whole, non-negative paise', () => {
  for (const bad of [-1, 1.5, NaN, Infinity]) assert.throws(() => inr(bad), /invalid/, String(bad));
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

const zeroLr: LrMoney = { topay_paise: 0, paid_paise: 0, hamali_paise: 0 };

test('lrAmounts: a to pay LR is freight + hamali, no tax', () => {
  assert.deepEqual(lrAmounts({ ...zeroLr, topay_paise: 100000, hamali_paise: 3000 }), { freight: 100000, hamali: 3000, total: 103000 });
});

test('lrAmounts: a paid LR totals the same as the same to pay LR', () => {
  assert.deepEqual(lrAmounts({ ...zeroLr, paid_paise: 100000, hamali_paise: 3000 }), { freight: 100000, hamali: 3000, total: 103000 });
});

test('lrAmounts: a hamali-only LR has no freight', () => {
  assert.deepEqual(lrAmounts({ ...zeroLr, hamali_paise: 1050 }), { freight: 0, hamali: 1050, total: 1050 });
});

test('lrAmounts: a zero LR is all zeros', () => {
  assert.deepEqual(lrAmounts(zeroLr), { freight: 0, hamali: 0, total: 0 });
});

test('lrAmounts: an LR saved before 4.5 adds only freight + hamali; its old charge columns and tax rate count for nothing', () => {
  const old = { ...zeroLr, topay_paise: 100000, hamali_paise: 3000, godown_bhada_paise: 500, godown_insurance_paise: 500, delivery_charges_paise: 200, pf_paise: 100, stax_bp: 500 };
  assert.deepEqual(lrAmounts(old), { freight: 100000, hamali: 3000, total: 103000 });
});

test('lrAmounts: both to pay and paid is refused; so is money that is not whole, non-negative paise', () => {
  assert.throws(() => lrAmounts({ ...zeroLr, topay_paise: 100, paid_paise: 100 }), /both/);
  assert.throws(() => lrAmounts({ ...zeroLr, hamali_paise: -1 }), /invalid/);
  assert.throws(() => lrAmounts({ ...zeroLr, topay_paise: 1.5 }), /invalid/);
});
