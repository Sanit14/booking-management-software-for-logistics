// A report on A4 portrait (4.1; Truck-wise on A4 landscape since 4.6): company, the report's heading, its period and filters, one ruled line per row, the totals of the whole
// filter on the last sheet only. Built like the firm statement (statement.ts): the sheets are split here, so "Page n of m", the header row
// on every sheet and the totals on the last one are exact. Text only comes in: the keeper did the sums and the formatting. One template
// serves all seven reports; each has its columns named in `strings.paper.report` and its widths here (6 reports have 9 columns or fewer; Truck-wise has 11).
import type { PrintReport, ReportKind } from '../shared';
import { strings } from '../src/strings';
import { paginate } from './memo';
import { A4, A4_LANDSCAPE, companyBlock, esc, pageDocument, type PageSpec } from './template';

const t = strings.paper;
const r = t.report;

/** Rows that fit under the header on the first sheet, on each next sheet, and the room the totals (and Truck-wise's footnote) take on the last. Proven by the real-PDF test. */
export const REPORT_FIRST_ROWS = 36;
export const REPORT_NEXT_ROWS = 43;
export const REPORT_TOTALS_ROWS = 5;
/** The same for the report that prints sideways (Truck-wise, 11 columns): a sideways sheet is 210 mm high, so it holds fewer rows. Proven by the real-PDF test. */
export const LANDSCAPE_FIRST_ROWS = 22;
export const LANDSCAPE_NEXT_ROWS = 28;

/** A4 portrait for every report but Truck-wise: its 11 columns (with Wasuli and the round figure) need the 277 mm of a sideways sheet. */
export const pageOf = (kind: ReportKind): PageSpec => (kind === 'truckWise' ? A4_LANDSCAPE : A4);

export const paginateReport = (rows: number, kind: ReportKind = 'dateWise'): number[] =>
  pageOf(kind).landscape ? paginate(rows, LANDSCAPE_FIRST_ROWS, LANDSCAPE_NEXT_ROWS, REPORT_TOTALS_ROWS) : paginate(rows, REPORT_FIRST_ROWS, REPORT_NEXT_ROWS, REPORT_TOTALS_ROWS);

/** What differs from the memo's rules: the totals are a few lines, not one; headings stay on one line; a note under the totals. */
const CSS = '\n.rep .tot{height:auto;flex-wrap:wrap;gap:.6mm 5mm;padding:.8mm 1.2mm}\n.rep .tot .l{flex:0 0 100%}\n.rep th{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n';

/**
 * Column widths in mm (they add up to the 190 mm between the margins of A4 portrait, or the 277 mm of A4 landscape for Truck-wise) and which columns are numbers. Amount columns hold 12,34,567.89 whole
 * where a row can add up to that much (the real-PDF test checks that no number is cut); a name, a truck or a station may end in "…".
 */
export const LAYOUT: Record<ReportKind, { widths: number[]; numbers: number[] }> = {
  dateWise: { widths: [24, 14, 16, 32, 32, 32, 40], numbers: [1, 2, 3, 4, 5, 6] },
  stationWise: { widths: [64, 14, 16, 32, 32, 32], numbers: [1, 2, 3, 4, 5] },
  consignorWise: { widths: [54, 28, 12, 14, 28, 28, 26], numbers: [2, 3, 4, 5, 6] },
  consigneeWise: { widths: [54, 28, 12, 14, 28, 28, 26], numbers: [2, 3, 4, 5, 6] },
  truckWise: { widths: [22, 16, 36, 32, 12, 26, 26, 24, 28, 29, 26], numbers: [1, 4, 5, 6, 7, 8, 9, 10] },
  firmWise: { widths: [60, 30, 30, 14, 28, 28], numbers: [1, 2, 3, 4, 5] },
  wasuli: { widths: [58, 30, 38, 28, 36], numbers: [1, 2, 3, 4] },
};

const head = (kind: ReportKind) => {
  const { widths, numbers } = LAYOUT[kind];
  const cols = widths.map((w) => `<col style="width:${w}mm">`).join('');
  const cells = r.kinds[kind].columns.map((n, i) => `<th${numbers.includes(i) ? ' class="n"' : ''}>${esc(n)}</th>`).join('');
  return `<colgroup>${cols}</colgroup><thead><tr>${cells}</tr></thead>`;
};

const row = (kind: ReportKind, cells: string[]) => {
  const { numbers } = LAYOUT[kind];
  return `<tr>${cells.map((c, i) => `<td${numbers.includes(i) ? ' class="n"' : ''}>${esc(c)}</td>`).join('')}</tr>`;
};

const totals = (p: PrintReport) => {
  const pairs = r.kinds[p.report].totals.map((k, i) => `<span>${esc(k)} <b>${esc(p.totals[i] ?? '')}</b></span>`).join('');
  const note = p.anyDiffers ? `<div class="note">${esc(r.differs)}</div>` : '';
  return `<div class="tot"><span class="l">${esc(r.total)}</span>${pairs}</div>${note}`;
};

const details = (p: PrintReport) => {
  const f = p.filters;
  const pairs: [string, string][] = [[r.period, r.periodText(p.from, p.to)]];
  if (f.station) pairs.push([r.station, f.station]);
  if (f.text) pairs.push([r.text, f.text]);
  if (f.truck) pairs.push([r.truck, f.truck]);
  if (f.agent) pairs.push([r.agent, f.agent]);
  return `<div class="det">${pairs.map(([k, v]) => `<div><b>${esc(k)}</b> ${esc(v)}</div>`).join('')}</div>`;
};

/** The whole report as one print page: the sheets in order, each with its own table and "Page n of m". */
export function reportHtml(p: PrintReport): string {
  const kind = p.report;
  const sizes = paginateReport(p.rows.length, kind);
  let at = 0;
  const sheets = sizes.map((count, i) => {
    const rows = p.rows.slice(at, at + count);
    at += count;
    const last = i === sizes.length - 1;
    const top =
      i === 0
        ? `${companyBlock(p.company)}<div class="head">${esc(r.kinds[kind].heading)}</div>${details(p)}`
        : `<div class="cont">${esc(r.continued(r.kinds[kind].name))}</div>`;
    const body = rows.map((cells) => row(kind, cells)).join('') + (rows.length === 0 ? `<tr><td class="none" colspan="${LAYOUT[kind].widths.length}">${esc(r.none)}</td></tr>` : '');
    // "memo" gives the sheet the memo's stylesheet (rules, header, ruled lines); "rep" is what a report does differently.
    return `<section class="page memo rep">${top}<table>${head(kind)}<tbody>${body}</tbody></table>${last ? totals(p) : ''}<div class="foot">${esc(t.pageOf(i + 1, sizes.length))}</div></section>`;
  });
  return pageDocument(r.title(r.kinds[kind].name), pageOf(kind), sheets.join(''), CSS);
}

/** Report-<name>-<from>-to-<to>.pdf, with only characters Windows accepts in a file name. */
export function reportFileName(p: PrintReport): string {
  return `Report-${r.kinds[p.report].name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${p.from === p.to ? p.from : `${p.from}-to-${p.to}`}.pdf`;
}
