import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFixed, formatPaise, formatSigned, formatWhole, paiseToField } from './rupees';

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

test('formatSigned: a minus sign for a negative amount (a memo net can be below zero), the same grouping and decimals as formatPaise', () => {
  assert.equal(formatSigned(1024090), '10,240.90');
  assert.equal(formatSigned(-12050), '-120.50');
  assert.equal(formatSigned(-12100), '-121');
  assert.equal(formatSigned(-123456700), '-12,34,567');
  assert.equal(formatSigned(-5), '-0.05');
  assert.equal(formatSigned(0), '0');
});

test('formatFixed: always two decimals, a minus sign when negative (the steps of a settlement and a rate like 0.40)', () => {
  assert.equal(formatFixed(695300), '6,953.00');
  assert.equal(formatFixed(40), '0.40');
  assert.equal(formatFixed(-12050), '-120.50');
  assert.equal(formatFixed(0), '0.00');
  assert.equal(formatFixed(1024090), '10,240.90');
  assert.equal(formatFixed(-123456789), '-12,34,567.89');
});

test('formatWhole: whole rupees with Indian grouping and a minus sign', () => {
  assert.deepEqual([10241, -121, 0, -1234567, 5].map(formatWhole), ['10,241', '-121', '0', '-12,34,567', '5']);
});
