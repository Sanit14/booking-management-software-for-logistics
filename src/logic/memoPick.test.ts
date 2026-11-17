import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Station } from '../../shared';
import { NOTHING_PICKED, chipsOf, dropPick, filtersOf, hasPicks, onlyStation, pickName, stationFilter, stationRows, tickAll, toggle, toggleStation, untick, type Ticks } from './memoPick';

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

test('station filter: the picked station, else a name typed in full, else no filter yet (typing "Nag" filters nothing until it is picked)', () => {
  const stations = [station(1, 'Nagpur'), station(2, 'Nanded'), station(3, 'Old Town', false)];
  assert.equal(stationFilter('Nagpur', 1, stations), 1);
  assert.equal(stationFilter('  nanded ', null, stations), 2);
  assert.equal(stationFilter('Nag', null, stations), null);
  assert.equal(stationFilter('', null, stations), null);
  assert.equal(stationFilter('Old Town', null, stations), null, 'a closed station is not offered');
});

const walkIn = (s: string) => ({ firmId: null, name: s });
const firm = (id: number, s: string) => ({ firmId: id, name: s });
const stationName = (id: number) => (id === 1 ? 'Nagpur' : id === 2 ? 'Amravati' : `Station ${id}`);

test('picks: a station is ticked and unticked; a name is added once; nothing picked is no filter', () => {
  assert.equal(hasPicks(NOTHING_PICKED), false);
  assert.deepEqual(filtersOf(NOTHING_PICKED), { toStationIds: [], consignors: [], consignees: [] });
  const a = toggleStation(NOTHING_PICKED, 1);
  assert.deepEqual(toggleStation(toggleStation(a, 2), 1).stations, [2]);
  const b = pickName(pickName(a, 'consignor', firm(9, 'Shree Agro Traders')), 'consignor', firm(9, 'Shree Agro Traders'));
  assert.equal(b.consignors.length, 1, 'the same firm twice is one pick');
  const c = pickName(b, 'consignor', walkIn('Shree Agro Traders'));
  assert.equal(c.consignors.length, 2, 'a walk-in written like a firm is another name');
  assert.deepEqual(filtersOf(c), { toStationIds: [1], consignors: [firm(9, 'Shree Agro Traders'), walkIn('Shree Agro Traders')], consignees: [] });
  assert.equal(NOTHING_PICKED.stations.length, 0, 'the starting point is never changed');
  assert.equal(hasPicks(c), true);
});

test('chips: stations, then consignors, then consignees; one is taken off by its key', () => {
  const p = pickName(pickName(toggleStation(toggleStation(NOTHING_PICKED, 1), 2), 'consignor', firm(9, 'Shree Agro')), 'consignee', walkIn('Kale & Sons'));
  const chips = chipsOf(p, stationName);
  assert.deepEqual(chips.map((c) => c.label), ['Nagpur', 'Amravati', 'Shree Agro', 'Kale & Sons']);
  assert.equal(new Set(chips.map((c) => c.key)).size, 4);
  assert.deepEqual(dropPick(p, chips[0].key).stations, [2]);
  assert.deepEqual(dropPick(p, chips[2].key).consignors, []);
  assert.deepEqual(dropPick(p, chips[3].key).consignees, []);
  assert.deepEqual(dropPick(p, 'nothing like it'), p);
  // a consignor and a consignee with the same text are different chips
  const both = pickName(pickName(NOTHING_PICKED, 'consignor', walkIn('Kale')), 'consignee', walkIn('Kale'));
  const keys = chipsOf(both, stationName).map((c) => c.key);
  assert.equal(new Set(keys).size, 2);
  assert.deepEqual(dropPick(both, keys[0]), { stations: [], consignors: [], consignees: [walkIn('Kale')] });
});

test('the memo\'s To follows the filter only when exactly one station is filtered', () => {
  assert.equal(onlyStation(NOTHING_PICKED), null);
  assert.equal(onlyStation(toggleStation(NOTHING_PICKED, 1)), 1);
  assert.equal(onlyStation(toggleStation(toggleStation(NOTHING_PICKED, 1), 2)), null);
});

test('the station list: the keeper\'s counts, and a ticked station with none left is still there (0) so it can be unticked', () => {
  const counts = [{ stationId: 1, station: 'Nagpur', lrs: 12 }, { stationId: 2, station: 'Amravati', lrs: 4 }];
  assert.deepEqual(stationRows(counts, NOTHING_PICKED, stationName), [
    { stationId: 1, station: 'Nagpur', lrs: 12, on: false },
    { stationId: 2, station: 'Amravati', lrs: 4, on: false },
  ]);
  const rows = stationRows(counts.slice(0, 1), toggleStation(toggleStation(NOTHING_PICKED, 2), 1), stationName);
  assert.deepEqual(rows, [{ stationId: 1, station: 'Nagpur', lrs: 12, on: true }, { stationId: 2, station: 'Amravati', lrs: 0, on: true }]);
});
