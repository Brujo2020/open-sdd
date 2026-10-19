/**
 * Claims-registry runner (§9.6).
 *
 * The paper's registry pairs every published sentence with a COMMAND whose exit code decides the
 * verdict, and it reports five states per claim. A registry that exists but is never executed
 * proves nothing beyond intent, so this module parses `docs/claims/paper-claims.yaml` and runs
 * every verifier.
 *
 * It deliberately does not depend on a YAML library: the registry uses a small, fixed subset
 * (a top-level list of mappings with scalar string values), and the parser below accepts exactly
 * that subset — including the block-comment header — and reports the entries it could not read
 * instead of silently skipping them.
 */

import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { assessClaims, type Claim, type ClaimRun, type ClaimsReport } from './claims.js';

export interface RegistryParseResult {
  claims: Claim[];
  /** Lines that looked like entries but were incomplete — reported, never dropped silently. */
  rejected: { id: string; reason: string }[];
}

/**
 * Unquote a YAML scalar.
 *
 * The quote style matters and getting it wrong is silent: in a SINGLE-quoted scalar only `''` is
 * an escape and backslashes are literal, while in a DOUBLE-quoted scalar backslash escapes apply.
 * Treating backslashes as escapes inside single quotes rewrote `\"` to `"` inside the verifier
 * commands and broke their shell quoting, which made seventeen working controls look broken.
 */
const unquote = (value: string): string => {
  const s = value.trim();
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    // Single left-to-right pass. Replacing the escape sequences in sequence is wrong: it turns
    // \\n into a backslash followed by a real newline, splitting the command across lines.
    return s.slice(1, -1).replace(/\\(.)/g, (_match, ch: string) => {
      if (ch === 'n') return '\n';
      if (ch === 't') return '\t';
      if (ch === '"') return '"';
      if (ch === '\\') return '\\';
      return ch;
    });
  }
  return s;
};

const EXPECTATIONS = new Set(['pass', 'fail', 'absent']);

/**
 * Parse the registry's YAML subset. The format is a list of mappings; each entry needs `id`,
 * `verifier` and `expectation`, plus the descriptive fields.
 */
export const parseClaimsRegistry = (raw: string): RegistryParseResult => {
  const claims: Claim[] = [];
  const rejected: { id: string; reason: string }[] = [];
  let current: Partial<Claim> | null = null;
  let currentId = '';

  const flush = (): void => {
    if (!current) return;
    const id = currentId || '(sin id)';
    if (!current.id || !current.verifier || !current.expectation) {
      rejected.push({ id, reason: 'faltan campos obligatorios (id, verifier o expectation)' });
    } else if (!EXPECTATIONS.has(current.expectation)) {
      rejected.push({
        id,
        reason: `expectation inválida "${current.expectation}": debe ser pass, fail o absent`,
      });
    } else {
      claims.push({
        id: current.id,
        section: current.section ?? '—',
        statementEs: current.statementEs ?? '',
        statementEn: current.statementEn ?? '',
        verifier: current.verifier,
        expectation: current.expectation as Claim['expectation'],
      });
    }
    current = null;
  };

  for (const line of raw.split(/\r?\n/)) {
    // Comments and blank lines carry no structure.
    if (/^\s*#/.test(line) || line.trim().length === 0) continue;

    const entryStart = line.match(/^\s*-\s*id:\s*(.+)$/);
    if (entryStart) {
      flush();
      currentId = unquote(entryStart[1]);
      current = { id: currentId };
      continue;
    }

    if (!current) continue;

    const kv = line.match(/^\s*(section|statement_es|statement_en|verifier|expectation):\s*(.+)$/);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    const value = unquote(rawValue);

    if (key === 'section') current.section = value;
    else if (key === 'statement_es') current.statementEs = value;
    else if (key === 'statement_en') current.statementEn = value;
    else if (key === 'verifier') current.verifier = value;
    else if (key === 'expectation') current.expectation = value as Claim['expectation'];
  }
  flush();

  return { claims, rejected };
};

export interface RegistryRunOptions {
  cwd: string;
  /** Per-verifier timeout. A hung verifier must not hang the whole audit. */
  timeoutMs?: number;
}

/** Exit code used when a verifier exceeds its timeout. */
export const TIMEOUT_EXIT_CODE = 124;

export interface RegistryRunResult {
  report: ClaimsReport;
  runs: ClaimRun[];
  rejected: { id: string; reason: string }[];
  /** Verifiers that timed out, reported separately from honest failures. */
  timedOut: string[];
}

const runVerifier = (
  verifier: string,
  cwd: string,
  timeoutMs: number,
): { exitCode: number; timedOut: boolean } => {
  // NOT a login shell (`-lc`): a login shell sources the user's profile, which can change the
  // working directory, and every verifier in the registry resolves repo-relative paths. Using
  // `-lc` made perfectly good verifiers fail and reported 17 working controls as broken.
  const result = spawnSync('bash', ['-c', verifier], {
    cwd,
    timeout: timeoutMs,
    encoding: 'utf8',
  });
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
    return { exitCode: TIMEOUT_EXIT_CODE, timedOut: true };
  }
  if (typeof result.status === 'number') return { exitCode: result.status, timedOut: false };
  // Killed by a signal or otherwise unresolved: not a pass.
  return { exitCode: result.signal ? 137 : 1, timedOut: false };
};

/** Execute every verifier from the repository root and decide each claim by exit code. */
export const runClaimsRegistry = async (
  raw: string,
  options: RegistryRunOptions,
): Promise<RegistryRunResult> => {
  const { claims, rejected } = parseClaimsRegistry(raw);
  const timeoutMs = options.timeoutMs ?? 60_000;
  const runs: ClaimRun[] = [];
  const timedOut: string[] = [];

  for (const claim of claims) {
    const { exitCode, timedOut: to } = runVerifier(claim.verifier, options.cwd, timeoutMs);
    if (to) timedOut.push(claim.id);
    runs.push({ claimId: claim.id, exitCode });
  }

  return {
    report: assessClaims(claims, runs),
    runs,
    rejected,
    timedOut,
  };
};

export const readClaimsRegistry = async (cwd: string, relPath = 'docs/claims/paper-claims.yaml'): Promise<string> =>
  readFile(path.join(cwd, relPath), 'utf8');

/** Human-readable one-line verdict per claim, for CLI output. */
export const renderClaimLines = (
  result: RegistryRunResult,
  statements: Map<string, string>,
): string[] =>
  result.report.results.map(({ claim, status }) => {
    const label = statements.get(claim.id) ?? claim.statementEn;
    return `${claim.id.padEnd(10)} ${status.padEnd(16)} ${label.slice(0, 90)}`;
  });
