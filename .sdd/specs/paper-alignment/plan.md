# Plan: Paper Alignment and Product Restoration

> Canonical name for this document is `plan.md` (the paper's Documentary Triad: `requirements.md`,
> `plan.md`, `tasks.md`). This repository's older tooling reads `design.md`; `design.md` is kept as
> a declared alias of this file rather than a second source of truth. Both names are accepted by
> the triad evaluator in `tools/open-sdd/src/core/triad.ts`.

## Problem

At the starting HEAD (`a262362`, "cleanup: remove legacy open-sdd and docs") the product had been
deleted: 668 files removed, leaving six tracked files. Every manifest pointed at something that no
longer existed, and one install path was actively harmful:

- `package.json` `postinstall` was `cd tools/open-sdd && npm install … || npm install …`. With
  `tools/open-sdd` absent, the shell fallback ran `npm install` in the repository root, re-triggering
  the same script. Measured: 81 concurrent `npm install` processes eight seconds into a run.
- `npm pack --dry-run` produced a 2-file, 2.5 kB tarball (LICENSE + package.json): the `bin`
  entries and `files` globs matched nothing.
- `install-global.sh` cloned a different repository URL, then failed at `npm run build`, then
  suggested an alias pointing at a deleted `install.sh`.
- `CLAUDE.md` and `README-OPENSDD.md` documented paths (`src/cli/`, `.claude/skills/`,
  "9 features") that no commit ever contained. `src/cli/` never existed in any revision.

Separately, the repository is the intended implementation vehicle for a published reference
architecture, and almost none of that architecture existed as executable code: governance was
three "vital gates", with no catalog, no crosswalk, no enforcement model, no default-FAIL
semantics, no receipts, no wave transactionality, no memory-poisoning controls and no claims
registry.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| ADR-001 | Restore the deleted product from git history (`HEAD~1`, content also held by tag `v1.0.0`) rather than rewriting it. | The content was intact and verified by 233 passing tests; a rewrite would discard working behavior and invite drift. |
| ADR-002 | Treat the paper's `plan.md` and this repository's `design.md` as the same Triad slot through a declared alias. | The paper names `plan.md`; the shipped parser reads `design.md`. Declaring the mapping keeps one source of truth instead of two divergent documents. |
| ADR-003 | The chain is **resolved** from catalog + profile + repository signals; the per-profile counts are derived, never constants. | §9.5: the executor "dejó de tener opinión" so it can neither run a disabled control nor omit an enabled one. The paper measured 7 / 9 / 12 on its own repository; those are results, not parameters. |
| ADR-004 | The crosswalk residue is **computed by subtraction** from the declared chain. | §9.5/Table 36: a curated residue can claim a control the running code does not implement. Subtraction cannot. |
| ADR-005 | `C7` (Karpathy discipline) is reported as **vacuous**, never as executable. | §4.9 and §9.5 state the reference gate returns success without inspecting anything. Implementing a fake check would fabricate evidence; deleting it would understate the declared chain. The honest third option is to report the gap. |
| ADR-006 | default-FAIL is scoped: the hard subset fails closed in every regime, process gates self-authorize under the flexible regime and require a receipt, and the strict regime fails closed. | §9.2/§16: reading "default-FAIL" as a universal property reads more than the paper claims. Blunt enforcement teaches teams to disable the harness. |
| ADR-007 | Controls that need a model backend degrade **explicitly** and are marked as not evidence. | There is no model backend here. §14.1's precedent: report `mode=degraded`, declare a heuristic, and state that it does not count as evidence of intent alignment. |
| ADR-008 | Replace the root `postinstall` shell chain with a guarded Node script. | Removes the recursion by construction and stops masking failures behind `||`. A silent exit 0 is how a repository becomes "installed and unbuildable". |
| ADR-009 | Record A2 (independence) as **unmeasured**, and state that the retirements rest on A1 and A3 only. | §9.4: the reference bench could not compute the co-activation matrix — the corpus format excludes exactly the co-occurrence it needs. The most dangerous measurement failure is the one filed without being reported. |
| ADR-010 | Keep the paper's measured numbers out of this repository's claims. | κ = 0.86 (n = 15), C4 FPR 20.0%, the 2.1–2.2 s sweep and the 7/9/12 counts are properties of the unpublished prototype. Restating them here would be the exact defect the paper's claims gate exists to catch. |

## Architecture

New modules under `tools/open-sdd/src/core/`, all pure or filesystem-local and unit tested:

| Module | Paper | Responsibility |
|---|---|---|
| `gateCatalog.ts` | Table 33/34/35/36, §9.5 | 21 logical gates, 14 executable checks, crosswalk, residue by subtraction, signal-based chain resolution |
| `enforcement.ts` | §6.3, Table 19, §9.2 | Levels A–D, per-host ceilings, behavioural sentinel (including fail-open), default-FAIL posture, hard subset |
| `invariants.ts` | Table 17/18 | I1–I6 and cumulative conformity C0–C3 from evidence |
| `receipts.ts` | I6, §9.10 | Relaxation ledger, appeal channel, override-rate recalibration at 20% |
| `hitl.ts` | Table 25, §4.8, §4.10 | Quantified escalation thresholds, rigor-mode selection, escalation calibration |
| `ears.ts` | §4.6, Table 12 | Five-template EARS validator and clarity diagnostics |
| `triad.ts` | §4.5, §9.7 | Triad presence, evidence lock (I2), the three decidable discipline properties |
| `waves.ts` | §7.2 | Wave state machine, all-or-nothing atomicity, scope contract, worktree/git command generation, file-claim TTL |
| `metaEval.ts` | §7.3, §7.4 | Cohen's κ, drift monitors, judge independence, bias mitigations |
| `memory.ts` | §11 | Distillation pipeline, quarantine, provenance, injection scanner, decay |
| `skills.ts` | §6.4, §11.1 | Skill classes, MCP concession registry, bidirectional permissions, candidate gating, promotion ladder |
| `telemetry.ts` | §14.1, Appendix B | Cost lines, 30% governance ceiling with degradation order, 70% compaction, metric definitions, complexity routing, self-failure policy |
| `claims.ts` | §2.3, §9.6 | Five-state claims registry, measured/built/proposed inventory |
| `assurance.ts` | Table 24/39, §14.3, §9.1 | Threat/ATLAS mapping, regulatory crosswalk, five lab banks, pre-registered refutation thresholds, Zero-Trust borrowing boundary |
| `gateRunner.ts` | §9.5, §9.6 | Deterministic execution of the declared controls with honest sensor reporting |

CLI surface added in `tools/open-sdd/src/cli/commands/paper.ts` and dispatched from
`tools/open-sdd/src/index.ts`: `gates [chain|crosswalk|list|enforcement|run]`,
`govern [invariants|conformance|hitl|rigor|appeal|meta-eval|budget]`,
`assure [threats|lab|claims|skills|memory]`, `waves <feature>`.

## Impacted surfaces

- `tools/open-sdd/src/core/**` — new modules plus barrel exports; existing modules untouched.
- `tools/open-sdd/src/cli/commands/paper.ts` (new), `tools/open-sdd/src/index.ts` (dispatch + help).
- `tools/open-sdd/test/**` — new test files; existing suite must stay green.
- Root `package.json` (postinstall, `files`, verification scripts), `scripts/postinstall.mjs` (new),
  `install.sh`, `install-global.sh`, `.gitignore` (stop ignoring `.claude/` wholesale).
- `.sdd/specs/paper-alignment/**` — this spec.
- Documentation: `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/**`, `CHANGELOG.md`.

## Risks

| Risk | Mitigation |
|---|---|
| New modules drift from the paper's exact wording | Every module cites section/table in its header; `docs/PAPER-ALIGNMENT.md` maps each element to the code and labels its status. |
| Declaring capabilities the code lacks | The chain resolver reports declared/executed/vacuous/not-implemented counts, and the claims registry binds documentation claims to executable verifiers. |
| Refactoring the restored CLI breaks working behavior | Existing 233 tests are the regression gate and remain untouched; new code is additive. |
| The install fix hides a genuine build failure | The postinstall propagates non-zero exits instead of swallowing them. |

## Verification plan

1. `npm --prefix tools/open-sdd run build` — TypeScript strict build succeeds.
2. `npm --prefix tools/open-sdd test` — full suite green (existing + new tests).
3. `node tools/open-sdd/dist/cli.js gates chain --profile solo|team|regulated` — resolves 7 / 9 / 12 declared controls.
4. `node tools/open-sdd/dist/cli.js gates crosswalk` — residue shows exactly G7, G8, G10, G11, G17; 16 of 21 covered.
5. `npm pack --dry-run` — tarball contains the CLI and templates.
6. Postinstall guard: absent workspace exits 0 with a message and spawns no nested install.
7. Claims registry verifiers executed from the repository root, results recorded in `docs/PAPER-ALIGNMENT.md`.
