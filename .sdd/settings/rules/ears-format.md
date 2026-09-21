# EARS Format Guidelines

## Overview
EARS (Easy Approach to Requirements Syntax) is the standard format for acceptance criteria in spec-driven development.

EARS patterns describe the logical structure of a requirement (condition + subject + response) and are not tied to any particular natural language.  
All acceptance criteria should be written in the target language configured for the specification (for example, `spec.json.language` / `{{LANG_CODE}}`).  
Keep EARS trigger keywords and fixed phrases in English (`When`, `If`, `While`, `Where`, `The system shall`, `The [system] shall`) and localize only the variable parts (`[event]`, `[precondition]`, `[trigger]`, `[feature is included]`, `[response/action]`) into the target language. Do not interleave target-language text inside the trigger or fixed English phrases themselves.

## Primary EARS Patterns

### 1. Event-Driven Requirements
- **Pattern**: When [event], the [system] shall [response/action]
- **Use Case**: Responses to specific events or triggers
- **Example**: When user clicks checkout button, the Checkout Service shall validate cart contents

### 2. State-Driven Requirements
- **Pattern**: While [precondition], the [system] shall [response/action]
- **Use Case**: Behavior dependent on system state or preconditions
- **Example**: While payment is processing, the Checkout Service shall display loading indicator

### 3. Unwanted Behavior Requirements
- **Pattern**: If [trigger], the [system] shall [response/action]
- **Use Case**: System response to errors, failures, or undesired situations
- **Example**: If invalid credit card number is entered, then the website shall display error message

### 4. Optional Feature Requirements
- **Pattern**: Where [feature is included], the [system] shall [response/action]
- **Use Case**: Requirements for optional or conditional features
- **Example**: Where the car has a sunroof, the car shall have a sunroof control panel

### 5. Ubiquitous Requirements
- **Pattern**: The [system] shall [response/action]
- **Use Case**: Always-active requirements and fundamental system properties
- **Example**: The mobile phone shall have a mass of less than 100 grams

## One template per requirement

A functional requirement carries **exactly one** trigger template. The check is automated in
`tools/open-sdd/src/core/ears.ts` (gate `C1`, and the `G1` clarity control) and it looks at the
trigger clause *before* `shall`:

- Allowed — a single trigger with a compound condition. This is one template:
  - When [event] and [additional condition], the [system] shall [response/action]
- Rejected — a second trigger keyword starting a new clause. That is two requirements wearing one,
  and it is the defect that reaches an agent as licence to invent:
  - While [precondition], when [event], the [system] shall [response/action]  ← split it

Diagnostics the validator emits: `NO_SHALL`, `NO_TEMPLATE_MATCH`, `MULTIPLE_TEMPLATES`,
`COMPOUND_REQUIREMENT` (more than one `shall`), `MISSING_THEN` (an `IF` without `THEN`),
`VAGUE_TERM` and `EMPTY_RESPONSE`.

`IF … THEN` is the pattern teams omit, and it is the first-class home of negative requirements: a
requirements document with no `IF` criterion is reporting no unwanted behaviour at all.

Note the limit the reference architecture states: this grammar disciplines the *statement* of a
requirement, not its *correctness*. A perfectly formed requirement can specify the wrong behaviour.

## Subject Selection Guidelines
- **Software Projects**: Use concrete system/service name (e.g., "Checkout Service", "User Auth Module")
- **Process/Workflow**: Use responsible team/role (e.g., "Support Team", "Review Process")
- **Non-Software**: Use appropriate subject (e.g., "Marketing Campaign", "Documentation")

## Quality Criteria
- Requirements must be testable, verifiable, and describe a single behavior.
- Use objective language: "shall" for mandatory behavior, "should" for recommendations; avoid ambiguous terms.
- Follow EARS syntax: [condition], the [system] shall [response/action].

<!-- GENERATED from .sdd/settings/standards by tools/open-sdd/src/core/standardsRender.ts; edit the catalogue entry, not this file -->

## Generated standards

<!-- standards:REQ-DOC-001:begin -->
## REQ-DOC-001 — The specification declares its target language

- **Category:** `docs`
- **Severity:** `info` (advisory until a measured corpus exists)
- **Applies to:** `spec.json`
- **Standard:** internal
- **Source:** `.sdd/settings/rules/ears-format.md#overview`
- **Detection:** `question` — `"language"\s*:`
- **Message:** ¿en qué idioma está escrita la especificación? declara `language` en `spec.json` para que las comprobaciones de lenguaje no adivinen
- **Evidence:** `tools/open-sdd/src/core/standards.ts#runStandard (question)`
- **Calibration:** not measured
- **Remedies:** none — this standard asks for the missing datum instead of prescribing
<!-- standards:REQ-DOC-001:end -->
<!-- standards:REQ-EARS-001:begin -->
## REQ-EARS-001 — No requirement without the `shall` operator

- **Category:** `requirements`
- **Severity:** `error` (advisory until a measured corpus exists)
- **Applies to:** `requirements.md`, `delta.md`
- **Standard:** EARS
- **Source:** `.sdd/settings/rules/ears-format.md#one-template-per-requirement`
- **Detection:** `structural` — `ears-issue:NO_SHALL`
- **Message:** un requisito sin el operador `shall` no es comprobable
- **Evidence:** `tools/open-sdd/src/core/ears.ts#validateEarsRequirement`
- **Calibration:** not measured
- **Remedies:**
  - `maybe-incorrect` — reescribe el enunciado como `<disparador>, <sistema> shall <respuesta>` con una única condición de disparo
  - `needs-human` — si el enunciado no expresa una obligación, retíralo en vez de añadir `shall`
<!-- standards:REQ-EARS-001:end -->
<!-- standards:REQ-EARS-002:begin -->
## REQ-EARS-002 — A statement that matches no EARS template

- **Category:** `requirements`
- **Severity:** `warning` (advisory until a measured corpus exists)
- **Applies to:** `requirements.md`, `delta.md`
- **Standard:** EARS
- **Source:** `.sdd/settings/rules/ears-format.md#one-template-per-requirement`
- **Detection:** `structural` — `ears-issue:NO_TEMPLATE_MATCH`
- **Message:** el enunciado no encaja en ninguna plantilla EARS y contiene términos ambiguos: casi siempre es un requisito ambiguo o dos requisitos vestidos de uno
- **Evidence:** `tools/open-sdd/src/core/ears.ts#validateEarsRequirement`
- **Calibration:** not measured
- **Remedies:**
  - `maybe-incorrect` — elige la plantilla que corresponda (`WHEN`, `WHILE`, `WHERE`, `IF ... THEN` o ubicua) y reescribe el enunciado
  - `needs-human` — si el enunciado esconde dos obligaciones, divídelo antes de elegir plantilla
<!-- standards:REQ-EARS-002:end -->
<!-- standards:REQ-EARS-003:begin -->
## REQ-EARS-003 — Exactly one EARS template per requirement

- **Category:** `requirements`
- **Severity:** `error` (advisory until a measured corpus exists)
- **Applies to:** `requirements.md`, `delta.md`
- **Standard:** EARS
- **Source:** `.sdd/settings/rules/ears-format.md#one-template-per-requirement`
- **Detection:** `structural` — `ears-issue:MULTIPLE_TEMPLATES`
- **Message:** hay más de una plantilla EARS en la condición de disparo: exactamente una por requisito funcional
- **Evidence:** `tools/open-sdd/src/core/ears.ts#validateEarsRequirement`
- **Calibration:** not measured
- **Remedies:**
  - `maybe-incorrect` — separa cada disparador en su propio requisito
  - `needs-human` — si los disparadores describen el mismo suceso, fusiónalos en una única condición compuesta con `and`
<!-- standards:REQ-EARS-003:end -->
<!-- standards:REQ-EARS-004:begin -->
## REQ-EARS-004 — One response per requirement

- **Category:** `requirements`
- **Severity:** `warning` (advisory until a measured corpus exists)
- **Applies to:** `requirements.md`, `delta.md`
- **Standard:** EARS
- **Source:** `.sdd/settings/rules/ears-format.md#one-template-per-requirement`
- **Detection:** `structural` — `ears-issue:COMPOUND_REQUIREMENT`
- **Message:** varias respuestas `shall` en un mismo enunciado: probablemente son varios requisitos
- **Evidence:** `tools/open-sdd/src/core/ears.ts#validateEarsRequirement`
- **Calibration:** not measured
- **Remedies:**
  - `maybe-incorrect` — divide el enunciado para que cada uno tenga una única condición de disparo y una única respuesta
  - `needs-human` — si las respuestas son inseparables, declara la obligación compuesta y su verificación conjunta
<!-- standards:REQ-EARS-004:end -->
<!-- standards:REQ-EARS-005:begin -->
## REQ-EARS-005 — The unwanted-behaviour pattern keeps its `THEN`

- **Category:** `requirements`
- **Severity:** `error` (advisory until a measured corpus exists)
- **Applies to:** `requirements.md`, `delta.md`
- **Standard:** EARS
- **Source:** `.sdd/settings/rules/ears-format.md#one-template-per-requirement`
- **Detection:** `structural` — `ears-issue:MISSING_THEN`
- **Message:** el patrón no deseado se escribe `IF <condición>, THEN <respuesta>`
- **Evidence:** `tools/open-sdd/src/core/ears.ts#validateEarsRequirement`
- **Calibration:** not measured
- **Remedies:**
  - `maybe-incorrect` — inserta `THEN` entre la condición y la respuesta
  - `needs-human` — si el enunciado no describe comportamiento no deseado, cambia de plantilla antes de añadir `THEN`
<!-- standards:REQ-EARS-005:end -->
<!-- standards:REQ-EARS-006:begin -->
## REQ-EARS-006 — Requirements avoid unverifiable terms

- **Category:** `requirements`
- **Severity:** `warning` (advisory until a measured corpus exists)
- **Applies to:** `requirements.md`, `delta.md`
- **Standard:** EARS
- **Source:** `.sdd/settings/rules/ears-format.md#quality-criteria`
- **Detection:** `structural` — `ears-issue:VAGUE_TERM`
- **Message:** el enunciado contiene términos no comprobables
- **Evidence:** `tools/open-sdd/src/core/ears.ts#validateEarsRequirement`
- **Calibration:** not measured
- **Remedies:**
  - `needs-human` — sustituye el término por una magnitud observable: umbral, unidad y condición de medida
  - `maybe-incorrect` — si el término es vocabulario del dominio, decláralo en el glosario y acota su significado
<!-- standards:REQ-EARS-006:end -->
<!-- standards:REQ-EARS-007:begin -->
## REQ-EARS-007 — The response after `shall` is not empty

- **Category:** `requirements`
- **Severity:** `error` (advisory until a measured corpus exists)
- **Applies to:** `requirements.md`, `delta.md`
- **Standard:** EARS
- **Source:** `.sdd/settings/rules/ears-format.md#one-template-per-requirement`
- **Detection:** `structural` — `ears-issue:EMPTY_RESPONSE`
- **Message:** la respuesta tras `shall` está vacía: el requisito no dice qué debe ocurrir
- **Evidence:** `tools/open-sdd/src/core/ears.ts#validateEarsRequirement`
- **Calibration:** not measured
- **Remedies:**
  - `maybe-incorrect` — escribe la respuesta observable que sigue a `shall`
  - `needs-human` — si nadie ha decidido la respuesta, anota la pregunta en vez de inventarla
<!-- standards:REQ-EARS-007:end -->
<!-- standards:REQ-EARS-008:begin -->
## REQ-EARS-008 — The trigger clause precedes `shall`

- **Category:** `requirements`
- **Severity:** `warning` (advisory until a measured corpus exists)
- **Applies to:** `requirements.md`, `delta.md`
- **Standard:** EARS
- **Source:** `.sdd/settings/rules/ears-format.md#one-template-per-requirement`
- **Detection:** `structural` — `ears-template-order`
- **Message:** la cláusula de disparo debe preceder a `shall` para que la plantilla sea explícita
- **Evidence:** `tools/open-sdd/src/core/standards.ts#runStandard (structural:ears-template-order)`
- **Calibration:** not measured
- **Remedies:**
  - `maybe-incorrect` — mueve el disparador al principio del enunciado, antes de `shall`
  - `needs-human` — si el orden refleja una condición que no es un disparador, reescribe el enunciado con la plantilla ubicua
<!-- standards:REQ-EARS-008:end -->
<!-- standards:REQ-EARS-009:begin -->
## REQ-EARS-009 — The requirements declare unwanted behaviour

- **Category:** `requirements`
- **Severity:** `warning` (advisory until a measured corpus exists)
- **Applies to:** `requirements.md`, `delta.md`
- **Standard:** EARS
- **Source:** `.sdd/settings/rules/ears-format.md#one-template-per-requirement`
- **Detection:** `structural` — `ears-negative-coverage`
- **Message:** ningún requisito de comportamiento no deseado (`IF ... THEN`): es el patrón que los equipos omiten y el único lugar de primera clase para requisitos negativos
- **Evidence:** `tools/open-sdd/src/core/ears.ts#negativeRequirementGap`
- **Calibration:** not measured
- **Remedies:**
  - `needs-human` — añade al menos un criterio `IF <condición>, THEN <respuesta>` por cada fallo observable, o declara por qué el sistema no tiene comportamiento no deseado
  - `maybe-incorrect` — revisa los modos de fallo conocidos y conviértelos en criterios `IF ... THEN`
<!-- standards:REQ-EARS-009:end -->
<!-- standards:REQ-EARS-010:begin -->
## REQ-EARS-010 — EARS trigger keywords use their canonical form

- **Category:** `requirements`
- **Severity:** `info` (advisory until a measured corpus exists)
- **Applies to:** `requirements.md`, `delta.md`
- **Standard:** EARS
- **Source:** `.sdd/settings/rules/ears-format.md#primary-ears-patterns`
- **Detection:** `structural` — `ears-trigger-casing`
- **Message:** la palabra clave EARS no está en su forma canónica
- **Evidence:** `tools/open-sdd/src/core/standards.ts#runStandard (structural:ears-trigger-casing)`
- **Calibration:** not measured
- **Remedies:**
  - `machine-applicable` — escribe la palabra clave en mayúsculas: `WHEN`, `WHILE`, `WHERE`, `IF` — cambio ortográfico: no altera el significado ni la detección
  - `maybe-incorrect` — si el enunciado no empieza por un disparador, reescríbelo con la plantilla ubicua
<!-- standards:REQ-EARS-010:end -->
<!-- standards:REQ-EARS-011:begin -->
## REQ-EARS-011 — A requirement describes a single behaviour

- **Category:** `requirements`
- **Severity:** `warning` (advisory until a measured corpus exists)
- **Applies to:** `requirements.md`, `delta.md`
- **Standard:** EARS
- **Source:** `.sdd/settings/rules/ears-format.md#quality-criteria`
- **Detection:** `heuristic` — `single-behaviour`
- **Message:** el enunciado probablemente describe varios comportamientos
- **Evidence:** `tools/open-sdd/src/core/standards.ts#runStandard (heuristic:single-behaviour)`
- **Calibration:** not measured
- **Remedies:**
  - `maybe-incorrect` — divide la respuesta en un requisito por comportamiento observable
  - `needs-human` — si los comportamientos comparten una única verificación, declara el criterio conjunto en `plan.md`
<!-- standards:REQ-EARS-011:end -->
