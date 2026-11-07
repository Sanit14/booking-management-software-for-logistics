# Audit 4.4 — every scan over the whole app

Method: the eight scans of `.claude/commands/scan.md` plus security, ponytail (dead code), dependencies and strings, each a **read-only pass by a fresh
reviewer agent** that ran nothing. Findings were not taken on trust: the ones marked **verified** were re-read (or measured) by me before anything was
changed; the rest are "reported" — a reviewer read the code, I have not yet. Severity: High = data loss, a wrong number or a security hole; Medium = wrong
or slow in an edge case that can really happen, or a rule broken with a visible effect; Low = hygiene or rare.

**Honest status:** the card's rule "no High or Medium left open" is **not met**. Two Highs and a handful of Mediums need an owner decision (they change
behaviour, or are design-level) or a real-window test I could not do; they are listed under "Open" with what I propose. Nothing below is hidden.

## Fixed in 4.4

| # | Sev | Where | What | Proof |
| - | --- | --- | --- | --- |
| A1 | High | `keeper/db.ts:12-20` (rule 4, failure) | **`synchronous` was NORMAL for every reopened database.** better-sqlite3 compiles `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1`; a new file reports FULL, a reopened one (every keeper start after the first) NORMAL — measured with a probe. A commit was not on disk when the save was answered, so a power cut could take back the last saves and the counter with them: an LR number issued twice. Now `synchronous = FULL` (one fsync per commit). | `db.dbtest.ts` reopens the file; red before, green after. Bench "Save LR" budget 150 ms to be re-read in the after-run. |
| A2 | Medium | `keeper/server.ts` (4 `process.env.BM_*` reads), `electron/keeperBridge.ts:88,114` (security 5) | **Test hooks could weaken a production keeper.** `BM_PIN_LOCK_MS` (PIN lock down to 100 ms), `BM_BACKUP_DIR` (backups sent to a folder of the user's choice), `BM_MARKER_REFRESH_MS`, `BM_DATA_ROOT` were read from the environment of whoever opened the app first. Now they work only when the keeper is started with `--test-hooks` (`keeper/testHooks.ts`); the app passes it only when not packaged, ignores `BM_DATA_ROOT` when packaged, and the keeper no longer inherits `NODE_OPTIONS`. | `testHooks.test.ts` (env alone changes nothing); every keeper test and `bench.cjs` pass the flag. |
| A3 | Medium | `src/loadingMemo/MemoView.tsx:39,189` (state, rule 8) | **Edit-header could overwrite another seat's change.** The dialog copied the memo when it opened but saved with the memo's *current* version, so a change by another seat in between was reverted instead of refused. The draft now carries the version Edit started from (as LR Entry's `editBase`); the keeper answers `memo-stale`, which the screen already shows. | No automated test: the repo has no screen-component tests. Read-verified. |
| A4 | Medium | `src/strings.ts:716-718,729` (strings) | The word **"Keeper"** (internal) showed in the sidebar status box and Settings. Now "Database service connected / not reachable". | — |
| A5 | Low | `electron/main.ts:9` | `--dev` was honoured by the installed app (loads a dev server with the full `window.bm` bridge). Now `!app.isPackaged &&`. | — |
| A6 | Low | `.gitignore` | `*.pem`, `*.key`, `BookingManagerKeys/` added (the signing key must never be added by `git add -A`). | — |
| A7 | Stall | see "Stalls" below | The two 4.3 stalls. | bench |
| A8 | High / Medium | `keeper/server.ts` `swapIn`, `stop()`, `/restore/preview` (found by the fresh-agent review of the 4.4 diff) | (a) a failed swap whose **reopen of the live file throws** (a locked file) left the keeper on `state = 'starting'` for ever — every seat waits, the watchdog never replaces it: now falls back to safe mode, which still offers Restore; (b) `/shutdown` during a swap exited mid-copy: `stop()` now waits for the swap; (c) the staged `.restoring` copy leaked if the marker write threw: `dropStaged` on every failure; (d) a preview during an apply is refused (`restore-busy`); (e) `NODE_OPTIONS` was removed case-sensitively (Windows keeps the spelling): now any case; (f) the update's backup call waited 60 s (now `LONG_CALL_MS`); stale comments. | `server.test.ts` "a restore that fails after its checks leaves the book open and ready": guards the failed-swap recovery path (it passed before the fix too — the throwing-reopen branch needs a locked file and is read-verified only). |

## Stalls (card, first part) — measured on the 3-year file, this PC

Same bench rows, before (`docs/bench/2026-11-07-laptop-4-4-before.md`, the 4.3 build) and after (`…-4-4.md`): a saver and a pinger run while the Settings
restore card lists, previews and restores. Budget: every request answered within 1 s.

| While … | before: worst save / worst ping | after: worst save / worst ping |
| --- | --- | --- |
| backups are listed | 21.6 s / 21.5 s | 12 ms / 13 ms |
| a backup is previewed | 28.0 s / 27.9 s | 116 ms / 45 ms (2,950 saves went through) |
| a restore runs | 24.0 s / 23.9 s | 507 ms / 504 ms (5,611 saves, 556 pings) |

All rows of the after run PASS. The restore **as a whole is not faster**: 93 s on this PC (89 s before; the compare alone 26 s), because the same whole-file
checks now run in child processes instead of on the thread. Save LR median went 6.5 → 9.6 ms with `synchronous = FULL` (budget 150 ms). A clean stop took
19.9 s right after a restore on this PC (15.8 s before): the old updater wait (10 s + 10 s) would have been on the edge.

What changed: `/backups/list` opens nothing (name, time, size); preview and apply check files in a child process (`summarizeInChild`, backup and live in
parallel); apply copies the chosen backup beside the live file and checks **the copy** before anything is closed; the swap copies asynchronously while health
says `starting`; a second restore is refused (`restore-busy`); `shutdown()` waits up to 60 s (`KEEPER_STOP_WAIT_MS`) for a stop that makes its last backup, and
the updater and the launcher's "replace an older keeper" use the same wait (before: 10 s + 10 s and 3 s + 6 s, against a measured 7–16 s stop). Nothing ever
kills a keeper that is writing.

## Open — owner decision (they change behaviour or are design-level)

| # | Sev | Where | Finding | Proposal |
| - | --- | --- | --- | --- |
| O1 | High (design) | `keeper/client.ts:53`, `keeper/server.ts:476`, security 1 | The keeper is **not authenticated** by the seats and `/shutdown` needs nothing. A local user can stop it and bind 127.0.0.1:47715 first; every seat's watchdog accepts a process that answers `/health` as `booking-manager`, and then sends it PINs and bookings. *Context:* the installer gives Users Modify on the data folder, so a local user can already read and edit `booking.db` directly; the squat adds PIN harvesting. *Reported, not re-verified.* | A per-boot secret in a file only the keeper's user can read does not work across several Windows users; a named pipe with an ACL would. Either is an architecture change: needs your decision. Record as an accepted gap if the clerks are trusted. |
| O2 | High (conditional) | `build/installer.nsh:14-17`, security 2 | The elevated installer runs `icacls … /grant *S-1-5-32-545:(OI)(CI)M` on folders that Users can delete and recreate; if one is recreated as a junction to a system folder, the next install grants Users Modify there. *The code is as described; whether `icacls` follows the junction is Windows behaviour I did not test.* | Test on a VM; fix by skipping the grant when the folder is a reparse point. Installer change: not made without a test. |
| O3 | Medium | `src/lrEntry/LrForm.tsx:111,328`, `keeper/lrs.ts:183`, `src/loadingMemo/MemoPanel.tsx:155` (failure 2) | A save whose **answer was lost** keeps its `uid`; if the clerk then changes a value and presses save, the keeper returns the first LR as "already saved" and the change is dropped. Fixing it (new uid when the values changed) means a corrected resubmission creates a **second** LR if the first had committed — a product choice. *Reported.* | Decide: refuse and show the saved LR, or let it create. |
| O4 | Medium | `keeper/server.ts:229,967`, `electron/keeperBridge.ts:370` (failure 3) | A migration that **throws** makes the keeper exit 1; the 15 s ping starts it again; each start writes a full pre-migration backup (named to the minute, never pruned). Disk fills with backups. Only happens if a bad migration is shipped (v5 does not exist). *I read the exit path; the loop is as described.* | Cap restarts after 3 failures in a row and skip a backup made in the last minutes; needs a screen message — wording is yours. |
| O5 | Medium | `src/reports/ReportsPage.tsx:24,80-101` (perf 2) | Any LR saved by any seat refetches **every loaded page** of the open report; the first page of consignor-wise on a year is 377–621 ms. Three pages loaded ≈ 1.5 s of the keeper per save. *Reported; arithmetic from the bench.* | Refetch the first page only and mark the rest stale. Needs a real-window pass. |
| O6 | Medium | `src/lrEntry/LrEntryPage.tsx:189-199`, `src/masters/MastersPage.tsx:95,147` (perf 3) | Lists over 200 rows are **not windowed**: the LR Entry day list renders up to 1,000 rows and re-renders on every `lrs` event and keystroke in the find box; Masters renders every row. *Reported; not measured.* | Measure in the window at 300 LRs a day; cap or window if it is slow. |
| O7 | Medium | `keeper/lockout.ts:10`, `keeper/pins.ts`, security 3 | The PIN lock lives in keeper memory (reset by a restart — already in the 2026-10-28 decision), is per PIN kind (five wrong tries from any seat lock everyone for a minute), and 4-digit scrypt hashes fall offline to anyone who can read `booking.db`. The env override is closed (A2). | Accepted by the earlier decision unless you want per-seat counters. |
| O8 | Medium | `keeper/server.ts` (events cap 32, no request timeout), `keeper/seats.ts:9`, security 5 | A local process can hold the 32 event streams, stall a body forever, or fill the seat map. *Reported.* | `server.requestTimeout`, prune the seat map: small, but untested on the seats. |
| O9 | Medium | `keeper/server.ts:144`, `src/strings.ts:722,1272` (strings 1, 2) | A raw error text (`EACCES: … D:\…`) reaches the status line and the "It did not work: …" toast. The status line shows it **by decision (2026-10-26)** so the owner can read why backups fail. | Keep, or map to words; your call. |

## Open — Low (listed for after launch; none touches money, numbers or status)

- **DB/perf:** `PendingPicker` filters not debounced (`PendingPicker.tsx:57-67`); `firmAccounts.countsSql` reads each firm's rows to count (`firmAccounts.ts:120`), unmeasured at 3-year size; no EXPLAIN tests for `lrs.byDate`, `memos.byDate`, histories, print rows; `schema_version` has no PRIMARY KEY and there is no golden-schema check (`migrations.ts:231`); `setDefaults` / `setCompany` carry no version (last Admin write wins, audited).
- **State/logic:** several lists do not listen to `stations`/`trucks`/`drivers` (a rename by another seat shows after the next LR event); `today` for presets is yesterday's on a seat left open overnight; `/print/done` publishes no event; module-level `last` view variables can point at a removed row; `flip()` in `lrs.ts:123` returns where `update()` throws (cannot happen today); `/backups/export` has no PIN and no audit row.
- **Print/failure:** the 2 MB `data:` URL guard is proven with ASCII only — a 1,000-row statement with long Devanagari names is ~2.1 MB (base64 would fix it); the guard marker is written non-atomically (`guard.ts:63`); `/health` throwing is shown as "another program on the port"; a half-written PDF stays if the disk fills; a wrong word ("no database to back up") while the keeper starts.
- **Security:** `will-navigate` allows any `file:` URL in production; CSP lacks `base-uri/form-action/object-src 'none'`; `seat.json` names are not cleaned on load; Users get Modify on all of `%ProgramData%\BookingManager`; a signed *older* release with a higher version is accepted; CI actions pinned by tag.
- **Dead code (ponytail):** `ComponentsPage` showcase + its strings (≈400 lines, bundled but unreachable when installed); `src/logic/lrFlow.ts` (test-only); unused strings keys (`ui.esc`, `lr.newestFirst`, `lr.goBack`, `history.listLabel`) and the placeholder page fallback (`pageEmpty*`, `Page.module.css`); the `text`/`money` cell helper copied in 6 files and `int`/`text` in 6 keeper rule files; `LrHistory`/`MemoHistory` near-duplicates; `isoToDisplay` twice; `scripts/make-icon.cjs`; exports used only by tests (`reports.ts` SQL builders, etc.); duplicate `build.productName` / `electronVersion` in `package.json`; `prebuild-install` and its tree ship in the installer.
- **Dependencies:** **none unused, all pinned exactly**; `npm audit` not re-run this session (Electron 22 and `minimatch` stay accepted, see decisions 2026-11-03).

## Scans with nothing found (what was checked)

db (every statement bound, ordered by business keys, listed with LIMIT, writes in one transaction, constraints), migration (v1–v4 bodies never edited, each
transactional, tested from empty and every older version), calc (integer paise, one rounding function, tax on freight only, `MAX_PAISE` cannot overflow,
SQL twin equals `lrAmounts`), logic (the `status`/`memo_id` CHECK rules out a loaded LR with no memo, on two memos, or cancelled on a memo; claim guard;
version checks; PIN gates match the PIN table), print (isolated window, every string escaped, no `@media print`, pagination at every edge), failure
(keeper restarts, rollbacks, guard, safe mode, event-stream reconnect), perf (no polling except the 15 s ping), window/IPC (sandbox, contextIsolation, no
generic channel, no path from the screen), updater (signature path end to end, key outside the repo).
