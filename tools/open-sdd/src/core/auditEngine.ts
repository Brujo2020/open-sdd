import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { AuditIssue, AuditResult, GovernanceMode, RtmEntry } from './types.js';
import {
  getSpecStatus,
  listSpecs,
  parseRequirementsMarkdown,
  parseTasksMarkdown,
  readSpecMetadata,
  resolveSddDir,
} from './specManager.js';
import { getModifiedFiles, isGitRepo } from './git.js';
import { evaluateGates, gatesPass, loadGovernanceSettings } from './governance.js';

/** Normalized prefix test used for the SDD directory exclusion in the drift check. */
const normalizedStartsWith = (file: string, prefix: string): boolean => {
  const f = path.normalize(file);
  const p = path.normalize(prefix);
  return f === p || f.startsWith(p.endsWith(path.sep) ? p : `${p}${path.sep}`);
};

/**
 * Does a task declare this requirement?
 *
 * The task template writes requirement references as plain numbers (`_Requirements: 2, 3_`)
 * while `parseRequirementsMarkdown` produces `REQ-2`. Matching only on the raw string therefore
 * never succeeded for template-conformant tasks, and every task was reported as a phantom. This
 * reads the declared metadata and normalizes both sides.
 */
const taskDeclaresRequirement = (
  task: { raw: string; title: string },
  req: { id: string; title: string },
): boolean => {
  const declared = task.raw.match(/_Requirements:\s*([^_\n]+)_/i);
  if (declared) {
    const ids = declared[1]
      .split(/[,;]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const numeric = req.id.replace(/^REQ-/i, '').toLowerCase();
    if (ids.some((id) => id === req.id.toLowerCase() || id === numeric)) return true;
  }
  return (
    task.raw.toLowerCase().includes(req.id.toLowerCase()) || task.raw.includes(req.title)
  );
};

export const auditFeature = async (
  cwd: string,
  feature: string,
  options: { regulatory?: boolean; sddDir?: string; mode?: GovernanceMode } = {},
): Promise<AuditResult> => {
  const sddDir = options.sddDir ?? (await resolveSddDir(cwd));
  const govSettings = await loadGovernanceSettings(cwd, sddDir);
  const effectiveMode = options.mode ?? govSettings.mode;
  const specDir = path.join(cwd, sddDir, 'specs', feature);
  const issues: AuditIssue[] = [];

  const status = await getSpecStatus(cwd, feature, sddDir);
  if (!status.exists) {
    return {
      feature,
      inSync: false,
      mode: effectiveMode,
      gates: evaluateGates(govSettings, {
        driftDetected: false,
        specContractOk: false,
        specContractDetail: `Specification "${feature}" does not exist`,
        proofsOk: false,
        proofsDetail: 'No spec, no evidence',
      }),
      driftDetected: true,
      score: 0,
      rtm: [],
      issues: [
        {
          severity: 'critical',
          code: 'SPEC_NOT_FOUND',
          message: `Specification "${feature}" does not exist in ${sddDir}/specs/`,
        },
      ],
    };
  }

  // 1. Check Documentary Triad files
  if (!status.files.requirements) {
    issues.push({
      severity: 'critical',
      code: 'MISSING_REQUIREMENTS',
      message: 'requirements.md is missing',
      file: 'requirements.md',
    });
  }
  if (!status.files.design) {
    issues.push({
      severity: 'warning',
      code: 'MISSING_DESIGN',
      message: 'design.md is missing',
      file: 'design.md',
    });
  }
  if (!status.files.tasks) {
    issues.push({
      severity: 'warning',
      code: 'MISSING_TASKS',
      message: 'tasks.md is missing',
      file: 'tasks.md',
    });
  }

  // 2. Requirements Traceability Matrix (RTM)
  const rtm: RtmEntry[] = [];
  let reqsList: ReturnType<typeof parseRequirementsMarkdown> = [];
  let tasksList: ReturnType<typeof parseTasksMarkdown> = [];

  if (status.files.requirements) {
    try {
      const reqContent = await readFile(path.join(specDir, 'requirements.md'), 'utf8');
      reqsList = parseRequirementsMarkdown(reqContent);
    } catch {
      // ignore
    }
  }

  if (status.files.tasks) {
    try {
      const taskContent = await readFile(path.join(specDir, 'tasks.md'), 'utf8');
      tasksList = parseTasksMarkdown(taskContent);
    } catch {
      // ignore
    }
  }

  for (const req of reqsList) {
    const matchingTasks = tasksList.filter((t) => taskDeclaresRequirement(t, req)).map((t) => t.id);

    const isVerified = matchingTasks.length > 0 && matchingTasks.every((tid) => {
      const t = tasksList.find((task) => task.id === tid);
      return t?.status === 'completed';
    });

    rtm.push({
      requirementId: req.id,
      title: req.title,
      mappedTasks: matchingTasks,
      verified: isVerified,
    });

    if (matchingTasks.length === 0 && tasksList.length > 0) {
      issues.push({
        severity: 'warning',
        code: 'UNMAPPED_REQUIREMENT',
        message: `Requirement ${req.id} ("${req.title}") is not mapped to any task in tasks.md`,
        file: 'requirements.md',
      });
    }
  }

  // 3. Check for phantom tasks (tasks that do not map to any requirement)
  if (reqsList.length > 0) {
    for (const task of tasksList) {
      const mapsToAny = reqsList.some((r) => taskDeclaresRequirement(task, r));
      if (!mapsToAny && task.status === 'completed') {
        issues.push({
          severity: 'info',
          code: 'PHANTOM_TASK',
          message: `Task ${task.id} ("${task.title}") has no explicit requirement mapping`,
          file: 'tasks.md',
        });
      }
    }
  }

  // 4. Ambient Code Drift Check
  let driftDetected = false;
  if (isGitRepo(cwd) && status.boundaries.length > 0) {
    const modified = getModifiedFiles(cwd);
    const boundaryList = status.boundaries.map((b) => path.normalize(b));
    // Boundaries may be files OR directories. Matching only by exact string equality made every
    // directory boundary inert — a task declaring `src/core` could never be in scope for
    // `src/core/foo.ts`, so the gate fired on everything and was noise rather than a control.
    const inScope = (file: string): boolean => {
      const normalized = path.normalize(file);
      return boundaryList.some((b) => {
        if (b === '.' || b === '' || b === path.sep) return true;
        if (normalized === b) return true;
        const prefix = b.endsWith(path.sep) ? b : `${b}${path.sep}`;
        return normalized.startsWith(prefix);
      });
    };
    for (const file of modified) {
      if (!inScope(file) && !normalizedStartsWith(file, sddDir)) {
        driftDetected = true;
        issues.push({
          severity: 'warning',
          code: 'AMBIENT_CODE_DRIFT',
          message: `File "${file}" was modified outside declared boundaries for feature "${feature}"`,
          file,
        });
      }
    }
  }

  // 5. Approvals check
  const meta = await readSpecMetadata(cwd, feature, sddDir);
  if (meta && tasksList.some((t) => t.status !== 'pending') && !status.isApproved) {
    issues.push({
      severity: 'critical',
      code: 'UNAPPROVED_IMPLEMENTATION',
      message: `Implementation started before Documentary Triad approval (Gate 0 violation)`,
      file: 'spec.json',
    });
  }

  // Compute compliance score
  const totalChecks = 4 + (reqsList.length > 0 ? reqsList.length : 1);
  const criticalCount = issues.filter((i) => i.severity === 'critical').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const deductions = criticalCount * 30 + warningCount * 10;
  const score = Math.max(0, Math.min(100, 100 - deductions));

  // 6. Regulatory Framework Checks (EU AI Act & NIST AI RMF)
  let regulatory: AuditResult['regulatory'] = undefined;
  if (options.regulatory) {
    const art11 = status.files.requirements && status.files.design && status.files.tasks;
    const art12 = isGitRepo(cwd);
    const art14 = Boolean(meta?.approvals.requirements && meta?.approvals.design);
    const nist = score >= 70 && criticalCount === 0;

    const checksPassed = [art11, art12, art14, nist].filter(Boolean).length;
    const compliancePercent = Math.round((checksPassed / 4) * 100);

    regulatory = {
      euAiActArt11: art11,
      euAiActArt12: art12,
      euAiActArt14: art14,
      nistAiRmf: nist,
      compliancePercent,
    };
  }

  // --- Gate evaluation -----------------------------------------------------
  // A spec that has been initialized but not yet worked on is not a violation:
  // it is simply early in the lifecycle. Gates judge work in flight, not intent.
  const implementationStarted = tasksList.some((t) => t.status !== 'pending');
  const specDrafted = status.files.requirements || status.files.design || status.files.tasks;

  // G2 spec contract: once implementation starts, the Triad must exist and be approved.
  const specContractOk = implementationStarted
    ? status.files.requirements && status.files.design && status.files.tasks && status.isApproved
    : true;
  // G3 verification proofs: only meaningful once there is something to prove.
  const proofsOk = !specDrafted || rtm.length === 0 ? true : rtm.every((r) => r.verified);

  const gates = evaluateGates(govSettings, {
    driftDetected,
    specContractOk,
    specContractDetail: !implementationStarted
      ? 'No implementation started yet; contract not required'
      : specContractOk
        ? 'Documentary Triad present and approved'
        : 'Implementation started before the spec was approved',
    proofsOk,
    proofsDetail: rtm.length === 0
      ? 'No requirements to verify yet'
      : proofsOk
        ? `All ${rtm.length} requirement(s) verified by completed tasks`
        : 'Requirements lack completed, traceable tasks',
  });

  // Blocking policy:
  //  - an enforced gate failure always blocks
  //  - critical issues always block
  //  - warnings block only when the profile says they should
  // Report-only profile (no enforced checks): findings are informational, never blocking.
  const reportOnly = govSettings.critical_invariants.length === 0;
  const warningsBlock = !govSettings.non_blocking_warnings && !govSettings.critical_gates_only;
  const inSync = reportOnly
    ? true
    : gatesPass(gates) && criticalCount === 0 && (!warningsBlock || warningCount === 0);

  return {
    feature,
    inSync,
    mode: effectiveMode,
    gates,
    driftDetected,
    score,
    rtm,
    issues,
    regulatory,
  };
};

export const auditAll = async (
  cwd: string,
  options: { regulatory?: boolean; sddDir?: string; mode?: GovernanceMode } = {},
): Promise<{ features: AuditResult[]; overallScore: number; projectInSync: boolean }> => {
  const sddDir = options.sddDir ?? (await resolveSddDir(cwd));
  const specs = await listSpecs(cwd, sddDir);

  if (specs.length === 0) {
    return {
      features: [],
      overallScore: 100,
      projectInSync: true,
    };
  }

  const results = await Promise.all(
    specs.map((spec) => auditFeature(cwd, spec, { ...options, sddDir })),
  );

  const totalScore = results.reduce((acc, r) => acc + r.score, 0);
  const overallScore = Math.round(totalScore / results.length);
  const projectInSync = results.every((r) => r.inSync);

  return {
    features: results,
    overallScore,
    projectInSync,
  };
};
