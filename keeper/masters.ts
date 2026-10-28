// Master data: stations, firms, trucks, drivers. Every write is ONE transaction with its audit row and answers with
// the saved row. Nothing is ever deleted: a row is deactivated, so old LRs and reports keep pointing at it.
// Editing and deactivating need the System PIN, checked here (pins.verify) before anything is written.
// The tables are small and the screen holds them all (all()), so name checks that SQL cannot do alone
// (similar names, driver duplicates) read the other rows of one kind inside the transaction: nothing else can
// write meanwhile, the keeper being the only process that touches the database.
import type { KeeperResult, MasterFields, MasterKind, MasterRow, MastersAll, ResultCode } from '../shared';
import { writeAudit } from './audit';
import type { Db } from './db';
import { cleanName, cleanPhone, cleanTruck, findSimilar, truckKey } from './masterRules';
import { nameKey } from './names';
import type { makePins } from './pins';

type Refusal = Extract<KeeperResult<never>, { ok: false }>;
const refuse = (code: ResultCode, extra: Omit<Refusal, 'ok' | 'code'> = {}): Refusal => ({ ok: false, code, ...extra });
const ok = <T>(value: T): KeeperResult<T> => ({ ok: true, value });

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

// What a row looks like to the screen. Business-key order, never by id.
const SELECT: Record<MasterKind, string> = {
  stations: 'SELECT id, name, active, version FROM stations',
  firms: 'SELECT id, name, station_id AS stationId, phone, active, version FROM firms',
  trucks: 'SELECT id, number, active, version FROM trucks',
  drivers: 'SELECT id, name, phone, active, version FROM drivers',
};
const ORDER: Record<MasterKind, string> = {
  stations: 'ORDER BY name_key',
  firms: 'ORDER BY name_key',
  trucks: 'ORDER BY number_key',
  drivers: 'ORDER BY name COLLATE NOCASE, phone',
};

const asRow = (raw: Record<string, unknown>): MasterRow => ({ ...raw, active: raw.active === 1 }) as unknown as MasterRow;
const byId = (db: Db, kind: MasterKind, id: number): MasterRow | undefined => {
  const raw = db.prepare(`${SELECT[kind]} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return raw && asRow(raw);
};
const listAll = (db: Db, kind: MasterKind): MasterRow[] =>
  (db.prepare(`${SELECT[kind]} ${ORDER[kind]}`).all() as Record<string, unknown>[]).map(asRow);

/** The typed fields, cleaned. `name` is the number for a truck; `key` is the unique key. */
interface Clean {
  name: string;
  key: string;
  stationId: number | null;
  phone: string;
}

/** Cleans what was typed; `ownStation` is the firm's current station, which stays allowed even if it was deactivated since. */
function clean(db: Db, kind: MasterKind, f: MasterFields, ownStation: number | null): Clean | Refusal {
  const text = (v: unknown): string => (typeof v === 'string' ? v : '');
  if (kind === 'trucks') {
    const number = cleanTruck(text(f.number));
    return number === null ? refuse('master-bad', { detail: 'number' }) : { name: number, key: truckKey(number), stationId: null, phone: '' };
  }
  const name = cleanName(text(f.name));
  if (name === null) return refuse('master-bad', { detail: 'name' });
  const out: Clean = { name, key: nameKey(name), stationId: null, phone: '' };
  if (kind === 'stations') return out;
  const phone = cleanPhone(f.phone === undefined ? '' : typeof f.phone === 'string' ? f.phone : '?'); // a non-string is not a phone
  if (phone === null) return refuse('master-bad', { detail: 'phone' });
  out.phone = phone;
  if (kind === 'firms' && f.stationId !== undefined && f.stationId !== null) {
    const id = f.stationId;
    const station = Number.isInteger(id) ? (db.prepare('SELECT active FROM stations WHERE id = ?').get(id) as { active: number } | undefined) : undefined;
    if (!station || (station.active !== 1 && id !== ownStation)) return refuse('master-bad', { detail: 'station' });
    out.stationId = id;
  }
  return out;
}

const EXISTING: Record<'stations' | 'firms' | 'trucks', string> = {
  stations: 'SELECT id FROM stations WHERE name_key = ? AND id != ?',
  firms: 'SELECT id FROM firms WHERE name_key = ? AND id != ?',
  trucks: 'SELECT id FROM trucks WHERE number_key = ? AND id != ?',
};

/** Exact duplicates are refused (active or not); similar firm / driver names need `confirmSimilar`. `selfId` is 0 for a new row. */
function conflict(db: Db, kind: MasterKind, c: Clean, selfId: number, confirmSimilar: boolean): Refusal | null {
  if (kind === 'drivers') {
    const others = db.prepare('SELECT id, name, phone FROM drivers WHERE id != ? ORDER BY name COLLATE NOCASE, phone').all(selfId) as { id: number; name: string; phone: string }[];
    const same = others.find((o) => nameKey(o.name) === c.key && o.phone === c.phone);
    if (same) return refuse('master-exists', { row: byId(db, 'drivers', same.id) });
    const near = others.filter((o) => findSimilar([o.name], c.name).length > 0);
    if (near.length > 0 && !confirmSimilar) return refuse('master-similar', { similar: near.map((o) => (o.phone ? `${o.name} · ${o.phone}` : o.name)) });
    return null;
  }
  const dup = db.prepare(EXISTING[kind]).get(c.key, selfId) as { id: number } | undefined;
  if (dup) return refuse('master-exists', { row: byId(db, kind, dup.id) });
  if (kind === 'firms' && !confirmSimilar) {
    const names = (db.prepare('SELECT name FROM firms WHERE id != ? ORDER BY name_key').all(selfId) as { name: string }[]).map((r) => r.name);
    const near = findSimilar(names, c.name);
    if (near.length > 0) return refuse('master-similar', { similar: near });
  }
  return null;
}

function insertRow(db: Db, kind: MasterKind, c: Clean, seat: string): number {
  const r =
    kind === 'stations'
      ? db.prepare('INSERT INTO stations (name, name_key, seat) VALUES (?, ?, ?)').run(c.name, c.key, seat)
      : kind === 'firms'
        ? db.prepare('INSERT INTO firms (name, name_key, station_id, phone, seat) VALUES (?, ?, ?, ?, ?)').run(c.name, c.key, c.stationId, c.phone, seat)
        : kind === 'trucks'
          ? db.prepare('INSERT INTO trucks (number, number_key, seat) VALUES (?, ?, ?)').run(c.name, c.key, seat)
          : db.prepare('INSERT INTO drivers (name, phone, seat) VALUES (?, ?, ?)').run(c.name, c.phone, seat);
  return Number(r.lastInsertRowid);
}

/** Writes the cleaned fields over a row at `version`; false when the version moved on (cannot happen inside the transaction that read it). */
function updateRow(db: Db, kind: MasterKind, id: number, version: number, c: Clean): boolean {
  const bump = `version = version + 1, updated_at = ${NOW} WHERE id = ? AND version = ?`;
  const r =
    kind === 'stations'
      ? db.prepare(`UPDATE stations SET name = ?, name_key = ?, ${bump}`).run(c.name, c.key, id, version)
      : kind === 'firms'
        ? db.prepare(`UPDATE firms SET name = ?, name_key = ?, station_id = ?, phone = ?, ${bump}`).run(c.name, c.key, c.stationId, c.phone, id, version)
        : kind === 'trucks'
          ? db.prepare(`UPDATE trucks SET number = ?, number_key = ?, ${bump}`).run(c.name, c.key, id, version)
          : db.prepare(`UPDATE drivers SET name = ?, phone = ?, ${bump}`).run(c.name, c.phone, id, version);
  return r.changes === 1;
}

const SET_ACTIVE: Record<MasterKind, string> = {
  stations: `UPDATE stations SET active = ?, version = version + 1, updated_at = ${NOW} WHERE id = ? AND version = ?`,
  firms: `UPDATE firms SET active = ?, version = version + 1, updated_at = ${NOW} WHERE id = ? AND version = ?`,
  trucks: `UPDATE trucks SET active = ?, version = version + 1, updated_at = ${NOW} WHERE id = ? AND version = ?`,
  drivers: `UPDATE drivers SET active = ?, version = version + 1, updated_at = ${NOW} WHERE id = ? AND version = ?`,
};

export function makeMasters(pins: Pick<ReturnType<typeof makePins>, 'verify'>) {
  return {
    all: (db: Db): MastersAll => ({
      stations: listAll(db, 'stations') as MastersAll['stations'],
      firms: listAll(db, 'firms') as MastersAll['firms'],
      trucks: listAll(db, 'trucks') as MastersAll['trucks'],
      drivers: listAll(db, 'drivers') as MastersAll['drivers'],
    }),

    /** Adding needs no PIN: clerks add walk-in firms from LR entry too. */
    create(db: Db, seat: string, kind: MasterKind, fields: MasterFields, confirmSimilar = false): KeeperResult<MasterRow> {
      return db.transaction((): KeeperResult<MasterRow> => {
        const c = clean(db, kind, fields, null);
        if ('ok' in c) return c;
        const refused = conflict(db, kind, c, 0, confirmSimilar);
        if (refused) return refused;
        const id = insertRow(db, kind, c, seat);
        const after = byId(db, kind, id) as MasterRow;
        writeAudit(db, { seat, action: 'masters.create', entity: kind, entityId: id, after });
        return ok(after);
      })();
    },

    update(db: Db, seat: string, kind: MasterKind, id: number, version: number, fields: MasterFields, systemPin: string, confirmSimilar = false): KeeperResult<MasterRow> {
      const gate = pins.verify(db, 'system', systemPin);
      if (!gate.ok) return gate;
      return db.transaction((): KeeperResult<MasterRow> => {
        const before = byId(db, kind, id);
        if (!before) return refuse('master-missing');
        if (before.version !== version) return refuse('master-stale', { row: before });
        const c = clean(db, kind, fields, kind === 'firms' ? (before as { stationId: number | null }).stationId : null);
        if ('ok' in c) return c;
        // Correcting a phone or station must not make the clerk confirm a name that was already there (two drivers called
        // Ramesh, "Shree Ganesh" next to "Shree Ganesh Traders"): similar names are asked about only when the name changes.
        const sameName = 'name' in before && nameKey(before.name) === c.key;
        const refused = conflict(db, kind, c, id, confirmSimilar || sameName);
        if (refused) return refused;
        if (!updateRow(db, kind, id, version, c)) return refuse('master-stale', { row: byId(db, kind, id) });
        const after = byId(db, kind, id) as MasterRow;
        writeAudit(db, { seat, action: 'masters.update', entity: kind, entityId: id, before, after });
        return ok(after);
      })();
    },

    /** Deactivating asks the System PIN; reactivating does not. Setting what it already is changes nothing. */
    setActive(db: Db, seat: string, kind: MasterKind, id: number, version: number, active: boolean, systemPin: string): KeeperResult<MasterRow> {
      if (!active) {
        const gate = pins.verify(db, 'system', systemPin);
        if (!gate.ok) return gate;
      }
      return db.transaction((): KeeperResult<MasterRow> => {
        const before = byId(db, kind, id);
        if (!before) return refuse('master-missing');
        if (before.version !== version) return refuse('master-stale', { row: before });
        if (before.active === active) return ok(before);
        if (db.prepare(SET_ACTIVE[kind]).run(active ? 1 : 0, id, version).changes !== 1) return refuse('master-stale', { row: byId(db, kind, id) });
        const after = byId(db, kind, id) as MasterRow;
        writeAudit(db, { seat, action: active ? 'masters.activate' : 'masters.deactivate', entity: kind, entityId: id, before, after });
        return ok(after);
      })();
    },
  };
}
