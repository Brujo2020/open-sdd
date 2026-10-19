import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli } from '../src/index.js';

const runtime = { platform: 'darwin' } as const;

const makeIO = () => {
  const logs: string[] = [];
  const errs: string[] = [];
  let exitCode: number | null = null;
  return {
    io: {
      log: (m: string) => logs.push(m),
      error: (m: string) => errs.push(m),
      exit: (c: number) => {
        exitCode = c;
      },
    },
    get logs() {
      return logs;
    },
    get errs() {
      return errs;
    },
    get exitCode() {
      return exitCode;
    },
  };
};

describe('CLI Subcommands', () => {
  it('executes open-sdd init', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'sdd-cli-sub-'));
    const ctx = makeIO();

    const code = await runCli(['init', 'payment-v2', '--title=Payment Gateway V2'], runtime, ctx.io, {}, { cwd });
    expect(code).toBe(0);
    expect(ctx.logs.join('\n')).toMatch(/Initialized specification for/);
    expect(ctx.logs.join('\n')).toMatch(/payment-v2/);
  });

  it('executes open-sdd status', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'sdd-cli-sub-'));
    const ctxInit = makeIO();
    await runCli(['init', 'feature-alpha'], runtime, ctxInit.io, {}, { cwd });

    const ctx = makeIO();
    const code = await runCli(['status', 'feature-alpha'], runtime, ctx.io, {}, { cwd });
    expect(code).toBe(0);
    expect(ctx.logs.join('\n')).toMatch(/Specification:.*feature-alpha/);
    expect(ctx.logs.join('\n')).toMatch(/Phase:\s+initialized/);
  });

  it('executes open-sdd status --json', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'sdd-cli-sub-'));
    const ctxInit = makeIO();
    await runCli(['init', 'feature-beta'], runtime, ctxInit.io, {}, { cwd });

    const ctx = makeIO();
    const code = await runCli(['status', '--json'], runtime, ctx.io, {}, { cwd });
    expect(code).toBe(0);
    const parsed = JSON.parse(ctx.logs.join('\n'));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((p: any) => p.name === 'feature-beta')).toBe(true);
  });

  it('executes open-sdd gap', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'sdd-cli-sub-'));
    const ctxInit = makeIO();
    await runCli(['init', 'feature-gap'], runtime, ctxInit.io, {}, { cwd });

    const ctx = makeIO();
    const code = await runCli(['gap', 'feature-gap'], runtime, ctx.io, {}, { cwd });
    expect(code).toBe(0);
    expect(ctx.logs.join('\n')).toMatch(/Blast Radius & Gap Analysis/);
  });

  it('executes open-sdd audit with --regulatory', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'sdd-cli-sub-'));
    const ctxInit = makeIO();
    await runCli(['init', 'feature-audit'], runtime, ctxInit.io, {}, { cwd });

    const ctx = makeIO();
    const code = await runCli(['audit', 'feature-audit', '--regulatory'], runtime, ctx.io, {}, { cwd });
    expect(code).toBe(0);
    expect(ctx.logs.join('\n')).toMatch(/Open-SDD Audit/);
    expect(ctx.logs.join('\n')).toMatch(/EU AI Act/);
  });

  it('executes open-sdd getspecs', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'sdd-cli-sub-'));
    await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'demo-app' }), 'utf8');

    const ctx = makeIO();
    const code = await runCli(['getspecs'], runtime, ctx.io, {}, { cwd });
    expect(code).toBe(0);
    expect(ctx.logs.join('\n')).toMatch(/Reverse-engineered repository context/);
  });

  it('executes open-sdd help for specific commands', async () => {
    const ctx = makeIO();
    const code = await runCli(['help', 'audit'], runtime, ctx.io, {});
    expect(code).toBe(0);
    expect(ctx.logs.join('\n')).toMatch(/Command: open-sdd audit/);
  });
});
