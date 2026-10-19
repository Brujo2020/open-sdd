---
name: sdd-bugfix
description: Fix a bug spec-first — actual, expected and what must not change; root cause and a failing test before the fix
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Skill
argument-hint: <what fails>
---

# Bug fix spec

<instructions>
## Why this flow exists
A defect is a delta on existing behaviour. A full requirements → design → tasks cycle hides the two things that
matter: the root cause and the regression contract (what must NOT change). This flow writes those down first, so
the fix is proven and nothing around it moves. (Kiro's bugfix specs; SteelForge `/sdd-bug`.)

## Steps
1. Reproduce the bug. Write `{{SDD_DIR}}/specs/<feature>/bugfix.md` with three lists:
   - **Actual** — what happens now (with the reproduction command and its output);
   - **Expected** — what should happen, as EARS (`WHEN …, the system shall …`);
   - **Must not change** — behaviour that has to stay identical; each item becomes a regression test.
2. Find the root cause in the code (`file:line`), not the symptom. Show the plan to the user and stop for approval.
3. Write FIRST a test that fails because of the bug, and the regression tests for "Must not change".
   Run them: the bug test fails, the regression tests pass.
4. Make the minimal fix. Run all of them again: everything green. Record the commands and results as evidence.
5. If the expected behaviour changes an existing spec, record it as `MODIFIED` with `open-sdd delta init`.
6. Finish with `/sdd-verify-completion`.
</instructions>
