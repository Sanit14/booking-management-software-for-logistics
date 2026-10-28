import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDataRoot, resolveDataRoot, DEFAULT_ROOT } from './dataRoot';

const refused = (root: string, why: string) =>
  assert.deepEqual(checkDataRoot(root, 'C:\\Users\\sundeep'), { ok: false, reason: why }, root);

test('accepts the default root and other plain folders', () => {
  assert.deepEqual(checkDataRoot('C:\\BookingManagerData', 'C:\\Users\\sundeep'), { ok: true });
  assert.deepEqual(checkDataRoot('D:\\Data\\BM', 'C:\\Users\\sundeep'), { ok: true });
});

test('refuses the Users folder itself', () => {
  refused('C:\\Users', 'user-profile');
});

test('refuses a bare drive', () => {
  refused('C:\\', 'bare-drive');
  refused('D:', 'bare-drive');
});

test('refuses anything under a user profile, Desktop, Documents, AppData or OneDrive', () => {
  refused('C:\\Users\\x\\Desktop\\data', 'user-profile');
  refused('C:\\Users\\x\\Documents\\BM', 'user-profile');
  refused('C:\\Users\\x\\AppData\\Roaming\\BM', 'user-profile');
  refused('C:\\Users\\x\\OneDrive\\BM', 'user-profile');
  refused('D:\\OneDrive - Sundeep\\BM', 'user-profile');
  refused('c:\\users\\X\\data', 'user-profile'); // case-insensitive
  // the current user's profile, wherever it lives
  assert.deepEqual(checkDataRoot('E:\\Profiles\\sundeep\\data', 'E:\\Profiles\\sundeep'), {
    ok: false,
    reason: 'user-profile',
  });
});

test('refuses anything containing DeliveryManager', () => {
  refused('C:\\DeliveryManagerData', 'delivery-manager');
  refused('D:\\deliverymanager\\BM', 'delivery-manager');
});

test('a profile that is not the current one is still not a plain folder', () => {
  // Users\<name> of any other user is refused by the structural rule, not by USERPROFILE.
  assert.deepEqual(checkDataRoot('C:\\Users\\other\\data', 'C:\\Users\\sundeep'), { ok: false, reason: 'user-profile' });
});

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bm-root-'));
}

test('resolve: BM_DATA_ROOT wins and never writes the pointer', () => {
  const dir = tmp();
  const pointer = path.join(dir, 'root.json');
  assert.equal(resolveDataRoot({ BM_DATA_ROOT: 'D:\\Dev\\BM' }, pointer), 'D:\\Dev\\BM');
  assert.equal(fs.existsSync(pointer), false);
});

test('resolve: "D:" alone is the root of drive D, never the current folder on D (which differs per process, e.g. on CI)', () => {
  const pointer = path.join(tmp(), 'root.json');
  assert.equal(resolveDataRoot({ BM_DATA_ROOT: 'D:' }, pointer), 'D:\\');
  assert.deepEqual(checkDataRoot(resolveDataRoot({ BM_DATA_ROOT: 'd:' }, pointer)), { ok: false, reason: 'bare-drive' });
});

test('resolve: always the resolved spelling (no trailing slash)', () => {
  const pointer = path.join(tmp(), 'root.json');
  assert.equal(resolveDataRoot({ BM_DATA_ROOT: 'D:\\Dev\\BM\\' }, pointer), 'D:\\Dev\\BM');
  fs.writeFileSync(pointer, JSON.stringify({ root: 'D:\\BM\\' }));
  assert.equal(resolveDataRoot({}, pointer), 'D:\\BM');
});

test('resolve: no pointer gives the default and writes the pointer', () => {
  const dir = tmp();
  const pointer = path.join(dir, 'sub', 'root.json');
  assert.equal(resolveDataRoot({}, pointer), DEFAULT_ROOT);
  assert.equal(DEFAULT_ROOT, 'C:\\BookingManagerData');
  assert.deepEqual(JSON.parse(fs.readFileSync(pointer, 'utf8')), { root: DEFAULT_ROOT });
});

test('resolve: an existing pointer is used', () => {
  const dir = tmp();
  const pointer = path.join(dir, 'root.json');
  fs.writeFileSync(pointer, JSON.stringify({ root: 'D:\\BM' }));
  assert.equal(resolveDataRoot({}, pointer), 'D:\\BM');
});

test('resolve: a corrupt pointer is an error, never silently replaced', () => {
  const dir = tmp();
  const pointer = path.join(dir, 'root.json');
  fs.writeFileSync(pointer, '{not json');
  assert.throws(() => resolveDataRoot({}, pointer), /root-pointer-unreadable/);
  assert.equal(fs.readFileSync(pointer, 'utf8'), '{not json');
});
