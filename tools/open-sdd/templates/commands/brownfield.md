---
id: brownfield
description: Run the whole brownfield entry path — recon, constitution draft, ratification, delta, and the check — on an existing codebase.
writes:
  - ".sdd/steering/constitution.draft.md"
  - ".sdd/specs/"
  - ".sdd/settings/"
mustNotTouch:
  - "src/**"
  - "test/**"
  - "**/*.ts"
  - "**/*.js"
  - "**/*.py"
  - "**/*.go"
  - "package.json"
  - "Dockerfile"
preconditions:
  []
handoffs:
  - constitution
  - specify
  - plan
parallelSafe: false
moves:
  - constitution
  - contracts
commands:
  - "open-sdd brownfield survey ."
  - "open-sdd brownfield bootstrap . --json"
  - "open-sdd brownfield constitution . --draft --write"
  - "open-sdd brownfield constitution . --interview --answers <path> --write"
  - "open-sdd govern constitution --ratify --by \"<name>\" --rationale \"<reason>\" --write"
  - "open-sdd brownfield impact <feature>"
  - "open-sdd brownfield contracts <feature> --json"
  - "open-sdd brownfield reuse <feature>"
  - "open-sdd delta init <feature> \"<title>\""
  - "open-sdd delta validate <feature> --json"
  - "open-sdd status --json"
  - "open-sdd status --check --json"
scripts:
  - "open-sdd brownfield survey ."
  - "open-sdd brownfield bootstrap . --json"
  - "open-sdd brownfield constitution . --draft --write"
  - "open-sdd delta validate <feature> --json"
  - "open-sdd status --check --json"
---

# Brownfield — the existing code is the source of truth

Use this on a repository that already has code and may not yet have specs. The order matters: the
code is described before it is judged, and it is judged before it is changed.

1. **Recon** — what the project already is (stack, tooling, modules, evidence).
2. **Constitution (descriptive)** — the principles the code already obeys, each with evidence; the
   practices the team wants but the code lacks become proposed amendments.
3. **Ratify** — a human accepts the constitution. Until then it is a draft with no authority.
4. **Delta** — the contract of change for the feature, in ADDED / MODIFIED / REMOVED / RENAMED terms.
5. **Check** — validate the repository against the constitution and the declared rigor level.

## Input

```text
$ARGUMENTS
```

The input may name the target directory and the feature. If the feature for the delta is missing, ask;
do not invent a slug.

## Contract — the five guarantees for this template

- **Identified — produces:** the constitution **draft** `.sdd/steering/constitution.draft.md`, the feature's `.sdd/specs/<feature>/` artifacts and `.sdd/settings/`.
- **Identified — refuses:** it refuses to create, modify or delete application source or tests — recon is read-only — and refuses to act on implementation intent, which becomes a deferred note.
- **Automated — how:** this template never asks you to "consider" a check: the `commands:` frontmatter names the real `open-sdd …` invocations and the steps below RUN them and read their output.
- **Assured — backing check:** `open-sdd delta validate <feature> --json` **exits 1** on an invalid delta (BLOCKS the change contract) and `open-sdd status --check --json` **exits 1** when the constitution is absent or violated; `open-sdd brownfield contracts <feature> --json` reports uncovered files as holes, not passes.
- **Measured — components:** `constitution`, `contracts` — the reader sees the change before/after in `open-sdd status --json` (score and phase).
- **Pivoted — the constitution is the pivot:** the constitution is the pivot: the descriptive constitution must be ratified by a named human to have authority, the report never presents a draft as ratified, and `open-sdd status --check --json` is the pivot check.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_brownfield`, run
   those steps first.
2. Entries with `enabled: false` are skipped and the skip is named.
3. If the YAML cannot be parsed, **stop and report it**. Never skip silently.

## Scope guard

- **May write:** `.sdd/steering/constitution.md`, the constitution's proposal material, the feature's
  `.sdd/specs/<feature>/` artifacts, and `.sdd/settings/`. The engine's own bootstrap writes only when
  given `--write`.
- **Must not touch:** application source, tests, build manifests, the Dockerfile. Reconnaissance is
  read-only. If a change is needed in code, it becomes a delta and a task, not an edit here.
- **Deferred intents:** any implementation, refactor, migration or deploy intent found in the input or
  the code is recorded as a deferred note in the feature's spec. This command never acts on it.

## Steps

1. Survey the repository and read the evidence it gathers:

```bash
open-sdd brownfield survey .
```

2. Run the single entry point that chains recon, constitution draft, module map and suggested steps.
   Read it before writing anything:

```bash
open-sdd brownfield bootstrap . --json
```

3. Produce the descriptive constitution as a draft — it is written to
   `.sdd/steering/constitution.draft.md` and is explicitly **not in force**:

```bash
open-sdd brownfield constitution . --draft --write
```

4. Ask the human **only** the decisions the repository cannot answer (scope of the first change, which
   proposed amendments to accept, what is explicitly out of scope). If the draft leaves open
   questions, use the interview cycle to apply the answers and re-validate:

```bash
open-sdd brownfield constitution . --interview --answers <path> --write
```

   Then **hand over**: give the human the ratify command and do not run it for them. Only a named
   person with a rationale promotes the draft, and an unratified draft has no authority:

```bash
open-sdd govern constitution --ratify --by "<name>" --rationale "<reason>" --write
```

5. For the feature, declare the contract of change:

```bash
open-sdd delta init <feature> "<title>"
```

6. Measure the blast radius before touching anything, and find what already exists so the change
   reuses it:

```bash
open-sdd brownfield impact <feature>
```

```bash
open-sdd brownfield reuse <feature>
```

7. Identify the regression oracle: which tests protect the files the change touches, and which files
   no contract covers:

```bash
open-sdd brownfield contracts <feature> --json
```

8. Validate the delta's ids, EARS form, targets and traceability:

```bash
open-sdd delta validate <feature> --json
```

9. Validate the repository against the constitution and the level, and finish with the state:

```bash
open-sdd status --check --json
```

```bash
open-sdd status --json
```

## The constitution is the pivot

The descriptive constitution is the authority for every later blocking verdict, and it must be
ratified to have any. Reconnaissance describes; the human ratifies; the delta obeys. If a change the
team wants contradicts a principle in force, the report says so and routes the amendment through the
constitution command instead of quietly bending the rule.

## Evidence

- Each principle cites the code path, command or test that demonstrates it. A desire with no
  demonstration is a proposed amendment, clearly separated.
- The impact, contracts and reuse outputs are evidence; your summary of them is interpretation, and
  the report labels which is which.
- A file with no covering contract is a named risk, not a footnote.

## Honesty

- If reconnaissance cannot run (no readable manifests, no git history), say so and describe only what
  you actually read.
- Never invent a principle, an owner, a metric or a module name.
- Never present the descriptive constitution as ratified. Ratification is a human act outside this
  command, and the report names who still has to perform it.

## Mandatory Post-Execution Hooks

1. Hand the ratified constitution to `specify` / `plan`.
2. Hand uncovered changed files to `tasks` as explicit coverage work.

## Completion Report

- What the survey found, with the evidence count.
- Constitution status (DRAFT / RATIFIED) and who must ratify.
- The delta, its validation result, and the blast radius.
- Uncovered files and deferred intents.
- Checks run, and checks that could not run.

## Done when

- Recon, constitution draft and delta exist, and the delta validates.
- The constitution is either ratified by a named human or explicitly still a draft.
- No application source was created, modified or deleted by this command.
