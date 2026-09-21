# Evolution plan — from a powerful engine to an unbeatable platform

**Scope.** This is a strategy document, not a specification. It states where the tool is strong,
where its ceiling is today, and the maximal plan to remove that ceiling: effortless adoption,
relentless helpfulness, machine-checkable standards, an honest AI conscience, and an integration
surface no competitor matches. Every workstream below names the modules it touches, the command a
human will type, and the acceptance criteria that decide whether it is done.

**How to read it.** §0 is the grounded diagnosis (with the evidence). §1 are the design tenets that
constrain every later decision. §2 is the plan at a glance. §3 details the nine workstreams. §4
sequences them. §5 states how success is *measured* — never asserted. §6 lists the anti-goals that
protect the project from its own ambition. §7 is the first executable slice.

**Honesty rule carried over from `docs/PAPER-ALIGNMENT.md`.** Nothing here is a promise that a
capability exists. A workstream is done when a command a reader can run produces the evidence.

---

## 0. Diagnosis

### 0.1 What is already strong (do not rebuild)

| Asset | Evidence in this repository |
|---|---|
| Deterministic, offline core | `doctor` reports "no model and no network required"; the CLI is pure Node |
| A real gate chain | 21 logical gates → C1–C7 + O1–O7, resolved per profile (`gateCatalog.ts`, `gates run`) |
| A constitution that governs specs | `constitution.ts`, `specConstitution.ts`, `govern constitution`, the ratchet |
| Brownfield as a first-class citizen | delta specs (ADSR), reverse constitution, impact/contracts/reuse/forecast |
| Honest degradation | C5 `mode=degraded`, C7 reported vacuous, `notChecked` travel explicitly |
| An assistant philosophy already written down | `assistants.ts`: never writes, never blocks, never repeats, never invents |
| A claims registry | `assure claims --verify`, 62 claims, 0 broken (after `8508152`) |
| A very wide integration surface | 26 verified host integrations (`HOST_INTEGRATIONS`), 31 command conventions (19 verified, 12 declared — `HOST_COMMAND_TEMPLATES`), 11 MCP tools/resources, 22 prompt templates |
| A bilingual experience layer | `tour`, `--lang`, `i18n.ts` (`es`, `en`) |
| Waivers with owner + expiry | `securityAllowlist.ts` |

The engine is not the problem. Adoption, enforcement coverage and the last mile are.

### 0.2 The three ceilings

1. **Standards exist as prose, not as checks.** `.sdd/settings/rules/` holds ~60 KB of genuine best
   practice across 15 documents (EARS, requirements review gate, design principles, task generation,
   steering, git). **No runtime code reads them** — a repository-wide grep finds only
   `plan/sharedRules.ts`, which *copies* them from the templates. Two of them even carry a
   "Mechanical Checks" section (`requirements-review-gate.md`, `design-review-gate.md`) that no code
   executes. `ears.ts` implements a partial catalogue
   (`NO_SHALL`, `NO_TEMPLATE_MATCH`, `MULTIPLE_TEMPLATES`, `COMPOUND_REQUIREMENT`, `MISSING_THEN`,
   `VAGUE_TERM`, `EMPTY_RESPONSE`) and `earsAssistant.ts` can rewrite a requirement; everything else
   is advice a human must remember to apply.
2. **The UX is powerful but wide, and it carries verified dead ends.** Each item below was
   reproduced against the current `dist`, not inferred:
   - **The install command the CLI tells users to run is a 404.** `npx open-sdd@latest` appears in
     runtime messages (`src/index.ts` ×7, `cli/commands/help.ts`, `doctor.ts`, `agents/registry.ts`,
     `cli/commands/init.ts`); the bare name `open-sdd` does not exist on npm (`E404`), and the real
     package is `@brujo2020/open-sdd`. Only `README.md`/`README.es.md` carry the correct scoped name,
     so the first command a user copies from the tool itself fails.
   - **`open-sdd help` is stale against `open-sdd --help`**: 8 command lines against 58. The index is
     hand-written instead of generated from the dispatch table, so `init --help`, `integrate --help`
     and `gates --help` are not command-specific help at all.
   - **An unknown command is a dead end**: `open-sdd statu` prints
     `Error: Unknown positional argument: statu`, exits 1, and offers no "did you mean `status`?" and
     no pointer to `--help`.
   - **`--lang` advertises 13 locales and ships 2.** `SUPPORTED_LOCALES = ['es','en']`, yet
     `--lang ja` is silently accepted with untranslated output — refuse-by-name is the project's own
     rule.
   - **The default locale is Spanish** (`DEFAULT_LOCALE = 'es'`) in an English-documented tool, and it
     reaches the `--json` envelope's `detail` field, so machine consumers parse a localized sentence.
   - **Two rendering defects**: `formatSectionTitle` (`cli/ui/colors.ts`) is missing its ESC bytes
     and prints a literal `[35m[1m== X ==[22m[39m` across two lines; and `NO_COLOR !== '1'`
     recognises only the literal `1`, so `NO_COLOR=true` still emits color (the NO_COLOR contract is
     "present and non-empty disables").
   - **Interactive prompts fail without a remedy**: three sites in `cli/ui/prompt.ts` throw the bare
     `TTY required for interactive prompts` instead of naming `--yes` / `--no-input`.
   - **A public comparison contradicts the registry**: `docs/COMPARE.md` still says "8 agents
     supported", while the compiled registry exposes 34 agent definitions and 31 command conventions
     (19 verified, 12 declared); the README says 35 / 32 (20 / 12). Three sources, three answers,
     none generated.
3. **The floor is not green everywhere.** The Windows suite is red at two named
   `coreCommandTemplates` assertions (G-26) and the hook step behind it is `skipped`, so the
   portable commit gate has never executed under git on Windows; no CI credential route has carried
   a version (G-28); ~13 `tool-maturity` and ~9 `brownfield-support` tasks sit in `[-]`; and with no
   model backend, intent alignment (C5/G15) is not measured (G-04).

### 0.3 What that means

The tool already *has* the ideas. What it lacks is (a) a machine-checkable standards layer that turns
its own rules into gates, (b) a last mile that makes adoption one command and every message a next
step, and (c) an optional AI layer that critiques and coaches without ever becoming a dependency.
Those three are the plan.

---

## 1. Design tenets

1. **Easy by default, resolutive always.** The shortest path (`npx` → one command) must reach a
   working, verified setup. Every message ends in a next step.
2. **No dead ends — a testable contract.** Every error and warning emits either a runnable `fix:`
   command or an explicit `question:` naming the missing datum. A test asserts this over every
   finding the engine can produce. A finding with neither is a bug.
3. **Never block without a remedy.** A blocking verdict carries at least one concrete remedy and one
   alternative. Blocking without a way forward trains people to disable gates.
4. **One source of truth, generated docs.** The agent registry generates the integration docs; the
   standards catalogue generates the `rules/*.md` prose. A number written by hand is a number that
   will drift (`COMPARE.md` is the proof).
5. **Deterministic core, AI as conscience.** The complete value of the tool must be reachable with
   no model and no network. AI *adds* judgment where judgment is required, degrades honestly, and
   never becomes load-bearing.
6. **Refuse by name, never silently.** An unsupported locale, an unverified host, a rule that cannot
   be checked: each is stated, with the list or the URL that justifies the refusal.
7. **Calibrate before you block.** A new check ships advisory, is measured against a labelled corpus
   (recall *and* false-positive rate), and only then may become blocking. This is the C4 lesson.
8. **Surpass, never copy.** Imitate the *flow* a competitor popularised and beat it on verification:
   the differentiator is never more prose, it is a check a reader can run.

---

## 2. The plan at a glance

| # | Workstream | Outcome | Primary surface | Depends on |
|---|---|---|---|---|
| W0 | **Green floor** | Every boundary the tool claims is green: Windows, publish, distribution, docs truth | CI, `package.json`, docs | — |
| W1 | **Zero-friction onboarding** | One command from `npx` to a verified, host-aware, undoable setup | `open-sdd up`, `init`, `doctor`, `install.sh` | W0 |
| W2 | **Standards engine** | The 15 rule documents become a machine-checkable catalogue wired into the gates | `open-sdd standards *`, `.sdd/settings/standards/**`, C1/C8 | W0 |
| W3 | **Requirements coach** | Best practice for requirements is stored, checked, and repaired with alternatives | `open-sdd requirements review/checklist/fix` | W2 |
| W4 | **Living constitution** | Principles carry checkers; compliance is a dashboard with a trend, not a claim | `govern constitution --compliance`, `specConstitution` | W2 |
| W5 | **AI conscience** | Optional, pluggable, injection-safe critique that coaches and abstains | `open-sdd review`, `ai.json`, C5 live | W2, W3 |
| W6 | **Integration everywhere** | Every host, inline diagnostics, PR comments, watch mode — from one registry | `up`, `integrate`, LSP, `action.yml` | W1 |
| W7 | **Scale & environment** | Monorepos, six language ecosystems, air-gapped installs, cached index | `survey`, `doctor --offline`, index cache | W1 |
| W8 | **Surpass the field** | A differentiated, *verified* SDD flow and a comparison that cannot go stale | `docs/COMPARE.md` (generated), guides | W2–W4 |

---

## 3. Workstreams

### W0 — Green floor (the credibility base)

**Problem.** A governance tool that cannot keep its own floor green loses the argument before it
starts. Today: Windows red (G-26), publish unproven (G-28), marketing docs stale, partial tasks.

**Design.**
- Fix the two Windows assertions in `coreCommandTemplates.test.ts` (path/format-sensitive: the
  suite is green on macOS on the same tree). Then let the `Execute the portable commit hook on
  Windows (G-26)` step actually run — that is the half of G-26 that was never about the suite.
- Close G-28 by exercising one credential route on purpose (`workflow_dispatch` with
  `dry_run=false` on a patch release), and document the manual OTP route as the fallback rather
  than the mechanism. **Publish with provenance** (`npm publish --provenance` over OIDC): the
  published 3.3.0 tarball has no `dist.attestations`, and provenance is the cheapest trust signal a
  governance tool can offer. Surface the attestation in `--version` and `doctor`.
- **Audit every install path the tool advertises.** `npx open-sdd@latest` is a 404 today (W1). The
  install command is generated from `package.json.name`, never typed by hand, and a test asserts no
  runtime message names an unpublishable package.
- Add a **docs-truth check** to the gate chain: every number the public docs assert about the
  repository (host count, template count, locale count, skills count) is generated from the registry
  or verified by a claim. `COMPARE.md` is the first customer.
- Finish `tool-maturity` task 11 (distribution: `npx`, provenance, container) and review the `[-]`
  backlog honestly: each partial task either finishes or is re-marked as declared-not-done.

**Acceptance.** `gates run` green on Linux **and** Windows; a release carried by CI; `assure claims
--verify` at 0 broken; no public doc contradicts the registry.

### W1 — Zero-friction onboarding and installation

**Problem.** Adoption requires knowing which of 35 agent ids, 22 templates, MCP flags and profiles
apply. `doctor` is excellent but is a *diagnosis*, not a *concierge*. `install.sh` and
`install-global.sh` exist but are a second, undocumented path.

**Design.**
- **`open-sdd up [target]`** — the single entry point. It detects the repository (git? language?
  existing `.sdd/`?) and the hosts actually present (`.claude/`, `.cursor/`, `.github/`, `.agents/`,
  `.codex/`…), proposes a plan, writes it, then *verifies its own write* with `doctor`, printing the
  next three commands. Idempotent, `--dry-run` first, `--yes` for CI.
- **Interactive when a TTY, flags when not.** A keyboard picker for host/locale/level; the same
  choices as flags; `--no-input` never hangs.
- **Undo and safety.** `open-sdd undo [--last|--list]` over the existing `backup.ts`; every write
  prints the exact path before writing; atomic writes; never overwrite a human-authored file
  (already the rule — make it visible).
- **Install trust.** Keep `npx` as the primary path, add checksum/provenance verification at install
  time, publish a one-line container run, and an air-gapped tarball with a verified digest. The
  install command is **single-sourced** from `package.json.name` so it can never point at the
  nonexistent unscoped `open-sdd`, and provenance (W0) is shown, not just claimed.
- **Honest locales.** Either ship the 13 advertised locales or make `--lang` **refuse an
  untranslated locale by name** with the list of translated ones. Silence is not a verdict. Make the
  default locale follow the environment (not a hardcoded `es`), and keep the `--json` envelope
  locale-independent so machine consumers never parse a translated sentence.
- **Help that answers the question asked.** `open-sdd help <command>` returns that command's own
  help; `init --help`, `doctor --help`, `integrate --help` work; the help index is generated from
  the same table that dispatches commands, so a routed command cannot be missing from help
  (today: 8 lines against `--help`'s 58). An unknown command suggests the nearest match
  (`did you mean 'status'?`) and points at `--help`.
- **A rendering and prompt contract.** `formatSectionTitle` emits real ANSI sequences or none; the
  `NO_COLOR` rule honours "present and non-empty"; every interactive prompt either works or fails
  naming `--yes` / `--no-input`. A test covers each.

**Acceptance.** On a fresh clone of a foreign repository: `npx @brujo2020/open-sdd@latest up -y`
reaches `doctor` 9 ok / 0 fail in under 60 s, and `undo` restores the previous state byte-for-byte.
A test asserts no routed command is absent from help.

### W2 — Standards engine: rules you can run

**Problem.** `.sdd/settings/rules/*.md` are best practice that nothing enforces. This is the single
highest-leverage gap and the heart of the user request: *find the good practices, store them, and
make them hold — warning when they do not, always with a solution.*

**Design.**
- **One machine-readable catalogue** at `.sdd/settings/standards/**` (one file per standard, or one
  `catalog.yaml`), and the `rules/*.md` prose **generated** from it (tenet 4). Each entry:

  ```yaml
  id: REQ-EARS-001
  title: One trigger template per requirement
  category: requirements        # requirements | design | tasks | steering | git | security | docs
  severity: error               # error | warning | info
  blocking: true                # only a calibrated subset may block
  applies_to: [requirements.md, delta.md]
  standard: EARS                # INCOSE | ISO-29148 | EARS | internal
  source: <URL or rule-file anchor>
  detect:
    kind: regex | structural | heuristic | question
    patterns: [...]
  message: ...
  remedy:
    auto_fixable: false
    templates: [...]
    alternatives: [...]
  evidence: <module/symbol that implements the check>
  calibrated: { corpus: <path>, recall: n/a, fpr: n/a }   # n/a until measured
  ```

- **Harvest, do not invent.** The seed catalogue is the mechanical content that already exists:
  the `ears.ts` diagnostics, the two "Mechanical Checks" sections, the EARS patterns in
  `ears-format.md`, the boundary/traceability rules in `requirements-review-gate.md`, and the
  evidence rule already enforced by C3.
- **Console.** `open-sdd standards list | show <id> | explain <id> | check [--json] |
  fix <id> [--apply]`. `check` runs every applicable standard over the declared artifacts and emits
  one finding per violation with `remedy` and `alternatives`.
- **Wire into the chain.** Extend C1 to run the requirements subset, and add **C8 Standards
  Conformance** (advisory first) so the rest is visible in `gates run`. A standard that cannot
  decide says `no verificado` — never `ok` (the `notChecked` discipline).
- **Overrides with a reason.** A repository may downgrade or disable a standard only by declaring
  it with a rationale and an owner, reusing the waiver shape (`.sdd/settings/standards.local.yaml`).
- **No dead ends, mechanically.** A test enumerates every finding the engine can emit and fails if
  any lacks `fix:` or `question:` (tenet 2).
- **Four checks the field proved are load-bearing** (designs in W8.1): the **drift sentinel**
  (row 1 — `REQ` id → globs + text hash, checked per commit, waivers with owner and expiry, wired
  into the staged-index hook at `spec-anchored`); **block-allocated, non-renumbering ids** with
  `ids audit` reporting `ID-MUTATED` / `ID-LOST` / `ID-REUSED` (row 4); the **reuse gate** — a
  symbol index and a `delta validate` that blocks a new symbol with no `reuse:` evidence (row 7);
  and **monotone convergence** over the existing `converge.ts` (row 6 — citations required, dedupe,
  `--require-progress`, `--verify <cmd>`).

**Acceptance.** `standards check` on this repository reports every violation with a remedy;
disabling a standard without a reason is an error; the `rules/*.md` files are byte-identical to
their generated form; the no-dead-ends test passes.

### W3 — Requirements coach

**Problem.** Requirements are where a project fails expensively. The tool checks EARS *shape*; it
does not check the quality characteristics that make a requirement usable, and it does not teach.

**Design.**
- **A full, checkable catalogue** beyond EARS: compound obligations (more than one `shall`),
  `and/or`, unbounded lists, unquantified adjectives and superlatives, missing units or thresholds,
  passive voice and missing actor, pronouns without an antecedent, negation without a positive
  statement, TBD/`{{…}}`, implementation leakage (technology in requirements), duplicated
  obligations, missing *unwanted-behaviour* coverage (no `IF`), missing acceptance criteria,
  non-numeric ids, glossary/term consistency, and traceability to tasks and tests.
- **Standards behind it:** EARS (six patterns), the INCOSE *Guide for Writing Requirements* quality
  characteristics, ISO/IEC 29148, RFC 2119/8174 keyword discipline (`shall/should/may`), and the
  "requirements smells" literature. Each check cites its standard and URL in the catalogue.
- **Non-functional requirements get a real shape:** the SEI quality-attribute scenario (source,
  stimulus, environment, artifact, response, response measure) and SLI/SLO/error-budget fields, so
  "fast" and "robust" become measurable or become an explicit question.
- **Commands.** `open-sdd requirements review <feature>` (findings + rewrites),
  `requirements checklist <feature>` (a checklist *executed*, not printed — "unit tests for
  English"), `requirements fix <feature> --apply <id>`, all with `--json`.
- **The rewrite playbook, per defect:** at least one canonical rewrite and one or two valid
  alternatives; when the honest answer is "the human must supply the datum" (the actor, the
  threshold, the trigger), the tool asks an explicit question instead of inventing a template with
  holes — the rule `assistants.ts` already enforces.
- **Checklist items are predicates, not prose** (W8.1 row 3): each item declares `cmd:` (exit code
  and digest), `artifact:` (file#line/hash) or `trace:` (REQ→task); `checklist verify <feature>`
  runs them and a `[x]` without a stored digest fails the commit gate, reusing C3's evidence store.
- **Traceability is part of quality.** A requirement with no task and no verification is a finding;
  the delta/evidence machinery already supplies the other end of the link.
- **A one-page review surface** (W8.1 row 8): `review <feature> --base <ref>` renders ADDED/MODIFIED/
  REMOVED requirements as word-level diffs, each row carrying its tasks, the tests that would fail if
  it changed (`brownfield contracts`) and a risk score, exiting 1 on unapproved requirement changes —
  because reviewing markdown is not reviewing code.

**Acceptance.** Against a labelled corpus of requirements with known defects (this corpus also
closes G-03 for requirements): recall and false-positive rate are measured and published in
`docs/MEASUREMENTS.md`; every finding has a remedy or a question; a human can take a vague
requirement to a checked one without leaving the terminal.

### W4 — The living constitution

**Problem.** The constitution is the authority every blocking verdict cites, but its principles are
prose; compliance is asserted by a report rather than demonstrated per principle.

**Design.**
- **Principles may carry a checker.** A principle in `constitution.md` declares either
  `check: <standard-id>` / `checker: <symbol>` or an explicit `advisory: <reason>`. A principle that
  is neither checked nor explicitly advisory is a finding — it must not be counted as compliant by
  silence.
- **`govern constitution --compliance`** reports principle → artifacts → evidence → status
  (compliant / violated / advisory / unverified) with the trend from the existing ratchet
  (`.sdd/state/adhesion.json`).
- **Amendments from reality.** Repeated violations of the same principle become a drafted
  amendment with the offending evidence attached (`constitutionAdvice.ts` already detects
  amendment-aged and evidence-expired); a human ratifies with `--by` and a rationale (already
  required).
- **The interview is the front door.** `brownfield constitution --draft` plus the interview flow
  already plan questions; add "adoption plan" output: what changes in the repository if this
  principle comes into force, and in what order.

**Acceptance.** On this repository every principle is either checked or explicitly advisory; the
compliance dashboard shows a trend; a principle cannot be silently counted as satisfied.

### W5 — AI conscience (optional, honest, pluggable)

**Problem.** C5/intent alignment degrades because no model backend ships, and the AI-specific risks
(sycophancy, hallucinated citations, prompt injection through spec content) are exactly the risks a
governance tool must model before adopting one.

**Design.**
- **Backends behind one interface, `none` by default:** local (Ollama), OpenAI-compatible, and any
  future provider, configured in `.sdd/settings/ai.json` with `enabled`, `provider`, `model`,
  `maxTokens`, `allowNetwork`. No provider is a hard dependency.
- **C5 becomes real only when configured** and reports `mode=live`. With two independent providers
  the judge-independence check (I4) becomes satisfiable; with one it stays `advisory` — as it does
  today.
- **`open-sdd review <feature>` / `open-sdd coach <feature>`:** critique the artifacts, emit findings
  with severity, remedy, alternatives and a confidence, and **never block by default**. Using a
  model judgment as evidence requires an I6 receipt (the receipt machinery exists).
- **Adversarial, not agreeable.** The reviewer prompt is adversarial and the review is independent
  of the author (`sdd-review` already defines the protocol). Consensus is not evidence.
- **Injection safety.** Spec content is untrusted data: it is delimited, never followed as
  instructions, and any instruction-like content found in a spec is itself a finding. The tool
  reports the attempt instead of obeying it.
- **Abstain when unsure.** Below a confidence threshold the model's output is a *question*, not a
  verdict; the tool never fabricates a citation — a claim without a resolvable source is dropped.
- **Budget and privacy.** Token budget per run, `--dry-run`, and a clear statement of what leaves
  the machine before anything does.

**Acceptance.** With no backend configured, every command behaves exactly as today (deterministic,
offline). With a backend configured, C5 reports `mode=live`, the reviewer is independent, and an
injected instruction in a requirement is reported rather than executed.

### W6 — Integration everywhere

**Problem.** The integration surface is already very wide — 31 command conventions and 26 verified
host integrations — but breadth is not the moat: the field's leading toolkit lists 41 integration
rows (https://raw.githubusercontent.com/github/spec-kit/main/docs/reference/integrations.md). Our
edge is that every row is either verified with the URL it was read from or refused by name.
Discovery is still manual, and findings live in the terminal instead of where the code lives.

**Design.**
- **One registry generates every surface:** the agent registry (`agents/registry.ts`) renders the
  matrices, the per-host docs, the help index and `integrate --list`, so no hand-written count can
  drift (this alone fixes `COMPARE.md`).
- **`open-sdd up`** (W1) wires the detected hosts, the commit hook and the CI template.
- **Findings where the work happens:** SARIF already exists; add an **LSP diagnostics server** so
  standards/gate findings appear inline in VS Code and JetBrains, each with a quick-fix mapped to
  the remedy.
- **PR as a coach, not a wall:** the GitHub Action (and a GitLab template) comments the findings with
  their remedies and alternatives; the blocking subset stays small and calibrated.
- **`open-sdd watch`** re-runs the relevant checks on change, in the background, without noise.
- **MCP parity:** expose standards and the requirements coach as MCP tools/resources so any host that
  speaks MCP gets the coach without installing anything else.
- **One editable rule source, projected** (W8.1 row 9): `integrate <host> --project-steering --write`
  generates the host rule file from the constitution + steering with an embedded
  `<!-- sdd-projection: sha256=… -->`; `doctor` fails on a stale or hand-edited projection and
  `--fix` regenerates it, so `AGENTS.md`, `CLAUDE.md` and the rest cannot become a second authority.
- **A supply chain with evidence** (W8.1 row 10): `ext add --sha256`, a
  `.sdd/extensions.lock.json` verified by `ext verify`, hooks declaring `command`/`timeout`/`sandbox`
  and running in declared order, `unsafe: true` refused under `--frozen`, and per-hook firing counts
  so "installed" is never reported as "working".

**Acceptance.** From a clean checkout, `up` wires the detected host, the hook and CI; a violation
appears inline in an editor with an applicable fix; a PR receives a comment naming the remedy.

### W7 — Scale and environment

**Problem.** Discovery is Node-only (G-21), there is no cached index, and air-gapped adoption is
asserted rather than exercised.

**Design.**
- **Multi-ecosystem discovery:** Maven, Gradle, Go, Rust, Python and .NET module detection
  (`tool-maturity` task 5), each with the module-responsibility map and reuse search working over it.
- **A cached structural index** keyed to HEAD (the paper's idea, honestly implemented and measured),
  so repeated checks are cheap on large repositories — with a published latency measurement, not a
  borrowed one.
- **Offline and air-gapped as a tested path:** a tarball with a digest, a `doctor --offline`
  guarantee, and no network call anywhere in the deterministic core (already true — make it a test).
- **Performance budget:** every command that grows with repository size declares its budget and is
  measured in `bench/`.
- **Pay the context tax visibly** (W8.1 row 5): `init --context-report` measures what the install
  writes, prints per-host and total token estimates against the host's documented budget, and writes
  `.sdd/settings/context-budget.json`; `doctor --context` fails above the ceiling and offers
  `--lazy` (one-line stubs expanded on demand) or `--install a,b,c`. The field measured 18.6k
  tokens/session for an unconditionally installed surface — the number is the argument for lazy
  defaults.

**Acceptance.** The survey detects modules in all six ecosystems on fixtures; a cold vs warm index
measurement is published; an air-gapped install reaches a green `doctor` with the network disabled.

### W8 — Surpassing the field (imitate the flow, beat it on verification)

**Problem.** The comparison document is stale and the differentiation is under-argued. The field's
popular toolkit proved that a clean prompt-driven flow wins adoption; it did not prove that the
resulting specs are *good*.

**Design — the differentiation thesis.** Copy nothing; beat these four things:
1. **Verification over generation.** Where the field *writes* a spec and moves on, this tool
   *verifies* it against a machine-checkable standards catalogue and repairs it with alternatives
   (W2/W3). A spec that cannot be checked is not done.
2. **Authority over convention.** Where the field keeps a project "constitution" as context, here
   the constitution is the *authority* a blocking verdict cites, with per-principle evidence and a
   trend (W4).
3. **Brownfield as the default.** Where the field assumes an empty repository, here the unit of
   specification is the delta against code that already exists, with a regression oracle (already
   shipped) — the reality of every enterprise.
4. **Honesty as a feature.** A claims registry, `notChecked`, `mode=degraded`, refuse-by-name, and a
   report that withdraws a number whose instrument cannot be named. No competitor ships this, and it
   is the reason a regulated buyer can trust the rest.
- **Make the comparison generated and verifiable.** `docs/COMPARE.md` is rewritten from the registry
  and from runnable checks; every claim about a competitor carries a URL and a date; every claim
  about this tool is a command. The marketing page becomes a measurable one.

**Acceptance.** `COMPARE.md` is generated, cites sources, and contains no hand-written count; a test
fails if a generated block drifts from its source.

#### W8.1 — What the field proved, and the improved design

External research (2026-09-21, primary sources; `web_search` was unavailable, so everything below was
fetched directly — raw templates, GitHub API issue search, vendor docs). github/spec-kit is the
reference: **138,177★, 12,381 forks, 300 open issues, MIT, Python, created 2025-08-21**
(https://api.github.com/repos/github/spec-kit). It earned the adoption; its own issues and its own
docs name the failures. Each row is an idea to imitate and beat, not to copy.

| # | Idea to imitate (source) | The failure it fixes | The improved design here |
|---|---|---|---|
| 1 | A constitution every command analyses against (`/constitution`) | spec-kit's docs admit spec-anchoring is a *convention*, not a mechanism; issue **#1191** (115 reactions) is the top unmet need — specs are write-once | **Drift sentinel in the floor**: `drift bind <feature>` records each `REQ` id → claimed globs + sha256 of its text; `drift check --since <ref>` exits 1 on a commit touching uncovered paths; `drift waive` writes a waiver with owner + expiry; the staged-index hook runs it at `spec-anchored`. `driftDetected` already exists in `auditEngine` — this makes it per-commit and blocking |
| 2 | Size the process to the change (BMAD's "the process sizes itself") | "Sledgehammer to crack a nut": `/clarify`, `/checklist`, `/analyze` are optional with no rule for when they are required | **`open-sdd route "<intent>"`**: survey + reuse + impact forecast returns **S/M/L** with its evidence (files likely touched, dependents, public-API deltas, coverage), fixes the artifact set and rigor in `.sdd/settings/route.json`, and `delta init` refuses extra ceremony for S unless `--override` (recorded, visible in `status`) |
| 3 | "Unit tests for English" (`/checklist`) | spec-kit's items are unverifiable prose and `/implement` only counts unchecked boxes; Fowler: no guarantee they are respected | **Executable checklist predicates**: every item in `checklist.md` declares `cmd:` (exit code + digest), `artifact:` (file#line/hash) or `trace:` (REQ→task); `checklist verify <feature>` runs them, a `[x]` without a stored digest fails the commit gate, and C3's evidence store is reused, not duplicated |
| 4 | Stable ids with traceability | **#4065**: inserting an `FR` silently invalidates every citation ("nothing errors — the references just quietly mean something else") | **Block-allocated, non-renumbering ids** (`REQ-AUTH-010…019`); `ids audit --base <ref>` fails `ID-MUTATED` / `ID-LOST` / `ID-REUSED` with git evidence, as a PR check |
| 5 | Measure the context the tool installs | **#1401**: installed command surface measured at **18.6k tokens/session** (~93 % of Cursor's default chat) | **`init --context-report`** measures the generated files and prints per-host + total token estimates against the host's documented budget, writes `context-budget.json`; `doctor --context` fails above the ceiling and suggests `--lazy` (one-line stubs expanded by `prompt <workflow>`) or `--install a,b,c` |
| 6 | Post-implementation convergence (`/converge`) | Append-only LLM gap-hunting with no dedupe, no progress requirement, no budget; **#4164** reports clean while the line was never in context | **Monotone convergence**: a finding without `file:line` + source-ref is dropped (and counted); dedupe by (source-ref, gap-type, evidence-hash); `--require-progress` fails when `uncovered(n) ≥ uncovered(n−1)`; `--verify <cmd>` refuses "converged" while the external suite is red; a `convergence.json` series makes the trend auditable |
| 7 | Reuse before writing (Fowler's agent regenerated existing classes; #1436 lists it as a must) | Duplication created by agents that never looked | **Reuse as a blocking gate**: `brownfield reuse --index` builds a symbol index (name, signature, path, hash); `delta validate` blocks a newly declared symbol without `reuse:` evidence, or flags near-identical signatures as candidates; the hook can run it over the staged index |
| 8 | Archive the change into the living spec (OpenSpec's `/opsx:archive`) | Spec trees accumulate dead branches instead of staying current | **`delta merge --archive`**: fold the delta into the base and move the change to `.sdd/specs/<f>/archive/<date>/`; add `review <feature> --base <ref>` — one diff-shaped page with ADDED/MODIFIED/REMOVED requirements, their tasks, the tests that would fail (from `brownfield contracts`) and a risk score, exiting 1 on unapproved requirement changes |
| 9 | One rule source per project | **#609** ("CLAUDE.md vs constitution.md", 24👍, open+stale), **#2362**, **#2681**: governance duplicated across constitution, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, copilot-instructions | **Generated host projections**: `integrate <host> --project-steering --write` generates the host rule file **from** the constitution + steering with an embedded `<!-- sdd-projection: sha256=… -->`; `doctor` fails on a stale or hand-edited projection and `--fix` regenerates it. Exactly one editable source |
| 10 | Extensions and hooks | spec-kit's docs admit preset `update` has no rollback, hooks ignore `priority`, `auto_execute_hooks` is not consulted, and workflow `shell` steps interpolate agent output with no sandbox; **#4200** measured extension commands invoked **0 of 30** runs | **Supply chain with evidence**: `ext add --sha256` verifies before unpack; `.sdd/extensions.lock.json` stores per-artifact hashes and `ext verify` recomputes them; hooks declare `command`, `timeout`, `sandbox: none|read-only` and run in declared order; anything interpolating untrusted values is `unsafe: true` and refused under `--frozen`; per-hook firing counts are reported, so "installed" ≠ "working" |

Adjacent tools, one idea each: **Kiro** — event-driven hooks (enforce steering at write time, not read
time); **cc-sdd** — `_Boundary:_`/`_Depends:_` tasks plus a fresh implementer + independent reviewer
(our `waves`/`scheduler.ts` already plans this; executing it closes G-10); **Tessl** —
`GENERATED FROM SPEC — DO NOT EDIT` banners that make the spec's authority machine-checkable;
**OpenSpec** — archive-as-merge-back (row 8); **BMAD** — the explicit planning-path chooser (row 2);
**Agent OS / Cursor rules** — path/glob-scoped rule loading, the cheapest known fix for context tax
(rows 5 and 9). Copilot Workspace's current model could not be verified (its docs page 404s) and is
deliberately not characterised.

#### W8.2 — Measured anti-evidence (why "calibrate before blocking" is earned)

- **Scott Logic** measured spec-kit at roughly **10× slowdown**: 33 m 30 s + 23 m 30 s of agent time
  and 2,577 + 2,262 lines of markdown for 689 + ~300 LOC, with 3.5 h + ~2 h of review and one bug
  shipped — against ~1,000 LOC in 8 min with 15 min of review and no bugs conventionally
  (https://blog.scottlogic.com/2025/11/26/putting-spec-kit-through-its-paces-radical-idea-or-reinvented-waterfall.html).
- A brownfield audit reported a green pipeline while external CI had **12/20 failing**, and 440
  claimed tests against **55** real (https://hubreb.github.io/blog/spec-kit-brownfield-applicability).
- The top "ceremony" complaint is the volume itself: **#75**, "creates the illusion of work,
  generating a bunch of text" (24 reactions).
- Artifact-level traceability detected **0 %** of hallucinations in the cited study; cited,
  per-line requirements reached 86–88 % at 0 % FPR (https://arxiv.org/abs/2606.30689) — which is the
  argument for rows 3 and 4 above, and for evidence predicates over prose.

Read together with our own C4 lesson, this is why **every new check ships advisory and blocking is
earned by a measured corpus** (tenet 7), and why the plan budgets artifacts per change class rather
than maximising them.

---

## 4. Sequencing

| Phase | Weeks | Ships | Why this order |
|---|---|---|---|
| **P0 — Credibility** | 1–2 | W0 (+ the W1 no-dead-ends quick wins: `help <cmd>`, `--lang` refusal, `COMPARE.md`) | You cannot ask for trust while your own floor is red |
| **P1 — Effortless** | 3–6 | W1 + W2 MVP (requirements subset in C1, `standards check`) | Adoption and enforcement are the two highest-leverage changes |
| **P2 — Quality** | 7–12 | W3 + W4 + the C8 advisory gate + the labelled corpus | Requirements quality is where the value compounds; the corpus makes blocking honest |
| **P3 — Judgment** | 13–18 | W5 + W6 (LSP, PR coach, watch) | AI and integrations multiply a base that is already correct |
| **P4 — Scale** | Q2 | W7 + W8 + 13 locales + cached index + full publish automation | Breadth last, so it does not mask an unfinished core |

Each phase ends with its acceptance criteria demonstrated in CI and recorded in
`docs/MEASUREMENTS.md` or `PAPER-ALIGNMENT.md` — a phase is not "done" because the code exists.

---

## 5. How success is measured (never asserted)

| Metric | Definition | Target | Instrument |
|---|---|---|---|
| **Time to first value** | Fresh repository → `doctor` 9 ok / 0 fail | < 60 s | CI fixture, timed |
| **Dead ends** | Findings with neither `fix:` nor `question:` | 0 | A test over the emitted-finding catalogue |
| **Enforcement coverage** | Rule statements that are machine-checked or explicitly advisory | 100 % of the catalogue | `standards list --json` |
| **Requirements recall / FPR** | Detection over the labelled defect corpus | published, then improve | `bench/` + `docs/MEASUREMENTS.md` |
| **Remedy usefulness** | Findings whose suggested remedy resolved the issue (opt-in telemetry) | measured, target set after baseline | opt-in, aggregated |
| **Floor green** | Linux + Windows + publish workflows | all green | CI |
| **Host coverage** | Verified / refused-by-name / declared, with URLs | no silent host | `integrate --list`, a test |
| **Honesty** | `assure claims --verify` | 0 broken | `assure claims` |
| **Drift coverage** | Commits touching a path no spec change or waiver covers | measured, then driven down | `drift check --since` |
| **Context tax** | Tokens the install writes, per host and total | under the declared budget | `init --context-report` |
| **Reuse gate** | New symbols blocked or flagged as near-duplicates | measured per change | `reuse --index`, `delta validate` |
| **Convergence monotonicity** | Rounds where `uncovered(n) ≥ uncovered(n−1)` | 0 | `convergence.json` |
| **Cost** | Tokens per AI review, when enabled | budget-enforced | `telemetry.ts` |

The rule from the paper's own discipline applies to every row: a metric whose instrument cannot be
named is not reported as a number.

---

## 6. Anti-goals and risks

- **Ceremony.** More checks is not more quality. Every standard ships advisory, is calibrated, and
  must justify its false-positive cost before it may block. This is measured, not cautious: the
  field's leading toolkit was clocked at roughly **10× slowdown** with thousands of lines of markdown
  for hundreds of lines of code, and one brownfield audit reported a green pipeline over **12/20
  failing** external CI checks (W8.2). Artifacts are budgeted per change class (W8.1 row 2).
- **AI noise.** Suggestions appear only on a real finding, once per run (the `assistants.ts` ledger),
  ordered by severity and by what unblocks the next phase — never a stream of opinions.
- **Model dependency.** If it needs a model to be useful, it is broken. The deterministic core stays
  complete; AI is opt-in and degrades honestly.
- **Sycophancy.** An agreeable reviewer is worse than none: the reviewer is adversarial, independent
  of the author, and must be able to say "I cannot decide".
- **Prompt injection.** Spec content is data; an instruction inside a spec is a finding, not a
  command.
- **Stale docs.** Any number about the repository is generated or claim-verified. This plan's own
  numbers are dated and sourced.
- **Scope creep.** The `[-]` backlog is closed honestly — finished, or re-declared as not done —
  before new workstreams open.

---

## 7. First executable slice (next two weeks)

1. **Day 1 — remove the dead ends that already exist** (all reproduced today):
   - the install command in every runtime message (`npx open-sdd@latest` → the real
     `@brujo2020/open-sdd`) single-sourced from `package.json`;
   - `open-sdd help <command>` returns command-specific help generated from the dispatch table
     (`init --help`, `integrate --help`, `gates --help`), and an unknown command suggests the
     nearest match — no more `Error: Unknown positional argument: statu` with no way forward;
   - `--lang` refuses an untranslated locale by name and lists `es`, `en`; the default locale stops
     being hardcoded `es`; the `--json` envelope stops carrying localized text in `detail`;
   - `formatSectionTitle` emits real ANSI sequences, `NO_COLOR` honours "present and non-empty",
     and the three TTY prompts name `--yes` / `--no-input`;
   - `docs/COMPARE.md` regenerated from the registry (34 definitions / 31 conventions, not "8 agents").
   *Acceptance:* one test asserts every routed command has help; one asserts every emitted finding
   has a `fix:` or a `question:`; one asserts no runtime message names an unpublishable package.
2. **Days 2–3 — W0.** The two Windows assertions fixed; the G-26 hook step runs; a patch release
   carried by a CI credential route (or the manual route declared as the mechanism).
3. **Days 4–7 — W2 MVP.** The standards catalogue seeded from `ears.ts` + the three Mechanical
   Checks sections + `ears-format.md`; `standards list|show|check`; the requirements subset wired
   into C1; every finding carries a remedy; the no-dead-ends test.
4. **Days 8–10 — W3 MVP.** Vague-term, compound-obligation, missing-unit, passive-voice and
   no-`IF` checks with rewrites; `requirements review <feature>`.
5. **Days 11–12 — W1 MVP.** `open-sdd up [--dry-run|--write|--yes]` with self-verification and
   `undo`; the host auto-detection over the existing registry.
6. **Days 13–14 — close the loop.** Record what shipped in `docs/MEASUREMENTS.md`; update
   `PAPER-ALIGNMENT.md` gaps touched (G-26/G-28 and the new C8); keep `assure claims` at 0 broken.

**Decisions requested before P1 begins**

- **Locales:** implement the 13 advertised, or declare `es`/`en` and refuse the rest by name?
  (Recommended: declare now, refuse by name, implement on demand — honesty over breadth.)
- **First AI backend:** local Ollama (privacy, offline) or an OpenAI-compatible endpoint (quality)?
  (Recommended: Ollama first, so the default stays network-free.)
- **New standards:** advisory-by-default until calibrated, or blocking where the tool is already
  confident? (Recommended: advisory-by-default; promote after the corpus.)
- **Formalization:** turn W1–W4 into SDD specs under `.sdd/specs/` before implementing, or execute
  the first slice directly and spec the rest? (Recommended: spec W2/W3 first — they are the ones
  that change the gate chain.)
