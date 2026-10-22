# Implementation Plan — wave-2

## Tasks

- [x] 1. Skill counts derived; CLM-027 green — _Requirements: REQ-W2-001_ — _Boundary:_ `docs/claims/paper-claims.yaml`, `tools/open-sdd/src/agents/registry.ts`
  - _Evidence: CLM-027 is now a structural invariant (every skills tree equals `_shared`); `assure claims --verify` 64 verified / 0 broken; adding a stray skill dir turns it broken._
- [x] 2. Unknown `--agent` lists valid ids — _Requirements: REQ-W2-002_ — _Boundary:_ `tools/open-sdd/src/cli/commands/init.ts`
  - _Evidence: `init --agent nope` exits 1 with "Agente desconocido" and the id list (test/wave2Weaknesses.test.ts)._
- [x] 3. Cline integration skills layout `.cline/skills/` — _Requirements: REQ-W2-003_ — _Boundary:_ `tools/open-sdd/src/core/integrations.ts`
  - _Evidence: cline row is `.cline/skills/sdd-*/SKILL.md` mode skills; `integrate cline` maps to cline-skills._
- [x] 4. Remove orphan devin tree; registry/manifest/template consistency test — _Requirements: REQ-W2-004_ — _Boundary:_ `tools/cc-sdd/`, `tools/open-sdd/test/wave2Weaknesses.test.ts`
  - _Evidence: tools/cc-sdd removed (17 kiro-* skills, subset of _shared); 4 consistency tests pass._
- [x] 5. dist matches src test — _Requirements: REQ-W2-005_ — _Boundary:_ `tools/open-sdd/test/wave2Weaknesses.test.ts`
  - _Evidence: a fresh tsc build into a temp dir equals dist/ (shebang aside)._
- [x] 6. Root vitest config — _Requirements: REQ-W2-006_ — _Boundary:_ `vitest.config.mjs`
  - _Evidence: `npx vitest run` at the root: 155 files / 2040 tests pass (was 54 false failures)._
- [x] 7. Help host list from registry — _Requirements: REQ-W2-007_ — _Boundary:_ `tools/open-sdd/src/cli/commands/help.ts`
  - _Evidence: `help` lists every row of HOST_INTEGRATIONS (was a hard-coded 10 of 22)._
- [x] 8. `axet-skills` and `cline-skills` agents + autodetect — _Requirements: REQ-W2-008_ — _Boundary:_ `tools/open-sdd/src/agents/registry.ts`, `tools/open-sdd/templates/manifests/`, `tools/open-sdd/src/cli/commands/init.ts`
  - _Evidence: built CLI `--axet` / `--cline` install 27 skills in .axet-plugin/skills and .cline/skills plus AGENTS.md; init detects .axet-plugin/ and .cline/; Axet 3.0.0 VSIX read: its skills watcher lists them in the / menu._
- [x] 9. Multi-agent `init --agent a,b` — _Requirements: REQ-W2-009_ — _Boundary:_ `tools/open-sdd/src/cli/commands/init.ts`
  - _Evidence: `--agent cline-skills,axet-skills --skills --write` installs both; one unknown id writes nothing._
- [x] 10. `gates run --summary` — _Requirements: REQ-W2-010_ — _Boundary:_ `tools/open-sdd/src/core/gateSummary.ts`, `tools/open-sdd/src/cli/commands/paper.ts`, `.github/workflows/gates.yml`, `action.yml`
  - _Evidence: Markdown table appended; missing path + unset env exits 1 before running; enabled in the PR workflow and the Action._
- [x] 11. `trace --mermaid` and `explain` — _Requirements: REQ-W2-011_ — _Boundary:_ `tools/open-sdd/src/core/trace.ts`, `tools/open-sdd/src/cli/commands/insight.ts`
  - _Evidence: 4 tests; `explain` keeps gate codes and adds REQ ids; trace exits 1 on an uncovered requirement._
- [x] 12. `badge` and `report --html` — _Requirements: REQ-W2-012_ — _Boundary:_ `tools/open-sdd/src/core/badge.ts`, `tools/open-sdd/src/core/trace.ts`
  - _Evidence: deterministic SVG; HTML has no script or network, escapes spec text; stdout artifacts carry no score footer._
- [x] 13. `integrate vscode-tasks` — _Requirements: REQ-W2-013_ — _Boundary:_ `tools/open-sdd/src/core/vscodeTasks.ts`
  - _Evidence: create, merge by label (user entries kept), keep on rerun, refuse JSON with comments._
- [x] 14. Axet PreToolUse completion gate — _Requirements: REQ-W2-014_ — _Boundary:_ `tools/open-sdd/src/core/axetHook.ts`, `tools/open-sdd/src/cli/commands/init.ts`
  - _Evidence: 6 tests run the rendered script with Node: other tools → cancel:false; gate pass → cancel:false; gate fail → cancel:true with output, exit 0; missing CLI → cancel:true; foreign hook refused; runs under a type:module package. Contract read from the Axet 3.0.0 VSIX; not run in a live Axet session._
- [x] 15. Axet workflows so `/sdd-*` autocompletes — _Requirements: REQ-W2-015_ — _Boundary:_ `tools/open-sdd/templates/agents/axet-skills/workflows/`, `tools/open-sdd/templates/manifests/axet-skills.json`
  - _Evidence: user saw no `/sdd` entries with skills only; the 3.0.0 bundle's menu (`b3e`) lists builtin + local/global/remote workflows, never skills. Its own menu and expansion code, run over an `--axet` install, yields 27 `/sdd-*` entries and expands `/sdd-spec-init`; 3 sync tests. Axet re-reads the folder only on opening the ⚖ panel (`refreshRules`) or starting a task, not on window reload; the installer's completion guide now says so._

