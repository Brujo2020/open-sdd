# Native GitFlow

> The branch role decides the governance. The tool says what this branch owes **before** you ask —
> and it derives the role from the branches that actually exist, never from a configuration file.

`open-sdd` writes specifications, deltas, evidence and gates as files in Git. GitFlow is therefore
not a workflow bolted on top: it is the shape those files travel in. Each branch role carries a
different contract, and `core/gitflow.ts` makes that contract explicit.

```bash
open-sdd gitflow          # detect model, role, base and print the policy for this branch
```

## 1. The model is detected from reality

`detectGitFlow(cwd)` reads the local branches (`git for-each-ref refs/heads`) and the current branch
(`git rev-parse --abbrev-ref HEAD`). It reports a model only when it observed the branches that
define it.

| Observed | Model | Evidence named |
|---|---|---|
| `develop` **and** `main`/`master` exist together | `gitflow` | both branch names; role branches (`feature/`, `release/`, `hotfix/`, `bugfix/`) if any |
| exactly one branch that is neither `develop` nor a role branch | `trunk` | that single branch name |
| anything else | `none` | the branches observed and the reason no model is asserted |

The refusal is deliberate. `main` + `feature/x` **without** `develop` is neither GitFlow nor a
single-branch trunk, so the model is `none` and the evidence says so. A declared-but-unobserved
model would be a claim without evidence, which is exactly what the rest of the console refuses to
produce.

Outside a Git repository, in a repository with no commits, or on a detached HEAD, detection still
succeeds: model `none`, branch `null`, role `other`, with the reason in `evidence`.

## 2. The role comes from the branch name

| Branch name | Role | Feature | Version |
|---|---|---|---|
| `main`, `master` | `main` | — | — |
| `develop`, `development` | `develop` | — | — |
| `feature/<x>`, `feat/<x>` | `feature` | `<x>` | — |
| `bugfix/<x>` | `feature` | `<x>` | — |
| `release/<v>` | `release` | — | `<v>` |
| `hotfix/<v>` | `hotfix` | — | `<v>` |
| `<x>-delta` | `other` | `<x>` | — |
| anything else | `other` | — | — |

Two notes on honesty:

- **`bugfix/<x>` is a change branch, not a hotfix.** The role set has no `bugfix` role; it maps to
  `feature` because its contract is a delta, and it is **not** treated as `hotfix`, which is the
  repair of a release line. The mapping is stated in code and here, not left implicit.
- **An unrecognized name is `other`**, and the policy says so. The tool does not guess a role from
  the repository, from the diff, or from what the branch name resembles. `<x>-delta` is `other`
  too, but the name declares its feature, so the policy points at that delta.

`base` is the branch the current one is compared against: `develop` for `feature` (falling back to
the default branch with the fallback named in `evidence`), the default branch for
`release`/`hotfix`/`develop`, and `null` for `main` (the pivot compares against nothing).

## 3. What each role requires

`branchPolicy(state, { level, brownfield })` returns `required`, `gates`, `blocking`, `nextStep` and
`detail`. `level` is the rigor level (`spec-first`, `spec-anchored`, `spec-as-source`) and selects
the gate chain; `brownfield: false` substitutes the triad for the delta in greenfield.

| Role | Requires | Gates |
|---|---|---|
| `feature` | the delta is the contract (`delta.md` with ADSR entries and delta-scoped `REQ-*` ids); the living triad; evidence on every completed task; gates run against `base` | the rigor chain (C1+C2 at `spec-first`) |
| `release` | **everything `feature` requires, plus** CHANGELOG + version, the audit bundle, green CI before merging, and the merge into `main` **and** back into `develop` | rigor chain + C3 + C6 |
| `hotfix` | the constitution still in force; evidence that reproduces and closes the fault; a **post-merge delta** so the fix does not vanish from the specification; gates against `base`, merge to `main` and `develop`, version tag | rigor chain + C3 |
| `main` | merges only — no direct work; the pivot passes the full chain in the PR; the merged release/hotfix keeps its version and changelog | C1–C7 |
| `develop` | integration first; the pivot must pass before opening `release/*`; every merged feature keeps its delta and evidence; no direct work except integration | rigor chain + C6 |
| `other` | with a declared feature: that feature's delta, plus a request to name the role. Without one: a request to name the branch by convention. Either way, only the common floor applies | rigor chain |

## 4. What blocks today vs. what is advice

The same ceiling/floor distinction the enforcement levels make. `blocking` names only mechanisms
that can actually stop something **in this repository today**:

- **Commit gate (level B, owned by the organization).** The pre-commit hook runs C1/C2/C3 over the
  staged index and fails closed. `open-sdd floor status` says whether it is installed here.
- **PR workflow (level C, owned by the organization).** `.github/workflows/gates.yml` runs the full
  chain on every `pull_request`; a red chain fails the pull request.
- **Governance profiles.** Under `team` and `enterprise`, writing code without an approved
  spec/delta fails the `spec_contract_present` invariant and blocks. Under `solo` — the default —
  it is reported as advisory and blocks nothing.

Everything else is **advice, not a padlock**:

- This tool does **not** install branch protection, required reviewers or push blocking. No role —
  not even `main` — has a lock of its own today. A direct commit to `main` passes.
- The release changelog/version and audit bundle have no installed gate that imposes them; only the
  PR's CI does.
- The hotfix post-merge delta has no installed gate either. It is a discipline the constitution and
  the rigor level demand, not a check that can fail a build yet.

`branchPolicy` is a pure function: it never reads the filesystem, so it will not claim a floor it
cannot see. It names the mechanism and points at the command that verifies installation.

## 5. Specs travel with the code

Specs are files in Git (`.sdd/specs/<feature>/`), so a feature branch carries its own delta and its
own triad. They merge with the code and they are reviewable in the same pull request. There is no
separate specification artifact that can drift, because there is no second place for it to live:

```
feat/checkout-flow            release/1.4.0
├── .sdd/specs/checkout-flow/ ├── CHANGELOG.md
│   ├── delta.md  (contract)  ├── .sdd/specs/checkout-flow/{delta,tasks}.md
│   ├── requirements.md       └── (version bump + audit bundle)
│   ├── plan.md
│   └── tasks.md  (evidence)
└── src/...
```

Merging the branch merges the contract that governs it. That is why a `release` branch can demand
the changelog and the audit bundle, and why a `hotfix` must land a post-merge delta: the
specification is part of the change, not a bystander.

## 6. The workflow, in a few lines

```bash
git checkout -b feature/checkout-flow develop
open-sdd delta init checkout-flow "add a checkout flow"   # branch -> delta
open-sdd delta validate checkout-flow                     # tasks/evidence -> gates
open-sdd gates run                                        # green before the PR
# PR into develop; CI runs the full chain

git checkout -b release/1.4.0 main
open-sdd gates run && open-sdd audit bundle checkout-flow  # release requires the bundle
# PR into main, then merge back into develop

git checkout -b hotfix/1.4.1 main
open-sdd gates run                                        # fix, merge to main + develop, tag
open-sdd delta init checkout-flow "post-merge hotfix"     # the fix is written back
```

`branch -> delta -> tasks/evidence -> gates -> PR -> release -> merge to main with the pivot green`.

## 7. What this layer refuses to assert

- A model that was not observed: `main` + feature branches without `develop` is `none`, not a
  guessed trunk.
- A role that the name does not declare: unrecognized branches are `other`, with a policy that says
  so instead of inferring intent.
- A protection that is not installed: `blocking` lists only the commit gate, the PR workflow and the
  enforceability of the governance profiles, and explicitly states that no branch protection is
  installed by this tool.
- A base that does not exist: when `develop` is missing on a feature branch, the base falls back to
  the default branch **and the fallback is named in `evidence`**, rather than pretending `develop`
  is there.
