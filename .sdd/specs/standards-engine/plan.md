# Plan: standards-engine

> Canonical name for this document is `plan.md`; `design.md` is an accepted alias of the same file
> (`tools/open-sdd/src/core/triad.ts`). This is workstream W2 of `docs/EVOLUTION-PLAN.md`.

_Constitution: C-STACK-FACT, C-API-COMPAT, C-BOUNDARIES, C-REGRESSION-ORACLE_

## Problem

`.sdd/settings/rules/` holds ~60 KB of real best practice across 15 documents — EARS format,
requirements review gate, design principles, task generation, steering, git. **No runtime code reads
them.** A repository-wide grep finds only `plan/sharedRules.ts`, which copies them out of the
templates, and two of them carry a "Mechanical Checks" section that nothing executes. Only `ears.ts`
implements a partial catalogue (`NO_SHALL`, `NO_TEMPLATE_MATCH`, `MULTIPLE_TEMPLATES`,
`COMPOUND_REQUIREMENT`, `MISSING_THEN`, `VAGUE_TERM`, `EMPTY_RESPONSE`).

The cost is not the missing check; it is that a rule which is not executable is a rule that is
remembered or forgotten. The plan (`docs/EVOLUTION-PLAN.md`, W2) names this as the highest-leverage
gap. The 42 checks that the requirements coach will run already exist in
`docs/guides/requirements-quality-catalog.md`; what is missing is the layer that stores them, runs
them, wires them into the chain and always answers with a remedy.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Where the catalogue lives | `.sdd/settings/standards/**`, one entry per standard | Settings are already the repository's declared-configuration home; a separate registry would drift |
| Which direction is the source of truth | Catalogue → generated prose | A rule and its prose that can disagree eventually do (the `COMPARE.md` drift is the precedent) |
| Default severity | Everything advisory until a corpus is measured | Decision 3 of §7, and the plan's tenet 7 ("calibrate before you block", the C4 lesson) |
| Finding channel | The existing `.sdd/settings/security-allowlist.json` shape | Femmer's own design goal is awareness plus transparent reasoning, not enforcement; one suppression mechanism, not two |
| Detection kind | `regex`, `structural`, `heuristic`, `question` | A check that cannot decide says so (`notChecked` discipline) instead of guessing |
| Dependencies | None new | `C-STACK-FACT`: the catalogue is data read with the existing parser; no new manifest entry |

## Design

### The catalogue entry

```yaml
id: REQ-EARS-001
title: One trigger template per requirement
category: requirements        # requirements | design | tasks | steering | git | security | docs
severity: advisory            # error | warning | info — never blocking until calibrated
blocking: false               # only a calibrated entry may set true
applies_to: [requirements.md, plan.md, tasks.md]
standard: EARS                # EARS | INCOSE | ISO-29148 | internal
source: <URL or rule-file anchor>
detect:
  kind: regex | structural | heuristic | question
  patterns: [...]
message: ...
remedy:
  auto_fixable: false
  grade: machine-applicable | maybe-incorrect | needs-human
  templates: [...]
  alternatives: [...]
evidence: <module/symbol that implements the check>
calibrated: { corpus: null, recall: null, fpr: null }
```

An entry missing a required field is rejected **by name** (`REQ-STD-001`); it does not run, and its
absence is visible rather than silent.

### Generation, not duplication

`rules/*.md` is rendered from the catalogue. The generated file carries the catalogue id it came
from, so `standards check` can report a hand-edited rule file as drifted and name the entry that
disagrees (`REQ-STD-002`). The seed is the content that already exists: the `ears.ts` diagnostics,
the two Mechanical Checks sections, the EARS patterns in `ears-format.md`, and the
boundary/traceability rules in `requirements-review-gate.md`.

### Chain wiring

- The requirements subset runs inside **C1** (`REQ-STD-006`).
- The rest is exposed as **C8 Standards Conformance**, advisory from the first release.
- A standard that cannot inspect its artifact renders **`skipped`**, never `passed` — the rule
  `specConstitution.ts` already states ("an `ok` over something not inspected is refused").

### Findings are actionable and graded

Every finding carries the rule id, the position (`file:line:column`), the message, and **at least one
remedy or one question**; a finding with neither fails a test (`REQ-STD-004`, `REQ-STD-009`). Remedies
are graded and only `machine-applicable` ones auto-apply (`REQ-STD-008`).

### Adjudication

A finding may be accepted, dismissed or waived with a reason, an owner and an expiry, in the existing
allowlist. An unused suppression is itself reported (`REQ-STD-007`), so accepted debt cannot become a
permanent blind spot.

## Boundaries

- New modules live under `tools/open-sdd/src/core/` (`standards.ts`, `standardsCatalogue.ts`,
  `standardsRender.ts`) and a console at `tools/open-sdd/src/cli/commands/standards.ts`.
- The change does **not** cross a module frontier beyond the existing `core → cli` direction
  (`C-BOUNDARIES`, SHOULD): no new dependency edge, no change to the MCP or plan layers.
- The catalogue is read through the existing settings parser; no new file format parser is
  introduced.

## Public API and the regression oracle

- Additive only (`C-API-COMPAT`, MUST): new exports from `core/index.ts`; no existing export is
  renamed or removed. The CLI gains a subcommand; no existing flag changes meaning.
- The existing Vitest suite is the regression oracle (`C-REGRESSION-ORACLE`, MUST). Every new check
  ships with a test; `test/coreEars.test.ts` and `test/coreGateRunner.test.ts` must keep passing
  unchanged, because the C1 wiring must not change the verdict of an existing passing spec.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Keep the rules as prose and rely on the agent to apply them | This is the current state, and it is the gap: nothing measures whether they were applied |
| Generate the catalogue *from* the prose | The prose is a document, not data; parsing it would be a second, weaker detector than the catalogue itself |
| Make the new checks blocking immediately | It would reproduce the C4 false-positive lesson and train `--no-verify`; decision 3 says advisory until calibrated |
| A second suppression file for standards | Two suppression paths diverge; the allowlist already requires a reason |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| False positives on organic repositories | Advisory default; precision/recall published per family before promotion |
| Ceremony: more checks, no value | Every entry must justify its cost with a corpus before it can block; artifacts are budgeted per change class |
| The generated prose becomes unusable | Generation is deterministic and byte-checked; a human can still read the rendered markdown |
| Drift between catalogue and `ears.ts` | `ears.ts` becomes the implementation behind the EARS entries; a test asserts the ids match |
