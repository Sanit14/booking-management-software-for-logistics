// What the screen, main and the keeper agree on. Types and fixed constants only, never logic.

export const APP_ID = 'booking-manager';
export const KEEPER_PORT = 47715;
// Bump when a running keeper must be replaced by the one this build ships (schema, routes, behaviour).
export const KEEPER_VERSION = 1;

export type RootRefusal = 'bare-drive' | 'user-profile' | 'delivery-manager';
export type GuardReason = 'marker-without-database' | 'marker-with-empty-database';

/** GET /health when the keeper is up. `safe-mode` = a database existed here before and is now gone or empty. */
export interface KeeperHealth {
  app: typeof APP_ID;
  state: 'ready' | 'safe-mode';
  reason?: GuardReason;
  keeperVersion: number;
  dataRoot: string;
  dbPath: string;
  startedAt: string;
}

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

/** Named functions only; there is deliberately no generic call(route, ...). */
export interface KeeperApi {
  health(): Promise<KeeperStatus>;
}
