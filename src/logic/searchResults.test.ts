import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SearchAnswer } from '../../shared';
import { flatten, move } from './searchResults';

const answer: SearchAnswer = {
  lrs: [{ id: 11, lrNo: 1234, lrYear: 2026, date: '2026-10-30', consignee: 'Kale', toStation: 'Nagpur', status: 'booked' }],
  firms: [
    { id: 5, name: 'Kale Brothers', station: 'Wani', active: true },
    { id: 6, name: 'Ankale Co', station: null, active: false },
  ],
  trucks: [{ id: 3, number: 'MH 29 BE 1234', active: true }],
  stations: [{ id: 2, name: 'Nagpur', active: true }],
};

test('rows come in the order LR, firm, truck, station, each with where a pick goes', () => {
  const rows = flatten(answer);
  assert.deepEqual(
    rows.map((r) => [r.group, r.jump]),
    [
      ['lr', { to: 'lr', id: 11 }],
      ['firm', { to: 'master', kind: 'firms', id: 5 }],
      ['firm', { to: 'master', kind: 'firms', id: 6 }],
      ['truck', { to: 'master', kind: 'trucks', id: 3 }],
      ['station', { to: 'master', kind: 'stations', id: 2 }],
    ],
  );
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, 'keys are unique, so a firm and a station with one id do not collide');
});

test('a group with nothing in it leaves no rows; an empty answer has none at all', () => {
  assert.deepEqual(flatten({ lrs: [], firms: [], trucks: [{ id: 1, number: 'X', active: true }], stations: [] }).map((r) => r.group), ['truck']);
  assert.deepEqual(flatten({ lrs: [], firms: [], trucks: [], stations: [] }), []);
});

test('the row keeps its item, so the screen can draw it', () => {
  const row = flatten(answer)[1];
  assert.equal(row.group === 'firm' && row.item.name, 'Kale Brothers');
});

test('down and up walk the rows and wrap round; with nothing there is no row', () => {
  assert.equal(move(0, 1, 3), 1);
  assert.equal(move(2, 1, 3), 0);
  assert.equal(move(0, -1, 3), 2);
  assert.equal(move(1, -1, 3), 0);
  assert.equal(move(-1, 1, 3), 0, 'down from nothing picked is the first');
  assert.equal(move(-1, -1, 3), 2, 'up from nothing picked is the last');
  assert.equal(move(0, 1, 0), -1);
  assert.equal(move(5, 1, 0), -1);
  assert.equal(move(0, 1, 1), 0);
});
