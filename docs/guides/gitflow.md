# Native GitFlow

> The branch role decides the governance. `open-sdd` derives the role from the branches that actually
> exist — never from a configuration file — and says what this branch owes before you ask.

```bash
open-sdd gitflow          # model, branch role, base and the policy this branch owes
```

## 1. The model is detected, not declared

`detectGitFlow(cwd)` reads the local branches (`git for-each-ref refs/heads`) and the current branch,
and asserts a model only when it observed the branches that define it.

| Observed | Model |
|---|---|
| `develop` **and** `main`/`master` exist together | `gitflow` |
| exactly one branch that is neither `develop` nor a role branch | `trunk` |
| anything else — including `main` + `feature/x` **without** `develop` | `none`, with the reason in `evidence` |

Outside a Git repository, with no commits, or on a detached HEAD, detection still succeeds: model
`none`, branch `null`, role `other`, reason in `evidence`. An unobserved model would be a claim
without evidence, which is exactly what the rest of the console refuses to produce.

## 2. The role comes from the branch name

| Branch | Role | Feature | Version |
|---|---|---|---|
| `main`, `master` | `main` | — | — |
| `develop`, `development` | `develop` | — | — |
| `feature/<x>`, `feat/<x>`, `bugfix/<x>` | `feature` | `<x>` | — |
| `release/<v>` | `release` | — | `<v>` |
| `hotfix/<v>` | `hotfix` | — | `<v>` |
| `<x>-delta` | `other` | `<x>` | — |
| anything else | `other` | — | — |

`bugfix/<x>` is a change branch, not a hotfix: the role set has no `bugfix` role, and a hotfix is the
repair of a release line. An unrecognized name is `other`, and the policy says so instead of guessing.

`base` is what the branch is compared against: `develop` for `feature` (falling back to the default
branch, and the fallback is named in `evidence`), the default branch for `develop`/`release`/`hotfix`,
and `null` for `main`.

## 3. What each role requires

`branchPolicy(state, { level, brownfield })` returns `required`, `gates`, `blocking`, `nextStep` and
`detail`. `level` is the rigor level (`spec-first`, `spec-anchored`, `spec-as-source`) and selects the
gate chain; `brownfield: false` substitutes the living triad for the delta.

| Role | Requires | Gates |
|---|---|---|
| `feature` | the delta as the contract (ADSR entries, delta-scoped `REQ-*` ids); the spec travels with the code; evidence on every completed task; gates against `base` | rigor chain (`C1+C2` at `spec-first`) |
| `release` | **everything `feature` requires, plus** CHANGELOG + version, the audit bundle, green CI before merging, and the merge into `main` **and** back into `develop` | chain + `C3` + `C6` |
| `develop` | integration first; the pivot green before cutting `release/*`; every merged feature keeps its delta and evidence. **Not** the release bundle (version/changelog/audit) | chain + `C6` |
| `hotfix` | the constitution in force; evidence that reproduces and closes the fault; a **post-merge delta** so the fix does not vanish from the spec | chain + `C3` |
| `main` | merges only — no direct work; the pivot passes the full chain in the PR; the merged release/hotfix keeps its version and changelog | `C1`–`C7` |
| `other` | only the common floor; with `<x>-delta`, that feature's delta plus a request to name the role | chain |

## 4. What blocks today vs. what is advice

`blocking` names only mechanisms that can actually stop something **in this repository today**:

- **Commit gate (level B).** The pre-commit hook runs `C1/C2/C3` over the staged index and fails
  closed; `open-sdd floor status` says whether it is installed here (it is).
- **PR workflow (level C).** `.github/workflows/gates.yml` runs the full chain on every
  `pull_request`; a red chain fails the pull request.
- **Governance profiles.** Under `team` and `enterprise`, code without an approved spec/delta fails
  the `spec_contract_present` invariant; under the default `solo` it is advisory only.

Everything else is **advice, not a padlock**. This tool does **not** install branch protection,
required reviewers or push blocking: no role — not even `main` — has a lock of its own, and a direct
commit to `main` passes. The release changelog/version and audit bundle, and the hotfix post-merge
delta, have no installed gate yet; only the PR's CI imposes the chain.

`branchPolicy` is pure: it never reads the filesystem, so it will not claim a floor it cannot see — it
names the mechanism and points at the command that verifies installation.

## 5. The workflow, in a few lines

```bash
git checkout -b feature/checkout-flow develop
open-sdd delta init checkout-flow "add a checkout flow"   # branch -> delta
open-sdd delta validate checkout-flow                     # tasks/evidence -> gates
open-sdd gates run                                        # green before the PR
# PR into develop; CI runs the full chain

git checkout -b release/1.4.0 main
open-sdd gates run && open-sdd audit bundle checkout-flow  # release also needs the bundle
# PR into main, then merge back into develop

git checkout -b hotfix/1.4.1 main
open-sdd gates run                                        # fix, merge to main + develop, tag
open-sdd delta init checkout-flow "post-merge hotfix"     # the fix is written back

open-sdd gitflow                                          # any branch: role, base, policy, gates
```

`branch → delta → tasks/evidence → gates → PR → release → merge to main with the pivot green`.
