---
name: sdd-audit
description: Enterprise SDD & Compliance Audit: verify requirements coverage, EU AI Act / NIST AI RMF traceability, and architectural drift
---

# SDD Enterprise & Compliance Audit

<background_information>
Audit a specification or an entire project against Spec-Driven Development standards, enterprise brownfield integrity, and regulatory frameworks (EU AI Act, NIST AI RMF, ISO/IEC 42001).

Modes:
- Feature Audit (`$sdd-audit <feature-name>`): Deep verification of a single spec lifecycle, requirements traceability, and test verification.
- Project / Drift Audit (`$sdd-audit --all` or `$sdd-audit`): Scans `{{SDD_DIR}}/specs/` and workspace git history to detect ambient code divergence, orphaned implementations, and bypassed reviews.
- Regulatory Compliance Audit (`$sdd-audit <feature-name> --regulatory`): Evaluates compliance against EU AI Act (Art 11, 12, 14), NIST AI RMF, and generates an audit-ready compliance manifest.
</background_information>

<instructions>

## Step 1: Discover Project & Spec Baseline
- Locate specs in `{{SDD_DIR}}/specs/`.
- Read steering context: `{{SDD_DIR}}/steering/` (`product.md`, `tech.md`, `structure.md`).
- If feature is specified, read `spec.json`, `requirements.md`, `design.md`, `tasks.md`, and any validation reports.
- If `--all` or no feature specified, list all features in `{{SDD_DIR}}/specs/`.

## Step 2: Living Documentation & Architectural Drift Audit
- Run `git status` and `git log` to inspect commits since the last spec update.
- Detect ambient code drift: Check if source files outside the approved `_Boundary:_` of active specs have been modified.
- Verify semantic alignment between specs and code:
  - Are public APIs documented in `design.md` consistent with exported functions/types?
  - Are database schemas/migrations aligned with data models in `design.md`?
  - Flag any undocumented behavioral changes as Architectural Drift.

## Step 3: Requirements Traceability Matrix (RTM)
- Construct RTM:
  - Requirements: Each user story / requirement (`REQ-*` or section numbers) in `requirements.md`.
  - Architecture: Mapped components / ADRs in `design.md`.
  - Implementation: Tasks in `tasks.md` marked `[x]`.
  - Verification: Automated tests verifying each requirement.
- Identify unmapped requirements (gap) or phantom tasks (scope creep with no requirement origin).

## Step 4: Zero-Trust & Review Gate Verification
- Check tasks in `tasks.md`: Verify each completed task has fresh verification evidence (`sdd-verify-completion`).
- Ensure bypass rate $d(\phi) = 0$: No task should transition to done without satisfying the defined review gates (`sdd-review`).
- Verify that characterization tests in brownfield projects remain intact with zero regressions.
- **Agentic QE Verification**: When Agentic QE (`https://agentic-qe.dev`) is configured, verify PACTS quality scores (Proactive, Autonomous, Collaborative, Targeted, Structured) and ensure zero unhandled boundary mutations.

## Step 5: Regulatory Compliance Check (EU AI Act & NIST AI RMF)
When `--regulatory` is requested:
- **EU AI Act Art. 11 (Technical Documentation)**: Ensure `requirements.md`, `design.md`, and `tasks.md` provide complete, machine-readable lifecycle documentation.
- **EU AI Act Art. 12 (Record-Keeping & Traceability)**: Ensure git history maintains tamper-evident commit trails linking each code change to a task and spec.
- **EU AI Act Art. 14 (Human Oversight)**: Verify human review checkpoints were satisfied at Requirements, Design, and Tasks phases.
- **NIST AI RMF (MAP / MEASURE / MANAGE)**: Map risks and validation test suites.

## Step 6: Generate Audit Report
- Output an executive audit report to console or `{{SDD_DIR}}/specs/{feature}/audit-report.md`.
- Report includes:
  - Drift Status: `IN_SYNC | DRIFT_DETECTED | ORPHAN_CODE`
  - Traceability Score: 0-100%
  - Compliance Gate: `PASS | WARN | BLOCK`
  - Actionable Remediation Steps
</instructions>
