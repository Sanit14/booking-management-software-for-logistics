// Runs as a real Electron app (not as Node) via scripts/test-electron.cjs, as part of `npm run check`: the real print engine turns
// real pages into real PDFs. The sheet count of each PDF must be the number of sheets the template made (a row that did not fit
// would spill onto an extra sheet), and the paper size must be A4 portrait for a memo and A5 landscape for an LR. Not shipped.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, app } from 'electron';
import { lrHtml } from '../print/lr';
import { FIRST_ROWS, NEXT_ROWS, TOTALS_ROWS, memoHtml, paginate } from '../print/memo';
import { A4, A5_LANDSCAPE, type PageSpec } from '../print/template';
import { sampleLr, sampleMemo } from '../print/testing';
import { renderPdf, withPage } from './print';

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'bm-print-test-')));
// A CI runner (GitHub's windows-latest = Windows Server 2025, no GPU) cannot run Electron 22's GPU process: it crashes the moment it starts
// (exit code -1073741819), over and over, until Chromium gives up ("GPU process isn't usable") and every page load fails with ERR_FAILED (-2).
// `disable-gpu` alone only makes the GPU process draw in software; it is still a separate process. `in-process-gpu` runs that work inside the
// main process, so there is no GPU process to crash. A PDF is drawn by software anyway. Only this test app: the shipped app is not touched.
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
// With no window left (the print window is closed after each PDF) Electron quits by itself unless something listens for this.
app.on('window-all-closed', () => undefined);
const keep = process.env.BM_PRINT_OUT; // set it to look at the PDFs

/** `/Type /Page` objects, not the `/Type /Pages` tree. */
const sheets = (pdf: Buffer): number => (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
/** The first sheet's size in points, from its /MediaBox. */
function size(pdf: Buffer): [number, number] {
  const m = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString('latin1'));
  assert.ok(m, 'a /MediaBox');
  return [Number(m[3]) - Number(m[1]), Number(m[4]) - Number(m[2])];
}
const near = (got: number, want: number) => assert.ok(Math.abs(got - want) < 2, `${got} is not about ${want}`);

/**
 * How far (in mm) the content of the worst sheet reaches below where it may go: the footer / signature line, or the bottom margin.
 * A negative number is room to spare. Counting sheets in the PDF cannot see a non-last sheet that overflows (its overflow is painted
 * over the next sheet), so every sheet is measured as well, in a window that is allowed scripts (the print window is not).
 */
async function overrun(html: string): Promise<number> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const px = await win.webContents.executeJavaScript(`(() => {
      const mm = 96 / 25.4;
      let worst = -1e9;
      for (const page of document.querySelectorAll('.page')) {
        const box = page.getBoundingClientRect();
        const marks = [...page.querySelectorAll('.foot, .sign')].map((e) => e.getBoundingClientRect().top);
        const limit = marks.length ? Math.min(...marks) : box.bottom - 10 * mm;
        for (const e of page.querySelectorAll('*')) {
          if (e.closest('.foot, .sign, .stamp')) continue;
          worst = Math.max(worst, e.getBoundingClientRect().bottom - limit);
        }
      }
      return worst;
    })()`);
    return (px as number) / (96 / 25.4);
  } finally {
    win.destroy();
  }
}
const noOverrun = async (name: string, html: string) => {
  const mm = await overrun(html);
  console.log(`# ${name}: ${mm <= 0 ? `${(-mm).toFixed(1)} mm to spare` : `${mm.toFixed(1)} mm too low`}`);
  assert.ok(mm <= 0.1, `${name}: the content of a sheet runs ${mm.toFixed(1)} mm into the footer or the margin`);
};

let total = 0;
let failed = 0;
async function check(name: string, body: () => Promise<void>): Promise<void> {
  total++;
  try {
    await body();
    console.log(`ok ${total} - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok ${total} - ${name}\n  ${String((e as Error)?.message ?? e).replace(/\n/g, '\n  ')}`);
  }
}

async function pdfOf(name: string, html: string, spec: PageSpec): Promise<Buffer> {
  const pdf = await renderPdf(html, spec);
  if (keep) {
    fs.mkdirSync(keep, { recursive: true });
    fs.writeFileSync(path.join(keep, `${name}.pdf`), pdf);
  }
  assert.ok(pdf.length > 1000, `${name}: ${pdf.length} bytes`);
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
  return pdf;
}

void app.whenReady().then(async () => {
  await check('a 1-LR memo is one A4 portrait sheet', async () => {
    const pdf = await pdfOf('memo-1', memoHtml(sampleMemo(1)), A4);
    assert.equal(sheets(pdf), 1);
    const [w, h] = size(pdf);
    near(w, 595);
    near(h, 842);
    await noOverrun('memo-1', memoHtml(sampleMemo(1)));
  });

  await check('a 60-LR memo is two sheets (header row on each, totals on the last)', async () => {
    const pdf = await pdfOf('memo-60', memoHtml(sampleMemo(60)), A4);
    assert.equal(paginate(60).length, 2);
    assert.equal(sheets(pdf), 2);
  });

  // The edges of every sheet: a full sheet must not spill onto one more, one row over must start the next.
  for (const n of [0, FIRST_ROWS - TOTALS_ROWS, FIRST_ROWS - TOTALS_ROWS + 1, FIRST_ROWS, FIRST_ROWS + 1, FIRST_ROWS + NEXT_ROWS - TOTALS_ROWS, FIRST_ROWS + NEXT_ROWS - TOTALS_ROWS + 1, FIRST_ROWS + NEXT_ROWS, FIRST_ROWS + NEXT_ROWS + 1, 150, 500]) {
    await check(`a memo of ${n} LRs: the PDF has the ${paginate(n).length} sheet(s) the template made`, async () => {
      const html = memoHtml(sampleMemo(n));
      const pdf = await pdfOf(`memo-${n}`, html, A4);
      assert.equal(sheets(pdf), paginate(n).length);
      await noOverrun(`memo-${n}`, html);
    });
  }

  await check('a cancelled memo with no rows is one sheet; a cancelled 60-LR memo keeps its two', async () => {
    assert.equal(sheets(await pdfOf('memo-cancelled-0', memoHtml(sampleMemo(0, { cancelled: true, rows: [] })), A4)), 1);
    assert.equal(sheets(await pdfOf('memo-cancelled-60', memoHtml(sampleMemo(60, { cancelled: true, differs: true })), A4)), 2);
  });

  await check('an LR is one A5 landscape sheet; a cancelled paid LR too', async () => {
    await noOverrun('lr', lrHtml(sampleLr()));
    const pdf = await pdfOf('lr', lrHtml(sampleLr()), A5_LANDSCAPE);
    assert.equal(sheets(pdf), 1);
    const [w, h] = size(pdf);
    near(w, 595);
    near(h, 420);
    const cancelled = await pdfOf('lr-cancelled', lrHtml(sampleLr({ cancelled: true, mode: 'paid', consignee: 'Maharashtra State Cooperative Marketing Federation Limited, Yavatmal, Maharashtra' })), A5_LANDSCAPE);
    assert.equal(sheets(cancelled), 1);
    await noOverrun('lr-cancelled', lrHtml(sampleLr({ cancelled: true, mode: 'paid', consignee: 'Maharashtra State Cooperative Marketing Federation Limited, Yavatmal, Maharashtra' })));
  });

  // Long lines in the header: every one is cut to one line, so the sheets still fit (the company block, driver and stations, the continued-sheet title).
  const long = 'X'.repeat(100);
  const worst = { company: { name: long, address: long.toUpperCase(), phone: long, gstin: long }, driver: long, from: long, to: long, truck: long };
  for (const n of [FIRST_ROWS - TOTALS_ROWS, FIRST_ROWS + 1, FIRST_ROWS + NEXT_ROWS + 1]) {
    await check(`a memo of ${n} LRs with 100-character company, driver and station lines still fits its sheets`, async () => {
      const html = memoHtml(sampleMemo(n, { ...worst, differs: true }));
      assert.equal(sheets(await pdfOf(`memo-long-${n}`, html, A4)), paginate(n).length);
      await noOverrun(`memo-long-${n}`, html);
    });
  }

  // The print window is shut: a script and an image in the page (what a typed name would be if escaping failed) fetch nothing.
  await check('the print window runs no script and loads nothing from the network', async () => {
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits++;
      res.end('');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const bait = `<!doctype html><body><img src="http://127.0.0.1:${port}/img.png"><link rel="stylesheet" href="http://127.0.0.1:${port}/a.css"><script>fetch('http://127.0.0.1:${port}/js')</script></body>`;
    try {
      // the control: an ordinary window does fetch all three, so a silent server below means the print window refused, not that the bait is bad
      const control = new BrowserWindow({ show: false });
      await control.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(bait)}`);
      await new Promise((r) => setTimeout(r, 800));
      control.destroy();
      assert.ok(hits >= 3, `the control window made ${hits} request(s)`);
      hits = 0;
      await withPage(bait, async () => new Promise((r) => setTimeout(r, 800)));
      assert.equal(hits, 0, 'the print window made a request');
    } finally {
      server.close();
    }
  });

  console.log(`1..${total}\n# tests ${total}\n# pass ${total - failed}\n# fail ${failed}`);
  app.exit(failed === 0 ? 0 : 1);
});
