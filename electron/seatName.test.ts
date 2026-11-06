import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSeat, saveSeat } from './seatName';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bm-seat-'));

test('a seat with no file is called after its Windows user, and keeps that name from then on', () => {
  const d = dir();
  const first = loadSeat(d);
  assert.equal(first, os.userInfo().username);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'seat.json'), 'utf8')), { name: first });
});

test('a rename is kept for the next start; the file is whole, with no temp file left', () => {
  const d = dir();
  loadSeat(d);
  saveSeat(d, 'Counter 2');
  assert.equal(loadSeat(d), 'Counter 2');
  assert.deepEqual(fs.readdirSync(d), ['seat.json']);
  saveSeat(d, 'Counter 3');
  assert.equal(loadSeat(d), 'Counter 3');
});

test('a file that is not a seat file falls back to the Windows user name', () => {
  const d = dir();
  fs.writeFileSync(path.join(d, 'seat.json'), 'not json');
  assert.equal(loadSeat(d), os.userInfo().username);
  fs.writeFileSync(path.join(d, 'seat.json'), JSON.stringify({ name: '' }));
  assert.equal(loadSeat(d), os.userInfo().username);
});

test('saving makes the folder if it is not there yet', () => {
  const d = path.join(dir(), 'not', 'yet');
  saveSeat(d, 'PC02');
  assert.equal(loadSeat(d), 'PC02');
});
