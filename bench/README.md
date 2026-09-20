# `bench/` — synthetic incoherence bench

A reproducible measurement of one narrow question: **for a documented class of incoherence that we
inject on purpose, does the tool's own output name it?**

```bash
node bench/harness.mjs                 # 10 repos, seed 1 (default)
node bench/harness.mjs --seed 7 --repos 14
node bench/harness.mjs --json          # machine-readable, for the table in docs/MEASUREMENTS.md
node bench/harness.mjs --keep          # keep the temp repos for inspection
```

Exit code is `0` only when the pristine baseline is clean **and** every injected incoherence was
caught. A miss exits `1`: a miss is a finding, not a rounding error to average away.

## What it does

1. Builds a **clean baseline** repository in a temp dir: a valid `.sdd/` (constitution, rigor,
   requirements, plan, delta, tasks), `src/ledger.ts` and `test/ledger.test.ts`, committed to a
   local git repo. The harness verifies this baseline produces **0 error findings** before it
   injects anything, so the defect is provably the cause.
2. Injects **exactly one** documented class into each repo (the assignment is shuffled by the
   seed, and every class appears at least once for `--repos >= 7`).
3. Runs **this checkout's pinned CLI** — `tools/open-sdd/dist/cli.js` — as a black box and asks
   whether its output names the class. It never resolves the global `open-sdd` on `PATH`.
4. Reports per class: `injected` / `caught` / `missed`.

Everything is offline and deterministic: the PRNG is a seeded `mulberry32`, git is invoked with a
null global/system config, and no network is touched. Repos live in `mktemp -d` and are removed
unless `--keep` is passed.

## The seven classes

| Class id | Injected incoherence | Detector surface |
|---|---|---|
| `untraced-requirement` | A delta requirement (`REQ-PAY-011`, audit trail) with no task citing it | `brownfield analyze --json` → `REQUIREMENT_WITHOUT_TASK` |
| `phantom-task-id` | A task citing `REQ-PAY-999`, an id the delta does not define | `brownfield analyze --json` → `PHANTOM_REQUIREMENT_ID` |
| `unfilled-placeholder` | A task whose `_Requirements:` is still `{{REQ-AREA-002}}` | `delta validate` → `UNFILLED_REQUIREMENT_PLACEHOLDER` |
| `completed-task-without-evidence` | A task marked `[x]` with no `_Evidence:` line | `status` → `evidencia 0/1 tarea(s) completada(s)` |
| `declared-contract-missing` | The delta declares `test/missing.test.ts`, which does not exist | `brownfield analyze --json` → `DECLARED_CONTRACT_MISSING` |
| `spec-code-drift` | A committed change touches `src/other.ts` while the delta declares `src/ledger.ts` | `brownfield analyze --base HEAD~1 --json` → `DELTA_TARGET_UNTOUCHED` (error) |
| `expired-waiver` | A security allow-list entry with `expires: 2020-01-01` still naming a real finding | `govern constitution --advise --json` → `waiver-expiring` |

The exact commands and the resulting counts are in **[docs/MEASUREMENTS.md](../docs/MEASUREMENTS.md)**.

## The prompt-only baseline column

The harness prints a column that is always `detectado por construcción: no`.

That column is **not** a measurement of another tool. "Prompt-only" here means a *text checklist*:
a written instruction that asks a model to look for these classes. A checklist has no instrument —
it cannot run `git diff`, cannot resolve a declared contract against the filesystem, cannot check a
task against an evidence marker, and cannot prove a negative. Asking it "did you find the phantom
id?" produces a claim, not a measurement, and there is nothing to falsify. So the honest value is
`detectado por construcción: no`: *by construction, it does not detect*. Stating it as a count
(e.g. "0/10") would imply we measured something and it scored zero, which would be a fabricated
comparison. We do not ship one.

The only measured column is the tool's own.

## Honesty notes

- These are **HONESTY numbers on SYNTHETIC repositories**, not field data from real teams. Each
  repo contains one defect we wrote ourselves, so a high catch rate is a statement about
  self-consistency (we know the marker; the tool emits it), not about recall on organic work.
- The paper's prototype figures (κ = 0.86 n=15, C4 FPR 20.0 %, the 2.1–2.2 s sweep) are **not**
  ours and are not reproduced here. See `docs/PAPER-ALIGNMENT.md` gaps G-01/G-02.
- `--repos` below 7 cannot cover every class; the per-class table shows `injected: 0` for the
  classes the seed did not schedule. That is coverage, not a miss.
- The `expired-waiver` class is named by the **advisory** surface (`govern constitution --advise`).
  The enforcement surface (`gates run C2 --staged`) also fails on it, but the human-readable gate
  line truncates its detail at 180 characters, so the expired-waiver naming is not visible there.
  That truncation is itself a finding — recorded in `docs/MEASUREMENTS.md`.
