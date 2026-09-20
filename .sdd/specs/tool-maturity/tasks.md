# Implementation Plan — tool-maturity

## Tasks

- [x] 1. MCP server over stdio exposing checks, artifacts and status — _Requirements: REQ-MAT-001_ — _Boundary:_ `tools/open-sdd/src/mcp/**`, `tools/open-sdd/test/mcpServer.test.ts`, `.sdd/specs/tool-maturity`
  - _Evidence: MCP handshake through the real CLI dispatch returns serverInfo open-sdd 3.0.2 with 11 tools and the resource families; absent resources answer -32002, never an empty string; 25 tests in test/mcpServer.test.ts + test/cliJsonOut.test.ts._
- [x] 2. `--json` on every command, one envelope shape — _Requirements: REQ-MAT-001_ — _Boundary:_ `tools/open-sdd/src/cli/**`
  - _Evidence: src/cli/jsonOut.ts defines one envelope shape and a one-line renderer; adoption is incremental and every command still on its previous shape is listed in the module header; 9 tests._
- [x] 3. `open-sdd init --agent --level --lang`, idempotent — _Requirements: REQ-MAT-002_ — _Boundary:_ `tools/open-sdd/src/cli/commands/init.ts`, `tools/open-sdd/test/init.test.ts`
  - _Evidence: init --write on a fresh git repository creates rigor.json + the descriptive constitution + the portable hook; a second run reports keep and an edited rigor.json stays byte-identical; an invalid --level exits 1 with the admitted list; 29 tests in test/cliInit.test.ts._
- [x] 4. `open-sdd doctor` with per-problem fixes — _Requirements: REQ-MAT-002_ — _Boundary:_ `tools/open-sdd/src/core/doctor.ts`, `tools/open-sdd/test/coreDoctor.test.ts`
  - _Evidence: 9 checks, each non-ok one carrying a concrete fix, everything unverifiable a warn containing "no se pudo comprobar"; --fix performs only the two safe idempotent repairs and never overwrites an existing settings file or a foreign hook; doctor reports 9 ok / 0 fail on a freshly governed repository; 43 tests in test/coreDoctor.test.ts._
- [-] 5. Multi-language module discovery (Maven, Gradle, Go, Rust, Python, .NET) — _Requirements: REQ-MAT-003_ — _Boundary:_ `tools/open-sdd/src/core/reverseEngineering.ts`, `tools/open-sdd/test/coreReverseEngineering.test.ts`
- [x] 6. Cross-platform commit gate without a POSIX shell dependency — _Requirements: REQ-MAT-004_ — _Boundary:_ `tools/open-sdd/templates/hooks/**`, `scripts/install-hooks.mjs`, `tools/open-sdd/test/hookPortability.test.ts`
  - _Evidence: The gate is Node (no bash constructs, dynamic import so the extensionless installed hook parses as CommonJS): invoked through git on a fixture, a clean commit exits 0 and a staged AWS example key exits 1 with C2 fail; CLI resolution never touches PATH; 14 tests in test/hookPortability.test.ts._
- [-] 7. Strict alignment mode in CI plus the constitutional ratchet — _Requirements: REQ-MAT-005_ — _Boundary:_ `tools/open-sdd/src/cli/commands/status.ts`, `.github/workflows/gates.yml`
- [-] 8. Waivers with owner and expiry — _Requirements: REQ-MAT-005, REQ-MAT-012_ — _Boundary:_ `tools/open-sdd/src/core/securityAllowlist.ts`, `.sdd/settings/security-allowlist.json`
- [-] 9. Audit evidence bundle with per-artifact hashes — _Requirements: REQ-MAT-006_ — _Boundary:_ `tools/open-sdd/src/cli/commands/audit.ts`, `tools/open-sdd/test/auditBundle.test.ts`
- [-] 10. GitHub Action, GitLab template and SARIF output — _Requirements: REQ-MAT-007_ — _Boundary:_ `action.yml`, `.github/workflows/gates.yml`, `docs/guides/ci-integration.md`
- [ ] 11. Distribution: `npx` path, registry publish with provenance, container image — _Requirements: REQ-MAT-008_ — _Boundary:_ `package.json`, `.github/workflows/publish.yml`, `Dockerfile`
- [-] 12. Guided tour and bilingual output — _Requirements: REQ-MAT-009_ — _Boundary:_ `tools/open-sdd/src/cli/commands/tour.ts`, `tools/open-sdd/src/cli/i18n.ts`
- [-] 13. One boundary vocabulary and manifest-aware API surface — _Requirements: REQ-MAT-010_ — _Boundary:_ `tools/open-sdd/src/core/bootstrap.ts`, `tools/open-sdd/src/core/reverseConstitution.ts`
- [-] 14. Delta merge-back into the base specification — _Requirements: REQ-MAT-010_ — _Boundary:_ `tools/open-sdd/src/core/deltaSpec.ts`, `tools/open-sdd/src/cli/commands/brownfield.ts`
- [-] 15. Constitutional adhesion score and trend — _Requirements: REQ-MAT-011_ — _Boundary:_ `tools/open-sdd/src/core/specConstitution.ts`, `tools/open-sdd/src/cli/commands/status.ts`
- [-] 16. Impact forecast and reuse-first enforced through MCP — _Requirements: REQ-MAT-013_ — _Boundary:_ `tools/open-sdd/src/core/changeImpact.ts`, `tools/open-sdd/src/mcp/**`
- [-] 17. Context pack per task — _Requirements: REQ-MAT-014_ — _Boundary:_ `tools/open-sdd/src/core/contextPack.ts`
- [-] 18. Operable spec-as-source repair loop — _Requirements: REQ-MAT-015_ — _Boundary:_ `tools/open-sdd/src/core/regeneration.ts`
- [x] 19. Constitution drafter with a human ratification gate — _Requirements: REQ-MAT-016_ — _Boundary:_ `tools/open-sdd/src/core/constitutionDraft.ts`, `tools/open-sdd/src/cli/commands/constitution.ts`, `tools/open-sdd/test/coreConstitutionDraft.test.ts`
  - _Evidence: brownfield constitution --draft writes constitution.draft.md marked not in force without touching the in-force file; govern constitution --evidence-pack emits what a host model needs; --ratify requires --by and a non-empty rationale, records the ratifier, and consumes the draft when nothing is pending; resolveAuthority no longer blesses a draft id; 22 tests._
- [-] 20. Advisor that keeps the constitution young — _Requirements: REQ-MAT-017_ — _Boundary:_ `tools/open-sdd/src/core/constitutionAdvice.ts`, `tools/open-sdd/test/coreConstitutionAdvice.test.ts`
