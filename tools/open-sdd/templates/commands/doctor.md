---
id: doctor
description: Diagnose the installation — Node, CLI, commit hook and its portability, rigor, constitution, specs and offline posture — with the fix for each failure.
writes: []
mustNotTouch:
  - "**"
preconditions:
  []
handoffs:
  - onboard
  - release
parallelSafe: true
moves: []
commands:
  - "open-sdd doctor --json"
  - "open-sdd status --json"
  - "open-sdd status --check --json"
  - "open-sdd floor status"
scripts:
  - "open-sdd doctor --json"
  - "open-sdd floor status"
---

# Doctor — one fix per problem, and no green claim it cannot back

When something is wrong, guessing wastes more time than measuring. This command runs the engine's
self-diagnosis and reports, per check, its state and the fix. It writes nothing: it names the command
that repairs each failure and hands it back to you.

## Input

```text
$ARGUMENTS
```

The input may name a directory to diagnose. Without one, diagnose the current repository.

## Contract — the five guarantees for this template

- **Identified — produces:** report only — it writes nothing (its `writes` list is empty on purpose).
- **Identified — refuses:** it refuses to apply any fix, even an obvious one, and refuses to report a check it could not run as a pass.
- **Automated — how:** this template never asks you to "consider" a check: the `commands:` frontmatter names the real engine invocations and the steps below RUN them and read their output.
- **Assured — backing check:** `open-sdd doctor --json` **exits 1** on any failed check (BLOCKS a "working install" claim) and each check carries its own state and fix; `open-sdd floor status` reports the enforcement floor's real state.
- **Measured — components:** none — this template is read-only and changes no SDD score component; `open-sdd status --json` is identical before and after by design.
- **Pivoted — the constitution is the pivot:** the constitution is the pivot: an absent or unratified constitution is a diagnostic finding with the constitution command as its fix, and `open-sdd status --check --json` is the pivot check it points to.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_doctor`, run those
   steps first.
2. Entries with `enabled: false` are skipped and the skip is named.
3. If the YAML cannot be parsed, **stop and report it**. Never skip silently.

## Scope guard

- **May write:** nothing. The `writes` list is empty on purpose.
- **Must not touch:** every path. Diagnosis observes; the human (or the named command) repairs.
- **Deferred intents:** every failure becomes a fix command in the report. This command never applies
  a fix itself, even an obvious one.

## Steps

1. Run the self-diagnosis and read every check with its state and fix:

```bash
open-sdd doctor --json
```

2. Read the installation floor's real state — installed, stale, foreign or absent:

```bash
open-sdd floor status
```

3. Read the repository state and phase, so a diagnosis is not confused with a repository problem:

```bash
open-sdd status --json
```

4. Validate against the constitution and the declared rigor level; a failing pivot check is the most
   common "it does not work" and must be reported as such:

```bash
open-sdd status --check --json
```

5. Report every check as **ok**, **warning** or **failure**, with the fix command next to each
   failure. Quote the engine's exit code: `doctor` exits 1 when any check fails, which BLOCKS a
   "working install" claim.

## The constitution is the pivot

An absent or unratified constitution is a diagnostic finding, not a silent default. `open-sdd status
--check --json` is the pivot check, and when it exits 1 the report names the constitution as the
cause and the constitution command as the fix.

## Evidence

- The per-check states, the fix commands and the exit codes are the evidence. Quote them.
- Distinguish an environment failure (Node, hook) from a repository failure (constitution, specs).
- A check that could not run is reported as "not inspected", never as ok.

## Honesty

- This command writes nothing; if a file changed, the wrong command ran.
- Never report a green install when a check failed or was skipped.
- Never invent a fix for a check the engine did not name.

## Mandatory Post-Execution Hooks

1. Hand the failing checks and their fix commands to the human; route a healthy install to `onboard`
   (first run) or `release` (later).
2. Leave the repository byte-identical.

## Completion Report

- Every check with its state and, when failing, its fix command.
- The engine's exit code, quoted.
- The `status --check` result and the floor state.
- That nothing was written.

## Done when

- Every diagnostic check is reported with its state and fix.
- The exit code is quoted and unmeasured checks are named.
- No file anywhere was modified.
