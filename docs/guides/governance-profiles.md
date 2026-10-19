# How strict is Open-SDD?

> **Short answer:** by default, not at all. It runs its checks, tells you what it found, and gets out of your way.

Everything is one line:

```json
// .sdd/settings/governance.json
{ "profile": "solo" }
```

## The three profiles

| Profile | What blocks you | Use when |
|---|---|---|
| **`solo`** (default) | nothing | You are building. You want the feedback, not the friction. |
| **`team`** | code written without an approved spec | A shared repo, where "there was no spec" is the failure that actually costs you. |
| **`enterprise`** | everything | You are audited and need to prove it. |

Switching is one word. It takes effect on the next `audit` or `verify`.

## What it checks

Three things, always. The profile only decides which of them *stop* you:

| Check | Passes when |
|---|---|
| Code follows an approved spec | Implementation started after the spec was approved |
| Changes stayed in scope | No files were touched outside the task's declared boundary |
| Work is verified | Every requirement has a completed, traceable task |

## Reading the output

```
Checks:
  ok        Work is verified
  heads up  Changes stayed in scope
            2 files modified outside the task's boundary
  blocked   Code follows an approved spec
            Implementation started before the spec was approved
```

- **`ok`** — passed.
- **`heads up`** — it found something, but your profile is not enforcing it. You are not blocked.
- **`blocked`** — your profile enforces this one. Exit code `1`.

Nothing is hidden: a check your profile ignores still reports. You always see the signal; you decide what stops the build.

A spec you just created never fails — checks look at work in progress, not intent.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Nothing enforced failed (always the case under `solo`) |
| `1` | Something your profile enforces failed |

Safe to drop straight into CI.

## One-off strict run

Without changing the file:

```bash
open-sdd audit my-feature --strict
```

## Fine-grained control

Most people never need this. If a profile is close but not exact, name the checks that should block — anything you leave out still reports:

```json
{
  "profile": "team",
  "critical_invariants": ["spec_contract_present", "boundary_integrity"]
}
```

| id | Check |
|---|---|
| `spec_contract_present` | Code follows an approved spec |
| `boundary_integrity` | Changes stayed in scope |
| `verification_proofs_pass` | Work is verified |

Explicit fields always beat the profile. A typo in an id is dropped rather than trusted, so a check downgrades to reporting instead of silently enforcing something undefined — confirm with the `Blocking:` line in the audit header.

| Field | Effect |
|---|---|
| `profile` | Preset for everything below |
| `critical_invariants` | Which checks block. Empty = report only |
| `non_blocking_warnings` | `false` makes warnings fail the run |
| `critical_gates_only` | `true` = only the listed checks can fail a run |

## Git side effects

`governance.json` decides what blocks. `.sdd/settings/git.json` decides what Open-SDD does to your repo — and it **never pushes** unless you set `auto_push: true`.

| Profile | Suggested `git.mode` |
|---|---|
| `solo` / `team` | `assisted` (branches and commits, no push) |
| `enterprise` | `strict` (also refuses unapproved implementation) |

## Compliance reporting

EU AI Act (Art. 11/12/14) and NIST AI RMF reporting is opt-in, not part of the normal flow:

```bash
open-sdd audit my-feature --regulatory
```
