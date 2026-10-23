import fs from 'node:fs';
import path from 'node:path';

export type Log = (event: string, detail?: unknown) => void;

// One line per event: time, event, detail. Plain append, no rotation.
// ponytail: unbounded growth; add rotation if keeper.log is ever reported too big to open.
export function makeLog(file: string): Log {
  const oneLine = (v: unknown) =>
    String(typeof v === 'string' ? v : JSON.stringify(v)).replace(/[\r\n\t]+/g, ' ').slice(0, 2000);
  return (event, detail = '') => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${new Date().toISOString()}\t${event}\t${oneLine(detail)}\n`);
    } catch (e) {
      console.error(`[keeper] cannot write ${file}:`, e);
    }
  };
}
