/**
 * QA support — the shared scaffolding the five tiers stand on.
 *
 * Every tier was re-declaring the same four things (a review harness, a temp repo, a CLI IO recorder
 * and a git commit). Duplicating them was not just noise: it meant a change to the artifact shape had
 * to be made five times, and any tier that lagged behind would keep testing an older world. This
 * module owns them once; the tiers import.
 *
 * It is deliberately framework-free (no vitest import): a helper that registers its own hooks would
 * make the cleanup invisible at the call site. Each tier calls `afterEach(cleanupTempRepos)`.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewRequirements, type CoachFinding } from '../src/core/requirementsCoach.js';
import type { CliIO } from '../src/cli/io.js';

/** The repository root, resolved from this file, so a test never depends on the cwd it was launched in. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The platform the CLI tests declare; the runtime object `runCli` expects. */
export const CLI_RUNTIME = { platform: 'darwin' } as const;

/** The artifact a coach review is pointed at. */
export const REQ_FILE = '.sdd/specs/f/requirements.md';

export interface CoachReview {
  findings: CoachFinding[];
  checked: number;
  skipped: string[];
}

/**
 * The one review harness: the deterministic core, with the catalogue empty and the model runner a
 * stub, so a case tests the coach and not the catalogue or a model.
 */
export const coachReview = (text: string, extra: { file: string; text: string }[] = []): CoachReview =>
  reviewRequirements({
    feature: 'f',
    artifacts: [{ file: REQ_FILE, text }, ...extra],
    entries: [],
    runner: () => [],
  }) as CoachReview;

/** `- <line>` bullets under a `# Requirements` heading. */
export const requirements = (...lines: string[]): string => ['# Requirements', '', ...lines, ''].join('\n');

/** The same, for a raw block of lines (used by the horde). */
export const requirementsBlock = (lines: string[]): string => requirements(...lines);

// ── Temp repositories ───────────────────────────────────────────────────────────────────────────
const tempDirs: string[] = [];

/**
 * A temp repository. `git: true` initialises one with an identity, which the id and drift-audit
 * tiers need; everything else is a plain directory.
 */
export const makeTempRepo = async (options: { git?: boolean } = {}): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-qa-'));
  tempDirs.push(dir);
  if (options.git) {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'gate@open-sdd.test'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'gate'], { cwd: dir });
  }
  return dir;
};

/** Register this once per test file: `afterEach(cleanupTempRepos)`. */
export const cleanupTempRepos = async (): Promise<void> => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
};

/** Write a file, creating its directories. */
export const writeIn = async (cwd: string, rel: string, content: string): Promise<void> => {
  const abs = path.join(cwd, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
};

/** Stage everything and commit, for the tiers that need a real base revision. */
export const gitCommit = (cwd: string, message: string): void => {
  execFileSync('git', ['add', '-A'], { cwd });
  execFileSync('git', ['commit', '-qm', message], { cwd });
};

// ── CLI IO ──────────────────────────────────────────────────────────────────────────────────────
export interface CliHarness {
  io: CliIO;
  logs: string[];
  errs: string[];
  out: () => string;
  err: () => string;
}

/** A recorder that satisfies `CliIO` and never exits the process. */
export const makeCliHarness = (): CliHarness => {
  const logs: string[] = [];
  const errs: string[] = [];
  return {
    io: {
      log: (msg: string) => logs.push(msg),
      error: (msg: string) => errs.push(msg),
      exit: () => undefined,
    },
    logs,
    errs,
    out: () => logs.join('\n'),
    err: () => errs.join('\n'),
  };
};
