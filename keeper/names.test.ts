import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameKey } from './names';

test('nameKey: lowercase, trimmed, inner whitespace collapsed', () => {
  assert.equal(nameKey('  Sundeep   Freight\tMovers \n'), 'sundeep freight movers');
  assert.equal(nameKey('MH 29 AB 1234'), 'mh 29 ab 1234');
  assert.equal(nameKey(''), '');
  assert.equal(nameKey('   '), '');
});

test('nameKey: the same name spelt with different spacing or case is one key', () => {
  assert.equal(nameKey('Yavatmal'), nameKey(' YAVATMAL '));
  assert.equal(nameKey('Raj  Kumar'), nameKey('raj kumar'));
});

test('nameKey: composed and decomposed spellings of one name are one key', () => {
  assert.equal(nameKey('José'), nameKey('José'));
  assert.equal(nameKey('क़'), nameKey('क़')); // Devanagari qa: precomposed vs ka + nukta
});

test('nameKey: Devanagari is left as it is', () => {
  assert.equal(nameKey('  यवतमाळ  '), 'यवतमाळ');
});
