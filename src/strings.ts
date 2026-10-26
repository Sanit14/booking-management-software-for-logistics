import {
  KEEPER_PORT,
  type BackupStatus,
  type DbSummary,
  type GuardReason,
  type KeeperStatus,
  type ResultCode,
  type RootRefusal,
} from '../shared';

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
  damaged: 'is damaged',
};

const resultText: Record<ResultCode, string> = {
  'not-in-safe-mode': 'A backup can only be restored when the database is in safe mode.',
  'backup-missing': 'That backup file is no longer there.',
  'backup-damaged': 'That backup is damaged and cannot be restored.',
  'backup-empty': 'That backup has no records, but the current database has. Restoring it would wipe the business, so it was refused.',
  'backup-newer-schema': 'That backup was made by a newer version of Booking Manager than this one.',
  'bad-token': 'The preview is out of date. Choose the backup again and check it before restoring.',
  'no-database': 'There is no database to back up right now.',
  cancelled: 'No folder was chosen.',
  failed: 'It did not work',
  'keeper-unreachable': 'The database service did not answer',
};

const contactAdmin = 'Do not enter data. Please contact the administrator.';
const two = (n: number) => String(n).padStart(2, '0');
const time = (iso: string) => {
  const d = new Date(iso);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
};
const dateTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${time(iso)}`;
};

function backupText(b: BackupStatus | undefined): string {
  if (b?.failing) return `backups failing: ${b.failing}`;
  return b?.lastAt ? `last backup ${time(b.lastAt)}` : 'no backup yet';
}

export const strings = {
  appTitle: 'Booking Manager',
  version: 'Version',
  keeperStarting: 'Starting the database service…',
  keeperStatus(s: KeeperStatus): string {
    if (s.kind === 'connected') {
      return `Keeper connected · data: ${s.health.dbPath} · seat: ${s.seat} · v${s.health.keeperVersion} · schema v${s.health.schemaVersion ?? '?'} · ${backupText(s.health.backup)}`;
    }
    if (s.kind === 'safe-mode') {
      const why = s.health.reason ? safeModeReason[s.health.reason] : 'cannot be used';
      return `Safe mode: the database at ${s.health.dbPath} ${why}. Nothing was changed or created. Restore a backup below; do not enter data until then. · seat: ${s.seat}`;
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

  exportBackup: 'Export backup to…',
  exportDone: (file: string) => `Backup written to ${file}`,
  result: (code: ResultCode, detail?: string): string => `${resultText[code]}${detail ? `: ${detail}` : ''}`,

  safeMode: {
    title: 'Restore a backup',
    loading: 'Looking for backups…',
    noBackups: 'No backups were found in the backup folder. Please contact the administrator.',
    backups: 'Backups, newest first',
    columns: { made: 'Made', size: 'Size', lrs: 'LRs', memos: 'Memos', masters: 'Masters', newestLr: 'Newest LR', status: 'Status' },
    status: { ok: 'OK', damaged: 'Damaged: cannot be restored' },
    choose: 'Choose',
    previewTitle: 'Check before restoring',
    backupSide: 'This backup',
    liveSide: 'The database now',
    liveMissing: 'Missing',
    liveDamaged: 'Damaged',
    restore: 'Restore this backup',
    restoring: 'Restoring…',
    keepsOld: 'The database now is kept as a copy in the backup folder (booking-before-restore-…), never deleted.',
    time: dateTime,
    kb: (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`,
    summary(s: DbSummary): string[] {
      const numbers = s.lastNumbers.map((n) => `${n.name === 'lr' ? 'LR' : 'Challan'} ${n.year}: ${n.last}`).join(', ');
      return [
        `Schema v${s.schemaVersion}`,
        `LRs: ${s.lrs}`,
        `Loading memos: ${s.memos}`,
        `Masters (stations, firms, trucks, drivers): ${s.masters}`,
        `Newest LR date: ${s.newestLrDate ?? 'none'}`,
        `Last numbers: ${numbers || 'none'}`,
      ];
    },
  },
};
