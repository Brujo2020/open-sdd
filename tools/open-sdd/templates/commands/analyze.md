---
id: analyze
description: Cross-check requirements, plan, tasks and code against each other, delegating every real check to the engine instead of re-deriving it in prose.
argument-hint: "<feature>"
writes:
  - ".sdd/specs/<feature>/analysis.md"
mustNotTouch:
  - ".sdd/specs/<feature>/requirements.md"
  - ".sdd/specs/<feature>/plan.md"
  - ".sdd/specs/<feature>/tasks.md"
  - ".sdd/specs/<feature>/delta.md"
  - ".sdd/steering/constitution.md"
  - "src/**"
  - "test/**"
preconditions:
  - ".sdd/specs/<feature>/requirements.md"
  - ".sdd/specs/<feature>/plan.md"
  - ".sdd/specs/<feature>/tasks.md"
handoffs:
  - converge
  - release
parallelSafe: true
moves:
  - alignment
commands:
  - "open-sdd status <feature> --json"
  - "open-sdd status --check --json"
  - "open-sdd brownfield analyze <feature> --json"
  - "open-sdd brownfield contracts <feature> --json"
  - "open-sdd delta validate <feature> --json"
  - "open-sdd gates run"
  - "open-sdd status --json"
scripts:
  - "open-sdd brownfield analyze <feature> --json"
  - "open-sdd delta validate <feature> --json"
  - "open-sdd gates run"
---

# Analyze — the engine checks, you read the result

You are auditing a feature for consistency: requirements ↔ plan ↔ tasks ↔ code ↔ constitution. The
checks are not yours to re-derive in prose. **Run the engine's checks and report their output**; your
job is to interpret, prioritise and route, and to be explicit about anything the engine could not
inspect.

## Input

```text
$ARGUMENTS
```

If no feature is named, read the state and ask which feature to analyse.

## Contract — the five guarantees for this template

- **Identified — produces:** `.sdd/specs/<feature>/analysis.md` — the report of measured, inferred and uninspected findings.
- **Identified — refuses:** it refuses to edit requirements, plan, tasks, source or the constitution: it reports and routes, it never fixes.
- **Automated — how:** this template never asks you to "consider" a check: the `commands:` frontmatter names the real engine invocations and the steps below RUN them and read their output.
- **Assured — backing check:** `open-sdd brownfield analyze <feature> --json` **exits 1** on error findings (BLOCKS release), `open-sdd delta validate <feature> --json` **exits 1** on a broken delta, and `open-sdd gates run` **exits 1** when the chain fails; all three exit codes are quoted verbatim.
- **Measured — components:** `alignment` — the reader sees the change before/after in `open-sdd status --json` (score and phase).
- **Pivoted — the constitution is the pivot:** the constitution is the pivot: a blocking finding must cite a ratified principle, an unratified draft downgrades findings to advisory, and `open-sdd status --check --json` is the pivot check.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_analyze`, run
   those steps first.
2. Entries with `enabled: false` are skipped and the skip is named.
3. If the YAML cannot be parsed, **stop and report it**. Never skip silently.

## Scope guard

- **May write:** only `.sdd/specs/<feature>/analysis.md` (the report).
- **Must not touch:** any other spec artifact, the constitution, application source, tests. This
  command **fixes nothing**: it reports and routes.
- **Deferred intents:** a remediation you would like to make is a recommendation in the report, never
  an edit. Hand it to `converge` as a proposed task.

## Steps

1. Read the feature state:

```bash
open-sdd status <feature> --json
```

2. Run the engine's consistency analysis and read the findings verbatim, including severity and code:

```bash
open-sdd brownfield analyze <feature> --json
```

3. Ask which changed files are protected by tests, and which are not:

```bash
open-sdd brownfield contracts <feature> --json
```

4. For a change to existing code, validate the delta's ids, EARS form, targets and traceability:

```bash
open-sdd delta validate <feature> --json
```

5. Validate the repository against the constitution and the declared rigor level:

```bash
open-sdd status --check --json
```

6. Run the enforcement chain so the report carries the repository's own verdict:

```bash
open-sdd gates run
```

7. Write `analysis.md` with, for every finding: the engine's code and severity, the artifact it
   concerns, the requirement id, the recommended route (`specify` / `plan` / `tasks` / `implement` /
   constitution amendment), and whether it is **blocking** or advisory. A blocking finding must cite
   the principle or gate it violates.
8. Separate three lists and never blend them:
   - findings the engine reported (evidence);
   - findings you inferred from reading the artifacts (your reasoning, labelled as such);
   - things neither could inspect (unknowns).

## The constitution is the pivot

A blocking verdict must cite a **ratified** principle by name; without one it is an opinion and must
be reported as advisory. If the constitution is absent or a draft, say so and report the checks that
depend on it as unmeasured rather than failed.

## Evidence

- Quote engine codes, severities and exit statuses; do not paraphrase a failure into a softer word.
- Distinguish measured from inferred explicitly, per finding.
- The coverage gaps the contracts check reports are evidence of risk, not an absence of evidence.

## Honesty

- If a check cannot run, list it under "not inspected" and never count it as a pass.
- Never invent a finding to look thorough, and never drop a blocking finding to make the feature look
  ready.
- Never claim the gate chain passed unless you ran it and observed the exit status.

## Mandatory Post-Execution Hooks

1. Route every blocking finding to a named command in the report.
2. Hand the report to `converge`; hand a clean, verified feature to `release`.

## Completion Report

- Findings by severity, each with code, artifact and route.
- What was measured, what was inferred, what was not inspected.
- The gate chain's exit status, verbatim.
- Recommended next command.

## Done when

- `analysis.md` exists and contains no invented checks and no hidden failures.
- Every blocking finding cites a ratified principle or a gate.
- Uninspected areas are named as such.
- Nothing outside the report was written.
