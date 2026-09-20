# Quickstart — the 60-second demo

This is the shortest honest path to seeing what `open-sdd` actually does: it creates a throwaway
repository containing real incoherences, runs the CLI against it, and shows the tool naming them.
No network, no `npm install`, nothing written outside a temp directory.

## Prerequisites

- Node.js **20 or newer** (`node --version`).
- This repository checked out, with the CLI built once:

```bash
git clone https://github.com/Brujo2020/open-sdd
cd open-sdd
npm --prefix tools/open-sdd ci
npm --prefix tools/open-sdd run build
```

`tools/open-sdd/dist/` is tracked, so a fresh clone can often run the CLI without building; building
first is still the honest baseline, because that is what the tests exercise.

## Run the demo

```bash
sh scripts/demo-60s.sh
```

It takes well under a minute. The script:

1. Creates a temp repo with a real spec triad (`.sdd/specs/payments/`: requirements in EARS, plan,
   tasks, and a delta).
2. Injects four incoherences that a real team produces:

   | Incoherence | Where it lives |
   |---|---|
   | A delta requirement (`REQ-PAY-011`) with no task implementing it | `delta.md` vs `tasks.md` |
   | A task marked complete with no `_Evidence:` line | `tasks.md` |
   | A task still carrying the template placeholder `{{REQ-AREA-002}}` | `tasks.md` |
   | A declared contract (`test/ledger.test.ts`) that does not exist | `delta.md` |

3. Runs the **pinned** CLI — always `tools/open-sdd/dist/cli.js` from this checkout, never the
   global `open-sdd` on your `PATH` — and prints three transcripts: `status` (phase, traceability,
   evidence), `delta validate` (unmapped requirement, placeholder), and `gates run` (the Zero-Trust
   chain and its verdict).
4. Prints a verdict per injected incoherence and **exits non-zero if the tool failed to detect any
   of them**. A demo that cannot fail is marketing; this one can.

At the end it prints the exact commands to run in your own repository, with the absolute path to the
CLI filled in.

## The commands it runs, on your own repository

Once the demo has convinced you, point the same three commands at a repository you own:

```bash
cd /path/to/your/repo
node /path/to/open-sdd/tools/open-sdd/dist/cli.js status
node /path/to/open-sdd/tools/open-sdd/dist/cli.js delta validate <feature>
node /path/to/open-sdd/tools/open-sdd/dist/cli.js gates run
```

`status` reads the whole state on one screen and prints the next command to run. `delta validate`
checks a brownfield delta for id format, EARS statements, targets, contracts and traceability.
`gates run` executes the resolved gate chain and exits non-zero when the chain does not pass.

If the repository has no `.sdd/` yet, start from the brownfield entry point instead:

```bash
node /path/to/open-sdd/tools/open-sdd/dist/cli.js brownfield survey .
node /path/to/open-sdd/tools/open-sdd/dist/cli.js brownfield constitution . --write
```

## Run it in a container instead

If you would rather not install Node locally, build the image once and run the same CLI:

```bash
docker build -t open-sdd .
docker run --rm -v "$PWD:/work" open-sdd status
```

The image is multi-stage, runs as a non-root user, and ships no dev dependencies. Commands that only
read the repository (`status`, `gates`, `delta validate`) work as-is. Commands that write into it
(the installer, `--write` flags) need either `--user "$(id -u):$(id -g)"` or a writable copy, because
the container user is not your host user.

## Where the numbers come from

The demo shows *that* the checks fire. The measured, reproducible counts — per class, with the exact
command and the tool version — live in [MEASUREMENTS.md](../MEASUREMENTS.md), produced by
`node bench/harness.mjs`. Those are honesty numbers on synthetic repositories, not field data.
