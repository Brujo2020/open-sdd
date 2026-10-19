import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  answerCodePlacement,
  buildModuleMap,
  planBootstrap,
  writeCodeIntelligence,
} from '../src/core/bootstrap.js';
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

/**
 * A real monorepo: root manifest + two nested workspaces with different dependencies. `core` owns
 * the tests and declares a public API (`main`); `api` depends on `core`, has source and no tests and
 * declares nothing special, so its responsibilities must come back empty rather than invented.
 */
const createMonorepoFixture = async (): Promise<string> => {
  const dir = await makeTemp('open-sdd-bootstrap-');

  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'bootstrap-root',
        private: true,
        workspaces: ['packages/*'],
        scripts: { build: 'tsc -b', test: 'vitest run' },
        devDependencies: { typescript: '^5.9.3' },
      },
      null,
      2,
    ),
    'utf8',
  );

  // packages/core — source + tests, declares a public API.
  await mkdir(path.join(dir, 'packages', 'core', 'src'), { recursive: true });
  await mkdir(path.join(dir, 'packages', 'core', 'test'), { recursive: true });
  await writeFile(
    path.join(dir, 'packages', 'core', 'package.json'),
    JSON.stringify({ name: '@fix/core', version: '1.0.0', main: 'dist/index.js', devDependencies: { vitest: '^4.0.18' } }, null, 2),
    'utf8',
  );
  await writeFile(path.join(dir, 'packages', 'core', 'tsconfig.json'), '{\n  "compilerOptions": {}\n}\n', 'utf8');
  await writeFile(
    path.join(dir, 'packages', 'core', 'src', 'index.ts'),
    'export const parseToken = (value: string): string => value;\n',
    'utf8',
  );
  await writeFile(
    path.join(dir, 'packages', 'core', 'src', 'types.ts'),
    'export interface CoreOptions {\n  name: string;\n}\n',
    'utf8',
  );
  await writeFile(
    path.join(dir, 'packages', 'core', 'test', 'index.test.ts'),
    "import { parseToken } from '../src/index.js';\nexport const covered = parseToken('x');\n",
    'utf8',
  );

  // packages/api — source only, one declared dependency, no tests, no bin/main/exports.
  await mkdir(path.join(dir, 'packages', 'api', 'src'), { recursive: true });
  await writeFile(
    path.join(dir, 'packages', 'api', 'package.json'),
    JSON.stringify({ name: '@fix/api', version: '1.0.0', dependencies: { '@fix/core': '^1.0.0' } }, null, 2),
    'utf8',
  );
  await writeFile(path.join(dir, 'packages', 'api', 'tsconfig.json'), '{\n  "compilerOptions": {}\n}\n', 'utf8');
  await writeFile(
    path.join(dir, 'packages', 'api', 'src', 'handler.ts'),
    "import { parseToken } from '../../core/src/index.js';\nexport const handleRequest = (): string => parseToken('x');\n",
    'utf8',
  );
  await writeFile(path.join(dir, 'packages', 'api', 'src', 'second.ts'), 'export const second = 1;\n', 'utf8');

  return dir;
};

/** A single-package repository: the layout gives no evidence that a module is the unit of change. */
const createSinglePackageFixture = async (): Promise<string> => {
  const dir = await makeTemp('open-sdd-single-');
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'single-package', scripts: { test: 'vitest run' } }, null, 2),
    'utf8',
  );
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await writeFile(path.join(dir, 'src', 'index.ts'), 'export const value = 1;\n', 'utf8');
  return dir;
};

const constitutionFile = (dir: string): string => path.join(dir, '.sdd', 'steering', 'constitution.md');
const intelligenceFile = (dir: string): string => path.join(dir, '.sdd', 'steering', 'codebase-intelligence.md');

describe('core/bootstrap — module map', () => {
  it('finds the root and both workspaces with their real source and test directories', async () => {
    const dir = await createMonorepoFixture();

    const map = await buildModuleMap(dir);
    const paths = map.modules.map((module) => module.path);

    expect(paths).toContain('.');
    expect(paths).toContain('packages/core');
    expect(paths).toContain('packages/api');

    const core = map.modules.find((module) => module.path === 'packages/core')!;
    expect(core.name).toBe('@fix/core');
    expect(core.owns).toContain('packages/core/src');
    expect(core.owns).toContain('packages/core/package.json');
    expect(core.testDirs).toEqual(['packages/core/test']);

    const api = map.modules.find((module) => module.path === 'packages/api')!;
    expect(api.owns).toContain('packages/api/src');
    expect(api.owns).not.toContain('packages/api/test');
    expect(api.testDirs).toEqual([]);

    expect(map.complete).toBe(true);
    expect(map.detail).toMatch(/workspace/i);
  });

  it('derives dependsOn from manifests and relative imports, and leaves responsibilities empty without evidence', async () => {
    const dir = await createMonorepoFixture();

    const map = await buildModuleMap(dir);
    const core = map.modules.find((module) => module.path === 'packages/core')!;
    const api = map.modules.find((module) => module.path === 'packages/api')!;

    // Declared dependency (@fix/core) and the crossing relative import both point at core.
    expect(api.dependsOn).toContain('packages/core');

    // core declares `main`, so that responsibility is evidence-backed...
    expect(core.responsibilities.join(' | ')).toMatch(/API pública/);
    // ...but api declares nothing distinctive and has no tests: the map must not invent a reason.
    expect(api.responsibilities).toEqual([]);

    // The root aggregates the workspaces — again, observed, not guessed.
    const root = map.modules.find((module) => module.path === '.')!;
    expect(root.responsibilities.join(' | ')).toMatch(/raíz de workspaces/);
  });

  it('reports incomplete instead of guessing when manifests cannot be read', async () => {
    const dir = await makeTemp('open-sdd-broken-');
    await writeFile(path.join(dir, 'package.json'), '{ this is not json', 'utf8');
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(path.join(dir, 'src', 'index.ts'), 'export const value = 1;\n', 'utf8');

    const map = await buildModuleMap(dir);

    expect(map.complete).toBe(false);
    expect(map.detail).toMatch(/no se pudo leer package\.json/i);
  });
});

describe('core/bootstrap — where does new code go', () => {
  it('answers `existing-module` and returns the reuse candidate for a symbol that already exists', async () => {
    const dir = await createMonorepoFixture();

    const answer = await answerCodePlacement({
      cwd: dir,
      description: 'reutilizar el parseo de tokens antes de crear nada',
      symbol: 'parseToken',
    });

    expect(answer.kind).toBe('existing-module');
    expect(answer.target).toBe('packages/core');
    expect(answer.reuseCandidates.length).toBeGreaterThan(0);
    const candidate = answer.reuseCandidates.find((entry) => entry.symbol === 'parseToken')!;
    expect(candidate.file).toBe('packages/core/src/index.ts');
    expect(candidate.line).toBe(1);
    expect(candidate.similarity).toBe(1);
    expect(answer.evidence.join(' | ')).toMatch(/parseToken/);
  });

  it('answers `undecidable` for a vague description with no evidence and still reports the reuse search', async () => {
    const dir = await createSinglePackageFixture();

    const answer = await answerCodePlacement({ cwd: dir, description: 'mejorar la calidad general del sistema' });

    expect(answer.kind).toBe('undecidable');
    expect(answer.target).toBeUndefined();
    expect(answer.reuseCandidates).toEqual([]);
    expect(answer.evidence.join(' | ')).toMatch(/workspaces/i);
    expect(answer.rationale).toMatch(/no se puede responder/i);
  });

  it('answers `new-module` when nothing matches but the layout declares workspaces', async () => {
    const dir = await createMonorepoFixture();

    const answer = await answerCodePlacement({ cwd: dir, description: 'añadir un motor de facturación fiscal' });

    expect(answer.kind).toBe('new-module');
    expect(answer.target).toBe('packages');
    expect(answer.evidence.join(' | ')).toMatch(/workspaces/i);
  });
});

describe('core/bootstrap — code intelligence document', () => {
  it('names the real package scripts and the constitution path, and does not write unless asked', async () => {
    const dir = await createMonorepoFixture();
    await mkdir(path.join(dir, '.sdd', 'steering'), { recursive: true });
    await writeFile(constitutionFile(dir), '# Constitution — fixture\n', 'utf8');

    const result = await writeCodeIntelligence({ cwd: dir });

    expect(result.written).toBe(false);
    expect(existsSync(intelligenceFile(dir))).toBe(false);
    expect(result.content).toContain('tsc -b');
    expect(result.content).toContain('vitest run');
    expect(result.content).toContain('.sdd/steering/constitution.md');
    expect(result.content).toMatch(/## Lo que NO se ha inspeccionado/);
    expect(result.detail).toMatch(/script/i);
  });

  it('writes the document when asked and marks it as generated', async () => {
    const dir = await createMonorepoFixture();

    const result = await writeCodeIntelligence({ cwd: dir, write: true });

    expect(result.written).toBe(true);
    expect(result.complete).toBe(true);
    expect(existsSync(intelligenceFile(dir))).toBe(true);
    const onDisk = await readFile(intelligenceFile(dir), 'utf8');
    expect(onDisk).toBe(result.content);
    expect(onDisk).toContain('generated-by: open-sdd brownfield bootstrap');
    expect(onDisk).toContain('packages/core');
  });
});

describe('core/bootstrap — plan', () => {
  it('marks a missing constitution `create` and an existing one `keep`', async () => {
    const dir = await createMonorepoFixture();

    const fresh = await planBootstrap({ cwd: dir });
    const freshArtifact = fresh.artifacts.find((artifact) => artifact.path.endsWith('constitution.md'))!;
    expect(freshArtifact.action).toBe('create');
    expect(fresh.artifacts.find((artifact) => artifact.path.endsWith('codebase-intelligence.md'))!.action).toBe('create');

    await mkdir(path.join(dir, '.sdd', 'steering'), { recursive: true });
    await writeFile(constitutionFile(dir), '# Constitution — propia\n', 'utf8');

    const settled = await planBootstrap({ cwd: dir });
    const keptArtifact = settled.artifacts.find((artifact) => artifact.path.endsWith('constitution.md'))!;
    expect(keptArtifact.action).toBe('keep');
    expect(keptArtifact.reason).toMatch(/no se sobrescribe/i);
  });

  it('composes the runnable flow and only rewords the delta step when a focus is given', async () => {
    const dir = await createMonorepoFixture();

    const withoutFocus = await planBootstrap({ cwd: dir });
    expect(withoutFocus.steps.some((step) => step.includes('brownfield survey'))).toBe(true);
    expect(withoutFocus.steps.some((step) => step.includes('brownfield constitution'))).toBe(true);
    expect(withoutFocus.steps.some((step) => step.includes('delta init'))).toBe(true);
    expect(withoutFocus.artifacts.some((artifact) => artifact.path.includes('/specs/'))).toBe(false);

    const withFocus = await planBootstrap({ cwd: dir, focus: 'gestion de pedidos' });
    expect(withFocus.steps.some((step) => step.includes('delta init gestion-de-pedidos'))).toBe(true);
    const deltaArtifact = withFocus.artifacts.find((artifact) => artifact.path.includes('/specs/'))!;
    expect(deltaArtifact).toBeDefined();
    expect(deltaArtifact.action).toBe('create');
    expect(deltaArtifact.path.endsWith('delta.md')).toBe(true);
  });
});

describe('cli/brownfield bootstrap', () => {
  it('prints the plan and exits 0 without writing anything', async () => {
    const dir = await createMonorepoFixture();
    const { io, logs, errors } = makeIO();

    const code = await handleBrownfieldCommand(['bootstrap', dir], io, dir);

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    const output = logs.join('\n');
    expect(output).toContain('Bootstrap brownfield');
    expect(output).toContain('Mapa de módulos');
    expect(output).toContain('packages/core');
    expect(output).toContain('packages/api');
    expect(output).toContain('Pasos');
    expect(output).toContain('constitution.md');
    expect(existsSync(intelligenceFile(dir))).toBe(false);
    expect(existsSync(constitutionFile(dir))).toBe(false);
  });

  it('resolves the repository root like survey when no target is given', async () => {
    const dir = await createMonorepoFixture();
    await mkdir(path.join(dir, '.sdd'), { recursive: true });
    const { io, logs } = makeIO();

    const code = await handleBrownfieldCommand(['bootstrap'], io, dir);

    expect(code).toBe(0);
    expect(logs.join('\n')).toContain(`raíz: ${dir}`);
  });

  it('--write creates the code-intelligence document and never overwrites an existing constitution', async () => {
    const dir = await createMonorepoFixture();
    await mkdir(path.join(dir, '.sdd', 'steering'), { recursive: true });
    const sentinel = '# Constitución escrita a mano\n';
    await writeFile(constitutionFile(dir), sentinel, 'utf8');

    const { io, logs, errors } = makeIO();
    const code = await handleBrownfieldCommand(['bootstrap', dir, '--write'], io, dir);

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(existsSync(intelligenceFile(dir))).toBe(true);
    expect(await readFile(constitutionFile(dir), 'utf8')).toBe(sentinel);
    expect(logs.join('\n')).toMatch(/se conserva/i);
  });

  it('--write generates the constitution when it does not exist yet', async () => {
    const dir = await createMonorepoFixture();
    const { io } = makeIO();

    const code = await handleBrownfieldCommand(['bootstrap', dir, '--write'], io, dir);

    expect(code).toBe(0);
    expect(existsSync(constitutionFile(dir))).toBe(true);
    expect(await readFile(constitutionFile(dir), 'utf8')).toContain('# Constitution —');
  });

  it('--json prints the plan machine-readably', async () => {
    const dir = await createMonorepoFixture();
    const { io, logs } = makeIO();

    const code = await handleBrownfieldCommand(['bootstrap', dir, '--json'], io, dir);

    expect(code).toBe(0);
    const parsed = JSON.parse(logs.join('\n'));
    expect(parsed.root).toBe(dir);
    expect(parsed.modules.map((module: { path: string }) => module.path)).toContain('packages/api');
    expect(Array.isArray(parsed.steps)).toBe(true);
    expect(Array.isArray(parsed.artifacts)).toBe(true);
  });
});
