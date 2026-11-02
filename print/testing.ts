// Sample printouts for the tests and the real-PDF run (not shipped).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { PrintLr, PrintMemo, PrintMemoRow } from '../shared';

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
    godownBhada: '10.00',
    godownInsurance: '5.00',
    deliveryCharges: '2.00',
    hamali: '12.50',
    staxPercent: '5',
    stax: '90.00',
    total: '1,919.50',
    cancelled: false,
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
