# Handoff

Older notes (sessions 1.1 – 4.4, owner steps, review notes, history) are unchanged in `docs/handoff-archive.md`. How to run, test, release and restore: `README.md`.
What the audit found and how each owner decision ended: `docs/audit-4.4.md`. One line per decision: `docs/decisions.md`.

## Session 4.5 — the LR as the customer approved it (built and checked 2026-11-12; NOT committed: the owner commits)

**State:** `KEEPER_VERSION` **21**, schema **v4** (unchanged, no migration), app version **0.4.0**.
**Final check:** `npm run check` alone, **exit 0 three times in a row on the final code — 325 node + 336 database + 59 real-Electron tests** (4.4 ended at 338 + 327 + 59: the node count fell because the tests of `taxPaise`, `parsePercent`, `chargesFor` and `chargeFill` left with their code; the database count rose with the new ones).
**Bench** (`docs/bench/2026-11-12-laptop-4-5.md`, a NEW 3-year file seeded with the new LR: `C:\bmload45`, 294,248 LRs, 19,844 memos, 447 MB, integrity ok, idle PC): **all 30 rows PASS**, Save LR median 5.6 ms (worst 13.4 against 150), Dashboard 55 ms (84 against 300), firm statement 119 ms, firm account open 645 ms, saves while a restore runs worst 322 ms. The old `C:\bmload` still holds charges and tax in its LRs: do not bench on it any more.
**Review by a fresh agent** (code-review-and-quality + ponytail-review): no High. One Medium: my temporary `dist-electron-seed` folder (a copy of the compiled keeper for the seeder) would have failed `eslint .` and been committed by `git add -A`: deleted. Lows fixed: two stale comments, `percentText` (replaced by a one-line division in the old-row reader), `ReportLrRow.hamaliPaise` (nothing showed it), the unused `--purple-tint`, "Changing it asks for the Admin PIN", the amounts strip padding 12 → 8 px, and a sentence test for an old godown row. Left as they were: `LrPreview.fields` (unused by the screen since before 4.5; only tests read it) and the name `MemoTotals.hamaliPaise` kept in the column `frozen_charges_paise` (documented where it is used; 4.6 reworks memo totals).

**Done** (details in `docs/decisions.md`, six lines dated 2026-11-12)
- **The LR has only the approved inputs** (consignor, consignee, LR number, From, To, particular, quantity, to pay or paid, hamali, wasuli; the date stays automatic). Charge option, godown bhada / insurance, delivery charges, PF and service tax are gone from LR Entry, Quick LR, the keeper, the LR print, Reports, Firm Accounts, History and Settings (`LrDefaultsCard` keeps the booking station). Hamali is typed on every LR, optional, empty = 0, it does not follow the quantity.
- **Money:** `lrAmounts` and `keeper/lrSql.ts` are freight, hamali, total; `lrSql.dbtest.ts` compares them over odd amounts, an old row with godown / tax set adds only freight + hamali. `lrs.preview` is a pure function and the form no longer waits for it before saving.
- **No migration:** the old columns stay in `lrs`; a new LR does not name them (they keep 0 / `'blank'`), an edit neither writes nor audits them, a retry (O3) compares only the remaining fields. The old `settings` rows (`chargeRule_*`, `defaultChargeOption`, `defaultStaxBp`) stay in existing books, unread.
- **Memos:** `frozen_charges_paise` now freezes the hamali sum, `frozen_stax_paise` is no longer written or compared. **A memo saved before 4.5 shows Differs** (accepted); Recalculate (Admin PIN) clears it.
- **History** still reads old rows (LR edits, memo recalculations, LR defaults) as "old → new" through small marked legacy readers; tests insert such rows by hand.
- **Paper and screens:** Date-wise = Date, LRs, Qty, To pay, Paid, Hamali, Total; the statement column "Charges + tax" is "Hamali" (screen and A4, same widths) and its totals lose Charges and Service tax; the memo's frozen totals say Hamali; the LR on A5 shows To pay or Paid, Hamali, Total. Snapshots regenerated; the real-PDF test proves the Hamali column whole.
- `scripts/seed-load.cjs`, `scripts/bench.cjs` and `electron/uiTiming.ts` stop generating charges and tax. `grep` for `stax`, `godown`, `deliveryCharges`, `chargeOption` finds only `migrations.ts`, the legacy History readers and their strings, and tests of old rows.

**NOT done — owner steps and honest gaps**
- **Not clicked in the real window** (the card's Done-when 2). The installed app's keeper (port 47715, process 8052 when I looked) has to be stopped first, and I did not stop it without your OK. Still to do on a PC with a throwaway book (`$env:BM_DATA_ROOT='C:\bmtest'; $env:BM_BACKUP_DIR='C:\bmtest\backups'; npm run dev`): type 10 LRs by keyboard only (Enter order consignor, consignee, to, particular, quantity, to pay, paid, hamali, wasuli, Enter saves; From is pre-filled and Enter walks past it), edit one, print one, Reports → Date-wise and a Firm Accounts statement (Hamali, no tax anywhere), Settings (no charge options). Also look at the LR form at 1024 × 768 with a lakh-sized freight and a hamali of 1,000 (`1,23,456` + `1,000`): the amounts strip is estimated at about 93 px per figure, not measured.
- **Enter and From:** the card's Enter order lists From; I kept the 2.2 / 2.4 behaviour (Enter walks past a pre-filled From, Tab reaches it). One attribute (`data-skip-enter` on the From box in `LrForm.tsx`) changes it.
- **The LR print has no Wasuli line** (it never had one; the card said "as today").
- A 0.3.x screen cannot meet the 0.4.0 keeper: the update replaces the app and the keeper together and refuses while another seat is open.

## For the next session to know
1. 4.6 reworks the memo settlement (hamali less, commission, wasuli, net, round figure). `MemoTotals.hamaliPaise` is stored in `memos.frozen_charges_paise`; `frozen_stax_paise` is dead weight in the table (never edit v1).
2. `lrSql.ts` is the only SQL for freight, hamali and total; `money.ts` `lrAmounts` is its JS twin. A new money column on `lrs` goes in both, with a case in `lrSql.dbtest.ts`.
3. Same as 4.4: `npm run measure:ui` (real window, port 47715: close Booking Manager first) and `node scripts/test-installer.cjs` are not part of `npm run check`; `npm run check` can fail by chance when the PC is busy (a seed or a bench running), and the Stop hook runs a check in the MAIN folder.

## Owner steps for 4.5 (PowerShell)
1. **Commit and merge** (steps printed at the end of the session), then from the MAIN folder: `npm install`, `npm run postinstall`, `git push`, `gh run list --limit 3` (green before 4.6).
2. **Release 0.4.0 from the main folder after the push:** `npm run release`, run the `gh release create v0.4.0 …` it prints. Update the installed 0.3.2 from Settings → Software update (Admin PIN); the new keeper (version 21) replaces the old one. Old memos will show Differs: that is expected.
3. **Real-window pass** (the list above), then on a seat (AnyDesk, NComputing) `npm run bench` with the installed exe if you want seat numbers.
4. Delete `C:\bmload` (the old 3-year file, 458 MB) and `C:\bmload45` when you no longer need them.
