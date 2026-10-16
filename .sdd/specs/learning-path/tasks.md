# Implementation Plan — learning-path

## Tasks

- [x] 1. Essentials help and `--all` — _Requirements: REQ-LRN-001, REQ-LRN-002_ — _Boundary:_ `tools/open-sdd/src/cli/commands/help.ts`, `tools/open-sdd/src/index.ts`, `tools/open-sdd/test/cliLearningPath.test.ts`
  - _Evidence: test/cliLearningPath.test.ts — `--help`, `-h` and `help` print the essentials (31 lines ≤ 40, START → DAILY LOOP → EXISTING CODE → PROOF → NEXT); `--help --all`, `help --all` and `help all` print the full index byte-identical to `renderFullHelp()`._
- [x] 2. `help workflow` — _Requirements: REQ-LRN-003, REQ-LRN-004_ — _Boundary:_ `tools/open-sdd/src/cli/commands/help.ts`, `tools/open-sdd/test/cliLearningPath.test.ts`
  - _Evidence: test/cliLearningPath.test.ts — five situations, five "done when:" lines; every `open-sdd <cmd> [<sub>]` named by the essentials and the workflow is in KNOWN_COMMANDS and STRICT_SUBCOMMANDS._
- [x] 3. Pointers to the path — _Requirements: REQ-LRN-005, REQ-LRN-006_ — _Boundary:_ `tools/open-sdd/src/index.ts`, `tools/open-sdd/src/cli/commands/help.ts`, `tools/open-sdd/test/cliSddScore.test.ts`, `tools/open-sdd/test/cliLearningPath.test.ts`
  - _Evidence: the score door ends on "aprende el flujo: open-sdd help workflow · comandos esenciales: open-sdd --help" (cliSddScore, 2 tests); `statu` exits 2 naming `--help --all` and `help workflow`; the full index leads its examples with `up --write` and has no "Apple-grade"._
- [x] 4. Released version in the bundle — _Requirements: REQ-LRN-007_ — _Boundary:_ `tools/open-sdd/package.json`, `tools/open-sdd/package-lock.json`, `tools/open-sdd/test/cliLearningPath.test.ts`
  - _Evidence: the workspace manifest equals the root (3.4.0); `audit bundle pay-flow --json` from the checkout reports tool.version 3.4.0 (it reported 3.0.2 before)._
- [x] 5. `init <slug> --write` hint — _Requirements: REQ-LRN-008_ — _Boundary:_ `tools/open-sdd/src/cli/commands/init.ts`, `tools/open-sdd/test/cliLearningPath.test.ts`
  - _Evidence: `init pay-flow --write` in an empty directory exits 1 and names `open-sdd init pay-flow` (without --write)._
- [x] 6. A requirements stub the coach accepts once filled — _Requirements: REQ-LRN-009_ — _Boundary:_ `tools/open-sdd/src/core/specManager.ts`, `tools/open-sdd/test/cliLearningPath.test.ts`
  - _Evidence: the unedited stub has double-brace markers and ≥ 1 finding; filled in its own shape, `requirements review --json` returns 0 findings and exit 0 (the old stub drew EARS-008, VER-006 and SET-005 on text nobody wrote)._
