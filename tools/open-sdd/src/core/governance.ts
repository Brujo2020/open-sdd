import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ALL_CRITICAL_INVARIANTS,
  type CriticalInvariant,
  type GateResult,
  type GovernanceProfile,
  type GovernanceSettings,
  type GitSettings,
} from './types.js';

/**
 * Governance profiles.
 *
 * A profile is the ONLY knob most users should ever touch. It sets governance
 * and git coherently so that the promise in the docs matches runtime behaviour.
 */
export const governanceProfiles: Record<
  GovernanceProfile,
  { governance: Omit<GovernanceSettings, 'profile'>; git: Partial<GitSettings>; summary: string }
> = {
  // Default. Nothing blocks. Every check still runs and reports, so you keep the
  // signal without the tool ever standing in your way.
  solo: {
    governance: {
      mode: 'fluid',
      critical_gates_only: true,
      non_blocking_warnings: true,
      critical_invariants: [],
    },
    git: { mode: 'assisted', auto_branch: true, auto_commit: true, auto_push: false },
    summary: 'Nothing blocks. Checks run and report only.',
  },
  // Shared repo: the one rule worth enforcing is that code follows an approved spec.
  team: {
    governance: {
      mode: 'fluid',
      critical_gates_only: true,
      non_blocking_warnings: true,
      critical_invariants: ['spec_contract_present'],
    },
    git: { mode: 'assisted', auto_branch: true, auto_commit: true, auto_push: false },
    summary: 'Only blocks code written without an approved spec.',
  },
  // Opt-in, for audited environments. Everything blocks.
  enterprise: {
    governance: {
      mode: 'strict',
      critical_gates_only: false,
      non_blocking_warnings: false,
      critical_invariants: [...ALL_CRITICAL_INVARIANTS],
    },
    git: { mode: 'strict', auto_branch: true, auto_commit: true, auto_push: false },
    summary: 'Everything blocks. For audited environments.',
  },
};

/**
 * Default = `solo`. A fresh install must never surprise someone: it does not
 * push to a remote and it does not block on gates they have not opted into.
 */
export const defaultGovernanceSettings: GovernanceSettings = {
  profile: 'solo',
  ...governanceProfiles.solo.governance,
};

const isValidInvariant = (v: unknown): v is CriticalInvariant =>
  typeof v === 'string' && (ALL_CRITICAL_INVARIANTS as string[]).includes(v);

/**
 * Resolve settings with clear precedence:
 *   explicit field in governance.json  >  profile preset  >  default profile
 * Unknown invariant ids are dropped rather than silently trusted.
 */
export const resolveGovernanceSettings = (parsed: Partial<GovernanceSettings> = {}): GovernanceSettings => {
  const profile: GovernanceProfile =
    parsed.profile && parsed.profile in governanceProfiles ? parsed.profile : 'solo';
  const base = governanceProfiles[profile].governance;

  const invariants = Array.isArray(parsed.critical_invariants)
    ? parsed.critical_invariants.filter(isValidInvariant)
    : base.critical_invariants;

  return {
    profile,
    mode: parsed.mode === 'strict' || parsed.mode === 'fluid' ? parsed.mode : base.mode,
    critical_gates_only:
      typeof parsed.critical_gates_only === 'boolean' ? parsed.critical_gates_only : base.critical_gates_only,
    non_blocking_warnings:
      typeof parsed.non_blocking_warnings === 'boolean'
        ? parsed.non_blocking_warnings
        : base.non_blocking_warnings,
    critical_invariants: [...invariants],
  };
};

export const loadGovernanceSettings = async (
  cwd: string = process.cwd(),
  sddDir: string = '.sdd',
): Promise<GovernanceSettings> => {
  const settingsPath = path.join(cwd, sddDir, 'settings', 'governance.json');
  try {
    const content = await readFile(settingsPath, 'utf8');
    return resolveGovernanceSettings(JSON.parse(content));
  } catch {
    return defaultGovernanceSettings;
  }
};

const gateLabels: Record<CriticalInvariant, string> = {
  boundary_integrity: 'Changes stayed in scope',
  spec_contract_present: 'Code follows an approved spec',
  verification_proofs_pass: 'Work is verified',
};

/**
 * Evaluate the 3 vital gates.
 *
 * A gate that fails is only `fail` when the active profile enforces it;
 * otherwise it is reported as `advisory` so the user sees the signal
 * without being blocked. This is what makes fluid/strict real.
 */
export const evaluateGates = (
  settings: GovernanceSettings,
  facts: {
    driftDetected: boolean;
    driftDetail?: string;
    specContractOk: boolean;
    specContractDetail?: string;
    proofsOk: boolean;
    proofsDetail?: string;
  },
): GateResult[] => {
  const raw: { id: CriticalInvariant; ok: boolean; detail: string }[] = [
    {
      id: 'boundary_integrity',
      ok: !facts.driftDetected,
      detail: facts.driftDetail ?? (facts.driftDetected ? 'Files modified outside declared boundaries' : 'No ambient drift'),
    },
    {
      id: 'spec_contract_present',
      ok: facts.specContractOk,
      detail: facts.specContractDetail ?? (facts.specContractOk ? 'Documentary Triad present and approved' : 'Spec contract missing or unapproved'),
    },
    {
      id: 'verification_proofs_pass',
      ok: facts.proofsOk,
      detail: facts.proofsDetail ?? (facts.proofsOk ? 'Fresh verification evidence present' : 'No fresh verification evidence'),
    },
  ];

  return raw.map(({ id, ok, detail }) => {
    const enforced = settings.critical_invariants.includes(id);
    const outcome: GateResult['outcome'] = ok ? 'pass' : enforced ? 'fail' : 'advisory';
    return { id, label: gateLabels[id], outcome, enforced, detail };
  });
};

/** A run passes when no ENFORCED gate failed. Advisory failures never block. */
export const gatesPass = (gates: GateResult[]): boolean => !gates.some((g) => g.outcome === 'fail');
