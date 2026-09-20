# Agentic SDLC and Spec-Driven Development

SDD-style Spec-Driven Development on an agentic SDLC

## Project Context

### Paths
- Steering: `{{SDD_DIR}}/steering/`
- Specs: `{{SDD_DIR}}/specs/`

### Steering vs Specification

**Steering** (`{{SDD_DIR}}/steering/`) - Guide AI with project-wide rules and context
**Specs** (`{{SDD_DIR}}/specs/`) - Formalize development process for individual features

### Active Specifications
- Check `{{SDD_DIR}}/specs/` for active specifications
- Use `/sdd-spec-status [feature-name]` to check progress

## Development Guidelines
{{DEV_GUIDELINES}}

## Minimal Workflow
- Phase 0 (optional): `/sdd-steering`, `/sdd-steering-custom`
- **Brownfield bootstrap** (existing codebase, no `.sdd/` specs): `/sdd-getspecs` — reverse-engineers steering + roadmap + spec seeds from code; then `/sdd-spec-requirements` or `/sdd-spec-batch`
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
Skills are located in `.claude/skills/sdd-*/SKILL.md`
- Each skill is a directory with a `SKILL.md` file
- Skills run inline with access to conversation context
- Skills may delegate parallel research to subagents for efficiency
- Additional files (templates, examples) can be added to skill directories
- `sdd-review` — task-local adversarial review protocol used by reviewer subagents
- `sdd-debug` — root-cause-first debug protocol used by debugger subagents
- `sdd-verify-completion` — fresh-evidence gate before success or completion claims
- **If there is even a 1% chance a skill applies to the current task, invoke it.** Do not skip skills because the task seems simple.

## Development Rules
- 3-phase approval workflow: Requirements → Design → Tasks → Implementation
- Human review required each phase; use `-y` only for intentional fast-track
- Keep steering current and verify alignment with `/sdd-spec-status`
- Follow the user's instructions precisely, and within that scope act autonomously: gather the necessary context and complete the requested work end-to-end in this run, asking questions only when essential information is missing or the instructions are critically ambiguous.

## Steering Configuration
- Load entire `{{SDD_DIR}}/steering/` as project memory
- Default files: `product.md`, `tech.md`, `structure.md`
- Custom files are supported (managed via `/sdd-steering-custom`)

## Zero-Trust console

This project carries a governance console (the `open-sdd` CLI). When a change needs a verdict rather
than an opinion, run it from the project root:

| Command | What it answers |
|---|---|
| `open-sdd gates chain` | Which controls are declared for this project, and which are executable |
| `open-sdd gates crosswalk` | Which logical gates each executable check imposes, and the residue no check covers |
| `open-sdd gates run --base <ref>` | Run the declared chain against a change; exits 1 when it fails |
| `open-sdd floor status` | Is the commit/merge enforcement floor installed? |
| `open-sdd govern conformance` | The conformity level (C0–C3) with per-invariant evidence |
| `open-sdd govern hitl` | The quantified human-in-the-loop escalation thresholds |
| `open-sdd assure claims --verify` | Decide every documentation claim by its verifier's exit code |
| `open-sdd waves <feature>` | The transactional wave plan and the git commands that materialise it |
| `open-sdd brownfield survey [target]` | What the existing project already is: stack, tooling, modules and the evidence for each |
| `open-sdd brownfield constitution [target] [--write]` | The descriptive constitution (principles the code obeys + proposed amendments) |
| `open-sdd delta init\|validate\|status <feature>` | The contract of change (ADSR): scaffold, validate ids/EARS/contracts, traceability and strangulation |
| `open-sdd brownfield contracts <feature> [--verify]` | The regression oracle: which tests protect the changed files, and which changed files no contract covers |
| `open-sdd brownfield impact \| reuse <feature>` | The change's reachable set and breaking changes; the symbols a reuse-first search would have found first |

Brownfield rigor comes in three levels — Spec-First, Spec-Anchored and Spec-as-Source — and from
Spec-Anchored upward a valid constitution is required (blocking), because it is the authority every
blocking verdict cites. The three levels are a cumulative ladder and the default is fluid: Spec-First (the default) demands a valid constitution and requirements in checkable EARS form (gates C1+C2), Spec-Anchored adds the delta, traceability, evidence binding and drift detection (C1+C2+C3+C6), and Spec-as-Source adds declared contracts and regeneration (C1...C6).

Two caveats to state rather than paper over: **C7/Karpathy is reported as vacuous** (it runs without
inspecting anything, so it is activation without measurement, not a passing control), and with **no
model backend configured, intent alignment (C5) reports `mode=degraded`** and is explicitly not
evidence. Install the enforcement floor into this project with `open-sdd floor install . --ci`
(commit hook + pull-request gate matrix).

Run `open-sdd --help` for the full command surface, or invoke the `sdd-help` skill.
