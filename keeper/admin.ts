// Admin-PIN changes that touch no business table (4.2): each checks the Admin PIN and writes its audit row, in the book's own transaction.
import type { KeeperResult, ResultCode } from '../shared';
import { writeAudit } from './audit';
import { cleanSeatName, seatKey } from './backupRules';
import type { Db } from './db';
import type { makePins } from './pins';

const ok = <T>(value: T): KeeperResult<T> => ({ ok: true, value });
const refuse = (code: ResultCode, detail?: string): KeeperResult<never> => ({ ok: false, code, ...(detail ? { detail } : {}) });
const SEEN_DAYS = 30;

export function makeAdmin(pins: Pick<ReturnType<typeof makePins>, 'verify'>, now: () => Date = () => new Date()) {
  return {
    /**
     * An update is about to be installed on this seat (main has asked for the Admin PIN already; the keeper asks again, because the keeper is the
     * one that checks): one audit row, `app.update`, before the keeper is stopped for the installer.
     */
    updateStart(db: Db, seat: string, from: string, to: string, adminPin: string): KeeperResult<true> {
      const gate = pins.verify(db, 'admin', adminPin);
      if (!gate.ok) return gate;
      db.transaction(() => writeAudit(db, { seat, action: 'app.update', entity: 'settings', entityId: 'app', before: { version: from }, after: { version: to } }))();
      return ok(true);
    },

    /**
     * A new name for this seat (`seat` is the name it uses now). The Admin PIN first; then the name must be 2 to 20 letters, digits, spaces or
     * dashes and not another seat's: a seat that wrote to the book in the last 30 days, or that is online now (`online`), ASCII case ignored.
     * Writes the audit row `seat.rename`; main keeps the name in this seat's own `seat.json`. A seat that only reads and has not talked to
     * this keeper since it started is not known to us.
     */
    renameSeat(db: Db, seat: string, rawName: string, adminPin: string, online: string[]): KeeperResult<{ name: string }> {
      const gate = pins.verify(db, 'admin', adminPin);
      if (!gate.ok) return gate;
      const name = cleanSeatName(rawName);
      if (!name) return refuse('seat-name-invalid');
      if (name === seat) return refuse('seat-name-same');
      const since = new Date(now().getTime() - SEEN_DAYS * 86400000).toISOString();
      const wrote = (db.prepare('SELECT DISTINCT seat FROM audit_log WHERE at >= ?').all(since) as { seat: string }[]).map((r) => r.seat);
      // A name given by a rename that has not been used to write anything yet is taken too (it is in the rename's own row).
      // (This seat's own earlier rename is its own name, not another seat's.)
      const renamed = (db.prepare("SELECT json_extract(after_json, '$.name') AS name FROM audit_log WHERE action = 'seat.rename' AND seat != ? AND at >= ?").all(seat, since) as { name: string | null }[]).flatMap((r) => (r.name ? [r.name] : []));
      // Changing only the case of its own name is a rename; anyone else's name is taken.
      const taken = [...wrote, ...renamed, ...online].find((other) => seatKey(other) === seatKey(name) && seatKey(other) !== seatKey(seat));
      if (taken !== undefined) return refuse('seat-name-taken', taken);
      db.transaction(() => writeAudit(db, { seat, action: 'seat.rename', entity: 'seats', entityId: seat, before: { name: seat }, after: { name } }))();
      return ok({ name });
    },
  };
}
