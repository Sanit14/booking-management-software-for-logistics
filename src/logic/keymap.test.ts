import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIONS, DEFAULT_KEYS, checkChange, eventToKey, keyLabel, matches, sanitize, type KeyEventLike, type Keymap } from './keymap';

const ev = (over: Partial<KeyEventLike>): KeyEventLike => ({ key: '', code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...over });

test('the defaults are the card\'s and are all different', () => {
  assert.deepEqual(DEFAULT_KEYS, {
    saveLr: 'F4',
    newLr: 'Escape',
    quickLr: 'F2',
    goLrEntry: 'F3',
    goLoadingMemo: 'F5',
    goDashboard: 'F1',
    focusLrSearch: 'Ctrl+F',
    globalSearch: 'Ctrl+K',
  });
  assert.equal(new Set(Object.values(DEFAULT_KEYS)).size, ACTIONS.length);
});

test('a key event becomes a key name by its physical key, so layouts and AltGr do not matter', () => {
  assert.equal(eventToKey(ev({ key: 'F2', code: 'F2' })), 'F2');
  assert.equal(eventToKey(ev({ key: 'q', code: 'KeyQ', ctrlKey: true })), 'Ctrl+Q');
  assert.equal(eventToKey(ev({ key: '£', code: 'Digit3', altKey: true })), 'Alt+3');
  assert.equal(eventToKey(ev({ key: 'Escape', code: 'Escape' })), 'Escape');
  assert.equal(eventToKey(ev({ key: 'Tab', code: 'Tab' })), 'Tab');
  assert.equal(eventToKey(ev({ key: 'F4', code: 'F4', altKey: true })), 'Alt+F4');
  assert.equal(eventToKey(ev({ key: 'Control', code: 'ControlLeft', ctrlKey: true })), null); // a modifier alone is not a key yet
  assert.equal(eventToKey(ev({ key: 'Shift', code: 'ShiftLeft', shiftKey: true })), null);
});

test('matches compares the event with a key name', () => {
  assert.equal(matches('F4', ev({ key: 'F4', code: 'F4' })), true);
  assert.equal(matches('F4', ev({ key: 'F4', code: 'F4', shiftKey: true })), false);
  assert.equal(matches('Ctrl+F', ev({ key: 'f', code: 'KeyF', ctrlKey: true })), true);
  assert.equal(matches('Ctrl+F', ev({ key: 'f', code: 'KeyF' })), false);
});

test('F1-F12 and Ctrl/Alt + a letter or digit may be given to an action', () => {
  for (const k of ['F6', 'F12', 'Ctrl+Q', 'Alt+7', 'Alt+Z']) assert.deepEqual(checkChange(DEFAULT_KEYS, 'quickLr', k), { ok: true }, k);
  for (const k of ['F13', 'F0', 'Q', 'Shift+F2', 'Ctrl+Shift+Q', 'Ctrl+Alt+Q', 'Meta+Q', 'Ctrl+;', 'Escape']) {
    assert.deepEqual(checkChange(DEFAULT_KEYS, 'quickLr', k), { ok: false, why: 'invalid' }, k);
  }
});

test('reserved keys are refused', () => {
  for (const k of ['Alt+F4', 'Ctrl+W', 'Ctrl+R', 'Tab', 'Enter', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+Z', 'Ctrl+Y']) {
    assert.deepEqual(checkChange(DEFAULT_KEYS, 'quickLr', k), { ok: false, why: 'reserved' }, k);
  }
});

test('a key another action uses is refused and names that action; its own key is fine', () => {
  assert.deepEqual(checkChange(DEFAULT_KEYS, 'quickLr', 'F4'), { ok: false, why: 'used', by: 'saveLr' });
  assert.deepEqual(checkChange(DEFAULT_KEYS, 'quickLr', 'F2'), { ok: true });
});

test('keyLabel shows Escape as Esc', () => {
  assert.equal(keyLabel('Escape'), 'Esc');
  assert.equal(keyLabel('Ctrl+Q'), 'Ctrl+Q');
});

test('sanitize: a good file is kept, anything wrong falls back', () => {
  const mine: Keymap = { ...DEFAULT_KEYS, quickLr: 'Ctrl+Q' };
  assert.deepEqual(sanitize(mine), mine);
  assert.deepEqual(sanitize(null), DEFAULT_KEYS);
  assert.deepEqual(sanitize('F2'), DEFAULT_KEYS);
  assert.deepEqual(sanitize({ quickLr: 'Ctrl+Q' }), { ...DEFAULT_KEYS, quickLr: 'Ctrl+Q' }); // missing actions get their default
  assert.deepEqual(sanitize({ quickLr: 'Tab', goLrEntry: 7, saveLr: 'F13' }), DEFAULT_KEYS);
});

test('sanitize: a seat file from before the search key gets Ctrl+K for it, and its other keys stay', () => {
  assert.deepEqual(sanitize({ saveLr: 'F4', quickLr: 'Ctrl+Q' }), { ...DEFAULT_KEYS, quickLr: 'Ctrl+Q' });
  assert.equal(sanitize({ globalSearch: 'F6' }).globalSearch, 'F6');
});

test('sanitize: a file that would give two actions one key is thrown away whole', () => {
  assert.deepEqual(sanitize({ quickLr: 'F4' }), DEFAULT_KEYS); // saveLr's default is F4
  assert.deepEqual(sanitize({ ...DEFAULT_KEYS, quickLr: 'F3' }), DEFAULT_KEYS);
});
