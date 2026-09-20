---
id: contracts
description: Report the regression oracle — which tests protect the change, and which changed files no test covers.
writes:
  - ".sdd/specs/<feature>/contracts/"
mustNotTouch:
  - ".sdd/specs/<feature>/requirements.md"
  - ".sdd/specs/<feature>/plan.md"
  - ".sdd/steering/constitution.md"
  - "src/**"
  - "test/**"
preconditions:
  - ".sdd/specs/<feature>/delta.md"
handoffs:
  - tasks
  - analyze
parallelSafe: true
moves:
  - contracts
commands:
  - "open-sdd brownfield contracts <feature> --json"
  - "open-sdd brownfield contracts <feature> --write"
  - "open-sdd brownfield contracts <feature> --verify"
  - "open-sdd brownfield analyze <feature> --json"
  - "open-sdd delta validate <feature> --json"
  - "open-sdd status --check --json"
  - "open-sdd status --json"
scripts:
  - "open-sdd brownfield contracts <feature> --json"
  - "open-sdd brownfield contracts <feature> --verify"
  - "open-sdd delta validate <feature> --json"
---

# Contracts — the hole in the oracle is the finding

Before a change is made, this command answers the question a green test suite hides: **which tests
actually protect the files I am about to change, and which changed files no contract covers?** A
green run with a declared contract missing is not a pass, and this report says so instead of assuming
the suite protects everything.

## Input

```text
$ARGUMENTS
```

The input names the feature. If it does not, read the current state and ask.

## Contract — the five guarantees for this template

- **Identified — produces:** the regression-oracle report; with `--write` the oracle artifact under `.sdd/specs/<feature>/contracts/`.
- **Identified — refuses:** it refuses to edit source or tests: it reports which changed files no test covers instead of assuming the suite protects everything.
- **Automated — how:** this template never asks you to "consider" a check: the `commands:` frontmatter names the real engine invocations and the steps below RUN them and read their output.
- **Assured — backing check:** `open-sdd brownfield contracts <feature> --json` is the check — it **exits 0 while reporting the uncovered files**, and that report is the finding; `open-sdd brownfield contracts <feature> --verify` re-proves it after the change and `open-sdd delta validate <feature> --json` **exits 1** on a broken delta.
- **Measured — components:** `contracts` — the reader sees the change before/after in `open-sdd status --json` (score and phase).
- **Pivoted — the constitution is the pivot:** the constitution is the pivot: a contract that contradicts a ratified principle is reported invalid rather than counted as protection, and `open-sdd status --check --json` is the pivot check.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_contracts`, run
   those steps first.
2. Entries with `enabled: false` are skipped and the skip is named.
3. If the YAML cannot be parsed, **stop and report it**. Never skip silently.
4. Confirm the delta exists for a change to existing code; without it, say what the analysis is
   missing rather than presenting a partial oracle as complete.

## Scope guard

- **May write:** the contracts oracle artifact under `.sdd/specs/<feature>/contracts/` when `--write`
  is given.
- **Must not touch:** requirements, plan, the constitution, application source or tests. This command
  reports coverage; it does not write tests.
- **Deferred intents:** "this file should have a test" becomes a task for `tasks`, not an edit here.

## Steps

1. Read the oracle: covering tests per changed file, and the files with no coverage at all:

```bash
open-sdd brownfield contracts <feature> --json
```

2. Publish the oracle as an artifact so the release can cite it, and re-run it in verification mode
   after implementation to prove the same oracle still holds:

```bash
open-sdd brownfield contracts <feature> --write
```

```bash
open-sdd brownfield contracts <feature> --verify
```

3. Read the change analysis, which supplies the changed-file set the oracle is measured against:

```bash
open-sdd brownfield analyze <feature> --json
```

4. Validate the delta's declared targets, so a contract is bound to a real change element:

```bash
open-sdd delta validate <feature> --json
```

5. Validate the repository against the constitution and the rigor level, and record the exit code:

```bash
open-sdd status --check --json
```

6. Report, in this order: the covering tests per changed file; the **uncovered** changed files; the
   declared contracts with no test behind them; and the parts of the change the oracle cannot see.
   Route each hole to `tasks`.

## The constitution is the pivot

A contract is only valid if the behaviour it locks is a principle the constitution protects.
`open-sdd status --check --json` is the pivot check; a contract that contradicts a ratified principle
is reported as invalid rather than counted as protection.

## Evidence

- The oracle report is the evidence; quote its per-file results, including the empty ones.
- `--verify` after implementation is the evidence that coverage did not regress.
- A file with no covering test is named explicitly. It is never rounded into "mostly covered".

## Honesty

- If the oracle cannot be computed (no delta, no git history, no test runner detected), say so and
  report the coverage as `unknown` rather than as covered.
- Never invent a test name, a file path or a coverage percentage.
- Never present the suite's green colour as the oracle; only this report says what is protected.

## Mandatory Post-Execution Hooks

1. Hand every uncovered changed file to `tasks` as explicit coverage work.
2. Hand the verified oracle to `analyze` for the final verdict.

## Completion Report

- Feature, oracle path, covering tests per changed file.
- Uncovered changed files and declared contracts with no test, by name.
- The `status --check` and `delta validate` exit codes.
- Checks run, and checks that could not run.

## Done when

- The oracle is reported for every changed file, including the uncovered ones.
- The artifact is written when requested, and `--verify` is the post-change check.
- Holes are routed as tasks, not hidden.
- No source or test file was modified.
