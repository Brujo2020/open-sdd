# Requirements — learning-path

_Constitution: C-STACK-FACT, C-API-COMPAT, C-BOUNDARIES, C-REGRESSION-ORACLE_

**Objective:** As a developer meeting Open-SDD for the first time, we want the help to show the few
commands of the daily loop in the order they are used, and one guided path per situation, so the first
change reaches a verified "done" without reading a 70-command index.

## Requirements

### REQ-LRN-001 — The default help is the essentials, in the order of use

- Statement: When `--help`, `-h` or `help` runs without `--all`, the [console] shall print the essentials index of at most 40 lines, grouped as start, daily loop, existing code and proof.
- Statement: When the essentials index is printed, the [console] shall end it with the commands `open-sdd help workflow`, `open-sdd help <command>` and `open-sdd --help --all`.

### REQ-LRN-002 — The full index stays one flag away

- Statement: When `--help --all`, `help --all` or `help all` runs, the [console] shall print the full index of every routed command.

### REQ-LRN-003 — One guided path per situation

- Statement: When `help workflow` runs, the [console] shall print the ordered commands for a new feature, a change to existing code, a small fix, adopting another tool's specs and proving a change, each path ending on the command that verifies it.

### REQ-LRN-004 — Every command the learning surface names exists

- Statement: When the essentials index or the workflow topic names a command or a subcommand, the [dispatcher] shall route it as a known command.

### REQ-LRN-005 — Every pointer leads to the path

- Statement: When the score door prints its last line, the [console] shall name `open-sdd help workflow` and `open-sdd --help`.
- Statement: When a command is unknown, the [console] shall name `open-sdd --help --all` as the list of every command.

### REQ-LRN-006 — The full index carries no marketing and leads with the one-command install

- Statement: When the full index is printed, the [console] shall list `up` as its first quick example and shall not print the heading "Apple-grade".

### REQ-LRN-007 — The audit bundle states the released version

- Statement: When an audit bundle is produced from a checkout, the [bundle] shall state the version of the root package manifest.

### REQ-LRN-008 — `init <feature> --write` names the command it meant

- Statement: If `init` receives `--write` and a slug that is not an existing directory, then the [console] shall exit 1 and name `open-sdd init <slug>` as the command that creates that spec.

### REQ-LRN-009 — The requirements stub teaches the shape the coach accepts

- Statement: When `init <feature>` creates `requirements.md`, the [scaffold] shall mark every placeholder as a double-brace marker in the `REQ-<AREA>-<NNN>` / `Statement:` shape.
- Statement: When every placeholder of the stub is filled in its own shape, the [requirements coach] shall report no finding caused by that shape.

## Non-functional requirements

- The changes shall not modify the gate chain (decision 4 of `docs/EVOLUTION-PLAN.md`).
- Every help surface shall work offline, exit 0 and print no score footer.
