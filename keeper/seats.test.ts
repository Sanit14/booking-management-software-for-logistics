import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEAT_FORGET_MS, SEAT_FRESH_MS, makeSeats } from './seats';

function clock() {
  let t = 5_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test('other seats seen in the last 45 seconds are online; this seat is not counted', () => {
  const c = clock();
  const seats = makeSeats(c.now);
  seats.saw('counter-1');
  seats.saw('counter-2');
  assert.deepEqual(seats.othersOnline('counter-1').sort(), ['counter-2']);
  assert.deepEqual(seats.othersOnline('someone-else').sort(), ['counter-1', 'counter-2']);
});

test('a seat that stopped pinging drops out after 45 seconds, and a new ping brings it back', () => {
  const c = clock();
  const seats = makeSeats(c.now);
  seats.saw('counter-2');
  c.advance(SEAT_FRESH_MS - 1);
  assert.deepEqual(seats.othersOnline('me'), ['counter-2']);
  c.advance(1);
  assert.deepEqual(seats.othersOnline('me'), []);
  seats.saw('counter-2');
  assert.deepEqual(seats.othersOnline('me'), ['counter-2']);
});

test('names that differ only in case are one seat', () => {
  const seats = makeSeats(clock().now);
  seats.saw('Counter-1');
  assert.deepEqual(seats.othersOnline('counter-1'), []);
});

test('a seat not seen for 30 days is forgotten, so a program sending new names all day cannot grow the list for ever (O8)', () => {
  const c = clock();
  const seats = makeSeats(c.now);
  seats.saw('old-1');
  seats.saw('old-2');
  c.advance(SEAT_FORGET_MS - 1);
  seats.saw('fresh');
  assert.equal(seats.size(), 3, 'nothing is forgotten before 30 days');
  c.advance(1);
  seats.saw('fresh');
  assert.equal(seats.size(), 1, 'the two that were last seen 30 days ago are gone');
  assert.deepEqual(seats.othersOnline('me'), ['fresh']);
});
