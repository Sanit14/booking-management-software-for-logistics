import http from 'node:http';
import { APP_ID, CHANGE_TABLES, type ChangeTable, type KeeperChange, type KeeperHealth } from '../shared';

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

const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 5000;

/** A frame is `data: {json}` lines; anything else (the `: connected` comment) is not a change. */
function parseChange(frame: string): KeeperChange | null {
  const line = frame.split('\n').find((l) => l.startsWith('data: '));
  if (!line) return null;
  try {
    const j = JSON.parse(line.slice(6)) as { tables?: unknown; ids?: unknown };
    const tables = Array.isArray(j.tables) ? j.tables.filter((t): t is ChangeTable => (CHANGE_TABLES as readonly unknown[]).includes(t)) : [];
    if (tables.length === 0) return null;
    return Array.isArray(j.ids) ? { tables, ids: j.ids.filter((i): i is number => Number.isInteger(i)) } : { tables };
  } catch {
    return null;
  }
}

/**
 * Listens to the keeper's GET /events and calls `onChange` for every change. Whenever the stream (re)connects it also
 * calls `onChange` once with every table: changes made while it was not listening (the keeper restarting, the first
 * connection still being made) were missed, so the views refetch. Retries after 1 s, 2 s, 4 s, then every 5 s until
 * stopped. Returns the stop function.
 */
export function subscribeEvents(port: number, opts: ClientOptions, onChange: (change: KeeperChange) => void): () => void {
  let stopped = false;
  let current: http.ClientRequest | null = null;
  let timer: NodeJS.Timeout | null = null;
  let delay = RETRY_FIRST_MS;

  const retry = () => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = null;
      connect();
    }, delay);
    delay = Math.min(delay * 2, RETRY_MAX_MS);
  };

  const connect = () => {
    const headers: Record<string, string> = {};
    if (opts.seat) headers['X-BM-Seat'] = encodeURIComponent(opts.seat);
    const req = http.request({ host: HOST, port, path: '/events', method: 'GET', headers, agent: false }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return retry();
      }
      delay = RETRY_FIRST_MS;
      onChange({ tables: [...CHANGE_TABLES] });
      res.setEncoding('utf8');
      let buffer = '';
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const change = parseChange(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
          if (change) onChange(change);
        }
      });
      res.on('end', retry);
      res.on('error', retry);
    });
    current = req;
    req.on('error', retry);
    req.end();
  };

  connect();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    current?.destroy();
  };
}
