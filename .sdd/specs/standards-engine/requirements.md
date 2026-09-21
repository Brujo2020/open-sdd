# Requirements — standards-engine

_Constitution: C-STACK-FACT, C-API-COMPAT, C-BOUNDARIES, C-REGRESSION-ORACLE_

**Objective:** As the maintainers of a governed repository, we want the best practice that today lives
as prose under `.sdd/settings/rules/` to become a machine-checkable catalogue wired into the gate
chain, so a violation is reported with its position, a remedy and its alternatives instead of being
advice someone must remember. This is workstream W2 of `docs/EVOLUTION-PLAN.md`; it implements
decisions 3 (advisory until calibrated) and 4 (spec before the gate chain).

## Requirements

### REQ-STD-001 — One machine-readable catalogue

- Statement: The [standards engine] shall read a catalogue from `.sdd/settings/standards/**` in which each entry declares an id, a category, a severity tier, a detection, a remedy, alternatives, a source and the evidence that implements it.
- Statement: When a catalogue entry omits a required field, the [engine] shall reject that entry by name.
- Statement: If an entry cites a standard, then the [engine] shall carry the source reference it declares.

### REQ-STD-002 — The prose is generated from the catalogue

- Statement: The [engine] shall render the documents under `.sdd/settings/rules/` from the catalogue so that a rule and its prose cannot drift.
- Statement: When a rendered rule file differs from the catalogue, the [engine] shall report the file as drifted, naming the entry that disagrees.

### REQ-STD-003 — A console to inspect and run the standards

- Statement: The [CLI] shall expose `standards list`, `standards show <id>`, `standards explain <id>`, `standards check` and `standards fix <id>`.
- Statement: When `standards check` runs with `--json`, the [CLI] shall emit one record per finding inside the single existing JSON envelope.
- Statement: When `standards explain <id>` runs, the [CLI] shall resolve the standard offline without a network call.

### REQ-STD-004 — Every finding is actionable

- Statement: When a standard fails, the [engine] shall emit at least one remedy or an explicit question that names the missing datum.
- Statement: If an emitted finding carries neither a remedy nor a question, then the [test suite] shall fail.

### REQ-STD-005 — Advisory until calibrated

- Statement: While a standard declares no measured corpus, the [engine] shall report its findings as advisory rather than blocking a gate.
- Statement: When a standard declares a calibrated corpus, the [engine] shall report its recall and its false-positive rate alongside the finding.
- Statement: The [engine] shall require a measured corpus before a standard may be marked blocking.

### REQ-STD-006 — Wired into the gate chain

- Statement: The [engine] shall run the requirements subset of the catalogue as part of C1.
- Statement: The [engine] shall expose the remaining standards as an advisory C8 control of `gates run`.
- Statement: If a standard cannot inspect its artifact, then the [engine] shall report that control as skipped instead of passed.

### REQ-STD-007 — Adjudication with a reason and an expiry

- Statement: When a finding is waived, the [allowlist] shall require a reason, an owner and an expiry date.
- Statement: The [engine] shall report a suppression that no longer matches any finding.
- Statement: If a declared waiver has expired, then the [engine] shall stop applying it.
- Statement: If a declared waiver has expired, then the [engine] shall name it in the report.

### REQ-STD-008 — Remedies are graded

- Statement: The [engine] shall grade each remedy as `machine-applicable`, `maybe-incorrect` or `needs-human`.
- Statement: When `standards fix --apply` runs, the [engine] shall apply only remedies graded machine-applicable.
- Statement: The [engine] shall never apply a remedy that changes the meaning of a spec artifact without an explicit human confirmation.

### REQ-STD-009 — Failure is loud and positioned

- Statement: When a format rule fails, the [engine] shall name the file, the line, the column and the fix.
- Statement: The [engine] shall never reject a document without naming the rule that rejected it.

### REQ-STD-010 — A change no requirement covers is visible

- Statement: When a commit touches a path that no requirement's declared globs cover, the [drift check] shall report that path.
- Statement: While the declared rigor level is spec-first, the [drift check] shall report as advisory.
- Statement: When a drift waiver is declared, the [waiver] shall require a reason, an owner and an expiry date.

### REQ-STD-011 — Identifiers are stable

- Statement: The [engine] shall allocate requirement identifiers in blocks per area.
- Statement: The [engine] shall never renumber an existing identifier.
- Statement: When an existing identifier's statement changes without a corresponding MODIFIED entry, the [ids audit] shall report `ID-MUTATED`.
- Statement: When an identifier disappears without a REMOVED entry, the [ids audit] shall report `ID-LOST`.

### REQ-STD-012 — Reuse is checked before a new symbol is declared

- Statement: The [engine] shall build a symbol index from the repository before a change is validated.
- Statement: While the reuse standard is uncalibrated, the [engine] shall report a newly declared symbol with no reuse evidence as advisory.
- Statement: The [engine] shall report a newly declared symbol whose signature resembles an indexed symbol as a candidate, with the candidate's location.

## Out of scope

- Delivering the AI critique: this spec is deterministic; the model layer is W5 (`docs/EVOLUTION-PLAN.md`) and its backend decision is Ollama, offline, configured later.
- Rendering the 42 requirement checks themselves: they belong to `requirements-coach`, which consumes this catalogue.
- Making any C8 or C1 check blocking: blocking is earned by calibration (REQ-STD-005).
