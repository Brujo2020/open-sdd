# Changelog

All notable changes to this project will be documented in this file.

**Release Notes**: [English](docs/RELEASE_NOTES/RELEASE_NOTES_en.md)

## [3.4.0] — 2026-09-21

### The requirements coach: 32 deterministic checks, and it never certifies

A spec is now adjudicated before anyone claims a review gate. Thirty-two checks across eight families
(EARS, ambiguity, singularity, verifiability, set-level, traceability, NFR, AI-specific) run
deterministically over `requirements.md`, and **every finding carries a position, a basis and a graded
remedy or an explicit question** — never a bare complaint. `open-sdd requirements review <feature>`
prints it; `--json` gives the machine envelope, and `requirements fix` applies only the rewrites that
are mechanical.

The two checks a hostile test horde proved were missing now exist: **`AMB-006`** (a superlative with
no baseline — "the highest resolution" — answered with a question, not an invented rewrite) and the
**slash chain of `AMB-009`**. The chain mattered: on `read/write/delete` the old anti-duplication guard
suppressed the finding entirely, so the defect vanished in silence.

Nothing here certifies. The output states that it reports checks and adjudication, not correctness; a
check that cannot inspect its link source is reported as **skipped**, never as a pass; and
instruction-shaped text inside a requirement is **escalated to a human**, never obeyed.

### The standards engine: a catalogue that renders itself and never blocks on faith

Sixteen machine-checkable standards ship in `.sdd/settings/standards/`, each declaring its severity,
the artifacts it applies to, a detection rule, and a remedy. `open-sdd standards list | show | explain
| check | fix` reads them. C8 Standards Conformance joins the chain as a **declared extension**
(`imposes: []`, advisory), and the rules under `.sdd/settings/rules/` are generated from the catalogue
by `injectRules`, which replaces only the marked blocks: the hand-written prose survives, and drift
means a **missing or edited block**, not a file that is not byte-identical to the render.

**Nothing blocks on faith.** Every entry is advisory until a corpus measures its precision, and
`isBlocking` requires a calibrated corpus before it can fail a build.

### Reversibility, stable identifiers and the console contract

`open-sdd uninstall` plans what it would undo from a receipt, and `restore --from` applies it. It
**refuses** to delete a file a human edited and a merged external config — un-merging is not deleting —
and `.sdd/` goes only with an explicit `--purge-sdd`. Identifiers are allocated in blocks and audited
against a real revision: `open-sdd brownfield ids <feature> --base <ref>` reports `ID-MUTATED` and
`ID-LOST` instead of letting an id quietly stop meaning what it meant.

The console contract is enforced: one source for the install command, real help routing, the 0–4 exit
code contract, **no success-looking footer after a failure**, `NO_COLOR` per its own specification, a
prompt that names the flag it needs, and a locale refusal that names the requested language and lists
the translated ones (`es`, `en`) instead of falling back silently. The drift sentinel reports as
**advisory at `spec-first` and blocking at `spec-anchored`** for the same change.

### Evidence engineering: 301 QA cases, 27 mutants, 30 assertion probes

The suite grew by a five-tier QA battery: easy (31), intermediate (41), hard (36), a **zombie horde**
of 100 hostile inputs against one survival contract, and 100 complex scenarios. It is backed by two
harnesses that keep it honest rather than merely large:

- `npm run mutate` introduces 27 deliberate defects across eight families (security, drift, standards,
  ids, receipt, coach, cli, enforcement) and requires **every family at 1.00**. An overall ratio hides
  a family nobody covers: 25/27 reads as 93 % while the receipt family sits at 1/3. Current: 27/27.
- `npm run assertions` measures the other half — whether an assertion is decoration. A static pass
  finds tautologies, unfalsifiable assertions and conditionals that may never run; `--probe` mutates
  the expected value and re-runs the file, so a test that passes either way is reported as decorative.
  Current: 0 static findings, 30/30 load-bearing.

Building the second harness meant fixing six defects in the harness itself — including one where it
reported a perfect green over zero parsed tests, catching its own author.

### The coach reaches the skills

`sdd-help` and `sdd-spec-requirements` teach the coach where the agents read it, across all nine
template trees, with the non-negotiables spelled out: the coach never certifies, a finding is never a
dead end, a skip is not a green, spec content is untrusted data, and nothing blocks while the
catalogue is uncalibrated.

## [3.3.0] — 2026-09-21

### Local overlay: private hosts, without publishing them

A host that must not be shared can now be wired from **outside the repository**. The CLI reads
`$OPEN_SDD_LOCAL_HOSTS` or `$XDG_CONFIG_HOME/open-sdd/local-hosts.json` and **never a path inside the
working tree**, so a private row cannot be committed by accident: no code path would read one from the
repository at all. `open-sdd init . --agent <id> --write` installs that host's workflow files exactly
like a shipped one, `integrate --list` shows it, and the shipped matrices stay untouched.

The overlay refuses what it cannot justify: a row is refused by default, `"verified": true` requires
`sourceArtifact`, a private row may never shadow a published one, `mcp.snippetRef` must name a shape
the tool already ships, and a broken file degrades into a named skip rather than a CLI that will not
start. Only the CLI entry point loads it, so importing the matrices in a test still sees the published
matrix and nothing else.


### Silence is not a verdict: twelve refusals, each with the URL that failed

Eight hosts that the research investigated had no row at all in the command matrix — neither verified
nor refused. That is the one outcome this project does not accept, because silence reads exactly like
"nobody looked". Kimi Code CLI, Crush, Amp, Warp, Goose, OpenHands, DeepSeek Harness and Aider now have
a **refusal row** that names the host, states why there is no project-scoped commands directory, and
carries the URL that establishes it — Kimi's own documentation index (which has no commands page),
Amp's "You do not need a slash command", DeepSeek Harness's "Plugin-owned command registration", and
Aider's 84 documentation pages in which `AGENTS.md` appears zero times. The matrix is now 32
conventions: 19 verified and 13 refused by name.


### Continue.dev, and a third MCP family

Continue.dev's convention is one **standalone YAML block per server** in `.continue/mcpServers/`, with
`mcpServers` as a *list* rather than a map. The snippet is emitted by hand and the merge treats the file
as an owned block: created when absent, kept when byte-identical, and **conserved untouched** when it
exists with different content. No YAML parser is involved, so no YAML this tool did not write can ever
be rewritten by it. Its prompts are **not** written to `.continue/prompts/`: that convention appears
zero times in the vendor's 153 documentation files, so the row refuses it by name even though the habit
is widespread — a plausible-looking path the host may never read is worse than an admitted gap.


### One shared skills tree instead of sixteen copies

Twenty-one skills now install **once**, from one neutral tree, into `.agents/skills/` — the cross-tool
path that Roo Code, Kilo Code, Junie, MiMoCode, Crush, Amp, Kimi Code, Warp, Devin and Factory Droid
each document reading (and that Goose, OpenHands and DeepSeek Harness read too). `integrate roo-code
--write` writes that host's own MCP file *and* the shared tree, and the plan says where and why instead
of announcing one directory and writing another. A host is mapped to that installer only when its own
row documents the path — enforced by a test — so Trae (whose `.agents/skills/` support is off by
default), Qoder, ZCode and CodeBuddy get a **manifest of their own that points at the same neutral
tree** — one manifest per host, never a tree per host — so all four install 21 skills into their own
different shape) and iFlow CLI (which documents no Agent Skills at all) remain declared rather than
written blind.


### Eleven more hosts, each one read from its own documentation

The 22 workflow templates no longer install for the eleven hosts this project started with. Each new
convention below was read from the vendor's own documentation (or, for ZCode, from the vendor's own
resolver, and the row says SOURCE-VERIFIED), and the row carries the URL it was checked against:

- **Factory Droid** — `.factory/commands/`, `$ARGUMENTS`.
- **Roo Code** — `.roo/commands/`; its `argument-hint` is display-only, so the input arrives as a
  plain instruction instead of a token the engine never expands.
- **Kilo Code** — `.kilo/commands/`; no placeholder documented.
- **JetBrains Junie** — `.junie/commands/`, and the installer **injects** the `allowPromptArgument:
  true` frontmatter key that the host requires before it will expose `$prompt` at all.
- **MiMoCode (Xiaomi)** — `.mimocode/commands/`, `$ARGUMENTS`.
- **iFlow CLI** — `.iflow/commands/`, `{{args}}`.
- **ZCode (Z.ai)** — `.zcode/commands/`, `$ARGUMENTS`; SOURCE-VERIFIED, because the documentation stops
  at "the project directory" and the path comes from the vendor's own command resolver.
- **Augment Code** — `.augment/commands/`, `$ARGUMENTS`.
- **Trae (ByteDance)** — `.trae/commands/`; no placeholder documented.
- **Qoder (Alibaba)** — `.qoder/commands/`; Qoder is the current name of Tongyi Lingma.
- **CodeBuddy (Tencent)** — `.codebuddy/commands/`, `$ARGUMENTS`.

### Twenty-six MCP registrations, each in its host's own shape

Fifteen hosts gained a **verified** MCP registration, and the matrix now holds twenty-six. Six of them do not use the `mcpServers` family — so the matrix writes each host's own shape instead of a plausible neighbour:

- `mcpServers` with a string `command` + `args` array: **Factory Droid** (`.factory/mcp.json`),
  **Roo Code** (`.roo/mcp.json`), **JetBrains Junie** (`.junie/mcp/mcp.json`), **iFlow CLI**
  (`.iflow/settings.json`), **Trae** (`.trae/mcp.json`), **Kimi Code CLI** (`.kimi-code/mcp.json`),
  **Warp** (`.warp/.mcp.json`), **Devin** (`.devin/mcp_config.json`), **Qoder** (`.mcp.json`).
- Top-level `mcp` with `type: "local"` and `command` as an **array**: **Kilo Code**
  (`.kilo/kilo.jsonc`) and **MiMoCode** (`.mimocode/mimocode.json`).
- Top-level `mcp` with a **string** `command`: **Crush** (`.crush.json`).
- Servers nested under `mcp.servers`: **ZCode** (`.zcode/config.json`).
- A namespaced key, `amp.mcpServers`: **Amp** (`.amp/settings.json`).
- `mcpServers` plus an explicit `type: "stdio"`: **CodeBuddy** (`.mcp.json`).

Kilo's documented file is JSONC, so a config that already contains comments is **refused rather than
rewritten** — a strict-JSON reader that silently dropped someone's comments to add a server would be
the same class of defect this tool exists to catch. Augment Code, Amazon Q Developer, Continue.dev,
DeepSeek Harness, Goose, OpenHands and the JetBrains AI Assistant were investigated and get **no** MCP
row: their file path or entry shape is not documented, or the config is user-scoped only, and the URLs
that failed are recorded in the report instead.

`open-sdd templates` now lists 31 conventions (19 verified, 12 refused) and `open-sdd --agent <id>`
accepts 34 agent definitions. Fourteen further hosts were investigated and are **not** given a
commands row, because no project-scoped commands directory is documented for them (Warp, Devin,
Replit, Firebase Studio, Aider, Crush, Amp, OpenHands, Goose, Kimi Code CLI, DeepSeek Harness,
JetBrains AI Assistant, Continue.dev, Amazon Q Developer) — their surface is skills and/or MCP, which
is the next increment and is declared in G-35 rather than half-shipped.

### The argument you type now actually arrives

*(This was prepared as 3.2.1 and never published: it ships inside 3.3.0.)*

- **The per-host argument token is translated instead of shipped verbatim.** Every prompt template was
  authored with `$ARGUMENTS` and installed unchanged, so Gemini CLI and Qwen Code — which substitute
  `{{args}}` — and GitHub Copilot — whose prompt files have no `$ARGUMENTS` at all and use the soft
  `${input:request}` the model is asked to prompt for — silently dropped the argument.
  `/sdd-specify my-feature` reached the body as a token nobody expands. The installer now renders each
  host's own form, and a host whose documentation describes no placeholder receives a plain
  instruction rather than a dead token.
- **A host's documented size limit is checked, not asserted.** Windsurf and Antigravity cap a workflow
  file at 12,000 characters; a template over the limit is reported as a failure **with the number** and
  is not written. Truncating a prompt would be worse than not installing it.
- **`argument-hint` ships in all 22 templates**, so Claude Code and the VS Code prompt files show what
  to type in the composer.
- **`open-sdd templates` prints the row that was internal until now**: directory, invocation, argument
  token and documented limit per host. `--json` carries the evidence URL behind each one.
- Upgrading refreshes the affected templates automatically: an installed template open-sdd generated
  and nobody edited is reported `update` and rewritten with the correct token; one a human edited is
  left untouched and named. Re-run `open-sdd init . --write` (or `open-sdd integrate <host> --write`)
  to pick this up.

## [3.2.0] — 2026-09-20

### The way of working: 22 prompt templates, installed by default

- **`open-sdd init <target> --write` installs 22 workflow templates into the host's own commands
  directory, and they are now the default path.** `/sdd-onboard`, `/sdd-constitution`,
  `/sdd-specify`, `/sdd-clarify`, `/sdd-plan`, `/sdd-tasks`, `/sdd-implement`, `/sdd-analyze`,
  `/sdd-checklist`, `/sdd-converge`, `/sdd-tasks-to-issues`, `/sdd-brownfield`, `/sdd-status`,
  `/sdd-contracts`, `/sdd-impact`, `/sdd-reuse`, `/sdd-gates`, `/sdd-audit`, `/sdd-import`,
  `/sdd-doctor`, `/sdd-tour` and `/sdd-release` are plain prompt files written where the host
  already reads them (`.claude/commands/`, `.cursor/commands/`, `.github/prompts/`,
  `.gemini/commands/`, `.opencode/commands/`). Each one points at the real engine
  (`open-sdd status --json`, `open-sdd delta validate <feature> --json`, …) instead of guessing, so
  the whole workflow runs with **no MCP server and no network**.
- **MCP is now opt-in.** `open-sdd init <target> --write --mcp` adds the host's MCP registration on
  top of the templates; without `--mcp`, no MCP configuration is touched. Some hosts do not
  implement MCP and some security policies block or allow-list it, so the default path had to stop
  depending on it. `open-sdd integrate <host> --write` remains the host-by-host equivalent.
- **The template install is idempotent and never overwrites your edits.** Every installed template
  carries a sha256 signature of the body it was generated from: a re-run refreshes an untouched
  template (`update`), leaves an edited one alone and says why (`keep`), and `--write` refuses to
  write into a host whose commands convention is not verified rather than inventing a path the host
  may never read.

### Brownfield convergence: what the specification asks and the code does not do

- **`open-sdd brownfield converge <feature>` measures the distance between the spec and the code
  instead of asserting it.** It reads `requirements.md`, `plan.md`/`design.md`, `tasks.md` and the
  delta, and reports six kinds of gap, each with machine-collected evidence: `missing` (a requirement
  no task implements, or a declared boundary that does not exist), `partial` (traced tasks that are
  not all complete, with the measured ratio), `contradicts` (a task citing an unknown requirement, or
  a constitutional pivot error), `unrequested` (a changed file exporting a symbol no spec token
  names), `unprotected` (a contract the delta declares that exists nowhere — a green test run cannot
  close this one) and `unbound` (a task marked `[x]` with no `_Evidence:`). A finding without
  evidence is discarded before it is printed, and the exit code is `1` when any gap is `high`.
- **`--write` appends the remaining work and nothing else.** Exactly one
  `## Phase N: Convergence` section goes to the bottom of `tasks.md`; existing tasks are never
  rewritten, renumbered or reordered, `requirements.md` and `plan.md` are never touched, and no
  application code is written. Re-running on the same tree does not append a gap twice.

### The constitution as the pivot: a natural-language interview and EARS

- **`open-sdd brownfield constitution --interview` is a conversation that does not ask what the code
  already answers.** It starts from the descriptive constitution — what the repository already
  demonstrates — and separates `decidedByEvidence` (the stack, the observed practices, the
  boundaries, the API surface, the established facts) from the questions only a person can answer:
  which observed principles to ratify, which practice the code does not yet show to adopt, and the
  normative decisions (API deprecation, regression floor, boundary crossing, sensitive data). With
  `--answers <path> --write` it writes a validated draft to `.sdd/steering/constitution.draft.md`
  and **never touches `constitution.md`**; only
  `open-sdd govern constitution --ratify --by "<name>" --rationale "<reason>"` puts it in force, so
  the authority is always a named person's decision.
- **`open-sdd brownfield specify <feature> "<description>"` derives EARS requirements from plain
  language**, and `open-sdd brownfield requirements <feature> [--suggest] [--apply <i>] [--write]`
  runs the EARS assistant over an existing `requirements.md`. Both use the same analyzer that
  validates the document, so the assistant and the gate cannot disagree.
- **`open-sdd brownfield clarify <feature>` asks the questions the analysis actually raised**, from
  the ambiguity codes and the unresolved delta markers rather than from a fixed script. The batch is
  capped (5 by default; when it is cut, `truncated`, `remaining` and the detail say so), and every
  answer rewrites only the affected line before the analysis is re-run to prove the ambiguity is
  gone: a response that does not remove the finding is reported open, never as fixed.

### Enforcement that fails closed, including the stop hook

- **`open-sdd integrate <host> --write` installs a `Stop` hook on the hosts whose blocking contract
  was verified against their own documentation (Claude Code, Codex CLI).** The hook runs the exact
  invocation the commit gate runs (`gates run C1 C2 C3 --staged --strict`), and an adapter maps both
  a failing gate (exit `1`) and a chain that could not run (exit `2`) to exit `2` — the code those
  hosts document as "block". Without that translation the raw argv would **fail open**: the check
  would run, see the failure, and the agent could still declare itself finished.
- **A host with no verified `Stop` mechanism is refused, not guessed at.** `integrate` reports
  `refused` with the reason and writes nothing for that host; this release does not ship a hook whose
  blocking behaviour was never confirmed.

### The celebration, when — and only when — it is earned

- **`open-sdd status --check` now prints a green feature block when three independent verdicts are
  all true at once:** the feature's requirements are EARS-conformant, its constitutional pivot was
  evaluated with no errors, and the gate chain the declared rigor level activates passed. Anything
  missing is `refused` with the missing datum named, and a real failure is reported `plain` — a check
  that did not run is never celebrated. The streak comes from the adhesion ratchet, not from a second
  count.
- **`open-sdd status --celebrations [--json]` reads the ledger of validations**
  (`.sdd/state/celebrations.json`), and the achievements shown are derived from events actually
  recorded there. An unreadable ledger is warned about and shown empty, never filled in.

### The living spec and its biography

- **`open-sdd biography <feature>` turns a specification's git history into its biography:** when it
  was born and when it last moved, one event per changed artifact with the lines added and removed,
  the spec's commits against the code's, the delta entries (amendments) that shaped it and the
  behaviour they replaced, who ratified the constitution it is read against, and the phases declared
  in `spec.json` over time. `--json` for scripts and `--limit N` for the event window.
- **The rhythm verdict is derived from measured numbers, never asserted.** `unknown`, `orphan`,
  `quiet`, `stale` and `alive` come from the commits and dates the repository actually has, and every
  rendering carries the sentence that activity is not quality: a spec that never changes can be
  correct, and one that changes daily can be a disaster.

### Progress and backup

- **`open-sdd progress` is an append-only ledger of milestones** (`.sdd/state/progress.json`), and
  `open-sdd progress record --kind <kind> --summary "<one line>" --score <0..100> --phase <1|2|3>
  [--evidence <path>]` appends one. The `delta` is computed against the previous entry and cannot be
  supplied by the caller; a flat day says *sin cambios* instead of dressing up as a rise; an empty,
  vague or multi-line summary is rejected because it would put a phrase where the fact belongs; and a
  corrupt ledger warns and starts a new series instead of inventing a history.
- **`open-sdd backup create|verify|restore` makes the governance state restorable.** `backup create`
  copies the whole `.sdd/` tree into a directory with a `manifest.json` and a sha256 per file;
  `backup verify <archive>` recomputes every hash and reports mismatches; `backup restore <archive>`
  is a dry run unless `--write`, and `--only <path>` restores a single file. Files shaped like
  credentials (`.env*`, `.npmrc`, `.netrc`, private keys), symlinks and `node_modules`/`dist`/`.git`
  are omitted and named in the manifest detail instead of being copied silently.

### Native GitFlow: the branch role decides the governance

- **`open-sdd gitflow [--level <level>] [--greenfield] [--json]` derives the branch's role from the
  branches that actually exist and says what that role requires before you ask.** The model is
  detected, not configured: `gitflow` only when `develop` and `main`/`master` coexist, `trunk` for a
  single non-role branch, and `none` with the reason otherwise. The role (`main`, `develop`,
  `feature`, `release`, `hotfix`, `other`) comes from the branch name, and the output names the
  artifacts the role owes, the gate chain for the declared rigor level, the next step, and —
  separately — what can actually block today (the commit hook, the pull-request workflow, the
  governance profiles) versus what is only advice.
- **It is a read-only report.** `gitflow` changes no branch, runs no gate chain, and never declares a
  branch protection it has not observed.

## [3.1.0] — 2026-09-20

### Added — one entry point, one dashboard, and the constitution as the pivot

- **`open-sdd brownfield bootstrap [target] [--focus "<texto>"] [--write] [--json]` — the single entry
  point for an existing repository.** `core/bootstrap.ts` composes the scanners that already existed
  (`scanProject`, `collectRepoFacts` + `buildDescriptiveConstitution`, `findReuseCandidates`) into one
  plan plus two artifacts that did not exist: the **module responsibility map**, with a decidable
  answer to "where does new code go?" (`answerCodePlacement`), and
  `.sdd/steering/codebase-intelligence.md` for agents — generated with a provenance marker and never
  overwriting a hand-authored file. This is our reading of spec-kit issue #1436's
  brownfield-bootstrap / module-map / knowledge-document concept, **reimplemented on our own engine**,
  not a port of their extension. Without `--write` it writes nothing; with `--write` it writes the
  intelligence document and generates the constitution only when it is missing.
- **`open-sdd status [feature] [--check] [--quiet] [--json]` — one dashboard for the whole state:**
  the constitution, every spec, the delta, the contract set, the constitutional alignment, the rigor
  level and the **next command to run**. `--check` appends the per-spec constitutional validation,
  `--quiet` collapses the panel to one line with the verdict in the exit code (the commit-time form),
  and `--json` emits the aggregate. `status` is a panel, not a wall.
- **The constitution is now the pivot of every spec, not a decorative document.**
  `core/specConstitution.ts` (`alignSpecWithConstitution`) compares a spec's requirements/plan/tasks
  and its brownfield delta with the constitution: a cited principle that is not in force is a
  **phantom authority** (`UNKNOWN_PRINCIPLE`, error), a spec that cites none leaves the pivot unused
  (`NO_PRINCIPLES_DECLARED`, warning, alignment 0), a requirement or delta entry that contradicts a
  `MUST` is `MUST_CONTRADICTED` / `TECH_LOCK_VIOLATION`, and the boundary, API-compatibility and
  regression-oracle rules are `BOUNDARY_VIOLATION` / `API_COMPAT_MISSING` / `ORACLE_MISSING`. When a
  rule cannot decide it says so in `detail` instead of emitting a finding — an `ok` over something not
  inspected is refused. `status --check` exits 1 only on error-severity findings. On this repository:
  alignment 100 %, 0 errors, 1 warning.
- **The `sdd-brownfield` skill — the fast-learning-curve artifact.** The 21st skill, shipped
  byte-identical for all 8 skills-based agents (168 `SKILL.md` templates in this repository, was 160):
  the five-step brownfield flow (reconocer → anclar → describir el cambio → comprobar → entregar), the
  **ADSR / EARS / EGTAV** mnemonics of the *Manual Maestro SDD v3.0*, the constitution-as-pivot
  explanation with this repository's real principle `C-API-COMPAT`, the cumulative rigor ladder, the
  reuse-first rule and the honesty rules (a green test run with a declared contract missing is not a
  pass). It complements `/sdd-getspecs` and `/sdd-steering`; it does not replace them. Paired with
  **[docs/guides/brownfield-quickstart.md](docs/guides/brownfield-quickstart.md)**, the 10-minute path
  with the FAQ and an honest "what it does not do yet" section.
- **Four new declared gaps and five new claims.** G-20 … G-23 record the real limits of the new
  surface: `bootstrap --write` writes two of the three artifacts its own plan announces; multi-module
  discovery is Node-only (no Maven/Gradle, Go, Rust or Python workspace discovery, so the spec-kit
  issue's language coverage is not matched — the concept is, the coverage is not); the module map and
  the constitution's boundary evidence use two different vocabularies; and `publicApiFiles` matches
  entry-point filenames instead of reading the manifest, which is why the compliance matrix reports
  50 % coverage on this repository. Claims CLM-058 … CLM-062 decide the new surface by exit code;
  registry result: 62 claims, 59 verified, 0 declared, 3 not measured, 0 broken, 0 outdated.

### Changed — the rigor levels are a cumulative ladder, and the default is the floor

- **The three SDD rigor levels (`tools/open-sdd/src/core/rigor.ts`) are now a cumulative ladder**
  whose default (`spec-first`, also what `.sdd/settings/rigor.json` declares in this repository) is
  deliberately fluid: 2 → 4 → 6 gates, and every level only **adds** demands and gates. `spec-first`
  now requires the constitution and the triad (requirements in checkable EARS form) — it previously
  only recommended them — adding nothing else: evidence, drift, contracts and regeneration stay
  `not-required`. `gatesActive` is `['C1','C2']` (was `['C1']`) and `missingArtifactPolicy` is
  `blocking` (was `advisory`). The maintainer's rationale: *por defecto que sea cumplir con los
  requerimientos y constitución bien hecha, y a medida que subo nivel se aumenten los gates*.
- **`spec-anchored` adds delta (brownfield), traceability, evidence and drift** and activates
  `['C1','C2','C3','C6']`; **`spec-as-source` adds contracts and regeneration** and activates
  `['C1','C2','C3','C4','C5','C6']`. No level removes a demand or a gate, and **C2 (secrets and
  destructive commands) is active at every level on purpose**: it is the hard subset that never
  self-authorizes, so lowering rigor must not make a committed credential acceptable.
- **The constitution is now `required: true, severity: 'blocking'` at all three levels**, greenfield
  and brownfield: a blocking verdict must cite an authority, so the default level cannot be lawless.
  What the levels differ in is everything above that floor (evidence binding, drift, contracts,
  regeneration), not whether authority exists. This is a **declared divergence** from the *Manual
  Maestro* §2.4 / reference-architecture reading that lets Spec-First pair with a constitution the
  level does not demand; recorded in `docs/PAPER-ALIGNMENT.md` (divergence 8) with its citation
  (CSDD §3.4, invariant I1).
- **The gate set is configurable and validated.** New API: `effectiveGates(level, override?)`,
  `validateGateOverride(ids)`, `RIGOR_LADDER`, `RigorSettings.gates?`, `RigorAssessment.gates`, and
  `assessRigor` takes `gates?`. The optional `gates` field in `.sdd/settings/rigor.json` may
  **narrow** the level's list, but an unknown id is **rejected** (naming the id) instead of being
  ignored, so a typo cannot silently reduce the checks.
- **`govern rigor` is compact by default; the commit path stays fluid.** It now prints two lines
  (level + active gates, and what it demands) and only blocking findings and warnings, with a count
  of the hidden informational findings; `--verbose` restores the full level table, the declared
  rationale and every finding; `--quiet` prints a single line and carries the verdict in the exit
  code; `--gates` prints the ladder table; `--select` is unchanged. The pre-commit hook
  (`tools/open-sdd/templates/hooks/pre-commit`) runs `govern rigor --no-drift --quiet`, so a commit
  does not read like an audit while C2 still blocks.

### Fixed — one publishable identity, and a parser bug it exposed

- **The publish pipeline targeted the wrong package.** `publish.yml` ran `npm publish` from
  `tools/open-sdd` (the build workspace), so a release tag would have published an **unscoped**
  `open-sdd` while the repository had already decided on `@brujo2020/open-sdd`. It now builds and
  tests the workspace, runs the gate chain and the claims registry, asserts the published name, and
  publishes from the repository root with `--access public --provenance`.
- **The workspace can no longer be published by accident.** `tools/open-sdd/package.json` is marked
  `"private": true`; the root manifest carries `publishConfig.access = "public"` (scoped packages
  default to private on npm) and remains the only publishable artifact.
- **`install:global` installed the wrong identity.** It installed `./tools/open-sdd` (global name
  `open-sdd`) instead of the scoped package; it now installs the repository root.
- **Documentation no longer advertises a command that resolves to nothing.** `npx open-sdd@latest`
  was named in the README, the installation guide, two workflow guides and the workspace README
  (9 occurrences). All install/uninstall instructions use `@brujo2020/open-sdd`, the README states
  that the scoped package **is not published yet**, and the paths that work today (clone +
  `install.sh`, or `npm run install:global`) are given explicitly.
- **Bug found while verifying the above, and fixed.** The claims-registry parser processed YAML
  double-quoted escapes in sequence, which turned `\\n` into a backslash plus a real newline and
  split a verifier command across lines. It now unescapes in a single left-to-right pass. This was
  caught by a new claim that failed as `broken` — the registry reporting on itself as intended.
- **The published artifact reported its version as `vdev`.** Packing the tarball and installing it into a
  throwaway prefix showed `open-sdd --version` printing `vdev`: the CLI read
  `../package.json`, and `tools/open-sdd/package.json` is deliberately not shipped. It now resolves the
  repository/package root manifest first (three levels up from `dist/cli.js`, which is the same
  directory in a checkout and once installed) and falls back to the workspace one, through a single
  `readCliVersion()` helper that replaced two duplicated read sites.
- **`postinstall` was noisy for consumers.** It announced a skipped workspace on every consumer
  install; it now installs workspace dependencies only when `tools/open-sdd/src` exists (a source
  checkout) and exits silently in the published layout, where the compiled `dist` is already shipped.
- **Verified against the real artifact, not the source tree:** the packed tarball installed into a
  temporary prefix exposes all four binaries (`open-sdd`, `sdd-open`, `sdd`, `open-sdd`),
  `--version` prints `open-sdd v3.0.2`, `--help` works, and `gates chain --profile team` resolves 9
  controls from the installed copy. Three more tests (13 in total) cover the version resolution and
  both postinstall paths, and CLM-044 decides the version by exit code.
- **Guards so none of it returns:** `test/releaseIntegrity.test.ts` (10 tests) asserts the single
  publishable identity, that every `bin` target exists, that the workspace is private, that
  `install:global` installs the root, that the publish pipeline tests before publishing and never
  runs from the workspace, that the identity is asserted before `npm publish`, and that **no
  documentation code block** advertises the unscoped name. Claims CLM-041 … CLM-043 decide the same
  properties by exit code.


### Added — brownfield: delta specs and the reverse constitution

- **Delta specs: the unit of specification is the change, not the system.** `core/deltaSpec.ts`
  implements the four ADSR sections (ADDED / MODIFIED / REMOVED / RENAMED), delta-scoped
  `REQ-<AREA>-<NNN>` identifiers, a mandatory `previous` on MODIFIED/REMOVED/RENAMED, a mandatory
  rationale **and** contracts on REMOVED (contracts are a warning on MODIFIED), a size warning above
  25 entries, per-entry strangulation (`legacy → both → new`), and two-way traceability: every
  requirement must have a task, and a task citing an unknown delta id is reported as a phantom. New
  console surface: `delta init|validate|status|render <feature>`.
- **The reverse-engineered descriptive constitution.** `core/constitution.ts` models one artifact
  with two provenances: `descriptive` principles (what the code already obeys, each with mandatory
  evidence) and `normative` principles (authored, introduced by a governed amendment that requires a
  migration plan). Six-field anatomy (identifier · threat/CWE reference · MUST/SHOULD/MAY ·
  restriction · pattern · justification), citable authority, indirect-injection scan and markdown
  round-trip. `core/reverseConstitution.ts` reads the repository's facts (lockfile, migration dirs
  and rollbacks, CI workflows, public API entry points, config files) and emits desired-but-absent
  practices as **proposed amendments**, never as facts. New console surface:
  `brownfield survey [target]` and `brownfield constitution [target] [--write]`.
- **Three SDD rigor levels.** `core/rigor.ts` implements Spec-First, Spec-Anchored and
  Spec-as-Source with the artifacts each level demands, its active gate ids, its evaluator question
  and its missing-artifact policy; `govern rigor` prints the levels and assesses the repository
  against the level declared in `.sdd/settings/rigor.json` (exiting 1 on blocking findings), and
  `govern rigor --select` recommends one. A valid constitution is **required (blocking) from
  Spec-Anchored upward** and only recommended at Spec-First, because it is the authority a blocking
  verdict cites. Where a demand is not decidable from artifacts (regeneration at Spec-as-Source) it
  is reported as a declared gap instead of a fabricated pass.
- **Analysis over the pending change: impact, contracts and reuse-first.** `core/changeImpact.ts`
  (`analyzeChangeImpact`) reports the change's reachable set, its blast radius, the touched API
  surface, its integration points and the breaking changes implied by the delta's targets.
  `core/executionContract.ts` turns the delta's declared `Contracts:` into a regression oracle:
  `extractContracts` binds covering tests to the changed files, publishes `contracts.json`, and
  names the changed files **no** contract covers; `verifyContracts` requires exit code 0 **and** no
  declared contract missing, so a green run never launders a promised protection that does not
  exist. `core/reuseFirst.ts` (`findReuseCandidates`, `REUSE_FIRST_RULE`) reports the symbols a
  reuse-first search would have found first. Console: `brownfield impact|contracts|reuse <feature>`,
  with `--write` and `--verify` on `contracts`. Declared limit: these are reports, not gates, and no
  workflow invokes `--verify` yet.
- **Reconnaissance is workspace- and configuration-aware (defect fixed).** Running `brownfield
  survey` on this repository used to report **"JavaScript, no tests detected"** while the project is
  TypeScript with 500+ tests, because the code lives in `tools/open-sdd` and the scan read only the
  repository root. The scanner now walks the declared workspace roots (`tools/open-sdd`, `packages/*`,
  `apps/*`, …) and reads both manifests and config files (`tsconfig.json`, `vitest.config.ts`,
  `governance.json`-style settings), so it reports **TypeScript / npm / tsc / Vitest and 9 modules**
  with the real module list. A brownfield survey that lies about the project it is run on is worse
  than no survey.
- **Drift-gate false positive fixed.** `core/git.ts` · `getModifiedFiles` trimmed the whole
  `git status --porcelain` output, which stripped the leading space of the **first** line only (the
  common "modified, not staged" prefix is ` M`); `slice(3)` then removed a real character from that
  path, so `docs/x.md` appeared as `ocs/x.md` and matched no declared boundary — a false
  ambient-drift finding on whichever file git listed first. The fix parses the raw output line by
  line; all 29 paths in this checkout now parse exactly.
- **Traceability updated.** Gap G-12 is rewritten from "heuristic bootstrap" to "delta specs and a
  reverse constitution, with behaviour still declared rather than extracted"; four new gaps record
  what remains (G-15 contract verification is not in CI, G-16 the compliance matrix has no console
  surface, G-17 no delta merge-back, G-18 impact/reuse consult code rather than the constitution);
  six declared divergences between the source documents and the implemented code are recorded in
  section 6 (six fields vs three, the undefined `SHALL NOT` modal, where Spec-Anchored starts,
  slash-separated CWE references, the two rigor scales and their bridge, and the unenforced
  compliance matrix); the component map gains the modules and the brownfield console; and nine new
  claims (CLM-045 … CLM-053) decide the capabilities by exit code. Registry result: 53 claims, 50
  verified, 0 broken, 0 outdated.

### Added — enforcement floor installed, skills taught, naming unified

- **Level B (commit) is installed, not declared.** `tools/open-sdd/templates/hooks/pre-commit` runs
  `gates run C1 C2 C3 --staged --strict` — C1 advisory, C2 blocking on secrets and destructive
  commands **in the staged index**, C3 blocking when a completed task carries no captured
  `_Evidence:`. It fails closed with an actionable message when the CLI is missing, and it is
  installed automatically by `npm run prepare` / `npm run hooks:install`, or into any target project
  with `open-sdd floor install <target> --ci`.
- **Level C (merge) is installed.** `.github/workflows/gates.yml` runs on every pull request:
  install, build, the full suite, the resolved chain, `gates run --base <base-sha>` against the PR
  diff, `govern discipline`, `assure claims --verify` and `floor status`.
  `tools/open-sdd/templates/hooks/open-sdd-gates.yml` is the copy shipped for target projects.
- **Declared security exceptions.** `.sdd/settings/security-allowlist.json` records each suppression
  per (path, pattern id) with a reason and an actor, and every run reports how many findings it
  suppressed — a suppression can never be mistaken for a clean scan. `git commit --no-verify` is
  documented as an unrecorded bypass.
- **`open-sdd floor status|install`** (new `floorInstallation.ts` and `securityAllowlist.ts`; new
  `--staged`, `--base` and `--strict` modes on `gates run`) answers whether the owned floor is
  installed rather than argued, and exits non-zero the moment it is not. 13 tests in
  `test/enforcementFloor.test.ts`.
- **The shipped skills teach the console.** All eight `sdd-help` skills (one per skills-based agent)
  now document `gates` / `govern` / `assure` / `waves` / `floor`, the C7-vacuity and
  no-model-backend caveats, and the pointer to `docs/PAPER-ALIGNMENT.md`.
- **Legacy naming purged from the guides and the shipped templates.** 588 replacements across 40
  files: `kiro-spec-impl` → `sdd-impl`, `/kiro:spec-init` → `/spec-init`, `/kiro/spec-impl` →
  `/sdd/spec-impl`, `{{KIRO_DIR}}` → `{{SDD_DIR}}`, `.kiro/` → `.sdd/`, `@kiro-` → `@sdd-`, and
  `agent: kiro/` → `agent: sdd/`. Thirty-nine broken internal anchors were repaired; a name audit now
  finds zero unknown skill or command tokens. The supported `--kiro-dir` alias, the archived release
  notes and the migration guide's deliberate before-column are untouched.
- **Untranslated Japanese fragments removed** from four English documents. The runtime literal
  `次のステップ` was kept on purpose — the subagents actually emit it — with the surrounding prose
  clarified.
- **Traceability updated.** Gap G-11 was rewritten from "declared, not installed" to "installed, with
  level A still unverified", and five new claims (CLM-036 … CLM-040) decide the floor by exit code.
  Registry result: 40 claims, 37 verified, 0 broken, 0 outdated.


### Added — restoration, Zero-Trust console, paper-aligned core
- **Restored the product.** The `cleanup: remove legacy open-sdd and docs` commit had removed the CLI surface while the npm package (`open-sdd@3.0.2`) still declared a `bin` pointing at `tools/open-sdd/dist/cli.js`. The CLI, its commands and the shipped agent templates are restored, and `install.sh` now drives the real CLI instead of copying files into a `src/cli/` layout that never existed in any commit.
- **Zero-Trust governance console.** `open-sdd gates|govern|assure|waves` implements the reference architecture: the gate chain resolved from catalog + profile + repository signals, the crosswalk and the residue computed by subtraction, enforcement levels A–D with ceiling-vs-floor and behavioural-sentinel semantics, conformity C0–C3, quantified HIL thresholds, relaxation receipts and the appeal channel, META-EVAL, the overhead budget, the OWASP Agentic / MITRE ATLAS and EU AI Act / NIST / ISO crosswalks, the five risk-lab banks, the skills and memory models, and transactional wave planning. `--help` lists the subcommands.
- **Paper-aligned core modules** under `tools/open-sdd/src/core/`: `gateCatalog.ts`, `enforcement.ts`, `invariants.ts`, `receipts.ts`, `hitl.ts`, `ears.ts`, `triad.ts`, `waves.ts`, `metaEval.ts`, `memory.ts`, `skills.ts`, `telemetry.ts`, `claims.ts`, `assurance.ts`, `gateRunner.ts`. The catalog keeps executable, vacuous and declared-but-not-implemented states distinct, so C7/Karpathy is reported as activation without measurement instead of being laundered into a passing control.

### Documentation — alignment with the published reference architecture
- **`README.md` rewritten.** The previous version was stale and, in places, false: it advertised a feature with no counterpart in the tree, described a `curl … install.sh | bash` one-liner the script cannot serve (it requires a target repository argument and exits `1` without one), and stated "Code always matches the approved spec" as an unconditional guarantee. The rewrite documents the real CLI surface, the 18 agent definitions and their install directories, both profile axes (`solo|team|enterprise` for blocking; `solo|team|regulated` for chain resolution) and the Zero-Trust console, and adds an explicit "what this port does not do" section.
- **`docs/PAPER-ALIGNMENT.md` added.** Traceability of the paper's architecture onto the code: paper section/table, implementing file and symbol, and a status label (`medido` / `construido` / `propuesto` / `brecha declarada`), plus the full G1–G21 → C1–C7/O1–O7 → crosswalk → residue correspondence and fourteen numbered gaps. It states without hedging that the paper's prototype (SteelHarness) is not published; that its measured figures (κ = 0.86 n=15, C4 FPR 20.0 %, the 2.1–2.2 s sweep, the 7/9/12 chain counts) are properties of that prototype and must not be restated as measurements of this repository; that no model backend ships, so C5 and META-EVAL degrade honestly; and that no ON/OFF delta table is published in the paper, so none is invented here.
- **`docs/claims/paper-claims.yaml` added, with an executable runner** — a §9.6-style claims registry of 35 entries, each with a verifier runnable from the repository root and an `expectation` of `pass`/`fail`/`absent`. The product CLI executes it: `assure claims --verify` (dispatched from `cli/commands/paper.ts` to `core/claimsRegistry.ts`). Measured result: `35 claims | 32 verified | 0 declared-gap | 3 not-measured | 0 broken | 0 outdated-text`.
- **`docs/QUICK-START.md` and `docs/INSTALLATION.md` added** — the two filenames the README and other docs referenced but which did not exist. Both are based on the real `--help` output, the agent registry and the `--dry-run`/`--overwrite`/`--lang` flags.
- **`CLAUDE.md` and `AGENTS.md` corrected.** They claimed skills lived in `.claude/skills/sdd-*/SKILL.md` and `.agent/skills/kiro-*/SKILL.md`; neither directory exists in this repository, the shipped skill prefix is `sdd-`, and the templates live under `tools/open-sdd/templates/agents/<agent>/skills/` (160 `SKILL.md` files). Both files now separate "in this repository" from "created in a target project", note that `.sdd/steering/` and `.sdd/memory/` are install targets, correct the progress command to `/sdd-spec-status`, and link to `docs/PAPER-ALIGNMENT.md` and the Zero-Trust console.

### Fixed
- **Shipped settings were never read.** `governance.json` and `git.json` installed into `.sdd/settings/templates/`, while the engine reads them from `.sdd/settings/`. Every project silently ran on hardcoded defaults regardless of what the files said. They now ship to the correct path (all 18 manifests), with a regression test.
- **`npm install` failed on npm 10.** vitest 4's peer graph crashed npm's resolver (`Cannot read properties of null (reading 'edgesOut')`). Pinned a `vite` override so a clean `npm i` works without `--legacy-peer-deps`.
- **Unrendered `{{KIRO_DIR}}` placeholder** leaked into the post-install "Get started" output for every agent.

### Changed
- **Configuration is one line.** `{ "profile": "solo" | "team" | "enterprise" }` sets everything. Explicit fields still override it.
- **The default blocks nothing.** `solo` runs every check and reports; it never fails a run. `team` blocks only code written without an approved spec; `enterprise` blocks everything. Previously `mode` changed a single branch and `critical_gates_only`, `non_blocking_warnings` and `critical_invariants` were read by nothing.
- **A check your profile ignores still reports** as `heads up` — you keep the signal without the friction.
- **Plain language everywhere.** "Critical Invariant Gate G2" is now "Code follows an approved spec"; "Documentary Triad / Gate 0 violation" is now "Implementation started before the spec was approved". Compliance reporting (EU AI Act, NIST) moved behind `--regulatory` instead of fronting the CLI and README.
- **Safer defaults**: fresh installs are `solo` + git `assisted` with `auto_push: false`. Previously governance shipped `fluid` while git shipped `strict` with `auto_push: true`, so a first run could push to a remote.
- A freshly initialised spec no longer fails its checks; they judge work in flight, not intent.

### Added
- `docs/guides/governance-profiles.md` — profiles, what each check means, exit codes for CI.
- 17 tests covering profile resolution, check enforcement and the shipped-settings path.

### Removed
- Four demo specs inherited from the upstream fork (`customer-support-rag-backend-{en,ja}`, `photo-albums-en`, `vercel-ai-chatui-research-agent-ja`).

## [3.0.2] - 2026-04-14

### Changed
- Remove the README Amazon book reference after the linked title shifted to promote `ai-sdd`, a closed-source clone of open-sdd without attribution ([#157](https://github.com/gotalab/open-sdd/pull/157))

### Fixed
- Add the missing `description` field to the Codex `spec-reviewer` custom agent template so Codex keeps the role available for cross-spec review instead of dropping it as malformed ([#160](https://github.com/gotalab/open-sdd/pull/160))

## [3.0.1] - 2026-04-11

### Changed
- Refine English release messaging by replacing the awkward phrase `team-scale AI-driven development` with `AI-driven development at team scale` across the main README and philosophy guide ([#155](https://github.com/gotalab/open-sdd/pull/155))

### Fixed
- Correct the mojibake in the Claude Code Skills `kiro-impl` template so the feature-flag test protocol renders the `→` arrow correctly ([#154](https://github.com/gotalab/open-sdd/pull/154))

### Security
- Harden manifest-, template-, and shared-rule-derived path handling so generated file operations stay within the expected roots and fail closed on unsafe traversal inputs or symlinked destinations ([#155](https://github.com/gotalab/open-sdd/pull/155))

## [3.0.0] - 2026-04-10

### Added
- Introduce Agent Skills mode as the primary installation target across 8 platforms: Claude Code, Codex, Cursor, GitHub Copilot, Windsurf, OpenCode, Gemini CLI, and Antigravity ([#141](https://github.com/gotalab/open-sdd/pull/141))
- Add new workflow entry points for skills mode, including `/kiro-discovery`, `/kiro-spec-batch`, and long-running autonomous `/kiro-impl` with reviewer/debugger support ([#141](https://github.com/gotalab/open-sdd/pull/141))
- Add `.kiro/settings/` rules and templates for boundary-first planning, design synthesis, review gates, task decomposition, and steering customization ([#141](https://github.com/gotalab/open-sdd/pull/141))
- Add `open-sdd-new-agent`, a plan-first SOP for adding new supported agents or migrating existing agents to skills mode ([#141](https://github.com/gotalab/open-sdd/pull/141))

### Changed
- Reposition open-sdd around skills-mode workflows and native subagent dispatch, with updated docs, guides, and onboarding across the repository ([#141](https://github.com/gotalab/open-sdd/pull/141))
- Change the default installer target from command-based Claude Code to `claude-code-skills` ([#141](https://github.com/gotalab/open-sdd/pull/141))
- Update the package positioning to “long-running autonomous implementation” and align README / release messaging with the v3 workflow ([#141](https://github.com/gotalab/open-sdd/pull/141))
- Restrict stale issue auto-close behavior so only maintainers who explicitly apply the `awaiting-response` label trigger timeout-based closure ([#138](https://github.com/gotalab/open-sdd/pull/138))

### Deprecated
- Deprecate command-based agent installs such as `--claude-code`, `--cursor`, and related prompt-mode variants in favor of `--*-skills` installs ([#141](https://github.com/gotalab/open-sdd/pull/141))

### Removed
- Remove Codex prompts mode as a supported install path; `--codex` now blocks and directs users to `--codex-skills` ([#141](https://github.com/gotalab/open-sdd/pull/141))
- Remove the external Ralph Loop dependency in favor of native subagent-driven autonomous implementation inside `kiro-impl` ([#141](https://github.com/gotalab/open-sdd/pull/141))

### Fixed
- Honor configured agent selection during non-interactive installs instead of forcing the default agent ([#141](https://github.com/gotalab/open-sdd/pull/141))
- Accept CRLF frontmatter when resolving skill shared-rules so Windows-style checkouts install complete rule sets ([#141](https://github.com/gotalab/open-sdd/pull/141))

## [2.1.1] - 2026-02-02

### Fixed
- Fix OpenCode agent slash command frontmatter to use full agent path ([#134](https://github.com/gotalab/open-sdd/pull/134))

### Security
- Update vitest to v4 to resolve security vulnerabilities ([#135](https://github.com/gotalab/open-sdd/pull/135))

### New Contributors
* @hiiamkazuto made their first contribution in #134

## [2.1.0] - 2026-02-01

### Added
- **OpenCode support** - 8th supported agent with full SDD workflow integration ([#117](https://github.com/gotalab/open-sdd/pull/117), [#127](https://github.com/gotalab/open-sdd/pull/127))
  - `.opencode/commands/` with 11 kiro commands
  - OpenCode Agents (subagent version) in `.opencode/agents/`
  - OPENCODE.md project memory template
  - Installation via `npx @brujo2020/open-sdd@latest --opencode` or `--opencode-agent`

### Changed
- Update recommended models to latest versions ([#128](https://github.com/gotalab/open-sdd/pull/128), [#129](https://github.com/gotalab/open-sdd/pull/129))
  - Claude: Opus 4.5
  - OpenAI: GPT-5.2
  - Google: Gemini 3 Flash
- Remove think keywords from templates for cleaner prompts ([#128](https://github.com/gotalab/open-sdd/pull/128))

### New Contributors
* @inovue made their first contribution in #117

## [2.0.5] - 2026-01-08

### Added
- Add Greek (el) language support, bringing total to 13 languages ([#121](https://github.com/gotalab/open-sdd/pull/121))

## [2.0.4] - 2026-01-07

### Fixed
- Update GitHub Copilot prompt files to replace deprecated `mode` attribute with `agent` ([#118](https://github.com/gotalab/open-sdd/pull/118))
- Fix registry.ts with review improvements ([#107](https://github.com/gotalab/open-sdd/pull/107))

### Documentation
- Add AI-Assisted SDD book reference to documentation ([#109](https://github.com/gotalab/open-sdd/pull/109))

## [2.0.3] - 2025-11-15

### Changed
- Refine recommended OpenAI models for Codex CLI, Cursor, GitHub Copilot, and Windsurf agents to prioritize `gpt-5.1-codex medium/high`, keeping `gpt-5.1 medium/high` as a general-purpose fallback.

### Fixed
- Align DEV_GUIDELINES-related tests with the stricter language-handling rules introduced in v2.0.2 so `npm test` passes cleanly for v2.0.3.

- PRs: [#104](https://github.com/gotalab/open-sdd/pull/104)

## [2.0.2] - 2025-11-15

### Changed
- Align templates, rules, and prompts with GPT-5.1 by updating recommended OpenAI model names for Codex CLI, Cursor, GitHub Copilot, and Windsurf agents to `GPT-5.1 high or medium`.
- Tighten language handling so all generated Markdown (requirements, design, tasks, research, validation) uses the spec’s target language (`spec.json.language`) and defaults to English (`en`) when unspecified.
- Make EARS patterns and requirements traceability more consistent by keeping EARS trigger phrases (`When`, `If`, `While`, `Where`, `The system shall`, `The [system] shall`) as fixed English fragments, localizing only the variable slots, and enforcing numeric requirement IDs across all phases (e.g. `Requirement 1`, `1.1`, `2.3`) with fast failure when IDs are missing or invalid instead of falling back to free-form labels.
- PRs: [#102](https://github.com/gotalab/open-sdd/pull/102)

## [2.0.1] - 2025-11-10

### Changed
- Improve README clarity and visual consistency ([#93](https://github.com/gotalab/open-sdd/pull/93), [#94](https://github.com/gotalab/open-sdd/pull/94))

## [2.0.0] - 2025-11-09

### Summary

- Consolidates every feature shipped in 2.0.0-alpha.1〜alpha.6 and promotes them to `npx @brujo2020/open-sdd@latest`.
- Adds validation commands, Research.md, steering/memory upgrades, and 7-agent / 13-language parity.
- For migration steps, see `docs/guides/migration-guide.md` (referenced from release notes as well).

### Added

#### Core Features
- **Parallel task analysis** by default in spec-tasks command ([#89](https://github.com/gotalab/open-sdd/pull/89))
  - Automatic `(P)` marker for parallel-executable tasks
  - New `--sequential` flag to opt-out of parallel analysis
  - New rule file: `tasks-parallel-analysis.md` for identifying parallel tasks
- **Research.md template** for spec-driven workflow
  - Separates discovery findings and architectural investigations from `design.md`
  - Captures research logs, architecture pattern evaluations, and design decisions
  - Provides structured format for documenting trade-offs and rationale
- **Guidelines for excluding agent tooling directories** from steering docs
  - Prevents `.claude/`, `.cursor/`, `.codex/` etc. from being analyzed

#### Platform Support (from alpha releases)
- **Claude Code Subagents mode** for context optimization ([#74](https://github.com/gotalab/open-sdd/pull/74))
  - Delegate SDD commands to dedicated subagents to preserve main conversation context
  - Improve session lifespan by isolating command-specific context
  - Specialized system prompts for each command type
  - 12 commands + 9 Subagent definitions
- **Windsurf IDE support** with complete workflow integration
  - `.windsurf/workflows/` directory with 11 workflow files
  - AGENTS.md configuration for optimization
  - `--windsurf` CLI flag
- **Codex CLI official support** with 11 prompts in `.codex/prompts/`
- **GitHub Copilot official support** with 11 prompts in `.github/prompts/`

#### Validation Commands (Brownfield Development)
- **`/kiro:validate-gap`** - Analyze implementation gap between requirements and existing codebase
- **`/kiro:validate-design`** - Validate design compatibility with existing architecture
- **`/kiro:validate-impl`** - Validate implementation against requirements, design, and tasks

#### Developer Experience
- **Interactive CLI installer** with guided setup ([#70](https://github.com/gotalab/open-sdd/pull/70))
  - Organized file display by Commands / Project Memory / Settings categories
  - Interactive project memory handling (overwrite/append/keep)
- **Comprehensive documentation**
  - Complete command reference with 11 `/kiro:*` commands ([#83](https://github.com/gotalab/open-sdd/pull/83))
  - Customization guide with 7 practical examples ([#83](https://github.com/gotalab/open-sdd/pull/83))
  - Migration guide for v1.x users
- **npm badges** for version tracking ([#86](https://github.com/gotalab/open-sdd/pull/86))

### Changed

#### Architecture & Structure
- **Unified template structure** - removed `os-mac/os-windows` directories in favor of single `commands/` structure
- **All templates now use actual extensions** (`.md`, `.prompt.md`, `.toml`)
- **Steering now functions as project-wide rules/patterns/guidelines** (Project Memory)
  - Enhanced steering system loading all documents under `steering/` directory
- **Shared settings bundle** in `{{KIRO_DIR}}/settings` for cross-platform customization

#### Commands & Workflow
- **Redesigned all 11 Spec-Driven commands** (`spec-*`, `validate-*`, `steering*`) with improved context
- **Enhanced task generation guidelines** with parallel execution criteria
- **Improved design template** with discovery process guidelines
- **Updated spec-design workflow** to leverage new research.md template
- **Streamlined tasks.md template structure**

#### Documentation & Formats
- **Updated EARS format** to use lowercase syntax ([#88](https://github.com/gotalab/open-sdd/pull/88))
  - Changed from "WHILE/WHEN/WHERE/IF" to "while/when/where/if"
  - Improved readability and consistency
- **Clarified template customization instructions** ([#85](https://github.com/gotalab/open-sdd/pull/85))
- **Updated installation documentation** for better clarity ([#87](https://github.com/gotalab/open-sdd/pull/87))
- **Reorganized documentation structure**
  - Renamed `docs/CHANGELOG/` to `docs/RELEASE_NOTES/`
  - Separated technical changelog from marketing-focused release notes
  - Added cross-references between CHANGELOG and Release Notes

#### Project Management
- **Automated GitHub issue lifecycle management** ([#80](https://github.com/gotalab/open-sdd/pull/80))
  - Auto-close stale issues after 10 days of inactivity
  - Configurable stale detection workflow
  - English-only workflow messaging ([#81](https://github.com/gotalab/open-sdd/pull/81))
- **Centralized agent metadata into registry** ([#72](https://github.com/gotalab/open-sdd/pull/72))

### Fixed
- Template structure standardization across all agents
- Manifest definitions for new directory layouts
- Template parameter replacement across platforms
- OS-specific command handling for Windows environments

### Removed
- OS-specific template directories (`os-mac`, `os-windows`)
- Deprecated Claude documentation files
- Duplicate CLAUDE.md files
- Unused documentation artifacts

### Breaking Changes

⚠️ **Important**: Please review the [Migration Guide](docs/guides/migration-guide.md) when upgrading from v1.x.

1. **Template Structure**: OS-specific directories removed. Use unified templates in `.kiro/settings/templates/`
2. **Steering**: Now loads entire `steering/` directory instead of single file
3. **File Extensions**: Templates use actual extensions (`.md`, `.prompt.md`, `.toml`)
4. **Command Count**: Expanded from 8 to 11 commands (3 validation commands added)

### Migration from v1.x

See the comprehensive [Migration Guide](docs/guides/migration-guide.md) for detailed upgrade instructions, including:
- Step-by-step migration procedures
- Breaking changes explained
- Template and steering migration
- Troubleshooting common issues

> For release storytelling, refer to `docs/RELEASE_NOTES/*`. This changelog keeps the technical diff only.

---

## Previous Alpha Releases

## [2.0.0-alpha.6] - 2025-11-09

### Added
- Parallel task analysis features (included in v2.0.0)
- Research.md template (included in v2.0.0)

## [2.0.0-alpha.5] - 2025-11-05

### Added
- npm `next` version badge in README files ([#86](https://github.com/gotalab/open-sdd/pull/86))

### Changed
- Updated EARS format to use lowercase syntax ([#88](https://github.com/gotalab/open-sdd/pull/88))
  - Changed from "WHILE/WHEN/WHERE/IF" to "while/when/where/if"
  - Improved readability and consistency
- Updated installation documentation for better clarity ([#87](https://github.com/gotalab/open-sdd/pull/87))

**Related PRs:**
- [#88](https://github.com/gotalab/open-sdd/pull/88) - Update EARS format to lowercase syntax
- [#87](https://github.com/gotalab/open-sdd/pull/87) - Clarify installation
- [#86](https://github.com/gotalab/open-sdd/pull/86) - Add npm next badge to README files

## [2.0.0-alpha.4] - 2025-10-30

### Added
- Comprehensive customization guide with 7 practical examples ([#83](https://github.com/gotalab/open-sdd/pull/83))
  - Template customization patterns
  - Agent-specific workflow examples
  - Project-specific rule examples
- Complete command reference documentation ([#83](https://github.com/gotalab/open-sdd/pull/83))
  - Detailed usage for all 11 `/kiro:*` commands
  - Parameter descriptions and examples

### Changed
- Clarified template customization instructions ([#85](https://github.com/gotalab/open-sdd/pull/85))
- Customization guide review improvements ([#84](https://github.com/gotalab/open-sdd/pull/84))

**Related PRs:**
- [#83](https://github.com/gotalab/open-sdd/pull/83) - Add customization guide and command reference
- [#84](https://github.com/gotalab/open-sdd/pull/84) - Customization guide review suggestions
- [#85](https://github.com/gotalab/open-sdd/pull/85) - Clarify template customization instructions

## [2.0.0-alpha.3.1] - 2025-10-24

### Added
- Automated GitHub issue lifecycle management ([#80](https://github.com/gotalab/open-sdd/pull/80))
  - Auto-close stale issues after 10 days of inactivity
  - Configurable stale detection workflow
  - English-only workflow messaging ([#81](https://github.com/gotalab/open-sdd/pull/81))

### Changed
- Updated stale detection period to 10 days
- Improved GitHub Actions workflow for issue management

**Related PRs:**
- [#80](https://github.com/gotalab/open-sdd/pull/80) - Automate GitHub issue lifecycle management
- [#81](https://github.com/gotalab/open-sdd/pull/81) - Make stale workflow messaging English-only

## [2.0.0-alpha.3] - 2025-10-22

### Added
- Windsurf IDE agent definition, manifest, and workflow templates so `npx @brujo2020/open-sdd@next --windsurf` installs `.windsurf/workflows/` and AGENTS.md alongside shared settings.
- `realManifestWindsurf` vitest coverage that exercises dry-run and apply flows across macOS/Linux runtimes.
- `--windsurf` CLI alias support and accompanying argument parser tests.

### Changed
- Updated completion guides and recommended model messaging to include Windsurf-specific guidance.
- Refreshed root README, `tools/open-sdd/README*`, and `docs/README/README_{en,ja,zh-TW}.md` with Windsurf setup instructions and manual QA steps.

## [2.0.0-alpha.2] - 2025-10-13

### Added
- Claude Code Subagents mode for context optimization ([#74](https://github.com/gotalab/open-sdd/pull/74))
  - Delegate SDD commands to dedicated subagents to preserve main conversation context
  - Improve session lifespan by isolating command-specific context
  - Specialized system prompts for each command type
  - Related issue: [#68](https://github.com/gotalab/open-sdd/issues/68)
- CHANGELOG.md at root following Keep a Changelog format
- Release Notes documentation structure in `docs/RELEASE_NOTES/`
  - Japanese version (RELEASE_NOTES_ja.md)
  - English version (RELEASE_NOTES_en.md)

### Changed
- Reorganized documentation structure
  - Renamed `docs/CHANGELOG/` to `docs/RELEASE_NOTES/`
  - Separated technical changelog from marketing-focused release notes
  - Added cross-references between CHANGELOG and Release Notes
- Improved Claude Code agent templates with updated recommendations
- Centralized agent metadata into registry ([#72](https://github.com/gotalab/open-sdd/pull/72))

### Removed
- Deprecated Claude documentation files
- Duplicate CLAUDE.md files
- Unused documentation artifacts

**Related PRs:**
- [#74](https://github.com/gotalab/open-sdd/pull/74) - Add Claude Code Subagents mode
- [#73](https://github.com/gotalab/open-sdd/pull/73) - Add CLAUDE.md documentation
- [#72](https://github.com/gotalab/open-sdd/pull/72) - Refactor agent metadata into central registry

## [2.0.0-alpha.1] - 2025-10-08

### Added
- Interactive CLI installer with guided setup (`npx @brujo2020/open-sdd@latest`)
  - Organized file display by Commands / Project Memory / Settings categories
  - Interactive project memory handling (overwrite/append/keep)
- Codex CLI official support with 11 prompts in `.codex/prompts/`
- GitHub Copilot official support with 11 prompts in `.github/prompts/`
- Shared settings bundle in `{{KIRO_DIR}}/settings` for cross-platform customization
- Enhanced steering system loading all documents under `steering/` directory

### Changed
- Redesigned all 11 Spec-Driven commands (`spec-*`, `validate-*`, `steering*`) with improved context
- Unified template structure - removed `os-mac/os-windows` directories in favor of single `commands/` structure
- All templates now use actual extensions (`.md`, `.prompt.md`, `.toml`)
- Steering now functions as project-wide rules/patterns/guidelines (Project Memory)
- Updated manifests and CLI with `--codex`, `--github-copilot` flags

### Fixed
- Template structure standardization across all agents
- Manifest definitions for new directory layouts

### Removed
- OS-specific template directories (`os-mac`, `os-windows`)

**Metrics:**
- Supported Platforms: 6 (Claude Code, Cursor IDE, Gemini CLI, Codex CLI, GitHub Copilot, Qwen Code)
- Commands: 11 (6 spec + 3 validate + 2 steering)

**Related PRs:**
- [#71](https://github.com/gotalab/open-sdd/pull/71) - Add alpha version info and improve language table
- [#70](https://github.com/gotalab/open-sdd/pull/70) - Release open-sdd v2.0.0-alpha

## [1.1.5] - 2025-09-24

### Added
- Qwen Code AI assistant support ([#64](https://github.com/gotalab/open-sdd/pull/64))
  - Reuse gemini-cli templates to minimize code duplication
  - Command directory: `.qwen/commands/kiro`
  - QWEN.md template for project memory

## [1.1.4] - 2025-09-17

### Fixed
- Bash command errors in steering templates ([#62](https://github.com/gotalab/open-sdd/pull/62))
  - Reverted to original bash one-liner style
  - Maintained Windows compatibility

## [1.1.3] - 2025-09-15

### Changed
- Improved steering command templates ([#60](https://github.com/gotalab/open-sdd/pull/60))
  - Simplified custom files check logic using `ls + wc`
  - Added `AGENTS.md` to project analysis section

### Fixed
- Kiro IDE integration descriptions in READMEs ([#61](https://github.com/gotalab/open-sdd/pull/61))
  - Clarified spec portability to Kiro IDE
  - Removed confusing command references

## [1.1.2] - 2025-09-14

### Added
- Multi-language support for project memory documents ([#59](https://github.com/gotalab/open-sdd/pull/59))
  - Centralized development guideline strings by language
  - Single templates with `DEV_GUIDELINES` placeholder

### Changed
- Consolidated agent documentation templates
- Updated manifests and tests for new template structure

## [1.1.1] - 2025-09-07

### Changed
- Updated repository URL throughout the project
- Improved test coverage and fixed edge cases ([#57](https://github.com/gotalab/open-sdd/pull/57))

### Fixed
- CLI messages and linux template mapping expectations
- Generated artifacts now properly ignored (.claude/, CLAUDE.md)

## [1.1.0] - 2025-09-08

### Added
- Validation commands for brownfield development ([#56](https://github.com/gotalab/open-sdd/pull/56))
  - `/kiro:validate-gap` - Analyze implementation gap between requirements and existing codebase
  - `/kiro:validate-design` - Validate design compatibility with existing architecture
  - `/kiro:validate-impl` - Validate implementation against requirements, design, and tasks
- Cursor IDE official support with 11 commands
- AGENTS.md configuration file for Cursor IDE optimization
- Windows template support for Gemini CLI with proper bash -c wrapping ([#56](https://github.com/gotalab/open-sdd/pull/56))

### Changed
- Command structure expanded from 8 to 11 commands
- Enhanced spec-design with flexible system flows and requirements traceability ([#55](https://github.com/gotalab/open-sdd/pull/55))
- Improved EARS requirements template with better subject guidance
- Updated documentation for brownfield vs greenfield workflows

### Fixed
- Template parameter replacement across platforms
- OS-specific command handling for Windows environments

**Metrics:**
- Supported Platforms: 5 (Claude Code, Cursor IDE, Gemini CLI, Codex CLI, GitHub Copilot)
- Commands: 11 (6 spec + 3 validate + 2 steering)
- Documentation Languages: 3 (English, Japanese, Traditional Chinese)

**Related PRs:**
- [#56](https://github.com/gotalab/open-sdd/pull/56) - Reorganize templates by OS and add Gemini CLI support
- [#55](https://github.com/gotalab/open-sdd/pull/55) - Enhance technical design document generation
- [#54](https://github.com/gotalab/open-sdd/pull/54) - Improve slash commands with individual arguments
- [#52](https://github.com/gotalab/open-sdd/pull/52) - Add Cursor agent manifest and CLI support

## [1.0.0] - 2025-08-31

### Added
- Multi-platform support for Spec-Driven Development
  - Claude Code (original platform)
  - Cursor IDE integration
  - Gemini CLI with TOML configuration
  - Codex CLI with GPT-5 optimized prompts
- open-sdd npm package for easy distribution ([#39](https://github.com/gotalab/open-sdd/pull/39))
- Complete CLI tool with `npx @brujo2020/open-sdd@latest` installation
- Template system supporting multiple platforms and OS variants
- 8 core commands for spec-driven workflow
  - spec-init, spec-requirements, spec-design, spec-tasks
  - spec-impl, spec-status
  - steering, steering-custom

### Changed
- Complete workflow redesign for spec-driven development
- Unified output format across all platforms
- Individual argument handling (`$1`, `$2`) instead of `$ARGUMENTS` ([#54](https://github.com/gotalab/open-sdd/pull/54))

### Fixed
- Context creation optimization in template processing ([#45](https://github.com/gotalab/open-sdd/pull/45))
  - Eliminated redundant `contextFromResolved()` calls
  - Improved performance by 20-50% for template-heavy operations

**Metrics:**
- Supported Platforms: 4 (Claude Code, Cursor, Gemini CLI, Codex CLI)
- Commands: 8
- Documentation Languages: 3

**Related PRs:**
- [#54](https://github.com/gotalab/open-sdd/pull/54) - Improve slash commands with individual arguments
- [#52](https://github.com/gotalab/open-sdd/pull/52) - Add Cursor agent support
- [#51](https://github.com/gotalab/open-sdd/pull/51) - Major enhancement of kiro commands
- [#45](https://github.com/gotalab/open-sdd/pull/45) - Optimize context creation performance
- [#43](https://github.com/gotalab/open-sdd/pull/43) - Add CI/CD workflow
- [#42](https://github.com/gotalab/open-sdd/pull/42) - Refactor README structure
- [#39](https://github.com/gotalab/open-sdd/pull/39) - Add gemini-cli integration and open-sdd tool
- [#37](https://github.com/gotalab/open-sdd/pull/37) - Release v1.0.0-beta.1
- [#36](https://github.com/gotalab/open-sdd/pull/36) - Initial CLI tool release

## [0.3.0] - 2025-08-12

### Added
- `-y` flag for streamlined workflow approval
  - Skip requirement approval: `/kiro:spec-design feature-name -y`
  - Skip requirement + design approval: `/kiro:spec-tasks feature-name -y`
- Argument hints in command input (`<feature-name> [-y]`)
- Custom Steering support in all spec commands

### Changed
- Optimized command file sizes by 30-36%
  - spec-init.md: 162→104 lines (36% reduction)
  - spec-requirements.md: 177→124 lines (30% reduction)
  - spec-tasks.md: 295→198 lines (33% reduction)
- Task structure optimization
  - Section-based functional grouping
  - Task granularity limits (3-5 sub-items, 1-2 hour completion)
  - Unified requirements reference format

### Removed
- Redundant explanations and template sections
- "Phase X:" prefixes in task organization

## [0.2.1] - 2025-07-27

### Changed
- Optimized CLAUDE.md file size from 150 to 66 lines
- Removed duplicate sections and verbose explanations
- Applied optimization across all language versions (Japanese, English, Traditional Chinese)

### Added
- "think" keyword to spec-requirements.md for better AI reasoning

## [0.2.0] - 2025-07-26

### Added
- Interactive approval system for workflow phases
  - `/kiro:spec-design`: Prompts for requirements review confirmation
  - `/kiro:spec-tasks`: Prompts for requirements + design review confirmation
  - Automatic spec.json updates on 'y' approval
- Enhanced specification generation quality
  - Improved EARS format consistency in requirements.md
  - Research & analysis process in design phase
  - Requirements mapping and traceability in design.md
  - TDD-optimized task structure in tasks.md

### Fixed
- Directory handling when `.kiro/steering/` doesn't exist
- Error messages improved for better clarity

### Changed
- Simplified system design by removing redundant `progress` field
- Reverted to original Kiro design philosophy for requirements generation
- Removed excessive "CRITICAL" and "MUST" language
- Focus on core functionality with iterative improvement

## [0.1.5] - 2025-07-25

### Added
- Security guidelines and content quality guidelines
- Inclusion modes improvements (Always/Conditional/Manual)
- Detailed usage recommendations and guidance

### Changed
- Enhanced `/kiro:steering` command to properly handle existing files
- Improved steering document management

### Fixed
- Claude Code pipe bugs for more reliable execution
- Non-git environment compatibility

## [0.1.0] - 2025-07-18

### Added
- Kiro IDE-style Spec-Driven Development system
- 3-phase approval workflow (Requirements → Design → Tasks → Implementation)
- EARS format requirement definition support
- Hierarchical requirement structure
- Automatic progress tracking and hooks
- Basic Slash Commands set
- Manual approval gates for quality assurance
- Specification compliance checking
- Context preservation functionality

## [0.0.1] - 2025-07-17

### Added
- Initial project structure

---

## Links

- **Repository**: [gotalab/open-sdd](https://github.com/gotalab/open-sdd)
- **npm Package**: [open-sdd](https://www.npmjs.com/package/open-sdd)
- **Release Notes**:
  - [Japanese](docs/RELEASE_NOTES/RELEASE_NOTES_ja.md)
  - [English](docs/RELEASE_NOTES/RELEASE_NOTES_en.md)
- **Documentation**:
  - [English](tools/open-sdd/README.md)
  - [Japanese](tools/open-sdd/README_ja.md)
  - [Traditional Chinese](docs/README/README_zh-TW.md)

---
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
