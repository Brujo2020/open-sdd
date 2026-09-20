---
name: sdd-getspecs
description: Brownfield entry point for existing codebases. Reverse-engineers project structure into .sdd/ steering, roadmap, and spec seeds (brief.md + spec.json). Use when adopting open-sdd on a project that has code but no specs, or when onboarding to an unfamiliar brownfield repo.
metadata:
  shared-rules: "getspecs-principles.md"
---


# Get Specs (Brownfield Reverse Engineering)

<background_information>
**Role**: Bootstrap open-sdd on brownfield (existing) projects without rewriting the codebase.

**Mission**:
- Understand what the project already is (tech, architecture, modules, conventions)
- Materialize that understanding as durable `.sdd/` artifacts
- Propose natural spec boundaries as seeds — not full requirements yet

**Success Criteria**:
- Steering captures patterns and principles, not file catalogs
- Spec seeds have clear boundaries derived from code reality
- User can continue with `$sdd-spec-requirements` or `$sdd-spec-batch` without re-explaining the project
- No spec-kit / `.specify/` artifacts created

**When to use instead of `$sdd-discovery`**:
- Project has substantial code but empty or missing `.sdd/specs/`
- Team is adopting open-sdd mid-flight on an existing repo
- You need project memory and spec backlog from code, not from a new feature idea

**When NOT to use**:
- Greenfield new project → `$sdd-discovery` or `$sdd-spec-init`
- Single small feature on a project that already has steering + specs → `$sdd-discovery`
- You only need gap analysis for one existing spec → `$sdd-validate-gap`
</background_information>

<instructions>

## Phase 0: Gate and Scope

1. **Confirm brownfield intent**: Existing codebase with meaningful implementation (not empty scaffold).
2. **Optional focus** ($ARGUMENTS): Module, domain, or area to prioritize when decomposing specs.
3. **Explain output contract** before writing:
   - Creates/updates: `{{SDD_DIR}}/steering/{product,tech,structure,roadmap}.md`
   - Creates spec seeds: `{{SDD_DIR}}/specs/<slug>/{spec.json,brief.md,requirements.md}` — `requirements.md` is **project-description stub only** (same as `$sdd-spec-init`), not EARS requirements
   - Does NOT create: EARS requirements body, `design.md`, `tasks.md`, `.specify/`
4. **Safety check**: Scan existing specs in `{{SDD_DIR}}/specs/`. If any spec directory already exists (brief.md, spec.json), list them and ask before overwriting or duplicating boundaries — regardless of approval status. For approved specs, stop and ask which to keep untouched.
5. **Proceed only after user confirms** (or user explicitly invoked the skill expecting writes).

## Phase 1: Lite Scan (metadata only)

Gather **metadata only**. Do NOT read full source files yet.

- **Specs inventory**: List `{{SDD_DIR}}/specs/*/spec.json` if any (name, phase, approvals)
- **Steering inventory**: Which files exist under `{{SDD_DIR}}/steering/`
- **Project root**: List top-level directories and key config files (package.json, pyproject.toml, go.mod, etc.)
- **Git presence**: Check if `.git` exists (do not run destructive git commands)

Note: `empty .sdd/` → full bootstrap; partial `.sdd/` → additive merge mode.

## Phase 2: Reverse Analysis (delegate)

Read `references/analysis-guide.md` from this skill's directory for the analysis framework.

**Spawn a sub-agent** (or execute sequentially if sub-agents unavailable) to analyze the codebase and return a structured summary **under 200 lines**:

1. Tech stack and versions (from config files, not guesses)
2. Architecture pattern and layering
3. Module/domain boundaries with paths
4. Conventions (naming, testing, error handling)
5. Candidate spec boundaries (natural seams for independent specs)
6. Areas of high change risk or tight coupling

**Context budget**: Sub-agent does heavy exploration; main context receives summary only.

If optional structural code graphs exist in the project (e.g. graphify), prefer them for module boundaries before broad file reads.

## Phase 3: Git Forensics (when `.git` exists)

Run lightweight, read-only git inspection:

```bash
git log --oneline -20
git branch -a | head -30
git log --oneline --since="6 months ago" --pretty=format:%s | sort | uniq -c | sort -rn | head -15
```

Extract:
- Active feature areas from branch names (`feature/*`, `fix/*`)
- Recurring themes in commit messages
- Recently hot directories (if inferable from commits)

Use this to **prioritize spec seeds**, not to invent features that do not exist in code.

## Phase 4: Steering Bootstrap

Load principles from `rules/getspecs-principles.md` in this skill's directory.

**If steering is missing or incomplete**:
1. Read templates from `{{SDD_DIR}}/settings/templates/steering/` (product, tech, structure)
2. Synthesize from Phase 2 summary + Phase 3 git signals
3. Write `product.md`, `tech.md`, `structure.md` — **patterns and decisions**, not exhaustive lists

**If steering already exists**:
- Read existing files first
- Propose **additive** updates only; preserve user-authored sections
- Report drift between steering and codebase; do not silently replace

**Optional**: Write `roadmap.md` in Phase 5 instead of here if spec decomposition is not ready yet.

## Phase 5: Roadmap and Spec Seeds

Read `references/spec-seed-template.md` from this skill's directory.

### Decompose boundaries

From analysis + git signals + optional `$ARGUMENTS` focus:

- Prefer **vertical slices** or **module-aligned** specs that can progress independently
- Target **3–8 spec seeds** for typical mid-size repos; fewer for small repos
- Each seed must answer: what existing capability does this spec document/improve?

### Write roadmap.md

Use the full roadmap structure in `references/spec-seed-template.md` (aligned with `$sdd-discovery` Path D: Overview, Approach Decision, Scope, Constraints, Boundary Strategy, Specs).

### Write each spec seed

For every slug under `## Specs (dependency order)`:

1. Create `{{SDD_DIR}}/specs/<slug>/`
2. Write `brief.md` using the brownfield brief format in `references/spec-seed-template.md`
   - **Current State** must reflect code that exists today
   - **Existing Spec Touchpoints** must reference real modules/paths
3. Write `spec.json` from `{{SDD_DIR}}/settings/templates/specs/init.json`:
   - Replace `{{FEATURE_NAME}}`, `{{TIMESTAMP}}`, `{{LANG_CODE}}`
   - Keep `phase: "initialized"` and all approvals `false`
4. Write `requirements.md` **stub** from `{{SDD_DIR}}/settings/templates/specs/requirements-init.md`:
   - Replace `{{PROJECT_DESCRIPTION}}` with a synthesis from brief **Problem**, **Current State**, and **Desired Outcome** (who, situation, target state)
   - Leave the `## Requirements` section empty — EARS content is `$sdd-spec-requirements`
   - Do not set `approvals.requirements.generated` to true

**Do NOT** generate EARS acceptance criteria — that is `$sdd-spec-requirements`.

### Verify artifacts

Read back each written file (`steering/*`, `roadmap.md`, each seed's `brief.md`, `spec.json`, `requirements.md`). If any write failed, stop and report before handoff.

## Phase 6: Handoff

Present to user:

1. **Steering status**: created / updated / unchanged (with paths)
2. **Spec seeds table**: slug | one-line scope | dependencies
3. **Evidence gaps**: areas needing human input before requirements
4. **Next command** (choose one):
   - Single seed: `$sdd-spec-requirements <slug>`
   - Multiple seeds: `$sdd-spec-batch` (after reviewing briefs)
   - Steering only: `$sdd-steering` when steering needs refinement before specs (existing core files trigger Sync Mode)

**CRITICAL**: All artifacts must be on disk before suggesting next commands. Conversation text does not survive session boundaries.

</instructions>

## Console reconnaissance (optional, deterministic)

The `open-sdd` console can do the reconnaissance deterministically before (or instead of) the
manual analysis: `open-sdd brownfield survey .` reports the stack, tooling, module boundaries and
the evidence for each; `open-sdd brownfield constitution . --write` writes the descriptive
constitution to `{{SDD_DIR}}/steering/constitution.md` (principles the code already obeys, each
with evidence; desired-but-absent practices become proposed amendments). Once the seeds exist, a
change to existing behaviour is specified as a delta — `open-sdd delta init <feature> "<title>"`,
then `open-sdd delta validate <feature>` — with ADDED/MODIFIED/REMOVED/RENAMED sections and
delta-scoped `REQ-<AREA>-<NNN>` ids. Three rigor levels (Spec-First, Spec-Anchored,
Spec-as-Source) govern how much of that is required. They are a cumulative ladder and the default
is fluid: Spec-First demands a valid constitution and requirements in checkable EARS form, and each
step up only adds checks (delta, traceability, evidence binding, drift, then contracts and
regeneration). The constitution is required (blocking) at EVERY level, because it is the authority a
blocking verdict cites.

## Output Description

Provide output in the project's language (detect from README or user; default `en`) with:

1. **Brownfield Summary** (3–5 bullets): stack, architecture, module count, seeds created
2. **Files Written**: bullet list with full paths
3. **Spec Seed Backlog**: table of slugs + dependency order
4. **Next Step**: one recommended command in a code block

Keep total output under 400 words. Details live on disk.

## Safety & Fallback

| Scenario | Action |
|----------|--------|
| Empty repo / scaffold only | Stop: use `$sdd-discovery` greenfield path |
| User declines writes | Report analysis only; no disk changes |
| Templates missing | Report missing path under `{{SDD_DIR}}/settings/templates/` |
| Existing spec directories (draft or approved) | Never overwrite silently. List all existing specs, ask before adding seeds that overlap. Approved specs: stop and keep untouched. |
| Huge monolith (>15 seeds) | Propose phased roadmap; write top 5–8 seeds first; ask user to continue |
| No git | Skip Phase 3; rely on structure analysis only |

## Relationship to Other Skills

| Skill | Relationship |
|-------|----------------|
| `$sdd-discovery` | Idea-first routing; getSpecs is **code-first** bootstrap |
| `$sdd-steering` | Same steering output; getSpecs automates initial bootstrap from code |
| `$sdd-spec-init` | Creates one spec from description; getSpecs creates **many seeds** from code |
| `$sdd-spec-requirements` | **Next step** — turns seeds into EARS requirements |
| `$sdd-validate-gap` | Per-spec gap analysis **after** requirements exist |
