// Runs as a real Electron app via scripts/test-electron.cjs, as part of `npm run check`. The real `Dialog` and `PinDialog` (bundled by the runner from
// src/ui/dialogHarness.tsx, which nests them the way a saved memo's windows are nested) get a real Escape from Electron's input pipeline, not from a
// script: one Escape must close only the dialog in front and give the focus back to the one under it. Not shipped.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, app } from 'electron';

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'bm-dialog-test-')));
// Same as the print test: no separate GPU process (a CI runner cannot run Electron 22's).
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.on('window-all-closed', () => undefined);

const bundle = process.env.BM_DIALOG_HARNESS; // the page the runner built: a folder with index.html in it

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

void app
  .whenReady()
  .then(async () => {
    assert.ok(bundle && fs.existsSync(path.join(bundle, 'index.html')), 'BM_DIALOG_HARNESS must name the folder the runner built');
    const win = new BrowserWindow({ width: 800, height: 600, show: false });
    await win.loadFile(path.join(bundle, 'index.html'));
    const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>;
    /** The titles of the open dialogs, the one at the back first. */
    const open = () => js<string[]>(`[...document.querySelectorAll('dialog')].filter((d) => d.open).map((d) => d.querySelector('h2').textContent)`);
    /** Which dialog holds the cursor (its title), or '' when it is on no dialog. */
    const focusIn = () => js<string>(`(document.activeElement.closest('dialog')?.querySelector('h2')?.textContent) ?? ''`);
    /** Reads until it says `want` (a busy PC may be slow to draw) or 2 s have passed, and returns the last answer for the assertion. */
    const settled = async <T>(read: () => Promise<T>, want: T): Promise<T> => {
      let got = await read();
      for (let i = 0; i < 40 && JSON.stringify(got) !== JSON.stringify(want); i++) {
        await sleep(50);
        got = await read();
      }
      return got;
    };
    const click = (id: string) => js(`document.getElementById(${JSON.stringify(id)}).click()`);
    // A real key press, through the same path as the keyboard (not a script-made event); a hidden window gets no keys, so the page is shown without taking focus.
    const escape = () => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    };
    win.showInactive();
    win.webContents.focus();

    await check('a dialog opened over another leaves both open', async () => {
      await click('open-outer');
      await settled(open, ['Outer']);
      await click('open-inner');
      assert.deepEqual(await settled(open, ['Outer', 'Inner']), ['Outer', 'Inner']);
      assert.equal(await settled(focusIn, 'Inner'), 'Inner');
    });

    await check('one Escape closes only the dialog in front, and the cursor goes back to the dialog under it; the second Escape closes that one too', async () => {
      escape();
      assert.deepEqual(await settled(open, ['Outer']), ['Outer'], 'the inner dialog closed alone');
      assert.equal(await settled(focusIn, 'Outer'), 'Outer', 'and the cursor is in the dialog under it');
      await sleep(200); // were a second dialog going to close late, it would have by now
      assert.deepEqual(await open(), ['Outer']);
      escape();
      assert.deepEqual(await settled(open, []), []);
    });

    await check('three deep (a PIN window over a window over a dialog): each Escape closes one', async () => {
      await click('open-outer');
      await settled(open, ['Outer']);
      await click('open-inner');
      await settled(open, ['Outer', 'Inner']);
      await click('open-pin');
      assert.deepEqual(await settled(open, ['Outer', 'Inner', 'PIN']), ['Outer', 'Inner', 'PIN']);
      escape();
      assert.deepEqual(await settled(open, ['Outer', 'Inner']), ['Outer', 'Inner']);
      assert.equal(await settled(focusIn, 'Inner'), 'Inner');
      escape();
      assert.deepEqual(await settled(open, ['Outer']), ['Outer']);
      escape();
      assert.deepEqual(await settled(open, []), []);
    });

    win.destroy();
    console.log(`1..${total}\n# tests ${total}\n# pass ${total - failed}\n# fail ${failed}`);
    app.exit(failed === 0 ? 0 : 1);
  })
  .catch((e) => {
    // Anything outside a check (the page missing, the window not loading) must end the run at once: with no window left Electron would wait for the runner's 240 s timeout.
    console.log(`not ok - ${String((e as Error)?.message ?? e)}\n# tests ${total + 1}\n# pass ${total - failed}\n# fail ${failed + 1}`);
    app.exit(1);
  });
