// What the screen, main and the keeper agree on. Types and fixed constants only, never logic.

export const APP_ID = 'booking-manager';
export const KEEPER_PORT = 47715;
// Bump when a running keeper must be replaced by the one this build ships (schema, routes, behaviour).
export const KEEPER_VERSION = 19;

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

/** A backup in the list: its name, time and size, nothing opened (the check, and what is inside, come with the restore preview). */
export interface BackupInfo {
  file: string; // name inside the backup folder
  at: string; // ISO, from the name
  sizeBytes: number;
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

export type MasterKind = 'stations' | 'firms' | 'trucks' | 'drivers' | 'agents';

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
/** A collection agent (wasuli): a name that is unique, and a phone. */
export interface Agent {
  id: number;
  name: string;
  phone: string;
  active: boolean;
  version: number;
}
export type MasterRow = Station | Firm | Truck | Driver | Agent;

/** Every master, active and inactive, ordered by name / number. The tables are small: the screen searches them in memory. */
export interface MastersAll {
  stations: Station[];
  firms: Firm[];
  trucks: Truck[];
  drivers: Driver[];
  agents: Agent[];
}

/** What a clerk types. Each kind uses its own fields: stations name · firms name, stationId, phone · trucks number · drivers and agents name, phone. */
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
  | 'master-busy' // an agent who still has collections assigned cannot be deactivated; detail: how many
  | 'master-bad'; // detail: the field that is not acceptable (name, number, phone, station)

/** The tables a change event can name. A view refetches only when one of its tables is named. */
export const CHANGE_TABLES = ['stations', 'firms', 'trucks', 'drivers', 'agents', 'lrs', 'memos', 'wasuli', 'settings'] as const;
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
  /** A wasuli row was made with the LR. */
  wasuli: boolean;
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
  /** The edit made, changed or removed the LR's wasuli row. */
  wasuli: boolean;
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

/** The company lines printed at the top of every printout (Settings, Admin PIN). The name is required; the other lines may be empty. */
export interface PrintCompany {
  name: string;
  address: string;
  phone: string;
  gstin: string;
}
/** One LR line of a printed memo. Amounts are text, already formatted by the keeper ('–' = nothing). */
export interface PrintMemoRow {
  sr: number;
  lrNo: number;
  consignor: string;
  consignee: string;
  destination: string;
  particular: string;
  qty: number;
  toPay: string;
  paid: string;
}
/** Exactly what a loading memo prints: text only, so the template does no maths. Totals are the ones frozen when the memo was saved. */
export interface PrintMemo {
  company: PrintCompany;
  challanNo: number;
  challanYear: number;
  /** dd-mm-yyyy */
  date: string;
  truck: string;
  driver: string;
  from: string;
  to: string;
  truckHire: string;
  loadingHamali: string;
  cancelled: boolean;
  /** The LRs no longer add up to the frozen totals (3.2): the print says so. */
  differs: boolean;
  /** By LR number. */
  rows: PrintMemoRow[];
  totals: { lrs: number; qty: number; toPay: string; paid: string };
}
/** Exactly what an LR prints. `mode` says which of To pay / Paid the freight is; every amount is formatted text. */
export interface PrintLr {
  company: PrintCompany;
  lrNo: number;
  lrYear: number;
  /** dd-mm-yyyy */
  date: string;
  from: string;
  to: string;
  consignor: string;
  consignee: string;
  particular: string;
  qty: number;
  mode: 'topay' | 'paid' | 'none';
  freight: string;
  godownBhada: string;
  godownInsurance: string;
  deliveryCharges: string;
  hamali: string;
  staxPercent: string;
  stax: string;
  total: string;
  cancelled: boolean;
}
/** One LR line of a printed firm statement. Amounts are text, already formatted by the keeper ('–' = nothing). */
export interface PrintStatementRow {
  lrNo: number;
  /** dd-mm-yyyy */
  date: string;
  /** The other party as booked. */
  party: string;
  to: string;
  qty: number;
  toPay: string;
  paid: string;
  /** Charges + service tax. */
  chargesTax: string;
  total: string;
}
/** A statement carries at most this many LRs on paper (the print page is one data: URL, which Chromium refuses above 2 MB); more asks for a shorter period. */
export const MAX_STATEMENT_PRINT_ROWS = 1000;
/** Exactly what a firm statement prints: text only. Totals are for the whole period, the same as the screen's. */
export interface PrintFirmStatement {
  company: PrintCompany;
  firm: string;
  role: FirmRole;
  /** dd-mm-yyyy */
  from: string;
  to: string;
  /** By (date, LR number). */
  rows: PrintStatementRow[];
  totals: {
    lrs: number;
    qty: number;
    toPay: string;
    paid: string;
    charges: string;
    stax: string;
    total: string;
    /** The wasuli amounts of these LRs and what came in; the paper shows the line only when something is owed. */
    wasuliOwed: string;
    wasuliCollected: string;
    hasWasuli: boolean;
  };
}
/** A report prints at most this many rows (the print page is one data: URL, which Chromium refuses above 2 MB); more asks for a shorter period. */
export const MAX_REPORT_PRINT_ROWS = 1000;
/**
 * Exactly what a report prints: text only, every amount already formatted. `rows` hold the report's columns in order and `totals` its
 * totals strip in order; the page (print/report.ts) names both from `strings.paper.report`, so the counts must match (a test checks).
 */
export interface PrintReport {
  company: PrintCompany;
  report: ReportKind;
  /** dd-mm-yyyy */
  from: string;
  to: string;
  /** The filters in force, by name (a station, a truck, an agent) or typed text; null / '' = not used by this report or not set. */
  filters: { station: string | null; text: string; truck: string | null; agent: string | null };
  rows: string[][];
  totals: string[];
  /** Truck-wise: at least one memo differs (its challan number carries a `*`). */
  anyDiffers: boolean;
}
/**
 * A print or a saved PDF that went through: it is written to the audit log. A firm statement names the period and role it was printed
 * for (`id` is the firm); a report names which report, its period and filters (`id` is 0).
 */
export interface PrintDone {
  kind: 'memo' | 'lr' | 'firm' | 'report';
  id: number;
  how: 'print' | 'pdf';
  from?: string;
  to?: string;
  role?: FirmRole;
  report?: ReportKind;
  filters?: ReportFilters;
}
export type PrintRefusal =
  | 'company-invalid' // `detail`: the box to fix (name, address, phone, gstin)
  | 'print-too-long' // a statement over MAX_STATEMENT_PRINT_ROWS LRs; `detail`: how many it has
  | 'report-too-long'; // a report with more than MAX_REPORT_PRINT_ROWS rows

export type LrRefusal =
  | 'lr-invalid' // `fields`: what to fix
  | 'lr-stale' // `lr`: the current LR, to show what changed
  | 'lr-missing'
  | 'lr-cancelled' // cannot be edited or cancelled again: restore it first
  | 'lr-not-cancelled' // restore of an LR that is not cancelled
  | 'lr-on-memo' // cannot be cancelled while on a memo; detail: the memo's number
  | 'lr-wasuli-collected'; // its wasuli is collected: no edit of the amount, no cancel, until the collection is undone; detail: the LR's number
// ---- Wasuli (3.4): collections of the LRs that carry a wasuli amount -------------------------------------------------

export type WasuliStatus = 'unassigned' | 'assigned' | 'collected';
/** Rows handed to an agent in one go (the keeper refuses more; the screen warns before it asks). */
export const MAX_WASULI_BATCH = 500;
export type WasuliMode = 'cash' | 'upi' | 'card';
/** The last 7 or 30 days, today counted as one of them. */
export type WasuliPeriod = 'week' | 'month';

/** One collection with its LR. Money in paise. */
export interface WasuliRow {
  id: number;
  version: number;
  status: WasuliStatus;
  lrId: number;
  lrNo: number;
  lrYear: number;
  lrDate: string;
  consignor: string;
  consignee: string;
  toStation: string;
  /** The challan the LR is on, once loaded. */
  challanNo: number | null;
  /** What is owed. */
  amountPaise: number;
  agentId: number | null;
  agent: string | null;
  assignedDate: string | null;
  collectedDate: string | null;
  /** What came in; below `amountPaise` for a part payment. */
  collectedPaise: number | null;
  mode: WasuliMode | null;
  remark: string;
  /** The seat that last changed the row ("Already collected on PC03"). */
  seat: string;
  /** Days waiting: since the LR date (Unassigned) or since it was assigned (Assigned); 0 once collected. */
  days: number;
}
/** What a screen saw of a row. A change is applied only while the row is still exactly so. */
export interface WasuliSeen {
  id: number;
  status: WasuliStatus;
  agentId: number | null;
  version: number;
}
/** Unassigned lists every agent's pool; Assigned and Collected need an agent (`period` only matters for Collected). */
export interface WasuliFilters {
  tab: WasuliStatus;
  agentId: number | null;
  period: WasuliPeriod;
}
/** Where the next page starts: after (or, for Collected, before) this row. `a` is its assigned / collected date ('' for Unassigned). */
export interface WasuliCursor {
  a: string;
  date: string;
  no: number;
}
/** 100 rows, `next` null at the end; `count` and `amountPaise` are for the whole filter, `counts` for the three tabs. */
export interface WasuliPage {
  rows: WasuliRow[];
  next: WasuliCursor | null;
  count: number;
  amountPaise: number;
  counts: Record<WasuliStatus, number>;
}
export interface AgentStat {
  agentId: number;
  name: string;
  active: boolean;
  assignedCount: number;
  assignedPaise: number;
  collectedTodayCount: number;
  collectedTodayPaise: number;
  collectedPeriodCount: number;
  collectedPeriodPaise: number;
}
/** What was typed in the collect dialog: the amount as text (the keeper parses it), the mode and a remark. */
export interface WasuliCollectInput {
  amount: string;
  mode: WasuliMode | null;
  remark: string;
}
export type WasuliField = 'amount' | 'mode' | 'remark' | 'agent';
/** required · amount (not a rupee amount above 0) · over (more than the wasuli amount) · long (remark over 200 characters) · missing (no such, or inactive, agent) · same (reassigned to the agent it already has). */
export type WasuliFieldError = 'required' | 'amount' | 'over' | 'long' | 'missing' | 'same';
/** The rows after a change; `changed` is false when nothing differed (nothing was written). */
export interface WasuliChanged {
  rows: WasuliRow[];
  changed: boolean;
}
export type WasuliRefusal =
  | 'wasuli-invalid' // `wasuliFields`: what to fix
  | 'wasuli-stale' // `wasuli`: the rows as they are now (a removed row is not there); nothing was changed
  | 'wasuli-missing'; // find: detail `no-lr` (no such LR) or `no-wasuli` (the LR has no wasuli)

// ---- Firm Accounts (3.5): what a firm sent and received in a period. Read-only; every figure is added up by the keeper ----

/** Which side of the LR the firm is on. `both` = consignor or consignee (an LR with the firm on both sides counts once). */
export type FirmRole = 'both' | 'consignor' | 'consignee';
/** A period, both days included (YYYY-MM-DD). */
export interface FirmRange {
  from: string;
  to: string;
}
/** The firm list's filters. `period` set = only firms with a (non-cancelled) LR dated in it. */
export interface FirmAccountFilters {
  text: string;
  stationId: number | null;
  showInactive: boolean;
  period: FirmRange | null;
}
/** One firm with the LRs it has had, whatever the dates (cancelled LRs left out). */
export interface FirmAccountRow {
  id: number;
  name: string;
  station: string | null;
  phone: string;
  active: boolean;
  asConsignor: number;
  asConsignee: number;
  lastLrDate: string | null;
}
/** Firms are listed by name; the next page starts after this name key. */
export interface FirmAccountCursor {
  key: string;
}
/** 100 firms, `next` null at the end; `count` is for the whole filter. */
export interface FirmAccountPage {
  rows: FirmAccountRow[];
  next: FirmAccountCursor | null;
  count: number;
}
/** What every statement read is asked for: one firm, a period, a role. */
export interface StatementQuery extends FirmRange {
  firmId: number;
  role: FirmRole;
}
/** One LR of the statement. Money in paise; `totalPaise` = freight + charges + service tax (the same on a To pay and a Paid LR). */
export interface StatementRow {
  lrId: number;
  lrNo: number;
  lrYear: number;
  date: string;
  /** The side(s) the firm is on in this LR. */
  role: FirmRole;
  /** The other party as booked: the consignee when the firm is the consignor, else the consignor. */
  party: string;
  fromStation: string;
  toStation: string;
  particular: string;
  qty: number;
  toPayPaise: number;
  paidPaise: number;
  chargesPaise: number;
  staxPaise: number;
  totalPaise: number;
  status: 'booked' | 'loaded';
  /** The memo the LR is on (to open it) and its challan number. */
  memoId: number | null;
  challanNo: number | null;
  /** The LR's wasuli row, if it has one: its state, what is owed and what came in. */
  wasuliStatus: WasuliStatus | null;
  wasuliPaise: number;
  wasuliCollectedPaise: number;
}
/** The whole period (not just the rows loaded). `wasuliOwedPaise` = the wasuli amounts of these LRs, collected or not. */
export interface StatementTotals {
  lrs: number;
  qty: number;
  toPayPaise: number;
  paidPaise: number;
  chargesPaise: number;
  staxPaise: number;
  totalPaise: number;
  wasuliOwedPaise: number;
  wasuliCollectedPaise: number;
}
/** The next page starts after this LR (date, then number: a date fixes the year). */
export interface StatementCursor {
  date: string;
  no: number;
}
/** 100 rows by (date, LR number), `next` null at the end, and the totals of the whole period. */
export interface StatementPage {
  rows: StatementRow[];
  next: StatementCursor | null;
  totals: StatementTotals;
}
export interface TopItem {
  name: string;
  lrs: number;
}
/** The five most frequent of each, with their LR counts. */
export interface StatementTop {
  parties: TopItem[];
  stations: TopItem[];
  trucks: TopItem[];
}
/** What the KPI cards show. `trips` = distinct saved memos the LRs are on; freight = to pay + paid. */
export interface FirmFigures {
  lrs: number;
  trips: number;
  qty: number;
  freightPaise: number;
  totalPaise: number;
  wasuliCollectedPaise: number;
}
/** The period, the period of the same length just before it, and the growth % of each figure (null when the figure before was 0). */
export interface FirmKpis {
  range: FirmRange;
  previous: FirmRange;
  now: FirmFigures;
  before: FirmFigures;
  growth: Record<keyof FirmFigures, number | null>;
}
/** One month of the growth chart. `growth` = freight against the month before; null when that was 0, and for the month in progress and later ones. */
export interface FirmMonth {
  month: string; // YYYY-MM
  lrs: number;
  freightPaise: number;
  growth: number | null;
}

// ---- Reports (4.1): the LRs, memos and wasuli grouped for a period. Read-only; every figure is added up by the keeper ----

/** The seven reports. Consignor- and consignee-wise are one keeper read (`partyWise`) with the side as an argument. */
export type ReportKind = 'dateWise' | 'stationWise' | 'consignorWise' | 'consigneeWise' | 'truckWise' | 'firmWise' | 'wasuli';
/** The LR-based reports whose rows open a list of their LRs (`reports.lrs`). */
export type ReportLrKind = 'stationWise' | 'consignorWise' | 'consigneeWise';
/** The filters a report may take; each report uses the ones that make sense for it and ignores the rest. */
export interface ReportFilters {
  /** Date-wise, Consignor- and Consignee-wise, Truck-wise: LRs / memos going to this station. */
  toStationId: number | null;
  /** Date-wise and Station-wise: any part of either party's name; Consignor- / Consignee-wise: that party's name; Firm-wise: the firm's name. */
  text: string;
  /** Truck-wise. */
  truckId: number | null;
  /** Wasuli. */
  agentId: number | null;
}
/** Which filters each report uses (the screen shows those boxes, the printout names them); the keeper ignores the others. */
export const REPORT_FILTERS: Record<ReportKind, readonly (keyof ReportFilters)[]> = {
  dateWise: ['toStationId', 'text'],
  stationWise: ['text'],
  consignorWise: ['toStationId', 'text'],
  consigneeWise: ['toStationId', 'text'],
  truckWise: ['truckId', 'toStationId'],
  firmWise: ['text'],
  wasuli: ['agentId'],
};
/** A period (both days included, by LR date; memo date for Truck-wise; collected date for the collected part of Wasuli) and the filters. */
export interface ReportQuery extends FirmRange, ReportFilters {}
/** Reports are paged by their own key (a date, a name key, a memo date); `no` breaks a tie (a firm id, a challan number), 0 when unused. */
export interface ReportCursor {
  key: string;
  no: number;
}
/** 100 rows, `next` null at the end, and the totals of the whole filter (not just the rows loaded). */
export interface ReportPage<Row, Totals> {
  rows: Row[];
  next: ReportCursor | null;
  totals: Totals;
}
/** What every LR-based report adds up. Money in paise; the to-pay and paid figures are the LRs' freight, as booked. */
export interface ReportFigures {
  lrs: number;
  qty: number;
  toPayPaise: number;
  paidPaise: number;
}
/** Date-wise totals and rows also carry charges, service tax and the total (freight + charges + tax, the same for a To pay and a Paid LR). */
export interface ReportMoney extends ReportFigures {
  chargesPaise: number;
  staxPaise: number;
  totalPaise: number;
}
export interface ReportDateRow extends ReportMoney {
  date: string;
}
/** Wasuli = the wasuli amounts booked on those LRs (the LR's own `wasuli_paise`). */
export interface ReportWithWasuli extends ReportFigures {
  wasuliPaise: number;
}
export interface ReportStationRow extends ReportWithWasuli {
  stationId: number;
  station: string;
}
/** A consignor or consignee: a firm (by its id, shown with its master name and station) or a walk-in (by the name as booked). */
export interface ReportPartyRow extends ReportWithWasuli {
  firmId: number | null;
  name: string;
  station: string | null;
}
/** One saved memo of the period with its FROZEN figures; `differs` = its LRs no longer add up to them (3.2). */
export interface ReportTruckRow {
  memoId: number;
  date: string;
  challanYear: number;
  challanNo: number;
  truck: string;
  toStation: string;
  lrs: number;
  toPayPaise: number;
  paidPaise: number;
  truckHirePaise: number;
  loadingHamaliPaise: number;
  differs: boolean;
}
export interface ReportTruckTotals {
  memos: number;
  lrs: number;
  toPayPaise: number;
  paidPaise: number;
  truckHirePaise: number;
  loadingHamaliPaise: number;
}
/** A firm with an LR in the period. Qty, to pay and paid count each of its LRs once, whichever side it is on (= its Firm Accounts "Both" totals). */
export interface ReportFirmRow {
  firmId: number;
  name: string;
  active: boolean;
  asConsignor: number;
  asConsignee: number;
  qty: number;
  toPayPaise: number;
  paidPaise: number;
}
/**
 * Not money: summing the rows' qty / to pay / paid would count an LR between two firms twice. `asConsignor` / `asConsignee` are the sums of the
 * firms listed; `walkInConsignor` / `walkInConsignee` are the period's LRs with no firm on that side, so firms + walk-ins = the LR total of the other reports.
 */
export interface ReportFirmTotals {
  firms: number;
  asConsignor: number;
  asConsignee: number;
  walkInConsignor: number;
  walkInConsignee: number;
}
/** An agent with something assigned now or collected in the period. */
export interface ReportAgentRow {
  agentId: number;
  agent: string;
  active: boolean;
  assignedCount: number;
  assignedPaise: number;
  collectedCount: number;
  collectedPaise: number;
}
/** The unassigned pool belongs to no agent, so it is here and not a column. */
export interface ReportAgentTotals {
  assignedCount: number;
  assignedPaise: number;
  collectedCount: number;
  collectedPaise: number;
  poolCount: number;
  poolPaise: number;
}
/** Which of a report's rows to list: a To station, or a consignor / consignee (a firm's id, or a walk-in's name as booked when `firmId` is null). */
export type ReportLrsFor = { kind: 'stationWise'; stationId: number } | { kind: 'consignorWise' | 'consigneeWise'; firmId: number | null; name: string };
/** The LRs behind one row of an LR-based report, under the same period and filters as the report, so they add up to the row. */
export interface ReportLrsRequest {
  of: ReportLrsFor;
  query: ReportQuery;
}
export interface ReportLrRow {
  lrId: number;
  lrNo: number;
  lrYear: number;
  date: string;
  consignor: string;
  consignee: string;
  toStation: string;
  qty: number;
  toPayPaise: number;
  paidPaise: number;
  chargesPaise: number;
  staxPaise: number;
  totalPaise: number;
  status: 'booked' | 'loaded';
}
/** The next page of LRs starts after this one (date, then number). */
export interface ReportLrCursor {
  date: string;
  no: number;
}
export interface ReportLrsPage {
  rows: ReportLrRow[];
  next: ReportLrCursor | null;
  totals: ReportMoney;
}

// ---- History (4.2): the audit log, read ----

/** What a row of the audit log is about. `other` = an action code this build does not know (listed, never filtered on). */
export type HistoryKind = 'lr' | 'memo' | 'wasuli' | 'firm' | 'station' | 'truck' | 'driver' | 'agent' | 'settings' | 'backup' | 'print' | 'other';
/** What was done, in a word a filter can offer. */
export type HistoryVerb =
  | 'created' | 'edited' | 'cancelled' | 'restored' | 'removed' | 'collected' | 'undone' | 'assigned'
  | 'memoChange' | 'activated' | 'deactivated' | 'lockedOut' | 'printed' | 'other';
export const HISTORY_KINDS: readonly Exclude<HistoryKind, 'other'>[] = ['lr', 'memo', 'wasuli', 'firm', 'station', 'truck', 'driver', 'agent', 'settings', 'backup', 'print'];
export const HISTORY_VERBS: readonly Exclude<HistoryVerb, 'other'>[] = [
  'created', 'edited', 'cancelled', 'restored', 'removed', 'collected', 'undone', 'assigned', 'memoChange', 'activated', 'deactivated', 'lockedOut', 'printed',
];

/**
 * Every action the keeper writes to the audit log, with its kind and verb: the filters are SQL on these, the screen words each one. A master
 * change is `masters.<what>:<table>` here, because its action code says what was done and its entity says to which kind of master.
 * A new action must be added here (a test fails until it is).
 */
export const HISTORY_ACTIONS: Readonly<Record<string, { kind: Exclude<HistoryKind, 'other'>; verb: Exclude<HistoryVerb, 'other'> }>> = {
  'lrs.create': { kind: 'lr', verb: 'created' },
  'lrs.update': { kind: 'lr', verb: 'edited' },
  'lrs.cancel': { kind: 'lr', verb: 'cancelled' },
  'lrs.restore': { kind: 'lr', verb: 'restored' },
  'lrs.memo-remove': { kind: 'lr', verb: 'memoChange' },
  'lrs.memo-move': { kind: 'lr', verb: 'memoChange' },
  'lrs.memo-add': { kind: 'lr', verb: 'memoChange' },
  'lrs.memo-cancel': { kind: 'lr', verb: 'memoChange' },
  'memos.create': { kind: 'memo', verb: 'created' },
  'memos.edit': { kind: 'memo', verb: 'edited' },
  'memos.remove-lrs': { kind: 'memo', verb: 'memoChange' },
  'memos.move-out': { kind: 'memo', verb: 'memoChange' },
  'memos.move-in': { kind: 'memo', verb: 'memoChange' },
  'memos.add-lrs': { kind: 'memo', verb: 'memoChange' },
  'memos.recalculate': { kind: 'memo', verb: 'memoChange' },
  'memos.cancel': { kind: 'memo', verb: 'cancelled' },
  'wasuli.create': { kind: 'wasuli', verb: 'created' },
  'wasuli.update': { kind: 'wasuli', verb: 'edited' },
  'wasuli.remove': { kind: 'wasuli', verb: 'removed' },
  'wasuli.assign': { kind: 'wasuli', verb: 'assigned' },
  'wasuli.reassign': { kind: 'wasuli', verb: 'assigned' },
  'wasuli.to-pool': { kind: 'wasuli', verb: 'assigned' },
  'wasuli.collect': { kind: 'wasuli', verb: 'collected' },
  'wasuli.uncollect': { kind: 'wasuli', verb: 'undone' },
  'wasuli.remark': { kind: 'wasuli', verb: 'edited' },
  'pins.setup': { kind: 'settings', verb: 'created' },
  'pins.change-system': { kind: 'settings', verb: 'edited' },
  'pins.change-admin': { kind: 'settings', verb: 'edited' },
  'pins.recover': { kind: 'settings', verb: 'edited' },
  'pins.locked': { kind: 'settings', verb: 'lockedOut' },
  'settings.lr-defaults': { kind: 'settings', verb: 'edited' },
  'settings.company': { kind: 'settings', verb: 'edited' },
  'settings.backup-dir': { kind: 'backup', verb: 'edited' },
  'seat.rename': { kind: 'settings', verb: 'edited' },
  'app.update': { kind: 'settings', verb: 'edited' },
  'backup.restore': { kind: 'backup', verb: 'restored' },
  'print.memo': { kind: 'print', verb: 'printed' },
  'print.lr': { kind: 'print', verb: 'printed' },
  'print.firm': { kind: 'print', verb: 'printed' },
  'print.report': { kind: 'print', verb: 'printed' },
  'masters.create:stations': { kind: 'station', verb: 'created' },
  'masters.update:stations': { kind: 'station', verb: 'edited' },
  'masters.activate:stations': { kind: 'station', verb: 'activated' },
  'masters.deactivate:stations': { kind: 'station', verb: 'deactivated' },
  'masters.create:firms': { kind: 'firm', verb: 'created' },
  'masters.update:firms': { kind: 'firm', verb: 'edited' },
  'masters.activate:firms': { kind: 'firm', verb: 'activated' },
  'masters.deactivate:firms': { kind: 'firm', verb: 'deactivated' },
  'masters.create:trucks': { kind: 'truck', verb: 'created' },
  'masters.update:trucks': { kind: 'truck', verb: 'edited' },
  'masters.activate:trucks': { kind: 'truck', verb: 'activated' },
  'masters.deactivate:trucks': { kind: 'truck', verb: 'deactivated' },
  'masters.create:drivers': { kind: 'driver', verb: 'created' },
  'masters.update:drivers': { kind: 'driver', verb: 'edited' },
  'masters.activate:drivers': { kind: 'driver', verb: 'activated' },
  'masters.deactivate:drivers': { kind: 'driver', verb: 'deactivated' },
  'masters.create:agents': { kind: 'agent', verb: 'created' },
  'masters.update:agents': { kind: 'agent', verb: 'edited' },
  'masters.activate:agents': { kind: 'agent', verb: 'activated' },
  'masters.deactivate:agents': { kind: 'agent', verb: 'deactivated' },
};

/** What the History list is asked: a period (local dates, both included) and who / what / which number. */
export interface HistoryFilters {
  from: string;
  to: string;
  /** Any part of the seat's name, ASCII case ignored; '' = every seat. */
  seat: string;
  kind: Exclude<HistoryKind, 'other'> | null;
  verb: Exclude<HistoryVerb, 'other'> | null;
  /** An LR number of `lrYear` (null = the keeper PC's current year). */
  lrNo: number | null;
  lrYear: number | null;
  challanNo: number | null;
  challanYear: number | null;
  /** Prints are left out unless this is on (or the kind is `print`). */
  showPrints: boolean;
}
/** Where the next page starts: the last row shown (newest first, so the next rows are older). */
export interface HistoryCursor {
  at: string;
  id: number;
}
/** How a changed value is written: rupees, a date, a percentage, a charge option's name, or as it is. */
export type HistoryUnit = 'paise' | 'date' | 'percent' | 'option';
/** One changed field: names (not ids) for stations, trucks, drivers, agents and firms; paise for money. */
export interface HistoryChange {
  field: string;
  from: string | number | null;
  to: string | number | null;
  unit?: HistoryUnit;
}
/** The words around a row, named by what they are; only those the action has are set. */
export interface HistoryFacts {
  reason?: string;
  remark?: string;
  consignor?: string;
  consignee?: string;
  station?: string;
  qty?: number;
  truck?: string;
  driver?: string;
  fromStation?: string;
  toStation?: string;
  lrCount?: number;
  lrNos?: number[];
  challanNo?: number;
  otherChallanNo?: number;
  agent?: string;
  fromAgent?: string;
  amountPaise?: number;
  owedPaise?: number;
  mode?: string;
  pin?: string;
  how?: string;
  report?: string;
  from?: string;
  to?: string;
  role?: string;
  file?: string;
  savedAs?: string;
}
/** What a row can lead to. */
export type HistoryRecord = 'lr' | 'memo' | 'wasuli' | 'firm' | 'station' | 'truck' | 'driver' | 'agent';
export interface HistoryRow {
  id: number;
  at: string; // ISO (UTC)
  seat: string;
  action: string;
  kind: HistoryKind;
  verb: HistoryVerb;
  /** The record the row opens (the current one, even if it was renamed since), or null. `openId` is its id; a wasuli row opens by `lrNo`. */
  record: HistoryRecord | null;
  openId: number | null;
  lrNo: number | null;
  lrYear: number | null;
  challanNo: number | null;
  challanYear: number | null;
  /** A master's name (a truck's number) or a report's key, as it was in the row. */
  name: string | null;
  changes: HistoryChange[];
  facts: HistoryFacts;
}
export interface HistoryPage {
  rows: HistoryRow[];
  next: HistoryCursor | null;
}

/** The Admin settings of Settings (4.2): the backup folder, this seat's name, restoring a backup while the app is running. */
export type AdminRefusal =
  | 'backup-dir-same-drive' // the folder is on the drive the data is on; detail: the folder. Resend with the confirm to use it anyway
  | 'backup-dir-unusable' // a backup could not be written there; detail: why
  | 'seat-name-invalid' // 2 to 20 letters, digits, spaces or dashes
  | 'seat-name-taken' // another seat has it (seen in the last 30 days); detail: the name
  | 'seat-name-same' // already this seat's name
  | 'restore-others-online' // detail: who has the app open
  | 'restore-backup-failed' // the backup taken first could not be written, so nothing was restored; detail: why
  | 'restore-busy'; // another restore is running

export type ResultCode = RestoreRefusal | PinRefusal | AdminRefusal | MasterRefusal | LrRefusal | MemoRefusal | PrintRefusal | WasuliRefusal | 'no-database' | 'cancelled' | 'failed' | 'keeper-unreachable';
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
      wasuli?: WasuliRow[];
      wasuliFields?: Partial<Record<WasuliField, WasuliFieldError>>;
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
    /**
     * Admin PIN, then asks for a folder, then makes a backup there; only if that works the folder becomes the backup folder. On the drive of
     * the data it is refused with `backup-dir-same-drive`: ask, and send again with `confirmSameDrive` to use the folder just picked.
     */
    setFolder(adminPin: string, confirmSameDrive: boolean): Promise<KeeperResult<{ dir: string; file: string }>>;
  };
  /** This seat's name (Admin PIN). It is used from the next start. */
  seat: {
    rename(name: string, adminPin: string): Promise<KeeperResult<{ name: string }>>;
  };
  restore: {
    /** In safe mode, or with no other seat open. */
    preview(file: string): Promise<KeeperResult<RestorePreview>>;
    /** In safe mode no PIN is needed; while the app is running the Admin PIN is, and nobody else may have it open. */
    apply(file: string, token: string, adminPin?: string): Promise<KeeperResult<{ schemaVersion: number }>>;
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
  /** The company lines on printouts. What is printed, and the print itself, is main's job (`PrintApi`): the screen cannot name those routes. */
  print: {
    company(): Promise<KeeperResult<PrintCompany>>;
    /** Admin PIN. */
    setCompany(input: PrintCompany, adminPin: string): Promise<KeeperResult<PrintCompany>>;
  };
  /**
   * Wasuli. Every change sends the rows as they were seen (`WasuliSeen`) and is refused with the current rows if one has moved on; a batch
   * is all or nothing. Assign, reassign, back to pool and collect need no PIN; undo and a remark edit need the System PIN.
   */
  wasuli: {
    /** One tab, 100 a page: pass the previous page's `next` for the following one. */
    list(filters: WasuliFilters, cursor: WasuliCursor | null): Promise<KeeperResult<WasuliPage>>;
    /** The collection of an LR by its number (this year's, else last year's). */
    /** `year` = exactly that year's LR (a History row knows it); without it this year's first, then last year's. */
    find(no: number, year?: number): Promise<KeeperResult<WasuliRow>>;
    agentStats(period: WasuliPeriod): Promise<KeeperResult<AgentStat[]>>;
    assign(rows: WasuliSeen[], agentId: number): Promise<KeeperResult<WasuliChanged>>;
    reassign(row: WasuliSeen, agentId: number): Promise<KeeperResult<WasuliChanged>>;
    toPool(row: WasuliSeen): Promise<KeeperResult<WasuliChanged>>;
    collect(row: WasuliSeen, input: WasuliCollectInput): Promise<KeeperResult<WasuliChanged>>;
    uncollect(row: WasuliSeen, systemPin: string): Promise<KeeperResult<WasuliChanged>>;
    remark(row: WasuliSeen, remark: string, systemPin: string): Promise<KeeperResult<WasuliChanged>>;
  };
  /**
   * Firm Accounts: what a firm sent and received. Reads only (no event, nothing written); the period is both days included, by LR date.
   * An unknown firm answers `master-missing`.
   */
  firms: {
    /** Every firm (active and inactive), by name, 100 a page: pass the previous page's `next` for the following one. */
    accounts(filters: FirmAccountFilters, cursor: FirmAccountCursor | null): Promise<KeeperResult<FirmAccountPage>>;
    /** The firm's non-cancelled LRs in the period by (date, number), 100 a page, with the totals of the whole period. */
    statement(query: StatementQuery, cursor: StatementCursor | null): Promise<KeeperResult<StatementPage>>;
    statementTop(query: StatementQuery): Promise<KeeperResult<StatementTop>>;
    kpis(query: StatementQuery): Promise<KeeperResult<FirmKpis>>;
    /** The 12 months of a calendar year. */
    months(firmId: number, year: number, role: FirmRole): Promise<KeeperResult<FirmMonth[]>>;
  };
  /**
   * Reports: the LRs, memos and wasuli grouped for a period, with the totals of the whole filter in the same answer. Reads only (no event,
   * nothing written), 100 rows a page: pass the previous page's `next` for the following one.
   */
  reports: {
    dateWise(query: ReportQuery, cursor: ReportCursor | null): Promise<KeeperResult<ReportPage<ReportDateRow, ReportMoney>>>;
    stationWise(query: ReportQuery, cursor: ReportCursor | null): Promise<KeeperResult<ReportPage<ReportStationRow, ReportWithWasuli>>>;
    partyWise(side: 'consignor' | 'consignee', query: ReportQuery, cursor: ReportCursor | null): Promise<KeeperResult<ReportPage<ReportPartyRow, ReportWithWasuli>>>;
    /** Saved memos by memo date, with their frozen figures. */
    truckWise(query: ReportQuery, cursor: ReportCursor | null): Promise<KeeperResult<ReportPage<ReportTruckRow, ReportTruckTotals>>>;
    firmWise(query: ReportQuery, cursor: ReportCursor | null): Promise<KeeperResult<ReportPage<ReportFirmRow, ReportFirmTotals>>>;
    /** Per agent: assigned now, collected in the period. */
    wasuli(query: ReportQuery, cursor: ReportCursor | null): Promise<KeeperResult<ReportPage<ReportAgentRow, ReportAgentTotals>>>;
    /** The LRs behind one row of Station-, Consignor- or Consignee-wise, by (date, number). */
    lrs(request: ReportLrsRequest, cursor: ReportLrCursor | null): Promise<KeeperResult<ReportLrsPage>>;
  };
  /** What changed in the books: the audit log, newest first, 100 a page (pass the previous page's `next` for the following one). Reads only. */
  history: {
    list(filters: HistoryFilters, cursor: HistoryCursor | null): Promise<KeeperResult<HistoryPage>>;
  };
  /** One box for LR number, challan number, firm, truck and station: a few of each, never a generic query. */
  search(text: string): Promise<KeeperResult<SearchAnswer>>;
}
