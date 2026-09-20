# open-sdd

`open-sdd` is the layer that makes an AI coding agent's "done" verifiable: executable gates, delta
specs for code that already exists, and a constitution that validates every spec.

[![License: MIT](https://img.shields.io/github/license/Brujo2020/open-sdd)](https://github.com/Brujo2020/open-sdd/blob/main/LICENSE)
[![CI — Linux + Windows](https://img.shields.io/github/actions/workflow/status/Brujo2020/open-sdd/gates.yml?branch=main)](https://github.com/Brujo2020/open-sdd/actions/workflows/gates.yml)

**English** · [Español](README.es.md)

## The problem

AI agents write code fast, and their "it is finished" is a claim nobody checks.
Prompt-only spec-driven tools produce documents, and a document does not fail a build.
This tool turns the claim into something executable: a gate decides pass or fail, and a control that
is declared but not implemented is reported as declared instead of counted as green.

## Install and the first 60 seconds

```bash
npx @brujo2020/open-sdd init . --write
```

Run it inside your repository. It detects the host agent, records the rigor level in
`.sdd/settings/rigor.json` and installs the commit gate (`.git/hooks/pre-commit`). It is plan-first:
without `--write` it only prints the plan, and it never overwrites an existing file. To install the
host's skills too, add `--skills`; `open-sdd integrate <host> --write` installs the skills **and**
registers the MCP server (`--list` shows the ten hosts; six carry a verified registration).

Then the one door. No arguments, read-only: it prints a 0–100 SDD score, the current phase and ONE
next action, with one line of why.

```bash
open-sdd                 # SDD score, phase and the single next action
open-sdd status          # the same state as a full panel
open-sdd --help          # every command
```

The console messages are currently Spanish; `--lang en` fully translates `open-sdd tour` and
`open-sdd context` only. The commands above work from the published package. In this checkout,
replace `open-sdd` with `node tools/open-sdd/dist/cli.js`.

Optional: the 60-second demo, offline, in a throwaway temp directory.

```bash
git clone https://github.com/Brujo2020/open-sdd && cd open-sdd
bash scripts/demo-60s.sh
```

It injects four real incoherences — an untraced requirement, a completed task with no evidence, an
unfilled `{{…}}` marker, a declared contract that does not exist — and exits non-zero if the tool
misses any of them.

## What you get

- **An MCP server.** A stdio JSON-RPC server with 11 tools and read-only resources, callable by any
  modern MCP host. No network, no model backend, no API keys.
- **Delta specs.** `ADDED` / `MODIFIED` / `REMOVED` / `RENAMED`, with delta-scoped `REQ-<AREA>-<NNN>`
  ids, so the contract of change stays finite.
- **A constitution as the pivot.** Every spec is validated against
  `.sdd/steering/constitution.md`; `brownfield constitution --draft` proposes it and a human ratifies it.
- **A rigor ladder.** `spec-first` → `spec-anchored` → `spec-as-source`, fluid by default and
  cumulative: each step only adds gates, and a valid constitution is required at every level.
- **A commit gate and PR checks.** A pre-commit hook over the staged index, and a pull-request
  workflow that runs the full chain.
- **An audit bundle.** One sha256 per artifact plus SARIF 2.1.0; exits non-zero on a blocking finding.
- **On-demand assistants.** Where a command already found a gap — an ambiguous EARS requirement, an
  unfilled marker, a missing constitution — it proposes a paste-ready fix or asks an explicit question.
- **Brownfield adoption.** `brownfield bootstrap` produces a module map, a codebase-intelligence
  document, a reverse constitution and reuse-first candidates.
- **Importers.** `import kiro | spec-kit | cc-sdd` maps incumbent artifacts into `.sdd/` and names
  every skip with its reason.

## How it compares

Qualitative, from the alternatives' public documentation. This is **not a benchmark**.

| | this tool | spec-kit | Kiro | prompt-only skill packs |
|---|---|---|---|---|
| Nature | CLI + MCP engine | prompt/skill toolkit | SDD inside one IDE | prompts and skills |
| Host integration | MCP server; 18 agent definitions, 10 host registrations (6 verified) | broad install and integration surface | its own IDE | the host's chat |
| Specs for existing code | delta specs + reverse constitution | spec workflow; a brownfield-bootstrap extension is proposed (#1436) | spec workflow in the IDE | documents only |
| Enforcement | executable gates, exit codes, commit hook + PR checks | prompts and review | IDE-guided workflow | none |
| Evidence / audit | audit bundle, sha256 per artifact, SARIF | the documents themselves | IDE artifacts | none |
| Offline | no network, no model backend | local templates and scripts | IDE product | host-dependent |

spec-kit does two things this repository does not: a much broader ecosystem and integration surface,
and a gentler learning curve. Kiro's IDE integration is smoother than anything shipped here. If you
live in either, they are good choices; no parity of ecosystem, polish or adoption is claimed.
[Migrate from Kiro, spec-kit and cc-sdd](docs/guides/migrate-from.md) maps their artifacts onto this
one.

## What it does not do yet

- **Module discovery is Node-only.** Workspace roots come from `package.json`; Maven/Gradle, Go, Rust
  and Python monorepos return a single root module from `brownfield bootstrap`.
- **Impact analysis has known false-positive classes.** `brownfield impact` reads the import graph
  and the delta, and a check with that noise level can train its readers to ignore it.
- **Four of ten MCP registrations are unverified.** Copilot, OpenCode, Zed and Antigravity ship as
  unverified: the snippet is printed and `--write` refuses to touch their config.
- **The container is built for one architecture.** `docker build` produces the builder's
  architecture, and no CI job builds or pushes a multi-arch image.
- **The measurements are synthetic.** `docs/MEASUREMENTS.md` records 10/10 injected classes caught on
  repositories this project wrote — self-consistency, not field recall or precision. The paper's
  κ/FPR/latency figures belong to an unpublished prototype and are not measurements of this repository.
- **The commit floor is installed, but level A is not verified.** The hook and the PR matrix exist
  and run; no behavioural sentinel has verified write-time blocking in any host, and
  `git commit --no-verify` is not recorded.

The complete list of gaps (G-01 … G-29), each with its code location, is in
[docs/PAPER-ALIGNMENT.md](docs/PAPER-ALIGNMENT.md).

## Documentation

[Install](docs/INSTALL.md) · [Quickstart (60 s)](docs/guides/quickstart-60s.md) ·
[Integrations](docs/guides/integrations.md) · [Existing projects](docs/guides/existing-projects.md) ·
[Migrate from Kiro / spec-kit / cc-sdd](docs/guides/migrate-from.md) ·
[Measurements](docs/MEASUREMENTS.md) · [Paper alignment and gaps](docs/PAPER-ALIGNMENT.md) ·
[Español](README.es.md) · [Changelog](CHANGELOG.md)

## License

MIT — see [LICENSE](LICENSE).
