/**
 * `test/cliGatesArgs.test.ts` — the argv contract of `gates run`.
 *
 * This suite exists because of a defect that made a security control silently not run: the handler
 * built its gate list with `args.slice(1).filter(a => !a.startsWith('-'))`, so the VALUE of a
 * value flag became a gate id. `gates run --base main` therefore resolved the chain to a single
 * pseudo-control called `main`, which the runner self-authorized, and the command printed
 * "La cadena pasa" and exit 0 while C1/C2/C3 never executed. `.github/workflows/gates.yml` calls
 * exactly `gates run --base "$BASE"`, so the CI job reported a pass it never measured.
 *
 * What is pinned here:
 *   1. `--base <ref>` and `--base=<ref>` both keep the ref as a ref and run the REAL chain
 *      (7 controls for `solo`, with C1/C2/C3 among them) — and the diff the ref names is the diff
 *      the chain judges: a committed AWS key on the change makes C2 FAIL.
 *   2. A token that is neither a known flag nor a catalog id is an error that names it and exits
 *      non-zero, instead of becoming a self-authorized pseudo-control.
 *   3. A value flag without a value or with an unknown value fails closed; an unknown flag does
 *      not swallow the token after it.
 *   4. The pre-existing correct forms are unchanged: a bare `gates run` is still 7 controls, and
 *      the hook's `gates run C1 C2 C3 --staged --strict` still runs exactly those three.
 *
 * All fixtures live in `os.tmpdir()` and are removed in `afterEach`; nothing is written inside this
 * repository.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli } from '../src/index.js';

// A real `git init` + commits under the full suite's contention needs more than the default.
vi.setConfig({ testTimeout: 60_000 });

const runtime = { platform: 'darwin' as NodeJS.Platform, env: {} };

const temps: string[] = [];

afterEach(async () => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

const makeIO = () => {
  const logs: string[] = [];
  const errs: string[] = [];
  return {
    io: {
      log: (message: string) => logs.push(message),
      error: (message: string) => errs.push(message),
      exit: () => undefined,
    },
    get logs() {
      return logs;
    },
    get errs() {
      return errs;
    },
    text: () => `${logs.join('\n')}\n${errs.join('\n')}`,
  };
};

const write = async (root: string, rel: string, content: string): Promise<void> => {
  const target = path.join(root, rel);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
};

const git = (cwd: string, args: string[]): void => {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
};

/** A minimal valid triad, so C1/C3 judge a real repository instead of an empty one. */
const seedSpec = async (root: string): Promise<void> => {
  await write(root, '.sdd/specs/payments/requirements.md', '# Requirements — payments\n\nREQ-PAY-001 The payments system SHALL record every refund.\n');
  await write(root, '.sdd/specs/payments/plan.md', '# Plan — payments\n\nRefunds are compensating ledger entries.\n');
  await write(root, '.sdd/specs/payments/tasks.md', '# Tasks — payments\n\n- [ ] T1 Implement the refund endpoint\n');
};

/**
 * A real git repository whose `feature` branch commits one AWS example key that `main` does not
 * have. The old parser was invisible on `main...HEAD` with zero changed files; this fixture makes
 * the difference between "the diff ran" and "the chain was replaced by a pseudo-control" observable.
 */
const makeChangeRepo = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'sdd-gates-args-'));
  temps.push(root);
  await seedSpec(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'gate@open-sdd.test']);
  git(root, ['config', 'user.name', 'open-sdd gate']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'base']);
  // `git init`'s default branch is not assumed: rename whatever it created to `main`.
  git(root, ['branch', '-m', 'main']);
  git(root, ['checkout', '-q', '-b', 'feature']);
  await write(root, 'leak.txt', 'aws_access_key_id = "AKIAIOSFODNN7EXAMPLE"\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'leak']);
  return root;
};

const gateIds = (text: string): string[] =>
  Array.from(text.matchAll(/^ {2}([CO]\d)\s{2,}/gm)).map((match) => match[1]);

const controlCount = (text: string): number => {
  const match = text.match(/\((\d+) control\(es\)/);
  return match ? Number(match[1]) : -1;
};

const run = async (argv: string[], cwd: string) => {
  const ctx = makeIO();
  const code = await runCli(argv, runtime, ctx.io, {}, { cwd });
  return { code, out: ctx.text(), logs: ctx.logs, errs: ctx.errs };
};

describe('cli `gates run` — a value flag is never a positional gate id', () => {
  it('`--base <ref>` runs the real chain against the ref', async () => {
    const cwd = await makeChangeRepo();
    const { code, out } = await run(['gates', 'run', '--base', 'main'], cwd);

    expect(controlCount(out)).toBe(7);
    expect(gateIds(out)).toEqual(expect.arrayContaining(['C1', 'C2', 'C3']));
    expect(out).toContain('modo: diff contra main, 1 fichero(s)');
    // The AWS example key is on the change, so C2 must fail: the diff was judged, not skipped.
    expect(out).toMatch(/C2\s+Security Baseline\s+fail/);
    expect(out).toContain('La cadena NO pasa');
    expect(code).toBe(1);
    // The old defect: a pseudo-control called `main`, self-authorized, with the chain reported as passing.
    expect(out).not.toContain('Auto-autorizados por sensor no disponible: main');
    expect(out).not.toMatch(/main\s+self-authorized/);
  });

  it('`--base=<ref>` is the same flag in the other spelling', async () => {
    const cwd = await makeChangeRepo();
    const { code, out } = await run(['gates', 'run', '--base=main'], cwd);

    expect(controlCount(out)).toBe(7);
    expect(gateIds(out)).toEqual(expect.arrayContaining(['C1', 'C2', 'C3']));
    expect(out).toContain('modo: diff contra main, 1 fichero(s)');
    expect(out).toMatch(/C2\s+Security Baseline\s+fail/);
    expect(code).toBe(1);
  });

  it('`--base=<ref>` coexists with explicit gate ids instead of consuming them', async () => {
    const cwd = await makeChangeRepo();
    const { out } = await run(['gates', 'run', '--base=main', 'C1', 'C2'], cwd);

    expect(controlCount(out)).toBe(2);
    expect(gateIds(out)).toEqual(['C1', 'C2']);
    expect(out).toContain('modo: diff contra main, 1 fichero(s)');
  });

  it('`--profile <name>` is not a gate id either', async () => {
    const cwd = await makeChangeRepo();
    const { out } = await run(['gates', 'run', '--profile', 'team'], cwd);

    expect(controlCount(out)).toBe(9);
    expect(out).toContain('perfil team');
    // The old defect resolved the chain to one control named `team`.
    expect(out).not.toMatch(/team\s+self-authorized/);
    expect(out).not.toContain('Auto-autorizados por sensor no disponible: team');
  });

  it('a bare `gates run` is unchanged: the 7 resolvable controls', async () => {
    const cwd = await makeChangeRepo();
    const { out } = await run(['gates', 'run'], cwd);

    expect(controlCount(out)).toBe(7);
    expect(gateIds(out)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']);
    expect(out).toContain('modo: controles independientes del diff');
  });

  it('the commit hook form still runs exactly C1/C2/C3 over the index', async () => {
    const cwd = await makeChangeRepo();
    const { out } = await run(['gates', 'run', 'C1', 'C2', 'C3', '--staged', '--strict'], cwd);

    expect(controlCount(out)).toBe(3);
    expect(gateIds(out)).toEqual(['C1', 'C2', 'C3']);
    expect(out).toContain('modo: índice (staged)');
  });
});

describe('cli `gates run` — fail closed on an argument it cannot classify', () => {
  it('names an unrecognised gate id and exits non-zero', async () => {
    const cwd = await makeChangeRepo();
    const { code, out, errs } = await run(['gates', 'run', 'main'], cwd);

    expect(code).toBe(1);
    expect(errs.join('\n')).toContain('Control(es) no reconocido(s): main');
    // The bogus id must not have been handed to the runner as a self-authorized control.
    expect(out).not.toContain('Ejecutando la cadena resuelta');
    expect(out).not.toContain('La cadena pasa');
  });

  it('names several unrecognised gate ids at once', async () => {
    const cwd = await makeChangeRepo();
    const { code, errs } = await run(['gates', 'run', 'C1', 'main', 'develop'], cwd);

    expect(code).toBe(1);
    expect(errs.join('\n')).toContain('main, develop');
  });

  it('an unknown flag is an error and does not swallow the token after it', async () => {
    const cwd = await makeChangeRepo();
    const { code, out, errs } = await run(['gates', 'run', '--nope', 'C1'], cwd);

    expect(code).toBe(1);
    expect(errs.join('\n')).toContain('Opción desconocida: --nope');
    expect(out).not.toContain('Ejecutando la cadena resuelta');
  });

  it('a value flag with no value fails closed instead of defaulting', async () => {
    const cwd = await makeChangeRepo();
    const { code, out, errs } = await run(['gates', 'run', '--base'], cwd);

    expect(code).toBe(1);
    expect(errs.join('\n')).toContain('--base exige un valor');
    expect(out).not.toContain('Ejecutando la cadena resuelta');
  });

  it('a value flag followed by another flag fails closed instead of taking it as a value', async () => {
    const cwd = await makeChangeRepo();
    const { code, errs } = await run(['gates', 'run', '--base', '--staged'], cwd);

    expect(code).toBe(1);
    expect(errs.join('\n')).toContain('--base exige un valor');
  });

  it('an unknown profile value fails closed instead of silently running the solo chain', async () => {
    const cwd = await makeChangeRepo();
    const { code, out, errs } = await run(['gates', 'run', '--profile', 'enterprise'], cwd);

    expect(code).toBe(1);
    expect(errs.join('\n')).toContain('Perfil desconocido: "enterprise"');
    expect(out).not.toContain('Ejecutando la cadena resuelta');
  });

  it('a base ref that does not resolve fails closed instead of diffing nothing and passing', async () => {
    const cwd = await makeChangeRepo();
    const { code, out, errs } = await run(['gates', 'run', '--base', 'no-such-ref'], cwd);

    expect(code).toBe(1);
    expect(errs.join('\n')).toContain('La referencia base "no-such-ref" no existe');
    expect(out).not.toContain('La cadena pasa');
  });
});
