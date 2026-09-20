---
id: plan
description: Turn approved requirements into a technical plan that names the real modules, contracts and tests, under the constitution.
writes:
  - ".sdd/specs/<feature>/plan.md"
  - ".sdd/specs/<feature>/design.md"
  - ".sdd/specs/<feature>/research.md"
mustNotTouch:
  - ".sdd/specs/<feature>/requirements.md"
  - ".sdd/steering/constitution.md"
  - "src/**"
  - "test/**"
preconditions:
  - ".sdd/specs/<feature>/requirements.md"
  - ".sdd/specs/<feature>/spec.json"
handoffs:
  - tasks
parallelSafe: false
moves:
  - gates
commands:
  - "open-sdd status <feature> --json"
  - "open-sdd brownfield analyze <feature> --json"
  - "open-sdd brownfield contracts <feature> --json"
  - "open-sdd brownfield reuse <feature>"
  - "open-sdd brownfield templates --json"
  - "open-sdd brownfield impact <feature>"
scripts:
  - "open-sdd status <feature> --json"
  - "open-sdd brownfield analyze <feature> --json"
  - "open-sdd brownfield contracts <feature> --json"
  - "open-sdd brownfield impact <feature>"
---

# Plan — design the change against the code that already exists

You are producing the technical plan for a feature whose requirements are approved. For an existing
codebase this is a **change plan**: it names what already exists, what must change, what must not,
and how the change will be proven. `plan.md` (alias `design.md`) is part of the documentary triad the
gate chain checks, so an empty or aspirational plan is a failing gate, not a style problem.

## Input

```text
$ARGUMENTS
```

If no feature is named, read the state and ask which one to plan.

## Contract — the five guarantees for this template

- **Identified — produces:** `.sdd/specs/<feature>/plan.md` (alias `design.md`) and `research.md`.
- **Identified — refuses:** it refuses to rewrite `requirements.md`, the constitution, source or tests; out-of-scope improvements become deferred notes.
- **Automated — how:** this template never asks you to "consider" a check: the `commands:` frontmatter names the real `open-sdd …` invocations and the steps below RUN them and read their output.
- **Assured — backing check:** `open-sdd brownfield analyze <feature> --json` and `open-sdd brownfield contracts <feature> --json` back every claim about existing code (contracts **exits 0** while reporting uncovered files — that report IS the check); `open-sdd delta validate <feature> --json` **exits 1** on an invalid delta (BLOCKS hand-off to `tasks`).
- **Measured — components:** `gates` — the reader sees the change before/after in `open-sdd status --json` (score and phase).
- **Pivoted — the constitution is the pivot:** the constitution is the pivot: the ratified constitution outranks design preference, and `open-sdd status --check --json` rejects a plan that violates a principle in force instead of softening it.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_plan`, run those
   steps first.
2. Entries with `enabled: false` are skipped and the skip is named.
3. If the YAML cannot be parsed, **stop and report it**. Never skip silently.
4. Confirm the requirements are approved and the open questions from `clarify` are closed or
   explicitly accepted as assumptions.

## Scope guard

- **May write:** the feature's `plan.md` / `design.md` and `research.md`.
- **Must not touch:** `requirements.md` (requirements are the contract; if they are wrong, say so and
  send the work back to `specify`), the constitution, application source, tests, manifests.
- **Deferred intents:** "we should also refactor X", "the dependency is old", "we could add
  telemetry" are not part of this plan. Record them as deferred notes in `plan.md` and leave them.

## Steps

1. Read the feature state and the requirement ids you are planning against:

```bash
open-sdd status <feature> --json
```

2. Ask the engine what the change touches and what it breaks:

```bash
open-sdd brownfield analyze <feature> --json
```

3. Ask which existing tests protect the files you are about to change — this is the regression
   oracle, and a change without a covering contract is a risk you must name:

```bash
open-sdd brownfield contracts <feature> --json
```

4. Search before you create. The reuse-first pass names existing symbols that already do part of the
   job, and the plan must either reuse them or say why it does not:

```bash
open-sdd brownfield reuse <feature>
```

5. Ask what the public surface change costs downstream consumers:

```bash
open-sdd brownfield impact <feature>
```

6. Read the house templates so the plan matches the repository's own shape instead of your habits:

```bash
open-sdd brownfield templates --json
```

7. Write `plan.md` with, at minimum:
   - the requirement ids this plan satisfies, one by one;
   - the modules, files and boundaries the change touches, grounded in the analysis output;
   - the contracts (tests, gates) that will prove each requirement;
   - the migration or compatibility path for any public surface change;
   - the risks the engine surfaced, quoted, not paraphrased into reassurance;
   - the deferred notes.
8. Where the design needs research, write `research.md` with the question, the options, the evidence
   found in this repository, and the decision.
9. Verify the plan does not contradict the constitution, and that every requirement has a design
   element. A requirement with no plan element is a gap, not an oversight to hide.

## The constitution is the pivot

The ratified constitution outranks your design preferences. If the cleanest design violates a
principle in force, the design changes, not the principle. An unratified draft has no authority, so
do not cite it as justification.

## Evidence

- Every claim about existing code cites an engine report or a path you actually read — never a
  remembered file.
- Distinguish what the engine measured (impact, contracts, reuse) from what you decided (structure,
  sequencing). Both belong in the plan; only the first is evidence.
- A "no coverage" result from the contracts check is a finding to report, not a detail to omit.

## Honesty

- If a check cannot run (no git history, no delta, no model backend), say so and say what remains
  unproven as a result.
- Never present a plan as validated if the requirements behind it are still open.
- Never invent file paths, symbol names or test names. If you did not see it, do not name it.

## Mandatory Post-Execution Hooks

1. Re-run `open-sdd status <feature> --json` and confirm the phase advanced.
2. Hand every uncovered requirement to `tasks` with an explicit note.

## Completion Report

- Paths written, requirement coverage (satisfied / uncovered by id).
- The engine findings that shaped the design, quoted.
- Deferred intents and open risks.
- Checks run, and checks that could not run.

## Done when

- `plan.md` (or `design.md`) maps every requirement to a concrete design element and a proof.
- Contract coverage and downstream impact are reported, including the uncovered parts.
- Reuse decisions are explicit.
- No source file and no requirement was modified.
