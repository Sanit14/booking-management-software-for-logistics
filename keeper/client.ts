import http from 'node:http';
import { APP_ID, type KeeperHealth } from '../shared';

const HOST = '127.0.0.1';

/** What is on the keeper port. `refused` = nothing listens; without it, something listens but did not answer in time. */
export type Probe =
  | { kind: 'up'; health: KeeperHealth }
  | { kind: 'down'; refused: boolean }
  | { kind: 'foreign' }; // answers, but is not a Booking Manager keeper

export interface ClientOptions {
  timeoutMs?: number;
  seat?: string;
}

function request(port: number, method: 'GET' | 'POST', urlPath: string, opts: ClientOptions, body?: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = {};
    // Header values must be latin-1; a Windows user name need not be.
    if (opts.seat) headers['X-BM-Seat'] = encodeURIComponent(opts.seat);
    const payload = method === 'POST' ? JSON.stringify(body ?? {}) : undefined;
    if (payload !== undefined) Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
    // agent: false = a fresh connection per call; a reused socket can be reset by a keeper that just restarted.
    const req = http.request({ host: HOST, port, path: urlPath, method, headers, agent: false }, (res) => {
      // Decode the stream, not each chunk: a multibyte character (₹, Devanagari) split across two chunks
      // would otherwise turn into U+FFFD.
      res.setEncoding('utf8');
      let body = '';
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(opts.timeoutMs ?? 3000, () => req.destroy(new Error('timeout')));
    req.end(payload);
  });
}

export async function probe(port: number, opts: ClientOptions = {}): Promise<Probe> {
  let r: { status: number; body: string };
  try {
    r = await request(port, 'GET', '/health', opts);
  } catch (e) {
    return { kind: 'down', refused: (e as NodeJS.ErrnoException).code === 'ECONNREFUSED' };
  }
  let parsed: { app?: string } | null;
  try {
    parsed = JSON.parse(r.body);
  } catch {
    return { kind: 'foreign' };
  }
  if (!parsed || parsed.app !== APP_ID) return { kind: 'foreign' };
  if (r.status === 200) return { kind: 'up', health: parsed as unknown as KeeperHealth };
  return { kind: 'foreign' };
}

/** Ask a keeper to checkpoint, close the database and exit. True if it acknowledged. */
export async function shutdown(port: number, opts: ClientOptions = {}): Promise<boolean> {
  try {
    return (await request(port, 'POST', '/shutdown', opts)).status === 200;
  } catch {
    return false;
  }
}

/**
 * One named keeper route that answers with JSON (the callers in electron/keeperBridge.ts name the routes; the
 * screen never does). The body of a POST is sent as JSON. Throws if the keeper cannot be reached in time.
 */
export async function callJson(port: number, method: 'GET' | 'POST', urlPath: string, body?: unknown, opts: ClientOptions = {}): Promise<{ status: number; json: unknown }> {
  const r = await request(port, method, urlPath, opts, body);
  let json: unknown = null;
  try {
    json = JSON.parse(r.body);
  } catch {
    /* not JSON: the caller sees json === null */
  }
  return { status: r.status, json };
}
