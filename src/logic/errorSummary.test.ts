import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorSummary } from './errorSummary';

const label = (k: string) => ({ consignor: 'Consignor', toStation: 'To station', qty: 'Quantity', paid: 'Paid' })[k] ?? k;

test('no errors, no line', () => {
  assert.equal(errorSummary({}, label), '');
  assert.equal(errorSummary({ qty: undefined }, label), '');
});

test('one error names its box', () => {
  assert.equal(errorSummary({ qty: 'Enter a whole number, 1 or more' }, label), 'Quantity: Enter a whole number, 1 or more');
});

test('the same message on several boxes is said once, boxes in form order', () => {
  const line = errorSummary({ qty: 'Required', consignor: 'Required', toStation: 'Required' }, label);
  assert.equal(line, 'Required: Consignor, To station, Quantity');
});

test('different messages are kept apart', () => {
  const line = errorSummary({ qty: 'Required', consignor: 'Already exists: Patil Hardware' }, label);
  assert.equal(line, 'Consignor: Already exists: Patil Hardware · Quantity: Required');
});
