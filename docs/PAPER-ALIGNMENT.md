# Paper alignment — traceability report

**Paper:** *Orquestación SDD-First Multiagente para Desarrollo Enterprise: Una Arquitectura de
Referencia Zero-Trust para Gobernar la Ingeniería de Software Agéntica a Escala* — Mario Alejandro
Ramos (NTT DATA), rev. 3, September 2026, 87 pp. (henceforth "the paper").

**Scope of this report:** how the paper's architecture maps onto the code that now lives in
`tools/open-sdd/src/core/`, what is implemented, what is a declared gap, and what the paper measured
that this repository does **not** measure. Every row names the file and the symbol that implements
it, so a reader can check the row instead of trusting it.

**What this report is not:** it is not evidence that the implementation works. It is an
*internal-consistency* instrument of exactly the kind the paper describes in §9.6 — prose and
repository agree on what exists, which is a real and narrow property. It would read the same on a
control plane whose gates blocked nothing. Self-audit is accounting; only an independent party
running the §14.3 benches would be evidence.

- Reproduce the claim counts with the product CLI:
  `node tools/open-sdd/dist/cli.js assure claims --verify`.
- Registry: [`docs/claims/paper-claims.yaml`](claims/paper-claims.yaml).
- Implementation status taxonomy: [§2.3 of the paper](https://doi.org/10.13140/RG.2.2.29185.42087).

---

## 1. Status vocabulary

The paper labels every component `medido` (data with provenance), `construido` (implemented and
exercised in the internal demonstrative harness, SteelHarness) or `propuesto` (design with
acceptance criteria, not built). Table 32 of the paper adds a fourth, external label —
`declarado` — with this caption:

> "'Declarado' significa implementado en un prototipo que el lector no puede inspeccionar, y es por
> tanto epistémicamente equivalente a una afirmación de los autores — fundimos aquí lo que borradores
> anteriores separaban en construido y propuesto, porque la distinción es invisible desde fuera."

| Label used here | Criterion applied to **this** repository |
|---|---|
| `medido` | Raw data with provenance produced **by this repository**: a reproducible command whose output is captured, or a captured artifact. |
| `construido` | Implemented here and exercised by an executable check that a reader can run. |
| `propuesto` | Design present as data/typing/comments, with no execution path. |
| `brecha declarada` | Declared and deliberately **not** implemented, and the code says so at runtime rather than laundering it into a pass. |

**Prototype collapse rule.** The paper's Table 5 caption and Table 32 caption are explicit: because
SteelHarness is not published, an external reader must collapse the paper's own `construido` and
`propuesto` into `declarado`. Everything this report labels `construido` is a claim about **this**
repository's code and is inspectable here; everything attributed to the paper's prototype is
labelled as the paper's, never restated as a measurement of this repository.

---

## 2. Measured result of the claims registry

Command run from the repository root, 2026-09-19:

```
$ node tools/open-sdd/dist/cli.js assure claims --verify
62 afirmaciones | 59 verificadas | 0 declaradas | 3 no medidas | 0 rotas | 0 desactualizadas
[exit=0]
```

| State (§9.6) | Count | Claims |
|---|---|---|
| `verified` | 59 | CLM-001 … CLM-027, CLM-030, CLM-032 … CLM-062 |
| `not-implemented` (declared gap confirmed) | 0 | — |
| `not-measured` (absence of evidence persists) | 3 | CLM-028 (`docs/lab` absent), CLM-029 (`bin/sh-gate` absent), CLM-031 (`.steelharness/` absent) |
| `broken` (text claims a pass the code does not deliver) | 0 | — |
| `outdated-text` (code improved past the prose) | 0 | — |

In the short vocabulary: **verified = 54, declared-gap = 0, absent/not-measured = 3, broken = 0,
outdated-text = 0** (out of 57). CLM-045 … CLM-057 decide the brownfield and rigor capabilities by
exit code: delta validation and two-way traceability, the mandatory `previous` on `MODIFIED`, the
evidence-or-amendment rule for descriptive principles, the constitution being blocking at every
level as the floor of the ladder, absent practices travelling as proposed amendments,
workspace-aware reconnaissance, contract extraction, the rule that exit code 0 never launders a
missing declared contract, the console report that publishes the oracle, the default level's
constitution-plus-requirements floor, the ladder monotonicity (2 → 4 → 6 gates), the rejection of an
unknown gate id, and the quiet `--no-drift` commit path.

Observed exit codes, from the run above: **CLM-028, CLM-029 and CLM-031 exited `1`; every other claim
exited `0`.** Both runners print the per-claim code, so the line above can be re-derived rather than
trusted.

Per §9.6, only `broken` halts a publication; there is none. The declaration limit of §9.6 applies
unchanged: **this proves internal consistency, not that what exists works.** One honest detail about
the process itself: an earlier revision of this report and of the registry recorded CLM-030 as a
declared gap, because at that moment no product command read the registry. The CLI then gained
`assure claims --verify`, which turned that entry into `outdated-text` — and the repair was editing
the registry text, never the code, exactly as §9.6 prescribes.

---

## 3. From the logical catalog to the executable chain

### 3.1 The 21 logical gates (Table 33) → the executable chain (Table 34) → the crosswalk (Table 35)

The catalog is data in `tools/open-sdd/src/core/gateCatalog.ts` (`LOGICAL_GATES`, `EXECUTABLE_CHAIN`).
Inspect with `node tools/open-sdd/dist/cli.js gates list` and `... gates crosswalk`.

| Logical gate (Table 33) | Tier | Imposed by | Executable? | Note |
|---|---|---|---|---|
| G1 Claridad de Requisitos | Hard | **C1** | yes | EARS conformance + Triad presence |
| G2 Completitud de Contexto | Hard | **O6** | opt-in | file-reference existence only (C8-scoped) |
| G3 Resolución de Dependencias | Hard | **O1** | opt-in | manifest presence + lockfile, not SLSA verification |
| G4 Consistencia Arquitectónica | Structural | **O4** | opt-in | ADRs cited by `plan.md` exist |
| G5 Línea Base de Seguridad | Structural | **C2** | yes (blocking) | secrets / destructive commands / injection patterns |
| G6 Descomposición de Tareas | Structural | **C1** | yes | DAG presence via Triad |
| G7 Cobertura de Riesgos | Structural | — | **residue** | retired to spec-checklist |
| G8 Calidad de Código | QE | — | **residue** | retired to CI |
| G9 Cobertura de Tests | QE | **C3** | yes | evidence lock over completed tasks |
| G10 Integridad de Integración | QE | — | **residue** | retired to CI |
| G11 Seguridad de Regresión | QE | — | **residue** | sustained by the existing test suite (evidence validated by C3) |
| G12 Documentación | QE | **C6** | yes | claims integrity |
| G13 Chequeo de Alucinaciones | Meta | **C4** | yes | symbol membership in this repository, else `undecidable` |
| G14 Chequeo de Consistencia | Meta | **C5** | yes (degrades) | needs a model backend; degrades honestly |
| G15 Alineamiento de Intención | Meta | **C5** | yes (degrades) | same |
| G16 Intercepción MCP | Meta | **O2** | opt-in | declared servers vs allow-list |
| G17 Disciplina de Salida | Transversal | — | **residue** | retired to a mode setting |
| G18 Memoria Viva | Transversal | **O5** | opt-in | inbox distilled within cadence |
| G19 Conocimiento Estructural | Transversal | **O3** | opt-in | index freshness against HEAD |
| G20 Integridad de Afirmaciones | Transversal | **C6** | yes | the same mechanism as this report |
| G21 Disciplina del Implementador | Transversal | **C7** | **vacuous** | `inspects: false`; activation without measurement (§9.7) |

### 3.2 The residue is computed by subtraction, never curated

`computeResidue()` in `gateCatalog.ts` builds the set of logical gates that no entry of
`EXECUTABLE_CHAIN` declares in `imposes`, excluding the vacuous case (which is reported separately,
because "no owner" and "an owner with no instrument" are different defects).

```ts
const covered = new Set(EXECUTABLE_CHAIN.flatMap((c) => c.imposes));
return LOGICAL_GATES.filter((g) => !covered.has(g.id) && g.state !== 'vacuous');
```

`node tools/open-sdd/dist/cli.js gates crosswalk` reports:

> `21 controles lógicos · 13 ejecutables · 1 vacíos · 16 cubiertos · 5 en el residuo`

| Residue (Table 36) | Tier | Destination recorded in code | Why it has no executable counterpart |
|---|---|---|---|
| G7 Cobertura de Riesgos | Structural | spec-checklist (histórico) | an automatic check would only assert a mitigation field is non-empty — compliance theatre, not coverage |
| G8 Calidad de Código | QE | CI | the project toolchain already owns lint/format; duplicating it adds latency without adding control |
| G10 Integridad de Integración | QE | CI | conflicts/build/suite belong to CI |
| G11 Seguridad de Regresión | QE | existing test suite (evidence validated by C3) | no gate of its own is claimed |
| G17 Disciplina de Salida | Transversal | mode setting | a violation is visible to the reader and damages no artifact; it fails the cost-asymmetry test |

Adding a logical gate, or wiring a new executable check, moves the crosswalk and the residue on
their own. That is the structural property the paper ascribes to its `gen-gate-tables-tex.py`
generator.

### 3.3 Which controls are executable, and the one that is vacuous

- **Executable (13):** C1–C6 and O1–O7 — `inspects: true`.
- **Vacuous (1):** **C7/Karpathy.** `EXECUTABLE_CHAIN` records `inspects: false`; the runtime
  (`enforcement.ts`, `applyDefaultFail`) refuses to let it pass as a control:

  > "Declarado pero vacío: el gate no inspecciona nada, así que no puede acreditar un control
  > (activación ≠ medición)."

  `gates chain` prints it as `vacío (activación ≠ medición)` and `gates chain --profile regulated`
  reports `Declarados: 12 · Ejecutables: 11 · No implementados: 0 · Vacíos: 1`.
- **Declared-but-not-implemented (0 here):** `ExecutableGate.implemented?: boolean` exists precisely
  to carry the paper's §9.5 state "counted in the chain, not executed, reported while the gap
  exists". No entry sets `implemented: false` today, so the profile-executed gap is zero. The field
  is the mechanism; the absence of a user of it is itself an honest statement.

**Why C7 is vacuous and reported.** The paper's own text (§9.7, §8.4) says `gate_C7` returns success
without inspecting anything and that this is the chain's least decidable check. This port encodes
that finding instead of laundering it: `inspects: false` propagates to the CLI, to `applyDefaultFail`
and to the residue computation (G21 is "covered" by a check that measures nothing — the one place
where coverage overstates).

---

## 4. Component-by-component map

| Paper element (§ / Table) | What the code does | File · symbol | Status |
|---|---|---|---|
| Framework definition; four pieces (§5, Table 16) | Grammar, validation chain and evidence binding are implemented. The constitution is now a first-class model with two provenances (`constitution.ts`) and a brownfield generator that writes a descriptive one to `.sdd/steering/constitution.md`; steering templates remain under `.sdd/settings/templates/steering/`. | `ears.ts`, `gateRunner.ts`, `triad.ts`, `constitution.ts`, `reverseConstitution.ts`, `.sdd/settings/templates/` | `construido` (4 of 4) · **brecha declarada** (normative amendment promotion unsurfaced — G-16) |
| Invariants I1–I6 (§5.1, Table 17) | Statements + the inspection that decides each; the runtime enforces I1 (authority on verdicts), I2 (evidence lock), I3 (`resolveFloor`/`assertFloorIsOwned`), I6 (receipts). I4 is modelled but not enforced; I5 has no scoping implementation. | `invariants.ts` · `INVARIANTS`; `enforcement.ts`; `receipts.ts`; `metaEval.ts` · `checkJudgeIndependence` | `construido` (I1, I2, I3, I6) · `propuesto` (I4) · **brecha declarada** (I5) |
| Conformity C0–C3 (§5.2, Table 18) | Cumulative levels; `assessConformity` derives the level from evidence and refuses C3 without a measured false-positive rate. | `invariants.ts` · `CONFORMITY_LEVELS`, `assessConformity`, `invariantsNotEvidenced` | `construido`; declared level **C1** (see G-09) |
| Documentary Triad (§4.5, Table 11) | `requirements.md` → `plan.md` → `tasks.md`; `design.md` accepted as a **declared** alias of `plan.md`; presence verdict explicitly labelled "approves by proxy". | `triad.ts` · `TRIAD`, `evaluateTriad`; `specManager.ts` · `parseTasksMarkdown`, `parseRequirementsMarkdown` | `construido` |
| Evidence lock / `_Evidence:` (I2, §4.5) | A completed task without a captured `_Evidence:` line is rejected; C3 runs it over `tasks.md`. | `triad.ts` · `EVIDENCE_MARKER`, `checkEvidenceLock`; `gateRunner.ts` · `runGate('C3')` | `construido` |
| EARS grammar (§4.6, Table 12) | Five templates, `shall` required, exactly-one-template diagnostic, vague-term list, compound-requirement heuristic, negative-requirement gap report, declared limit. | `ears.ts` · `EARS_TEMPLATES`, `validateEarsRequirement`, `validateRequirements`, `negativeRequirementGap`, `EARS_LIMIT` | `construido` |
| Applicability + rigor levels (§4.8, §4.10, Tables 13/14) | Decision function for `none/lite/spec-first/spec-anchored/spec-as-source` from discard-by-design, scope, misreading cost, reversibility, audit exposure and complexity. | `hitl.ts` · `selectRigorMode`, `RIGOR_POLICY`; CLI `govern rigor` | `construido` as a decision function · `propuesto` as an adaptive engine wired to runs |
| When not to delegate (§4.7) | Two non-capacity escalations: irreversible unbounded damage, and nobody able to evaluate the output. | `hitl.ts` · `evaluateEscalations` (`irreversible-damage`, `no-local-evaluator`) | `construido` (criteria) |
| Enforcement levels A–D and the per-tool ceiling (§6.3, Table 19) | Levels, ownership, per-tool write ceiling with caveats, sentinel semantics (`exit 2` blocks; `exit 1` is read as hook failure → fail-open), ceiling-vs-floor resolution. | `enforcement.ts` · `ENFORCEMENT_LEVELS`, `TOOL_ENFORCEMENT`, `DEFAULT_SENTINEL`, `interpretSentinel`, `resolveFloor`, `assertFloorIsOwned`; CLI `gates enforcement` | `construido` (model) · **brecha declarada** (no host hooks/adapters shipped — see G-11) |
| default-FAIL and the hard subset (§9.2) | Two regimes; the default is the flexible one; an unavailable sensor self-authorizes with a receipt except in the hard subset; a scanner that fired never self-authorizes. | `enforcement.ts` · `HARD_SUBSET`, `applyDefaultFail`, `posturePasses`, `unresolvedReceipts` | `construido` |
| Control admission criterion A1–A3 (§9.3) | Each logical gate carries `admission: { silence, independence, costAsymmetry }`, derived and shown per row so a reader can disagree with one row rather than an accumulated count. The A2 co-activation measurement is not performed (the paper reports its own failure in §9.4). | `gateCatalog.ts` · `AdmissionCriteria`, `LOGICAL_GATES[].admission` | `construido` (recorded flags) · **brecha declarada** (A2 measurement) |
| Chain resolution + signals (§9.5, Tables 33–36) | Core constant; opt-in activated by profile or by a repository signal, each activation citing the signal; declared/executed/vacuous reported separately. | `gateCatalog.ts` · `resolveGateChain`, `detectSignals`, `buildCrosswalk`, `computeResidue`, `catalogSummary`; `cli/commands/paper.ts` · `detectRepoSignals` | `construido` |
| The gate runner (§9.2, §9.5) | One branch per control; every branch reports **sensor availability** and **fired** separately. C1 runs `evaluateTriad` + EARS; C2 `scanSecurity`; C3 evidence lock; C4 `buildSymbolIndex`/`checkSymbols`; C5 declares itself degraded; C6 checks referenced docs exist; C7 returns vacuous; O1–O7 check their artifact. | `gateRunner.ts` · `runGate`, `runChain`, `scanSecurity`, `buildSymbolIndex`, `checkSymbols`, `HARD_CONTROL_BY_GATE` | `construido` |
| Hallucination check C4/G13 and the declared verdict domain (§8.4) | `present` / `absent` / `external` / `undecidable`; only a symbol whose prefix is a module of this repository is judgeable. The index is built in-process; there is no cached `.sdd/.graph` index and no labelled corpus. | `gateRunner.ts` · `SymbolVerdict`, `checkSymbols`, `buildSymbolIndex` | `construido` (domain logic) · **brecha declarada** (index cache and FPR bench — see G-03) |
| META-EVAL protocol (§7.3, §7.4) | Cohen's κ, Landis–Koch band, preregistered `n = 120`, approval-drift monitor (>2σ), blind-sentinel self-preference test, judge-family independence with honest downgrade to advisory, the three judge biases, the temperature-zero note. | `metaEval.ts` · `cohensKappa`, `checkApprovalDrift`, `checkSelfPreference`, `checkJudgeIndependence`, `JUDGE_BIASES`, `DETERMINISM_NOTE`; CLI `govern meta-eval` | `construido` (model) · `propuesto` (confirmatory study at n ≥ 120; no live judge) |
| Transactional waves (§7.2) | States, six stated invariants, all-or-nothing `resolveWave`, scope gate, worktree/branch/identity assignment, and the git commands that would materialise the wave. Parallelism is bounded by DAG frontier; the deadlock fallback force-picks one task. | `waves.ts` · `WaveState`, `WAVE_INVARIANTS`, `resolveWave`, `checkScope`, `planWorktrees`, `waveGitCommands`; `scheduler.ts` · `buildTaskDependencyWaves`; CLI `waves` | `construido` (plan and rules) · **brecha declarada** (no executor runs the git commands — see G-10) |
| HIL thresholds (§9.9, Table 25) | All published thresholds as configuration, with the "uncalibrated starting values" caveat attached and the complexity scale declared non-transferable. | `hitl.ts` · `HITL_DEFAULTS`, `evaluateEscalations`, `calibrateEscalationThreshold`; CLI `govern hitl` | `construido` · `propuesto` (the quarterly calibration run) |
| Appeal channel + relaxation receipts (I6, §9.10) | Mandatory actor/reason/hash on every receipt, override journal, ≥20 % sustained → design review, `assessI6`, accepted-risk ledger. Journal path `.sdd/receipts.json` (absent in a fresh checkout → zero relaxations, I6 satisfied vacuously by emptiness). | `receipts.ts` · `makeReceipt`, `recordOverride`, `recalibrate`, `assessI6`, `acceptedRiskLedger`; CLI `govern appeal` | `construido` |
| Memory mesh + distillation + anti-poisoning (§11, Figure 8) | Three backends; capture → distillation → promotion → injection with quarantine; provenance signature; injection-pattern scanner; promotion gate requiring provenance, no origin-withdrawal, clean scan and G5 screening; decay/degradation; living-memory cadence. | `memory.ts` · `MEMORY_MESH`, `MEMORY_PIPELINE`, `scanForInjection`, `decidePromotion`, `applyDecay`, `evaluateLivingMemory`; CLI `assure memory` | `construido` |
| Auto-Skill Factory (§11.1, Table 28) | Candidates, not skills; non-empty MCP declaration rejects; judge ≠ author; judge family ≠ generator family; ≥2 observations; born with a review date; expiry on two activation cycles or a vanished pattern. | `skills.ts` · `PROMOTION_LADDER`, `SKILL_METRICS`, `evaluateCandidate`, `evaluateCandidateExpiry` | `construido` |
| Skills as the unit of privilege (§6.4) | Four classes and their failure modes; three-level progressive disclosure; hard rule that no skill widens the reachable MCP set; bidirectional permission check; third-party policy. | `skills.ts` · `SKILL_CLASSES`, `PROGRESSIVE_DISCLOSURE`, `checkMcpPermissions`, `checkBidirectionalPermissions`, `THIRD_PARTY_SKILL_POLICY`; CLI `assure skills` | `construido` (rules) · `propuesto` (live MCP proxy / concession registry file) |
| Threat model and regulatory crosswalk (§9.8, Table 24; Appendix D, Table 39) | OWASP Agentic → ATLAS → primary gates → complementary control; harness control → EU AI Act / NIST AI RMF / ISO 42001; the "Zero-Trust borrowing boundary" of §9.1 (what is claimed, what is not). | `assurance.ts` · `OWASP_AGENTIC_MAP`, `REGULATORY_MAP`, `REGULATORY_CONTEXT`, `ZERO_TRUST_BOUNDARY`; CLI `assure threats` | `construido` (data tables) |
| Risk lab and refutation thresholds (§14.3, Table 31) | Five banks with purpose, artifact and standard mapping; preregistered refutation thresholds with status `measured`/`preregistered`; fixed artifact format; adversarial-validator steps; three exit questions. | `assurance.ts` · `RISK_LAB_BANKS`, `REFUTATION_THRESHOLDS`, `LAB_ARTIFACT_FIELDS`, `LAB_EXIT_QUESTIONS`, `ADVERSARIAL_VALIDATOR`; CLI `assure lab` | `construido` (protocol data) · `propuesto` (the benches are not run here) |
| Overhead budget and telemetry (Appendix B.4–B.6, §10.3) | Three cost lines (only the human one does not fall with model prices); 30 % ceiling with expensive-first degradation; 70 % compaction trigger with its four steps; operational metric definitions; ON/OFF comparison function; T0–T3 routing and escalation; harness self-failure asymmetry. | `telemetry.ts` · `COST_LINES`, `evaluateGovernanceBudget`, `CONTEXT_COMPACTION_TRIGGER`, `evaluateCompaction`, `METRIC_DEFINITIONS`, `compareLoopEconomy`, `COMPLEXITY_TIERS`, `routeModel`, `escalateTier`, `HARNESS_SELF_FAILURE`; CLI `govern budget` | `construido` (policy) · **brecha declarada** (no telemetry recorded here) |
| Manuscript as executable contract (§9.6) | Five claim states with the rule that only `broken` halts publication; `evaluateClaim`, `assessClaims`, the generator limit; implementation-status inventory `measured/built/proposed` with the defensive rule that no proposed component participates in today's guarantees; the registry is executed by the CLI, not only printed. | `claims.ts` · `CLAIM_STATUSES`, `evaluateClaim`, `assessClaims`, `renderClaimsSummary`, `CLAIMS_REGISTRY_LIMIT`, `IMPLEMENTATION_STATUSES`, `auditInventory`; `claimsRegistry.ts` · `parseClaimsRegistry`, `runClaimsRegistry`; `cli/commands/paper.ts` · `assure claims --verify`; `docs/claims/paper-claims.yaml` | `construido` |
| Brownfield inversion (§12, Figure 9, Tables 40/41) | Workspace- and configuration-aware reconnaissance: the scan walks declared workspace roots (`tools/open-sdd`, `packages/*`, …) and reads both manifests and config files, so this repository reports TypeScript / npm / tsc / Vitest and 9 modules instead of "JavaScript, no tests detected". It still writes descriptive steering and up to five spec seeds. | `reverseEngineering.ts` · `scanProject`, `bootstrapSteering`, `bootstrapSpecSeeds`; CLI `getspecs` | `construido` — the inversion itself is completed by the rows below; see G-12 |
| Delta specs — the contract of change (§12, Figure 9, Tables 40/41) | ADSR sections, delta-scoped `REQ-<AREA>-<NNN>` ids, mandatory `previous` on MODIFIED/REMOVED/RENAMED, mandatory rationale + contracts on REMOVED (warning on MODIFIED), a 25-entry size warning, per-entry strangulation `legacy → both → new`, and two-way traceability (requirement → task; tasks citing unknown ids reported as phantoms). | `deltaSpec.ts` · `validateDeltaSpec`, `traceDelta`, `strangulationReport`, `renderDeltaSpec`, `parseDeltaSpec`, `deltaCounts`; `cli/commands/brownfield.ts` · `handleDeltaCommand`; CLI `delta init\|validate\|status\|render` | `construido` · **brecha declarada** (contracts declared, not executed — G-15; no merge-back — G-17) |
| The Constitution: one model, two provenances (CSDD §3.2 six-field anatomy, §3.3 compliance matrix, §3.4 apex; §6.1 injection) | `descriptive` principles must carry evidence; `normative` ones enter only through an amendment with a migration plan. Six-field anatomy, `MUST`/`SHOULD`/`MAY`, citable authority (`resolveAuthority`), indirect-injection scan, markdown round-trip, compliance matrix and amendment promotion. | `constitution.ts` · `validateConstitution`, `principlesInForce`, `resolveAuthority`, `renderConstitution`, `parseConstitution`, `buildComplianceMatrix`, `impactedPrinciples`, `promoteAmendment`, `detectInjection`; CLI `brownfield constitution` | `construido` (model + validation) · **brecha declarada** (matrix and amendment promotion unsurfaced — G-16) |
| Reverse-engineered descriptive constitution (§12) | Reads the repo's facts (lockfile, migration dirs and rollbacks, CI workflows, public API entry points, config files), emits a principle only when compliance is evidenced in the code, declares the stack an established fact, and emits desired-but-absent practices as PROPOSED AMENDMENTS — never as facts. | `reverseConstitution.ts` · `collectRepoFacts`, `buildDescriptiveConstitution`; CLI `brownfield survey`, `brownfield constitution --write` | `construido` (evidence is artifact presence, not extracted behaviour — G-12) |
| Three SDD rigor levels (*Manual Maestro* §2.4; reference architecture §4.8/§4.10) | Spec-First / Spec-Anchored / Spec-as-Source as a **cumulative ladder** (gates 2 → 4 → 6; every level only adds), each with its per-aspect demands, active gate ids, evaluator question and missing-artifact policy. A valid constitution is **required (blocking) at every level**, Spec-First included, because a blocking verdict must cite an authority at every level (CSDD §3.4, invariant I1); the default `spec-first` is deliberately fluid because it adds nothing above that floor. The declared level lives in `.sdd/settings/rigor.json` with a mandatory rationale and an optional `gates` override that may narrow the list but whose unknown ids are rejected; `assessRigor` evaluates the repository against it. Where a demand is not decidable from artifacts it is reported as a `brecha declarada` (regeneration at Spec-as-Source) instead of being faked as satisfied. | `rigor.ts` · `RIGOR_LEVELS`, `RIGOR_LADDER`, `RIGOR_REQUIREMENTS`, `rigorRequirements`, `rigorRequires`, `effectiveGates`, `validateGateOverride`, `selectRigorLevel`, `constitutionRequired`, `loadRigorSettings`, `resolveRigorSettings`, `assessRigor`, `isRigorLevel`, `toSddRigorLevel`; `.sdd/settings/rigor.json`; CLI `govern rigor [--select\|--gates\|--verbose\|--quiet]` | `construido` |
| Brownfield console (§12; *Manual Maestro* §2.4) | One deterministic surface for the brownfield path: reconnaissance of the existing project, the reverse constitution (printed, or written to `.sdd/steering/constitution.md` with a round-trip check), the delta lifecycle, and three analysis reports over the change — impact (dependents, blast radius, API surface, breaking changes), contracts (the regression oracle, with `--verify` running the test command) and reuse (`REUSE_FIRST_RULE` candidates). | `cli/commands/brownfield.ts` · `handleBrownfieldCommand`, `handleDeltaCommand`; `index.ts` dispatch; CLI `brownfield survey\|constitution\|impact\|contracts\|reuse`, `delta init\|validate\|status\|render` | `construido` · **brecha declarada** (contract verification is not in CI — G-15) |
| Execution contracts, change impact, reuse-first (§12; CSDD §3.3) | The regression oracle as data: which tests protect the changed files, which changed files no contract covers, and whether a run satisfied the declared contracts (`satisfied` requires exit 0 **and** no declared contract missing); the change's reachable set, breaking changes and integration points; the symbols a reuse-first search would have found first. | `executionContract.ts` · `extractContracts`, `verifyContracts`, `testCommandFor`, `contractsFileName`; `changeImpact.ts` · `analyzeChangeImpact`; `reuseFirst.ts` · `findReuseCandidates`, `scanDeclarations`, `REUSE_FIRST_RULE`; CLI `brownfield impact\|contracts\|reuse` | `construido` (commands) · **brecha declarada** (advisory, not gate-wired) — see G-15/G-18 |
| One entry point for an existing repository — `brownfield bootstrap` (spec-kit issue #1436: the **concept is adopted and reimplemented on our own engine**, not a port of their extension; *Manual Maestro* v3.0 EGTAV) | Composes the scanners that already existed — `scanProject`, `collectRepoFacts` + `buildDescriptiveConstitution`, `findReuseCandidates` — into one plan, plus two artifacts that did not exist: the **module responsibility map**, with a decidable answer to "where does new code go?" (`answerCodePlacement`), and `.sdd/steering/codebase-intelligence.md` for agents, carrying a provenance marker and never overwriting a hand-authored file. This is our reading of the spec-kit issue's knowledge-document idea, rebuilt on our engine: it re-scans nothing and re-implements no symbol search. `--focus` names the first change; `--write` writes the intelligence document and generates the constitution if absent; `--json` emits the plan. | `bootstrap.ts` · `planBootstrap`, `buildModuleMap`, `answerCodePlacement`, `writeCodeIntelligence`, `CODE_INTELLIGENCE_MARKER`; `cli/commands/brownfield.ts` · `handleBrownfieldCommand`; CLI `brownfield bootstrap [target] [--focus "<texto>"] [--write] [--json]` | `construido` · **brecha declarada** (the plan lists the focus delta seed as `create`, but `--write` writes only the intelligence document and the constitution; the seed comes from `delta init` — G-20) |
| Agent-agnostic installation (§6.4 progressive disclosure; Table 4) | 15 agent definitions; 8 skills-based variants × 21 skills = 168 `SKILL.md` templates; per-agent layout, alias flags and completion guides. `sdd-brownfield` is the 21st skill and its eight copies are byte-identical (the `sdd-help` precedent). | `agents/registry.ts` · `agentDefinitions`, `agentList`; `tools/open-sdd/templates/agents/**` | `construido` |
| One dashboard for the whole state — `status [feature] [--check] [--quiet] [--json]` (*Manual Maestro* v3.0 EGTAV — the validation layer is where a brownfield workflow is read) | A single panel over the repository: the constitution (present/valid, principles in force, pending amendments), every spec (phase, triad, traceability, evidence), the delta counts and strangulation, the contract set with its uncovered changes, the constitutional alignment, the rigor level with its active gates, and the **next command to run**. `--check` appends the per-spec constitutional validation; `--quiet` collapses the panel to one line with the verdict in the exit code, which is the commit-time form; `--json` emits the aggregate for tooling. | `core/status.ts` · `buildRepositoryStatus`, `renderStatusPanel`, `renderStatusLine`, `nextAction`; `cli/commands/status.ts` · `handleStatusCommand`; CLI `status [feature] [--check] [--quiet] [--json]` | `construido` · **brecha declarada** (the alignment is a report: nothing blocks because a spec ignores a principle — G-16) |
| The constitution as the pivot of every spec (*Manual Maestro* v3.0; CSDD §3.4 apex, invariant I1) | Given a spec's requirements/plan/tasks and its brownfield delta, answers three questions a reviewer cannot answer consistently: whether the principles the spec **cites** exist and are in force (`UNKNOWN_PRINCIPLE`, error — a phantom authority), whether the spec **contradicts** a `MUST` (`MUST_CONTRADICTED`, `TECH_LOCK_VIOLATION`), and whether the artifacts it produces respect the imposed boundary, API-compatibility and regression-oracle rules (`BOUNDARY_VIOLATION`, `API_COMPAT_MISSING`, `ORACLE_MISSING`). A spec that cites nothing is `NO_PRINCIPLES_DECLARED` (warning) and scores alignment 0, so the pivot cannot be silently unused. When a rule cannot decide, it says so in `detail` instead of emitting a finding: an `ok` over something not inspected is refused. `status --check` exits 1 only on error-severity findings. | `specConstitution.ts` · `alignSpecWithConstitution`, `declaredPrinciples`, `SPEC_PRINCIPLES_MARKER`, `ConstitutionalAlignmentFinding`, `SpecAlignment`; `constitution.ts` · `principlesInForce`; CLI `status --check` | `construido` · verified on this repository (alignment 100 %, 0 errors, 1 `BOUNDARY_VIOLATION` warning; a synthetic phantom principle makes `status --check` exit 1 — CLM-062) |
| Governance profiles (repo-level) and chain profiles (§9.5) | Two distinct axes: `governance.json` ships `solo|team|enterprise` (what blocks); the Zero-Trust chain resolver accepts `solo|team|regulated` (which controls are declared). | `governance.ts` · `governanceProfiles`, `resolveGovernanceSettings`; `gateCatalog.ts` · `ChainProfile`, `PROFILE_MANDATED` | `construido` — but see G-08 (naming divergence) |

### 4.1 Brownfield — the unit of specification is the delta

In a brownfield repository the existing code is the de facto source of truth, so the unit of
specification is not the system but the **delta**: the artifact that describes only what changes. A
delta is four sections, and three of them carry an obligation beyond the statement:

| ADSR section | What it declares | Extra obligation |
|---|---|---|
| `ADDED` | Behaviour that does not exist yet | — |
| `MODIFIED` | Behaviour that exists and changes | `previous` (the behaviour being replaced) is required; contracts are recommended (warning) |
| `REMOVED` | Behaviour that is withdrawn | `previous`, `rationale` and `contracts` are all required (errors) |
| `RENAMED` | Behaviour that keeps its semantics under a new name | `previous` is required |

Every entry carries a delta-scoped identifier `REQ-<AREA>-<NNN>` and a strangulation state
(`legacy → both → new`) that makes coexistence with the old path visible instead of implying a
rewrite. `delta validate` checks identifiers, EARS statements, targets, the ADSR obligations and
two-way traceability; `delta status` prints the counts and the strangulation progress.

**The honest example is this repository's own delta.** `.sdd/specs/brownfield-support/delta.md`
contains the brownfield work as ADSR entries. `REQ-BF-003` is a `MODIFIED` entry whose `Previous:`
line names the defect it replaces ("the scan read only the repository root, so a workspace layout was
reported as JavaScript with no tests detected — including on this repository"), and whose
`Contracts:` line names `tools/open-sdd/test/coreBrownfield.test.ts` and
`coreReverseEngineering.test.ts`. Running
`node tools/open-sdd/dist/cli.js delta validate brownfield-support` reports **0 errors** and, at the
time of writing, **9/10 requirements with a traced task (90%), naming `REQ-BF-010` as the one
without** — the two-way check stated in a single line. The single warning is the empty `REMOVED`
section: a decision recorded rather than an omission. What that line does *not* prove is the
regression oracle: the contracts are declared, but nothing executes the delta→contract mapping
(G-15) — a gap the delta itself now declares as the `ADDED` entry `REQ-BF-008` ("the tests that
protect the change are declared and verified"), whose target module exists but has no caller. The
delta is also never merged back into a base spec (G-17).

---

## 5. Gaps between the paper and this implementation

Each gap is stated plainly, with the paper section and the code location.

### G-01 — The prototype (SteelHarness) is not published

Paper: Table 5 caption, Table 32 caption, §16 "Nota sobre el prototipo"; retracted-conjecture
history in §1. An external reader **must** collapse the paper's `construido` and `propuesto` into
`declarado`. Nothing in this repository makes the prototype's artifacts inspectable: there is no
`.steelharness/`, no `configs/gates.yaml`, no `bin/sh-gate`, no `bin/sh-claims`, no
`docs/feature-status.md`, no `docs/lab/`. Claims CLM-028/029/031 confirm three of those absences by
exit code. Where this report says a paper element is `construido`, it means *in this repository*,
never *in the paper's prototype*.

### G-02 — The paper's measured numbers are properties of the prototype, not of this repository

These figures may **not** be restated as measurements of `open-sdd`:

| Figure | Paper locus | Why it must not be restated here |
|---|---|---|
| κ = 0.86, n = 15, 5 TP / 1 FN / 0 FP / 9 TN, `mode=ollama` | §7.4, §14.1, §14.2, Table 5 | No live judge and no sentinel corpus exist here. `metaEval.ts` reproduces the coefficient from the hardcoded confusion matrix to exercise the arithmetic; `cohensKappa` flags `tooSmallToConclude: true`. The console prints the **paper's** pilot label, not a fresh measurement. |
| C4 FPR = 20.0 % (3/15), specificity 0.8000, Wilson CI [0.5481, 0.9295] | §8.4, §14.2, Table 31 | Calculated over the prototype's balanced n=30 corpus, which this repository does not ship. `assurance.ts` stores the string as the `measured` value of the `c4-fpr` threshold — a transcription, not a local run. |
| Full sweep 2.1–2.2 s; symbol check 61 s → <1 s; index built at commit close | §9.5, §14.1 | There is no `bin/sh-gate` and no cached index here (CLM-029). `gates run` executes the TS runner over the current tree; no sweep latency is claimed. |
| Chain sizes 7 / 9 / 12 on the implementation repository | §9.5 | `gateCatalog.ts` reproduces the **policy** that yields 7/9/12 on a repository matching the paper's profile. The counts here fall out of `PROFILE_MANDATED` and detected signals; they are not a re-measurement of the paper's repository. |
| −53 % wasted context tokens, ~−40 % cost per session | Appendix B.1 | One-installation pilot of the prototype; no equivalent instrumentation exists here. |
| `sh-claims --check` → OK (14 real, 0 stub, 0 spec-only); e2e 6/6 | §14.1, Table 5 | Neither the `sh-claims` tool nor the `tests/e2e/e2e_runner.py` harness is shipped here. |

This is the paper's own rule applied to this report: a figure whose instrument cannot be named is
withdrawn rather than repeated (§12.3, §16).

### G-03 — No labelled corpus, no gate calibration, no measured false-positive rate

Paper: §9.3/§9.4 (A2 measurement failed), §14.2 (C4 FPR threshold reached), §14.4 open problem 1,
Table 31. This repository implements the *catalog* of controls and the *protocol data* of the five
lab banks, but runs none of them: `docs/lab/` does not exist (CLM-028). Consequently:

- C3 conformity (Table 18) is **not claimed**; `govern conformance` reports **C1**.
- The "calibration is a security control" thesis (§15, item 4) is argued in `assurance.ts`, not shown.
- The FN/FP/latency table that bench 3 would produce has no data here, and inventing it is the exact
  defect `claims.ts` exists to prevent.

### G-04 — No model backend: C5 and META-EVAL judging degrade honestly

Paper: §7.3 (judge heterogeneity as a *requirement*), §16 limitation 8 (the prototype itself did not
always satisfy it), §B.5 (model-judgment controls fail open, record, mark unaudited). Here
`gateRunner.ts` always reports `sensorAvailable: false` for C5 with
`mode=degraded: … NO cuenta como evidencia de alineamiento de intención`. Under the default flexible
regime that self-authorizes and requires an I6 receipt; under `strict` (chain profile `regulated`)
it fails. `checkJudgeIndependence` implements the family rule but with one provider it can only
return `advisory`. Intent alignment (G15) and session consistency (G14) are therefore **not
measured** in this repository, and META-EVAL is a computational model, not a running judge.

### G-05 — No ON/OFF delta table exists in the paper, so none is invented here

Paper: §14.1 sends the reader to "el protocolo de la tabla anterior"; §17 refers to "los deltas del
piloto de la Sección 14.3" — but **no ON/OFF delta table is published anywhere in the paper**.
`telemetry.ts` provides `compareLoopEconomy` to compute tokens/task, iterations, escalations and
latency deltas from two `LoopEconomy` records; no records exist. The harness-ON vs harness-OFF claim
(Table 30) is unimplemented here and unpublished there.

### G-06 — The §9.7 decidable properties are exposed, but not as chain gates

Paper: §9.7, §8.4. `triad.ts` implements `checkDecidableDiscipline` — diff budget, scope
containment, declared-uncertainty — and `NON_DECIDABLE_DISCIPLINE_NOTE`, and the Zero-Trust console
now runs them over the working tree: `govern discipline` reads the pending diff, applies the
declared budget (`SDD_MAX_LINES` / `SDD_MAX_FILES`) and scope (`SDD_SCOPE`), and exits `1` on a
decidable violation.

Two limits remain honest rather than papered over. First, **no chain gate calls them**: C7 still
returns "activación sin medición", which is the paper's own finding about `gate_C7` and is not
laundered here, so the properties inform a human rather than blocking a wave. Second, of the three,
only **diff budget and scope containment** are decidable from a diff; `declared-uncertainty` is
reported as `no medible` because it needs the assumption register, which this call does not receive.
Reporting `ok` for a property nobody inspected would be exactly the vacuity the paper rejects — an
acknowledged gap is worth more than a weak check.

### G-07 — The claims registry is wired, and it registers more than the paper's did

Paper: §9.6 (`./bin/sh-claims verify` against `docs/claims/paper-claims.yaml`). The product CLI now
runs the registry directly: `assure claims --verify` → `claimsRegistry.ts` · `parseClaimsRegistry`,
`runClaimsRegistry`, dispatched from `cli/commands/paper.ts`; it reports the five states and exits
`1` only on `broken`. There is exactly one runner: a second, documentation-side copy was removed
rather than left to drift against the product command. Two declared differences from the paper's run:

- The registry holds **53 claims**, not the paper's 33, because it registers this port's components
  (including the brownfield capabilities, CLM-045 … CLM-053).
- The **three `not-measured` entries are the honest residue of the unpublished prototype** (no
  `docs/lab`, no `bin/sh-gate`, no `.steelharness/`): the paper's own instrument cannot decide them
  from here, and this report does not pretend otherwise.

### G-08 — Two different profile axes, with different names

- `governance.json` (shipped) accepts `solo | team | enterprise` — this decides what **blocks**
  (`governance.ts`, `governanceProfiles`).
- `gates chain --profile` accepts `solo | team | regulated` — this decides which Zero-Trust
  **controls are declared** (`gateCatalog.ts`, `ChainProfile`, `PROFILE_MANDATED`).

They are not the same axis and the names do not line up: `enterprise` is not accepted by
`--profile`, and `regulated` is not accepted by `governance.json`. Whether this is a defect or a
deliberate separation (blocking policy vs. chain resolution) is not settled by the paper — it
publishes one instance, not two vocabularies. Treat the two tables as independent.

### G-09 — Conformity is claimed at C1 here, whereas the paper claims C2 for its instance

Paper: Table 18 caption — the described instance claims **C2**, with I5 partially satisfied and I6
satisfied only since receipts exist; C3 requires measurements not performed. In this repository
`govern conformance` declares **C1** and reports `I4 no cumple` (needs a different-family judge and
an agent-identity registry) and `I5 no cumple` (the per-change constraint scope is declared but not
measured). This is a real disagreement between the paper's self-assessment and what this instance can
evidence, and it is resolved in the honest direction: the instance claims less, not more.

### G-10 — Waves are planned and specified, not executed

Paper: §7.2 (state: built). `waves.ts` implements the state machine, the six invariants, the
all-or-nothing `resolveWave`, the scope gate, worktree/identity assignment and the git command
generation; `scheduler.ts` builds the DAG waves. The `waves <feature>` command **prints** the plan
and the commands; nothing runs them (`planWorktrees`/`waveGitCommands`/`resolveWave` are not invoked
by an executor). There is no swarm runtime, no worktree lifecycle, and no provenance graph. Note also
that `buildTaskDependencyWaves` defaults to `maxParallel = 4` — the paper explicitly publishes **no**
numeric cap (§7.2, "no numeric max-subagents value is published"), so this is an implementation
choice, not a transcription. Additionally, `waves <feature>` needs `.sdd/specs/<feature>/tasks.md`;
with none it exits 1 with `Sin tasks.md en .sdd/specs/<feature>/`.

### G-11 — The commit/merge floor is installed here; level A still is not verified

Paper: §6.3, §16.1, Table 19 caption — the floor is B (commit) and C (merge) because those boundaries
belong to the organization. `resolveFloor` returns `floor: B, C` for every known tool **by ownership
reasoning**; installation is a separate question, and this repository now answers it too.

**Installed (level B — commit).** `tools/open-sdd/templates/hooks/pre-commit` is the single source,
copied into `.git/hooks/pre-commit` by `npm run hooks:install` (wired to `npm run prepare`), or into
any target repository with `open-sdd floor install <target> --ci`. It runs `gates run C1 C2 C3
--staged --strict`: C1 is advisory, C2 blocks on secrets and destructive commands **in the staged
index**, and C3 blocks when a completed task carries no captured `_Evidence:`. Behaviour was verified
by running the hook itself, not by reading it: a real credential in the index is refused (exit 1, C2
`fail`), a clean change passes, an allow-listed fixture passes while reporting how many findings it
suppressed, and a task marked complete without evidence is refused (exit 1, C3 `fail`). When the CLI
is missing the hook **fails closed** and prints the three ways to fix it.

**Installed (level C — merge).** `.github/workflows/gates.yml` runs on `pull_request` and on pushes to
`main`: workspace install, build, the full test suite, the resolved chain, `gates run --base
<base-sha>` **against the pull-request diff** (a run that inspects nothing is activation without
measurement), `govern discipline`, `assure claims --verify`, and `floor status`. The CI template
shipped for target projects is `tools/open-sdd/templates/hooks/open-sdd-gates.yml`.

**What is still not verified, stated plainly.** (1) `resolveFloor` remains an ownership argument: the
*ceiling* a host allows and the *guarantee* an installation achieves are different claims, and only a
periodically re-run behavioural sentinel establishes the latter — no sentinel is run here, and the
console prints `interpretSentinel(1)` as a demonstration of the semantics, not as verification.
(2) Level A is therefore still a ceiling: no host hook is verified in this checkout. (3)
`git commit --no-verify` bypasses level B, and that bypass is **not recorded** — the allow-list is the
recorded channel, so a bypass is invisible to the audit. `open-sdd floor status` reports B and C, and
exits non-zero the moment either stops being installed.

**One false-positive generator in the drift check, fixed.** The ambient-drift check that the floor
and the rigor assessment both use reads the changed paths through `git.ts` · `getModifiedFiles`,
which trimmed the whole `git status --porcelain` output. The porcelain format is `XY<space>path`, and
for the common "modified, not staged" case the first character is a space, so trimming removed it
from the **first line only** and `slice(3)` then ate a real character of that path: `docs/x.md`
became `ocs/x.md`, which matched no declared boundary and produced a false drift finding on whichever
file git listed first. The fix reads the raw output line by line and strips the status prefix
per line; all 29 paths in this checkout now parse exactly.

### G-12 — Brownfield has delta specs and a reverse constitution; behaviour is still declared, not extracted

Paper: §12, Figure 9, Tables 40/41; CSDD §3.2/§3.3; *Manual Maestro* §2.4. The heuristic bootstrap
remains (`reverseEngineering.ts` · `scanProject`, `bootstrapSteering`, `bootstrapSpecSeeds`; CLI
`getspecs`), but the central inversion of §12 is now implemented in three parts.

1. **The delta is the unit of specification** (`deltaSpec.ts` · `validateDeltaSpec`, `traceDelta`,
   `strangulationReport`, `renderDeltaSpec`, `parseDeltaSpec`; `cli/commands/brownfield.ts` ·
   `handleDeltaCommand`; CLI `delta init|validate|status|render`). A delta carries the four ADSR
   sections, delta-scoped `REQ-<AREA>-<NNN>` identifiers, a mandatory `previous` on
   MODIFIED/REMOVED/RENAMED, a mandatory rationale **and** contracts on REMOVED (contracts are a
   warning on MODIFIED), a size warning above 25 entries, per-entry strangulation
   (`legacy → both → new`), and two-way traceability: every requirement must have a task, and a task
   citing an unknown delta id is reported as a phantom.
2. **The reverse constitution** (`constitution.ts` + `reverseConstitution.ts`; CLI
   `brownfield survey|constitution [--write]`) is descriptive by construction. One model has two
   provenances: `descriptive` principles must cite evidence that the code already satisfies them,
   and `normative` principles enter only through a governed amendment carrying a migration plan.
   The six-field anatomy (identifier · threat/CWE reference · imposition level · restriction ·
   pattern · justification), `MUST`/`SHOULD`/`MAY`, citable authority (`resolveAuthority`), a
   markdown round-trip and a validator that refuses a descriptive principle without evidence are
   all implemented; a desired-but-absent practice is emitted as a PROPOSED AMENDMENT, never as a
   fact.
3. **The three SDD rigor levels** (`rigor.ts`; CLI `govern rigor` and `govern rigor --select`) are a
   cumulative ladder (gates 2 → 4 → 6; every level only adds) in which a valid constitution is
   **required (blocking) at every level**, Spec-First included, because the constitution is the
   authority every blocking verdict cites. The default `spec-first` stays fluid by demanding only
   the floor — EARS requirements plus a citable constitution, gates C1+C2 — and the level's `gates`
   list is configurable, with unknown ids rejected rather than ignored.

Reconnaissance is now workspace-aware and configuration-aware: on this repository `brownfield
survey .` reports **TypeScript / npm / tsc / Vitest and 9 modules**. Before the fix it reported
"JavaScript, no tests detected" because the code lives in `tools/open-sdd` and the scan read only the
repository root.

What is still **not** built — verified in the code, not assumed:

- **The contracts are declared, not executed.** `validateDeltaSpec` requires them on REMOVED and
  warns on MODIFIED, and `assessRigor` requires them at Spec-as-Source, but nothing runs the tests a
  delta names: `Contracts:` is a string list and no command, gate or CI step resolves it to an
  executed check. `traceDelta` maps requirements to tasks, never contracts to runs. See G-15.
- **Behaviour is declared, not extracted.** The descriptive constitution derives its evidence from
  artifacts that exist (lockfile, public entry points, module directories, test runner) and the
  compliance matrix resolves those paths against the filesystem; it does not read, run or otherwise
  extract the behaviour the code implements.
- **A delta is never merged back into the base spec.** `DeltaSpec.status` accepts `merged` and
  `base` records the target, but `delta` has no merge subcommand and nothing rewrites the base
  `requirements.md` from the ADSR entries; the delta stays a reviewed change proposal. See G-17.

### G-13 — Provenance, MCP mediation and sandboxes are represented, not enforced

Paper: §6.1/§6.2 (harness countermeasures), Table 5 rows 4 and 7. `assurance.ts` maps
`AML.T0010`/SLSA and defines the complementary controls; `skills.ts` enforces the MCP *rule* on
declared data. But there is no stdio MCP proxy, no per-role allow-list enforcement at a boundary, no
in-toto/SLSA attestation, no sandbox-of-record, and no destructive-command interception in an
enforcement layer before content evaluation (the destructive patterns appear only as C2 content
scanning of changed files). These are `propuesto` in this repository, consistent with the paper's own
Table 5 labelling of full taint-tracking and microVMs as `propuesto`.

### G-14 — I5 (minimum privilege applied to attention) is declared, not measured

Paper: §5.1 (I5), §6.4 (skills selection from the impact graph, not agent judgement), Table 8
(Marri n=1 attention-budget evidence). `skills.ts` states the principle and the class taxonomy, but
nothing scopes the loaded constraint set to a change's impact radius, and nothing resolves skill
selection from an impact graph. `govern conformance` records `I5 no cumple`. The consequence the
paper names — a governance corpus degrading past the attention budget it is read with — is
acknowledged and unrepaired here.

### G-15 — CI runs the contracts oracle as an extraction, not as a test run

Paper: §12 (the extracted specification's first use is the regression oracle). `.github/workflows/gates.yml`
now runs `brownfield contracts <feature> --base <pr-base-sha>` for every spec that declares a delta, so
the oracle is evaluated at the merge boundary rather than left to a reviewer: the command exits 1 when
the delta declares a contract that does not exist, and reports the changed files no contract covers.

What is deliberately NOT done in CI: re-running the suite through `contracts --verify`. CI already runs
the full test suite as its own step, and `verifyContracts` refuses to turn an exit code into a pass when
a declared contract is missing — so wrapping it around a second suite run would add cost without adding
a control. The consequence is recorded honestly: an uncovered change is REPORTED at the merge boundary,
not blocked by it. Blocking on "no test covers this file" would refuse legitimate changes to barrels,
type-only modules and documentation, which is why it is a report.

### G-16 — The compliance matrix has a caller; the amendment path is reachable

Paper: CSDD §3.3/§4.2. The matrix's four stated purposes (audit support, change impact, gap detection,
regression prevention) were implemented but importable only; `govern constitution --matrix` now reaches
them: it prints the principle → artifact mapping with the coverage ratio, marks references that do not
resolve to a path (a fact or a command is listed, not dropped), and — when the working tree has changes —
answers `impactedPrinciples(matrix, changed)`, i.e. which constitutional principles the change can touch.

`govern constitution --promote <AMD-ID> --plan "<migration path>"` reaches `promoteAmendment`, which
refuses to put an amendment in force without a migration plan and a named actor. Still open: nothing
enforces the matrix automatically — no gate fails because a principle has no artifact. It is a report a
reviewer runs, and `C-STACK-FACT` and `C-BOUNDARIES` currently show as gaps on this repository because
their evidence is a fact and a directory list rather than a file:line, which is the honest state of a
descriptive constitution whose evidence is not all code.

### G-17 — A delta is never merged back into the base specification

Paper: §12 (the extracted specification as the thing modernization preserves). `DeltaSpec` carries
`base` and a `status` of `proposed | approved | merged`, and `renderDeltaSpec`/`parseDeltaSpec`
round-trip both, but `delta` exposes only `init | validate | status | render` and nothing rewrites
the base `requirements.md` from the ADSR entries. `merged` is a label an author types into
`delta.md`, not a state a command produces. The delta therefore remains a reviewed change proposal
against the base; applying it is manual, and the drift between the two is not checked.

### G-18 — Change impact and reuse-first consult code, not the constitution

Paper: §12 (what a brownfield change must analyse before it is written); CSDD §3.3 (change-impact
analysis is one of the matrix's four purposes). Two modules landed with the brownfield work and both
now have a console surface:

| Module | Command | What it answers — and its limit |
|---|---|---|
| `changeImpact.ts` · `analyzeChangeImpact` | `brownfield impact <feature>` | Dependents, blast radius, touched API surface, integration points, breaking changes implied by the delta's targets. It reads the **import graph and the delta**, so it reports which *files* are reached; it does not name which **constitutional principles** the change affects — that is `constitution.ts` · `impactedPrinciples`, which no command calls (G-16) |
| `reuseFirst.ts` · `findReuseCandidates` / `REUSE_FIRST_RULE` | `brownfield reuse <feature>` | Which existing symbols a reuse-first search would have found before a new one was created. It is an advisory report, deliberately: the generated constitution emits "reuse-first policy" as `AMD-REUSE-FIRST`, a **proposed** amendment, so the code and the constitution agree that the practice is not enforced |

Neither is a gate: `brownfield impact` exits 1 only on an `error`-severity finding, and its findings
on this repository are warnings (public API entry points touched, delta targets with no `previous`).
Both are honest reports a reviewer reads, which is the correct starting point — an advisory that is
actually run beats a gate that verifies nothing.

---

### G-19 — The impact analysis still has false-positive classes, and one figure in this project was mismeasured

Paper: §12 / the brownfield research document §5.2. `analyzeChangeImpact` was fixed twice during this
work (a target that is new at `HEAD` no longer demands a `previous` declaration, and a directory
target now covers the files beneath it), but four false-positive classes remain, all verified in the
code and none of them fixed:

| Class | What it produces | Where it belongs |
|---|---|---|
| Untracked directories as changed files | `git status --porcelain` lists an untracked directory as one entry, so a directory path reached the file readers (`EISDIR`) and counted as a changed file | Fixed at the CLI layer (`--untracked-files=all` + filter to real files); the module still assumes its caller passes files |
| A public-API entry point changed but declared ADDED | The API-surface warning fires for any changed entry file regardless of whether the delta declares it as new — the same family as the fixed defect, in a different block | `changeImpact.ts`, API-surface block |
| An ADDED target that legitimately does not exist yet | `.sdd/steering/constitution.md` is generated by a command, so "declares a target this change does not touch" is arguably premature rather than a violation | `changeImpact.ts`, not-touched block |
| Build artifacts under `tools/open-sdd/dist/**` | Counted as undeclared scope changes even though they are compiled from declared sources | `changeImpact.ts`, scope block |

**A corrected measurement.** An earlier commit message in this repository reported the fix as
"87 → 35 warnings". That was **not a controlled comparison**: the two runs were taken on a live working
tree that also contained unrelated in-flight edits. The controlled pair was measured on a scratch clone
reconstructed to a fixed tree, identical for both runs: **89 → 48 warnings** (of which 43 → 25 were
`previous` demands, 42 → 20 outside-scope, 2 → 1 not-touched, 2 → 2 API). The corrected figure is the
one to cite; on the live tree the counts move with whatever is uncommitted at the time and are not
comparable across runs.

What this costs, stated plainly: until the remaining classes are addressed, `brownfield impact` is a
**review aid with a known false-positive rate**, not a gate. It is deliberately not wired into CI
(G-18), which is consistent — a check with this noise level would train its readers to ignore it.

### G-20 — `bootstrap --write` writes two of the three artifacts its own plan announces

Paper: §12 / *Manual Maestro* v3.0 EGTAV. `brownfield bootstrap --focus "<texto>" --write` prints an
`Artefactos` list in which the focus delta seed appears with the action `create`
(`.sdd/specs/<slug>/delta.md`, reason "semilla de delta para el foco «…»"), and the summary line counts
it ("3 artefacto(s) por crear"). The write path creates only two: `.sdd/steering/codebase-intelligence.md`
and, when absent, `.sdd/steering/constitution.md`. The delta seed is not written; the plan's own step 5
is the instruction to run `delta init` for it. Verified on a scratch repository: the statement claims
three artifacts to create, `find` shows two files, and no `delta.md` exists until `delta init` runs.

This is a **reporting** defect, not a missing capability — the ordered steps are correct and the delta
does get created, by the command that owns it. It matters because `BootstrapPlan.artifacts` is documented
as "artifacts the bootstrap would write" and is the artifact a reader or an agent would act on; a plan
that overstates its own write set is exactly the class of silent mismatch this report exists to record.
The honest reading of `bootstrap --write` today: it writes the intelligence document and the constitution;
the delta seed is a **step**, not a write.

### G-21 — Multi-module discovery is Node-only

Paper: §12 / spec-kit issue #1436 (the concept is adopted and reimplemented on our engine; the language
coverage is not). `reverseEngineering.ts` · `scanProject` builds its workspace roots from `package.json`
`workspaces` plus conventional directories that contain a `package.json`. There is **no** Maven/Gradle
(`pom.xml`, `settings.gradle`), Go (`go.work`), Rust (`Cargo.toml` workspace) or Python monorepo
discovery, so the layouts the spec-kit issue names are not matched: on such a repository the module map
returns a single root module. (`go.mod` and `Cargo.toml` are recognised as *build tools* for a single
project, not as workspace declarations.) Consequence to state plainly: `brownfield bootstrap`'s module
map is correct for Node/TypeScript workspaces and **narrower than the reference** everywhere else — the
honest output is "one root module", not a fabricated decomposition.

### G-22 — Two boundary vocabularies coexist

Paper: §12 / CSDD §3.3 (boundary evidence). The bootstrap module map uses "root + every workspace root"
(`bootstrap.ts` · `buildModuleMap`), while `reverseConstitution.ts` still derives `C-BOUNDARIES` evidence
from `project.modules` — the subdirectories of the detected source directories, falling back to the
source dirs themselves (`reverseConstitution.ts:242-243`). On the same repository the two therefore
describe different things: on this checkout the module map reports 2 modules (root + `tools/open-sdd`),
while the constitution lists the 9 source subdirectories (`agents`, `cli`, `constants`, `core`, …) as the
boundaries. Neither is wrong for its purpose; they are **not reconciled**, so a reader must not assume
the map and the constitution's boundary evidence agree.

### G-23 — `publicApiFiles` is a filename pattern, not a manifest read

Paper: §12 / CSDD §3.4 (the constitution's authority cites evidence). `collectRepoFacts.publicApiFiles`
matches entry-point **filenames** with
`/(^|\/)(index|main|mod|api|routes?)\.(ts|js|mjs|py|go|rb|java|rs)$/` (`reverseConstitution.ts:132`) and
never consults `package.json` `bin`/`exports`. A package whose public surface is declared only in its
manifest can therefore be missed, and `C-API-COMPAT`'s evidence is incomplete for it. The bootstrap's
responsibility detection *does* read the manifest (`bin`), so the two disagree about what "public API"
means. This is why the compliance matrix reports **50 % coverage** on this repository, with
`C-STACK-FACT` and `C-BOUNDARIES` as the gaps — their evidence is a fact and a directory list rather than
a `file:line`, which is the honest state of a descriptive constitution whose evidence is not all code
(see also G-16).

## 6. Where the paper and the code genuinely disagree

1. **Conformity level** — paper claims C2 for its described instance (Table 18 caption); this code
   declares C1 because I4 and I5 are unsatisfied (`govern conformance`). Section reference: §5.2,
   Table 18. Code: `invariants.ts` · `assessConformity`, `cli/commands/paper.ts` · `govern conformance`.
2. **C7/Karpathy** — the paper's Table 33 says G21 was "previsto como bloqueo"; the executable chain
   classifies C7 as `ejecutable` because its body branches, while §8.4 says it checks nothing. This
   code resolves the tension by adding a third state, `inspects: false` → `vacío`, and refusing to
   count it as a passing control. Section reference: §9.7, §8.4, Table 33 row G21. Code:
   `gateCatalog.ts` · `EXECUTABLE_CHAIN['C7']`, `enforcement.ts` · `applyDefaultFail`.
3. **Profile vocabulary** — one published instance in the paper, two independent axes here
   (`enterprise` vs `regulated`); see G-08. Code: `governance.ts` · `governanceProfiles`;
   `gateCatalog.ts` · `ChainProfile`.
4. **Level B/C floor** — the paper asserts the floor is universal and cheap ("cuesta una tarde de
   trabajo"); this repository now installs both boundaries (pre-commit hook and pull-request gate
   matrix), so the floor is no longer declaration-only. What remains unverified is level A, the
   write-time ceiling (G-11). Section reference: §6.3, Table 19 caption, §16.1.
5. **`implemented: false` gap** — the paper's §9.5 describes a period where the regulated profile
   declared 12 controls and executed 7. This port models that state (`ExecutableGate.implemented`)
   but has no gate in it, so the declared-vs-executed gap reads zero. That is a difference in
   state, not a contradiction, but a reader should not read "0 no implementados" as evidence that
   the paper's gap was closed by this port.

The next seven are **divergences between the two source documents and the implemented code** that the
brownfield/constitution work exposed. They are recorded, not reconciled: where the documents
disagree, the code had to pick one, and this report says which.

6. **Six fields or three.** CSDD §3.2 fixes six fields per principle — identifier, CWE reference,
   enforcement level, constraint, implementation pattern, rationale. The *Manual Maestro* §4.2 lists
   only three (WHAT / WHY / HOW) and its example uses roman-numeral identifiers with no CWE
   references. The implemented model follows CSDD: `constitution.ts` · `validateConstitution`
   requires the six fields, rejects positional ids (`isPositionalIdentifier`) and rejects a `MUST`
   that names no threat (`MUST-THREAT`). A constitution written to the *Manual Maestro* example
   would therefore fail validation here — deliberately, because its ids are not citable by a
   blocking verdict (I1) and a `MUST` without a threat is an arbitrary rule.
7. **A fourth modal.** The *Manual Maestro* example uses `SHALL NOT`. The implemented model defines
   exactly three imposition levels, `MUST` / `SHOULD` / `MAY` (CSDD §3.2), and
   `validateConstitution` reports `LEVEL-INVALID` for anything else. `SHALL NOT` is expressed as a
   `MUST` whose restriction is a prohibition, so the level stays citable.
8. **Where a level starts, and whether the constitution is optional at Spec-First.** *Manual
   Maestro* §8.2 places an authentication system and a legacy migration at Spec-Anchored, while the
   implemented decision table (`rigor.ts` · `selectRigorLevel`) treats high-consequence work —
   authentication, authorization, payments, cross-team contracts, legacy modernization — as
   Spec-as-Source. The sharper divergence is §2.4 and the reference architecture, which allow a
   "Spec-First + Constitución" pairing in which the constitution is a companion the level does not
   demand. **This implementation declares that reading rejected.** `constitutionRequired` returns
   `required: true, severity: 'blocking'` at all three levels (Spec-First included, greenfield and
   brownfield), because a blocking verdict must cite an authority at every level (CSDD §3.4 apex;
   invariant I1, `constitution.ts` · `resolveAuthority`). A Spec-First project that omitted the
   constitution would leave C1/C2 with no rule to cite when they block. What the levels still differ
   in is everything above that floor — evidence binding, drift, contracts and regeneration — which is
   why the default can stay fluid without becoming lawless. The active gate set is likewise
   configurable: `effectiveGates(level, override)` may narrow the level's list, but
   `validateGateOverride` rejects an unknown id instead of ignoring it, so a typo cannot lower the
   bar in silence.
9. **Slash-separated CWE references.** CSDD §4.1 SEC-010 cites two CWEs as `CWE-862/863`. The
   implemented format is strictly `CWE-<number>` (`constitution.ts` · `CWE_REFERENCE_PATTERN`,
   `normalizeCweReference`), so a slash-separated multiple is rejected as `CWE-FORMAT` rather than
   silently accepted. A principle answering two weaknesses must be split into two principles or pick
   the primary one; the validator does not guess which.
10. **Two rigor scales, one bridge.** `hitl.ts` · `RigorMode` keeps five values
    (`none | lite | spec-first | spec-anchored | spec-as-source`) because it also models the
    decision *not* to apply SDD, while `rigor.ts` · `SddRigorLevel` has the three SDD levels.
    `toSddRigorLevel` is the declared bridge, and `none`/`lite` collapse to the lightest level
    (`spec-first`). Two scales remain in the codebase; only the bridge keeps them from drifting.
11. **The compliance matrix is implemented, not enforced.** CSDD §3.3/§4.2 gives the matrix four
    purposes (audit support, change-impact analysis, gap detection, regression prevention) and
    `constitution.ts` implements all four (`buildComplianceMatrix`, `impactedPrinciples`), but no
    CI workflow calls them: `.github/workflows/gates.yml` runs install, build, test,
    `gates chain`, `gates run`, `govern discipline`, `assure claims --verify` and `floor status` —
    not `govern rigor`, and not the matrix. The four answers are available to a caller; nothing in
    the pipeline asks for them (G-16).
12. **A bootstrap *command* and a skill, not a slash command inside the tool.** spec-kit issue #1436
    proposes brownfield bootstrap as a slash command shipped inside the agent extension, with a
    module map and a generated knowledge document. This port adopts the **concept** and reimplements
    it on its own engine: `brownfield bootstrap` is an engine command in the console (so it runs
    headless, in CI and without any agent), and the teaching layer is a skill
    (`sdd-brownfield`, installed as `/sdd-brownfield`) rather than the command's implementation.
    Nothing of the spec-kit extension's code is used. The delta-spec mechanism that this port pairs
    with it — ADSR sections, delta-scoped ids, per-entry strangulation, the delta as the unit of
    specification — has **no counterpart in spec-kit**, so the concept travels but the workflow does
    not: a reader coming from that issue should not expect its artifacts or its command syntax here.

---

## 7. Reading rules for anyone citing this report

1. Do **not** cite the paper's prototype figures as measurements of `open-sdd` (G-02).
2. Do **not** cite METR / GitClear / DORA (§1, Table 2, §16 limitation 6) as evidence *for* this
   harness — they establish the problem, not the remedy.
3. Do **not** present the gate-tier firing distribution (§14.1/§14.2) as a measure of prevented
   defects; the paper itself reclassifies it as a design sanity check (§15).
4. `default-FAIL` is exact only for the hard subset and for strict mode; process gates start
   flexible and self-authorize with a receipt (§9.2, §16 limitation 9).
5. No `propuesto` component participates in today's security guarantees (§2.3 defensive reading);
   `assure claims` states this at runtime.
6. Where prose and this report disagree, the running system is ground truth and the sentence is the
   bug — the paper's own rule ("Donde la prosa y el prototipo demostrativo discrepen, el sistema en
   ejecución es la verdad de terreno y la frase es el bug", §9.6 prototype note).
