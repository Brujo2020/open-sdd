# SDD modes and the modules from SteelForge

SteelForge IDE ran open-sdd inside a desktop agent for months and grew a layer around it: rigor levels people could
pick, flows for each kind of work, a stage guide, and a set of deterministic checks that the other SDD toolkits
(Spec Kit, Kiro, OpenSpec, cc-sdd, BMAD) leave to a prompt. This guide documents what came back to open-sdd, **why
each piece is included**, and which skills fit each kind of project.

Everything here is deterministic: no model, no network. Only `gherkin --write`, `archive --confirm` and
`discovery log` write files; every other command only reads.

## Which skills to use for which kind of project

Projects are different, and the skill that fits one is ceremony — or a missing safety net — for another. Identify
the type first; `open-sdd modes --projects` prints this table and `open-sdd modes --project <type>` one row.

| Type | Recognise it by | Level · terrain | Skills, in order | Do NOT use |
|---|---|---|---|---|
| `fuzzy-idea` | nobody can say who needs it or what "done" is | spec-first · greenfield | `/sdd-discovery` → `open-sdd discovery lint` → `/sdd-spec-quick` or `/sdd-tiny` | `/sdd-spec-requirements` |
| `spike` | throwaway code to test feasibility | explore | `/sdd-tiny` → implement → `/sdd-promote` if it survives | `/sdd-spec-quick`, `/sdd-impl` |
| `greenfield` | no existing code constrains it | spec-first · greenfield | `/sdd-steering` → `/sdd-spec-init` → `/sdd-spec-requirements` → `/sdd-spec-design` → `/sdd-spec-tasks` → `open-sdd gherkin --write` → `/sdd-impl` → `/sdd-validate-impl` → `open-sdd archive --confirm` | `/sdd-getspecs`, `/sdd-characterize` |
| `multi-feature` | a roadmap with dependencies | spec-anchored · greenfield | `/sdd-discovery` → `/sdd-spec-batch` → `open-sdd waves` → `/sdd-impl` per wave | `/sdd-spec-quick` one by one |
| `brownfield-extension` | running code with tests | spec-anchored · brownfield | `/sdd-getspecs` → `brownfield constitution` → `steering check` → `delta init/validate` → `brownfield contracts` → `/sdd-spec-tasks` → `/sdd-impl` → `contracts --verify` | a new spec from scratch, `/sdd-tiny` |
| `legacy-untested` | nothing pins the current behaviour | spec-anchored · brownfield | `/sdd-getspecs` → `/sdd-characterize` → `brownfield contracts` → `/sdd-refactor`, `/sdd-bugfix` or `delta init` | any change before `/sdd-characterize` |
| `bug` | existing behaviour is wrong | spec-first · brownfield | `/sdd-bugfix` → `delta init` only if a spec changes → `/sdd-verify-completion` | `/sdd-spec-quick` |
| `refactor` | structure changes, behaviour must not | spec-first · brownfield | `/sdd-characterize` if untested → `/sdd-refactor` → `brownfield impact` | `/sdd-spec-requirements`, a bug fix in the same change |

## The two axes: level and flow

**Level** (`open-sdd modes [--level …] [--brownfield] [--governance …]`) decides which modules are required (`on`),
available (`opt`) or out of scope (`off`):

| Module | explore | spec-first | spec-anchored | spec-as-source | Why it is required where it is |
|---|---|---|---|---|---|
| Tinyspec | on | off | off | off | explore still writes "done when", so a spike can fail visibly |
| Discovery | opt | opt | opt | on | at spec-as-source the spec generates code: an unvalidated idea would be generated |
| Steering | opt | opt (brownfield: on) | on | on | on existing code the agent must learn the project before changing it |
| Constitution | off | on | on | on | the authority every blocking verdict cites |
| Clarify, EARS | off | on | on | on | an open question becomes a guess in the code; a requirement without a trigger cannot be tested |
| Gherkin | off | opt | on | on | from spec-anchored up each requirement needs an executable scenario traced to it |
| Design, Tasks, Analyze | off | opt | on | on | a requirement no plan names was listed, not designed; drift is invisible from one artifact |
| Delta | off | brownfield: on | brownfield: on | brownfield: on | on existing code the unit of change is the delta |
| Approvals | off | off | opt (enterprise: on) | on | when the spec is the source, an unapproved phase is unreviewed code |
| Archive | off | off | opt | on | finished specs out of `.sdd/specs/` keep status and waves about live work |

`explore` is **not** a rung of the governed ladder (`spec-first` → `spec-anchored` → `spec-as-source`): it is a
throwaway mode, and nothing built in it counts as evidence until `/sdd-promote` turns it into a spec.

**Flow** is the kind of work: `spec`, `quick`, `bugfix`, `plan` (read-only), `tiny` and `discovery`.

## What was added, and why

| Addition | Where | Why it is included |
|---|---|---|
| `open-sdd modes` | `src/core/sddModes.ts` | open-sdd had the rigor ladder and every artifact, but no place that answered "with this level, on this terrain, what must I do and what can I skip?". The matrix and the project-type table are data any interface can render (`--json`). |
| `open-sdd stages <feature>` | `stagesFor` in `sddModes.ts` | Kiro's sequential stage guide: the active stage is the first one not done, and each stage says what it needs. Users stopped asking "what now?". |
| `open-sdd gherkin <feature>` | `src/core/earsGherkin.ts` | open-sdd validated and coached EARS but never turned a criterion into an acceptance scenario, so the requirement → test trace was typed by hand and drifted. Deterministic: it only reorders what the criterion says, and skips (with the reason) what is not EARS. |
| Five task-structure checks in `consistency` | `src/core/taskStructure.ts` | `consistency` traced ids but did not read the task list itself. Duplicate numbers make `/sdd-impl 1.2` ambiguous; `(P)` without `_Boundary:_` lets parallel tasks collide; `_Depends:_` on a missing task corrupts the waves; a task with no verification makes "done" an opinion; a requirement the plan never names was not designed. |
| `REQUIREMENT_NAMES_TECHNOLOGY` in `consistency` | `src/core/requirementTechnology.ts` | cc-sdd's rule: a requirement says WHAT, not WITH WHAT; naming PostgreSQL or React fixes a design decision inside the document that must survive any design. Advisory only (`info`): the list holds names that are unambiguous in prose, and a criterion that records the constraint (`Constraint:`, ADR, contract) is left alone. It complements the catalogued `VER-004`, which needs the standards catalogue loaded. |
| `open-sdd discovery lint` / `log` | `src/core/discoveryBrief.ts` | `/sdd-discovery` wrote `brief.md` but nothing checked it before requirements consumed it. The gate blocks an empty scope exclusion, an unmeasurable outcome and any unconfirmed assumption (from BMAD), and refuses secrets. The log is append-only so the reasons behind a kill or a lock survive. |
| `open-sdd archive <feature>` | `src/core/archive.ts` | specs had no end of life and finished work inflated every scan. Archiving (from OpenSpec) requires every task done, `spec.json` in `verified`/`completed` and tasks approved; it is a dry run without `--confirm`, never overwrites, and moves in one `rename`. |
| `open-sdd steering check` | `src/core/steeringCheck.ts` | generated steering is partly inferred. Until a person confirms it, every spec inherits guesses as rules. The check validates Kiro's `inclusion` modes, rejects `#[[file:…]]` references outside the workspace, and treats `(inferred)` / `[NEEDS CLARIFICATION]` as a draft. |
| `/sdd-tiny`, `/sdd-promote` | skills | a spike needs "done when" but not governance; promotion is the explicit door back into the ladder. |
| `/sdd-bugfix` | skill | a bug's evidence is the root cause and the regression contract (what must NOT change), written before the fix. |
| `/sdd-plan-only` | skill | decide before committing: the agent is read-only. |
| `/sdd-refactor` | skill | "no behaviour change" is a claim: the same tests green before and after, and `brownfield impact` as the check. |
| `/sdd-characterize` | skill | on untested legacy, freeze the current behaviour first, or no later change can be proven safe. |

## Getting the new flows into your agent

The CLI commands (`modes`, `stages`, `gherkin`, `archive`, `discovery`, `steering check`) work anywhere `open-sdd`
runs. The six new **flows** (`sdd-tiny`, `sdd-promote`, `sdd-bugfix`, `sdd-plan-only`, `sdd-refactor`,
`sdd-characterize`) are skills, so they need the host's skills installed:

```bash
open-sdd integrate claude-code --write     # 27 skills in .claude/skills/ + CLAUDE.md with the guide per project type
open-sdd integrate --list                  # every host and where its skills go
```

`open-sdd init . --write` (the no-MCP default) installs the 22 prompt templates only; it does not install these six
flows. Verified on a clean repository: `integrate claude-code --write` writes `.claude/skills/sdd-*/SKILL.md` (27
directories, each `name:` equal to its folder) and the "Which commands for which kind of project" section of
`CLAUDE.md`. The same skills are in the shared tree that every host reading `.agents/skills/` installs.

## Attribution

Spec Kit (GitHub), OpenSpec (Fission-AI), cc-sdd (gotalab) and BMAD-METHOD are MIT: their ideas and rules were
taken, not their code. Kiro's ideas come through cc-sdd and its published modes. The implementation was written in
SteelForge IDE and rewritten here in TypeScript on top of open-sdd's own parsers (`parseTasksMarkdown`,
`parseRequirementsMarkdown`, `ears.ts`) instead of duplicating them.
