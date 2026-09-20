# Install

Every way to get `open-sdd` onto a machine and into a repository, least friction first. The version
this documentation describes is **v3.0.2** (`package.json` at the repository root). It is **not on the
npm registry yet**; each path below says plainly whether it installs this version or the older one
that is published.

## Prerequisites

| Requirement | Why | Check |
|---|---|---|
| Node.js **>= 20** | Declared in `package.json` `engines.node`. The CLI, the commit hook and the tests are Node ESM. | `node --version` |
| git | The brownfield impact/contracts reports diff against history and the commit gate lives in `.git/hooks`. | `git --version` |
| npm | Only to build from a clone or install the package. The CLI itself has **no runtime dependencies** (every import is relative or `node:`). | `npm --version` |
| Docker (optional) | The container path, if you do not want Node on the host. | `docker --version` |

`open-sdd doctor` re-checks the Node range and the git environment after install.

---

## 1. `npx`, no install

The scoped package name is `@brujo2020/open-sdd`. The **unscoped** `open-sdd` does **not exist** on
the registry, so `npx open-sdd@latest` is never this project.

This release (**v3.0.2**) is not published yet. The registry currently carries **v2.0.0** under the
same scoped name — an older toolkit with different commands. The command below therefore runs today,
but it gives you the old binary, not the one this documentation describes:

```bash
npx --yes @brujo2020/open-sdd@latest --version   # runs the published v2.0.0 toolkit
```

Once v3.0.2 is published, the same entry point installs the skills into the current directory with no
clone. **These two commands do not work yet** — they are the shape the release will have:

```bash
npx @brujo2020/open-sdd@latest --claude-skills -y    # pending publication
npx @brujo2020/open-sdd@3.0.2 --cursor-skills -y     # pending publication
```

Until then, use the global install, the container, or a clone below.

---

## 2. Global npm install

**From a checkout (recommended until v3.0.2 is published).** This builds the CLI from source and puts
it on your `PATH`:

```bash
git clone https://github.com/Brujo2020/open-sdd
cd open-sdd
npm run install:global     # npm --prefix tools/open-sdd run build && npm install -g .
open-sdd --version         # open-sdd v3.0.2
```

**From the registry** (installs the published v2.0.0 today):

```bash
npm install -g @brujo2020/open-sdd
open-sdd --version
```

Then, from inside a target repository:

```bash
cd /path/to/your/project
open-sdd --claude-skills -y
```

---

## 3. Container

The `Dockerfile` is multi-stage: it compiles the CLI, then copies only the compiled output, the
templates and `package.json`. The final image has no `node_modules`, runs as a non-root user and
pins its base tag.

```bash
git clone https://github.com/Brujo2020/open-sdd
cd open-sdd
docker build -t open-sdd .
docker run --rm -v "$PWD:/work" open-sdd doctor
docker run --rm -v "$PWD:/work" open-sdd status
```

Read-only commands (`status`, `gates`, `delta validate`) work against the mounted repository as-is.
Commands that **write** into it (the installer, `--write` flags) need either
`--user "$(id -u):$(id -g)"` or a writable copy, because the container user is not your host user.

---

## 4. From a clone (contributors)

```bash
git clone https://github.com/Brujo2020/open-sdd
cd open-sdd
npm --prefix tools/open-sdd ci
npm --prefix tools/open-sdd run build
npm --prefix tools/open-sdd test
node tools/open-sdd/dist/cli.js --version
```

`tools/open-sdd/dist/` is tracked, so the CLI also runs before a build
(`node tools/open-sdd/dist/cli.js --help`). Building first is the honest baseline: it is what the
tests exercise.

---

## Install the skills into a repository

Three commands install different things. Do not confuse them; run each **inside the target
repository**.

| Goal | Command | Writes |
|---|---|---|
| Agent skills + settings | `open-sdd --claude-skills -y` | `.sdd/settings/`, the agent's skill directory, the agent documentation file |
| Project scaffold (templates + rigor + commit gate) | `open-sdd init . --agent claude-code-skills --write` | the host's **prompt templates**, `.sdd/settings/rigor.json`, `.git/hooks/pre-commit` |
| Project scaffold + MCP (opt-in) | `open-sdd init . --agent claude-code-skills --write --mcp` | everything above **plus** the host's MCP server registration |
| Commit gate + PR workflow | `open-sdd floor install . --ci` | `.git/hooks/pre-commit`, `.github/workflows/open-sdd-gates.yml` |

Known agent flags include `--claude-skills`, `--codex-skills`, `--cursor-skills`,
`--copilot-skills`, `--gemini-skills`, `--windsurf-skills`, `--opencode-skills` and
`--antigravity`. The full table (ids, aliases, install directories) is the README's
[Supported host agents](../README.md) section and
`tools/open-sdd/src/agents/registry.ts`.

### Two paths: prompt templates (default) or templates + MCP (opt-in)

`open-sdd init . --write` installs the **prompt templates** for the host it detected. That is the
default because it works anywhere: the templates are plain files in the directory the host already
reads, they need no network, and no security policy can block them. Each template points at the real
engine (`open-sdd status --json`, `open-sdd delta validate <feature> --json`, …) instead of guessing.

| Path | Command | What you get |
|---|---|---|
| **Templates only — default, works anywhere** | `open-sdd init . --write` | The 22 prompt templates in the host's commands directory — `/sdd-onboard`, `/sdd-constitution`, `/sdd-specify`, `/sdd-plan`, `/sdd-tasks`, `/sdd-implement`, `/sdd-analyze`, `/sdd-converge`, `/sdd-release`, and the rest. No MCP, no network, nothing a security policy can block. |
| **Templates + MCP — opt-in, richer** | `open-sdd init . --write --mcp` | Everything above **plus** the MCP server registration, so the host can call the engine directly instead of shelling out. `open-sdd integrate <host> --write` is the host-by-host equivalent. |

MCP is **opt-in** because it is not universally available: some hosts do not implement it, and some
security policies block or allow-list it. The default path must work on every host and under every
policy, so it does not depend on MCP at all.

The template install is idempotent and never overwrites a file you edited. Every artifact carries a
sha256 signature of the body it was generated from: a second `init --write` reports `keep`, an
unedited older template is refreshed (`update`), and an edited template is reported `keep` with the
reason instead of being replaced. A host whose prompt-template convention is **not verified** (Codex
CLI, Windsurf, Qwen Code, Antigravity, Zed, Cline) is marked `NO VERIFICADA` and `--write` refuses to
write into it — the same rule the MCP matrix follows. `open-sdd integrate --list` is the live matrix
for MCP; the prompt-template matrix is `tools/open-sdd/src/core/commandTemplates.ts`.

The per-host commands directories are: Claude Code `.claude/commands/`, Cursor `.cursor/commands/`,
GitHub Copilot `.github/prompts/` (`.prompt.md`), Gemini CLI `.gemini/commands/` (`.toml`), OpenCode
`.opencode/commands/`.

Preview before writing with `--dry-run`:

```bash
open-sdd --claude-skills --dry-run
```

### What is never overwritten

- The **project initizer** (`open-sdd init .`) reports `keep` for every artifact that already exists:
  `.sdd/settings/rigor.json` and the constitution are never overwritten. The one exception is the
  commit hook, which is refreshed when it is an older version of our own template; a hook that is not
  ours is never touched.
- The **skills install** uses `--overwrite=prompt` by default (ask per file). In a non-TTY
  environment `prompt` falls back to `skip`, so an unattended run creates what is missing and keeps
  what exists. `-y` maps `prompt` to `force` and *does* overwrite; use `--backup[=<dir>]` to keep a
  copy first.

---

## What the installer writes, and where

Verified by installing into a throwaway git repository with `open-sdd --claude-skills -y`:

| Path | What it is |
|---|---|
| `.sdd/settings/governance.json` | What blocks: `solo` (default) / `team` / `enterprise`. |
| `.sdd/settings/git.json` | Git automation, shipped **assisted and never pushing**. |
| `.sdd/settings/templates/…` | Spec, steering and steering-custom templates. |
| `.claude/skills/sdd-*/SKILL.md` (+ `rules/`, `references/`, `templates/` for some skills) | The 21 skills, for Claude Code Skills. Other agents write their own directory (`.cursor/skills`, `.agent/skills`, …). |
| `CLAUDE.md` / `AGENTS.md` | The agent's documentation file, where that agent uses one. |

Not written by that command, on purpose:

- `.sdd/specs/<feature>/` — created by the workflow commands (`/sdd-spec-init`, `open-sdd init <feature>`).
- `.sdd/steering/` — created by `/sdd-steering` or `open-sdd brownfield constitution . --write`.
- `.sdd/settings/rigor.json` and `.git/hooks/pre-commit` — these belong to `open-sdd init . --write`.
- `.github/workflows/open-sdd-gates.yml` — this belongs to `open-sdd floor install . --ci`.

---

## Verify the install

The diagnosis command is `open-sdd doctor`. It runs nine checks — Node range, CLI reachable, commit
hook state, hook portability, declared rigor, constitution, specs, no-model/no-network, and the git
environment — and exits non-zero on a failure. Real shape on this repository:

```text
✓ [ok] Versión de Node: Node v26.7.0 cumple el rango ">=20" declarado en package.json.
✓ [ok] CLI alcanzable: El CLI responde desde tools/open-sdd/dist/cli.js y reporta la versión 3.0.2.
✓ [ok] Hook de commit: Hook instalado en .git/hooks/pre-commit (.git/hooks), ejecutable e idéntico a la plantilla vigente pre-commit.mjs.
✓ [ok] Rigor declarado: nivel spec-first · gates activos: C1, C2 · rationale declarado (…).
✓ [ok] Sin modelo y sin red: No se requiere backend de modelo ni acceso a red: el CLI es determinista y funciona offline.

Diagnóstico de /path/to/repo: 9 ok · 0 aviso(s) · 0 fallo(s) — sin fallos.
```

The other two checks most people run first:

```bash
open-sdd --version                 # the CLI responds
ls .claude/skills                  # the skills landed (example for Claude Code Skills)
```

---

## Upgrade

Short version: re-run the installer and the project initizer; both are idempotent and a `keep` is a
promise that your edits survive. `open-sdd doctor` tells you when the commit gate is an older
version of ours. The full path — including what to do when `doctor` reports the gate as outdated and
how to roll back — is [Upgrade](guides/upgrade.md).

```bash
npm run install:global                                  # or: npm install -g @brujo2020/open-sdd
open-sdd init . --agent claude-code-skills --write      # refreshes a stale hook, keeps everything else
```

Release history and the current `[Unreleased]` section are in [CHANGELOG.md](../CHANGELOG.md).

---

## Uninstall

There is **no** uninstall command, and the installed artifacts carry no lock file. Remove the three
things by hand, or restore them from version control:

1. The global CLI: `npm uninstall -g @brujo2020/open-sdd`.
2. The commit gate: delete `.git/hooks/pre-commit` (and unset `core.hooksPath` if you opted into a
   versioned hooks directory). From a clone, `node scripts/install-hooks.mjs --uninstall` does this
   for that checkout.
3. The project artifacts: `.sdd/`, the agent's skill directory (`.claude/skills/`, `.cursor/skills/`,
   …) and the agent documentation file (`CLAUDE.md` / `AGENTS.md`). If you used
   `open-sdd floor install . --ci`, also remove `.github/workflows/open-sdd-gates.yml`.

Your own content — `.sdd/specs/`, `.sdd/steering/` and anything you edited — is plain Markdown under
version control; delete only what you do not want to keep.

---

## Offline and air-gapped installs

The CLI has **no runtime dependencies**, so one tarball is enough. On a connected machine with the
checkout:

```bash
npm pack          # produces brujo2020-open-sdd-3.0.2.tgz
```

Transfer that file and install it without a registry:

```bash
npm install -g /path/to/brujo2020-open-sdd-3.0.2.tgz
open-sdd --version
```

Or into a single project instead of globally:

```bash
npm install /path/to/brujo2020-open-sdd-3.0.2.tgz
./node_modules/.bin/open-sdd --version
```

For the container on an isolated host, move the image, not the source:
`docker save open-sdd -o open-sdd.tar` on the connected side, `docker load -i open-sdd.tar` on the
isolated side.

Everything the console does — `status`, `gates`, `delta validate`, `brownfield …`, the 60-second demo
— runs offline. `npx` and `npm install` from the registry are the only steps that need the network.
