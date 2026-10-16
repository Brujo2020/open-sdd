/**
 * The adoption path, end to end on throwaway repositories: `up` → a verified floor, `floor status`
 * green in a TARGET project (it used to exit 1 right after `floor install . --ci`), GitLab CI, and
 * the legacy uninstall that gives pre-receipt installs an exit.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectInstalledFloor } from '../src/core/floorInstallation.js';
import { planLegacyUninstall } from '../src/core/legacyUninstall.js';
import { detectCi } from '../src/cli/commands/up.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const cli = path.join(repoRoot, 'tools', 'open-sdd', 'dist', 'cli.js');
const posix = process.platform !== 'win32';

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const gitRepo = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'open-sdd-adopt-'));
  temps.push(dir);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'a@b.c'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'T'], { cwd: dir });
  await writeFile(path.join(dir, 'package.json'), '{"name":"demo"}\n', 'utf8');
  return dir;
};

const run = (args: string[], cwd: string) => {
  const r = spawnSync(process.execPath, [cli, ...args, '--no-footer'], { cwd, encoding: 'utf8' });
  return { status: r.status ?? -1, output: (r.stdout ?? '') + (r.stderr ?? '') };
};

describe.runIf(posix)('floor in a target project', () => {
  it('floor status is green right after floor install . --ci (GitHub)', async () => {
    const dir = await gitRepo();
    expect(run(['floor', 'install', '.', '--ci'], dir).status).toBe(0);
    const floor = await detectInstalledFloor(dir);
    expect(floor.commitHookShipped).toBe(true);
    expect(floor.floorInstalled).toBe(true);
    expect(run(['floor', 'status'], dir).status).toBe(0);
  });

  it('--ci gitlab writes the include-able job, creates .gitlab-ci.yml, and counts as level C', async () => {
    const dir = await gitRepo();
    const result = run(['floor', 'install', '.', '--ci', 'gitlab'], dir);
    expect(result.status, result.output).toBe(0);
    expect(await readFile(path.join(dir, '.gitlab', 'open-sdd-gates.gitlab-ci.yml'), 'utf8')).toContain('merge_request_event');
    expect(await readFile(path.join(dir, '.gitlab-ci.yml'), 'utf8')).toContain('local: .gitlab/open-sdd-gates.gitlab-ci.yml');
    // `gitlab` is the provider, never mistaken for the target directory.
    expect(existsSync(path.join(dir, 'gitlab'))).toBe(false);
    expect((await detectInstalledFloor(dir)).floorInstalled).toBe(true);
  });

  it('an existing .gitlab-ci.yml is never edited: the include line is printed instead', async () => {
    const dir = await gitRepo();
    await writeFile(path.join(dir, '.gitlab-ci.yml'), 'stages: [test]\n', 'utf8');
    const result = run(['floor', 'install', '.', '--ci', 'gitlab'], dir);
    expect(await readFile(path.join(dir, '.gitlab-ci.yml'), 'utf8')).toBe('stages: [test]\n');
    expect(result.output).toContain('include:');
  });
});

describe.runIf(posix)('open-sdd up', () => {
  it('detects the CI the repository already uses', async () => {
    const dir = await gitRepo();
    expect((await detectCi(dir)).provider).toBe('none');
    await mkdir(path.join(dir, '.github'));
    expect((await detectCi(dir)).provider).toBe('github');
    await writeFile(path.join(dir, '.gitlab-ci.yml'), 'x: 1\n', 'utf8');
    expect((await detectCi(dir)).provider).toBe('gitlab');
  });

  it('without --write writes nothing; with --write ends on a measured doctor verdict with 0 failures', async () => {
    const dir = await gitRepo();
    await mkdir(path.join(dir, '.github'));
    const plan = run(['up'], dir);
    expect(plan.status, plan.output).toBe(0);
    expect(existsSync(path.join(dir, '.sdd'))).toBe(false);
    expect(plan.output).toContain('open-sdd up . --write');

    const applied = run(['up', '--write'], dir);
    expect(applied.status, applied.output).toBe(0);
    expect(applied.output).toMatch(/9 ok · 0 aviso\(s\) · 0 fallo\(s\)/);
    expect(existsSync(path.join(dir, '.github', 'workflows', 'open-sdd-gates.yml'))).toBe(true);
    expect(existsSync(path.join(dir, '.git', 'hooks', 'open-sdd-cli.json'))).toBe(true);
  });

  it('refuses an unknown CI with a usage error', async () => {
    const dir = await gitRepo();
    expect(run(['up', '--ci', 'jenkins'], dir).status).toBe(2);
  });
});

describe.runIf(posix)('uninstall --legacy', () => {
  it('finds what up installed, refuses a skill a human extended, and restores a preserved foreign hook', async () => {
    const dir = await gitRepo();
    await mkdir(path.join(dir, '.github'));
    const hooks = path.join(dir, '.git', 'hooks');
    await mkdir(hooks, { recursive: true });
    await writeFile(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho team\n', { mode: 0o755 });
    // `up` never overwrites a foreign hook: doctor fails and names it, which is the honest verdict.
    const upped = run(['up', '--write'], dir);
    expect(upped.status).toBe(1);
    expect(upped.output).toContain('ajeno');
    // The human decides to replace it: floor install preserves the team hook as a backup.
    expect(run(['floor', 'install', '.'], dir).status).toBe(0)
    expect(existsSync(path.join(hooks, 'pre-commit.open-sdd-backup'))).toBe(true);

    const extended = path.join(dir, '.github', 'skills', 'sdd-impl');
    await writeFile(path.join(extended, 'MY-NOTES.md'), 'mine\n', 'utf8');

    const plan = await planLegacyUninstall(dir);
    expect(plan.entries.find((e) => e.path === '.github/skills/sdd-impl')?.state).toBe('refused');
    expect(plan.entries.find((e) => e.path === '.github/skills/sdd-audit')?.state).toBe('remove');

    const applied = run(['uninstall', '--legacy', '--write'], dir);
    expect(applied.status, applied.output).toBe(0);
    expect(await readFile(path.join(hooks, 'pre-commit'), 'utf8')).toBe('#!/bin/sh\necho team\n');
    expect(existsSync(path.join(hooks, 'open-sdd-cli.json'))).toBe(false);
    expect(existsSync(path.join(dir, '.github', 'skills', 'sdd-audit'))).toBe(false);
    expect(existsSync(path.join(extended, 'MY-NOTES.md'))).toBe(true);
    expect(existsSync(path.join(dir, '.sdd'))).toBe(true);
  });

  it('a hook that is not ours is never touched', async () => {
    const dir = await gitRepo();
    const hooks = path.join(dir, '.git', 'hooks');
    await mkdir(hooks, { recursive: true });
    await writeFile(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho team\n', 'utf8');
    const plan = await planLegacyUninstall(dir);
    expect(plan.entries).toEqual([expect.objectContaining({ path: '.git/hooks/pre-commit', state: 'refused' })]);
  });
});
