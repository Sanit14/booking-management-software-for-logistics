# Handoff

Older notes (sessions 1.1 – 4.3, owner steps, review notes, history) are unchanged in `docs/handoff-archive.md`. How to run, test, release and restore: `README.md`.
What the audit found and what is still open: `docs/audit-4.4.md`. One line per decision: `docs/decisions.md`.

## Session 4.4 — stall fixes, audit, clean-up (built and checked 2026-11-07; NOT committed: the owner commits)

**State:** `KEEPER_VERSION` **19**, schema **v4** (unchanged), app version **0.3.1**.
**Final check:** `npm run check` alone, **exit 0 three times in a row on the final code — 320 node + 320 database + 59 real-Electron tests** (4.3 ended at 318 + 316 + 59). The baseline run of this session, before any change, failed 2 keeper-server tests by timing (a clean stop passed the client's old 3 s wait while an `npm ci` was running); they passed alone, and `shutdown()` now waits 60 s.
**Bench** (`docs/bench/2026-11-07-laptop-4-4.md`, the 3-year file, idle PC): every row PASS, including the new "saves / health pings while backups are listed / previewed / restored" rows. It was run **before the fresh-agent review fixes** (they touch only the failed-swap path, `stop()` during a swap and the preview gate, not the happy path): run it again on an idle PC if you want a number for the final code.
**Review by a fresh agent** (code-review-and-quality + ponytail-review): one High (a failed swap whose reopen throws left the keeper on `starting`), two Mediums (shutdown during a swap, a leaked staged copy) and Lows: all fixed, recorded as A8 in `docs/audit-4.4.md`. A Low the review also named and I did NOT do: the `['', '-wal', …]` clean-up appears in `restoreFiles` once more (the other two copies were merged).

**Done**
- **The two 4.3 stalls are fixed and measured** on the 3-year file (`C:\bmload`): while Settings → Restore a backup… lists, previews and restores, the worst save / health ping was **12 / 116 / 507 ms** (before: 21.6 / 28.0 / 24.0 s; `docs/bench/2026-11-07-laptop-4-4-before.md` and `…-4-4.md`). `/backups/list` opens nothing (the picker shows made / size; counts and "damaged" come with the preview). Preview and apply check files in child processes; apply checks a COPY made beside the live file before anything is closed; the swap is asynchronous (health says `starting`); a second restore is refused. Waits for a clean stop: 60 s (updater and launcher), restore / export calls from the screen 10 min. **The restore as a whole is not faster** (93 s here): it just no longer holds the keeper.
- **Audit A1 (High):** `synchronous = FULL` — a reopened WAL file was at NORMAL, so a power cut could take back the last saves and the counter (an LR number issued twice). **A2:** `BM_*` test hooks need `--test-hooks` (the installed app never passes it; it also ignores `BM_DATA_ROOT` and drops `NODE_OPTIONS`). **A3:** Loading Memo "Edit header" could silently revert another seat's change (now `memo-stale`). A4–A6: "Keeper" wording, `--dev` in the installed app, `.gitignore` for keys.
- `README.md` written, this file shortened, `docs/audit-4.4.md` written.

**NOT done — owner decisions (details and proposals in `docs/audit-4.4.md`, "Open")**: O1 the keeper port is unauthenticated (a local user could squat it and read PINs; architecture change), O2 the installer's `icacls` on folders Users can replace (test on a VM), O3 a retried save whose answer was lost drops a corrected value (product choice), O4 a throwing migration would restart-loop with a backup each time, O5 Reports refetch every loaded page on any save, O6 long lists not windowed, O7–O9 PIN-lock scope, port DoS, raw error text. **The card's "no High / Medium left open" is not met**; I fixed what needed no decision and had a test or a read-proof, and listed the rest rather than guess.
- Not run: the dead-code deletions the audit lists (Low; the `ComponentsPage` showcase is the big one), `npm audit` (unchanged since 4.3), anything in the real Electron window (the screen changes — picker columns, a "checking" line, status wording, Edit header — are typechecked and linted, not clicked), the installed 0.3.0 → 0.3.1 update, the NComputing seat.

## For the next session to know
1. A restore in `server.ts`: `/restore/apply` sets `restoring`; `verifyApply` takes the token and leaves `booking.db.restoring`; `restoreFiles` moves it in; `swapIn` sets `state='starting'`; every early exit calls `dropStaged`. If the preview passes ~30 s on a seat, take the live side from the keeper's open handle (counts only) instead of a child check.
2. `BackupInfo` is `{file, at, sizeBytes}`; anything that wants counts calls `/restore/preview`.
3. Tests and `bench.cjs` start the keeper with `--test-hooks`; a new place that spawns a keeper and needs a `BM_*` variable must pass it.
4. `npm run check` fails by chance when the PC is busy (a keeper's clean stop passes 3 s): run it alone; `shutdown()` now waits 60 s by default, which removed most of that.
5. The Stop hook runs `npm run check` in the MAIN folder, not the worktree; it collides with a check you run elsewhere and with an `npm ci`.

## Owner steps for 4.4 (PowerShell)
1. **Commit and merge** (steps printed at the end of the session), then from the MAIN folder: `npm install`, `npm run postinstall`, `git push`, `gh run list --limit 3` (green before 4.5).
2. **Release 0.3.1 from the main folder after the push:** `npm run release`, run the `gh release create v0.3.1 …` it prints. Update the installed 0.3.0 from Settings → Software update (Admin PIN); the first start after the update opens an existing book, so expect `synchronous` FULL from then on.
3. **On a seat** (AnyDesk, NComputing): Settings → Restore a backup… on a real book — list, choose (watch the "checking" line), compare, cancel. Then the bench from `README.md` with the installed exe if you want seat numbers (`docs\bench\<date>-ncomputing.md`); read Save LR first (FULL costs an fsync; a spinning disk is slower than this SSD).
4. Delete `C:\bmload` when you no longer need the 3-year file (458 MB), and `%TEMP%\bm-bench-*` if a bench was interrupted.
5. Decide O1–O9 above (or tell me which to build in 4.5).
