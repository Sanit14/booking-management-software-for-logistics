import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReportCursor } from '../../shared';
import { NO_PAGES, startPages, withFirstPage, withMorePage, type FirstPage } from './reportPages';

const key = (row: unknown) => String(row);

const cursor = (n: number) => ({ sortKey: String(n), sortNo: n }) as unknown as ReportCursor;
const rows = (from: number, count: number) => Array.from({ length: count }, (_, i) => `row-${from + i}`);
const page = (key: string, from: number, count: number, next: ReportCursor | null, totals = `totals-${key}`): FirstPage => ({ key, rows: rows(from, count), next, totals });

test('the first answer of a report is just the first page', () => {
  const p = withFirstPage(NO_PAGES, page('a', 0, 100, cursor(100)), key);
  assert.deepEqual([p.rows.length, p.firstLen, p.next, p.stale], [100, 100, cursor(100), false]);
});

test('a change while only the first page is open replaces that page and the totals, and nothing is marked old', () => {
  const was = withFirstPage(NO_PAGES, page('a', 0, 100, cursor(100), 'old totals'), key);
  const now = withFirstPage(was, page('a', 1000, 100, cursor(1100), 'new totals'), key);
  assert.deepEqual(now.rows, rows(1000, 100));
  assert.deepEqual([now.totals, now.next, now.stale], ['new totals', cursor(1100), false]);
});

test('a change with more pages open refreshes the first page and the totals only: the pages below stay, marked out of date (O5)', () => {
  let p = withFirstPage(NO_PAGES, page('a', 0, 100, cursor(100)), key);
  p = withMorePage(p, { rows: rows(100, 100), next: cursor(200) });
  p = withMorePage(p, { rows: rows(200, 50), next: null });
  assert.equal(p.rows.length, 250);

  const now = withFirstPage(p, page('a', 5000, 100, cursor(5100), 'new totals'), key);
  assert.deepEqual(now.rows, [...rows(5000, 100), ...rows(100, 150)], 'new first page, then the old pages as they were');
  assert.deepEqual([now.totals, now.next, now.firstLen, now.stale], ['new totals', null, 100, true], 'the way on is the old last page\'s');
});

test('a first page that is shorter or longer after the change still keeps exactly the pages below it', () => {
  let p = withFirstPage(NO_PAGES, page('a', 0, 100, cursor(100)), key);
  p = withMorePage(p, { rows: rows(100, 100), next: null });
  const shorter = withFirstPage(p, page('a', 0, 98, cursor(98)), key);
  assert.deepEqual(shorter.rows, [...rows(0, 98), ...rows(100, 100)]);
  const again = withFirstPage(shorter, page('a', 0, 100, cursor(100)), key);
  assert.deepEqual(again.rows, [...rows(0, 100), ...rows(100, 100)], 'a second change keeps the same pages below');
  assert.equal(again.stale, true);
});

test('another report, period or filter starts over: nothing of the old rows, nothing marked old', () => {
  let p = withFirstPage(NO_PAGES, page('a', 0, 100, cursor(100)), key);
  p = withMorePage(p, { rows: rows(100, 100), next: null });
  const other = withFirstPage(p, page('b', 0, 40, null), key);
  assert.deepEqual([other.key, other.rows.length, other.stale], ['b', 40, false]);
});

test('a row that moved from the second page into the new first page is not shown twice', () => {
  let p = withFirstPage(NO_PAGES, page('a', 0, 100, cursor(100)), key);
  p = withMorePage(p, { rows: rows(100, 100), next: null });
  // a row was taken out of page 1: the new page 1 now ends with what was row 100 on the old page 2
  const now = withFirstPage(p, page('a', 1, 100, cursor(101)), key);
  assert.equal(new Set(now.rows).size, now.rows.length, 'no row twice');
  assert.deepEqual(now.rows, [...rows(1, 100), ...rows(101, 99)]);
  assert.equal(now.stale, true);
});

test('a page asked for before a change and answered after it is added, and the pages below are marked out of date', () => {
  const p = withFirstPage(NO_PAGES, page('a', 0, 100, cursor(100)), key);
  const quiet = withMorePage(p, { rows: rows(100, 100), next: null });
  assert.equal(quiet.stale, false, 'nothing changed meanwhile');
  const late = withMorePage(p, { rows: rows(100, 100), next: null }, true);
  assert.deepEqual([late.rows.length, late.stale], [200, true]);
  assert.equal(withMorePage(late, { rows: rows(200, 10), next: null }).stale, true, 'it stays marked until Refresh');
});

test('Refresh goes back to the first page as the keeper last gave it', () => {
  let p = withFirstPage(NO_PAGES, page('a', 0, 100, cursor(100)), key);
  p = withMorePage(p, { rows: rows(100, 100), next: null });
  const fresh = page('a', 7000, 100, cursor(7100));
  p = withFirstPage(p, fresh, key);
  assert.equal(p.stale, true);
  const back = startPages(fresh);
  assert.deepEqual([back.rows, back.next, back.stale, back.firstLen], [fresh.rows, cursor(7100), false, 100]);
});
