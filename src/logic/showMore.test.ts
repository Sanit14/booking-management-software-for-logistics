import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_ROWS, firstRows } from './showMore';

const list = (n: number) => Array.from({ length: n }, (_, i) => i);

test('a list of the first-page size or less is drawn whole (the very same array), a longer one shows its first rows and says how many are left', () => {
  const small = list(FIRST_ROWS);
  assert.equal(firstRows(small, FIRST_ROWS).rows, small);
  assert.equal(firstRows(small, FIRST_ROWS).hidden, 0);
  const long = list(FIRST_ROWS + 150);
  const shown = firstRows(long, FIRST_ROWS);
  assert.deepEqual([shown.rows.length, shown.hidden, shown.rows[0], shown.rows[FIRST_ROWS - 1]], [FIRST_ROWS, 150, 0, FIRST_ROWS - 1]);
});

test('Show more raises the limit by one page; the rows keep their order and none repeats', () => {
  const long = list(1000);
  let limit = FIRST_ROWS;
  const seen = [firstRows(long, limit).rows.length];
  for (let i = 0; i < 4; i++) seen.push(firstRows(long, (limit += FIRST_ROWS)).rows.length);
  assert.deepEqual(seen, [200, 400, 600, 800, 1000]);
  assert.equal(firstRows(long, limit).hidden, 0);
  assert.deepEqual(firstRows(long, 400).rows, long.slice(0, 400));
});
