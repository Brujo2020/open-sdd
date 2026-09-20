---
id: audit
description: Produce the evidence bundle — a hash per artifact, the compliance matrix, the claims registry and SARIF — without inventing a verdict.
writes:
  - ".sdd/audit/"
mustNotTouch:
  - ".sdd/steering/constitution.md"
  - ".sdd/specs/**"
  - "src/**"
  - "test/**"
handoffs:
  - release
  - analyze
parallelSafe: true
moves:
  - gates
commands:
  - "open-sdd audit bundle --json"
  - "open-sdd audit bundle --sarif .sdd/audit/open-sdd.sarif --json"
  - "open-sdd assure claims --verify --json"
  - "open-sdd assure threats"
  - "open-sdd gates crosswalk"
  - "open-sdd govern conformance"
  - "open-sdd status --check --json"
scripts:
  - "open-sdd audit bundle --json"
  - "open-sdd assure claims --verify --json"
  - "open-sdd govern conformance"
  - "open-sdd status --check --json"
---

# Audit — attest what exists, hash it, and refuse to overclaim

You are producing the audit evidence for a release or a review: the artifacts, each with a hash, the
compliance crosswalk, the claims registry and a SARIF report a code-scanning tool can ingest. This is
possible only because open-sdd produces real artifacts; there is nothing comparable to attest when
the "specification" is a chat log.

## Input

```text
$ARGUMENTS
```

The input may name the feature and the output directory. If the output directory is not given, use
`.sdd/audit/` and say so.

## Pre-Execution Checks

1. Read `.sdd/settings/extensions.yml` when it exists. If it declares `hooks.before_audit`, run those
   steps first.
2. Entries with `enabled: false` are skipped and the skip is named.
3. If the YAML cannot be parsed, **stop and report it**. Never skip silently.
4. Confirm the constitution is in force; an audit that cites an unratified draft attests nothing.

## Scope guard

- **May write:** the evidence bundle and the SARIF file under `.sdd/audit/`.
- **Must not touch:** the constitution, the specs, application source or tests. An audit observes; it
  does not remediate.
- **Deferred intents:** a remediation discovered during the audit is a finding with a route
  (`analyze` / `converge`), never an edit made here.

## Steps

1. Produce the evidence bundle, one sha256 per artifact, and read the `ok` field:

```bash
open-sdd audit bundle --json
```

2. Emit the SARIF 2.1.0 report for code scanning, into the bundle directory:

```bash
open-sdd audit bundle --sarif .sdd/audit/open-sdd.sarif --json
```

3. Verify the claims registry. It must report zero broken claims; a broken claim is a failed
   attestation, not a footnote:

```bash
open-sdd assure claims --verify --json
```

4. Read the security posture and attach the residual risks it names:

```bash
open-sdd assure threats
```

5. Read the control crosswalk so every claim maps to the control that imposes it:

```bash
open-sdd gates crosswalk
```

6. Read the per-invariant conformance evidence:

```bash
open-sdd govern conformance
```

7. Validate the repository against the constitution and the declared rigor level, and record the exit
   code as the repository's own verdict:

```bash
open-sdd status --check --json
```

8. Write the audit note next to the bundle: artifact count and hashes, the `ok` value, the claims
   result, the controls cited, and **every check that could not run**. A bundle that hides an
   uninspected control is not evidence.

## The constitution is the pivot

The bundle attests the principles of the ratified constitution and the controls they imply.
`open-sdd status --check --json` is the pivot check; if the constitution is absent or a draft, the
audit reports the attestation as unavailable rather than issuing a certificate over nothing.

## Evidence

- The hashes, the claims counts and the exit codes are the evidence. Quote them; do not summarise them
  into "audited".
- The SARIF file and the bundle path are the artifacts a reviewer opens.
- Residual risk and unmeasured controls are listed, not omitted.

## Honesty

- Never fabricate a hash, an artifact, a control mapping or a compliance verdict.
- If a check cannot run, list it under "not inspected" and never count it as a pass.
- A green bundle is not proof of quality; it is proof that the declared controls were executed. Say
  exactly that.

## Mandatory Post-Execution Hooks

1. Link the bundle and SARIF path in the release note or review.
2. Route every finding to `analyze` or `converge`; route a clean audit to `release`.

## Completion Report

- Bundle path, artifact count and hashes; SARIF path.
- `ok` value, claims registry result, controls cited, residual risks.
- The `status --check` exit code, quoted.
- Checks run, and checks that could not run.

## Done when

- The bundle exists with a hash per artifact and the SARIF report is written.
- The claims registry result and every exit code are reported verbatim.
- Uninspected controls are named as such.
- No spec or source file was modified.
