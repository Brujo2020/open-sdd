---
id: impact
description: Measure the blast radius and forecast of a change before anything is written — dependents, breaking changes and migrations without rollback.
writes: []
mustNotTouch:
  - "**"
preconditions:
  - ".sdd/specs/<feature>/delta.md"
handoffs:
  - plan
  - contracts
parallelSafe: true
moves: []
commands:
  - "open-sdd brownfield impact <feature>"
  - "open-sdd brownfield forecast \"<description>\" --json"
  - "open-sdd brownfield analyze <feature> --json"
  - "open-sdd delta validate <feature> --json"
  - "open-sdd status --check --json"
  - "open-sdd status --json"
scripts:
  - "open-sdd brownfield impact <feature>"
  - "open-sdd brownfield forecast \"<description>\" --json"
  - "open-sdd brownfield analyze <feature> --json"
---

# Impact — the cost of the change, before the change

Most tooling will happily start editing. This command measures first: which dependents a change
reaches, which public surfaces break, which migrations have no rollback, and — for a change that is
only described in words — what the engine forecasts it would touch. It is read-only, and it exists so
`plan` is written against a measured blast radius instead of an optimistic one.

## Input

```text
$ARGUMENTS
```

The input names the feature, or describes the change in natural language. If neither is present, ask
for the description rather than guessing at a change nobody stated.

## Contract — the five guarantees for this template

- **Identified — produces:** report only — it writes nothing (its `writes` list is empty on purpose).
- **Identified — refuses:** it refuses to edit code or specs, and refuses to forecast a change nobody described: it asks for the description instead.
- **Automated — how:** this template never asks you to "consider" a check: the `commands:` frontmatter names the real engine invocations and the steps below RUN them and read their output.
- **Assured — backing check:** `open-sdd brownfield impact <feature>` and `open-sdd brownfield forecast "<description>" --json` are the checks; `open-sdd brownfield analyze <feature> --json` **exits 1** when the feature cannot be analysed (BLOCKS a confident impact claim) and `open-sdd delta validate <feature> --json` **exits 1** on a broken delta.
- **Measured — components:** none — this template is read-only and changes no SDD score component; `open-sdd status --json` is identical before and after by design.
- **Pivoted — the constitution is the pivot:** the constitution is the pivot: an impact that breaks a principle in force is reported as a constitutional conflict, and `open-sdd status --check --json` is the pivot check.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_impact`, run those
   steps first.
2. Entries with `enabled: false` are skipped and the skip is named.
3. If the YAML cannot be parsed, **stop and report it**. Never skip silently.

## Scope guard

- **May write:** nothing. The `writes` list is empty on purpose.
- **Must not touch:** every path. It reads the repository and prints or returns JSON.
- **Deferred intents:** a migration or refactor the impact report surfaces is a finding handed to
  `plan`; this command does not schedule it and does not start it.

## Steps

1. Measure the blast radius of the declared change: dependents, breaking changes, migrations and the
   public API surface:

```bash
open-sdd brownfield impact <feature>
```

2. For a change that is only described, forecast what it would touch, with the symbols it recognised:

```bash
open-sdd brownfield forecast "<description>" --json
```

3. Read the consistency findings that constrain the change:

```bash
open-sdd brownfield analyze <feature> --json
```

4. Validate the delta's declared targets so the impact is measured against a real change contract:

```bash
open-sdd delta validate <feature> --json
```

5. Validate against the constitution and the rigor level, and record the exit code:

```bash
open-sdd status --check --json
```

6. Report: the dependents and public surfaces at risk; the breaking changes with their consumers; the
   migrations with no rollback path; and the forecast's recognised vs unrecognised terms. Where the
   forecast recognised nothing, say the description was not specific enough and ask for it — do not
   present an empty forecast as "no impact".

## The constitution is the pivot

An impact that would break a principle in force (a boundary, a compatibility promise) is reported as
a constitutional conflict, not merely a risk. `open-sdd status --check --json` is the pivot check; an
unratified draft cannot settle whether a break is acceptable.

## Evidence

- The impact and forecast reports are the evidence; quote the dependents and breaking changes by
  name.
- The delta validation exit code is evidence that the change contract is real.
- Distinguish measured impact from your inference about consequences.

## Honesty

- This command writes nothing; if a file changed, the wrong command ran.
- If the impact cannot be computed (no delta, no base ref, unreadable history), say so and do not
  imply safety.
- Never invent a dependent, a consumer or a migration; an empty result is reported as "not measured"
  or "nothing found", whichever the engine says.

## Mandatory Post-Execution Hooks

1. Hand the blast radius to `plan` and the uncovered surfaces to `contracts`.
2. Leave the repository byte-identical.

## Completion Report

- Dependents, breaking changes, migrations and public surfaces, by name.
- Forecast terms recognised vs unrecognised, and whether the description was specific enough.
- The `status --check` and `delta validate` exit codes.
- That nothing was written.

## Done when

- The blast radius and forecast are reported with the engine's own output quoted.
- Unrecognised forecast terms are named and the human is asked for a better description.
- No file anywhere was modified.
