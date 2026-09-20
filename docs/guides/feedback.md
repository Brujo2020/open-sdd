# Feedback and celebration

A green, animated moment when something genuinely validates — and a light gamification layer whose
every number comes from a check that actually ran. The whole design answers one question: **when is
it honest to celebrate?**

Short answer: only when three independent verdicts are all true *at the same time*, for a whole
feature. Anything less gets a plain report. Anything missing gets a refusal.

> Commands below are shown as `open-sdd …` for an installed CLI. In this repository, replace
> `open-sdd` with `node tools/open-sdd/dist/cli.js`.

## What fires it

The celebration fires on a **feature validating as a whole** — not on a single file, not on one
check. A feature is the unit of work an owner recognizes: all of *its* requirements, *its* spec
against the constitution, *its* gates.

The moment appears **after the report and before the footer**: run a validation command that
produces the three verdicts, and when they are all green the block is printed there. `status` and
the footer carry the current level and the streak, so the state is visible even when nothing just
validated.

## The three conditions

All three must hold at once. They are *inputs* to the judge, never derived by it.

| # | Verdict | Condition | Where it comes from |
|---|---|---|---|
| 1 | Requirements are EARS-conformant | `errors === 0` **and** `conforming === total` | `earsAssistant` over the feature's `requirements.md` |
| 2 | The constitutional pivot passes | `evaluated === true` **and** `errors === 0` | `specConstitution` / pivot over the feature's spec |
| 3 | The gates pass | `failed.length === 0` (and `passed === total`) | the gate chain that the declared rigor level activates |

Optional context — the score, the phase, the streak — is displayed but never gates the celebration.
If it is absent it is omitted, not invented.

## The verdict table

Precedence is deliberate: **missing data is worse than bad data.** A check that did not run cannot
produce a verdict, so it refuses before any failing check is even considered.

| Inputs | Verdict | Why |
|---|---|---|
| All three true | `celebrate` | The checks that ran all said yes. |
| Requirements missing / `notChecked` / `0` requirements | `refused` | No requirements were measured: there is nothing to be conformant to. |
| Pivot `evaluated !== true` | `refused` | The spec was never judged against the principles in force. |
| No gate result (`total === 0`) or gates `notChecked` | `refused` | Nothing was executed, so nothing passed. |
| Any unknown number (`NaN`, missing field) | `refused` | An unreadable verdict is not a pass. |
| `errors > 0` or `conforming < total` | `plain` | A real failure, named: `EARS 11/12, 1 error`. |
| Pivot `errors > 0` | `plain` | Named with the alignment: `pivot 80%, 2 errors`. |
| A gate failed | `plain` | Names the gate(s): `gate C2 fails`. |
| `passed < total` with an empty failure list | `plain` | Still not all gates passed. |

A `refused` result also fires when a failing check and a missing check coexist: the reason names
what is *missing* first, because no verdict can be established at all.

## The success block

Static form, verbatim (`open-sdd … --no-anim`, or any non-TTY run):

```text
════════════════════════════════════════════════════════════════
 ✔ FEATURE VALIDADA — checkout
 EARS 12/12 · pivote 100% · gates 6/6
 racha: 7 cambios seguidos sin bajar la adhesión · score 92/100 · fase 3/3
 las comprobaciones que corrieron dijeron que sí; no es una garantía de calidad.
════════════════════════════════════════════════════════════════
✅ checkout · EARS 12/12 · pivote 100% · gates 6/6 · score 92/100 · fase 3 · racha 7
```

The block shows **what** validated, with the real numbers of the three verdicts, plus the score, the
phase and the streak. The **last line is always the static summary** — a log captured from an
animating run ends with one readable line, never with a half-drawn frame.

### Animation

Animation is TTY-only and time-bounded: **10 frames × 60 ms = 600 ms** (< 700 ms). Each frame is a
pure function of its index, so it is tested without clocks. Frames write to stdout, use plain box
characters and raw ANSI codes only, and no dependency is added to `package.json`.

## The streak's real meaning

```text
racha: 7 cambios seguidos sin bajar la adhesión
```

`N` is supplied by the caller — the constitutional ratchet (`ratchet.ts`) already knows whether
adhesion dropped. The streak is **not** re-derived here, because a second derivation would be a
second truth. It is not a counter of activity: it is the number of consecutive changes in which
adhesion did not fall. A streak of `0` says so plainly (`aún sin racha`) rather than pretending to
be a streak. If no streak is supplied, the line is omitted — a streak made of nothing would be
decoration.

## Levels and achievements (derived, never invented)

There are no points and no badges for nothing. The level comes from the score bands the product
already computes with `sddScore`; the phase the same module reports is shown beside it, and the
streak comes from the ratchet:

| Score | Level |
|---|---|
| < 40 | Inicio |
| 40–59 | Especificando |
| 60–79 | Implementando |
| 80–94 | Verificando |
| ≥ 95 | Consolidado |

Achievements each require a real recorded event:

| Achievement | Real event behind it |
|---|---|
| first validation recorded | at least one entry in the ledger |
| 3 / 10 features validated | that many distinct features in the ledger |
| 5 / 10 changes without adhesion dropping | a recorded streak of that size |
| constitution ratified | the caller asserts the constitution is actually ratified |
| first delta merged | the caller asserts a delta actually merged |

If the event is not there, the achievement is not shown. A `--json` run never carries colour.

## The ledger

A feature that validates is recorded **once** in `.sdd/state/celebrations.json` (atomic write:
temp file + rename, the same pattern as the ratchet). Nothing is written on a `plain` or `refused`
verdict: a rejection leaves no trace. An unreadable ledger is **warned about and restarted** with
the real entry — never completed by hand, never faked, and never a crash.

```json
{
  "version": 1,
  "entries": [
    {
      "feature": "checkout",
      "date": "2026-02-11T10:00:00.000Z",
      "score": 92,
      "phase": 3,
      "ears": { "conforming": 12, "total": 12 },
      "pivot": { "alignment": 1 },
      "gates": { "passed": 6, "total": 6 },
      "streak": 7
    }
  ]
}
```

Entries are deduplicated by `feature + date + score`, so re-running the same validation does not add
a second identical line. Incomplete input (no real score, gates that did not all pass, requirements
that are not conformant, an alignment outside `0..1`) is rejected with a reason and nothing is
written.

### `status --celebrations [--json]`

The only new flag; it lists the ledger.

```text
VALIDACIONES REGISTRADAS: 2
  ✔ checkout  2026-02-11  score 92/100 · fase 3 · EARS 12/12 · pivote 100% · gates 6/6 · racha 7
  ✔ api       2026-02-10  score 85/100 · fase 3 · EARS 9/9 · pivote 95% · gates 6/6 · racha 3
nivel: Verificando · fase 3 · score 85/100
logros: primera validación registrada · 3 features validadas
```

`--json` emits the same content as a machine envelope (`count`, `features`, `latest`,
`achievements`, `entries`, `corrupt`).

## Turning the ceremony off

| Knob | Effect |
|---|---|
| `--no-anim` | Static block, no frames. |
| `--quiet` | No animation; a single static summary line. |
| `--json` | Machine output; no human block, no animation, and **never coloured**. |
| `NO_COLOR=1` | No colour and no animation. |
| `SDD_NO_ANIM=1` | No animation (colour is unaffected). |
| `CI=true` | No animation in pipelines. |
| non-TTY stdout | No animation (frames are TTY-only by construction). |

Turning off the animation never turns off honesty: the static block and the ledger record are the
same either way.

## Honest limits

- **A green moment is not a quality guarantee.** It means *the checks that ran said yes*. Those are
  the checks that exist, applied to the feature at hand; they are not a proof that the software is
  good, complete, or safe.
- **Unverified checks are refused, not celebrated.** If EARS did not run, if the pivot was not
  evaluated, or if no gate produced a result, the verdict is `refused` with the missing input named.
  Celebrating an unverified pass is exactly the lie this project exists to remove.
- **A refusal is not a failure of the code** — it is a failure to establish a verdict. It stays red
  on purpose, so a pipeline cannot mistake "nothing was checked" for "everything is fine".
- **The streak is a rule, not a reward.** It can only go up while adhesion does not fall; it is
  supplied by the ratchet, not counted here, and it is never estimated.
- **The ledger is a record, not an oracle.** It says which features validated, on which dates, at
  which scores — the numbers each check reported, nothing more.
