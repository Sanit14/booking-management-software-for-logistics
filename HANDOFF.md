# Handoff

**Last session:** 1.4 — backup, restore, damage check. The keeper now makes verified backups on its own, checks the database at every start, and a damaged / missing / emptied database leads to a plain restore screen. `npm run check` passes: 55 node tests + 57 database tests. Status line (connected): "Keeper connected · data: … · seat: … · v4 · schema v1 · last backup HH:mm" (or "backups failing: <reason>").
**Next:** Session 1.5 (styling / design system) per the Build Plan, then 2.1 (masters endpoints and screens). The safe-mode screen and the Export button are deliberately unstyled; 1.5 styles them.
**State:** committed by the owner (see git log). Built in git worktree `.claude\worktrees\brave-nash-fd03e4` (branch `claude/brave-nash-fd03e4`).

## What exists (new in 1.4)
- `keeper/backupNames.ts` (pure, `node --test`): `backupName` (`booking-YYYYMMDD-HHmm.db`, local time), `parseBackupName`, `beforeRestoreName`, `pickToPrune` (newest 48 + first backup of each of the last 30 days; never the newest; ignores other files).
- `keeper/backup.ts`: `makeBackup` (db.backup → `.tmp` → switched to rollback-journal mode so no -wal/-shm sits beside it → verified read-only with `quick_check` + row count → renamed; failure deletes it), `readSummary`, `listBackups`, `backupFiles`, `pruneBackups`, `migrateSafely` (backup first when the database already has a schema and a migration is pending; a failed backup does not block the migration).
- `keeper/restore.ts`: `checkRestore` (refusals), `previewRestore`, `verifyApply` (one-shot token bound to file name + size + mtime; refusals re-checked), `restoreFiles` (live file + `-wal` copied with COPYFILE_EXCL to `booking-before-restore-<time>.db`, backup copied to `booking.db.restoring`, stale `-wal`/`-shm` removed, renamed into place; synchronous).
- `keeper/db.ts`: `openChecked` (open + `quick_check` → `{db}` or `{damaged}`; only NOTADB/CORRUPT are "damaged", other errors stay fatal), `hasTable`, `tableCount`, `masterRows`.
- `keeper/server.ts`: start-up is now async (state `starting` → `ready` | `safe-mode`); order: marker/file guard → `openChecked` → blank-rows guard → backup dir from `settings.backupDir` → pre-migration backup + migrate → first backup of the day (if none dated today) → ready. Hourly backup timer, backup on clean stop (`stop()` is one shared promise, so a second `/shutdown` never cuts the backup short). Routes: `POST /backups/list`, `POST /restore/preview`, `/restore/apply`, `/backups/export` (JSON content type required, body ≤ 64 KB, host check as before). Restore routes answer `not-in-safe-mode` in normal mode. `KEEPER_VERSION` 4.
- Bridge/preload/screen: `keeper.backups.list/exportTo`, `keeper.restore.preview/apply` (named IPC handlers; folder picker for export is in main), `src/SafeMode.tsx` (list → choose → side-by-side preview → "Restore this backup"), Export button on the connected screen, all text in `src/strings.ts`. Calls return `KeeperResult` (`{ok,value}` | `{ok:false,code}`).
- Tests: `keeper/backupNames.test.ts`, `backup.dbtest.ts` (backup during 500 inserts, no leftovers, failed verify, unwritable folder, summary, list, prune, migrateSafely), `restore.dbtest.ts`, `db.dbtest.ts` (openChecked), and 6 new real-keeper tests in `server.test.ts` (backup on start, unwritable folder → `failing`, deleted db → restore, random bytes → `damaged` → restore, normal-mode refusal, export).

## Done-when status (card 1.4)
1. Tests inside `npm run check`: **proven** (exit 0).
2. Backup shown within a minute of start, file in the backup folder: **proven** by `server.test.ts` (health.backup.lastAt, one `booking-*.db`, no temp files) and by a hand run of the built app on a temp data root (log: `backup-ok why=start`, file present; stop added a second). Not run against the real `D:\BookingManagerBackups`.
3. Delete `booking.db` → safe-mode screen → restore → "Keeper connected · schema v1": keeper side **proven** by `server.test.ts` (safe mode → list → preview → wrong token refused → apply → ready, restarts straight to ready). The **screen click-through was NOT done** (see below).
4. Random bytes in `booking.db` → "damaged" → restore: keeper side **proven** (file untouched in safe mode, kept as `booking-before-restore-*` after restore). Screen click-through not done.
5. "Export backup to…": keeper route **proven** (file written, SQLite header, rollback-journal byte, only the .db in the folder). The native folder picker and button were not clicked.
6. This file, decisions, changed-file list, commit message.
**Screen click-through (items 3–5):** I could not do it myself (Electron's remote-debugging port wedged and I abandoned it). The owner ran the PowerShell steps I gave (throwaway `C:\bmtest` folders: start, Export, deleted db → restore, random bytes → restore) and reported "done with all commands" — **no result details or problems were reported**, so treat the screen as checked by the owner but not independently confirmed by me. If anything on the screen looked wrong, it is not recorded here.

## Review by a fresh agent (code-review-and-quality + ponytail-review)
No blocking findings. Fixed: start wait 10 s → 60 s (`START_WAIT_MS`); after a restore the keeper re-reads `settings.backupDir`, shows the restored backup's time and takes a first backup (`adoptBackupFolder`, `runBackup('restore')`); the export dialog title comes from `src/strings.ts`; export waits for a running backup and is refused while stopping; listing is now `POST /backups/list` (it opens every backup, so a plain cross-origin GET must not trigger it — `KEEPER_VERSION` 4); `SQLITE_IOERR_READ`/`SHORT_READ` also count as damaged (bad sector). **Not taken:** dropping the preview token's size+mtime fingerprint (small, tested, guards a changed file between preview and apply); making `pickToPrune`'s 48/30 and `MadeBackup.bytes` constants/removing them (cosmetic). **Known, accepted:** closing a database that failed `quick_check` while it has a hot `-wal` checkpoints that WAL into the damaged file, so "nothing written" is not strictly true there; the `booking-before-restore-*` copy is made afterwards and still holds everything that was in the file.

## Decisions the card left open (made in 1.4 — all in `docs/decisions.md`)
- Backup folder = `BM_BACKUP_DIR` (dev/tests) → `settings.backupDir` (plain text, no UI to set it yet) → `D:\BookingManagerBackups`. A damaged database cannot be read for settings, so safe mode uses the default.
- A failed pre-migration backup does not block the migration (logged, status line shows failing). Start-up backup only if no backup is dated today and is taken before "ready". "48 hourly" = newest 48 files (start/stop/pre-migration ones count). Restore only in safe mode.

## Things to know (new)
- **Backups are rollback-journal files, not WAL.** `db.backup` copies the WAL flag; a read-only open of a WAL file leaves `-wal`/`-shm`, so `makeBackup` flips the temp copy to `journal_mode=DELETE` before verifying. The keeper switches it back to WAL when a restore is opened.
- A restore migrates the restored file without a fresh backup (the restored backup and the set-aside copy are both still in the folder).
- The clean-stop backup runs before the keeper exits, so `/shutdown` takes as long as a backup; the client's default timeout is 3 s (fine for a small database; the bridge's replace-old-keeper wait is 6 s). Revisit if the database grows to hundreds of MB. Same for the start-up backup vs the bridge's 10 s start wait.
- `listBackups` opens every backup read-only with `quick_check` (≤ ~78 files); fine in safe mode, do not call it on a hot path.
- `quick_check` runs at every start: O(database size).
- Hourly timer and the 5-minute marker timer are not covered by an end-to-end test (they need an hour / need records). The marker-raising end-to-end test promised for 2.1 still stands (insert via the first real endpoint, shorten the interval, assert the marker rose).
- Local-time names: if the PC clock is changed backwards, a new backup can share a name with an older one and replace it (same-minute names also replace each other: start + stop within a minute leave one file).

## Things to know (from earlier sessions, still true)
- **The keeper keeps running after the app closes — on purpose.** After a rebuild an old keeper keeps the old code until it is stopped (`Invoke-RestMethod -Method Post -Uri http://127.0.0.1:47715/shutdown -ContentType application/json -Body '{}'`) or `KEEPER_VERSION` is bumped. Bump it whenever routes or schema change.
- `npm run check` = typecheck → ESLint → delete `dist-electron` → compile → `node --test` run from inside `dist-electron` → `npm run test:db` (`*.dbtest.ts` under Electron-as-node, `scripts/test-db.cjs`). `scripts/` is not linted.
- Keeper integration tests (`keeper/server.test.ts`) spawn the keeper as Electron-as-node with `PROGRAMDATA`, `BM_BACKUP_DIR` and a temp root. The keeper does **not** re-check the data root (main does, before spawning).
- `electron/keeperBridge.ts` imports `electron`, so no unit test.
- If the database cannot be opened for a reason other than damage (permissions, locked) the keeper logs `keeper-fatal` and exits 1; the screen says "could not be started (exit 1; see keeper.log)".
- The keeper runs inside the Windows session of the seat that started it; if that seat logs off, every seat shows "could not be started" until one reopens the app (1.6 decides watchdog vs service).
- Two seats under the same Windows user share one seat name; a real two-seat hardware check is still needed.
- node-gyp fails on very long paths; each new worktree needs its own `npm install` (took ~6 min here).
- Debugging the built app with `--remote-debugging-port` wedged under Electron 22 when several clients connected; do not rely on it. `pkill -f` inside the Bash tool kills its own shell.
- Schema v1 (`keeper/migrations.ts`): a shipped migration is never edited; add version 2. All tables STRICT, money in integer paise, etc. (unchanged).

## Open from 1.1 / for 1.6 (hardware and packaging)
- `npm audit` Electron advisories accepted (fix needs Electron 41, no Win7).
- Window size: 1024×768 includes the frame; decide kiosk/maximised on real seats.
- Production CSP in `index.html` still allows `ws://127.0.0.1:5173`; tighten at packaging.
- Packaging: `better-sqlite3` `asarUnpack`, keeper script path from the packaged app, leave `*.test.js` / `*.dbtest.js` out. Folder permissions for non-admin seats (`%ProgramData%\BookingManager`, data root, logs, `D:\BookingManagerBackups`) are a 1.6 item.
- `vite.config.ts` is linted but not type-checked.
