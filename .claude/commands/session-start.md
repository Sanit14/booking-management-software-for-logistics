---
description: Start a Booking Manager build session (reads context, plans, waits for approval)
argument-hint: <session number, e.g. 1.2>
---
Session $ARGUMENTS of Booking Manager.

1. Read `CLAUDE.md`, `HANDOFF.md`, `docs/decisions.md` and `docs/sessions/$ARGUMENTS.md` in full.
   If the session card does not exist, stop and say so.
2. Read the existing code the card touches before planning. Never plan from assumptions.
3. Use the `make-plan` skill to write a short plan: files to create/change, tests to add, what is out of scope,
   and how each "Done when" item will be proven. Use `ponytail`: smallest change that meets the card.
4. Show the plan and **wait for my approval**. Do not write code before I say go.
5. After approval: build in thin slices (`do`, `incremental-implementation`); test first for money, numbering
   and status rules (`test-driven-development`). After each slice run `npm run check`.
6. When the card's "Done when" list is met: run `/verify`, then hand off as CLAUDE.md describes.
   Never run git commit or push.
