# Claude Code Subagents Workflow (Spec-Quick Focus)

> **Scope:** this page covers the legacy **`--claude-agent` / `--claude-code-agent`** install target, which uses static Subagent files under `.claude/agents/sdd/*.md` to accelerate `spec-quick`. If you installed with `--claude-skills` (or any other `--*-skills` flag) and are looking for how skills mode dispatches implementer / reviewer / debugger roles, see the [Skill Reference](skill-reference.md).

This guide explains how the **Claude Code Subagents** install target (`--claude-agent` / `--claude-code-agent`) accelerates the spec workflow via the `spec-quick` command. Other `/spec-*` commands reuse the same Subagents, but this document focuses on the spec-quick orchestration because it is the only Subagent-enabled command with its own control logic.

## Installation Recap

- Install with `npx @brujo2020/open-sdd@latest --claude-agent --lang <code>`.
- Files are placed under:
  - `.claude/commands/sdd/` – 12 high-level commands (spec, steering, validation).
  - `.claude/agents/sdd/` – 9 Subagent definitions used for deeper analysis, file expansion, and reporting.
  - `CLAUDE.md` – quickstart and usage tips.

## How `spec-quick` Orchestrates Subagents

`spec-quick` is a macro-command that calls four Subagents in sequence—`spec-init` (inline), `spec-requirements`, `spec-design`, and `spec-tasks`—to generate a brand-new spec in one run. Internally, the command follows the same instructions defined in `tools/open-sdd/templates/agents/claude-code-agent/commands/spec-quick.md`.

### Modes

- **Interactive (default)** – Stops after each phase and asks whether to continue. Ideal for first-time runs or complex features.
- **Automatic (`--auto`)** – Runs all phases without pausing, using TodoWrite to track progress. Best for quick drafts or low-risk features.

Both modes skip `/validate-gap` and `/validate-design`. The completion message reminds you to run these manually if the feature is risky.

### Phase Breakdown

| Phase | Triggered Subagent | What happens |
|-------|--------------------|--------------|
| 1. Initialize | Inline instructions (no Subagent) | Creates `.sdd/specs/{feature}/`, writes `spec.json` + `requirements.md` skeleton from templates. TodoWrite marks "Initialize spec" as complete. |
| 2. Requirements | `agents/spec-requirements.md` | Runs `/spec-requirements {feature}` to fill out requirements.md. In automatic mode, ignores "Next step" prompts from this Subagent and proceeds immediately. |
| 3. Design | `agents/spec-design.md` | Executes `/spec-design {feature} -y`, which generates/updates `research.md` (if needed) and `design.md`. TodoWrite now marks three phases complete. |
| 4. Tasks | `agents/spec-tasks.md` | Calls `/spec-tasks {feature} -y` to build `tasks.md` with Req coverage and P-wave labels. When finished, TodoWrite hits 4/4 complete and spec-quick prints the final summary. |

In automatic mode the command never pauses, even when Subagents emit their “次のステップ” (next step) message, which is intended for standalone usage. Interactive mode prompts after each phase (“Continue to requirements?”, “Continue to design?”, etc.).

### Outputs and Skipped Gates

Upon completion you get:

- `spec.json` (metadata)
- `requirements.md`
- `design.md` (with research-backed decisions)
- `tasks.md` (parallel-ready plan)

What it **doesn’t** do:
- No `/validate-gap` integration check
- No `/validate-design` quality gate
- No `/validate-impl` (implementation hasn’t started)

Plan to run at least the first two validation commands manually for brownfield work.

### Manual Subagent Invocation

Need to re-run just one phase? Mention `@agents-spec-design`, `@agents-spec-tasks`, etc. in Claude Code chat. These aliases were generated during install and map directly to `.claude/agents/sdd/*.md`.

## Recommended Usage Pattern

1. Run `npx @brujo2020/open-sdd@latest --claude-agent --lang <code>` to ensure Subagent assets exist.
2. Prepare Project Memory via `/steering` (and optionally `/steering-custom`) so Subagents inherit accurate architecture/product rules.
3. Use `spec-quick <feature> [--auto]` for rapid drafts, then review `requirements.md`, `design.md`, `tasks.md` just like the manual flow.
4. Run validation commands manually if the feature touches existing systems or critical boundaries.
5. Proceed with `/spec-impl` and `/spec-status` once the spec is approved.

## Customising Subagent Behaviour

1. **Start with shared templates/rules** – Update `{{SDD_DIR}}/settings/templates/*.md` and `{{SDD_DIR}}/settings/rules/*.md` to reflect team-specific checklists and review criteria, so that every agent and Subagent references the same single source of truth.
2. **Then adjust Subagent prompts if necessary** – add company-specific heuristics (prioritization, risk classification, testing policy, etc.) to `.claude/agents/sdd/*.md`.
3. **Tune command triggers** – edit the `call_subagent` section of `.claude/commands/sdd/*.md` to control invocation conditions and additional guardrails.
4. **Keep prompts concise** – the Task Tool context is short, so keep long explanations in the templates/rules and list only the essentials in the Subagent prompt.

## Troubleshooting

- **Subagent not triggering** – ensure you have installed with `--claude-agent` flag and that `.claude/agents/sdd/` exists.
- **Too many files analysed** – edit the file pattern expansion step in the relevant Subagent prompt to narrow the search.
- **Outputs differ from templates** – update `{{SDD_DIR}}/settings/templates` so that Subagent summaries point to the latest document sections.

## See Also

- [Skill Reference](skill-reference.md) — skills-mode workflow, including "Inside `/sdd-impl`" dispatch details and the Skills mode vs `--claude-agent` comparison
- [Spec-Driven Development Workflow](spec-driven.md)
- [Project README — Supported Agents](../../README.md#supported-agents)
