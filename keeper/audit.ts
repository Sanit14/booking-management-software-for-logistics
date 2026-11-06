import type { Db } from './db';

export interface AuditEntry {
  seat: string;
  action: string;
  entity: string;
  entityId: number | string;
  before?: unknown;
  after?: unknown;
}

/** One audit row as a history reads it back: the JSON columns still text. */
export interface AuditRow {
  at: string;
  seat: string;
  action: string;
  before: string | null;
  after: string | null;
}

/** A row's before / after as an object. An unreadable column is "nothing": a history page must never break on one old row. */
export function parseJson(text: string | null): Record<string, unknown> {
  try {
    const v: unknown = text === null ? {} : JSON.parse(text);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
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
