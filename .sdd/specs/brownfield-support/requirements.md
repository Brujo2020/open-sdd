# Requirements Document

## Introduction

Applying spec-driven development to a system that is already in production inverts the unit of work:
the existing code is the de facto source of truth, so the specification describes the CHANGE, not the
system. This specification covers the delta engine, the reverse-engineered constitution, honest
reconnaissance of an existing repository, and the regression oracle.

The authoritative change contract is `delta.md` (ADDED / MODIFIED / REMOVED / RENAMED). This document
carries the same requirements in EARS form for the Documentary Triad; `delta.md` adds the change kind,
the behaviour being replaced, the targets and the contracts.

## Requirements

### REQ-BF-001 — The delta is the contract of change

**Objective:** As an engineer, I want the change described as a delta, so that the obligation stays finite.

#### Acceptance Criteria

- The [delta engine] shall parse and render a change with sections ADDED, MODIFIED, REMOVED and RENAMED.
- The [delta engine] shall require an identifier of the form REQ-AREA-NNN scoped to the change.
- If a requirement is MODIFIED, REMOVED or RENAMED, then the [validator] shall require the behaviour being replaced.
- If a requirement is REMOVED, then the [validator] shall require its rationale and its covering contracts.
- When a delta exceeds twenty-five entries, the [validator] shall warn that it resembles a whole-system specification.

### REQ-BF-004 — Traceability in both directions

**Objective:** As an auditor, I want every delta requirement traced to work, so that nothing is claimed without a task.

#### Acceptance Criteria

- When tasks declare delta identifiers, the [traceability check] shall report which delta requirements own which tasks.
- If a delta requirement has no task, then the [traceability check] shall report it as unmapped.
- If a task cites a delta identifier that the delta does not define, then the [traceability check] shall report a phantom task.

### REQ-BF-002 — A constitution that states only what the code already is

**Objective:** As an architect, I want a descriptive constitution, so that an agent cannot silently modernize what nobody asked it to modernize.

#### Acceptance Criteria

- When a repository is surveyed, the [constitution generator] shall emit only principles with evidence in the code.
- If a practice is desired but not observed, then the [constitution generator] shall record it as a proposed amendment instead of a principle.
- The [constitution] shall declare the language, package manager, build tool and test runner as established facts.
- If a descriptive principle lacks evidence, then the [constitution validator] shall reject it.
- While every principle of a constitution of four or more principles is MUST, the [constitution validator] shall warn that the levels no longer distinguish anything.

### REQ-BF-003 — Reconnaissance that does not lie

**Objective:** As a maintainer, I want the survey to describe my repository accurately, so that the generated artifacts are trustworthy.

#### Acceptance Criteria

- When a repository keeps its code in a nested workspace, the [scanner] shall detect the language, test runner and build tool declared there.
- When a language, test runner or build tool is declared only by a configuration file, the [scanner] shall detect it.
- If a fact cannot be determined, then the [scanner] shall report it as unknown instead of guessing.

### REQ-BF-007 — Analyse the impact of a change before writing it

**Objective:** As an architect, I want the blast radius of a change measured, so that a bounded change does not become an involuntary refactor.

#### Acceptance Criteria

- When a change is analysed, the [impact analysis] shall report the files that depend on the changed files, walking the dependency graph.
- If an exported symbol disappears, then the [impact analysis] shall report a breaking change.
- If a changed migration has no rollback counterpart, then the [impact analysis] shall report an error.
- If the analysis cannot read the project sources, then the [impact analysis] shall report that the radius is unknown instead of reporting a small one.

### REQ-BF-008 — Bind the change to the tests that protect it

**Objective:** As an engineer, I want the existing tests bound to the change, so that the specification's first use is regression protection.

#### Acceptance Criteria

- When contracts are extracted, the [oracle] shall bind each changed file to the test files that cover it.
- If a removed requirement declares contracts, then the [oracle] shall verify that those contracts exist.
- If a changed file has no covering contract, then the [oracle] shall report it as an uncovered change.
- The [oracle] shall not report success from an exit code alone when a declared contract is missing.

### REQ-BF-009 — Search before creating

**Objective:** As a maintainer, I want a reuse check, so that a new symbol does not duplicate one that already exists.

#### Acceptance Criteria

- When a change proposes a new symbol, the [reuse check] shall report existing symbols that match by name or by variant above the similarity threshold.
- If a proposed symbol already has a reusable candidate, then the [reuse check] shall report a violation.
- If the source directories cannot be read, then the [reuse check] shall report that the search did not run.

### REQ-BF-005 — The brownfield surface in the console

**Objective:** As an engineer, I want the brownfield workflow as commands, so that the correct artifact is the easy one.

#### Acceptance Criteria

- The [console] shall expose reconnaissance, constitution generation, impact analysis, contract extraction and reuse search for a feature.
- When a delta exists, the [console] shall validate it and report its traceability.

### REQ-BF-006 — Three rigor levels, and the constitution is the floor

**Objective:** As a maintainer, I want to choose how much stringency this project accepts, so that the default is fluid and raising the level adds checks.

#### Acceptance Criteria

- When no level is declared, the [rigor model] shall require requirements in checkable form and a valid constitution in the same breath.
- When the level rises to Spec-Anchored, the [rigor model] shall additionally require traceability, evidence binding and drift detection.
- When the level is Spec-Source, the [rigor model] shall additionally require declared contracts and regeneration as repair.
- If the declared level demands an artifact that is missing, then the [assessment] shall report a blocking finding.
- When a blocking finding exists, the [commit gate] shall refuse the commit.
- When a project declares an explicit gate list, the [model] shall reject unknown gate identifiers instead of silently reducing the checks.

### REQ-BF-010 — The brownfield workflow is documented where the agents read it

**Objective:** As a user, I want the workflow documented in the places I actually read, so that the tool is usable without reading its source.

#### Acceptance Criteria

- The [documentation] shall describe the delta workflow, the constitution and the level ladder in the traceability report and in a guide.
- The [templates] shall name the brownfield commands in the orientation file each agent reads first.

### REQ-BF-011 — One dashboard for the whole state

**Objective:** As a maintainer, I want the state of the project on one screen, so that I do not have to remember which command answers which question.

#### Acceptance Criteria

- When the status is requested, the [dashboard] shall report the constitution, the specs, the delta, the contracts, the alignment and the declared level.
- When everything is in order, the [dashboard] shall name the single next command to run.
- If a section could not be inspected, then the [dashboard] shall mark it as unknown instead of reporting it as healthy.

### REQ-BF-012 — One entry point for an existing repository

**Objective:** As an architect, I want a single command to bring an existing repository into the workflow, so that adoption is not a checklist of nine commands.

#### Acceptance Criteria

- When a repository is bootstrapped, the [bootstrap] shall compose reconnaissance, the constitution, the module map, the code intelligence and the steps into one plan.
- If an artifact already exists, then the [bootstrap] shall propose to keep it rather than overwrite it.

### REQ-BF-013 — The constitution validates every spec

**Objective:** As an auditor, I want each spec checked against the constitution, so that the authority it cites is real and its requirements do not contradict what the code already is.

#### Acceptance Criteria

- When a spec is checked, the [alignment] shall report the principles it declares and the ones it ignores.
- If a spec cites a principle that is not in force, then the [alignment] shall report a phantom authority as an error.
- If a requirement contradicts a principle in force, then the [alignment] shall report it.
- If the rule cannot decide, then the [alignment] shall stay silent instead of reporting a violation.

### REQ-BF-014 — The workflow is taught where the agents read it

**Objective:** As a new user, I want a short skill and a quickstart, so that the learning curve is minutes and not an afternoon.

#### Acceptance Criteria

- The [skill] shall teach the five steps with the exact commands and the constitution as the pivot.
- The [quickstart] shall state what the tool does not do yet.
