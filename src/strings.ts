import { KEEPER_PORT, type GuardReason, type KeeperStatus, type RootRefusal } from '../shared';

// All UI text lives here (English).
const rootRefused: Record<RootRefusal, (path: string) => string> = {
  'bare-drive': (p) => `The data folder ${p} is a whole drive. Use a named folder such as C:\\BookingManagerData.`,
  'user-profile': (p) =>
    `The data folder ${p} is inside a Windows user's folder, so every seat would get its own copy. Use a shared folder such as C:\\BookingManagerData.`,
  'delivery-manager': (p) => `The data folder ${p} belongs to DeliveryManager. Booking Manager needs its own folder.`,
};

const safeModeReason: Record<GuardReason, string> = {
  'marker-without-database': 'is missing, but one was there before',
  'marker-with-empty-database': 'is empty, but one was there before',
  'marker-with-no-rows': 'has no records, but it had records before',
};

const contactAdmin = 'Do not enter data. Please contact the administrator.';

export const strings = {
  appTitle: 'Booking Manager',
  version: 'Version',
  keeperStarting: 'Starting the database service…',
  keeperStatus(s: KeeperStatus): string {
    if (s.kind === 'connected') {
      return `Keeper connected · data: ${s.health.dbPath} · seat: ${s.seat} · v${s.health.keeperVersion} · schema v${s.health.schemaVersion ?? '?'}`;
    }
    if (s.kind === 'safe-mode') {
      const why = s.health.reason ? safeModeReason[s.health.reason] : 'cannot be used';
      return `Safe mode: the database at ${s.health.dbPath} ${why}. Nothing was changed or created, and a backup must be restored. ${contactAdmin} · seat: ${s.seat}`;
    }
    switch (s.code) {
      case 'root-refused':
        return `${s.refusal ? rootRefused[s.refusal](s.detail) : `The data folder ${s.detail} cannot be used.`} ${contactAdmin}`;
      case 'root-pointer-unreadable':
        return `The data-folder setting ${s.detail} cannot be read. ${contactAdmin}`;
      case 'keeper-wrong-app':
        return `Another program is using port ${KEEPER_PORT}, which Booking Manager needs. ${contactAdmin}`;
      case 'keeper-other-root':
        return `A database service is already running on a different data folder (${s.detail}). ${contactAdmin}`;
      case 'keeper-unreachable':
        return `The database service could not be started (${s.detail}). ${contactAdmin}`;
    }
  },
};
