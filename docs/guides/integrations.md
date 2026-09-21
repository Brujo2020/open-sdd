# Integrations

> Verification status: **all four** hosts whose shape needed its own documentation — **Copilot**
> (VS Code surface), **OpenCode**, **Zed** and **Google Antigravity** — were checked against those
> hosts' own documentation, and each carries the URL it was checked against (see the matrix in
> `tools/open-sdd/src/core/integrations.ts`). Antigravity's page is JavaScript-rendered, but the page
> advertises a Markdown sibling (`https://antigravity.google/docs/mcp.md`, the target of its own
> `View Markdown` link) which documents the entry shape: a single top-level `mcpServers` object with
> `command` (string) + `args` (array) for stdio. `open-sdd integrate --list` is the live source of
> truth.

Open-SDD installs into the host you already use. This guide is the human face of the
machine-checked matrix in `tools/open-sdd/src/core/integrations.ts`: one section per host with how
to install, what gets written and where, the exact in-chat invocation, the MCP registration snippet
verbatim, how to verify the install, and how to remove it.

Run the same matrix from the CLI — it is the source of truth, so the docs and the tool cannot drift:

```bash
open-sdd integrate --list                 # the whole matrix, one row per host
open-sdd integrate cursor                 # detect or name a host, print its exact invocation
open-sdd integrate cursor --write         # register the MCP server and install the skills
open-sdd integrate cursor --write --dry-run   # show what would change, write nothing
open-sdd integrate cursor --json          # the plan and the outcome as machine-readable JSON
```

In this repository, replace `open-sdd` with `node tools/open-sdd/dist/cli.js`.

Detection names its evidence. With no host argument and no marker in the repository, the plan
proposes `claude-code` as a **default** — exactly like `init` — and labels it `[defecto]` rather than
pretending it was detected. An explicit host always wins.

## The matrix

| Host | id | Skills layout | Invocation in chat | MCP config | Snippet verified |
|---|---|---|---|---|---|
| Claude Code | `claude-code` | `.claude/skills/sdd-*/SKILL.md` | `/sdd-brownfield` | `.mcp.json` | **yes** |
| Cursor | `cursor` | `.cursor/skills/sdd-*/SKILL.md` | `/sdd-brownfield` | `.cursor/mcp.json` | **yes** |
| GitHub Copilot | `copilot` | `.github/skills/sdd-*/SKILL.md` | `/sdd-brownfield` | `.vscode/mcp.json` | yes (VS Code surface) |
| Codex CLI | `codex` | `.agents/skills/sdd-*/SKILL.md` | `$sdd-brownfield` | `~/.codex/config.toml` | **yes** |
| Gemini CLI | `gemini-cli` | `.gemini/skills/sdd-*/SKILL.md` | `/sdd-brownfield` | `.gemini/settings.json` | **yes** |
| Windsurf | `windsurf` | `.windsurf/skills/sdd-*/SKILL.md` | `@sdd-brownfield` | `~/.codeium/windsurf/mcp_config.json` | **yes** |
| OpenCode | `opencode` | `.opencode/skills/sdd-*/SKILL.md` | `/sdd-brownfield` | `opencode.json` | yes |
| Google Antigravity | `antigravity` | `.agent/skills/sdd-*/SKILL.md` | `/sdd-brownfield` | `.agents/mcp_config.json` (workspace), `~/.gemini/config/mcp_config.json` (global) | **yes** |
| Zed | `zed` | `AGENTS.md` | `@AGENTS.md run the sdd-brownfield workflow` | Zed `settings.json` | yes |
| Cline | `cline` | `.clinerules/sdd-*.md` | `@.clinerules/sdd-brownfield.md` | `cline_mcp_settings.json` | **yes** |

**Verified** means the snippet shape (and the file the tool writes) is one this project is confident
about, and the `notes` in the matrix say how we know. Every host in the shipped matrix is verified
today, so `open-sdd integrate --list` prints no **NO VERIFICADA** row — the legend stays because the
rule still governs any host added later. **No** means not confirmed: the CLI prints it as
**NO VERIFICADO**, `--write` refuses to touch that config file, and you paste the snippet yourself
after checking it against the host's own documentation. A snippet that looks right and is wrong is
worse than an acknowledged gap.

## How installation works

Three equivalent routes. The npm/npx route needs no global install and no Python:

```bash
npx open-sdd@latest --cursor-skills --lang en     # per host: see the alias in each section
npm install -g open-sdd && open-sdd --cursor-skills --lang en
docker run --rm -v "$PWD:/work" -w /work node:22 npx -y open-sdd@latest --cursor-skills --lang en
```

Every host section uses its own skills alias flag. `open-sdd integrate <host> --write` runs exactly
that command for you (the installer is the single implementation; `integrate` only delegates), and
registers the MCP server in the same pass.

What the install writes, in general:

- the host's skills layout, one directory per skill (`sdd-*`), with a `SKILL.md` inside each;
- `.sdd/settings/` (shared rules and templates) unless a `.kiro` layout is already in use;
- `.sdd/steering/` and `.sdd/specs/` are **not** created by the install — they are project memory
  and specs you author afterwards.

## Two paths: prompt templates (default) and MCP (opt-in)

There are two ways to give the host the open-sdd workflow, and they are not equivalent:

| Path | Command | What you get |
|---|---|---|
| **Templates only — default, works anywhere** | `open-sdd init . --write` | The 22 prompt templates in the host's commands directory. Each one points at the real engine (`open-sdd status --json`, `open-sdd brownfield analyze <feature> --json`, `open-sdd delta validate <feature> --json`, `open-sdd gates run`, …) instead of describing what it would do. No MCP, no network, nothing a security policy can block. |
| **Templates + MCP — opt-in, richer** | `open-sdd init . --write --mcp` (or `open-sdd integrate <host> --write`) | Everything above **plus** the MCP server registration, so the host can call the engine directly instead of shelling out. |

MCP is opt-in because it is not universally available: some hosts do not implement it, and some
security policies block or allow-list it. The default path must work on every host and under every
policy, so it does not depend on MCP at all. `open-sdd integrate <host> --write` still registers MCP
and installs the skills for one host; `init --write` is the project-wide default.

**Read the flow before installing it:** `open-sdd templates` lists all 22 workflows, what each one
writes, the directory every one of the eleven hosts reads, and whether that convention is verified —
plus how many are already installed *here* (counted by the installer, not by a directory listing, so a
template a human edited by hand is reported as edited and not as missing). `--host <id>` narrows it to
one host and `--json` returns the same object a script can read. It writes nothing.

The prompt templates live in the host's own convention, and only **verified** conventions are
written:

| Host | Commands directory | File | Argument token | Verified |
|---|---|---|---|---|
| Claude Code | `.claude/commands/` | `sdd-<id>.md` | `$ARGUMENTS` | yes |
| Cursor | `.cursor/commands/` | `sdd-<id>.md` | none documented | yes |
| GitHub Copilot | `.github/prompts/` | `sdd-<id>.prompt.md` | `${input:request}` (soft) | yes |
| Gemini CLI | `.gemini/commands/` | `sdd-<id>.toml` | `{{args}}` | yes |
| OpenCode | `.opencode/commands/` | `sdd-<id>.md` | `$ARGUMENTS` | yes |
| Qwen Code | `.qwen/commands/` | `sdd-<id>.md` | `{{args}}` | yes — the docs now specify Markdown with `{{args}}`; the `.toml` form is deprecated |
| Windsurf | `.windsurf/workflows/` | `sdd-<id>.md` | none documented | yes — legacy path but still read; `.devin/workflows/` is the newer preferred path; **12 000-character limit enforced** |
| Antigravity | `.agents/workflows/` | `sdd-<id>.md` | none documented | yes — legacy workflows, deprecated 2026-11-01 in favour of `.agents/skills/`; **12 000-character limit enforced** |
| Codex CLI | `.codex/prompts/` (declared) | `sdd-<id>.md` | none | **NO** — docs document only a deprecated user-scoped `~/.codex/prompts/`; the repo surface is `.agents/skills/` |
| Factory Droid | `.factory/commands/` | `sdd-<id>.md` | `$ARGUMENTS` | yes |
| Roo Code | `.roo/commands/` | `sdd-<id>.md` | none documented | yes |
| Kilo Code | `.kilo/commands/` | `sdd-<id>.md` | none documented | yes |
| JetBrains Junie | `.junie/commands/` | `sdd-<id>.md` | `$prompt` (+ injected `allowPromptArgument: true`) | yes |
| MiMoCode (Xiaomi) | `.mimocode/commands/` | `sdd-<id>.md` | `$ARGUMENTS` | yes |
| iFlow CLI | `.iflow/commands/` | `sdd-<id>.md` | `{{args}}` | yes |
| ZCode (Z.ai) | `.zcode/commands/` | `sdd-<id>.md` | `$ARGUMENTS` | yes — **SOURCE-VERIFIED**: the vendor's own resolver computes the path; its docs only say "the project directory" |
| Augment Code | `.augment/commands/` | `sdd-<id>.md` | `$ARGUMENTS` | yes |
| Trae (ByteDance) | `.trae/commands/` | `sdd-<id>.md` | none documented | yes |
| Qoder (Alibaba) | `.qoder/commands/` | `sdd-<id>.md` | none documented | yes — Qoder is the current name of Tongyi Lingma |
| CodeBuddy (Tencent) | `.codebuddy/commands/` | `sdd-<id>.md` | `$ARGUMENTS` | yes |
| Zed | none | — | none | **NO** — slash commands come from Skills; no prompt-file directory is documented |
| Cline | none | — | none | **NO** — customization is Skills; no workflow directory is documented |

Eleven of these conventions were added after reading each vendor's own documentation (or, for ZCode,
the vendor's own resolver); every one carries the URL it was checked against in `--json`, and the ones
that could not be confirmed are printed as **NO VERIFICADA** rather than guessed. Warp, Devin, Replit,
Firebase Studio, Aider, Crush, Amp, OpenHands, Goose, Kimi Code CLI, DeepSeek Harness and the
JetBrains AI Assistant have **no documented project-scoped commands directory**, so no row is invented
for them: their integration surface is skills and/or MCP, and it is declared as a gap in
`docs/PAPER-ALIGNMENT.md` (G-35) until that surface is installed for them too.

**The argument is translated, not passed through.** The 22 templates are authored once, with a single
`$ARGUMENTS` block. At install time the installer renders each host's own token: `{{args}}` for Gemini
CLI and Qwen Code, `${input:request}` for Copilot, the canonical `$ARGUMENTS` where that is what the
host substitutes, and — for the hosts whose documentation describes no placeholder at all — a plain
instruction instead of a token their engine would never expand. Before this was wired, the field was
declared in the matrix and never consumed, so three hosts silently received an argument that never
arrived. A host that publishes a per-file size limit also gets it **checked**: `windsurf` and
`antigravity` cap a workflow at 12 000 characters, and a template over the limit is reported as a
failure with the number rather than truncated. `open-sdd templates` prints both the token and the
limit per host.

An unverified host is printed as **NO VERIFICADA** and `--write` refuses to write into it, exactly as
the MCP matrix refuses an unverified snippet. The `evidence` string is the audit trail: it names the
documentation URL that was fetched for a verified host, or the exact URLs that were tried and what
they returned for one that could not be confirmed. The source of truth for this table is
`tools/open-sdd/src/core/commandTemplates.ts`; the MCP matrix is
`tools/open-sdd/src/core/integrations.ts`.

Templates are idempotent and never overwrite a human edit: each artifact carries a sha256 signature
of the body it was generated from, so a second run reports `keep`, an unedited older template is
refreshed (`update`), and an edited template is reported `keep` with the reason.

## How to verify any install

```bash
open-sdd doctor              # Node range, CLI reachability, commit hook, rigor, constitution, specs
open-sdd status              # the whole repository state on one screen
open-sdd integrate --list    # what the matrix promises for the host you installed
```

`doctor` is the same instrument in every host because the engine is the same. It reports the fix for
every check it fails; a green `doctor` plus a real `/sdd-brownfield` in the host's chat is the
definition of a working integration.

## How to uninstall

1. Remove the MCP entry: delete the `open-sdd` key from the config file in the table (for Claude
   Code you can run `claude mcp remove open-sdd` instead of editing `.mcp.json`).
2. Remove the skills: delete the host's skills layout directory (for example
   `.cursor/skills/sdd-*`).
3. `.sdd/` is your project's own memory and specs. It is not part of the install, so an uninstall
   never deletes it. Remove it deliberately if you mean to.

---

## Claude Code

- **Install:** `npx open-sdd@latest --claude-code-skills --lang en`
  (alias `--claude-skills`; the deprecated `--claude-code` prompt mode is not the skills layout).
- **What gets written:** `.claude/skills/sdd-*/SKILL.md`, plus `.sdd/settings/` and a `CLAUDE.md`
  quickstart. Detection markers: `.claude/`, `.claude/skills/`, `CLAUDE.md`.
- **Invocation in chat:** `/sdd-brownfield`, `/sdd-spec-quick <feature>`, `/sdd-impl <feature>`.
  Slash commands are bare names, no namespace.
- **MCP registration (verified), project scope `.mcp.json`:**

```json
{
  "mcpServers": {
    "open-sdd": {
      "command": "node",
      "args": ["/absolute/path/to/open-sdd/dist/cli.js", "mcp"]
    }
  }
}
```

The user scope is `~/.claude.json` and takes the same object. The host's own command writes the same
entry: `claude mcp add open-sdd -- node /absolute/path/to/open-sdd/dist/cli.js mcp`.

- **Verify:** `open-sdd doctor`, then `/sdd-help` in the chat.
- **Uninstall:** `claude mcp remove open-sdd` (or delete the key), `rm -rf .claude/skills/sdd-*`.

## Cursor

- **Install:** `npx open-sdd@latest --cursor-skills --lang en`
  (the deprecated `--cursor` command mode is not the skills layout).
- **What gets written:** `.cursor/skills/sdd-*/SKILL.md`, `.sdd/settings/`, `AGENTS.md`.
  Detection markers: `.cursor/`, `.cursor/mcp.json`, `.cursorrules`.
- **Invocation in chat:** `/sdd-brownfield`.
- **MCP registration (verified), project scope `.cursor/mcp.json`:**

```json
{
  "mcpServers": {
    "open-sdd": {
      "command": "node",
      "args": ["/absolute/path/to/open-sdd/dist/cli.js", "mcp"]
    }
  }
}
```

The user scope `~/.cursor/mcp.json` takes the same shape.

- **Verify:** `open-sdd doctor`, then `/sdd-spec-status` in the chat.
- **Uninstall:** delete the `open-sdd` key from `.cursor/mcp.json`, `rm -rf .cursor/skills/sdd-*`.

## GitHub Copilot

- **Install:** `npx open-sdd@latest --copilot-skills --lang en`
  (alias `--github-copilot-skills`).
- **What gets written:** `.github/skills/sdd-*/SKILL.md`, `.sdd/settings/`, `AGENTS.md`.
  Detection markers: `.github/copilot-instructions.md`, `.github/skills/`, `.vscode/mcp.json`.
- **Invocation in chat:** `/sdd-brownfield`.
- **MCP registration (verified — VS Code surface).** Copilot has two surfaces with different shapes: VS Code reads
  `.vscode/mcp.json` with a `servers` object and `type: "stdio"`, while the Copilot CLI uses
  `~/.copilot/mcp-config.json` with `mcpServers`. The CLI prints the VS Code shape and refuses to
  write it for you:

```json
{
  "servers": {
    "open-sdd": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/open-sdd/dist/cli.js", "mcp"]
    }
  }
}
```

- **Verify:** `open-sdd doctor`, then `/sdd-help` in the chat.
- **Uninstall:** remove the `open-sdd` entry from whichever file you used,
  `rm -rf .github/skills/sdd-*`.

## Codex CLI

- **Install:** `npx open-sdd@latest --codex-skills --lang en`
  (the deprecated `--codex` prompt mode is rejected by the CLI).
- **What gets written:** `.agents/skills/sdd-*/SKILL.md`, `.sdd/settings/`, `AGENTS.md`.
  Detection markers: `.codex/`, `.agents/skills/`, `.codex/config.toml`.
- **Invocation in chat:** `$sdd-brownfield`. Codex uses `$`, not `/`.
- **MCP registration (verified), `~/.codex/config.toml`:**

```toml
[mcp_servers.open-sdd]
command = "node"
args = ["/absolute/path/to/open-sdd/dist/cli.js", "mcp"]
```

The merge is textual: if the table already exists it is kept, otherwise it is appended at the end of
the file and nothing else changes.

- **Verify:** `open-sdd doctor`, then `$sdd-spec-status` in the chat.
- **Uninstall:** delete the `[mcp_servers.open-sdd]` table, `rm -rf .agents/skills/sdd-*`.

## Gemini CLI

- **Install:** `npx open-sdd@latest --gemini-cli-skills --lang en` (alias `--gemini-skills`).
- **What gets written:** `.gemini/skills/sdd-*/SKILL.md`, `.sdd/settings/`, `GEMINI.md`.
  Detection markers: `.gemini/`, `GEMINI.md`, `.gemini/settings.json`.
- **Invocation in chat:** `/sdd-brownfield`.
- **MCP registration (verified), project scope `.gemini/settings.json`:**

```json
{
  "mcpServers": {
    "open-sdd": {
      "command": "node",
      "args": ["/absolute/path/to/open-sdd/dist/cli.js", "mcp"]
    }
  }
}
```

That file also holds other Gemini CLI settings; the merge preserves every key it does not own. The
user scope `~/.gemini/settings.json` takes the same shape.

- **Verify:** `open-sdd doctor`, then `/sdd-spec-status` in the chat.
- **Uninstall:** delete the `open-sdd` key, `rm -rf .gemini/skills/sdd-*`.

## Windsurf

- **Install:** `npx open-sdd@latest --windsurf-skills --lang en`.
- **What gets written:** `.windsurf/skills/sdd-*/SKILL.md`, `.sdd/settings/`, `AGENTS.md`.
  Detection markers: `.windsurf/`, `.windsurfrules`, `.windsurf/skills/`.
- **Invocation in chat:** `@sdd-brownfield`. Windsurf uses mentions, not slash commands.
- **MCP registration (verified), `~/.codeium/windsurf/mcp_config.json`:**

```json
{
  "mcpServers": {
    "open-sdd": {
      "command": "node",
      "args": ["/absolute/path/to/open-sdd/dist/cli.js", "mcp"]
    }
  }
}
```

Windsurf documents MCP in a user-level file, so `--write` writes outside the repository and says so.

- **Verify:** `open-sdd doctor`, then `@sdd-spec-status` in the chat.
- **Uninstall:** delete the `open-sdd` key, `rm -rf .windsurf/skills/sdd-*`.

## OpenCode

- **Install:** `npx open-sdd@latest --opencode-skills --lang en`.
- **What gets written:** `.opencode/skills/sdd-*/SKILL.md`, `.sdd/settings/`, `AGENTS.md`.
  Detection markers: `.opencode/`, `opencode.json`, `.opencode/skills/`.
- **Invocation in chat:** `/sdd-brownfield`.
- **MCP registration (NOT verified).** OpenCode is recalled to use a top-level `mcp` object with
  `type: "local"` and an array `command` in `opencode.json`, which is a different shape from the
  `mcpServers` family. Confirm it against the host's documentation before pasting:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "open-sdd": {
      "type": "local",
      "command": ["node", "/absolute/path/to/open-sdd/dist/cli.js", "mcp"],
      "enabled": true
    }
  }
}
```

- **Verify:** `open-sdd doctor`, then `/sdd-spec-status` in the chat.
- **Uninstall:** delete the `open-sdd` key from `opencode.json`,
  `rm -rf .opencode/skills/sdd-*`.

## Google Antigravity

- **Install:** `npx open-sdd@latest --antigravity-skills --lang en` (alias `--antigravity`).
- **What gets written:** `.agent/skills/sdd-*/SKILL.md`, `.sdd/settings/`, `AGENTS.md`.
  Detection markers: `.agent/`, `.agent/skills/`, `.agent/rules/`.
- **Invocation in chat:** `/sdd-brownfield`.
- **MCP registration (VERIFIED), workspace `.agents/mcp_config.json` and global
  `~/.gemini/config/mcp_config.json`.** The file holds a single top-level `mcpServers` object, one
  entry per server, and a stdio entry carries a STRING `command` plus an `args` ARRAY (optional
  `env`, `cwd`, `disabled`, `disabledTools`). Remote entries use `serverUrl` — legacy `url`/`httpUrl`
  are explicitly unsupported. `--write` merges into the workspace file; checked against
  `https://antigravity.google/docs/mcp` and its Markdown sibling
  `https://antigravity.google/docs/mcp.md`:

```json
{
  "mcpServers": {
    "open-sdd": {
      "command": "node",
      "args": ["/absolute/path/to/open-sdd/dist/cli.js", "mcp"]
    }
  }
}
```

- **Also available:** the Interactive MCP Manager (`/mcp` in the prompt) shows live server status, and
  `Manage MCP Servers` → `View raw config` opens the same `mcp_config.json`.
- **Verify:** `open-sdd doctor`, then `/sdd-help` in the chat.
- **Uninstall:** `rm -rf .agent/skills/sdd-*` and delete the `open-sdd` key from `mcp_config.json`.

## Zed

- **Install:** Zed has no skills installer in the agent registry. Point its project rules at
  `AGENTS.md` and run the workflows from a host that installs skills, or copy the skills you want.
- **What gets written:** `AGENTS.md` (project rules). Detection markers: `.zed/`, `.rules`,
  `AGENTS.md`.
- **Invocation in chat:** `@AGENTS.md run the sdd-brownfield workflow` — Zed uses file mentions, not
  slash commands.
- **MCP registration (NOT verified), `context_servers` in Zed `settings.json`:**

```json
{
  "context_servers": {
    "open-sdd": {
      "command": {
        "path": "node",
        "args": ["/absolute/path/to/open-sdd/dist/cli.js", "mcp"]
      }
    }
  }
}
```

The file path is remembered (`~/.config/zed/settings.json` on Linux,
`~/Library/Application Support/Zed/settings.json` on macOS, `%APPDATA%\Zed\settings.json` on
Windows), but the inner entry shape is not confirmed here. `--write` refuses it.

- **Verify:** `open-sdd doctor`; confirm the server appears in Zed's agent panel.
- **Uninstall:** delete the `open-sdd` entry from `context_servers`, remove the rules reference.

## Cline

- **Install:** Cline has no skills installer in the agent registry; its rules live in
  `.clinerules/`. Install the skills for another host if you also use one, and keep the rules file
  for Cline.
- **What gets written:** `.clinerules/sdd-*.md`. Detection markers: `.clinerules/`, `.clinerules`.
- **Invocation in chat:** `@.clinerules/sdd-brownfield.md` — Cline attaches rules, it has no slash
  commands.
- **MCP registration (verified), `cline_mcp_settings.json` in the VS Code extension's
  `globalStorage`:**

```json
{
  "mcpServers": {
    "open-sdd": {
      "command": "node",
      "args": ["/absolute/path/to/open-sdd/dist/cli.js", "mcp"]
    }
  }
}
```

The path is `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
on macOS, `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
on Linux, and `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`
on Windows. Cline accepts extra per-server keys (`disabled`, `autoApprove`); the snippet omits them
because they are optional.

- **Verify:** `open-sdd doctor`; confirm the server is listed in Cline's MCP panel.
- **Uninstall:** delete the `open-sdd` key from `cline_mcp_settings.json`, remove
  `.clinerules/sdd-*.md`.

---

## See also

- [Migrating from Kiro, spec-kit and cc-sdd](migrate-from.md) — what maps, what does not, and the
  exact `open-sdd import` commands.
- [Quickstart in 60 seconds](quickstart-60s.md) — install and first spec.
- [CI integration](ci-integration.md) — make the gate chain the merge boundary.
- [Command reference](command-reference.md) — every console command.
