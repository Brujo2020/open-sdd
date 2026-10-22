# Requirements — wave-2

**Objective:** Close ten weaknesses found with evidence on `main` after the `c355e79` merge, and add ten
improvements, the first being Cline and its fork Axet.plugin as installable skills hosts.

**Out of scope:** everything already in PR #1 (`--no-footer`, `up`, `approve`, repository cleanup of
`Claude outputs/`); Axet rules and workflows (their workspace paths are not verified).

## Requirements

### REQ-W2-001 — Claims and counts agree with what ships

- Statement: The [claims registry] shall derive the shipped SKILL.md count from the template tree, so `assure claims --verify` reports 0 broken.
- Statement: The [agent registry] shall state the number of skills it installs from the shared tree without a hard-coded count.

### REQ-W2-002 — An unknown agent is named, not mistaken for a path

- Statement: WHEN `init --agent` receives an unknown id, the [installer] shall exit 1 and list the valid ids.

### REQ-W2-003 — Cline is installed where Cline reads

- Statement: The [Cline integration] shall install skills in `.cline/skills/sdd-*/SKILL.md`, the directory documented at docs.cline.bot.

### REQ-W2-004 — No orphan template trees

- Statement: The [repository] shall contain no template tree that no agent in the registry installs.
- Statement: If a template tree, manifest or registry entry lacks its counterparts, then the [test suite] shall fail.

### REQ-W2-005 — Compiled output matches source

- Statement: If the committed `dist/` differs from a fresh build of `src/`, then the [test suite] shall fail.

### REQ-W2-006 — The suite runs from the repository root

- Statement: WHEN `npx vitest run` is executed at the repository root, the [test runner] shall run the CLI suite with its own configuration.

### REQ-W2-007 — Help derives the host list

- Statement: The [help] shall derive the integration host list from the integrations registry.

### REQ-W2-008 — Axet.plugin and Cline as skills agents

- Statement: WHEN `--axet` is given, the [installer] shall install the shared skills in `.axet-plugin/skills/sdd-*/SKILL.md` and an `AGENTS.md`.
- Statement: WHEN `--cline` is given, the [installer] shall install the shared skills in `.cline/skills/sdd-*/SKILL.md` and an `AGENTS.md`.
- Statement: WHEN `init` runs without `--agent` in a project containing `.axet-plugin/` or `.cline/`, the [installer] shall choose the matching agent.

### REQ-W2-009 — Several hosts in one run

- Statement: WHEN `init --agent a,b` is given, the [installer] shall plan and write every listed agent, and fail before writing if any id is unknown.

### REQ-W2-010 — CI summary

- Statement: WHEN `gates run --summary=<path>` is given, the [gate runner] shall append a Markdown table of every gate verdict to that path.
- Statement: WHEN `gates run --summary` is given without a path, the [gate runner] shall append the table to `$GITHUB_STEP_SUMMARY`.
- Statement: If `--summary` has no path and `$GITHUB_STEP_SUMMARY` is unset, then the [gate runner] shall exit 1 before running any gate.

### REQ-W2-011 — Traceability you can see

- Statement: WHEN `trace <feature> --mermaid` is given, the [console] shall print a Mermaid flowchart linking each requirement to the tasks that cite it.
- Statement: WHEN `explain <REQ-ID>` is given, the [console] shall print the defining spec, the citing tasks and the files that mention the id.

### REQ-W2-012 — Shareable status

- Statement: WHEN `badge` is given, the [console] shall write an offline SVG badge with the composite SDD score.
- Statement: WHEN `report <feature> --html` is given, the [console] shall write one self-contained HTML page with requirements, tasks, evidence and the trace graph.

### REQ-W2-013 — Editor tasks

- Statement: WHEN `integrate vscode-tasks --write` is given, the [integration] shall add SDD tasks to `.vscode/tasks.json` and keep every pre-existing task entry present.

### REQ-W2-014 — Axet's agent sees the commit gate's verdict while it works

- Statement: WHEN an Axet task starts, the [TaskStart hook] shall add the SDD contract and the commit gate's current verdict to the agent's context.
- Statement: WHEN a file-changing or command tool finishes and the gate's verdict differs from the last one reported in that task, the [PostToolUse hook] shall add the new verdict to the agent's context.
- Statement: WHEN an Axet task completes, the [TaskComplete hook] shall print the gate's verdict in the chat.
- Statement: The [Axet hooks] shall run the gate with the project root as working directory and answer `cancel: false`.
- Statement: If the gate CLI cannot be started, then the [Axet hooks] shall report the gate as unavailable with the error.

### REQ-W2-015 — Axet's slash menu offers every sdd skill

- Statement: WHEN `--axet` is given, the [installer] shall write one extensionless workflow per shared skill in `.axetrules/workflows/`, named exactly as the skill.
- Statement: The [workflow] shall instruct the agent to follow `.axet-plugin/skills/<skill>/SKILL.md` with the text typed after the command as its input.

### REQ-W2-016 — One command from one origin installs Axet support

- Statement: WHEN `--axet` is given, the [installer] shall write the skills, the workflows, AGENTS.md, the settings and the three hooks in one run.
- Statement: The [Axet hooks] shall resolve the CLI from `$OPEN_SDD_CLI`, then the project's `node_modules`, then `npx --yes <origin>`, where the origin is the package spec the installer was run from.

