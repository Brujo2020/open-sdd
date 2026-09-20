- [x] 9. Generated artifacts of the brownfield change — _Requirements: REQ-BF-001, REQ-BF-002, REQ-BF-003, REQ-BF-005, REQ-BF-006_ — _Boundary:_ `tools/open-sdd/dist`_
  - The compiled CLI is committed so the published package and a git clone both run without a build.
  - _Evidence: `tools/open-sdd/dist/{core/{deltaSpec,constitution,reverseConstitution,rigor}.js,cli/commands/brownfield.js}` are rebuilt from the sources of this change; the drift check treats them as part of the declared boundaries._
- [x] 10. Fix the false ambient-drift paths — _Requirements: REQ-BF-003_ — _Boundary:_ `tools/open-sdd/src/core/git.ts`_
  - `getModifiedFiles` trimmed the whole `git status --porcelain` output, which stripped the leading space of the FIRST line only (the "modified, not staged" prefix is ` M`); `slice(3)` then removed a real character from that path, so the first file listed appeared as `ocs/...` and matched no declared boundary. The victim looked random because it was whichever file git listed first, and it produced false drift findings.
  - _Evidence: before the fix `getModifiedFiles` returned 27 parsed entries with 1 path absent from the raw porcelain output (`"ocs/PAPER-ALIGNMENT.md"`); after the fix 29/29 parsed entries match the raw output exactly with 0 discrepancies. Re-running `govern rigor` then reported real in-flight paths instead of a truncated one._

- [-] 12. Impact analysis of a change — _Requirements: REQ-BF-007_ — _Boundary:_ `tools/open-sdd/src/core/changeImpact.ts`, `tools/open-sdd/test/coreChangeImpact.test.ts`_
  - Dependents through the dependency graph, breaking changes from the previous export surface, migrations without rollback, integration points, API surface, and the declared scope versus the delta's targets.
  - Observable completion: a changed migration without rollback is an error and an unreadable source tree reports an unknown radius instead of a small one.

- [-] 13. Execution contracts as the regression oracle — _Requirements: REQ-BF-008_ — _Boundary:_ `tools/open-sdd/src/core/executionContract.ts`, `tools/open-sdd/test/coreExecutionContract.test.ts`, `.github/workflows/gates.yml`_
  - Discover the tests that cover the changed files, bind the contracts a delta declares, and report the changed files no test covers.
  - Observable completion: CI runs the oracle and a missing declared contract fails the build.

- [-] 14. Reuse-first as a checkable rule — _Requirements: REQ-BF-009_ — _Boundary:_ `tools/open-sdd/src/core/reuseFirst.ts`, `tools/open-sdd/test/coreReuseFirst.test.ts`_
  - Report existing symbols that match a proposed new symbol by name or variant, and treat a match above the threshold as a violation.
  - Observable completion: an exact match is a violation and a genuinely new symbol is not.

- [x] 15. Require the constitution at the commit and pull-request boundaries — _Requirements: REQ-BF-006_ — _Boundary:_ `tools/open-sdd/templates/hooks/pre-commit`, `.github/workflows/gates.yml`, `scripts/install-hooks.mjs`, `tools/open-sdd/src/cli/commands/paper.ts`_
  - The commit gate runs \`govern rigor --no-drift\` when the project declares a level, and CI runs the full assessment plus every delta validation.
  - Observable completion: a repository declaring Spec-Anchored without a constitution has its commit refused.
  - _Evidence: a throwaway repository declaring \`spec-anchored\` with no constitution exits 1 with "Constitución ausente: el nivel Spec-Anchored emite veredictos bloqueantes y estos deben citar autoridad, pero no hay principios en vigor que citar"; this repository (valid constitution) passes the same hook with exit 0. Two design defects were fixed to get here: the hook installer refused to refresh an older version of its own gate, and the drift aspect was blocking commits — drift is tautological at commit time (the change being committed IS the modification) and now runs at the pull-request boundary instead, with \`--except/--no-drift\` announcing the exclusion so it cannot be read as a passed check._

- [-] 16. One dashboard for the whole state — _Requirements: REQ-BF-011_ — _Boundary:_ `tools/open-sdd/src/core/status.ts`, `tools/open-sdd/src/cli/commands/status.ts`, `tools/open-sdd/test/coreStatus.test.ts`_
  - Constitution, specs, delta, contracts, constitutional alignment and level on one screen, plus the next command. Unknown sections are marked unknown, never healthy.
  - Observable completion: `open-sdd status` exits 0 on a healthy repository and `--check` exits 1 on a phantom principle.

- [-] 17. One entry point for an existing repository — _Requirements: REQ-BF-012_ — _Boundary:_ `tools/open-sdd/src/core/bootstrap.ts`, `tools/open-sdd/src/cli/commands/brownfield.ts`, `tools/open-sdd/test/coreBootstrap.test.ts`_
  - Composes reconnaissance, the descriptive constitution, the module responsibility map, the code-intelligence document and the ordered steps. Adopts the spec-kit bootstrap concept (issue #1436) reimplemented on this engine, not copied.
  - Observable completion: `brownfield bootstrap` prints the plan, and `--write` never overwrites an existing constitution.

- [-] 18. The constitution validates every spec — _Requirements: REQ-BF-013_ — _Boundary:_ `tools/open-sdd/src/core/specConstitution.ts`, `tools/open-sdd/test/coreSpecConstitution.test.ts`_
  - Declared principles, ignored principles, phantom authority (error), contradiction with a principle in force, and silence when the rule cannot decide.
  - Observable completion: a spec citing an unknown principle fails the check and the alignment ratio is 0 — not 1 — when nothing is declared.

- [-] 19. Teach the workflow where the agents read it — _Requirements: REQ-BF-014_ — _Boundary:_ `tools/open-sdd/templates`, `docs/guides/brownfield-quickstart.md`, `README.md`, `docs/claims/paper-claims.yaml`_
  - A skill with the five steps and the constitution as pivot, plus a quickstart that states what the tool does not do yet.
  - Observable completion: the skill exists for every skills-based agent as one identical variant and the claims registry stays at 0 broken.

- [-] 11. Document brownfield, the constitution and the three levels — _Requirements: REQ-BF-001, REQ-BF-002, REQ-BF-006, REQ-BF-010_ — _Boundary:_ `README.md`, `CLAUDE.md`, `AGENTS.md`, `CHANGELOG.md`, `docs`, `tools/open-sdd/templates`_
  - Rewrite gap G-12 with what is now built and what is not, add the new component rows and claims, write the brownfield workflow guide, and teach the brownfield commands to the shipped templates.
  - Observable completion: the claims registry stays at 0 broken and 0 outdated, and the traceability report states the divergences between the source documents and the implementation instead of hiding them.
# Implementation Plan

## Tasks

- [x] 1. Delta engine: ADSR model, validation and traceability — _Requirements: REQ-BF-001, REQ-BF-004_ — _Boundary:_ `tools/open-sdd/src/core/deltaSpec.ts`_
  - Parse and render the four sections; require delta-scoped ids, EARS statements, targets, the replaced behaviour on MODIFIED/REMOVED/RENAMED, and rationale plus contracts on REMOVED.
  - Trace requirements to tasks in both directions and report strangulation progress.
  - _Evidence: `node tools/open-sdd/dist/cli.js delta validate brownfield-support` → 0 errors; the delta parser ignores HTML comment blocks so a scaffold's commented example is not read as a requirement._

- [x] 2. The shared constitution model — _Requirements: REQ-BF-002_ — _Boundary:_ `tools/open-sdd/src/core/constitution.ts`_
  - Six-field anatomy, imposition levels, provenance descriptive|normative, amendment governance with a mandatory migration plan, citable authority, markdown round-trip.
  - _Evidence: `brownfield constitution --write` reports "ida y vuelta: 4/4 principios legibles"; the validator rejects a descriptive principle without evidence and warns when every principle is MUST._

- [x] 3. Reverse-engineered descriptive constitution — _Requirements: REQ-BF-002_ — _Boundary:_ `tools/open-sdd/src/core/reverseConstitution.ts`_
  - Detect the facts, evidence each principle, and record desired-but-absent practices as proposed amendments instead of principles.
  - _Evidence: the note `- [x] 3. Reverse-engineered descriptive constitution` produced C-STACK-FACT, C-API-COMPAT, C-BOUNDARIES (SHOULD) and C-REGRESSION-ORACLE with file-level evidence, plus AMD-REUSE-FIRST and AMD-INCREMENTAL-DOCS as proposals; the level-balance warning fired while every principle was MUST and disappeared once C-BOUNDARIES became SHOULD._

- [x] 4. Workspace-aware and configuration-aware reconnaissance — _Requirements: REQ-BF-003_ — _Boundary:_ `tools/open-sdd/src/core/reverseEngineering.ts`_
  - Merge evidence across nested manifests and detect tooling declared only in configuration files; report unknown instead of guessing.
  - _Evidence: `brownfield survey` on this repository changed from "JavaScript, no tests detected" to "TypeScript, npm, tsc, Vitest, 9 módulos"; the survey on a fresh empty directory reports `unknown`._

- [x] 5. Brownfield console surface — _Requirements: REQ-BF-005_ — _Boundary:_ `tools/open-sdd/src/cli/commands/brownfield.ts`, `tools/open-sdd/src/index.ts`_
  - `brownfield survey|constitution [--write]` and `delta init|validate|status|render`, wired into the dispatcher and the help text.
  - _Evidence: `brownfield survey`, `brownfield constitution --write`, `delta init`, `delta validate` and `delta status` all exit 0 and render expected output._

- [x] 6. Regression tests for the brownfield core and console — _Requirements: REQ-BF-001, REQ-BF-002, REQ-BF-003, REQ-BF-004, REQ-BF-005_ — _Boundary:_ `tools/open-sdd/test`_
  - Delta round-trip and validation, constitution fidelity, workspace scanning on a temporary monorepo fixture, and the CLI handlers with a fake IO.
  - _Evidence: `test/coreDeltaSpec.test.ts` and `test/coreBrownfield.test.ts` are added and the whole suite is re-run green; the measured file/test count is recorded in docs/PAPER-ALIGNMENT.md rather than predicted here._

- [x] 7. Dogfood the brownfield flow on this repository — _Requirements: REQ-BF-002, REQ-BF-004_ — _Boundary:_ `.sdd/steering`, `.sdd/specs/brownfield-support`_
  - Generate the repository's own descriptive constitution and describe this very change as a delta.
  - _Evidence: `.sdd/steering/constitution.md` written with 4 principles in force and 2 proposed amendments; this spec's `delta.md` validates with full traceability (5/5 requirements mapped)._

- [-] 8. The three rigor levels, with the constitution required — _Requirements: REQ-BF-006_ — _Boundary:_ `tools/open-sdd/src/core/rigor.ts`, `tools/open-sdd/src/cli/commands/paper.ts`, `tools/open-sdd/src/core/index.ts`, `tools/open-sdd/src/core/types.ts`, `.sdd/settings/rigor.json`, `tools/open-sdd/dist`_
  - Spec-First / Spec-Anchored / Spec-as-Source as a CUMULATIVE ladder whose default is fluid: Spec-First demands a valid constitution plus requirements in checkable EARS form, and each step up only adds (traceability and evidence binding, then contracts and regeneration). The constitution is required at every level because a blocking verdict must cite authority.
  - Observable completion: a project with no constitution fails the assessment at every level, the ladder activates 2 -> 4 -> 6 gates as it rises, and an unknown gate id in the configuration is rejected instead of ignored.
