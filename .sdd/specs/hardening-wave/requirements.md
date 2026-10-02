# Requirements — hardening-wave

_Constitution: C-STACK-FACT, C-API-COMPAT, C-BOUNDARIES, C-REGRESSION-ORACLE_

**Objective:** As a team adopting Open-SDD in any repository and with any AI host, we want the commit
gate to be impossible to bypass by an old CLI, approvals that stop counting when the approved file
changes, and an adoption path of one command, so the tool is both strict where it claims to be and easy
everywhere else.

## Requirements

### REQ-HRD-001 — The commit hook never runs an unverified CLI (G-36)

- Statement: When the hook is installed, the [installer] shall record the installing CLI path and version beside the hook, outside the committed tree.
- Statement: When the hook resolves its CLI, the [hook] shall prefer the explicit `OPEN_SDD_CLI`, then the pinned CLI, then the project candidates, and only then a CLI on `PATH`.
- Statement: If the only CLI found is on `PATH` and its reported version is lower than the pinned version (or 3.4.0 without a pin) or unknown, then the [hook] shall refuse the commit with exit 1 and name the upgrade command.

### REQ-HRD-002 — The diagnosis and the gate agree on the CLI

- Statement: If the pinned CLI no longer exists or is older than the CLI running the diagnosis, then the [doctor] shall report the hook check as a warning with the re-pin command.
- Statement: When `doctor --fix` reinstalls the hook, the [doctor] shall write the pin.

### REQ-HRD-003 — An approval is bound to the approved bytes

- Statement: When a human approves a gate, the [ledger] shall record the approver, the timestamp, the artifact file and its sha256 in `.sdd/specs/<feature>/approvals.json`.
- Statement: When the check runs and an approved artifact's sha256 differs from the recorded one, the [console] shall report the approval as stale and exit 1.
- Statement: If the previous gate in the order requirements, design, tasks is not freshly approved, then the [ledger] shall refuse the approval and name the command that unblocks it.
- Statement: If no approver name is given and `git config user.name` is empty, then the [console] shall refuse the approval with exit 2.

### REQ-HRD-004 — The process is sized to the change

- Statement: When an intent is routed, the [router] shall return class S, M or L with the evidence behind it and the next commands.
- Statement: If the size of the change cannot be determined and the intent is not cosmetic, then the [router] shall return a class other than S.

### REQ-HRD-005 — One command to adopt

- Statement: When `up` runs without `--write`, the [console] shall print the plan and write no file.
- Statement: When `up --write` runs, the [console] shall run init with skills for the detected host, install the CI gate matrix for the detected CI, and finish with the doctor verdict as its exit code.

### REQ-HRD-006 — A merged delta can be retired

- Statement: When `delta merge --write --archive` succeeds, the [console] shall move the delta to `archive/<YYYY-MM-DD>-delta.md` without overwriting an earlier archive.
- Statement: If `--archive` is given without `--write`, then the [console] shall exit 2 and change no file.

### REQ-HRD-007 — The context tax is stated

- Statement: When the context report runs, the [console] shall report per host surface the files, the always-loaded token estimate and the on-demand token estimate, and state the estimation rule.
- Statement: If a budget is given and the always-loaded estimate exceeds it, then the [console] shall exit 1.

### REQ-HRD-008 — Installs without a receipt can be removed

- Statement: When `uninstall --legacy` runs, the [console] shall list as removable only the hook that matches a shipped template or carries the gate header, its pin, and skills whose name and file set match a shipped skill.
- Statement: If a skill directory holds a file the shipped skill does not have, then the [console] shall refuse to remove it.
- Statement: When the removed hook had preserved a foreign hook as a backup, the [console] shall restore the foreign hook.

### REQ-HRD-009 — Tool-level commands print no score footer

- Statement: When `help`, `explain`, `mcp`, `uninstall` or `restore` exits 0, the [dispatcher] shall not print the score footer.

### REQ-HRD-010 — The floor is reported truthfully in any project, on GitHub or GitLab

- Statement: When an installed hook carries the gate header, the [floor report] shall count it as the shipped hook.
- Statement: When `.gitlab-ci.yml` or a file under `.gitlab/` runs `gates run` on `merge_request_event`, the [floor report] shall count it as the merge gate matrix.
- Statement: When `floor install --ci gitlab` runs, the [installer] shall write the GitLab job and shall not edit an existing `.gitlab-ci.yml`.

## Non-functional requirements

- The changes shall not modify the gate chain (decision 4 of `docs/EVOLUTION-PLAN.md`).
- Every new command shall work offline with no model backend.
