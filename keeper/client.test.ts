import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { probe } from './client';

function listen(handler: http.RequestListener): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler).listen(0, '127.0.0.1', () => {
      resolve({ port: (server.address() as net.AddressInfo).port, close: () => server.close() });
    });
  });
}

const health = { app: 'booking-manager', state: 'ready', keeperVersion: 1, dataRoot: 'C:\\₹ डेटा', dbPath: 'x', startedAt: 't' };

test('a multibyte character split across two chunks survives', async () => {
  const json = Buffer.from(JSON.stringify(health), 'utf8');
  const cut = json.indexOf(Buffer.from('₹')) + 1; // inside the 3-byte character
  const s = await listen((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write(json.subarray(0, cut));
    setTimeout(() => res.end(json.subarray(cut)), 50);
  });
  try {
    const p = await probe(s.port);
    assert.equal(p.kind, 'up');
    assert.equal(p.kind === 'up' && p.health.dataRoot, 'C:\\₹ डेटा');
  } finally {
    s.close();
  }
});

test('something else on the port is "foreign", never "up"', async () => {
  const other = await listen((_req, res) => res.end(JSON.stringify({ app: 'delivery-manager', ok: true })));
  const html = await listen((_req, res) => res.end('<html></html>'));
  try {
    assert.deepEqual(await probe(other.port), { kind: 'foreign' });
    assert.deepEqual(await probe(html.port), { kind: 'foreign' });
  } finally {
    other.close();
    html.close();
  }
});

test('a closed port is "down" and refused', async () => {
  const s = await listen((_req, res) => res.end('{}'));
  const { port } = s;
  s.close();
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(await probe(port), { kind: 'down', refused: true });
});

test('a listener that never answers is "down" but not refused', async () => {
  const s = await listen(() => undefined);
  try {
    assert.deepEqual(await probe(s.port, { timeoutMs: 200 }), { kind: 'down', refused: false });
  } finally {
    s.close();
  }
});
