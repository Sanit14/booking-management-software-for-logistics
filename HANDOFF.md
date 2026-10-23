# Handoff

**Last session:** 1.1 — project skeleton. Electron 22.3.27 + React 19 + TS + Vite (chrome108) build and open; `npm run check` and `npm run build` pass.
**Next:** Session 1.2 — keeper process + keeper bridge (preload currently exposes only `window.bm.version`).
**State:** nothing committed yet (owner commits). No GitHub remote yet.

## What exists
- `electron/main.ts`, `electron/preload.ts` → compiled to `dist-electron/electron/` (CommonJS, Node 16 target). `package.json` `main` points there.
- `src/` one placeholder page; all UI text in `src/strings.ts`. `shared/index.ts` is empty (types only).
- `npm run dev` = compile electron, then Vite (127.0.0.1:5173) + `electron . --dev` together. Without `--dev` Electron loads the built `dist/index.html`, so `npm run build` then `npx electron .` smoke-tests the production path (done in 1.1: works, CSP and preload version fine).
- `npm run check` = tsc (web + node) + ESLint (`--max-warnings 0`) + `node --test` (zero tests so far). `npm run build` = typecheck + Vite build + compile electron.
- `tsconfig.web.json` has `types: []` so Node globals are a type error in `src/`.
- `.npmrc` sets `legacy-peer-deps=true`: Vite 7 optionally wants `@types/node` ≥ 20.19, we pin 16 on purpose.

## Open problems / things to know
- **`npm audit` reports 2 high + several Electron advisories.** Only fixable by Electron 41, which drops Windows 7. Accepted; CLAUDE.md pins Electron 22 until a hardware test says otherwise. Offline, no remote content loaded.
- **Default Electron menu bar (File/Edit/View/Window/Help) is still shown.** Not in the card; remove with `Menu.setApplicationMenu(null)` in a later session (also decide window sizing: the 1024×768 window includes its frame, so the page area is ~1008×730, below the 1024×768 UI target; kiosk/maximised may be wanted on the real seats).
- One `npm run dev` run exited immediately with code 0 (Electron quit at once) and could not be reproduced in two later runs. If it recurs, suspect a stale instance holding the single-instance lock.
- Production CSP in `index.html` still allows `ws://127.0.0.1:5173` (needed for Vite HMR in dev). Tighten when the keeper bridge is added (1.2) or at packaging (1.6).
- `vite.config.ts` is linted but not type-checked (it would need Node types in the web project).
- **Do in 1.2 (before any keeper test is written):** `check` only runs compiled `*.test.js`; `typecheck` is `--noEmit`, so a `*.test.ts` would never run and `check` would stay green. Make `check` compile the keeper/tests (emit to `dist-electron`) before `node --test`, and prove it with one failing test.
- When the CSP moves to a header or is tightened: the Vite React-refresh preamble is an inline script, so dev needs `'unsafe-inline'` in `script-src` (serve mode only).
- Hardware test: check two NComputing seats do not share one `%APPDATA%\Booking Manager` folder (single-instance lock and Chromium cache are keyed on it).
- Reviewer's optional cut, not taken: replace `concurrently` + `wait-on` with an ~8-line `scripts/dev.mjs` using Vite's `createServer` (2 fewer devDependencies).
