# Handoff

**Last session:** 1.3 — schema v1, numbering, money, audit. The keeper now creates/upgrades `booking.db` to schema v1 on start; money, yearly numbering and the audit log are pure/tested code. `npm run check` passes: 44 node tests + 35 database tests. The status line reads "Keeper connected · data: … · seat: … · v2 · schema v1".
**Next:** Session 2.1 (masters endpoints and screens) per the Build Plan. Nothing in the keeper serves the new tables yet: no endpoint, no screen.
**State:** nothing committed yet (owner commits). No GitHub remote yet. Built in git worktree `.claude\worktrees\session-1-3` (branch `worktree-session-1-3`).

## What exists
- **Schema v1** (`keeper/migrations.ts`): `stations, firms, trucks, drivers, counters, memos, lrs, audit_log, settings` + `schema_version`, every CHECK/index/FK from the card. Migrations are an ordered list, each in one transaction with its `schema_version` row; applied versions are skipped; a database newer than the keeper is refused. **A shipped migration is never edited: add version 2.** `settings` is seeded with `chargeRule_option1|option2|blank` (JSON in paise, DM's defaults ×100).
- `keeper/money.ts` (`parseRupees`, `taxPaise` round-half-up, `chargesFor`, `lrAmounts`; `ChargeRule` = DM's CartageRule in paise), `keeper/numbering.ts` (`nextNumber(db, 'lr'|'challan', recordDate)` → `{year, no}`, throws outside a transaction, year from the record's date), `keeper/audit.ts` (`writeAudit`, also requires a transaction; the table itself refuses UPDATE/DELETE via triggers), `keeper/names.ts` (`nameKey`).
- Every table is `STRICT` (an INTEGER column refuses 12.5 and 'abc'; a bare `CHECK (x >= 0)` would let both in), and `lr_date`/`memo_date` must be `YYYY-MM-DD` with `lr_year`/`challan_year` equal to the date's year.
- Guard upgrade: the marker (`%ProgramData%\BookingManager\db-<hash>.json`) now stores `businessRows` (lrs + memos + stations + firms + trucks + drivers), written on open, on clean stop, and **raised every 5 minutes** while the keeper runs (`raiseMarker`), so a power cut on day one leaves a baseline at most 5 minutes old. The timer is covered by a database test for `raiseMarker` but not by an end-to-end test (there is no endpoint yet that adds records): **add one in 2.1** (insert via the new endpoint, wait or shorten the interval, assert the marker rose). Opening a database with 0 rows when the marker says > 0 → safe mode `marker-with-no-rows` (nothing migrated, nothing written). A 1.2 marker has no count, so the guard is simply off for it.
- `/health` gains `schemaVersion`; `KEEPER_VERSION` is 2 (a running 1.2 keeper is replaced automatically — seen working).
- **Database tests:** `*.dbtest.ts` run by `scripts/test-db.cjs` under Electron-as-node (the rebuilt better-sqlite3 loads only there); `check` ends with `npm run test:db`. Helpers in `keeper/testing.ts` (`freshDb`, `insertLr`, `insertMemo`…). Pure tests stay `*.test.ts`. New database test? Name it `*.dbtest.ts` and it is picked up.
- Everything from 1.2 (keeper process, bridge, data root rules, safe mode) is unchanged apart from the above; see "Things to know".

## Decisions the card left open (made in 1.3 — change them in a new migration if wrong)
- `uid` is `TEXT NOT NULL UNIQUE` on `lrs` and `memos` (caller-made, so a retried save cannot double-book).
- `firms.station_id` is **nullable**; `memos.truck_id`/`driver_id` and `lrs` stations are NOT NULL (the card marks only consignor/consignee/memo ids as NULL).
- `audit_log.entity_id` is TEXT (fits row ids and settings keys); dates are `YYYY-MM-DD` text, timestamps ISO-UTC text, `active` 0/1, `seat` NOT NULL.
- Memo money/count columns are also CHECK ≥ 0. `charges` in `lrAmounts` excludes `wasuli_paise` (card lists exactly: godown bhada + insurance + delivery + hamali + pf).
- Review by a fresh agent (code-review-and-quality + ponytail-review) found no blocking bugs. Fixed: STRICT tables, date CHECKs, stale guard baseline after a crash, `stop()` now always checkpoints even if the marker write fails, safe-mode wording no longer claims records existed, `nameKey` is NFC-normalised, `nextNumber` is one `INSERT … ON CONFLICT … RETURNING` statement, `migrate` no longer re-sorts. Not taken: dropping `whole()` checks on DB-sourced money (cheap and defensive), `.immediate` transactions (comment left in `numbering.ts` for when a second writer appears).
- Still to confirm with the client (2.2): the printed total is the same for to pay and paid LRs.

## Things to know (will bite later)
- **The keeper keeps running after the app closes — on purpose.** After a rebuild an old keeper keeps the old code until it is stopped (`Invoke-RestMethod -Method Post -Uri http://127.0.0.1:47715/shutdown -ContentType application/json -Body '{}'`) or `KEEPER_VERSION` is bumped. Bump it whenever routes or schema change.
- `npm run check` = typecheck → ESLint → delete `dist-electron` → compile → `node --test` run from inside `dist-electron` (so it never picks up compiled copies under `.claude\worktrees\*`) → `npm run test:db`. `scripts/` is not linted.
- The keeper integration tests (`keeper/server.test.ts`) spawn the keeper as Electron-as-node and use `PROGRAMDATA` + a temp root; the keeper does **not** re-check the data root (main does, before spawning).
- `electron/keeperBridge.ts` imports `electron`, so no unit test; verified by hand in 1.2 (stale keeper replaced, other program on the port, two apps at once → one keeper, reopen reuses the keeper) and again in 1.3 (1.2 keeper replaced by v2, 1.2 database upgraded in place: same file, birth time unchanged, now v1).
- If the database cannot be opened (damaged file) the keeper logs `keeper-fatal` and exits 1; the screen says "could not be started (exit 1; see keeper.log)". A proper message and restore flow come with 1.4.
- **The keeper runs inside the Windows session of the seat that started it.** If that seat logs off the keeper dies and every other seat shows "could not be started" until one reopens the app. DM has a seat-side watchdog; not built (1.6 decides watchdog vs Windows service on hardware).
- Two seats under the same Windows user share one seat name; each NComputing seat is meant to be its own Windows user. A real two-seat check is still needed on hardware (also: do two seats share one `%APPDATA%\Booking Manager`?).
- node-gyp fails on very long paths (> 260 chars); `postinstall` rebuilds better-sqlite3 for Electron, so build from a short checkout path if it complains. Each new worktree needs its own `npm install`.
- Temp folder `C:\bmtest13` (data roots, ProgramData stand-in and seat folders from the 1.3 hand tests) could not be deleted by the session (safety check); delete it by hand.

## Open from 1.1 / for 1.6 (hardware and packaging)
- `npm audit` Electron advisories accepted (fix needs Electron 41, no Win7).
- Window size: 1024×768 includes the frame, so the page area is ~1008×730; decide kiosk/maximised on real seats.
- Production CSP in `index.html` still allows `ws://127.0.0.1:5173` (dev HMR); tighten at packaging. Dev also needs `'unsafe-inline'` for the React-refresh preamble if the CSP moves to a header.
- Packaging: `better-sqlite3` must be `asarUnpack`ed, the keeper script path must work from the packaged app, and `*.test.js` / `*.dbtest.js` must be left out of the package. Keeper folder permissions for non-admin seats (`%ProgramData%\BookingManager`, data root, logs) are a 1.6 item.
- `vite.config.ts` is linted but not type-checked. Reviewer's optional cut (replace `concurrently` + `wait-on` with a small `scripts/dev.mjs`) not taken.
- One `npm run dev` run in 1.1 exited at once with code 0 and was not reproduced; suspect a stale instance holding the single-instance lock.
