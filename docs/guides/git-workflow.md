# Strict Git Mode & SpecOps Workflow Guide

> "Let specs be the single source of truth. Allow implementation to flow only from approved specifications, validated rigorously and committed immutably."

## Overview

In traditional software development, Git tracks code while specifications remain scattered across wikis, issue trackers, or chat histories. Over time, code and specifications inevitably drift apart.

Open-SDD's **Strict Git Mode** (*SpecOps*) bridges this divide by making specifications **living source code** in Git:
- Specifications reside in `.sdd/specs/<feature>/`.
- Every SDLC phase gate is tied to deterministic Git actions: branch creation, spec approval commit/push, and implementation validation commit/push.
- Generative coding without an approved specification is strictly blocked.

---

## Configuration (`.sdd/settings/git.json`)

Configure Git automation behavior in your project:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "mode": "assisted",
  "branch_prefix": "feat/",
  "steering_branch": "main",
  "auto_branch": true,
  "auto_commit": true,
  "auto_push": false,
  "require_approved_spec": true,
  "commit_conventions": {
    "steering": "docs(steering): establish architecture and technical standards",
    "spec_init": "spec({{feature}}): initialize feature specification seed",
    "spec_approved": "spec({{feature}}): approve requirements, design, and tasks breakdown",
    "impl_complete": "feat({{feature}}): complete implementation verified against spec"
  }
}
```

### Operational Modes
- `assisted` (**default**): Branches and commits for you at each phase gate; never pushes. Safe starting point.
- `strict`: Implementation without an approved spec is blocked. Pairs with the `enterprise` profile.
- `off`: Manual Git management; Open-SDD writes files to disk without invoking Git commands.

> **`auto_push` ships as `false` on purpose.** Nothing reaches your remote unless you turn it on. Set `"auto_push": true` only when the branch protection on your remote is what you want Open-SDD pushing into.

### Relationship to profiles

`git.json` controls what happens to your repo; `governance.json` controls what blocks you.

| Profile | Suggested `git.mode` |
|---|---|
| `solo` / `team` | `assisted` |
| `enterprise` | `strict` |

---

## The 4 Git Milestones

```mermaid
sequenceDiagram
  autonumber
  actor User as Engineer / Architect
  participant Agent as AI Coding Agent
  participant Git as Git Repository (.sdd/ & src/)
  participant Remote as GitHub / Remote

  Note over User,Remote: Phase 0: Project Steering
  User->>Agent: /sdd-steering
  Agent->>Git: Write .sdd/steering/*.md
  Agent->>Git: git commit -m "docs(steering): ..."
  Agent->>Remote: git push origin main

  Note over User,Remote: Phase 1: Feature Spec Initiation
  User->>Agent: /sdd-spec-init <feature>
  Agent->>Git: git checkout -b feat/<feature>
  Agent->>Git: git commit -m "spec(<feature>): initialize..."

  Note over User,Remote: Phase 2: Documentary Triad Approval Lock
  User->>Agent: /sdd-spec-requirements, design, tasks
  User->>Agent: Approve Triad (spec.json: phase='approved')
  Agent->>Git: git commit -m "spec(<feature>): approve requirements, design, and tasks"
  Agent->>Remote: git push -u origin feat/<feature>

  Note over User,Remote: Phase 3: Strict Spec Enforcement & Implementation
  User->>Agent: /sdd-impl <feature>
  Agent->>Git: Verify spec.json (phase === 'approved')
  alt Spec is NOT approved
    Agent-->>User: ⛔ BLOCKED: Specs required before implementation
  else Spec IS approved
    Agent->>Git: Execute TDD implementation per task
  end

  Note over User,Remote: Phase 4: Verification & PR Generation
  User->>Agent: /sdd-validate-impl <feature>
  Agent->>Git: Run automated tests + Agentic QE invariants
  Agent->>Git: git commit -m "feat(<feature>): complete implementation verified..."
  Agent->>Remote: git push origin feat/<feature>
  Agent-->>User: Output Pull Request template with verification evidence
```

---

## Best Practices & Enterprise Compliance

1. **Specs Never Drift**: Because `spec(<feature>): approve...` precedes `feat(<feature>): implement...`, the Git commit history provides an immutable audit trail proving that architecture preceded implementation.
2. **Regulatory Traceability (EU AI Act & NIST AI RMF)**: Auditors can trace any code diff directly to its parent spec commit and human sign-off hash.
3. **Brownfield Safe**: When using `/sdd-getspecs`, existing codebases are reverse-engineered into *unapproved seeds*. Implementation cannot touch legacy modules until human review formally approves the seed.
