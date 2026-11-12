// Sample printouts for the tests and the real-PDF run (not shipped).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { PrintFirmStatement, PrintLr, PrintMemo, PrintMemoRow, PrintReport, PrintStatementRow, ReportKind } from '../shared';

const NAMES = ['Shree Ganesh Traders', 'Patil Hardware', 'Kale Brothers', 'Jain Cloth Stores & Sons', 'Deshmukh Agro Industries Private Limited', 'Rathod <Steel> "House"'];

/** A memo of `count` LRs. Every tenth LR has a name too long for its column, so the one-line rule is exercised. */
export function sampleMemo(count: number, over: Partial<PrintMemo> = {}): PrintMemo {
  const rows: PrintMemoRow[] = Array.from({ length: count }, (_, i) => ({
    sr: i + 1,
    lrNo: 1200 + i,
    consignor: NAMES[i % NAMES.length],
    consignee: i % 10 === 9 ? 'Maharashtra State Cooperative Marketing Federation Limited, Yavatmal' : NAMES[(i + 2) % NAMES.length],
    destination: 'Nagpur',
    particular: i % 3 === 0 ? 'Cloth bales' : 'Hardware & fittings',
    qty: 3 + (i % 5),
    toPay: i % 2 === 0 ? '1,800.00' : '–',
    paid: i % 2 === 0 ? '–' : '2,500.50',
  }));
  return {
    company: { name: 'Sundeep Freight Movers', address: 'Station Road, Yavatmal 445001', phone: 'Ph 07232 245678', gstin: 'GSTIN 27ABCDE1234F1Z5' },
    challanNo: 13,
    challanYear: 2026,
    date: '31-10-2026',
    truck: 'MH 29 BE 1234',
    driver: 'Ramesh Pawar',
    from: 'Yavatmal',
    to: 'Nagpur',
    truckHire: '4,500.00',
    loadingHamali: '250.75',
    cancelled: false,
    differs: false,
    rows,
    totals: { lrs: count, qty: rows.reduce((s, r) => s + r.qty, 0), toPay: '1,23,456.00', paid: '9,87,654.50' },
    ...over,
  };
}

export function sampleLr(over: Partial<PrintLr> = {}): PrintLr {
  return {
    company: { name: 'Sundeep Freight Movers', address: 'Station Road, Yavatmal 445001', phone: 'Ph 07232 245678', gstin: 'GSTIN 27ABCDE1234F1Z5' },
    lrNo: 1248,
    lrYear: 2026,
    date: '31-10-2026',
    from: 'Yavatmal',
    to: 'Nagpur',
    consignor: 'Shree Ganesh Traders',
    consignee: 'Kale Brothers',
    particular: 'Cloth bales',
    qty: 7,
    mode: 'topay',
    freight: '1,800.00',
    hamali: '12.50',
    total: '1,812.50',
    cancelled: false,
    ...over,
  };
}

/** A firm statement of `count` LRs. Every tenth LR has a party name too long for its column, so the one-line rule is exercised. */
export function sampleStatement(count: number, over: Partial<PrintFirmStatement> = {}): PrintFirmStatement {
  const rows: PrintStatementRow[] = Array.from({ length: count }, (_, i) => ({
    lrNo: 1200 + i,
    date: `${String(1 + (i % 28)).padStart(2, '0')}-10-2026`,
    party: i % 10 === 9 ? 'Maharashtra State Cooperative Marketing Federation Limited, Yavatmal' : NAMES[(i + 2) % NAMES.length],
    to: i % 4 === 0 ? 'Nagpur' : 'Amravati',
    qty: 3 + (i % 5),
    toPay: i % 2 === 0 ? '1,800.00' : '–',
    paid: i % 2 === 0 ? '–' : '2,500.50',
    hamali: i % 3 === 0 ? '132.00' : '–',
    total: i % 2 === 0 ? '1,932.00' : '2,632.50',
  }));
  return {
    company: { name: 'Sundeep Freight Movers', address: 'Station Road, Yavatmal 445001', phone: 'Ph 07232 245678', gstin: 'GSTIN 27ABCDE1234F1Z5' },
    firm: 'Shree Ganesh Traders',
    role: 'both',
    from: '01-10-2026',
    to: '31-10-2026',
    rows,
    totals: {
      lrs: count, qty: rows.reduce((s, r) => s + r.qty, 0), toPay: '1,23,456.00', paid: '9,87,654.50', hamali: '12,345.00', total: '11,29,134.40',
      wasuliOwed: '0.00', wasuliCollected: '0.00', hasWasuli: false,
    },
    ...over,
  };
}

/** A cell as it comes from the keeper: an amount ('–' = nothing in this row) or a count. */
const AMOUNTS = ['1,234.50', '12,345.00', '9,99,999.99', '56.00', '4,500.25', '1,23,456.78', '780.00', '2,00,000.00', '99.99'];
const amt = (i: number, mod: number): string => (i % mod === 0 ? '–' : AMOUNTS[i % AMOUNTS.length]);
const longName = 'Maharashtra State Cooperative Marketing Federation Limited, Yavatmal';
/** The cells of row `i` and the totals strip of each report, in the order of its columns (strings.paper.report). */
const REPORT_SAMPLES: Record<ReportKind, { row: (i: number) => string[]; totals: string[] }> = {
  dateWise: {
    row: (i) => [`${String(1 + (i % 28)).padStart(2, '0')}-10-2026`, String(3 + (i % 40)), String(10 + (i % 90)), amt(i, 2), amt(i + 1, 2), amt(i, 3), '12,345.67'],
    totals: ['1,234', '5,678', '12,34,567.89', '9,87,654.50', '12,345.00', '29,13,134.40'],
  },
  stationWise: {
    row: (i) => [i % 10 === 9 ? longName : `Station ${i}`, String(3 + (i % 40)), String(10 + (i % 90)), amt(i, 2), amt(i + 1, 2), amt(i, 5)],
    totals: ['1,234', '5,678', '12,34,567.89', '9,87,654.50', '1,000.00'],
  },
  consignorWise: {
    row: (i) => [i % 10 === 9 ? longName : NAMES[i % NAMES.length], i % 3 === 0 ? 'Nagpur' : '', String(3 + (i % 40)), String(10 + (i % 90)), amt(i, 2), amt(i + 1, 2), amt(i, 5)],
    totals: ['1,234', '5,678', '12,34,567.89', '9,87,654.50', '1,000.00'],
  },
  consigneeWise: {
    row: (i) => [i % 10 === 9 ? longName : NAMES[(i + 1) % NAMES.length], i % 3 === 0 ? 'Amravati' : '', String(3 + (i % 40)), String(10 + (i % 90)), amt(i, 2), amt(i + 1, 2), amt(i, 5)],
    totals: ['1,234', '5,678', '12,34,567.89', '9,87,654.50', '1,000.00'],
  },
  truckWise: {
    row: (i) => [`${String(1 + (i % 28)).padStart(2, '0')}-10-2026`, `${1200 + i}${i % 7 === 6 ? '*' : ''}`, i % 10 === 9 ? longName : 'MH 29 BE 1234', i % 4 === 0 ? 'Nagpur' : 'Amravati', String(20 + (i % 60)), amt(i, 2), amt(i + 1, 2), '5,000.00', amt(i, 3)],
    totals: ['60', '1,234', '12,34,567.89', '9,87,654.50', '3,00,000.00', '12,000.00'],
  },
  firmWise: {
    row: (i) => [i % 10 === 9 ? longName : NAMES[i % NAMES.length], String(i % 50), String((i * 3) % 50), String(10 + (i % 90)), amt(i, 2), amt(i + 1, 2)],
    totals: ['60', '1,234', '1,200', '34', '28'],
  },
  wasuli: {
    row: (i) => [i % 10 === 9 ? longName : `Agent ${i}`, String(i % 30), amt(i, 4), String(i % 20), amt(i, 3)],
    totals: ['24', '1,23,456.00', '31', '45,678.00', '12', '60,000.00'],
  },
};

/** A report of `count` rows. Every tenth name is too long for its column, so the one-line rule is exercised. */
export function sampleReport(report: ReportKind, count: number, over: Partial<PrintReport> = {}): PrintReport {
  const sample = REPORT_SAMPLES[report];
  return {
    company: { name: 'Sundeep Freight Movers', address: 'Station Road, Yavatmal 445001', phone: 'Ph 07232 245678', gstin: 'GSTIN 27ABCDE1234F1Z5' },
    report,
    from: '01-10-2026',
    to: '31-10-2026',
    filters: { station: null, text: '', truck: null, agent: null },
    rows: Array.from({ length: count }, (_, i) => sample.row(i)),
    totals: sample.totals,
    anyDiffers: report === 'truckWise' && count > 6,
    ...over,
  };
}

/** The smallest font size in points the page's CSS asks for, in `font-size` and in the `font` shorthand. */
export function smallestPt(html: string): number {
  const sizes = [...html.matchAll(/font(?:-size)?:\s*(?:[a-z-]+\s+)*(\d+(?:\.\d+)?)pt/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length >= 3, 'font sizes were found');
  return Math.min(...sizes);
}

/**
 * Compares `html` with print/snapshots/<name>.html (one tag per line, so a change reads as a diff). UPDATE_SNAPSHOTS=1 rewrites
 * the file; a missing snapshot is written and fails once, so it cannot go in unreviewed.
 */
export function matchSnapshot(name: string, html: string): void {
  // compiled to dist-electron/print/, the snapshots sit with the source
  const file = path.join(__dirname, '..', '..', 'print', 'snapshots', `${name}.html`);
  const now = html.replace(/></g, '>\n<') + '\n';
  const missing = !fs.existsSync(file);
  const update = process.env.UPDATE_SNAPSHOTS === '1';
  if (update || missing) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, now);
    assert.ok(update, `snapshot ${name} did not exist: written, look at it and run again`);
    return;
  }
  const before = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(now, before, `snapshot ${name} changed (UPDATE_SNAPSHOTS=1 rewrites it)`);
}
