# Open-SDD: Agentic SDLC and Spec-Driven Development

Open-SDD: Model-agnostic Spec-Driven Development on an enterprise agentic SDLC.
Living specifications, Zero-Trust validation, and auditable architecture.

## Project Context

### Paths

This repository **is the tool**, so its paths are the tool's own source and templates. The paths the
skills *create in a target project* are listed separately, because in this checkout they may not
exist yet.

| Purpose | In this repository | In a target project (created by the skills) |
|---|---|---|
| Settings, rules, templates | `.sdd/settings/` | `.sdd/settings/` |
| Steering (project memory) | templates only: `.sdd/settings/templates/steering/` | `.sdd/steering/` (`product.md`, `tech.md`, `structure.md`) |
| Feature specs | `.sdd/specs/` | `.sdd/specs/<feature>/` |
| Memory (session ledgers) | not present | `.sdd/memory/` |
| CLI source + templates | `tools/open-sdd/src/`, `tools/open-sdd/templates/` | — |
| Compiled CLI | `tools/open-sdd/dist/cli.js` | — |

Do not look for steering or memory under `.sdd/` in this checkout until a skill has created them.

### Steering vs Specification

**Steering** (`.sdd/steering/`) - Guides AI with project-wide rules, architecture, and technology standards.
**Specs** (`.sdd/specs/`) - Formalizes the development lifecycle for individual features into an auditable Documentary Triad (`requirements.md`, `plan.md`, `tasks.md`; `design.md` is an accepted alias of `plan.md` — see `tools/open-sdd/src/core/triad.ts`).

### Active Specifications
- Check `.sdd/specs/` for active specifications
- Use `/sdd-spec-status [feature-name]` to check progress

## Development Guidelines
- Think in English, generate responses in English. All Markdown content written to project files (e.g., requirements.md, design.md, tasks.md, research.md, validation reports) MUST be written in the target language configured for this specification (see spec.json.language).
- **Specs are Living Documentation**: Stored and versioned natively in Git alongside source code. Specs never drift from code.

## Minimal Workflow
- Phase 0 (Steering): `/sdd-steering`, `/sdd-steering-custom`
- **Brownfield Bootstrap** (existing codebase, no `.sdd/` specs): `/sdd-getspecs [focus]` — reverse-engineers steering + roadmap + unapproved spec seeds from code; seeds must be reviewed, edited, and validated before approval.
- **Brownfield governance** (the existing code is the source of truth): run the console before specifying a change —
  - recon: `open-sdd brownfield survey .` — what the project already is (stack, tooling, modules, evidence)
  - constitution: `open-sdd brownfield constitution . --write` — the descriptive constitution in `.sdd/steering/constitution.md` (principles the code already obeys, each with evidence; desired-but-absent practices become proposed amendments)
  - delta: `open-sdd delta init <feature> "what changes"` then `open-sdd delta validate <feature>` — the contract of change (ADDED/MODIFIED/REMOVED/RENAMED, delta-scoped `REQ-<AREA>-<NNN>` ids)
  - analysis: `open-sdd brownfield contracts <feature> [--verify]` — the regression oracle (which tests protect the changed files, which files no contract covers; a green run with a declared contract missing is not a pass); `brownfield impact` for the blast radius and breaking changes; `brownfield reuse` for reuse-first candidates
  - rigor: declare the level in `.sdd/settings/rigor.json`; `open-sdd govern rigor` assesses the repository against it. The three levels are a **cumulative ladder** whose default is deliberately fluid: `spec-first` (the default) demands a valid constitution, requirements in checkable EARS form and gates C1+C2; each step up only *adds* (Spec-Anchored → +delta/traceability/evidence/drift, C1+C2+C3+C6; Spec-as-Source → +contracts/regeneration, C1…C6). The constitution is the authority a blocking verdict cites, so it is **required (blocking) at every level**, and you raise the bar in `.sdd/settings/rigor.json`, never by lowering what the floor already checks.
- Discovery (new work/ideas): `/sdd-discovery "idea"` — identifies action path (Greenfield or Brownfield extension), writes `brief.md` and `roadmap.md`
- Phase 1 (Specification):
  - Single spec: `/sdd-spec-quick {feature} [--auto]` or step-by-step:
    - `/sdd-spec-init "description"`
    - `/sdd-spec-requirements {feature}`
    - `/sdd-validate-gap {feature}` (gap & blast-radius analysis on existing codebase)
    - `/sdd-spec-design {feature} [-y]`
    - `/sdd-validate-design {feature}` (design review gate)
    - `/sdd-spec-tasks {feature} [-y]`
  - Multi-spec: `/sdd-spec-batch` — initializes all specs from roadmap.md in parallel dependency waves
- Phase 2 (Implementation): `/sdd-impl {feature} [tasks] [--review required|inline|off]`
  - Without task numbers: autonomous mode (subagent per task + independent review + verify gate)
  - With task numbers: manual mode (selected tasks only in main context)
  - `/sdd-validate-impl {feature}` (standalone feature-level verification; supports Agentic QE autonomous validation fleets)
- Governance & Compliance: `/sdd-audit {feature}` — generates auditable compliance report (EU AI Act, NIST RMF, ADR genealogy)
- Progress check: `/sdd-spec-status {feature}` (use anytime)

## Skills Structure

The skills **shipped by this repository** are source templates; the CLI copies the selected agent's
set into a target project.

- Templates (this repository): `tools/open-sdd/templates/agents/<agent>/skills/sdd-*/SKILL.md`
  — 168 `SKILL.md` files across 8 skills-based agents (21 skills each).
- Installed in a target project: the agent's layout directory, e.g. `.claude/skills/sdd-*/SKILL.md`
  (Claude Code Skills), `.agent/skills/` (Antigravity), `.cursor/skills/` (Cursor).
- The agent registry that defines every layout and alias flag is
  `tools/open-sdd/src/agents/registry.ts`.

Skills in this checkout:
- Each skill is a directory with a `SKILL.md` file.
- This repository's own agent skills live under `.agents/skills/` (`sdd-help`, `open-sdd-new-agent`).
- Skills run inline with access to conversation context and delegate parallel research to subagents.
- `sdd-review` — task-local adversarial review protocol
- `sdd-debug` — root-cause-first debug protocol
- `sdd-verify-completion` — fresh-evidence gate before success or completion claims
- **If there is even a 1% chance a skill applies to the current task, invoke it.**

## Zero-Trust console (reference architecture)

The CLI implements the governance model of *Orquestación SDD-First Multiagente para Desarrollo
Enterprise* (rev. 3, Sept 2026). The normative traceability report — every paper section, its
implementing symbol, and every declared gap — is
**[docs/PAPER-ALIGNMENT.md](docs/PAPER-ALIGNMENT.md)**. Read it before claiming the code does
something the paper describes.

```bash
node tools/open-sdd/dist/cli.js gates chain --profile regulated   # resolve the chain
node tools/open-sdd/dist/cli.js gates crosswalk                   # G1–G21 → C1–C7/O1–O7 + residue
node tools/open-sdd/dist/cli.js gates enforcement                 # levels A–D, ceiling vs floor
node tools/open-sdd/dist/cli.js gates run                         # run the chain (exit 1 if it fails)
node tools/open-sdd/dist/cli.js govern conformance                # C0–C3 with per-invariant evidence
node tools/open-sdd/dist/cli.js govern hitl                       # quantified HIL thresholds
node tools/open-sdd/dist/cli.js govern discipline                 # §9.7 decidable properties over the diff
node tools/open-sdd/dist/cli.js assure threats                    # OWASP/ATLAS + regulatory crosswalk
node tools/open-sdd/dist/cli.js waves <feature>                   # wave plan + git commands
node tools/open-sdd/dist/cli.js floor status                    # is the commit/merge floor installed?
```

Non-negotiables when using that model:

- **Never restate the paper's prototype measurements** (κ = 0.86 n=15, C4 FPR 20.0 %, the 2.1–2.2 s
  sweep) as measurements of this repository. See gaps G-01/G-02 in `docs/PAPER-ALIGNMENT.md`.
- **C7/Karpathy is vacuous** (`inspects: false`): activation without measurement, reported as such.
- **No model backend ships**, so C5 intent alignment reports `mode=degraded` and is not evidence.
- The claims registry (`docs/claims/paper-claims.yaml`) is executed by the product CLI:
  `node tools/open-sdd/dist/cli.js assure claims --verify`. It exits `1` only on a `broken` claim, and
  it must stay at `0 broken`.

## Development Rules
- 3-phase approval workflow: Requirements → Design → Tasks → Implementation
- Human review required each phase; use `-y` only for intentional fast-track
- Karpathy Guidelines (Think before coding, Simplicity first, Surgical changes, Goal-driven execution) are mandatory.
- Autonomous Quality Engineering: Agentic QE (`agentic-qe.dev`, PACTS framework) enabled for boundary-scoped metamorphic invariant testing.
- Strict Git Mode: specs are mandatory and implementation without an approved specification is
  blocked **under the `team` and `enterprise` governance profiles**; the default `solo` profile runs
  its checks and reports without blocking (`tools/open-sdd/src/core/governance.ts`).
- **The enforcement floor is installed, not merely declared.** `npm install` wires a pre-commit hook
  (`tools/open-sdd/templates/hooks/pre-commit`) that runs C1/C2/C3 against the **staged index** and
  fails closed if the CLI is missing; `.github/workflows/gates.yml` runs the full chain on every pull
  request. Never bypass with `--no-verify` — declare a genuine false positive in
  `.sdd/settings/security-allowlist.json` with a reason, which is the channel an audit can read.
  Level A remains a ceiling: no behavioural sentinel has verified write-time blocking in any host.
- Keep steering current and verify alignment with `/sdd-spec-status`.

## Steering Configuration
- Load entire `.sdd/steering/` as project memory when it exists
- Default files: `product.md`, `tech.md`, `structure.md`
- Custom files are supported (managed via `/sdd-steering-custom`)
- Shipped templates: `.sdd/settings/templates/steering/`
