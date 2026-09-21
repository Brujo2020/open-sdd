# Implementation Plan — requirements-coach

## Tasks

- [ ] 1. The deterministic check runner — _Requirements: REQ-RQC-001, REQ-RQC-003_ — _Boundary:_ `tools/open-sdd/src/core/requirementsCoach.ts`, `tools/open-sdd/test/coreRequirementsCoach.test.ts`
  - Load the applicable checks from the standards catalogue; run them over the declared artifacts; emit findings with id, severity, span, `file:line:column`, basis and remedy.
- [ ] 2. Seed the eight families from the stored catalogue — _Requirements: REQ-RQC-001_ — _Boundary:_ `.sdd/settings/standards/**`, `tools/open-sdd/test/coreRequirementsFamilies.test.ts`
  - Encode the 42 checks of `docs/guides/requirements-quality-catalog.md` as catalogue entries with their default tiers; assert the family counts.
- [ ] 3. Findings never dead-end — _Requirements: REQ-RQC-003, REQ-RQC-006_ — _Boundary:_ `tools/open-sdd/src/core/requirementsCoach.ts`, `tools/open-sdd/test/coreRequirementsDeadEnds.test.ts`
  - Every emitted finding carries a remedy or a question; the ASK-THE-HUMAN triggers (undefined actor, undecided threshold, two-way term, doubtful necessity) produce a question naming the datum.
- [ ] 4. Governance split: deterministic gates, model advises — _Requirements: REQ-RQC-002, REQ-RQC-011_ — _Boundary:_ `tools/open-sdd/src/core/requirementsCoach.ts`, `tools/open-sdd/src/core/gateRunner.ts`, `tools/open-sdd/test/coreRequirementsAuthority.test.ts`
  - Attribute every finding to its instrument; a model-derived finding is advisory and cannot block; with no backend configured, model controls report degraded and leave the pass count.
- [ ] 5. Calibration harness and reported metrics — _Requirements: REQ-RQC-004_ — _Boundary:_ `tools/open-sdd/bench/**`, `docs/MEASUREMENTS.md`, `tools/open-sdd/test/coreRequirementsCalibration.test.ts`
  - A labelled defect corpus; per-family recall and false-positive rate measured and published; promotion to blocking refused without a recorded measurement.
- [ ] 6. Executable checklists — _Requirements: REQ-RQC-005_ — _Boundary:_ `tools/open-sdd/src/core/checklist.ts`, `tools/open-sdd/templates/specs/checklist.md`, `tools/open-sdd/test/coreChecklist.test.ts`
  - Items declare `cmd` / `artifact` / `property` / `trace`; `checklist verify` executes them and stores a digest; a `[x]` without a digest fails the commit gate.
- [ ] 7. Non-functional requirement shape — _Requirements: REQ-RQC-007_ — _Boundary:_ `.sdd/settings/standards/**`, `tools/open-sdd/test/coreNfrShape.test.ts`
  - Six-part quality-attribute scenario; percentile plus window for operational targets; an absolute target with no error budget is advisory.
- [ ] 8. Traceability findings — _Requirements: REQ-RQC-008_ — _Boundary:_ `tools/open-sdd/src/core/specConstitution.ts`, `tools/open-sdd/src/core/reuseFirst.ts`, `tools/open-sdd/test/coreTraceability.test.ts`
  - Orphan requirement, requirement with no downstream evidence, and gold-plated code with no requirement.
- [ ] 9. The one-page review surface — _Requirements: REQ-RQC-009_ — _Boundary:_ `tools/open-sdd/src/core/specReview.ts`, `tools/open-sdd/src/cli/commands/requirements.ts`, `tools/open-sdd/test/coreSpecReview.test.ts`
  - Word-level diffs per requirement with tasks, the tests that would fail and a risk score; non-zero exit on an unapproved change.
- [ ] 10. Injection handling and the local backend boundary — _Requirements: REQ-RQC-010_ — _Boundary:_ `tools/open-sdd/src/core/requirementsCoach.ts`, `.sdd/settings/standards/**`, `tools/open-sdd/test/coreRequirementsInjection.test.ts`
  - Instruction-shaped spec content is a finding and escalates to a human; the reviewer runs with no secrets and no network.
- [ ] 11. The console — _Requirements: REQ-RQC-003, REQ-RQC-009_ — _Boundary:_ `tools/open-sdd/src/cli/commands/requirements.ts`, `tools/open-sdd/test/cliRequirements.test.ts`
  - `requirements review <feature>`, `requirements checklist <feature> [--verify]`, `requirements fix <feature> --apply <id>`, `review <feature> --base <ref>`, all with `--json`.
- [ ] 12. Locale contract — _Requirements: REQ-RQC-012_ — _Boundary:_ `tools/open-sdd/src/cli/i18n.ts`, `tools/open-sdd/src/cli/commands/requirements.ts`, `tools/open-sdd/test/cliLocaleRefusal.test.ts`
  - Ids, keys and fix commands stay English under every locale; an untranslated locale is refused by name and the translated list is printed.
- [ ] 13. Teach the coach and register the claim — _Requirements: REQ-RQC-003, REQ-RQC-004_ — _Boundary:_ `docs/guides/requirements-quality-catalog.md`, `docs/claims/paper-claims.yaml`, `README.md`, `.sdd/specs/**`, `docs/EVOLUTION-PLAN.md`, `tools/open-sdd/templates/agents/_shared/skills/sdd-spec-requirements/SKILL.md`
  - The skill teaches the coach where the agents read it; the catalogue's status moves from research input to enforced entries; the claim is registered.
