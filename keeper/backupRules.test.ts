import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSeatName, driveOf, isAbsoluteWindows, sameDrive, sameFolder, seatKey } from './backupRules';

test('the drive a path is on: the letter, or the share', () => {
  assert.equal(driveOf('C:\\BookingManagerData'), 'c:\\');
  assert.equal(driveOf('d:/Backups/x'), 'd:\\');
  assert.equal(driveOf('\\\\server\\share\\BM'), '\\\\server\\share\\');
  assert.equal(driveOf('relative\\folder'), '');
});

test('same drive: the data and the backups on one disk are not a backup', () => {
  assert.equal(sameDrive('C:\\BookingManagerData', 'c:\\Users\\HP\\Backups'), true);
  assert.equal(sameDrive('C:\\BookingManagerData', 'D:\\BookingManagerBackups'), false);
  assert.equal(sameDrive('C:\\Data', '\\\\server\\share\\BM'), false);
  assert.equal(sameDrive('\\\\server\\share\\a', '\\\\server\\share\\b'), true);
  assert.equal(sameDrive('relative', 'also\\relative'), false, 'no drive is not "the same drive"');
});

test('an absolute Windows path has a drive or a share; "D:" alone and relative paths do not count', () => {
  assert.equal(isAbsoluteWindows('E:\\BM'), true);
  assert.equal(isAbsoluteWindows('\\\\server\\share\\BM'), true);
  assert.equal(isAbsoluteWindows('E:BM'), false);
  assert.equal(isAbsoluteWindows('BM\\x'), false);
  assert.equal(isAbsoluteWindows(''), false);
});

test('the same folder however it was typed', () => {
  assert.equal(sameFolder('D:\\BookingManagerBackups', 'd:\\bookingmanagerbackups\\'), true);
  assert.equal(sameFolder('D:\\BookingManagerBackups', 'D:\\BookingManagerBackups\\old'), false);
});

test('a seat name: 2 to 20 letters, digits, spaces or dashes; spaces tidied', () => {
  assert.equal(cleanSeatName('PC03'), 'PC03');
  assert.equal(cleanSeatName('  Counter   2 '), 'Counter 2');
  assert.equal(cleanSeatName('Booking-1'), 'Booking-1');
  assert.equal(cleanSeatName('काउंटर 2'), 'काउंटर 2', 'any script');
  assert.equal(cleanSeatName('A'.repeat(20)), 'A'.repeat(20));
  for (const bad of ['', ' ', 'A', 'A'.repeat(21), '--', '- -', 'PC_03', 'PC.03', 'PC/03', 'PC03!', 'a\tb\u0000']) assert.equal(cleanSeatName(bad), null, JSON.stringify(bad));
  assert.equal(cleanSeatName('a\tb'), 'a b', 'a tab is a space');
});

test('names are compared with ASCII case ignored', () => {
  assert.equal(seatKey('Counter 2'), 'counter 2');
  assert.equal(seatKey('PC03'), seatKey('pc03'));
});
