import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_ROWS, NEXT_ROWS, SETTLEMENT_ROWS, TOTALS_ROWS, memoFileName, memoHtml, paginate } from './memo';
import { matchSnapshot, sampleMemo, smallestPt } from './testing';

const count = (html: string, what: string | RegExp): number => html.split(what).length - 1;
const sheetsOf = (html: string): string[] => html.split('<section').slice(1);

test('paginate: no rows is one sheet; the totals fit on the first sheet up to FIRST_ROWS - TOTALS_ROWS rows', () => {
  assert.deepEqual(paginate(0), [0]);
  assert.deepEqual(paginate(1), [1]);
  assert.deepEqual(paginate(FIRST_ROWS - TOTALS_ROWS), [FIRST_ROWS - TOTALS_ROWS]);
});

test('paginate: one row over goes to a second sheet, and the totals never sit alone there', () => {
  const over = FIRST_ROWS - TOTALS_ROWS + 1;
  assert.deepEqual(paginate(over), [over - 1, 1]);
  assert.deepEqual(paginate(FIRST_ROWS + 1), [FIRST_ROWS, 1]);
});

test('paginate: for any number of rows the sizes add up, every sheet is within its capacity and the last one has room for the totals and a row', () => {
  for (let n = 0; n <= 600; n++) {
    const sizes = paginate(n);
    assert.equal(sizes.reduce((a, b) => a + b, 0), n, `rows ${n}`);
    sizes.forEach((size, i) => {
      const capacity = i === 0 ? FIRST_ROWS : NEXT_ROWS;
      assert.ok(size <= capacity - (i === sizes.length - 1 ? TOTALS_ROWS : 0), `rows ${n}, sheet ${i + 1} has ${size}`);
      if (n > 0) assert.ok(size >= 1, `rows ${n}, sheet ${i + 1} is empty`);
    });
  }
});

test('paginate: 60 rows are two sheets and the most a memo carries, 500, is a dozen or so', () => {
  assert.deepEqual(paginate(60), [35, 25]);
  assert.equal(paginate(500).length, 12);
});

test('memoHtml: every sheet has its own header row and "Page n of m"; the totals row is on the last sheet only', () => {
  const html = memoHtml(sampleMemo(60));
  const sheets = sheetsOf(html);
  assert.equal(sheets.length, 2);
  assert.equal(count(html, '<thead>'), 2, 'the header row is repeated');
  sheets.forEach((s, i) => {
    assert.match(s, new RegExp(`Page ${i + 1} of 2`));
    assert.match(s, /<th>Consignor<\/th><th>Consignee<\/th><th>LR No<\/th><th>Particulars<\/th><th class="n">Pak<\/th><th class="n">Paid \(₹\)<\/th><th class="n">To pay \(₹\)<\/th><th class="n">Wasuli \(₹\)<\/th>/);
    assert.equal(count(s, 'class="tot"'), i === 1 ? 1 : 0, `sheet ${i + 1}`);
  });
  assert.match(sheets[1], /Total · LRs: 60/);
  assert.match(sheets[1], /To pay \(₹\) <b>1,23,456\.00<\/b>/);
  assert.match(sheets[1], /Wasuli \(₹\) <b>4,076\.00<\/b>/);
  assert.equal(count(html, /<tr><td(?! class="none")/g), 60, 'every LR once');
});

const BLOCK = ['DETAILS OF REPORT', 'Total articles', 'Paid amount', 'To pay amount', 'Hamali less amount', 'Commission less amount', 'Wasuli amount', 'Net amount Rs.', 'Round figure Rs.'];

test('memoHtml: "Details of report" follows the last row, on the last sheet only, with the two notes next to their amounts', () => {
  const [first, second] = sheetsOf(memoHtml(sampleMemo(60)));
  for (const t of BLOCK) assert.ok(!first.includes(t), `not on the first sheet: ${t}`);
  for (const t of BLOCK) assert.ok(second.includes(t), t);
  assert.ok(second.includes('(177 × 0.40)') && second.includes('(10 %)'), 'hamali and commission say how they were worked out');
  assert.ok(second.indexOf('DETAILS OF REPORT') > second.indexOf('</table>'), 'after the last row');
  assert.ok(second.indexOf('Total articles') < second.indexOf('Net amount Rs.') && second.indexOf('Net amount Rs.') < second.indexOf('Round figure Rs.'), 'in the order of the old paper');
  assert.match(second, /Round figure Rs\.<\/span><span>10,241</);
});

test('memoHtml: a negative total and net are printed as sent, with their minus signs', () => {
  const html = memoHtml(sampleMemo(3, { settlement: { ...sampleMemo(1).settlement!, total1: '-10.00', total2: '-10.00', net: '-10.00', round: '-10' } }));
  assert.match(html, /Net amount Rs\.<\/span><span>-10\.00</);
  assert.match(html, /Round figure Rs\.<\/span><span>-10</);
});

test('memoHtml: a memo with no settlement (saved before 4.6, or cancelled) has no block and keeps its totals row', () => {
  const html = memoHtml(sampleMemo(5, { settlement: null }));
  for (const t of BLOCK) assert.ok(!html.includes(t), t);
  assert.equal(count(html, 'class="tot"'), 1);
});

test('memoHtml: the block needs room, so it never sits alone on a sheet: one row over the first sheet moves a row with it', () => {
  assert.equal(sheetsOf(memoHtml(sampleMemo(FIRST_ROWS - SETTLEMENT_ROWS))).length, 1, 'the most that fits with the block');
  const sheets = sheetsOf(memoHtml(sampleMemo(FIRST_ROWS - SETTLEMENT_ROWS + 1)));
  assert.equal(sheets.length, 2);
  assert.ok(count(sheets[1], /<tr><td(?! class="none")/g) >= 1, 'the last sheet has a row of its own');
  assert.ok(sheets[1].includes('DETAILS OF REPORT'));
  assert.equal(sheetsOf(memoHtml(sampleMemo(FIRST_ROWS - TOTALS_ROWS, { settlement: null }))).length, 1, 'without the block only the totals row has to fit');
});

test('memoHtml: the first sheet carries the company, LOADING MEMO and the header; later sheets only say which memo they continue', () => {
  const [first, second] = sheetsOf(memoHtml(sampleMemo(60)));
  for (const text of ['Sundeep Freight Movers', 'Station Road, Yavatmal 445001', 'Ph 07232 245678', 'GSTIN 27ABCDE1234F1Z5', 'LOADING MEMO', 'Challan No.', '13', '31-10-2026', 'MH 29 BE 1234', 'Ramesh Pawar', 'Yavatmal', 'Nagpur', '4,500.00', '250.75']) {
    assert.ok(first.includes(text), text);
  }
  assert.ok(!second.includes('LOADING MEMO'));
  assert.match(second, /Sundeep Freight Movers — Loading memo 13 \(continued\)/);
});

test('memoHtml: empty company lines are left out, not printed as blank lines', () => {
  const html = memoHtml(sampleMemo(1, { company: { name: 'Sundeep Freight Movers', address: '', phone: '', gstin: '' } }));
  assert.equal(count(html, '<div class="co">'), 1);
  assert.ok(!html.includes('<div></div>'));
});

test('memoHtml: the "changed after saving" line appears on the last sheet, only when the memo differs', () => {
  assert.ok(!memoHtml(sampleMemo(5)).includes('LRs changed after saving'));
  const html = memoHtml(sampleMemo(60, { differs: true }));
  const [first, second] = sheetsOf(html);
  assert.ok(!first.includes('LRs changed after saving'));
  assert.ok(second.includes('LRs changed after saving — recalculate to update totals'));
});

test('memoHtml: a cancelled memo has the CANCELLED mark on every sheet; one that is not has none', () => {
  assert.ok(!memoHtml(sampleMemo(60)).includes('CANCELLED'));
  const sheets = sheetsOf(memoHtml(sampleMemo(60, { cancelled: true })));
  assert.equal(sheets.length, 2);
  for (const s of sheets) assert.match(s, /<div class="stamp">CANCELLED<\/div>/);
});

test('memoHtml: a memo with no rows (a cancelled one) says so and still prints its frozen totals', () => {
  const html = memoHtml(sampleMemo(0, { cancelled: true, rows: [], settlement: null, totals: { lrs: 3, qty: 9, toPay: '1,000.00', paid: '0.00', wasuli: '0.00' } }));
  assert.equal(sheetsOf(html).length, 1);
  assert.match(html, /No LRs on this memo/);
  assert.match(html, /Total · LRs: 3/);
});

test('memoHtml: names and company lines are escaped, so nothing typed can open a tag', () => {
  const memo = sampleMemo(6, { company: { name: '<b>Sundeep</b> & Sons', address: '"quoted" \'line\'', phone: '', gstin: '' }, driver: '<img src=x onerror=alert(1)>' });
  const html = memoHtml(memo);
  assert.ok(html.includes('&lt;b&gt;Sundeep&lt;/b&gt; &amp; Sons'));
  assert.ok(html.includes('&quot;quoted&quot; &#39;line&#39;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('Rathod &lt;Steel&gt; &quot;House&quot;'));
  assert.ok(!/<b>Sundeep|<img|<Steel>|<script/i.test(html));
});

test('memoHtml: the page is black and white, A4 portrait with no margin of its own, and does not use @media print', () => {
  const html = memoHtml(sampleMemo(2));
  assert.match(html, /@page\{size:A4 portrait;margin:0\}/);
  assert.ok(!html.includes('@media'));
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(html.replace(/#fff\b|#000\b/gi, '')), 'only black and white');
  assert.ok(smallestPt(html) >= 9, 'nothing under 9 pt');
});

test('memoFileName: Challan-<number>-<year>.pdf', () => {
  assert.equal(memoFileName(sampleMemo(1)), 'Challan-13-2026.pdf');
});

test('memoHtml: snapshots', () => {
  matchSnapshot('memo-1', memoHtml(sampleMemo(1)));
  matchSnapshot('memo-40', memoHtml(sampleMemo(40, { differs: true })));
  matchSnapshot('memo-cancelled', memoHtml(sampleMemo(0, { cancelled: true, rows: [], settlement: null, totals: { lrs: 3, qty: 9, toPay: '1,000.00', paid: '0.00', wasuli: '0.00' } })));
});
