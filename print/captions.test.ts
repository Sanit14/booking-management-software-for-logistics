import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Compiled to dist-electron/print/: the app's source is two folders up.
const root = path.join(__dirname, '..', '..');

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

test('the captions the owner took out (4.7-closing) are gone from the strings and from every screen', () => {
  const all = sources(path.join(root, 'src'));
  assert.ok(all.length > 50, 'the source was found');
  const hits = (re: RegExp) => all.filter((f) => re.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f));
  assert.deepEqual(hits(/pickToChange|editSameYear|cancelReasonHint/), []);
  // History's one-line hint under its filters was the only `hint` key of strings.ts and the only `t.hint` of its page
  assert.deepEqual(hits(/^\s+hint: '/m).filter((f) => f.endsWith('strings.ts')), []);
  assert.deepEqual(hits(/\bt\.hint\b/), []);
});

test('the word "article" is on no screen and on no paper: not in src/, shared/ or print/ (a memo says quantity)', () => {
  const word = new RegExp('arti' + 'cle', 'i'); // spelt in two parts so this file does not find itself
  const files = [...sources(path.join(root, 'src')), ...sources(path.join(root, 'shared')), ...sources(path.join(root, 'print'))];
  const hits = files.filter((f) => !f.endsWith('captions.test.ts') && word.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f));
  assert.deepEqual(hits, []);
});
