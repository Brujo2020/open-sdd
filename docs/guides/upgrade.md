# Upgrade

How to move an installed `open-sdd` to a newer release, and how to refresh the artifacts it put on
disk. This page is about **upgrading between our versions**. For the historical v1.x → v2 → v3 paths
(with their flag and layout changes), see [Migration Guide](migration-guide.md).

The order that matters: update the CLI first, then re-run the installers inside each repository.
Nothing here deletes or rewrites your specs.

## 1. Know what you have

```bash
open-sdd --version
open-sdd doctor
```

`doctor` reports the CLI version, the commit-hook state and the declared rigor level. Run it again
after the upgrade to confirm the hook was refreshed.

## 2. Get the new CLI

**`npx` — no install, always the newest published version.** This is the frictionless path once
v3.0.2 is published. Today, the registry's `latest` is the older **v2.0.0**:

```bash
npx @brujo2020/open-sdd@latest --version
```

The unscoped `npx open-sdd@latest` is **not** this project (the name does not exist). Pin an exact
version when you need reproducibility: `npx @brujo2020/open-sdd@3.0.2 …`.

**Global install.**

```bash
npm install -g @brujo2020/open-sdd      # from the registry
npm run install:global                  # from a checkout: builds, then installs this version
open-sdd --version
```

**From a clone.**

```bash
git pull
npm --prefix tools/open-sdd ci
npm --prefix tools/open-sdd run build
node tools/open-sdd/dist/cli.js --version
```

Full details and the pre-publication caveats are in [Install](../INSTALL.md).

## 3. Refresh what is on disk (idempotent)

From inside the target repository, re-run the two installers:

```bash
cd /path/to/your/repo
open-sdd --claude-skills -y                             # skills + .sdd/settings templates
open-sdd init . --agent claude-code-skills --write      # rigor + commit gate
```

Both are safe to re-run. The project initizer is **idempotent by construction**: it reports
`create` / `keep` / `update` for every artifact, and a second run is all `keep`. Real second-run
output:

```text
  Artefactos
    keep               .sdd/settings/rigor.json
    keep               .git/hooks/pre-commit
        el hook instalado ya es nuestra versión vigente: se conserva (instalador: open-sdd floor install)
  Plan de init en /path/to/repo: … 0 artefacto(s) por crear, 0 por actualizar, 2 conservado(s).
```

### What is never overwritten

- **`init` never overwrites an edited file.** Existing artifacts are reported `keep`:
  `.sdd/settings/rigor.json` and the constitution are left exactly as they are. The one exception is
  the commit hook, which is refreshed when it is an older version of *our* template; a hook that is
  not ours (`foreign`) is preserved, never replaced.
- **The skills install** defaults to `--overwrite=prompt` (ask per file). In a non-TTY environment
  `prompt` falls back to `skip`, so an unattended run creates what is missing and **keeps what
  exists**. `-y` maps `prompt` to `force`, which *does* overwrite — drop `-y` (or pass
  `--overwrite=prompt`) if you have hand-edited generated files, and use `--backup[=<dir>]` to keep a
  copy.

There is no separate `integrate` subcommand. The integration step **is** the installer + `init` pair
above; the non-destructive behavior described here is what "integrate" would mean.

Your specs are yours: `.sdd/specs/` is populated by the workflow commands, not by the installers, and
an upgrade does not touch it.

## 4. The commit hook: refresh, and what `doctor` means

The commit gate is a file installed from `tools/open-sdd/templates/hooks/pre-commit.mjs` into
`.git/hooks/pre-commit`. A new release can change that template. `open-sdd doctor` classifies the
installed copy:

| `doctor` state | Meaning | Fix |
|---|---|---|
| `current` | Identical to the shipped template. | Nothing to do. |
| `stale` | Ours, but an older version — this is the "gate is outdated" case. | `open-sdd init . --write` or `open-sdd floor install .` |
| `missing` | No hook installed. | `open-sdd floor install .` |
| `not-executable` | Present but git silently ignores it. | Reinstall restores the executable bit. |
| `foreign` | Someone else's hook. Never overwritten. | `open-sdd floor install . --force` backs it up first. |
| `unverifiable` | Present but not comparable to ours. | Left untouched. |

## 5. When `doctor` reports the gate as outdated

This is the `stale` row above. Refresh it without touching anything else:

```bash
open-sdd init . --agent claude-code-skills --write
open-sdd doctor
```

Expected confirmation line:

```text
✓ [ok] Hook de commit: Hook instalado en .git/hooks/pre-commit (.git/hooks), ejecutable e idéntico a la plantilla vigente pre-commit.mjs.
```

If the hook is `foreign`, the installer reports a backup and does **not** install ours; that is the
designed behavior, not a failure. Re-read the message and decide, or use
`open-sdd floor install . --force` which makes the backup explicit.

## 6. What changed

- **[CHANGELOG.md](../../CHANGELOG.md)** — the `[Unreleased]` section and the section for each
  released version, with the date.
- **[Paper alignment](../PAPER-ALIGNMENT.md)** — every declared gap (G-01 …) with its code location,
  so you can tell what a release added from what it still does not do.

## 7. If you need to go back

There is no automated rollback. npm cannot re-publish a version, so a bad release is deprecated and
followed by a new patch rather than overwritten ([Publishing](publish.md)):

```bash
npx @brujo2020/open-sdd@2.0.0 --version    # pin the previous published version
```

To revert the on-disk artifacts, restore `.sdd/` and the agent's skill directory from version
control. `git diff` before you upgrade shows exactly what the installers changed.

## FAQ

**Does upgrading touch my specs or steering?** No. `.sdd/specs/` and `.sdd/steering/` are yours; the
installers do not write them.

**Do I have to upgrade every repository at once?** No. The installed artifacts are ordinary files.
Each repository upgrades when you re-run the installer inside it.

**Does `-y` overwrite my edits?** Yes — `-y` is `--overwrite=force`. Without it (or with
`--overwrite=prompt`), existing files are kept.

**Can I mix versions across repositories?** Yes. Version compatibility is per repository; the specs
in `.sdd/` are version-agnostic Markdown.
