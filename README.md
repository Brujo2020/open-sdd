# open-sdd

**Model-agnostic Spec-Driven Development on an enterprise agentic SDLC.**

`open-sdd` installs a spec-driven workflow into the coding agent you already use, and ships a
governance console that implements the reference architecture published in *Orquestación SDD-First
Multiagente para Desarrollo Enterprise: Una Arquitectura de Referencia Zero-Trust…* (Mario Alejandro
Ramos, NTT DATA, rev. 3, Sept 2026). Specs live in Git next to the code; the console resolves a
Zero-Trust gate chain, reports declared-vs-executed honestly, and never invents a measurement.

- **One CLI, many hosts.** 18 agent definitions across 8 skills-based variants (168 `SKILL.md`
  templates ship in this repository).
- **Specs in the repository.** `.sdd/specs/<feature>/` holds the Documentary Triad
  (`requirements.md` in EARS, `plan.md`, `tasks.md`), versioned and reviewed like code.
- **Brownfield first.** `/sdd-getspecs` reverse-engineers steering and editable spec seeds from an
  existing codebase; seeds must be reviewed before approval.
- **Governance you can inspect.** `gates`, `govern` and `assure` expose the chain, the invariants,
  the HITL thresholds, the threat model and the declared gaps as deterministic console output.
- **Honest by construction.** A control that is declared but not implemented is reported as such,
  not silently executed as an empty success.

> Full traceability of the paper's architecture onto this code — including what is *not*
> implemented — is in **[docs/PAPER-ALIGNMENT.md](docs/PAPER-ALIGNMENT.md)**.

---

## Install

### From a clone (the build and CLI commands below were verified this way)

```bash
git clone https://github.com/Brujo2020/open-sdd
cd open-sdd
npm --prefix tools/open-sdd install    # installs the CLI's dev dependencies
npm --prefix tools/open-sdd run build  # compiles to tools/open-sdd/dist/
node tools/open-sdd/dist/cli.js --help
```

`tools/open-sdd/dist/` is present and tracked, so a checkout can also run the CLI without building
first.

### Install the skills into a project

Run the CLI **inside the target repository**, or use the `install.sh` helper that takes the target
as its first argument:

```bash
# In the target repo (Claude Code skills, no prompts):
node /path/to/open-sdd/tools/open-sdd/dist/cli.js --claude-skills -y

# Or from the open-sdd checkout:
bash install.sh /path/to/your/repo --cursor-skills -y
```

The helper builds the CLI on first use and installs artifacts under `<repo>/.sdd/` plus the selected
agent's skill directory.

### Global CLI

```bash
npm run install:global          # builds, then installs this checkout globally
open-sdd gates chain            # one of: open-sdd, sdd-open, sdd, open-sdd
```

### Published package

The npm package is **`@brujo2020/open-sdd`**. Note two facts that the earlier documentation got
wrong — it advertised `npx open-sdd@latest`, which resolves to nothing:

- The unscoped name `open-sdd` is **not** this project (it does not exist on the registry), so
  `npx open-sdd@latest` fails. The scoped name is the only correct one.
- The scoped package is **not published yet**; `v3.0.2` is the version it will carry.

Until it is published, use one of the two paths that work today:

```bash
bash install.sh /path/to/your/repo            # from a clone: installs into a target repository
npm run install:global                        # from a clone: puts open-sdd on your PATH
```

Once published, the same entry point is available without a clone:

```bash
npx @brujo2020/open-sdd@latest --cursor-skills -y
```

### CLI flags

| Flag | Meaning |
|---|---|
| `--agent <id>` | Select an agent (see the table below) |
| `--<alias>` | Agent alias flags, e.g. `--claude-skills`, `--cursor-skills`, `--antigravity` |
| `--lang <code>` | `ja en zh-TW zh es pt de fr ru it ko ar el` |
| `--os <auto\|mac\|windows\|linux>` | Target OS (default `auto`) |
| `--sdd-dir <path>` | SDD root (default `.sdd` or `.kiro`); `--kiro-dir` is an alias |
| `--overwrite <prompt\|skip\|force>` | Overwrite policy (default `prompt`) |
| `--backup[=<dir>]` | Back up files before overwriting |
| `--profile <full\|minimal>` | Template profile (default `full`) |
| `--manifest <path>` | Plan from an explicit manifest |
| `--dry-run` | Print the plan, write nothing |
| `--yes`, `-y` | Skip prompts (`prompt` → `force`) |

In non-TTY environments, `prompt` falls back to `skip`.

---

## The workflow, in the agent

After installing, use the skills from your agent's chat:

| Command | What it does |
|---|---|
| `/sdd-help` | Interactive guide, cheatsheet and examples |
| `/sdd-getspecs [focus]` | Brownfield: reverse-engineer steering + editable spec seeds |
| `/sdd-brownfield` | Brownfield governance: recon, constitution, delta, impact and rigor (the 5 steps) |
| `/sdd-discovery "idea"` | Route new work; writes `brief.md` + `roadmap.md` |
| `/sdd-spec-quick <feature> [--auto]` | Requirements → design → tasks in one pass |
| `/sdd-impl <feature> [tasks] [--review required\|inline\|off]` | Autonomous or targeted implementation |
| `/sdd-validate-impl <feature>` | Standalone feature-level verification |
| `/sdd-audit <feature> [--regulatory]` | Drift report; EU AI Act / NIST RMF when requested |
| `/sdd-spec-status <feature>` | Progress and next actions |

The step-by-step path is `/sdd-steering` → `/sdd-spec-init` → `/sdd-spec-requirements` →
`/sdd-validate-gap` → `/sdd-spec-design` → `/sdd-validate-design` → `/sdd-spec-tasks` → `/sdd-impl`.

---

## Brownfield: governing an existing codebase

When the code already exists, the existing code is the de facto source of truth and the unit of
specification is not the system but the **delta**: the artifact that describes only what changes.
Three mechanisms implement that, all in the `open-sdd` console.

### Brownfield en 5 pasos

La regla que manda: **el código existente es la fuente de verdad de facto: no reinventes la
arquitectura, gobiérnala.** La ruta corta, en orden, con los mnemónicos del *Manual Maestro SDD
v3.0* (**ADSR** para la delta, **EARS** para la forma comprobable del requisito, **EGTAV** para las
cinco capas: Especificación, Generación, Tareas, Artefactos, Validación):

| Paso | Comando | Qué produce |
|---|---|---|
| 1. Reconocer | `open-sdd brownfield bootstrap .` | stack, módulos, evidencia y el plan ordenado de pasos |
| 2. Anclar | `open-sdd brownfield constitution . --write` | `.sdd/steering/constitution.md` descriptiva, con evidencia |
| 3. Describir el cambio | `open-sdd delta init <feature> "..."` → `open-sdd delta validate <feature>` | la delta ADSR: el contrato del cambio, no la spec de todo el sistema |
| 4. Comprobar | `open-sdd status --check`, `brownfield impact\|contracts\|reuse`, `govern rigor` | pivote constitucional, impacto, oráculo de regresión, reutilización |
| 5. Entregar | `open-sdd status` | la evidencia en las tareas, los gates del nivel declarado y un único panel |

El detalle está en el skill **`/sdd-brownfield`**
(`tools/open-sdd/templates/agents/*/skills/sdd-brownfield/SKILL.md`) y en la guía de 10 minutos
[docs/guides/brownfield-quickstart.md](docs/guides/brownfield-quickstart.md). La constitución es el
**pivote**: cada spec se valida contra ella con `open-sdd status --check`.

### 1. The delta is the contract of change

A delta has four sections — `ADDED`, `MODIFIED`, `REMOVED`, `RENAMED` (ADSR) — and every entry
carries a delta-scoped identifier `REQ-<AREA>-<NNN>` rather than an id for the whole system, which
is what keeps the obligation finite.

| Section | Extra obligation |
|---|---|
| `ADDED` | — |
| `MODIFIED` | `previous` (the behaviour replaced); contracts recommended |
| `REMOVED` | `previous` + `rationale` + `contracts` (all required) |
| `RENAMED` | `previous` required |

Each entry also declares a strangulation state (`legacy → both → new`), so moving a piece of the
old system into the new one is visible progress instead of an implied rewrite.

```bash
open-sdd delta init <feature> "what changes"    # scaffold .sdd/specs/<feature>/delta.md
open-sdd delta validate <feature>               # ids, EARS, targets, ADSR obligations, traceability
open-sdd delta status <feature>                 # counts, strangulation progress, traceability
```

Three reports back the change before it is written. `brownfield contracts <feature> [--verify]`
turns the delta's declared tests into the regression oracle: it lists which tests protect the
changed files, names the changed files **no** contract covers, and with `--verify` runs the test
command — exit code 0 with a declared contract missing is not a pass. `brownfield impact <feature>`
reports the reachable set, the touched API surface and the breaking changes; `brownfield reuse
<feature>` reports the symbols a reuse-first search would have found first.

### 2. The reverse constitution

`brownfield constitution` reads the repository and emits a **descriptive** constitution: the
principles the code already obeys, each with the evidence that it does, plus the stack declared an
established fact. A practice that is desired but absent is emitted as a **proposed amendment**, never
as a fact, and a descriptive principle without evidence is a validation error.

```bash
open-sdd brownfield survey .                    # what the project is: stack, tooling, modules, evidence
open-sdd brownfield constitution . --write      # write .sdd/steering/constitution.md
```

### 3. Niveles de exigencia (la escalera)

The three SDD rigor levels are a **cumulative ladder**: every level only *adds* demands and gates,
and a valid constitution is required at **every** level, because a blocking verdict must be able to
cite an authority. The default is **Spec-First**, and it is deliberately fluid: it runs the two
gates you can never self-authorize, not the whole audit.

| Level | What it adds | Active gates |
|---|---|---|
| **Spec-First** (default, fluid) | A requirements spec in checkable EARS form and a valid constitution. Nothing else: no evidence binding, no drift detection, no contracts, no regeneration. | C1, C2 |
| **Spec-Anchored** | + a living spec, the brownfield delta, requirement→task traceability, evidence binding and drift detection on every change. | C1, C2, C3, C6 |
| **Spec-as-Source** | + declared execution contracts and regeneration from the spec as the repair mechanism. | C1, C2, C3, C4, C5, C6 |

C2 (secrets and destructive commands) is active at every level **on purpose**: it is the hard subset
that never self-authorizes, so lowering rigor must not make a committed credential acceptable.

**How to raise the level:** declare it in `.sdd/settings/rigor.json` with the level and a non-empty
rationale (a rigor choice without a declared motive is not auditable, and a malformed file is
rejected rather than silently degraded). The optional `gates` field overrides which checks run: it
may **narrow** the list, but an unknown gate id is **rejected** rather than ignored, so a typo cannot
silently reduce the checks a project believes it is running.

```bash
open-sdd govern rigor            # compact: level + active gates + what it demands
open-sdd govern rigor --verbose  # the full level table, the rationale and every finding
open-sdd govern rigor --gates    # the ladder table: what each level adds and its gates
open-sdd govern rigor --select   # recommend a level from the decision table
```

The reconnaissance is workspace-aware: on this repository `brownfield survey .` reports TypeScript /
npm / tsc / Vitest and 9 modules, not the "JavaScript, no tests detected" it used to report when the
code lived in a nested workspace.

---

## Supported host agents

The authoritative list is `tools/open-sdd/src/agents/registry.ts` (`agentDefinitions`). Eight variants
are skills-based and carry the full 20-skill suite.

| Agent | `--agent` id | Alias flags | Installs into |
|---|---|---|---|
| Claude Code Skills | `claude-code-skills` | `--claude-code-skills`, `--claude-skills` | `.claude/skills` |
| Claude Code | `claude-code` | `--claude-code`, `--claude` | `.claude/commands/sdd` |
| Claude Code Agents | `claude-code-agent` | `--claude-code-agent`, `--claude-agent` | `.claude/commands/sdd` + `.claude/agents/sdd` |
| Codex Skills | `codex-skills` | `--codex-skills` | `.agents/skills` |
| Cursor Skills | `cursor-skills` | `--cursor-skills` | `.cursor/skills` |
| Cursor IDE | `cursor` | `--cursor` | `.cursor/commands/sdd` |
| GitHub Copilot Skills | `github-copilot-skills` | `--copilot-skills`, `--github-copilot-skills` | `.github/skills` |
| GitHub Copilot | `github-copilot` | `--copilot`, `--github-copilot` | `.github/prompts` |
| Gemini CLI Skills | `gemini-cli-skills` | `--gemini-cli-skills`, `--gemini-skills` | `.gemini/skills` |
| Gemini CLI | `gemini-cli` | `--gemini-cli`, `--gemini` | `.gemini/commands/sdd` |
| Windsurf Skills | `windsurf-skills` | `--windsurf-skills` | `.windsurf/skills` |
| Windsurf IDE | `windsurf` | `--windsurf` | `.windsurf/workflows` |
| OpenCode Skills | `opencode-skills` | `--opencode-skills` | `.opencode/skills` |
| OpenCode | `opencode` | `--opencode` | `.opencode/commands` |
| OpenCode Agents | `opencode-agent` | `--opencode-agent` | `.opencode/commands` |
| Antigravity Skills | `antigravity-skills` | `--antigravity-skills`, `--antigravity` | `.agent/skills` |
| Qwen Code | `qwen-code` | `--qwen-code`, `--qwen` | `.qwen/commands/sdd` |
| Codex CLI (prompts) | `codex` | `--codex`, `--codex-cli` | **deprecated** — the CLI refuses and points to `--codex-skills` |

The install path above is where the CLI writes **in your project**. The templates this repository
ships live under `tools/open-sdd/templates/agents/<agent>/`.

---

## Governance profiles

There are **two different profile axes**, and they are not interchangeable.

### 1. What blocks — `.sdd/settings/governance.json`

Verified in `tools/open-sdd/src/core/governance.ts` (`governanceProfiles`). Default is `solo`.

| `profile` | What blocks | Intended use |
|---|---|---|
| `solo` | Nothing. Checks run and report. | Building; you want the signal, not the friction. |
| `team` | Code written without an approved spec. | Shared repository. |
| `enterprise` | Everything (strict mode, all critical invariants). | Audited environments. |

Three checks exist; the profile decides which stop a run:
`spec_contract_present`, `boundary_integrity`, `verification_proofs_pass`. Explicit
`critical_invariants` override the profile; unknown ids are dropped rather than trusted. A check the
profile ignores still reports. See [docs/guides/governance-profiles.md](docs/guides/governance-profiles.md).

### 2. Which Zero-Trust controls are declared — `gates chain --profile`

Verified in `tools/open-sdd/src/core/gateCatalog.ts` (`ChainProfile`, `PROFILE_MANDATED`). The core
C1–C7 is constant; the activable layer is a function of the profile and of repository signals.

| `--profile` | Declared | Executed | Vacuous | Adds |
|---|---|---|---|---|
| `solo` (default) | 7 | 6 | 1 (C7) | — |
| `team` | 9 | 8 | 1 | O1, O5 |
| `regulated` | 12 | 11 | 1 | O1, O2, O3, O4, O5 (and `gates run` uses strict posture) |

> The names `enterprise` and `regulated` belong to different axes; `--profile enterprise` is not a
> valid chain profile. This divergence is recorded as gap G-08 in
> [docs/PAPER-ALIGNMENT.md](docs/PAPER-ALIGNMENT.md).

---

## The Zero-Trust console

All commands are read-mostly, deterministic, and safe to run from the repository root. They exit `0`
unless stated otherwise.

| Command | What it prints |
|---|---|
| `gates chain [--profile solo\|team\|regulated]` | The resolved chain, declared/executed/vacuous counts, and the repository signals that activated opt-ins |
| `gates crosswalk` | Implemented check → logical gate (G1–G21), plus the residue computed by subtraction |
| `gates list` | The 21 logical gates with tier, check and state |
| `gates enforcement` | Enforcement levels A–D, the per-tool write ceiling, and the sentinel fail-open warning |
| `gates run [ids…]` | Runs the resolved chain (or named controls). Exits `1` if the chain does not pass |
| `govern invariants` | Invariants I1–I6 and the inspection that decides each |
| `govern conformance` | Conformity level C0–C3 with per-invariant evidence |
| `govern hitl` | The quantified Human-in-the-Loop thresholds |
| `govern discipline` | §9.7 decidable properties (diff budget, scope containment) over the working diff |
| `floor status` / `floor install` | Whether the owned enforcement floor (commit hook + PR gate matrix) is installed, and installing it into a target project |
| `govern rigor` | Rigor mode for a change (`none`/`lite`/`spec-first`/`spec-anchored`/`spec-as-source`) |
| `govern appeal` | Relaxation receipts and override-rate recalibration |
| `govern meta-eval` | Cohen's κ pilot, the Landis–Koch floor and the preregistered `n` |
| `govern budget` | Governance overhead lines, the 30 % ceiling, metric definitions, T0–T3 routing |
| `assure threats` | OWASP Agentic → MITRE ATLAS → primary gates; regulatory crosswalk; the Zero-Trust borrowing boundary |
| `assure lab` | The five risk-lab banks and the preregistered refutation thresholds |
| `assure claims` | The five claim states and the measured/built/proposed inventory; `assure claims --verify` runs `docs/claims/paper-claims.yaml` and decides every claim by exit code (exits `1` only on `broken`) |
| `assure skills` | Skill classes, the MCP hard rule and the promotion ladder |
| `assure memory` | Memory mesh, distillation pipeline, anti-poisoning probe |
| `waves <feature>` | Transactional wave plan with the git commands that would materialise it (needs `.sdd/specs/<feature>/tasks.md`) |
| `brownfield survey [target]` | What the existing project is: stack, tooling, module boundaries and the evidence for each |
| `brownfield constitution [target] [--write]` | The descriptive constitution (principles the code obeys + proposed amendments); `--write` stores it in `.sdd/steering/constitution.md` |
| `delta init\|validate\|status\|render <feature>` | The contract of change: scaffold ADSR, validate ids/EARS/contracts/traceability, report counts and strangulation |
| `brownfield impact\|contracts\|reuse <feature>` | Analysis over the pending change: reachable set and breaking changes, the regression oracle (`--verify` runs the test command), reuse-first candidates |

Environment variables accepted by the console include `SDD_FEATURE`, `SDD_COMPLEXITY`,
`SDD_RELAXATIONS`, `SDD_CYCLE_TOKENS`, `SDD_META_TOKENS`, `SDD_AUDIT_TOKENS`, `SDD_DISTILL_TOKENS`,
`SDD_C2_OVERRIDES`/`SDD_C2_BLOCKS`, `SDD_C3_OVERRIDES`/`SDD_C3_BLOCKS`.

### SDLC commands

| Command | What it does |
|---|---|
| `status [feature]` | Spec/implementation progress |
| `init <feature>` | Scaffold a spec directory |
| `getspecs [focus]` | Brownfield scan → steering + spec seeds |
| `gap <feature>` | Gap / blast-radius analysis |
| `impl <feature>` | Implementation runner |
| `verify <feature>` | Feature-level verification |
| `audit <feature>` | Drift + traceability report |
| `help [topic]` | In-chat help |

---

## Reference architecture

The console is a port of the paper's control plane, not a re-description of it. The maps below give
the paper section and the implementing symbol; **[docs/PAPER-ALIGNMENT.md](docs/PAPER-ALIGNMENT.md)**
is the complete traceability report, including every declared gap.

| Paper (§ / Table) | This code | Symbol |
|---|---|---|
| Invariants I1–I6, conformity C0–C3 (§5.1, §5.2, Tables 17/18) | `src/core/invariants.ts` | `INVARIANTS`, `CONFORMITY_LEVELS`, `assessConformity` |
| 21 logical gates, executable chain, crosswalk, residue (Appendix A, Tables 33–36) | `src/core/gateCatalog.ts` | `LOGICAL_GATES`, `EXECUTABLE_CHAIN`, `buildCrosswalk`, `computeResidue` |
| Chain resolution from catalog + profile + signals (§9.5) | `src/core/gateCatalog.ts` | `resolveGateChain`, `detectSignals` |
| default-FAIL posture and the hard subset (§9.2) | `src/core/enforcement.ts` | `applyDefaultFail`, `HARD_SUBSET` |
| Enforcement levels A–D and per-tool ceilings (§6.3, Table 19) | `src/core/enforcement.ts` | `ENFORCEMENT_LEVELS`, `TOOL_ENFORCEMENT`, `resolveFloor`, `interpretSentinel` |
| Documentary Triad + evidence lock (§4.5, I2) | `src/core/triad.ts` | `TRIAD`, `evaluateTriad`, `checkEvidenceLock` |
| EARS grammar (§4.6, Table 12) | `src/core/ears.ts` | `EARS_TEMPLATES`, `validateEarsRequirement` |
| Gate runner (§9.2, §9.5, §8.4) | `src/core/gateRunner.ts` | `runGate`, `runChain`, `scanSecurity`, `checkSymbols` |
| HIL thresholds and rigor selection (§9.9, §4.8, §4.10, Table 25) | `src/core/hitl.ts` | `HITL_DEFAULTS`, `evaluateEscalations`, `selectRigorMode` |
| Appeal channel + relaxation receipts (I6, §9.10) | `src/core/receipts.ts` | `makeReceipt`, `recalibrate`, `assessI6` |
| META-EVAL protocol (§7.3, §7.4) | `src/core/metaEval.ts` | `cohensKappa`, `checkJudgeIndependence`, `checkApprovalDrift` |
| Transactional waves (§7.2) | `src/core/waves.ts`, `src/core/scheduler.ts` | `resolveWave`, `checkScope`, `waveGitCommands`, `buildTaskDependencyWaves` |
| Memory mesh, distillation and anti-poisoning (§11) | `src/core/memory.ts` | `MEMORY_MESH`, `decidePromotion`, `scanForInjection`, `applyDecay` |
| Skills as the unit of privilege; Auto-Skill Factory (§6.4, §11.1, Table 28) | `src/core/skills.ts` | `SKILL_CLASSES`, `checkMcpPermissions`, `evaluateCandidate` |
| Claims registry and implementation-status inventory (§9.6, §2.3) | `src/core/claims.ts`, `src/core/claimsRegistry.ts`, `docs/claims/paper-claims.yaml` | `CLAIM_STATUSES`, `evaluateClaim`, `IMPLEMENTATION_STATUSES`, `runClaimsRegistry` |
| Threat model, regulatory crosswalk, risk lab (§9.8, Appendix D, §14.3, Tables 24/31/39) | `src/core/assurance.ts` | `OWASP_AGENTIC_MAP`, `REGULATORY_MAP`, `RISK_LAB_BANKS`, `REFUTATION_THRESHOLDS` |
| Overhead budget and telemetry (Appendix B.4–B.6, §10.3) | `src/core/telemetry.ts` | `COST_LINES`, `evaluateGovernanceBudget`, `COMPLEXITY_TIERS`, `HARNESS_SELF_FAILURE` |
| Brownfield inversion (§12, Figure 9) | `src/core/reverseEngineering.ts` | `scanProject`, `bootstrapSteering`, `bootstrapSpecSeeds` |

### What this port does **not** do

Stated here so the reference section is not read as a claim of completeness:

- **The paper's prototype (SteelHarness) is not published.** Its measured figures — κ = 0.86 (n=15),
  C4 FPR 20.0 % (3/15), the 2.1–2.2 s sweep, the 7/9/12 chain counts, the −53 % token pilot — are
  properties of that prototype. They are **not** measurements of this repository, and the console
  labels the ones it reproduces as the paper's pilot.
- **No model backend ships.** C5 (intent alignment) reports `mode=degraded` and is not evidence;
  META-EVAL is a computational model, not a running judge.
- **C7/Karpathy is vacuous** (`inspects: false`) and is reported as activation without measurement.
- **The §9.7 decidable properties are implemented but not gate-wired.**
- **No gate calibration, no labelled corpus, no ON/OFF delta table.** The paper publishes no ON/OFF
  table either, so none is invented here.
- **The commit/merge floor is installed, but level A is not verified.** The pre-commit hook
  (level B) and the pull-request gate matrix (level C) both exist and are exercised; `resolveFloor`
  remains an ownership argument, and no behavioural sentinel has verified write-time blocking in any
  host, so level A is a ceiling and not a guarantee. `git commit --no-verify` bypasses level B and
  that bypass is not recorded.

Each of these is a numbered gap (G-01 … G-14) with its paper citation and code location in
[docs/PAPER-ALIGNMENT.md](docs/PAPER-ALIGNMENT.md).

---

## Enforcement floor (levels B and C)

The guarantee this tool can make on day one is the **commit/merge floor**, because those boundaries
belong to the organization rather than to a vendor. Both are installed here, and installed into any
target project:

```bash
npm run hooks:install              # level B in this checkout (also runs automatically on npm install)
open-sdd floor install . --ci      # level B + C in a target project
open-sdd floor status              # is the floor installed? exits 1 when it is not
```

The hook judges the **staged index**, not the working tree, and runs three controls: C1 (triad,
advisory), C2 (secrets and destructive commands, blocking) and C3 (evidence lock, blocking when a
task is marked complete without its captured proof). If the CLI itself is missing, the hook **fails
closed** and prints how to fix it. Legitimate false positives are declared per (path, pattern) with a
reason in `.sdd/settings/security-allowlist.json`, and every run reports how many findings it
suppressed — a suppression is never silent. `git commit --no-verify` also bypasses the hook, and
that bypass is **not** recorded; the allow-list is the channel an audit can read.

Level C is `.github/workflows/gates.yml` (`templates/hooks/open-sdd-gates.yml` for target projects):
the chain runs against the pull-request diff via `--base`, because a gate run that inspects nothing
is activation without measurement.

---

## Repository layout

```
open-sdd/
├── tools/open-sdd/            CLI source, templates, manifests
│   ├── src/core/            governance models (see the map above)
│   ├── src/agents/          agent registry (18 definitions)
│   ├── src/cli/commands/    status, init, getspecs, gap, impl, verify, audit, paper
│   ├── templates/agents/    168 SKILL.md templates across 8 skills variants
│   └── dist/                compiled CLI (committed)
├── docs/
│   ├── PAPER-ALIGNMENT.md   traceability report (paper → code → gaps)
│   ├── QUICK-START.md       5-minute path
│   ├── INSTALLATION.md      installation reference
│   ├── claims/              paper-claims.yaml (§9.6 registry)
│   └── guides/              workflow, governance, brownfield, git, skills
├── .sdd/                    settings + templates (project memory lives here)
├── install.sh               install the CLI artifacts into a target repo
└── package.json             bin: open-sdd, sdd-open, sdd, open-sdd
```

---

## Documentation

- **[docs/QUICK-START.md](docs/QUICK-START.md)** — install and run in five minutes.
- **[docs/INSTALLATION.md](docs/INSTALLATION.md)** — every install path and flag.
- **[docs/PAPER-ALIGNMENT.md](docs/PAPER-ALIGNMENT.md)** — paper-to-code traceability and gaps.
- **[docs/guides/governance-profiles.md](docs/guides/governance-profiles.md)** — what blocks, and when.
- **[docs/guides/spec-driven.md](docs/guides/spec-driven.md)** — the SDD workflow end to end.
- **[docs/guides/skill-reference.md](docs/guides/skill-reference.md)** — the 21 skills.
- **[docs/guides/git-workflow.md](docs/guides/git-workflow.md)** — branch/commit automation.
- **[docs/guides/brownfield-getspecs.md](docs/guides/brownfield-getspecs.md)** — existing codebases.
- **[docs/README.md](docs/README.md)** — documentation index.

## License

MIT — see [LICENSE](LICENSE).
