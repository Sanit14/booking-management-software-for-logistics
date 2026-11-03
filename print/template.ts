// The document shell and the one stylesheet every printout shares. The print window loads ONLY a page built here (a data:
// URL): the app's own CSS never gets there, and the app itself has no global @media print (a test looks), so printing can
// neither leak into nor be blanked by the app's styles. Black on white, serif, nothing under 9 pt.
//
// Pages are fixed boxes (`.page`), one per sheet, with the 10 mm margin as padding and @page margin 0: what is on a sheet is
// decided here, by the page splitting in memo.ts, not by the print engine. A box is 1 mm shorter than the sheet so rounding
// never starts an empty sheet, and it never clips (`overflow` stays visible): a row that did not fit would show as an extra
// sheet, which the real-PDF test counts.

export interface PageSpec {
  size: 'A4' | 'A5';
  landscape: boolean;
}
export const A4: PageSpec = { size: 'A4', landscape: false };
export const A5_LANDSCAPE: PageSpec = { size: 'A5', landscape: true };

/** Text for an HTML body or attribute. Every name and number that is not ours goes through this. */
export const esc = (v: string | number): string =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const css = (spec: PageSpec): string => {
  const [w, h] = spec.landscape ? [210, 148] : [210, 297];
  return `
@page{size:${spec.size} ${spec.landscape ? 'landscape' : 'portrait'};margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#fff;color:#000}
body{font:9pt/1.25 "Times New Roman",Times,serif}
.page{position:relative;width:${w}mm;height:${h - 1}mm;padding:10mm;break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
.co{text-align:center}
.co .name{font-size:14pt;font-weight:bold;line-height:1.2}
.co div{line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.foot{position:absolute;right:10mm;bottom:10mm}
.stamp{position:absolute;left:50%;top:48%;transform:translate(-50%,-50%) rotate(-22deg);border:1mm solid #000;padding:2mm 8mm;font:bold 44pt/1 Arial,Helvetica,sans-serif;letter-spacing:2mm;color:transparent;-webkit-text-stroke:.45mm #000;white-space:nowrap}
table{border-collapse:collapse;table-layout:fixed;width:100%}
th,td{border:.2mm solid #000;padding:0 1.2mm;text-align:left;vertical-align:middle}
th{font-weight:bold}
.n{text-align:right;font-variant-numeric:tabular-nums}
.memo .co{margin-bottom:2mm}
.memo .head{text-align:center;font-size:12pt;font-weight:bold;letter-spacing:.5mm;border-top:.4mm solid #000;border-bottom:.4mm solid #000;padding:1mm 0;margin-bottom:2mm}
.memo .det{display:grid;grid-template-columns:1fr 1fr;column-gap:6mm;row-gap:.8mm;margin-bottom:3mm;font-size:10pt}
.memo .det div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.memo .det b{display:inline-block;min-width:30mm}
.memo .cont{font-size:10pt;font-weight:bold;height:6mm;margin-bottom:2mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.memo th{height:6.5mm}
.memo td{height:5.6mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.memo td.n{overflow:visible;text-overflow:clip}
.memo .tot{display:flex;gap:6mm;align-items:center;height:6.5mm;padding:0 1.2mm;border:.2mm solid #000;border-top:0}
.memo .tot .l{flex:1;font-weight:bold}
.memo .none{height:8mm;text-align:center;font-style:italic}
.memo .note{margin-top:2mm;font-style:italic}
.lr .co{margin-bottom:2mm}
.lr .head{display:flex;justify-content:space-between;align-items:baseline;border-top:.4mm solid #000;border-bottom:.4mm solid #000;padding:1mm 0;margin-bottom:3mm;font-size:11pt}
.lr .head .t{font-size:12pt;font-weight:bold;letter-spacing:.5mm}
.lr .cols{display:flex;gap:6mm;align-items:flex-start}
.lr .l{width:108mm}
.lr .r{width:76mm}
.lr td{height:6.4mm;font-size:10pt}
.lr .l th{width:24mm;font-size:10pt}
.lr .amt th{text-align:right;font-size:10pt}
.lr .tot td{font-weight:bold;font-size:11pt;border-top:.5mm solid #000}
.lr .sign{position:absolute;right:10mm;bottom:12mm;width:60mm;border-top:.3mm solid #000;text-align:center;padding-top:1mm}
`;
};

/** A complete page for the print window: `body` is the pages (`<section class="page …">`), one per sheet. `extraCss` is the printout's own rules, after the shared ones. */
export function pageDocument(title: string, spec: PageSpec, body: string, extraCss = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css(spec)}${extraCss}</style></head><body>${body}</body></html>`;
}

/** The company lines at the top of a page: the name, then the address, phone and GSTIN lines that are not empty. */
export function companyBlock(c: { name: string; address: string; phone: string; gstin: string }): string {
  const lines = [c.address, c.phone, c.gstin].filter((l) => l !== '').map((l) => `<div>${esc(l)}</div>`);
  return `<div class="co"><div class="name">${esc(c.name)}</div>${lines.join('')}</div>`;
}

export const stamp = (word: string): string => `<div class="stamp">${esc(word)}</div>`;
