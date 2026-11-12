// Ordered schema migrations. Each runs in ONE transaction together with its schema_version row, so a failure
// leaves the file exactly as it was. Applied versions are skipped, so running migrate() twice changes nothing.
// A migration, once shipped, is never edited: change the schema with a new, higher version.
import type { Db } from './db';

export interface Migration {
  version: number;
  up(db: Db): void;
}

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
// Every business table carries these (the audit trail says who and when; version guards stale edits).
const COMMON = `
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  updated_at TEXT NOT NULL DEFAULT (${NOW}),
  seat TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1`;
const paise = (name: string) => `${name} INTEGER NOT NULL DEFAULT 0 CHECK (${name} >= 0)`;

// The three charge options, in paise (DM's defaults: Rs 5 -> 500). Frozen here on purpose: later changes to
// the defaults must not rewrite what version 1 seeded.
const CHARGE_RULES = {
  option1: { godownBhadaPaise: 500, godownInsurancePaise: 500, deliveryChargesPaise: 200, hamaliPerDagPaise: 1000, hamaliFlatPaise: 0, hamaliMode: 'perDag' },
  option2: { godownBhadaPaise: 200, godownInsurancePaise: 300, deliveryChargesPaise: 300, hamaliPerDagPaise: 0, hamaliFlatPaise: 0, hamaliMode: 'none' },
  blank: { godownBhadaPaise: 0, godownInsurancePaise: 0, deliveryChargesPaise: 0, hamaliPerDagPaise: 0, hamaliFlatPaise: 0, hamaliMode: 'none' },
};

function schemaV1(db: Db): void {
  db.exec(`
    -- Every table is STRICT: an INTEGER column refuses 12.5 or 'abc' (a plain CHECK (x >= 0) would let both in),
    -- which is what makes "integer paise" a rule of the database and not only of the code.
    CREATE TABLE stations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      ${COMMON}
    ) STRICT;
    CREATE TABLE firms (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL UNIQUE,
      station_id INTEGER REFERENCES stations (id),
      phone TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      ${COMMON}
    ) STRICT;
    CREATE TABLE trucks (
      id INTEGER PRIMARY KEY,
      number TEXT NOT NULL,
      number_key TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      ${COMMON}
    ) STRICT;
    CREATE TABLE drivers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      ${COMMON}
    ) STRICT;

    -- Yearly series: nextNumber() bumps 'last' inside the saving transaction.
    CREATE TABLE counters (
      name TEXT NOT NULL CHECK (name IN ('lr', 'challan')),
      year INTEGER NOT NULL,
      last INTEGER NOT NULL DEFAULT 0 CHECK (last >= 0),
      PRIMARY KEY (name, year)
    ) STRICT;

    CREATE TABLE memos (
      id INTEGER PRIMARY KEY,
      uid TEXT NOT NULL UNIQUE,
      challan_year INTEGER NOT NULL,
      challan_no INTEGER NOT NULL,
      memo_date TEXT NOT NULL,
      truck_id INTEGER NOT NULL REFERENCES trucks (id),
      driver_id INTEGER NOT NULL REFERENCES drivers (id),
      from_station_id INTEGER NOT NULL REFERENCES stations (id),
      to_station_id INTEGER NOT NULL REFERENCES stations (id),
      ${paise('truck_hire_paise')},
      ${paise('loading_hamali_paise')},
      -- Frozen when the memo is saved; later LR edits flag the memo instead of changing these.
      frozen_lr_count INTEGER NOT NULL DEFAULT 0 CHECK (frozen_lr_count >= 0),
      frozen_qty INTEGER NOT NULL DEFAULT 0 CHECK (frozen_qty >= 0),
      ${paise('frozen_topay_paise')},
      ${paise('frozen_paid_paise')},
      ${paise('frozen_charges_paise')},
      ${paise('frozen_stax_paise')},
      status TEXT NOT NULL DEFAULT 'saved' CHECK (status IN ('saved', 'cancelled')),
      ${COMMON},
      UNIQUE (challan_year, challan_no),
      CHECK (memo_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND challan_year = CAST(substr(memo_date, 1, 4) AS INTEGER))
    ) STRICT;
    CREATE INDEX memos_by_date ON memos (memo_date);
    CREATE INDEX memos_by_truck ON memos (truck_id, memo_date);

    CREATE TABLE lrs (
      id INTEGER PRIMARY KEY,
      uid TEXT NOT NULL UNIQUE,
      lr_year INTEGER NOT NULL,
      lr_no INTEGER NOT NULL,
      lr_date TEXT NOT NULL,
      consignor_id INTEGER REFERENCES firms (id),
      consignor_name TEXT NOT NULL,
      consignee_id INTEGER REFERENCES firms (id),
      consignee_name TEXT NOT NULL,
      from_station_id INTEGER NOT NULL REFERENCES stations (id),
      to_station_id INTEGER NOT NULL REFERENCES stations (id),
      particular TEXT NOT NULL,
      qty INTEGER NOT NULL CHECK (qty >= 0),
      ${paise('topay_paise')},
      ${paise('paid_paise')},
      charge_option TEXT NOT NULL DEFAULT 'blank' CHECK (charge_option IN ('option1', 'option2', 'blank')),
      ${paise('godown_bhada_paise')},
      ${paise('godown_insurance_paise')},
      ${paise('delivery_charges_paise')},
      ${paise('hamali_paise')},
      ${paise('pf_paise')},
      ${paise('wasuli_paise')},
      stax_bp INTEGER NOT NULL DEFAULT 0 CHECK (stax_bp BETWEEN 0 AND 10000),
      status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'loaded', 'cancelled')),
      memo_id INTEGER REFERENCES memos (id),
      ${COMMON},
      UNIQUE (lr_year, lr_no),
      CHECK (lr_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND lr_year = CAST(substr(lr_date, 1, 4) AS INTEGER)),
      CHECK (NOT (topay_paise > 0 AND paid_paise > 0)),
      CHECK ((status = 'loaded') = (memo_id IS NOT NULL))
    ) STRICT;
    CREATE INDEX lrs_by_date ON lrs (lr_date);
    CREATE INDEX lrs_pending ON lrs (status, to_station_id, lr_date);
    CREATE INDEX lrs_by_memo ON lrs (memo_id);
    CREATE INDEX lrs_by_consignor ON lrs (consignor_id, lr_date);
    CREATE INDEX lrs_by_consignee ON lrs (consignee_id, lr_date);

    -- Append-only. entity_id is text so a settings key and a row id fit the same column.
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY,
      at TEXT NOT NULL DEFAULT (${NOW}),
      seat TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT
    ) STRICT;
    CREATE INDEX audit_by_entity ON audit_log (entity, entity_id);
    CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
      BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
    CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
      BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
  `);
  const seed = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  for (const [option, rule] of Object.entries(CHARGE_RULES)) seed.run(`chargeRule_${option}`, JSON.stringify(rule));
}

// v2 (session 3.4): collection agents and the wasuli (collection) of an LR. One row per LR with a wasuli amount.
// The CHECKs tie the columns to the status, so a half-collected or agent-less assigned row cannot exist.
function schemaV2(db: Db): void {
  const day = (col: string) => `CHECK (${col} IS NULL OR ${col} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')`;
  db.exec(`
    CREATE TABLE agents (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      ${COMMON}
    ) STRICT;

    CREATE TABLE wasuli (
      id INTEGER PRIMARY KEY,
      lr_id INTEGER NOT NULL UNIQUE REFERENCES lrs (id),
      amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
      status TEXT NOT NULL DEFAULT 'unassigned' CHECK (status IN ('unassigned', 'assigned', 'collected')),
      agent_id INTEGER REFERENCES agents (id),
      assigned_date TEXT ${day('assigned_date')},
      collected_date TEXT ${day('collected_date')},
      collected_paise INTEGER,
      mode TEXT CHECK (mode IN ('cash', 'upi', 'card')),
      remark TEXT NOT NULL DEFAULT '',
      ${COMMON},
      CHECK ((status = 'unassigned') = (agent_id IS NULL)),
      CHECK ((status = 'unassigned') = (assigned_date IS NULL)),
      CHECK ((status = 'collected') = (collected_date IS NOT NULL)),
      CHECK ((collected_date IS NULL) = (collected_paise IS NULL) AND (collected_date IS NULL) = (mode IS NULL)),
      CHECK (collected_paise IS NULL OR (collected_paise > 0 AND collected_paise <= amount_paise))
    ) STRICT;
    -- (status, agent_id) serves the Unassigned / Assigned lists; collected_date last serves "this agent, last 7 days".
    CREATE INDEX wasuli_by_status ON wasuli (status, agent_id, collected_date);
    CREATE INDEX wasuli_by_collected ON wasuli (collected_date);

    -- Every LR already booked with a wasuli amount becomes a collection to follow up.
    INSERT INTO wasuli (lr_id, amount_paise, seat) SELECT id, wasuli_paise, seat FROM lrs WHERE status != 'cancelled' AND wasuli_paise > 0;
  `);
}

// v3 (session 4.2): the History page lists the audit log by time, newest first; until now the log was only looked up by (entity, entity_id).
// An index only: no data changes (the log stays append-only; an index is not a row).
function schemaV3(db: Db): void {
  db.exec('CREATE INDEX audit_by_at ON audit_log (at)');
}

// v4 (session 4.3): the Dashboard adds up every booked LR of any date (count, quantity, oldest date, stations, per station). On a 3-year book that is
// ~23,000 LRs scattered over a 450 MB file, and reading their quantity from the rows cost ~250 ms a statement. A partial index holds only the booked LRs, and
// holds everything those statements need, so they never touch the rows. An index only: no data changes.
function schemaV4(db: Db): void {
  db.exec("CREATE INDEX lrs_booked ON lrs (to_station_id, lr_date, qty) WHERE status = 'booked'");
}

// v5 (session 4.6): the settlement ("Details of report") of a loading memo: the hamali rate per article and the commission % typed with it, the memo's
// wasuli frozen with its other totals, and the net and the round figure worked out when it was saved. A memo saved before 4.6 has NULL rate, %, net and
// round figure (it has no settlement until Edit rate / commission gives it one); its frozen wasuli is backfilled from the LRs now on it (a cancelled memo has
// none: its LRs left it). The net and the round figure may be negative, so they do not use the `paise()` helper, whose CHECK is >= 0.
function schemaV5(db: Db): void {
  db.exec(`
    ALTER TABLE memos ADD COLUMN hamali_rate_paise INTEGER CHECK (hamali_rate_paise IS NULL OR hamali_rate_paise >= 0);
    ALTER TABLE memos ADD COLUMN commission_bp INTEGER CHECK (commission_bp IS NULL OR commission_bp BETWEEN 0 AND 10000);
    ALTER TABLE memos ADD COLUMN frozen_wasuli_paise INTEGER NOT NULL DEFAULT 0 CHECK (frozen_wasuli_paise >= 0);
    ALTER TABLE memos ADD COLUMN frozen_net_paise INTEGER;
    ALTER TABLE memos ADD COLUMN round_rupees INTEGER CHECK (round_rupees IS NULL OR (hamali_rate_paise IS NOT NULL AND commission_bp IS NOT NULL AND frozen_net_paise IS NOT NULL));
    UPDATE memos SET frozen_wasuli_paise = COALESCE((SELECT SUM(wasuli_paise) FROM lrs WHERE lrs.memo_id = memos.id), 0);
  `);
}

export const MIGRATIONS: Migration[] = [
  { version: 1, up: schemaV1 },
  { version: 2, up: schemaV2 },
  { version: 3, up: schemaV3 },
  { version: 4, up: schemaV4 },
  { version: 5, up: schemaV5 },
];

/** The highest applied version; 0 for a file with no schema_version rows (e.g. a 1.2 database). */
export function currentVersion(db: Db): number {
  return (db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_version').get() as { v: number }).v;
}

/** Bring the database up to the latest version. Returns the version it is at afterwards. */
export function migrate(db: Db, migrations: Migration[] = MIGRATIONS): number {
  // The 1.2 keeper already created this table; the statement is a no-op there.
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const latest = migrations[migrations.length - 1]?.version ?? 0; // the list is in order (tested)
  const at = currentVersion(db);
  // A newer keeper has been here: an older one must not touch a schema it does not know.
  if (at > latest) throw new Error(`database is at schema v${at}, newer than this keeper (v${latest})`);
  for (const m of migrations) {
    if (m.version <= at) continue;
    db.transaction(() => {
      m.up(db);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(m.version);
    })();
  }
  return currentVersion(db);
}
