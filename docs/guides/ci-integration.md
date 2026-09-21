# CI integration

How to make the Open-SDD floor the merge boundary of a real pipeline: the gate chain, the
constitutional status check, the audit evidence bundle and the SARIF 2.1.0 report that external
code scanning consumes.

> Commands below are shown as `open-sdd …` for an installed CLI. In this repository, replace
> `open-sdd` with `node tools/open-sdd/dist/cli.js`.

## What CI enforces

The enforcement floor has two halves. Level B is the pre-commit hook that runs C1/C2/C3 over the
**staged index**; level C is CI, which asks no vendor's permission and cannot be silently withdrawn.
A pipeline that only *runs* the checks but ignores their exit code is activation without measurement,
so every command below is wired to fail the job.

| Command | Blocks on | Exit codes |
|---|---|---|
| `gates run --base <ref>` | any gate `FAIL` in the resolved chain | 0 pass · 1 fail · 2 could not run |
| `status --check [feature]` | status error lines **and** constitutional alignment errors | 0 pass · 1 fail |
| `govern rigor` | a rigor aspect the declared level requires but the repository does not satisfy | 0 pass · 1 fail |
| `assure claims --verify` | a claim whose state is `broken` | 0 pass · 1 broken · 2 registry unreadable |
| `audit bundle` | a gate `FAIL` **or** a broken claim | 0 pass · 1 blocking finding · 2 could not run |
| `audit sarif` | same verdict as the bundle it serialises | 0 pass · 1 blocking finding · 2 could not run |

### The exit-code contract

```
0  pass             nothing blocking was found.
1  blocking finding a gate FAILED or a claim is broken. The job must fail.
2  could not run    the audit itself could not execute (unreadable rigor.json, unwritable bundle
                    directory, a SARIF log that fails its own shape check). NOT a pass, NOT a
                    finding: fail the job and fix the instrument.
```

Two rules keep the contract honest:

1. **Absence of evidence is not evidence of absence.** A gate whose sensor is unavailable is
   reported as `self-authorized` (never as a pass) and an absent artifact is recorded as
   `present: false` with a null hash — never as an empty file that hashes to something.
2. **Only real findings block.** `audit bundle` exits 1 on a gate `FAIL` or a broken claim.
   Alignment findings are severity-ranked in the report and in the SARIF (`error` / `warning` /
   `note`) and are made blocking by `status --check`, which is run as its own CI step.

## GitHub Actions

The repository ships a composite action, **`open-sdd gates`**, in [`action.yml`](../../action.yml).
It builds this repository's CLI — never a globally installed `open-sdd`, never an unpinned registry
copy — and then runs, in the caller's workspace: `govern rigor`, `gates chain`, `gates run`,
`status --check`, `audit bundle` + SARIF, and the SARIF upload.

### Inputs

| Input | Default | Meaning |
|---|---|---|
| `feature` | `''` | Feature spec to audit. Empty means every spec under `.sdd/specs`. |
| `level` | `spec-first` | **Minimum** rigor level the run must satisfy: `spec-first`, `spec-anchored`, `spec-as-source`. The declared level in `.sdd/settings/rigor.json` must be at least this. |
| `sarif` | `.sdd/audit/open-sdd.sarif` | Where the SARIF 2.1.0 report is written, relative to the repository root. |
| `profile` | `solo` | Gate-chain reduction profile: `solo`, `team`, `regulated`. |
| `base` | `''` | Git ref the chain diffs against. Empty derives the pull-request base commit, then `HEAD~1`. |
| `upload-sarif` | `true` | Upload the report to code scanning (needs `security-events: write`). |
| `node-version` | `20` | Node.js used to build and run the CLI. |

### Outputs

| Output | Meaning |
|---|---|
| `bundle` | Directory of the evidence bundle (`.sdd/audit/ci`). |
| `manifest` | Path of `manifest.json`, with one sha256 per artifact. |
| `sarif` | Path of the SARIF 2.1.0 report. |
| `exit-code` | Bundle exit code: `0` pass · `1` blocking finding · `2` could not run. |
| `verdict` | `pass` or `blocked`. |

### Example workflow

```yaml
name: gates

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  security-events: write   # required by the SARIF upload

jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0      # `--base` diffs against the base commit

      # Pin the action to a commit SHA: the action and the gates it enforces are the same artifact.
      - uses: Brujo2020/open-sdd@<commit-sha>
        with:
          feature: ${{ vars.SDD_FEATURE }}
          level: spec-first
          sarif: .sdd/audit/open-sdd.sarif

      # Optional: consume the verdict without re-running the audit.
      - name: Show the audit verdict
        if: always()
        run: echo "audit=${{ steps.gates.outputs.verdict }} exit=${{ steps.gates.outputs.exit-code }}"
```

The action's evidence-bundle step exits with the bundle's exit code, so a blocking finding fails the
job; `upload-artifact` and `upload-sarif` run with `if: always()` so the evidence is available even
when the job is red.

### Running the steps by hand

If you would rather not use the action, the equivalent steps in this repository are:

```yaml
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install and build the pinned CLI
        working-directory: tools/open-sdd
        run: |
          npm ci
          npm run build

      - name: Run the gate chain against the change
        run: |
          BASE="${{ github.event.pull_request.base.sha }}"
          if [ -z "$BASE" ]; then BASE="HEAD~1"; fi
          node tools/open-sdd/dist/cli.js gates run --base "$BASE"

      - name: Constitutional status check
        run: node tools/open-sdd/dist/cli.js status --check

      - name: Audit evidence bundle and SARIF
        run: |
          node tools/open-sdd/dist/cli.js audit bundle \
            --out .sdd/audit/ci \
            --sarif .sdd/audit/open-sdd.sarif

      - name: Upload SARIF to code scanning
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: .sdd/audit/open-sdd.sarif
          category: open-sdd
```

Every command is invoked through `node tools/open-sdd/dist/cli.js`. **Never** invoke a bare
`open-sdd`: a globally installed copy of a different version resolves from `PATH` and would decide
the verdict with code the repository does not contain.

## GitLab CI

GitLab has no composite-action equivalent, so the job runs the CLI directly. Same contract, same
exit codes, same artifacts:

```yaml
open-sdd-gates:
  stage: test
  image: node:20
  variables:
    # Pin the tool version. Use the scoped package once published, or a checkout of this repository.
    OPEN_SDD_CLI: 'node tools/open-sdd/dist/cli.js'
    SDD_FEATURE: ''
  before_script:
    - npm ci --prefix tools/open-sdd
    - npm run build --prefix tools/open-sdd
  script:
    # 1. The declared rigor level must satisfy the run (raise it in .sdd/settings/rigor.json).
    - $OPEN_SDD_CLI govern rigor

    # 2. The Zero-Trust chain against the change. GitLab provides the base SHA for merge requests.
    - |
      if [ -n "$CI_MERGE_REQUEST_DIFF_BASE_SHA" ]; then
        BASE="$CI_MERGE_REQUEST_DIFF_BASE_SHA"
      else
        BASE="HEAD~1"
      fi
      $OPEN_SDD_CLI gates run --base "$BASE"

    # 3. Constitutional status. Alignment errors fail here as well as in the chain.
    - |
      if [ -n "$SDD_FEATURE" ]; then
        $OPEN_SDD_CLI status "$SDD_FEATURE" --check
      else
        $OPEN_SDD_CLI status --check
      fi

    # 4. The evidence bundle and the SARIF report. Exit 1 (blocking) and 2 (could not run) both fail.
    - |
      $OPEN_SDD_CLI audit bundle \
        --out .sdd/audit/ci \
        --sarif .sdd/audit/open-sdd.sarif
  artifacts:
    when: always
    expire_in: 30 days
    paths:
      - .sdd/audit/
    # Newer GitLab versions can ingest a SARIF report with `reports: { sarif: <path> }`; where that
    # is not available, the file above is still a normal artifact any consumer can read.
  rules:
    - if: $CI_PIPELINE_SOURCE == 'merge_request_event'
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

Two adaptations are usually needed:

- **Tool acquisition.** The snippet builds the CLI from a checkout (`tools/open-sdd`). To use a
  published artifact instead, install a pinned version and set
  `OPEN_SDD_CLI: node node_modules/@brujo2020/open-sdd/tools/open-sdd/dist/cli.js`; never rely on a
  global install.
- **Network policy.** `gates run`, `status --check` and `audit bundle` work offline. The claims
  registry (`assure claims --verify`) executes local verifier commands only.

## The audit evidence bundle

`audit bundle` writes an auditor-readable record of what the tool decided. Nothing is recomputed by
hand and no verdict is re-derived: the bundle calls the same modules the commands call and records
their output.

```
.sdd/audit/<timestamp>/          # or --out <dir>, e.g. .sdd/audit/ci
├── manifest.json                # verdict, tool version, timestamp, one sha256 per artifact
├── constitution.md              # the constitution text, if present
├── constitution.json            # principles in force + the compliance matrix
├── specs/<feature>/…            # requirements.md, plan.md, tasks.md, delta.md, spec.json
├── gates.json                   # resolved chain + the full runChain report
├── claims.json                  # the execute-by-exit-code claims registry verdict
├── alignment.json               # specConstitution alignment report per spec
└── rigor.json                   # declared level and the gates it activates
```

`manifest.json` carries `schema`, `tool.name`/`tool.version`, `generatedAt`, `verdict`
(`passed`, `exitCode`, `blockedBy`), the scope, a `findings` list — and `artifacts`, one entry per
artifact with `id`, `role`, `present`, `path`, `bytes` and `sha256`. An artifact that does not
exist is recorded as `present: false` with a null hash: the bundle never turns absence into an
empty file that hashes to something.

### Verifying the hashes

An auditor does not have to trust the tool to recompute a hash:

```bash
BUNDLE=.sdd/audit/ci
node -e '
  const { createHash } = require("node:crypto");
  const { readFileSync } = require("node:fs");
  const path = require("node:path");
  const manifest = JSON.parse(readFileSync(path.join(process.argv[1], "manifest.json"), "utf8"));
  let bad = 0;
  for (const a of manifest.artifacts) {
    if (!a.present || a.external) continue;
    const digest = createHash("sha256").update(readFileSync(path.join(process.argv[1], a.path), "utf8")).digest("hex");
    if (digest !== a.sha256) { console.error("MISMATCH", a.path); bad += 1; }
  }
  console.log(`verdict=${manifest.verdict.passed ? "pass" : "blocked"} artifacts=${manifest.artifacts.length} mismatches=${bad}`);
  process.exit(bad === 0 ? 0 : 1);
' "$BUNDLE"
```

### JSON mode

`audit bundle --json` emits the shared envelope
(`{ ok, command, data, findings: { errors, warnings }, detail }`) where `data` is the manifest.
`ok` equals the verdict, so a script can branch on one field and still read the whole evidence set.

## SARIF 2.1.0

`audit bundle --sarif <path>` and `audit sarif [feature] [--out <path>]` emit OASIS SARIF 2.1.0
with exactly one `run`, the tool as `tool.driver`, and one `result` per finding. Every result
carries:

- `ruleId` — the gate id (`C1`…`C7`, `O1`…`O7`), the alignment code (`UNKNOWN_PRINCIPLE`, …) or the
  claim id (`CLAIM-…`); every referenced id is declared in `tool.driver.rules`;
- `level` — `error` for gate FAILs and broken claims, `warning`/`note` for alignment findings;
- `message.text` — the same sentence the human report prints;
- `locations[0].physicalLocation.artifactLocation.uri` — the repository-relative path of the
  artifact the finding is about, with `region.startLine` when the line is known (a C2 secret on a
  line, a broken claim in the registry).

`version` is exactly `2.1.0` and `$schema` is the canonical
`https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json`.
The tool checks its own output before writing it (`validateSarifShape`): a log that fails the shape
check is an exit-2 condition, never a silently malformed upload.

`audit sarif` prints to stdout and writes nothing else, so it composes:

```bash
node tools/open-sdd/dist/cli.js audit sarif --out .sdd/audit/open-sdd.sarif || test $? -eq 1
```

## The published container image

The `container` job in [`.github/workflows/gates.yml`](../../.github/workflows/gates.yml) builds the
[`Dockerfile`](../../Dockerfile) for **`linux/amd64` and `linux/arm64`** and, when the run is allowed
to publish, pushes both platforms to the GitHub Container Registry. A multi-architecture build that
nobody can pull is a promise, not a distribution, so the image is published under tags a human can
actually resolve.

### Pulling and running it

The version tag is read from the repository's root `package.json` by the job, so it is the version
this tree declares; `latest` tracks the default branch. In a checkout you can derive it instead of
copying a literal that goes stale:

```bash
TAG="$(node -p "require('./package.json').version")"   # 3.2.0 at the time of writing
IMAGE="ghcr.io/brujo2020/open-sdd:${TAG}"

# Pull the version this release declares, or the default branch's build.
docker pull "$IMAGE"
docker pull ghcr.io/brujo2020/open-sdd:latest

# Run the CLI against the repository you are standing in. `status` is the default command.
docker run --rm -v "$PWD:/work" "$IMAGE" status

# Any other command: the image's entrypoint is `node /app/dist/cli.js`.
docker run --rm -v "$PWD:/work" "$IMAGE" gates run
docker run --rm "$IMAGE" --version
```

Written out, that is the pull a reader copies when the declared version is `3.2.0`:

```bash
docker pull ghcr.io/brujo2020/open-sdd:3.2.0
docker run --rm -v "$PWD:/work" ghcr.io/brujo2020/open-sdd:3.2.0 status
```

The container runs as the non-root user `sdd` and `status`/`gates`/`delta` only read the mount. For a
command that writes into it (the installer, `--write`), add `--user "$(id -u):$(id -g)"` or mount a
writable copy: a container user cannot write into a directory owned by your host user.

### What is published, and when

| Ref | Tags | When |
|---|---|---|
| `refs/heads/main` | `:<version>`, `:sha-<commit>`, `:latest` | every green run on `main` |
| `refs/tags/v*.*.*` | `:<version>`, `:sha-<commit>` | every green run on a version tag |
| `pull_request` | none — the job builds for both platforms and does not push | every pull request, forks included |

Two consequences worth stating plainly:

- **The image will exist only after the first successful run on `main`.** Until then
  `docker pull ghcr.io/brujo2020/open-sdd:3.2.0` fails with `manifest unknown` (or `denied`): there is
  no earlier image and no fallback registry. A version tag publishes the image with the version in
  `package.json` at the tagged commit; `:latest` is only moved by a run on the default branch, so an
  old maintenance tag cannot drag `latest` backwards.
- **A pull request cannot publish.** The job's `PUSH_IMAGE` guard is
  `github.event_name != 'pull_request' && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v'))`;
  a pull request is always `refs/pull/<n>/merge`, so the GHCR login step is skipped and the build runs
  with `push: false`. `permissions: packages: write` is scoped to this one job — the gate and Windows
  jobs never hold it — and GitHub withholds write tokens from fork pull requests regardless.

GHCR packages are **private by default**, even in a public repository: the first image is visible only
to the account that owns the package until it is switched to public in the repository's *Packages*
settings (<https://github.com/users/Brujo2020/packages/container/package/open-sdd>). Until then, pull
it authenticated:

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
```

### Verifying what a tag points at

The tags are derived in CI from `package.json` and `github.sha`, never re-typed, and the build that
produced them is the same job that passed the build check for both platforms:

```bash
docker buildx imagetools inspect ghcr.io/brujo2020/open-sdd:3.2.0   # manifest list: both platforms
node -p "require('./package.json').version"                          # the version the tag was read from
```

## Proving the commit hook on a non-POSIX host

Level B is the pre-commit hook, and on Windows it is the half of the floor that no Linux job can
witness: git, the shell git uses to honour the hook's shebang, and the Node that receives the file
are all different binaries there. Running the test suite on Windows is **not** the same thing as
running the hook git invokes — the suite imports the gate's code, it does not let git call it.

The `windows` job therefore ends with a step that executes the hook for real, and the step is the
proof rather than a description of one:

1. `git init` a throwaway fixture **outside** the repository, with a valid `.sdd/specs/governance`
   triad so the blocking gates judge a real tree.
2. Copy `tools/open-sdd/templates/hooks/pre-commit.mjs` to `<fixture>/.githooks/pre-commit` — the
   extensionless path the installer ships — and set `core.hooksPath` to `.githooks`, so **git** is
   what resolves and invokes the hook.
3. Run the hook directly through `node` on a clean index (**exit 0**) and on an index carrying a real
   C2 finding, an AWS access key (**non-zero**).
4. Run the real `git commit` on the same two indexes and assert the same exit codes, plus the hook's
   own output: `COMMIT BLOQUEADO` when it refuses, and its gate banner when it accepts. An exit 0 with
   no banner would mean git never ran the hook, which is the failure the step exists to catch.

No `--no-verify` appears anywhere — a bypass would prove the opposite of the claim — and nothing is
skipped or marked `continue-on-error`. The script is plain `bash` because that is the shell Git for
Windows uses for hooks; the same commands run unchanged on macOS and Linux, which is how the exit
codes below were established before the Windows runner ever saw them:

| Command | Local (macOS) exit code |
|---|---|
| `node tools/open-sdd/templates/hooks/pre-commit.mjs` (clean index) | `0` |
| `node tools/open-sdd/templates/hooks/pre-commit.mjs` (staged AWS key) | `1` |
| `git commit` through `core.hooksPath` (staged AWS key) | `1` |
| `git commit` through `core.hooksPath` (clean index) | `0` |

What a green local run does **not** establish, and only the Windows runner can:

- that Git for Windows honours the `#!/usr/bin/env node` shebang of an **extensionless** hook and
  hands the file to Windows `node.exe` (POSIX hosts never exercise this path);
- that Windows Node executes the hook file and the CLI it spawns, including the `process.platform ===
  'win32'` branches (`PATH` + `PATHEXT` resolution, rejection of `.cmd` bin shims instead of feeding
  them to Node, CRLF-tolerant reads);
- that git's own `core.hooksPath` lookup finds the installed hook and propagates its non-zero exit
  back to `git commit`, so a refused commit is refused by the gate and not by a shell error;
- that a Windows checkout (CRLF, no execute bit) of the hook still yields exit codes `1` and `0` in
  the two cases above.

Until that step has run on `windows-latest` and reported green, the portable-gate claim is proven for
POSIX hosts only: the table above is a macOS measurement, and the same commands on the Windows runner
are a prediction from it, not a measurement.

## Related

- [`docs/PAPER-ALIGNMENT.md`](../PAPER-ALIGNMENT.md) — what each control actually implements.
- [`docs/guides/governance-profiles.md`](governance-profiles.md) — `solo`, `team` and `enterprise`.
- [`docs/guides/brownfield-delta-workflow.md`](brownfield-delta-workflow.md) — the delta and the
  three rigor levels this pipeline enforces.
