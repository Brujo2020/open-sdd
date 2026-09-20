---
id: onboard
description: Day one in one flow — install the host templates, recon the repo, draft the constitution, and hand ratification to a human.
writes:
  - ".sdd/settings/"
  - ".sdd/steering/constitution.draft.md"
  - ".claude/commands/"
  - ".cursor/commands/"
  - ".github/prompts/"
  - ".gemini/commands/"
  - ".opencode/commands/"
mustNotTouch:
  - ".sdd/steering/constitution.md"
  - "src/**"
  - "test/**"
  - "package.json"
handoffs:
  - constitution
  - brownfield
  - specify
parallelSafe: false
moves:
  - constitution
  - gates
commands:
  - "open-sdd integrate --list"
  - "open-sdd init . --agent <agent> --write"
  - "open-sdd brownfield survey ."
  - "open-sdd brownfield bootstrap . --json"
  - "open-sdd brownfield constitution . --draft --write"
  - "open-sdd brownfield constitution . --interview --answers <path> --write"
  - "open-sdd govern constitution --ratify --by \"<name>\" --rationale \"<reason>\" --write"
  - "open-sdd status --json"
  - "open-sdd status --check --json"
  - "open-sdd doctor --json"
scripts:
  - "open-sdd integrate --list"
  - "open-sdd init . --agent <agent> --write"
  - "open-sdd brownfield survey ."
  - "open-sdd brownfield constitution . --draft --write"
  - "open-sdd status --json"
---

# Onboard — from nothing to a ratified constitution and a score

You are onboarding a repository onto open-sdd. The flow installs the host prompt templates (no MCP,
no network), reads what the code already is, produces a constitution **draft**, and then **hands
ratification to a human**. It ends with a real score and a named ratifier — not with a folder of
files.

## Input

```text
$ARGUMENTS
```

The input may name the target directory and the host agent. If the host is not obvious, detect it and
state the evidence before installing anything.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_onboard`, run
   those steps first.
2. Entries with `enabled: false` are skipped and the skip is named.
3. If the YAML cannot be parsed, **stop and report it**. Never skip silently.

## Scope guard

- **May write:** `.sdd/settings/`, the constitution **draft** `.sdd/steering/constitution.draft.md`,
  and the host's prompt-template directory. Never the in-force `constitution.md`.
- **Must not touch:** application source, tests, manifests, or `.sdd/steering/constitution.md` — only
  `--ratify` replaces the in-force document, and that is a human act.
- **Deferred intents:** anything the human mentions that is not installation becomes a deferred note
  and a hand-off to `specify`; this command does not start a feature.

## Steps

1. Read the integration matrix and install the host templates. The templates are the default path:
   files the host already reads, with no MCP registration and nothing a security policy can block:

```bash
open-sdd integrate --list
```

```bash
open-sdd init . --agent <agent> --write
```

2. Survey the repository so the draft is grounded in evidence, not in a blank page:

```bash
open-sdd brownfield survey .
```

3. Run the single entry point that chains recon, module map and suggested next steps; read it before
   writing anything:

```bash
open-sdd brownfield bootstrap . --json
```

4. Produce the constitution draft. It is explicitly **not in force**:

```bash
open-sdd brownfield constitution . --draft --write
```

5. If the draft has open questions, answer them in natural language and let the engine produce a
   validated draft (never answers the human must give):

```bash
open-sdd brownfield constitution . --interview --answers <path> --write
```

6. **Hand over.** Ask the human to ratify, and give them the exact command. Do not ratify for them:

```bash
open-sdd govern constitution --ratify --by "<name>" --rationale "<reason>" --write
```

7. Read the score and the phase, then validate against the constitution and the declared rigor:

```bash
open-sdd status --json
```

```bash
open-sdd status --check --json
```

8. Diagnose the installation so the human knows what is green and what still needs a fix:

```bash
open-sdd doctor --json
```

## The constitution is the pivot

The flow **stops at a draft**. An unratified draft has no authority, and every later blocking verdict
must cite a ratified principle, so onboarding is not complete until a named human runs the ratify
command. `open-sdd status --check --json` is the pivot check; until it passes, the repository is
onboarded but not governed.

## Evidence

- The survey and bootstrap outputs are evidence of what the repository is; quote them.
- The draft's evidence count and open questions are evidence of what still needs a human.
- The score and the `status --check` exit code are evidence of the state reached; report them
  verbatim, including a non-zero exit.

## Honesty

- Never report the constitution as ratified unless the human ran the ratify command and you saw it
  succeed. A draft is a draft.
- If the host convention is unverified, the templates are not installed; say so and name the host,
  instead of pretending the install completed.
- Never invent a principle, a ratifier, a rationale or a score.

## Mandatory Post-Execution Hooks

1. Name the ratifier and the exact ratify command in the completion report.
2. Hand the ratified repository to `specify` (or `brownfield` for a change).

## Completion Report

- Host detected, template directory written (or the reason it was refused).
- Draft path, evidence count, open questions, and who must ratify.
- Score and phase, and the `status --check` exit code.
- Checks run, and checks that could not run.

## Done when

- The host templates are installed (or explicitly refused with a reason) with no MCP registration.
- A constitution draft exists with evidence, and the human has been given the ratify command.
- The score, phase and diagnosis are reported with their exit codes.
- No application source and no in-force constitution were touched.
