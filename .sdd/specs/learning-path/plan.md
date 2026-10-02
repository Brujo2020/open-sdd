# Plan — learning-path

## Design decisions

- **ADR-LRN-001 — Progressive disclosure, one table.** The essentials and the workflow topic are short
  hand-written texts; the full index stays the projection of `COMMANDS` behind `--all` (the `git help`
  / `git help -a` split). A test proves every command the short texts name is routed, so they cannot
  promise a command that does not exist.
- **ADR-LRN-002 — Each path ends on its verifier.** `help workflow` closes every situation with the
  command whose exit code says "done", so learning the path is learning the evidence.
- **ADR-LRN-003 — An unedited stub must not pass.** The requirements stub uses double-brace markers,
  so a stub nobody edited is reported instead of counted as a requirement; its filled shape is the one
  the coach accepts with zero findings.
- **ADR-LRN-004 — No gate-chain change** (decision 4 of `docs/EVOLUTION-PLAN.md`).

## Components

| Requirement | Module |
|---|---|
| REQ-LRN-001/002/003/006 | `src/cli/commands/help.ts` (`renderEssentialHelp`, `WORKFLOW_USAGE`, `handleHelpCommand`) |
| REQ-LRN-001/005 | `src/index.ts` (`--help` routing, score door, unknown-command hint) |
| REQ-LRN-007 | `tools/open-sdd/package.json`, `tools/open-sdd/package-lock.json` |
| REQ-LRN-008 | `src/cli/commands/init.ts` (`handleProjectInit`) |
| REQ-LRN-009 | `src/core/specManager.ts` (`initSpec`) |

## Risks

- Scripts that parsed the full `--help` must now pass `--all` (the two in-repo tests that did were
  updated); the exit code and the `Usage: open-sdd` line are unchanged.
- The coach is advisory and its precision is unmeasured: "zero findings" is proved for the stub's
  shape, not for the quality of what a person writes into it.
