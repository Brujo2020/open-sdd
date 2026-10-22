# Implementation Plan — wave-2

## Tasks

- [ ] 1. Skill counts derived; CLM-027 green — _Requirements: REQ-W2-001_ — _Boundary:_ `docs/claims/paper-claims.yaml`, `tools/open-sdd/src/agents/registry.ts`
- [ ] 2. Unknown `--agent` lists valid ids — _Requirements: REQ-W2-002_ — _Boundary:_ `tools/open-sdd/src/cli/commands/init.ts`
- [ ] 3. Cline integration skills layout `.cline/skills/` — _Requirements: REQ-W2-003_ — _Boundary:_ `tools/open-sdd/src/core/integrations.ts`
- [ ] 4. Remove orphan devin tree; registry/manifest/template consistency test — _Requirements: REQ-W2-004_ — _Boundary:_ `tools/cc-sdd/`, `tools/open-sdd/test/registryConsistency.test.ts`
- [ ] 5. dist matches src test — _Requirements: REQ-W2-005_ — _Boundary:_ `tools/open-sdd/test/distSync.test.ts`
- [ ] 6. Root vitest config — _Requirements: REQ-W2-006_ — _Boundary:_ `vitest.config.ts`
- [ ] 7. Help host list from registry — _Requirements: REQ-W2-007_ — _Boundary:_ `tools/open-sdd/src/cli/commands/help.ts`
- [ ] 8. `axet-skills` and `cline-skills` agents + autodetect — _Requirements: REQ-W2-008_ — _Boundary:_ `tools/open-sdd/src/agents/registry.ts`, `tools/open-sdd/templates/manifests/`, `tools/open-sdd/src/cli/commands/init.ts`
- [ ] 9. Multi-agent `init --agent a,b` — _Requirements: REQ-W2-009_ — _Boundary:_ `tools/open-sdd/src/cli/commands/init.ts`
- [ ] 10. `gates run --summary` — _Requirements: REQ-W2-010_ — _Boundary:_ gates command
- [ ] 11. `trace --mermaid` and `explain` — _Requirements: REQ-W2-011_ — _Boundary:_ `tools/open-sdd/src/core/trace.ts`
- [ ] 12. `badge` and `report --html` — _Requirements: REQ-W2-012_ — _Boundary:_ `tools/open-sdd/src/cli/commands/`
- [ ] 13. `integrate vscode-tasks` — _Requirements: REQ-W2-013_ — _Boundary:_ integrate command
