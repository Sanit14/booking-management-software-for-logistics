import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firm, Station } from '../../shared';
import { partyFilter, stationFilter, tickAll, toggle, untick, type Ticks } from './memoPick';

const none: Ticks = new Set();
const ids = (t: Ticks) => [...t];

test('toggle ticks an LR, and unticks it again; the old set is left alone', () => {
  const one = toggle(none, 1);
  assert.deepEqual(ids(one), [1]);
  assert.deepEqual(ids(toggle(one, 2)), [1, 2]);
  assert.deepEqual(ids(toggle(one, 1)), []);
  assert.deepEqual(ids(one), [1]);
});

test('tick all adds the rows shown and leaves what was already ticked, in the order it was ticked', () => {
  const start = toggle(toggle(none, 7), 3);
  assert.deepEqual(ids(tickAll(start, [1, 3, 5])), [7, 3, 1, 5]);
  assert.deepEqual(ids(tickAll(none, [])), []);
});

test('untick removes the ids given (the taken LRs), and the rest stay', () => {
  const t = tickAll(none, [1, 2, 3]);
  assert.deepEqual(ids(untick(t, [2, 9])), [1, 3]);
  assert.deepEqual(ids(untick(t, [])), [1, 2, 3]);
});

const station = (id: number, name: string, active = true): Station => ({ id, name, active, version: 1 });
const firm = (id: number, name: string, active = true): Firm => ({ id, name, stationId: null, phone: '', active, version: 1 });

test('station filter: the picked station, else a name typed in full, else no filter yet (typing "Nag" filters nothing until it is picked)', () => {
  const stations = [station(1, 'Nagpur'), station(2, 'Nanded'), station(3, 'Old Town', false)];
  assert.equal(stationFilter('Nagpur', 1, stations), 1);
  assert.equal(stationFilter('  nanded ', null, stations), 2);
  assert.equal(stationFilter('Nag', null, stations), null);
  assert.equal(stationFilter('', null, stations), null);
  assert.equal(stationFilter('Old Town', null, stations), null, 'a closed station is not offered');
});

test('party filter: a picked firm; a firm typed in full; any other text as it is; nothing typed is no filter', () => {
  const firms = [firm(1, 'Shree Ganesh Traders'), firm(2, 'Old Firm', false)];
  assert.deepEqual(partyFilter('Shree Ganesh Traders', 1, firms), { firmId: 1, text: 'Shree Ganesh Traders' });
  assert.deepEqual(partyFilter(' shree  ganesh traders', null, firms), { firmId: 1, text: 'shree  ganesh traders' });
  assert.deepEqual(partyFilter('Kale', null, firms), { firmId: null, text: 'Kale' });
  assert.deepEqual(partyFilter('Old Firm', null, firms), { firmId: null, text: 'Old Firm' }, 'a closed firm is matched by its name');
  assert.equal(partyFilter('   ', null, firms), null);
});
