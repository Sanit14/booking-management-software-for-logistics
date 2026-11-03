// A firm's statement of account on A4: company, STATEMENT OF ACCOUNT, firm / period / which LRs, one ruled line per LR, the totals of
// the whole period on the last sheet only. Built like the loading memo (memo.ts): the sheets are split here, so "Page n of m", the
// header row on every sheet and the totals on the last one are exact. Text only comes in: the keeper did the sums and the formatting.
import type { PrintFirmStatement, PrintStatementRow } from '../shared';
import { strings } from '../src/strings';
import { paginate } from './memo';
import { A4, companyBlock, esc, pageDocument } from './template';

const t = strings.paper;
const s = t.statement;

/** Rows that fit under the header on the first sheet, on each next sheet, and the room the totals take on the last (in rows). Proven by the real-PDF test. */
export const STATEMENT_FIRST_ROWS = 36;
export const STATEMENT_NEXT_ROWS = 43;
export const STATEMENT_TOTALS_ROWS = 4;

export const paginateStatement = (rows: number): number[] => paginate(rows, STATEMENT_FIRST_ROWS, STATEMENT_NEXT_ROWS, STATEMENT_TOTALS_ROWS);

/** What differs from the memo's rules: the totals are a few lines (the sums, then the wasuli), not one; the firm's name has the first row of the details to itself. */
const CSS = '\n.stmt .tot{height:auto;flex-wrap:wrap;gap:.6mm 5mm;padding:.8mm 1.2mm}\n.stmt .tot .l{flex:0 0 100%}\n.stmt .det div:first-child{grid-column:1/-1}\n';

/**
 * Column widths in mm; they add up to the 190 mm between the margins. The LR number fits 6 digits, the date dd-mm-yyyy, and each amount
 * column 9,99,999.99 (the real-PDF test checks that none of them is cut); only the party and To may end in "…".
 */
const WIDTHS = [13, 20, 34, 20, 9, 22, 22, 24, 26];

const head = () => {
  const c = s.columns;
  const names = [c.lr, c.date, c.party, c.to, c.qty, c.toPay, c.paid, c.chargesTax, c.total];
  const right = [false, false, false, false, true, true, true, true, true];
  const cols = WIDTHS.map((w) => `<col style="width:${w}mm">`).join('');
  const cells = names.map((n, i) => `<th${right[i] ? ' class="n"' : ''}>${esc(n)}</th>`).join('');
  return `<colgroup>${cols}</colgroup><thead><tr>${cells}</tr></thead>`;
};

const row = (r: PrintStatementRow) =>
  `<tr><td class="n">${r.lrNo}</td><td>${esc(r.date)}</td><td>${esc(r.party)}</td><td>${esc(r.to)}</td><td class="n">${r.qty}</td>` +
  `<td class="n">${esc(r.toPay)}</td><td class="n">${esc(r.paid)}</td><td class="n">${esc(r.chargesTax)}</td><td class="n">${esc(r.total)}</td></tr>`;

const totals = (p: PrintFirmStatement) => {
  const x = p.totals;
  const amounts: [string, string][] = [[s.toPay, x.toPay], [s.paid, x.paid], [s.charges, x.charges], [s.stax, x.stax], [s.grand, x.total]];
  const wasuli = x.hasWasuli ? `<span class="l">${esc(s.wasuli(x.wasuliOwed, x.wasuliCollected))}</span>` : '';
  return (
    `<div class="tot"><span class="l">${esc(s.total(x.lrs, x.qty))}</span>` +
    amounts.map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join('') +
    `${wasuli}</div>`
  );
};

const details = (p: PrintFirmStatement) => {
  const pairs: [string, string][] = [[s.firm, p.firm], [s.period, s.periodText(p.from, p.to)], [s.role, s.roles[p.role]]];
  return `<div class="det">${pairs.map(([k, v]) => `<div><b>${esc(k)}</b> ${esc(v)}</div>`).join('')}</div>`;
};

/** The whole statement as one print page: the sheets in order, each with its own table and "Page n of m". */
export function statementHtml(p: PrintFirmStatement): string {
  const sizes = paginateStatement(p.rows.length);
  let at = 0;
  const sheets = sizes.map((count, i) => {
    const rows = p.rows.slice(at, at + count);
    at += count;
    const last = i === sizes.length - 1;
    const top =
      i === 0
        ? `${companyBlock(p.company)}<div class="head">${esc(s.heading)}</div>${details(p)}`
        : `<div class="cont">${esc(s.continued(p.firm))}</div>`;
    const body = rows.map(row).join('') + (rows.length === 0 ? `<tr><td class="none" colspan="9">${esc(s.none)}</td></tr>` : '');
    // "memo" gives the sheet the memo's stylesheet (rules, header, ruled lines); "stmt" is what the statement does differently.
    return `<section class="page memo stmt">${top}<table>${head()}<tbody>${body}</tbody></table>${last ? totals(p) : ''}<div class="foot">${esc(t.pageOf(i + 1, sizes.length))}</div></section>`;
  });
  return pageDocument(s.title(p.firm), A4, sheets.join(''), CSS);
}

/** Statement-<firm>-<from>-to-<to>.pdf, with only characters Windows accepts in a file name. */
export function statementFileName(p: PrintFirmStatement): string {
  const firm = Array.from(p.firm.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '')).slice(0, 40).join('').replace(/-+$/, '') || 'Firm';
  return `Statement-${firm}-${p.from === p.to ? p.from : `${p.from}-to-${p.to}`}.pdf`;
}
