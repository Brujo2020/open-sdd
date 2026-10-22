/**
 * REQ-W2-014 — Axet completion gate. The rendered script is executed for real with Node against
 * stdin payloads shaped as the Axet 3.0.0 bundle sends them.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AXET_HOOK_MARKER, planAxetHook, renderAxetHook } from '../src/core/axetHook.js';

const tempDirs: string[] = [];
afterEach(async () => {
  while (tempDirs.length > 0) await rm(tempDirs.pop() as string, { recursive: true, force: true });
});

/** A stand-in CLI whose exit code is the verdict: the hook must not care what the CLI is. */
const fixture = async (cliExit: number | null): Promise<{ hook: string; dir: string }> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-axet-'));
  tempDirs.push(dir);
  const cli = path.join(dir, 'cli.mjs');
  if (cliExit !== null) await writeFile(cli, `console.log('C2 fail: secret'); process.exit(${cliExit});\n`);
  const hook = path.join(dir, 'PreToolUse');
  await writeFile(hook, renderAxetHook(cli));
  return { hook, dir };
};

const call = (hook: string, stdin: string): { status: number | null; json: { cancel: boolean; errorMessage?: string } } => {
  const run = spawnSync(process.execPath, [hook], { input: stdin, encoding: 'utf8' });
  return { status: run.status, json: JSON.parse(run.stdout.trim()) as { cancel: boolean; errorMessage?: string } };
};

const completion = JSON.stringify({ preToolUse: { toolName: 'attempt_completion', parameters: { result: 'done' } } });

describe('REQ-W2-014 — Axet PreToolUse completion gate', () => {
  it('lets every other tool through', async () => {
    const { hook } = await fixture(1);
    expect(call(hook, JSON.stringify({ preToolUse: { toolName: 'read_file' } }))).toEqual({ status: 0, json: { cancel: false } });
    expect(call(hook, 'not json').json.cancel).toBe(false);
  });

  it('allows completion when the gate passes', async () => {
    const { hook } = await fixture(0);
    expect(call(hook, completion)).toEqual({ status: 0, json: { cancel: false } });
  });

  it('blocks completion with the gate output, exiting 0 because Axet ignores non-zero exits', async () => {
    const { hook } = await fixture(1);
    const result = call(hook, completion);
    expect(result.status).toBe(0);
    expect(result.json.cancel).toBe(true);
    expect(result.json.errorMessage).toContain('C2 fail: secret');
  });

  it('fails closed when the CLI is missing', async () => {
    const { hook } = await fixture(null);
    const result = call(hook, completion);
    expect(result.status).toBe(0);
    expect(result.json.cancel).toBe(true);
  });

  it('refuses a foreign hook, keeps its own, updates its own', () => {
    expect(planAxetHook('#!/bin/sh\necho mine\n', '/cli.js', false).action).toBe('refused');
    expect(planAxetHook('#!/bin/sh\necho mine\n', '/cli.js', true).action).toBe('update');
    const own = renderAxetHook('/cli.js');
    expect(own).toContain(AXET_HOOK_MARKER);
    expect(planAxetHook(own, '/cli.js', false).action).toBe('keep');
    expect(planAxetHook(own, '/other/cli.js', false).action).toBe('update');
    expect(planAxetHook(null, '/cli.js', false).action).toBe('create');
  });

  it('uses no require() and no static import, so it runs under a "type": "module" package', () => {
    const script = renderAxetHook('/cli.js');
    expect(script).not.toMatch(/\brequire\(/);
    expect(script).not.toMatch(/^import /m);
  });
});
