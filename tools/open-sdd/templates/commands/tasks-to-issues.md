---
id: tasks-to-issues
description: Publish the approved task list as one issue per task, preserving the requirement, the test command and the evidence line.
writes:
  - ".sdd/specs/<feature>/issues/"
mustNotTouch:
  - ".sdd/specs/<feature>/tasks.md"
  - ".sdd/specs/<feature>/requirements.md"
  - ".sdd/steering/constitution.md"
  - "src/**"
  - "test/**"
preconditions:
  - ".sdd/specs/<feature>/tasks.md"
handoffs: []
parallelSafe: true
moves:
  - traceability
commands:
  - "open-sdd status <feature> --json"
  - "open-sdd delta validate <feature> --json"
  - "open-sdd status --json"
  - "open-sdd status --check --json"
scripts:
  - "open-sdd status <feature> --json"
  - "open-sdd delta validate <feature> --json"
---

# Tasks to issues — one task, one trackable unit, no information lost

You are exporting the approved task list to the team's issue tracker. Each issue carries the task's
requirement, its declared paths, its real test command and its `_Evidence:_` line, so the tracker and
the spec cannot drift apart. This command **exports**; it does not re-plan.

## Input

```text
$ARGUMENTS
```

The input may name the feature and the tracker (for example a repository and label). If the tracker is
unknown, ask before publishing anywhere.

## Contract — the five guarantees for this template

- **Identified — produces:** one issue payload per task under `.sdd/specs/<feature>/issues/`, and the tracker entries when a tracker is configured and reachable.
- **Identified — refuses:** it refuses to edit `tasks.md` or any spec artifact, and refuses to report a publication that did not occur.
- **Automated — how:** this template never asks you to "consider" a check: the `commands:` frontmatter names the real engine invocations and the steps below RUN them and read their output.
- **Assured — backing check:** `open-sdd status <feature> --json` confirms the task set in scope and `open-sdd delta validate <feature> --json` **exits 1** on a broken requirement id (BLOCKS publication); publication is proven by the tracker's returned id, otherwise the report says `NOT PUBLISHED`.
- **Measured — components:** `traceability` — the reader sees the change before/after in `open-sdd status --json` (score and phase).
- **Pivoted — the constitution is the pivot:** the constitution is the pivot: issues carry the constitution's constraints as acceptance criteria, an issue that would violate a principle is not published, and `open-sdd status --check --json` is the pivot check.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_tasks_to_issues`,
   run those steps first.
2. Entries with `enabled: false` are skipped and the skip is named.
3. If the YAML cannot be parsed, **stop and report it**. Never skip silently.
4. If a network or CLI tool is required to publish and it is unavailable, say so: write the issue
   payloads locally and report that publication did not happen. Never report a publication that did
   not occur.

## Scope guard

- **May write:** the local payload directory `.sdd/specs/<feature>/issues/` and, only when a tracker
  is explicitly configured and reachable, the tracker itself.
- **Must not touch:** `tasks.md` (read-only input), requirements, plan, the constitution, source,
  tests.
- **Deferred intents:** an issue that is not derived from a task is not created here. Note it in the
  report and let the human decide its home.

## Steps

1. Read the feature state and confirm the task set is the approved one:

```bash
open-sdd status <feature> --json
```

2. For a change to existing code, confirm the delta is valid so every issue's requirement id is real:

```bash
open-sdd delta validate <feature> --json
```

3. Write one payload per task under `.sdd/specs/<feature>/issues/`, named by task id, containing:
   - the task id and outcome as the title;
   - the requirement id(s) it serves;
   - the paths it may touch;
   - the exact test command and the `_Evidence:_` instruction;
   - its dependencies, referenced by task id;
   - a link back to the spec artifacts.
4. Publish only when the tracker is configured and reachable, and record the returned issue id next
   to the task id in the report. Do not put tracker ids into `tasks.md` unless the human asks.
5. Verify nothing was lost: every task has exactly one issue, and every issue points at a real task
   and a real requirement id.

## The constitution is the pivot

Issues carry the constitution's constraints as acceptance criteria where the principle applies. An
issue that would require violating a ratified principle must not be published; report the conflict.
A draft constitution is not authority to encode a rule.

## Evidence

- The mapping task id ↔ issue id is the evidence that the export was complete; include both
  directions.
- If publication failed, the local payloads are the evidence of what was attempted, and the failure
  message is quoted.
- Never present a drafted payload as a published issue.

## Honesty

- If no tracker is reachable, say `NOT PUBLISHED` plainly and leave the payloads for the human.
- Never invent an issue id, a URL or a tracker response.
- Never invent acceptance criteria the task did not carry.

## Mandatory Post-Execution Hooks

1. Report the complete task ↔ issue mapping, including anything unpublished.
2. Leave `tasks.md` untouched; the spec remains the source of truth.

## Completion Report

- Feature, tracker (or `none`), and publication status (`published` / `NOT PUBLISHED`).
- Task id ↔ issue id mapping, both directions.
- Tasks with no issue (with the reason) and issues with no task (should be zero).
- Checks run, and checks that could not run.

## Done when

- Every task has a corresponding payload, and every published issue traces to a task and a
  requirement.
- Unpublished work is explicitly labelled with its reason.
- No spec artifact and no source file was modified.
