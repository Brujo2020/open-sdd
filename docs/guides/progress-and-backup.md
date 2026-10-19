# Progress and backup

Two commands answer two fears that have nothing to do with each other, and this guide keeps them
apart on purpose:

- **`progress`** answers *"do we know what we have achieved?"* — a ledger, for awareness.
- **`backup`** answers *"can I get my work back if I lose it?"* — a restorable copy, for survival.

The owner's instruction was blunt: *«marca siempre el progreso que seamos conscientes y guardemos
respaldo»*. The backup is the more important half, because hours of work are lost exactly once.

> Commands below are shown as `open-sdd …` for an installed CLI. In this repository, replace
> `open-sdd` with `node tools/open-sdd/dist/cli.js`.

## The progress ledger: awareness, not reward

`.sdd/state/progress.json` is an **append-only** ledger of milestones. It is not a scoreboard, not a
streak, and not a reward system. Its only job is to make the state of the work *conscious*: when a
person — or an agent — returns to a project hours later, the question "what was actually achieved?"
has a written answer instead of a memory.

The ledger is a *companion* to the ratchet (`core/ratchet.ts`). The ratchet makes a silent *drop*
impossible; the ledger makes silent *forgetting* impossible. The ratchet stores `.sdd/state/adhesion.json`
and only that file; the ledger stores `progress.json` and only that file. Two writers, two files, no
crossing.

### Shape

```json
{
  "version": 1,
  "entries": [
    {
      "at": "2026-09-19T21:18:29.493Z",
      "kind": "implement",
      "summary": "Implementé el login OAuth con tests de contrato",
      "score": { "total": 55, "phase": 2 },
      "delta": { "score": 15, "phase": 1 },
      "evidence": ["src/auth.ts", "test/auth.test.ts"]
    }
  ]
}
```

### The computed-delta rule

`delta` is **computed against the previous entry**. The caller cannot supply it — the input type is
`Omit<ProgressEntry, 'at' | 'delta'>`, and an injected `delta` is discarded and recomputed. A lie
about progress must not be expressible, not merely discouraged.

- **First entry** (or the first entry after a corrupt ledger): `delta` is `{ score: 0, phase: 0 }`.
  There is nothing to compare against, and inventing a rise would be a lie.
- **No movement**: the delta is `0` and the ledger *says so* — `delta 0 · sin cambios`. It never
  dresses a flat day as a rise.
- **A rise or a drop**: `delta.score` is the arithmetic difference; `delta.phase` is `1`, `0` or
  `-1` (a phase is a step, not a count).
- **`summary`** is one Spanish line naming what was achieved. An empty summary, a multi-line
  summary, or a vague one (`se avanzó`, `sin novedades`) is **rejected**: the empty phrase must not
  take the place of the fact. Naming the file, the spec or the verdict is the whole point.
- **A corrupt ledger** never crashes and never fakes history. `readProgress` returns zero entries
  and `corrupt: true` with a reason; the next `recordProgress` **warns and starts a new series**. A
  half-readable history presented as history is a false history.

### Timeline

`renderProgress` is one screen, newest first: `date · what · score with delta · phase`.

```
2026-09-19 21:20 · Verifiqué la cadena de gates del nivel declarado · 55/100 (delta 0) · Fase 2 · sin cambios
2026-09-19 21:18 · Implementé el login OAuth con tests de contrato · 55/100 (+15) · Fase 2 ↑
2026-09-19 20:02 · Creé la especificación de auth con requisitos EARS · 40/100 (0) · Fase 1
```

`limit` (default 20) keeps the last N milestones. No headers, no decoration — a milestone with no
movement says `delta 0`, and that is information, not a failure.

## The backup: a restorable copy, not an audit artifact

`audit bundle` (`src/cli/commands/audit.ts`) produces evidence **for a third party**: what the tool
decided, with which authority, and a sha256 per artifact so an auditor can recompute every verdict.
A **backup is for you**. It does not prove compliance; it returns your work. That is why it copies
the *whole* `.sdd/` tree — settings, specs, steering with the constitution, and the state ledgers —
instead of a selected set of artifacts, and why restoring is a first-class operation rather than a
footnote.

### Why a directory and not a tarball

A backup is `<out>/manifest.json` plus `<out>/files/…` (the `.sdd/` tree mirrored). The choice is
deliberate:

1. It is verified and restored without unpacking anything, using the same filesystem primitives.
2. A sha256 per file is trivial to recompute — for the tool and for you.
3. A half-written backup is *visible* (a file is missing, or the manifest is absent) instead of a
   truncated tar that looks intact.
4. `restore --only` can bring back a single file without touching the rest.

The cost is more inodes. For `.sdd/` — a few thousand text files — that is not a cost.

### Shape

```json
{
  "schema": "open-sdd.backup/1",
  "createdAt": "2026-09-19T21:18:29.493Z",
  "tool": "open-sdd",
  "version": "3.1.1",
  "root": ".sdd",
  "files": [
    { "path": "settings/rigor.json", "bytes": 22, "sha256": "9f2c…" },
    { "path": "steering/constitution.md", "bytes": 51, "sha256": "1ab7…" }
  ],
  "counts": { "files": 2, "bytes": 73 },
  "git": { "branch": "feat/auth", "commit": "a1b2c3d…", "dirty": true },
  "detail": "Respaldo de .sdd/ con 2 fichero(s) y 73 byte(s). OMITIDOS por forma de credencial (no se guarda ningún token): .npmrc, .env."
}
```

`root` is the backed-up root relative to the project (`.sdd`). It is also the destination root of a
restore. `manifest.json` is written **last**, so its presence means the payload was written whole.

### What it contains — and what it deliberately does not

**Contains** the entire `.sdd/` tree: `settings/` (rigor, governance, git, allowlists), `specs/`
(requirements, plan/design, tasks, delta, spec metadata), `steering/` (including the constitution)
and `state/` (the ratchet baseline, the progress ledger).

**Never contains:**

- `node_modules`, `dist`, `.git` — reproducible or already versioned. Copying them multiplies the
  size and hides the only question that matters: *is my governance state here?*
- **Credential-shaped files** — `.npmrc`, `.env*`, `.netrc`, `.git-credentials`, private keys
  (`id_rsa`, `id_ed25519`, …). They are **skipped and named in `manifest.detail`**. A backup that
  stores a token in plain text is not a backup; it is a leak with a timestamp.
- **Symlinks** — not followed (they could point outside the tree or copy foreign content) and named
  in `detail`.
- The backups directory itself (`<sdd>/backups/`) and the chosen output directory — otherwise every
  backup would contain the previous one.

`counts` describes the files that *were* stored, so an omission never inflates the count.

### Verify

```bash
open-sdd backup verify .sdd/backups/2026-09-19T21-18-29-493Z
```

`verifyBackup` recomputes **every** sha256 and reports every mismatch and every missing file. A
single failure means `ok: false`: an archive that fails its own manifest is never reported as good.
Files present in the payload but not declared are counted in the detail (they do not invalidate the
verification, because a restore only touches declared files, but they are said out loud).

### Restore

```bash
open-sdd backup restore .sdd/backups/2026-09-19T21-18-29-493Z            # dry run: reports only
open-sdd backup restore .sdd/backups/2026-09-19T21-18-29-493Z --write    # applies
open-sdd backup restore .sdd/backups/2026-09-19T21-18-29-493Z --write --only state
```

`restoreBackup` **never overwrites silently.** Per file it is either `restored` or `skipped` with a
stable reason:

| Reason | Meaning |
|---|---|
| `ya idéntico` | The destination already has the exact bytes: nothing to do. |
| `existe y difiere` | The destination differs and is older than the copy: refused, not overwritten. |
| `más reciente en disco` | The destination differs and is **newer** than the copy — later work is protected. |
| `ausente en el respaldo` | The manifest declares it but the payload does not have it. |
| `no coincide con el manifiesto (hash)` | The payload file was tampered with: it is not restored. |
| `escapa de la raíz del respaldo` | A **refusal**: the manifest path leaves the backup root. |
| `fuera de la raíz permitida` | A **refusal**: the declared root (or a path) leaves the project. |

A path that escapes the backup root is a **refusal, not a restore**. Without `--write`, nothing on
disk is touched and the command reports what it *would* do. `--only <path-or-dir>` narrows the
restore to an exact path or a directory prefix; filtered files appear in neither list.

### Force

`createBackup` refuses to write into an existing directory unless `--force`, and with `--force` it
replaces the whole directory so old payload files cannot mix with new ones. Backups default to
`<sdd>/backups/<timestamp>`.

## The honest line

The backup protects the governance state **between commits**. It is not the ultimate backup.

> The ultimate backup of a spec-driven project is that the specs live in git.

`.sdd/specs/`, `.sdd/steering/` and the settings are plain text, versioned next to the code, with
the full history of every approval and every change. `git log` on those paths is the real,
distributed, off-machine backup — and it exists because the specification is living documentation,
not a wiki page. Use `backup` for the uncommitted hours: the ledger and baseline that have not been
committed yet, the state you would lose if the working tree disappeared right now. Then commit.

## CLI wiring

Both modules are pure core; the command layer parses flags and renders. The wiring that belongs in
`src/cli/commands/` (a sibling's file, not this change) is:

```ts
// src/index.ts — dispatch
if (cmd === 'progress') return handleProgressCommand(subArgv, io, targetCwd);
if (cmd === 'backup') return handleBackupCommand(subArgv, io, targetCwd);

// progress [--json] [--limit N]
//   no args        → renderProgress(readProgress(cwd).entries) + read.detail when corrupt
//   --record …     → recordProgress({ cwd, entry: { kind, summary, score, evidence } })
// backup [create|verify|restore] [path] [--out <dir>] [--force] [--write] [--only <p>] [--json]
```

Both commands return `jsonEnvelope({ command, data, errors, warnings, detail })` for `--json`; a
corrupt ledger is a **warning**, never an error, because it does not stop work. `createBackup` and
`restoreBackup` are read-only in their dry-run form, which makes them safe defaults.
