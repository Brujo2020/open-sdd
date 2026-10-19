/**
 * Is the enforcement floor actually installed, or only declared?
 *
 * The reference architecture's central structural claim is that the guarantee a programme can
 * make on day one is the commit/merge floor, because those boundaries belong to the organization.
 * Ownership is not installation, though: a repository can reason its way to "B and C are ours"
 * while shipping neither a pre-commit hook nor a pull-request gate matrix. This module answers the
 * second question separately, so the report cannot conflate the two.
 */

import { execFileSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export interface InstalledFloor {
  /** The repository ships an installable pre-commit hook. */
  commitHookShipped: boolean;
  /** The hook is installed in this checkout's hook directory. */
  commitHookInstalled: boolean;
  /** A workflow runs the gate chain on pull requests. */
  ciGateMatrix: boolean;
  /** Workflows that mention the gate chain at all. */
  workflowsReferencingGates: string[];
  /** The hook path that was inspected, resolved the way `doctor` resolves it. */
  hookPath: string | null;
  /** Which directory that path came from: `.git/hooks` or `core.hooksPath=<dir>`. */
  hookOrigin: string;
  /** True only when both owned boundaries are operational here. */
  floorInstalled: boolean;
  detail: string;
}

const fileExists = async (p: string): Promise<boolean> =>
  (await stat(p).catch(() => null)) !== null;

const gitOutput = (cwd: string, args: string[]): string | null => {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out.length > 0 ? out.split('\n')[0].trim() : null;
  } catch {
    return null;
  }
};

/**
 * Resolve the commit-hook path the way `doctor.ts` does. `git rev-parse --git-path
 * hooks/pre-commit` already honors `core.hooksPath`, so a team that opted into a repository
 * controlled hooks directory is not told the hook is missing. Outside a git repository the
 * conventional `.git/hooks/pre-commit` is the only path there is, and it is used with no origin
 * claim beyond that.
 */
const resolveHookPath = async (cwd: string): Promise<{ path: string; origin: string }> => {
  const gitPath = gitOutput(cwd, ['rev-parse', '--git-path', 'hooks/pre-commit']);
  const hooksPath = gitOutput(cwd, ['config', '--get', 'core.hooksPath']);
  if (gitPath) {
    return {
      path: path.isAbsolute(gitPath) ? gitPath : path.resolve(cwd, gitPath),
      origin: hooksPath ? `core.hooksPath=${hooksPath}` : '.git/hooks',
    };
  }
  return { path: path.join(cwd, '.git', 'hooks', 'pre-commit'), origin: '.git/hooks' };
};

export const detectInstalledFloor = async (
  cwd: string,
  options: { hookPath?: string; workflowsDir?: string } = {},
): Promise<InstalledFloor> => {
  const hookPath = options.hookPath ?? path.join('tools', 'open-sdd', 'templates', 'hooks', 'pre-commit');
  const workflowsDir = options.workflowsDir ?? path.join('.github', 'workflows');
  const resolvedHook = await resolveHookPath(cwd);

  const commitHookShipped = await fileExists(path.join(cwd, hookPath));
  const commitHookInstalled = await fileExists(resolvedHook.path);

  const entries = await readdir(path.join(cwd, workflowsDir), { withFileTypes: true }).catch(() => []);
  const workflowsReferencingGates: string[] = [];
  let ciGateMatrix = false;

  for (const entry of entries) {
    if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
    const content = await readFile(path.join(cwd, workflowsDir, entry.name), 'utf8').catch(() => '');
    if (!/gates run/.test(content)) continue;
    workflowsReferencingGates.push(entry.name);
    // A gate matrix only counts as the merge boundary if it runs on pull requests. A workflow
    // that only runs on tag pushes is a release check, not a merge gate.
    if (/pull_request/.test(content)) ciGateMatrix = true;
  }

  const floorInstalled = commitHookShipped && commitHookInstalled && ciGateMatrix;
  const missing: string[] = [];
  if (!commitHookShipped) missing.push('hook no incluido en el repositorio');
  else if (!commitHookInstalled) {
    const relative = path.relative(cwd, resolvedHook.path) || resolvedHook.path;
    missing.push(`hook no instalado en ${relative} (${resolvedHook.origin}) (ejecuta \`npm run hooks:install\`)`);
  }
  if (!ciGateMatrix) missing.push('ningún workflow corre la cadena en pull_request');

  const relativeHook = path.relative(cwd, resolvedHook.path) || resolvedHook.path;
  return {
    commitHookShipped,
    commitHookInstalled,
    ciGateMatrix,
    workflowsReferencingGates,
    hookPath: resolvedHook.path,
    hookOrigin: resolvedHook.origin,
    floorInstalled,
    detail: floorInstalled
      ? `Suelo instalado: el hook de commit ejecuta los gates críticos y la matriz completa corre en cada pull request (hook en ${relativeHook}, ${resolvedHook.origin}).`
      : `Suelo declarado pero NO instalado: ${missing.join('; ')}.`,
  };
};
