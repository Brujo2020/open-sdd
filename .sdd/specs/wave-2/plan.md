# Plan — wave-2

## Decisions

- **Axet path.** Verified by reading the Axet Plugin 3.0.0 VSIX (publisher `Ntt-Data`, 2026-10-21):
  a `LocalSkillsWatcher` always watches `.axet-plugin/skills/` and requires only a YAML frontmatter
  with `name`; the webview's slash menu merges local workflows, global workflows and those skills
  into its `custom` section. Workflows live in `.axetrules/workflows/` (named after the file, `.md`
  included), rules in `.axetrules/` plus `AGENTS.md`, hooks in `.axetrules/hooks/` (Cline events:
  TaskStart…TaskComplete, PreToolUse, PostToolUse, UserPromptSubmit, PreCompact). The slash menu (`b3e`) lists builtin commands and
  workflows only — skills are never in it (confirmed when the user saw no `/sdd` entries) — so the
  agent also writes one extensionless workflow per skill (`/sdd-spec-init`), each pointing at its skill. `TaskComplete` is not cancellable in the bundle; `PreToolUse` is, so the completion gate (REQ-W2-014)
  is a `PreToolUse` script that acts only on `attempt_completion`. A hook that exits non-zero is logged
  and ignored (`cancel:false`), so the script always exits 0 and blocks through its JSON — fail-closed.
  Evidence is the bundle's code, not a behavioural sentinel run in a live Axet session.
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
