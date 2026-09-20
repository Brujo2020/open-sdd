---
id: converge
description: Reconcile what the specs claim with what the code and the engine reports show, and turn every real gap into an explicit task.
writes:
  - ".sdd/specs/<feature>/tasks.md"
  - ".sdd/specs/<feature>/convergence.md"
mustNotTouch:
  - ".sdd/specs/<feature>/requirements.md"
  - ".sdd/specs/<feature>/plan.md"
  - ".sdd/steering/constitution.md"
  - "src/**"
  - "test/**"
preconditions:
  - ".sdd/specs/<feature>/tasks.md"
handoffs:
  - implement
  - analyze
parallelSafe: false
moves:
  - alignment
commands:
  - "open-sdd status --json"
  - "open-sdd status --check --json"
  - "open-sdd brownfield analyze <feature> --json"
  - "open-sdd brownfield contracts <feature> --json"
  - "open-sdd brownfield converge <feature> --json"
  - "open-sdd govern rigor --gates"
scripts:
  - "open-sdd brownfield converge <feature> --json"
  - "open-sdd brownfield analyze <feature> --json"
  - "open-sdd brownfield contracts <feature> --json"
---

# Converge — the specs and the code must agree, or the gap must be written down

After implementation, documentation and code drift. This command measures the drift with the engine,
reports the score and phase, and appends the unbuilt work as **explicit tasks** — never as a vague
"follow-up". A gap that is not in `tasks.md` does not exist.

## Input

```text
$ARGUMENTS
```

If no feature is named, read the state and ask which feature to converge.

## Contract — the five guarantees for this template

- **Identified — produces:** `.sdd/specs/<feature>/convergence.md` and the tasks appended to `.sdd/specs/<feature>/tasks.md`.
- **Identified — refuses:** it refuses to rewrite existing tasks, requirements or plan, and refuses to mark a feature converged while a drift item is open.
- **Automated — how:** this template never asks you to "consider" a check: the `commands:` frontmatter names the real engine invocations and the steps below RUN them and read their output.
- **Assured — backing check:** `open-sdd brownfield analyze <feature> --json` **exits 1** on error findings and `open-sdd status --check --json` **exits 1** when the constitution is violated; a failing check BLOCKS the convergence claim.
- **Measured — components:** `alignment` — the reader sees the change before/after in `open-sdd status --json` (score and phase).
- **Pivoted — the constitution is the pivot:** the constitution is the pivot: drift is measured against the ratified constitution, the disagreement is routed to the constitution command rather than settled by preference, and `open-sdd status --check --json` is the pivot check.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_converge`, run
   those steps first.
2. Entries with `enabled: false` are skipped and the skip is named.
3. If the YAML cannot be parsed, **stop and report it**. Never skip silently.

## Scope guard

- **May write:** the feature's `tasks.md` (append new tasks only — never rewrite existing ones) and
  `convergence.md` (the drift report).
- **Must not touch:** `requirements.md`, `plan.md`, the constitution, application source or tests. If
  the code is wrong, the new task fixes it; this command does not.
- **Deferred intents:** a gap that is real but out of this feature's scope is recorded in
  `convergence.md` with the feature that should own it. It is not silently dropped.

## Steps

1. Read the repository score and phase, and the one action the engine recommends:

```bash
open-sdd status --json
```

2. Read the engine's consistency findings for the feature — these are the drift candidates:

```bash
open-sdd brownfield analyze <feature> --json
```

3. Ask which changed files no test covers; uncovered change is drift that a green suite hides:

```bash
open-sdd brownfield contracts <feature> --json
```

4. Validate the repository against the constitution and the declared rigor level, and read the gates
   that level activates so you know what "converged" must mean here:

```bash
open-sdd status --check --json
```

```bash
open-sdd govern rigor --gates
```

5. Write `convergence.md` with:
   - the score and phase **as reported**, quoted;
   - each drift item: the document claim, the code reality, the engine evidence, and the direction of
     the fix (document or code);
   - the regeneration status where the engine exposes it: what can be regenerated from the specs and
     what cannot;
   - the deferred items and their proposed owner.
6. Run the engine's converge pass, which derives the drift items and appends the unbuilt work as
   tasks with their traceability intact. Read what it appended before adding anything by hand:

```bash
open-sdd brownfield converge <feature> --json
```

7. Append a task to `tasks.md` for every unbuilt or drifted element the engine did **not** already
   cover, using the same shape `tasks` requires: id, requirement, paths, the real test command, and
   `_Evidence:_`. Never renumber or rewrite existing tasks.
8. Do not mark the feature converged while any drift item is unresolved or any new task is open.

## The constitution is the pivot

Drift is measured against the ratified constitution, not against preference. When the code and a
principle in force disagree, the report says which one the team must change and routes it through the
constitution command; an unratified draft cannot settle the disagreement.

## Evidence

- Quote the score, phase and gate findings. Do not round a failing check up to "mostly".
- Every drift item cites the engine output that exposed it.
- The regeneration status is reported as measured, including "not regenerable", never assumed.

## Honesty

- If a drift check cannot run, list it under "not inspected" and do not count it as agreement.
- Never invent a task to look busy, and never omit a drift item to declare convergence early.
- Never claim the score improved; report the number you observed before and after.

## Mandatory Post-Execution Hooks

1. Hand the appended tasks to `implement`.
2. Re-run `analyze` after the tasks are done; do not self-certify convergence.

## Completion Report

- Score and phase before/after, quoted.
- Drift items and the direction of each fix.
- Tasks appended, by id; tasks still open.
- Checks run, and checks that could not run.

## Done when

- Every drift item is resolved or written down as an open task.
- `convergence.md` records the score, phase, drift evidence and regeneration status.
- Existing tasks were not rewritten or renumbered.
- No source file was touched.
