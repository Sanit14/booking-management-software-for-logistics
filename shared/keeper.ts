// What the screen, main and the keeper agree on. Types and fixed constants only, never logic.

export const APP_ID = 'booking-manager';
export const KEEPER_PORT = 47715;
// Bump when a running keeper must be replaced by the one this build ships (schema, routes, behaviour).
export const KEEPER_VERSION = 5;

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

export type ResultCode = RestoreRefusal | 'no-database' | 'cancelled' | 'failed' | 'keeper-unreachable';
/** What the screen gets back from a keeper call: data, or a code (wording lives in src/strings.ts). */
export type KeeperResult<T> = { ok: true; value: T } | { ok: false; code: ResultCode; detail?: string };

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
}
