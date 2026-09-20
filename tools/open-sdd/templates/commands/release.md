---
id: release
description: Run the release gate chain, verify the claims registry and audit bundle, then tag and publish through the two documented credential routes.
writes:
  - "CHANGELOG.md"
  - ".sdd/specs/<feature>/release.md"
mustNotTouch:
  - ".sdd/steering/constitution.md"
  - ".sdd/settings/**"
  - "src/**"
  - "test/**"
preconditions:
  - ".sdd/steering/constitution.md"
handoffs: []
parallelSafe: false
moves:
  - gates
commands:
  - "open-sdd status --check --json"
  - "open-sdd gates run"
  - "open-sdd gates chain --profile regulated"
  - "open-sdd gates crosswalk"
  - "open-sdd gates enforcement"
  - "open-sdd govern conformance"
  - "open-sdd assure claims --verify --json"
  - "open-sdd assure threats"
  - "open-sdd audit bundle --json"
  - "open-sdd floor status"
  - "open-sdd status --json"
scripts:
  - "open-sdd gates run"
  - "open-sdd assure claims --verify --json"
  - "open-sdd audit bundle --json"
  - "open-sdd floor status"
---

# Release — the gates decide, the evidence is bundled, then it ships

A release is not a feeling. It is the repository's own enforcement chain passing, the claims registry
staying intact, an evidence bundle with a hash per artifact, and a tag published through a documented
credential route. If any of those is missing, the release has not happened — whatever the UI says.

## Input

```text
$ARGUMENTS
```

The input may name the version or the feature being released. If the version is not stated, read it
from the root manifest and ask before tagging.

## Contract — the five guarantees for this template

- **Identified — produces:** `CHANGELOG.md`, the release note `.sdd/specs/<feature>/release.md`, the git tag and the published artifact.
- **Identified — refuses:** it refuses to modify application source, tests, the constitution or the settings, and refuses to ship around a failing gate.
- **Automated — how:** this template never asks you to "consider" a check: the `commands:` frontmatter names the real engine invocations and the steps below RUN them and read their output.
- **Assured — backing check:** `open-sdd gates run` **exits 1** when the chain fails (BLOCKS the release), `open-sdd assure claims --verify --json` **exits 1** on a broken claim (BLOCKS), `open-sdd audit bundle --json` **exits 1** when the bundle is not `ok`, and `open-sdd floor status` reports the installed floor.
- **Measured — components:** `gates` — the reader sees the change before/after in `open-sdd status --json` (score and phase).
- **Pivoted — the constitution is the pivot:** the constitution is the pivot: the release verdict cites the ratified constitution, a draft constitution means the release is not authorised, and `open-sdd status --check --json` is the pivot check.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_release`, run
   those steps first.
2. Entries with `enabled: false` are skipped and the skip is named.
3. If the YAML cannot be parsed, **stop and report it**. Never skip silently.
4. Confirm the working tree is clean and the version is not already on the registry before doing
   anything irreversible. A release command that publishes from a dirty tree ships something nobody
   reviewed.

## Scope guard

- **May write:** `CHANGELOG.md`, the release note `.sdd/specs/<feature>/release.md`, the git tag, and
  the published artifact through the pipeline.
- **Must not touch:** the constitution, the settings, application source or tests. A code change found
  during release is a new task, not a release-time edit.
- **Deferred intents:** anything discovered that needs code or spec work is recorded in the release
  note and routed back. Never ship around a failing gate.

## Steps

1. Validate the repository against the constitution and the declared rigor level:

```bash
open-sdd status --check --json
```

2. Run the enforcement chain. Its exit status is the release verdict, not your summary of it:

```bash
open-sdd gates run
```

3. If the project declares a regulated profile, run the stricter resolved chain and report which
   controls it resolved:

```bash
open-sdd gates chain --profile regulated
```

4. Read the crosswalk so the release note can trace implementation to the control that imposes it,
   and read the enforcement levels so the ceiling/floor distinction is stated, not blurred:

```bash
open-sdd gates crosswalk
```

```bash
open-sdd gates enforcement
```

5. Read the invariant conformance report and attach its per-invariant evidence:

```bash
open-sdd govern conformance
```

6. Verify the claims registry. It must report zero broken claims; a broken claim blocks the release:

```bash
open-sdd assure claims --verify --json
```

7. Read the security posture and include the residual risks it names:

```bash
open-sdd assure threats
```

8. Produce the evidence bundle — every artifact with its sha256 — and archive it with the release:

```bash
open-sdd audit bundle --json
```

9. Confirm the enforcement floor is actually installed, not merely declared:

```bash
open-sdd floor status
```

10. Update `CHANGELOG.md` with the version, the changes, and the verification above. Tag the version
    and publish through the documented route. Three publish failures have actually happened here;
    map the message before changing anything:

    | Error | What it means | What to do |
    |---|---|---|
    | `E403 … Two-factor authentication … required` | The account is in auth-and-writes and the credential is not exempt from the OTP. | Use a granular token with Bypass 2FA, or publish manually with `--otp <code>`. |
    | `E404 … PUT … Not found` | The **CI authorisation failed**; npm returns 404 instead of 403 for an authorisation failure. The package exists. | Do not create the package. Fix the credential route and re-read the `Publish route:` line the step printed. |
    | `EPUBLISHCONFLICT` / `version already exists` | That version is already published; npm versions are immutable. | Bump, commit and tag the **new** version. Never re-push a tag to overwrite. |

11. Record, in the release note, which publish route was attempted and whether it succeeded. A route
    that failed is reported as failed; the version is not "published except for one error".

## The constitution is the pivot

The release verdict cites the ratified constitution and the gate chain. If the constitution is absent
or a draft, the release is not authorised: the blocking controls have no authority to cite. Fix the
constitution first, then release.

## Evidence

- The gate chain's exit status, quoted; the claims registry's counts; the audit bundle's hashes; the
  floor's installation state. Those are the evidence.
- The release note must not claim any check that is not in that list.
- Residual risks and unmeasured controls are named, not rounded away.

## Honesty

- Never report a green release when a gate, claim or floor check failed or could not run.
- Never invent a version, a tag, a hash or a publish confirmation.
- If provenance or an attestation was requested but not produced, say so.
- The prototype numbers this project must never restate as its own (κ, FPR, sweep timings) are not
  release evidence; do not quote them.

## Mandatory Post-Execution Hooks

1. Archive the audit bundle with the release and link it in the release note.
2. Re-run `open-sdd floor status` after publishing to confirm the gate remained installed.

## Completion Report

- Version, tag, and publish status (`published` / `NOT PUBLISHED`) with the route attempted.
- Gate chain verdict and exit status; claims registry result; floor state.
- Bundle location and artifact count with hashes.
- Residual risks and any check that could not run.

## Done when

- The enforcement chain passed and its verdict is quoted.
- The claims registry reports zero broken claims, and the audit bundle exists with hashes.
- The release note records the publish route and its real outcome.
- No application source was modified as part of the release.
