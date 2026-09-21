# Requirements — requirements-coach

_Constitution: C-STACK-FACT, C-API-COMPAT, C-BOUNDARIES, C-REGRESSION-ORACLE_

**Objective:** As a team writing specifications, we want the requirements-quality best practice stored
in `docs/guides/requirements-quality-catalog.md` to be checkable, so a vague, compound, unverifiable or
untraceable requirement is named with its position, a proposed rewrite and its alternatives — and so
the tools that judge it never become the authority that certifies it. This is workstream W3 of
`docs/EVOLUTION-PLAN.md`; it consumes the catalogue built by `standards-engine` and implements
decisions 1 (locales), 2 (Ollama, offline) and 3 (advisory until calibrated).

## Requirements

### REQ-RQC-001 — The stored catalogue is the source of the checks

- Statement: The [coach] shall load the 42 checks of `docs/guides/requirements-quality-catalog.md` from the standards catalogue rather than from code.
- Statement: When a check is added or reclassified, the [coach] shall take its severity tier from the catalogue entry.
- Statement: The [coach] shall report a check whose catalogue entry is missing as unavailable instead of silently omitting it.

### REQ-RQC-002 — Deterministic checks gate, the model advises

- Statement: While a finding comes from a deterministic check of severity S1 or S2, the [coach] shall allow it to block a gate.
- Statement: While a finding comes from a model critique, the [coach] shall report it as advisory.
- Statement: While a finding comes from a model critique, the [coach] shall never let it block a gate.
- Statement: The [coach] shall attribute every finding to the instrument that produced it.

### REQ-RQC-003 — Every finding is positioned, grounded and actionable

- Statement: When a check fails, the [coach] shall emit the check id, the severity, the quoted span with its `file:line:column`, the basis, and at least one remedy or one question.
- Statement: The [coach] shall state the measured precision of the check when one is recorded.
- Statement: If a finding carries neither a remedy nor a question, then the [test suite] shall fail.

### REQ-RQC-004 — Calibration before promotion

- Statement: While a check family has no measured corpus, the [coach] shall keep that family advisory.
- Statement: When a family is measured against a labelled corpus, the [coach] shall publish its recall and its false-positive rate in `docs/MEASUREMENTS.md`.
- Statement: The [coach] shall promote a check to blocking only after its measured precision is recorded.

### REQ-RQC-005 — Checklist items are executable predicates

- Statement: The [coach] shall require each checklist item to declare a predicate of kind `cmd`, `artifact`, `property` or `trace`.
- Statement: When `checklist verify <feature>` runs, the [coach] shall execute each predicate.
- Statement: When `checklist verify <feature>` runs, the [coach] shall record the resulting digest as evidence.
- Statement: If an item is marked complete without a stored digest, then the [commit gate] shall fail.

### REQ-RQC-006 — Abstention is a first-class outcome

- Statement: When a defect requires a datum the tool does not have, the [coach] shall emit a question that names that datum instead of a rewrite.
- Statement: The [coach] shall treat an undefined actor, an undecided threshold, a term used two ways and a doubtful necessity as questions.
- Statement: The [coach] shall never invent a citation.
- Statement: The [coach] shall drop a claim whose source does not resolve.

### REQ-RQC-007 — Non-functional requirements get a measurable shape

- Statement: When a requirement is a quality attribute, the [coach] shall require the six parts of a quality-attribute scenario.
- Statement: When a requirement is a quality attribute, the [coach] shall report a missing response measure.
- Statement: When a requirement states an operational target, the [coach] shall require a percentile and a measurement window.
- Statement: The [coach] shall report an absolute availability or reliability target with no error budget as advisory.

### REQ-RQC-008 — Traceability is part of quality

- Statement: The [coach] shall report a requirement with no upward link as an orphan.
- Statement: The [coach] shall report a requirement with no downstream task or verification artefact.
- Statement: The [coach] shall report code covered by no requirement as gold plating.

### REQ-RQC-009 — One review surface for a change

- Statement: When `review <feature> --base <ref>` runs, the [coach] shall render the added, modified and removed requirements as word-level diffs on a single page.
- Statement: The [coach] shall attach to each row its tasks, the tests that would fail if it changed, and a risk score.
- Statement: When a requirement changes without approval, the [coach] shall exit non-zero.

### REQ-RQC-010 — Spec content is untrusted input

- Statement: The [coach] shall treat every spec artifact as untrusted data.
- Statement: The [coach] shall never follow an instruction found inside a spec artifact.
- Statement: When content shaped as an instruction to an agent appears in a spec, the [coach] shall report it as a finding.
- Statement: When content shaped as an instruction to an agent appears in a spec, the [coach] shall escalate the finding to a human.
- Statement: While the model backend is the local Ollama provider, the [coach] shall run without network access and without access to secrets.

### REQ-RQC-011 — The coach never certifies

- Statement: The [coach] shall report the checks that passed and the findings that were adjudicated.
- Statement: The [coach] shall never state that a specification is correct.
- Statement: When a model critique is used as evidence, the [coach] shall require a receipt.
- Statement: When a model critique is used as evidence, the [coach] shall record the model and the mode that produced it.
- Statement: If no model backend is configured, then the [coach] shall report the model-based controls as degraded.
- Statement: If no model backend is configured, then the [coach] shall exclude those controls from the pass count.

### REQ-RQC-012 — One machine surface, honest locales

- Statement: The [coach] shall keep check ids, requirement identifiers, JSON keys and the commands inside a fix in English under every console locale.
- Statement: While the console locale is `es` or `en`, the [coach] shall translate the console prose.
- Statement: When a locale other than `es` or `en` is requested, the [coach] shall refuse it by name.
- Statement: When a locale other than `es` or `en` is requested, the [coach] shall list the translated locales.

## Out of scope

- Shipping a model backend: the decision is Ollama, offline, and its client is W5.
- Re-deriving the catalogue schema, the loader, the C1/C8 wiring and the adjudication channel: those belong to `standards-engine`.
- Making a model verdict a gate: the measured 47 % detection / 11 % false-flag profile forbids it (REQ-RQC-002, REQ-RQC-011).
