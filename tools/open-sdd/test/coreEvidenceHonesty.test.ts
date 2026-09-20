/**
 * Evidence honesty: the code must say only what reconnaissance observed.
 *
 * Five reviewer defects share one shape — a claim stronger than the evidence behind it: fabricated
 * steering (a "Native test runner" and a `test/` directory nobody saw, a TDD discipline nothing
 * enforces), an invented test command presented as verified, a template marker that silently
 * corrupted task ids, and a template placeholder reported as a requirement id that does not exist.
 *
 * Every fixture lives in `mkdtemp` and is removed in `afterEach`; nothing is written inside the
 * repository. The CLI probe uses the imported handler, never the `open-sdd` on PATH.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bootstrapSteering } from '../src/core/reverseEngineering.js';
import { testCommandFor, extractContracts } from '../src/core/executionContract.js';
import { parseTasksMarkdown } from '../src/core/specManager.js';
import { traceDelta, type DeltaSpec } from '../src/core/deltaSpec.js';
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

const write = async (root: string, rel: string, content: string): Promise<void> => {
  const full = path.join(root, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
};

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

const readSteering = async (root: string, file: string): Promise<string> =>
  readFile(path.join(root, '.sdd', 'steering', file), 'utf8');

describe('bootstrapSteering — dice solo lo que el reconocimiento observó', () => {
  it('sin runner observado: lo dice y no inventa ni TDD ni un directorio de test', async () => {
    const root = await makeTemp('open-sdd-honesty-bare-');
    // A manifest with no test dependency, no test script and no test directory: the scan observes
    // no runner, and that absence is the only thing the steering may report.
    await write(root, 'package.json', JSON.stringify({ name: 'bare-fixture', dependencies: {} }, null, 2));

    await bootstrapSteering(root);

    const tech = await readSteering(root, 'tech.md');
    expect(tech).toContain('no se observó ningún runner de test');
    expect(tech).not.toContain('TDD required');
    expect(tech).not.toContain('Native test runner');
    // No fabricated test directory anywhere in the technical steering.
    expect(tech).not.toContain('test/');

    // Defect 5: structure.md used to fall back to a fabricated `test/`.
    const structure = await readSteering(root, 'structure.md');
    expect(structure).toContain('no se observó ningún directorio de test');
    expect(structure).not.toContain('Test directories: test/');
  });

  it('con runner declarado: lo nombra y usa el comando que el repositorio declara', async () => {
    const root = await makeTemp('open-sdd-honesty-runner-');
    await write(
      root,
      'package.json',
      JSON.stringify(
        {
          name: 'runner-fixture',
          devDependencies: { vitest: '^4.0.0' },
          scripts: { test: 'vitest run' },
        },
        null,
        2,
      ),
    );
    await write(root, 'test/session.test.ts', 'export const ok = true;\n');

    await bootstrapSteering(root);

    const tech = await readSteering(root, 'tech.md');
    expect(tech).toContain('Vitest');
    // The real command the project declares, with the script it comes from as evidence.
    expect(tech).toContain('`npm test`');
    expect(tech).toContain('vitest run');

    const structure = await readSteering(root, 'structure.md');
    expect(structure).toContain('test');
  });

  it('con runner observado pero sin script: nombra el runner y marca el comando como derivado', async () => {
    const root = await makeTemp('open-sdd-honesty-derived-');
    await write(
      root,
      'package.json',
      JSON.stringify({ name: 'derived-fixture', devDependencies: { vitest: '^4.0.0' } }, null, 2),
    );

    await bootstrapSteering(root);

    const tech = await readSteering(root, 'tech.md');
    expect(tech).toContain('Vitest');
    expect(tech).toContain('npx vitest run');
    expect(tech).toContain('derivado');
    expect(tech).toContain('no verificado');
  });
});

describe('testCommandFor — un framework desconocido produce un comando DERIVADO', () => {
  it('marca `npm test` como derivado cuando no hay framework', () => {
    expect(testCommandFor(undefined)).toEqual({ command: 'npm test', derived: true });
    expect(testCommandFor('')).toEqual({ command: 'npm test', derived: true });
    expect(testCommandFor('framework-que-nadie-declara')).toEqual({ command: 'npm test', derived: true });
  });

  it('el runner reconocido también se marca derivado (derivado del nombre, no verificado)', () => {
    expect(testCommandFor('Vitest')).toEqual({ command: 'npx vitest run', derived: true });
    expect(testCommandFor('Jest')).toEqual({ command: 'npx jest', derived: true });
  });

  it('la CLI imprime la marca (derivado, no verificado) para el comando inventado', async () => {
    const root = await makeTemp('open-sdd-honesty-cli-');
    await write(root, 'package.json', JSON.stringify({ name: 'cli-fixture', dependencies: {} }, null, 2));
    await write(root, 'src/free.ts', 'export const free = 1;\n');
    await mkdir(path.join(root, '.sdd', 'specs', 'demo'), { recursive: true });

    // `contracts` analyses the working tree through git; the untracked source file is the change.
    const git = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
    expect(git.status, `git init falló: ${git.stderr}`).toBe(0);

    const { io, logs } = makeIO();
    const code = await handleBrownfieldCommand(['contracts', 'demo'], io, root);

    expect(code).toBe(0);
    expect(logs.join('\n')).toContain('npm test (derivado, no verificado)');
  });

  it('el detalle de extractContracts dice que el comando por defecto es una suposición', async () => {
    const root = await makeTemp('open-sdd-honesty-detail-');
    await write(root, 'package.json', JSON.stringify({ name: 'detail-fixture', dependencies: {} }, null, 2));

    const set = await extractContracts({ cwd: root, changedFiles: ['src/free.ts'] });
    expect(set.testCommand).toBe('npm test');
    expect(set.detail).toContain('No se detectó framework');
    expect(set.detail).toContain('suposición derivada');
  });
});

describe('parseTasksMarkdown — el marcador diferido no corrompe el id', () => {
  it('lee `- [ ]*` como tarea diferida con su id real, nunca como `task-1`', () => {
    const tasks = parseTasksMarkdown(['# Tasks', '- [ ]* 1.4 Añadir test diferido'].join('\n'));

    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('1.4');
    expect(tasks[0].id).not.toBe('task-1');
    expect(tasks[0].deferred).toBe(true);
    expect(tasks[0].title).toBe('1.4 Añadir test diferido');
    expect(tasks[0].title).not.toContain('*');
  });

  it('un checkbox normal sigue sin marcador de diferido', () => {
    const [task] = parseTasksMarkdown('- [ ] 1.5 Tarea normal');
    expect(task.id).toBe('1.5');
    expect(task.deferred).toBeUndefined();
  });
});

describe('traceDelta — placeholder sin rellenar ≠ id inexistente', () => {
  const spec = (ids: string[]): DeltaSpec => ({
    feature: 'orden',
    title: 'Cambio de orden',
    status: 'proposed',
    entries: ids.map((id) => ({ id, kind: 'ADDED' as const, title: id, statement: id, targets: ['src/order.ts'] })),
  });

  it('reporta `{{...}}` como UNFILLED_REQUIREMENT_PLACEHOLDER y no como fantasma', () => {
    const tasks = parseTasksMarkdown(
      [
        '- [ ] 1.1 Rellenar la plantilla _Requirements: {{REQ-ORD-001}}_',
        '- [ ] 1.2 Con marcador genérico _Requirements: {{REQUIREMENT_IDS}}_',
      ].join('\n'),
    );

    const trace = traceDelta(spec(['REQ-ORD-001']), tasks);

    expect(trace.unfilledPlaceholders).toEqual([
      { taskId: '1.1', cited: '{{REQ-ORD-001}}', code: 'UNFILLED_REQUIREMENT_PLACEHOLDER' },
      { taskId: '1.2', cited: '{{REQUIREMENT_IDS}}', code: 'UNFILLED_REQUIREMENT_PLACEHOLDER' },
    ]);
    // The id INSIDE the braces is not reported as an id the author never wrote.
    expect(trace.phantomTasks).toEqual([]);
    expect(trace.detail).toContain('UNFILLED_REQUIREMENT_PLACEHOLDER');
  });

  it('un id realmente desconocido sigue siendo un fantasma', () => {
    const tasks = parseTasksMarkdown('- [ ] 1.2 Auditar _Requirements: REQ-XX-999_');

    const trace = traceDelta(spec(['REQ-ORD-001']), tasks);

    expect(trace.phantomTasks).toEqual([{ taskId: '1.2', cited: 'REQ-XX-999' }]);
    expect(trace.unfilledPlaceholders).toEqual([]);
    expect(trace.unmapped).toEqual(['REQ-ORD-001']);
  });
});
