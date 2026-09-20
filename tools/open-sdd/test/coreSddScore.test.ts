/**
 * Pruebas del número compuesto y la fase (`src/core/sddScore.ts`).
 *
 * Los fixtures viven en `os.tmpdir()` y se limpian en `afterEach`: nada se escribe dentro del
 * repositorio. Cada fixture es un repositorio mínimo — constitución + rigor + spec (+ delta) — y lo
 * que se afirma es el NÚMERO, la FASE y la ÚNICA acción siguiente, además de que ningún componente
 * se puntúe cuando no se pudo inspeccionar.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  SDD_SCORE_WEIGHTS,
  computeSddScore,
  explainNextAction,
  renderScoreFooter,
} from '../src/core/sddScore.js';

const dirs: string[] = [];

const makeTmp = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-score-'));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true });
});

const write = async (root: string, rel: string, content: string): Promise<void> => {
  const target = path.join(root, rel);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
};

const CONSTITUTION = [
  '# Constitution — demo',
  '',
  'Provenance: descriptive',
  '',
  '## Principles',
  '',
  '### C-STACK-FACT — Stack en vigor',
  '- Level: SHOULD',
  '- Threat: ADR-001',
  '- Restriction: El stack en vigor (Node.js, TypeScript ESM y vitest) se declara hecho establecido y no se moderniza sin una enmienda gobernada.',
  '- Pattern: Un cambio de stack se tramita como enmienda con plan de migración aprobado.',
  '- Justification: Modernizar sin pedido destruye el comportamiento anclado que nadie autorizó a cambiar en este repositorio.',
  '- Provenance: descriptive',
  '- Evidence: package.json',
  '',
].join('\n');

const REQUIREMENTS = [
  '# Requirements: sesión',
  '',
  '### REQ-SESS-001: Registrar sesión',
  '',
  '- WHEN se invoque el endpoint, the system shall registrar la sesión con su marca de tiempo.',
  '',
].join('\n');

const PLAN = [
  '# Plan: sesión',
  '',
  '## Constitution',
  '',
  '- C-STACK-FACT — el stack en vigor no se moderniza sin una enmienda gobernada.',
  '',
].join('\n');

const TASKS_DONE = [
  '- [x] 1.1 implementar el registro — _Requirements: REQ-SESS-001_ — _Boundary:_ `src/session`',
  '  _Evidence: npx vitest run (3 passed)',
  '',
].join('\n');

const TASKS_OPEN = [
  '- [ ] 1.1 implementar el registro — _Requirements: REQ-SESS-001_ — _Boundary:_ `src/session`',
  '',
].join('\n');

/** La misma tarea, pero sin citar el requisito de la delta: el hueco de trazabilidad. */
const TASKS_NOCITE = [
  '- [x] 1.1 implementar el registro — _Boundary:_ `src/session`',
  '  _Evidence: npx vitest run (3 passed)',
  '',
].join('\n');

const DELTA = [
  '# Delta: session — Registrar sesión',
  '',
  'Status: proposed',
  '',
  '## ADDED',
  '',
  '### REQ-SESS-001 — Registrar sesión',
  '- Statement: WHEN se invoque el endpoint, the system shall registrar la sesión.',
  '- Targets: src/session/register.ts',
  '- Contracts: test/session/register.test.ts',
  '- Strangler: new',
  '',
].join('\n');

interface SeedOptions {
  constitution?: string | null;
  requirements?: string | null;
  plan?: string | null;
  tasks?: string | null;
  delta?: string | null;
  contract?: boolean;
}

const seed = async (root: string, options: SeedOptions = {}): Promise<void> => {
  if (options.constitution !== null) {
    await write(root, '.sdd/steering/constitution.md', options.constitution ?? CONSTITUTION);
  }
  await write(
    root,
    '.sdd/settings/rigor.json',
    JSON.stringify({ level: 'spec-first', rationale: 'Fixture: nivel declarado con motivo explícito.', brownfield: true }, null, 2),
  );
  if (options.requirements !== null) await write(root, '.sdd/specs/session/requirements.md', options.requirements ?? REQUIREMENTS);
  if (options.plan !== null) await write(root, '.sdd/specs/session/plan.md', options.plan ?? PLAN);
  if (options.tasks !== null) await write(root, '.sdd/specs/session/tasks.md', options.tasks ?? TASKS_DONE);
  if (options.delta !== null) await write(root, '.sdd/specs/session/delta.md', options.delta ?? DELTA);
  if (options.contract) await write(root, 'test/session/register.test.ts', 'import { it } from "vitest"; it("x", () => {});');
  await write(root, 'package.json', JSON.stringify({ name: 'demo' }, null, 2));
};

/** El fixture completo: todos los componentes medidos y a 1 salvo la evidencia. */
const seedComplete = async (tasks: string): Promise<string> => {
  const root = await makeTmp();
  await seed(root, { tasks, contract: true });
  return root;
};

describe('core/sddScore — el número compuesto', () => {
  it('declara los siete componentes, con pesos que suman 100 y evidencia obligatoria', async () => {
    const root = await makeTmp();
    await seed(root, { contract: true });

    const report = await computeSddScore(root, { feature: 'session' });

    expect(report.components.map((component) => component.id)).toEqual([
      'constitution',
      'ears',
      'traceability',
      'evidence',
      'contracts',
      'gates',
      'alignment',
    ]);
    expect(report.components.reduce((sum, component) => sum + component.weight, 0)).toBe(100);
    for (const component of report.components) {
      expect(component.weight).toBe(SDD_SCORE_WEIGHTS[component.id as keyof typeof SDD_SCORE_WEIGHTS]);
      expect(component.evidence.trim().length).toBeGreaterThan(0);
      expect(component.score).toBeGreaterThanOrEqual(0);
      expect(component.score).toBeLessThanOrEqual(1);
    }
  });

  it('un directorio vacío da una puntuación baja, Fase 1, un notMeasured con nombre y la constitución como acción', async () => {
    const root = await makeTmp();

    const report = await computeSddScore(root);

    expect(report.total).toBeLessThan(30);
    expect(report.phase).toBe(1);
    expect(report.phaseLabel).toBe('Fase 1 · Especificar');
    expect(report.notMeasured).toContain('trazabilidad');
    expect(report.notMeasured).toContain('evidencia');
    expect(report.nextAction).toBe('open-sdd brownfield constitution . --write');
    expect(explainNextAction(report)).toContain('no hay constitución');
  });

  it('no puntúa 0 ni 1 lo que no pudo inspeccionar: lo declara y excluye su peso del total', async () => {
    const root = await makeTmp();

    const report = await computeSddScore(root);
    const contracts = report.components.find((component) => component.id === 'contracts');

    expect(contracts?.evidence).toContain('NO MEDIDO');
    expect(report.detail).toContain('NO se puntúa 0 ni 1');
    expect(report.detail).toContain('se excluye del denominador');
    // El total es la media de lo MEDIDO: 0 de constitución + 0 de EARS + 0,5 de gates sobre 50.
    expect(report.total).toBe(15);
  });

  it('una especificación completa pero sin implementar da Fase 2 y la implementación como acción', async () => {
    const root = await seedComplete(TASKS_OPEN);

    const report = await computeSddScore(root, { feature: 'session' });

    expect(report.phase).toBe(2);
    expect(report.phaseLabel).toBe('Fase 2 · Implementar');
    expect(report.components.find((component) => component.id === 'evidence')?.score).toBe(0);
    expect(report.nextAction).toBe('open-sdd impl session');
    expect(explainNextAction(report)).toContain('sin evidencia');
  });

  it('una especificación con evidencia y gates que pasan da Fase 3 y el veredicto constitucional como acción', async () => {
    const root = await seedComplete(TASKS_DONE);

    const report = await computeSddScore(root, { feature: 'session' });

    expect(report.phase).toBe(3);
    expect(report.phaseLabel).toBe('Fase 3 · Verificar');
    expect(report.total).toBe(100);
    expect(report.notMeasured).toEqual([]);
    expect(report.nextAction).toBe('open-sdd status --check');
  });

  it('un hueco de trazabilidad baja el total exactamente el peso documentado', async () => {
    const full = await computeSddScore(await seedComplete(TASKS_DONE), { feature: 'session' });
    const gap = await computeSddScore(await seedComplete(TASKS_NOCITE), { feature: 'session' });

    expect(full.components.find((component) => component.id === 'traceability')?.score).toBe(1);
    expect(gap.components.find((component) => component.id === 'traceability')?.score).toBe(0);
    expect(full.notMeasured).toEqual([]);
    expect(gap.notMeasured).toEqual([]);
    expect(full.total - gap.total).toBe(SDD_SCORE_WEIGHTS.traceability);
    expect(gap.nextAction).toBe('open-sdd delta validate session');
  });

  it('sin constitución válida no se declara ninguna fase de implementación', async () => {
    const root = await makeTmp();
    await seed(root, { constitution: '# Constitution — demo\n\nProvenance: descriptive\n\n## Principles\n' });

    const report = await computeSddScore(root, { feature: 'session' });

    expect(report.phase).toBe(1);
    expect(report.components.find((component) => component.id === 'constitution')?.score).toBe(0);
    expect(report.nextAction).toBe('open-sdd brownfield constitution . --write');
  });

  it('sin requirements.md la especificación está incompleta: Fase 1 y la acción de crearla', async () => {
    const root = await makeTmp();
    await seed(root, { requirements: null, contract: true });

    const report = await computeSddScore(root, { feature: 'session' });

    expect(report.phase).toBe(1);
    expect(report.components.find((component) => component.id === 'ears')?.score).toBe(0);
    expect(report.nextAction).toBe('open-sdd init session');
  });
});

describe('core/sddScore — el pie de UNA línea', () => {
  it('es exactamente una línea, con la fase, el porcentaje y UN solo comando', async () => {
    const root = await seedComplete(TASKS_DONE);

    const footer = renderScoreFooter(await computeSddScore(root, { feature: 'session' }));

    expect(footer.split('\n')).toHaveLength(1);
    expect(footer).toContain('SDD 100%');
    expect(footer).toContain('Fase 3 · Verificar');
    expect(footer).toContain('siguiente: open-sdd status --check');
    // Exactamente UN comando: la única aparición de `open-sdd <verbo>` es la acción siguiente.
    expect(footer.match(/open-sdd [a-z-]/g)).toHaveLength(1);
  });

  it('nombra lo no medido en vez de inventarle un porcentaje', async () => {
    const root = await makeTmp();

    const footer = renderScoreFooter(await computeSddScore(root));

    expect(footer).toContain('sin medir: trazabilidad, evidencia, contratos, alineación');
    expect(footer).toContain('Fase 1');
    expect(footer.split('\n')).toHaveLength(1);
    expect(footer.match(/open-sdd [a-z-]/g)).toHaveLength(1);
  });
});
