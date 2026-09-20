# Installation

This document covers every way to install `open-sdd`, what the installer writes, and how to verify
it. All commands are runnable from the repository root unless stated otherwise.

## Prerequisites

- **Node.js** with ESM support. The tracked `tools/open-sdd/dist/` is plain ESM JavaScript and needs
  no build; this checkout was verified with Node v26.7.0.
- **npm** for the from-source build (TypeScript + Vitest dev dependencies live in
  `tools/open-sdd/package.json`).
- No engines constraint is declared in either `package.json`.

The package exposes four bin names, all pointing at the same CLI:
`open-sdd`, `sdd-open`, `sdd`, `open-sdd` (root `package.json` → `tools/open-sdd/dist/cli.js`).

## Option 1 — From a clone (per-project, no global install)

```bash
git clone https://github.com/Brujo2020/open-sdd
cd open-sdd
npm --prefix tools/open-sdd install
npm --prefix tools/open-sdd run build
```

Then install the skills into a target repository by running the CLI **inside that repository**:

```bash
cd /path/to/your-project
node /path/to/open-sdd/tools/open-sdd/dist/cli.js --claude-skills -y
```

The CLI resolves the target from its working directory, so always run it from inside the project you
are installing into.

## Option 2 — The `install.sh` helper

`install.sh` wraps Option 1: it builds the CLI if `tools/open-sdd/dist/cli.js` is missing, then runs it
inside the repository you pass as the first argument.

```bash
bash install.sh /path/to/your/repo [agent flags...]

# Examples
bash install.sh ~/projects/api                  # Claude Code (default)
bash install.sh ~/projects/api --cursor-skills  # Cursor skills
bash install.sh ~/projects/api --lang es -y     # Spanish, no prompts
```

The target argument is required; `install.sh` exits `1` with usage if it is missing, and also if the
target is not a directory.

## Option 3 — Global CLI (terminal everywhere)

From the checkout, the root script builds and installs globally:

```bash
npm run install:global        # npm --prefix tools/open-sdd run build && npm install -g ./tools/open-sdd
```

Or install the package directory directly:

```bash
npm install -g ./tools/open-sdd
open-sdd --help
```

With a global install, run the CLI from inside the target repository:

```bash
cd /path/to/your-project
open-sdd --cursor-skills -y
```

## Option 4 — Published package

The package is named `open-sdd` and the CLI help advertises npx:

```bash
npx @brujo2020/open-sdd@latest             # Claude Code skills (default) — once published
npx @brujo2020/open-sdd@latest --cursor-skills -y
npx @brujo2020/open-sdd@latest --lang es -y
```

## Choosing an agent

18 agent definitions ship; 8 are skills-based and carry all 21 skills. The authoritative table
(labels, `--agent` ids, alias flags and install directories) is in the
[README](../README.md#supported-host-agents). The most common skills variants:

| Agent | Flag | Installs into |
|---|---|---|
| Claude Code Skills | `--claude-skills` | `.claude/skills/` |
| Codex Skills | `--codex-skills` | `.agents/skills/` |
| Cursor Skills | `--cursor-skills` | `.cursor/skills/` |
| GitHub Copilot Skills | `--copilot-skills` | `.github/skills/` |
| Gemini CLI Skills | `--gemini-skills` | `.gemini/skills/` |
| Windsurf Skills | `--windsurf-skills` | `.windsurf/skills/` |
| OpenCode Skills | `--opencode-skills` | `.opencode/skills/` |
| Antigravity Skills | `--antigravity` | `.agent/skills/` |

`--codex` (the old prompts mode) is **deprecated**: the CLI refuses it with exit `1` and points to
`--codex-skills`.

You can also select by id: `--agent claude-code-skills`.

## Flags

| Flag | Values | Default | Notes |
|---|---|---|---|
| `--agent <id>` | see README table | prompted | Non-TTY falls back to the default agent |
| `--<alias>` | e.g. `--claude-skills` | — | Agent alias flags |
| `--lang <code>` | `ja en zh-TW zh es pt de fr ru it ko ar el` | `en` | Affects generated documents |
| `--os <auto\|mac\|windows\|linux>` | — | `auto` | Uses the runtime when `auto` |
| `--sdd-dir <path>` | any path | `.sdd` or `.kiro` | `--kiro-dir` is an alias |
| `--overwrite <prompt\|skip\|force>` | — | `prompt` | `prompt` asks per file |
| `--backup[=<dir>]` | optional dir | off | Back up before overwriting |
| `--profile <full\|minimal>` | — | `full` | Template profile |
| `--manifest <path>` | manifest JSON | agent default | Plan from an explicit manifest |
| `--dry-run` | — | off | Print the plan; write nothing |
| `--yes`, `-y` | — | off | Shorthand for `--overwrite=force` |
| `-h`, `--help` | — | — | Usage |
| `-v`, `--version` | — | — | Version |

In non-TTY environments, `prompt` mode falls back to `skip` and the CLI prints a warning; use
`--yes` or `--overwrite=force` for unattended installs.

### Dry run first

```bash
node tools/open-sdd/dist/cli.js --claude-skills --dry-run
```

`--dry-run` prints the resolved artifacts and the summary of what would be written, and changes
nothing on disk.

## What gets written

- `.sdd/settings/` — settings, rules and templates (including `governance.json` and `git.json`).
- `.sdd/specs/` — populated by the workflow commands, not by the installer.
- The selected agent's directory — e.g. `.claude/skills/`, `.cursor/skills/`, `.agent/skills/`.
- The agent's documentation file where applicable (`CLAUDE.md`, `AGENTS.md`).

Git automation ships as `assisted` and **never pushes**: `auto_branch` and `auto_commit` are on,
`auto_push` is off. Set `auto_push: true` in `.sdd/settings/git.json` if you want pushes.

## Verify the install

```bash
# The CLI responds:
node tools/open-sdd/dist/cli.js --version

# The chain resolves:
node tools/open-sdd/dist/cli.js gates chain --profile regulated

# The skills landed in the target project (example for Claude Code Skills):
ls /path/to/your-project/.claude/skills | head
```

## Governance profiles after install

`.sdd/settings/governance.json` decides what blocks. Default is `solo` (nothing blocks).
`team` blocks only code written without an approved spec; `enterprise` blocks everything. Full
reference: [guides/governance-profiles.md](guides/governance-profiles.md).

## Uninstall

There is **no** uninstall command. Remove the agent's skill directory, the `.sdd/settings/` tree and
the agent documentation file by hand, or restore them from version control. Remove a global install
with `npm uninstall -g @brujo2020/open-sdd`.
