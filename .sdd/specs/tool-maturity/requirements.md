# Requirements — tool-maturity

**Objective:** As a team, we want Open-SDD to be the mandatory, agnostic SDD layer of any modern AI
toolchain, installable and usable in minutes, with the constitution as the pivot.

## Requirements

### REQ-MAT-001 — The engine speaks to any AI host

- Statement: The [engine] shall expose its checks, artifacts and status as an MCP server over stdio.
- Statement: The [engine] shall expose every command's result as machine-readable JSON under `--json`.
- Statement: When a host requests the constitution or the applicable spec for a task, the [engine] shall return them as MCP resources.

### REQ-MAT-002 — Installation that diagnoses itself

- Statement: WHEN a project is initialised, the [installer] shall select agent, rigor level and language in one command and be idempotent.
- Statement: The [doctor] shall diagnose Node version, hooks, settings, specs, constitution and cross-platform hook support, and name the fix for each problem.

### REQ-MAT-003 — Reconnaissance beyond Node

- Statement: WHEN a repository declares Maven, Gradle, Go, Rust, Python or .NET modules, the [scanner] shall detect the modules and their responsibilities.
- Statement: If a declared toolchain cannot be read, then the [scanner] shall report it as unknown instead of treating the repository as single-module.

### REQ-MAT-004 — Enforcement that works on every OS

- Statement: The [commit gate] shall run without a POSIX shell dependency on Windows, macOS and Linux.

### REQ-MAT-005 — The constitution blocks, not just reports

- Statement: WHEN the alignment check runs in strict mode, the [console] shall exit non-zero on a warning as well as on an error.
- Statement: The [ratchet] shall refuse a change that lowers a principle's compliance without a promoted amendment.
- Statement: WHEN a violation is waived, the [allowlist] shall require an owner and an expiry date.

### REQ-MAT-006 — An evidence bundle an auditor can read

- Statement: WHEN an audit bundle is requested, the [console] shall emit the specs, gates, claims, constitution and compliance matrix with a content hash per artifact.

### REQ-MAT-007 — Native CI integration

- Statement: The [project] shall publish a GitHub Action, a GitLab template and a SARIF report so findings appear in the host's code scanning.

### REQ-MAT-008 — Zero-friction distribution

- Statement: The [package] shall run through `npx` without a global install and be publishable to a public registry with provenance.

### REQ-MAT-009 — A five-minute curve

- Statement: The [tour] shall take a new user from an existing repository to a validated delta without reading the source.
- Statement: The [console] shall render its user-facing output in Spanish and English.

### REQ-MAT-010 — Evidence that is not approximate

- Statement: The [reconnaissance] shall use one boundary vocabulary shared by the module map and the constitution.
- Statement: The [API surface] shall read declared entry points from manifests instead of matching file names.
- Statement: WHEN a delta is merged back, the [engine] shall rewrite the base specification sections instead of leaving the label to the author.

### REQ-MAT-011 — Constitutional adhesion measured over time

- Statement: The [console] shall report a per-spec constitutional adhesion score and its trend across releases.

### REQ-MAT-012 — Waivers that expire

- Statement: WHEN a waiver passes its expiry, the [gate] shall fail until it is renewed and name the owner.

### REQ-MAT-013 — Reuse-first enforced, impact forecast

- Statement: WHEN an agent proposes a new symbol, the [MCP tool] shall return existing candidates before any file is written.
- Statement: The [impact analysis] shall forecast the blast radius of a described change before it is written.

### REQ-MAT-014 — The context pack every host needs

- Statement: WHEN a task starts, the [engine] shall assemble the constitution, the applicable spec and the module map into one context pack for the host.

### REQ-MAT-015 — Spec-as-source that can actually run

- Statement: WHEN a repair is requested at the spec-as-source level, the [engine] shall repair the spec first and regenerate the artifact, reporting drift until both agree.

## Non-functional requirements

- The engine shall keep working with no model backend and no network access.
- IF a check did not inspect the artifacts it claims to have checked, THEN the [console] shall not report it as passed.

### REQ-MAT-016 — A constitution draft a human ratifies

**Objective:** As an architect, I want help drafting the constitution, so that day one is not a blank page.

#### Acceptance Criteria

- The [drafter] shall emit a DRAFT constitution marked as not in force, with the evidence behind every proposed principle.
- When a draft is ratified, the [engine] shall record the ratifying human and require a rationale for every normative principle.
- If a principle is still a draft, then the [console] shall refuse to cite it as authority in a blocking verdict.

### REQ-MAT-017 — An advisor that keeps the constitution young

**Objective:** As a maintainer, I want continuous suggestions, so that the constitution does not age into fiction.

#### Acceptance Criteria

- The [advisor] shall report principles whose evidence no longer resolves, practices the code follows that no principle states, and amendments that have aged without a decision.
- The [advisor] shall attach a concrete example to every suggestion.
- When a suggestion is applied, the [engine] shall record it as an amendment with its migration plan.
