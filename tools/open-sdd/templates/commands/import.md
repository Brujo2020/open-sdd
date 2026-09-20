---
id: import
description: Adopt specs from Kiro, spec-kit or cc-sdd as mapped seeds, reporting every file skipped and overwriting nothing.
writes:
  - ".sdd/specs/"
  - ".sdd/steering/"
mustNotTouch:
  - ".sdd/steering/constitution.md"
  - "src/**"
  - "test/**"
preconditions:
  []
handoffs:
  - brownfield
  - specify
parallelSafe: false
moves:
  - traceability
commands:
  - "open-sdd import --json"
  - "open-sdd import kiro --json"
  - "open-sdd import spec-kit --json"
  - "open-sdd import cc-sdd --json"
  - "open-sdd import kiro --write"
  - "open-sdd status --json"
  - "open-sdd status --check --json"
scripts:
  - "open-sdd import --json"
  - "open-sdd import kiro --json"
  - "open-sdd import kiro --write"
  - "open-sdd status --check --json"
---

# Import — absorb the incumbent, keep what maps, name what does not

You are migrating specifications from Kiro, spec-kit or cc-sdd into `.sdd/`. The mapping is a
**mapping, never a promise**: what converts cleanly is copied or converted, what cannot be represented
is **skipped and listed**, and nothing already in `.sdd/` is overwritten. Imported specs are seeds,
not authority — they must be reconciled with the constitution before they bind.

## Input

```text
$ARGUMENTS
```

The input may name the source (`kiro`, `spec-kit`, `cc-sdd`). Without one, detect what is present and
report it.

## Contract — the five guarantees for this template

- **Identified — produces:** the mapped `.sdd/specs/` and `.sdd/steering/` artifacts produced by `open-sdd import`, plus its per-file plan; nothing existing is overwritten.
- **Identified — refuses:** it refuses to overwrite an existing artifact and refuses to claim a 1:1 conversion: what cannot be mapped is skipped and listed.
- **Automated — how:** this template never asks you to "consider" a check: the `commands:` frontmatter names the real engine invocations and the steps below RUN them and read their output.
- **Assured — backing check:** `open-sdd import --json` reports per-file `copy`/`convert`/`skip` (exit 0) — the skips ARE the check and must be reported; `open-sdd status --check --json` **exits 1** until the imported seeds are reconciled with the constitution.
- **Measured — components:** `traceability` — the reader sees the change before/after in `open-sdd status --json` (score and phase).
- **Pivoted — the constitution is the pivot:** the constitution is the pivot: imported requirements inherit no authority from their old tool, they are candidates until reconciled, and `open-sdd status --check --json` is the pivot check.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_import`, run those
   steps first.
2. Entries with `enabled: false` are skipped and the skip is named.
3. If the YAML cannot be parsed, **stop and report it**. Never skip silently.
4. Import is a write. Without `--write` it must remain a dry-run plan; never write during the plan.

## Scope guard

- **May write:** mapped artifacts under `.sdd/specs/` and `.sdd/steering/`, and only with `--write`.
- **Must not touch:** `.sdd/steering/constitution.md`, application source, tests. An imported file
  never overwrites an existing `.sdd/` artifact; collisions are reported as skips.
- **Deferred intents:** a source spec whose intent is implementation work becomes a deferred note and
  a hand-off to `specify`; import does not start the work.

## Steps

1. Read the plan: every source found, every conversion, and every skip with its reason:

```bash
open-sdd import --json
```

2. Narrow to one incumbent when more than one is present, so the mapping is unambiguous:

```bash
open-sdd import kiro --json
```

```bash
open-sdd import spec-kit --json
```

```bash
open-sdd import cc-sdd --json
```

3. Apply the mapping. Read the outcome: `copy`, `convert` and `skip` per file, with nothing
   overwritten:

```bash
open-sdd import kiro --write
```

4. Read the repository state to see what the import produced:

```bash
open-sdd status --json
```

5. Validate against the constitution and the declared rigor level, because an imported spec is not
   yet governed:

```bash
open-sdd status --check --json
```

6. Report: what was found, what was copied, what was converted, and **every skip with its reason**.
   An import with skips is not a failure — an import that hides its skips is.

## The constitution is the pivot

Imported requirements do not inherit authority from their old tool. `open-sdd status --check --json`
is the pivot check; until the imported seeds are reconciled with the ratified constitution, they are
candidates, and the report says so.

## Evidence

- The import plan and outcome are the evidence; quote the per-file actions.
- The `status --check` exit code is evidence of whether the import is governed.
- Distinguish a converted file from one the engine merely copied.

## Honesty

- Never claim a 1:1 conversion; the reference tools' formats do not map completely, and the skips are
  the proof.
- Never overwrite an existing artifact, and never report a skip as a success.
- If a source is unreadable or absent, say so instead of reporting an empty import as clean.

## Mandatory Post-Execution Hooks

1. Hand the imported seeds to `brownfield` / `specify` for reconciliation.
2. List every skipped file in the completion report with its reason.

## Completion Report

- Sources found; per-file `copy` / `convert` / `skip` with reasons.
- What the import did **not** represent.
- The `status --check` exit code.
- Checks run, and checks that could not run.

## Done when

- The plan was read before writing, and `--write` only wrote mapped artifacts.
- Every skip is reported with its reason; nothing was overwritten.
- Imported seeds are handed off for constitutional reconciliation.
- No source or test file was modified.
