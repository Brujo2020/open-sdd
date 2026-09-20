# Brownfield convergence

`open-sdd brownfield converge <feature>` answers one question with measurements instead of
opinions: **given the specifications as the only source of intent, what is still missing from the
code?** It reads `requirements.md`, `plan.md`/`design.md` and `tasks.md` (plus `delta.md` when it
exists) and the repository itself, reports every gap it can measure, and — only with `--write` —
appends the remaining work to the bottom of `tasks.md` as new, traceable tasks.

It is the brownfield answer to spec-kit's `converge`, rebuilt on this repository's engine. The
difference is not the idea, it is who measures: here every finding carries machine-collected
evidence, and a finding without evidence does not exist.

> Commands below are shown as `open-sdd …` for an installed CLI. In this repository, replace
> `open-sdd` with `node tools/open-sdd/dist/cli.js`.

## The workflow: implement → converge → implement

Converge is not a first step. It is the loop that closes the gap between "the tasks are done" and
"the code actually does what the spec asked".

```bash
# 1. Implement against the spec (skills / sdd-impl), then ask the engine what is left.
open-sdd brownfield converge <feature>            # report only; tasks.md is not touched

# 2. Read the findings table. Each row is a measured gap with its evidence.
#    Exit code is 1 when any gap is `high` (a real gap in a delivered feature), 0 otherwise.

# 3. Turn the remaining work into tracked tasks, append-only.
open-sdd brownfield converge <feature> --write    # appends ONE `## Phase N: Convergence` section

# 4. Implement those tasks, capture `_Evidence:`, and run converge again.
open-sdd brownfield converge <feature>            # idempotent: no gap is appended twice
```

The loop is deliberately honest about the direction of the arrow. Converge never rewrites
`requirements.md`, `plan.md` or `tasks.md` above the append point, never renumbers or reorders
existing tasks, and never writes application code. If the spec is wrong, the fix is an explicit
edit to the spec (or a delta entry), not a silent convergence.

## Gap types, how each is detected, and what evidence it carries

| Gap type | Severity | Detected by | Evidence (machine-collected) |
|---|---|---|---|
| `missing` | high | `traceDelta` maps no task to a requirement (or delta entry); or a task's declared `_Boundary:_` path does not exist (`stat`) | `requirements.md:<line>` / `tasks.md:<line>`, `traceDelta: 0 of N tasks cite …`, or `<path>: no existe (stat: ENOENT)` |
| `partial` | medium | the requirement has traced tasks and not all are `[x]`; the ratio is measured (0/N included) | `cobertura medida: k/N tarea(s) completada(s)` + `tasks.md:<line>` of each pending task |
| `contradicts` | high | `traceDelta` reports a task citing an unknown requirement id; or `alignSpecWithConstitution` emits a pivot error | `tasks.md:<line>` + the cited id; or `alignSpecWithConstitution:<CODE>` + the principle and artifact |
| `unrequested` | low | a changed file inside a declared boundary/target exports a symbol no token of the spec names (`extractExportNames`) | `file:<line>` of the export + `0 of N spec tokens name <symbol>` |
| `unprotected` | high | a contract declared by the delta exists neither on disk nor in the set extracted by `extractContracts` | `delta.md: contrato declarado por <REQ>` + `<path>: no existe (stat: ENOENT)` + `extractContracts: 0 of N contracts back it` |
| `unbound` | high | `checkEvidenceLock` finds a task marked `[x]` with no `_Evidence:` line | `tasks.md:<line>` + `checkEvidenceLock: N task(s) completed without _Evidence:_` |

Two of the six are ours alone, and they are the reason the engine is worth having:

- **`unprotected`** is the regression-oracle hole. A delta can *declare* a contract that protects a
  behaviour; if that contract does not exist, the specification is promising protection the
  repository does not have. A green test run does not close it, so converge reports it as `high`.
- **`unbound`** is a claim, not a completion. A task marked `[x]` without `_Evidence:` is textually
  indistinguishable from a verified one — which is exactly why it is a gap and not a detail.

Everything else is composed, never re-implemented: `traceDelta` for the two-way trace,
`extractContracts` for the oracle, `alignSpecWithConstitution` for the constitutional pivot,
`resolveBoundaries`/`scanProject` for the facts, `checkEvidenceLock` for the evidence lock, and
`checkConsistency` for the full artifact-vs-artifact pass (converge runs it and says so in
`checked`, lifting only the error codes it does not already own, so nothing is reported twice).

## The exact append format

`--write` appends exactly one section and nothing else:

```markdown
## Phase 3: Convergence

- [ ] conv-1: El requisito REQ-BF-008 está a medias (0/1): cierra 13 con evidencia y vuelve a ejecutar converge. — _Requirements: REQ-BF-008_ — _Boundary:_ `tools/open-sdd/src/core/executionContract.ts`_ — _TDD:_ `vitest run`_ — _Convergence: F-6f2a1c9d4b70_
```

- `N` is the next free phase number (the highest `## Phase <n>` in the file plus one); nothing above
  is renumbered.
- `conv-K` continues the existing `conv-` numbering, so two passes cannot collide.
- `_Requirements:_` names the requirement the gap serves; a pivot finding about a principle carries
  `_Constitution: <PRINCIPLE>_` instead.
- `_Boundary:_` is a module or path observed by reconnaissance (task boundary → delta target →
  directory of the evidence path → repo root), never an invented one.
- `_TDD:_` carries the project's **real** test command: `scripts.test` from the manifest when it is
  declared, otherwise the command `testCommandFor` derives from the detected runner. When nobody
  declared a runner, the marker is omitted and `notChecked` says so — a command is never invented.
- `_Convergence: F-<fingerprint>_` is the idempotency marker.

The appended section is a real task list: `parseTasksMarkdown` reads the ids (`conv-1`, `conv-2`,
…), the boundaries and the requirements, and `traceDelta` sees the new `_Requirements:` citations,
so traceability improves by exactly the gaps that were appended.

## Append-only and idempotency guarantees

- **Append-only, byte for byte.** The only write is the new section at the end of `tasks.md`. When
  there is nothing to append, nothing is written at all: `converged: true` and the file is left
  untouched (the test suite asserts byte equality).
- **Idempotent.** The fingerprint is `sha256(gapType|source)` truncated to 12 hex characters. It
  deliberately excludes evidence and line numbers, which shift when the file grows, so it is stable
  across runs. Before emitting a finding, converge reads the `_Convergence: F-…_` markers already in
  `tasks.md` and drops the ones already recorded. Running converge twice on an unchanged repository
  reports zero new findings for the same gap and writes nothing the second time.
- **Stale-report guard.** `appendConvergence` refuses to write if `tasks.md` changed between the
  analysis and the append: the report no longer describes the file, so it asks you to re-run
  converge instead of writing on a different base.

## The score delta

The report exposes `scoreImpact`: the `sddScore` components the findings should move, with the
measured reason — `contracts` for `unprotected`, `evidence` for `unbound` and `partial`,
`traceability` for `missing` and `unrequested`, `alignment` for `contradicts`. The composite number
is not restated here.

That delta is **not a quality benchmark**. It is a bookkeeping signal: "these are the components
this remaining work feeds". A higher score after implementing the appended tasks means the spec is
better honoured, not that the software is better. The score is also weighted and partial: a
component that could not be measured is excluded from the denominator rather than scored zero, so a
low number can mean "less was inspected", not "less was done". Read `notChecked` before reading the
number.

## What converge cannot see — and says so

`checked` lists what ran, with the numbers it saw. `notChecked` lists what did not run and why: no
`delta.md` (no declared contracts), no constitution (no pivot authority), no detected runner (no
`_TDD:_`), no diff (nothing to judge as `unrequested`), an unreadable test directory, an unreadable
toolchain. `complete` is true only when `notChecked` is empty.

`converged` is stricter in one direction and looser in another, on purpose:

- it requires **zero new findings**;
- it requires **no inspection blocker** — an unreadable `requirements.md`/`tasks.md`/`delta.md`, an
  unreadable test directory, an unreadable toolchain, or an unreadable changed source file. A run
  that found nothing because it could not read the code must never report `converged: true`;
- the absence of an *optional* artifact (no delta, no constitution, no runner, no diff) is disclosed
  in `notChecked` and does not by itself forbid declaring converged what was actually measured.

## Honest comparison with spec-kit's `converge`

spec-kit's `converge` is an agent reading `spec.md`, `plan.md` and `tasks.md` and appending the
remaining work it judges to be missing; its findings are prose, its evidence is what the model
wrote, and its guarantees (append-only, clean when satisfied, stop on a missing prerequisite) are
instructions the agent is asked to follow. Ours keeps the idea and moves the measurement into an
engine: the gap types are computed from `traceDelta`, `extractContracts`, `checkEvidenceLock`, the
constitutional pivot and `stat`, and each finding cites `file:line`, a measured ratio or a command's
output — a finding without machine evidence is dropped before it is emitted. Because the engine
computes a stable fingerprint per gap, it can *prove* it will not append the same gap twice instead
of being asked not to, and because it distinguishes "nothing to do" from "could not read the code",
it refuses to claim convergence over source it never inspected. The two extra gap types are the
concrete payoff: `unprotected` (a declared contract that does not exist — the regression-oracle hole)
and `unbound` (a task marked complete without `_Evidence:`) are measurable here and invisible to a
reader that only sees prose.

## See also

- [`brownfield-delta-workflow.md`](./brownfield-delta-workflow.md) — the delta as the unit of change.
- [`brownfield-quickstart.md`](./brownfield-quickstart.md) — the first run on an existing repo.
- [`existing-projects.md`](./existing-projects.md) — adopting open-sdd in place.
