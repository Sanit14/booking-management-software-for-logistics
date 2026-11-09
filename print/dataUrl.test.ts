import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_STATEMENT_PRINT_ROWS } from '../shared';
import { MAX_DATA_URL_CHARS, printUrl } from './dataUrl';
import { statementHtml } from './statement';
import { sampleStatement } from './testing';

// 100 Devanagari letters: three bytes in UTF-8, so nine characters in the URL (%E0%A4%85) against one for a letter of the English alphabet.
const devanagari = 'श्रीगणेशट्रेडर्स'.repeat(8).slice(0, 100);

test('the guard counts the real data: URL, not the rows: 1,000 statement rows of long Devanagari names are over what Chromium accepts, ASCII ones are not (audit, print Low)', () => {
  const base = sampleStatement(MAX_STATEMENT_PRINT_ROWS);
  const statement = (name: string) => statementHtml({ ...base, rows: base.rows.map((r) => ({ ...r, party: name, to: name })), firm: name });

  assert.ok(printUrl(statement('X'.repeat(100))), 'the longest English names fit, as the row limit assumed');
  const html = statement(devanagari);
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  assert.ok(url.length > MAX_DATA_URL_CHARS, `the rows limit alone would let ${url.length} characters through`);
  assert.equal(printUrl(html), null, 'too long: refused before anything is loaded');
});

test('a short page gives the URL that loads it, unchanged by the guard', () => {
  assert.equal(printUrl('<p>नमस्ते</p>'), `data:text/html;charset=utf-8,${encodeURIComponent('<p>नमस्ते</p>')}`);
});
