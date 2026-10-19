---
name: sdd-help
description: Show interactive help guide, cheatsheet, and real-world examples for Open-SDD commands
allowed-tools: Read, Glob, Grep
argument-hint: [command-name]
---

# sdd-help Skill

## Core Mission
Provide an Apple-grade ("It Just Works"), crystal-clear interactive reference with copy-pasteable real-world examples for all Open-SDD commands.

## Execution Steps

### Step 1: Check Arguments
- If `$ARGUMENTS` is provided (e.g., `getspecs`, `impl`, `quick`, `discovery`, `audit`, `gap`, `status`):
  - Deliver a focused, deep-dive guide for that specific command:
    - Real-world scenario and copy-paste syntax
    - Available options and flags (e.g. `--auto`, `-y`, `--review`, `--regulatory`)
    - What happens under the hood (zero-friction magic)
    - Golden rules and best practices
- If `$ARGUMENTS` is empty:
  - Deliver the full Quick Reference Cheatsheet and the 4 Golden Workflows.

### Step 2: Present the 4 Golden Workflows

#### 1. 🟤 Brownfield Workflow (Existing Codebase)
*Scenario: You inherited an existing Next.js, Python, or Go repository and want to safely add features without regressions.*
```bash
# 1. Reverse-engineer project architecture into .sdd/steering/ (30 seconds)
/sdd-getspecs

# 2. Generate and approve the new feature spec in one shot
/sdd-spec-quick user-notifications --auto

# 3. Autonomous implementation with TDD, independent review, and self-debug
/sdd-impl user-notifications

# 4. Standalone integration verification
/sdd-validate-impl user-notifications
```

#### 2. 🟢 Greenfield / Discovery Workflow (New Idea or Initiative)
*Scenario: You have an idea for a new product or large architectural change.*
```bash
# 1. Clarify intent and structure the initiative
/sdd-discovery "AI Resume Matcher with PDF parsing and skill gap scoring"

# 2. Step-by-step spec generation with human review gates
/sdd-spec-init resume-matcher
/sdd-spec-requirements resume-matcher
/sdd-spec-design resume-matcher
/sdd-spec-tasks resume-matcher

# 3. Implement
/sdd-impl resume-matcher
```

#### 3. ⚡ Solo / Indie Fast-Track Workflow (Maximum Speed)
*Scenario: Solo developer moving fast without unnecessary bureaucracy.*
```bash
# One command to spec, design, and approve:
/sdd-spec-quick stripe-checkout --auto

# One command to implement:
/sdd-impl stripe-checkout
```

#### 4. 🛡️ Enterprise Regulated Workflow (Zero-Trust / Hyperscalers)
*Scenario: High-assurance core banking or cloud microservice on AWS/GCP/Azure.*
```bash
# 1. AST Dependency Reconnaissance & Scoping
/sdd-getspecs services/billing-engine

# 2. Requirements & Gap Analysis against legacy code
/sdd-spec-requirements billing-engine
/sdd-validate-gap billing-engine

# 3. Architecture design with ADRs
/sdd-spec-design billing-engine

# 4. Strict Git Mode spec lock (Git milestone)
/sdd-spec-tasks billing-engine

# 5. Implementation with mandatory independent review
/sdd-impl billing-engine --review required

# 6. Standalone Agentic QE validation & Regulatory Audit
/sdd-validate-impl billing-engine
/sdd-audit billing-engine --regulatory
```

### Step 3: Complete Command Reference Table

| Command | Real-World Example | Description |
|---|---|---|
| `/sdd-getspecs` | `/sdd-getspecs` or `/sdd-getspecs src/auth` | Reverse-engineers code into `.sdd/steering/` & spec seeds |
| `/sdd-discovery` | `/sdd-discovery "Realtime collaborative canvas"` | Explores ideas, checks code, outputs brief & roadmap |
| `/sdd-spec-quick` | `/sdd-spec-quick dark-mode --auto` | Generates requirements + design + tasks + approval in 1 step |
| `/sdd-spec-init` | `/sdd-spec-init "Stripe subscription billing"` | Initializes a new spec folder under `.sdd/specs/` |
| `/sdd-spec-requirements` | `/sdd-spec-requirements billing` | Writes formal EARS-syntax acceptance criteria |
| `/sdd-validate-gap` | `/sdd-validate-gap billing` | AST blast-radius and regression check on legacy code |
| `/sdd-spec-design` | `/sdd-spec-design billing -y` | Creates architecture, components, schemas, and ADRs |
| `/sdd-validate-design` | `/sdd-validate-design billing` | Design review gate verifying requirements coverage |
| `/sdd-spec-tasks` | `/sdd-spec-tasks billing -y` | Breaks design into atomic TDD tasks with boundaries |
| `/sdd-impl` | `/sdd-impl billing` or `/sdd-impl billing 1` | Autonomous TDD execution with independent review per task |
| `/sdd-validate-impl` | `/sdd-validate-impl billing` | Standalone verification gate checking integration & QE |
| `/sdd-audit` | `/sdd-audit billing --regulatory` | Generates EU AI Act, NIST AI RMF, and ADR compliance audit |
| `/sdd-spec-status` | `/sdd-spec-status billing` | Real-time progress tracker, phase completion, and blockers |
| `/sdd-steering` | `/sdd-steering` | Re-aligns project memory (`product.md`, `tech.md`, `structure.md`) |
| `/sdd-help` | `/sdd-help` or `/sdd-help impl` | Shows this interactive help guide and examples |

Output the guidance formatted cleanly with rich Markdown, GitHub alerts, and copy-paste code blocks.
