import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { approveGate, checkApprovals, specDirOf } from '../src/core/approvals.js';
import { handleApproveCommand } from '../src/cli/commands/approve.js';
import type { CliIO } from '../src/cli/io.js';

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const makeIO = () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const io: CliIO = { log: (m) => logs.push(m), error: (m) => errors.push(m), exit: () => undefined };
  return { io, logs, errors, text: () => [...logs, ...errors].join('\n') };
};

const seed = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'open-sdd-approve-'));
  temps.push(root);
  const dir = specDirOf(root, 'auth');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'requirements.md'), '# R\n\n- WHEN x, the system shall y.\n', 'utf8');
  await writeFile(path.join(dir, 'design.md'), '# D\n', 'utf8');
  await writeFile(path.join(dir, 'tasks.md'), '# T\n\n- [ ] 1. do\n', 'utf8');
  await writeFile(
    path.join(dir, 'spec.json'),
    JSON.stringify({ name: 'auth', approvals: { requirements: false, design: { generated: true, approved: false }, tasks: false } }),
    'utf8',
  );
  return root;
};

describe('core/approvals — an approval bound to the approved bytes', () => {
  it('records who, when and the sha256, and syncs both spec.json shapes', async () => {
    const root = await seed();
    const r = await approveGate({ root, feature: 'auth', gate: 'requirements', by: 'Ana' });
    expect(r.ok).toBe(true);
    expect(r.status.state).toBe('fresh');
    const ledger = JSON.parse(await readFile(path.join(specDirOf(root, 'auth'), 'approvals.json'), 'utf8'));
    expect(ledger.requirements.by).toBe('Ana');
    expect(ledger.requirements.sha256).toMatch(/^[0-9a-f]{64}$/);

    await approveGate({ root, feature: 'auth', gate: 'design', by: 'Ana' });
    const spec = JSON.parse(await readFile(path.join(specDirOf(root, 'auth'), 'spec.json'), 'utf8'));
    expect(spec.approvals.requirements).toBe(true);
    expect(spec.approvals.design).toEqual({ generated: true, approved: true });
  });

  it('an edit after approval makes it STALE', async () => {
    const root = await seed();
    await approveGate({ root, feature: 'auth', gate: 'requirements', by: 'Ana' });
    await writeFile(path.join(specDirOf(root, 'auth'), 'requirements.md'), '# R\n\n- edited after review\n', 'utf8');
    const [req] = await checkApprovals(specDirOf(root, 'auth'));
    expect(req!.state).toBe('stale');
    expect(req!.detail).toContain('changed after Ana approved it');
  });

  it('refuses design before a FRESH requirements approval, naming the command that unblocks', async () => {
    const root = await seed();
    const r = await approveGate({ root, feature: 'auth', gate: 'design', by: 'Ana' });
    expect(r.ok).toBe(false);
    expect(r.refusal!.fix).toContain('--gate requirements');

    await approveGate({ root, feature: 'auth', gate: 'requirements', by: 'Ana' });
    await writeFile(path.join(specDirOf(root, 'auth'), 'requirements.md'), 'changed\n', 'utf8');
    expect((await approveGate({ root, feature: 'auth', gate: 'design', by: 'Ana' })).ok).toBe(false);
  });
});

describe('open-sdd approve — CLI contract', () => {
  it('--check exits 1 on a stale approval and 0 when everything recorded is fresh', async () => {
    const root = await seed();
    const ok = makeIO();
    expect(await handleApproveCommand(['auth', '--gate', 'requirements', '--by', 'Ana'], ok.io, root)).toBe(0);
    expect(await handleApproveCommand(['auth', '--check'], makeIO().io, root)).toBe(0);

    await writeFile(path.join(specDirOf(root, 'auth'), 'requirements.md'), 'edited\n', 'utf8');
    const stale = makeIO();
    expect(await handleApproveCommand(['auth', '--check'], stale.io, root)).toBe(1);
    expect(stale.text()).toContain('STALE');
    expect(stale.text()).toContain('open-sdd approve auth --gate requirements');
  });

  it('--strict also fails on a missing approval; --json is one parseable envelope', async () => {
    const root = await seed();
    expect(await handleApproveCommand(['auth', '--check'], makeIO().io, root)).toBe(0);
    const ctx = makeIO();
    expect(await handleApproveCommand(['auth', '--check', '--strict', '--json'], ctx.io, root)).toBe(1);
    const envelope = JSON.parse(ctx.logs.join('\n'));
    expect(envelope.ok).toBe(false);
    expect(envelope.findings.errors.map((e: { id: string }) => e.id)).toContain('APPROVAL-MISSING-REQUIREMENTS');
  });

  it('usage errors exit 2: unknown gate, unknown spec, no feature', async () => {
    const root = await seed();
    expect(await handleApproveCommand(['auth', '--gate', 'deploy', '--by', 'A'], makeIO().io, root)).toBe(2);
    expect(await handleApproveCommand(['nope', '--check'], makeIO().io, root)).toBe(2);
    expect(await handleApproveCommand([], makeIO().io, root)).toBe(2);
  });

  it('a refused approval exits 1 with the fix', async () => {
    const root = await seed();
    const ctx = makeIO();
    expect(await handleApproveCommand(['auth', '--gate', 'tasks', '--by', 'Ana'], ctx.io, root)).toBe(1);
    expect(ctx.text()).toContain('= help: open-sdd approve auth --gate design');
  });
});
