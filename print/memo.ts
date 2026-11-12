// The loading memo on A4: company, LOADING MEMO, the header, one ruled line per LR (the old software's table), the frozen totals and "Details of report"
// on the last sheet only. The sheets are split here, so "Page n of m", the header row on every sheet and the totals on the last one are exact.
import type { PrintMemo, PrintMemoRow, PrintSettlement } from '../shared';
import { strings } from '../src/strings';
import { A4, companyBlock, esc, pageDocument, stamp } from './template';

const t = strings.paper;

/**
 * Rows that fit under the header on the first sheet, on each next sheet, and the room the last sheet keeps (in rows): the totals line alone for a memo with no
 * settlement, the totals line and "Details of report" (4.6) for one that has it. Proven by the real-PDF test.
 */
export const FIRST_ROWS = 35;
export const NEXT_ROWS = 43;
export const TOTALS_ROWS = 3;
export const SETTLEMENT_ROWS = 14;

/**
 * How many rows go on each sheet. The last sheet always has room for the totals and at least one row (the totals never sit
 * alone); a memo with no rows is one sheet. Always at least one sheet. The capacities are the memo's unless another printout
 * (the firm statement) says its own.
 */
export function paginate(rows: number, firstRows = FIRST_ROWS, nextRows = NEXT_ROWS, totalsRows = TOTALS_ROWS): number[] {
  const sizes: number[] = [];
  let left = rows;
  for (let sheet = 0; ; sheet++) {
    const capacity = sheet === 0 ? firstRows : nextRows;
    if (left <= capacity - totalsRows) {
      sizes.push(left);
      return sizes;
    }
    const take = Math.min(capacity, left - 1);
    sizes.push(take);
    left -= take;
  }
}

/** Column widths in mm (Consignor, Consignee, LR No, Particulars, Pak, Paid, To pay, Wasuli); they add up to the 190 mm between the margins. */
const WIDTHS = [36, 36, 14, 28, 11, 21, 22, 22];

const head = () => {
  const c = t.memo.columns;
  const names = [c.consignor, c.consignee, c.lr, c.particular, c.qty, c.paid, c.toPay, c.wasuli];
  const right = [false, false, false, false, true, true, true, true];
  const cols = WIDTHS.map((w) => `<col style="width:${w}mm">`).join('');
  const cells = names.map((n, i) => `<th${right[i] ? ' class="n"' : ''}>${esc(n)}</th>`).join('');
  return `<colgroup>${cols}</colgroup><thead><tr>${cells}</tr></thead>`;
};

const row = (r: PrintMemoRow) =>
  `<tr><td>${esc(r.consignor)}</td><td>${esc(r.consignee)}</td><td>${r.lrNo}</td><td>${esc(r.particular)}</td>` +
  `<td class="n">${r.qty}</td><td class="n">${esc(r.paid)}</td><td class="n">${esc(r.toPay)}</td><td class="n">${esc(r.wasuli)}</td></tr>`;

const totals = (p: PrintMemo) => {
  const c = t.memo.columns;
  const k = p.totals;
  return `<div class="tot"><span class="l">${esc(t.memo.total(k.lrs))}</span><span>${esc(c.qty)} <b>${k.qty}</b></span><span>${esc(c.paid)} <b>${esc(k.paid)}</b></span><span>${esc(c.toPay)} <b>${esc(k.toPay)}</b></span><span>${esc(c.wasuli)} <b>${esc(k.wasuli)}</b></span></div>`;
};

/** "Details of report" in the old paper's order: the amounts as the keeper sent them, the two notes in brackets next to hamali and commission. */
const settlementBlock = (s: PrintSettlement): string => {
  const d = t.memo.details;
  const line = (label: string, value: string, cls = '', how = '') =>
    `<div class="r${cls}"><span>${esc(label)}${how ? ` <span class="how">${esc(d.how(how))}</span>` : ''}</span><span>${esc(value)}</span></div>`;
  return (
    `<div class="set"><div class="h">${esc(d.title)}</div>` +
    line(d.articles, String(s.articles)) +
    line(d.paid, s.paid) +
    line(d.toPay, s.toPay) +
    line(d.hamaliLess, s.hamaliLess, ' rule', s.hamaliHow) +
    line(d.total, s.total1, ' sub') +
    line(d.commissionLess, s.commissionLess, ' rule', s.commissionHow) +
    line(d.total, s.total2, ' sub') +
    line(d.wasuli, s.wasuli, ' rule') +
    line(d.net, s.net, ' rule bold') +
    line(d.round, s.round, ' big') +
    '</div>'
  );
};

/** What the block does differently from the rest of the page: a centred column of ruled lines, the totals indented, the round figure big. */
const CSS = `
.set{width:112mm;margin:5mm auto 0;font-size:10pt}
.set .h{text-align:center;font-weight:bold;font-size:11pt;letter-spacing:.4mm;text-decoration:underline;margin-bottom:2mm}
.set .r{display:flex;justify-content:space-between;height:5.2mm;line-height:5.2mm;white-space:nowrap}
.set .rule{border-bottom:.3mm solid #000}
.set .sub{padding-left:14mm;font-weight:bold}
.set .bold{font-weight:bold}
.set .big{font-size:12pt;font-weight:bold;margin-top:1.5mm}
.set .how{font-weight:normal}
`;

const details = (p: PrintMemo) => {
  const m = t.memo;
  const pairs: [string, string][] = [
    [m.challan, `${p.challanNo}`], [m.date, p.date],
    [m.truck, p.truck], [m.driver, p.driver],
    [m.from, p.from], [m.to, p.to],
    [m.truckHire, p.truckHire], [m.loadingHamali, p.loadingHamali],
  ];
  return `<div class="det">${pairs.map(([k, v]) => `<div><b>${esc(k)}</b> ${esc(v)}</div>`).join('')}</div>`;
};

/** The whole memo as one print page: the sheets in order, each with its own table and "Page n of m". */
export function memoHtml(p: PrintMemo): string {
  const sizes = paginate(p.rows.length, FIRST_ROWS, NEXT_ROWS, p.settlement ? SETTLEMENT_ROWS : TOTALS_ROWS);
  let at = 0;
  const sheets = sizes.map((count, i) => {
    const rows = p.rows.slice(at, at + count);
    at += count;
    const last = i === sizes.length - 1;
    const top =
      i === 0
        ? `${companyBlock(p.company)}<div class="head">${esc(t.memo.heading)}</div>${details(p)}`
        : `<div class="cont">${esc(p.company.name)} — ${esc(t.memo.continued(p.challanNo))}</div>`;
    const body = rows.map(row).join('') + (rows.length === 0 ? `<tr><td class="none" colspan="8">${esc(t.memo.none)}</td></tr>` : '');
    const note = last && p.differs ? `<div class="note">${esc(t.memo.differs)}</div>` : '';
    return `<section class="page memo">${top}<table>${head()}<tbody>${body}</tbody></table>${last ? totals(p) : ''}${note}${last && p.settlement ? settlementBlock(p.settlement) : ''}<div class="foot">${esc(t.pageOf(i + 1, sizes.length))}</div>${p.cancelled ? stamp(t.cancelled) : ''}</section>`;
  });
  return pageDocument(t.memo.title(p.challanNo), A4, sheets.join(''), CSS);
}

export const memoFileName = (p: PrintMemo): string => `Challan-${p.challanNo}-${p.challanYear}.pdf`;
