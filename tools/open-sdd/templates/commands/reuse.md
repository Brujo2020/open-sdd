---
id: reuse
description: Search the existing symbols before creating a new one, and report honestly when nothing can be reused.
writes: []
mustNotTouch:
  - "**"
handoffs:
  - plan
parallelSafe: true
moves: []
commands:
  - "open-sdd brownfield reuse <feature>"
  - "open-sdd brownfield reuse <feature> --symbols <A,B>"
  - "open-sdd brownfield impact <feature>"
  - "open-sdd status --check --json"
scripts:
  - "open-sdd brownfield reuse <feature>"
  - "open-sdd brownfield reuse <feature> --symbols <A,B>"
---

# Reuse — search before you create, and prove the search happened

"Reuse before you write" is a rule every tool preaches and almost none enforces with a check. This
command runs the check: it searches the repository for symbols that already do part of the job, so
`plan` either reuses them or states why it does not. It is read-only and it must be run **before** new
code exists.

## Input

```text
$ARGUMENTS
```

The input names the feature, or a list of symbols to search for. If neither is present, derive the
symbols from the delta and say which ones you derived.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_reuse`, run those
   steps first.
2. Entries with `enabled: false` are skipped and the skip is named.
3. If the YAML cannot be parsed, **stop and report it**. Never skip silently.

## Scope guard

- **May write:** nothing. The `writes` list is empty on purpose.
- **Must not touch:** every path. It reads and reports; it never creates a symbol or a file.
- **Deferred intents:** "this existing helper should be extended" is a finding for `plan`; this
  command does not edit the helper.

## Steps

1. Search for existing symbols that already implement part of the intended change:

```bash
open-sdd brownfield reuse <feature>
```

2. Search for a specific set of candidate symbols when the intent names them:

```bash
open-sdd brownfield reuse <feature> --symbols <A,B>
```

3. Read the blast radius of the change so reuse is judged against the same measured surface:

```bash
open-sdd brownfield impact <feature>
```

4. Validate against the constitution and the rigor level, and record the exit code:

```bash
open-sdd status --check --json
```

5. Report every candidate with its location and the part of the job it covers, and — this is the
   honest part — when the search returns nothing, report **"no reuse found"**, not "nothing to
   reuse". Route the decision to `plan`, which must either reuse a candidate or state why it does not.

## The constitution is the pivot

Reuse must not violate a principle in force: extending a symbol that sits behind a boundary the
constitution protects is reported as a conflict. `open-sdd status --check --json` is the pivot check.

## Evidence

- The reuse report is the evidence; quote the candidate symbols and their locations.
- A search with no results is still evidence, and it is reported as an empty result, not as a
  conclusion about the repository.
- Distinguish a candidate the engine found from a similarity you inferred.

## Honesty

- This command writes nothing; if a file changed, the wrong command ran.
- Never claim reuse you did not find, and never claim the repository has nothing to reuse because
  your search terms were poor — say the search was narrow.
- If the search cannot run (no delta, unreadable history), say so and report reuse as unmeasured.

## Mandatory Post-Execution Hooks

1. Hand the candidates to `plan` as reuse-first input.
2. Leave the repository byte-identical.

## Completion Report

- Candidates by symbol and location, with the job each covers.
- Whether the search was exhaustive or narrow, and the terms used.
- The `status --check` exit code.
- That nothing was written.

## Done when

- The reuse search ran before any new symbol was created, and its result is reported verbatim.
- An empty result is reported as "no reuse found", with the terms used.
- No file anywhere was modified.
