---
name: sdd-plan-only
description: Plan only — analyse the request and return a plan without changing a single file
allowed-tools: Read, Bash, Glob, Grep
argument-hint: <request to plan>
---

# Plan only

<instructions>
## Why this flow exists
Some decisions must be made before anything is committed: estimates, options, risks. In this flow the agent is
read-only, so the user can explore safely. (Kiro's Plan mode; SteelForge `/sdd-plan-only`.)

## Rules (hard)
- Do NOT write, edit, move or delete files. Do NOT run commands that change state (installs, migrations, git
  commits, formatters with --write). Read-only commands only (`open-sdd status`, `open-sdd modes`, `git log`, reading code).

## Output (in the chat)
1. Goal, in the user's words.
2. Ordered steps; for each: what it touches (files or modules) and how it will be verified.
3. Risks and how each is mitigated.
4. Open questions (max 5, each with options).
5. The recommended flow and level to execute it (`open-sdd modes`), and the exact next command
   (`/sdd-spec-quick`, `/sdd-spec-requirements`, `/sdd-bugfix` or `/sdd-tiny`).
</instructions>
