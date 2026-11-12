import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_STATEMENT_PRINT_ROWS } from '../shared';
import { STATEMENT_FIRST_ROWS, STATEMENT_NEXT_ROWS, STATEMENT_TOTALS_ROWS, paginateStatement, statementFileName, statementHtml } from './statement';
import { matchSnapshot, sampleStatement, smallestPt } from './testing';

const count = (html: string, what: string | RegExp): number => html.split(what).length - 1;
const sheetsOf = (html: string): string[] => html.split('<section').slice(1);

test('paginate: no rows is one sheet; one row over the first sheet goes to a second, and the totals never sit alone there', () => {
  assert.deepEqual(paginateStatement(0), [0]);
  assert.deepEqual(paginateStatement(1), [1]);
  assert.deepEqual(paginateStatement(STATEMENT_FIRST_ROWS - STATEMENT_TOTALS_ROWS), [STATEMENT_FIRST_ROWS - STATEMENT_TOTALS_ROWS]);
  const over = STATEMENT_FIRST_ROWS - STATEMENT_TOTALS_ROWS + 1;
  assert.deepEqual(paginateStatement(over), [over - 1, 1]);
});

test('paginate: for any number of rows up to the print limit the sizes add up and every sheet is within its capacity', () => {
  for (let n = 0; n <= MAX_STATEMENT_PRINT_ROWS; n++) {
    const sizes = paginateStatement(n);
    assert.equal(sizes.reduce((a, b) => a + b, 0), n, `rows ${n}`);
    sizes.forEach((size, i) => {
      const capacity = i === 0 ? STATEMENT_FIRST_ROWS : STATEMENT_NEXT_ROWS;
      assert.ok(size <= capacity - (i === sizes.length - 1 ? STATEMENT_TOTALS_ROWS : 0), `rows ${n}, sheet ${i + 1} has ${size}`);
      if (n > 0) assert.ok(size >= 1, `rows ${n}, sheet ${i + 1} is empty`);
    });
  }
});

test('statementHtml: 60 LRs are two sheets, each with its own header row and "Page n of m"; the totals are on the last sheet only', () => {
  const html = statementHtml(sampleStatement(60));
  const sheets = sheetsOf(html);
  assert.equal(sheets.length, paginateStatement(60).length);
  assert.ok(sheets.length >= 2, '60 rows need two sheets');
  assert.equal(count(html, '<thead>'), sheets.length, 'the header row is repeated');
  sheets.forEach((s, i) => {
    assert.match(s, new RegExp(`Page ${i + 1} of ${sheets.length}`));
    assert.match(s, /<th>LR<\/th><th>Date<\/th><th>Other party<\/th>/);
    assert.equal(count(s, 'class="tot"'), i === sheets.length - 1 ? 1 : 0, `sheet ${i + 1}`);
  });
  const last = sheets[sheets.length - 1];
  assert.match(last, /Total · LRs: 60 · Qty: \d+/);
  for (const text of ['To pay <b>1,23,456.00</b>', 'Paid <b>9,87,654.50</b>', 'Hamali <b>12,345.00</b>', 'Total <b>11,29,134.40</b>']) assert.ok(last.includes(text), text);
  for (const text of ['Charges', 'Service tax', 'tax']) assert.ok(!html.includes(text), `no ${text}`);
  assert.equal(count(html, /<tr><td class="n">\d{4}<\/td><td>\d\d-10-2026<\/td>/g), 60, 'every LR once');
});

test('statementHtml: the first sheet carries the company, the heading, the firm, the period and the role; later sheets only say which statement they continue', () => {
  const [first, second] = sheetsOf(statementHtml(sampleStatement(60)));
  for (const text of ['Sundeep Freight Movers', 'Station Road, Yavatmal 445001', 'STATEMENT OF ACCOUNT', 'Shree Ganesh Traders', '01-10-2026 to 31-10-2026', 'All LRs of the firm']) assert.ok(first.includes(text), text);
  assert.ok(!second.includes('STATEMENT OF ACCOUNT'));
  assert.match(second, /Shree Ganesh Traders - statement \(continued\)/);
  assert.ok(statementHtml(sampleStatement(2, { role: 'consignee' })).includes('As consignee'));
  assert.ok(statementHtml(sampleStatement(2, { from: '05-10-2026', to: '05-10-2026' })).includes('<b>Period</b> 05-10-2026<'), 'one day is named once');
});

test('statementHtml: the wasuli line is on the last sheet only, and only when something is owed', () => {
  assert.ok(!statementHtml(sampleStatement(5)).includes('Wasuli'));
  const html = statementHtml(sampleStatement(60, { totals: { ...sampleStatement(60).totals, hasWasuli: true, wasuliOwed: '2,500.00', wasuliCollected: '1,000.00' } }));
  const sheets = sheetsOf(html);
  assert.equal(count(html, 'Wasuli (₹): to collect 2,500.00 · collected 1,000.00'), 1);
  assert.ok(sheets[sheets.length - 1].includes('Wasuli (₹)'));
});

test('statementHtml: a statement with no LRs says so and still prints its totals', () => {
  const html = statementHtml(sampleStatement(0));
  assert.equal(sheetsOf(html).length, 1);
  assert.match(html, /No LRs in this period/);
  assert.match(html, /Total · LRs: 0 · Qty: 0/);
});

test('statementHtml: names and company lines are escaped, so nothing typed can open a tag', () => {
  const html = statementHtml(sampleStatement(6, { firm: '<b>Kale</b> & Sons', company: { name: '"Q" \'name\'', address: '', phone: '', gstin: '' } }));
  assert.ok(html.includes('&lt;b&gt;Kale&lt;/b&gt; &amp; Sons'));
  assert.ok(html.includes('&quot;Q&quot; &#39;name&#39;'));
  assert.ok(html.includes('Rathod &lt;Steel&gt; &quot;House&quot;'));
  assert.ok(!/<b>Kale|<Steel>|<script|<img/i.test(html));
});

test('statementHtml: black and white, A4 portrait with no margin of its own, no @media print, nothing under 9 pt', () => {
  const html = statementHtml(sampleStatement(2));
  assert.match(html, /@page\{size:A4 portrait;margin:0\}/);
  assert.ok(!html.includes('@media'));
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(html.replace(/#fff\b|#000\b/gi, '')), 'only black and white');
  assert.ok(smallestPt(html) >= 9);
});

test('statementHtml: the biggest printout (1,000 LRs with the longest names) stays under the 2 MB a data: URL may be', () => {
  const long = 'X'.repeat(100);
  const base = sampleStatement(MAX_STATEMENT_PRINT_ROWS);
  const rows = base.rows.map((r) => ({ ...r, party: long, to: long }));
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(statementHtml({ ...base, rows, firm: long }))}`;
  assert.ok(url.length < 1_800_000, `${url.length} characters`);
});

test('statementFileName: a name Windows accepts, with the period', () => {
  assert.equal(statementFileName(sampleStatement(1)), 'Statement-Shree-Ganesh-Traders-01-10-2026-to-31-10-2026.pdf');
  assert.equal(statementFileName(sampleStatement(1, { firm: 'A/B: "C" *D*?', from: '05-10-2026', to: '05-10-2026' })), 'Statement-A-B-C-D-05-10-2026.pdf');
  assert.equal(statementFileName(sampleStatement(1, { firm: '///' })), 'Statement-Firm-01-10-2026-to-31-10-2026.pdf');
  assert.ok(statementFileName(sampleStatement(1, { firm: 'Z'.repeat(200) })).length < 90);
});

test('statementHtml: snapshots', () => {
  matchSnapshot('statement-1', statementHtml(sampleStatement(1)));
  matchSnapshot('statement-40', statementHtml(sampleStatement(40, { role: 'consignor', totals: { ...sampleStatement(40).totals, hasWasuli: true, wasuliOwed: '2,500.00', wasuliCollected: '1,000.00' } })));
  matchSnapshot('statement-empty', statementHtml(sampleStatement(0)));
});
