// What the screen, main and the keeper agree on. Types and fixed constants only, never logic.

export const APP_ID = 'booking-manager';
export const KEEPER_PORT = 47715;
// Bump when a running keeper must be replaced by the one this build ships (schema, routes, behaviour).
export const KEEPER_VERSION = 12;

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
  | 'toPay' | 'paid' | 'godownBhada' | 'godownInsurance' | 'deliveryCharges' | 'hamali' | 'wasuli' | 'staxPercent'
  | 'reason'; // the reason for cancelling, not a box of the form
/** The fields an edit can change (and History lists). */
export type LrEditField = Exclude<LrField, 'reason'>;
/** Why a field is refused: required · amount (not a rupee amount) · whole (not a whole number ≥ 1) · percent · both (to pay AND paid) · same (from = to) · future (date) · date (not a date) · year (an edit moved the date into another year: the number belongs to its year) · missing (no such, or inactive, station / firm). */
export type LrFieldError = 'required' | 'amount' | 'whole' | 'percent' | 'both' | 'same' | 'future' | 'date' | 'year' | 'missing';

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
/** One saved LR with everything the form needs to open it. Money in paise, tax as typed text; the screen only formats. */
export interface LrDetail {
  id: number;
  /** Sent back with an edit, cancel or restore: a stale one is refused. */
  version: number;
  status: LrStatus;
  lrNo: number;
  lrYear: number;
  date: string;
  /** The challan number of the memo the LR is on (status `loaded`). */
  memoNo: number | null;
  /** The memo the LR is on (to open it); null when it is on none. */
  memoId: number | null;
  fromStationId: number;
  toStationId: number;
  /** A picked firm's id, or null for a walk-in (the name is what was typed). */
  consignorId: number | null;
  consignor: string;
  consigneeId: number | null;
  consignee: string;
  particular: string;
  qty: number;
  toPayPaise: number;
  paidPaise: number;
  chargeOption: ChargeOption;
  godownBhadaPaise: number;
  godownInsurancePaise: number;
  deliveryChargesPaise: number;
  hamaliPaise: number;
  wasuliPaise: number;
  staxPercent: string;
  amounts: LrAmounts;
}
export interface LrUpdated {
  lr: LrDetail;
  /** A walk-in consignor / consignee was saved to the firms master in the same save. */
  firmsAdded: boolean;
  /** False when nothing differed from what was saved: nothing was written. */
  changed: boolean;
}
/** A changed field: station names (not ids), paise for the money fields, the option code for `chargeOption`, text otherwise. */
export interface LrChange {
  field: LrEditField;
  from: string | number | null;
  to: string | number | null;
}
export interface LrHistoryEntry {
  at: string; // ISO
  seat: string;
  action: 'created' | 'edited' | 'cancelled' | 'restored';
  /** Why it was cancelled. */
  reason?: string;
  /** For an edit: what changed. */
  changes: LrChange[];
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

/** The Dashboard's counts for one day (null = today). Counts only, never money: nothing here is an amount. */
export interface DashboardSummary {
  date: string;
  /** LRs dated `date` by status; `cancelled` is shown apart and is not part of "LRs today". */
  booked: number;
  loaded: number;
  cancelled: number;
  /** Quantity of the day's LRs, cancelled left out. */
  qty: number;
  /** Every booked LR, any date, waiting for a memo. */
  pending: number;
  pendingQty: number;
  oldestPending: string | null;
  /** Stations that have pending LRs. */
  pendingStations: number;
  /** Saved memos of the day (0 until 3.1) and the trucks on them. */
  memos: number;
  trucksOut: number;
}
export interface PendingStation {
  stationId: number;
  station: string;
  lrs: number;
  qty: number;
}
/** The newest LRs of today, no amounts. */
export interface RecentLr {
  id: number;
  lrNo: number;
  consignee: string;
  toStation: string;
  status: LrStatus;
}

export interface SearchLr extends RecentLr {
  lrYear: number;
  date: string;
}
export interface SearchFirm {
  id: number;
  name: string;
  station: string | null;
  active: boolean;
}
export interface SearchTruck {
  id: number;
  number: string;
  active: boolean;
}
export interface SearchStation {
  id: number;
  name: string;
  active: boolean;
}
export interface SearchMemo {
  id: number;
  challanYear: number;
  challanNo: number;
  date: string;
  truck: string;
  toStation: string;
  status: MemoStatus;
}
/** At most 5 of each, best first. */
export interface SearchAnswer {
  lrs: SearchLr[];
  memos: SearchMemo[];
  firms: SearchFirm[];
  trucks: SearchTruck[];
  stations: SearchStation[];
}

export type MemoStatus = 'saved' | 'cancelled';
/** One challan carries at most this many LRs (the keeper refuses more; the screen warns before it asks). */
export const MAX_MEMO_LRS = 500;

/**
 * What the loading clerk typed and ticked. Money is the typed TEXT (the keeper parses it). `date` null = today; any other
 * date needs `systemPin`. `lrIds` are the ticked LRs, 1 to 500.
 */
export interface MemoHeaderInput {
  date: string | null;
  truckId: number | null;
  driverId: number | null;
  fromStationId: number | null;
  toStationId: number | null;
  truckHire: string;
  loadingHamali: string;
}
export interface MemoInput extends MemoHeaderInput {
  /** One per open panel; the same uid sent twice returns the memo saved first. */
  uid: string;
  systemPin?: string;
  lrIds: number[];
}
export type MemoField = 'date' | 'reason' | 'truck' | 'driver' | 'fromStation' | 'toStation' | 'truckHire' | 'loadingHamali' | 'lrs';
/** required · amount (not a rupee amount) · same (from = to) · future / date (the date) · year (an edit moved the date out of the challan's year) · missing (no such, or inactive, truck / driver / station; an LR id that does not exist) · many (over 500 LRs). */
export type MemoFieldError = 'required' | 'amount' | 'same' | 'future' | 'date' | 'year' | 'missing' | 'many';

/** A firm picked for a pending-LR filter, or text typed: any part of the name an LR was booked with (a walk-in's or a firm's). */
export interface PartyFilter {
  firmId: number | null;
  text: string;
}
/** Dates are ISO; null = no bound. Only booked LRs are ever listed. */
export interface MemoFilters {
  from: string | null;
  to: string | null;
  toStationId: number | null;
  consignor: PartyFilter | null;
  consignee: PartyFilter | null;
}
/** Where the next page starts: after this LR, in (date, number) order. */
export interface MemoCursor {
  date: string;
  no: number;
}
/** One LR in a pending list or on a memo. */
export interface MemoLrRow {
  id: number;
  lrNo: number;
  date: string;
  consignor: string;
  consignee: string;
  toStation: string;
  qty: number;
  toPayPaise: number;
  paidPaise: number;
}
/** 100 rows, `next` null at the end; `count` and `qty` are for the whole filter. */
export interface PendingPage {
  rows: MemoLrRow[];
  next: MemoCursor | null;
  count: number;
  qty: number;
}
/** The ticked LRs that are still booked, added up by the keeper. */
export interface PendingTotals {
  lrs: number;
  qty: number;
  toPayPaise: number;
  paidPaise: number;
}
export interface MemoDefaults {
  today: string;
  /** The challan number the next memo dated `date` will most likely get (a hint: another seat may take it first). */
  nextNo: number;
}
export interface MemoListRow {
  id: number;
  challanYear: number;
  challanNo: number;
  date: string;
  truck: string;
  toStation: string;
  lrCount: number;
  status: MemoStatus;
}
export interface MemoSaved extends MemoListRow {
  /** The same uid had been saved before: this is that first memo, nothing new was written. */
  again: boolean;
}
/** What a memo's LRs add up to: the totals frozen on the memo, or the totals of its LRs now. */
export interface MemoTotals {
  lrs: number;
  qty: number;
  toPayPaise: number;
  paidPaise: number;
  chargesPaise: number;
  staxPaise: number;
}
/** A saved memo: its header, the totals frozen when it was saved, the totals of its LRs now, and its LRs. */
export interface MemoDetail extends MemoListRow {
  version: number;
  truckId: number;
  driverId: number;
  driver: string;
  fromStationId: number;
  fromStation: string;
  toStationId: number;
  truckHirePaise: number;
  loadingHamaliPaise: number;
  frozen: MemoTotals;
  /** The LRs on the memo now, added up in SQL the way they were at the save (all 0 for a cancelled memo). */
  now: MemoTotals;
  /** A saved memo whose LRs no longer add up to its frozen totals. Never set for a cancelled memo. */
  differs: boolean;
  lrs: MemoLrRow[];
}
/** Saved memos list: dates are ISO, null = no bound. */
export interface SavedMemoFilters {
  from: string | null;
  to: string | null;
  truckId: number | null;
  toStationId: number | null;
}
/** Where the next page of saved memos starts: older than this memo, in (date, challan number) order. */
export interface SavedMemoCursor {
  date: string;
  no: number;
}
export interface SavedMemoRow extends MemoListRow {
  driver: string;
  /** The quantity frozen on the memo. */
  qty: number;
  differs: boolean;
}
export interface SavedMemoPage {
  rows: SavedMemoRow[];
  next: SavedMemoCursor | null;
}
/** An edit or a recalculation that changes nothing writes nothing: `changed` is false. */
export interface MemoChanged {
  memo: MemoDetail;
  changed: boolean;
}
export type MemoChangeField = 'date' | 'truck' | 'driver' | 'fromStation' | 'toStation' | 'truckHire' | 'loadingHamali' | 'lrs' | 'qty' | 'toPay' | 'paid' | 'charges' | 'stax';
/** A changed field: names (not ids) for truck, driver and stations, paise for money, text otherwise. */
export interface MemoChange {
  field: MemoChangeField;
  from: string | number | null;
  to: string | number | null;
}
export interface MemoHistoryEntry {
  at: string; // ISO
  seat: string;
  action: 'created' | 'edited' | 'removed' | 'added' | 'moved-out' | 'moved-in' | 'recalculated' | 'cancelled';
  reason?: string;
  /** edited: the header fields; recalculated: the totals. */
  changes: MemoChange[];
  /** removed, added, moved, cancelled: the LR numbers. */
  lrNos: number[];
  /** moved: the other memo's challan number. */
  otherNo?: number;
}
/** A ticked LR that could not be loaded or changed: it is on another memo (loaded), was cancelled, or is not on this memo (booked). */
export interface MemoTaken {
  id: number;
  lrNo: number;
  /** `booked`: the LR is not on the memo any more (another seat took it off). */
  state: 'booked' | 'loaded' | 'cancelled';
  challanNo: number | null;
  truck: string | null;
}

export type MemoRefusal =
  | 'memo-invalid' // `memoFields`: what to fix
  | 'memo-conflict' // `taken`: the LRs another seat got first; nothing was saved
  | 'memo-missing'
  | 'memo-stale' // `memo`: the current memo, to show what changed
  | 'memo-cancelled' // a cancelled memo cannot be changed
  | 'memo-last-lr' // taking these LRs off would leave the memo with none: cancel the memo instead
  | 'memo-target'; // the memo to move LRs to is missing, cancelled, or the same memo

export type LrRefusal =
  | 'lr-invalid' // `fields`: what to fix
  | 'lr-stale' // `lr`: the current LR, to show what changed
  | 'lr-missing'
  | 'lr-cancelled' // cannot be edited or cancelled again: restore it first
  | 'lr-not-cancelled' // restore of an LR that is not cancelled
  | 'lr-on-memo'; // cannot be cancelled while on a memo; detail: the memo's number
export type ResultCode = RestoreRefusal | PinRefusal | MasterRefusal | LrRefusal | MemoRefusal | 'no-database' | 'cancelled' | 'failed' | 'keeper-unreachable';
/**
 * What the screen gets back from a keeper call: data, or a code (wording lives in src/strings.ts).
 * `detail` on master-exists / master-similar from an LR save names the party: consignor or consignee.
 */
export type KeeperResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: ResultCode;
      detail?: string;
      row?: MasterRow;
      lr?: LrDetail;
      similar?: string[];
      fields?: Partial<Record<LrField, LrFieldError>>;
      memoFields?: Partial<Record<MemoField, MemoFieldError>>;
      taken?: MemoTaken[];
      memo?: MemoDetail;
    };

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
    get(id: number): Promise<KeeperResult<LrDetail>>;
    /** An LR of the current year by its number. */
    find(no: number): Promise<KeeperResult<LrDetail>>;
    /** System PIN. A stale `version` is refused with the current LR. The number never changes. */
    update(id: number, version: number, input: LrInput, systemPin: string): Promise<KeeperResult<LrUpdated>>;
    /** System PIN and a reason. Not while the LR is on a memo. */
    cancel(id: number, version: number, reason: string, systemPin: string): Promise<KeeperResult<LrDetail>>;
    restore(id: number, version: number, systemPin: string): Promise<KeeperResult<LrDetail>>;
    /** Newest first, at most 50. */
    history(id: number): Promise<KeeperResult<LrHistoryEntry[]>>;
  };
  settings: {
    /** Admin PIN to change. */
    setLrDefaults(input: LrDefaultsInput, adminPin: string): Promise<KeeperResult<LrDefaults>>;
  };
  /** Dashboard counts (`date` null = today). Reads only: they never publish an event. */
  dashboard: {
    summary(date: string | null): Promise<KeeperResult<DashboardSummary>>;
    /** Booked LRs per To station, most first, at most 20. */
    pendingByStation(): Promise<KeeperResult<PendingStation[]>>;
    /** The last 8 LRs of today. */
    recentLrs(): Promise<KeeperResult<RecentLr[]>>;
  };
  /** Loading memos (challans). Money is paise; totals are added up by the keeper, never by the screen. */
  memos: {
    defaults(date: string | null): Promise<KeeperResult<MemoDefaults>>;
    /** Booked LRs by (date, number), 100 a page: pass the previous page's `next` for the following one. */
    pending(filters: MemoFilters, cursor: MemoCursor | null): Promise<KeeperResult<PendingPage>>;
    totals(ids: number[]): Promise<KeeperResult<PendingTotals>>;
    /** All or nothing: an LR another seat loaded first is refused with `memo-conflict` and nothing is saved. A date other than today needs the System PIN. */
    create(input: MemoInput): Promise<KeeperResult<MemoSaved>>;
    get(id: number): Promise<KeeperResult<MemoDetail>>;
    /** That day's memos, newest first, at most 200 (null = today). */
    byDate(date: string | null): Promise<KeeperResult<MemoListRow[]>>;
    /** Saved memos by (date, challan number), newest first, 100 a page: pass the previous page's `next` for the following one. */
    list(filters: SavedMemoFilters, cursor: SavedMemoCursor | null): Promise<KeeperResult<SavedMemoPage>>;
    /** System PIN. A stale `version` is refused with the current memo. The challan number never changes. */
    editHeader(id: number, version: number, input: MemoHeaderInput, systemPin: string): Promise<KeeperResult<MemoChanged>>;
    /** System PIN. The LRs go back to booked; the last LR of a memo cannot be taken off. */
    removeLrs(id: number, lrIds: number[], systemPin: string): Promise<KeeperResult<MemoDetail>>;
    /** System PIN. Answers with the memo the LRs left. */
    moveLrs(id: number, lrIds: number[], targetId: number, systemPin: string): Promise<KeeperResult<MemoDetail>>;
    /** System PIN. The same claim guard as a new memo: all or nothing. */
    addLrs(id: number, lrIds: number[], systemPin: string): Promise<KeeperResult<MemoDetail>>;
    /** Admin PIN: the frozen totals become the totals of the LRs now. */
    recalculate(id: number, version: number, adminPin: string): Promise<KeeperResult<MemoChanged>>;
    /** Admin PIN and a reason: the LRs go back to booked. There is no restore. */
    cancel(id: number, version: number, reason: string, adminPin: string): Promise<KeeperResult<MemoDetail>>;
    /** Newest first, at most 50. */
    history(id: number): Promise<KeeperResult<MemoHistoryEntry[]>>;
  };
  /** One box for LR number, challan number, firm, truck and station: a few of each, never a generic query. */
  search(text: string): Promise<KeeperResult<SearchAnswer>>;
}
