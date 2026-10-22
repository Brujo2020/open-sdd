/**
 * Axet Plugin hooks (REQ-W2-014): the commit gate's verdict carried into Axet's own loop.
 *
 * ── What Axet 3.0.0 allows (read from its VSIX, publisher Ntt-Data — not public docs) ─────────────
 *   - A hook is a file named after its event in `<workspace>/.axetrules/hooks/`; Axet scans only the
 *     event names, so nothing else in the folder runs. On Windows an extensionless file is started with
 *     `node`; elsewhere it runs through the shell, so it needs a shebang and the executable bit.
 *   - It is spawned WITHOUT a cwd (it inherits the extension host's), gets the event JSON on stdin
 *     (`workspaceRoots`, `taskId`, `preToolUse` / `postToolUse` / `taskStart` / `taskComplete`) and
 *     answers `{cancel, contextModification, errorMessage}` on stdout within 30 s.
 *   - `attempt_completion` is EXCLUDED from PreToolUse and PostToolUse, and TaskComplete runs after the
 *     completion is shown, is not cancellable and its answer is ignored. A hook therefore CANNOT block
 *     a completion. `cancel: true` cancels the whole task, so these hooks never send it.
 *   - `contextModification` from TaskStart and PostToolUse is appended to the agent's conversation as
 *     `<hook_context>`; hook output lines are shown in the chat.
 *
 * ── What the hooks do with that ─────────────────────────────────────────────────────────────────
 *   TaskStart    → tells the agent the SDD contract and the gate's current verdict.
 *   PostToolUse  → after an edit or a command, re-runs the gate and tells the agent only when the
 *                  verdict changes (fail ↔ pass), so a red gate is not repeated after every edit.
 *   TaskComplete → prints the verdict in the chat for the person (advisory: it cannot reopen the task).
 * The blocking floor stays the commit hook (level B). These hooks are level A: steering, not a lock.
 *
 * ── Portability ─────────────────────────────────────────────────────────────────────────────────
 * The project root is derived from the hook's own location, never from the inherited cwd. The CLI is
 * resolved at run time: `$OPEN_SDD_CLI`, then the project's `node_modules`, then `npx --yes <source>`
 * — the same origin the installer ran from — so a committed `.axetrules/hooks/` works on another
 * machine without an absolute path from this one.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { STOP_HOOK_GATE_ARGS } from './stopHook.js';
export const AXET_HOOKS_DIR = '.axetrules/hooks';
export const AXET_HOOK_EVENTS = ['TaskStart', 'PostToolUse', 'TaskComplete'];
export const AXET_HOOK_MARKER = 'open-sdd:axet-hook';
/** The first design hooked PreToolUse, which Axet never runs for attempt_completion; it is retired. */
export const AXET_LEGACY_HOOK = 'PreToolUse';
const LEGACY_MARKER = 'open-sdd:axet-completion-gate';
export const PACKAGE_NAME = '@brujo2020/open-sdd';
/** Tools after which the gate is re-checked: the ones that change files or run commands. */
const CHANGE_TOOLS = ['write_to_file', 'replace_in_file', 'apply_patch', 'execute_command', 'new_rule'];
/**
 * Where this CLI was installed from, so the hooks can reach the same origin. `npx <spec>` records the
 * spec in `~/.npm/_npx/<hash>/package.json`; the CLI finds that file from its own path.
 */
export const detectInstallSource = (cliPath, version) => {
    const fromEnv = process.env.OPEN_SDD_SOURCE?.trim();
    if (fromEnv)
        return fromEnv;
    const parts = path.resolve(cliPath).split(path.sep);
    const npx = parts.lastIndexOf('_npx');
    if (npx >= 0 && parts.length > npx + 1) {
        const manifest = [...parts.slice(0, npx + 2), 'package.json'].join(path.sep);
        try {
            const deps = JSON.parse(readFileSync(manifest, 'utf8')).dependencies ?? {};
            const spec = deps[PACKAGE_NAME];
            // npx records a local tarball or folder relative to its own cache dir: make it absolute.
            if (spec?.startsWith('file:'))
                return `file:${path.resolve(path.dirname(manifest), spec.slice('file:'.length))}`;
            if (spec)
                return /^[\w.-]+:/.test(spec) || spec.includes('/') ? spec : `${PACKAGE_NAME}@${spec}`;
        }
        catch {
            // fall through to the version this CLI carries
        }
    }
    return `${PACKAGE_NAME}@${version}`;
};
/**
 * CommonJS- and ESM-safe on purpose: the file has no extension, so Node picks the module system from
 * the project's package.json. Only dynamic import() is used, never require() or a static import.
 */
export const renderAxetHook = (event, source) => `#!/usr/bin/env node
// ${AXET_HOOK_MARKER} event=${event} — written by open-sdd. Reinstall with: npx --yes ${source} integrate axet-hooks --write
// Level A (steering): Axet lets no hook block attempt_completion; the commit gate is what refuses.
const EVENT = ${JSON.stringify(event)};
const SOURCE = ${JSON.stringify(source)};
const GATE_ARGS = ${JSON.stringify(STOP_HOOK_GATE_ARGS)};
const CHANGE_TOOLS = ${JSON.stringify(CHANGE_TOOLS)};
const answer = (value) => { process.stdout.write(JSON.stringify(value) + '\\n'); process.exit(0); };
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => { main().catch((error) => answer({ cancel: false, errorMessage: 'open-sdd hook: ' + String(error) })); });

async function main() {
  let payload = {};
  try { payload = JSON.parse(input || '{}'); } catch (error) { payload = {}; }
  if (EVENT === 'PostToolUse' && !CHANGE_TOOLS.includes((payload.postToolUse || {}).toolName || '')) answer({ cancel: false });
  const path = await import('node:path');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const { spawnSync } = await import('node:child_process');

  // Axet spawns hooks without a cwd: the project is where this file lives, not where Axet runs.
  const here = path.dirname(path.resolve(process.argv[1] || '.'));
  let root = path.resolve(here, '..', '..');
  if (!fs.existsSync(path.join(root, '.axetrules'))) root = (payload.workspaceRoots || [])[0] || process.cwd();

  const local = [process.env.OPEN_SDD_CLI, path.join(root, 'node_modules', '@brujo2020', 'open-sdd', 'tools', 'open-sdd', 'dist', 'cli.js')]
    .find((candidate) => candidate && fs.existsSync(candidate));
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
  const win = process.platform === 'win32';
  const run = local
    ? spawnSync(process.execPath, [local, ...GATE_ARGS], { cwd: root, env, encoding: 'utf8', timeout: 25000 })
    : spawnSync(win ? 'npx.cmd' : 'npx', ['--yes', SOURCE, ...GATE_ARGS], { cwd: root, env, encoding: 'utf8', timeout: 25000, shell: win });
  const gateCommand = local ? 'npx open-sdd ' + GATE_ARGS.join(' ') : 'npx --yes ' + SOURCE + ' ' + GATE_ARGS.join(' ');

  const text = ((run.stdout || '') + '\\n' + (run.stderr || '')).replace(/\\x1b\\[[0-9;]*m/g, '');
  const rows = text.split('\\n').map((line) => line.match(/^\\s*([CO]\\d+)\\s+(.+?)\\s{2,}(pass|fail|advisory|self-authorized)\\s*$/)).filter(Boolean);
  // A non-zero exit with no gate row means the CLI never judged anything: that is not a verdict.
  const verdict = run.error || run.status === null || (run.status !== 0 && rows.length === 0) ? 'unavailable' : run.status === 0 ? 'pass' : 'fail';
  const lastError = text.split('\\n').map((line) => line.trim()).filter(Boolean).slice(-1)[0] || '';
  const failing = rows.filter((row) => row[3] === 'fail').map((row) => row[1] + ' ' + row[2]);
  const detail = verdict === 'pass'
    ? 'PASS — ' + (rows.map((row) => row[1] + ' ' + row[3]).join(', ') || 'the chain passes')
    : verdict === 'fail'
      ? 'FAIL — ' + (failing.join('; ') || 'the chain does not pass') + '. Run \`' + gateCommand + '\` to see why.'
      : 'UNAVAILABLE — the gate could not run (' + (run.error ? run.error.message : run.status === null ? 'timeout' : lastError.slice(0, 300)) + '). Install it in the project: npm i -D ' + SOURCE;

  if (EVENT === 'TaskComplete') {
    process.stderr.write('open-sdd gate after completion: ' + detail + '\\n');
    answer({ cancel: false });
  }

  // One verdict file per task, so PostToolUse does not repeat what TaskStart already said.
  const state = path.join(os.tmpdir(), 'open-sdd-axet-' + String(payload.taskId || 'none').replace(/[^\\w-]/g, '') + '.json');
  if (EVENT === 'TaskStart') {
    try { fs.writeFileSync(state, JSON.stringify({ verdict })); } catch (error) { /* best effort */ }
    answer({
      cancel: false,
      contextModification: [
        'SDD_GATE: this repository is governed by open-sdd (Spec-Driven Development).',
        '- Use the /sdd-* workflows; each one follows its skill in .axet-plugin/skills/.',
        '- The commit gate is \`' + gateCommand + '\`: a commit is refused while it fails.',
        '- Before attempt_completion, run it and fix what it reports. Do not bypass it with --no-verify.',
        '- Current verdict: ' + detail,
      ].join('\\n'),
    });
  }

  // PostToolUse: speak only when the verdict changes, so a red gate is not repeated after every edit.
  let previous = '';
  try { previous = JSON.parse(fs.readFileSync(state, 'utf8')).verdict || ''; } catch (error) { previous = ''; }
  try { fs.writeFileSync(state, JSON.stringify({ verdict })); } catch (error) { /* best effort */ }
  if (verdict === previous) answer({ cancel: false });
  if (verdict === 'pass' && previous === '') answer({ cancel: false });
  answer({ cancel: false, contextModification: 'SDD_GATE: ' + detail + (verdict === 'pass' ? ' It may be safe to complete now.' : ' Fix it before attempt_completion.') });
}
`;
const readOrNull = (file) => {
    try {
        return readFileSync(file, 'utf8');
    }
    catch {
        return null;
    }
};
/** Plan every hook file: ours are rewritten, foreign ones refused unless `force`, the legacy one retired. */
export const planAxetHooks = (root, source, force) => {
    const plans = AXET_HOOK_EVENTS.map((event) => {
        const file = path.join(root, AXET_HOOKS_DIR, event);
        const content = renderAxetHook(event, source);
        const existing = readOrNull(file);
        if (existing === null)
            return { event, file, action: 'create', content };
        if (existing === content)
            return { event, file, action: 'keep' };
        if (!existing.includes(AXET_HOOK_MARKER) && !force) {
            return { event, file, action: 'refused', reason: `${AXET_HOOKS_DIR}/${event} existe y no lo escribió open-sdd (usa --force para reemplazarlo).` };
        }
        return { event, file, action: 'update', content };
    });
    const legacy = path.join(root, AXET_HOOKS_DIR, AXET_LEGACY_HOOK);
    if (existsSync(legacy) && (readOrNull(legacy) ?? '').includes(LEGACY_MARKER)) {
        plans.push({ event: AXET_LEGACY_HOOK, file: legacy, action: 'retire', reason: 'Axet no ejecuta PreToolUse para attempt_completion: el hook anterior no hacía nada.' });
    }
    return plans;
};
/** Apply a plan from `planAxetHooks`. Hooks are written executable: Axet runs them through the shell. */
export const applyAxetHooks = async (plans) => {
    const { chmod, mkdir, rm, writeFile } = await import('node:fs/promises');
    const outcome = { written: [], kept: [], refused: [], retired: [] };
    for (const plan of plans) {
        if (plan.action === 'keep')
            outcome.kept.push(plan.event);
        else if (plan.action === 'refused')
            outcome.refused.push(plan.reason ?? plan.event);
        else if (plan.action === 'retire') {
            // A folder that forbids deletes must not abort the install: the legacy hook is inert (Axet never
            // runs PreToolUse for attempt_completion), so it is reported for manual removal instead.
            try {
                await rm(plan.file, { force: true });
                outcome.retired.push(plan.event);
            }
            catch (error) {
                outcome.refused.push(`${AXET_HOOKS_DIR}/${plan.event}: no se pudo retirar (${error.code ?? String(error)}); es inerte, bórralo a mano.`);
            }
        }
        else if (plan.content !== undefined) {
            await mkdir(path.dirname(plan.file), { recursive: true });
            await writeFile(plan.file, plan.content, { encoding: 'utf8', mode: 0o755 });
            await chmod(plan.file, 0o755).catch(() => undefined);
            outcome.written.push(plan.event);
        }
    }
    return outcome;
};
