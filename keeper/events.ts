// Change events: after a committed write the keeper tells every open GET /events stream which tables changed, so
// the seats refetch just those (no polling). A refused or rolled-back write publishes nothing: callers publish
// only once the write has returned ok.
import type http from 'node:http';
import type { ChangeTable, KeeperChange } from '../shared';

export function makeEvents() {
  const open = new Set<http.ServerResponse>();
  return {
    /** Starts a server-sent-events response. The first line tells the client the stream is live. */
    add(res: http.ServerResponse): void {
      if (res.destroyed) return; // the client gave up while its request was still being read
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      open.add(res);
      res.on('close', () => open.delete(res));
    },
    publish(tables: ChangeTable[], ids?: number[]): void {
      const change: KeeperChange = ids && ids.length > 0 ? { tables, ids } : { tables };
      const frame = `data: ${JSON.stringify(change)}\n\n`;
      for (const res of open) res.write(frame);
    },
    count: (): number => open.size,
    closeAll(): void {
      for (const res of open) res.end();
      open.clear();
    },
  };
}
