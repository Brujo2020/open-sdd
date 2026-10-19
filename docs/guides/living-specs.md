# Living specs: the biography of a specification

A specification in open-sdd is not a document that is written once and filed away. It is a file in
git, next to the code it governs, so it has a history: commits, dates, authors, line counts, and the
amendments and ratifications recorded around it. The biography turns that history into an answer to
three questions nobody could previously ask — when did this specification live, how does its rhythm
compare with the code's, and has the code moved on without it?

The feature is implemented in `tools/open-sdd/src/core/specBiography.ts` and surfaced by the CLI's
`biography` subcommand (`open-sdd biography <feature>`, with `--json` for the machine-readable
envelope).

## What the biography shows

| Field | What it answers |
|---|---|
| `born` | The first commit that touched the spec directory. |
| `lastChange` | The most recent commit that touched the spec directory. |
| `events` | One entry per spec artifact changed per commit: date, author, short sha, subject, artifact and the lines added/removed **for that file**. Most recent first, bounded by `limit` (default 20). |
| `activity` | Spec commits versus code commits since the spec was born, plus the days elapsed. |
| `breathing` / `breathingReason` | The derived rhythm verdict, and the measured numbers that produced it. |
| `amendments` | The delta entries that shaped the spec, each with the behaviour it replaced. |
| `ratifications` | Who ratified the constitution's amendments, when, and why. |
| `phaseHistory` / `currentPhase` | The `phase` declared in `spec.json` in each commit that changed it, plus the phase declared today. |
| `score` | The current `sddScore` reading, so the biography can be read next to the state. |
| `notes` | What could not be read, said explicitly instead of omitted. |

The artifact vocabulary is fixed: `requirements`, `plan` (`design.md` is an accepted alias),
`tasks`, `delta`, `spec.json`, `constitution`, and `other` for anything else inside the spec
directory. Files outside both the spec directory and the constitution are not spec events, so a
biography never turns into a second `git log` of the whole repository.

## Breathing: a rhythm, not a grade

Every value in the biography comes from git or from the artifacts. Nothing is inferred, and the
verdict is never asserted without the numbers behind it. The rule is ordered; the first condition
that matches wins:

| # | Measured condition | Verdict |
|---|---|---|
| 1 | git is unavailable, or the spec directory is outside the work tree | `unknown` |
| 2 | git has never recorded the spec directory | `orphan` |
| 3 | the code has not moved since the spec was born | `quiet` |
| 4 | commits after the spec's last change ≥ **3** | `stale` (the reason names the number) |
| 5 | the spec was written once and the code moved anyway | `orphan` |
| 6 | no code commit after the spec's last change | `alive` |
| 7 | spec commits are ≥ **1/3** of all spec+code commits since birth | `alive` |
| 8 | otherwise | `quiet` |

The two thresholds are still decisions, not truths. They live as named exports
(`STALE_CODE_COMMITS` and `ALIVE_SPEC_SHARE`) so they can be argued about and changed in one place,
and so tests can pin the boundary. What changed is that they are now backed by a measurement of this
repository instead of by argument alone — and that measurement says the sample is too small to
calibrate them.

### What was measured (2026-09-21, this repository)

The measurement imported the real module and, for every feature under `.sdd/specs/`, computed the raw
numbers from git. One repository at one revision is one case, so the same numbers were measured at
earlier revisions too: a temporary `git worktree` was checked out at 10 revisions spanning the 81
commits since `.sdd/specs/` first appeared (`af6aa56`, 2026-09-16), giving **197 feature × revision
observations** over **7 features** — the 3 live specs plus 4 demonstration specs that existed between
two commits. The module's verdict was cross-checked against the independently computed numbers on 23
of those observations (0 mismatches), so the harness measures what the module measures.

**Reconciliation latency** — how many commits passed after the spec's last change before the spec was
next updated, i.e. the silence the workflow actually tolerated before catching up:

| Feature | Closed silences (commits of silence at the peak) |
|---|---|
| `paper-alignment` | 0, 5, 0, 12 |
| `brownfield-support` | 3, 0, 5 |
| `tool-maturity` | 0, 1, 2 |
| **pooled (n=10)** | **0, 0, 0, 0, 1, 2, 3, 5, 5, 12** — median 2, mean 2.8, max 12 |

The gaps still open at the measurement revision (`488c0a8`) were 30, 30 and 27 commits; they grow
with every commit. **Nothing was observed between 12 and 27.**

**Spec share** — the share branch is consulted only when the spec is not already `stale` and the code
did move: 14 of the 197 observations, across 10 distinct revisions.

| Observed share | Verdict | What happened next |
|---|---|---|
| 23%, 24%, 29%, 31% | below 1/3 → `quiet` | the spec never moved again (4/4) |
| 38%, 40%, 40%, 43%, 44%, 50%, 50%, 60%, 67%, 67% | ≥ 1/3 → `alive` | the spec moved again (8/10; 2 were already at the feature's final revision) |

No branch-reached observation falls between 31% and 38%, so 1/3 sits inside an empty band and is not
distinguishable from 0.32 or 0.37 on this sample.

### Why the constants did not move

- **`STALE_CODE_COMMITS = 3` stays.** One commit is demonstrably noise: 4 of the 10 reconciled
  silences peaked at 0–1 commits, and a threshold of 1 would have flagged 6 of 10. Three sits at the
  mean of the observed tolerance (2.8). But the data does **not** make 3 a materiality boundary: 4 of
  the 10 silences that were eventually reconciled had already reached 3 (3, 5, 5, 12), so `stale` at
  3 is an early warning and it will label in-flight work as stale roughly 4 times out of 10. The only
  thresholds with perfect separation on this sample are 13–27 — a 15-wide band delimited by 10 closed
  and 3 open gaps — so picking a number inside it would be inventing a threshold from far too few
  points.
- **`ALIVE_SPEC_SHARE = 1/3` stays.** On the observations where the branch is reached it separates
  cleanly — below 1/3 the spec never moved again, at or above it the spec did — but that is 14
  observations from 10 revisions, and any value in 31%–37% produces identical verdicts. 1/3 is the
  incumbent inside that band, not a calibrated point.

**The honest limit:** 3 live features, 10 closed silences, one repository, one author and one
workflow, over 5 days. A codebase with a different cadence can shift both numbers. The numbers above
name the exact revisions, so the measurement can be repeated; if it is repeated on a larger corpus
and supports a different interval, the constant changes in one place and the boundary tests move with
it.

Precedence is deliberate: `stale` beats `orphan`. A specification that was written once and then
watched three code commits go by is both orphaned and out of date; the larger count is the stronger
signal, so it is named `stale`. `orphan` is reserved for early abandonment — one or two later code
commits — where "it was left orphaned" describes what happened better.

### The honest caveat

The rendered biography always carries this line, and the code exports it as
`ACTIVITY_IS_NOT_QUALITY`:

> Esto mide RITMO, no CALIDAD: una especificación que nunca cambia puede ser correcta y una que
> cambia todos los días puede ser un desastre.

Translation: this measures **rhythm, not quality**. A spec that never changes can be a correct spec,
and a spec that changes daily can be a mess. A `stale` verdict is a prompt to look, never a verdict
on the content. The biography measures activity precisely so that it does not have to pretend to
measure quality.

### When the answer is `unknown`

Some questions cannot be answered, and the biography says so rather than guessing:

- the directory is not a git repository, or git is not available;
- the git root cannot be resolved;
- the spec directory is outside the git work tree.

In all three cases `breathing` is `unknown`, `born` and `lastChange` are `null`, `events` is empty
and `complete` is `false`. The soul sections are still read from disk, because not measuring the
rhythm is not the same as reading nothing.

## Amendments and ratifications

The biography does not summarise the spec's content; it shows the *decisions* recorded around it.

**Amendments** are the entries of `delta.md` — the contract of change. Each entry appears with its
kind (`ADDED`, `MODIFIED`, `REMOVED`, `RENAMED`), its title, and, when it has one, the `previous`
behaviour it replaced, plus whether it was merged into the base specification. A `MODIFIED` entry
that cannot name the behaviour it replaces is not shown as if it could: the render says so.

**Ratifications** come from the project constitution's amendment register, which is the record of
*who* put a rule in force and *when*. Only records that were actually ratified are listed —
amendments with status `in-force` or `approved`, or with a named approval — because a proposal that
nobody ratified is not law and must not read as if it were. Each line carries the ratifier, the
date, and the rationale. A feature whose constitution has no ratifications gets a line that says so
instead of a silently empty section.

Phase history follows the same rule: it is read from the `phase` field of `spec.json` in every
commit that changed that file, so the phases a spec has been through are recovered from git rather
than reconstructed from memory. When no such commit exists, the section says the history is absent.

## Why a spec that lives in git has a history worth showing

Specifications stored in git are living documentation: they are versioned with the code, they can be
diffed, blamed and reviewed, and their changes can be tied to the commits that changed behaviour.
The history exists whether or not anyone reads it. Ignoring it produces the failure this feature
exists to make visible: a specification that was true when it was written and quietly stopped being
true while the code moved on — with no signal anywhere that it happened.

Showing the history also makes the honest failure modes visible. A spec that changes every day may
be a spec that is thrashing; a spec that never changes may be stable, or may be abandoned. The
biography does not decide which: it reports the counts, the dates and the authors so a human can.

## The workflow implication: one story, two commits

A change to the code and a change to the specification are two commits that belong to the same
story. The delta is what ties them: it declares what changes, which behaviour it replaces, and which
contracts protect it. When the delta and the code move together, the biography reads `alive` — and
that verdict is a fact about the commit history, not a promise about the code.

The `stale` verdict is the signal the workflow is meant to prevent: the code moved, the contract of
change did not. When it appears, the number in the reason is the size of the gap, and the fix is a
delta — not a rewrite of the specification to describe whatever the code now does after the fact.
The amendment record left by that delta is what a future biography will show as the moment the spec
caught up.
