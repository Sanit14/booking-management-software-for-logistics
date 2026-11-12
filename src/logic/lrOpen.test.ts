import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LrDetail } from '../../shared';
import { formFromLr } from './lrOpen';

const lr: LrDetail = {
  id: 7, version: 3, status: 'booked', lrNo: 245, lrYear: 2026, date: '2026-10-29', memoNo: null, memoId: null,
  fromStationId: 1, toStationId: 2, consignorId: 10, consignor: 'Shree Ganesh Traders', consigneeId: null, consignee: 'Kale Brothers',
  particular: 'Cloth bales', qty: 12, toPayPaise: 180000, paidPaise: 0, hamaliPaise: 12010, wasuliPaise: 0,
  amounts: { freight: 180000, hamali: 12010, total: 192010 },
};
const name = (id: number) => ({ 1: 'Yavatmal', 2: 'Nagpur' })[id as 1 | 2] ?? '';

test('formFromLr: every box shows what was saved, money as the text a clerk would type', () => {
  const f = formFromLr(lr, name);
  assert.deepEqual(f.from, { text: 'Yavatmal', id: 1 });
  assert.deepEqual(f.to, { text: 'Nagpur', id: 2 });
  assert.deepEqual(f.consignor, { text: 'Shree Ganesh Traders', firmId: 10, add: false });
  assert.deepEqual(f.consignee, { text: 'Kale Brothers', firmId: null, add: false }, 'a walk-in stays a walk-in');
  assert.equal(f.particular, 'Cloth bales');
  assert.equal(f.qty, '12');
  assert.equal(f.toPay, '1800');
  assert.equal(f.paid, '', 'zero is an empty box');
  assert.equal(f.hamali, '120.1');
  assert.equal(f.wasuli, '');
});
