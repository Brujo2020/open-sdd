# Plan — hardening-wave

## Design decisions

- **ADR-HRD-001 — Pin per clone, verify the fallback.** The pin lives in the hooks directory (like the
  hook itself), so an absolute machine path is never committed. A `PATH` CLI is not forbidden — that
  would break legitimate global installs — it is version-checked first. The version floor is duplicated
  in the hook (which can import nothing) and `core/hookPin.ts`; a test asserts they agree.
- **ADR-HRD-002 — The ledger is data, `spec.json` is a projection.** `approvals.json` is the source of
  truth; the boolean flags in `spec.json` are kept in sync for the skills that read them.
- **ADR-HRD-003 — Compose, never re-implement.** `up` calls `init`, the CI installer shared with
  `floor install` (`installCiTemplate`) and `doctor`. `route` reuses `forecastImpact`.
- **ADR-HRD-004 — Conservative by default.** `route` never answers S for an unsized change;
  `uninstall --legacy` refuses anything it cannot prove; context tokens are an announced estimate.
- **ADR-HRD-005 — No gate-chain change.** Approvals, route and the context budget are commands a CI can
  run, not new chain gates (decision 4).

## Components

| Requirement | Module |
|---|---|
| REQ-HRD-001/002 | `templates/hooks/pre-commit.mjs`, `src/core/hookPin.ts`, `src/core/doctor.ts`, `src/cli/commands/paper.ts` |
| REQ-HRD-003 | `src/core/approvals.ts`, `src/cli/commands/approve.ts` |
| REQ-HRD-004 | `src/core/route.ts`, `src/cli/commands/route.ts` |
| REQ-HRD-005 | `src/cli/commands/up.ts` |
| REQ-HRD-006 | `src/cli/commands/brownfield.ts` |
| REQ-HRD-007 | `src/core/contextBudget.ts`, `src/cli/commands/contextReport.ts` |
| REQ-HRD-008 | `src/core/legacyUninstall.ts`, `src/cli/commands/uninstall.ts` |
| REQ-HRD-009 | `src/index.ts` |
| REQ-HRD-010 | `src/core/floorInstallation.ts`, `templates/hooks/open-sdd-gates.gitlab-ci.yml` |

## Risks

- A pinned path inside an ephemeral `npx` cache can vanish: the hook then falls back to verified
  candidates and still demands the pinned version from `PATH`.
- `uninstall --legacy` cannot detect a shipped file edited in place (no receipt hash): the plan is printed
  first and `--write` is required.
