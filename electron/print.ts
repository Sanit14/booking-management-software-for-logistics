// Printing (3.3), the main-process side. The screen asks for "print memo 13" / "save LR 1248 as PDF"; main fetches exactly what is
// printed from the keeper, builds the page (print/), renders it in a hidden window of its own and hands it to the Windows print
// dialog or to a PDF file. The hidden window has no preload, no Node, no scripts and no network: it shows one data: page and the
// app's own CSS never gets there. Only a print that went through (or a PDF that was saved) is reported back to the keeper.
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, app, dialog, ipcMain, session, type WebContents } from 'electron';
import type { KeeperResult, PrintDone, PrintFirmStatement, PrintLr, PrintMemo, PrintReport, ReportKind, ReportQuery, StatementQuery } from '../shared';
import { errnoOf } from '../keeper/errno';
import { asStatementQuery } from '../keeper/firmRules';
import { makeLog } from '../keeper/log';
import { logPath, programDir } from '../keeper/paths';
import { asReportKind, asReportQuery } from '../keeper/reportRules';
import { printUrl } from '../print/dataUrl';
import { lrFileName, lrHtml } from '../print/lr';
import { memoFileName, memoHtml } from '../print/memo';
import { reportFileName, reportHtml } from '../print/report';
import { statementFileName, statementHtml } from '../print/statement';
import { A4, A5_LANDSCAPE, type PageSpec } from '../print/template';
import { strings } from '../src/strings';
import type { KeeperBridge } from './keeperBridge';

type Outcome = KeeperResult<{ file?: string }>;
interface Page {
  html: string;
  spec: PageSpec;
  fileName: string;
}

const log = makeLog(logPath(programDir())); // the keeper's log file: console.error is lost in the installed app

let locked = false;
/** A session of its own, in memory, that refuses every request except a data: page. */
function printSession() {
  const s = session.fromPartition('bm-print'); // no "persist:" prefix: nothing is kept
  if (!locked) {
    s.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('data:') }));
    locked = true;
  }
  return s;
}

/** The page in a window nobody sees; the window is gone when `use` is done. */
export async function withPage<T>(html: string, use: (contents: WebContents) => Promise<T>): Promise<T> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { session: printSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, devTools: false },
  });
  try {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    // ponytail: a data: URL, no temp file to clean up. Chromium refuses one over 2 MB: `run` has refused a longer printout before this (printUrl).
    const url = printUrl(html);
    if (!url) throw new Error('printout too long');
    await win.loadURL(url);
    return await use(win.webContents);
  } finally {
    win.destroy();
  }
}

/** The page as PDF bytes. The same call serves Save PDF and the real-PDF test. */
export const renderPdf = (html: string, spec: PageSpec): Promise<Buffer> =>
  withPage(html, (contents) =>
    contents.printToPDF({ pageSize: spec.size, landscape: spec.landscape, printBackground: false, margins: { marginType: 'none' }, preferCSSPageSize: true }),
  );

/** The Windows print dialog (printer, copies); resolves when the job was sent or the dialog was closed. */
const sendToPrinter = ({ html, spec }: Page): Promise<Outcome> =>
  withPage(
    html,
    (contents) =>
      new Promise<Outcome>((resolve) =>
        contents.print({ silent: false, printBackground: false, pageSize: spec.size, landscape: spec.landscape, margins: { marginType: 'none' } }, (success, reason) =>
          resolve(success ? { ok: true, value: {} } : /cancel/i.test(reason) ? { ok: false, code: 'cancelled' } : (log('print-failed', { reason }), { ok: false, code: 'failed' })),
        ),
      ),
  );

/** Asks where to save first, so closing that dialog costs nothing. */
async function savePdf(page: Page): Promise<Outcome> {
  const options = {
    title: strings.print.saveTitle,
    defaultPath: path.join(app.getPath('documents'), page.fileName),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  };
  const parent = BrowserWindow.getFocusedWindow();
  const chosen = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
  if (chosen.canceled || !chosen.filePath) return { ok: false, code: 'cancelled' };
  await fs.promises.writeFile(chosen.filePath, await renderPdf(page.html, page.spec));
  return { ok: true, value: { file: chosen.filePath } };
}

export function initPrint(bridge: Pick<KeeperBridge, 'call'>) {
  let busy = false; // a second press (a double click) while a dialog is open would open a second dialog and write a second audit row
  // A firm statement is a different printout for each period and role: `query` says which (its `firmId` is the id). A report is told by `report` (which one, for which period and filters; its id is 0).
  const run = async (kind: PrintDone['kind'], id: unknown, how: unknown, query?: StatementQuery, report?: { kind: ReportKind; query: ReportQuery }): Promise<Outcome> => {
    if (typeof id !== 'number' || !Number.isInteger(id) || (how !== 'print' && how !== 'pdf')) return { ok: false, code: 'failed', detail: 'bad request' };
    if (busy) return { ok: false, code: 'cancelled' };
    busy = true;
    try {
      let page: Page;
      if (kind === 'memo') {
        const data = await bridge.call<PrintMemo>('POST', '/print/memo', { id });
        if (!data.ok) return data;
        page = { html: memoHtml(data.value), spec: A4, fileName: memoFileName(data.value) };
      } else if (kind === 'lr') {
        const data = await bridge.call<PrintLr>('POST', '/print/lr', { id });
        if (!data.ok) return data;
        page = { html: lrHtml(data.value), spec: A5_LANDSCAPE, fileName: lrFileName(data.value) };
      } else if (kind === 'report' && report) {
        const data = await bridge.call<PrintReport>('POST', '/print/report', { report: report.kind, query: report.query });
        if (!data.ok) return data;
        page = { html: reportHtml(data.value), spec: A4, fileName: reportFileName(data.value) };
      } else {
        const data = await bridge.call<PrintFirmStatement>('POST', '/print/firm-statement', { query });
        if (!data.ok) return data;
        page = { html: statementHtml(data.value), spec: A4, fileName: statementFileName(data.value) };
      }
      // Counted on the real URL, before any dialog: long names outside ASCII take 9 characters each, so the row limits alone do not keep it under 2 MB.
      if (printUrl(page.html) === null) return { ok: false, code: kind === 'report' ? 'report-too-long' : 'print-too-long' };
      const outcome = how === 'pdf' ? await savePdf(page) : await sendToPrinter(page);
      // The audit row is for a print that went through; failing to write it does not undo the paper.
      if (outcome.ok) {
        const q = report?.query;
        const done = report && q ? { kind, id, how, report: report.kind, from: q.from, to: q.to, filters: { toStationId: q.toStationId, text: q.text, truckId: q.truckId, agentId: q.agentId } } : query ? { kind, id, how, from: query.from, to: query.to, role: query.role } : { kind, id, how };
        await bridge.call('POST', '/print/done', done);
      }
      return outcome;
    } catch (e) {
      // Never the message itself: a failed load quotes the page, names included. The log gets the kind of error, the screen a file error's code (EBUSY, EACCES).
      log('print-failed', { error: (e as Error)?.name ?? 'error', code: (e as NodeJS.ErrnoException)?.code });
      const code = errnoOf(e);
      return { ok: false, code: 'failed', ...(code ? { detail: code } : {}) };
    } finally {
      busy = false;
    }
  };
  ipcMain.handle('print:memo', (_e, id: unknown, how: unknown) => run('memo', id, how));
  ipcMain.handle('print:lr', (_e, id: unknown, how: unknown) => run('lr', id, how));
  ipcMain.handle('print:firm-statement', (_e, query: unknown, how: unknown): Promise<Outcome> => {
    const q = asStatementQuery(query);
    return q ? run('firm', q.firmId, how, q) : Promise.resolve({ ok: false, code: 'failed', detail: 'bad request' });
  });
  ipcMain.handle('print:report', (_e, kind: unknown, query: unknown, how: unknown): Promise<Outcome> => {
    const [k, q] = [asReportKind(kind), asReportQuery(query)];
    return k && q ? run('report', 0, how, undefined, { kind: k, query: q }) : Promise.resolve({ ok: false, code: 'failed', detail: 'bad request' });
  });
}
