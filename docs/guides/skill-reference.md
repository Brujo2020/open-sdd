# Skill Reference

Comprehensive reference for the modern **Open-SDD** skills workflow across all 8 supported AI coding agents (Claude Code, Cursor, Codex, Copilot, Windsurf, OpenCode, Gemini CLI, and Antigravity).

---

## Start Here

Use this matrix to identify which Open-SDD skill to execute:

| You want to... | Start with | Typical next step |
|---|---|---|
| Get interactive help, recipes, cheatsheets | `/sdd-help` | Follow guided recipe |
| Reverse-engineer an existing / brownfield repo | `/sdd-getspecs` | `/sdd-spec-requirements` or `/sdd-spec-batch` |
| Route a new idea or greenfield feature | `/sdd-discovery` | `/sdd-spec-init` or `/sdd-spec-batch` |
| Create a single feature spec (fast-track) | `/sdd-spec-quick` | `/sdd-impl` |
| Initialize a specification step-by-step | `/sdd-spec-init` | `/sdd-spec-requirements` |
| Write EARS requirements | `/sdd-spec-requirements` | `/sdd-validate-gap` or `/sdd-spec-design` |
| Quantify blast-radius on existing codebase | `/sdd-validate-gap` | `/sdd-spec-design` |
| Create technical architecture & contracts | `/sdd-spec-design` | `/sdd-validate-design` |
| Review architectural design quality | `/sdd-validate-design` | `/sdd-spec-tasks` |
| Break down into tasks with boundaries | `/sdd-spec-tasks` | `/sdd-impl` |
| Initialize multiple specs in parallel DAG waves | `/sdd-spec-batch` | Review generated specs |
| Implement tasks (parallel waves or sequential) | `/sdd-impl` | `/sdd-validate-impl` |
| Validate feature integration (Agentic QE / PACTS) | `/sdd-validate-impl` | `/sdd-audit` |
| Audit architectural drift & regulatory compliance | `/sdd-audit` | Fix drift or export compliance report |
| Check spec status and progress | `/sdd-spec-status` | Resume next recommended phase |
| Manage persistent project memory | `/sdd-steering` | `/sdd-steering-custom` |

---

## Core Workflow Skills

### `/sdd-help`
Interactive in-chat guide and cheat sheet for all commands, options, and recipes.
- Explains syntax and flags (`--parallel`, `--regulatory`, `--json`).
- Recommends workflows for greenfield vs. brownfield codebases.

### `/sdd-getspecs`
Universal Brownfield Reverse-Engineering engine:
- Traverses AST and imports to deduce architecture without manual cataloging.
- Bootstraps `.sdd/steering/` (`product.md`, `tech.md`, `structure.md`) and `.sdd/steering/roadmap.md`.
- Generates unapproved spec seeds (`brief.md`, `spec.json`, EARS stubs) requiring human review and approval.

### `/sdd-discovery`
Unified entry point for new features, requests, or initiatives:
- Determines decomposition strategy (single spec, multiple specs, or direct implementation).
- Writes `brief.md` and generates roadmap dependencies.

### `/sdd-impl`
Autonomous and parallel task implementation engine:
- **Parallel Wave Scheduling (`--parallel`)**: Dispatches subagents in concurrent waves where file boundaries are strictly disjoint ($\text{Boundary}(T_A) \cap \text{Boundary}(T_B) = \emptyset$), eliminating merge conflicts and race conditions.
- **Dynamic Role Dispatch**:
  - **Implementer**: Fresh context with Task Brief, executing TDD (RED → GREEN) under the Feature Flag Protocol.
  - **Reviewer (`sdd-review`)**: Independent evaluation of `git diff`, tests, and boundaries.
  - **Debugger (`sdd-debug`)**: Isolated root-cause analysis (max 2 rounds) on blockers.
- **`sdd-verify-completion`**: Fresh-evidence gate before marking any task complete (`[x]`).

### `/sdd-validate-impl`
Feature-level verification gate:
- Re-validates the full test suite and cross-task contracts.
- Discovers and runs autonomous invariant testing via **Agentic QE** (`agentic-qe.dev`, PACTS framework) when available.

### `/sdd-audit`
Continuous architectural compliance engine:
- Compares ambient code with `.sdd/specs/` to prevent architectural decay.
- Builds the Requirements Traceability Matrix (RTM).
- Audits compliance with **EU AI Act** (Art. 11 Technical Documentation, Art. 12 Record-Keeping, Art. 14 Human Oversight) and **NIST AI RMF**.

---

## Supporting Gate Skills

- **`sdd-review`**: Adversarial task-local code review verifying boundary scope, test validity, and spec fidelity.
- **`sdd-debug`**: Clean-context root-cause investigation triggered on failures to prevent context pollution loops.
- **`sdd-verify-completion`**: Verifies fresh execution evidence before any success claim is reported.
