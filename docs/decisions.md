# Decisions

One line per decision, newest at the bottom. Details live in the Spec and Build Plan docs (links in CLAUDE.md).

- 2026-10-22 · Booking Manager is fully standalone from DM: own data, own install, no link.
- 2026-10-22 · Fresh start: no old data imported; the client enters master data only.
- 2026-10-22 · Volume ~300 LRs/day, several NComputing seats, Windows 7 host, 1024×768.
- 2026-10-22 · Masters: firm, station, truck, driver. Route = station (no route master). Agent page deferred.
- 2026-10-22 · LR: one particular + quantity per LR. Walk-in consignor/consignee allowed, can be saved to master.
- 2026-10-22 · LR charges follow DM's charges (cartage) rule: Option 1 / Option 2 / Blank from Settings fill godown bhada, godown insurance, delivery charges, hamali (per dag × qty, flat, none); all editable; to pay XOR paid.
- 2026-10-22 · Service tax % set per LR, on freight only (to pay or paid), printed on the LR.
- 2026-10-22 · LR and challan numbers are running series that reset every 1 January.
- 2026-10-22 · LR edit / cancel / move off a memo needs the System PIN.
- 2026-10-22 · Loading memo = filter pending LRs, tick, assign truck + driver (masters); from = loading station, to = delivering station chosen for the memo.
- 2026-10-22 · Memo totals are frozen at save; later LR edits flag the memo until a PIN-gated Recalculate.
- 2026-10-22 · One LR can only be on one memo; claim guard refuses and names the LR and truck.
- 2026-10-22 · Wasuli page v1 = copy of DM's; booking-side rules decided later.
- 2026-10-22 · Reports v1: date, station, consignor, consignee, truck, firm — default columns in the Spec.
- 2026-10-22 · Same printer as DM; memo on A4.
- 2026-10-22 · Pages: Dashboard (global search + count cards, no money), LR Entry, Loading Memo, Quick LR on every page; Admin: Firm Accounts, Wasuli, Reports, Masters, Settings.
- 2026-10-22 · UI direction A "DM Evolved": DM teal #144D52/#1D9699 + orange; buttons with white text use #C4531B; Plus Jakarta Sans + Inter; bigger type.
- 2026-10-22 · Shortcuts are user-configurable, as in DM.
- 2026-10-22 · Stack: Electron 22.3.27, React 19 + TS, Vite (chrome108), plain CSS + CSS Modules, keeper process + better-sqlite3 (WAL), node:test.
- 2026-10-22 · Keeper port 47715, data root C:\BookingManagerData, backups D:\BookingManagerBackups.
- 2026-10-22 · Owner does all git commits and pushes; GitHub repo created after the first session/app test.
- 2026-10-23 · Tooling pins (dev machine only): TypeScript 5.9.3 (typescript-eslint rejects ≥ 6.1), Vite 7.3.7 + plugin-react 5.2.0, ESLint 9.39.5, `@types/node` 16.18.126 so tsc rejects Node APIs newer than 16.17; all devDependencies, exact versions, `.npmrc` legacy-peer-deps.
- 2026-10-23 · Electron 22 npm-audit advisories accepted (fix needs Electron 41, no Win7); app is offline and loads no remote content.
- 2026-10-23 · Keeper = Electron exe run as plain Node (`ELECTRON_RUN_AS_NODE=1`), detached, binds 127.0.0.1:47715 before touching the database; a second keeper exits 0.
- 2026-10-23 · Main checks the data root (refusal rules) before spawning the keeper; the keeper trusts its argument. The screen gets error codes; all wording lives in `src/strings.ts`.
- 2026-10-23 · A running keeper older than `KEEPER_VERSION` is shut down and replaced; one on a different data root or another program on the port is an error, never "connected".
- 2026-10-23 · Blank-database guard: marker per data root in `%ProgramData%\BookingManager`; marker + missing or 0-byte `booking.db` = safe mode, no new file.
- 2026-10-23 · Keeper tests spawn the keeper as Electron-as-node (rebuilt better-sqlite3 loads only there); pure logic never imports it. `npm run check` wipes and recompiles `dist-electron` before `node --test`.
- 2026-10-23 · `better-sqlite3` 12.11.1 is rebuilt for Electron 22.3.27 by `postinstall` (`@electron/rebuild` 4.2.0, works on dev Node 20.19; needs VS Build Tools and a short path).
- 2026-10-23 · Keeper client opens a fresh connection per request (`agent: false`); seat name = Windows user name, sent as `X-BM-Seat`.
