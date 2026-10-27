# Handoff

**Last session:** 1.5 — design system and app shell. The app now opens into the real shell (sidebar, eight pages, Quick LR, keeper status box) in the direction-A look; `src/ui/` holds every building block; a Components page shows them all; the safe-mode screen and Export are restyled. `npm run check` passes: 66 node tests + 57 database tests, ESLint 0 warnings. No keeper or database code changed.
**Next:** Session 2.1 (masters endpoints and screens), then 2.2 (keeper change events), 2.4 (Quick LR form + shortcuts), 2.5 (dashboard counts).
**State:** uncommitted, in git worktree `.claude\worktrees\session-start-1-5-4cea0c` (branch `claude/session-start-1-5-4cea0c`). The owner commits.

## What exists (new in 1.5)
- `src/styles/tokens.css` (every colour/size/spacing/radius/shadow as a CSS variable) and `global.css` (reset, bundled fonts, one focus ring). Fonts: Plus Jakarta Sans + Inter, **woff2 only, declared by hand** (`@font-face`; Inter latin + latin-ext with `unicode-range`, latin-ext carries ₹). fontsource's own subset CSS files have no `unicode-range`, so importing both would let latin-ext replace latin for every letter. Icons `lucide-react` 1.59.0, fonts `@fontsource/*` 5.3.0, all exact devDependencies.
- `src/ui/`: Button (+KeyCap), Field (label/hint/error/required/read-only/disabled; `money` = ₹ prefix, right-aligned), TypeAhead, Table (sticky header/totals, ticked tint, empty state, `maxHeight` scroll box that is keyboard-focusable), Chip, Card/StatCard/PageHeader, Toast (`ToastProvider` + `useToast()`), Dialog (native `<dialog>.showModal()`; children mount only while open; `data-autofocus` marks the first-focus control), PinDialog (4 digits, submits on the 4th, the caller checks the PIN and returns true/false), `useEnterToNext`. One `.module.css` each.
- `src/logic/` (pure; compiled by `tsconfig.node.json` so `node --test` runs it): `typeAhead.ts` (`buildRows`: prefix before contains, same key as the keeper's `nameKey` — a copy, with a test proving they agree — walk-in row last) and `nextField.ts` (`nextIndex`). Tests: `typeAhead.test.ts`, `nextField.test.ts`.
- `src/shell/`: Sidebar (+ count badges, none used yet), StatusBox (keeper dot, seat, last backup / "Backups failing: …" in red), Page (header + empty state), SettingsPage (Export backup + "Open Components page"), Notice (starting / keeper errors, whole window), pages.ts.
- `src/App.tsx`: keeper state → Notice | SafeMode | shell; page switch is `useState` (no router). `src/SafeMode.tsx`: same behaviour as 1.4, restyled (Table, Card, Buttons). `src/ComponentsPage.tsx`: every component in every state (made-up sample data).
- `npm run dev -- --components` opens the Components page straight away (the dev script now ends in `--` so `concurrently -P` passes the flag; main loads `#components`; dev only). Also reachable from Settings; Back returns to Settings.
- All text is in `src/strings.ts` (`strings.components` for the showcase). `keeperStatus()` is now only for the whole-window cases (error, safe mode). The 1.4 one-line "Keeper connected · data: … · v4 · schema v1" is gone from the screen; the StatusBox shows connected / seat / last backup (the keeper's `/health` still carries schema version and db path).

## Done-when status (card 1.5)
1. **Shell looks like mockup A** — *rendered and checked in the browser pane* (1024×768, stub `window.bm`, not committed): sidebar, Dashboard page, Quick LR, status box. **Not run in the real Electron window by me**; the owner compares `npm run dev` against the canvas. (The `npm run dev -- --components` fix was proven with a `concurrently` echo test, not inside Electron.)
2. Every sidebar page opens its shell — **proven** in the pane (all 8: header + empty state; Settings shows the Backup and Components cards).
3. Components page, nothing clipped at 1024×768 — **proven** in the pane: six frames 207–537 px tall, no horizontal overflow, no element wider than its box.
4. Keyboard only — **proven** in the pane with real key presses: Tab reaches all 40 controls and each shows a ring; Enter walks the fields skipping read-only/disabled and the last field submits; TypeAhead ↑/↓/Enter/Esc, walk-in row, Esc keeps the text; Dialog traps Tab, Esc closes, focus returns to the opener; PinDialog wrong PIN shakes/clears/shows "Wrong PIN", the retry works at once, the right PIN closes and returns focus. Caveat: the pane's Chromium is newer than 108 — native `<dialog>` focus return and the focus ring should be seen once in the Electron 22 window.
5. Safe mode restyled and still restores — the look is **checked** with a stub (14 backups, one damaged, preview, Restore button; fits 768 without scrolling). The **real** delete-`booking.db` → restore click-through is **not done**; owner steps below.
6. Fonts offline — **proven**: in dev and in `vite build` every font request is local (10 Inter + 4 Jakarta woff2 in `dist/assets`, no external host); `document.fonts` shows the Inter latin and latin-ext faces in use.
7. This file, decisions, file list, commit message — done.

Owner steps for item 5 (throwaway data, PowerShell, from the worktree folder; `BM_DATA_ROOT` / `BM_BACKUP_DIR` are the dev overrides):
```powershell
$env:BM_DATA_ROOT='C:\bmtest15'; $env:BM_BACKUP_DIR='C:\bmtest15\backups'; npm run dev   # let it open, then close the window
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:47715/shutdown -ContentType application/json -Body '{}'
Remove-Item C:\bmtest15\booking.db*
npm run dev   # same shell: safe-mode screen -> Choose a backup -> Restore this backup -> the shell opens
```

## Review by a fresh agent (code-review-and-quality + ponytail-review)
Real findings, all fixed and re-checked (`npm run check` green afterwards): the `--components` flag was silently dropped by `concurrently` (needed a trailing `--`); PinDialog lost focus after a wrong PIN (disabled input → now `readOnly`) and a rejected check was unhandled; safe-mode cards could squeeze the Restore button (the page now scrolls); focus ring clipped for a button inside a table cell; key-cap on orange buttons was 3.7:1 (now a dark backing); `useEnterToNext` skipped textareas and swallowed Ctrl/Alt+Enter; disabled fields looked enabled; hard-coded text moved into `strings.ts`; toast cap (4), long detail wraps, per-toast timer; TypeAhead clamps its highlight, ignores IME composition and no longer lets callers replace its key/blur handlers; the scroll-box table is keyboard-focusable. Ponytail cuts taken: no backward step in `nextIndex`, Toast simplified, unused props/strings removed, Jakarta woff fallbacks dropped, `--components` only in dev.
**Not taken / known:**
1. A TypeAhead list inside a `Card` will be clipped by the card's `overflow:hidden` — decide on LR Entry (2.4): portal the list out, or drop the clip on that card.
2. A native modal `<dialog>` sits above toasts, so a toast raised while a dialog is open is covered until it closes.
3. `ComponentsPage` + `strings.components` ship in the production bundle (the card wants Settings → Components); gate on `import.meta.env.DEV` if the owner prefers.
4. `window.bm.version` and the `--app-version` plumbing are no longer used by the screen (left alone, outside this diff).
5. Enter picks the highlighted first match, so a walk-in name that is the start of a master ("Patil" vs "Patil Hardware") needs ↓ to the walk-in row first — tell the clerks.
6. Success/info toasts are `role="status"`; screen readers vary on announcing content that is already there when the toast appears.

## Decisions made in 1.5 (all in `docs/decisions.md`)
Tokens/fonts/icons; pure screen logic in `src/logic`; native `<dialog>`; PIN 4 digits (owner's call); TypeAhead behaviour; toast timing; shell layout (status box in the sidebar foot, whole-window panels for starting/error/safe mode, Export moved to Settings); readability floor over the mockups (14px table headers/chips, 38px small buttons, status colours darkened — every pair ≥ 4.5:1, checked with a throwaway script).

## Things to know (new in 1.5)
- **A fresh worktree's `npm install` took ~8 min, and the native module can end up built for the wrong runtime.** After adding packages, `better_sqlite3.node` was left built for Node 20 (ABI 115) and every keeper integration test failed with "keeper did not come up" (the keeper log said "compiled against a different Node.js version"). Fix: `npm run postinstall` (electron-rebuild), then `npm run check`.
- `docs/sessions/1.5.md` was missing from the worktree (the card was committed on main later, commit 383984d); I did not add a copy to this branch.
- Files written in this session are LF, older ones CRLF (git `autocrlf=true` normalises); multi-line scripted edits must allow for both.
- Browser-pane verification trick (not in the repo): open `http://127.0.0.1:5173/`, define a stub `window.bm` in the console, then `import('/src/main.tsx?x=1')` renders the shell or safe mode without Electron. `#components` needs no stub.

## What exists (from 1.4, unchanged)
- `keeper/backupNames.ts` (pure, `node --test`): `backupName` (`booking-YYYYMMDD-HHmm.db`, local time), `parseBackupName`, `beforeRestoreName`, `pickToPrune` (newest 48 + first backup of each of the last 30 days; never the newest; ignores other files).
- `keeper/backup.ts`: `makeBackup` (db.backup → `.tmp` → switched to rollback-journal mode so no -wal/-shm sits beside it → verified read-only with `quick_check` + row count → renamed; failure deletes it), `readSummary`, `listBackups`, `backupFiles`, `pruneBackups`, `migrateSafely` (backup first when the database already has a schema and a migration is pending; a failed backup does not block the migration).
- `keeper/restore.ts`: `checkRestore` (refusals), `previewRestore`, `verifyApply` (one-shot token bound to file name + size + mtime; refusals re-checked), `restoreFiles` (live file + `-wal` copied with COPYFILE_EXCL to `booking-before-restore-<time>.db`, backup copied to `booking.db.restoring`, stale `-wal`/`-shm` removed, renamed into place; synchronous).
- `keeper/db.ts`: `openChecked` (open + `quick_check` → `{db}` or `{damaged}`; only NOTADB/CORRUPT are "damaged", other errors stay fatal), `hasTable`, `tableCount`, `masterRows`.
- `keeper/server.ts`: start-up is now async (state `starting` → `ready` | `safe-mode`); order: marker/file guard → `openChecked` → blank-rows guard → backup dir from `settings.backupDir` → pre-migration backup + migrate → first backup of the day (if none dated today) → ready. Hourly backup timer, backup on clean stop (`stop()` is one shared promise, so a second `/shutdown` never cuts the backup short). Routes: `POST /backups/list`, `POST /restore/preview`, `/restore/apply`, `/backups/export` (JSON content type required, body ≤ 64 KB, host check as before). Restore routes answer `not-in-safe-mode` in normal mode. `KEEPER_VERSION` 4.
- Bridge/preload/screen: `keeper.backups.list/exportTo`, `keeper.restore.preview/apply` (named IPC handlers; folder picker for export is in main), `src/SafeMode.tsx` (list → choose → side-by-side preview → "Restore this backup"), Export button on the connected screen, all text in `src/strings.ts`. Calls return `KeeperResult` (`{ok,value}` | `{ok:false,code}`).
- Tests: `keeper/backupNames.test.ts`, `backup.dbtest.ts` (backup during 500 inserts, no leftovers, failed verify, unwritable folder, summary, list, prune, migrateSafely), `restore.dbtest.ts`, `db.dbtest.ts` (openChecked), and 6 new real-keeper tests in `server.test.ts` (backup on start, unwritable folder → `failing`, deleted db → restore, random bytes → `damaged` → restore, normal-mode refusal, export).

## Decisions the card left open (made in 1.4 — all in `docs/decisions.md`)
- Backup folder = `BM_BACKUP_DIR` (dev/tests) → `settings.backupDir` (plain text, no UI to set it yet) → `D:\BookingManagerBackups`. A damaged database cannot be read for settings, so safe mode uses the default.
- A failed pre-migration backup does not block the migration (logged, status line shows failing). Start-up backup only if no backup is dated today and is taken before "ready". "48 hourly" = newest 48 files (start/stop/pre-migration ones count). Restore only in safe mode.

## Things to know (from 1.4)
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
