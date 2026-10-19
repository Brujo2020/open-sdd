/**
 * Stop hooks — the commit gate's verdict replayed inside the agent's own loop.
 *
 * ── The one sentence of why ─────────────────────────────────────────────────────────────────────
 * An agent that declared "done" only to be blocked by `git commit` wasted the turn; a Stop hook makes
 * the host refuse to end the turn while the check the commit would fail is still failing.
 *
 * ── What this file is, and what it is NOT ───────────────────────────────────────────────────────
 * It is ONE hook, for the two hosts whose blocking mechanism was read from their own documentation:
 * Claude Code (`Stop`, exec form `command` + `args`) and Codex CLI (`Stop`, string `command` in
 * `hooks.json`). It is not a registry, not a command, not an auditor and not a new check: the argv
 * runs the SAME invocation the commit gate runs (`gates run C1 C2 C3 --staged --strict`, the
 * `GATE_ARGS` of `templates/hooks/pre-commit.mjs`) — `test/coreStopHook.test.ts` re-parses that file
 * and fails if the two drift apart.
 *
 * For every other host the answer is a refusal with the reason: Gemini's blocking schema was not
 * opened, Copilot/Cursor have the event but unverified blocking behaviour, Windsurf structurally
 * cannot, and Cline/OpenCode/Zed/Antigravity document none. This repository never emits an unverified
 * mechanism, so `installStopHook` writes NOTHING for them.
 *
 * ── Why the argv is not literally `['node', cli, ...GATE_ARGS]` ─────────────────────────────────
 * `gates run … --strict` exits 1 on a failure while both verified hosts block only on exit 2, so a raw
 * argv would have FAILED OPEN — it would have run the check, seen the failure, and let the agent
 * declare done anyway. That is exactly the `hook-failed-open` case this repository's own enforcement
 * module names: `DEFAULT_SENTINEL` (`src/core/enforcement.ts`) classifies exit 1 as
 * `hook-failed-open`, and a hook that dies with exit 1 fails OPEN while the configuration still reads
 * "blocking". The argv below interposes a ~200-character adapter that
 * adds NO check: it spawns the CLI with the exact same gate invocation and maps non-zero → 2
 * (fail-closed, so a CLI that cannot even start also blocks). That translation is the only thing
 * between the gate's verdict and the host's documented blocking contract.
 *
 * The two snippets are serializations of the same argv: Claude's documented exec form keeps it a
 * shell-free `command` + `args` array; Codex documents only a shell `command` string, so it is
 * quoted for a POSIX shell there. `notes` records the evidence and the honest limits; the long form
 * lives in `docs/guides/stop-hook.md`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
/**
 * The commit gate's own invocation, byte-for-byte the `GATE_ARGS` of `templates/hooks/pre-commit.mjs`.
 * The test suite parses that template and fails when the two drift apart, so this stays the gate's
 * check and never becomes a second one.
 */
export const STOP_HOOK_GATE_ARGS = [
    'gates',
    'run',
    'C1',
    'C2',
    'C3',
    '--staged',
    '--strict',
];
/**
 * Exit-code adapter. It runs `gates run …` exactly as the commit gate does and translates the verdict
 * into the host's blocking contract: 0 stays 0, anything else (a finding, a crash, a missing CLI)
 * becomes exit 2, which is the code both verified hosts read as "do not stop". Written with double
 * quotes only so the Codex `command` string can wrap it in single quotes for a POSIX shell.
 */
const EXIT_ADAPTER = 'const{spawnSync}=require("node:child_process"),a=process.argv.slice(1),r=spawnSync(process.execPath,[a[0],...a.slice(1)],{stdio:["ignore","inherit","inherit"]});process.exit(r.status===0?0:2)';
const DOC_CLAUDE = 'https://docs.claude.com/en/docs/claude-code/hooks';
const DOC_CODEX = 'https://developers.openai.com/codex/hooks';
const argvFor = (cliPath) => [
    'node',
    '-e',
    EXIT_ADAPTER,
    cliPath,
    ...STOP_HOOK_GATE_ARGS,
];
const jsonDoc = (value) => `${JSON.stringify(value, null, 2)}\n`;
/**
 * POSIX single-quote quoting. Codex documents hook commands as shell strings (its examples use
 * `$(git rev-parse --show-toplevel)`), so the shared argv is serialized rather than duplicated.
 */
const shellQuote = (value) => `'${value.replace(/'/g, `'\\''`)}'`;
/** Claude Code's documented exec form: a `command` plus an `args` array, with no shell anywhere. */
const claudeSnippet = (opts) => {
    const [command, ...args] = argvFor(opts.cliPath);
    return jsonDoc({ hooks: { Stop: [{ hooks: [{ type: 'command', command, args }] }] } });
};
/** Codex's `hooks.json` shape: a single shell `command` string (there is no documented `args` array). */
const codexSnippet = (opts) => jsonDoc({
    hooks: {
        Stop: [{ hooks: [{ type: 'command', command: argvFor(opts.cliPath).map(shellQuote).join(' ') }] }],
    },
});
const ADAPTER_NOTE = '`gates run … --strict` sale con 1 ante un fallo y los dos anfitriones solo bloquean con exit 2: un argv crudo habría fallado ABIERTO (habría visto el fallo y dejado al agente declararse terminado). Es el caso `hook-failed-open` que nombra el propio módulo de enforcement (DEFAULT_SENTINEL, src/core/enforcement.ts). Por eso el argv interpone un adaptador mínimo que NO añade ninguna comprobación: ejecuta el mismo `gates run`, conserva stdout y stderr (un bloqueo sin motivo enseña a desactivar el hook) y traduce no-cero→2 (fail-closed: un CLI ausente también bloquea).';
export const STOP_HOOKS = [
    {
        host: 'claude-code',
        event: 'Stop',
        configPaths: {
            darwin: '.claude/settings.json',
            linux: '.claude/settings.json',
            win32: '.claude/settings.json',
        },
        snippet: claudeSnippet,
        argv: argvFor,
        docUrl: DOC_CLAUDE,
        notes: [
            'Evento `Stop` en `.claude/settings.json` (ámbito de proyecto, committeable). Las otras superficies documentadas son `~/.claude/settings.json` y `.claude/settings.local.json`; esta entrada escribe la de proyecto.',
            'Forma VERIFICADA de ejecución: `command` + `args` (array, sin shell). `exit 2` impide que el agente se detenga y continúa el turno; el equivalente JSON es `{"decision":"block","reason":"…"}`. Documentación: https://docs.claude.com/en/docs/claude-code/hooks.',
            'La entrada recibe `stop_hook_active` en stdin para el guardia anti-bucle; este hook no lo consume a propósito (ver límites en docs/guides/stop-hook.md): ignora stdin y vuelve a bloquear en cada Stop mientras el gate falle.',
            ADAPTER_NOTE,
        ],
    },
    {
        host: 'codex',
        event: 'Stop',
        configPaths: {
            darwin: '.codex/hooks.json',
            linux: '.codex/hooks.json',
            win32: '.codex/hooks.json',
        },
        snippet: codexSnippet,
        argv: argvFor,
        docUrl: DOC_CODEX,
        notes: [
            'Evento `Stop` en `.codex/hooks.json` (ámbito de proyecto). Alternativas documentadas: `~/.codex/hooks.json` y las tablas `[hooks]` en línea dentro de `config.toml`. Documentación: https://developers.openai.com/codex/hooks.',
            'Forma VERIFICADA del handler: `command` es una CADENA (shell), no un array `command`+`args`; `Stop` espera JSON en stdout al salir con 0, y `exit 2` más stderr también continúa el turno. `timeout` por defecto 600 s.',
            'Los hooks de proyecto solo se cargan cuando la capa `.codex/` del proyecto está confiada: hay que revisarlos y confiarlos con `/hooks` (la confianza se registra contra el hash del hook, así que una edición vuelve a pedir revisión).',
            '`stop_hook_active` está presente en la entrada; no se consume (mismo criterio que en Claude Code). La forma Windows (`commandWindows`) no se emite: su quoting no se verificó.',
            ADAPTER_NOTE,
        ],
    },
];
/** The verified entry for a host, or `undefined` — the caller never gets a guessed snippet. */
export const stopHookFor = (host) => STOP_HOOKS.find((entry) => entry.host === host);
/**
 * A project-relative path that is the same on every OS wins (the committable one); a home-relative
 * path falls back to the running platform. Mirrors the rule the MCP matrix uses.
 */
const pickConfigPath = (paths) => {
    const entries = [paths.linux, paths.darwin, paths.win32];
    const homeRelative = (entry) => entry.startsWith('~') || entry.startsWith('%');
    if (new Set(entries).size === 1 && !homeRelative(entries[0]))
        return entries[0];
    return paths[process.platform] ?? entries[0];
};
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Order-insensitive structural equality, so a user's reordered entry still counts as "already there". */
const sameJson = (a, b) => {
    if (a === b)
        return true;
    if (typeof a !== typeof b || a === null || b === null)
        return false;
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
            return false;
        return a.every((value, index) => sameJson(value, b[index]));
    }
    if (typeof a === 'object') {
        const left = a;
        const right = b;
        const keys = Object.keys(left);
        if (keys.length !== Object.keys(right).length)
            return false;
        return keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && sameJson(left[key], right[key]));
    }
    return false;
};
const refused = (reason) => ({ path: '', action: 'refused', reason, snippet: '' });
/**
 * Merge the host's Stop hook into its own config, preserving every unrelated key and every other hook.
 *
 *   create  the file did not exist
 *   update  the file existed and our Stop entry was appended (all other content untouched)
 *   keep    our Stop entry is already present — the file is not rewritten
 *   refused an unverified host, an unreadable/unparseable file, or a `hooks`/`hooks.Stop` value that
 *           is not the shape the host documents. Nothing is written in that case.
 */
export const installStopHook = async (input) => {
    const hook = stopHookFor(input.host);
    if (!hook) {
        return refused(`el anfitrión «${input.host}» no tiene un mecanismo Stop verificado en este repositorio (solo claude-code y codex lo tienen): no se emite un hook no verificado y no se escribe nada.`);
    }
    const write = input.write !== false;
    const target = path.join(input.cwd, pickConfigPath(hook.configPaths));
    const snippet = hook.snippet({ cliPath: input.cliPath });
    const entry = JSON.parse(snippet).hooks.Stop[0];
    let raw = null;
    try {
        raw = await readFile(target, 'utf8');
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            return refused(`no se pudo leer ${target}: ${error.message}; no se escribe nada.`);
        }
    }
    const relative = path.relative(input.cwd, target);
    if (raw === null) {
        if (write) {
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, jsonDoc({ hooks: { Stop: [entry] } }), 'utf8');
        }
        return {
            path: target,
            action: 'create',
            reason: `no existía ${relative}: se crea con el hook Stop (evento Stop de ${hook.host}).`,
            snippet,
        };
    }
    let config;
    try {
        config = JSON.parse(raw);
    }
    catch {
        return refused(`${relative} existe pero no es JSON válido: se niega a reescribirlo (podría destruir configuración del equipo). Nada escrito.`);
    }
    if (!isPlainObject(config)) {
        return refused(`${relative} no contiene un objeto JSON en la raíz: no se toca. Nada escrito.`);
    }
    const existingHooks = config.hooks;
    if (existingHooks !== undefined && !isPlainObject(existingHooks)) {
        return refused(`${relative} tiene un valor "hooks" que no es un objeto: no se toca. Nada escrito.`);
    }
    const existingStop = existingHooks?.Stop;
    if (existingStop !== undefined && !Array.isArray(existingStop)) {
        return refused(`${relative} tiene un valor "hooks.Stop" que no es un array: no se toca. Nada escrito.`);
    }
    const stop = existingStop ?? [];
    if (stop.some((candidate) => sameJson(candidate, entry))) {
        return {
            path: target,
            action: 'keep',
            reason: `el hook Stop de ${hook.host} ya está en ${relative} y es idéntico: no se escribe nada.`,
            snippet,
        };
    }
    if (write) {
        await writeFile(target, jsonDoc({ ...config, hooks: { ...(existingHooks ?? {}), Stop: [...stop, entry] } }), 'utf8');
    }
    return {
        path: target,
        action: 'update',
        reason: `se AÑADE el hook Stop a ${relative}; el resto de claves y hooks se conservan sin cambios.`,
        snippet,
    };
};
