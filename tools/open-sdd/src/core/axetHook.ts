/**
 * Axet Plugin completion gate (REQ-W2-014): the commit gate replayed before Axet may finish a task.
 *
 * Evidence — read from the Axet Plugin 3.0.0 VSIX (publisher Ntt-Data), not from public docs and not
 * from a behavioural run in a live session:
 *   - a hook is a file named after its event in `.axetrules/hooks/`; on Windows an extensionless (or
 *     `.js`) file is started with `node`, elsewhere through the shell, so it needs a shebang and the
 *     executable bit;
 *   - the event JSON arrives on stdin; the hook answers `{cancel, contextModification, errorMessage}`;
 *   - `TaskComplete` is NOT cancellable, `PreToolUse` is, and it carries `preToolUse.toolName`, which
 *     is `attempt_completion` when the agent declares the task done;
 *   - a hook that exits non-zero is logged and IGNORED (`cancel:false`): exit codes fail open.
 * Hence the shape below: act only on `attempt_completion`, run the same invocation the commit gate
 * runs, and always exit 0 — the block travels in the JSON, and a CLI that cannot start also blocks.
 * Hooks only run when Axet's global "hooks enabled" setting is on.
 */

import { STOP_HOOK_GATE_ARGS } from './stopHook.js';

export const AXET_HOOK_PATH = '.axetrules/hooks/PreToolUse';
export const AXET_HOOK_MARKER = 'open-sdd:axet-completion-gate';

/**
 * CommonJS- and ESM-safe on purpose: the file has no extension, so Node picks the module system from
 * the project's package.json. Only dynamic import() is used, never require() or a static import.
 */
export const renderAxetHook = (cliPath: string): string => `#!/usr/bin/env node
// ${AXET_HOOK_MARKER} — written by open-sdd (integrate axet-hook). Reinstalling rewrites it; a foreign hook is only replaced with --force.
// Blocks attempt_completion while the commit gate fails. Always exits 0: Axet ignores non-zero exits.
const CLI = ${JSON.stringify(cliPath)};
const GATE_ARGS = ${JSON.stringify(STOP_HOOK_GATE_ARGS)};
const answer = (value) => { process.stdout.write(JSON.stringify(value) + '\\n'); process.exit(0); };
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', async () => {
  let toolName = '';
  try { toolName = (JSON.parse(input || '{}').preToolUse || {}).toolName || ''; } catch (error) { toolName = ''; }
  if (toolName !== 'attempt_completion') answer({ cancel: false });
  const { spawnSync } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  if (!existsSync(CLI)) {
    answer({ cancel: true, errorMessage: 'open-sdd: no se encontró el CLI en ' + CLI + '. Reinstala el gate: npx @brujo2020/open-sdd integrate axet-hook --write --force' });
  }
  const run = spawnSync(process.execPath, [CLI, ...GATE_ARGS], { encoding: 'utf8', timeout: 25000 });
  if (run.status === 0) answer({ cancel: false });
  const output = ((run.stdout || '') + (run.stderr || '')).replace(/\\x1b\\[[0-9;]*m/g, '').trim();
  answer({
    cancel: true,
    errorMessage: 'open-sdd: el commit gate falla, la tarea no puede cerrarse todavía.\\n' + output.slice(-3000),
    contextModification: 'Corrige lo que reporta open-sdd (gates run C1 C2 C3 --staged --strict) antes de volver a intentar attempt_completion.',
  });
});
`;

export type AxetHookPlan = { action: 'create' | 'update' | 'keep'; content: string } | { action: 'refused'; reason: string };

export const planAxetHook = (existing: string | null, cliPath: string, force: boolean): AxetHookPlan => {
  const content = renderAxetHook(cliPath);
  if (existing === null) return { action: 'create', content };
  if (existing === content) return { action: 'keep', content };
  if (!existing.includes(AXET_HOOK_MARKER) && !force) {
    return { action: 'refused', reason: `${AXET_HOOK_PATH} existe y no lo escribió open-sdd: no se toca (usa --force para reemplazarlo).` };
  }
  return { action: 'update', content };
};
