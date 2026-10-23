---
description: End-of-phase audit scan (read-only report)
argument-hint: db | calc | logic | print | perf | failure | migration | state | all
---
Run the Booking Manager audit scan "$ARGUMENTS" (or every scan for "all"). Read-only: report, do not fix.
Read `CLAUDE.md` first; every finding cites file:line and the CLAUDE.md rule it breaks.

- **db** — every keeper query: uses an index (`EXPLAIN QUERY PLAN`), has a `LIMIT` if it lists rows, orders by
  business keys, runs multi-row writes in one transaction, uses prepared statements. Schema constraints match the plan.
- **calc** — all money in integer paise; one rounding function; service tax on freight only; charges-rule
  math; memo frozen totals; no money computed in the screen.
- **logic** — status transitions (booked / loaded / cancelled), claim guard, version checks, PIN gates,
  yearly number reset, walk-in handling.
- **print** — print templates isolated in the print window; no global `@media print`; A4 memo fits.
- **perf** — no polling, no refetch on navigation, no full-table reads, list virtualisation where > 200 rows,
  budgets from the Build Plan.
- **failure** — keeper down, disk full, locked file, blank database, wrong data root, crash mid-save:
  each fails loudly and loses nothing.
- **migration** — migrations ordered, each in one transaction, idempotent, tested from an empty database.
- **state** — screen state vs keeper truth: stale views after another seat's write, optimistic updates, drafts.

Finish with a table: severity, finding, file:line, rule, suggested fix.
