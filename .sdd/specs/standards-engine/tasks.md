# Implementation Plan — standards-engine

## Tasks

- [ ] 1. The catalogue model and its loader — _Requirements: REQ-STD-001_ — _Boundary:_ `tools/open-sdd/src/core/standards.ts`, `tools/open-sdd/test/coreStandards.test.ts`
  - A typed entry (id, category, severity, blocking, applies_to, standard, source, detect, message, remedy, evidence, calibrated) and a loader that rejects a missing required field **by name**.
- [ ] 2. Seed the catalogue from what already exists — _Requirements: REQ-STD-001, REQ-STD-002_ — _Boundary:_ `.sdd/settings/standards/**`, `tools/open-sdd/templates/settings/standards/**`, `tools/open-sdd/test/coreStandardsSeed.test.ts`
  - Harvest the `ears.ts` diagnostics, the two Mechanical Checks sections and the EARS patterns; wire the EARS entries to the `ears.ts` implementation so the two cannot diverge.
- [ ] 3. Render `rules/*.md` from the catalogue — _Requirements: REQ-STD-002_ — _Boundary:_ `tools/open-sdd/src/core/standardsRender.ts`, `.sdd/settings/rules/**`, `tools/open-sdd/test/coreStandardsRender.test.ts`
  - Deterministic rendering plus a drift report that names the entry that disagrees with a hand-edited file.
- [ ] 4. The `standards` console — _Requirements: REQ-STD-003_ — _Boundary:_ `tools/open-sdd/src/cli/commands/standards.ts`, `tools/open-sdd/test/cliStandards.test.ts`
  - `list`, `show <id>`, `explain <id>` (offline), `check [--json]`, `fix <id> [--apply]`, all inside the single JSON envelope.
- [ ] 5. Findings always carry a remedy or a question — _Requirements: REQ-STD-004, REQ-STD-009_ — _Boundary:_ `tools/open-sdd/src/core/standards.ts`, `tools/open-sdd/test/coreStandardsDeadEnds.test.ts`
  - A test enumerates every emitted finding kind and fails if any lacks a `fix:` or a `question:`; format failures name `file:line:column`.
- [ ] 6. Advisory-by-default and the calibration gate — _Requirements: REQ-STD-005_ — _Boundary:_ `tools/open-sdd/src/core/standards.ts`, `tools/open-sdd/test/coreStandardsCalibration.test.ts`
  - A standard without a corpus reports advisory and cannot block; declaring a corpus publishes recall and false-positive rate.
- [ ] 7. Wire the requirements subset into C1 and add C8 — _Requirements: REQ-STD-006_ — _Boundary:_ `tools/open-sdd/src/core/gateRunner.ts`, `tools/open-sdd/src/core/gateCatalog.ts`, `tools/open-sdd/test/coreGateRunner.test.ts`, `tools/open-sdd/test/coreGateCatalog.test.ts`
  - C1 runs the requirements subset; C8 is advisory; an uninspectable control renders `skipped`, never `passed`.
- [ ] 8. Adjudication in the existing allowlist — _Requirements: REQ-STD-007_ — _Boundary:_ `tools/open-sdd/src/core/securityAllowlist.ts`, `.sdd/settings/security-allowlist.json`, `tools/open-sdd/test/coreSecurityAllowlist.test.ts`
  - Reason + owner + expiry required; an unused suppression is reported; an expired waiver stops applying and is named.
- [ ] 9. Graded remedies and guarded application — _Requirements: REQ-STD-008_ — _Boundary:_ `tools/open-sdd/src/cli/commands/standards.ts`, `tools/open-sdd/test/cliStandardsFix.test.ts`
  - Only `machine-applicable` remedies auto-apply; a meaning-changing rewrite requires explicit confirmation.
- [ ] 10. The drift sentinel behind the rigour level — _Requirements: REQ-STD-010_ — _Boundary:_ `tools/open-sdd/src/core/driftCheck.ts`, `tools/open-sdd/src/core/rigor.ts`, `tools/open-sdd/test/coreDriftCheck.test.ts`
  - Bind requirement ids to declared globs; report an uncovered path; advisory at spec-first, blocking at spec-anchored; waivers carry owner and expiry.
- [ ] 11. Stable, block-allocated identifiers — _Requirements: REQ-STD-011_ — _Boundary:_ `tools/open-sdd/src/core/stableIds.ts`, `tools/open-sdd/src/cli/commands/brownfield.ts`, `tools/open-sdd/test/coreStableIds.test.ts`
  - `ids audit --base <ref>` reports `ID-MUTATED` and `ID-LOST` with git evidence; never renumber.
- [ ] 12. The reuse gate, advisory until calibrated — _Requirements: REQ-STD-012_ — _Boundary:_ `tools/open-sdd/src/core/reuseFirst.ts`, `tools/open-sdd/src/core/deltaSpec.ts`, `tools/open-sdd/test/coreReuseFirst.test.ts`
  - Build the symbol index; report a new symbol with no reuse evidence; surface near-signature candidates with their location.
- [ ] 13. Documentation and the claim it earns — _Requirements: REQ-STD-001, REQ-STD-003_ — _Boundary:_ `docs/guides/standards.md`, `README.md`, `docs/claims/paper-claims.yaml`, `tools/open-sdd/templates`, `.sdd/specs/**`, `docs/EVOLUTION-PLAN.md`
  - Teach the console where the agents read it; register the verifiable claim; keep the counts generated, never hand-written.
