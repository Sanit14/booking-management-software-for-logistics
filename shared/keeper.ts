// What the screen, main and the keeper agree on. Types and fixed constants only, never logic.

export const APP_ID = 'booking-manager';
export const KEEPER_PORT = 47715;
// Bump when a running keeper must be replaced by the one this build ships (schema, routes, behaviour).
export const KEEPER_VERSION = 8;

export type RootRefusal = 'bare-drive' | 'user-profile' | 'delivery-manager';
export type GuardReason = 'marker-without-database' | 'marker-with-empty-database' | 'marker-with-no-rows' | 'damaged';

/** Backups as the status line needs them: when the last good one was made, or why they are failing. */
export interface BackupStatus {
  lastAt?: string; // ISO
  failing?: string;
}

/**
 * GET /health when the keeper is up. `safe-mode` = a database existed here before and is now gone, empty or
 * damaged. `starting` = the port is taken but the database is still being checked, backed up and migrated.
 */
export interface KeeperHealth {
  app: typeof APP_ID;
  state: 'starting' | 'ready' | 'safe-mode';
  reason?: GuardReason;
  keeperVersion: number;
  /** The database's schema version; absent in safe mode, where the database is not touched. */
  schemaVersion?: number;
  backup?: BackupStatus;
  /** The keeper's process id: the updater waits for it to exit before installing. */
  pid: number;
  /** Whether the two PINs have been set (first-run setup done); absent in safe mode. */
  pinsSet?: boolean;
  dataRoot: string;
  dbPath: string;
  /** The folder backups are written to (and, in safe mode, listed from). */
  backupDir: string;
  startedAt: string;
}

/** What is inside a database or backup file, read without changing it. */
export interface DbSummary {
  schemaVersion: number;
  lrs: number;
  memos: number;
  /** stations + firms + trucks + drivers */
  masters: number;
  newestLrDate: string | null;
  /** Last number issued, per series and year. */
  lastNumbers: { name: 'lr' | 'challan'; year: number; last: number }[];
}

export interface BackupInfo {
  file: string; // name inside the backup folder
  at: string; // ISO, from the name
  sizeBytes: number;
  /** Failed `quick_check` or could not be opened: listed, but cannot be chosen. */
  damaged: boolean;
  summary?: DbSummary;
}

export type RestoreRefusal =
  | 'not-in-safe-mode'
  | 'backup-missing'
  | 'backup-damaged'
  | 'backup-empty' // 0 records, while the live database has records
  | 'backup-newer-schema'
  | 'bad-token'; // apply without (or after changing) the preview that issued the token

/** The live database next to a backup: its summary, or why there is none. */
export interface RestorePreview {
  file: string;
  token: string;
  backup: DbSummary;
  live: DbSummary | 'missing' | 'damaged';
}

/** The two PINs. The recovery code is a third secret the keeper checks, but only through pins.recover. */
export type PinKind = 'admin' | 'system';

export type PinRefusal =
  | 'wrong-pin'
  | 'wrong-recovery-code'
  | 'pin-locked' // detail: seconds to wait
  | 'pins-already-set' // another seat finished the first-run setup first
  | 'pins-not-set'
  | 'bad-pin' // not exactly 4 digits
  | 'pins-same'; // Admin and System PIN must differ

export type MasterKind = 'stations' | 'firms' | 'trucks' | 'drivers';

export interface Station {
  id: number;
  name: string;
  active: boolean;
  version: number;
}
export interface Firm {
  id: number;
  name: string;
  stationId: number | null;
  phone: string;
  active: boolean;
  version: number;
}
export interface Truck {
  id: number;
  number: string;
  active: boolean;
  version: number;
}
export interface Driver {
  id: number;
  name: string;
  phone: string;
  active: boolean;
  version: number;
}
export type MasterRow = Station | Firm | Truck | Driver;

/** Every master, active and inactive, ordered by name / number. The tables are small: the screen searches them in memory. */
export interface MastersAll {
  stations: Station[];
  firms: Firm[];
  trucks: Truck[];
  drivers: Driver[];
}

/** What a clerk types. Each kind uses its own fields: stations name · firms name, stationId, phone · trucks number · drivers name, phone. */
export interface MasterFields {
  name?: string;
  number?: string;
  stationId?: number | null;
  phone?: string;
}

export type MasterRefusal =
  | 'master-exists' // `row`: the existing one (inactive → the screen offers to reactivate it)
  | 'master-similar' // `similar`: the names; resend with confirmSimilar to save anyway
  | 'master-stale' // `row`: the current row, to show what changed
  | 'master-missing'
  | 'master-bad'; // detail: the field that is not acceptable (name, number, phone, station)

/** The tables a change event can name. A view refetches only when one of its tables is named. */
export const CHANGE_TABLES = ['stations', 'firms', 'trucks', 'drivers', 'lrs', 'memos', 'settings'] as const;
export type ChangeTable = (typeof CHANGE_TABLES)[number];
/** Pushed after a committed write (and, after a reconnect, for every table: events may have been missed). */
export interface KeeperChange {
  tables: ChangeTable[];
  ids?: number[];
}

export type ChargeOption = 'option1' | 'option2' | 'blank';

/** Who an LR is from / to: a firm picked from the list, or a walk-in name (optionally saved to the firms master with the LR). */
export interface LrParty {
  firmId: number | null;
  /** Used when `firmId` is null. */
  name: string;
  addToFirms: boolean;
}

/**
 * What a clerk typed. Money, quantity and tax are the typed TEXT: the keeper parses them (the screen never calculates).
 * `date` null = today; any other date needs `systemPin`.
 */
export interface LrInput {
  /** One per open form; the same uid sent twice returns the LR saved first. */
  uid: string;
  date: string | null;
  systemPin?: string;
  fromStationId: number | null;
  toStationId: number | null;
  consignor: LrParty;
  consignee: LrParty;
  particular: string;
  qty: string;
  toPay: string;
  paid: string;
  chargeOption: ChargeOption;
  godownBhada: string;
  godownInsurance: string;
  deliveryCharges: string;
  hamali: string;
  wasuli: string;
  staxPercent: string;
  confirmSimilar?: boolean;
}

export type LrField =
  | 'date' | 'fromStation' | 'toStation' | 'consignor' | 'consignee' | 'particular' | 'qty' | 'chargeOption'
  | 'toPay' | 'paid' | 'godownBhada' | 'godownInsurance' | 'deliveryCharges' | 'hamali' | 'wasuli' | 'staxPercent';
/** Why a field is refused: required · amount (not a rupee amount) · whole (not a whole number ≥ 1) · percent · both (to pay AND paid) · same (from = to) · future (date) · date (not a date) · missing (no such, or inactive, station / firm). */
export type LrFieldError = 'required' | 'amount' | 'whole' | 'percent' | 'both' | 'same' | 'future' | 'date' | 'missing';

/** Paise. Computed by the keeper's `lrAmounts` only. */
export interface LrAmounts {
  freight: number;
  charges: number;
  stax: number;
  total: number;
}
/** What a charge option fills for a quantity, in paise. */
export interface ChargeDefaults {
  godownBhada: number;
  godownInsurance: number;
  deliveryCharges: number;
  hamali: number;
}
/** No write. `fields` holds only what is wrong with the numbers typed so far (not "required"). */
export interface LrPreview {
  amounts: LrAmounts;
  defaults: ChargeDefaults;
  fields: Partial<Record<LrField, LrFieldError>>;
}

export type LrStatus = 'booked' | 'loaded' | 'cancelled';
export interface LrListRow {
  id: number;
  lrNo: number;
  consignor: string;
  consignee: string;
  toStation: string;
  qty: number;
  toPayPaise: number;
  paidPaise: number;
  status: LrStatus;
}
export interface LrSaved {
  row: LrListRow;
  amounts: LrAmounts;
  /** The same uid had been saved before: this is that first LR, nothing new was written. */
  again: boolean;
  /** A walk-in consignor / consignee was saved to the firms master in the same save. */
  firmsAdded: boolean;
}
export interface LrDay {
  date: string;
  /** Newest first (by LR number). */
  rows: LrListRow[];
  /** Cancelled LRs are left out. All from SQL. */
  totals: { count: number; qty: number; toPayPaise: number; paidPaise: number; booked: number; loaded: number };
}
/** What the LR form starts from. */
export interface LrDefaults {
  today: string;
  bookingStationId: number | null;
  chargeOption: ChargeOption;
  /** The default service tax as typed text ("0", "5", "2.5"). */
  staxPercent: string;
  /** The number the next LR dated `date` will most likely get (a hint: another seat may take it first). */
  nextNo: number;
}
export interface LrDefaultsInput {
  bookingStationId: number | null;
  chargeOption: ChargeOption;
  staxPercent: string;
}

export type LrRefusal = 'lr-invalid'; // `fields`: what to fix
export type ResultCode = RestoreRefusal | PinRefusal | MasterRefusal | LrRefusal | 'no-database' | 'cancelled' | 'failed' | 'keeper-unreachable';
/**
 * What the screen gets back from a keeper call: data, or a code (wording lives in src/strings.ts).
 * `detail` on master-exists / master-similar from an LR save names the party: consignor or consignee.
 */
export type KeeperResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ResultCode; detail?: string; row?: MasterRow; similar?: string[]; fields?: Partial<Record<LrField, LrFieldError>> };

export type KeeperErrorCode =
  | 'root-refused' // detail: the refused path, `refusal` says why
  | 'root-pointer-unreadable' // detail: the pointer file
  | 'keeper-unreachable'
  | 'keeper-wrong-app' // something else answers on the keeper port
  | 'keeper-other-root'; // a keeper is running on another data root; detail: that root

/** What the screen gets from keeper.health(): codes, never UI text (that lives in src/strings.ts). */
export type KeeperStatus =
  | { kind: 'connected'; health: KeeperHealth; seat: string }
  | { kind: 'safe-mode'; health: KeeperHealth; seat: string }
  | { kind: 'error'; code: KeeperErrorCode; detail: string; refusal?: RootRefusal };

/** Main pushes this to the screen on its own: the keeper vanished and is being started again, or the result of that. */
export type KeeperPush = KeeperStatus | { kind: 'reconnecting' };

/** Named functions only; there is deliberately no generic call(route, ...). */
export interface KeeperApi {
  health(): Promise<KeeperStatus>;
  /** Calls back whenever main reconnects the keeper. Returns the function that stops listening. */
  onStatus(callback: (push: KeeperPush) => void): () => void;
  backups: {
    list(): Promise<KeeperResult<BackupInfo[]>>;
    /** Asks for a folder, then writes a fresh verified backup there. */
    exportTo(): Promise<KeeperResult<{ file: string }>>;
  };
  restore: {
    preview(file: string): Promise<KeeperResult<RestorePreview>>;
    apply(file: string, token: string): Promise<KeeperResult<{ schemaVersion: number }>>;
  };
  /** The keeper checks every PIN; the screen only collects digits and passes them on. */
  pins: {
    /** First run: both PINs; answers with the recovery code, to be shown once. */
    setup(adminPin: string, systemPin: string): Promise<KeeperResult<{ recoveryCode: string }>>;
    verify(kind: PinKind, pin: string): Promise<KeeperResult<true>>;
    changeSystem(adminPin: string, newPin: string): Promise<KeeperResult<true>>;
    changeAdmin(adminPin: string, newPin: string): Promise<KeeperResult<true>>;
    /** Forgot PINs: the recovery code, then both PINs again; answers with the new recovery code. */
    recover(recoveryCode: string, newAdminPin: string, newSystemPin: string): Promise<KeeperResult<{ recoveryCode: string }>>;
  };
  /** Master data. Every write answers with the saved row; editing and deactivating carry the System PIN, which the keeper checks. */
  masters: {
    all(): Promise<KeeperResult<MastersAll>>;
    create(kind: MasterKind, fields: MasterFields, confirmSimilar?: boolean): Promise<KeeperResult<MasterRow>>;
    /** A stale `version` is refused with the current row. */
    update(kind: MasterKind, id: number, version: number, fields: MasterFields, systemPin: string, confirmSimilar?: boolean): Promise<KeeperResult<MasterRow>>;
    /** Deactivating needs the System PIN; reactivating ignores it. */
    setActive(kind: MasterKind, id: number, version: number, active: boolean, systemPin: string): Promise<KeeperResult<MasterRow>>;
  };
  /** Calls back after any committed write by any seat. Returns the function that stops listening. */
  onChanged(callback: (change: KeeperChange) => void): () => void;
  /** LRs. `date` null = today (the keeper PC's date). */
  lrs: {
    defaults(date: string | null): Promise<KeeperResult<LrDefaults>>;
    preview(input: LrInput): Promise<KeeperResult<LrPreview>>;
    create(input: LrInput): Promise<KeeperResult<LrSaved>>;
    byDate(date: string | null): Promise<KeeperResult<LrDay>>;
  };
  settings: {
    /** Admin PIN to change. */
    setLrDefaults(input: LrDefaultsInput, adminPin: string): Promise<KeeperResult<LrDefaults>>;
  };
}
