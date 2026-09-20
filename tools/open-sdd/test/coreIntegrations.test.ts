/**
 * `open-sdd integrate` — the adoption surface, machine-checked.
 *
 * Everything runs over `mkdtemp` fixtures and is cleaned in `afterEach`: the suite NEVER writes
 * inside the repository. The observable contract under test is the one the matrix promises:
 * `--list` prints every host with its invocation syntax, detection names its evidence, a verified
 * host yields a parseable JSON/TOML snippet while an unverified one is printed as NO VERIFICADO and
 * never written, and `--write` merges into an existing config without deleting unrelated keys and
 * is idempotent on the second run.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  HOST_INTEGRATIONS,
  detectIntegration,
  integrationById,
  mcpRegistration,
} from '../src/core/integrations.js';
import { handleIntegrateCommand, planIntegrate } from '../src/cli/commands/init.js';

const tempDirs: string[] = [];

const makeRoot = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-integrate-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

const makeIO = () => {
  const logs: string[] = [];
  const errs: string[] = [];
  return {
    io: {
      log: (message: string) => logs.push(message),
      error: (message: string) => errs.push(message),
      exit: () => undefined,
    },
    get logs() {
      return logs;
    },
    get errs() {
      return errs;
    },
    text: () => logs.join('\n'),
  };
};

const exists = async (p: string): Promise<boolean> => (await stat(p).catch(() => null)) !== null;

const readJson = async (p: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(p, 'utf8')) as Record<string, unknown>;

describe('integrations — the matrix is the single source of truth', () => {
  it('--list prints every host with its skills layout and its invocation syntax', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();

    expect(await handleIntegrateCommand(['--list'], ctx.io, dir)).toBe(0);

    for (const host of HOST_INTEGRATIONS) {
      expect(ctx.text(), `host ${host.id} missing from --list`).toContain(host.id);
      expect(ctx.text(), `invocation of ${host.id} missing`).toContain(host.invocation);
      expect(ctx.text(), `skills layout of ${host.id} missing`).toContain(host.skills.layout);
    }
    expect(ctx.text()).toContain('verificado');
    expect(ctx.text()).toContain('NO VERIFICADA');
    // `--list` is read-only: nothing may appear in the fixture.
    expect(await exists(path.join(dir, '.cursor'))).toBe(false);
    expect(await exists(path.join(dir, '.mcp.json'))).toBe(false);
  });

  it('every id resolves and the matrix has no duplicate host', () => {
    const ids = HOST_INTEGRATIONS.map((host) => host.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(integrationById(id)?.id).toBe(id);
    expect(integrationById('does-not-exist')).toBeUndefined();
  });
});

describe('integrations — detection names its evidence', () => {
  it('detects Cursor from a `.cursor/` marker and publishes the evidence', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });

    const detected = await detectIntegration(dir);
    expect(detected?.id).toBe('cursor');
    expect(detected?.evidence.some((line) => line.includes('.cursor/'))).toBe(true);
  });

  it('without any marker there is nothing to detect', async () => {
    const dir = await makeRoot();
    expect(await detectIntegration(dir)).toBeNull();
  });

  it('the detected host is printed with its exact invocation line', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });
    const ctx = makeIO();

    expect(await handleIntegrateCommand([], ctx.io, dir)).toBe(0);
    expect(ctx.text()).toContain('cursor');
    expect(ctx.text()).toContain('/sdd-brownfield');
    expect(ctx.text()).toContain('.cursor/ existe');
  });

  it('an unknown host is an error that lists the admitted ids', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();
    expect(await handleIntegrateCommand(['not-a-host'], ctx.io, dir)).toBe(1);
    expect(ctx.errs.join('\n')).toContain('claude-code');
  });
});

describe('integrations — MCP registration is real or declared unverified', () => {
  it('a verified JSON host produces a parseable `mcpServers` snippet', () => {
    const cliPath = '/opt/open-sdd/dist/cli.js';
    const registration = mcpRegistration('claude-code', { cliPath });

    expect(registration.verified).toBe(true);
    expect(registration.format).toBe('json');
    expect(registration.path).toBe('.mcp.json');

    const parsed = JSON.parse(registration.content) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(parsed.mcpServers['open-sdd'].command).toBe('node');
    expect(parsed.mcpServers['open-sdd'].args).toEqual([cliPath, 'mcp']);
  });

  it('a verified TOML host produces a `[mcp_servers.open-sdd]` table', () => {
    const registration = mcpRegistration('codex', { cliPath: '/opt/open-sdd/dist/cli.js' });
    expect(registration.verified).toBe(true);
    expect(registration.format).toBe('toml');
    expect(registration.content).toContain('[mcp_servers.open-sdd]');
    expect(registration.content).toContain('command = "node"');
    expect(registration.content).toContain('args = ["/opt/open-sdd/dist/cli.js", "mcp"]');
  });

  it('an unverified host is marked `verified:false`, printed as NO VERIFICADO and never written', async () => {
    const dir = await makeRoot();
    const registration = mcpRegistration('zed', { cliPath: '/opt/open-sdd/dist/cli.js' });
    expect(registration.verified).toBe(false);

    const plan = await planIntegrate({ cwd: dir, host: 'zed' });
    expect(plan.mcp.verified).toBe(false);
    expect(plan.artifacts.find((artifact) => artifact.kind === 'mcp-config')?.action).toBe('keep');

    const ctx = makeIO();
    expect(await handleIntegrateCommand(['zed'], ctx.io, dir)).toBe(0);
    expect(ctx.text()).toContain('NO VERIFICADO');
    expect(ctx.text()).toContain('no se escribe automáticamente');
  });

  it('an unknown id never yields a plausible-looking snippet', () => {
    const registration = mcpRegistration('nope', { cliPath: '/opt/cli.js' });
    expect(registration.path).toBeNull();
    expect(registration.content).toBe('');
    expect(registration.verified).toBe(false);
  });
});

describe('integrations --write — merge, never clobber, and idempotent', () => {
  const fixtureConfig = {
    mcpServers: {
      'other-tool': { command: 'uvx', args: ['other'] },
    },
    unrelatedTop: { keep: true },
  };

  it('merges into an EXISTING config and leaves unrelated keys untouched', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });
    await writeFile(path.join(dir, '.cursor', 'mcp.json'), `${JSON.stringify(fixtureConfig, null, 2)}\n`, 'utf8');

    const ctx = makeIO();
    expect(await handleIntegrateCommand(['cursor', '--write', '--json'], ctx.io, dir)).toBe(0);

    const output = JSON.parse(ctx.text()) as {
      artifacts: { kind: string; action: string }[];
      outcome: { written: string[]; kept: string[] };
    };
    expect(output.artifacts.find((artifact) => artifact.kind === 'mcp-config')?.action).toBe('update');
    expect(output.outcome.written).toContain('.cursor/mcp.json');

    const merged = (await readJson(path.join(dir, '.cursor', 'mcp.json'))) as {
      mcpServers: Record<string, unknown>;
      unrelatedTop: { keep: boolean };
    };
    // The untouched keys survive, byte for byte in meaning.
    expect(merged.unrelatedTop).toEqual({ keep: true });
    expect(merged.mcpServers['other-tool']).toEqual({ command: 'uvx', args: ['other'] });
    expect(merged.mcpServers['open-sdd']).toEqual({
      command: 'node',
      args: [expect.stringContaining('cli.js'), 'mcp'],
    });
  });

  it('a second --write reports keep for the MCP config (idempotent)', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });

    expect(await handleIntegrateCommand(['cursor', '--write', '--json'], makeIO().io, dir)).toBe(0);
    const before = await readFile(path.join(dir, '.cursor', 'mcp.json'), 'utf8');

    const ctx = makeIO();
    expect(await handleIntegrateCommand(['cursor', '--write', '--json'], ctx.io, dir)).toBe(0);
    const output = JSON.parse(ctx.text()) as {
      artifacts: { kind: string; action: string }[];
      outcome: { kept: string[] };
    };
    expect(output.artifacts.find((artifact) => artifact.kind === 'mcp-config')?.action).toBe('keep');
    expect(output.outcome.kept).toContain('.cursor/mcp.json');
    expect(await readFile(path.join(dir, '.cursor', 'mcp.json'), 'utf8')).toBe(before);
  });

  it('a config that does not parse is refused, not rewritten', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });
    const broken = '{ "mcpServers": { // comment\n';
    await writeFile(path.join(dir, '.cursor', 'mcp.json'), broken, 'utf8');

    const ctx = makeIO();
    expect(await handleIntegrateCommand(['cursor', '--write', '--json'], ctx.io, dir)).toBe(0);
    const output = JSON.parse(ctx.text()) as { artifacts: { kind: string; action: string }[] };
    expect(output.artifacts.find((artifact) => artifact.kind === 'mcp-config')?.action).toBe('keep');
    expect(await readFile(path.join(dir, '.cursor', 'mcp.json'), 'utf8')).toBe(broken);
  });

  it('--dry-run never writes even when --write is also present', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });

    expect(await handleIntegrateCommand(['cursor', '--write', '--dry-run'], makeIO().io, dir)).toBe(0);
    expect(await exists(path.join(dir, '.cursor', 'mcp.json'))).toBe(false);
  });
});
