/**
 * Pruebas de la superficie de consola de `brownfield converge`.
 *
 * Lo que se afirma: sin `--write` se imprime la tabla y NO se toca `tasks.md`; con `--write` se
 * anexa y se reportan `tasksBefore`/`tasksAfter`; el código de salida es 1 solo cuando hay un hueco
 * `high`; sin `requirements.md` el mensaje nombra el comando a ejecutar primero y no hay salida
 * parcial; `--max N` acota cuántas tareas se anexan; y el sobre `--json` es JSON parseable con la
 * forma estable de `jsonOut`. Los fixtures viven en `os.tmpdir()` y se limpian en `afterEach`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleBrownfieldCommand } from '../src/cli/commands/brownfield.js';
import { runCli } from '../src/index.js';
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
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
    exit: () => undefined,
  };
  return { io, logs, errors };
};

const writeText = async (dir: string, rel: string, content: string): Promise<void> => {
  const absolute = path.join(dir, rel);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf8');
};

const REQUIREMENTS = `# Requirements: demo

### REQ-DEMO-001 — Capability one
- When the demo runs, the system shall do the demo thing.

### REQ-DEMO-002 — Capability two
- When the demo runs again, the system shall do the second thing.
`;

const taskOne = `- [x] 1. Implement the demo — _Requirements: REQ-DEMO-001_ — _Boundary:_ \`src/demo.ts\`_
  - _Evidence: \`vitest run\` → 1 passed._
`;

const writeFixture = async (
  dir: string,
  tasks: string,
  options: { requirements?: boolean } = {},
): Promise<void> => {
  await writeText(
    dir,
    'package.json',
    `${JSON.stringify({ name: 'converge-cli', private: true, scripts: { test: 'vitest run' } }, null, 2)}\n`,
  );
  await writeText(dir, 'src/demo.ts', 'export const demo = (): string => "demo";\n');
  if (options.requirements !== false) {
    await writeText(dir, '.sdd/specs/demo/requirements.md', REQUIREMENTS);
  }
  await writeText(dir, '.sdd/specs/demo/tasks.md', tasks);
};

const tasksPath = (dir: string): string => path.join(dir, '.sdd', 'specs', 'demo', 'tasks.md');

const jsonOf = (logs: string[]): any => JSON.parse(logs.filter((line) => line.trim().startsWith('{')).join('\n'));

describe('brownfield converge · CLI', () => {
  it('sin --write imprime la tabla y no toca tasks.md, con salida 0 si no hay huecos altos', async () => {
    const dir = await makeTemp('cli-converge-readonly-');
    // REQ-DEMO-002 queda a medias (medium): hay hallazgo, pero ningún `high`.
    await writeFixture(dir, `${taskOne}- [ ] 2. Implement the second thing — _Requirements: REQ-DEMO-002_ — _Boundary:_ \`src/demo.ts\`_\n`);
    const before = await readFile(tasksPath(dir));

    const { io, logs, errors } = makeIO();
    const code = await handleBrownfieldCommand(['converge', 'demo'], io, dir);

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);
    const output = logs.join('\n');
    expect(output).toContain('Convergencia brownfield — demo');
    expect(output).toContain('partial');
    expect(output).toContain('REQ-DEMO-002');
    expect(output).toContain('evidencia:');
    expect(output).toContain('métricas:');
    expect(output).toContain('Sin --write no se ha tocado tasks.md.');
    expect(await readFile(tasksPath(dir))).toEqual(before);
  });

  it('sale con 1 cuando hay un hueco `high` (requisito sin tarea)', async () => {
    const dir = await makeTemp('cli-converge-high-');
    await writeFixture(dir, taskOne); // REQ-DEMO-002 sin tarea → missing/high

    const { io, logs } = makeIO();
    const code = await handleBrownfieldCommand(['converge', 'demo'], io, dir);

    expect(code).toBe(1);
    expect(logs.join('\n')).toContain('missing');
  });

  it('con --write anexa una sección y reporta tasksBefore/tasksAfter', async () => {
    const dir = await makeTemp('cli-converge-write-');
    await writeFixture(dir, taskOne); // missing/high → exit 1 pero se anexa

    const { io, logs } = makeIO();
    const code = await handleBrownfieldCommand(['converge', 'demo', '--write'], io, dir);

    expect(code).toBe(1);
    const output = logs.join('\n');
    expect(output).toContain('tareas: 1 → 2');
    const after = await readFile(tasksPath(dir), 'utf8');
    expect(after).toContain('## Phase 1: Convergence');
    expect(after).toContain('_Requirements: REQ-DEMO-002_');
    expect(after).toContain('_TDD:_ `vitest run`_');
    expect(after).toContain('_Convergence: F-');
    expect(after.startsWith(taskOne)).toBe(true);
  });

  it('--max N acota cuántas tareas se anexan', async () => {
    const dir = await makeTemp('cli-converge-max-');
    await writeFixture(
      dir,
      `${taskOne}- [ ] 2. Implement the second thing — _Requirements: REQ-DEMO-002_ — _Boundary:_ \`src/demo.ts\`_\n`,
    );

    const { io, logs } = makeIO();
    const code = await handleBrownfieldCommand(['converge', 'demo', '--max', '1', '--write'], io, dir);

    expect(code).toBe(0);
    expect(logs.join('\n')).toContain('tareas: 2 → 3');
    const after = await readFile(tasksPath(dir), 'utf8');
    expect((after.match(/_Convergence: F-/g) ?? []).length).toBe(1);
  });

  it('sin requirements.md nombra el comando a ejecutar primero y no produce salida parcial', async () => {
    const dir = await makeTemp('cli-converge-prereq-');
    await writeFixture(dir, taskOne, { requirements: false });

    const { io, logs, errors } = makeIO();
    const code = await handleBrownfieldCommand(['converge', 'demo'], io, dir);

    expect(code).toBe(1);
    expect(logs).toHaveLength(0);
    expect(errors.join('\n')).toContain('/sdd-spec-requirements demo');
    expect(errors.join('\n')).toContain('Nada se ha escrito');
    // Nada se anexó: el fichero sigue exactamente igual.
    expect(await readFile(tasksPath(dir), 'utf8')).toBe(taskOne);
  });

  it('emite un sobre JSON parseable (forma estable de jsonOut)', async () => {
    const dir = await makeTemp('cli-converge-json-');
    await writeFixture(dir, taskOne); // missing/high

    const { io, logs } = makeIO();
    const code = await handleBrownfieldCommand(['converge', 'demo', '--json'], io, dir);

    expect(code).toBe(1);
    const envelope = jsonOf(logs);
    expect(envelope.command).toBe('brownfield converge');
    expect(envelope.ok).toBe(false);
    expect(Array.isArray(envelope.findings.errors)).toBe(true);
    expect(Array.isArray(envelope.findings.warnings)).toBe(true);
    expect(envelope.data.feature).toBe('demo');
    expect(envelope.data.metrics.byGapType.missing).toBe(1);
    expect(envelope.data.metrics.byGapType.unprotected).toBe(0);
    expect(envelope.data.converged).toBe(false);
    expect(typeof envelope.detail).toBe('string');
  });

  it('el despachador real enruta `brownfield converge` y devuelve el mismo código', async () => {
    const dir = await makeTemp('cli-converge-dispatch-');
    await writeFixture(dir, taskOne); // missing/high

    const { io, logs } = makeIO();
    const code = await runCli(
      ['brownfield', 'converge', 'demo', '--no-footer'],
      { platform: 'darwin' } as const,
      io,
      {},
      { cwd: dir },
    );

    expect(code).toBe(1);
    expect(logs.join('\n')).toContain('Convergencia brownfield — demo');
  });
});
