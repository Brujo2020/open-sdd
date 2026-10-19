/**
 * Los asistentes bajo demanda vistos POR LA CLI: aparecen donde ya está la ambigüedad, con la
 * propuesta concreta, un ejemplo y una única acción; se topan a 3 con la línea "ver más"; no
 * repiten la misma sugerencia entre dos comandos de la misma ejecución; y NUNCA cambian el veredicto
 * del comando que los imprime.
 *
 * Todos los fixtures viven en `os.tmpdir()` y se limpian en `afterEach`: nada se escribe dentro del
 * repositorio.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleBrownfieldCommand, handleDeltaCommand } from '../src/cli/commands/brownfield.js';
import { handleStatusCommand } from '../src/cli/commands/status.js';
import { resetAssistLedger } from '../src/core/assistants.js';
import { renderConstitution, type Constitution } from '../src/core/constitution.js';
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

beforeEach(() => resetAssistLedger());

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

const write = async (root: string, rel: string, content: string): Promise<void> => {
  const target = path.join(root, rel);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
};

const CONSTITUTION: Constitution = {
  project: 'demo',
  provenance: 'descriptive',
  establishedFacts: ['El stack en vigor es Node.js + TypeScript ESM + vitest.'],
  principles: [
    {
      id: 'C-STACK-FACT',
      title: 'Stack en vigor',
      level: 'SHOULD',
      threatReference: 'ADR-001',
      restriction:
        'El stack en vigor (Node.js, TypeScript ESM y vitest) se declara hecho establecido y no se moderniza sin una enmienda gobernada.',
      pattern: 'Un cambio de stack se tramita como enmienda con plan de migración aprobado.',
      justification: 'Modernizar sin pedido destruye el comportamiento anclado que nadie autorizó a cambiar.',
      provenance: 'descriptive',
      evidence: ['src/index.ts'],
    },
  ],
  amendments: [],
};

const VALID_CONSTITUTION_MD = renderConstitution(CONSTITUTION);

const CLEAN_REQUIREMENTS = [
  '# Requirements Document',
  '',
  '## Requirements',
  '',
  '- The [engine] shall keep working with no model backend and no network access.',
  '',
].join('\n');

const VAGUE_REQUIREMENTS = [
  '# Requirements Document',
  '',
  '## Requirements',
  '',
  '- The [engine] shall respond rápido.',
  '',
].join('\n');

const deltaWithStatement = (statement: string, id = 'REQ-DEMO-001'): string =>
  [
    '# Delta: demo — cambio',
    '',
    'Status: proposed',
    '',
    '## ADDED',
    '',
    `### ${id} — Entrada`,
    `- Statement: ${statement}`,
    '- Targets: src/demo.ts',
    '',
  ].join('\n');

const DELTA_COMPOUND = deltaWithStatement('The [drafter] shall emit a draft and shall record the evidence.');
const DELTA_CONFORMING = deltaWithStatement(
  'When a task is traced, the [validator] shall cite the delta requirement it implements.',
);

/** Cuatro compuestos distintos: el tope de 3 tiene que recortar de verdad. */
const DELTA_FOUR = [
  '# Delta: demo — cambio',
  '',
  'Status: proposed',
  '',
  '## ADDED',
  '',
  '### REQ-DEMO-001 — Uno',
  '- Statement: The [drafter] shall emit a draft and shall record the evidence.',
  '- Targets: src/a.ts',
  '',
  '### REQ-DEMO-002 — Dos',
  '- Statement: The [engine] shall parse the file and shall emit a report.',
  '- Targets: src/b.ts',
  '',
  '### REQ-DEMO-003 — Tres',
  '- Statement: The [validator] shall check the id and shall record the verdict.',
  '- Targets: src/c.ts',
  '',
  '### REQ-DEMO-004 — Cuatro',
  '- Statement: The [runner] shall load the config and shall start the job.',
  '- Targets: src/d.ts',
  '',
].join('\n');

const TASKS_WITH_PLACEHOLDERS = [
  '# Tasks',
  '',
  '- [ ] 1.1 Rellenar la plantilla _Requirements: {{REQ-ORD-001}}_',
  '',
].join('\n');

const specRepo = async (options: {
  requirements?: string;
  delta?: string;
  tasks?: string;
  constitution?: string | null;
} = {}): Promise<string> => {
  const dir = await makeTemp('open-sdd-cli-assist-');
  const constitution = options.constitution === undefined ? VALID_CONSTITUTION_MD : options.constitution;
  if (constitution !== null) await write(dir, '.sdd/steering/constitution.md', constitution);
  await write(dir, '.sdd/specs/demo/requirements.md', options.requirements ?? CLEAN_REQUIREMENTS);
  if (options.delta !== undefined) await write(dir, '.sdd/specs/demo/delta.md', options.delta);
  if (options.tasks !== undefined) await write(dir, '.sdd/specs/demo/tasks.md', options.tasks);
  return dir;
};

/** La spec que `status --check` sabe alinear: plan que declara el principio en vigor. */
const statusRepo = async (constitution: string | null): Promise<string> => {
  const dir = await makeTemp('open-sdd-cli-assist-status-');
  if (constitution !== null) await write(dir, '.sdd/steering/constitution.md', constitution);
  await write(
    dir,
    '.sdd/specs/demo/spec.json',
    JSON.stringify({ name: 'demo', version: '1.0.0', phase: 'initialized', language: 'es', description: 'x' }),
  );
  await write(
    dir,
    '.sdd/settings/rigor.json',
    JSON.stringify({ level: 'spec-first', rationale: 'Fixture con motivo declarado.', brownfield: true }, null, 2),
  );
  await write(dir, '.sdd/specs/demo/requirements.md', CLEAN_REQUIREMENTS);
  await write(
    dir,
    '.sdd/specs/demo/plan.md',
    ['# Plan: demo', '', '## Constitution', '', '- C-STACK-FACT — el stack no se moderniza sin una enmienda gobernada.', ''].join('\n'),
  );
  return dir;
};

const assistantLines = (text: string): string[] =>
  text.split('\n').filter((line) => /\[(error|warning|info)\] (ears-|constitution-|unfilled-)/.test(line));

describe('cli/delta validate — el asistente aparece junto al hallazgo', () => {
  it('un compuesto imprime propuesta, ejemplo y acción (no solo el código EARS)', async () => {
    const dir = await specRepo({ delta: DELTA_COMPOUND });
    const { io, logs } = makeIO();

    const code = await handleDeltaCommand(['validate', 'demo'], io, dir);
    const text = logs.join('\n');

    expect(code).toBe(1); // El hallazgo EARS ya fallaba; el asistente no lo cambia.
    expect(text).toContain('Asistente bajo demanda');
    expect(text).toContain('ears-ambiguity');
    expect(text).toContain('propuesta: The [drafter] shall emit a draft.');
    expect(text).toContain('ejemplo:');
    expect(text).toContain('acción: open-sdd brownfield requirements demo --suggest');
  });

  it('un marcador sin rellenar es su propia sugerencia con el texto exacto a sustituir, y no cambia el veredicto', async () => {
    const dir = await specRepo({ delta: DELTA_CONFORMING, tasks: TASKS_WITH_PLACEHOLDERS });
    const { io, logs } = makeIO();

    const code = await handleDeltaCommand(['validate', 'demo'], io, dir);
    const text = logs.join('\n');

    // El marcador no es un error de la delta: el comando sigue saliendo 0 y el asistente lo dice.
    expect(code).toBe(0);
    expect(text).toContain('unfilled-placeholder');
    expect(text).toContain('Sustituye exactamente {{REQ-ORD-001}} por REQ-ORD-001');
    expect(text).toContain('acción: open-sdd delta validate demo');
  });

  it('con más de 3 hallazgos muestra 3 y una línea "ver más"', async () => {
    const dir = await specRepo({ delta: DELTA_FOUR });
    const { io, logs } = makeIO();

    const code = await handleDeltaCommand(['validate', 'demo'], io, dir);
    const text = logs.join('\n');

    expect(code).toBe(1);
    expect(assistantLines(text)).toHaveLength(3);
    expect(text).toContain('ver más: open-sdd brownfield requirements demo --suggest');
  });

  it('sin hallazgos no imprime nada del asistente (silencio, no ruido)', async () => {
    const dir = await specRepo({ delta: DELTA_CONFORMING });
    const { io, logs } = makeIO();

    await handleDeltaCommand(['validate', 'demo'], io, dir);

    expect(logs.join('\n')).not.toContain('Asistente bajo demanda');
  });
});

describe('cli/brownfield requirements — el asistente aparece sin --suggest', () => {
  it('con un aviso EARS imprime la propuesta y NO cambia el exit 0', async () => {
    const dir = await specRepo({ requirements: VAGUE_REQUIREMENTS });
    const { io, logs } = makeIO();

    const code = await handleBrownfieldCommand(['requirements', 'demo'], io, dir);
    const text = logs.join('\n');

    expect(code).toBe(0); // Un aviso no bloquea, y el asistente tampoco.
    expect(text).toContain('Asistente bajo demanda');
    expect(text).toContain('ears-ambiguity');
    expect(text).toContain('Falta información:');
  });

  it('con --suggest no repite el bloque del asistente: el informe ya trae las propuestas', async () => {
    const dir = await specRepo({ requirements: VAGUE_REQUIREMENTS });
    const { io, logs } = makeIO();

    await handleBrownfieldCommand(['requirements', 'demo', '--suggest'], io, dir);

    expect(logs.join('\n')).not.toContain('Asistente bajo demanda');
  });

  it('no repite entre dos comandos de la misma ejecución', async () => {
    const dir = await specRepo({ delta: DELTA_COMPOUND });
    const first = makeIO();
    const second = makeIO();

    await handleDeltaCommand(['validate', 'demo'], first.io, dir);
    await handleBrownfieldCommand(['requirements', 'demo'], second.io, dir);

    const combined = [...first.logs, ...second.logs].join('\n');
    // El mismo requisito compuesto lo ven los dos comandos; aparece UNA vez.
    expect(combined.match(/\[error\] ears-ambiguity/g) ?? []).toHaveLength(1);
  });
});

describe('cli/status --check — el asistente aparece cuando falta la constitución', () => {
  it('sin constitución colabora con crearla, y el veredicto (1) no cambia por ello', async () => {
    const dir = await statusRepo(null);
    const { io, logs } = makeIO();

    const code = await handleStatusCommand(['demo', '--check'], io, dir);
    const text = logs.join('\n');

    // El pivote ya falla sin constitución: el asistente informa, no bloquea ni perdona.
    expect(code).toBe(1);
    expect(text).toContain('Asistente bajo demanda');
    expect(text).toContain('constitution-missing');
    expect(text).toContain('open-sdd brownfield constitution . --draft --write');
  });

  it('con la constitución en vigor y sin hallazgos accionables, calla', async () => {
    const dir = await statusRepo(VALID_CONSTITUTION_MD);
    const { io, logs } = makeIO();

    const code = await handleStatusCommand(['demo', '--check'], io, dir);

    expect(code).toBe(0);
    expect(logs.join('\n')).not.toContain('Asistente bajo demanda');
  });
});
