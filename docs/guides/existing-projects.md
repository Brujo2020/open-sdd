# Existing projects (brownfield)

The on-ramp for a real codebase you did not start with `open-sdd`. The rule that governs everything
below:

> The existing code is the de-facto source of truth: **do not reinvent the architecture, govern it.**

That means the unit of specification is not the system — it is the **delta**: the artifact that
describes only what changes. Writing down the spec of a whole existing system is exactly what
brownfield cannot afford, so the system is *read* (recon + constitution) and the change is
*specified* separately. This page is the path; the protocol lives in the `/sdd-brownfield` skill.

Prerequisites, all install paths and the pre-publication caveats are in [Install](../INSTALL.md). Run
every command from the root of the repository you are governing.

## The 5 steps

| Step | Command | What it produces |
|---|---|---|
| 1. Recon | `open-sdd brownfield bootstrap .` | stack, module map, evidence, and the ordered plan (add `--write` to store the intelligence document) |
| 2. Constitution draft | `open-sdd brownfield constitution . --draft --write` | a **descriptive** constitution: the principles the code already obeys, each with evidence; desired-but-absent practices become proposed amendments |
| 3. Ratify | `open-sdd govern constitution --ratify --by "<name>" --rationale "<text>" --write` | the constitution enters into force with a named human behind it |
| 4. Delta | `open-sdd delta init <feature> "what changes"` then `open-sdd delta validate <feature>` | the contract of change (ADSR sections, delta-scoped `REQ-<AREA>-<NNN>` ids) |
| 5. Check | `open-sdd status <feature> --check`, `open-sdd brownfield impact\|contracts\|reuse <feature>`, `open-sdd govern rigor` | constitutional alignment, blast radius, regression oracle, reuse candidates, rigor verdict |

Then `open-sdd status` is the single dashboard: constitution, every spec, the delta, the contracts,
the constitutional alignment, the rigor level and the next command to run.

The expanded version — real output from this repository, the FAQ and the honest limits — is
[Brownfield in 10 minutes](brownfield-quickstart.md). The 60-second demo
([Quickstart](quickstart-60s.md)) shows the same engine detecting four real incoherences in a
throwaway repo.

### Ratifying is a human gate, not a formality

A descriptive constitution is evidence, not opinion: a principle without evidence is a validation
error, and a practice the code does **not** show is emitted as a **proposed amendment**, never as a
fact. The draft is incomplete until a named person ratifies it. Until then the constitution is not in
force, and `status --check` says so instead of pretending otherwise.

### The constitution is the pivot

Every spec is validated against the constitution with `open-sdd status <feature> --check`. A spec
that cites a principle which is not in force is a **phantom authority** (error, exit 1); a spec that
cites none leaves the pivot unused (warning); a requirement that contradicts a `MUST` is reported as
such. `open-sdd govern constitution --matrix` publishes the principle → artifact coverage so you can
see which principles are backed by a real `file:line` and which are not.

## What it reads, and what it never touches

**Reads:** manifests and lockfiles, the build tool and test runner in use, module boundaries and the
import graph, the working diff and its history, and your `.sdd/` specs — nothing else.

**Writes:** only under `.sdd/` (the intelligence document, the constitution, `rigor.json`) and the
agent's skill directory, and only when you pass the writing flag. Existing files are reported
`keep`; `brownfield constitution` refuses to touch a constitution that already exists and puts its
draft beside it.

**Never touches:** your source code, your tests, your build files. No command rewrites a file it did
not create. The impact, contracts and reuse reports are read-only (`contracts --write` stores its
report in the spec directory).

## How long it takes

The repository publishes no brownfield timing benchmark, and inventing one would break its own rule,
so here is the structural answer instead of a number:

- **Machine time** is one command per step. Recon, constitution draft, delta validation and the
  reports are deterministic console runs; run `open-sdd brownfield survey .` and it prints exactly
  what it scanned.
- **Human time** is the real cost, and it is deliberate: reviewing the constitution draft before
  ratifying it, and reviewing the delta before writing code. That review *is* the gate; skipping it
  is what makes a spec decorative.

The only timed artifact in this project is the demo, and its repository is synthetic — see
[Measurements](../MEASUREMENTS.md) for what those numbers are and are not.

## What to expect on a big monorepo

- **Node / TypeScript workspaces:** the module map is real. Discovery builds workspace roots from
  `package.json` `workspaces` plus conventional directories that contain a `package.json`, and the
  map answers "where does new code go?" per module.
- **Everywhere else:** module discovery returns **one root module**. There is no Maven/Gradle, Go,
  Rust-workspace or Python-monorepo discovery, so `go.mod` and `Cargo.toml` are recognised as build
  tools for a single project, not as workspace declarations. The honest output on those repositories
  is "one root module", not a fabricated decomposition. This is declared as gap **G-21** in
  [Paper alignment](../PAPER-ALIGNMENT.md).
- **Multi-language repositories:** the stack detection names the language/build tooling it observes,
  but the *decomposition* is the Node-only part above. A polyglot monorepo whose roots are not
  `package.json` files is read as a single module.
- The constitution uses a boundary vocabulary that is not identical to the module map's (gap
  **G-22**), so expect two views of "boundary", each internally consistent.

## What it does not do

Honesty first. These are the real limits today, each with its numbered gap in
[Paper alignment](../PAPER-ALIGNMENT.md):

- **Behaviour is declared, not extracted from code.** Recon gives you the map and the evidence, not
  the system's runtime behaviour. The delta's requirements are authored by you (or by the agent
  proposing them) and reviewed; the tool does not mine behavioural specs out of the source.
- **A delta is never merged back into the base spec** (G-17). `merged` is a label an author types
  into `delta.md`, not a state a command produces. Nothing rewrites the base `requirements.md` from
  the ADSR entries, applying a delta is manual, and drift between the delta and the base is not
  checked.
- **The impact analysis has known false-positive classes** (G-19). Four remain, verified in the code:
  a public-API entry point changed but declared `ADDED`; an `ADDED` target that legitimately does not
  exist yet; build artifacts under `tools/open-sdd/dist/**` counted as undeclared scope; and the
  module-level assumption that its caller passes files rather than directories (fixed at the CLI
  layer, still true of the module). `brownfield impact` is therefore a **review aid with a known
  false-positive rate, not a gate** — deliberately not wired into CI (G-18).
- **Execution-contract verification is not in CI** (G-15). The regression oracle runs when someone
  passes `contracts --verify`; a green test run with a declared contract missing is **not** a pass,
  which is why the command exits non-zero in that case.
- **The constitution matrix and `status --check` do not block anything** by themselves (G-16): no gate
  fails because a principle has no artifact. They are reports a reviewer reads.
- **`bootstrap --write` writes two of the three artifacts its own plan announces** (G-20): the
  intelligence document and the constitution (only when missing). The delta seed it lists is a
  **step**, created by `delta init`, not a write.
- **The paper's prototype measurements are not measurements of this repository** (G-01/G-02). Do not
  quote them as ours.

## Next

- [Brownfield in 10 minutes](brownfield-quickstart.md) — the same path with real output and an FAQ.
- [Upgrade](upgrade.md) — refresh the artifacts on an existing install.
- `/sdd-brownfield` — the skill that teaches this flow inside the agent's chat.
- `/sdd-getspecs` — the broader bootstrap that reverse-engineers steering and editable spec seeds for
  the whole project; it complements this flow rather than replacing it.
