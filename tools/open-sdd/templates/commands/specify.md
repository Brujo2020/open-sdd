---
id: specify
description: Turn a natural-language intent into a numbered EARS requirements document under the ratified constitution.
writes:
  - ".sdd/specs/<feature>/spec.json"
  - ".sdd/specs/<feature>/requirements.md"
  - ".sdd/specs/<feature>/brief.md"
mustNotTouch:
  - ".sdd/steering/constitution.md"
  - "src/**"
  - "test/**"
  - "package.json"
preconditions:
  - ".sdd/steering/constitution.md"
handoffs:
  - clarify
  - plan
parallelSafe: false
moves:
  - ears
commands:
  - "open-sdd status --json"
  - "open-sdd status <feature> --json"
  - "open-sdd brownfield specify <feature> \"<description>\" --json"
  - "open-sdd brownfield requirements <feature> --suggest --json"
  - "open-sdd brownfield analyze <feature> --json"
  - "open-sdd delta init <feature> \"<title>\""
  - "open-sdd delta validate <feature> --json"
  - "open-sdd status --check --json"
scripts:
  - "open-sdd brownfield specify <feature> \"<description>\" --json"
  - "open-sdd brownfield requirements <feature> --suggest --json"
  - "open-sdd delta init <feature> \"<title>\""
---

# Specify — intent becomes numbered EARS requirements

You are turning the human's intent into requirements that a machine can check. Each requirement is
one numbered statement in EARS form, with its pattern named, and nothing in the document is a datum
the human did not give you.

## Input

```text
$ARGUMENTS
```

If the intent is thin, ask for the missing subject, actor and observable result before writing
anything. A requirement invented from silence is the most expensive kind of bug.

## Contract — the five guarantees for this template

- **Identified — produces:** `.sdd/specs/<feature>/requirements.md` (numbered EARS statements, pattern named) and `spec.json`.
- **Identified — refuses:** it refuses to write the constitution, application source, tests or manifests; implementation, refactor or deploy intent becomes a deferred note, never a requirement.
- **Automated — how:** this template never asks you to "consider" a check: the `commands:` frontmatter names the real engine invocations and the steps below RUN them and read their output.
- **Assured — backing check:** `open-sdd brownfield requirements <feature> --suggest --json` re-checks every statement against the real EARS patterns and **exits 1** when the spec cannot be analysed (BLOCKS hand-off to `plan`); `open-sdd delta validate <feature> --json` **exits 1** on an invalid delta.
- **Measured — components:** `ears` — the reader sees the change before/after in `open-sdd status --json` (score and phase).
- **Pivoted — the constitution is the pivot:** the constitution is the pivot: requirements are written under the ratified constitution in EARS form with the pattern named (`When … the system shall …`, `If … the system shall …`), an unknowable datum becomes a question instead of a fabricated requirement, and `open-sdd status --check --json` validates the spec against the principles.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_specify`, run
   those steps first.
2. Entries with `enabled: false` are skipped and the skip is named.
3. If the YAML cannot be parsed, **stop and report it**. Never skip silently.
4. Read the ratified constitution. If it is missing or unratified, say so before proceeding: the
   requirements you write would have no authority to be validated against.

## Scope guard

- **May write:** the feature's own `.sdd/specs/<feature>/` artifacts (`spec.json`, `requirements.md`
  and, when useful, `brief.md`). For an existing codebase, the change contract is a delta:
  `open-sdd delta init <feature> "<title>"` — declare ADDED / MODIFIED / REMOVED / RENAMED there.
- **Must not touch:** the constitution, application source, tests, or build manifests.
- **Deferred intents:** implementation detail, refactors, deployment steps and "while we are here"
  cleanups are **not requirements**. Capture them as deferred notes at the end of `requirements.md`
  and leave them alone; a later `plan` or `implement` decides whether they exist.

## Steps

1. Read the current state so you know which phase and which feature you are in:

```bash
open-sdd status --json
```

2. Turn the natural-language intent into a first-pass spec with the engine's specify front door. It
   writes the spec artifacts and the questions it cannot answer; read both:

```bash
open-sdd brownfield specify <feature> "<description>" --json
```

3. For an existing codebase, declare the contract of change; then the requirements have a scope to
   live in:

```bash
open-sdd delta init <feature> "<title>"
```

4. Draft the requirements in EARS. **Name the pattern for each statement** and keep exactly one
   behaviour per statement:
   - *Ubiquitous* — "The system shall …"
   - *Event-driven* — "When <trigger>, the system shall …"
   - *State-driven* — "While <state>, the system shall …"
   - *Unwanted behaviour* — "If <condition>, the system shall …"
   - *Optional feature* — "Where <feature is configured>, the system shall …"
5. Use the engine's EARS assistant to check and suggest rewrites against the real patterns:

```bash
open-sdd brownfield requirements <feature> --suggest --json
```

6. Read the machine report: it names every statement that is not yet checkable and every pattern it
   could not match. Fix the prose; do not argue with the report.
7. Give each requirement a stable id of the form `REQ-<AREA>-<NNN>` scoped to this feature or delta,
   and never renumber an id that already shipped.
8. **An unknowable datum becomes a question, not a fabricated requirement.** If the human did not say
   the timeout, the limit, the owner or the retention period, write it into the open-questions list
   and hand it to `clarify`.
9. Ask the engine what the change touches, so the requirements do not silently contradict the code:

```bash
open-sdd brownfield analyze <feature> --json
```

10. Confirm the feature's artifacts parse and are in the phase you think they are:

```bash
open-sdd status <feature> --json
```

## The constitution is the pivot

Requirements exist **under** the ratified constitution, not next to it. If a requirement would
violate a principle in force, do not write it: report the conflict and let the human amend the
constitution first. A draft constitution has no authority; a requirement may not cite one.

## Evidence

- Each requirement states an observable result that a test could check. If nothing could ever fail
  it, it is not a requirement.
- The engine's EARS report is evidence of form; your reading of the human's words is evidence of
  intent. Label them as such in the report.
- Never present a suggested rewrite as an accepted requirement. Suggestions are proposals until the
  human accepts them.

## Honesty

- If the EARS assistant cannot run, say so and say which checks are therefore missing — do not
  report "requirements validated" when only your own prose was reviewed.
- Never invent numbers, names, ids, dates or acceptance criteria the human did not give.
- List which statements are backed by the human's input and which are open questions.

## Mandatory Post-Execution Hooks

1. Re-run `open-sdd status <feature> --json` and confirm the EARS component is now measured.
2. Hand the open questions to `clarify` before any plan is written.

## Completion Report

- Feature id, the delta (if any), and the path written.
- Requirement count by EARS pattern, with the id range.
- Every open question, verbatim.
- Deferred intents, with the file that holds them.
- Checks run, and checks that could not run.

## Done when

- `requirements.md` holds numbered, pattern-named EARS statements with no invented data.
- Every unknowable is a question routed to `clarify`.
- The delta (for a change to existing code) is declared and validates.
- No application source was touched.
