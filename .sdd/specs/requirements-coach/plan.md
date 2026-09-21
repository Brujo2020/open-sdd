# Plan: requirements-coach

> Canonical name for this document is `plan.md`; `design.md` is an accepted alias of the same file
> (`tools/open-sdd/src/core/triad.ts`). This is workstream W3 of `docs/EVOLUTION-PLAN.md`.

_Constitution: C-STACK-FACT, C-API-COMPAT, C-BOUNDARIES, C-REGRESSION-ORACLE_

## Problem

The tool checks the *shape* of a requirement (EARS: one trigger template, a `shall`, no vague term)
and nothing else. `ears.ts` implements seven diagnostics; `earsAssistant.ts` can rewrite a
requirement; `assistants.ts` decides when to surface a suggestion. Everything else that makes a
requirement usable — singularity, verifiability, units, tolerance, escape clauses, open-ended lists,
NFR measurability, traceability, and the AI-specific hazards — is not checked at all, and the
definitions of "done" survive only as prose.

`docs/guides/requirements-quality-catalog.md` now stores the best practice: **42 checks in 8
families**, each with a severity tier, a detection, a worked example, a rewrite playbook with its
ASK-THE-HUMAN triggers, and definitions of done for a requirement and for a set. This spec makes it
run.

The evidence that shapes the design:

- The best off-the-shelf model detects **47 % of expert-identified requirement issues at 11 %
  false-flag**, and misses necessity and correctness almost always (arXiv 2609.03230), while LLM
  support *reduced* human inspection accuracy (arXiv 2608.21298). So a model may advise and may not
  gate.
- Femmer et al.'s per-smell precision runs from **0.96 (Subjective) to 0.26 (Vague Pronouns)**. So
  only deterministic, high-confidence defects start near blocking; the rest stay advisory until a
  project's own adjudication history proves them.
- Femmer's stated goal is awareness plus transparent reasoning, not enforcement — which is the
  existing allowlist shape, not a second suppression path.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Where the checks live | The `standards-engine` catalogue | One source of truth; the coach consumes entries, it does not hard-code checks |
| Who may block | Deterministic S1/S2 checks only | The measured model profile; OWASP LLM01's own mitigation is deterministic validation |
| Model backend | Ollama, local, offline (decision 2) | The deterministic core stays complete with no network; a model only adds judgement |
| Default severity | Advisory until a corpus is measured (decision 3) | Femmer's precision spread; the C4 false-positive lesson |
| Locales | `es` and `en`; any other is refused by name (decision 1) | "Silence is not a verdict": an accepted-but-untranslated locale is a silent lie |
| Suppression | The existing allowlist, with reason, owner and expiry | One adjudication channel; reused, not duplicated |

## Design

### Detection first, judgement second

```
deterministic check  ->  S1/S2 finding (may block)   ->  remedy (graded) or question
model critique       ->  S3 advisory (never blocks)  ->  proposed rewrite + confidence + basis
```

The coach always knows which instrument produced a finding and says so (`REQ-RQC-002`). A model
critique that is used as evidence carries an I6 receipt recording the model and the mode
(`REQ-RQC-011`).

### The check families and their defaults

| Family | Examples | Default tier |
|---|---|---|
| EARS / statement | `EARS-001` no modal, `EARS-006` condition outside the statement | S1–S3 |
| Ambiguity | `AMB-003` escape clause (S1), `AMB-007` vague pronoun (S3, P 0.26) | mixed |
| Singularity | `SIN-001` compound (S1), `SIN-007` negation (S2, suppressed inside a condition) | mixed |
| Verifiability | `VER-001` no measurable outcome, `VER-006` restated acceptance criterion (S1) | S2–S1 |
| Set-level | `SET-005` orphan, `SET-006` no downstream evidence | S2 |
| NFR measurability | `NFR-001` no response measure, `NFR-002` no percentile/window | S2–S3 |
| Traceability | `TRC-002` dangling link (S1) | S1–S3 |
| AI-specific | `AI-002` injection-shaped content (S1), `AI-003` unfalsifiable AC (S1) | S1–S3 |

### The three surfaces

1. **`requirements review <feature>`** — runs the applicable checks, prints findings with their span,
   basis, remedy and alternatives, and records the adjudication.
2. **`requirements checklist <feature>`** — items are predicates (`cmd`, `artifact`, `property`,
   `trace`); `checklist verify` executes them and stores a digest, reusing C3's evidence store. A
   `[x]` without a digest fails the commit gate (`REQ-RQC-005`). This is what turns "unit tests for
   English" into tests *of* the English.
3. **`review <feature> --base <ref>`** — one page: word-level requirement diffs, each with its tasks,
   the tests that would fail (`brownfield contracts`) and a risk score; exits non-zero on an
   unapproved change (`REQ-RQC-009`).

### Abstention and injection

ASK-THE-HUMAN triggers produce a question naming the missing datum (`REQ-RQC-006`). Spec content is
untrusted: `AI-002` flags instruction-shaped text and the reviewer runs without secrets and without
egress (`REQ-RQC-010`), which the local Ollama backend makes the default rather than a promise.

### Locale contract

Console prose follows `es`/`en`. Check ids, `REQ-<AREA>-<NNN>`, JSON keys and the commands inside a
fix stay English under every locale; a third locale is refused by name with the list of translated
ones (`REQ-RQC-012`).

## Boundaries

- New modules: `tools/open-sdd/src/core/requirementsCoach.ts`,
  `tools/open-sdd/src/core/checklist.ts`, `tools/open-sdd/src/core/specReview.ts`, and a console at
  `tools/open-sdd/src/cli/commands/requirements.ts`.
- Reuses the catalogue, the finding shape, the evidence store (C3), the assistant ledger and the
  contracts oracle; it introduces none of them (`C-BOUNDARIES`, SHOULD).
- No new dependency (`C-STACK-FACT`): the deterministic checks are TypeScript; the model client
  arrives in W5 and is optional.

## Public API and the regression oracle

- Additive only (`C-API-COMPAT`): new exports and a new subcommand. `brownfield requirements` keeps
  its current behaviour and is not replaced.
- `C-REGRESSION-ORACLE`: the existing suite must keep passing, and `test/coreEars.test.ts` is the
  contract that the C1 requirements subset does not change the verdict of an already-conforming spec.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Let the model do the whole review | 47 % detection, 11 % false-flag, necessity/correctness missed, and it degrades human inspection |
| Add the 42 checks as independent gates | Ceremony; the measured precision spread means most must stay advisory |
| A separate checklist mechanism | The C3 evidence store already exists; a second one would drift |
| Ship all 13 locales | Refusing by name is honest and cheap; translation breadth is not the moat (decision 1) |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Too many advisory findings (noise) | Order by severity and by what unblocks the next phase; one line each; dedupe by the assistant ledger; measured precision stated on every finding |
| The coach becomes an authority it is not | `REQ-RQC-011`: it reports what passed and what was adjudicated, never "correct" |
| Rewrites change meaning silently | Remedies are graded; only `machine-applicable` auto-apply |
| Injection through a spec | `AI-002` plus no secrets and no egress in the reviewer; escalation to a human, never silent compliance |
