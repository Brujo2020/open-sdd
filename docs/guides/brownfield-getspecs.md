# Brownfield Bootstrap with `/sdd-getspecs`

> Adapted from brownfield reverse-engineering patterns (spec-kit brownfield extensions) into native open-sdd `.sdd/` artifacts.

## What it does

`/sdd-getspecs` is the **code-first entry point** for adopting open-sdd on an existing repository.

It reverse-engineers the project and writes durable artifacts under `.sdd/`:

| Output | Purpose |
|--------|---------|
| `steering/product.md`, `tech.md`, `structure.md` | Project memory (patterns, not catalogs) |
| `steering/roadmap.md` | Ordered backlog of spec boundaries |
| `specs/<slug>/brief.md` | Brownfield brief grounded in **current code** |
| `specs/<slug>/spec.json` | Initialized spec metadata (`phase: initialized`) |
| `specs/<slug>/requirements.md` | **Stub only** — project description (same as `/sdd-spec-init`); EARS section empty |

It does **not** write EARS acceptance criteria, `design.md`, or `tasks.md`. Those remain gated behind the normal open-sdd workflow.

## Why it exists

| Problem | Without getSpecs | With getSpecs |
|---------|------------------|---------------|
| Existing repo, no specs | `/sdd-discovery` assumes you have an **idea** | Reads **code** first |
| Onboarding | Manual steering + many `/sdd-spec-init` calls | One pass → roadmap + seeds |
| Wrong tool | spec-kit `.specify/` parallel tree | Single `.sdd/` contract (Kiro-compatible) |
| Over-scoping | One giant spec | Module/git-informed boundaries |

`/sdd-discovery` routes **new work**. `/sdd-getspecs` bootstraps **existing work**.

## Position in the open-sdd pipeline

```mermaid
flowchart TB
  subgraph entry [Entry points]
    GS["/sdd-getspecs<br/>code-first brownfield"]
    DISC["/sdd-discovery<br/>idea-first greenfield"]
  end

  subgraph sdd [".sdd/ artifacts"]
    ST["steering/<br/>product · tech · structure · roadmap"]
    SEED["specs/&lt;slug&gt;/<br/>brief · spec.json · requirements stub"]
  end

  subgraph sdd [Standard open-sdd phases — unchanged gates]
    REQ["/sdd-spec-requirements<br/>EARS requirements"]
    GAP["/sdd-validate-gap<br/>optional brownfield"]
    DES["/sdd-spec-design"]
    TSK["/sdd-spec-tasks"]
    IMP["/sdd-impl"]
  end

  GS --> ST
  GS --> SEED
  DISC --> SEED
  SEED --> REQ
  REQ --> GAP
  GAP --> DES
  DES --> TSK
  TSK --> IMP
```

## Six-phase protocol (detailed)

```mermaid
sequenceDiagram
  participant U as User
  participant G as sdd-getspecs
  participant SA as Sub-agent
  participant D as Disk (.sdd/)

  U->>G: /sdd-getspecs [focus?]
  G->>U: Phase 0 — explain contract, confirm writes
  U->>G: confirm
  G->>G: Phase 1 — lite scan (metadata only)
  G->>SA: Phase 2 — reverse analysis ≤200 lines
  SA-->>G: stack, arch, modules, spec candidates
  G->>G: Phase 3 — git forensics (read-only)
  G->>D: Phase 4 — steering bootstrap / merge
  G->>D: Phase 5 — roadmap + seeds (3 files per slug)
  G->>D: verify read-back
  G->>U: Phase 6 — handoff command
```

## Spec seed contract (per slug)

Each seed is **not** a complete spec. It is a brownfield handoff bundle compatible with `/sdd-spec-init` and `/sdd-spec-requirements`:

```mermaid
erDiagram
  SPEC_SEED ||--|| brief_md : contains
  SPEC_SEED ||--|| spec_json : contains
  SPEC_SEED ||--|| requirements_stub : contains

  brief_md {
    string Problem
    string CurrentState "must cite real paths"
    string DesiredOutcome
    string Scope
    string BoundaryCandidates
  }

  spec_json {
    string feature_name
    string phase "initialized"
    boolean approvals_all_false
  }

  requirements_stub {
    string ProjectDescription "from brief synthesis"
    string RequirementsSection "empty — EARS later"
  }
```

| File | Written by getSpecs | Written by later skills |
|------|---------------------|------------------------|
| `brief.md` | Yes — brownfield context | Read by requirements/design |
| `spec.json` | Yes — `phase: initialized` | Updated by each phase gate |
| `requirements.md` | Yes — **stub only** | EARS body by `/sdd-spec-requirements` |
| `design.md` | No | `/sdd-spec-design` |
| `tasks.md` | No | `/sdd-spec-tasks` |

## How it works (6 phases — summary)

```
Phase 0  Gate        Confirm brownfield + user approval before writes
Phase 1  Lite scan   Metadata only (.sdd inventory, root listing)
Phase 2  Reverse     Sub-agent summary ≤200 lines (stack, arch, modules)
Phase 3  Git         Optional branch/commit themes (read-only)
Phase 4  Steering    Bootstrap or additive merge of product/tech/structure
Phase 5  Seeds       roadmap.md + brief.md + spec.json + requirements.md stub per slug
Phase 6  Handoff     /sdd-spec-requirements or /sdd-spec-batch
```

### Design choices

1. **Seeds, not EARS** — `requirements.md` stub matches `/sdd-spec-init`; EARS stays in `/sdd-spec-requirements`.
2. **Sub-agent for exploration** — Heavy codebase reads stay out of main context (same pattern as `/sdd-discovery`).
3. **Additive steering** — Never silently replace user-authored steering.
4. **No `.specify/`** — Avoids parallel spec trees incompatible with Kiro/open-sdd portability.
5. **Git as signal, not truth** — Commit themes prioritize seeds; they do not invent features.

## When to use

**Use `/sdd-getspecs` when:**

- The repo has real implementation but empty or incomplete `.sdd/specs/`
- The team is adopting open-sdd mid-flight
- You need steering + a spec backlog from code reality

**Use `/sdd-discovery` instead when:**

- You have a new feature idea on a project that already has specs/steering
- Greenfield scaffold with little code

**Use `/sdd-validate-gap` after:**

- `/sdd-spec-requirements` for a single brownfield spec (per-feature gap analysis)

## Typical workflow

```bash
# 1. Install open-sdd skills (once)
npx @brujo2020/open-sdd@latest --cursor-skills

# 2. Bootstrap from existing code
/sdd-getspecs

# 3. Turn seeds into specs (pick one)
/sdd-spec-requirements auth-service
/sdd-spec-batch

# 4. Continue normal open-sdd pipeline
/sdd-spec-design auth-service
/sdd-spec-tasks auth-service
/sdd-impl auth-service
```

Optional focus area:

```bash
/sdd-getspecs payments module
```

## Skill files

Installed to `.cursor/skills/sdd-getspecs/` (path varies by agent):

- `SKILL.md` — orchestration protocol
- `rules/getspecs-principles.md` — brownfield principles
- `references/analysis-guide.md` — reverse-engineering checklist
- `references/spec-seed-template.md` — brief, roadmap, requirements stub templates

## Credits

Logic distilled from [spec-kit brownfield extensions](https://github.com/Pimzino/spec-kit-brownfield-extensions) and mapped to open-sdd `.sdd/` outputs. spec-kit `.specify/` artifacts are intentionally **not** generated.

## Related

- [Universal Brownfield Guide (Solo to Hyperscalers)](./universal-brownfield-sdd.md)
- [Enterprise Zero-Trust Brownfield Modernization](./enterprise-brownfield-sdd.md)
- [Skill Reference](./skill-reference.md)
- [Why open-sdd?](./why-open-sdd.md)
