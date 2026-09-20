import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanProject } from '../src/core/reverseEngineering.js';
import { buildDescriptiveConstitution, collectRepoFacts } from '../src/core/reverseConstitution.js';
import {
  parseConstitution,
  renderConstitution,
  resolveAuthority,
  validateConstitution,
  type Constitution,
} from '../src/core/constitution.js';
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
 * A workspace layout: the root manifest declares nothing, the real project lives in a nested
 * package. This is the layout the scanner used to report as "JavaScript, no tests".
 */
const createWorkspaceFixture = async (): Promise<string> => {
  const dir = await makeTemp('open-sdd-workspace-');

  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'workspace-root', private: true }, null, 2),
    'utf8',
  );

  await mkdir(path.join(dir, 'tools', 'service', 'src'), { recursive: true });
  await mkdir(path.join(dir, 'tools', 'service', 'test'), { recursive: true });
  await writeFile(
    path.join(dir, 'tools', 'service', 'package.json'),
    JSON.stringify(
      {
        name: '@fixture/service',
        version: '1.0.0',
        devDependencies: { typescript: '^5.9.3', vitest: '^4.0.18' },
      },
      null,
      2,
    ),
    'utf8',
  );
  await writeFile(path.join(dir, 'tools', 'service', 'tsconfig.json'), '{\n  "compilerOptions": {}\n}\n', 'utf8');
  await writeFile(path.join(dir, 'tools', 'service', 'src', 'index.ts'), 'export const service = true;\n', 'utf8');
  await writeFile(path.join(dir, 'tools', 'service', 'test', 'service.test.ts'), 'export const placeholder = true;\n', 'utf8');

  return dir;
};

/** A single-root fixture whose evidence exercises the descriptive constitution generator. */
const createFactsFixture = async (): Promise<string> => {
  const dir = await makeTemp('open-sdd-facts-');
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'facts-fixture' }, null, 2), 'utf8');
  await writeFile(path.join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3 }, null, 2), 'utf8');
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await writeFile(path.join(dir, 'src', 'index.ts'), 'export const api = true;\n', 'utf8');
  // A test directory exists, but nothing declares a test framework: the regression oracle is
  // desired-but-absent and must travel as a proposed amendment, never as a principle.
  await mkdir(path.join(dir, 'test'), { recursive: true });
  return dir;
};

describe('core/brownfield', () => {
  it('scans a workspace: nested package language, test framework, source/test dirs and roots', async () => {
    const dir = await createWorkspaceFixture();

    const project = await scanProject(dir);

    expect(project.language).toBe('TypeScript');
    expect(project.testFramework).toBe('Vitest');
    expect(project.buildTool).toBe('tsc');
    expect(project.packageManager).toBe('npm');
    expect(project.sourceDirs).toContain('tools/service/src');
    expect(project.testDirs).toContain('tools/service/test');
    expect(project.workspaceRoots).toContain('tools/service');
  });

  it('reports `unknown` language instead of guessing when nothing indicates one', async () => {
    const dir = await makeTemp('open-sdd-empty-');

    const project = await scanProject(dir);

    expect(project.language).toBe('unknown');
    expect(project.frameworks).toEqual([]);
    expect(project.sourceDirs).toEqual([]);
    expect(project.testDirs).toEqual([]);
    expect(project.workspaceRoots).toBeUndefined();
  });

  it('generates a descriptive constitution: evidence for every fact, amendments for absences', async () => {
    const dir = await createFactsFixture();
    const project = await scanProject(dir);
    const facts = await collectRepoFacts(dir, project);
    const result = buildDescriptiveConstitution(facts, { generatedAt: '2026-01-01T00:00:00.000Z' });

    expect(facts.lockfile).toBe('package-lock.json');
    expect(facts.publicApiFiles).toContain('src/index.ts');
    expect(result.detected.length).toBeGreaterThan(0);

    // (a) nothing aspirational is emitted as a descriptive fact: every principle cites evidence.
    expect(result.constitution.principles.length).toBeGreaterThan(0);
    for (const principle of result.constitution.principles) {
      expect(principle.provenance).toBe('descriptive');
      expect(principle.evidence).toBeDefined();
      expect((principle.evidence ?? []).length).toBeGreaterThan(0);
      for (const item of principle.evidence ?? []) expect(item.trim().length).toBeGreaterThan(0);
    }

    // (b) a desired-but-absent practice is a proposed amendment, not a principle.
    const proposed = result.constitution.amendments.find((a) => a.id === 'AMD-REGRESSION-ORACLE');
    expect(proposed).toBeDefined();
    expect(proposed?.status).toBe('proposed');
    expect(result.constitution.principles.map((p) => p.id)).not.toContain('C-REGRESSION-ORACLE');
    expect(result.deferred.join(' | ')).toMatch(/no se detectaron tests/i);

    // (c) the generated artifact passes its own validator without blocking issues.
    const errors = validateConstitution(result.constitution).filter((issue) => issue.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('round-trips the generated constitution through render/parse with ids, levels and evidence intact', async () => {
    const dir = await createFactsFixture();
    const project = await scanProject(dir);
    const facts = await collectRepoFacts(dir, project);
    const { constitution } = buildDescriptiveConstitution(facts, { generatedAt: '2026-01-01T00:00:00.000Z' });

    const parsed = parseConstitution(renderConstitution(constitution));

    expect(parsed.principles).toHaveLength(constitution.principles.length);
    const byId = new Map(parsed.principles.map((p) => [p.id, p]));
    for (const original of constitution.principles) {
      const round = byId.get(original.id);
      expect(round).toBeDefined();
      expect(round?.level).toBe(original.level);
      expect(round?.evidence).toEqual(original.evidence);
    }
  });

  it('resolveAuthority accepts principle and requirement ids and rejects unknown citations', () => {
    const constitution: Constitution = {
      project: 'demo',
      provenance: 'descriptive',
      establishedFacts: [],
      amendments: [],
      principles: [
        {
          id: 'C-API-COMPAT',
          title: 'Preservar la compatibilidad de la API pública',
          level: 'SHOULD',
          restriction: 'No romper exportaciones públicas sin una delta que declare la migración.',
          pattern: 'Preferir cambios aditivos antes de retirar símbolos.',
          justification: 'Los consumidores externos no se actualizan en el mismo cambio.',
          provenance: 'descriptive',
          evidence: ['src/index.ts'],
        },
      ],
    };

    const principle = resolveAuthority(constitution, 'C-API-COMPAT');
    expect(principle.known).toBe(true);
    expect(principle.kind).toBe('principle');
    expect(principle.detail).toContain('C-API-COMPAT');

    const requirement = resolveAuthority(constitution, 'REQ-AUTH-001');
    expect(requirement.known).toBe(true);
    expect(requirement.kind).toBe('requirement');

    const unknown = resolveAuthority(constitution, 'NOPE');
    expect(unknown.known).toBe(false);
    expect(unknown.kind).toBe('unknown');
  });

  it('surveys the repository from the CLI and logs the detected language', async () => {
    const dir = await makeTemp('open-sdd-survey-');
    await mkdir(path.join(dir, '.sdd'), { recursive: true });
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'survey-fixture' }, null, 2), 'utf8');

    const { io, logs, errors } = makeIO();
    const code = await handleBrownfieldCommand(['survey'], io, dir);

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(logs.join('\n')).toContain('lenguaje: JavaScript');
  });
});
