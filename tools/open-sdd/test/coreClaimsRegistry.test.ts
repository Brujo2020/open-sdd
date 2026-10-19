import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseClaimsRegistry,
  runClaimsRegistry,
  readClaimsRegistry,
  TIMEOUT_EXIT_CODE,
} from '../src/core/claimsRegistry.js';

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'open-sdd-claims-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const registry = (body: string): string => `# header comment\n\n${body}`;

describe('core/claimsRegistry — parsing', () => {
  it('parses a well-formed entry', () => {
    const { claims, rejected } = parseClaimsRegistry(
      registry(
        `- id: CLM-001
  section: "§9.3"
  statement_es: 'Una afirmación.'
  statement_en: 'A claim.'
  verifier: 'true'
  expectation: pass
`,
      ),
    );

    expect(rejected).toEqual([]);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toEqual({
      id: 'CLM-001',
      section: '§9.3',
      statementEs: 'Una afirmación.',
      statementEn: 'A claim.',
      verifier: 'true',
      expectation: 'pass',
    });
  });

  it('parses several entries and ignores comments and blank lines', () => {
    const { claims } = parseClaimsRegistry(
      registry(
        `# a comment
- id: A
  verifier: 'true'
  expectation: pass

# another comment
- id: B
  verifier: 'false'
  expectation: fail
`,
      ),
    );

    expect(claims.map((c) => c.id)).toEqual(['A', 'B']);
  });

  it('preserves backslashes inside single-quoted scalars (YAML does not escape them)', () => {
    // The verifiers embed escaped quotes for the shell. Treating `\"` as an escape here rewrote
    // the command and broke its quoting, which is how working controls were once reported broken.
    const { claims } = parseClaimsRegistry(
      registry(
        `- id: CLM-002
  verifier: 'node -e "import {x} from \\"./dist/x.js\\""'
  expectation: pass
`,
      ),
    );

    expect(claims[0].verifier).toBe('node -e "import {x} from \\"./dist/x.js\\""');
  });

  it('collapses the doubled single quote inside single-quoted scalars', () => {
    const { claims } = parseClaimsRegistry(
      registry(
        `- id: CLM-003
  statement_en: 'The check''s output is captured.'
  verifier: 'true'
  expectation: pass
`,
      ),
    );

    expect(claims[0].statementEn).toBe("The check's output is captured.");
  });

  it('processes backslash escapes inside double-quoted scalars', () => {
    const { claims } = parseClaimsRegistry(
      registry(
        `- id: CLM-004
  statement_en: "line one\\nline two"
  verifier: 'true'
  expectation: pass
`,
      ),
    );

    expect(claims[0].statementEn).toBe('line one\nline two');
  });

  it('rejects an entry missing a verifier or an expectation instead of dropping it silently', () => {
    const { claims, rejected } = parseClaimsRegistry(
      registry(
        `- id: CLM-005
  statement_en: 'No verifier here.'
  expectation: pass

- id: CLM-006
  verifier: 'true'
`,
      ),
    );

    expect(claims).toEqual([]);
    expect(rejected.map((r) => r.id)).toEqual(['CLM-005', 'CLM-006']);
    expect(rejected[0].reason).toContain('faltan campos obligatorios');
  });

  it('rejects an invalid expectation value', () => {
    const { claims, rejected } = parseClaimsRegistry(
      registry(
        `- id: CLM-007
  verifier: 'true'
  expectation: maybe
`,
      ),
    );

    expect(claims).toEqual([]);
    expect(rejected[0].reason).toContain('expectation inválida');
  });
});

describe('core/claimsRegistry — execution', () => {
  it('decides each claim by the verifier exit code', async () => {
    const dir = await makeTempDir();
    const raw = registry(
      `- id: OK
  verifier: 'true'
  expectation: pass

- id: BROKEN
  verifier: 'false'
  expectation: pass

- id: DECLARED-GAP
  verifier: 'false'
  expectation: fail

- id: ABSENT
  verifier: 'false'
  expectation: absent
`,
    );

    const result = await runClaimsRegistry(raw, { cwd: dir });

    expect(result.report.total).toBe(4);
    expect(result.report.verified).toBe(1);
    expect(result.report.broken).toBe(1);
    expect(result.report.notImplemented).toBe(1);
    expect(result.report.notMeasured).toBe(1);
    expect(result.report.halting.map((c) => c.id)).toEqual(['BROKEN']);
    expect(result.timedOut).toEqual([]);
  });

  it('runs verifiers with the repository root as the working directory', async () => {
    const dir = await makeTempDir();
    await writeFile(path.join(dir, 'marker.txt'), 'present', 'utf8');

    const result = await runClaimsRegistry(
      registry(`- id: CWD\n  verifier: 'test -f marker.txt'\n  expectation: pass\n`),
      { cwd: dir },
    );

    expect(result.report.verified).toBe(1);
  });

  it('reports a hung verifier as a timeout instead of hanging the audit', async () => {
    const dir = await makeTempDir();
    const result = await runClaimsRegistry(
      registry(`- id: SLOW\n  verifier: 'sleep 5'\n  expectation: pass\n`),
      { cwd: dir, timeoutMs: 200 },
    );

    expect(result.timedOut).toEqual(['SLOW']);
    expect(result.runs[0].exitCode).toBe(TIMEOUT_EXIT_CODE);
    // A timeout is not a pass: with `expectation: pass` it is reported as broken.
    expect(result.report.broken).toBe(1);
  });

  it('reads the registry from a path relative to the repository root', async () => {
    const dir = await makeTempDir();
    await writeFile(
      path.join(dir, 'claims.yaml'),
      registry(`- id: FILE\n  verifier: 'true'\n  expectation: pass\n`),
      'utf8',
    );

    const raw = await readClaimsRegistry(dir, 'claims.yaml');
    expect(raw).toContain('FILE');
  });
});
