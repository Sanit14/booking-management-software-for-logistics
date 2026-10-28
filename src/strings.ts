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
  'wrong-pin': 'Wrong PIN.',
  'wrong-recovery-code': 'That recovery code is not right.',
  'pin-locked': 'Too many wrong tries. Wait a minute and try again',
  'pins-already-set': 'The PINs were already set on another computer.',
  'pins-not-set': 'The PINs have not been set up yet.',
  'bad-pin': 'A PIN is exactly 4 digits.',
  'pins-same': 'The Admin PIN and the System PIN must be different.',
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
    reconnecting: 'Reconnecting…',
    lost: 'Keeper not reachable',
    seat: (name: string) => `Seat ${name}`,
    lastBackup: (iso: string) => `Backed up ${time(iso)}`,
    noBackup: 'No backup yet',
    backupFailing: (why: string) => `Backups failing: ${why}`,
  },
  settings: {
    backupTitle: 'Backup',
    backupText: 'Backups are made automatically every hour. Export writes a fresh copy to a folder you choose.',
    versionTitle: 'Version and folders',
    appVersion: 'Booking Manager',
    keeperVersion: 'Database service (keeper)',
    schemaVersion: 'Database schema',
    noSchema: '–',
    dataFolder: 'Data folder',
    backupFolder: 'Backup folder',
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

  update: {
    title: 'Software update',
    text: 'Nothing is checked or installed on its own. Installing needs the Admin PIN, and Booking Manager must be closed on every other computer.',
    current: (version: string) => `This computer runs version ${version}.`,
    check: 'Check for updates',
    checking: 'Checking…',
    uptodate: 'Booking Manager is up to date.',
    available: (version: string, sizeBytes: number) => `Version ${version} is available (${Math.max(1, Math.round(sizeBytes / 1048576))} MB).`,
    download: 'Download',
    downloading: (percent: number) => `Downloading… ${percent}%`,
    verifying: 'Checking the signature…',
    downloaded: (version: string) => `Version ${version} is downloaded and checked.`,
    install: 'Install and restart',
    installTitle: 'Install the update',
    installPrompt: 'Enter the Admin PIN to install',
    installing: (version: string) => `Installing version ${version}. Windows may ask for permission; the app restarts by itself.`,
    steps: ['Checking that no other computer has Booking Manager open', 'Backing up the database', 'Stopping the database service', 'Starting the installer'],
    problem: {
      dev: 'Updates can only be checked in the installed app, not in a development run.',
      network: "Couldn't reach the update server. Check the internet connection and try again.",
      nothingPublished: 'No update has been published yet.',
      checksum: 'The downloaded file failed its safety check and was thrown away. Try again.',
      generic: (what: string) => `Something went wrong: ${what}`,
      unavailable: 'The update component could not be loaded.',
      busy: 'Another update step is still running.',
      nothingReady: 'No checked update is ready to install.',
      fileMissing: 'The downloaded update file is missing. Download it again.',
      fileChanged: 'The downloaded update file was changed after it was checked, so it was thrown away. Download it again.',
      otherSeats: (names: string) => `Booking Manager is still open on: ${names}. Close it there, then try again. (If it was just closed, wait 45 seconds.)`,
      otherSessions: (sessions: string) => `Booking Manager is still running in another Windows session (${sessions}). Close it there, then try again.`,
      scanFailed: "Couldn't check the other Windows sessions, so the update was not started. Try again.",
      noKeeper: 'The database service could not be identified. Close Booking Manager, open it again, then try again.',
      backupFailed: (why: string) => `The backup failed, so nothing was changed. ${why}`.trim(),
      keeperStuck: 'The database service did not stop within 10 seconds, so nothing was changed. Try again.',
      installerFailed: "The installer couldn't be started. Nothing was changed.",
      signatureNotSetUp: 'Update signing is not set up in this build, so the update was not accepted.',
      signatureMismatch: "The update's signature file does not match this update, so it was not accepted.",
      signatureBad: 'The update is not signed correctly, so it was not accepted.',
      signatureMissing: 'This update has no signature file (latest.sig), so it was not accepted.',
      signatureUnreadable: "The update's signature file is damaged, so the update was not accepted.",
      signatureInsecure: 'The update address is not secure (https), so the update was not accepted.',
      signatureDownload: "Couldn't download the update's signature file. Check the internet connection and try again.",
    },
  },

  pins: {
    setupTitle: 'Set up the PINs',
    setupIntro: 'Two PINs protect changes to bookings and software updates. They are set once, on the first computer.',
    chooseAdmin: 'Choose the Admin PIN (owner: updates and PIN changes)',
    repeatAdmin: 'Type the Admin PIN again',
    chooseSystem: 'Choose the System PIN (daily changes to LRs)',
    repeatSystem: 'Type the System PIN again',
    adminLabel: 'Admin PIN',
    systemLabel: 'System PIN',
    mismatch: 'The two entries did not match. Choose this PIN again.',
    saving: 'Saving…',
    codeTitle: 'Recovery code',
    codeText: 'Write this code down and keep it safe. It is shown only once. If the PINs are forgotten it is the only way back in.',
    codeDone: 'I have written it down',
    recoverTitle: 'Forgot the PINs',
    recoverIntro: 'Type the recovery code, then choose both PINs again.',
    recoverLabel: 'Recovery code',
    recoverContinue: 'Continue',
    cardTitle: 'PINs',
    cardText: 'The Admin PIN is for updates and PIN changes. The System PIN is for daily changes to LRs and memos.',
    changeSystem: 'Change System PIN',
    changeAdmin: 'Change Admin PIN',
    forgot: 'Forgot the PINs',
    enterAdmin: 'Enter the Admin PIN',
    newSystem: 'Choose the new System PIN',
    newAdmin: 'Choose the new Admin PIN',
    repeatNew: 'Type the new PIN again',
    changed: 'PIN changed',
    recovered: 'The PINs were reset',
  },
  result: (code: ResultCode, detail?: string): string =>
    code === 'pin-locked' ? `Too many wrong tries. Try again in ${detail ?? '60'} seconds.` : `${resultText[code]}${detail ? `: ${detail}` : ''}`,

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
