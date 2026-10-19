# Requirements Review Gate

Before writing `requirements.md`, review the draft requirements and repair local issues until the draft passes or a true scope ambiguity is discovered.

## Boundary Continuity

Use boundary terminology consistently across phases without turning requirements into design:

- **Discovery** identifies `Boundary Candidates`
- **Requirements** make inclusion, exclusion, and adjacent expectations explicit when scope could be misread
- **Design** turns those into `Boundary Commitments`
- **Tasks** use `_Boundary:_` to constrain executable work

Requirements should clarify the feature boundary in user- or operator-observable terms, not in architecture ownership or implementation detail.

## Scope and Coverage Review

- The draft must cover the feature's core user journeys, major scope boundaries, primary error cases, and meaningful edge conditions that are visible to the user or operator.
- If the feature touches adjacent systems, specs, or workflows, the draft must make clear what this feature expects from them and what it does not own when that distinction affects user-visible behavior or operator expectations.
- Business/domain rules, compliance constraints, security/privacy expectations, and operational constraints that materially shape user-visible behavior must be reflected explicitly when they are in scope.
- If coverage is missing because the draft is incomplete, repair the draft and review again.
- If coverage cannot be completed cleanly because the project description or steering context is ambiguous, contradictory, or underspecified, stop and ask the user to clarify instead of guessing.

## EARS and Testability Review

- Every acceptance criterion must follow the EARS rules defined in `ears-format.md`.
- Every requirement must be testable, observable, and specific enough that later design and validation can verify it.
- Remove implementation details that belong in `design.md` rather than `requirements.md`.
- Requirement headings must use numeric IDs only; do not mix numeric and alphabetic labels.

## Structure and Quality Review

- Group related behaviors into coherent requirement areas without duplicating the same obligation across multiple sections.
- Make inclusion/exclusion boundaries explicit when the feature scope could otherwise be misread.
- Keep boundary statements lightweight and observable: describe feature responsibility and adjacent expectations without prescribing components, layers, or internal ownership.
- Ensure non-functional expectations remain user-observable or operator-observable; move technology choices and internal architecture detail out of requirements.
- Normalize vague language such as "fast", "robust", or "secure" into concrete user-visible expectations whenever the source material supports it.

## Mechanical Checks

Before applying judgment, verify these mechanically:
- **Numeric IDs present**: Every requirement heading has a numeric ID (1, 1.1, 2, etc.). Scan the draft for headings without IDs.
- **Acceptance criteria exist**: Every requirement has at least one EARS-format acceptance criterion. Scan for requirements with no "When/If/While/Where" acceptance statements.
- **No implementation language**: Scan for technology-specific terms (database names, framework names, API patterns) that belong in design, not requirements. Flag any found.

## Review Loop

- Run mechanical checks first, then judgment-based review.
- If issues are local to the draft, repair the draft and re-run the review gate.
- Keep the loop bounded: no more than 2 review-and-repair passes before escalating a real ambiguity back to the user.
- Write `requirements.md` only after the review gate passes.

<!-- GENERATED from .sdd/settings/standards by tools/open-sdd/src/core/standardsRender.ts; edit the catalogue entry, not this file -->

## Generated standards

<!-- standards:REQ-GATE-001:begin -->
## REQ-GATE-001 — Requirement headings declare a numeric identifier

- **Category:** `requirements`
- **Severity:** `warning` (advisory until a measured corpus exists)
- **Applies to:** `requirements.md`, `delta.md`
- **Standard:** internal
- **Source:** `.sdd/settings/rules/requirements-review-gate.md#mechanical-checks`
- **Detection:** `structural` — `requirements-numeric-ids`
- **Message:** un encabezado de requisito no declara identificador numérico
- **Evidence:** `tools/open-sdd/src/core/standards.ts#runStandard (structural:requirements-numeric-ids)`
- **Calibration:** not measured
- **Remedies:**
  - `maybe-incorrect` — asigna al encabezado un identificador numérico estable, por ejemplo `REQ-AREA-001` o `1.2`
  - `needs-human` — si el encabezado no es un requisito sino una sección del documento, bájalo a nivel 2
<!-- standards:REQ-GATE-001:end -->
<!-- standards:REQ-GATE-002:begin -->
## REQ-GATE-002 — Every requirement has an EARS acceptance criterion

- **Category:** `requirements`
- **Severity:** `warning` (advisory until a measured corpus exists)
- **Applies to:** `requirements.md`, `delta.md`
- **Standard:** internal
- **Source:** `.sdd/settings/rules/requirements-review-gate.md#mechanical-checks`
- **Detection:** `structural` — `requirements-acceptance-criteria`
- **Message:** la sección de requisito no contiene ningún criterio de aceptación conforme a EARS
- **Evidence:** `tools/open-sdd/src/core/standards.ts#runStandard (structural:requirements-acceptance-criteria)`
- **Calibration:** not measured
- **Remedies:**
  - `maybe-incorrect` — añade al menos un criterio con una plantilla EARS y un único disparador
  - `needs-human` — si el requisito no es verificable, reformúlalo o retíralo antes de añadir un criterio
<!-- standards:REQ-GATE-002:end -->
<!-- standards:REQ-GATE-003:begin -->
## REQ-GATE-003 — Requirements avoid implementation language

- **Category:** `requirements`
- **Severity:** `info` (advisory until a measured corpus exists)
- **Applies to:** `requirements.md`, `delta.md`
- **Standard:** internal
- **Source:** `.sdd/settings/rules/requirements-review-gate.md#mechanical-checks`
- **Detection:** `regex` — `\b(?:PostgreSQL|Postgres|MySQL|MariaDB|MongoDB|SQLite|Redis|Elasticsearch|Kafka|RabbitMQ|Memcached)\b`, `\b(?:React|Angular|Vue(?:\.js)?|Svelte|Django|Flask|Rails|Laravel|Spring\s+Boot|Express(?:\.js)?|Next\.js|NestJS)\b`, `\b(?:Kubernetes|Docker|Terraform|Ansible|AWS|Azure|GCP)\b`
- **Message:** el requisito nombra una tecnología concreta que pertenece a `plan.md`, no a `requirements.md`
- **Evidence:** `tools/open-sdd/src/core/standards.ts#runStandard (regex)`
- **Calibration:** not measured
- **Remedies:**
  - `maybe-incorrect` — sustituye el nombre del producto por la capacidad observable que el requisito exige
  - `needs-human` — si la tecnología es una restricción de alcance, muévela a `plan.md` o declara la excepción con motivo
<!-- standards:REQ-GATE-003:end -->
<!-- standards:REQ-GATE-004:begin -->
## REQ-GATE-004 — Requirement headings do not mix alphabetic and numeric labels

- **Category:** `requirements`
- **Severity:** `warning` (advisory until a measured corpus exists)
- **Applies to:** `requirements.md`, `delta.md`
- **Standard:** internal
- **Source:** `.sdd/settings/rules/requirements-review-gate.md#ears-and-testability-review`
- **Detection:** `regex` — `^#{1,6}\s+[A-Za-z]{1,3}\d+\b`, `^#{1,6}\s+(?:Requirement|Requisito|Section|Sección)\s+\d`
- **Message:** un encabezado mezcla etiqueta alfabética y numérica: usa solo identificadores numéricos
- **Evidence:** `tools/open-sdd/src/core/standards.ts#runStandard (regex)`
- **Calibration:** not measured
- **Remedies:**
  - `maybe-incorrect` — vuelve el encabezado a un identificador numérico, por ejemplo `3.` o `REQ-AREA-003`
  - `needs-human` — si el identificador alfabético ya está en uso, decide la renumeración antes de cambiarlo: un identificador no se renumera en silencio
<!-- standards:REQ-GATE-004:end -->
