// Times the screens with long lists in the REAL app window (session 4.4, audit O6): a day of 400 LRs in LR Entry and 500 firms in Masters. It runs as an
// Electron app (scripts/measure-ui.cjs starts it), with the real preload and the real main-process bridge, against a private book it fills through the
// keeper's own routes. Not part of `npm run check` (a number belongs to a PC, and it uses the keeper port, so no other Booking Manager may be running).
//
// What it times, 20 runs each, in ms:
//   key    one keystroke in the box over the list: the page renders again with every row, the browser lays it out (sync) and paints the next frame (frame)
//   event  another seat's save: from the keeper's change event reaching the window to the new row on screen (read again, JSON, render, paint)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, app, ipcMain, powerSaveBlocker } from 'electron';
import type { LrInput } from '../shared';
import { FIRST_ROWS } from '../src/logic/showMore';
import { strings } from '../src/strings';
import { initKeeperBridge } from './keeperBridge';
import { loadKeys, saveKeys } from './seatKeys';

const RUNS = 20;
const LRS = 400;
const FIRMS = 500;
const LABEL_LR_FIND = strings.lr.findLabel;
const LABEL_MASTERS_SEARCH = strings.masters.searchLabel;

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-ui-timing-'));
app.setPath('userData', userData);
app.on('window-all-closed', () => undefined);
// A window that is hidden, covered or on a locked screen stops painting, and every frame below would wait for ever: keep the display on and the renderer awake.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
powerSaveBlocker.start('prevent-display-sleep');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { median: at(0.5), p95: at(0.95), worst: s[s.length - 1] };
};
const fmt = (n: number) => n.toFixed(1);

/** Helpers the window gets once: all timing is taken inside the page, with its own clock. */
const PAGE_HELPERS = `(() => {
  const frame = () => new Promise((resolve, reject) => {
    const stuck = setTimeout(() => reject(new Error('the window is not painting (hidden, covered or locked screen?)')), 5000);
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(stuck); resolve(); }));
  });
  const setValue = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const rows = (label) => document.querySelectorAll('table[aria-label="' + label + '"] tbody tr').length;
  // How many LRs / firms the page says it has (the list may draw fewer rows: "Show more").
  const lrCount = () => { const s = document.querySelector('[class*="totalsStrip"] strong'); return s ? Number(s.textContent) : 0; };
  const tabCount = (name) => { const b = [...document.querySelectorAll('[role="tab"]')].find((x) => x.textContent.trim().startsWith(name)); return b ? Number(b.textContent.replace(/[^0-9]/g, '')) : 0; };
  const box = (label) => [...document.querySelectorAll('input')].find((i) => (i.getAttribute('aria-label') || (i.labels && i.labels[0] && i.labels[0].textContent) || '').includes(label));
  const click = (text) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(text)); if (!b) throw new Error('no button ' + text); b.click(); };
  window.__t = {
    click,
    rows,
    lrCount,
    tabCount,
    async waitRows(label, n) { for (let i = 0; i < 400 && rows(label) < n; i++) await new Promise((r) => setTimeout(r, 50)); return rows(label); },
    async keys(label, values) {
      const el = box(label);
      if (!el) throw new Error('no box ' + label);
      const out = [];
      for (const v of values) {
        await frame();
        const t0 = performance.now();
        setValue(el, v);
        void document.body.offsetHeight; // style and layout, now
        const sync = performance.now() - t0;
        await frame();
        out.push([sync, performance.now() - t0]);
      }
      setValue(el, '');
      await frame();
      return out;
    },
    // Armed before the other seat's save; settles with the time from the change event reaching this window to the row being on screen.
    arm(table, kind, want) {
      const count = kind === 'lr' ? lrCount : () => tabCount(${JSON.stringify(strings.masters.tabs.firms)});
      window.__pending = new Promise((resolve, reject) => {
        let t0 = 0;
        const giveUp = setTimeout(() => reject(new Error('no change event or new row within 15 s')), 15000);
        const off = window.bm.keeper.onChanged((c) => { if (!t0 && c.tables.includes(table)) t0 = performance.now(); });
        const tick = () => {
          if (t0 && count() >= want) requestAnimationFrame(() => { off(); clearTimeout(giveUp); resolve(performance.now() - t0); });
          else requestAnimationFrame(tick);
        };
        tick();
      });
    },
    result: () => window.__pending,
  };
})()`;

async function main(): Promise<string> {
  ipcMain.handle('seat:keys-get', () => loadKeys(userData));
  ipcMain.handle('seat:keys-set', (_e, keys: unknown) => saveKeys(userData, keys));
  const bridge = initKeeperBridge(userData);
  const status = await bridge.status();
  if (status.kind !== 'connected') throw new Error(`the keeper is not up: ${JSON.stringify(status)}`);
  const post = async <T>(url: string, body: unknown): Promise<T> => {
    const r = await bridge.call<T>('POST', url, body, 120000);
    if (!r.ok) throw new Error(`${url}: ${r.code} ${JSON.stringify(r.fields ?? r.detail ?? '')}`);
    return r.value;
  };

  // ---- the book: PINs, two stations, 500 firms, 400 LRs dated today ----
  await post('/pins/setup', { adminPin: '1111', systemPin: '2222' });
  const station = async (name: string) => (await post<{ id: number }>('/masters/create', { kind: 'stations', fields: { name } })).id;
  const from = await station('Yavatmal');
  const to = await station('Nagpur');
  const word = (i: number) => String.fromCharCode(97 + (i % 26), 97 + (Math.floor(i / 26) % 26), 97 + (Math.floor(i / 676) % 26), 120, 121, 122); // six letters, none a prefix of another
  const firmIds: number[] = [];
  for (let i = 0; i < FIRMS; i++) firmIds.push((await post<{ id: number }>('/masters/create', { kind: 'firms', fields: { name: `${word(i)} Traders` }, confirmSimilar: true })).id);
  let serial = 0;
  const lr = (over: Partial<LrInput> = {}): LrInput => ({
    uid: `timing-${++serial}`, date: null, fromStationId: from, toStationId: to,
    consignor: { firmId: firmIds[serial % FIRMS], name: '', addToFirms: false }, consignee: { firmId: null, name: `Walk-in ${serial}`, addToFirms: false },
    particular: 'Cloth bales', qty: '3', toPay: '1,800', paid: '', hamali: '', wasuli: '', confirmSimilar: false, systemPin: '', ...over,
  });
  for (let i = 0; i < LRS; i++) await post('/lrs/create', { input: lr() });

  // ---- the window: the built screen, the real preload ----
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    show: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, additionalArguments: ['--app-version=timing'] },
  });
  await win.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  const run = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code) as Promise<T>;
  for (let i = 0; i < 200 && !(await run<boolean>(`!!document.querySelector('aside nav button')`)); i++) await sleep(100);
  await run(PAGE_HELPERS);

  const lrTable = strings.lr.listLabel;
  const masterTable = strings.masters.listLabel('firms');
  const out: string[] = [];
  const row = (what: string, xs: number[], extra = '') => {
    const s = stats(xs);
    out.push(`| ${what} | ${fmt(s.median)} | ${fmt(s.p95)} | ${fmt(s.worst)} |${extra}`);
    return s.median;
  };
  const values = Array.from({ length: RUNS }, (_, i) => ['1', '12', '123', '1234', '12345', '123456', '1234567'][i % 7]);

  // LR Entry
  await run(`__t.click(${JSON.stringify(strings.pages.lrEntry)})`);
  const lrDrawn = await run<number>(`__t.waitRows(${JSON.stringify(lrTable)}, ${Math.min(LRS, FIRST_ROWS)})`);
  const lrRows = await run<number>('__t.lrCount()');
  if (lrDrawn < Math.min(LRS, FIRST_ROWS) || lrRows < LRS) throw new Error(`LR Entry draws ${lrDrawn} rows of ${lrRows} LRs, not ${LRS}`);
  const typed = await run<[number, number][]>(`__t.keys(${JSON.stringify(LABEL_LR_FIND)}, ${JSON.stringify(values)})`);
  const lrKey = row(`LR Entry, ${lrRows} LRs (${lrDrawn} rows drawn): a keystroke in the find box, to the next frame`, typed.map((t) => t[1]));
  row('  of which render and layout (sync)', typed.map((t) => t[0]));
  const lrEvent: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    await run(`__t.arm('lrs', 'lr', ${lrRows + i + 1})`);
    await post('/lrs/create', { input: lr() });
    lrEvent.push(await run<number>('__t.result()'));
  }
  const lrEventMedian = row('LR Entry: another seat saves an LR (change event to the new row on screen)', lrEvent);

  // Masters, Firms tab
  await run(`__t.click(${JSON.stringify(strings.pages.masters)})`);
  await run(`__t.click(${JSON.stringify(strings.masters.tabs.firms)})`);
  const firmDrawn = await run<number>(`__t.waitRows(${JSON.stringify(masterTable)}, ${Math.min(FIRMS, FIRST_ROWS)})`);
  const firmRows = await run<number>(`__t.tabCount(${JSON.stringify(strings.masters.tabs.firms)})`);
  if (firmDrawn < Math.min(FIRMS, FIRST_ROWS) || firmRows < FIRMS) throw new Error(`Masters draws ${firmDrawn} rows of ${firmRows} firms, not ${FIRMS}`);
  // every firm is called "... Traders", so each of these keeps all the rows on screen: the worst case for the list
  const letters = Array.from({ length: RUNS }, (_, i) => ['r', 'ra', 'rad', 'rade', 'rader', 'raders'][i % 6]);
  const searched = await run<[number, number][]>(`__t.keys(${JSON.stringify(LABEL_MASTERS_SEARCH)}, ${JSON.stringify(letters)})`);
  const mKey = row(`Masters, ${firmRows} firms (${firmDrawn} rows drawn): a keystroke in the search box, to the next frame`, searched.map((t) => t[1]));
  row('  of which render and layout (sync)', searched.map((t) => t[0]));
  const mEvent: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    await run(`__t.arm('firms', 'firms', ${firmRows + i + 1})`);
    await post('/masters/create', { kind: 'firms', fields: { name: `${word(FIRMS + i)} Traders` }, confirmSimilar: true });
    mEvent.push(await run<number>('__t.result()'));
  }
  const mEventMedian = row('Masters: another seat adds a firm (change event to the new row on screen)', mEvent);

  const worst = Math.max(lrKey, lrEventMedian, mKey, mEventMedian);
  win.destroy(); // the keeper is stopped by scripts/measure-ui.cjs, which checks that it is on this private book first
  return [
    `Electron ${process.versions.electron}, Chromium ${process.versions.chrome}, ${os.cpus()[0]?.model ?? 'cpu'}, ${RUNS} runs each. Milliseconds.`,
    '',
    '| What | median | p95 | worst |',
    '| --- | --- | --- | --- |',
    ...out,
    '',
    `Decision rule (card): a median over 100 ms means the first ${FIRST_ROWS} rows with "Show more"; this build draws ${FIRST_ROWS} rows. Highest median here: ${fmt(worst)} ms. If a keystroke is over 100 ms the drawing is too slow; if only an event is, the rest is the reads it triggers.`,
  ].join('\n');
}

void app.whenReady().then(async () => {
  // Whatever goes wrong, the run ends: 10 minutes is far more than it needs (about 1).
  setTimeout(() => {
    console.error('ui timing: gave up after 10 minutes');
    app.exit(1);
  }, 10 * 60 * 1000).unref();
  try {
    const report = await main();
    console.log(`UI-TIMING-BEGIN\n${report}\nUI-TIMING-END`);
    app.exit(0);
  } catch (e) {
    console.error('ui timing failed:', e);
    app.exit(1);
  }
});
