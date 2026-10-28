import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPaise, paiseToField } from './rupees';

test('formatPaise: Indian grouping, paise only when there are some', () => {
  assert.equal(formatPaise(0), '0');
  assert.equal(formatPaise(500), '5');
  assert.equal(formatPaise(99900), '999');
  assert.equal(formatPaise(180000), '1,800');
  assert.equal(formatPaise(12050), '120.50');
  assert.equal(formatPaise(5), '0.05');
  assert.equal(formatPaise(125000000), '12,50,000');
  assert.equal(formatPaise(10000000), '1,00,000');
});

test('paiseToField: plain text a person would type; zero is an empty box', () => {
  assert.equal(paiseToField(0), '');
  assert.equal(paiseToField(500), '5');
  assert.equal(paiseToField(250), '2.5');
  assert.equal(paiseToField(1205), '12.05');
  assert.equal(paiseToField(180000), '1800');
});
