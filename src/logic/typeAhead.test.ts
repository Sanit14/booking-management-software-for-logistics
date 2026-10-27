import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nameKey } from '../../keeper/names';
import { buildRows, matchKey, type Option } from './typeAhead';

const o = (label: string): Option => ({ id: label, label });
const firms = ['Shree Ganesh Traders', 'Patil Hardware', 'Ganesh Agencies', 'Om Stores', 'Shree  Sai Kirana'].map(o);
const labels = (rows: ReturnType<typeof buildRows>) => rows.map((r) => (r.kind === 'option' ? r.option.label : 'WALK-IN'));

test('matchKey is the same key the keeper uses for master names', () => {
  for (const s of ['  Raj   Kumar ', 'RAJ KUMAR', 'Café', 'Café', 'राम‍  शर्मा', '']) {
    assert.equal(matchKey(s), nameKey(s));
  }
});

test('names starting with the text come before names that only contain it', () => {
  assert.deepEqual(labels(buildRows(firms, 'ganesh', 10, false)), ['Ganesh Agencies', 'Shree Ganesh Traders']);
});

test('case and extra spaces are ignored', () => {
  assert.deepEqual(labels(buildRows(firms, ' SHREE   sai', 10, false)), ['Shree  Sai Kirana']);
  assert.deepEqual(labels(buildRows(firms, 'shree g', 10, false)), ['Shree Ganesh Traders']);
});

test('inside one tier the caller order is kept', () => {
  assert.deepEqual(labels(buildRows(firms, 'shree', 10, false)), ['Shree Ganesh Traders', 'Shree  Sai Kirana']);
});

test('empty text lists the options in the caller order, never a walk-in row', () => {
  assert.deepEqual(labels(buildRows(firms, '', 3, true)), ['Shree Ganesh Traders', 'Patil Hardware', 'Ganesh Agencies']);
  assert.deepEqual(labels(buildRows(firms, '   ', 2, true)), ['Shree Ganesh Traders', 'Patil Hardware']);
});

test('the limit cuts options, and the walk-in row is always last after them', () => {
  assert.deepEqual(labels(buildRows(firms, 'a', 2, true)), ['Shree Ganesh Traders', 'Patil Hardware', 'WALK-IN']);
});

test('walk-in row appears with no match at all, and only when asked for', () => {
  assert.deepEqual(labels(buildRows(firms, 'zzz', 5, true)), ['WALK-IN']);
  assert.deepEqual(labels(buildRows(firms, 'zzz', 5, false)), []);
});
