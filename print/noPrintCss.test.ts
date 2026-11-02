import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Compiled to dist-electron/print/: the app's source is two folders up.
const root = path.join(__dirname, '..', '..');

function files(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (/\.(css|tsx?|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('the app has no global print styles: nothing under src/ or index.html says @media print or media="print"', () => {
  const list = [...files(path.join(root, 'src')), path.join(root, 'index.html')];
  assert.ok(list.length > 50, 'the source was found');
  const hits = list.filter((f) => /@media\s+print|media\s*=\s*["']print/i.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(hits.map((f) => path.relative(root, f)), []);
});
