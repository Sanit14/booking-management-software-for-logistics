import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firm, Truck } from '../../shared';
import { visibleRows } from './masterList';

const firm = (id: number, name: string, active = true): Firm => ({ id, name, stationId: null, phone: '', active, version: 1 });
const truck = (id: number, number: string): Truck => ({ id, number, active: true, version: 1 });
const names = (rows: ReturnType<typeof visibleRows>) => rows.map((r) => r.id);

const firms = [firm(1, 'Shree Ganesh Traders'), firm(2, 'Patil Hardware', false), firm(3, 'Om  Sai Kirana')];

test('inactive rows show only when asked for, and the keeper order is kept', () => {
  assert.deepEqual(names(visibleRows(firms, 'firms', '', false)), [1, 3]);
  assert.deepEqual(names(visibleRows(firms, 'firms', '', true)), [1, 2, 3]);
});

test('search is on the name key: case, extra spaces and the middle of the name', () => {
  assert.deepEqual(names(visibleRows(firms, 'firms', ' GANESH  ', false)), [1]);
  assert.deepEqual(names(visibleRows(firms, 'firms', 'om sai', false)), [3]);
  assert.deepEqual(names(visibleRows(firms, 'firms', 'patil', false)), []);
  assert.deepEqual(names(visibleRows(firms, 'firms', 'patil', true)), [2]);
});

test('a truck is found however its number is typed', () => {
  const trucks = [truck(1, 'MH 29 BE 1234'), truck(2, 'MH 31 AB 9')];
  for (const q of ['mh29', 'MH-29 BE', 'be.1234', 'mh 29 be 1234']) assert.deepEqual(names(visibleRows(trucks, 'trucks', q, false)), [1], q);
  assert.deepEqual(names(visibleRows(trucks, 'trucks', 'mh', false)), [1, 2]);
});
