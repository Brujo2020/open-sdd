---
id: constitution
description: Establish, amend or ratify the project constitution that every other open-sdd command cites as authority.
writes:
  - ".sdd/steering/constitution.draft.md"
  - ".sdd/settings/constitution/"
  - ".sdd/settings/extensions.yml"
mustNotTouch:
  - "src/**"
  - "test/**"
  - "**/*.ts"
  - "**/*.js"
  - "**/*.py"
  - "**/*.go"
  - "**/*.rs"
  - "**/*.java"
  - "package.json"
  - "Dockerfile"
preconditions:
  - ".sdd/settings/rigor.json"
handoffs:
  - clarify
  - specify
parallelSafe: false
moves:
  - constitution
commands:
  - "open-sdd brownfield survey ."
  - "open-sdd brownfield constitution . --draft --write"
  - "open-sdd brownfield constitution . --interview --answers <path> --write"
  - "open-sdd govern constitution --ratify --by \"<name>\" --rationale \"<reason>\" --write"
  - "open-sdd status --json"
  - "open-sdd status --check --json"
scripts:
  - "open-sdd brownfield survey ."
  - "open-sdd brownfield constitution . --draft --write"
  - "open-sdd govern constitution --ratify --by \"<name>\" --rationale \"<reason>\" --write"
---

# Constitution — the project's ratified authority

You are establishing the constitution of this repository: the short list of principles the code
**already obeys** (each with the evidence that proves it) plus the amendments the team wants but the
code does not yet show. The constitution is the document every other command in this repository cites when it
blocks something, so a principle without evidence is not a principle — it is a wish.

## Input

```text
$ARGUMENTS
```

If the input is empty, ask the human for the one thing only a human can decide: which principles the
team wants the code to obey. Do not invent principles from enthusiasm.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_constitution`,
   run those steps before anything else.
2. An extension entry with `enabled: false` is skipped, and the skip is named in the report.
3. If the YAML cannot be parsed, **stop and report it**. Never skip an extension silently: a hook that
   did not run is not a hook that passed.
4. The reconnaissance the engine already gathered is the evidence base. Start from it, never from a
   blank page:

```bash
open-sdd brownfield survey .
```

## Scope guard

- **May write:** `.sdd/steering/constitution.md`, proposal material under
  `.sdd/settings/constitution/`, and the extension file `.sdd/settings/extensions.yml` **only** when
  the human explicitly asks to register a hook.
- **Must not touch:** application source or tests under any language, build manifests, or the
  Dockerfile. This command never creates, modifies or deletes application code.
- **Deferred intents:** if the input contains implementation, refactor, deploy or migration intent
  ("rename the service", "upgrade the runtime", "ship it"), do **not** execute it. Record it as a
  deferred note under `.sdd/settings/constitution/deferred.md` with the exact wording the human used,
  and carry it into the completion report. It becomes a spec or a delta through `specify`, not here.

## Steps

1. Run the reconnaissance the engine already implements and read its evidence:

```bash
open-sdd brownfield survey .
```

2. Produce a draft constitution derived from the code, with one evidence line per principle:

```bash
open-sdd brownfield constitution . --draft
```

3. Separate the result into three lists and keep them separate in the document:
   - **Principles in force** — the code obeys them today; each carries the file/command that proves it.
   - **Proposed amendments** — desired but absent; explicitly marked as proposals, not rules.
   - **Open questions** — the decisions no instrument can answer. Ask the human; do not answer for them.
4. Ask **only** the questions a human must decide. For each, offer the evidence and the consequence of
   each option. Never fabricate a decision to keep moving.
5. Write the draft. The engine writes it to `.sdd/steering/constitution.draft.md` and **never** to
   `constitution.md`; if an in-force document already exists it is left untouched:

```bash
open-sdd brownfield constitution . --draft --write
```

   When the draft leaves questions a human must answer, use the interview cycle instead — it applies
   the answers and re-validates the produced text:

```bash
open-sdd brownfield constitution . --interview --answers <path> --write
```

6. **Hand over.** Ask the human to ratify, and give them the exact command. Do not run it for them:
   only a named person with a non-empty rationale can promote the draft, and the draft is consumed in
   the process so it cannot silently re-ratify old text later:

```bash
open-sdd govern constitution --ratify --by "<name>" --rationale "<reason>" --write
```

7. A draft carries `Status: DRAFT`; a ratified constitution carries `Status: RATIFIED` with the
   ratifying human named. **An unratified draft has no authority**: no gate may cite it and no
   blocking verdict may rest on it.

## The constitution is the pivot

Every command in this repository is bound by the constitution. A blocking verdict must cite a named
principle of a **ratified** constitution; without one the verdict is an opinion. If the constitution
is absent or unratified, say so instead of proceeding as if it existed:

```bash
open-sdd status --json
```

Finish by validating the repository against the document you just wrote:

```bash
open-sdd status --check --json
```

## Evidence

- Every principle carries the evidence that makes it checkable: a path, a command, a test, or a
  measurement. "We care about quality" is not a principle.
- Distinguish, in the report, what the **engine measured** from what **you proposed**. The engine's
  output is evidence; your prose is a proposal until a human ratifies it.
- Do not restate prototype numbers or vendor claims as measurements of this repository. If a datum
  was not produced by a command you ran on this repository, it is not evidence.

## Honesty

- If a check cannot run (missing tool, no git history, no constitution yet), **say so in plain
  words**. Never report a pass for something that was not inspected.
- Never invent a datum the human did not give: no fabricated principle, owner, date, ticket or
  metric. If it is unknowable from the repository, it is a question.
- Name the commands you ran and the ones you could not. A report that hides a skipped check is worse
  than no report.

## Mandatory Post-Execution Hooks

1. Re-run `open-sdd status --json` and confirm the constitution component is now measured.
2. If the constitution changed, list every other `.sdd/` artifact that now contradicts it and mark
   them for `analyze`.

## Completion Report

- The path written, its `Status:` (DRAFT or RATIFIED), and who must ratify it.
- Principles in force vs proposed amendments, with the evidence for each.
- Open questions asked, and the answers received (or `UNANSWERED`).
- Deferred intents captured, with the file that holds them.
- The exact checks run, and the exact checks that could not run.

## Done when

- `.sdd/steering/constitution.md` exists with its ratification state stated.
- Every in-force principle has evidence; every unevidenced desire is a proposal or a question.
- Out-of-scope intent is recorded as a deferred note, not executed.
- The human has been asked only the questions they alone can answer.
