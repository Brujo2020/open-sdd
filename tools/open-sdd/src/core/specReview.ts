/**
 * One review surface for a change (REQ-RQC-009).
 *
 * `review <feature> --base <ref>` renders the added, modified and removed requirements as word-level
 * diffs on a single page; each row carries its covering tasks, the tests that would fail if it
 * changed, and a risk score. It exits non-zero when a requirement changed without approval.
 *
 * The contracts oracle is another workstream: this module *accepts* the tests that would fail as
 * input (`contracts`) and does not implement the oracle. `baseArtifacts` and `approvals` are inputs
 * too, so the module stays pure, offline and deterministic — the CLI reads them from git and from
 * `spec.json`.
 *
 * The page reports changes, coverage and risk. It never states that a specification is correct.
 */

import type { StandardEntry, StandardRunner } from './standardsTypes.js';
import { parseTasksMarkdown } from './specManager.js';
import {
  classifyArtifact,
  countByCheck,
  parseRequirements,
  reviewRequirements,
  type CoachFinding,
} from './requirementsCoach.js';

export interface SpecReviewArtifact {
  file: string;
  text: string;
}

export interface SpecContractTest {
  id: string;
  file?: string;
  /** Requirement ids this test would protect. */
  covers?: string[];
  /** Single-requirement shorthand. */
  requirementId?: string;
  /** Defaults to true: a listed contract test is assumed to fail if its requirement changes. */
  wouldFail?: boolean;
}

export interface SpecContractInput {
  tests: SpecContractTest[];
}

export interface SpecApprovalState {
  approved: boolean;
  approvedBy?: string;
  approvedAt?: string;
  ref?: string;
  /** When present, only these requirement ids are approved; the rest are unapproved changes. */
  approvedIds?: string[];
}

export interface SpecReviewInput {
  feature: string;
  base: string;
  artifacts: SpecReviewArtifact[];
  contracts: SpecContractInput;
  runner: StandardRunner;
  entries: StandardEntry[];
  /** The artifacts as they were at `base`; when omitted, every current requirement reads as added. */
  baseArtifacts?: SpecReviewArtifact[];
  /** The approval state, accepted as input (the CLI reads it from `spec.json`). */
  approvals?: SpecApprovalState;
}

export type RequirementChange = 'added' | 'modified' | 'removed';

export interface DiffSegment {
  op: 'equal' | 'add' | 'remove';
  text: string;
}

export interface RequirementReviewRow {
  id: string;
  change: RequirementChange;
  statement: string;
  previous?: string;
  diff: DiffSegment[];
  tasks: string[];
  failingTests: string[];
  /** 0–100; higher means more uncertainty or blast radius. */
  risk: number;
  riskFactors: string[];
  approved: boolean;
}

export interface SpecReviewResult {
  feature: string;
  base: string;
  rows: RequirementReviewRow[];
  summary: {
    added: number;
    modified: number;
    removed: number;
    unchanged: number;
    failingTests: number;
    risk: number;
  };
  unapprovedChanges: RequirementReviewRow[];
  exitCode: number;
  findings: CoachFinding[];
  findingsByCheck: Record<string, number>;
  detail: string;
}

const MAX_DIFF_TOKENS = 900;

/** Word-level diff over a statement. Whitespace is a token, so the result renders as readable prose. */
export const wordDiff = (before: string, after: string): DiffSegment[] => {
  const a = before.match(/\s+|\S+/g) ?? [];
  const b = after.match(/\s+|\S+/g) ?? [];
  const segments: DiffSegment[] = [];
  const push = (op: DiffSegment['op'], text: string): void => {
    const last = segments[segments.length - 1];
    if (last && last.op === op) last.text += text;
    else segments.push({ op, text });
  };

  if (a.length > MAX_DIFF_TOKENS || b.length > MAX_DIFF_TOKENS) {
    if (before.trim()) push('remove', before);
    if (after.trim()) push('add', after);
    return segments.filter((s) => s.text.length > 0);
  }

  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('equal', a[i]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('remove', a[i]);
      i += 1;
    } else {
      push('add', b[j]);
      j += 1;
    }
  }
  while (i < n) {
    push('remove', a[i]);
    i += 1;
  }
  while (j < m) {
    push('add', b[j]);
    j += 1;
  }
  return segments;
};

/** Render a diff for a terminal or a markdown page: `[-removed-]` and `{+added+}`. */
export const renderWordDiff = (diff: DiffSegment[]): string =>
  diff
    .map((segment) => {
      if (segment.op === 'remove') return `[-${segment.text.trim()}-]`;
      if (segment.op === 'add') return `{+${segment.text.trim()}+}`;
      return segment.text;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

const requirementMap = (artifacts: SpecReviewArtifact[]): Map<string, { text: string; line: number; endLine: number; file: string }> => {
  const map = new Map<string, { text: string; line: number; endLine: number; file: string }>();
  for (const artifact of artifacts) {
    if (classifyArtifact(artifact.file) !== 'requirements') continue;
    for (const parsed of parseRequirements(artifact.file, artifact.text)) {
      const existing = map.get(parsed.id);
      if (existing) {
        existing.text = `${existing.text} ${parsed.text}`.trim();
        existing.endLine = Math.max(existing.endLine, parsed.endLine);
        continue;
      }
      map.set(parsed.id, { text: parsed.text, line: parsed.line, endLine: parsed.endLine, file: artifact.file });
    }
  }
  return map;
};

const coveringTasks = (artifacts: SpecReviewArtifact[], requirementId: string): string[] => {
  const out: string[] = [];
  for (const artifact of artifacts) {
    if (classifyArtifact(artifact.file) !== 'tasks') continue;
    for (const task of parseTasksMarkdown(artifact.text)) {
      if (!task.raw.includes(requirementId)) continue;
      const label = `${task.id} — ${task.title.replace(/[_*`]/g, '').slice(0, 80)}`;
      if (!out.includes(label)) out.push(label);
    }
  }
  return out.slice(0, 8);
};

const failingTestsFor = (contracts: SpecContractInput, requirementId: string): string[] => {
  const out: string[] = [];
  for (const test of contracts.tests) {
    const covers = test.covers ?? (test.requirementId ? [test.requirementId] : []);
    if (!covers.includes(requirementId)) continue;
    if (test.wouldFail === false) continue;
    out.push(`${test.id}${test.file ? ` (${test.file})` : ''}`);
  }
  return out;
};

const findingsInRange = (
  findings: CoachFinding[],
  file: string,
  line: number,
  endLine: number,
): CoachFinding[] => findings.filter((f) => f.file === file && f.line >= line && f.line <= endLine);

const clampRisk = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

/**
 * Score a change deterministically. Every addend names its reason, so a risk number can be argued
 * with instead of trusted.
 */
const scoreRisk = (row: {
  change: RequirementChange;
  findings: CoachFinding[];
  taskCount: number;
  failingCount: number;
  approved: boolean;
}): { risk: number; factors: string[] } => {
  let risk = 10;
  const factors: string[] = [];

  if (row.change === 'removed') {
    risk += 30;
    factors.push('+30 requirement removed');
  } else if (row.change === 'modified') {
    risk += 18;
    factors.push('+18 statement modified');
  } else {
    risk += 8;
    factors.push('+8 new requirement');
  }

  const errors = row.findings.filter((f) => f.severity === 'error').length;
  const warnings = row.findings.filter((f) => f.severity === 'warning').length;
  const infos = row.findings.filter((f) => f.severity === 'info').length;
  if (errors > 0) {
    const add = Math.min(30, errors * 15);
    risk += add;
    factors.push(`+${add} ${errors} blocking finding(s) in this requirement`);
  }
  if (warnings > 0) {
    const add = Math.min(18, warnings * 6);
    risk += add;
    factors.push(`+${add} ${warnings} warning finding(s) in this requirement`);
  }
  if (infos > 0) {
    const add = Math.min(6, infos * 2);
    risk += add;
    factors.push(`+${add} advisory finding(s) in this requirement`);
  }
  if (row.failingCount > 0) {
    const add = Math.min(25, row.failingCount * 5);
    risk += add;
    factors.push(`+${add} ${row.failingCount} test(s) would fail`);
  }
  if (row.taskCount === 0) {
    risk += 8;
    factors.push('+8 no covering task');
  } else {
    risk -= 6;
    factors.push('-6 covered by a task');
  }
  if (!row.approved) {
    risk += 10;
    factors.push('+10 changed without approval');
  }
  return { risk: clampRisk(risk), factors };
};

/**
 * Produce the one-page review. Pure: git, the contracts oracle and the approval state are inputs.
 */
export const reviewSpec = (input: SpecReviewInput): SpecReviewResult => {
  const current = requirementMap(input.artifacts);
  const base = requirementMap(input.baseArtifacts ?? []);
  const approvals: SpecApprovalState = input.approvals ?? { approved: false };
  const coachReport = reviewRequirements({
    feature: input.feature,
    artifacts: input.artifacts,
    entries: input.entries,
    runner: input.runner,
  });

  const rows: RequirementReviewRow[] = [];
  let unchanged = 0;
  let failingTests = 0;

  const isApproved = (id: string): boolean =>
    approvals.approved === true && (!approvals.approvedIds || approvals.approvedIds.includes(id));

  const buildRow = (id: string, change: RequirementChange, statement: string, previous?: string): void => {
    const currentMeta = current.get(id);
    const baseMeta = base.get(id);
    const file = currentMeta?.file ?? baseMeta?.file ?? 'requirements.md';
    const line = currentMeta?.line ?? baseMeta?.line ?? 0;
    const endLine = currentMeta?.endLine ?? baseMeta?.endLine ?? line;
    const taskList = coveringTasks(input.artifacts, id);
    const tests = failingTestsFor(input.contracts, id);
    const rowFindings = change === 'removed' ? [] : findingsInRange(coachReport.findings, file, line, endLine);
    const approved = isApproved(id);
    const { risk, factors } = scoreRisk({
      change,
      findings: rowFindings,
      taskCount: taskList.length,
      failingCount: tests.length,
      approved,
    });
    failingTests += tests.length;
    rows.push({
      id,
      change,
      statement,
      ...(previous !== undefined ? { previous } : {}),
      diff: previous !== undefined ? wordDiff(previous, statement) : [{ op: 'add', text: statement }],
      tasks: taskList,
      failingTests: tests,
      risk,
      riskFactors: factors,
      approved,
    });
  };

  for (const [id, meta] of current) {
    const previous = base.get(id);
    if (!previous) {
      buildRow(id, 'added', meta.text);
      continue;
    }
    if (previous.text.trim() === meta.text.trim()) {
      unchanged += 1;
      continue;
    }
    buildRow(id, 'modified', meta.text, previous.text);
  }
  for (const [id, meta] of base) {
    if (current.has(id)) continue;
    buildRow(id, 'removed', meta.text);
  }

  rows.sort((a, b) => a.change.localeCompare(b.change) || a.id.localeCompare(b.id));

  const unapprovedChanges = rows.filter((row) => !row.approved);
  const overallRisk = rows.length === 0 ? 0 : clampRisk(rows.reduce((sum, r) => sum + r.risk, 0) / rows.length);
  const summary = {
    added: rows.filter((r) => r.change === 'added').length,
    modified: rows.filter((r) => r.change === 'modified').length,
    removed: rows.filter((r) => r.change === 'removed').length,
    unchanged,
    failingTests,
    risk: overallRisk,
  };

  return {
    feature: input.feature,
    base: input.base,
    rows,
    summary,
    unapprovedChanges,
    exitCode: unapprovedChanges.length > 0 ? 1 : 0,
    findings: coachReport.findings,
    findingsByCheck: countByCheck(coachReport.findings),
    detail: `${summary.added} added, ${summary.modified} modified, ${summary.removed} removed, ${summary.unchanged} unchanged · risk ${overallRisk}/100 · ${unapprovedChanges.length} unapproved change(s) · ${summary.failingTests} test(s) would fail · this reports changes and coverage, not correctness`,
  };
};

/** Render the one page. Markdown, so it can be pasted into a PR comment unchanged. */
export const renderSpecReview = (result: SpecReviewResult): string => {
  const lines: string[] = [];
  lines.push(`# Review · ${result.feature} · base \`${result.base}\``);
  lines.push('');
  lines.push(result.detail);
  lines.push('');
  if (result.rows.length === 0) {
    lines.push('No requirement was added, modified or removed against this base.');
  }
  for (const row of result.rows) {
    const verb = row.change === 'added' ? 'ADDED' : row.change === 'modified' ? 'MODIFIED' : 'REMOVED';
    lines.push(`## ${verb} · ${row.id} · risk ${row.risk}/100${row.approved ? '' : ' · UNAPPROVED'}`);
    lines.push('');
    lines.push(`- diff: ${renderWordDiff(row.diff) || '(no textual change)'}`);
    lines.push(`- tasks: ${row.tasks.length > 0 ? row.tasks.join('; ') : 'none'}`);
    lines.push(`- tests that would fail: ${row.failingTests.length > 0 ? row.failingTests.join('; ') : 'none declared'}`);
    lines.push(`- risk: ${row.risk}/100 (${row.riskFactors.join(', ')})`);
    lines.push('');
  }
  lines.push('This page reports the changes, their coverage and their risk; it does not certify the specification.');
  return lines.join('\n');
};
