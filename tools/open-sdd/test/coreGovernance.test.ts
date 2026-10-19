import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initSpec } from '../src/core/specManager.js';
import { auditFeature } from '../src/core/auditEngine.js';
import {
  evaluateGates,
  gatesPass,
  governanceProfiles,
  loadGovernanceSettings,
  resolveGovernanceSettings,
} from '../src/core/governance.js';

const writeGovernance = async (cwd: string, body: unknown) => {
  const dir = path.join(cwd, '.sdd', 'settings');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'governance.json'), JSON.stringify(body), 'utf8');
};

describe('core/governance settings resolution', () => {
  it('defaults to the solo profile and never auto-pushes', () => {
    const s = resolveGovernanceSettings({});
    expect(s.profile).toBe('solo');
    expect(s.mode).toBe('fluid');
    expect(s.critical_invariants).toEqual([]);
    expect(governanceProfiles.solo.git.auto_push).toBe(false);
  });

  it('applies a named profile preset', () => {
    const s = resolveGovernanceSettings({ profile: 'enterprise' });
    expect(s.mode).toBe('strict');
    expect(s.critical_invariants).toHaveLength(3);
    expect(s.non_blocking_warnings).toBe(false);
  });

  it('lets an explicit field override the profile preset', () => {
    const s = resolveGovernanceSettings({ profile: 'enterprise', mode: 'fluid' });
    expect(s.mode).toBe('fluid');
    // untouched fields still come from the preset
    expect(s.critical_invariants).toHaveLength(3);
  });

  it('drops unknown invariant ids instead of trusting them', () => {
    const s = resolveGovernanceSettings({ critical_invariants: ['boundary_integrity', 'made_up'] as never });
    expect(s.critical_invariants).toEqual(['boundary_integrity']);
  });

  it('falls back to defaults when governance.json is absent or malformed', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'sdd-gov-'));
    expect((await loadGovernanceSettings(cwd)).profile).toBe('solo');
    await writeGovernance(cwd, 'not-an-object');
    expect((await loadGovernanceSettings(cwd)).mode).toBe('fluid');
  });
});

describe('core/governance gate evaluation', () => {
  const failingFacts = { driftDetected: true, specContractOk: false, proofsOk: false };

  it('never blocks under solo: every failure is advisory', () => {
    const gates = evaluateGates(resolveGovernanceSettings({ profile: 'solo' }), failingFacts);
    expect(gates.every((g) => g.outcome === 'advisory')).toBe(true);
    expect(gates.every((g) => g.enforced === false)).toBe(true);
    // the whole point of the default profile: it reports, it does not stand in the way
    expect(gatesPass(gates)).toBe(true);
  });

  it('team blocks only on the spec contract', () => {
    const gates = evaluateGates(resolveGovernanceSettings({ profile: 'team' }), failingFacts);
    const blocking = gates.filter((g) => g.outcome === 'fail');
    expect(blocking).toHaveLength(1);
    expect(blocking[0].id).toBe('spec_contract_present');
  });

  it('blocks on every gate under enterprise', () => {
    const gates = evaluateGates(resolveGovernanceSettings({ profile: 'enterprise' }), failingFacts);
    expect(gates.every((g) => g.outcome === 'fail')).toBe(true);
    expect(gatesPass(gates)).toBe(false);
  });

  it('passes cleanly when all facts are healthy', () => {
    const gates = evaluateGates(resolveGovernanceSettings({ profile: 'enterprise' }), {
      driftDetected: false,
      specContractOk: true,
      proofsOk: true,
    });
    expect(gatesPass(gates)).toBe(true);
  });
});

describe('auditFeature honours the active profile', () => {
  const seed = async (profile: 'solo' | 'enterprise') => {
    const cwd = await mkdtemp(path.join(tmpdir(), `sdd-gov-${profile}-`));
    await writeGovernance(cwd, { profile });
    const { specDir } = await initSpec(cwd, 'billing', { createBranch: false });
    // Implementation started (task in progress) but the Triad was never approved.
    await writeFile(path.join(specDir, 'requirements.md'), '### REQ-1: Charge card\n- works\n', 'utf8');
    await writeFile(
      path.join(specDir, 'tasks.md'),
      '- [x] 1. Charge card (REQ-1) _Boundary:_ `src/pay.ts`\n',
      'utf8',
    );
    return cwd;
  };

  it('reports the mode and all three gates in the result', async () => {
    const cwd = await seed('solo');
    const res = await auditFeature(cwd, 'billing');
    expect(res.mode).toBe('fluid');
    expect(res.gates).toHaveLength(3);
  });

  it('is stricter under enterprise than under solo for the same repo state', async () => {
    const soloRes = await auditFeature(await seed('solo'), 'billing');
    const entRes = await auditFeature(await seed('enterprise'), 'billing');

    const enforcedSolo = soloRes.gates.filter((g) => g.enforced).length;
    const enforcedEnt = entRes.gates.filter((g) => g.enforced).length;
    expect(enforcedEnt).toBeGreaterThan(enforcedSolo);
    expect(entRes.mode).toBe('strict');
  });

  it('does not penalise a freshly initialised spec', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'sdd-gov-fresh-'));
    await initSpec(cwd, 'untouched', { createBranch: false });
    const res = await auditFeature(cwd, 'untouched');
    expect(res.inSync).toBe(true);
  });
});
