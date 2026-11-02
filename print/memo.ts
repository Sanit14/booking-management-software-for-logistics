// The loading memo on A4: company, LOADING MEMO, the header, one ruled line per LR, the frozen totals on the last sheet only.
// The sheets are split here, so "Page n of m", the header row on every sheet and the totals on the last one are exact.
import type { PrintMemo, PrintMemoRow } from '../shared';
import { strings } from '../src/strings';
import { A4, companyBlock, esc, pageDocument, stamp } from './template';

const t = strings.paper;

/** Rows that fit under the header on the first sheet, on each next sheet, and the room the totals line takes on the last (in rows). */
export const FIRST_ROWS = 35;
export const NEXT_ROWS = 43;
export const TOTALS_ROWS = 3;

/**
 * How many rows go on each sheet. The last sheet always has room for the totals and at least one row (the totals never sit
 * alone); a memo with no rows is one sheet. Always at least one sheet.
 */
export function paginate(rows: number): number[] {
  const sizes: number[] = [];
  let left = rows;
  for (let sheet = 0; ; sheet++) {
    const capacity = sheet === 0 ? FIRST_ROWS : NEXT_ROWS;
    if (left <= capacity - TOTALS_ROWS) {
      sizes.push(left);
      return sizes;
    }
    const take = Math.min(capacity, left - 1);
    sizes.push(take);
    left -= take;
  }
}

/** Column widths in mm; they add up to the 190 mm between the margins. */
const WIDTHS = [8, 13, 34, 34, 20, 28, 9, 22, 22];

const head = () => {
  const c = t.memo.columns;
  const names = [c.sr, c.lr, c.consignor, c.consignee, c.destination, c.particular, c.qty, c.toPay, c.paid];
  const right = [false, false, false, false, false, false, true, true, true];
  const cols = WIDTHS.map((w) => `<col style="width:${w}mm">`).join('');
  const cells = names.map((n, i) => `<th${right[i] ? ' class="n"' : ''}>${esc(n)}</th>`).join('');
  return `<colgroup>${cols}</colgroup><thead><tr>${cells}</tr></thead>`;
};

const row = (r: PrintMemoRow) =>
  `<tr><td class="n">${r.sr}</td><td class="n">${r.lrNo}</td><td>${esc(r.consignor)}</td><td>${esc(r.consignee)}</td><td>${esc(r.destination)}</td><td>${esc(r.particular)}</td>` +
  `<td class="n">${r.qty}</td><td class="n">${esc(r.toPay)}</td><td class="n">${esc(r.paid)}</td></tr>`;

const totals = (p: PrintMemo) => {
  const c = t.memo.columns;
  return `<div class="tot"><span class="l">${esc(t.memo.total(p.totals.lrs))}</span><span>${esc(c.qty)} <b>${p.totals.qty}</b></span><span>${esc(c.toPay)} <b>${esc(p.totals.toPay)}</b></span><span>${esc(c.paid)} <b>${esc(p.totals.paid)}</b></span></div>`;
};

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
  const sizes = paginate(p.rows.length);
  let at = 0;
  const sheets = sizes.map((count, i) => {
    const rows = p.rows.slice(at, at + count);
    at += count;
    const last = i === sizes.length - 1;
    const top =
      i === 0
        ? `${companyBlock(p.company)}<div class="head">${esc(t.memo.heading)}</div>${details(p)}`
        : `<div class="cont">${esc(p.company.name)} — ${esc(t.memo.continued(p.challanNo))}</div>`;
    const body = rows.map(row).join('') + (rows.length === 0 ? `<tr><td class="none" colspan="9">${esc(t.memo.none)}</td></tr>` : '');
    const note = last && p.differs ? `<div class="note">${esc(t.memo.differs)}</div>` : '';
    return `<section class="page memo">${top}<table>${head()}<tbody>${body}</tbody></table>${last ? totals(p) : ''}${note}<div class="foot">${esc(t.pageOf(i + 1, sizes.length))}</div>${p.cancelled ? stamp(t.cancelled) : ''}</section>`;
  });
  return pageDocument(t.memo.title(p.challanNo), A4, sheets.join(''));
}

export const memoFileName = (p: PrintMemo): string => `Challan-${p.challanNo}-${p.challanYear}.pdf`;
