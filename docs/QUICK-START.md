# Quick start

Five minutes from a clone to a working spec-driven setup. Everything here is verifiable with the
commands shown.

## 1. Get the CLI running

```bash
git clone https://github.com/Brujo2020/open-sdd
cd open-sdd
npm --prefix tools/open-sdd install     # installs the CLI's dev dependencies
npm --prefix tools/open-sdd run build   # compiles to tools/open-sdd/dist/
node tools/open-sdd/dist/cli.js --help
```

The compiled CLI is present and tracked under `tools/open-sdd/dist/`, so
`node tools/open-sdd/dist/cli.js --help` works even before a build.
`npm --prefix tools/open-sdd run build` recompiles it from `tools/open-sdd/src/`.

## 2. Install into your project

Run the CLI from inside the target repository and pick your agent. Skills-based variants are the
default recommendation:

```bash
cd /path/to/your-project
node /path/to/open-sdd/tools/open-sdd/dist/cli.js --claude-skills -y   # Claude Code
node /path/to/open-sdd/tools/open-sdd/dist/cli.js --cursor-skills -y   # Cursor
node /path/to/open-sdd/tools/open-sdd/dist/cli.js --antigravity -y     # Google Antigravity
```

Or use the helper script, which takes the target repository as its first argument:

```bash
bash /path/to/open-sdd/install.sh /path/to/your-project --copilot-skills -y
```

Add `--lang es` (or any supported code) to localize the generated documents.

## 3. Use it from the agent's chat

| Step | Command |
|---|---|
| Need help | `/sdd-help` |
| Existing code, no specs | `/sdd-getspecs` — review the generated seeds before approving |
| New feature, fast path | `/sdd-spec-quick auth --auto` |
| Build it | `/sdd-impl auth` |
| Verify it | `/sdd-validate-impl auth` |
| Check progress | `/sdd-spec-status auth` |

A fresh install runs its checks and reports **without blocking**. To make an approved spec
mandatory, set the profile in `.sdd/settings/governance.json`:

```json
{ "profile": "team" }
```

`team` blocks only code written without an approved spec; `enterprise` blocks everything. See
[guides/governance-profiles.md](guides/governance-profiles.md).

## 4. Look inside the governance model

The same CLI carries the Zero-Trust console from the reference architecture. Run it from the open-sdd
checkout or the installed location:

```bash
node tools/open-sdd/dist/cli.js gates chain --profile regulated
node tools/open-sdd/dist/cli.js gates crosswalk
node tools/open-sdd/dist/cli.js gates enforcement
node tools/open-sdd/dist/cli.js govern conformance
node tools/open-sdd/dist/cli.js assure threats
```

What to expect, and what not to:

- `gates chain --profile regulated` prints `Declarados: 12 · Ejecutables: 11 · Vacíos: 1`; the one
  vacuous control is **C7/Karpathy**, declared but measuring nothing.
- `gates run` exits `1` when the chain does not pass.
- The paper's prototype figures (κ = 0.86 n=15, C4 FPR 20.0 %, the 2.1–2.2 s sweep) are **not**
  measurements of this repository. See [PAPER-ALIGNMENT.md](PAPER-ALIGNMENT.md), gaps G-01/G-02.

## 5. Reproduce the paper-alignment counts

```bash
node tools/open-sdd/dist/cli.js assure claims --verify   # §9.6 verifier; exits 1 only on a broken claim
```

Expected from either (the product command prints the Spanish equivalent):

```
35 claims | 32 verified | 0 declared-gap | 3 not-measured | 0 broken | 0 outdated-text
```

`0 broken` is the only state that would halt a publication.

## Next

- [INSTALLATION.md](INSTALLATION.md) — every install path and flag.
- [PAPER-ALIGNMENT.md](PAPER-ALIGNMENT.md) — paper → code traceability and declared gaps.
- [guides/spec-driven.md](guides/spec-driven.md) — the workflow end to end.
