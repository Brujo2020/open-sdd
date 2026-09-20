/**
 * The commit gate must work on every operating system.
 *
 * The gate used to be a bash script. That is invisible on macOS and Linux and fatal on Windows, so
 * these tests are deliberately behavioural: they run the real hook against real `git init` fixtures
 * and run the real installer against a fixture that looks like a checkout. Nothing is written inside
 * this repository — every fixture is an `fs.mkdtemp` directory removed in `afterEach`.
 *
 * The static assertion (no shell-only constructs in the Node gate) exists because that particular
 * regression cannot be caught by running the hook on a POSIX host: it only fails on the platform the
 * portable gate was written for.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const hookTemplate = path.join(repoRoot, 'tools', 'open-sdd', 'templates', 'hooks', 'pre-commit.mjs');
const posixTemplate = path.join(repoRoot, 'tools', 'open-sdd', 'templates', 'hooks', 'pre-commit');
const installerScript = path.join(repoRoot, 'scripts', 'install-hooks.mjs');
const cliEntry = path.join(repoRoot, 'tools', 'open-sdd', 'dist', 'cli.js');

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const makeTempDir = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
  /** stdout and stderr joined: a hook that fails closed may speak on either stream. */
  output: string;
}

const run = (
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): CommandResult => {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    env: options.env ?? process.env,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return { status: result.status ?? -1, stdout, stderr, output: stdout + stderr };
};

const runGit = (dir: string, args: string[]): CommandResult => run('git', args, { cwd: dir });

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const SPEC_FILES: Record<string, string> = {
  'requirements.md':
    '# Requisitos\n\nEl sistema describe el comportamiento esperado en prosa, sin formularios ni marcadores numericos.\n',
  'plan.md': '# Plan\n\nArquitectura de referencia del fixture.\n',
  'tasks.md': '# Tareas\n\n- [ ] T1 hacer algo\n',
};

const CONSTITUTION = [
  '# Constitution — fixture',
  '',
  'Provenance: descriptive',
  '',
  '## Principles',
  '',
  '### C-BOUNDARIES — Limites declarados',
  '- Level: SHOULD',
  '- Restriction: Un cambio no cruza una frontera de modulo sin declararlo en la delta.',
  '- Pattern: Mantener el cambio dentro de los limites declarados por el grafo de tareas.',
  '- Justification: Las fronteras codifican decisiones de arquitectura que siguen vigentes.',
  '- Provenance: descriptive',
  '- Evidence: src; test',
  '',
].join('\n');

/**
 * A real git repository with a valid triad, so C1/C3 pass on an empty index. The CLI under test is
 * supplied through OPEN_SDD_CLI, which the hook resolves first — that keeps the fixture independent
 * of whatever happens to be installed globally on the machine.
 */
const makeRepo = async (options: { rigor?: boolean } = {}): Promise<string> => {
  const dir = await makeTempDir('open-sdd-hook-');
  runGit(dir, ['init', '-q']);
  runGit(dir, ['config', 'user.email', 'gate@open-sdd.test']);
  runGit(dir, ['config', 'user.name', 'open-sdd gate']);

  const specDir = path.join(dir, '.sdd', 'specs', 'governance');
  await mkdir(specDir, { recursive: true });
  for (const [name, content] of Object.entries(SPEC_FILES)) {
    await writeFile(path.join(specDir, name), content, 'utf8');
  }

  if (options.rigor === true) {
    await mkdir(path.join(dir, '.sdd', 'settings'), { recursive: true });
    await writeFile(
      path.join(dir, '.sdd', 'settings', 'rigor.json'),
      '{"level":"spec-first"}\n',
      'utf8',
    );
    await mkdir(path.join(dir, '.sdd', 'steering'), { recursive: true });
    await writeFile(path.join(dir, '.sdd', 'steering', 'constitution.md'), CONSTITUTION, 'utf8');
  }

  return dir;
};

/**
 * A directory that looks like this checkout: the real installer plus the real templates, so running
 * it resolves `root` to the fixture instead of to this repository.
 */
const makeCheckout = async (options: { git?: boolean } = {}): Promise<string> => {
  const dir = await makeTempDir('open-sdd-install-');
  const templateDir = path.join(dir, 'tools', 'open-sdd', 'templates', 'hooks');
  await mkdir(path.join(dir, 'scripts'), { recursive: true });
  await mkdir(templateDir, { recursive: true });
  await copyFile(installerScript, path.join(dir, 'scripts', 'install-hooks.mjs'));
  await copyFile(hookTemplate, path.join(templateDir, 'pre-commit.mjs'));
  await copyFile(posixTemplate, path.join(templateDir, 'pre-commit'));

  if (options.git !== false) {
    runGit(dir, ['init', '-q']);
    runGit(dir, ['config', 'user.email', 'gate@open-sdd.test']);
    runGit(dir, ['config', 'user.name', 'open-sdd gate']);
  }

  return dir;
};

const install = (dir: string, args: string[] = []): CommandResult =>
  run(process.execPath, [path.join(dir, 'scripts', 'install-hooks.mjs'), ...args], { cwd: dir });

const hookEnv = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...process.env,
  OPEN_SDD_CLI: cliEntry,
  ...overrides,
});

const locateGit = (): string => {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(finder, ['git'], { encoding: 'utf8' });
  const lines = (result.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines[0] ?? 'git';
};

/**
 * A PATH that resolves `git` and nothing else, so the fail-closed test cannot accidentally find a
 * globally installed open-sdd and pass. On POSIX a symlink is used because git sometimes shares a
 * directory with the global npm shims (Homebrew puts both in the same bin).
 */
const isolatedGitPath = async (): Promise<string> => {
  const gitBinary = locateGit();
  if (process.platform === 'win32') return path.dirname(gitBinary);
  const dir = await makeTempDir('open-sdd-path-');
  await symlink(gitBinary, path.join(dir, 'git'));
  return dir;
};

describe('templates/hooks/pre-commit.mjs — portable gate source', () => {
  it('contains no shell-only construct', () => {
    const source = readFileSync(hookTemplate, 'utf8');
    // A regression here is invisible on macOS/Linux and fatal on Windows, which is why it is a
    // static assertion and not a behavioural one.
    for (const token of ['[[', '$(', '`', 'function ', 'set -e']) {
      expect(source.includes(token), `el gate portatil no debe contener ${JSON.stringify(token)}`).toBe(
        false,
      );
    }
  });

  it('starts with the Node shebang', () => {
    expect(readFileSync(hookTemplate, 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
  });

  it('exits 0 on a clean index when the CLI resolves through OPEN_SDD_CLI', async () => {
    const dir = await makeRepo();
    const result = run(process.execPath, [hookTemplate], { cwd: dir, env: hookEnv() });

    expect(result.status, result.output).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('fails CLOSED when the CLI cannot be resolved, and says how to fix it', async () => {
    const dir = await makeRepo();
    const isolated = await isolatedGitPath();
    // Sanity: the isolated PATH must not contain a global gate, or the test proves nothing.
    expect(existsSync(path.join(isolated, 'open-sdd'))).toBe(false);

    const result = run(process.execPath, [hookTemplate], {
      cwd: dir,
      env: { ...process.env, PATH: isolated, OPEN_SDD_CLI: path.join(dir, 'no-existe', 'cli.js') },
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain('COMMIT BLOQUEADO');
    // Never 0: a missing instrument must not read as an approved verification.
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('OPEN_SDD_CLI');
    expect(result.output).toContain('npm run build');
    expect(result.output).toContain('security-allowlist.json');
  });

  it('reports the declared rigor level quietly, without the level table', async () => {
    const dir = await makeRepo({ rigor: true });
    const result = run(process.execPath, [hookTemplate], { cwd: dir, env: hookEnv() });

    expect(result.status, result.output).toBe(0);
    const lines = result.output
      .trim()
      .split(/\r?\n/)
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(2);
    expect(result.output).toContain('nivel de rigor declarado');
    // The full table belongs to `open-sdd govern rigor`, not to every commit.
    expect(result.output).not.toContain('gates activos');
    expect(result.output).not.toContain('Rigor: spec-first');
  });
});

describe('the gate contract — the Node gate and the POSIX fallback agree', () => {
  const parseStringArray = (source: string, name: string): string[] => {
    const match = new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(source);
    expect(match, `no se encontro ${name} en el gate`).not.toBeNull();
    const body = match?.[1] ?? '';
    return Array.from(body.matchAll(/'([^']*)'/g), (entry) => entry[1]);
  };

  it('runs exactly the same gate ids and flags in both implementations', () => {
    const nodeGate = readFileSync(hookTemplate, 'utf8');
    const posixGate = readFileSync(posixTemplate, 'utf8');

    const gateArgs = parseStringArray(nodeGate, 'GATE_ARGS');
    const rigorArgs = parseStringArray(nodeGate, 'RIGOR_ARGS');

    expect(gateArgs.join(' ')).toBe('gates run C1 C2 C3 --staged --strict');
    expect(rigorArgs.join(' ')).toBe('govern rigor --no-drift --quiet');

    const posixLines = posixGate.split('\n').map((line) => line.trim());
    const posixGateLine = posixLines.find((line) => line.startsWith('node "$CLI" gates run'));
    const posixRigorLine = posixLines.find((line) => line.startsWith('node "$CLI" govern rigor'));

    expect(posixGateLine).toBe(`node "$CLI" ${gateArgs.join(' ')}`);
    expect(posixRigorLine).toBe(`node "$CLI" ${rigorArgs.join(' ')}`);
  });
});

describe('scripts/install-hooks.mjs — honest, idempotent, reversible', () => {
  it('installs an executable hook into an empty git repository', async () => {
    const dir = await makeCheckout();
    const result = install(dir);

    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toContain('instalado en');

    const target = path.join(dir, '.git', 'hooks', 'pre-commit');
    expect(existsSync(target)).toBe(true);
    // It installs the portable Node gate, never the POSIX fallback: the stale copy must not exist.
    expect(readFileSync(target, 'utf8')).toBe(readFileSync(hookTemplate, 'utf8'));
    if (process.platform !== 'win32') {
      expect((await stat(target)).mode & 0o111).toBeGreaterThan(0);
    }
  });

  it('reports already-up-to-date on a second run and writes nothing', async () => {
    const dir = await makeCheckout();
    install(dir);
    const target = path.join(dir, '.git', 'hooks', 'pre-commit');
    const contentBefore = readFileSync(target, 'utf8');
    const statBefore = await stat(target);

    await delay(50);
    const second = install(dir);

    expect(second.status, second.output).toBe(0);
    expect(second.stdout).toContain('ya está actualizado');
    expect(second.stdout).toContain('no se escribió nada');
    expect(readFileSync(target, 'utf8')).toBe(contentBefore);
    expect((await stat(target)).mtimeMs).toBe(statBefore.mtimeMs);
  });

  it('refreshes an older version of our own hook instead of trusting mere presence', async () => {
    const dir = await makeCheckout();
    const target = path.join(dir, '.git', 'hooks', 'pre-commit');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, '#!/bin/bash\n# open-sdd version anterior\nexit 0\n', 'utf8');

    const result = install(dir);

    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toContain('versión anterior');
    expect(readFileSync(target, 'utf8')).toBe(readFileSync(hookTemplate, 'utf8'));
  });

  it('reports a non-git directory without crashing and without claiming an install', async () => {
    const dir = await makeCheckout({ git: false });
    const result = install(dir);

    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toContain('no hay repositorio git');
    expect(result.stdout).not.toContain('instalado en');
    expect(existsSync(path.join(dir, '.git', 'hooks', 'pre-commit'))).toBe(false);
  });

  it('--hooks-path installs into a versioned directory and sets core.hooksPath, idempotently', async () => {
    const dir = await makeCheckout();
    const first = install(dir, ['--hooks-path', '.githooks']);

    expect(first.status, first.output).toBe(0);
    const target = path.join(dir, '.githooks', 'pre-commit');
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(readFileSync(hookTemplate, 'utf8'));
    expect(runGit(dir, ['config', '--get', 'core.hooksPath']).stdout.trim()).toBe('.githooks');

    const contentBefore = readFileSync(target, 'utf8');
    const statBefore = await stat(target);
    await delay(50);
    const second = install(dir, ['--hooks-path', '.githooks']);

    expect(second.status, second.output).toBe(0);
    expect(second.stdout).toContain('ya apunta a .githooks');
    expect(readFileSync(target, 'utf8')).toBe(contentBefore);
    expect((await stat(target)).mtimeMs).toBe(statBefore.mtimeMs);
    expect(runGit(dir, ['config', '--get', 'core.hooksPath']).stdout.trim()).toBe('.githooks');
  });

  it('--uninstall removes the hook and unsets core.hooksPath', async () => {
    const dir = await makeCheckout();
    install(dir, ['--hooks-path', '.githooks']);

    const result = install(dir, ['--uninstall']);

    expect(result.status, result.output).toBe(0);
    expect(existsSync(path.join(dir, '.githooks', 'pre-commit'))).toBe(false);
    expect(runGit(dir, ['config', '--get', 'core.hooksPath']).status).not.toBe(0);
  });

  it('never installs over a foreign hook without saying so', async () => {
    const dir = await makeCheckout();
    const target = path.join(dir, '.git', 'hooks', 'pre-commit');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, '#!/bin/sh\necho ajeno\n', 'utf8');

    const result = install(dir);

    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toContain('ajeno');
    expect(result.stdout).toContain('NO se instaló');
    expect(result.stdout).not.toContain('gate de commit instalado');
    expect(readFileSync(target, 'utf8')).toBe('#!/bin/sh\necho ajeno\n');
    expect(existsSync(`${target}.open-sdd-backup`)).toBe(true);
  });

  it('--force rewrites and names the outcome as a forced write', async () => {
    const dir = await makeCheckout();
    const target = path.join(dir, '.git', 'hooks', 'pre-commit');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, '#!/bin/sh\necho ajeno\n', 'utf8');

    const result = install(dir, ['--force']);

    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toContain('--force');
    expect(readFileSync(target, 'utf8')).toBe(readFileSync(hookTemplate, 'utf8'));
  });
});
