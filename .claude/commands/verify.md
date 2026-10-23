---
description: Prove the current session is done (checks, review, handoff)
---
1. Run `npm run check`. If it fails, fix the root cause (`systematic-debugging`) and rerun; at most 5 rounds,
   then stop and report what is still failing and why.
2. Walk the session card's "Done when" list one by one and show the evidence for each (command output, file, or
   what to click). Anything unproven is not done (`verification-before-completion`).
3. Start a fresh subagent that did not write the code to review the diff with `code-review-and-quality` and
   `/ponytail-review`. Fix real findings, then go back to step 1.
4. Update `HANDOFF.md` (what was done, what is next, what failed) and add one line per new decision to
   `docs/decisions.md`.
5. List the changed files and print one suggested commit message ending in `[session <n.n>]`.
   Do not commit or push.
