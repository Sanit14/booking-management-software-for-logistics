import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_REPORT_PRINT_ROWS, type ReportKind } from '../shared';
import { strings } from '../src/strings';
import { LANDSCAPE_FIRST_ROWS, LANDSCAPE_NEXT_ROWS, LAYOUT, REPORT_FIRST_ROWS, REPORT_NEXT_ROWS, REPORT_TOTALS_ROWS, pageOf, paginateReport, reportFileName, reportHtml } from './report';
import { matchSnapshot, sampleReport, smallestPt } from './testing';

const KINDS = Object.keys(strings.paper.report.kinds) as ReportKind[];
const count = (html: string, what: string | RegExp): number => html.split(what).length - 1;
const sheetsOf = (html: string): string[] => html.split('<section').slice(1);

test('the seven reports are all here, each with a layout whose widths fill the width between the margins (190 mm on A4 portrait, 277 mm on A4 landscape)', () => {
  assert.deepEqual([...KINDS].sort(), ['consigneeWise', 'consignorWise', 'dateWise', 'firmWise', 'stationWise', 'truckWise', 'wasuli']);
  for (const kind of KINDS) {
    const { widths, numbers } = LAYOUT[kind];
    const landscape = pageOf(kind).landscape;
    assert.equal(widths.reduce((a, b) => a + b, 0), landscape ? 277 : 190, kind);
    assert.equal(widths.length, strings.paper.report.kinds[kind].columns.length, `${kind}: a width for every column`);
    assert.ok(widths.length <= (landscape ? 11 : 9), `${kind}: A4 ${landscape ? 'landscape holds 11' : 'portrait holds 9'} columns`);
    assert.ok(numbers.every((i) => i < widths.length));
  }
});

test('only Truck-wise (11 columns) prints sideways; the other six reports stay on A4 portrait', () => {
  assert.deepEqual(KINDS.filter((k) => pageOf(k).landscape), ['truckWise']);
  for (const kind of KINDS) assert.equal(pageOf(kind).size, 'A4', kind);
});

test('a sample report has a cell for every column and a total for every label of its totals strip', () => {
  for (const kind of KINDS) {
    const p = sampleReport(kind, 3);
    for (const cells of p.rows) assert.equal(cells.length, strings.paper.report.kinds[kind].columns.length, `${kind} row`);
    assert.equal(p.totals.length, strings.paper.report.kinds[kind].totals.length, `${kind} totals`);
  }
});

test('paginate: no rows is one sheet; one row over the first sheet goes to a second, and the totals never sit alone there', () => {
  assert.deepEqual(paginateReport(0), [0]);
  assert.deepEqual(paginateReport(1), [1]);
  assert.deepEqual(paginateReport(REPORT_FIRST_ROWS - REPORT_TOTALS_ROWS), [REPORT_FIRST_ROWS - REPORT_TOTALS_ROWS]);
  const over = REPORT_FIRST_ROWS - REPORT_TOTALS_ROWS + 1;
  assert.deepEqual(paginateReport(over), [over - 1, 1]);
});

test('paginate: Truck-wise has its own, smaller capacities (a sideways sheet is shorter); the totals never sit alone there either', () => {
  for (let n = 0; n <= MAX_REPORT_PRINT_ROWS; n++) {
    const sizes = paginateReport(n, 'truckWise');
    assert.equal(sizes.reduce((a, b) => a + b, 0), n, `rows ${n}`);
    sizes.forEach((size, i) => {
      const capacity = i === 0 ? LANDSCAPE_FIRST_ROWS : LANDSCAPE_NEXT_ROWS;
      assert.ok(size <= capacity - (i === sizes.length - 1 ? REPORT_TOTALS_ROWS : 0), `rows ${n}, sheet ${i + 1} has ${size}`);
      if (n > 0) assert.ok(size >= 1, `rows ${n}, sheet ${i + 1} is empty`);
    });
  }
  assert.ok(LANDSCAPE_FIRST_ROWS < REPORT_FIRST_ROWS && LANDSCAPE_NEXT_ROWS < REPORT_NEXT_ROWS);
});

test('paginate: for any number of rows up to the print limit the sizes add up and every sheet is within its capacity', () => {
  for (let n = 0; n <= MAX_REPORT_PRINT_ROWS; n++) {
    const sizes = paginateReport(n);
    assert.equal(sizes.reduce((a, b) => a + b, 0), n, `rows ${n}`);
    sizes.forEach((size, i) => {
      const capacity = i === 0 ? REPORT_FIRST_ROWS : REPORT_NEXT_ROWS;
      assert.ok(size <= capacity - (i === sizes.length - 1 ? REPORT_TOTALS_ROWS : 0), `rows ${n}, sheet ${i + 1} has ${size}`);
      if (n > 0) assert.ok(size >= 1, `rows ${n}, sheet ${i + 1} is empty`);
    });
  }
});

test('reportHtml: 60 rows are two sheets, each with its own header row and "Page n of m"; the totals are on the last sheet only — for every report', () => {
  for (const kind of KINDS) {
    const html = reportHtml(sampleReport(kind, 60));
    const sheets = sheetsOf(html);
    assert.equal(sheets.length, paginateReport(60, kind).length, kind);
    assert.ok(sheets.length >= 2, `${kind}: 60 rows need two sheets`);
    assert.equal(count(html, '<thead>'), sheets.length, `${kind}: the header row is repeated`);
    const first = strings.paper.report.kinds[kind].columns[0];
    sheets.forEach((s, i) => {
      assert.match(s, new RegExp(`Page ${i + 1} of ${sheets.length}`));
      assert.ok(s.includes(`<th>${first}</th>`), `${kind}: the header on sheet ${i + 1}`);
      assert.equal(count(s, 'class="tot"'), i === sheets.length - 1 ? 1 : 0, `${kind}: sheet ${i + 1}`);
    });
    const last = sheets[sheets.length - 1];
    strings.paper.report.kinds[kind].totals.forEach((label, i) => assert.ok(last.includes(`${label} <b>${sampleReport(kind, 60).totals[i]}</b>`), `${kind}: ${label}`));
    assert.equal(count(html, /<tr><td/g), 60, `${kind}: every row once`);
  }
});

test('reportHtml: the first sheet carries the company, the heading, the period and the filters; later sheets only say which report they continue', () => {
  const p = sampleReport('dateWise', 60, { filters: { station: 'Nagpur', text: 'kale', truck: null, agent: null } });
  const [first, second] = sheetsOf(reportHtml(p));
  for (const text of ['Sundeep Freight Movers', 'Station Road, Yavatmal 445001', 'DATE-WISE REPORT', '01-10-2026 to 31-10-2026', '<b>To station</b> Nagpur', '<b>Name contains</b> kale']) assert.ok(first.includes(text), text);
  assert.ok(!second.includes('DATE-WISE REPORT'));
  assert.match(second, /Date-wise report \(continued\)/);
  assert.ok(!first.includes('<b>Truck</b>') && !first.includes('<b>Agent</b>'), 'a filter that is not set is not named');
  assert.ok(reportHtml(sampleReport('wasuli', 2, { from: '05-10-2026', to: '05-10-2026', filters: { station: null, text: '', truck: null, agent: 'Ramesh Pawar' } })).includes('<b>Period</b> 05-10-2026<'), 'one day is named once');
  assert.ok(reportHtml(sampleReport('truckWise', 2, { filters: { station: null, text: '', truck: 'MH 29 AB 1', agent: null } })).includes('<b>Truck</b> MH 29 AB 1'));
});

test('reportHtml: Truck-wise explains the * on a differing memo, on the last sheet, and only then', () => {
  const html = reportHtml(sampleReport('truckWise', 60));
  const sheets = sheetsOf(html);
  assert.equal(count(html, strings.paper.report.differs), 1);
  assert.ok(sheets[sheets.length - 1].includes(strings.paper.report.differs));
  assert.ok(!reportHtml(sampleReport('truckWise', 60, { anyDiffers: false })).includes(strings.paper.report.differs));
  assert.ok(!reportHtml(sampleReport('dateWise', 60)).includes(strings.paper.report.differs));
});

test('reportHtml: a report with no rows says so and still prints its totals', () => {
  for (const kind of KINDS) {
    const html = reportHtml(sampleReport(kind, 0));
    assert.equal(sheetsOf(html).length, 1);
    assert.match(html, /Nothing in this period/);
    assert.ok(html.includes(`colspan="${LAYOUT[kind].widths.length}"`), kind);
    assert.equal(count(html, 'class="tot"'), 1);
  }
});

test('reportHtml: names, company lines and filters are escaped, so nothing typed can open a tag', () => {
  const evil = '<script>alert(1)</script> & "q" \'x\'';
  const p = sampleReport('consignorWise', 3, { company: { name: evil, address: '', phone: '', gstin: '' }, filters: { station: evil, text: evil, truck: null, agent: null } });
  p.rows[0][0] = evil;
  const html = reportHtml(p);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot; &#39;x&#39;'));
  assert.ok(!/<script|<img/i.test(html));
});

test('reportHtml: black and white, A4 (Truck-wise sideways) with no margin of its own, no @media print, nothing under 9 pt', () => {
  for (const kind of KINDS) {
    const html = reportHtml(sampleReport(kind, 2));
    assert.match(html, kind === 'truckWise' ? /@page\{size:A4 landscape;margin:0\}/ : /@page\{size:A4 portrait;margin:0\}/);
    assert.match(html, kind === 'truckWise' ? /\.page\{[^}]*width:297mm;height:209mm/ : /\.page\{[^}]*width:210mm;height:296mm/);
    assert.ok(!html.includes('@media'));
    assert.ok(!/#[0-9a-f]{3,6}\b/i.test(html.replace(/#fff\b|#000\b/gi, '')), 'only black and white');
    assert.ok(smallestPt(html) >= 9);
  }
});

test('reportHtml: the biggest printout (1,000 rows with the longest names) stays under the 2 MB a data: URL may be', () => {
  const long = 'X'.repeat(100);
  for (const kind of KINDS) {
    const base = sampleReport(kind, MAX_REPORT_PRINT_ROWS);
    const rows = base.rows.map((cells) => cells.map((c) => (/^[\d,.–*-]+$/.test(c) ? c : long)));
    const url = `data:text/html;charset=utf-8,${encodeURIComponent(reportHtml({ ...base, rows, filters: { station: long, text: long, truck: null, agent: null } }))}`;
    assert.ok(url.length < 1_800_000, `${kind}: ${url.length} characters`);
  }
});

test('reportFileName: a name Windows accepts, with the report and the period', () => {
  assert.equal(reportFileName(sampleReport('dateWise', 1)), 'Report-Date-wise-01-10-2026-to-31-10-2026.pdf');
  assert.equal(reportFileName(sampleReport('consignorWise', 1, { from: '05-10-2026', to: '05-10-2026' })), 'Report-Consignor-wise-05-10-2026.pdf');
  for (const kind of KINDS) assert.match(reportFileName(sampleReport(kind, 1)), /^Report-[A-Za-z-]+-\d\d-\d\d-\d{4}-to-\d\d-\d\d-\d{4}\.pdf$/);
});

test('reportHtml: snapshots', () => {
  matchSnapshot('report-date-wise-3', reportHtml(sampleReport('dateWise', 3)));
  matchSnapshot('report-truck-wise-40', reportHtml(sampleReport('truckWise', 40, { filters: { station: 'Nagpur', text: '', truck: null, agent: null } })));
  matchSnapshot('report-wasuli-empty', reportHtml(sampleReport('wasuli', 0)));
});
