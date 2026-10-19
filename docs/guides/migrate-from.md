# Migrating from Kiro, spec-kit and cc-sdd

Open-SDD can read what the incumbents already wrote. This guide is honest about what that means:
**a conversion is a mapping, never a promise of equivalence.** We move documents to the place our
engine reads, we rename what has a declared alias, and we say out loud what we did not convert and
why. Nothing is ever overwritten, and nothing is silently "fixed".

```bash
open-sdd import                          # detect every incumbent and print the plan
open-sdd import kiro                     # plan one source
open-sdd import spec-kit --write         # apply the plan
open-sdd import cc-sdd --json            # machine-readable plan
open-sdd import --source spec-kit --write
open-sdd import kiro --write --dry-run   # show what would change, write nothing
```

In this repository, replace `open-sdd` with `node tools/open-sdd/dist/cli.js`. The importer never
writes without `--write`, and it never overwrites a file that already exists — it reports the path it
refused to touch.

## What a mapping is, and what it is not

- It **is** a relocation: the document lands where `open-sdd status`, the gate chain and the MCP
  server look for it.
- It **is** a rename where a canonical name exists: `design.md` is a declared alias of `plan.md` in
  `tools/open-sdd/src/core/triad.ts`, so it is normalized to `plan.md` with the content copied
  verbatim.
- It is **not** a semantic conversion. Kiro's `requirements.md` and spec-kit's `spec.md` are not
  EARS-checked requirements documents; no validator has approved them, and no gate has run on them.
- It is **not** a merge. If the target exists, the import stops at that path.

What every user must do by hand after an import:

1. Read `open-sdd import <source>` (no `--write`) and read the `skip` list. Those are the losses.
2. Rewrite requirements into checkable EARS form and run the requirements validation.
3. Write or review `.sdd/steering/constitution.md`: an imported constitution is not automatically
   the authority a blocking verdict can cite.
4. Recreate each spec's metadata with `open-sdd init <feature>` if you need the engine's `spec.json`.
5. Run `open-sdd status --check` and `open-sdd doctor`, then `open-sdd gates run`.

## Kiro

**What we take:** project memory (`steering/`), the documentary triad per feature (`specs/`), and
JSON settings that parse.

| From | To | Action | Notes |
|---|---|---|---|
| `.kiro/steering/*.md` | `.sdd/steering/*.md` | copy | Same role, same names. Verbatim. |
| `.kiro/specs/<f>/requirements.md` | `.sdd/specs/<f>/requirements.md` | copy | Content may not be in EARS. |
| `.kiro/specs/<f>/design.md` | `.sdd/specs/<f>/plan.md` | convert | `design.md` is a declared alias of `plan.md`; the content is copied verbatim. |
| `.kiro/specs/<f>/tasks.md` | `.sdd/specs/<f>/tasks.md` | copy | `_Boundary:_`, `_Depends:_` and `_Evidence:_` are read by open-sdd. |
| `.kiro/settings/*.json` | `.sdd/settings/*.json` | convert | Only when the JSON parses. |
| `.kiro/specs/<f>/spec.json` | — | skip | Kiro's metadata shape is not open-sdd's; copying it would make the engine read a foreign metadata file as its own. |
| `.kiro/settings/**` directories, non-JSON files | — | skip | No confirmed equivalent shape. |

**Known losses:** the `spec.json` metadata (phase, language, status) is not carried over; unknown
documents in a spec directory are not imported; a feature without `requirements.md` is imported
incomplete and C1 will see it as incomplete.

**A hazard the import names:** if the repository has no `.sdd/` but does have `.kiro/`, open-sdd
already reads `.kiro` in place (`resolveSddDir`). The import creates `.sdd/` as well and warns that
two roots must not coexist. Pick one and remove the other.

## spec-kit

**What we take:** the constitution, the spec documents, and the auxiliary documents of the spec
lifecycle.

| From | To | Action | Notes |
|---|---|---|---|
| `.specify/memory/constitution.md` | `.sdd/steering/constitution.md` | convert | Copied **verbatim**. `validateConstitution` runs on it and every issue is reported; nothing is fixed. |
| `.specify/specs/**` or `specs/**` `spec.md` | `.sdd/specs/<f>/requirements.md` | convert | A provenance banner states it is a mapping and not EARS. |
| `.specify/specs/**` or `specs/**` `plan.md`, `tasks.md`, `research.md`, `data-model.md`, `quickstart.md` | same name under `.sdd/specs/<f>/` | copy | Verbatim. |
| `.specify/specs/**/contracts/**` | `.sdd/specs/<f>/contracts/**` | copy | Same role: the spec's executable interface. |
| `.specify/templates/**` | — | skip | Our templates are different by design; importing them would produce documents our gates do not recognize. |
| `.specify/scripts/**` | — | skip | They run spec-kit's flow, not ours. |
| other `.specify/memory/*.md` | — | skip | No declared role in our steering set. |
| unknown documents in a spec directory | — | skip | Named with a reason. |

**Known losses:** the constitution's prose is not converted into our principle anatomy. If
`validateConstitution` reports that no principle was recognized (the usual outcome for a prose
constitution), the file is still imported so you can diff it, and the plan says it must be rewritten
by hand before it can govern anything. Templates and scripts are deliberately not migrated.

## cc-sdd

**What we take:** the same `.kiro`-compatible specs as Kiro, plus a report of its skills directory
and of its task boundary annotations.

| From | To | Action | Notes |
|---|---|---|---|
| `.kiro/steering/*.md` | `.sdd/steering/*.md` | copy | Same as Kiro. |
| `.kiro/specs/<f>/{requirements,design,tasks}.md` | `.sdd/specs/<f>/…` | copy / convert | Same mappings as Kiro (`design.md` becomes `plan.md`). |
| `.kiro/specs/<f>/tasks.md` annotations | — | reported | `_Boundary:_` and `_Depends:_` are already read by open-sdd; the plan counts them and warns you to check that the path vocabulary matches your repository. |
| `.claude/skills/kiro-*`, `.agents/skills/kiro-*`, `.kiro/skills/**` | — | skip | Its skills are a different set, not a rename of our `sdd-*` skills. Copying them into our layout would declare capabilities we do not have. |

**Known losses:** the skills are not migrated (install ours with
`open-sdd integrate <host> --write` and port anything you need by hand); `spec.json` is skipped for
the same reason as Kiro's; a cc-sdd project that is also a Kiro project produces two overlapping
plans, and the second one becomes a list of `skip` results because the targets already exist.

## After the import

```bash
open-sdd status                       # what the engine now sees
open-sdd brownfield constitution .    # if you need a descriptive constitution from the code
open-sdd integrate <host> --write     # register MCP and install the skills for your host
open-sdd doctor                       # verify the whole installation
```

## See also

- [Integrations](integrations.md) — the per-host matrix, MCP snippets and invocation syntax.
- [Command reference](command-reference.md) — every console command.
- [Quickstart in 60 seconds](quickstart-60s.md) — install and first spec.
