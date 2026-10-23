# Handoff

**Last session:** 1.2 — keeper process and bridge. One keeper per Windows host owns `booking.db`; every seat finds or starts it over `127.0.0.1:47715`. The screen shows "Keeper connected · data: … · seat: … · v1". `npm run check` passes (22 tests), `npm run build` passes.
**Next:** Session 1.3 — schema v1 and counters (real tables replace the bare `schema_version` table; LR/challan numbering inside the save transaction).
**State:** nothing committed yet (owner commits). No GitHub remote yet.

## What exists
- `keeper/` (TypeScript → CommonJS, Node 16 target, compiled to `dist-electron/keeper/`):
  `server.ts` (the process; binds the port first, `/health`, `POST /shutdown`), `db.ts` (open WAL, `foreign_keys=ON`, `busy_timeout=5000`, creates only `schema_version`), `guard.ts` (blank-database marker + `decideOpen`), `dataRoot.ts` (refused roots, pointer file), `client.ts` (probe/shutdown, utf8 per stream, fresh connection per call), `log.ts`, `paths.ts`. Tests sit next to each file (`*.test.ts`).
- `electron/keeperBridge.ts` (main process): resolves and checks the data root → probes → replaces a keeper older than `KEEPER_VERSION` → spawns detached (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`) → waits ≤ 10 s → returns a `KeeperStatus`. One IPC route, `keeper:health`; preload exposes `window.bm.keeper.health()` only (no generic call).
- `shared/keeper.ts`: `KeeperHealth`, `KeeperStatus`, error codes, and the constants `APP_ID`, `KEEPER_PORT`, `KEEPER_VERSION`. The screen gets **codes**; all wording is in `src/strings.ts`.
- Data root: `BM_DATA_ROOT` (dev/tests, never saved) → `%ProgramData%\BookingManager\root.json` → default `C:\BookingManagerData` (pointer written). Logs: `%ProgramData%\BookingManager\logs\keeper.log`. Blank-db marker: `%ProgramData%\BookingManager\db-<hash of root>.json`.
- Default File/Edit/View menu removed (`Menu.setApplicationMenu(null)`; `GetMenu` on the window returns 0).
- `npm run check` = typecheck → ESLint → delete `dist-electron` → compile → `node --test`. Proven in 1.2 with a deliberately failing `*.test.ts` (check went red, test deleted, green).
- `npm install` runs `postinstall` = `electron-rebuild -f -w better-sqlite3` (compiles for Electron 22.3.27 / ABI 110; needs VS Build Tools + Python; ran fine on dev Node 20.19 although `@electron/rebuild` 4.2.0 declares Node ≥ 22.12).

## Things to know (will bite later)
- **The keeper keeps running after the app closes — on purpose.** After `npm run build` an old keeper keeps the old code until it is stopped (`Invoke-RestMethod -Method Post -Uri http://127.0.0.1:47715/shutdown -ContentType application/json -Body '{}'`) or `KEEPER_VERSION` in `shared/keeper.ts` is bumped. Bump it whenever routes/schema change.
- The rebuilt better-sqlite3 loads only under Electron's Node, not the system Node 20 that runs `node --test`. So the keeper integration tests spawn the keeper as Electron-as-node (like production); pure logic never imports better-sqlite3. Keep it that way.
- Tests use `PROGRAMDATA` and a temp root; the temp folder is under the user profile, which is why the keeper itself does **not** re-check the root (main does, before spawning).
- `electron/keeperBridge.ts` imports `electron`, so it has no unit test. Verified by hand instead: stale keeper (version 0) replaced, other program on the port → error, two apps started together → one keeper (`second-keeper-exit` in the log), close/reopen reuses the same keeper (same `startedAt`).
- If the database cannot be opened (damaged file) the keeper logs `keeper-fatal` and exits 1; the screen says "could not be started (exit 1)" and the cause is only in `keeper.log`. A proper message and restore flow come with 1.4.
- **The keeper runs inside the Windows session of the seat that started it.** If that seat logs off, the keeper dies and every other seat shows "could not be started" until one reopens the app (which starts a new keeper). DM added a seat-side watchdog for this; not built here (card: permissions/service questions are 1.6). Decide on hardware whether a watchdog or a Windows service is wanted.
- Review by a fresh agent (code-review-and-quality + ponytail-review) found no critical issues; fixed: pointer-file write race (temp file + rename), spawn `error` crash in main, keeper lingering after `/shutdown` if the client left, root spelling normalised before hashing the marker, marker/db permission errors no longer read as "missing", stale-keeper replacement re-probes first, dead `starting` state removed. Not taken: folding `paths.ts` into another file, dropping `seat.json` (the card asks for it).
- Two seats under the same Windows user share one seat name; each NComputing seat is meant to be its own Windows user. Real two-seat check still needed on hardware (also: do two seats share one `%APPDATA%\Booking Manager`?).
- node-gyp fails on very long paths (>260 chars); build from a short checkout path if `postinstall` complains.

## Open from 1.1 / for 1.6 (hardware and packaging)
- `npm audit` Electron advisories accepted (fix needs Electron 41, no Win7).
- Window size: 1024×768 includes the frame, so the page area is ~1008×730; decide kiosk/maximised on real seats.
- Production CSP in `index.html` still allows `ws://127.0.0.1:5173` (dev HMR); tighten at packaging. Dev also needs `'unsafe-inline'` for the React-refresh preamble if the CSP moves to a header.
- Packaging: `better-sqlite3` must be `asarUnpack`ed, the keeper script path must work from the packaged app, and `*.test.js` must be left out of the package. Keeper folder permissions for non-admin seats (`%ProgramData%\BookingManager`, data root, logs) are a 1.6 item.
- `vite.config.ts` is linted but not type-checked. Reviewer's optional cut (replace `concurrently` + `wait-on` with a small `scripts/dev.mjs`) not taken.
- One `npm run dev` run in 1.1 exited at once with code 0 and was not reproduced; suspect a stale instance holding the single-instance lock.
