---
id: implement
description: Execute the task list one task at a time, with a real test run as the only accepted proof of completion.
writes:
  - "src/**"
  - "test/**"
  - ".sdd/specs/<feature>/tasks.md"
mustNotTouch:
  - ".sdd/specs/<feature>/requirements.md"
  - ".sdd/specs/<feature>/plan.md"
  - ".sdd/steering/constitution.md"
  - ".sdd/settings/extensions.yml"
handoffs:
  - analyze
parallelSafe: false
moves:
  - evidence
commands:
  - "open-sdd status <feature> --json"
  - "open-sdd gates run"
  - "open-sdd gates chain --profile regulated"
  - "open-sdd brownfield contracts <feature> --json"
  - "open-sdd delta validate <feature> --json"
scripts:
  - "open-sdd status <feature> --json"
  - "open-sdd gates run"
  - "open-sdd brownfield contracts <feature> --json"
---

# Implement — evidence or it did not happen

You are executing the approved task list. The only accepted proof that a task is complete is the
task's own test command having been run and having passed — with its output recorded in the task's
`_Evidence:_` line. "It should work" is not evidence.

## Input

```text
$ARGUMENTS
```

With task numbers (`T003 T004`), execute exactly those. Without them, execute the remaining tasks in
dependency order. If no feature is named, read the state and ask.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_implement`, run
   those steps first.
2. Entries with `enabled: false` are skipped and the skip is named.
3. If the YAML cannot be parsed, **stop and report it**. Never skip silently.
4. Confirm the task list is approved and the tests it names actually exist. A task whose test command
   does not exist is blocked, not "done next time".

## Scope guard

- **May write:** application source and tests inside the paths the task declares, plus the task's
  `_Evidence:_` line in `tasks.md`.
- **Must not touch:** `requirements.md` or `plan.md` (if they are wrong, stop and send the work back),
  the constitution, the extension configuration. Never edit a test to make a failing behaviour pass
  unless the task explicitly says the test is the deliverable.
- **Deferred intents:** discoveries that need work outside the task's declared paths become deferred
  notes in `tasks.md`. Do not widen the task. Do not fix the unrelated bug you noticed.

## Steps

1. Read the state, the phase and the remaining tasks:

```bash
open-sdd status <feature> --json
```

2. For each task, in dependency order:
   1. Re-read the task and its requirement ids.
   2. Make the smallest change that satisfies it, inside the declared paths.
   3. Run the task's **own test command**, not a proxy.
   4. On failure: fix the cause, not the test. If the test itself is wrong, say so explicitly and
      record why.
   5. On pass: write the `_Evidence:_` line with the command and its result reference, then move on.
3. Keep the regression oracle green as you go — run the contracts report to see which tests protect
   the files you touched and run them:

```bash
open-sdd brownfield contracts <feature> --json
```

4. For a change to existing code, keep the delta valid after every task that changes the surface:

```bash
open-sdd delta validate <feature> --json
```

5. When the task list is complete, run the enforcement chain. It is the repository's own verdict, not
   yours:

```bash
open-sdd gates run
```

6. If the repository declares a regulated profile, run the stricter chain and report its verdict
   verbatim:

```bash
open-sdd gates chain --profile regulated
```

## The constitution is the pivot

Do not implement a task in a way that violates a ratified principle, even if it is the shortest path.
If the only viable implementation violates the constitution, stop and report the conflict; the human
amends the constitution or the plan. An unratified draft is not authority to bend a rule.

## Evidence

- The `_Evidence:_` line holds the exact command and its observed result. An empty line means the task
  is incomplete.
- The contract report tells you which changes are unprotected. Report that gap; do not paper over it
  with a passing unrelated suite.
- Quote the gate output; do not summarise it into "all good".

## Honesty

- Never mark a task complete without running its test command in this session.
- If a command cannot run (missing runtime, no network, platform mismatch), say so and leave the task
  open with the reason. A skipped check is never a pass.
- Never claim the gate chain passed if it was not executed. Report the exit status you observed.

## Mandatory Post-Execution Hooks

1. Re-run `open-sdd status <feature> --json` and confirm the evidence component moved.
2. Hand the completed task set to `analyze` for independent checking.

## Completion Report

- Tasks completed, each with its evidence line; tasks left open, each with its blocker.
- Contradictions found between requirements, plan and code.
- Deferred intents and the unprotected changes the contracts report named.
- Checks run, and checks that could not run.

## Done when

- Every completed task has a real, executed test command in its `_Evidence:_` line.
- The repository's own enforcement chain was run and its verdict reported verbatim.
- No requirement or plan document was modified.
- Open tasks are explicitly open with reasons.
