import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDefaults, markManual, releaseIfEmpty, type ChargeKey, type ChargeTexts } from './chargeFill';

const empty: ChargeTexts = { godownBhada: '', godownInsurance: '', deliveryCharges: '', hamali: '' };
const option1 = { godownBhada: 500, godownInsurance: 500, deliveryCharges: 200, hamali: 3000 };
const none = new Set<ChargeKey>();

test('applyDefaults: with nothing typed by hand every box takes the option\'s amount', () => {
  assert.deepEqual(applyDefaults(empty, none, option1), { godownBhada: '5', godownInsurance: '5', deliveryCharges: '2', hamali: '30' });
});

test('applyDefaults: a box the clerk typed in keeps its text when the quantity or the option changes', () => {
  const typed: ChargeTexts = { godownBhada: '', godownInsurance: '', deliveryCharges: '', hamali: '75' };
  const manual = markManual(none, 'hamali', '75');
  assert.deepEqual(applyDefaults(typed, manual, { ...option1, hamali: 6000 }).hamali, '75', 'quantity went up: still 75');
  assert.deepEqual(applyDefaults(typed, manual, { godownBhada: 200, godownInsurance: 300, deliveryCharges: 300, hamali: 0 }), {
    godownBhada: '2', godownInsurance: '3', deliveryCharges: '3', hamali: '75',
  });
});

test('applyDefaults: the Blank option empties the boxes that are not the clerk\'s', () => {
  const filled = applyDefaults(empty, none, option1);
  assert.deepEqual(applyDefaults(filled, none, { godownBhada: 0, godownInsurance: 0, deliveryCharges: 0, hamali: 0 }), empty);
});

test('applyDefaults: hamali follows the quantity until the clerk takes it over', () => {
  let texts = applyDefaults(empty, none, option1);
  assert.equal(texts.hamali, '30');
  texts = applyDefaults(texts, none, { ...option1, hamali: 10000 });
  assert.equal(texts.hamali, '100');
});

test('markManual: typing marks a box; emptying it mid-edit does not hand it back yet (it would refill under the cursor)', () => {
  const one = markManual(none, 'godownBhada', '9');
  assert.deepEqual([...one], ['godownBhada']);
  assert.deepEqual([...markManual(one, 'hamali', '1')].sort(), ['godownBhada', 'hamali']);
  assert.deepEqual([...markManual(one, 'godownBhada', '')], ['godownBhada']);
  assert.deepEqual([...one], ['godownBhada'], 'the old set is not changed');
});

test('releaseIfEmpty: leaving an emptied box hands it back to the option; a box with text stays the clerk\'s', () => {
  const both = new Set<ChargeKey>(['godownBhada', 'hamali']);
  assert.deepEqual([...releaseIfEmpty(both, 'hamali', ' ')], ['godownBhada']);
  assert.deepEqual([...releaseIfEmpty(both, 'hamali', '5')].sort(), ['godownBhada', 'hamali']);
  assert.deepEqual([...both].sort(), ['godownBhada', 'hamali'], 'the old set is not changed');
});
