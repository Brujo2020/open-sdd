---
id: tour
description: The guided first run — recon, draft, check, status and delta — that hands over at the human decision and never ratifies for you.
writes:
  - ".sdd/steering/constitution.draft.md"
  - ".sdd/settings/"
mustNotTouch:
  - ".sdd/steering/constitution.md"
  - "src/**"
  - "test/**"
preconditions:
  []
handoffs:
  - constitution
  - specify
  - brownfield
parallelSafe: false
moves:
  - constitution
commands:
  - "open-sdd tour . --json"
  - "open-sdd tour . --write"
  - "open-sdd brownfield survey ."
  - "open-sdd brownfield constitution . --draft --write"
  - "open-sdd status --json"
  - "open-sdd status --check --json"
  - "open-sdd delta init <feature> \"<title>\""
  - "open-sdd delta validate <feature> --json"
  - "open-sdd govern constitution --ratify --by \"<name>\" --rationale \"<reason>\" --write"
scripts:
  - "open-sdd tour . --json"
  - "open-sdd tour . --write"
  - "open-sdd brownfield constitution . --draft --write"
  - "open-sdd status --check --json"
---

# Tour — the first run, guided, ending at the human's decision

A first run should teach the workflow, not dump a folder. This command walks the repository through
recon, the constitution draft, the pivot check, the status door and the delta — and it **hands over at
the human decision**: it never ratifies the constitution for you, and it says at each step what it is
about to write before it writes it.

## Input

```text
$ARGUMENTS
```

The input may name the target directory and, optionally, the first feature. Without a feature, the
tour ends at the constitution hand-over.

## Contract — the five guarantees for this template

- **Identified — produces:** the guided-run report; with `--write` it writes the constitution **draft** and `.sdd/settings/`.
- **Identified — refuses:** it refuses to ratify the constitution for the human and refuses to write application source; it hands over at the human decision.
- **Automated — how:** this template never asks you to "consider" a check: the `commands:` frontmatter names the real engine invocations and the steps below RUN them and read their output.
- **Assured — backing check:** `open-sdd tour . --json` reports every step; `open-sdd status --check --json` **exits 1** until the constitution is in force, which is the hand-over point, and the tour reports that exit code as the boundary between installed and governed.
- **Measured — components:** `constitution` — the reader sees the change before/after in `open-sdd status --json` (score and phase).
- **Pivoted — the constitution is the pivot:** the constitution is the pivot: the tour ends at a DRAFT plus the exact ratify command, an unratified draft has no authority, and `open-sdd status --check --json` is the pivot check.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_tour`, run those
   steps first.
2. Entries with `enabled: false` are skipped and the skip is named.
3. If the YAML cannot be parsed, **stop and report it**. Never skip silently.

## Scope guard

- **May write:** only the artifacts the guided steps declare — the constitution **draft**
  (`.sdd/steering/constitution.draft.md`) and `.sdd/settings/` — and only with `--write`.
- **Must not touch:** `.sdd/steering/constitution.md`, application source, tests. Ratification is a
  human act; the tour stops before it.
- **Deferred intents:** the first feature the human names becomes a hand-off to `specify` /
  `brownfield`, not a spec written inside the tour.

## Steps

1. Read the tour plan — each step and what it would write — without writing anything:

```bash
open-sdd tour . --json
```

2. Execute the guided run. Every writing step declares itself first; a step that cannot run is
   reported, not skipped:

```bash
open-sdd tour . --write
```

3. Reconnaissance is the tour's first evidence; read it directly if the tour reports it as missing:

```bash
open-sdd brownfield survey .
```

4. Produce the constitution draft the tour ends on, explicitly not in force:

```bash
open-sdd brownfield constitution . --draft --write
```

5. Read the score and the phase the tour reached:

```bash
open-sdd status --json
```

6. Run the pivot check. Its exit code is the tour's verdict; **exit 1 BLOCKS** the hand-off until the
   constitution is in force:

```bash
open-sdd status --check --json
```

7. If the human names a first feature, declare its change contract and validate it; otherwise stop at
   the hand-over:

```bash
open-sdd delta init <feature> "<title>"
```

```bash
open-sdd delta validate <feature> --json
```

8. Give the human the ratify command and stop. Do not run it for them:

```bash
open-sdd govern constitution --ratify --by "<name>" --rationale "<reason>" --write
```

## The constitution is the pivot

The tour is built to end at a **draft** plus a ratify command, because an unratified draft has no
authority and every downstream blocking verdict must cite a ratified principle. `open-sdd status
--check --json` is the pivot check; the tour reports its exit code as the boundary between "installed"
and "governed".

## Evidence

- The tour's per-step report, the score, and the `status --check` exit code are the evidence.
- The draft's evidence count and open questions are evidence of what remains for the human.
- A step that did not run is named as not run.

## Honesty

- Never ratify the constitution, and never present the draft as in force.
- Never report a step as completed when the tour reported it as skipped or failed.
- If `--write` was not given, say plainly that nothing was written.
- Never invent a feature, a score or a ratification.

## Mandatory Post-Execution Hooks

1. Name the ratifier and the exact ratify command in the report.
2. Hand the ratified repository to `specify` (new work) or `brownfield` (a change to existing code).

## Completion Report

- Steps run and steps not run, each with its reason.
- Draft path, evidence count and open questions; who must ratify.
- Score, phase and the `status --check` exit code.
- Checks run, and checks that could not run.

## Done when

- The tour ran (or reported that it wrote nothing without `--write`) and its steps are all accounted
  for.
- The constitution is a draft with a named ratifier and the exact ratify command.
- The pivot check's exit code is reported verbatim.
- No application source and no in-force constitution were touched.
