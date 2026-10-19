# Standards engine (W2)

The best practice that used to live only as prose under `.sdd/settings/rules/` is now **data** under
`.sdd/settings/standards/`, and data can be run. This guide is the operator's view; the specification
is [`.sdd/specs/standards-engine/`](../../.sdd/specs/standards-engine/requirements.md) and the plan is
in [`docs/EVOLUTION-PLAN.md`](../EVOLUTION-PLAN.md) (workstream W2).

## The one rule that governs everything: advisory until calibrated

A standard **cannot block** until it declares a measured corpus. `isBlocking(entry)` is the single
place that decides, and it requires `calibrated.corpus` to be a non-null string. Every entry that
ships today has `blocking: false` and `corpus: null`, so every finding is advisory: it is reported,
it carries a remedy, and it does not fail the chain.

That is deliberate. The measured record is blunt — an off-the-shelf model detected 47 % of
expert-identified requirement issues at 11 % false-flag, and Femmer's per-smell precision runs from
0.96 to 0.26 — so a check earns the right to block by being measured on this repository's own corpus,
not by looking reasonable.

## The console

```bash
open-sdd standards list                    # every entry: id, severity, advisory, title
open-sdd standards show REQ-EARS-001       # the full entry, including its source
open-sdd standards explain REQ-EARS-001    # offline; the same, for a reader in a hurry
open-sdd standards check                   # run the catalogue over the declared artifacts
open-sdd standards check --json            # the same inside the single JSON envelope
open-sdd standards fix REQ-EARS-010        # preview the remedy; --apply writes only safe ones
```

`check` reports, per finding: the standard id, the severity, `file:line:column`, the span, a message
and at least one **remedy** or an explicit **question**. A finding with neither is a bug, and a test
(`test/coreStandardsDeadEnds.test.ts`) enumerates the catalogue and fails if one could exist.

Remedies are graded: `machine-applicable` (safe to auto-apply), `maybe-incorrect` (preview first) and
`needs-human` (the honest answer is a question, not a rewrite). `fix --apply` applies only the first,
and it refuses a `needs-human` remedy by returning its text as the question.

## How a finding reaches the gate chain

Two places, both **advisory in fact**:

- **C1** runs the `category === 'requirements'` subset over the spec's `requirements.md` and appends
  its findings to C1's detail and evidence. C1's verdict is unchanged: the findings are named and do
  not fail the chain.
- **C8 Standards Conformance** is a control of its own, declared as an **extension beyond the
  paper's catalog** (`imposes: []`, so it adds no crosswalk coverage). It discovers the artifacts the
  catalogue declares and runs every applicable entry. Only a **calibrated** standard can make C8
  fire; until then it reports `0 bloqueante(s), N advisory`.

A standard that cannot inspect its artifact is reported **`skipped`**, never passed — an `ok` over
something nobody looked at is the defect this project removes everywhere.

## Adding a standard

Create one JSON file per standard under `.sdd/settings/standards/` (and mirror it under
`tools/open-sdd/templates/shared/settings/standards/` if it should ship to every project):

```json
{
  "id": "REQ-XXX-001",
  "title": "…",
  "category": "requirements",
  "severity": "warning",
  "blocking": false,
  "appliesTo": ["requirements.md", "delta.md"],
  "standard": "EARS",
  "source": "https://… or the rule-file anchor",
  "detect": { "kind": "regex", "patterns": ["…"] },
  "message": "…",
  "remedy": { "autoFixable": false, "grades": [{ "grade": "needs-human", "text": "…" }] },
  "evidence": "the module/symbol that implements the check",
  "calibrated": { "corpus": null, "recall": null, "fpr": null }
}
```

A required field that is missing gets the entry **rejected by name** (`file#id`), never silently
skipped: `loadStandards` returns `rejected[]` and the console shows it.

## The prose is generated from the catalogue

`rules/*.md` can be rendered from the catalogue (`renderRules`), and `standards check` reports any
file whose rendered block is absent or different, naming the entries that disagree. Today it reports
two drifted files (`ears-format.md`, `requirements-review-gate.md`) and **does not overwrite them**;
switching the real files to generated form is a content decision recorded as an open task in the
spec, not a missing capability.

## Honest limits

- No calibration corpus exists yet, so nothing may be promoted to blocking.
- The renderer reports drift but the repository's `rules/*.md` are still hand-written.
- Adjudication reuses the existing allowlist (reason, owner, expiry); the "an unused suppression is
  reported" half of that requirement is still open.
- The drift sentinel, stable block-allocated identifiers and the reuse gate are specified but not
  implemented; each is declared open in
  [`tasks.md`](../../.sdd/specs/standards-engine/tasks.md).
