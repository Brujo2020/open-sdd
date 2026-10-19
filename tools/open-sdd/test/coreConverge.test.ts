/**
 * Pruebas de `core/converge.ts`: la convergencia brownfield medida por el motor.
 *
 * Lo que se afirma, en el orden de los seis tipos de hueco y de las garantías:
 *   1. un contrato declarado que no existe es `unprotected`/high y la evidencia es la ruta;
 *   2. una tarea `[x]` sin `_Evidence:` es `unbound`/high y la evidencia es `tasks.md:<línea>`;
 *   3. un requisito satisfecho por el código NO se reporta (prueba de ruido);
 *   4. un repositorio limpio da `converged: true`, cero hallazgos y `tasks.md` byte a byte igual;
 *   5. dos ejecuciones no duplican el hueco (idempotencia por huella estable);
 *   6. la sección anexada la leen los parsers reales y mejora la trazabilidad;
 *   7. cuando la fuente no se puede leer, `notChecked` lo dice y NO se declara convergencia;
 *   8. los tipos `contradicts` y `unrequested` también se miden.
 *
 * Los fixtures viven en `os.tmpdir()` y se limpian en `afterEach`: nunca se escribe en el repositorio.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  analyseConvergence,
  appendConvergence,
  convergeExitCode,
  convergenceFingerprint,
  fingerprintsInTasks,
} from '../src/core/converge.js';
import { parseRequirementsMarkdown, parseTasksMarkdown } from '../src/core/specManager.js';
import { traceDelta, type DeltaSpec } from '../src/core/deltaSpec.js';

const temps: string[] = [];

const makeTemp = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const writeText = async (dir: string, rel: string, content: string): Promise<void> => {
  const absolute = path.join(dir, rel);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf8');
};

const writeSpec = async (
  dir: string,
  feature: string,
  files: { requirements?: string; tasks?: string; delta?: string; plan?: string },
): Promise<void> => {
  for (const [name, content] of Object.entries(files)) {
    if (content === undefined) continue;
    await writeText(dir, path.posix.join('.sdd', 'specs', feature, `${name}.md`), content);
  }
};

/** Proyecto mínimo: manifiesto con `scripts.test` real, código y un directorio de test observables. */
const writeProject = async (dir: string): Promise<void> => {
  await writeText(
    dir,
    'package.json',
    `${JSON.stringify(
      { name: 'converge-fixture', private: true, scripts: { test: 'vitest run' }, devDependencies: { vitest: '^4.0.18' } },
      null,
      2,
    )}\n`,
  );
  await writeText(dir, 'src/demo.ts', 'export const demo = (): string => "demo";\n');
  await writeText(dir, 'test/demo.test.ts', 'export const test = (): void => undefined;\n');
};

const REQUIREMENT = `# Requirements: demo

### REQ-DEMO-001 — Capability one
- When the demo runs, the system shall do the demo thing.

### REQ-DEMO-002 — Capability two
- When the demo runs again, the system shall do the second thing.
`;

const taskOne = (evidence: boolean): string =>
  `- [x] 1. Implement the demo — _Requirements: REQ-DEMO-001_ — _Boundary:_ \`src/demo.ts\`_` +
  (evidence ? '\n  - _Evidence: `vitest run` → 1 passed._\n' : '\n');

const deltaWithContract = (contract: string): string => `# Delta: demo — Un cambio

Status: approved

## ADDED

### REQ-DEMO-001 — Capability one
- Statement: WHEN the demo runs, the [demo] shall do the demo thing.
- Targets: src/demo.ts
- Contracts: ${contract}
- Strangler: new
`;

/** Traza de referencia construida con los ids de requirements.md, para medir cobertura. */
const requirementTrace = (requirements: string): DeltaSpec => ({
  feature: 'demo',
  title: 'requirements.md',
  status: 'approved',
  entries: parseRequirementsMarkdown(requirements).map((item) => ({
    id: item.id.toUpperCase(),
    kind: 'ADDED' as const,
    title: '',
    statement: '',
    targets: [],
  })),
});

const coverageOf = (requirements: string, tasks: string): number =>
  traceDelta(
    requirementTrace(requirements),
    parseTasksMarkdown(tasks).map((task) => ({ id: task.id, raw: task.raw })),
  ).coverage;

describe('converge · tipos de hueco', () => {
  it('reporta `unprotected`/high con la ruta del contrato declarado como evidencia', async () => {
    const dir = await makeTemp('converge-unprotected-');
    await writeProject(dir);
    await writeSpec(dir, 'demo', {
      requirements: REQUIREMENT,
      tasks: taskOne(true),
      delta: deltaWithContract('test/missing.test.ts'),
    });

    const report = await analyseConvergence({ cwd: dir, feature: 'demo', changedFiles: [] });

    const finding = report.findings.find((item) => item.gapType === 'unprotected');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('high');
    expect(finding!.source).toBe('test/missing.test.ts');
    expect(finding!.evidence.some((item) => item.includes('test/missing.test.ts'))).toBe(true);
    expect(finding!.evidence.some((item) => item.includes('no existe'))).toBe(true);
    expect(convergeExitCode(report)).toBe(1);
    expect(report.converged).toBe(false);
  });

  it('reporta `unbound`/high con `tasks.md:<línea>` cuando una tarea completada no lleva `_Evidence:`', async () => {
    const dir = await makeTemp('converge-unbound-');
    await writeProject(dir);
    await writeSpec(dir, 'demo', { requirements: REQUIREMENT, tasks: taskOne(false) });

    const report = await analyseConvergence({ cwd: dir, feature: 'demo', changedFiles: [] });

    const finding = report.findings.find((item) => item.gapType === 'unbound');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('high');
    expect(finding!.source).toBe('1');
    expect(finding!.evidence).toContain('.sdd/specs/demo/tasks.md:1');
    expect(finding!.evidence.some((item) => item.includes('checkEvidenceLock'))).toBe(true);
    expect(convergeExitCode(report)).toBe(1);
  });

  it('NO reporta un requisito que el código ya satisface (prueba de ruido)', async () => {
    const dir = await makeTemp('converge-clean-noise-');
    await writeProject(dir);
    await writeSpec(dir, 'demo', {
      requirements: REQUIREMENT,
      tasks: `${taskOne(true)}\n- [x] 2. Implement the second thing — _Requirements: REQ-DEMO-002_ — _Boundary:_ \`src/demo.ts\`_\n  - _Evidence: \`vitest run\` → 1 passed._\n`,
    });

    const report = await analyseConvergence({ cwd: dir, feature: 'demo', changedFiles: [] });

    expect(report.findings.filter((item) => item.source === 'REQ-DEMO-001')).toHaveLength(0);
    expect(report.findings.filter((item) => item.source === 'REQ-DEMO-002')).toHaveLength(0);
    expect(report.metrics.byGapType.unbound).toBe(0);
    expect(report.metrics.byGapType.partial).toBe(0);
  });

  it('reporta `contradicts`/high cuando una tarea cita un id que la spec no define', async () => {
    const dir = await makeTemp('converge-phantom-');
    await writeProject(dir);
    await writeSpec(dir, 'demo', {
      requirements: REQUIREMENT,
      tasks: '- [ ] 1. Cita fantasma — _Requirements: REQ-DEMO-099_ — _Boundary:_ `src/demo.ts`_\n',
    });

    const report = await analyseConvergence({ cwd: dir, feature: 'demo', changedFiles: [] });

    const finding = report.findings.find((item) => item.gapType === 'contradicts');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('high');
    expect(finding!.source).toBe('REQ-DEMO-099');
    expect(finding!.evidence.some((item) => item.includes('tasks.md:1'))).toBe(true);
  });

  it('reporta `unrequested`/low para un export cambiado que ningún requisito nombra', async () => {
    const dir = await makeTemp('converge-unrequested-');
    await writeProject(dir);
    await writeText(dir, 'src/core/extra.ts', 'export const mysteryHelper = (): string => "x";\n');
    await writeSpec(dir, 'demo', {
      requirements: REQUIREMENT,
      tasks: `${taskOne(true)}- [x] 2. Implement the second thing — _Requirements: REQ-DEMO-002_ — _Boundary:_ \`src/core\`_\n  - _Evidence: \`vitest run\` → 1 passed._\n`,
    });

    const report = await analyseConvergence({
      cwd: dir,
      feature: 'demo',
      changedFiles: ['src/core/extra.ts'],
    });

    const finding = report.findings.find((item) => item.gapType === 'unrequested');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('low');
    expect(finding!.source).toBe('src/core/extra.ts');
    expect(finding!.evidence.some((item) => item.includes('src/core/extra.ts:1'))).toBe(true);
    expect(convergeExitCode(report)).toBe(0);
  });
});

describe('converge · append-only, byte a byte, e idempotencia', () => {
  it('un repositorio limpio da `converged: true`, cero hallazgos y el fichero intacto', async () => {
    const dir = await makeTemp('converge-clean-');
    await writeProject(dir);
    const tasks = `${taskOne(true)}\n- [x] 2. Implement the second thing — _Requirements: REQ-DEMO-002_ — _Boundary:_ \`src/demo.ts\`_\n  - _Evidence: \`vitest run\` → 1 passed._\n`;
    await writeSpec(dir, 'demo', { requirements: REQUIREMENT, tasks });
    const tasksPath = path.join(dir, '.sdd', 'specs', 'demo', 'tasks.md');
    const before = await readFile(tasksPath);

    const report = await analyseConvergence({ cwd: dir, feature: 'demo', changedFiles: [] });

    expect(report.findings).toHaveLength(0);
    expect(report.converged).toBe(true);
    expect(report.appended).toBe(tasks);
    const appended = await appendConvergence({ cwd: dir, feature: 'demo', report, write: true });
    expect(appended.written).toBe(false);
    expect(appended.tasksAfter).toBe(report.tasksBefore);
    expect(await readFile(tasksPath)).toEqual(before);
  });

  it('dos ejecuciones no duplican el hueco y la segunda no escribe nada', async () => {
    const dir = await makeTemp('converge-idempotent-');
    await writeProject(dir);
    const tasks = `${taskOne(true)}\n- [ ] 2. Implement the second thing — _Requirements: REQ-DEMO-002_ — _Boundary:_ \`src/demo.ts\`_\n`;
    await writeSpec(dir, 'demo', { requirements: REQUIREMENT, tasks });

    const first = await analyseConvergence({ cwd: dir, feature: 'demo', changedFiles: [] });
    expect(first.findings.map((item) => item.gapType)).toEqual(['partial']);
    const firstFingerprint = convergenceFingerprint(first.findings[0]);
    expect(first.appended).not.toBeNull();

    const written = await appendConvergence({ cwd: dir, feature: 'demo', report: first, write: true });
    expect(written.written).toBe(true);
    expect(written.tasksAfter).toBe(first.tasksBefore + 1);

    const tasksPath = path.join(dir, '.sdd', 'specs', 'demo', 'tasks.md');
    const afterFirst = await readFile(tasksPath, 'utf8');
    expect(fingerprintsInTasks(afterFirst).has(firstFingerprint)).toBe(true);
    expect((afterFirst.match(/_Convergence: F-/g) ?? []).length).toBe(1);

    const second = await analyseConvergence({ cwd: dir, feature: 'demo', changedFiles: [] });
    expect(second.findings).toHaveLength(0);
    expect(second.converged).toBe(true);
    expect(second.appended).toBe(afterFirst);

    const secondWrite = await appendConvergence({ cwd: dir, feature: 'demo', report: second, write: true });
    expect(secondWrite.written).toBe(false);
    expect(await readFile(tasksPath, 'utf8')).toBe(afterFirst);
  });

  it('la sección anexada la leen los parsers reales y mejora la trazabilidad', async () => {
    const dir = await makeTemp('converge-trace-');
    await writeProject(dir);
    const tasks = taskOne(true); // REQ-DEMO-002 no tiene ninguna tarea → missing/high
    await writeSpec(dir, 'demo', { requirements: REQUIREMENT, tasks });

    const beforeCoverage = coverageOf(REQUIREMENT, tasks);
    expect(beforeCoverage).toBeLessThan(1);

    const report = await analyseConvergence({ cwd: dir, feature: 'demo', changedFiles: [] });
    const missing = report.findings.find((item) => item.gapType === 'missing' && item.source === 'REQ-DEMO-002');
    expect(missing).toBeDefined();
    expect(missing!.severity).toBe('high');

    const written = await appendConvergence({ cwd: dir, feature: 'demo', report, write: true });
    expect(written.written).toBe(true);

    const after = await readFile(path.join(dir, '.sdd', 'specs', 'demo', 'tasks.md'), 'utf8');
    const parsed = parseTasksMarkdown(after);
    const appendedTask = parsed.find((task) => task.id === 'conv-1');
    expect(appendedTask).toBeDefined();
    expect(appendedTask!.status).toBe('pending');
    expect(appendedTask!.raw).toContain('_Requirements: REQ-DEMO-002_');
    expect(appendedTask!.raw).toContain('_Boundary:_');
    expect(appendedTask!.raw).toContain('_TDD:_ `vitest run`_');
    expect(appendedTask!.raw).toContain('_Convergence: F-');
    expect(appendedTask!.boundary).toContain('src/demo.ts');

    // La trazabilidad real mejora: el requisito huérfano pasa a tener tarea.
    const afterCoverage = coverageOf(REQUIREMENT, after);
    expect(afterCoverage).toBeGreaterThan(beforeCoverage);
    expect(afterCoverage).toBe(1);

    // Y la sección va al final, con la cabecera de fase, sin tocar lo anterior.
    expect(after.startsWith(tasks)).toBe(true);
    expect(after).toContain('## Phase 1: Convergence');
  });
});

describe('converge · honestidad sobre lo no inspeccionado', () => {
  it('`notChecked` se puebla y NO se declara convergencia cuando la fuente no se puede leer', async () => {
    const dir = await makeTemp('converge-unreadable-');
    await writeProject(dir);
    await writeSpec(dir, 'demo', { requirements: REQUIREMENT });
    // `tasks.md` como DIRECTORIO: existe (stat) pero no se puede leer como fichero (EISDIR).
    await mkdir(path.join(dir, '.sdd', 'specs', 'demo', 'tasks.md'), { recursive: true });

    const report = await analyseConvergence({ cwd: dir, feature: 'demo', changedFiles: [] });

    expect(report.notChecked.some((item) => item.includes('tasks.md') && item.includes('no se pudo leer'))).toBe(true);
    expect(report.complete).toBe(false);
    expect(report.converged).toBe(false);
    expect(report.appended).toBeNull();
  });

  it('declara el prerrequisito ausente y no produce salida parcial sin requirements.md', async () => {
    const dir = await makeTemp('converge-prereq-');
    await writeProject(dir);
    await writeText(dir, '.sdd/specs/demo/tasks.md', taskOne(true));

    const report = await analyseConvergence({ cwd: dir, feature: 'demo', changedFiles: [] });

    expect(report.findings).toHaveLength(0);
    expect(report.appended).toBeNull();
    expect(report.converged).toBe(false);
    expect(report.detail).toContain('/sdd-spec-requirements demo');
    expect(report.notChecked.some((item) => item.includes('requirements.md'))).toBe(true);
  });

  it('nombra lo que no pudo medir (sin delta, sin constitución, sin diff, sin runner)', async () => {
    const dir = await makeTemp('converge-notchecked-');
    // Sin package.json: no hay runner declarado ni detectado.
    await writeText(dir, 'src/demo.ts', 'export const demo = (): string => "demo";\n');
    await writeSpec(dir, 'demo', { requirements: REQUIREMENT, tasks: taskOne(true) });

    const report = await analyseConvergence({ cwd: dir, feature: 'demo' });

    expect(report.notChecked.some((item) => item.includes('contratos'))).toBe(true);
    expect(report.notChecked.some((item) => item.includes('constitucional'))).toBe(true);
    expect(report.notChecked.some((item) => item.includes('runner de test'))).toBe(true);
    expect(report.notChecked.some((item) => item.includes('código no pedido'))).toBe(true);
    expect(report.checked.length).toBeGreaterThan(0);
  });
});
