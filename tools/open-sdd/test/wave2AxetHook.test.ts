/**
 * REQ-W2-014 / REQ-W2-016 — Axet hooks. Each rendered hook is executed for real with Node, from a cwd
 * that is NOT the project (Axet spawns hooks without one), against payloads shaped as Axet 3.0.0
 * serializes them, with a stand-in CLI whose verdict the test controls.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AXET_HOOK_EVENTS,
  AXET_HOOK_MARKER,
  applyAxetHooks,
  detectInstallSource,
  planAxetHooks,
  renderAxetHook,
  type AxetHookEvent,
} from '../src/core/axetHook.js';

const tempDirs: string[] = [];
afterEach(async () => {
  while (tempDirs.length > 0) await rm(tempDirs.pop() as string, { recursive: true, force: true });
});
const makeDir = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const SOURCE = 'github:Brujo2020/open-sdd#improve/wave-2';

/** A project with the hooks installed and a stand-in CLI in node_modules. */
const project = async (withLocalCli = true): Promise<string> => {
  const root = await makeDir('sdd-axet-root-');
  await applyAxetHooks(planAxetHooks(root, SOURCE, false));
  if (withLocalCli) {
    const dist = path.join(root, 'node_modules', '@brujo2020', 'open-sdd', 'tools', 'open-sdd', 'dist');
    await mkdir(dist, { recursive: true });
    await writeFile(
      path.join(dist, 'cli.js'),
      [
        "import fs from 'node:fs';",
        "fs.writeFileSync('gate-cwd.txt', process.cwd());",
        "const pass = fs.existsSync('pass.flag');",
        "console.log('  C1   Triad Integrity (SDD)                      advisory');",
        "console.log('  C2   Security Baseline                          ' + (pass ? 'pass' : 'fail'));",
        'process.exit(pass ? 0 : 1);',
      ].join('\n'),
    );
  }
  return root;
};

const fire = (root: string, event: AxetHookEvent, payload: object, env: NodeJS.ProcessEnv = process.env) => {
  const elsewhere = tmpdir();
  const run = spawnSync(process.execPath, [path.join(root, '.axetrules', 'hooks', event)], {
    cwd: elsewhere,
    input: JSON.stringify({ hookName: event, taskId: `t${Math.random().toString(36).slice(2)}`, workspaceRoots: [root], ...payload }),
    encoding: 'utf8',
    env,
  });
  const lines = run.stdout.trim().split('\n');
  return { status: run.status, json: JSON.parse(lines[lines.length - 1]) as { cancel: boolean; contextModification?: string }, stderr: run.stderr };
};

describe('REQ-W2-014 — what each Axet hook does', () => {
  it('TaskStart gives the agent the contract and the verdict, running the gate in the project root', async () => {
    const root = await project();
    const result = fire(root, 'TaskStart', { taskStart: { taskMetadata: { initialTask: 'x' } } });
    expect(result.status).toBe(0);
    expect(result.json.cancel).toBe(false);
    expect(result.json.contextModification).toMatch(/^SDD_GATE: /);
    expect(result.json.contextModification).toContain('FAIL — C2 Security Baseline');
    expect(result.json.contextModification).toContain('Before attempt_completion');
    expect(await readFile(path.join(root, 'gate-cwd.txt'), 'utf8')).toBe(root);
  });

  it('PostToolUse ignores tools that change nothing, without running the gate', async () => {
    const root = await project();
    expect(fire(root, 'PostToolUse', { postToolUse: { toolName: 'read_file' } }).json).toEqual({ cancel: false });
    expect(existsSync(path.join(root, 'gate-cwd.txt'))).toBe(false);
  });

  it('PostToolUse speaks only when the verdict changes within a task', async () => {
    const root = await project();
    const taskId = 'task-change';
    const edit = { taskId, postToolUse: { toolName: 'write_to_file' } };
    const first = fire(root, 'PostToolUse', edit);
    expect(first.json.contextModification).toContain('FAIL');
    expect(fire(root, 'PostToolUse', edit).json).toEqual({ cancel: false });
    await writeFile(path.join(root, 'pass.flag'), '');
    const fixed = fire(root, 'PostToolUse', edit);
    expect(fixed.json.contextModification).toContain('PASS');
    expect(fire(root, 'PostToolUse', edit).json).toEqual({ cancel: false });
  });

  it('PostToolUse does not repeat the verdict TaskStart already gave in the same task', async () => {
    const root = await project();
    fire(root, 'TaskStart', { taskId: 'task-same' });
    expect(fire(root, 'PostToolUse', { taskId: 'task-same', postToolUse: { toolName: 'write_to_file' } }).json).toEqual({ cancel: false });
  });

  it('TaskComplete reports in the chat and never cancels', async () => {
    const root = await project();
    const result = fire(root, 'TaskComplete', { taskComplete: { taskMetadata: {} } });
    expect(result.json).toEqual({ cancel: false });
    expect(result.stderr).toContain('open-sdd gate after completion: FAIL');
  });

  it('without a local CLI it runs the same origin through npx', async () => {
    const root = await project(false);
    const bin = await makeDir('sdd-axet-bin-');
    const record = path.join(bin, 'args.txt');
    await writeFile(path.join(bin, 'npx'), `#!/bin/sh\necho "$@" > '${record}'\nexit 1\n`);
    await chmod(path.join(bin, 'npx'), 0o755);
    const result = fire(root, 'TaskStart', {}, { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` });
    expect(result.json.cancel).toBe(false);
    expect(await readFile(record, 'utf8')).toContain(`--yes ${SOURCE} gates run C1 C2 C3 --staged --strict`);
  });

  it('a CLI that cannot start is reported as unavailable, never as a gate verdict', async () => {
    const root = await project(false);
    const bin = await makeDir('sdd-axet-bin-');
    await writeFile(path.join(bin, 'npx'), '#!/bin/sh\necho "npm error 404 Not Found" >&2\nexit 1\n');
    await chmod(path.join(bin, 'npx'), 0o755);
    const result = fire(root, 'TaskStart', {}, { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` });
    expect(result.json.contextModification).toContain('UNAVAILABLE — the gate could not run (npm error 404 Not Found)');
    expect(result.json.contextModification).not.toContain('FAIL');
  });

  it('no hook ever sends cancel:true (in Axet it cancels the whole task)', () => {
    for (const event of AXET_HOOK_EVENTS) expect(renderAxetHook(event, SOURCE)).not.toMatch(/cancel:\s*true/);
  });

  it('uses no require() and no static import, so it runs under a "type": "module" package', () => {
    for (const event of AXET_HOOK_EVENTS) {
      const script = renderAxetHook(event, SOURCE);
      expect(script).not.toMatch(/\brequire\(/);
      expect(script).not.toMatch(/^import /m);
    }
  });
});

describe('REQ-W2-016 — one origin', () => {
  it('reads the spec npx recorded for this package', async () => {
    const cache = await makeDir('sdd-npx-');
    const hash = path.join(cache, '_npx', 'abc123');
    await mkdir(path.join(hash, 'node_modules', '@brujo2020', 'open-sdd', 'tools', 'open-sdd', 'dist'), { recursive: true });
    await writeFile(path.join(hash, 'package.json'), JSON.stringify({ dependencies: { '@brujo2020/open-sdd': SOURCE } }));
    const cli = path.join(hash, 'node_modules', '@brujo2020', 'open-sdd', 'tools', 'open-sdd', 'dist', 'cli.js');
    const saved = process.env.OPEN_SDD_SOURCE;
    delete process.env.OPEN_SDD_SOURCE;
    try {
      expect(detectInstallSource(cli, '9.9.9')).toBe(SOURCE);
      await writeFile(path.join(hash, 'package.json'), JSON.stringify({ dependencies: { '@brujo2020/open-sdd': 'file:../../pkg.tgz' } }));
      expect(detectInstallSource(cli, '9.9.9')).toBe(`file:${path.join(cache, 'pkg.tgz')}`);
      expect(detectInstallSource('/usr/lib/node_modules/@brujo2020/open-sdd/dist/cli.js', '9.9.9')).toBe('@brujo2020/open-sdd@9.9.9');
      process.env.OPEN_SDD_SOURCE = 'file:/tmp/x.tgz';
      expect(detectInstallSource(cli, '9.9.9')).toBe('file:/tmp/x.tgz');
    } finally {
      if (saved === undefined) delete process.env.OPEN_SDD_SOURCE;
      else process.env.OPEN_SDD_SOURCE = saved;
    }
  });

  it('plans: create, keep, refuse a foreign hook, force it, retire the PreToolUse of the first design', async () => {
    const root = await makeDir('sdd-axet-plan-');
    expect(planAxetHooks(root, SOURCE, false).map((p) => p.action)).toEqual(['create', 'create', 'create']);
    await applyAxetHooks(planAxetHooks(root, SOURCE, false));
    expect(planAxetHooks(root, SOURCE, false).map((p) => p.action)).toEqual(['keep', 'keep', 'keep']);
    expect(planAxetHooks(root, 'github:other/fork', false).map((p) => p.action)).toEqual(['update', 'update', 'update']);
    await writeFile(path.join(root, '.axetrules', 'hooks', 'TaskStart'), '#!/bin/sh\necho mine\n');
    expect(planAxetHooks(root, SOURCE, false)[0].action).toBe('refused');
    expect(planAxetHooks(root, SOURCE, true)[0].action).toBe('update');
    await writeFile(path.join(root, '.axetrules', 'hooks', 'PreToolUse'), '// open-sdd:axet-completion-gate\n');
    const outcome = await applyAxetHooks(planAxetHooks(root, SOURCE, true));
    expect(outcome.retired).toEqual(['PreToolUse']);
    expect(existsSync(path.join(root, '.axetrules', 'hooks', 'PreToolUse'))).toBe(false);
    expect(await readFile(path.join(root, '.axetrules', 'hooks', 'TaskStart'), 'utf8')).toContain(AXET_HOOK_MARKER);
  });
});
