import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, cleanPhone, cleanTruck, findSimilar, truckKey } from './masterRules';

test('truckKey: case, spaces, dots and dashes do not matter', () => {
  for (const typed of ['MH 29 BE 1234', 'mh-29-be-1234', 'Mh.29.Be.1234', ' mh29be1234 ', 'MH-29 BE.1234']) {
    assert.equal(truckKey(typed), 'MH29BE1234', typed);
  }
  assert.notEqual(truckKey('MH 29 BE 1235'), truckKey('MH 29 BE 1234'));
});

test('cleanTruck: shown as typed, upper-cased, inner spaces collapsed; blank is refused', () => {
  assert.equal(cleanTruck('  mh-29  be 1234 '), 'MH-29 BE 1234');
  assert.equal(cleanTruck('   '), null);
  assert.equal(cleanTruck('x'.repeat(101)), null);
  for (const empty of ['-', '.', '. .', ' - . ']) assert.equal(cleanTruck(empty), null, `no empty key: ${empty}`);
});

test('cleanName: trimmed, inner spaces collapsed, 1 to 100 characters', () => {
  assert.equal(cleanName('  Shree   Ganesh  Traders '), 'Shree Ganesh Traders');
  assert.equal(cleanName(''), null);
  assert.equal(cleanName('  '), null);
  assert.equal(cleanName('a'.repeat(100)), 'a'.repeat(100));
  assert.equal(cleanName('a'.repeat(101)), null);
});

test('cleanPhone: digits only; separators and a leading + are dropped; letters and long numbers are refused', () => {
  assert.equal(cleanPhone('98220 12345'), '9822012345');
  assert.equal(cleanPhone('+91-98220-12345'), '919822012345');
  assert.equal(cleanPhone('(07232) 245 678'), '07232245678');
  assert.equal(cleanPhone(''), '');
  assert.equal(cleanPhone('   '), '');
  assert.equal(cleanPhone('98220x12345'), null);
  assert.equal(cleanPhone('9+8'), null);
  assert.equal(cleanPhone('1'.repeat(16)), null);
  assert.equal(cleanPhone('1'.repeat(15)), '1'.repeat(15));
});

test('findSimilar: a name that starts like another, either way round, on the name key', () => {
  const have = ['Shree Ganesh Traders', 'Patil Hardware', 'Om Sai Transport', 'Patil'];
  assert.deepEqual(findSimilar(have, 'shree ganesh'), ['Shree Ganesh Traders']);
  assert.deepEqual(findSimilar(have, 'Shree Ganesh Traders & Sons'), ['Shree Ganesh Traders']);
  assert.deepEqual(findSimilar(have, ' PATIL '), ['Patil Hardware', 'Patil']);
  assert.deepEqual(findSimilar(have, 'Sai Transport'), [], 'a name that only contains the text is not similar');
  assert.deepEqual(findSimilar(have, 'Krishna'), []);
});

test('findSimilar: an equal name counts (the caller decides exact matches first); blank matches nothing', () => {
  assert.deepEqual(findSimilar(['Ravi Kumar'], '  ravi   KUMAR'), ['Ravi Kumar']);
  assert.deepEqual(findSimilar(['Ravi Kumar'], '   '), []);
});
