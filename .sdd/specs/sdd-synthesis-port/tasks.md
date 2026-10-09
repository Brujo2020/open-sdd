# Implementation Plan — sdd-synthesis-port

## Tasks

- [x] 1. Gherkin converter — _Requirements: REQ-SSP-001, REQ-SSP-002, REQ-SSP-003_ — _Boundary:_ `tools/open-sdd/src/core/gherkin.ts`, `tools/open-sdd/test/coreGherkin.test.ts`
  - _Evidence: `test/coreGherkin.test.ts` 12 tests green — the six patterns (EN), Spanish triggers, a quoted `shall` and an inner comma kept in the condition, skips with a reason, `# language: es` keywords, byte-identical output on rerun. Dogfood: `requirements gherkin requirements-coach` → 46 scenarios, 0 skipped._
- [x] 2. Console `requirements gherkin` — _Requirements: REQ-SSP-004_ — _Boundary:_ `tools/open-sdd/src/cli/commands/requirements.ts`, `tools/open-sdd/src/cli/commands/help.ts`, `tools/open-sdd/test/cliRequirementsGherkin.test.ts` — _Depends:_ 1
  - _Evidence: `test/cliRequirementsGherkin.test.ts` — no `--write` writes nothing (exit 0); `--write` creates and is idempotent; a different `acceptance.feature` is left byte-identical and exits 1; missing `requirements.md` exits 1 naming the file._
- [x] 3. Task grammar checks — _Requirements: REQ-SSP-005, REQ-SSP-006, REQ-SSP-007, REQ-SSP-008_ — _Boundary:_ `tools/open-sdd/src/core/taskGrammar.ts`, `tools/open-sdd/test/coreTaskGrammar.test.ts`
  - _Evidence: `test/coreTaskGrammar.test.ts` 8 tests green — template-shaped file clean; dangling `_Depends:_` and duplicate numeric id are errors; word ids not compared; `(P)` without boundary and leaf task without citation warn; parent with sub-tasks exempt; numeric `_Requirements: 1_` counts, `{{…}}` does not._
- [x] 4. Wire task grammar into the consistency report — _Requirements: REQ-SSP-005, REQ-SSP-006, REQ-SSP-007, REQ-SSP-008_ — _Boundary:_ `tools/open-sdd/src/core/consistency.ts`, `tools/open-sdd/test/cliRequirementsGherkin.test.ts` — _Depends:_ 3
  - _Evidence: `checkConsistency` reports `TASK_DEPENDS_UNKNOWN` and records the `gramática de tareas` check (test in `test/cliRequirementsGherkin.test.ts`). `brownfield analyze` over the 5 existing specs of this repo: 0 new `TASK_*` findings. Full suite: 155 files / 2021 tests green._
