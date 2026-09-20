# Brownfield delta workflow

Practical guide to governing an existing codebase with open-sdd: the delta as the unit of
specification, the reverse-engineered descriptive constitution, and the three SDD rigor levels.

> Commands below are shown as `open-sdd …` for an installed CLI. In this repository, replace
> `open-sdd` with `node tools/open-sdd/dist/cli.js`.

## When to use it

Use this workflow when the code already exists and is the de facto source of truth — that is, any
repository where a change modifies behaviour rather than creating a system:

- Adopting open-sdd mid-flight on a running product.
- A change that touches existing contracts, endpoints, schemas or modules.
- Modernization or strangulation work where old and new implementations coexist.
- Any repository that must declare how much rigor a change accepts.

Do **not** use it for a greenfield system with no behaviour to preserve: there the normal
Documentary Triad (`requirements.md` → `plan.md` → `tasks.md`) is the contract, and a delta would
be a spec of the whole system in disguise.

## The delta is the contract of change

A delta describes **only what changes**. It is a markdown file at
`.sdd/specs/<feature>/delta.md`, and it has four sections — the ADSR mnemonic:

| Section | What it declares | Extra obligation |
|---|---|---|
| `ADDED` | Behaviour that does not exist yet | — |
| `MODIFIED` | Behaviour that exists and changes | `Previous` required; `Contracts` recommended (warning) |
| `REMOVED` | Behaviour that is withdrawn | `Previous`, `Rationale` and `Contracts` all required (errors) |
| `RENAMED` | Behaviour that keeps its semantics under a new name | `Previous` required |

Every entry carries an identifier scoped to the **change**, not to the system:
`REQ-<AREA>-<NNN>` (for example `REQ-AUTH-001`). That scoping is what keeps the obligation finite: a
task traces to a delta requirement, never to "everything".

### Entry format, filled

```markdown
## MODIFIED

### REQ-AUTH-001 — Sessions are issued by the new token service
- Statement: WHEN a client presents valid credentials, the [session service] shall issue a signed session token with a 15-minute lifetime.
- Previous: The legacy session store wrote an opaque cookie and looked it up in Redis on every request.
- Targets: src/auth/session.ts, POST /sessions
- Contracts: test/auth/session.test.ts::issues a session, test/auth/session.test.ts::rejects expired tokens
- Strangler: both
```

| Field | Meaning |
|---|---|
| `Statement` | The resulting behaviour, in EARS (`WHEN … the <system> shall …`) |
| `Previous` | The behaviour being replaced — required on MODIFIED, REMOVED, RENAMED |
| `Targets` | Files, symbols, endpoints or schemas the change touches (impact analysis needs them) |
| `Contracts` | The tests that cover the behaviour and must keep passing — the regression oracle |
| `Rationale` | Why the behaviour is withdrawn and how its consumers migrate — required on REMOVED |
| `Strangler` | `legacy`, `both` or `new` (see below) |

A `REMOVED` entry without a rationale and without contracts is rejected: an elimination without a
motive is an accident, not a decision.

## Strangulation: `legacy` → `both` → `new`

Strangulation is modelled **per entry**, so moving a piece of the old system into the new one is
visible progress instead of an implied rewrite:

| State | Meaning |
|---|---|
| `legacy` | The entry still runs entirely on the old path (the default) |
| `both` | Old and new implementations coexist; the contract protects the overlap |
| `new` | The entry runs entirely on the new path; nothing of the old remains |

`delta status` reports the distribution — how many entries are fully on the new path, how many
coexist, and how many are still legacy. A delta with everything on `legacy` is a plan; a delta with
everything on `new` is a description of work already done. Both are legitimate; pretending one is
the other is not.

## Writing the descriptive constitution

In brownfield, the first constitution must be **descriptive**: the principles the code already
obeys, with the evidence that it does. Its purpose is narrow and concrete — stop an agent from
silently "modernizing" code nobody asked it to modernize.

```bash
open-sdd brownfield survey .                      # what the project is, and the evidence for each fact
open-sdd brownfield constitution .                # print the constitution without writing it
open-sdd brownfield constitution . --write        # write .sdd/steering/constitution.md
```

`survey` reports the language, package manager, build tool, test framework, module boundaries and
the evidence gathered for each. `constitution` turns that into principles. On this repository it
finds, among others:

| Principle | Level | Evidence it cites |
|---|---|---|
| `C-STACK-FACT` | MUST | The stack as an established fact (npm, the lockfile, tsc) |
| `C-API-COMPAT` | MUST | The public entry points (`src/index.ts`, `src/core/index.ts`) |
| `C-BOUNDARIES` | SHOULD | The module directories |
| `C-REGRESSION-ORACLE` | MUST | The test runner and the test directory |

Three rules make the artifact trustworthy:

1. **A descriptive principle without evidence is a validation error.** A wish recorded as a fact is
   exactly the failure mode aspirational constitutions have.
2. **A desired-but-absent practice is emitted as a PROPOSED AMENDMENT**, never as a fact. On this
   repository, "reuse-first policy" and "incremental documentation" are amendments, not principles.
3. **The constitution is read as policy by models**, so an exception a user or an input controls
   ("unless the user says…") is rejected as an indirect-injection surface.

### Reading the amendments

The generated file has two sections: `## Principles` (in force) and `## Amendments` (proposed).
An amendment is not in force and does not govern anything yet. To promote one, it needs a migration
plan and a named actor; the model exposes `promoteAmendment` for that, but **no console command
promotes an amendment yet** — treat the amendments list as the backlog of things the code does not
do, and introduce them through a governed change when you are ready.

## The three rigor levels

Declaring a level is accepting its demands, not labelling the project. The levels are a **cumulative
ladder**: each step up only *adds* checks (2 → 4 → 6 gates), so raising the level is how you add
rigor, and no level retires what a lower one demanded.

| Level | What it adds | Active gates |
|---|---|---|
| **Spec-First** (default, fluid) | A requirements spec in checkable EARS form and a valid constitution. No drift detection, no evidence binding, no contracts, no regeneration. | C1, C2 |
| **Spec-Anchored** | + a living spec, the brownfield delta, requirement→task traceability, evidence binding and drift detection on every change. | C1, C2, C3, C6 |
| **Spec-as-Source** | + declared execution contracts and regeneration from the spec as the repair mechanism. | C1, C2, C3, C4, C5, C6 |

**The honest rule:** the constitution is the authority a blocking verdict cites, so it is
**required (blocking) at every level**, Spec-First included — a gate that blocks while citing a rule
nobody wrote is not a control. The default stays fluid not by skipping authority but by adding
nothing above the floor: EARS requirements, a valid constitution and C1+C2. **Raise the level to add
checks** (delta governance, traceability, evidence, drift, contracts, regeneration), never to earn
the right to cite a rule. C2 (secrets and destructive commands) is never one of the optional checks:
it stays active at every level, so lowering rigor does not make a committed credential acceptable.

The level's gate set is **configurable but validated**: the optional `gates` field in
`.sdd/settings/rigor.json` may narrow the list of checks, but an unknown id is rejected instead of
ignored, so a typo cannot lower the bar in silence.

### Which level to choose

`govern rigor --select` recommends a level from the decision table; the first matching condition
wins:

| Signal | Level |
|---|---|
| Scope not known | Spec-First (exploration-first) |
| High consequence (auth, payments, cross-team contracts, legacy modernization) | Spec-as-Source |
| Misreading is cheap | Spec-First |
| Complexity below the Lite threshold | Spec-First |
| Audited, or hard to reverse | Spec-as-Source |
| Reversible and not audited | Spec-Anchored |
| Brownfield | Spec-Anchored |
| Reversibility unknown | Spec-as-Source (conservative) |

Declare the choice in `.sdd/settings/rigor.json` — the level **and** a non-empty rationale, because
a rigor choice without a declared motive is not auditable:

```json
{
  "level": "spec-anchored",
  "rationale": "Existing repository, reviewed by pull request: traceability, evidence binding and drift detection are required; regeneration is not.",
  "brownfield": true
}
```

A malformed file or an empty rationale is rejected rather than silently degraded: a broken file must
not become an invisible lowering of the bar.

## Commands

```bash
# Reconnaissance and constitution
open-sdd brownfield survey [target]                 # stack, tooling, modules and the evidence for each
open-sdd brownfield constitution [target]           # print the descriptive constitution
open-sdd brownfield constitution [target] --write   # write .sdd/steering/constitution.md

# Delta lifecycle
open-sdd delta init <feature> "<title>" [--base <base>]   # scaffold .sdd/specs/<feature>/delta.md
open-sdd delta validate <feature>                         # ids, EARS, targets, ADSR obligations, traceability
open-sdd delta status <feature>                           # ADSR counts, strangulation progress, traceability
open-sdd delta render <feature>                           # normalised markdown

# Analysis over the pending change
open-sdd brownfield impact <feature>                      # dependents, blast radius, API surface, breaking changes
open-sdd brownfield contracts <feature>                   # the regression oracle: declared vs discovered, uncovered files
open-sdd brownfield contracts <feature> --write           # publish contracts.json for CI
open-sdd brownfield contracts <feature> --verify          # run the test command; exit 1 unless contracts are satisfied
open-sdd brownfield reuse <feature> [--symbols a,b]       # symbols a reuse-first search would have found first

# Rigor
open-sdd govern rigor            # compact: level + active gates + what it demands (exit 1 if blocking)
open-sdd govern rigor --verbose  # the full level table, the rationale and every finding
open-sdd govern rigor --gates    # the ladder table: what each level adds and its gates
open-sdd govern rigor --select   # recommend a level from the decision table
```

`delta validate` exits `1` on errors (it exits `0` with warnings, which is the honest signal that
the artifact is drifting towards a full-system spec). `govern rigor` exits `1` when the declared
level is not satisfied.

A worked example from this repository, run on its own delta:

```
$ node tools/open-sdd/dist/cli.js delta validate brownfield-support
  aviso              brownfield-support EMPTY_SECTION
      La sección REMOVED está vacía. …

  0 error(es), 1 aviso(s).
  Trazabilidad: 9/10 requisito(s) de la delta con tarea (90%); sin tarea: REQ-BF-010.
```

The warning is the empty `REMOVED` section — a decision recorded rather than an omission. The
traceability line is the two-way check in one sentence: it counts the requirements that have a task
**and** names the one that does not, which is why a delta can validate cleanly and still be an
honest report of unfinished work.

## What is not automated yet

Stated here so the workflow is not read as more than it is:

- **Contract verification exists but is not in CI.** `open-sdd brownfield contracts <feature>
  [--write] [--verify]` binds the delta's declared tests to the changed files, reports the changed
  files no contract covers, and with `--verify` runs the test command and exits `1` unless the
  contract set is satisfied (exit 0 with a declared contract missing is *not* a pass). But
  `.github/workflows/gates.yml` does not invoke it, so the oracle is a command a reviewer runs, not
  yet a boundary that blocks a merge. Wire it into your pipeline yourself.
- **A delta is never merged back into a base spec.** `merged` is a label an author writes; applying
  the ADSR entries to a base `requirements.md` is manual.
- **The compliance traceability matrix** (principle → artifact, plus change-impact) is implemented
  in the module but has no console command; `brownfield impact` answers the impact question from the
  dependency graph instead of from the constitution's evidence.
- **Amendment promotion** is modelled but not exposed by a command.
- **Impact and reuse-first are advisory.** `open-sdd brownfield impact` and `open-sdd brownfield
  reuse` report; they do not block (only `error`-severity impact findings exit non-zero, and the
  reuse rule is deliberately unenforced — the generated constitution emits it as a proposed
  amendment).

These are recorded as gaps G-15, G-16, G-17 and G-18 in
[docs/PAPER-ALIGNMENT.md](../PAPER-ALIGNMENT.md).
