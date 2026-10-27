import {
  KEEPER_PORT,
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

export const strings = {
  appTitle: 'Booking Manager',
  keeperStarting: 'Starting the database service…',
  // Only for the whole-window cases; the connected state is the shell (StatusBox).
  keeperStatus(s: Exclude<KeeperStatus, { kind: 'connected' }>): string {
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

  company: 'Sundeep Freight Movers',
  navLabel: 'Navigation',
  quickLr: 'Quick LR',
  quickLrSoon: 'Quick LR is coming in 2.4',
  nav: { main: 'Main', admin: 'Admin' },
  pages: {
    dashboard: 'Dashboard',
    lrEntry: 'LR Entry',
    loadingMemo: 'Loading Memo',
    firmAccounts: 'Firm Accounts',
    wasuli: 'Wasuli',
    reports: 'Reports',
    masters: 'Masters',
    settings: 'Settings',
  },
  pageEmpty: 'Nothing to show here yet',
  pageEmptyHint: 'This page is built in a later session.',
  status: {
    connected: 'Keeper connected',
    seat: (name: string) => `Seat ${name}`,
    lastBackup: (iso: string) => `Backed up ${time(iso)}`,
    noBackup: 'No backup yet',
    backupFailing: (why: string) => `Backups failing: ${why}`,
  },
  settings: {
    backupTitle: 'Backup',
    backupText: 'Backups are made automatically every hour. Export writes a fresh copy to a folder you choose.',
    componentsTitle: 'Components',
    componentsText: 'Every building block of the screens, in every state.',
    openComponents: 'Open Components page',
  },
  // The Components page (a developer showcase; its sample data is made up).
  components: {
    title: 'Components',
    subtitle: 'Every building block in every state',
    back: 'Back',
    buttons: 'Buttons and key caps',
    variant: { primary: 'Primary', secondary: 'Secondary', outline: 'Outline', ghost: 'Ghost', danger: 'Danger' },
    saveLr: 'Save LR',
    disabled: 'Disabled',
    keyCaps: 'Key caps:',
    fields: 'Fields (Enter moves to the next field)',
    f: {
      plain: 'Plain',
      placeholder: 'Type here',
      required: 'Required',
      hint: 'A hint under the field',
      error: 'With error',
      errorText: 'Quantity must be a whole number',
      readOnly: 'Read-only',
      money: 'Money',
      moneyEmpty: 'Money, empty',
      disabled: 'Disabled',
      last: 'Last field',
      lastHint: 'Enter here saves',
      firm: 'Consignor',
      firmPlaceholder: 'Type a firm name',
      next: 'Next field',
      nextHint: 'Enter in Consignor lands here',
    },
    enterNote: 'Enter on the last field, or on this button, saves.',
    formSubmitted: 'Form submitted',
    typeAhead: 'TypeAhead',
    typeAheadKeys: '↑ ↓ move, Enter picks, Esc closes',
    walkIn: 'Walk-in — keep typing',
    nothingTyped: 'Nothing typed yet.',
    typedOnly: (text: string) => `Kept as typed: "${text}" (walk-in).`,
    pickedMaster: (text: string) => `Picked from the list: "${text}".`,
    chipsCards: 'Chips, cards and page header',
    stat: { lrs: 'LRs booked', pending: 'Pending to load', trucks: 'Trucks out' },
    cardTitle: 'A card',
    cardBody: 'Cards hold lists and forms.',
    header: { title: 'Page header', subtitle: 'Title, a line under it, and actions on the right' },
    tables: 'Tables',
    scrollBox: 'Scroll box with sticky header',
    emptyTable: 'Empty table',
    empty: 'Nothing here',
    tickLr: (lr: number) => `Tick LR ${lr}`,
    cols: { lr: 'LR', consignor: 'Consignor', to: 'To', qty: 'Qty', toPay: 'To pay ₹', status: 'Status' },
    totals: { lrs: (n: number) => `${n} LRs`, toPay: '₹7,450' },
    statLines: { booked: 'Booked', loaded: 'Loaded', stations: 'Stations', oldest: 'Oldest booked', memos: 'Memos' },
    feedback: 'Toasts, dialogs and PIN',
    toast: { success: 'Success toast', info: 'Info toast', warning: 'Warning toast', error: 'Error toast', detail: 'A second line with details' },
    openConfirm: 'Confirm dialog',
    openDanger: 'Danger dialog',
    openPin: 'PIN dialog',
    pinNote: 'Success and info toasts hide after 4 seconds; warnings and errors stay until closed. The demo PIN is 1234.',
    dialog: {
      title: 'Save this LR?',
      text: 'Enter or the buttons choose; Esc cancels and focus goes back to the button that opened this.',
      confirm: 'Save',
      done: 'Confirmed',
      dangerTitle: 'Cancel this LR?',
      dangerText: 'This cannot be undone. Focus starts on Cancel.',
      dangerConfirm: 'Cancel LR',
    },
    pinTitle: 'System PIN',
    pinOk: 'PIN accepted',
  },
  required: 'Required',
  ui: {
    dismiss: 'Dismiss',
    cancel: 'Cancel',
    ok: 'OK',
    pinPrompt: (digits: number) => `Enter the ${digits}-digit System PIN`,
    enter: 'Enter',
    rupee: '₹',
    pinLabel: 'System PIN',
    pinWrong: 'Wrong PIN. Try again.',
  },
  chip: {
    booked: 'Booked',
    loaded: 'Loaded',
    cancelled: 'Cancelled',
    toPay: 'To pay',
    paid: 'Paid',
    charges: 'Charges',
    pending: 'Pending',
    saved: 'Saved',
  },

  exportBackup: 'Export backup to…',
  exportDone: 'Backup exported',
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
