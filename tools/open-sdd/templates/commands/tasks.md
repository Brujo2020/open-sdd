---
id: tasks
description: Decompose the approved plan into ordered, independently testable tasks, each with the exact test command and an evidence line.
writes:
  - ".sdd/specs/<feature>/tasks.md"
mustNotTouch:
  - ".sdd/specs/<feature>/requirements.md"
  - ".sdd/specs/<feature>/plan.md"
  - ".sdd/steering/constitution.md"
  - "src/**"
  - "test/**"
preconditions:
  - ".sdd/specs/<feature>/plan.md"
handoffs:
  - implement
  - tasks-to-issues
parallelSafe: false
moves:
  - traceability
  - evidence
commands:
  - "open-sdd status <feature> --json"
  - "open-sdd brownfield contracts <feature> --json"
  - "open-sdd delta validate <feature> --json"
  - "open-sdd brownfield templates --json"
scripts:
  - "open-sdd status <feature> --json"
  - "open-sdd brownfield contracts <feature> --json"
  - "open-sdd delta validate <feature> --json"
---

# Tasks — ordered work with a proof attached to each item

You are turning an approved plan into tasks that an agent (or a human) can execute one at a time and
**prove** done. Every task carries the requirement it serves, the files it may touch, and the real
command that decides whether it is finished. A task without a test command is a wish with a
checkbox.

## Input

```text
$ARGUMENTS
```

If no feature is named, read the state and ask which feature to decompose.

## Contract — the five guarantees for this template

- **Identified — produces:** `.sdd/specs/<feature>/tasks.md` — ordered tasks each carrying a requirement id, a real test command and an `_Evidence:_` line.
- **Identified — refuses:** it refuses to rewrite `requirements.md` or `plan.md`, refuses to edit source, and refuses to mark any task complete.
- **Automated — how:** this template never asks you to "consider" a check: the `commands:` frontmatter names the real `open-sdd …` invocations and the steps below RUN them and read their output.
- **Assured — backing check:** `open-sdd brownfield contracts <feature> --json` reports the coverage (exit 0, but the holes it names must be carried as `coverage: unknown`); `open-sdd delta validate <feature> --json` **exits 1** on a broken traceability mapping (BLOCKS hand-off to `implement`).
- **Measured — components:** `traceability`, `evidence` — the reader sees the change before/after in `open-sdd status --json` (score and phase).
- **Pivoted — the constitution is the pivot:** the constitution is the pivot: each task encodes the principles in force, a requirement with no design element is a reported gap rather than an invented task, and `open-sdd status --check --json` validates the spec against the principles.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_tasks`, run those
   steps first.
2. Entries with `enabled: false` are skipped and the skip is named.
3. If the YAML cannot be parsed, **stop and report it**. Never skip silently.
4. Confirm the plan exists and every requirement in scope has a design element. A requirement with no
   design element is a gap to report, not a task to invent.

## Scope guard

- **May write:** only `.sdd/specs/<feature>/tasks.md`.
- **Must not touch:** `requirements.md`, `plan.md`, the constitution, application source, tests.
- **Deferred intents:** improvements that are not required by the plan become deferred notes at the
  bottom of `tasks.md`. They do not become tasks in this feature.

## Steps

1. Read the feature state and confirm the task set targets the right phase:

```bash
open-sdd status <feature> --json
```

2. Ask which tests protect the files each task will change, so every task names its regression
   protection rather than assuming it:

```bash
open-sdd brownfield contracts <feature> --json
```

3. Read the repository's own task template so the document matches house shape:

```bash
open-sdd brownfield templates --json
```

4. Decompose by **observable outcome**, not by file. Each task must have:
   - a stable id (`T001`, `T002`, …) and a one-line outcome;
   - the requirement id(s) it serves (traceability, one direction and complete);
   - the exact paths it may touch;
   - the **real test command** that decides it, spelled out (`npm test` at the package root,
     `pytest -q tests/test_x.py`, …) — never "run the tests";
   - a `_Evidence:_` line to be filled with the command output reference when the task is done;
   - its dependencies (`Depends on: T00n`) so the order is executable;
   - whether it can run in parallel with its siblings and why.
5. Order the tasks so that each one leaves the repository in a state where the previous tests still
   pass. No task may depend on a later task to compile.
6. For a change to existing code, verify the delta's traceability now, before implementation:

```bash
open-sdd delta validate <feature> --json
```

7. Check the coverage of the task set against the plan: every plan element maps to at least one
   task, and every task maps to at least one requirement. List both directions of the mapping in the
   document and in the report.

## The constitution is the pivot

Tasks inherit the constitution's constraints. If a task cannot be done without violating a principle
in force, do not write the task — report the conflict and escalate to the constitution. A blocking
verdict downstream will cite the principle, so encode it here as a task constraint.

## Evidence

- The `_Evidence:_` line is filled with the command and its outcome, at completion. An empty evidence
  line means the task is not done, regardless of how the code looks.
- Every task's test command must be one that actually exists in this repository. If you cannot find
  one, the task's first sub-step is to add it — and that, too, is a task with evidence.
- The traceability mapping (requirement → task → test) is the evidence that nothing was forgotten.

## Honesty

- If the contracts check cannot run, say so and mark the affected tasks `coverage: unknown` instead of
  implying protection that was not inspected.
- Never invent a test command, a file path or a requirement id.
- Never mark a task complete here; this command only writes the plan of work.

## Mandatory Post-Execution Hooks

1. Re-run `open-sdd status <feature> --json` and confirm the traceability component moved.
2. Hand the ordered set to `implement`.

## Completion Report

- Path written, task count, and the requirement ↔ task ↔ test coverage both directions.
- Tasks whose coverage is unknown, and why.
- Deferred intents.
- Checks run, and checks that could not run.

## Done when

- Every task is independently testable, ordered, and carries a real test command plus `_Evidence:_`.
- The requirement → task → test mapping is complete and explicit.
- Uncovered requirements are reported, not hidden.
- No source file was touched.
