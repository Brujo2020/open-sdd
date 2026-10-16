/**
 * G-36 — the commit hook must never fail OPEN through a stale global CLI.
 *
 * Behavioural: each case runs the real hook template (or the installed copy) against a real
 * `git init` fixture with a PATH that contains only git plus a FAKE `open-sdd` whose `--version` and
 * exit code the test controls. Nothing is written inside this repository.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOOK_PIN_FILE, MIN_HOOK_CLI_VERSION, compareSemver, readHookPin } from '../src/core/hookPin';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const hookTemplate = path.join(repoRoot, 'tools', 'open-sdd', 'templates', 'hooks', 'pre-commit.mjs');
const cliEntry = path.join(repoRoot, 'tools', 'open-sdd', 'dist', 'cli.js');
const posix = process.platform !== 'win32';

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const tmp = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const run = (args: string[], cwd: string, env: NodeJS.ProcessEnv) => {
  const r = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', shell: false });
  return { status: r.status ?? -1, output: (r.stdout ?? '') + (r.stderr ?? '') };
};

const makeRepo = async (): Promise<string> => {
  const dir = await tmp('open-sdd-pin-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
};

/** A fake CLI: answers `--version` with `version`, and exits `gateExit` for anything else. */
const fakeCli = async (dir: string, name: string, version: string, gateExit: number, marker: string) => {
  const file = path.join(dir, name);
  await writeFile(
    file,
    [
      '#!/usr/bin/env node',
      `if (process.argv.includes('--version')) { console.log('open-sdd v${version}'); process.exit(0); }`,
      `console.log('${marker}');`,
      `process.exit(${gateExit});`,
      '',
    ].join('\n'),
    'utf8',
  );
  await chmod(file, 0o755);
  return file;
};

/** PATH = git + a fake global `open-sdd`. */
const pathWithFake = async (version: string, gateExit: number, marker: string): Promise<string> => {
  const dir = await tmp('open-sdd-path-');
  const which = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  await symlink(which, path.join(dir, 'git'));
  await fakeCli(dir, 'open-sdd', version, gateExit, marker);
  return dir;
};

const envWithout = (PATH: string): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH };
  delete env.OPEN_SDD_CLI;
  return env;
};

describe('hook pin constants', () => {
  it('the hook template and core/hookPin.ts agree on the pin file and the version floor', () => {
    const source = readFileSync(hookTemplate, 'utf8');
    expect(source).toContain(`const PIN_FILE = '${HOOK_PIN_FILE}';`);
    expect(source).toContain(`const MIN_CLI_VERSION = '${MIN_HOOK_CLI_VERSION}';`);
  });

  it('compareSemver orders versions and refuses non-versions', () => {
    expect(compareSemver('2.0.0', '3.4.0')).toBe(-1);
    expect(compareSemver('3.4.0', '3.4.0')).toBe(0);
    expect(compareSemver('3.10.0', '3.4.0')).toBe(1);
    expect(compareSemver('dev', '3.4.0')).toBeNull();
  });
});

describe.runIf(posix)('templates/hooks/pre-commit.mjs — G-36', () => {
  it('fails CLOSED when the only CLI is a stale global install, instead of running it', async () => {
    const repo = await makeRepo();
    const PATH = await pathWithFake('2.0.0', 0, 'STALE-GATE-RAN');
    const result = run([hookTemplate], repo, envWithout(PATH));

    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('demasiado antiguo');
    expect(result.output).toContain('2.0.0');
    expect(result.output).toContain(MIN_HOOK_CLI_VERSION);
    expect(result.output).toContain('npm install -g @brujo2020/open-sdd@latest');
    // The stale CLI was asked its version and nothing else: its gate never ran.
    expect(result.output).not.toContain('STALE-GATE-RAN');
  });

  it('accepts a global install whose version is at least the floor', async () => {
    const repo = await makeRepo();
    // The fake gate fails on purpose: its verdict reaching the hook proves the hook RAN it.
    const PATH = await pathWithFake('9.0.0', 1, 'FRESH-GATE-RAN');
    const result = run([hookTemplate], repo, envWithout(PATH));

    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('FRESH-GATE-RAN');
    expect(result.output).not.toContain('demasiado antiguo');
  });

  it('prefers the pinned CLI over anything on PATH', async () => {
    const repo = await makeRepo();
    const hooksDir = path.join(repo, '.git', 'hooks');
    await mkdir(hooksDir, { recursive: true });
    const installedHook = path.join(hooksDir, 'pre-commit');
    await copyFile(hookTemplate, installedHook);
    const pinned = await fakeCli(await tmp('open-sdd-pinned-'), 'cli.js', '3.5.0', 1, 'PINNED-STRICT');
    await writeFile(path.join(hooksDir, HOOK_PIN_FILE), JSON.stringify({ cli: pinned, version: '3.5.0' }), 'utf8');
    const PATH = await pathWithFake('9.0.0', 0, 'LENIENT-GLOBAL');

    const result = run([installedHook], repo, envWithout(PATH));

    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('PINNED-STRICT');
    expect(result.output).not.toContain('LENIENT-GLOBAL');
  });

  it('demands the PINNED version from a PATH fallback when the pinned path is gone', async () => {
    const repo = await makeRepo();
    const hooksDir = path.join(repo, '.git', 'hooks');
    await mkdir(hooksDir, { recursive: true });
    const installedHook = path.join(hooksDir, 'pre-commit');
    await copyFile(hookTemplate, installedHook);
    // npx caches are ephemeral: the pinned path vanished, but the pin still records 4.0.0.
    await writeFile(
      path.join(hooksDir, HOOK_PIN_FILE),
      JSON.stringify({ cli: path.join(repo, 'gone', 'cli.js'), version: '4.0.0' }),
      'utf8',
    );
    const PATH = await pathWithFake('3.9.9', 0, 'OLDER-THAN-PIN');

    const result = run([installedHook], repo, envWithout(PATH));

    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('4.0.0');
    expect(result.output).not.toContain('OLDER-THAN-PIN');
  });

  it('names the published package in its fix, never the unscoped name that 404s', () => {
    const source = readFileSync(hookTemplate, 'utf8');
    expect(source).not.toMatch(/npm install -D open-sdd\b/);
    expect(source).toContain('@brujo2020/open-sdd');
  });
});

describe.runIf(posix)('open-sdd floor install — writes the pin', () => {
  it('records the installing CLI and its version beside the hook', async () => {
    const repo = await makeRepo();
    const result = run([cliEntry, 'floor', 'install', repo], repo, process.env);
    expect(result.status, result.output).toBe(0);

    const pin = await readHookPin(path.join(repo, '.git', 'hooks'));
    expect(pin).not.toBeNull();
    expect(existsSync(pin!.cli)).toBe(true);
    expect(compareSemver(pin!.version, MIN_HOOK_CLI_VERSION)).not.toBe(-1);
    // Per clone: nothing about the pin lands in the committed tree.
    expect(existsSync(path.join(repo, HOOK_PIN_FILE))).toBe(false);
    expect(await readFile(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8')).toContain(HOOK_PIN_FILE);
  });
});
