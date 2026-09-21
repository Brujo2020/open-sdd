/**
 * Executable checklists (REQ-RQC-005).
 *
 * An item in a spec checklist is not prose: it declares a predicate of kind `cmd`, `artifact`,
 * `property` or `trace`. `checklist verify` executes them and records a digest; a `[x]` without a
 * stored digest fails the commit gate. This is what turns "unit tests for English" into tests *of*
 * the English.
 *
 * The evidence line reuses the existing format from `core/triad.ts` (`_Evidence:`), so the evidence
 * lock that already rejects an unproven task completion rejects an unproven checklist item too.
 * There is exactly one evidence store; this module does not invent a second one.
 *
 * The module is pure: `verifyChecklist` returns the updated markdown, and the caller (the CLI)
 * writes it. Executing commands is injectable, so tests run offline and deterministically.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { checkEvidenceLock, EVIDENCE_MARKER } from './triad.js';

export type ChecklistPredicateKind = 'cmd' | 'artifact' | 'property' | 'trace';

export const CHECKLIST_PREDICATE_KINDS: readonly ChecklistPredicateKind[] = ['cmd', 'artifact', 'property', 'trace'];

export interface ChecklistPredicate {
  kind: ChecklistPredicateKind;
  value: string;
  line: number;
}

export interface ChecklistItem {
  id: string;
  title: string;
  checked: boolean;
  /** 1-based line of the item in the checklist markdown. */
  line: number;
  predicates: ChecklistPredicate[];
  /** Digest recorded by a previous `checklist verify`, read from its `_Evidence:` line. */
  digest: string | null;
}

export interface ChecklistProblem {
  itemId: string;
  line: number;
  reason: string;
}

export interface ChecklistParseResult {
  items: ChecklistItem[];
  problems: ChecklistProblem[];
}

export interface CommandOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ChecklistVerifyInput {
  markdown: string;
  cwd?: string;
  /** Artifacts a `trace` predicate resolves against. */
  artifacts?: { file: string; text: string }[];
  /** Injected command runner; defaults to `execSync` with the item's command string. */
  runCommand?: (cmd: string, cwd: string) => CommandOutcome;
  /** Resolves a `property` predicate; without one, property items cannot be verified. */
  propertyRunner?: (property: string) => { ok: boolean; detail?: string };
  readFile?: (path: string) => string | null;
  exists?: (path: string) => boolean;
  /** Injected clock for the evidence line; omitted by default so verification stays deterministic. */
  recordedAt?: string;
}

export interface PredicateOutcome {
  predicate: ChecklistPredicate;
  executed: boolean;
  ok: boolean;
  digest: string;
  detail: string;
}

export interface ChecklistItemResult {
  item: ChecklistItem;
  outcomes: PredicateOutcome[];
  /** Combined digest recorded as evidence; empty when any predicate could not be executed. */
  digest: string;
  verified: boolean;
}

export interface ChecklistFailure {
  itemId: string;
  line: number;
  reason: string;
}

export interface ChecklistVerifyResult {
  items: ChecklistItem[];
  results: ChecklistItemResult[];
  /** Blocking: a completed item without a digest, or a completed item whose predicate failed. */
  failures: ChecklistFailure[];
  /** Advisory: a recorded digest that no longer matches a fresh run. */
  stale: ChecklistFailure[];
  /** Items whose predicates all executed successfully. */
  passed: number;
  /** Items that declared at least one predicate. */
  checkedItems: number;
  /** The checklist markdown with `_Evidence:` lines recorded. */
  content: string;
  evidenceMarker: string;
}

const ITEM_RE = /^(\s*)[-*+]\s*\[( |x|X|-)\]\s*(\S+)\s*(.*)$/;
const EVIDENCE_RE = /_Evidence:\s*(.*?)_?\s*$/i;
const PREDICATE_RE = /^\s*(?:[-*+]\s*)?predicate\s*:\s*(.*)$/i;
const KIND_RE = /^(cmd|artifact|property|trace)\b\s*(?:[:—–-]|\s)\s*(.*)$/i;

const cleanValue = (value: string): string => value.replace(/^[`"']|[`"']$/g, '').trim();

const sha256 = (value: string): string => `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;

/**
 * Parse a checklist. Each item is `- [ ] CHK-001 — title` followed by indented continuation lines:
 * one `predicate:` per predicate and an optional `_Evidence:` recorded by a previous verify.
 */
export const parseChecklist = (markdown: string): ChecklistParseResult => {
  const lines = markdown.split(/\r?\n/);
  const items: ChecklistItem[] = [];
  const problems: ChecklistProblem[] = [];
  const seen = new Set<string>();
  let current: ChecklistItem | null = null;

  const flush = (): void => {
    if (!current) return;
    if (current.predicates.length === 0) {
      problems.push({
        itemId: current.id,
        line: current.line,
        reason: 'declares no predicate of kind `cmd`, `artifact`, `property` or `trace`',
      });
    }
    items.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const itemMatch = line.match(ITEM_RE);
    if (itemMatch) {
      flush();
      const id = itemMatch[3];
      if (seen.has(id)) {
        problems.push({ itemId: id, line: i + 1, reason: 'duplicate checklist item id' });
      }
      seen.add(id);
      const title = itemMatch[4].replace(/^[—–:-]\s*/, '').trim();
      current = {
        id,
        title,
        checked: itemMatch[2].toLowerCase() === 'x',
        line: i + 1,
        predicates: [],
        digest: null,
      };
      continue;
    }
    if (!current) continue;
    // Continuation lines must be indented; anything else closes the item.
    if (!/^\s+\S/.test(line)) continue;

    const evidence = line.match(EVIDENCE_RE);
    if (/_Evidence:/i.test(line) && evidence) {
      const raw = evidence[1].replace(/^[`"']|[`"']$/g, '').trim();
      current.digest = raw.length > 0 ? raw : null;
      continue;
    }
    const predicateLine = line.match(PREDICATE_RE);
    if (!predicateLine) continue;
    const body = predicateLine[1].trim();
    const kindMatch = body.match(KIND_RE);
    if (!kindMatch) {
      problems.push({
        itemId: current.id,
        line: i + 1,
        reason: `predicate \`${body}\` does not declare a kind of \`cmd\`, \`artifact\`, \`property\` or \`trace\``,
      });
      continue;
    }
    const kind = kindMatch[1].toLowerCase() as ChecklistPredicateKind;
    const value = cleanValue(kindMatch[2]);
    if (!value) {
      problems.push({ itemId: current.id, line: i + 1, reason: `predicate \`${kind}\` has no value` });
      continue;
    }
    current.predicates.push({ kind, value, line: i + 1 });
  }
  flush();
  return { items, problems };
};

const defaultRunCommand = (cmd: string, cwd: string): CommandOutcome => {
  try {
    const stdout = execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { exitCode: 0, stdout: stdout ?? '', stderr: '' };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string; message?: string };
    return {
      exitCode: typeof err.status === 'number' ? err.status : 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message ?? '',
    };
  }
};

const defaultReadFile = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

interface TraceResolution {
  ok: boolean;
  detail: string;
  digest: string;
}

/** A `trace` predicate is `REQ-… -> TEST-…`: both ids must resolve in the provided artifacts. */
export const resolveTrace = (
  value: string,
  artifacts: { file: string; text: string }[],
): TraceResolution => {
  const tokens = value.split(/->|=>|→/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length < 2 || artifacts.length === 0) {
    return { ok: false, detail: tokens.length < 2 ? 'the trace names fewer than two ids' : 'no artifacts were provided', digest: '' };
  }
  const missing = tokens.filter((token) => !artifacts.some((a) => a.text.includes(token)));
  const together = artifacts.filter((a) => tokens.every((token) => a.text.includes(token)));
  const digest = sha256(`trace:${value}\n${together.map((a) => sha256(a.text)).join('|')}`);
  if (missing.length > 0) {
    return { ok: false, detail: `the trace does not resolve: ${missing.join(', ')} is absent from every artifact`, digest };
  }
  if (together.length === 0) {
    return { ok: false, detail: 'the trace ids exist but no single artifact carries both ends', digest };
  }
  return { ok: true, detail: `resolved in ${together.map((a) => a.file).join(', ')}`, digest };
};

const runPredicates = (
  item: ChecklistItem,
  input: ChecklistVerifyInput,
): { outcomes: PredicateOutcome[]; digest: string; verified: boolean } => {
  const cwd = input.cwd ?? process.cwd();
  const runCommand = input.runCommand ?? defaultRunCommand;
  const readFile = input.readFile ?? defaultReadFile;
  const exists = input.exists ?? existsSync;
  const artifacts = input.artifacts ?? [];
  const outcomes: PredicateOutcome[] = [];

  for (const predicate of item.predicates) {
    if (predicate.kind === 'cmd') {
      const outcome = runCommand(predicate.value, cwd);
      const combined = `${outcome.stdout}\n${outcome.stderr}`.trim();
      outcomes.push({
        predicate,
        executed: true,
        ok: outcome.exitCode === 0,
        digest: sha256(`cmd:${predicate.value}\nexit:${outcome.exitCode}\noutput:${combined}`),
        detail: `exit ${outcome.exitCode}`,
      });
      continue;
    }
    if (predicate.kind === 'artifact') {
      const content = readFile(predicate.value);
      if (content === null || content === undefined) {
        const present = exists(predicate.value);
        outcomes.push({
          predicate,
          executed: false,
          ok: false,
          digest: '',
          detail: present
            ? `artifact \`${predicate.value}\` exists but could not be read`
            : `artifact \`${predicate.value}\` does not exist`,
        });
        continue;
      }
      outcomes.push({
        predicate,
        executed: true,
        ok: true,
        digest: sha256(`artifact:${predicate.value}\n${content}`),
        detail: `artifact \`${predicate.value}\` read (${content.length} characters)`,
      });
      continue;
    }
    if (predicate.kind === 'trace') {
      const resolution = resolveTrace(predicate.value, artifacts);
      outcomes.push({
        predicate,
        executed: true,
        ok: resolution.ok,
        digest: resolution.digest,
        detail: resolution.detail,
      });
      continue;
    }
    // property
    if (!input.propertyRunner) {
      outcomes.push({
        predicate,
        executed: false,
        ok: false,
        digest: '',
        detail: 'no property runner was provided, so the predicate could not be executed',
      });
      continue;
    }
    const outcome = input.propertyRunner(predicate.value);
    outcomes.push({
      predicate,
      executed: true,
      ok: outcome.ok,
      digest: sha256(`property:${predicate.value}\nok:${outcome.ok}\n${outcome.detail ?? ''}`),
      detail: outcome.detail ?? (outcome.ok ? 'property holds' : 'property does not hold'),
    });
  }

  const executed = outcomes.length > 0 && outcomes.every((o) => o.executed && o.digest !== '');
  const digest = executed ? sha256(outcomes.map((o) => o.digest).join('|')) : '';
  return { outcomes, digest, verified: executed && outcomes.every((o) => o.ok) };
};

const renderEvidence = (result: ChecklistItemResult, recordedAt?: string): string => {
  const summary = result.outcomes
    .map((o) => `${o.predicate.kind} ${o.predicate.value} (${o.detail})`)
    .join(' · ');
  const stamp = recordedAt ? ` · ${recordedAt}` : '';
  return `  - ${EVIDENCE_MARKER} ${result.digest} · ${summary}${stamp}_`;
};

/**
 * Execute every predicate and record a digest per item. Pure: the patched markdown is returned, not
 * written. A completed item without a digest is a failure; the existing evidence lock re-checks the
 * result so the two mechanisms cannot disagree.
 */
export const verifyChecklist = (input: ChecklistVerifyInput): ChecklistVerifyResult => {
  const parsed = parseChecklist(input.markdown);
  const results: ChecklistItemResult[] = [];
  const failures: ChecklistFailure[] = [];
  const stale: ChecklistFailure[] = [];

  for (const item of parsed.items) {
    const run = runPredicates(item, input);
    results.push({ item, outcomes: run.outcomes, digest: run.digest, verified: run.verified });
    if (!item.checked) continue;
    if (item.predicates.length === 0) {
      failures.push({ itemId: item.id, line: item.line, reason: 'marked complete without declaring any predicate' });
      continue;
    }
    if (run.digest === '') {
      failures.push({ itemId: item.id, line: item.line, reason: 'marked complete with no recorded digest' });
      continue;
    }
    const failing = run.outcomes.filter((o) => !o.ok);
    if (failing.length > 0) {
      failures.push({
        itemId: item.id,
        line: item.line,
        reason: `marked complete but its predicate failed: ${failing.map((o) => o.detail).join('; ')}`,
      });
      continue;
    }
    if (item.digest && item.digest !== run.digest) {
      stale.push({
        itemId: item.id,
        line: item.line,
        reason: `recorded digest \`${item.digest}\` does not match a fresh run`,
      });
    }
  }

  // Rebuild the markdown, replacing any previous `_Evidence:` line with the fresh digest.
  const resultById = new Map(results.map((r) => [r.item.id, r]));
  const itemLines = new Map(parsed.items.map((item) => [item.line - 1, item]));
  const lines = input.markdown.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const item = itemLines.get(i);
    if (!item) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    out.push(lines[i]);
    i += 1;
    const continuation: string[] = [];
    while (i < lines.length && !itemLines.has(i) && /^\s+\S/.test(lines[i])) {
      continuation.push(lines[i]);
      i += 1;
    }
    const result = resultById.get(item.id);
    const kept = continuation.filter((line) => !/_Evidence:/i.test(line));
    if (result && result.digest !== '') kept.push(renderEvidence(result, input.recordedAt));
    out.push(...kept);
  }
  const content = out.join('\n');

  // The existing evidence lock is the authority on "complete without evidence"; map its verdict.
  const lock = checkEvidenceLock(content);
  for (const unproven of lock.unprovenCompletions) {
    if (!failures.some((f) => f.itemId === unproven.taskId)) {
      failures.push({ itemId: unproven.taskId, line: 0, reason: 'completed without a recorded digest' });
    }
  }

  const checkedItems = results.filter((r) => r.item.predicates.length > 0).length;
  const passed = results.filter((r) => r.verified).length;

  return {
    items: parsed.items,
    results,
    failures,
    stale,
    passed,
    checkedItems,
    content,
    evidenceMarker: EVIDENCE_MARKER,
  };
};

/** One line per item, for the human surface. Never says the spec is correct. */
export const renderChecklistReport = (result: ChecklistVerifyResult): string => {
  const lines: string[] = [];
  lines.push(
    `${result.items.length} item(s) · ${result.checkedItems} with a predicate · ${result.passed} verified · ${result.failures.length} fail · ${result.stale.length} stale`,
  );
  for (const failure of result.failures) lines.push(`fail  ${failure.itemId} line ${failure.line}: ${failure.reason}`);
  for (const item of result.stale) lines.push(`stale ${item.itemId} line ${item.line}: ${item.reason}`);
  return lines.join('\n');
};
