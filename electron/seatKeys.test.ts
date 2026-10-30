import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DEFAULT_KEYS } from '../src/logic/keymap';
import { loadKeys, saveKeys } from './seatKeys';

const seatDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bm-seat-'));

test('no file: the defaults', () => {
  assert.deepEqual(loadKeys(path.join(seatDir(), 'missing')), DEFAULT_KEYS);
});

test('saved keys come back after a restart (a new load)', () => {
  const dir = seatDir();
  const saved = saveKeys(dir, { ...DEFAULT_KEYS, quickLr: 'Ctrl+Q' });
  assert.equal(saved.quickLr, 'Ctrl+Q');
  assert.equal(loadKeys(dir).quickLr, 'Ctrl+Q');
});

test('two seats keep their own keys', () => {
  const a = seatDir();
  const b = seatDir();
  saveKeys(a, { ...DEFAULT_KEYS, quickLr: 'Ctrl+Q' });
  assert.equal(loadKeys(b).quickLr, 'F2');
  assert.equal(loadKeys(a).quickLr, 'Ctrl+Q');
});

test('a corrupt file, or one with a refused key, gives the defaults for what is wrong', () => {
  const dir = seatDir();
  fs.writeFileSync(path.join(dir, 'keys.json'), '{not json');
  assert.deepEqual(loadKeys(dir), DEFAULT_KEYS);
  fs.writeFileSync(path.join(dir, 'keys.json'), JSON.stringify({ quickLr: 'Tab', goLrEntry: 'Alt+L' }));
  assert.deepEqual(loadKeys(dir), { ...DEFAULT_KEYS, goLrEntry: 'Alt+L' });
});

test('saving a set that gives two actions one key writes the defaults, never the clash', () => {
  const dir = seatDir();
  const saved = saveKeys(dir, { ...DEFAULT_KEYS, quickLr: 'F4' });
  assert.deepEqual(saved, DEFAULT_KEYS);
  assert.deepEqual(loadKeys(dir), DEFAULT_KEYS);
});
