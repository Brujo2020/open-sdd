# Paper alignment — traceability report

**Paper:** *Orquestación SDD-First Multiagente para Desarrollo Enterprise: Una Arquitectura de
Referencia Zero-Trust para Gobernar la Ingeniería de Software Agéntica a Escala* — Mario Alejandro
Ramos (NTT DATA), rev. 3, September 2026, 87 pp. (henceforth "the paper").

**Scope of this report:** how the paper's architecture maps onto the code that now lives in
`tools/open-sdd/src/core/`, `tools/open-sdd/src/mcp/`, `tools/open-sdd/src/cli/commands/`,
`tools/open-sdd/templates/`, `bench/` and `scripts/` — plus the repository-level artifacts
`action.yml`, `Dockerfile` and `.github/workflows/gates.yml`. What is implemented, what is a declared
gap, and what the paper measured that this repository does **not** measure. Every row names the file
and the symbol that implements it, so a reader can check the row instead of trusting it.

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

Command run from the repository root, 2026-09-21:

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

In the short vocabulary: **verified = 59, declared-gap = 0, absent/not-measured = 3, broken = 0,
outdated-text = 0** (out of 62). CLM-045 … CLM-057 decide the brownfield and rigor capabilities by
exit code: delta validation and two-way traceability, the mandatory `previous` on `MODIFIED`, the
evidence-or-amendment rule for descriptive principles, the constitution being blocking at every
level as the floor of the ladder, absent practices travelling as proposed amendments,
workspace-aware reconnaissance, contract extraction, the rule that exit code 0 never launders a
missing declared contract, the console report that publishes the oracle, the default level's
constitution-plus-requirements floor, the ladder monotonicity (2 → 4 → 6 gates), the rejection of an
unknown gate id, and the quiet `--no-drift` commit path. CLM-058 … CLM-062 cover the surfaces added
since: the single brownfield entry point, the `sdd-brownfield` skill, the one status dashboard, its
`--quiet` commit-time line, and the phantom-authority check that makes `status --check` exit 1 on a
principle that is not in force.

Observed exit codes, from the run above: **CLM-028, CLM-029 and CLM-031 exited `1`; every other claim
exited `0`.** Both runners print the per-claim code, so the line above can be re-derived rather than
trusted.

Per §9.6, only `broken` halts a publication; there is none. The declaration limit of §9.6 applies
unchanged: **this proves internal consistency, not that what exists works.** One honest detail about
the process itself: an earlier revision of this report and of the registry recorded CLM-030 as a
declared gap, because at that moment no product command read the registry. The CLI then gained
`assure claims --verify`, which turned that entry into `outdated-text` — and the repair was editing
the registry text, never the code, exactly as §9.6 prescribes. The same repair was applied in this
revision to **CLM-027** and **CLM-059**: the shared neutral skills tree added by `a8fb2da` moved the
count from 168 files / 8 identical `sdd-brownfield` copies to **189 files / 9 identical copies**, the
run before the repair reported those two entries `broken` (57 verified / 2 broken, which is why the
`gates` job of run `35555105973` was red), and the fix was again editing the registry's statements and
verifiers. The code was already correct; rewriting it to satisfy a stale sentence is the defect §9.6
forbids.

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

- **Executable (14):** C1–C6, **C8** and O1–O7 — `inspects: true`.
- **Vacuous (1):** **C7/Karpathy.** `EXECUTABLE_CHAIN` records `inspects: false`; the runtime
  (`enforcement.ts`, `applyDefaultFail`) refuses to let it pass as a control:

  > "Declarado pero vacío: el gate no inspecciona nada, así que no puede acreditar un control
  > (activación ≠ medición)."

  `gates chain` prints it as `vacío (activación ≠ medición)` and `gates chain --profile regulated`
  reports `Declarados: 13 · Ejecutables: 12 · No implementados: 0 · Vacíos: 1`.
- **Extension beyond the paper (1): C8 Standards Conformance.** The paper's Table 34 chain ends at
  C7/O7; C8 is **ours**, and this report declares it rather than folding it into the paper's catalog.
  It runs the machine-checkable standards catalogue over the declared artifacts and is **advisory**:
  a finding from a standard with no measured corpus is reported and does not fail the chain; only a
  calibrated (`isBlocking`) standard can. `imposes: []` on purpose — it maps to no logical gate of
  Table 33, so it adds no coverage claim to the crosswalk.
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
| The gate runner (§9.2, §9.5) | One branch per control; every branch reports **sensor availability** and **fired** separately. C1 runs `evaluateTriad` + EARS and the catalogue's requirements subset as advisory; C2 `scanSecurity`; C3 evidence lock; C4 `buildSymbolIndex`/`checkSymbols`; C5 declares itself degraded; C6 checks referenced docs exist; C7 returns vacuous; **C8 (our extension) runs the standards catalogue**; O1–O7 check their artifact. | `gateRunner.ts` · `runGate`, `runChain`, `scanSecurity`, `buildSymbolIndex`, `checkSymbols`, `HARD_CONTROL_BY_GATE`; `standards.ts` · `loadStandards`, `runStandard` | `construido` |
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
| Delta specs — the contract of change (§12, Figure 9, Tables 40/41) | ADSR sections, delta-scoped `REQ-<AREA>-<NNN>` ids, mandatory `previous` on MODIFIED/REMOVED/RENAMED, mandatory rationale + contracts on REMOVED (warning on MODIFIED), a 25-entry size warning, per-entry strangulation `legacy → both → new`, two-way traceability (requirement → task; tasks citing unknown ids reported as phantoms), and the all-or-nothing **merge back** into the base `requirements.md` (`delta merge --write`), which refuses to touch the base when any entry cannot be applied. | `deltaSpec.ts` · `validateDeltaSpec`, `traceDelta`, `strangulationReport`, `renderDeltaSpec`, `parseDeltaSpec`, `deltaCounts`, `mergeDeltaIntoBase`; `cli/commands/brownfield.ts` · `handleDeltaCommand`; CLI `delta init\|validate\|status\|render\|merge [--write]` | `construido` · **brecha declarada** (contracts declared, not executed — G-15; the merge is textual and there is no post-merge drift check — G-17) |
| The Constitution: one model, two provenances (CSDD §3.2 six-field anatomy, §3.3 compliance matrix, §3.4 apex; §6.1 injection) | `descriptive` principles must carry evidence; `normative` ones enter only through an amendment with a migration plan. Six-field anatomy, `MUST`/`SHOULD`/`MAY`, citable authority (`resolveAuthority`), indirect-injection scan, markdown round-trip, compliance matrix and amendment promotion. | `constitution.ts` · `validateConstitution`, `principlesInForce`, `resolveAuthority`, `renderConstitution`, `parseConstitution`, `buildComplianceMatrix`, `impactedPrinciples`, `promoteAmendment`, `detectInjection`; CLI `brownfield constitution` | `construido` (model + validation) · **brecha declarada** (matrix and amendment promotion unsurfaced — G-16) |
| Reverse-engineered descriptive constitution (§12) | Reads the repo's facts (lockfile, migration dirs and rollbacks, CI workflows, public API entry points, config files), emits a principle only when compliance is evidenced in the code, declares the stack an established fact, and emits desired-but-absent practices as PROPOSED AMENDMENTS — never as facts. | `reverseConstitution.ts` · `collectRepoFacts`, `buildDescriptiveConstitution`; CLI `brownfield survey`, `brownfield constitution --write` | `construido` (evidence is artifact presence, not extracted behaviour — G-12) |
| Three SDD rigor levels (*Manual Maestro* §2.4; reference architecture §4.8/§4.10) | Spec-First / Spec-Anchored / Spec-as-Source as a **cumulative ladder** (gates 2 → 4 → 6; every level only adds), each with its per-aspect demands, active gate ids, evaluator question and missing-artifact policy. A valid constitution is **required (blocking) at every level**, Spec-First included, because a blocking verdict must cite an authority at every level (CSDD §3.4, invariant I1); the default `spec-first` is deliberately fluid because it adds nothing above that floor. The declared level lives in `.sdd/settings/rigor.json` with a mandatory rationale and an optional `gates` override that may narrow the list but whose unknown ids are rejected; `assessRigor` evaluates the repository against it. Where a demand is not decidable from artifacts it is reported as a `brecha declarada` (regeneration at Spec-as-Source) instead of being faked as satisfied. | `rigor.ts` · `RIGOR_LEVELS`, `RIGOR_LADDER`, `RIGOR_REQUIREMENTS`, `rigorRequirements`, `rigorRequires`, `effectiveGates`, `validateGateOverride`, `selectRigorLevel`, `constitutionRequired`, `loadRigorSettings`, `resolveRigorSettings`, `assessRigor`, `isRigorLevel`, `toSddRigorLevel`; `.sdd/settings/rigor.json`; CLI `govern rigor [--select\|--gates\|--verbose\|--quiet]` | `construido` |
| Brownfield console (§12; *Manual Maestro* §2.4) | One deterministic surface for the brownfield path: reconnaissance of the existing project, the reverse constitution (printed, or written to `.sdd/steering/constitution.md` with a round-trip check), the delta lifecycle, and three analysis reports over the change — impact (dependents, blast radius, API surface, breaking changes), contracts (the regression oracle, with `--verify` running the test command) and reuse (`REUSE_FIRST_RULE` candidates). | `cli/commands/brownfield.ts` · `handleBrownfieldCommand`, `handleDeltaCommand`; `index.ts` dispatch; CLI `brownfield survey\|constitution\|impact\|contracts\|reuse`, `delta init\|validate\|status\|render` | `construido` · **brecha declarada** (contract verification is not in CI — G-15) |
| Execution contracts, change impact, reuse-first (§12; CSDD §3.3) | The regression oracle as data: which tests protect the changed files, which changed files no contract covers, and whether a run satisfied the declared contracts (`satisfied` requires exit 0 **and** no declared contract missing); the change's reachable set, breaking changes and integration points; the symbols a reuse-first search would have found first. | `executionContract.ts` · `extractContracts`, `verifyContracts`, `testCommandFor`, `contractsFileName`; `changeImpact.ts` · `analyzeChangeImpact`; `reuseFirst.ts` · `findReuseCandidates`, `scanDeclarations`, `REUSE_FIRST_RULE`; CLI `brownfield impact\|contracts\|reuse` | `construido` (commands) · **brecha declarada** (advisory, not gate-wired) — see G-15/G-18 |
| One entry point for an existing repository — `brownfield bootstrap` (spec-kit issue #1436: the **concept is adopted and reimplemented on our own engine**, not a port of their extension; *Manual Maestro* v3.0 EGTAV) | Composes the scanners that already existed — `scanProject`, `collectRepoFacts` + `buildDescriptiveConstitution`, `findReuseCandidates` — into one plan, plus two artifacts that did not exist: the **module responsibility map**, with a decidable answer to "where does new code go?" (`answerCodePlacement`), and `.sdd/steering/codebase-intelligence.md` for agents, carrying a provenance marker and never overwriting a hand-authored file. This is our reading of the spec-kit issue's knowledge-document idea, rebuilt on our engine: it re-scans nothing and re-implements no symbol search. `--focus` names the first change; `--write` writes the intelligence document, generates the constitution if absent, and creates the focus delta seed by reusing `delta init`'s own scaffold (never overwriting an existing file); `--json` emits the plan. | `bootstrap.ts` · `planBootstrap`, `buildModuleMap`, `answerCodePlacement`, `writeCodeIntelligence`, `CODE_INTELLIGENCE_MARKER`; `cli/commands/brownfield.ts` · `handleBrownfieldCommand`; CLI `brownfield bootstrap [target] [--focus "<texto>"] [--write] [--json]` | `construido` · the plan's write set and the write path now agree (the defect recorded as G-20 is fixed) |
| Agent-agnostic installation (§6.4 progressive disclosure; Table 4) | 18 agent definitions; 8 skills-based variants × 21 skills plus one shared neutral tree of 21 = 189 `SKILL.md` templates (`_shared` is the ninth tree, added by `a8fb2da`); per-agent layout, alias flags and completion guides. `sdd-brownfield` is the 21st skill and its nine copies are byte-identical (the `sdd-help` precedent). | `agents/registry.ts` · `agentDefinitions`, `agentList`; `tools/open-sdd/templates/agents/**` | `construido` |
| One dashboard for the whole state — `status [feature] [--check] [--quiet] [--json]` (*Manual Maestro* v3.0 EGTAV — the validation layer is where a brownfield workflow is read) | A single panel over the repository: the constitution (present/valid, principles in force, pending amendments), every spec (phase, triad, traceability, evidence), the delta counts and strangulation, the contract set with its uncovered changes, the constitutional alignment, the rigor level with its active gates, and the **next command to run**. `--check` appends the per-spec constitutional validation; `--quiet` collapses the panel to one line with the verdict in the exit code, which is the commit-time form; `--json` emits the aggregate for tooling. | `core/status.ts` · `buildRepositoryStatus`, `renderStatusPanel`, `renderStatusLine`, `nextAction`; `cli/commands/status.ts` · `handleStatusCommand`; CLI `status [feature] [--check] [--quiet] [--json]` | `construido` · **brecha declarada** (the alignment is a report: nothing blocks because a spec ignores a principle — G-16) |
| The constitution as the pivot of every spec (*Manual Maestro* v3.0; CSDD §3.4 apex, invariant I1) | Given a spec's requirements/plan/tasks and its brownfield delta, answers three questions a reviewer cannot answer consistently: whether the principles the spec **cites** exist and are in force (`UNKNOWN_PRINCIPLE`, error — a phantom authority), whether the spec **contradicts** a `MUST` (`MUST_CONTRADICTED`, `TECH_LOCK_VIOLATION`), and whether the artifacts it produces respect the imposed boundary, API-compatibility and regression-oracle rules (`BOUNDARY_VIOLATION`, `API_COMPAT_MISSING`, `ORACLE_MISSING`). A spec that cites nothing is `NO_PRINCIPLES_DECLARED` (warning) and scores alignment 0, so the pivot cannot be silently unused. When a rule cannot decide, it says so in `detail` instead of emitting a finding: an `ok` over something not inspected is refused. `status --check` exits 1 only on error-severity findings. | `specConstitution.ts` · `alignSpecWithConstitution`, `declaredPrinciples`, `SPEC_PRINCIPLES_MARKER`, `ConstitutionalAlignmentFinding`, `SpecAlignment`; `constitution.ts` · `principlesInForce`; CLI `status --check` | `construido` · verified on this repository (alignment 100 %, 0 errors, 1 `BOUNDARY_VIOLATION` warning; a synthetic phantom principle makes `status --check` exit 1 — CLM-062) |
| Governance profiles (repo-level) and chain profiles (§9.5) | Two distinct axes: `governance.json` ships `solo|team|enterprise` (what blocks); the Zero-Trust chain resolver accepts `solo|team|regulated` (which controls are declared). | `governance.ts` · `governanceProfiles`, `resolveGovernanceSettings`; `gateCatalog.ts` · `ChainProfile`, `PROFILE_MANDATED` | `construido` — but see G-08 (naming divergence) |
| Tool-agnostic integration surface — the MCP server (§6.4 progressive disclosure; Table 4 agent-agnostic installation; §9.5 G16/O2 "Intercepción MCP") | A stdio JSON-RPC 2.0 server that exposes the engine to any host without per-host code: **11 tools** (`open_sdd_status`, `open_sdd_constitution_check`, `open_sdd_validate_delta`, `open_sdd_contracts`, `open_sdd_impact`, `open_sdd_reuse_search`, `open_sdd_module_map`, `open_sdd_plan_bootstrap`, `open_sdd_rigor`, `open_sdd_gates_run`, `open_sdd_context_pack`) and read-only **resources** (`sdd://status`, `sdd://steering/constitution.md`, and each spec's `requirements.md`/`plan.md`/`tasks.md`/`delta.md`, plus the `design.md` alias). Every schema is `additionalProperties: false`; an absent artifact is reported as `present: false` + `reason`, never omitted and never an empty string. The context pack (`buildContextPack`) is the same object for the MCP tool and the `open-sdd context` terminal face. Implemented subset: `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `shutdown`; prompts, sampling, roots, logging, progress, subscriptions and completions are deliberately out. No network, no model backend, no API keys. | `mcp/server.ts` · `runMcpServer`; `mcp/protocol.ts` · `JsonRpcPeer`, `buildInitializeResult`, `parseJsonRpcMessage`, `LineFramer`; `mcp/tools.ts` · `listToolDescriptors`, `callTool`, `listResources`, `readResource`, `CONSTITUTION_URI`, `STATUS_URI`; `core/contextPack.ts` · `buildContextPack`, `contextAbsences`; CLI `mcp`, `context` | `construido` · **brecha declarada** (it is the exposed surface, not the O2 interception/mediation: no per-role allow-list is enforced at a boundary — see G-13) |
| Absorbing the incumbents — Kiro, spec-kit and cc-sdd (*Manual Maestro* migration; spec-kit issue #1436) | A conversion here is a **MAPPING**, never a promise of equivalence: every conversion names its reason, every recognized-but-unmappable artifact becomes an explicit `skip` with its reason, and `applyImport` never overwrites an existing file. Kiro/cc-sdd steering and the triad are copied (with `design.md` normalized to the canonical `plan.md`); spec-kit's `spec.md` becomes `requirements.md` behind a provenance banner; the constitution is copied verbatim with `validateConstitution`'s findings reported and never "fixed". | `core/importers.ts` · `IMPORT_SOURCES`, `planImport`, `applyImport`, `provenanceBanner`; `cli/commands/init.ts` · `handleImportCommand`; CLI `import [kiro\|spec-kit\|cc-sdd] [--write\|--dry-run\|--json]` | `construido` · **brecha declarada** (known losses are named in G-25; imported requirements are not EARS-validated) |
| One number and one phase — the door (*Manual Maestro* v3.0 EGTAV: the validation layer is where the work is read; §9.6 accounting discipline) | `open-sdd` with no arguments inspects the repository and prints the composite **SDD score** (0–100, a weighted mean over seven components that already exist as checks: constitution 20, EARS 15, traceability 15, evidence 15, contracts 10, gates 15, alignment 10), the current **phase** (1 Specify · 2 Implement · 3 Verify) and the **single next action** with one line of why. The first rule is that no new oracle is invented: every component delegates to the module that already owns the semantics. A component that could not be inspected is declared in `notMeasured` and its weight is **excluded from the denominator** rather than scored 0 or 1; the gate component can never say "gates OK" while the command of the same invocation said the chain fails. The same line is the footer of every command (`--json`, `--quiet` and `--no-footer` suppress it). | `core/sddScore.ts` · `SDD_SCORE_WEIGHTS`, `computeSddScore`, `chooseNextAction`, `explainNextAction`, `renderScoreFooter`; `index.ts` · `runScoreDoor`, `emitScoreFooter`, `runsGateChain`; CLI `open-sdd` (no arguments) | `construido` |
| On-demand assistants (§4.7 human evaluation; §9.7 decidable discipline; *Manual Maestro* EARS) | One decision point that makes the assistants that already exist appear where they are needed: it reads the repository state and the findings a command just produced and returns suggestions plus the command that advances. Four rules keep it honest: it **writes nothing**, it **blocks nothing** (it never touches the caller's exit code), it **deduplicates** by content within a run, and it **invents nothing** — a missing actor, trigger, measurable value or replacement id becomes an explicit question, never a template with holes. `notChecked` names what it could not inspect. | `core/assistants.ts` · `assist`, `renderAssist`, `AssistSuggestion`, `resetAssistLedger`; wired into `cli/commands/status.ts`, `cli/commands/brownfield.ts` | `construido` (proposals only) · `propuesto` (no model backend ships; the host model writes the prose) |
| The EARS assistant (§4.6 EARS grammar; *Manual Maestro* EARS) | Goes past "is this EARS?" to "how is it written well?": a catalogue of stable finding codes (compound requirement, vague term, missing trigger, passive voice, no actor, not testable), a paste-ready rewrite that is a **complete EARS sentence** or an explicit `EARS_NEEDS_INFORMATION` question — never a placeholder — the pattern it uses, and a worked example from this repository's own documents. `earsEvidencePack` hands the host model exactly what it needs to draft; `complete` means coverage of the document, not a verdict. | `core/earsAssistant.ts` · `EARS_PATTERNS`, `analyseEars`, `EARS_SUGGESTION_CATALOGUE`, `earsEvidencePack`, `mergeEarsReports`, `renderEarsReport`; CLI `govern --advise-ears`, `brownfield requirements` | `construido` · **brecha declarada** (no model backend: it proposes and asks, it does not decide) |
| Templates adapted to the observed stack, embedded TDD, one-pass consistency (spec-kit issue #1436 "templates adapted to specific tech stack and coding style"; §9.7; CSDD §3.3) | Adaptation is **evidence, not decoration**: every substituted value names the file that demonstrates it and the pair is recorded in `adaptedFrom`; anything left as `{{PLACEHOLDER}}` is listed in `unchanged` with the reason. When a test runner is observed, the tasks template carries the red-green cycle (test first, command that must fail, implementation, command that must pass) using only commands the repository declares; with no runner it emits **no** cycle rather than a promise with no oracle. It writes only to `<sddDir>/settings/templates/brownfield/` and never overwrites. `brownfield analyze` composes the checks that already exist (trace, pivot, contracts, boundaries) into one pass and names `notChecked` with its reason — an absent artifact is a declared gap, not a pass. | `core/templateAdaptation.ts` · `adaptTemplates`, `ADAPTED_TEMPLATE_DIR`, `ADAPTED_TEMPLATE_FILE`; `core/consistency.ts` · `checkConsistency`, `ConsistencyReport`; CLI `brownfield templates [--write\|--json]`, `brownfield analyze [--base\|--json]` | `construido` |
| The constitutional ratchet and expiring waivers (CSDD §3.4 apex; invariants I1/I6; REQ-MAT-005, REQ-MAT-012) | The pivot answers "how much of the authority the spec cites resolves today?"; the ratchet answers "is that worse than the last time?" A baseline per feature lives in `.sdd/state/adhesion.json` (alignment ratio, the ids of the principles **in force**, the constitution hash, the timestamp). The first run never fails; a descent is an `error` that names the principles that fell out and does **not** self-rebase; `--accept-drop "<reason>"` authorizes that specific descent and records who/what/when; a rise updates the baseline; corrupt state is a `warning` and a reset, never a silent pass. Separately, a security allow-list entry may carry `owner` and `expires`; an expired waiver stops applying and is named by the advisory surface (`waiver-expiring`). | `core/ratchet.ts` · `runAdhesionRatchet`, `readAdhesionState`, `hashConstitution`, `adhesionStatePath`, `ADHESION_STATE_FILE`; `core/securityAllowlist.ts` · `parseSecurityAllowlist`, `expiredWaivers`, `applySecurityAllowlist`; `core/constitutionAdvice.ts` · `adviseConstitution` (`waiver-expiring`, `evidence-expired`, `amendment-aged`); CLI `status [--accept-drop]`, `govern constitution --advise` | `construido` |
| The audit evidence bundle and SARIF (CSDD §3.3 audit support; §9.6 "only `broken` halts publication"; REQ-MAT-006/REQ-MAT-007) | One command assembles the evidence an auditor reads — constitution, specs, gates, claims, alignment and rigor — with **one sha256 per artifact** in `manifest.json` and an explicit verdict; `audit sarif` emits SARIF 2.1.0 and validates its shape before writing. Exit codes are a contract: `0` pass · `1` blocking finding (gate FAIL or broken claim) · `2` the audit could not run. `action.yml` is the same contract as a native composite GitHub Action, building the CLI from `github.action_path` so the action and the gates cannot drift; the CI workflow uploads the bundle and the SARIF to code scanning. | `cli/commands/audit.ts` · `collectEvidence`, `writeBundle`, `buildSarifLog`, `validateSarifShape`, `AUDIT_EXIT_CODES`, `renderBundleSummary`; `action.yml`; `.github/workflows/gates.yml`; CLI `audit bundle [--out] [--sarif] [--profile]`, `audit sarif [--out]` | `construido` |
| Reproducible container entry point (§16.1) | The `Dockerfile` is multi-stage and honest about what it ships: the build stage compiles TypeScript, the runtime stage copies only `dist`, `templates` and `package.json`, and no `node_modules` reaches the final image. `.github/workflows/gates.yml` carries a `container` job that builds it for **`linux/amd64` and `linux/arm64`** with QEMU + Buildx, failing the job if either platform fails, and **pushes to `ghcr.io/brujo2020/open-sdd` on `main` and on version tags** with job-scoped `packages: write`; `:latest` only on `main`. `push` is `false` on a pull request, so the build check still runs and a PR cannot write to the registry. | `Dockerfile`; `.github/workflows/gates.yml` · job `container`; `docs/guides/ci-integration.md` | `construido` (both platforms are built **and published**: `ghcr.io/brujo2020/open-sdd` is public and anonymously pullable for `linux/amd64` and `linux/arm64`, with `:3.3.0`, `:latest` and a per-commit `:sha-<commit>` — G-27 is resolved) |
| Reproducible distribution — the release pipeline (§16) | `@brujo2020/open-sdd` publishes from the repository root. The publish step supports **two credential routes** and states which it attempts: a granular `NPM_TOKEN` (Bypass 2FA) passed as `NODE_AUTH_TOKEN`, or OIDC trusted publishing with `id-token: write` when the secret is empty. `workflow_dispatch.dry_run` exercises install → build → test → gate chain → claims → `npm pack --dry-run` and publishes nothing. | `.github/workflows/publish.yml`; `docs/guides/publish.md` | `construido` (the artifact: **3.3.0 is published** — `dist-tags.latest = 3.3.0`, 613 files; it went out through the manual OTP path) · **brecha declarada** (no CI credential route has yet produced a green publish — G-28) |
| The portable commit gate (§6.3 Table 19 levels A–D; §16.1; REQ-MAT-003) | The level-B boundary is a **Node** hook (`pre-commit.mjs`), so it runs on a non-POSIX host; a POSIX `/bin/sh` fallback (`pre-commit`) fails **closed** with a diagnosis when Node cannot be honoured, because a commit gate that silently degrades to "no checks" is worse than none. It judges the **staged index** (`--staged`) with C1 (advisory), C2 (blocking: secrets and destructive commands) and C3 (blocking: a completed task with no captured `_Evidence:`); when the CLI is missing it prints the three ways to fix it. `doctor` reports whether the installed hook is our current version and whether it depends on a POSIX shell. | `templates/hooks/pre-commit.mjs`, `templates/hooks/pre-commit`; `scripts/install-hooks.mjs`; `core/floorInstallation.ts` · `detectInstalledFloor`; `core/doctor.ts` · `inspectCommitHook`, `runDoctor`; CLI `floor install\|status`, `doctor` | `construido` · **brecha declarada** (level A is still a ceiling; the Windows job carries a step that would execute the hook through a real `git commit`, but it is skipped while the suite is red, so no run of it exists — G-26) |
| Installation self-diagnosis and guided first run (spec-kit's onboarding surface, reimplemented; *Manual Maestro* v3.0 EGTAV) | `doctor` turns every startup assumption into a named check with the exact fixing command — Node range, CLI reachability, the commit hook and its portability, declared rigor, constitution, specs and the offline posture — and never reports `ok` for something it could not inspect. `tour` teaches by doing: it runs the real commands through their real handlers and stops at the human decision (ratifying a constitution is never automated). `context` is the terminal face of the MCP context pack, so a host and a terminal read the same object. | `core/doctor.ts` · `runDoctor`, `renderDoctor`, `inspectCommitHook`; `cli/commands/tour.ts` · `handleTourCommand`, `handleContextCommand`; CLI `doctor`, `tour`, `context [--json]` | `construido` |
| The demo, the synthetic bench and the measurements (§14.3 risk-lab discipline — applied to this repository's **own** instrument, not to the paper's benches) | `scripts/demo-60s.sh` creates a throwaway repository, injects four real incoherences (an untraced delta requirement, a completed task with no `_Evidence:`, an unfilled `{{…}}` marker, a declared contract that does not exist), runs the **pinned** `tools/open-sdd/dist/cli.js` and exits non-zero if the engine fails to name any of them — a demo that cannot fail is marketing. `bench/harness.mjs` builds ten synthetic repositories from a verified-clean baseline, injects exactly one documented class per repo and reports injected/caught/missed per class; it exits `1` on a dirty baseline or a miss. `docs/MEASUREMENTS.md` records the numbers with the exact command, tool version and seed. | `scripts/demo-60s.sh`; `bench/harness.mjs`; `bench/README.md`; `docs/MEASUREMENTS.md`; `docs/guides/quickstart-60s.md` | `medido` (10/10 synthetic classes caught, reproducible offline from a clone) · **brecha declarada** (these are **synthetic** honesty numbers, not field data; the paper's κ/FPR/latency figures remain the prototype's — G-29) |
| The prompt templates — the **default** integration, and whose way of working it is (spec-kit's `templates/commands/*.md`; §6.4 progressive disclosure; Table 4) | **The way of working is spec-kit's**, and this report says so plainly: its `templates/commands/*.md` — ten Markdown prompt files, verified at `github.com/github/spec-kit/tree/main/templates/commands` — is the shape (one prompt per workflow, invoked from chat). **What open-sdd adds is the engine below the prompt**: every template calls the real commands (`open-sdd status --json`, `open-sdd brownfield analyze <feature> --json`, `open-sdd delta validate <feature>`, `open-sdd gates run`) instead of describing what it would do, so the flow works with no MCP, no network and nothing a security policy can block. 22 templates, one per `COMMAND_TEMPLATE_IDS` entry; each host's command directory is a row of `HOST_COMMAND_TEMPLATES`, an unverified convention is refused (`keep` with its reason) rather than guessed, and every artifact carries a sha256 signature of the generated body so a human's edit is never overwritten. | `core/commandTemplates.ts` · `COMMAND_TEMPLATE_IDS` (22), `HOST_COMMAND_TEMPLATES`, `renderCommandTemplate`, `planCommandTemplates`, `installCommandTemplates`, `summarizeCommandTemplates`, `commandHostById`, `hostForAgent`, `readCommandTemplateCatalogue`; `templates/commands/*.md` (22 files); `cli/commands/init.ts` · `handleInitCommand` (artifact kind `command-templates`); `cli/commands/templates.ts` · `handleTemplatesCommand`; CLI `init [target] [--agent <id>] [--write]` and `templates [--host <id>] [--json]`; `docs/guides/integrations.md` | `construido` · cite: spec-kit `templates/commands/*.md` (the flow), open-sdd engine (what is added) · listed by `open-sdd templates` and named by `--help` (G-31, resuelta) |
| The branch role as a governance input (§6.3 Table 19 levels A–D; the floor is B/C; *Manual Maestro* git flow) | The **role of the branch decides what is required**, and the role is DERIVED from the branches git reports — never from a config file, because a branching model declared but not observed would be a claim without evidence. `gitflow` is declared only when `develop` and `main`/`master` both exist, `trunk` only with a single non-role branch, and `none` otherwise with the reason; the role is read from the real prefixes (`feature/`, `feat/`, `bugfix/` → `feature`; `release/`, `hotfix/`, `<x>-delta`). `branchPolicy` returns what the role REQUIRES and, separately, what actually BLOCKS today — and that second list is explicit that **this tool installs NO branch protection, no required reviews and no push blocking, so no role, `main` included, has a lock of its own**. What blocks today is only the installed floor: the level-B pre-commit hook (C1/C2/C3 over the staged index) and the level-C pull-request workflow (full chain); everything else the role demands is advice. Report-only: it executes nothing and writes nothing. | `core/gitflow.ts` · `detectGitFlow`, `branchPolicy`, `renderGitFlow`, `CORE_CHAIN_IDS`; `cli/commands/gitflow.ts` · `handleGitflowCommand`; CLI `gitflow [--level <l>] [--greenfield] [--json]`; `docs/guides/gitflow.md` | `construido` (model + policy + report) · **brecha declarada** (no branch protection / required reviews / push block — G-33) |
| The progress ledger — consciousness, not a scoreboard (*Manual Maestro* v3.0 EGTAV; §9.6 accounting discipline) | `.sdd/state/progress.json`, APPEND-ONLY and atomic (write tmp + rename), answering "what was achieved, when, and with what evidence?". The rule the shape enforces: `delta` is **COMPUTED** against the previous entry, never supplied by the caller — the input type omits it (`Omit<ProgressEntry,'at'\|'delta'>`), and a value smuggled through an `as any` is discarded and recomputed, so a lie about progress is not expressible. Without movement the delta is 0 and it says `sin cambios` instead of dressing it up as a rise; the caller supplies the timestamp, which the module sets, and a `summary` that must be ONE concrete line ("se avanzó" is rejected). A corrupt ledger never throws and never becomes a story told from unreadable bytes: it warns and starts a NEW series. It owns only that file — `adhesion.json` belongs to the ratchet. | `core/progress.ts` · `PROGRESS_STATE_FILE`, `progressStatePath`, `readProgress`, `recordProgress`, `renderProgress`, `DEFAULT_PROGRESS_LIMIT`; `cli/commands/progress.ts` · `handleProgressCommand`; CLI `progress [--json] [--limit N]`, `progress record --kind <t> --summary "<line>" --score <0..100> --phase <1\|2\|3>`; `docs/guides/progress-and-backup.md` | `construido` |
| The restorable backup of the governance state — versus the audit bundle (§16 reproducibility; CSDD §3.3 audit support) | A backup is **for you** and returns your work; it does not attest to a third party. That is the difference from `audit bundle` (`cli/commands/audit.ts` · `collectEvidence`, `writeBundle`), which produces evidence an auditor recomputes (one sha256 per artifact, an explicit verdict): complementary operations, deliberately not the same one. Shape: a DIRECTORY, `<out>/manifest.json` + `<out>/files/…` mirroring the whole `.sdd/` tree (settings, specs, steering with the constitution, the state ledgers), so it verifies and restores without unpacking and `restore --only <path>` can bring back a single file. `verifyBackup` recomputes every sha256 and a backup that fails its own manifest is never declared good. `restoreBackup` never silently overwrites: per file `restored` or `skipped` with a stable reason (identical, differs, newer on disk, absent, hash mismatch) and **a path that escapes the backup root is a rejection, not a restore**. Credentials and reproducible trees are SKIPPED **and NAMED in `manifest.detail`**: `.npmrc`, `.env*`, `.netrc`, `.git-credentials`, private keys `id_rsa`/`id_ed25519`, plus `node_modules`, `dist`, `.git` and symlinks — a backup that stores a token in plain text is a leak with a date. | `core/backup.ts` · `createBackup`, `verifyBackup`, `restoreBackup`, `BACKUP_SCHEMA`, `BACKUP_MANIFEST_FILE`, `BACKUP_CREDENTIAL_PATTERNS`, `BACKUP_EXCLUDED_DIRS`, `RESTORE_SKIP_REASONS`; `cli/commands/backup.ts` · `handleBackupCommand`; CLI `backup create\|verify\|restore`; `docs/guides/progress-and-backup.md` | `construido` |
| The biography of a living specification — its rhythm (§4.5 living documentation; *Manual Maestro* v3.0) | What the spec's git history says: when it was born, when it last moved, whether the code kept moving without it, which delta entries (amendments) shaped it and what they replaced, who ratified the constitution it is read against, and the phases declared in `spec.json` over time. **It measures ACTIVITY, never quality**, and the rendered output carries that sentence every time (`ACTIVITY_IS_NOT_QUALITY`): a spec that never changes can be correct, and one that changes daily can be a disaster. The `breathing` verdict is DERIVED, never asserted without the numbers: no git (or spec outside the work tree) → `unknown`; git never saw it → `orphan`; code unmoved since birth → `quiet`; ≥3 code commits after the spec's last change → `stale` (naming the number) and it wins over `orphan`; written once and code moved → `orphan`; nothing after it → `alive`; spec share ≥1/3 → `alive`. Gates are not re-run here and are reported as not measured. | `core/specBiography.ts` · `specBiography`, `renderBiography`, `STALE_CODE_COMMITS`, `ALIVE_SPEC_SHARE`, `ACTIVITY_IS_NOT_QUALITY`, `DEFAULT_EVENT_LIMIT`; `cli/commands/biography.ts` · `handleBiographyCommand`; CLI `biography <feature> [--limit N] [--json]` | `medido` on this repository · what it says about THIS repo: `biography brownfield-support` → **`stale`**, **26** code commits after the spec's last change against a threshold of **3** (4 spec-directory commits vs. 34 total; last spec change `98881ab`, 2026-09-19T21:16:09-03:00; the number moves with every commit) · thresholds are chosen, not calibrated — G-32 |
| The celebration — a visible "yes" that has to be earned (§9.6 accounting discipline; *Manual Maestro* v3.0) | Fires only when the **three truths hold at once**: EARS conforming (`errors === 0` and `conforming === total`), the constitutional pivot evaluated with `errors === 0`, and gates with no failure. A verdict that could not be established — no requirements, pivot not evaluated, no gate result, any section `notChecked` — is **refused**, never downgraded to a friendly "plain", and the refusal names the missing datum; the search order is what is MISSING before what FAILS. Feature scope (`judgeFeatureCelebration`) shares the same core as the per-check case, so they cannot diverge. The streak `N` (consecutive adhesion rises) comes from the ratchet and is never re-derived here; without N no streak is printed. The ledger `.sdd/state/celebrations.json` records only REAL validations: `appendCelebration` rejects a missing score/phase, non-conforming EARS, a pivot without alignment or gates not all green, dedupes by feature+date+score, and a rejection leaves no trace. Animation is TTY-only and bounded (10 frames × 60 ms) and the last line a caller receives is always the static readable summary. | `core/celebrate.ts` · `judgeCelebration`, `judgeFeatureCelebration`, `celebrateFeature`, `playCelebration`, `appendCelebration`, `readCelebrations`, `deriveAchievements`, `CELEBRATIONS_STATE_FILE`; `cli/commands/status.ts` · `handleStatusCommand`, `--celebrations` | `construido` (it celebrates checks that ran, never "the software is good") |
| The Stop hook — the flagship: the commit gate's verdict inside the agent's own loop (§6.3 Table 19 levels A–D; the flag ship) | ONE hook for the two hosts whose blocking mechanism was read from their own documentation: Claude Code (`Stop`, exec form `command` + `args` in `.claude/settings.json`) and Codex CLI (`Stop`, shell-string `command` in `.codex/hooks.json`). The argv runs the SAME invocation the commit gate runs (`gates run C1 C2 C3 --staged --strict`, byte-for-byte the `GATE_ARGS` of `templates/hooks/pre-commit.mjs`; a test re-parses that file and fails if the two drift). Why the argv is not literally `['node', cli, ...GATE_ARGS]`: **`gates run … --strict` exits 1 on a failure while both hosts block only on exit 2**, so a raw argv would have **FAILED OPEN** — it would have run the check, seen the failure and let the agent declare done anyway. That is exactly the `hook-failed-open` case this repository's own enforcement module names (`DEFAULT_SENTINEL`, `core/enforcement.ts`), where a hook that dies with 1 fails open while the config still reads "blocking". The adapter interposes **no new check**: it spawns the CLI with the same gate args and maps any non-zero (a finding, a crash, a missing CLI) to 2, so failure is always closed, and it conserves stdout/stderr because a block with no reason teaches the reader to disable the hook. Verified for `claude-code` and `codex`; every other host is **refused with its reason** and nothing is written. | `core/stopHook.ts` · `STOP_HOOKS`, `STOP_HOOK_GATE_ARGS`, `installStopHook`, `stopHookFor`, `StopHookInstallation`; `core/enforcement.ts` · `DEFAULT_SENTINEL`; `templates/hooks/pre-commit.mjs` · `GATE_ARGS`; `core/doctor.ts` · `runDoctor` (plan-mode stop-hook status); `cli/commands/init.ts` · `handleInitCommand`, `handleIntegrateCommand`; CLI `integrate <host> [--write]`, `doctor`; `docs/guides/stop-hook.md` | `construido` · **brecha declarada** (never observed blocking a real agent end-to-end on this machine, and `stop_hook_active` is not consumed — G-30) |

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
`node tools/open-sdd/dist/cli.js delta validate brownfield-support` reports **0 errors** and
**14/14 requirements with a traced task (100%)** — the two-way check stated in a single line. The
single warning is the empty `REMOVED` section: a decision recorded rather than an omission. What that
line does *not* prove is the regression oracle: the contracts are declared, but nothing executes the
delta→contract mapping (G-15) — a gap the delta itself declares as the `ADDED` entry `REQ-BF-008`
("the tests that protect the change are declared and verified"), whose target module exists but has
no caller. The delta is now merged back into the base by `delta merge --write`, which is
all-or-nothing and refuses to touch the base when any entry cannot be applied; G-17 states what that
merge still does not do.

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

- The registry holds **62 claims**, not the paper's 33, because it registers this port's components
  (including the brownfield capabilities, CLM-045 … CLM-053, and the synthesis and adoption surfaces,
  CLM-054 … CLM-062).
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
- **The merge back is textual and unchecked afterwards.** `delta merge --write` now rewrites the base
  `requirements.md` from the ADSR entries and marks the delta `merged`; it is all-or-nothing and
  refuses when an ADDED id already exists with other content, a MODIFIED/REMOVED/RENAMED target is
  not found, or a rename would collide with a different requirement. What it does **not** do: validate
  that the base stays coherent after the merge beyond those checks, or detect drift between a
  `merged` delta and the base later. See G-17.

### G-13 — Provenance, MCP mediation and sandboxes are represented, not enforced

Paper: §6.1/§6.2 (harness countermeasures), Table 5 rows 4 and 7. `assurance.ts` maps
`AML.T0010`/SLSA and defines the complementary controls; `skills.ts` enforces the MCP *rule* on
declared data; and a stdio **MCP server** now exists (`src/mcp/**`, 11 tools and read-only resources,
see the component map). But the server is the exposed *surface*, not the interception: there is no
MCP proxy, no per-role allow-list enforcement at a boundary, no
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

### G-17 — The delta merges back textually, and nothing checks the base afterwards

Paper: §12 (the extracted specification as the thing modernization preserves). `delta merge --write`
(`deltaSpec.ts` · `mergeDeltaIntoBase`, `cli/commands/brownfield.ts` · `handleDeltaCommand`) now does
what the label used to claim: it rewrites the base `requirements.md` from the ADSR entries and only
then sets `DeltaSpec.status = 'merged'` and each applied entry's `Merged: true`. The merge is
**all-or-nothing** and refuses, leaving the base untouched, when an ADDED id already exists with
different content, a MODIFIED/REMOVED/RENAMED target cannot be found, or a rename would collide with
a different requirement; it is also idempotent (a second run reports "sin cambios", never duplicates).

What remains a declared gap: the merge is a **textual** rewrite matched by id or by the `previous`
text, so it does not re-validate the base's EARS conformance, its traceability or its alignment after
the write, and no command compares a `merged` delta with the base later to detect drift between them.
The honest reading: applying a delta is now a command, not a manual edit, but "the base and the delta
agree" is still an assumption the tool does not re-check.

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

### G-20 — RESOLVED: `bootstrap --write` now writes the three artifacts its own plan announces

Paper: §12 / *Manual Maestro* v3.0 EGTAV. This gap was recorded when `brownfield bootstrap --focus
"<texto>" --write` printed an `Artefactos` list with the focus delta seed as `create` while the write
path created only `.sdd/steering/codebase-intelligence.md` and, when absent, `.sdd/steering/constitution.md`.
The write path now creates the delta seed too, by reusing `delta init`'s own scaffold
(`cli/commands/brownfield.ts`, the `deltaCreated`/`deltaKept` block): `.sdd/specs/<slug>/delta.md` is
written when absent and reported as `conservado` when it already exists, and the plan's write set and
the write path agree. The entry is kept in the numbering because a gap that closes is a fact about the
report's own history; the remaining limit is only that the seed exists when `--focus` is given (without
a focus there is no slug to name), which the plan states.

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

### G-24 — RESOLVED: all four MCP registrations are verified, Antigravity included

Paper: §6.4 / Table 4 (agent-agnostic installation); §9.5 G16/O2 ("Intercepción MCP"). The integration
matrix (`integrations.ts`) treats `mcp.verified` as an **evidence** field, and every verified row carries
the URL it was checked against, so a reader can re-verify it rather than trust it:

- **GitHub Copilot** — verified against the VS Code documentation: `.vscode/mcp.json` with a `servers`
  object and a `{type: "stdio", command, args}` entry. The Copilot CLI remains a **separate surface**
  with `mcpServers`; modelling both rather than pretending one shape serves both.
- **OpenCode** — verified: `opencode.json` with an `mcp` key, `type: "local"`, and an ARRAY `command`.
- **Zed** — verified, and the verification **corrected** the earlier guess: `context_servers` entries use
  a STRING `command` plus a separate `args` array, not the nested `command: {path, args}` object that
  had been assumed. That correction is the argument for this field existing at all.
- **Google Antigravity** — **now fully verified**, and this closes the last partial row. The page at
  `https://antigravity.google/docs/mcp` is JavaScript-rendered, so a plain fetch returns the navigation
  and the section titles but not the example. The rendered page itself **advertises a Markdown sibling**:
  its inline script builds `View Markdown`'s href as `location.pathname + '.md'`, and the buttons
  `Copy Markdown` / `View Markdown` are in the served HTML. Fetching `https://antigravity.google/docs/mcp.md`
  (HTTP 200, `text/markdown`, 14 582 bytes) yields the documented shape: a **single top-level `mcpServers`
  object**, one entry per server, where a stdio entry carries `command` (string) and `args` (array) and may
  add `env`, `cwd`, `disabled` or `disabledTools`; remote entries use `serverUrl`, with `url` and `httpUrl`
  explicitly unsupported. Antigravity therefore joins the `mcpServers` family and uses the same snippet as
  Claude Code/Cursor. URLs tried and what each returned, since a dead end is worth recording even when the
  hunt succeeds: `docs/mcp` with a browser UA → `200 text/html` (109 836 bytes, JS-rendered, no shape);
  `docs/mcp.md` → `200 text/markdown` (the shape); `docs/mcp/index.md` → `404`; `docs/mcp?format=md` →
  `200 text/html` (the query is ignored, identical bytes to the base page). The workspace path
  `.agents/mcp_config.json` is the one the matrix declares for `--write`; the global
  `~/.gemini/config/mcp_config.json` is recorded in the notes. `open-sdd integrate --list` prints the row
  `verificado` and `integrate antigravity --dry-run` plans the merge into `.agents/mcp_config.json`.

The consequence is deliberate and stated by the CLI: an unverified row is printed as **NO VERIFICADA** and
`--write` refuses to write it, so nothing is ever written into someone's editor on the strength of a guess.
That guard remains in the code and is now exercised by a synthetic row in the test suite rather than by a
real host, because **no host in the shipped matrix is unverified any more** — the matrix is four quarters
verified instead of none.

### G-25 — The importers are mappings, not faithful migrations, and the losses are named

Paper: *Manual Maestro* migration workflow; spec-kit issue #1436 (absorbing the incumbents).
`importers.ts` converts Kiro/cc-sdd and spec-kit artifacts into the `.sdd/` layout, and its contract
says plainly that a conversion is a **MAPPING**, never a promise of equivalence. The known losses, all
verified in the code, are: Kiro/cc-sdd **`spec.json` is skipped** (its metadata shape is not ours, so
copying it would make the engine read foreign metadata as its own); non-JSON settings, nested settings
directories and any JSON that fails to parse are **skipped**; **cc-sdd skills are skipped** (its
`kiro-*` set is not a rename of our `sdd-*` set); spec-kit **templates and scripts are skipped by
design**, as are unknown spec documents, non-`contracts` directories and `.specify/memory/*` other than
`constitution.md`; a spec-kit `spec.md` becomes `requirements.md` behind a provenance banner and its
content is **copied verbatim, not EARS-validated**; and a spec-kit constitution is copied **verbatim**
with `validateConstitution`'s findings reported, never fixed, so a constitution without open-sdd's
six-field anatomy must be rewritten by a person before a blocking verdict can cite it. `applyImport`
never overwrites an existing file and reports every path it refused to touch, and an import that would
leave two SDD roots (`.kiro` and `.sdd`) raises a warning. The honest label: an on-ramp that loses
nothing silently, not a lossless migration.

### G-26 — The portable commit gate has never executed on Windows, and the Windows suite is red again

Paper: §6.3, Table 19 (levels A–D), §16.1 (host portability of the floor). `.github/workflows/gates.yml`
declares a `windows` job (windows-latest, Node 20) that builds the CLI and runs the **full** suite with
no skips, and a later step that would execute the portable hook there. Four facts, all from the workflow
and the Actions API rather than from prose:

1. **The job executes.** It is not a declaration that never ran: the last fully green `gates.yml` run on
   `main` is `35538792448` (2026-09-20T21:28Z, sha `fa4a170`, the v3.1.1 release commit), which reports
   `gates`, `windows` and `container` all `success`.
2. **It is red on the current head, and this report does not call it green.** In run `35555105973`
   (2026-09-21T02:43Z, sha `49a6c33`, the current `origin/main` HEAD) the failing job is `windows` at
   its *Test suite (full)* step: `test/coreCommandTemplates.test.ts` reports `2 failed | 127 passed
   (128)` files and `2 failed | 1499 passed | 6 skipped (1507)` tests. The two failing tests are
   `installCommandTemplates — create, keep, update, and refuse > writes into each newly documented host
   at the exact path its own docs name` and `… > renders TOML for Gemini CLI and Markdown for the
   rest`, each `AssertionError: expected false to be true`. The local macOS suite is green on the same
   tree (128 files / 1507 tests), so the failure is Windows-specific. The log now names the failing
   tests and the assertion, so this report states them instead of guessing a root cause.
3. **The earlier POSIX-mode prediction is retired, not confirmed.** A previous revision of this gap
   predicted three execute-bit assertions (`enforcementFloor.test.ts:170`, `cliInit.test.ts:389`,
   `coreDoctor.test.ts:601`). Those sites now carry `it.skipIf(process.platform === 'win32')`
   (`enforcementFloor.test.ts:160`, `cliInit.test.ts:379`, `coreDoctor.test.ts:346`), which is where the
   run's 6 skips come from, and they are not the current failure. The failing class is
   `coreCommandTemplates`, which the prediction did not name. The comment block in
   `.github/workflows/gates.yml` still listed the three old sites and was corrected in the same revision.
4. **The hook step exists and has never executed, because the suite fails before it.** The job carries a
   step, `Execute the portable commit hook on Windows (G-26)`, that `git init`s a fixture, points
   `core.hooksPath` at the production layout (`<hooksDir>/pre-commit`, no extension) and asserts both
   outcomes of a real `git commit` (a staged key blocks with the hook's own refusal; a clean index
   commits). In run `35555105973` that step is **`skipped`** because *Test suite (full)* failed first
   (the API step list reads step 6 `failure`, step 7 `skipped`). So the portable Node hook
   (`templates/hooks/pre-commit.mjs`) has still never executed under git on Windows — the half of the
   gap that was never about the suite — and `doctor` reports the hook's POSIX dependence as a check
   precisely because that part is real.

The honest summary: Windows portability is **not** established today. The suite has been green there and
the job is real; on the current head it is red at two named `coreCommandTemplates` assertions, and the
hook step that would settle the other half is skipped until that suite goes green.

### G-27 — RESOLVED: the container image is built for both architectures by CI and published, publicly pullable, to GHCR

Paper: §16.1 (a reproducible, host-independent entry point). The gap had two halves, and both are now
closed by evidence rather than by configuration.

**The build.** `.github/workflows/gates.yml` carries a `container` job that builds the `Dockerfile` for
**`linux/amd64` and `linux/arm64`** with `docker/setup-qemu-action` + `docker/setup-buildx-action`. The
`Dockerfile` itself needed **no change**: `node:20.19-alpine3.23` is a multi-architecture manifest that
already carries both targets, and the build has no architecture-specific step (the build stage runs
`npm ci` + `tsc` inside the target container; the runtime stage only copies `dist`, `templates` and
`package.json`). Every recent `gates.yml` run reports `container` as `success` — including `35555105973`
(2026-09-21T02:43Z, sha `49a6c33`, the current `origin/main` HEAD, whose `gates` and `windows` jobs both
failed) and the tag run `35555282277` (`v3.3.0`, where `container` was the only job that ran).

**The published image.** The job does not stop at building: on `main` and on a version tag it logs in to
GHCR and pushes both platforms, and the result is publicly pullable. Verified from a machine with **no**
`ghcr.io` credentials in `~/.docker/config.json`:

- `docker manifest inspect ghcr.io/brujo2020/open-sdd:latest` returns an image index whose platforms are
  `linux/amd64` and `linux/arm64`, beside the two buildx provenance/attestation manifests;
- the anonymous token flow succeeds — `https://ghcr.io/token?scope=repository:brujo2020/open-sdd:pull&service=ghcr.io`
  issues a token with no credentials, and `/v2/brujo2020/open-sdd/tags/list` answers with `3.3.0`,
  `latest`, `3.2.0` and a per-commit `sha-*` tag per pushed revision, including `sha-49a6c33394ae` for
  the current `origin/main` HEAD.

So the GHCR default visibility is **public** and the job-scoped `packages: write` permission is
**proven by the tags it pushed** — the two items this gap recorded as unproven. It is closed: the image
exists, carries both architectures, and a reader can pull it.

### G-28 — No CI credential route has yet produced a green publish (v3.3.0 was carried by hand, not by CI)

Paper: §16 (reproducible distribution). The package **is** published: the registry's **last published
version is v3.3.0** (2026-09-21T02:48:20Z), with **v3.2.0** (2026-09-21T00:38:37Z), **v3.1.1**
(2026-09-20T21:29:22Z), **v3.1.0** (2026-09-20T20:57:44Z) and **v2.0.0** (2026-09-17) before it, and
`dist-tags.latest` is **3.3.0**. The unscoped name `open-sdd` does not exist (HTTP 404), so
`npx open-sdd@latest` is **not** this project and remains the wrong invocation. What is still a gap is
the *path*, not the artifact:

- **No recorded `publish.yml` run has carried a version through the credential exchange, and the latest
  one did not even reach it.** The tag-triggered run for **v3.3.0** (`35555282224`, 2026-09-21T02:46Z)
  failed at **`Verify the claims registry`** — the stale CLM-027/CLM-059 text repaired in this revision
  — so its `Publish` step was **`skipped`**. The three runs before it reached the publish step and
  failed there: v3.2.0 (`35548403616`), v3.1.1 (`35538813623`) and v3.1.0 (`35536455377`). The failure
  surface therefore moved *earlier* in the pipeline with v3.3.0, and on the current tree the credential
  exchange is the untested part, not the pre-publication checks.
- **The tag's `publish.yml` runs the suite, the gate chain and the claims registry before it
  publishes** (`Test suite — a red suite blocks the release`, `Verify the gate chain on the release
  tree`, `Verify the claims registry`, then the single `Publish` step). On v3.3.0 the first two passed
  and the third failed, so the `Publish` step never ran.
- **Route A (the granular token) is implemented but unexercised.** When `NPM_TOKEN` carries a value the
  publish step passes it as `NODE_AUTH_TOKEN`; the owner must generate it with **Bypass 2FA**, because
  the account has 2FA and a token under `auth-and-writes` otherwise demands a one-time password CI
  cannot supply. No recorded run has published through it, and whether the secret is configured is an
  owner-side action this report does not record.
- **Route B (OIDC trusted publishing) has never produced a green publish.** When the secret is absent
  the step **unsets** the variable (an empty secret is treated as no secret, never as a blank token) and
  attempts the OIDC exchange, which `permissions: id-token: write` makes possible. The `dad42b0`
  account of the failure (the exchange needs npm ≥ 11.5.1 and Node 20 bundled npm 10.x) is addressed by
  pinning `node-version: '24'`; the 404 npm returns is an **authorisation failure**, not a missing
  package, and no run has yet gone green on it.
- **The route that shipped every published version remains the manual OTP publish.** v3.3.0 appeared on
  the registry at 02:48:20Z, about a minute **after** run `35555282224` had failed, so the owner's
  `npm publish --access public --otp <code>` carried it — as 3.1.0, 3.1.1 and 3.2.0 were carried before
  it. The tag-triggered CI publish is expected to fail at the credential exchange and does not carry the
  version.
- **The one tag-triggered `gates.yml` run of `v3.3.0` (`35555282277`) reports success on `container`
  alone:** `gates` and `windows` are `skipped` there by the workflow's own `if`, which restricts them to
  pull requests, `main` and manual dispatch. It is not a green chain and not a Windows proof; the
  pre-publication steps of `publish.yml` are the only place the release tree's chain ran.

The honest summary: the artifact path (a published, installable package) is real and the registry is
the proof; the **CI publishing path is unproven on both routes**, and until one of them produces a
green workflow run that actually carries a version, the manual OTP publish remains the release
mechanism. This report does not claim either route works because it is configured, and it does not
infer a working credential path from a tagged release that CI did not carry.

### G-29 — `docs/MEASUREMENTS.md` is synthetic honesty data, not field data, and the paper's figures are still not ours

Paper: §14.3 (risk-lab benches and their refutation thresholds) — applied here to **this
repository's own instrument**, never to the paper's benches, which are not run. `bench/harness.mjs`
builds ten **synthetic** repositories from a baseline it first verifies has zero error findings,
injects exactly one documented class per repo and asks whether the pinned CLI's output names it; the
recorded result is 10 injected / 10 caught / 0 missed, reproducible offline with
`node bench/harness.mjs --seed 1 --repos 10`. That number is a statement about **self-consistency**
(the marker is known and the engine emits it), not about recall on organic repositories and not about
precision against real noise; the harness's own "prompt-only" column is deliberately
`detectado por construcción: no`, because a text checklist has no instrument and scoring it `0/10`
would invent a comparison. The same file keeps saying what must not be restated here: the paper's
κ = 0.86 (n = 15), C4 FPR 20.0 % and the 2.1–2.2 s sweep are the **prototype's** measurements (G-02),
and no model backend ships, so nothing in the bench is evidence about C5/intent alignment. One honest
finding the bench surfaced is recorded rather than smoothed over: the expired-waiver class is named by
the advisory surface, and the `gates run` console line truncates the finding detail at 180 characters,
so the gate fails correctly while its reason is not visible in the console.

### G-30 — The Stop hook has never been observed blocking a real agent end-to-end on this machine

Paper: §6.3, Table 19 (the per-tool ceiling), §16.1. `stopHook.ts` is the one mechanism in this
repository that would block an agent *inside its own loop*, and its design is argued from documented
contracts rather than from an observed block. What is verified: the exit-code adapter's mapping
(`0 → 0`, anything else `→ 2`), that its argv is byte-for-byte the commit gate's `GATE_ARGS` (a test
re-parses `templates/hooks/pre-commit.mjs` and fails on drift), that the two snippets serialize to the
documented shapes (`claude-code` exec form `command` + `args`; `codex` shell-string `command`), and
that every other host is refused. What is **not** verified: that either host, given this hook,
actually refused to end a turn while the gate was failing. No host was run end-to-end here —
`docs/guides/stop-hook.md` says so in its own "Honest limits" — so the blocking behaviour rests on the
hosts' documentation, not on a recorded block. Two further limits travel with it: `stop_hook_active`
is deliberately not consumed, so the hook will re-block on every `Stop` while the gate fails (a
potential loop, documented rather than guarded), and Codex's project hooks load only when the `.codex/`
layer is trusted via `/hooks` (trust is recorded against the hook's hash, so an edit re-prompts). The
honest reading: the adapter removes the fail-open defect this repository could see in its own code; it
does not yet demonstrate that a host blocks.

### G-31 — RESOLVED: the 22 prompt templates are listable, and `open-sdd --help` names them

Paper: §6.4 / Table 4 (agent-agnostic installation). The templates were the default integration while
`open-sdd --help` mentioned neither them nor any way to list them: only the `init` plan's own
`command-templates` artifact, `COMMAND_TEMPLATE_IDS`, `templates/commands/` and
`docs/guides/integrations.md` knew they existed. The capability was there and exercised by
`coreCommandTemplates.test.ts`; what was missing was the door, and a reader who only ran `--help` could
not learn that 22 workflows were installed. Three changes close it, none of them a new format:

- **A command that lists the flow:** `open-sdd templates [--host <id>] [--json]`
  (`cli/commands/templates.ts` · `handleTemplatesCommand`, `buildTemplatesReport`) prints the 22
  workflows with what each one writes, the directory each of the eleven hosts reads, and whether that
  convention is verified; `--host` narrows it to one row, and an unknown host is exit 1 naming the ones
  that exist rather than an empty success.
- **A catalogue parsed from the files themselves:** `readCommandTemplateCatalogue()`
  (`core/commandTemplates.ts`) reads each template's own frontmatter, so the listing cannot drift from
  what ships. A test asserts that the parsed `commands` and `writes` equal the raw YAML lists for all
  22 entries, and that `readOnly` is *derived* from `writes` instead of declared a second time.
- **The count in the help:** `open-sdd --help` now carries a "Command templates (the DEFAULT
  integration: 22 workflows, no MCP and no network)" section with the count, the listing command and
  the install line. The wiring test that parses `--help` and dispatches every command it names
  therefore covers the new row automatically, which is why the help text could not be edited into a
  promise the CLI does not keep.

The "here" line is not an estimate: the count comes from `planCommandTemplates`, the same installer
`init` uses, so it reports `22/22` only when the artifacts are really in place — and it counts
separately the templates a human edited by hand, detected by the sha256 signature, because those are
exactly the ones the installer refuses to overwrite.

Writing the test found a real defect in the parser it introduced: it stripped the outer quotes of a
frontmatter value but left `\"` escaped, so the constitution's ratify command was catalogued as
`open-sdd govern constitution --ratify --by \"<name>\" …` — a string that is not the command it claims
to be. The unescaping is now explicit and pinned by the equality test above.

### G-32 — The biography's thresholds are chosen, and the measurement does not calibrate them (it says so)

Paper: §4.5 (living documentation). `specBiography.ts` derives a `breathing` verdict from measured git
numbers, which is the honest part: nothing is asserted without them. The two boundaries it derives from
are still **decisions, not truths**, but they are no longer unmeasured. On 2026-09-21 the module was run
over every feature under `.sdd/specs/` and at 10 earlier revisions through a temporary `git worktree`
spanning the 81 commits since `.sdd/specs/` first appeared (`af6aa56`): **197 feature × revision
observations over 7 features** (3 live, 4 demonstration specs), one author, one workflow, 5 days. The
module's verdict matched independently computed git numbers on all 23 cross-checked observations.

- **`STALE_CODE_COMMITS = 3`.** The measured reconciliation latency — commits of silence before the spec
  was next updated — is `{0,0,0,0,1,2,3,5,5,12}` for the 3 live features (median 2, mean 2.8, max 12),
  against open gaps of 27–30 at the measurement revision. One commit is demonstrably noise (4 of the 10
  reconciled silences peaked at 0–1; a threshold of 1 would flag 6 of 10) and 3 sits at the mean. But
  **3 is not a materiality boundary**: 4 of the 10 silences that were eventually reconciled had already
  reached 3, so `stale` at 3 is an **early warning** that labels in-flight work roughly 4 times in 10,
  which is why the reason string no longer claims the code "changed materially" — the measurement
  falsified that wording and it was corrected. The only values with perfect separation here (13–27) form
  a 15-wide band delimited by 10 closed and 3 open gaps; inventing a threshold inside it from that sample
  would be worse than keeping the incumbent.
- **`ALIVE_SPEC_SHARE = 1/3`.** The share branch is reached in only 14 of 197 observations (10 revisions).
  Below 1/3 the observed shares are 23–31% and the spec never moved again (4/4); at or above it they are
  38–67% and the spec moved again in 8 of 10 (2 right-censored at the feature's final revision). Nothing
  falls between 31% and 38%, so 1/3 sits inside an **empty band** and is indistinguishable from 0.32 or
  0.37 on this sample.

The suite pins the boundary (two commits do not cross it, three do; 33% crosses the share, 29% does not)
— but pinning a threshold is not validating it. The honest label remains: a heuristic with a stated
rationale and a **measured cost**, not a calibrated instrument. The measurement is reproducible from the
revisions named above; the sample is too small to move either constant, and the calibration target
(whether a silent spec was actually WRONG) is unobservable — the proxy is "the spec eventually moved
again", which is why the perfect-separation band is reported as an interval, not a value.

### G-33 — The branch role is a report; nothing installs branch protection

Paper: §6.3, Table 19; §5.1 invariant I1 (authority on verdicts). `gitflow.ts` answers what a branch
role requires and, separately, what actually blocks — and the second list names only the installed
floor: the level-B pre-commit hook (C1/C2/C3 over the staged index) and the level-C pull-request
workflow (the full chain). The module states in its own output that **this tool installs no branch
protection, no required reviews and no push blocking**, so no role has a lock of its own and a direct
commit to `main` passes. For this repository the public GitHub rulesets API returns an empty list
(`GET /repos/brujo2020/open-sdd/rulesets` → `[]`), which evidences that no ruleset is configured; the
legacy branch-protection endpoint requires authentication (`401` unauthenticated), so the report can
evidence the ruleset absence and not the legacy setting, and it says which is which. The gap is
inherited from the paper's own ownership argument (the floor belongs to the organisation, not to the
tool); what this repository adds is that it is now *named at the moment the role is read*, instead of
being left implicit in a policy table.

### G-34 — RESOLVED: the argument placeholder was declared per host and never consumed

Paper: §6.4 / Table 4 (agent-agnostic installation). `HOST_COMMAND_TEMPLATES` carried an
`argumentSyntax` field per host and the interface said, in its own words, that it was "for the reader;
the body still uses `$ARGUMENTS`". So all 22 rendered artifacts shipped the canonical token verbatim,
whatever the host's engine actually substitutes — and three hosts substitute something else: Gemini
CLI and Qwen Code inject `{{args}}`, and the VS Code prompt files behind GitHub Copilot have no
`$ARGUMENTS` at all (their documented mechanism is the soft `${input:variableName}`, which the model is
asked to prompt for). A human typing `/sdd-specify <feature>` on those three hosts had the argument
silently dropped, and a prompt that reads `$ARGUMENTS` is not the prompt anyone wrote. The field was
decoration: the same class of defect as a gate chain that resolves over an empty control set
(`76278cf`), and it survived because the matrix *looked* like it already handled it.

Fixed, with the evidence kept where a reader can check it:

- **One authored token, translated per host.** `ARGUMENT_PLACEHOLDER` is the single canonical block,
  and `renderCommandTemplate` renders each host's own form. A host whose documentation describes no
  placeholder at all (Cursor, Windsurf, Antigravity, and the refused Codex row) now receives a plain
  instruction instead of a token its engine would never expand.
- **Every row carries `argumentEvidence`**: the quoted mechanism plus the URL for a documented token
  (`VERIFIED: …`), or the URLs that were tried and failed for a row whose token is `null`. A test
  requires one or the other — a bare `null` is not allowed to exist without the URL that justifies it.
- **`maxChars` turns a prose claim into a checked invariant.** Windsurf and Antigravity document a
  12,000-character ceiling per workflow file. The installer measures every rendered artifact against
  it and a template over the limit is reported as a **failure with the number**, never truncated: a
  prompt cut in half is worse than a prompt that was not installed.
- **The negative is pinned too.** A test renders every template for every host and asserts that no
  artifact contains *another* host's placeholder, which is what would have caught the original defect.
- **`argument-hint` ships in all 22 templates**, the composer hint both Claude Code and the VS Code
  prompt files document, so the human sees what to type instead of guessing.

`open-sdd templates` prints, per host, the directory, the invocation, the argument token and the
documented limit — so the matrix that used to be an internal table is now the thing a user reads.

### G-35 — PARTLY RESOLVED: the new hosts' skills install through ONE shared neutral tree, and the rest is named

Paper: §6.4 / Table 4 (agent-agnostic installation). Eleven hosts gained a verified prompt-command
convention (Factory Droid, Roo Code, Kilo Code, JetBrains Junie, MiMoCode, iFlow CLI, ZCode, Augment
Code, Trae, Qoder, CodeBuddy), each one read from the vendor's own documentation — or, for ZCode, from
the vendor's own resolver, and that row says SOURCE-VERIFIED instead of pretending the docs state it.
Every row carries its URL in `argumentEvidence` and `evidence`, and `open-sdd templates --json` prints
them. Fifteen hosts gained a verified **MCP** registration, and six of them forced a shape of their own
rather than a plausible neighbour: Kilo Code and MiMoCode use a top-level `mcp` with `type: "local"`
and `command` as an **array**, Crush uses `mcp` with a **string** command, ZCode nests the servers under
`mcp.servers`, Amp namespaces the key as `amp.mcpServers`, and CodeBuddy keeps `mcpServers` but requires
an explicit `type: "stdio"`. Kilo's documented file is JSONC, so a config that already holds comments is
**refused, not rewritten**: the merge reads strict JSON, and destroying someone's comments to gain a
server entry is not a trade this tool makes.

**The skills half is now resolved for ten of them, without writing sixteen trees.** The research
established that nearly every one of these hosts reads the cross-tool `.agents/skills/` convention
(Roo Code, Kilo Code, Junie, MiMoCode, Crush, Amp, Kimi Code, Warp, Devin, Factory Droid — each row's
`notes` names the page that says so), so the increment was **one neutral tree plus one manifest**
(`templates/agents/_shared/skills`, `manifests/agents-skills.json`, agent `agents-skills`) instead of a
hand-adapted copy per host. `integrate roo-code --write` now writes that host's own MCP file **and** the
21 skills into `.agents/skills/`, and the plan says *where* and *why* instead of announcing
`.roo/skills/` and writing somewhere else. Three further hosts (Goose, OpenHands, DeepSeek Harness)
read the same path but have no MCP row — their config is user-scoped or plugin-based — so they are
served by the installer directly: `open-sdd --agents-skills`, or `init --agent agents-skills`.

**Trae, Qoder, ZCode and CodeBuddy are covered too**, and by the same economy: none of them reads the
cross-tool path (Trae ships it off by default; the other three use their own), so each gets a manifest
of its own that still points at the **same neutral tree** — one manifest per host, never a tree per
host. `integrate trae --write` writes 21 skills into `.trae/skills/` and its MCP file; the same for
`.qoder/skills/`, `.zcode/skills/` (source-verified project path) and `.codebuddy/skills/`. A test
asserts both halves: each of those manifests resolves to `templates/agents/_shared/skills`, and **no
per-host tree exists for any of them**.

What remains declared is small and specific: a host whose instructions are **flat rule files**
rather than a `sdd-*/SKILL.md` tree needs a different render, and a host that documents no Agent
Skills at all gets none rather than an invented one (**iFlow CLI** is the case in the shipped matrix).
`--skills` on either still **declares the gap and exits 0** — it never attempts an install it cannot
complete, and never reports a failure the user cannot fix.

Seven hosts were investigated and get **no** MCP row at all (Augment Code, Amazon Q Developer,
Continue.dev, DeepSeek Harness, Goose, OpenHands, JetBrains AI Assistant): their file path or their
entry shape is not documented, or the config is user-scoped only. Fourteen were refused a commands row
for the same reason (no documented project-scoped commands directory). Amazon Q Developer is
additionally time-boxed — its IDE plugins are documented as end-of-support on 2027-04-30 with a
migration to Kiro — so it is a bridge and not a destination. In every case the URLs that failed are
recorded in the row or in the report, so a later increment starts from evidence instead of starting
over.

---

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
    CI workflow calls them: `.github/workflows/gates.yml` runs install, build, test, `gates chain`,
    `gates run --base`, `govern discipline`, `govern rigor`, delta validation,
    `brownfield contracts`, `assure claims --verify`, the audit bundle (with SARIF) and `floor status`
    — and still not `govern constitution --matrix`, nor `impactedPrinciples`. The four answers are
    available to a caller; nothing in the pipeline asks for them (G-16).
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
7. Do **not** cite `docs/MEASUREMENTS.md`'s 10/10 as field recall or precision: it is a synthetic
   self-consistency check on repositories this project wrote (G-29). The paper's prototype figures
   remain the prototype's (G-02).
8. Do **not** present an integration-matrix row as a supported MCP configuration when its `verified`
   field is `false` (G-24) — no shipped row is `false` today, and a row added later that is will print
   as **NO VERIFICADA** — nor the importers as lossless migrations (G-25). Do **not** call the Windows
   job a green portability proof: it is red on the current head and the commit gate has never run there
   (G-26). Each of those is a declared gap, and the CLI prints it as one.
9. Attribute the prompt-template workflow to **spec-kit** (`templates/commands/*.md`): what open-sdd
   contributes is the executable engine each prompt calls, not the way of working itself. Do not
   read `specBiography`'s `breathing` verdict as a quality judgement, and do not treat its thresholds
   (`STALE_CODE_COMMITS = 3`, `ALIVE_SPEC_SHARE = 1/3`) as calibrated — they are declared heuristics
   (G-32), and the on-repository `stale` figure moves with every commit.
10. Do **not** read `gitflow`'s "required" list as enforcement: no branch protection, required review or
    push block is installed, and only the level-B commit hook and the level-C PR workflow block (G-33).
