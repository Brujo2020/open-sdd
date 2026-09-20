---
id: checklist
description: Derive a project-specific readiness checklist from the constitution and the declared rigor level, naming the command that runs each checkable item.
writes:
  - ".sdd/specs/<feature>/checklist.md"
mustNotTouch:
  - ".sdd/steering/constitution.md"
  - ".sdd/settings/rigor.json"
  - ".sdd/specs/<feature>/requirements.md"
  - ".sdd/specs/<feature>/plan.md"
  - "src/**"
  - "test/**"
preconditions:
  - ".sdd/steering/constitution.md"
  - ".sdd/settings/rigor.json"
handoffs:
  - implement
parallelSafe: true
moves:
  - gates
commands:
  - "open-sdd status --json"
  - "open-sdd status --check --json"
  - "open-sdd govern rigor --gates"
  - "open-sdd govern conformance"
  - "open-sdd gates run"
  - "open-sdd assure threats"
scripts:
  - "open-sdd govern rigor --gates"
  - "open-sdd status --check --json"
  - "open-sdd gates run"
---

# Checklist — generated from the constitution and the rigor level, not from taste

A checklist is only useful if it is specific to *this* repository and if every checkable item names
the command that actually runs it. This command **derives** the checklist from two machine-readable
sources — the ratified constitution and the declared rigor level — and refuses to pad it with
generic advice.

## Input

```text
$ARGUMENTS
```

If no feature is named, produce the repository-level checklist. If a feature is named, scope the
items to it.

## Contract — the five guarantees for this template

- **Identified — produces:** `.sdd/specs/<feature>/checklist.md` (or repository-scope `.sdd/checklist.md`).
- **Identified — refuses:** it refuses to tick an item without running that item's command, and refuses to invent a threshold, a policy or a check.
- **Automated — how:** this template never asks you to "consider" a check: the `commands:` frontmatter names the real `open-sdd …` invocations and the steps below RUN them and read their output.
- **Assured — backing check:** every runnable item names the command that decides it; `open-sdd govern rigor --gates` and `open-sdd govern conformance` (exit 0) back the derived items and `open-sdd gates run` **exits 1** on failure (BLOCKS readiness); an item no command can decide is labelled human-judgement.
- **Measured — components:** `gates` — the reader sees the change before/after in `open-sdd status --json` (score and phase).
- **Pivoted — the constitution is the pivot:** the constitution is the pivot: the checklist is derived from the ratified constitution's principles in force, a draft constitution makes the items advisory, and `open-sdd status --check --json` is the pivot check.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_checklist`, run
   those steps first.
2. Entries with `enabled: false` are skipped and the skip is named.
3. If the YAML cannot be parsed, **stop and report it**. Never skip silently.

## Scope guard

- **May write:** only the checklist artifact (`.sdd/specs/<feature>/checklist.md`, or
  `.sdd/checklist.md` at repository scope).
- **Must not touch:** the constitution, the rigor declaration, requirements, plan, source or tests.
  This command measures; it does not remediate.
- **Deferred intents:** an item that *should* be checkable but has no command yet is recorded as a
  **gap item** with the command that would be needed. It is not a checkbox.

## Steps

1. Read the repository state:

```bash
open-sdd status --json
```

2. Read the rigor ladder and the gates the declared level activates. Each activated gate becomes a
   checklist item with its control id:

```bash
open-sdd govern rigor --gates
```

3. Read the constitution and turn every principle **in force** into one of:
   - a **checkable item** naming the exact command that verifies it, or
   - a **not-yet-checkable item** stating plainly that no command verifies it yet, so a human must.
   A principle with no check is not a pass; it is an acknowledged gap.
4. Validate the repository against the constitution and the level:

```bash
open-sdd status --check --json
```

5. Pull the invariant-level checks the engine exposes, and attach each to the item it verifies:

```bash
open-sdd govern conformance
```

6. Pull the security posture for the items that belong to it:

```bash
open-sdd assure threats
```

7. Add the enforcement item — the repository's own verdict is part of readiness:

```bash
open-sdd gates run
```

8. Write the checklist grouped by source (constitution / rigor level / invariants / security), one
   item per line, with: `[ ]` or `[x]`, the item, the command that decides it or `NO COMMAND — human
   judgement`, and the evidence expected. Do not add an item whose only justification is habit.

## The constitution is the pivot

The constitution is the primary source of the checklist: its principles in force define what
"ready" means here. An unratified draft cannot generate binding items; if the constitution is a
draft, say so and mark the derived items advisory.

## Evidence

- Every checkable item names a real command. An item with no command is explicitly labelled as
  requiring human judgement — that is honest, not a gap to paper over.
- Distinguish items derived from the constitution, from the rigor level, and from the engine's
  invariant/security reports.
- Never mark an item `[x]` on the strength of your own reading; only a run command ticks a box.

## Honesty

- Never invent a check, a threshold or a policy the sources do not contain.
- If a source cannot be read (no constitution, no rigor declaration, no model backend for an
  alignment invariant), list the items it would have produced as **not derived**, with the reason.
- A checklist that claims coverage it cannot run is worse than a short honest one.

## Mandatory Post-Execution Hooks

1. Hand unticked items to `implement` as work, not as advice.
2. Re-derive the checklist after implementation; do not reuse a stale one.

## Completion Report

- Item count by source, and how many are runnable vs human-judgement.
- The commands each runnable item names.
- Sources that could not be read, and the items they would have produced.
- Checks run, and checks that could not run.

## Done when

- Every checklist item traces to the constitution, the rigor level, or an engine report.
- Every runnable item names a real command; every non-runnable item says so.
- No item is ticked without a command having been run.
- Nothing outside the checklist artifact was written.
