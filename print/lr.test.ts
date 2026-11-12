import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lrFileName, lrHtml } from './lr';
import { matchSnapshot, sampleLr, smallestPt } from './testing';

test('lrHtml: one A5 landscape sheet with the company, LORRY RECEIPT, the number, the date, the parties, the goods, freight, hamali and the total', () => {
  const html = lrHtml(sampleLr());
  assert.equal(html.split('<section').length - 1, 1);
  assert.match(html, /@page\{size:A5 landscape;margin:0\}/);
  for (const text of [
    'Sundeep Freight Movers', 'Station Road, Yavatmal 445001', 'LORRY RECEIPT', 'LR No.', '1248', '31-10-2026', 'Yavatmal', 'Nagpur', 'Shree Ganesh Traders', 'Kale Brothers', 'Cloth bales', '>7<',
    'Freight (To pay)', '1,800.00', 'Hamali', '12.50', 'Total', '1,812.50', 'Signature',
  ]) {
    assert.ok(html.includes(text), text);
  }
  // The charge lines and the service tax are gone from the paper (4.5).
  for (const text of ['Godown', 'Delivery', 'Service tax', 'Charges']) assert.ok(!html.includes(text), `no ${text}`);
  assert.ok(!html.includes('CANCELLED'));
});

test('lrHtml: a paid LR says Paid, an LR with no freight just says Freight', () => {
  assert.match(lrHtml(sampleLr({ mode: 'paid' })), /Freight \(Paid\)/);
  const none = lrHtml(sampleLr({ mode: 'none', freight: '0.00' }));
  assert.ok(none.includes('>Freight<'));
  assert.ok(!none.includes('Freight ('));
});

test('lrHtml: a cancelled LR has the CANCELLED mark', () => {
  assert.match(lrHtml(sampleLr({ cancelled: true })), /<div class="stamp">CANCELLED<\/div>/);
});

test('lrHtml: names are printed as typed but escaped, so nothing typed can open a tag', () => {
  const html = lrHtml(sampleLr({ consignor: 'Ravi <Kale> & Co', consignee: '"Patil" \'Hardware\'', particular: '<script>alert(1)</script>' }));
  assert.ok(html.includes('Ravi &lt;Kale&gt; &amp; Co'));
  assert.ok(html.includes('&quot;Patil&quot; &#39;Hardware&#39;'));
  assert.ok(!/<script|<Kale>/i.test(html));
});

test('lrHtml: black and white, nothing under 9 pt, no @media print', () => {
  const html = lrHtml(sampleLr());
  assert.ok(!html.includes('@media'));
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(html.replace(/#fff\b|#000\b/gi, '')));
  assert.ok(smallestPt(html) >= 9, 'nothing under 9 pt');
});

test('lrFileName: LR-<number>-<year>.pdf', () => {
  assert.equal(lrFileName(sampleLr()), 'LR-1248-2026.pdf');
});

test('lrHtml: snapshots', () => {
  matchSnapshot('lr', lrHtml(sampleLr()));
  matchSnapshot('lr-cancelled-paid', lrHtml(sampleLr({ cancelled: true, mode: 'paid', consignor: 'Ravi <Kale> & Co' })));
});
