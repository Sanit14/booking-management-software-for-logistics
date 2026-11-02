// The LR (bilti) on A5 landscape: company, LORRY RECEIPT with the number and date, the parties and goods on the left, every
// amount on the right, a signature line. A default layout until the owner sends a photo of their own bilti.
import type { PrintLr } from '../shared';
import { strings } from '../src/strings';
import { A5_LANDSCAPE, companyBlock, esc, pageDocument, stamp } from './template';

const t = strings.paper.lr;

export function lrHtml(p: PrintLr): string {
  const mode = p.mode === 'topay' ? t.toPay : p.mode === 'paid' ? t.paid : '–';
  const goods: [string, string][] = [
    [t.from, p.from], [t.to, p.to], [t.consignor, p.consignor], [t.consignee, p.consignee], [t.particular, p.particular], [t.qty, String(p.qty)], [t.payment, mode],
  ];
  const amounts: [string, string][] = [
    [p.mode === 'none' ? t.freight : `${t.freight} (${mode})`, p.freight],
    [t.godownBhada, p.godownBhada], [t.godownInsurance, p.godownInsurance], [t.deliveryCharges, p.deliveryCharges], [t.hamali, p.hamali],
    [t.stax(p.staxPercent), p.stax],
  ];
  const left = goods.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  const right =
    `<tr><th colspan="2">${esc(t.amounts)}</th></tr>` +
    amounts.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${esc(v)}</td></tr>`).join('') +
    `<tr class="tot"><td>${esc(t.total)}</td><td class="n">${esc(p.total)}</td></tr>`;
  const sheet =
    `<section class="page lr">${companyBlock(p.company)}` +
    `<div class="head"><span class="t">${esc(t.heading)}</span><span>${esc(t.lrNo)} <b>${p.lrNo}</b></span><span>${esc(t.date)} <b>${esc(p.date)}</b></span></div>` +
    `<div class="cols"><table class="l"><tbody>${left}</tbody></table><table class="r amt"><tbody>${right}</tbody></table></div>` +
    `<div class="sign">${esc(t.signature)}</div>${p.cancelled ? stamp(strings.paper.cancelled) : ''}</section>`;
  return pageDocument(t.title(p.lrNo), A5_LANDSCAPE, sheet);
}

export const lrFileName = (p: PrintLr): string => `LR-${p.lrNo}-${p.lrYear}.pdf`;
