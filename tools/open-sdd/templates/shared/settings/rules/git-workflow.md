# Strict Git & SpecOps Workflow

## Core Philosophy: Spec-as-Code & Single Source of Truth

1. **Specs are Living Source Code**: Specifications in `.sdd/specs/<feature>/` are versioned directly in Git alongside the codebase. Code never moves faster than its specification.
2. **Spec-First, Code-Second**: In Strict Git Mode (`mode: "strict"` in `.sdd/settings/git.json`), generative implementation is strictly prohibited without an approved specification.
3. **Traceable Git Provenance**: Every phase gate in the SDLC corresponds to an immutable Git milestone (branch switch, spec lock commit, implementation verified commit).

---

## The Strict Git Lifecycle

### Phase 0: Steering Governance
- **Target Branch**: `main` (or configured `steering_branch`).
- **Action**: When `/sdd-steering` or `/sdd-steering-custom` creates or updates architecture, technology, or structure guidelines:
  - Stage: `git add .sdd/steering/`
  - Commit: `docs(steering): establish architecture and technical standards`
  - Push (if `auto_push: true`): `git push origin main`

### Phase 1: Feature Initialization
- **Trigger**: `/sdd-spec-init <feature>` or `/sdd-getspecs <feature>`
- **Branch Action**:
  - Check current branch. If not already on `feat/<feature>`, create and switch:
    ```bash
    git checkout -b feat/<feature>
    ```
  - Stage initialized seed: `git add .sdd/specs/<feature>/`
  - Commit: `spec(<feature>): initialize feature specification seed`

### Phase 2: The Documentary Triad Approval Lock (Spec Gate)
- **Trigger**: `/sdd-spec-tasks <feature>` completes, or user explicitly approves the specification triad:
  - `requirements.md` (EARS criteria approved)
  - `design.md` (Architecture & file structure plan approved)
  - `tasks.md` (Decomposition with `_Boundary:_` approved)
  - `spec.json` sets `phase: "approved"` and all three approval flags to `true`.
- **Git Milestone**:
  - Stage spec files: `git add .sdd/specs/<feature>/`
  - Commit: `spec(<feature>): approve requirements, design, and tasks breakdown`
  - Push: `git push -u origin feat/<feature>`
  - Output notice: `[STRICT GIT MODE] Specification approved and locked on feat/<feature>. Implementation authorized.`

### Phase 3: Strict Spec Enforcement (Pre-Implementation Gate)
- **Trigger**: `/sdd-impl <feature>`
- **Enforcement Check**:
  - Read `.sdd/specs/<feature>/spec.json`.
  - If `git.json` has `mode: "strict"`:
    - Verify `phase === "approved"`.
    - Verify `approvals.requirements.approved === true`.
    - Verify `approvals.design.approved === true`.
    - Verify `approvals.tasks.approved === true`.
  - **If ANY check fails**:
    - **ABORT AND BLOCK IMMEDIATELY**:
      ```
      [BLOCKED - STRICT SPEC ENFORCEMENT]
      Cannot generate implementation code for feature '{feature}'.
      Living specifications are the single source of truth.
      Missing approved documentation triad in .sdd/specs/{feature}/spec.json.
      Run /sdd-spec-requirements, /sdd-spec-design, and /sdd-spec-tasks to approve specs before implementing.
      ```

### Phase 4: Implementation & Validation Complete Gate
- **Trigger**: `/sdd-validate-impl <feature>` (or completion of autonomous `/sdd-impl`)
- **Verification Requirement**: All deterministic unit/integration tests and Agentic QE invariant tests must pass.
- **Git Milestone**:
  - Stage all implementation and test files: `git add .`
  - Commit: `feat(<feature>): complete implementation verified against spec`
  - Push: `git push origin feat/<feature>`
  - Generate Pull Request summary for GitHub linking:
    - Problem & Desired Outcome (from `brief.md`)
    - Functional Requirements (from `requirements.md`)
    - Architectural Decisions (from `design.md`)
    - Completed Tasks with boundaries (from `tasks.md`)
    - Verification Evidence & Proof Matrix (from `sdd-validate-impl` / `sdd-audit`)
