# Delta: tool-maturity — Full-pro maturity for the SDD layer

Status: draft

## ADDED

### REQ-MAT-001 — The
- Statement: WHEN this capability is requested, the [engine] shall provide it as specified in requirements.md REQ-MAT-001.
- Targets: tools/open-sdd/src/mcp/server.ts
- Strangler: new

### REQ-MAT-002 — Installation
- Statement: WHEN this capability is requested, the [engine] shall provide it as specified in requirements.md REQ-MAT-002.
- Targets: tools/open-sdd/src/cli/commands/init.ts
- Strangler: new

### REQ-MAT-003 — Reconnaissance
- Statement: WHEN this capability is requested, the [engine] shall provide it as specified in requirements.md REQ-MAT-003.
- Targets: tools/open-sdd/src/core/reverseEngineering.ts
- Strangler: new

### REQ-MAT-004 — Enforcement
- Statement: WHEN this capability is requested, the [engine] shall provide it as specified in requirements.md REQ-MAT-004.
- Targets: tools/open-sdd/templates/hooks/pre-commit
- Strangler: new

### REQ-MAT-005 — The
- Statement: WHEN this capability is requested, the [engine] shall provide it as specified in requirements.md REQ-MAT-005.
- Targets: tools/open-sdd/src/cli/commands/status.ts
- Strangler: new

### REQ-MAT-006 — An
- Statement: WHEN this capability is requested, the [engine] shall provide it as specified in requirements.md REQ-MAT-006.
- Targets: tools/open-sdd/src/cli/commands/audit.ts
- Strangler: new

### REQ-MAT-007 — Native
- Statement: WHEN this capability is requested, the [engine] shall provide it as specified in requirements.md REQ-MAT-007.
- Targets: action.yml
- Strangler: new

### REQ-MAT-008 — Zero-friction
- Statement: WHEN this capability is requested, the [engine] shall provide it as specified in requirements.md REQ-MAT-008.
- Targets: package.json
- Strangler: new

### REQ-MAT-009 — A
- Statement: WHEN this capability is requested, the [engine] shall provide it as specified in requirements.md REQ-MAT-009.
- Targets: tools/open-sdd/src/cli/commands/tour.ts
- Strangler: new

### REQ-MAT-010 — Evidence
- Statement: WHEN this capability is requested, the [engine] shall provide it as specified in requirements.md REQ-MAT-010.
- Targets: tools/open-sdd/src/core/bootstrap.ts
- Strangler: new

### REQ-MAT-011 — Constitutional
- Statement: WHEN this capability is requested, the [engine] shall provide it as specified in requirements.md REQ-MAT-011.
- Targets: tools/open-sdd/src/core/specConstitution.ts
- Strangler: new

### REQ-MAT-012 — Waivers
- Statement: WHEN this capability is requested, the [engine] shall provide it as specified in requirements.md REQ-MAT-012.
- Targets: tools/open-sdd/src/core/securityAllowlist.ts
- Strangler: new

### REQ-MAT-013 — Reuse-first
- Statement: WHEN this capability is requested, the [engine] shall provide it as specified in requirements.md REQ-MAT-013.
- Targets: tools/open-sdd/src/core/changeImpact.ts
- Strangler: new

### REQ-MAT-014 — The
- Statement: WHEN this capability is requested, the [engine] shall provide it as specified in requirements.md REQ-MAT-014.
- Targets: tools/open-sdd/src/core/contextPack.ts
- Strangler: new

### REQ-MAT-015 — Spec-as-source
- Statement: WHEN this capability is requested, the [engine] shall provide it as specified in requirements.md REQ-MAT-015.
- Targets: tools/open-sdd/src/core/regeneration.ts
- Strangler: new

### REQ-MAT-016 — A constitution draft a human ratifies
- Statement: The [drafter] shall emit a draft marked as not in force, carrying the evidence behind each proposed principle, and the [engine] shall keep draft principles out of blocking verdicts until a human ratifies them.
- Targets: tools/open-sdd/src/core/constitutionDraft.ts, tools/open-sdd/src/cli/commands/constitution.ts, tools/open-sdd/test/coreConstitutionDraft.test.ts
- Strangler: new

### REQ-MAT-017 — An advisor that keeps the constitution young
- Statement: The [advisor] shall report expired evidence, unstated practices and aged amendments, each with a concrete example and a command that applies it as a governed amendment.
- Targets: tools/open-sdd/src/core/constitutionAdvice.ts, tools/open-sdd/test/coreConstitutionAdvice.test.ts
- Strangler: new

## MODIFIED

## REMOVED

## RENAMED
