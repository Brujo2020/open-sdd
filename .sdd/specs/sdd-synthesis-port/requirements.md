# Requirements Document — sdd-synthesis-port

## Introduction
Source: `SDD-PARA-OPENSDD.md` (SteelForge PR #22, implemented in JavaScript there; not tested inside open-sdd). Its JavaScript sources are not reachable from this session, so the behaviour is re-implemented in TypeScript from the guide's contract, not copied.

A gap analysis against `main@175a0d1` decided what is ported. Only behaviour no open-sdd module owns is in scope; a second implementation of an owned rule would drift from the first.

## Boundary Context
- **In scope**: EARS→Gherkin generation (guide §4); task-grammar checks PARALLEL, DEPENDS, NUM and ORPHAN (guide §3).
- **Out of scope, already owned**:
  - COVERAGE / UNKNOWN → `consistency.ts` (`REQUIREMENT_WITHOUT_TASK`, `PHANTOM_REQUIREMENT_ID`).
  - EARS, VAGUE, CLAUSE, PLACEHOLDER, ID, TECH, LEN-class rules → `requirementsCoach.ts` (EARS-*, AMB-*, SIN-*, TRC-*) and `ears.ts`.
  - CLARIFY → `clarify.ts`; PLAN mention → `consistency.ts` constitutional pivot and `converge.ts`.
  - Delta archive → `delta merge --write --archive` (PR #1, branch `hardening/g36-up-approve`).
- **Out of scope, would fork a vocabulary** (proposals, not built):
  - Module matrix `explore|minimal|anchored|source` → collides with the rigor ladder `spec-first|spec-anchored|spec-as-source` (`rigor.ts`).
  - BMAD 5-field brief and `brief lint` → collides with the `sdd-discovery` brief format shipped in 9 skill trees.
  - Steering `inclusion: always|fileMatch|manual` and `#[[file:]]` → changes the steering contract of every agent tree.
  - Feature-folder archive with `validation.md` readiness → waits for PR #1 so there is one archive verb.

## Requirements

### REQ-SSP-001: Gherkin scenario per EARS statement
**Objective:** As a spec author, I want each EARS acceptance statement turned into one Gherkin scenario, so that acceptance tests start from the approved wording.

#### Acceptance Criteria
1. When `open-sdd requirements gherkin <feature>` runs, the CLI shall emit one scenario per statement that contains `shall` (or `debe`), tagged `@<requirement-id> @<pattern>`.
2. When the statement is ubiquitous, the converter shall emit `Given the system is running` and one `Then` step.
3. When the statement opens with `WHEN <trigger>`, the converter shall emit `Given the system is running`, `When <trigger>` and one `Then` step.
4. When the statement opens with `WHILE <state>`, the converter shall emit `Given <state>` and one `Then` step.
5. When the statement opens with `WHERE <feature>`, the converter shall emit `Given <feature>` and one `Then` step.
6. When the statement opens with `IF <condition>`, the converter shall emit `Given the system is running`, `When <condition>` and one `Then` step without the `THEN` keyword.
7. When the statement opens with `WHILE <s>, WHEN <x>`, the converter shall emit `Given <s>`, `When <x>` and one `Then` step tagged `@complex`.
8. The converter shall keep the subject and the `shall` verb of the requirement in the `Then` step.

### REQ-SSP-002: Non-EARS statements are skipped, never invented
#### Acceptance Criteria
1. If a statement contains neither `shall` nor `debe`, then the converter shall omit it and list it under `skipped` with its requirement id and the reason.

### REQ-SSP-003: Output language follows the spec
#### Acceptance Criteria
1. Where `spec.json.language` is `es`, the converter shall write `# language: es` and the keywords `Escenario`, `Dado`, `Cuando`, `Entonces`.
2. Where `spec.json.language` is absent or not `es`, the converter shall write English keywords.

### REQ-SSP-004: Writing is explicit and never clobbers
#### Acceptance Criteria
1. When `--write` is absent, the CLI shall write no file and exit 0.
2. When `--write` is present and `acceptance.feature` does not exist or has identical content, the CLI shall write `.sdd/specs/<feature>/acceptance.feature` and exit 0.
3. If `--write` is present and `acceptance.feature` exists with different content, then the CLI shall leave the file unchanged and exit 1.
4. If the feature has no `requirements.md`, then the CLI shall exit 1 and name the missing file.

### REQ-SSP-005: Dangling task dependency
#### Acceptance Criteria
1. When the consistency report reads `tasks.md`, the report shall raise `TASK_DEPENDS_UNKNOWN` (error) for each `_Depends:_` id that names no task in the file.

### REQ-SSP-006: Duplicate task number
#### Acceptance Criteria
1. When the consistency report reads `tasks.md`, the report shall raise `TASK_DUPLICATE_ID` (error) for each numeric task id that appears more than once.

### REQ-SSP-007: Parallel task without boundary
#### Acceptance Criteria
1. When a task carries the `(P)` marker and no `_Boundary:_` in its line or its detail lines, the report shall raise `TASK_PARALLEL_WITHOUT_BOUNDARY` (warning).

### REQ-SSP-008: Leaf task without requirement
#### Acceptance Criteria
1. When a task has no sub-task and cites no requirement id in its line or its detail lines, the report shall raise `TASK_WITHOUT_REQUIREMENT` (warning).
2. The report shall not raise `TASK_WITHOUT_REQUIREMENT` for a parent task whose sub-tasks (`N.M`) exist.
