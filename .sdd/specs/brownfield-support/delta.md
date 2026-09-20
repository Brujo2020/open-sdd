# Delta: brownfield-support — Delta specs, reverse constitution and honest reconnaissance

Status: approved

## ADDED

### REQ-BF-001 — The delta is the contract of change
- Statement: WHEN a change is specified against an existing repository, the [delta engine] shall express only what changes using the ADDED, MODIFIED, REMOVED and RENAMED sections.
- Targets: tools/open-sdd/src/core/deltaSpec.ts, tools/open-sdd/test/coreDeltaSpec.test.ts
- Contracts: tools/open-sdd/test/coreDeltaSpec.test.ts
- Strangler: new

### REQ-BF-002 — A constitution that states only what the code already is
- Statement: The [constitution generator] shall emit a principle only when compliance with it is evidenced in the existing code.
- Targets: tools/open-sdd/src/core/reverseConstitution.ts, tools/open-sdd/src/core/constitution.ts, tools/open-sdd/test/coreBrownfield.test.ts, tools/open-sdd/test/coreConstitution.test.ts, .sdd/steering/constitution.md
- Contracts: tools/open-sdd/test/coreBrownfield.test.ts
- Strangler: new

### REQ-BF-004 — Traceability in both directions
- Statement: WHEN a delta is validated, the [traceability check] shall report every delta requirement without a task and every task citing an unknown delta identifier.
- Targets: tools/open-sdd/src/core/deltaSpec.ts, tools/open-sdd/test/coreDeltaSpec.test.ts
- Contracts: tools/open-sdd/test/coreDeltaSpec.test.ts
- Strangler: new

### REQ-BF-005 — The brownfield surface in the console
- Statement: The [governance console] shall expose reconnaissance, constitution generation and delta validation as commands.
- Targets: tools/open-sdd/src/cli/commands/brownfield.ts, tools/open-sdd/src/index.ts, tools/open-sdd/test/coreBrownfield.test.ts
- Contracts: tools/open-sdd/test/coreBrownfield.test.ts
- Strangler: new

### REQ-BF-006 — Three rigor levels, with the constitution required from the second
- Statement: WHEN a project declares its rigor level, the [rigor assessment] shall require a valid constitution from the spec-anchored level upward.
- Targets: tools/open-sdd/src/core/rigor.ts, .sdd/settings/rigor.json, tools/open-sdd/test/coreRigor.test.ts, tools/open-sdd/src/cli/commands/paper.ts, tools/open-sdd/templates/hooks/pre-commit, .github/workflows/gates.yml
- Contracts: tools/open-sdd/test/coreRigor.test.ts
- Strangler: new

### REQ-BF-007 — Impact analysis before the change is written
- Statement: WHEN a change is analysed, the [impact analysis] shall report the dependents of the changed files, the breaking changes and the migrations without a rollback plan.
- Targets: tools/open-sdd/src/core/changeImpact.ts, tools/open-sdd/test/coreChangeImpact.test.ts
- Contracts: tools/open-sdd/test/coreChangeImpact.test.ts
- Strangler: new

### REQ-BF-008 — The tests that protect the change are declared and verified
- Statement: WHEN contracts are extracted for a change, the [oracle] shall bind every covering test to the changed files and report the changed files no test covers.
- Targets: tools/open-sdd/src/core/executionContract.ts, .github/workflows/gates.yml, tools/open-sdd/test/coreExecutionContract.test.ts
- Contracts: tools/open-sdd/test/coreExecutionContract.test.ts
- Strangler: new

### REQ-BF-009 — Search before creating
- Statement: WHEN a change proposes a new symbol, the [reuse check] shall report existing symbols that a reuse-first search would have found first.
- Targets: tools/open-sdd/src/core/reuseFirst.ts, tools/open-sdd/test/coreReuseFirst.test.ts
- Contracts: tools/open-sdd/test/coreReuseFirst.test.ts
- Strangler: new

### REQ-BF-010 — The brownfield workflow is documented where the agents read it
- Statement: WHEN the brownfield workflow changes, the [documentation] shall describe it in the traceability report, the guides and the orientation file each agent reads first.
- Targets: README.md, CLAUDE.md, AGENTS.md, CHANGELOG.md, docs/PAPER-ALIGNMENT.md, docs/guides/brownfield-delta-workflow.md, docs/claims/paper-claims.yaml, tools/open-sdd/templates
- Contracts: tools/open-sdd/test/docsIntegrity.test.ts
- Strangler: new

### REQ-BF-011 — One dashboard for the whole state
- Statement: WHEN a project asks for its status, the [console] shall report the constitution, the specs, the delta, the contracts, the constitutional alignment and the rigour level on one screen, together with the next command to run.
- Targets: tools/open-sdd/src/core/status.ts, tools/open-sdd/src/cli/commands/status.ts, tools/open-sdd/test/coreStatus.test.ts
- Contracts: tools/open-sdd/test/coreStatus.test.ts
- Strangler: new

### REQ-BF-012 — One entry point for an existing repository
- Statement: WHEN a repository is bootstrapped, the [bootstrap] shall compose reconnaissance, the descriptive constitution, the module responsibility map, the code-intelligence document and the ordered steps into one plan.
- Targets: tools/open-sdd/src/core/bootstrap.ts, tools/open-sdd/src/cli/commands/brownfield.ts, tools/open-sdd/test/coreBootstrap.test.ts
- Contracts: tools/open-sdd/test/coreBootstrap.test.ts
- Strangler: new

### REQ-BF-013 — The constitution validates every spec
- Statement: WHEN a spec is checked, the [constitutional alignment] shall report the principles it declares, the ones it ignores, any phantom authority and any requirement that contradicts a principle in force.
- Targets: tools/open-sdd/src/core/specConstitution.ts, tools/open-sdd/test/coreSpecConstitution.test.ts
- Contracts: tools/open-sdd/test/coreSpecConstitution.test.ts
- Strangler: new

### REQ-BF-014 — The workflow is taught where the agents read it
- Statement: The [skill] shall teach the five-step brownfield flow with the exact commands and the constitution as the pivot for validating every spec.
- Targets: tools/open-sdd/templates, docs/guides/brownfield-quickstart.md, docs/claims/paper-claims.yaml
- Contracts: tools/open-sdd/test/docsIntegrity.test.ts
- Strangler: new

## MODIFIED

### REQ-BF-003 — Reconnaissance of a workspace layout
- Statement: WHEN a repository keeps its code inside a nested workspace, the [scanner] shall detect the language, test runner and build tool declared in that workspace.
- Previous: The scan read only the repository root, so a workspace layout was reported as JavaScript with no tests detected — including on this repository, which is TypeScript with a full test suite.
- Targets: tools/open-sdd/src/core/reverseEngineering.ts, tools/open-sdd/test/coreReverseEngineering.test.ts
- Contracts: tools/open-sdd/test/coreBrownfield.test.ts, tools/open-sdd/test/coreReverseEngineering.test.ts
- Strangler: new

## REMOVED

## RENAMED
