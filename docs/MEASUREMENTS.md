# Measurements

This file holds the numbers **this repository measured about itself**. It exists because the
project's rule is that a claim without a reproducing command is not a measurement — and because
the figures in the reference paper are *not* ours and must never be quoted as if they were.

Everything below is reproducible offline from a clone. Nothing here is field data.

---

## Synthetic incoherence bench

| Field | Value |
|---|---|
| Tool | `open-sdd v3.1.0` (`tools/open-sdd/dist/cli.js`, pinned) |
| Node | `v26.7.0` |
| Date | 2026-09-20 (tool version refreshed to v3.1.0; the measurement numbers below are unchanged) |
| Seed | `1` |
| Repositories | `10` (synthetic) |
| Baseline sanity | pristine repo → **0 error findings** |
| Result | **10 injected / 10 caught / 0 missed** |

### Exact reproducing command

```bash
node bench/harness.mjs --seed 1 --repos 10
```

Machine-readable (the source of the table below):

```bash
node bench/harness.mjs --seed 1 --repos 10 --json
```

The harness exits `1` if the pristine baseline is not clean or if any injected class is missed.
It writes only inside `mktemp -d` and needs no network.

### Per-class result

| Class | Injected | Caught | Missed | Prompt-only baseline |
|---|---:|---:|---:|---|
| `untraced-requirement` | 1 | 1 | 0 | detectado por construcción: no |
| `phantom-task-id` | 2 | 2 | 0 | detectado por construcción: no |
| `unfilled-placeholder` | 1 | 1 | 0 | detectado por construcción: no |
| `completed-task-without-evidence` | 1 | 1 | 0 | detectado por construcción: no |
| `declared-contract-missing` | 1 | 1 | 0 | detectado por construcción: no |
| `spec-code-drift` | 2 | 2 | 0 | detectado por construcción: no |
| `expired-waiver` | 2 | 2 | 0 | detectado por construcción: no |
| **TOTAL** | **10** | **10** | **0** | |

### Verbatim harness output

```text
open-sdd — synthetic incoherence bench
  tool     open-sdd v3.1.0 (tools/open-sdd/dist/cli.js)
  node     v26.7.0   seed 1   repos 10
  baseline clean (0 error findings)

  class                            injected  caught  missed  prompt-only baseline
  -------------------------------- --------- ------- ------- ----------------------------------
  untraced-requirement             1         1       0       detectado por construcción: no
  phantom-task-id                  2         2       0       detectado por construcción: no
  unfilled-placeholder             1         1       0       detectado por construcción: no
  completed-task-without-evidence  1         1       0       detectado por construcción: no
  declared-contract-missing        1         1       0       detectado por construcción: no
  spec-code-drift                  2         2       0       detectado por construcción: no
  expired-waiver                   2         2       0       detectado por construcción: no
  -------------------------------- --------- ------- ------- ----------------------------------
  TOTAL                            10        10      0

  Synthetic repositories: one documented class injected per repo, from a clean baseline.
  These are HONESTY numbers on SYNTHETIC repos — not field data from real teams.
```

### What each class is and where the tool names it

| Class | Injected incoherence | Detector surface (exact command) |
|---|---|---|
| `untraced-requirement` | Delta entry `REQ-PAY-011` (audit trail) with no task citing it | `brownfield analyze payments --base HEAD --json` → `REQUIREMENT_WITHOUT_TASK` (error) |
| `phantom-task-id` | Task citing `REQ-PAY-999`, undefined in the delta | `brownfield analyze payments --base HEAD --json` → `PHANTOM_REQUIREMENT_ID` |
| `unfilled-placeholder` | Task `_Requirements: {{REQ-AREA-002}}_` | `delta validate payments` → `UNFILLED_REQUIREMENT_PLACEHOLDER` |
| `completed-task-without-evidence` | Task `[x]` with no `_Evidence:` line | `status payments` → `evidencia 0/1 tarea(s) completada(s)` |
| `declared-contract-missing` | Delta declares `test/missing.test.ts`, absent from disk | `brownfield analyze payments --base HEAD --json` → `DECLARED_CONTRACT_MISSING` |
| `spec-code-drift` | Commit touches `src/other.ts`; delta declares `src/ledger.ts` | `brownfield analyze payments --base HEAD~1 --json` → `DELTA_TARGET_UNTOUCHED` (error) |
| `expired-waiver` | Allow-list entry with `expires: 2020-01-01` still naming a real finding | `govern constitution --advise --json` → `waiver-expiring` |

Each repo is built from a clean baseline that the harness verifies has **0 error findings** before
the single defect is injected. That is what makes the attribution honest: the tool caught the thing
we put there, and the thing we put there was the only defect.

---

## Honesty notes — read before quoting any number above

- **These are honesty numbers on SYNTHETIC repositories, not field data from real teams.** Each
  repository contains one incoherence we wrote ourselves, with a marker we know the engine emits.
  A 10/10 result says the instrument is self-consistent and the documented classes are wired to
  real checks. It does **not** estimate recall on organic repositories, and it says nothing about
  precision against noise a real codebase produces.
- **The paper's prototype figures are not ours.** κ = 0.86 (n=15), C4 FPR 20.0 % and the 2.1–2.2 s
  sweep are measurements of the reference prototype, not of this CLI. See gaps G-01/G-02 in
  `docs/PAPER-ALIGNMENT.md`. They are not reproduced, reused or averaged here.
- **The "prompt-only" column is not a measurement of another tool.** A prompt-only workflow is a
  *text checklist*: it has no instrument, so it cannot verify any of these classes and cannot prove
  a negative. Its value is `detectado por construcción: no` — a statement about the absence of a
  verifier. Presenting it as `0/10` would invent a comparison we did not run.
- **The bench is a black-box run of the pinned CLI.** It invokes `tools/open-sdd/dist/cli.js` from
  this checkout. It never resolves the global `open-sdd` on `PATH` (a v2.0.0 binary with different
  behaviour), so the numbers belong to this source tree.
- **No model backend ships**, so nothing here is evidence about C5/intent alignment. The bench does
  not measure it.

### One finding the bench surfaced

The `expired-waiver` class is named by the **advisory** surface (`govern constitution --advise`).
The enforcement surface also fails on it — `gates run C2 --staged` exits `1` — but the
human-readable gate line truncates the finding detail at 180 characters
(`tools/open-sdd/src/cli/commands/paper.ts`, the `f.detail.slice(0, 180)` in the `gates run`
renderer), and the expired-waiver naming sits just past that cut. The gate therefore fails
correctly while the *reason* ("excepción caducada …; responsable: …") is not visible in the console
line. The full text is present in the report the engine builds; only the render is clipped. This is
recorded as a finding, not smoothed over.
