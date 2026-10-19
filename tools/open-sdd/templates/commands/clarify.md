---
id: clarify
description: Ask the human only the questions the spec cannot answer, bounded to five, and verify that every answer removed the ambiguity.
argument-hint: "<feature> [--max N]"
writes:
  - ".sdd/specs/<feature>/requirements.md"
  - ".sdd/specs/<feature>/clarifications.md"
  - ".sdd/specs/<feature>/clarify/"
mustNotTouch:
  - ".sdd/steering/constitution.md"
  - "src/**"
  - "test/**"
  - "package.json"
preconditions:
  - ".sdd/specs/<feature>/requirements.md"
handoffs:
  - plan
parallelSafe: false
moves:
  - ears
commands:
  - "open-sdd status <feature> --json"
  - "open-sdd brownfield clarify <feature> --json"
  - "open-sdd brownfield clarify <feature> --questions-file .sdd/specs/<feature>/clarify/questions.json"
  - "open-sdd brownfield clarify <feature> --answers .sdd/specs/<feature>/clarify/answers.json --write"
  - "open-sdd brownfield requirements <feature> --suggest --json"
  - "open-sdd delta validate <feature> --json"
  - "open-sdd status --json"
  - "open-sdd brownfield clarify <feature> --answers <path> --write"
  - "open-sdd status --check --json"
scripts:
  - "open-sdd brownfield clarify <feature> --json"
  - "open-sdd brownfield clarify <feature> --questions-file .sdd/specs/<feature>/clarify/questions.json"
  - "open-sdd brownfield clarify <feature> --answers .sdd/specs/<feature>/clarify/answers.json --write"
  - "open-sdd delta validate <feature> --json"
---

# Clarify — the bounded interrogation

Ambiguity you do not resolve now becomes rework you pay for later. This command interrogates the
human about the spec, but it is **bounded** and **derived**: the questions come from the engine's
deterministic ambiguity codes, never from the agent's imagination, and every answer is written back
into the specification and then **verified** to have removed the ambiguity.

The engine implements this as `open-sdd brownfield clarify <feature>`: a default cap of **five**
questions (`--max N` to change it), questions derived from the EARS analysis and any unfilled
`{{…}}` delta marker, and a non-interactive cycle (`--questions-file` → fill answers → `--answers …
--write`) that never blocks on a terminal. Use that command; this template is the protocol around
it.

## Input

```text
$ARGUMENTS
```

If the input names a feature, use it. If not, read the current state and ask which feature to clarify.

## Contract — the five guarantees for this template

- **Identified — produces:** the rewritten `.sdd/specs/<feature>/requirements.md` plus the question/answer ledger under `.sdd/specs/<feature>/clarify/`.
- **Identified — refuses:** it refuses to answer its own questions and refuses to edit application source or the constitution.
- **Automated — how:** this template never asks you to "consider" a check: the `commands:` frontmatter names the real engine invocations and the steps below RUN them and read their output.
- **Assured — backing check:** `open-sdd brownfield clarify <feature> --answers <path> --write` re-runs the analysis after applying answers and reports `resolved`/`stillOpen` with `codeBefore`/`codeAfter`; `open-sdd delta validate <feature> --json` **exits 1** on a broken delta (BLOCKS hand-off to `plan`).
- **Measured — components:** `ears` — the reader sees the change before/after in `open-sdd status --json` (score and phase).
- **Pivoted — the constitution is the pivot:** the constitution is the pivot: answers are folded into EARS statements with the pattern named, an unratified draft cannot authorise an answer, and `open-sdd status --check --json` validates the spec against the principles.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_clarify`, run
   those steps first.
2. Entries with `enabled: false` are skipped and the skip is named.
3. If the YAML cannot be parsed, **stop and report it**. Never skip silently.
4. Load the feature's `requirements.md` and `spec.json`, plus the delta when the feature changes
   existing code.

## Scope guard

- **May write:** only the feature's own spec artifacts — `requirements.md` (to fold answers in) and
  the clarification ledger under `.sdd/specs/<feature>/clarify/` (or `clarifications.md`).
- **Must not touch:** the constitution, application source, tests, build manifests, or any other
  feature's spec.
- **Deferred intents:** a question whose answer reveals new work is recorded as a deferred note in the
  ledger. Do not expand this spec to absorb it; it becomes its own feature.

## Steps

1. Read the feature state so the questions target the real gap:

```bash
open-sdd status <feature> --json
```

2. Ask the engine for the bounded question set. Read every question's code, artifact and evidence —
   the engine answers from repository evidence anything the repository can compute, and asks only what
   a human must decide:

```bash
open-sdd brownfield clarify <feature> --json
```

3. For a non-interactive run, materialise the questions, fill the answers, and apply them with a
   verified write-back:

```bash
open-sdd brownfield clarify <feature> --questions-file .sdd/specs/<feature>/clarify/questions.json
```

```bash
open-sdd brownfield clarify <feature> --answers .sdd/specs/<feature>/clarify/answers.json --write
```

4. Ask the human the questions, in chat. Do not answer them yourself. A question the agent answers is
   an invented datum with extra steps. **The cap is five by default**: if the engine reports the batch
   was truncated (`remaining` > 0), say so; never present a truncated batch as the whole set.
5. Confirm the write-back was **verified**: the engine re-runs the analysis after applying answers and
   reports `codeBefore`/`codeAfter`, which ids are `resolved` and which are `stillOpen`. An answer
   that did not remove its code is reported as open, never as fixed.
6. A refused answer (empty, still a `{{…}}` placeholder, or identical to what was already there) is
   reported as refused with its reason. Do not retry it silently; re-ask the question.
7. Re-read the statements that remain not checkable, so nothing was lost in the rewrite:

```bash
open-sdd brownfield requirements <feature> --suggest --json
```

8. For a change to existing code, validate the delta after the write-back:

```bash
open-sdd delta validate <feature> --json
```

## The constitution is the pivot

The constitution constrains the answers. If an answer would require violating a ratified principle,
say so and stop: the human must amend the constitution through the constitution command, not route
around it here. An unratified draft cannot authorise an answer.

## Evidence

- Each question cites the artifact and line that raised it; each answer cites the statement it
  changed. The engine's `fromEvidence` entries are answers the repository already knew — label them
  as evidence, not as human decisions.
- The before/after ambiguity codes are the evidence that an answer worked. `stillOpen` is the honest
  result, not a failure to hide.
- The clarification ledger is the audit trail: no answer exists for a downstream command unless it is
  written there.

## Honesty

- Never invent an answer, a default presented as a decision, or a fifth question to look thorough.
  Fewer questions asked well beat five asked for show.
- If the engine cannot run, say so and say which statements were therefore not inspected.
- Report truncation (`remaining`) and refusals verbatim; an open question is a legitimate end state,
  a hidden one is not.
- Never claim the spec is clean when the engine reported codes still open.

## Mandatory Post-Execution Hooks

1. Re-run `open-sdd status <feature> --json` and confirm the EARS component moved.
2. If any question remains open, name it in the completion report and in the handoff to `plan`.

## Completion Report

- Questions asked (≤ the cap), each with its answer or `UNANSWERED`; the count left by truncation.
- Answers applied and their `resolved` / `stillOpen` status, with the before/after codes.
- Statements changed in `requirements.md`, by id.
- Deferred intents captured.
- Checks run, and checks that could not run.

## Done when

- At most the capped number of questions was asked, each one a human decision or an evidence-derived
  answer.
- Every answer is written back into `requirements.md` and verified to have removed its ambiguity (or
  reported `stillOpen`).
- Remaining unknowns are explicitly `UNANSWERED`, not assumed.
- No source file was touched.
