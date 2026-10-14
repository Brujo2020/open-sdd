---
name: sdd-tiny
description: Tinyspec for a spike or proof of concept — goal, done-when and out-of-scope in three lines, then code
---

# Tinyspec (explore mode)

<instructions>
## Why this flow exists
A spike or proof of concept is throwaway code: requirements, design, tasks and approvals would cost more than the
code itself. But "done when" must still be written down, or a spike never visibly fails. Tinyspec keeps that one
discipline and drops the rest. It is the `explore` level: OUTSIDE the governed rigor ladder, so nothing built here
counts as evidence for `spec-first` or above until it is promoted (`/sdd-promote`).

## Steps
1. Ask the user for the idea in one sentence if `$ARGUMENTS` is empty. Derive a kebab-case feature name.
2. Write `{{SDD_DIR}}/specs/<feature>/tiny.md` with exactly:
   ```
   # Tinyspec — <feature>

   Goal: <one sentence, in the user's words>
   Done when:
   - [ ] <observable check 1>
   - [ ] <observable check 2 (max 3)>
   Out of scope: <what this spike will NOT do>
   ```
   If something is missing, ask ONE question. Never invent a done-when the user did not agree to.
3. Implement directly. After each change, run the check of one "Done when" item and tick it only with evidence
   (the command you ran and its result).
4. When every item is ticked, report the evidence and offer `/sdd-promote <feature>` if the spike will live on.

## Rules
- Do not create requirements.md, design.md or tasks.md in this flow.
- A "Done when" that needs hardware, accounts or services you do not have is reported in one line, not faked.
</instructions>
