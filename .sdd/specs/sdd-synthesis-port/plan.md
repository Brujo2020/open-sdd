# Plan — sdd-synthesis-port

## Components
| Component | File | Contract |
|---|---|---|
| Gherkin converter | `tools/open-sdd/src/core/gherkin.ts` (new) | `earsToScenario(id, text, lang)` → scenario or skip reason; `buildFeature({feature, requirements, language})` → `{text, scenarios, skipped}`. Input = `parseRequirements` from `requirementsCoach.ts` (the one requirement parser). Pure, no I/O. |
| Task grammar | `tools/open-sdd/src/core/taskGrammar.ts` (new) | `parseTaskBlocks(md)` → checkbox line + its indented detail lines; `checkTaskGrammar(md)` → findings with the `ConsistencyFinding` shape. Pure. |
| Consistency wiring | `tools/open-sdd/src/core/consistency.ts` | new section 1b after the trace: appends task-grammar findings and one `checked` line. |
| Console | `tools/open-sdd/src/cli/commands/requirements.ts`, `src/cli/commands/help.ts` | `requirements gherkin <feature> [--write] [--json]`. |

## Decisions
- Citations are read from the checkbox line **and** its detail lines, because the shipped `tasks.md` template puts `_Requirements:_` / `_Boundary:_` on detail bullets.
- Duplicate check is limited to numeric ids (`1`, `1.2`): the shared parser derives a word id from free-text titles, which would false-positive.
- New findings are warnings except the two that break scheduling (`scheduler.ts` force-picks a task whose dependency is unresolved, silently).
- English is the canonical EARS form (`ears.ts`); Spanish triggers (`Cuando/Mientras/Donde/Si…entonces`, `debe`) are also recognised, as the guide specifies.

## Validation
`vitest` unit tests per module + CLI test for `--write` refusal; full suite; `assure claims --verify` stays at 0 broken; `brownfield analyze` over this repo's own specs to measure new findings.
