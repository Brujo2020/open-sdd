import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DRIFT_WAIVERS_FILE,
  checkDrift,
  collectDriftBindings,
  matchesGlob,
  parseDriftBindings,
  readDriftWaivers,
} from '../src/core/driftCheck.js';

const dirs: string[] = [];
const makeRepo = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-drift-'));
  dirs.push(dir);
  return dir;
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const TASKS = [
  '# Tasks',
  '',
  '- [x] 1. Console — _Requirements: REQ-STD-003_ — _Boundary:_ `tools/open-sdd/src/cli/commands/standards.ts`, `tools/open-sdd/test/cliStandards.test.ts`',
  '- [ ] 2. Internal tree — _Requirements: REQ-STD-001, REQ-STD-002_ — _Boundary:_ `tools/open-sdd/src/core/_shared/**`, `docs/guides/standards.md`',
].join('\n');

describe('core/driftCheck — every changed path is covered or knowingly accepted', () => {
  it('parses ids and globs, and a boundary path containing an underscore does not truncate the rest', () => {
    const bindings = parseDriftBindings('standards-engine', TASKS);
    expect(bindings).toHaveLength(2);
    expect(bindings[0].ids).toEqual(['REQ-STD-003']);
    expect(bindings[0].globs).toContain('tools/open-sdd/src/cli/commands/standards.ts');
    // El defecto del parser de fronteras (`[^_]` cortaba en el primer guion bajo) no puede repetirse.
    expect(bindings[1].globs).toContain('tools/open-sdd/src/core/_shared/**');
    expect(bindings[1].globs).toContain('docs/guides/standards.md');
    expect(bindings[1].ids).toEqual(['REQ-STD-001', 'REQ-STD-002']);
  });

  it('matches a glob the way a boundary is written', () => {
    expect(matchesGlob('src/a.ts', 'src/a.ts')).toBe(true);
    expect(matchesGlob('src/a.ts', 'src/*.ts')).toBe(true);
    expect(matchesGlob('src/deep/a.ts', 'src/*.ts')).toBe(false);
    expect(matchesGlob('src/deep/a.ts', 'src/**')).toBe(true);
    expect(matchesGlob('tools/x/src/core/_shared/a.ts', 'tools/x/src/core/_shared/**')).toBe(true);
    // Un glob de directorio cubre también lo que hay debajo.
    expect(matchesGlob('tools/core/a/b.ts', 'tools/core')).toBe(true);
  });

  it('classifies covered, uncovered, waived and expired-waiver without inventing coverage', () => {
    const bindings = parseDriftBindings('f', TASKS);
    const report = checkDrift({
      files: ['tools/open-sdd/src/cli/commands/standards.ts', 'README.md', 'scripts/legacy.sh', 'tools/old.sh'],
      bindings,
      waivers: [
        { path: 'README.md', reason: 'docs: no es código', owner: 'maintainers', expires: '2027-03-31' },
        { path: 'scripts/**', reason: 'script heredado', owner: 'ops', expires: '2020-01-01' },
        { path: 'tools/old.sh', reason: 'se retira en Q1', owner: 'ops', expires: '2027-03-31' },
      ],
      now: new Date('2026-01-01T00:00:00Z'),
    });

    const state = new Map(report.findings.map((finding) => [finding.file, finding.state]));
    expect(state.get('tools/open-sdd/src/cli/commands/standards.ts')).toBe('covered');
    expect(state.get('README.md')).toBe('waived');
    expect(state.get('tools/old.sh')).toBe('waived');
    // Un waiver caducado NO cubre: vuelve nombrado para que el gate diga con quién hablar.
    expect(state.get('scripts/legacy.sh')).toBe('expired-waiver');
    expect(report.findings.find((f) => f.file === 'tools/open-sdd/src/cli/commands/standards.ts')?.coveredBy).toEqual([
      'REQ-STD-003',
    ]);
    expect(report.uncovered).toBe(0);
    expect(report.waived).toBe(2);
    expect(report.expired).toBe(1);
  });

  it('reports a file nobody covers as uncovered, and passes problems through instead of swallowing them', () => {
    const report = checkDrift({
      files: ['scripts/mystery.sh'],
      bindings: [],
      problems: ['no existe .sdd/specs: no hay requisitos que declaren cobertura.'],
    });
    expect(report.uncovered).toBe(1);
    expect(report.findings[0].state).toBe('uncovered');
    expect(report.findings[0].coveredBy).toEqual([]);
    expect(report.problems).toHaveLength(1);
  });

  it('reads the bindings of every spec and the waivers, and refuses a corrupt waivers file', async () => {
    const cwd = await makeRepo();
    await mkdir(path.join(cwd, '.sdd/specs/standards-engine'), { recursive: true });
    await writeFile(path.join(cwd, '.sdd/specs/standards-engine/tasks.md'), TASKS, 'utf8');

    const collected = await collectDriftBindings(cwd, '.sdd');
    expect(collected.bindings).toHaveLength(2);
    expect(collected.problems).toEqual([]);

    await mkdir(path.join(cwd, '.sdd/settings'), { recursive: true });
    await writeFile(
      path.join(cwd, DRIFT_WAIVERS_FILE),
      JSON.stringify({ allow: [{ path: 'README.md', reason: 'docs', owner: 'maintainers', expires: '2027-03-31' }] }),
      'utf8',
    );
    const waivers = await readDriftWaivers(cwd);
    expect(waivers.problem).toBeNull();
    expect(waivers.waivers).toHaveLength(1);

    await writeFile(path.join(cwd, DRIFT_WAIVERS_FILE), '{ not json', 'utf8');
    const corrupt = await readDriftWaivers(cwd);
    expect(corrupt.waivers).toEqual([]);
    expect(corrupt.problem).toContain(DRIFT_WAIVERS_FILE);
  });
});
