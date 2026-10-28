# Booking Manager — rules for every session

Booking Manager is a Windows desktop app for Sundeep Freight Movers (Yavatmal). Booking clerks create an LR for
each consignment (~300/day); a loading clerk filters pending LRs and turns the ones for one truck into a Loading
Memo (challan). Sister app to DeliveryManager (DM) but fully standalone: separate data, separate install.

- Spec (business rules): https://claude.ai/artifact/S9oBw5WFwRvjiCJ4t6Nz6i
- Build plan (architecture, schema, phases): https://claude.ai/artifact/NJNpwK8sB7KtLq29yUpDep
- Decisions so far: `docs/decisions.md` · Current session: `docs/sessions/<n.n>.md` · Last stop: `HANDOFF.md`
- Chosen UI: direction A "DM Evolved" — reference mockups in `docs/design/`

## Target machines (fixed — they decide the stack)
Windows 7 host with NComputing thin-client seats, screen 1024×768, offline, several seats at once.
Dev machine: Windows 11, PowerShell. Give PowerShell commands, never bash-only ones.

## Stack (pinned — do not upgrade without a hardware test)
- Electron **22.3.27** (last with Win7) → Chromium **108**, Node **16.17** inside.
- Screen: React 19 + TypeScript, Vite with `build.target: 'chrome108'`.
- Styling: plain CSS + CSS Modules + design tokens as CSS variables. **No Tailwind v4** (needs Chrome 111+).
  No CSS/JS features newer than Chrome 108 (no `color-mix()`, `oklch()`, native CSS nesting).
- Keeper (the only process that touches the database): TypeScript compiled to CommonJS for **Node 16**.
  Never use Node APIs newer than 16.17.
- Database: SQLite via better-sqlite3 (same version DM ships), WAL, `foreign_keys=ON`.
- Tests: `node:test` for keeper logic. No test framework.
- Packaging: electron-builder NSIS + electron-updater (Session 1.6).

## Identity on the shared host (never collide with DM)
- App id `com.sundeepfreight.bookingmanager`, keeper port **47715** (DM uses 47615).
- Data root `C:\BookingManagerData`, backups `D:\BookingManagerBackups`.
- Never read, write or reference DM's port, data root, backups or locks.

## Data rules (each one exists because DM broke it)
1. The screen never opens the database. Every read/write is a **named keeper endpoint** with its own SQL.
   No generic query endpoint, no ORM, no query shim, no fallback database in the screen.
2. Business rules (money, numbering, status) live **only in the keeper**. The screen and keeper share types
   (`shared/`), never logic.
3. SQL filters, sums, groups and pages. The screen receives only the rows it shows. Every list has a `LIMIT`.
4. Every multi-row change is **one transaction**. LR and challan numbers are issued inside the save's
   transaction (`counters` table, per year, reset 1 January).
5. Money is **integer paise** everywhere. One rounding function. Service tax is basis points, on freight only.
6. Order by **business keys** (date, number), never by `id`.
7. Store inputs, compute totals — except memo totals, which are deliberately **frozen when the memo is saved**.
8. Edits carry `version`; a stale version is refused, never overwritten.
9. No polling and no reload on navigation. The keeper pushes change events; views refetch only what changed.
10. Printing happens in a separate hidden window with its own template. No global `@media print`.
11. All UI text lives in one strings file (English). No secrets in code.

## UI rules
- Every screen fits **1024×768** with no page scroll on entry pages.
- Inputs ≥ 17px text / ≥ 44px tall, tables ≥ 15px, labels ≥ 14px semibold, tabular numbers, contrast ≥ 4.5:1.
- Enter = next field, Shift+Tab = back. Shortcuts are user-configurable (Settings), never hardcoded maps.
- Dashboard shows **counts only, never money**.

## How a session runs
1. `/session-start <n.n>` — read this file, `HANDOFF.md`, `docs/decisions.md`, `docs/sessions/<n.n>.md`.
2. Plan first (plan mode, `make-plan` skill): files to touch, tests to add, out of scope. **Wait for approval.**
3. Build in thin slices (`do`, `incremental-implementation`, `ponytail`). Test first for money, numbering,
   status rules (`test-driven-development`).
4. Verify: `npm run check` (typecheck + lint + tests). The Stop hook runs it; fix until green, max 5 rounds,
   then stop and report the cause (`systematic-debugging`, `verification-before-completion`).
5. Review with a fresh agent (`code-review-and-quality`, `ponytail-review`); fixes go back through step 4.
6. Hand off: update `HANDOFF.md`, add one line per decision to `docs/decisions.md`.

## Git
**Never run `git commit` or `git push`.** The owner commits. At the end of a session, list the changed files and
print one suggested commit message, e.g. `feat(keeper): schema v1, counters [session 1.3]`.
If the session runs in a git worktree (e.g. `.claude/worktrees/<name>`, branch `claude/<name>`), say so at the
end and print the owner's PowerShell steps in this order: inside the worktree `git add -A`, `git commit`,
`git log -1` (confirm the commit exists); then from the main folder `git merge <branch>`, `git log -1` (confirm
the merge), and only then `git worktree remove <path>` (**never `--force`**: it deletes uncommitted work — the
first 1.7 attempt was lost this way), `git branch -d <branch>`, `npm install`, `npm run postinstall`.

## Out of scope until after launch
Agent page, booking-side wasuli rules (v1 copies DM's Wasuli page), the LR website, any cloud sync.
