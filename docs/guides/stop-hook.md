# Stop hook — refuse to finish while the commit gate fails

An agent that says "done" and is then blocked by `git commit` wasted the whole turn. This hook runs
the same check the commit gate runs, from the host's own `Stop` event, so the agent cannot declare
itself finished while that check is failing.

It is **one hook, on two hosts**. Nothing is emitted for any other host: this repository never ships
an unverified mechanism.

## The exit-code fact that shapes the hook

`open-sdd gates run C1 C2 C3 --staged --strict` exits **1** on a gate failure and **2** only when the
run itself could not execute. Both verified hosts block on **exit 2** and read any other non-zero code
as a failed hook — i.e. **fail-open**. This repository's own `DEFAULT_SENTINEL`
(`tools/open-sdd/src/core/enforcement.ts`) names exit 1 `hook-failed-open`.

A raw argv (`node <cli.js> gates run …`) would therefore have run the check, seen the failure, and let
the agent declare done anyway. The argv below interposes a ~200-character adapter that adds **no
check**: it spawns the CLI with the exact same gate invocation, passes stdout/stderr through (a block
with no reason teaches people to disable the hook), and maps the verdict:

| CLI exit | Meaning | Hook exit | Effect |
|---|---|---|---|
| 0 | the chain passes | 0 | the agent may stop |
| 1 | a gate FAILED | **2** | the agent is blocked and continues |
| 2 | the chain could not run | **2** | blocked, fail-closed |
| anything else / crash / CLI missing | — | **2** | blocked, fail-closed |

## Per-host table (verified rows only)

| Host | Event | Project config | Blocking contract | Doc |
|---|---|---|---|---|
| Claude Code | `Stop` | `.claude/settings.json` | exec form `command` + `args`; `exit 2` prevents stopping, or `{"decision":"block","reason":"…"}` | https://docs.claude.com/en/docs/claude-code/hooks |
| Codex CLI | `Stop` | `.codex/hooks.json` | string `command`; `exit 2` + stderr continues the turn, or `{"decision":"block","reason":"…"}` | https://developers.openai.com/codex/hooks |

Claude Code also documents `~/.claude/settings.json` and `.claude/settings.local.json`; Codex also
documents `~/.codex/hooks.json` and inline `[hooks]` tables in `config.toml`. This minimal version
writes the committable project file.

**No hook is produced for:** Gemini CLI (blocking schema not opened), Copilot and Cursor (event
exists, blocking behaviour unverified), Windsurf (structurally cannot), Cline, OpenCode, Zed,
Antigravity (none documented). `installStopHook` refuses them with that reason and writes nothing.

## The exact snippets

Claude Code — `{cwd}/.claude/settings.json`. Exec form, so there is no shell string anywhere:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": [
              "-e",
              "const{spawnSync}=require(\"node:child_process\"),a=process.argv.slice(1),r=spawnSync(process.execPath,[a[0],...a.slice(1)],{stdio:[\"ignore\",\"inherit\",\"inherit\"]});process.exit(r.status===0?0:2)",
              "<cli.js>",
              "gates",
              "run",
              "C1",
              "C2",
              "C3",
              "--staged",
              "--strict"
            ]
          }
        ]
      }
    ]
  }
}
```

Codex CLI — `{cwd}/.codex/hooks.json`. Codex documents only a **string** `command`, so the same argv is
serialized into a POSIX shell string: every element is single-quoted and an embedded `'` is escaped as
`'\''` (the test suite runs the produced string through a real `sh -c` to prove the quoting):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "'node' '-e' 'const{spawnSync}=require(\"node:child_process\"),a=process.argv.slice(1),r=spawnSync(process.execPath,[a[0],...a.slice(1)],{stdio:[\"ignore\",\"inherit\",\"inherit\"]});process.exit(r.status===0?0:2)' '<cli.js>' 'gates' 'run' 'C1' 'C2' 'C3' '--staged' '--strict'"
          }
        ]
      }
    ]
  }
}
```

## The argv

Both hosts run the same argv — the commit gate's invocation, unchanged, behind the adapter:

```json
["node", "-e", "<adapter>", "<cli.js>", "gates", "run", "C1", "C2", "C3", "--staged", "--strict"]
```

The adapter, verbatim:

```js
const{spawnSync}=require("node:child_process"),a=process.argv.slice(1),r=spawnSync(process.execPath,[a[0],...a.slice(1)],{stdio:["ignore","inherit","inherit"]});process.exit(r.status===0?0:2)
```

The tail (`gates run C1 C2 C3 --staged --strict`) is byte-identical to `GATE_ARGS` in
`tools/open-sdd/templates/hooks/pre-commit.mjs`, and a test re-parses that template and fails if the
two ever drift apart. The adapter contains no check of its own.

## Installing it once the CLI is wired

The library entry point exists today; the `core/index.ts` barrel line and any CLI command are wired
**separately** and are not part of this hook:

```ts
import { installStopHook } from './core/stopHook.js';

const result = await installStopHook({
  cwd: process.cwd(),
  host: 'claude-code',          // 'claude-code' | 'codex'
  cliPath: '/abs/path/to/dist/cli.js',
  // write: false → compute the action and the snippet without touching the disk
});
// result: { path, action: 'create' | 'update' | 'keep' | 'refused', reason, snippet }
```

- **Merge**: it reads the host's config and appends one `Stop` entry. Every unrelated key and every
  other hook entry is preserved, in the same order; only `hooks.Stop` grows.
- **Idempotent**: when our entry is already present the action is `keep` and the file is not rewritten
  (the test makes the file read-only first, so a write would fail loudly).
- **Refused**: an unverified host, unreadable/unparseable JSON, or a `hooks`/`hooks.Stop` value that is
  not the documented shape → nothing is written, and `reason` says why.

Codex additionally requires the hook to be reviewed and trusted: open `/hooks` in the CLI. Trust is
recorded against the hook's hash, so editing it asks for review again.

## Removing it

Delete the `Stop` entry from the host config (`hooks.Stop` in `.claude/settings.json` or
`.codex/hooks.json`); delete the file if the hook was the only thing in it. The install is additive, so
removal never needs to undo a rewrite of unrelated settings.

## Honest limits

- **Two hosts only.** A host not in the table above is refused with its reason, never guessed at.
- **Not a substitute for the commit gate or the PR checks.** This replays one check inside the agent
  loop; `git commit` and CI remain the boundaries that actually hold. The commit gate also runs the
  declared-rigor add-on when `.sdd/settings/rigor.json` exists; the Stop hook runs C1/C2/C3 only.
- **`--staged` judges the index.** The hook mirrors the commit gate exactly, so if nothing is staged
  the check sees no staged diff. It does not inspect the working tree.
- **No host has been observed end-to-end blocking a real agent on this machine.** The tests prove the
  argv and the Codex shell string produce the blocking exit code against real fixtures; whether a given
  host build honours `Stop` is the host's contract, not something this repository has measured here.
- **`stop_hook_active` is not consumed.** The adapter does not read stdin, so the hook blocks on every
  `Stop` while the check fails instead of allowing one escape hatch. That is the fail-closed choice:
  the alternative lets the agent stop after a single block without fixing anything.
- **Codex on Windows** needs its `commandWindows` override; this version emits only the POSIX `command`,
  because the Windows quoting was not verified. The Claude Code exec form applies on every OS.
- **`node` comes from `PATH`.** A host config is static, so it cannot carry `process.execPath`; the CLI
  path is recorded as given, and a missing CLI blocks (exit 2) rather than passing.
- **`feature` is accepted by the snippet API but not emitted.** Neither verified Stop-hook shape
  carries an environment channel, and inventing an `env` key would be an unverified guess. `gates run`
  resolves the feature itself (`SDD_FEATURE`, or the first spec under `.sdd/specs`).
