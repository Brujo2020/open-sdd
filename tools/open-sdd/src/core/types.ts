export type SpecPhase =
  | 'initialized'
  | 'requirements-drafted'
  | 'design-drafted'
  | 'tasks-drafted'
  | 'approved'
  | 'in-progress'
  | 'verified'
  | 'completed';

export interface SpecApprovals {
  requirements: boolean;
  design: boolean;
  tasks: boolean;
}

export interface SpecMetadata {
  name: string;
  version?: string;
  phase: SpecPhase;
  approvals: SpecApprovals;
  language?: string;
  created_at?: string;
  updated_at?: string;
  description?: string;
}

export type TaskStatus = 'completed' | 'in_progress' | 'pending';

export interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  boundary?: string[];
  depends?: string[];
  raw: string;
}

export interface TaskWave {
  waveIndex: number;
  tasks: TaskItem[];
  isParallel: boolean;
  boundaries: string[];
}

export interface SchedulePlan {
  feature: string;
  totalTasks: number;
  pendingTasks: number;
  waves: TaskWave[];
  maxConcurrency: number;
}

export interface RequirementItem {
  id: string;
  title: string;
  type?: 'ubiquitous' | 'event_driven' | 'state_driven' | 'unwanted' | 'optional';
  acceptanceCriteria: string[];
}

export interface SpecStatus {
  name: string;
  phase: SpecPhase;
  exists: boolean;
  files: {
    brief: boolean;
    requirements: boolean;
    design: boolean;
    tasks: boolean;
    auditReport: boolean;
  };
  requirementsCount: number;
  tasks: {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    percent: number;
  };
  approvals: SpecApprovals;
  boundaries: string[];
  isApproved: boolean;
}

export type GovernanceMode = 'fluid' | 'strict';

/**
 * Named presets that configure governance + git coherently in one field.
 * Users pick a profile instead of hand-tuning a dozen flags.
 */
export type GovernanceProfile = 'solo' | 'team' | 'enterprise';

/** The three vital gates. Each maps to an invariant id in `critical_invariants`. */
export type CriticalInvariant =
  | 'boundary_integrity'
  | 'spec_contract_present'
  | 'verification_proofs_pass';

export const ALL_CRITICAL_INVARIANTS: CriticalInvariant[] = [
  'boundary_integrity',
  'spec_contract_present',
  'verification_proofs_pass',
];

export interface GovernanceSettings {
  /** Preset that seeds the fields below. Explicit fields always win over the profile. */
  profile?: GovernanceProfile;
  mode: GovernanceMode;
  /** When true, only `critical_invariants` can fail a run; everything else is advisory. */
  critical_gates_only: boolean;
  /** When true, warning-severity findings never change the exit code. */
  non_blocking_warnings: boolean;
  /** Which gates are enforced. Omit a gate to downgrade it to advisory. */
  critical_invariants: CriticalInvariant[];
}

/** Result of evaluating one gate against a spec. */
export interface GateResult {
  id: CriticalInvariant;
  label: string;
  /** 'pass' | 'fail' | 'advisory' (failed, but not enforced in this profile). */
  outcome: 'pass' | 'fail' | 'advisory';
  enforced: boolean;
  detail: string;
}

export interface GitSettings {
  mode: 'strict' | 'assisted' | 'off';
  branch_prefix: string;
  auto_branch: boolean;
  auto_commit: boolean;
  auto_push: boolean;
  require_approved_spec: boolean;
}

export interface AuditIssue {
  severity: 'critical' | 'warning' | 'info';
  code: string;
  message: string;
  file?: string;
}

export interface RtmEntry {
  requirementId: string;
  title: string;
  mappedTasks: string[];
  verified: boolean;
}

export interface AuditResult {
  feature: string;
  inSync: boolean;
  /** Evaluation of the 3 vital gates under the active governance profile. */
  gates: GateResult[];
  mode: GovernanceMode;
  driftDetected: boolean;
  score: number;
  rtm: RtmEntry[];
  issues: AuditIssue[];
  regulatory?: {
    euAiActArt11: boolean;
    euAiActArt12: boolean;
    euAiActArt14: boolean;
    nistAiRmf: boolean;
    compliancePercent: number;
  };
}

export interface GapAnalysis {
  feature: string;
  impactLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  boundaries: {
    file: string;
    exists: boolean;
    status: 'create' | 'modify';
  }[];
  externalDependencies: string[];
  warnings: string[];
}

export interface DiscoveredProject {
  name: string;
  language: string;
  frameworks: string[];
  packageManager?: string;
  buildTool?: string;
  testFramework?: string;
  sourceDirs: string[];
  testDirs: string[];
  modules: string[];
  /** Nested workspace roots that hold their own manifest (`packages/*`, `tools/*`, ...). */
  workspaceRoots?: string[];
}
