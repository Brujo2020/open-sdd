# Plan: Brownfield Support

> Canonical name for this document is `plan.md`; `design.md` is kept as a declared alias of it (see
> `tools/open-sdd/src/core/triad.ts`).

## Problem

The tool assumed a greenfield project: one specification per feature describing an entire system, with
reconnaissance that only looked at the repository root. On a real, already-implemented codebase that
produces the wrong artifact (a system specification instead of a change contract) and, on a workspace
layout, a survey that misreports the language and claims there are no tests.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| ADR-BF-001 | A delta spec (`delta.md`) is the change contract: ADDED / MODIFIED / REMOVED / RENAMED, with delta-scoped `REQ-<AREA>-<NNN>` identifiers. | §12: the unit is the delta, not the system. Scoping the identifier to the change is what keeps the obligation finite and the traceability fine-grained. |
| ADR-BF-002 | One constitution model with two provenances: `descriptive` (brownfield, evidence required) and `normative` (authored, introduced by governed amendment). | The reverse constitution of the brownfield objective and the constitutional model of the CSDD paper are the same artifact at different stages of maturity. Two models would drift immediately. |
| ADR-BF-003 | Nothing aspirational is emitted as a fact: a desired-but-absent practice becomes a proposed amendment. | A descriptive principle without evidence is a wish recorded as a fact, which is the failure mode that makes governance documents ignored. |
| ADR-BF-004 | Reconnaissance is workspace-aware and configuration-aware, and reports `unknown` rather than guessing. | Proven necessary by running the survey on this repository: it reported "JavaScript, no tests detected" on a TypeScript project with 513 tests, because the code lives in `tools/open-sdd`. |
| ADR-BF-005 | The regression oracle is the declared contracts of MODIFIED/REMOVED entries, and REMOVED requires them. | §12: the extracted specification's first use is protecting what must not change, not producing documentation. |

## Architecture

| Module | Responsibility |
|---|---|
| `core/deltaSpec.ts` | Delta model, ADSR parsing and rendering, validation (ids, EARS, previous, rationale, contracts), traceability and strangulation progress |
| `core/constitution.ts` | The shared constitution model: six-field anatomy, imposition levels, provenance, amendment governance, validation, markdown round-trip, citable authority |
| `core/reverseConstitution.ts` | Detects the facts and generates the descriptive constitution; deferred practices become amendments |
| `core/reverseEngineering.ts` | Workspace-aware, configuration-aware reconnaissance |
| `cli/commands/brownfield.ts` | `brownfield survey|constitution` and `delta init|validate|status|render` |

## Risks

| Risk | Mitigation |
|---|---|
| A survey that overstates what it found | Every field is derived from a file that exists; `unknown` otherwise. |
| A constitution that becomes an ignored document | Levels distinguish defensible deviation; everything-MUST is warned about; evidence is mandatory for descriptive principles. |
| A delta that is really a system specification | Size heuristic warns above 25 entries; the identifier grammar is change-scoped. |

## Verification plan

1. `npm --prefix tools/open-sdd run build` and `test` green.
2. `open-sdd brownfield survey` on this repository reports TypeScript, Vitest and the real module list.
3. `open-sdd brownfield constitution --write` emits a valid constitution with a faithful round-trip.
4. `open-sdd delta validate brownfield-support` reports no errors and full traceability.
