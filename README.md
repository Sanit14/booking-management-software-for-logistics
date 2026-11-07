# Booking Manager

Windows desktop app for Sundeep Freight Movers (Yavatmal): booking clerks write LRs, the loading clerk turns pending LRs into a Loading Memo.
Standalone sister of DeliveryManager. Rules for working on it: `CLAUDE.md`. Where a session stopped: `HANDOFF.md`. Decisions: `docs/decisions.md`.
What the last audit found and left open: `docs/audit-4.4.md`. Older handoff notes: `docs/handoff-archive.md`.

Target: Windows 7 seats (NComputing, 1024×768, offline). Stack is pinned (Electron 22.3.27, Node 16.17 inside): do not upgrade without a hardware test.
Commands below are PowerShell, from the repo folder.

## Run it (development)
```powershell
npm install
npm run postinstall        # rebuilds better-sqlite3 for Electron 22 (needs Visual Studio Build Tools); run it after every npm install / npm ci
npm run dev                # real data folder C:\BookingManagerData: only if no installed Booking Manager is running
```
A throwaway book instead (safe to play with; the installed app's keeper on port 47715 must be stopped first):
```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:47715/shutdown -ContentType application/json -Body '{}'
$env:BM_DATA_ROOT='C:\bmtest'; $env:BM_BACKUP_DIR='C:\bmtest\backups'; npm run dev
```
(`BM_*` variables work only in a dev run; the installed app ignores them.) Delete `C:\bmtest` afterwards.

## Test
```powershell
npm run check              # typecheck + lint + node tests + database tests + real-Electron print tests. Run it ALONE: nothing else on the PC
```
It must end with exit code 0 (about 7 minutes). A timing test can fail when the PC is busy (a build, a bench, an install): run it again alone before looking for a bug.

Speed on a big book: build a 3-year file once, then time it (a dev tool, ~20 minutes and ~460 MB; it refuses the real data folder):
```powershell
npm run build:node
npm run seed:load -- C:\bmload                 # PINs in a seeded book: Admin 1111, System 2222 (throwaway data only)
npm run bench -- C:\bmload --label mypc        # idle PC; writes docs\bench\<date>-mypc.md, every budget should say PASS
```

## Release (owner)
Release from the MAIN folder, after the commit is merged and pushed, so the installer matches pushed code:
```powershell
npm install
npm run postinstall
npm run release            # check + installer + signature; prints the `gh release create vX.Y.Z …` command: run it
```
Then on each seat: Settings → Software update → Check → Download → Install (Admin PIN). Settings must show the new version afterwards.
The update **signing key** is `C:\Users\HP\BookingManagerKeys\update-signing-private.pem` — the only copy; keep a backup somewhere else, never in the repo
(`.gitignore` blocks `*.pem`). Losing it means seats can no longer accept updates until a new key is built into a new installer.

## Restore a backup
- Backups: `D:\BookingManagerBackups` (every hour, on start, on stop, before an update; newest 48 plus the first of each of the last 30 days).
- Normal case: Settings → **Restore a backup…** (Admin PIN). Every other seat must have the app closed. Choose a backup, wait for the check (up to a minute on a big
  book), compare the two summaries, restore. The book as it was is kept as `booking-before-restore-<time>.db` in the backup folder and never deleted.
- If the book is missing or damaged the app starts in **safe mode** and offers the same list; nothing is overwritten until you restore.
- Data folder `C:\BookingManagerData`; the keeper's log is `%ProgramData%\BookingManager\logs\keeper.log` (what failed, with times; no PINs).

## Git
Claude sessions never commit or push. After a session: `git add -A`, `git commit`, `git log -1`; then from the main folder `git merge <branch>`, `git log -1`,
`git worktree remove <path>` (never `--force`), `git branch -d <branch>`, `git push`, `gh run list --limit 3` (the run must be green before the next session).
