// Helpers shared by the memo dbtests (they run under Electron's Node, see scripts/test-db.cjs; not shipped).
import assert from 'node:assert/strict';
import type { KeeperResult, LrInput, MemoInput, MemoSaved } from '../shared';
import { makeLrs } from './lrs';
import { makeMasters } from './masters';
import { makeMemos } from './memos';
import { makePins } from './pins';
import { freshDb } from './testing';

export const ADMIN = '1111';
export const SYSTEM = '2222';
export const now = () => new Date(2026, 9, 31, 10, 30); // local time: 31 October 2026

export function setUp() {
  const pins = makePins();
  const db = freshDb();
  assert.ok(pins.setup(db, 'seat-1', ADMIN, SYSTEM).ok);
  const masters = makeMasters(pins);
  const lrs = makeLrs(pins, masters, now);
  const memos = makeMemos(pins, now);
  const made = <T extends { id: number; version: number }>(r: KeeperResult<T>) => {
    assert.ok(r.ok, r.ok ? '' : r.code);
    return r.value;
  };
  const st = (name: string) => made(masters.create(db, 'seat-1', 'stations', { name })).id;
  return {
    db, pins, masters, lrs, memos, made,
    yavatmal: st('Yavatmal'), nagpur: st('Nagpur'), amravati: st('Amravati'),
    truck: made(masters.create(db, 'seat-1', 'trucks', { number: 'MH 29 BE 1234' })).id,
    truck2: made(masters.create(db, 'seat-1', 'trucks', { number: 'MH 29 AB 1' })).id,
    driver: made(masters.create(db, 'seat-1', 'drivers', { name: 'Ramesh Pawar' })).id,
    ganesh: made(masters.create(db, 'seat-1', 'firms', { name: 'Shree Ganesh Traders' })).id,
    patil: made(masters.create(db, 'seat-1', 'firms', { name: 'Patil Hardware' })).id,
  };
}
export type Set = ReturnType<typeof setUp>;

let serial = 0;
export const lrInput = (s: Set, over: Partial<LrInput> = {}): LrInput => ({
  uid: `lr-${++serial}`,
  date: null,
  fromStationId: s.yavatmal,
  toStationId: s.nagpur,
  consignor: { firmId: s.ganesh, name: '', addToFirms: false },
  consignee: { firmId: s.patil, name: '', addToFirms: false },
  particular: 'Cloth bales',
  qty: '3',
  toPay: '1,800',
  paid: '',
  chargeOption: 'blank',
  godownBhada: '',
  godownInsurance: '',
  deliveryCharges: '',
  hamali: '',
  wasuli: '',
  staxPercent: '0',
  ...over,
});
/** A booked LR through the real save; returns its id and number. A date other than today is backdated with the PIN. */
export function book(s: Set, over: Partial<LrInput> = {}) {
  const r = s.lrs.create(s.db, 'seat-1', lrInput(s, { ...(over.date ? { systemPin: SYSTEM } : {}), ...over }));
  assert.ok(r.ok, r.ok ? '' : `${r.code} ${JSON.stringify(r.fields)}`);
  return { id: r.value.row.id, no: r.value.row.lrNo };
}
export const memoInput = (s: Set, lrIds: number[], over: Partial<MemoInput> = {}): MemoInput => ({
  uid: `memo-${++serial}`,
  date: null,
  truckId: s.truck,
  driverId: s.driver,
  fromStationId: s.yavatmal,
  toStationId: s.nagpur,
  truckHire: '',
  loadingHamali: '',
  lrIds,
  ...over,
});
export const create = (s: Set, lrIds: number[], over: Partial<MemoInput> = {}, seat = 'seat-1') => s.memos.create(s.db, seat, memoInput(s, lrIds, over));
export const saved = (r: KeeperResult<MemoSaved>): MemoSaved => {
  assert.ok(r.ok, r.ok ? '' : `${r.code} ${JSON.stringify(r.memoFields ?? r.taken ?? '')}`);
  return r.value;
};
export const refused = <T>(r: KeeperResult<T>) => {
  assert.equal(r.ok, false);
  return r as Extract<KeeperResult<T>, { ok: false }>;
};
