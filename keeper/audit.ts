import type { Db } from './db';

export interface AuditEntry {
  seat: string;
  action: string;
  entity: string;
  entityId: number | string;
  before?: unknown;
  after?: unknown;
}

/**
 * Append one row to audit_log. Must run inside the transaction of the change it describes, so the two succeed
 * or fail together. This is the only code that touches audit_log, and it only ever inserts (the table also
 * refuses UPDATE and DELETE itself).
 */
export function writeAudit(db: Db, e: AuditEntry): void {
  if (!db.inTransaction) throw new Error('writeAudit must be called inside the transaction of the change it records');
  const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
  db.prepare('INSERT INTO audit_log (seat, action, entity, entity_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?)').run(
    e.seat,
    e.action,
    e.entity,
    String(e.entityId),
    json(e.before),
    json(e.after),
  );
}
