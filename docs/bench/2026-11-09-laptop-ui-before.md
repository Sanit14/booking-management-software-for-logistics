# Long lists in the real window — laptop, 2026-11-09 — BEFORE any windowing (every row drawn)

A day of 400 LRs in LR Entry and 500 firms in Masters. `npm run measure:ui` (electron/uiTiming.ts).

Electron 22.3.27, Chromium 108.0.5359.215, AMD Ryzen 3 3250U with Radeon Graphics         , 20 runs each. Milliseconds.

| What | median | p95 | worst |
| --- | --- | --- | --- |
| LR Entry, 400 rows: a keystroke in the find box, to the next frame | 148.0 | 1042.7 | 1042.7 |
|   of which render and layout (sync) | 79.2 | 554.4 | 554.4 |
| LR Entry: another seat saves an LR (change event to the new row on screen) | 474.5 | 1104.0 | 1104.0 |
| Masters, 500 firms: a keystroke in the search box, to the next frame | 118.3 | 170.9 | 170.9 |
|   of which render and layout (sync) | 81.8 | 124.5 | 124.5 |
| Masters: another seat adds a firm (change event to the new row on screen) | 228.4 | 358.2 | 358.2 |

Decision rule (card): a median over 100 ms means the first 200 rows with "Show more". Highest median here: 474.5 ms -> OVER: window the lists.
