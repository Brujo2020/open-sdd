import { describe, it, expect } from 'vitest';
import {
  LOGICAL_GATES,
  EXECUTABLE_CHAIN,
  DEFAULT_SIGNALS,
  resolveGateChain,
  computeResidue,
  catalogSummary,
  buildCrosswalk,
  detectSignals,
  getExecutableGate,
  type RepoSignals,
} from '../src/core/gateCatalog.js';

const ALL_SIGNALS: RepoSignals = {
  declaresThirdPartyMcpServers: true,
  hasAdrRecords: true,
  exceedsContextWindow: true,
  hasDependencyManifest: true,
  multipleAuthors: true,
  requiresStructuralGraph: true,
  hasLivingMemory: true,
};

const CORE = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];

describe('core/gateCatalog — Table 33/34 catalog shape', () => {
  it('declares the 21 logical gates G1..G21', () => {
    expect(LOGICAL_GATES).toHaveLength(21);
    expect(LOGICAL_GATES.map((g) => g.id)).toEqual(
      Array.from({ length: 21 }, (_, i) => `G${i + 1}`),
    );
  });

  it('declares the 14 executable chain entries C1-C7 and O1-O7', () => {
    expect(EXECUTABLE_CHAIN).toHaveLength(14);
    expect(EXECUTABLE_CHAIN.map((g) => g.id)).toEqual([
      ...CORE,
      'O1',
      'O2',
      'O3',
      'O4',
      'O5',
      'O6',
      'O7',
    ]);
  });

  it('exposes the constant core as exactly C1-C7', () => {
    const core = EXECUTABLE_CHAIN.filter((g) => g.posture !== 'opt-in').map((g) => g.id);
    expect(core).toEqual(CORE);
  });

  it('resolves C7 as vacuous, never as executed, in every profile', () => {
    for (const profile of ['solo', 'team', 'regulated'] as const) {
      const chain = resolveGateChain(profile, ALL_SIGNALS);
      expect(chain.vacuous.map((v) => v.id)).toContain('C7');
      expect(chain.executed).not.toContain('C7');
      expect(chain.notImplemented.map((v) => v.id)).not.toContain('C7');
    }
    expect(getExecutableGate('C7')?.inspects).toBe(false);
    expect(getExecutableGate('C7')?.posture).toBe('advisory');
  });
});

describe('core/gateCatalog — resolveGateChain (§9.5)', () => {
  it('solo resolves the constant core only (7 declared controls)', () => {
    const chain = resolveGateChain('solo', DEFAULT_SIGNALS);
    expect(chain.declared).toEqual(CORE);
    expect(chain.declared).toHaveLength(7);
    expect(chain.profileMandated).toEqual([]);
    expect(chain.signalActivated).toEqual([]);
    // C7 is declared but vacuous, so the executed set is the core minus C7.
    expect(chain.executed).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6']);
    expect(chain.blocking).toEqual(['C2']);
    expect(chain.advisory).toEqual(['C1', 'C3', 'C4', 'C5', 'C6']);
  });

  it('team resolves 9 declared controls (core + O1 + O5)', () => {
    const chain = resolveGateChain('team', DEFAULT_SIGNALS);
    expect(chain.declared).toHaveLength(9);
    expect(chain.declared).toEqual([...CORE, 'O1', 'O5']);
    expect(chain.profileMandated.map((c) => c.id)).toEqual(['O1', 'O5']);
    expect(chain.signalActivated).toEqual([]);
  });

  it('regulated resolves 12 declared controls (core + O1..O5) with no signals', () => {
    const chain = resolveGateChain('regulated', DEFAULT_SIGNALS);
    expect(chain.declared).toHaveLength(12);
    expect(chain.declared).toEqual([...CORE, 'O1', 'O2', 'O3', 'O4', 'O5']);
    expect(chain.profileMandated.map((c) => c.id)).toEqual(['O1', 'O2', 'O3', 'O4', 'O5']);
    expect(chain.signalActivated).toEqual([]);
  });

  it('signals never activate an opt-in control at solo, even with every signal set', () => {
    const chain = resolveGateChain('solo', ALL_SIGNALS);
    expect(chain.declared).toHaveLength(7);
    expect(chain.signalActivated).toEqual([]);
    expect(chain.executed.length).toBeLessThanOrEqual(7);
  });

  it('signals activate opt-in controls at team, citing the signal that justified each', () => {
    const chain = resolveGateChain('team', ALL_SIGNALS);
    const activated = chain.signalActivated.map((c) => c.id).sort();
    expect(activated).toEqual(['O2', 'O3', 'O4', 'O6', 'O7']);
    // profile-mandated O1/O5 are not duplicated as signal activations
    expect(chain.signalActivated.map((c) => c.id)).not.toContain('O1');
    expect(chain.signalActivated.map((c) => c.id)).not.toContain('O5');
    for (const control of chain.signalActivated) {
      expect(control.signal).toBeTruthy();
      expect(control.reason.length).toBeGreaterThan(0);
    }
    expect(chain.declared).toHaveLength(14);
  });

  it('signals activate only the non-mandated opt-ins at regulated (O6, O7)', () => {
    const chain = resolveGateChain('regulated', ALL_SIGNALS);
    expect(chain.signalActivated.map((c) => c.id).sort()).toEqual(['O6', 'O7']);
    expect(chain.declared).toHaveLength(14);
  });

  it('reports the paper measured counts 7 / 9 / 12 with default signals', () => {
    const counts = (['solo', 'team', 'regulated'] as const).map(
      (p) => resolveGateChain(p, DEFAULT_SIGNALS).declared.length,
    );
    expect(counts).toEqual([7, 9, 12]);
  });
});

describe('core/gateCatalog — residue (Table 36) computed by subtraction', () => {
  it('contains exactly G7, G8, G10, G11 and G17 for the shipped catalog', () => {
    expect(computeResidue().map((r) => r.id)).toEqual(['G7', 'G8', 'G10', 'G11', 'G17']);
  });

  it('covers 16 of the 21 logical gates', () => {
    const summary = catalogSummary();
    expect(summary.logical).toBe(21);
    expect(summary.covered).toBe(16);
    expect(summary.residue).toBe(5);
    expect(summary.executable).toBe(13);
    expect(summary.vacuous).toBe(1);
  });

  it('is derived: every residue gate has no executable check imposing it', () => {
    const imposed = new Set(EXECUTABLE_CHAIN.flatMap((c) => c.imposes));
    for (const entry of computeResidue()) {
      expect(imposed.has(entry.id)).toBe(false);
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(entry.retroTo.length).toBeGreaterThan(0);
    }
  });

  it('does not list the vacuous gate G21 as residue (different defect, different report)', () => {
    expect(computeResidue().map((r) => r.id)).not.toContain('G21');
  });
});

describe('core/gateCatalog — crosswalk and signal detection', () => {
  it('crosswalks logical gates to the checks that impose them', () => {
    const { byLogical, byCheck } = buildCrosswalk();
    const byGate = new Map(byLogical.map((row) => [row.gate, row.imposedBy]));
    expect(byGate.get('G5')).toEqual(['C2']);
    expect(byGate.get('G21')).toEqual(['C7']);
    expect(byGate.get('G7')).toEqual([]);
    expect(byCheck.find((c) => c.check === 'C1')?.imposes).toEqual(['G1', 'G6']);
  });

  it('detectSignals turns evidence details into booleans and reports every signal', () => {
    const { signals, evidence } = detectSignals({
      hasDependencyManifest: 'package-lock.json presente',
    });
    expect(signals.hasDependencyManifest).toBe(true);
    expect(signals.hasAdrRecords).toBe(false);
    expect(evidence).toHaveLength(7);
    expect(evidence.find((e) => e.signal === 'hasAdrRecords')?.detail).toBe('no detectada');
  });
});
