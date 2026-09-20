import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { planBootstrap } from '../src/core/bootstrap.js';
import { parseTasksMarkdown } from '../src/core/specManager.js';
import { traceDelta, type DeltaSpec } from '../src/core/deltaSpec.js';
import { adaptTemplates, ADAPTED_TEMPLATE_DIR } from '../src/core/templateAdaptation.js';
import { handleBrownfieldCommand } from '../src/cli/commands/brownfield.js';
import type { CliIO } from '../src/cli/io.js';

const temps: string[] = [];

const makeTemp = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const makeIO = (): { io: CliIO; logs: string[]; errors: string[] } => {
  const logs: string[] = [];
  const errors: string[] = [];
  const io: CliIO = {
    log: (msg) => logs.push(msg),
    error: (msg) => errors.push(msg),
    exit: () => undefined,
  };
  return { io, logs, errors };
};

const writeJson = async (dir: string, rel: string, value: unknown): Promise<void> => {
  const absolute = path.join(dir, rel);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const writeText = async (dir: string, rel: string, content: string): Promise<void> => {
  const absolute = path.join(dir, rel);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf8');
};

/**
 * A real Node monorepo with a DECLARED test command: the root `test` script runs Vitest, `core` has
 * source + tests and `api` has source only. Every fact the adapted template may name exists on disk.
 */
const createNodeFixture = async (): Promise<string> => {
  const dir = await makeTemp('open-sdd-templates-');
  await writeJson(dir, 'package.json', {
    name: 'fixture-root',
    private: true,
    workspaces: ['packages/*'],
    scripts: { build: 'tsc -b', test: 'vitest run' },
    devDependencies: { typescript: '^5.9.3', vitest: '^4.0.18' },
  });
  await writeText(dir, 'tsconfig.json', '{\n  "compilerOptions": {}\n}\n');
  await writeJson(dir, 'packages/core/package.json', {
    name: '@fixture/core',
    version: '1.0.0',
    main: 'dist/index.js',
    devDependencies: { vitest: '^4.0.18' },
  });
  await writeText(dir, 'packages/core/src/index.ts', 'export const parseOrder = (value: string): string => value;\n');
  await writeText(dir, 'packages/core/test/index.test.ts', "import { parseOrder } from '../src/index.js';\n");
  await writeJson(dir, 'packages/api/package.json', {
    name: '@fixture/api',
    version: '1.0.0',
    dependencies: { express: '^4.21.0' },
  });
  await writeText(dir, 'packages/api/src/server.ts', 'export const server = (): string => "up";\n');
  return dir;
};

/** A Node project with NO test runner at all: no test script, no test dependency, no test dir. */
const createRunnerlessFixture = async (): Promise<string> => {
  const dir = await makeTemp('open-sdd-templates-none-');
  await writeJson(dir, 'package.json', {
    name: 'plain-service',
    private: true,
    scripts: { build: 'tsc -b' },
    devDependencies: { typescript: '^5.9.3' },
  });
  await writeText(dir, 'tsconfig.json', '{\n  "compilerOptions": {}\n}\n');
  await writeText(dir, 'src/index.ts', 'export const start = (): string => "up";\n');
  return dir;
};

/** A runner in the dependencies but NO script declaring how to run it. */
const createRunnerWithoutCommandFixture = async (): Promise<string> => {
  const dir = await makeTemp('open-sdd-templates-noscript-');
  await writeJson(dir, 'package.json', {
    name: 'vite-only',
    private: true,
    devDependencies: { typescript: '^5.9.3', vitest: '^4.0.18' },
  });
  await writeText(dir, 'tsconfig.json', '{\n  "compilerOptions": {}\n}\n');
  await writeText(dir, 'src/index.ts', 'export const start = (): string => "up";\n');
  await writeText(dir, 'test/index.test.ts', 'export {};\n');
  return dir;
};

const templateOf = (
  templates: Awaited<ReturnType<typeof adaptTemplates>>['templates'],
  kind: 'requirements' | 'plan' | 'tasks',
): (typeof templates)[number] => {
  const found = templates.find((template) => template.kind === kind);
  if (!found) throw new Error(`falta la plantilla ${kind}`);
  return found;
};

describe('core/templateAdaptation — evidence-based adaptation', () => {
  it('names the REAL test command and carries the red-green cycle on every task line', async () => {
    const dir = await createNodeFixture();

    const result = await adaptTemplates({ cwd: dir });

    expect(result.complete).toBe(true);
    expect(result.templates.map((template) => template.kind)).toEqual(['requirements', 'plan', 'tasks']);
    const tasks = templateOf(result.templates, 'tasks');

    // The real command: the declared invocation AND the verbatim script command.
    expect(tasks.content).toContain('`npm test`');
    expect(tasks.content).toContain('`vitest run`');
    expect(tasks.content).toContain('Vitest');
    // The real directories and module names from buildModuleMap.
    expect(tasks.content).toContain('packages/core/test');
    expect(tasks.content).toContain('packages/core');
    expect(tasks.content).toContain('`packages/core/src`');
    expect(tasks.content).toContain('packages/api');
    // The cycle: test first, then the command that must fail, then the implementation, then green.
    expect(tasks.content).toContain('test primero:');
    expect(tasks.content).toMatch(/rojo: `npm test` debe fallar/);
    expect(tasks.content).toMatch(/verde: `npm test` debe pasar/);

    const taskLines = tasks.content.split('\n').filter((line) => line.trimStart().startsWith('- [ ]'));
    expect(taskLines.length).toBeGreaterThanOrEqual(3);
    for (const line of taskLines) {
      expect(line).toContain('_Requirements:');
      expect(line).toContain('_Boundary:_');
      expect(line).toContain('_TDD: rojo primero, verde después: `npm test`_');
    }
  });

  it('records the evidence of every substitution in adaptedFrom', async () => {
    const dir = await createNodeFixture();

    const result = await adaptTemplates({ cwd: dir });
    const tasks = templateOf(result.templates, 'tasks');
    const requirements = templateOf(result.templates, 'requirements');

    expect(tasks.adaptedFrom.some((entry) => entry.includes('script "test" = "vitest run"'))).toBe(true);
    expect(tasks.adaptedFrom.some((entry) => entry.includes('scanProject().testFramework = Vitest'))).toBe(true);
    expect(
      requirements.adaptedFrom.some((entry) => /directorios de test.*packages\/core\/test/.test(entry)),
    ).toBe(true);
    expect(requirements.adaptedFrom.some((entry) => /directorios de código.*packages\/core\/src/.test(entry))).toBe(
      true,
    );
    const plan = templateOf(result.templates, 'plan');
    expect(
      plan.adaptedFrom.some((entry) => entry.includes('buildModuleMap(cwd)') && entry.includes('packages/api')),
    ).toBe(true);
    // Every evidence line pairs a substitution with the observation behind it.
    for (const entry of [...tasks.adaptedFrom, ...plan.adaptedFrom, ...requirements.adaptedFrom]) {
      expect(entry).toContain('←');
    }
  });

  it('lists every part left generic in unchanged, each with its reason', async () => {
    const dir = await createNodeFixture();

    const result = await adaptTemplates({ cwd: dir });
    const tasks = templateOf(result.templates, 'tasks');

    expect(tasks.unchanged.length).toBeGreaterThan(0);
    expect(tasks.unchanged.some((item) => item.includes('{{DESCRIPCIÓN_DEL_CAMBIO}}'))).toBe(true);
    expect(tasks.unchanged.some((item) => /no son observables/.test(item))).toBe(true);
    // The template repeats its own gaps, so a reader cannot mistake a placeholder for a decision.
    for (const item of tasks.unchanged) expect(tasks.content).toContain(item);
  });

  it('emits NO red-green cycle when there is no test runner, and says why', async () => {
    const dir = await createRunnerlessFixture();

    const result = await adaptTemplates({ cwd: dir });
    const tasks = templateOf(result.templates, 'tasks');

    expect(result.complete).toBe(true);
    expect(tasks.content).toMatch(/No se observó ningún runner de test/);
    expect(tasks.content).not.toContain('_TDD:');
    expect(tasks.content).not.toContain('debe fallar');
    expect(tasks.content).not.toContain('debe pasar');
    expect(tasks.unchanged.some((item) => /ciclo rojo-verde/.test(item))).toBe(true);
    expect(tasks.rationale).toMatch(/no se observó runner/i);
    // The plan says the same thing, so the two templates cannot disagree.
    expect(templateOf(result.templates, 'plan').content).toMatch(/No se observó runner de test/);
  });

  it('reports a runner without a declared command as derived-and-unverified, with no cycle', async () => {
    const dir = await createRunnerWithoutCommandFixture();

    const result = await adaptTemplates({ cwd: dir });
    const tasks = templateOf(result.templates, 'tasks');

    expect(tasks.content).toContain('runner observado: Vitest');
    expect(tasks.content).toMatch(/NO se emite el ciclo rojo-verde/);
    expect(tasks.content).toContain('candidato derivado, NO verificado: `npx vitest run`');
    expect(tasks.content).not.toContain('_TDD:');
    expect(tasks.adaptedFrom.some((entry) => entry.includes('devDependencies.vitest'))).toBe(true);
  });

  it('excludes a watch-mode script from the red-green command', async () => {
    const dir = await createNodeFixture();
    await writeJson(dir, 'package.json', {
      name: 'fixture-root',
      private: true,
      workspaces: ['packages/*'],
      scripts: { test: 'vitest run', 'test:watch': 'vitest -w' },
      devDependencies: { typescript: '^5.9.3', vitest: '^4.0.18' },
    });

    const result = await adaptTemplates({ cwd: dir });
    const tasks = templateOf(result.templates, 'tasks');

    expect(tasks.content).toContain('`npm test`');
    expect(tasks.content).not.toContain('`npm run test:watch`');
    expect(tasks.content).toContain('script "test:watch"');
  });

  it('survives the REAL parsers: every task keeps its id, boundary and requirement', async () => {
    const dir = await createNodeFixture();

    const tasks = templateOf((await adaptTemplates({ cwd: dir })).templates, 'tasks');
    const parsed = parseTasksMarkdown(tasks.content);

    // Three modules plus the cross-module task, all parsed from the adapted template.
    expect(parsed.length).toBe(4);
    for (const task of parsed) {
      expect(task.id).toMatch(/^\d+\.1$/);
      expect(task.boundary?.length ?? 0).toBeGreaterThan(0);
      expect(task.raw).toContain('_Requirements:');
    }
    expect(parsed.map((task) => task.boundary?.[0])).toContain('packages/api/src');
    expect(parsed.map((task) => task.boundary?.[0])).toContain('packages/core/src');

    // The requirement ids of the template trace with the SAME matcher the toolchain uses.
    const synthetic: DeltaSpec = {
      feature: 'synthetic',
      title: 'synthetic',
      status: 'proposed',
      entries: ['REQ-AREA-001', 'REQ-AREA-002', 'REQ-AREA-003', 'REQ-AREA-004'].map((id) => ({
        id,
        kind: 'ADDED',
        title: '',
        statement: '',
        targets: [],
      })),
    };
    const trace = traceDelta(synthetic, parsed);
    expect(trace.mapped).toHaveLength(4);
    expect(trace.unmapped).toEqual([]);
    expect(trace.phantomTasks).toEqual([]);
  });
});

describe('core/templateAdaptation — write never overwrites', () => {
  it('creates only where nothing exists and reports `keep` otherwise', async () => {
    const dir = await createNodeFixture();
    const brownfieldDir = path.join(dir, '.sdd', ADAPTED_TEMPLATE_DIR);
    await writeText(dir, '.sdd/' + path.posix.join(ADAPTED_TEMPLATE_DIR, 'tasks.md'), '# plantilla propia del proyecto\n');
    // The generic installed template must never be touched either.
    await writeText(dir, '.sdd/settings/templates/specs/tasks.md', '# plantilla genérica instalada\n');
    await writeText(dir, '.sdd/settings/templates/specs/requirements.md', '# plantilla genérica instalada\n');

    const result = await adaptTemplates({ cwd: dir, write: true });

    expect(existsSync(path.join(brownfieldDir, 'requirements.md'))).toBe(true);
    expect(existsSync(path.join(brownfieldDir, 'plan.md'))).toBe(true);
    expect(await readFile(path.join(brownfieldDir, 'tasks.md'), 'utf8')).toBe('# plantilla propia del proyecto\n');
    expect(await readFile(path.join(dir, '.sdd/settings/templates/specs/tasks.md'), 'utf8')).toBe(
      '# plantilla genérica instalada\n',
    );
    expect(result.written.map((written) => path.posix.basename(written)).sort()).toEqual(['plan.md', 'requirements.md']);
    const kept = result.actions.find((action) => action.path.endsWith('/tasks.md'))!;
    expect(kept.action).toBe('keep');
    expect(kept.reason).toMatch(/nunca se sobrescribe/i);

    // Idempotent: a second run writes nothing at all.
    const second = await adaptTemplates({ cwd: dir, write: true });
    expect(second.written).toEqual([]);
    expect(second.actions.every((action) => action.action === 'keep')).toBe(true);
  });

  it('writes nothing without --write, but still reports what it would create', async () => {
    const dir = await createNodeFixture();

    const result = await adaptTemplates({ cwd: dir, write: false });

    expect(result.written).toEqual([]);
    expect(existsSync(path.join(dir, '.sdd', ADAPTED_TEMPLATE_DIR))).toBe(false);
    expect(result.actions.every((action) => action.action === 'create')).toBe(true);
  });

  it('keeps .kiro when the project resolved its SDD directory there', async () => {
    const dir = await createNodeFixture();
    await mkdir(path.join(dir, '.kiro'), { recursive: true });

    const result = await adaptTemplates({ cwd: dir, write: true });

    expect(result.templates[0]!.path.startsWith('.kiro/')).toBe(true);
    expect(existsSync(path.join(dir, '.kiro', 'settings', 'templates', 'brownfield', 'plan.md'))).toBe(true);
  });
});

describe('core/templateAdaptation — bootstrap exposes the adaptation', () => {
  it('planBootstrap returns the adapted templates and a step that names the command', async () => {
    const dir = await createNodeFixture();

    const plan = await planBootstrap({ cwd: dir });

    expect(plan.templates.map((template) => template.kind)).toEqual(['requirements', 'plan', 'tasks']);
    expect(templateOf(plan.templates, 'tasks').content).toContain('`npm test`');
    expect(plan.steps.some((step) => step.includes('brownfield templates'))).toBe(true);
    expect(plan.detail).toMatch(/plantilla\(s\) adaptada\(s\)/);
    // The plan still only promises to write its own artifacts: templates are not in `artifacts`.
    expect(plan.artifacts.some((artifact) => artifact.path.includes('brownfield'))).toBe(false);
  });
});

describe('cli/brownfield templates', () => {
  it('prints the adapted templates and exits 0 (--json included)', async () => {
    const dir = await createNodeFixture();
    const { io, logs, errors } = makeIO();

    const code = await handleBrownfieldCommand(['templates', dir, '--json'], io, dir);

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    const parsed = JSON.parse(logs.join('\n'));
    expect(parsed.complete).toBe(true);
    expect(parsed.actions).toHaveLength(3);
    expect(parsed.templates.find((t: { kind: string }) => t.kind === 'tasks').content).toContain('`npm test`');
  });

  it('--write creates the templates and reports the kept ones', async () => {
    const dir = await createNodeFixture();
    await writeText(dir, '.sdd/' + path.posix.join(ADAPTED_TEMPLATE_DIR, 'plan.md'), '# plan propio\n');
    const { io, logs } = makeIO();

    const code = await handleBrownfieldCommand(['templates', dir, '--write'], io, dir);

    expect(code).toBe(0);
    expect(existsSync(path.join(dir, '.sdd', ADAPTED_TEMPLATE_DIR, 'tasks.md'))).toBe(true);
    expect(await readFile(path.join(dir, '.sdd', ADAPTED_TEMPLATE_DIR, 'plan.md'), 'utf8')).toBe('# plan propio\n');
    expect(logs.join('\n')).toMatch(/se conserva/);
    expect(logs.join('\n')).toContain('Disciplina rojo-verde');
  });

  it('exits 1 when the stack could not be observed, because then nothing is evidence-based', async () => {
    const dir = await makeTemp('open-sdd-templates-empty-');
    await writeText(dir, 'notes.txt', 'nothing to adapt\n');
    const { io, logs } = makeIO();

    const code = await handleBrownfieldCommand(['templates', dir, '--json'], io, dir);

    expect(code).toBe(1);
    const parsed = JSON.parse(logs.join('\n'));
    expect(parsed.complete).toBe(false);
    expect(parsed.detail).toMatch(/stack NO determinado/);
  });
});
