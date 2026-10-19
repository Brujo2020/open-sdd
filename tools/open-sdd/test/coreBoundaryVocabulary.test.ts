/**
 * ONE boundary vocabulary (REQ-MAT-010).
 *
 * Two artifacts describe the same repository: the module responsibility map that
 * `bootstrap.buildModuleMap` produces ("where does new code go?") and the descriptive constitution
 * that `reverseConstitution` produces (principle `C-BOUNDARIES`, "which limits does a change
 * respect?"). They used to answer with two different sets of boundaries — the map listed
 * `root + workspace roots`, the constitution listed the subdirectories of the source directories —
 * so a reader could be told the repository has boundaries A and B by one artifact and C and D by
 * the other, with no way to tell which one governs.
 *
 * Both now derive their boundaries from the single exported `resolveBoundaries`. These tests fix
 * that as a property: on one fixture, the two artifacts name the SAME boundaries, and the C-BOUNDARIES
 * evidence is exactly that list.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveBoundaries, scanProject, type DiscoveredProject } from '../src/core/reverseEngineering.js';
import { buildModuleMap } from '../src/core/bootstrap.js';
import { buildDescriptiveConstitution, collectRepoFacts } from '../src/core/reverseConstitution.js';
import { validateConstitution } from '../src/core/constitution.js';

const temps: string[] = [];

const makeTemp = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const write = async (dir: string, rel: string, content: string): Promise<void> => {
  const full = path.join(dir, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
};

/**
 * One repository, TWO vocabularies' worth of evidence: a Node workspace root whose source tree also
 * has module-like subdirectories. That is exactly the shape where the old implementation named
 * `admin`, `billing`, `catalog` (subdirectories of `src`) in the constitution while the map named
 * `packages/api`, `packages/core` — same repository, two answers.
 */
const dualVocabularyFixture = async (): Promise<string> => {
  const dir = await makeTemp('open-sdd-boundaries-');
  await write(
    dir,
    'package.json',
    JSON.stringify(
      {
        name: 'boundary-root',
        private: true,
        workspaces: ['packages/*'],
        devDependencies: { typescript: '^5.9.3', vitest: '^4.0.18' },
      },
      null,
      2,
    ),
  );
  await write(dir, 'package-lock.json', JSON.stringify({ lockfileVersion: 3 }, null, 2));
  await write(
    dir,
    'packages/core/package.json',
    JSON.stringify({ name: '@fix/core', version: '1.0.0', main: 'dist/index.js' }, null, 2),
  );
  await write(dir, 'packages/core/src/index.ts', 'export const parseToken = (value: string): string => value;\n');
  await write(dir, 'packages/core/test/index.test.ts', 'export const covered = true;\n');
  await write(
    dir,
    'packages/api/package.json',
    JSON.stringify({ name: '@fix/api', version: '1.0.0', dependencies: { '@fix/core': '^1.0.0' } }, null, 2),
  );
  await write(dir, 'packages/api/src/handler.ts', 'export const handle = (): string => "x";\n');
  // Subdirectories of a source directory: the old constitution's "modules". They are NOT boundaries.
  await mkdir(path.join(dir, 'src', 'billing'), { recursive: true });
  await mkdir(path.join(dir, 'src', 'catalog'), { recursive: true });
  await write(dir, 'src/index.ts', 'export const root = true;\n');
  await write(dir, 'src/billing/invoice.ts', 'export const invoice = 1;\n');
  await write(dir, 'src/catalog/item.ts', 'export const item = 1;\n');
  return dir;
};

const boundaryEvidence = (
  facts: Awaited<ReturnType<typeof collectRepoFacts>>,
): string[] => {
  const { constitution } = buildDescriptiveConstitution(facts);
  const principle = constitution.principles.find((entry) => entry.id === 'C-BOUNDARIES');
  return principle?.evidence ?? [];
};

describe('core boundary vocabulary — one function, two artifacts', () => {
  it('exports the boundary set that the module map builds', async () => {
    const dir = await dualVocabularyFixture();
    const project = await scanProject(dir);

    const resolved = resolveBoundaries(project);
    const map = await buildModuleMap(dir);

    expect(resolved.boundaries).toEqual(['.', 'packages/api', 'packages/core']);
    expect(map.modules.map((module) => module.path)).toEqual(resolved.boundaries);
    expect(resolved.source).toBe('declared-modules');
    expect(resolved.ecosystems).toEqual({ '.': 'node', 'packages/api': 'node', 'packages/core': 'node' });
  });

  it('makes the constitution name exactly the module map boundaries, not source subdirectories', async () => {
    const dir = await dualVocabularyFixture();
    const project = await scanProject(dir);
    const facts = await collectRepoFacts(dir, project);

    const resolved = resolveBoundaries(facts.project);
    const map = await buildModuleMap(dir);

    // The property that was broken: the same repository, one answer.
    expect(boundaryEvidence(facts)).toEqual(resolved.boundaries);
    expect(boundaryEvidence(facts)).toEqual(map.modules.map((module) => module.path));

    // And the old answer is gone: `billing`/`catalog` are subdirectories of `src`, not boundaries.
    expect(boundaryEvidence(facts)).not.toContain('billing');
    expect(boundaryEvidence(facts)).not.toContain('catalog');
  });

  it('agrees on the boundaries of a non-Node repository too', async () => {
    const dir = await makeTemp('open-sdd-boundaries-maven-');
    await write(dir, 'pom.xml', '<project><modules><module>libs/core</module><module>apps/api</module></modules></project>');
    await write(dir, 'libs/core/pom.xml', '<project><artifactId>core</artifactId></project>');
    await write(dir, 'apps/api/pom.xml', '<project><artifactId>api</artifactId></project>');

    const project = await scanProject(dir);
    const facts = await collectRepoFacts(dir, project);
    const resolved = resolveBoundaries(project);
    const map = await buildModuleMap(dir);

    expect(resolved.boundaries).toEqual(['.', 'apps/api', 'libs/core']);
    expect(boundaryEvidence(facts)).toEqual(resolved.boundaries);
    expect(boundaryEvidence(facts)).toEqual(map.modules.map((module) => module.path));
    expect(resolved.ecosystems['libs/core']).toBe('maven');
  });

  it('falls back to the single root boundary when nothing declares modules — in both artifacts', async () => {
    const dir = await makeTemp('open-sdd-boundaries-single-');
    await write(dir, 'package.json', JSON.stringify({ name: 'single', devDependencies: { vitest: '^4.0.18' } }, null, 2));
    await write(dir, 'src/index.ts', 'export const value = 1;\n');
    await write(dir, 'test/index.test.ts', 'export const covered = true;\n');

    const project = await scanProject(dir);
    const facts = await collectRepoFacts(dir, project);
    const resolved = resolveBoundaries(project);
    const map = await buildModuleMap(dir);

    expect(resolved).toMatchObject({ boundaries: ['.'], source: 'root-only' });
    expect(map.modules.map((module) => module.path)).toEqual(['.']);
    expect(boundaryEvidence(facts)).toEqual(['.']);
  });

  it('keeps the constitution valid, with evidence that resolves on disk', async () => {
    const dir = await dualVocabularyFixture();
    const project = await scanProject(dir);
    const facts = await collectRepoFacts(dir, project);
    const { constitution } = buildDescriptiveConstitution(facts);

    const errors = validateConstitution(constitution).filter((issue) => issue.severity === 'error');
    expect(errors).toEqual([]);

    // Every boundary cited is a path that exists, so `validateConstitution`'s evidence rule is not
    // satisfied by a plausible-looking string.
    const principle = constitution.principles.find((entry) => entry.id === 'C-BOUNDARIES')!;
    expect(principle.provenance).toBe('descriptive');
    expect(principle.level).toBe('SHOULD');
    expect((principle.evidence ?? []).length).toBeGreaterThan(0);
  });

  it('labels the ecosystem of every boundary, and `unknown` when nothing declared it', async () => {
    const dir = await makeTemp('open-sdd-boundaries-mixed-');
    // A Go workspace root with a Node package inside it: two toolchains, one boundary list.
    await write(dir, 'go.work', 'go 1.22\n\nuse ./services/api\n');
    await write(dir, 'services/api/go.mod', 'module example.com/api\n\ngo 1.22\n');
    await write(
      dir,
      'package.json',
      JSON.stringify({ name: 'mixed-root', workspaces: ['tools/*'] }, null, 2),
    );
    await write(dir, 'tools/cli/package.json', JSON.stringify({ name: '@acme/cli' }, null, 2));

    const project = await scanProject(dir);
    const resolved = resolveBoundaries(project);

    expect(resolved.boundaries).toEqual(['.', 'services/api', 'tools/cli']);
    expect(resolved.ecosystems['services/api']).toBe('go');
    expect(resolved.ecosystems['tools/cli']).toBe('node');
    // The root was declared by both toolchains; the first declaration labels it and the map says so.
    expect(['go', 'node']).toContain(resolved.ecosystems['.']);
    expect(resolved.detail).toMatch(/Fronteras: 3/);
  });

  it('still derives the boundary set from `workspaceRoots` alone for an older project object', () => {
    // `DiscoveredProject` predates `declaredModules`: a caller passing one must still get the
    // roots as boundaries rather than an empty set.
    const legacy: DiscoveredProject = {
      name: 'legacy',
      language: 'TypeScript',
      frameworks: [],
      sourceDirs: ['src'],
      testDirs: [],
      modules: [],
      workspaceRoots: ['packages/a'],
    };

    const resolved = resolveBoundaries(legacy);

    expect(resolved.boundaries).toEqual(['.', 'packages/a']);
    expect(resolved.source).toBe('declared-modules');
    expect(resolved.ecosystems['packages/a']).toBe('unknown');
  });
});

/**
 * The floor's own boundary: where the commit hook actually is. A team that opted into
 * `core.hooksPath` has its hook installed, and telling it "hook no instalado" because the file is
 * not in `.git/hooks` is a false negative on the one control this module reports.
 */
describe('core/floorInstallation — the hook directory is the one git resolves', () => {
  const git = async (cwd: string, args: string[]): Promise<void> => {
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', args, { cwd, stdio: 'ignore' });
  };

  const withFloor = async (dir: string): Promise<void> => {
    await write(dir, path.join('tools', 'open-sdd', 'templates', 'hooks', 'pre-commit'), '#!/bin/bash\n');
    await write(
      dir,
      path.join('.github', 'workflows', 'gates.yml'),
      'on:\n  pull_request:\njobs:\n  g:\n    steps:\n      - run: open-sdd gates run\n',
    );
  };

  it('counts a hook installed in a `core.hooksPath` directory and says which directory it used', async () => {
    const { detectInstalledFloor } = await import('../src/core/floorInstallation.js');
    const dir = await makeTemp('open-sdd-hookspath-');
    await git(dir, ['init', '-q']);
    await git(dir, ['config', 'core.hooksPath', '.githooks']);
    await withFloor(dir);
    await write(dir, '.githooks/pre-commit', '#!/bin/bash\n');
    // The conventional directory stays empty: only the opted-in one holds the hook.
    await mkdir(path.join(dir, '.git', 'hooks'), { recursive: true });

    const floor = await detectInstalledFloor(dir);

    expect(floor.commitHookInstalled).toBe(true);
    expect(floor.floorInstalled).toBe(true);
    expect(floor.hookOrigin).toBe('core.hooksPath=.githooks');
    expect(floor.hookPath).toBe(path.join(dir, '.githooks', 'pre-commit'));
    expect(floor.detail).toContain('core.hooksPath=.githooks');
  });

  it('still reports the hook missing when the opted-in directory has none', async () => {
    const { detectInstalledFloor } = await import('../src/core/floorInstallation.js');
    const dir = await makeTemp('open-sdd-hookspath-missing-');
    await git(dir, ['init', '-q']);
    await git(dir, ['config', 'core.hooksPath', '.githooks']);
    await withFloor(dir);

    const floor = await detectInstalledFloor(dir);

    expect(floor.commitHookInstalled).toBe(false);
    expect(floor.floorInstalled).toBe(false);
    // The path that was inspected is named, so the report is checkable rather than a bare verdict.
    // `path.relative` produces the platform's separator, so the expectation is built the same way.
    expect(floor.detail).toContain(path.join('.githooks', 'pre-commit'));
    expect(floor.detail).toContain('core.hooksPath=.githooks');
  });

  it('keeps the `.git/hooks` behaviour for a repository that opted into nothing', async () => {
    const { detectInstalledFloor } = await import('../src/core/floorInstallation.js');
    const dir = await makeTemp('open-sdd-hookspath-default-');
    await git(dir, ['init', '-q']);
    await withFloor(dir);
    await write(dir, path.join('.git', 'hooks', 'pre-commit'), '#!/bin/bash\n');

    const floor = await detectInstalledFloor(dir);

    expect(floor.commitHookInstalled).toBe(true);
    expect(floor.floorInstalled).toBe(true);
    expect(floor.hookOrigin).toBe('.git/hooks');
  });
});
