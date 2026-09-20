---
id: status
description: Read the repository's real state — score, phase and the one next action — and route to the right command without writing anything.
writes: []
mustNotTouch:
  - "**"
preconditions:
  []
handoffs:
  - brownfield
  - specify
  - plan
  - tasks
  - implement
  - analyze
  - release
parallelSafe: true
moves: []
commands:
  - "open-sdd status --json"
  - "open-sdd status --check --json"
  - "open-sdd status <feature> --json"
  - "open-sdd context <feature> --json"
  - "open-sdd govern rigor --gates"
  - "open-sdd brownfield analyze <feature> --json"
  - "open-sdd brownfield requirements <feature> --suggest --json"
scripts:
  - "open-sdd status --json"
  - "open-sdd status --check --json"
  - "open-sdd context <feature> --json"
  - "open-sdd govern rigor --gates"
---

# Status — one door, one next action

This is the command to run when you do not know what to run. It reads the repository and answers with
the composite score, the phase, and the **one** action that moves the work forward. It is strictly
read-only, and it never guesses: what it cannot measure it reports as not measured.

## Input

```text
$ARGUMENTS
```

The input may name a feature. Without one, report the repository as a whole.

## Contract — the five guarantees for this template

- **Identified — produces:** report only — it writes nothing (its `writes` list is empty on purpose).
- **Identified — refuses:** it refuses to write anything at all, including the fix it just noticed; it routes instead.
- **Automated — how:** this template never asks you to "consider" a check: the `commands:` frontmatter names the real `open-sdd …` invocations and the steps below RUN them and read their output.
- **Assured — backing check:** it reports the component and gate state verbatim; `open-sdd status --check --json` **exits 1** when the constitution is absent or violated and that exit code is reported as the repository's verdict, never softened.
- **Measured — components:** none — this template is read-only and changes no SDD score component; `open-sdd status --json` is identical before and after by design.
- **Pivoted — the constitution is the pivot:** the constitution is the pivot: an absent or unratified constitution is reported as the next action before anything else, and `open-sdd status --check --json` is the pivot check.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_status`, run those
   steps first, and never let a hook turn this command into a writer.
2. Entries with `enabled: false` are skipped and the skip is named.
3. If the YAML cannot be parsed, **stop and report it**. Never skip silently.

## Scope guard

- **May write:** nothing. This command has an empty `writes` list on purpose.
- **Must not touch:** every path. Not the specs, not the source, not the configuration.
- **Deferred intents:** whatever the human says while reading the status ("also fix X") is recorded in
  the report as a deferred note and routed to the owning command. Status does not act.

## Steps

1. Read the repository score and the single recommended action:

```bash
open-sdd status --json
```

2. Read the same state validated against the constitution and the declared rigor level:

```bash
open-sdd status --check --json
```

3. When a feature is named, read that feature's phase and artifacts:

```bash
open-sdd status <feature> --json
```

4. Read the declared rigor ladder so the recommendation is explained by the level, not by taste:

```bash
open-sdd govern rigor --gates
```

5. Read the context pack the engine serves — the same one the MCP server exposes — when the next step
   needs the assembled context rather than the score:

```bash
open-sdd context <feature> --json
```

6. When the next action is a requirement fix, ask the EARS assistant what is not checkable:

```bash
open-sdd brownfield requirements <feature> --suggest --json
```

7. When the next action is consistency work, ask for the findings:

```bash
open-sdd brownfield analyze <feature> --json
```

8. Report, in this order: the score and its measured components, the components **not measured** and
   why, the phase, the ONE next action, and the reason that action is the right one. Then stop. The
   human decides whether to run it.

## The constitution is the pivot

The score's heaviest component is the constitution, and the recommendation is only authoritative when
the constitution is ratified. If it is absent or a draft, that is the next action, and the report says
so before anything else.

## Evidence

- Quote the component scores and the not-measured list; do not compute your own score.
- Every recommendation cites the component or gate that made it the priority.
- Distinguish the engine's measured state from your reading of it.

## Honesty

- Never report a component as passing when it is listed as not measured.
- Never invent a next action the engine did not recommend, and never hide a blocking gate.
- This command writes nothing; if you wrote something, you ran the wrong command.

## Mandatory Post-Execution Hooks

1. Route the one next action to its command and state it explicitly in the report.
2. Leave the repository byte-identical.

## Completion Report

- Score (measured components only), the not-measured list with reasons, and the phase.
- The one next action, its command, and why.
- Deferred notes and their owner commands.
- That nothing was written, or the exact failure if a read failed.

## Done when

- The score, phase and one next action are reported with their evidence.
- Unmeasured components are named rather than implied.
- No file anywhere was modified.
