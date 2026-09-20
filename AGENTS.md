# Agentic SDLC and Spec-Driven Development

SDD-style Spec-Driven Development on an agentic SDLC

## Project Memory
Project memory keeps persistent guidance (steering, specs notes, component docs) so Antigravity honors your standards each run. Treat it as the long-lived source of truth for patterns, conventions, and decisions.

- Use `.sdd/steering/` for project-wide policies: architecture principles, naming schemes, security constraints, tech stack decisions, api standards, etc.
- Use local `AGENTS.md` files for feature or library context (e.g. `src/lib/payments/AGENTS.md`): describe domain assumptions, API contracts, or testing conventions specific to that folder.
- Specs notes stay with each spec (under `.sdd/specs/`) to guide specification-level workflows.

## Project Context

### Paths

This repository **is the tool** (the open-sdd CLI and its templates). The paths below distinguish
what lives here from what the install creates in a target project.

| Purpose | In this repository | In a target project (created by the install) |
|---|---|---|
| Settings, rules, templates | `.sdd/settings/` | `.sdd/settings/` |
| Steering (project memory) | templates only: `.sdd/settings/templates/steering/` | `.sdd/steering/` (`product.md`, `tech.md`, `structure.md`) |
| Feature specs | `.sdd/specs/` | `.sdd/specs/<feature>/` |
| Antigravity skills | `tools/cc-sdd/templates/agents/antigravity-skills/skills/sdd-*/SKILL.md` | `.agent/skills/sdd-*/SKILL.md` |
| CLI source + compiled CLI | `tools/cc-sdd/src/`, `tools/cc-sdd/dist/cli.js` | — |

### Steering vs Specification

**Steering** (`.sdd/steering/`) - Guide AI with project-wide rules and context
**Specs** (`.sdd/specs/`) - Formalize development process for individual features

### Active Specifications
- Check `.sdd/specs/` for active specifications
- Use `/sdd-spec-status [feature-name]` to check progress

## Development Guidelines
<!-- DEV_GUIDELINES: injected at install time with language-specific guidelines (npx @brujo2020/open-sdd@latest --lang <code>) -->
- Think in English, generate responses in English. All Markdown content written to project files (e.g., requirements.md, design.md, tasks.md, research.md, validation reports) MUST be written in the target language configured for this specification (see spec.json.language).

## Minimal Workflow
- Phase 0 (optional): `/sdd-steering`, `/sdd-steering-custom`
- **Brownfield bootstrap** (existing codebase, no `.sdd/` specs): `/sdd-getspecs` — reverse-engineers steering + roadmap + spec seeds from code; then `/sdd-spec-requirements` or `/sdd-spec-batch`
- **Brownfield governance** (the existing code is the source of truth): run the console before specifying a change —
  - recon: `open-sdd brownfield survey .` — what the project already is (stack, tooling, modules, evidence)
  - constitution: `open-sdd brownfield constitution . --write` — the descriptive constitution in `.sdd/steering/constitution.md` (principles the code already obeys, each with evidence; desired-but-absent practices become proposed amendments)
  - delta: `open-sdd delta init <feature> "what changes"` then `open-sdd delta validate <feature>` — the contract of change (ADDED/MODIFIED/REMOVED/RENAMED, delta-scoped `REQ-<AREA>-<NNN>` ids)
  - analysis: `open-sdd brownfield contracts <feature> [--verify]` — the regression oracle (which tests protect the changed files, which files no contract covers; a green run with a declared contract missing is not a pass); `brownfield impact` for the blast radius and breaking changes; `brownfield reuse` for reuse-first candidates
  - rigor: declare the level in `.sdd/settings/rigor.json`; `open-sdd govern rigor` assesses the repository against it. The three levels are a **cumulative ladder** whose default is deliberately fluid: `spec-first` (the default) demands a valid constitution, requirements in checkable EARS form and gates C1+C2; each step up only *adds* (Spec-Anchored → +delta/traceability/evidence/drift, C1+C2+C3+C6; Spec-as-Source → +contracts/regeneration, C1…C6). The constitution is the authority a blocking verdict cites, so it is **required (blocking) at every level**, and you raise the bar in `.sdd/settings/rigor.json`, never by lowering what the floor already checks.
- Discovery: `/sdd-discovery "idea"` — determines action path, writes brief.md + roadmap.md for multi-spec projects
- Phase 1 (Specification):
  - Single spec: `/sdd-spec-quick {feature} [--auto]` or step by step:
    - `/sdd-spec-init "description"`
    - `/sdd-spec-requirements {feature}`
    - `/sdd-validate-gap {feature}` (optional: for existing codebase)
    - `/sdd-spec-design {feature} [-y]`
    - `/sdd-validate-design {feature}` (optional: design review)
    - `/sdd-spec-tasks {feature} [-y]`
  - Multi-spec: `/sdd-spec-batch` — creates all specs from roadmap.md in parallel by dependency wave
- Phase 2 (Implementation): `/sdd-impl {feature} [tasks] [--review required|inline|off]`
  - Without task numbers: autonomous mode (subagent per task + independent review + final validation)
  - With task numbers: manual mode (selected tasks in main context, still reviewer-gated before completion)
  - `--review off` skips task-local review; use it intentionally and keep `/sdd-validate-impl {feature}` as the final quality gate
  - `/sdd-validate-impl {feature}` (standalone re-validation)
- Progress check: `/sdd-spec-status {feature}` (use anytime)

## Skills Structure
The Antigravity skills shipped by this repository are templates; the install copies them into a
target project:

- Templates here: `tools/cc-sdd/templates/agents/antigravity-skills/skills/sdd-*/SKILL.md`
- Installed target: `.agent/skills/sdd-*/SKILL.md` (21 skills; the prefix is `sdd-`, not `kiro-`)
- Each skill is a directory with a `SKILL.md` file
- The agent registry defining every layout and alias flag is `tools/cc-sdd/src/agents/registry.ts`
- Use `/skills` to inspect currently available skills
- Invoke a skill directly with `/sdd-<skill-name>`
- **If there is even a 1% chance a skill applies to the current task, invoke it.** Do not skip skills because the task seems simple.
- `sdd-review` — task-local adversarial review protocol used by reviewer subagents
- `sdd-debug` — root-cause-first debug protocol used by debugger subagents
- `sdd-verify-completion` — fresh-evidence gate before success or completion claims

> Antigravity does not support programmatic sub-agent dispatch. Skills that reference parallel sub-agents will execute sequentially in the main context.

## Zero-Trust console (reference architecture)

The CLI implements the governance model of *Orquestación SDD-First Multiagente para Desarrollo
Enterprise* (rev. 3, Sept 2026). The traceability report — every paper section, its implementing
symbol, and every declared gap — is **[docs/PAPER-ALIGNMENT.md](docs/PAPER-ALIGNMENT.md)**.

```bash
node tools/cc-sdd/dist/cli.js gates chain --profile regulated   # resolve the gate chain
node tools/cc-sdd/dist/cli.js gates crosswalk                   # G1–G21 → C1–C7/O1–O7 + residue
node tools/cc-sdd/dist/cli.js gates enforcement                 # levels A–D, ceiling vs floor
node tools/cc-sdd/dist/cli.js gates run                         # run the chain (exit 1 if it fails)
node tools/cc-sdd/dist/cli.js govern conformance                # C0–C3 with per-invariant evidence
node tools/cc-sdd/dist/cli.js assure threats                    # OWASP/ATLAS + regulatory crosswalk
node tools/cc-sdd/dist/cli.js waves <feature>                   # wave plan + git commands
```

The paper's prototype measurements (κ = 0.86 n=15, C4 FPR 20.0 %, the 2.1–2.2 s sweep) are **not**
measurements of this repository, and C7/Karpathy is reported as vacuous rather than as a passing
control. Details in gaps G-01/G-02 and G-06 of the report.

## Development Rules
- 3-phase approval workflow: Requirements → Design → Tasks → Implementation
- Human review required each phase; use `-y` only for intentional fast-track
- Keep steering current and verify alignment with `/sdd-spec-status`
- Specs are mandatory under the `team` and `enterprise` governance profiles; the default `solo`
  profile runs its checks and reports without blocking (`tools/cc-sdd/src/core/governance.ts`)
- The enforcement floor is installed: a pre-commit hook runs C1/C2/C3 over the staged index and a
  pull-request workflow runs the full chain. Declare false positives in
  `.sdd/settings/security-allowlist.json` with a reason instead of using `--no-verify`.
- Follow the user's instructions precisely, and within that scope act autonomously: gather the necessary context and complete the requested work end-to-end in this run, asking questions only when essential information is missing or the instructions are critically ambiguous.

## Steering Configuration
- Load entire `.sdd/steering/` as project memory when it exists
- Default files: `product.md`, `tech.md`, `structure.md`
- Custom files are supported (managed via `/sdd-steering-custom`)
- Shipped templates: `.sdd/settings/templates/steering/`
