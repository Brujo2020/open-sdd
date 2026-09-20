---
id: gates
description: Resolve and run the declared rigor level's gate chain, with the enforcement levels and the honest ceiling-versus-floor distinction.
writes: []
mustNotTouch:
  - "**"
preconditions:
  - ".sdd/settings/rigor.json"
handoffs:
  - analyze
  - release
parallelSafe: true
moves:
  - gates
commands:
  - "open-sdd gates run"
  - "open-sdd gates chain --profile regulated"
  - "open-sdd gates crosswalk"
  - "open-sdd gates enforcement"
  - "open-sdd govern rigor --gates"
  - "open-sdd floor status"
  - "open-sdd status --check --json"
scripts:
  - "open-sdd gates run"
  - "open-sdd gates chain --profile regulated"
  - "open-sdd gates enforcement"
  - "open-sdd floor status"
---

# Gates — the repository's own verdict, not yours

This command runs the Zero-Trust gate chain for the declared rigor level and reports what it resolved,
what it measured and what it could not. It also states the part most tools hide: **a green chain is
not proof of quality** — it is proof that the declared controls executed — and the enforcement levels
have a **ceiling** (what could be enforced) above the **floor** (what actually is).

## Input

```text
$ARGUMENTS
```

The input may name a profile. If it does not, use the profile the repository declares and say which.

## Contract — the five guarantees for this template

- **Identified — produces:** report only — it writes nothing (its `writes` list is empty on purpose).
- **Identified — refuses:** it refuses to edit a spec or a source file to make a gate pass, and refuses to report a green chain it did not run.
- **Automated — how:** this template never asks you to "consider" a check: the `commands:` frontmatter names the real `open-sdd …` invocations and the steps below RUN them and read their output.
- **Assured — backing check:** `open-sdd gates run` **exits 1** when the chain fails (BLOCKS the merge or release); `open-sdd gates chain --profile regulated`, `open-sdd gates crosswalk`, `open-sdd gates enforcement` and `open-sdd floor status` report the resolved controls, the crosswalk, the levels and the installed floor.
- **Measured — components:** `gates` — the reader sees the change before/after in `open-sdd status --json` (score and phase).
- **Pivoted — the constitution is the pivot:** the constitution is the pivot: every blocking control cites a ratified principle, an unratified constitution makes the controls uncitable, and `open-sdd status --check --json` is the pivot check.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_gates`, run those
   steps first.
2. Entries with `enabled: false` are skipped and the skip is named.
3. If the YAML cannot be parsed, **stop and report it**. Never skip silently.

## Scope guard

- **May write:** nothing. The `writes` list is empty on purpose.
- **Must not touch:** every path. It runs the chain and reports; it never edits a spec or a source
  file to make a gate pass.
- **Deferred intents:** a control that cannot pass becomes a finding routed to `analyze` or the
  constitution, never a rule quietly relaxed here.

## Steps

1. Read the rigor ladder and which gates the declared level activates:

```bash
open-sdd govern rigor --gates
```

2. Run the enforcement chain. Its exit status is the verdict; **exit 1 BLOCKS**:

```bash
open-sdd gates run
```

3. If the repository declares a regulated profile, resolve and run the stricter chain:

```bash
open-sdd gates chain --profile regulated
```

4. Read the crosswalk so every implemented verification maps to the control that imposes it, and read
   the enforcement levels so ceiling and floor are not blurred:

```bash
open-sdd gates crosswalk
```

```bash
open-sdd gates enforcement
```

5. Confirm the enforcement floor is actually installed, not merely declared:

```bash
open-sdd floor status
```

6. Validate against the constitution and the rigor level, and record the exit code:

```bash
open-sdd status --check --json
```

7. Report: the resolved chain and profile; each control's verdict and evidence; the controls **not
   measured** and why; the ceiling-versus-floor statement; and the explicit sentence that a green
   chain proves execution, not quality.

## The constitution is the pivot

Every blocking control cites a principle of the ratified constitution. `open-sdd status --check
--json` is the pivot check; if the constitution is absent or a draft, the blocking controls have
nothing to cite and are reported as uncitable rather than green.

## Evidence

- The chain's exit status, the resolved profile and the per-control evidence are the evidence. Quote
  them.
- A control that did not run is listed under "not measured" and never counted as passing.
- The floor/ceiling statement is part of the evidence, not a disclaimer to omit.

## Honesty

- This command writes nothing; if a file changed, the wrong command ran.
- Never report a green chain you did not run, and never present the ceiling as the floor.
- Never claim a gate passed when its control was not measured; say "not measured" and name it.
- A green chain is not proof of quality; say exactly that in the report.

## Mandatory Post-Execution Hooks

1. Hand a failing chain to `analyze` with the failing control ids; hand a green chain to `release`
   with the exit code.
2. Leave the repository byte-identical.

## Completion Report

- Profile, resolved chain, and each control's verdict with evidence.
- Controls not measured, and why.
- The ceiling-versus-floor statement, and the `status --check` exit code.
- That nothing was written.

## Done when

- The chain ran and its exit status is reported verbatim.
- Not-measured controls are named; ceiling and floor are distinguished.
- The "green is not proof of quality" statement is present.
- No file anywhere was modified.
