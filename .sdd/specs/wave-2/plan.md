# Plan — wave-2

## Decisions

- **Axet path.** Axet.plugin (a Cline fork) reads workspace skills from `.axet-plugin/skills/<skill>/SKILL.md`
  (confirmed by the user from the Axet UI, 2026-10-21). Its Rules and Workflows tabs exist but their
  workspace paths are not verified, so nothing is written there; `AGENTS.md` carries the quickstart.
- **Cline path.** `.cline/skills/` is the recommended project directory (docs.cline.bot/customization/skills,
  fetched 2026-10-21). The existing `integrate cline` keeps its MCP registration; its skills layout moves
  from `.clinerules/sdd-*.md` prompt files to `.cline/skills/sdd-*/SKILL.md`.
- **Devin tree.** `tools/cc-sdd/templates/agents/devin-skills/` (17 `kiro-*` skills from upstream) is a
  strict subset of `_shared/skills` (27). Its only unique content is Devin-specific `run_subagent`
  wording; the shared skills already carry the "no multi-agent → sequential" fallback Axet needs.
  The tree is removed; docs keep Devin only where it describes the Windsurf→Devin docs move.
- **Cline hooks dropped.** The hooks page points to SDK plugins without a file contract; no gate is
  installed on an unverified contract.
- New agents reuse the `codebuddy-skills` pattern: shared skills tree + `_shared/docs/AGENTS.md` + settings.

## Components

| Requirement | Component |
|---|---|
| REQ-W2-001 | `docs/claims/paper-claims.yaml`, `src/agents/registry.ts` |
| REQ-W2-002, 009 | `src/cli/commands/init.ts` |
| REQ-W2-003 | `src/core/integrations.ts` |
| REQ-W2-004 | `tools/cc-sdd/` removed, `test/registryConsistency.test.ts` |
| REQ-W2-005 | `test/distSync.test.ts` |
| REQ-W2-006 | `vitest.config.ts` (root) |
| REQ-W2-007 | `src/cli/commands/help.ts` |
| REQ-W2-008 | `registry.ts`, `templates/manifests/{axet,cline}-skills.json`, `init.ts` |
| REQ-W2-010 | gates run command |
| REQ-W2-011..013 | new `src/core/trace.ts`, `src/cli/commands/{trace,explain,badge,report}.ts`, integrate |
