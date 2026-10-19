import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderConstitution, type Constitution } from '../src/core/constitution.js';
import { repairFromSpec, type GeneratorRun } from '../src/core/regeneration.js';

const temps: string[] = [];

const makeTemp = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const write = async (root: string, rel: string, content: string): Promise<void> => {
  const full = path.join(root, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
};

const constitution = (): Constitution => ({
  project: 'demo',
  provenance: 'descriptive',
  establishedFacts: ['El proyecto usa TypeScript.'],
  principles: [
    {
      id: 'P-QUALITY-01',
      title: 'Tests obligatorios',
      level: 'MUST',
      restriction: 'Todo comportamiento se protege con una prueba.',
      pattern: 'Añade una prueba que falle sin el cambio.',
      justification: 'Sin prueba no hay evidencia.',
      provenance: 'descriptive',
      evidence: ['test/'],
    },
  ],
  amendments: [],
});

type Level = 'spec-first' | 'spec-anchored' | 'spec-as-source';

const setup = async (level: Level, options: { constitution?: boolean } = {}): Promise<{ root: string; specPath: string; artifactPath: string }> => {
  const root = await makeTemp('open-sdd-regen-');
  await write(
    root,
    '.sdd/settings/rigor.json',
    JSON.stringify({ level, rationale: 'Prueba del bucle de regeneración.', brownfield: true }, null, 2),
  );
  if (options.constitution !== false) {
    await write(root, '.sdd/steering/constitution.md', renderConstitution(constitution()));
  }
  await write(root, '.sdd/specs/demo/requirements.md', '# Requirements — demo\n');
  await write(root, 'dist/generated.txt', 'v1\n');
  return {
    root,
    specPath: path.join(root, '.sdd', 'specs', 'demo', 'requirements.md'),
    artifactPath: path.join(root, 'dist', 'generated.txt'),
  };
};

const generatorWriting = (rel: string, content: string) => async (_command: string, cwd: string): Promise<GeneratorRun> => {
  await write(cwd, rel, content);
  return { code: 0, stdout: 'ok', stderr: '' };
};

const generatorNoop = async (): Promise<GeneratorRun> => ({ code: 0, stdout: '', stderr: '' });

describe('repairFromSpec — autoridad de la spec', () => {
  it('rechaza por debajo de spec-as-source sin escribir nada', async () => {
    const { root, specPath, artifactPath } = await setup('spec-anchored');
    const specBefore = await readFile(specPath, 'utf8');

    const report = await repairFromSpec({
      cwd: root,
      feature: 'demo',
      target: 'dist/generated.txt',
      command: 'gen',
      write: true,
      runGenerator: generatorWriting('dist/generated.txt', 'v2\n'),
    });

    expect(report.status).toBe('refused');
    expect(report.operable).toBe(false);
    expect(report.regenerated).toBe(false);
    expect(report.recorded).toBe(false);
    expect(report.refusals.join(' ')).toMatch(/spec-as-source/);
    expect(await readFile(specPath, 'utf8')).toBe(specBefore);
    expect(await readFile(artifactPath, 'utf8')).toBe('v1\n');
  });

  it('rechaza cuando la constitución no está en vigor', async () => {
    const { root } = await setup('spec-as-source', { constitution: false });

    const report = await repairFromSpec({
      cwd: root,
      feature: 'demo',
      target: 'dist/generated.txt',
      command: 'gen',
      write: true,
      runGenerator: generatorWriting('dist/generated.txt', 'v2\n'),
    });

    expect(report.status).toBe('refused');
    expect(report.refusals.join(' ')).toMatch(/no está en vigor/);
    expect(report.regenerated).toBe(false);
  });

  it('sin --write es un plan: no registra ni regenera', async () => {
    const { root, specPath, artifactPath } = await setup('spec-as-source');
    const specBefore = await readFile(specPath, 'utf8');

    const report = await repairFromSpec({
      cwd: root,
      feature: 'demo',
      target: 'dist/generated.txt',
      command: 'gen',
      write: false,
      runGenerator: generatorWriting('dist/generated.txt', 'v2\n'),
    });

    expect(report.status).toBe('planned');
    expect(report.recorded).toBe(false);
    expect(report.regenerated).toBe(false);
    expect(await readFile(specPath, 'utf8')).toBe(specBefore);
    expect(await readFile(artifactPath, 'utf8')).toBe('v1\n');
  });
});

describe('repairFromSpec — generador declarado', () => {
  it('se niega honestamente cuando no hay generador declarado', async () => {
    const { root, specPath, artifactPath } = await setup('spec-as-source');

    const report = await repairFromSpec({
      cwd: root,
      feature: 'demo',
      target: 'dist/generated.txt',
      write: true,
      runGenerator: generatorWriting('dist/generated.txt', 'v2\n'),
    });

    expect(report.status).toBe('refused');
    expect(report.regenerated).toBe(false);
    expect(report.matches).toBe(false);
    expect(report.refusals.join(' ')).toMatch(/generador/i);
    // La INTENCIÓN queda registrada en la spec (la spec manda), pero no se afirma reparación.
    expect(report.recorded).toBe(true);
    const specText = await readFile(specPath, 'utf8');
    expect(specText).toContain('## Repairs');
    expect(specText).toContain('dist/generated.txt');
    expect(await readFile(artifactPath, 'utf8')).toBe('v1\n');
  });

  it('registra la reparación en la spec ANTES de regenerar el artefacto', async () => {
    const { root, specPath } = await setup('spec-as-source');
    let specDuringRun = '';

    const report = await repairFromSpec({
      cwd: root,
      feature: 'demo',
      target: 'dist/generated.txt',
      command: 'gen',
      requirement: 'REQ-MAT-015',
      evidence: 'test/coreRegeneration.test.ts::drift',
      write: true,
      runGenerator: async (_command, cwd) => {
        specDuringRun = await readFile(path.join(cwd, '.sdd', 'specs', 'demo', 'requirements.md'), 'utf8');
        await write(cwd, 'dist/generated.txt', 'v2\n');
        return { code: 0, stdout: '', stderr: '' };
      },
    });

    // El registro existía ya cuando el generador se ejecutó: la spec es la fuente, no el acta.
    expect(specDuringRun).toContain('## Repairs');
    expect(specDuringRun).toContain('REQ-MAT-015');
    expect(report.recorded).toBe(true);
    expect(report.status).toBe('in-sync');
    const specText = await readFile(specPath, 'utf8');
    expect(specText).toContain('- Evidence: test/coreRegeneration.test.ts::drift');
  });
});

describe('repairFromSpec — deriva y reconciliación por hash', () => {
  it('informa deriva hasta que el hash del artefacto coincide con el registrado', async () => {
    const { root, artifactPath } = await setup('spec-as-source');

    const first = await repairFromSpec({
      cwd: root,
      feature: 'demo',
      target: 'dist/generated.txt',
      command: 'gen',
      requirement: 'REQ-MAT-015',
      write: true,
      runGenerator: generatorWriting('dist/generated.txt', 'v2\n'),
    });
    expect(first.status).toBe('in-sync');
    expect(first.regenerated).toBe(true);
    expect(first.matches).toBe(true);
    expect(first.drift).toBe(false);
    expect(first.afterHash).toBe(first.recordedHash);
    expect(first.afterHash).not.toBe(first.beforeHash);

    // El artefacto deriva de lo que la spec registró.
    await write(root, 'dist/generated.txt', 'corrupto\n');
    const second = await repairFromSpec({
      cwd: root,
      feature: 'demo',
      target: 'dist/generated.txt',
      command: 'gen',
      requirement: 'REQ-MAT-015',
      write: true,
      runGenerator: generatorWriting('dist/generated.txt', 'v2\n'),
    });

    expect(second.drift).toBe(true);
    expect(second.regenerated).toBe(true);
    expect(second.matches).toBe(true);
    expect(second.status).toBe('in-sync');
    expect(second.afterHash).toBe(first.recordedHash);
    expect(await readFile(artifactPath, 'utf8')).toBe('v2\n');
  });

  it('no declara reparación cuando ningún fichero cambia: informa deriva', async () => {
    const { root } = await setup('spec-as-source');

    // 1ª pasada: se fija el hash esperado.
    await repairFromSpec({
      cwd: root,
      feature: 'demo',
      target: 'dist/generated.txt',
      command: 'gen',
      write: true,
      runGenerator: generatorWriting('dist/generated.txt', 'v2\n'),
    });
    await write(root, 'dist/generated.txt', 'corrupto\n');

    // El generador «termina bien» pero no escribe nada.
    const report = await repairFromSpec({
      cwd: root,
      feature: 'demo',
      target: 'dist/generated.txt',
      command: 'gen',
      write: true,
      runGenerator: generatorNoop,
    });

    expect(report.regenerated).toBe(false);
    expect(report.matches).toBe(false);
    expect(report.status).toBe('drift');
    expect(report.drift).toBe(true);
    expect(report.detail).toMatch(/no se puede afirmar|ningún fichero cambió/i);
  });

  it('una primera reparación sin cambio de fichero nunca se reporta como reparada', async () => {
    const { root, artifactPath } = await setup('spec-as-source');

    const report = await repairFromSpec({
      cwd: root,
      feature: 'demo',
      target: 'dist/generated.txt',
      command: 'gen',
      write: true,
      runGenerator: generatorNoop,
    });

    expect(report.recorded).toBe(true);
    expect(report.regenerated).toBe(false);
    expect(report.matches).toBe(false);
    expect(report.status).toBe('drift');
    expect(report.detail).toMatch(/no se puede afirmar|ningún fichero cambió/i);
    expect(await readFile(artifactPath, 'utf8')).toBe('v1\n');
  });
});
