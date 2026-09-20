/**
 * Pruebas de comportamiento del asistente EARS POR LA CLI.
 *
 * Fijan las dos reglas que importan: (1) el informe sale con propuestas y ejemplos y el comando sale
 * 1 solo con una sugerencia de severidad `error`; (2) la spec NO se reescribe nunca desde una
 * heurística en bloque — `--write` exige `--apply <índice|código>`, muestra el diff y se niega ante
 * una propuesta que es una pregunta. Todo ocurre en fixtures `mkdtemp`: nada se toca en este repositorio.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleBrownfieldCommand } from '../src/cli/commands/brownfield.js';
import { handleGovernCommand } from '../src/cli/commands/paper.js';
import type { CliIO } from '../src/cli/io.js';
import type { EarsReport, EarsSuggestion } from '../src/core/earsAssistant.js';
import type { JsonEnvelope } from '../src/cli/jsonOut.js';

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

/** La spec de la fixture: un compuesto (error, índice 1) y un término vago (aviso/pregunta, índice 2). */
const REQUIREMENTS = `# Requirements Document

## Requirements

### REQ-DEMO-001 — Draft

#### Acceptance Criteria

- The [drafter] shall emit a draft and shall record the evidence.
- The [engine] shall respond rápido.
`;

const specFixture = async (requirements: string | null, delta?: string): Promise<string> => {
  const dir = await makeTemp('open-sdd-cli-ears-');
  const specDir = path.join(dir, '.sdd', 'specs', 'demo');
  await mkdir(specDir, { recursive: true });
  if (requirements !== null) await writeFile(path.join(specDir, 'requirements.md'), requirements, 'utf8');
  if (delta !== undefined) await writeFile(path.join(specDir, 'delta.md'), delta, 'utf8');
  return dir;
};

const requirementsPath = (dir: string): string => path.join(dir, '.sdd', 'specs', 'demo', 'requirements.md');
const readRequirements = (dir: string): Promise<string> => readFile(requirementsPath(dir), 'utf8');

describe('cli/brownfield requirements — informe', () => {
  it('imprime el informe con la distribución de patrones y sale 1 con una sugerencia de error', async () => {
    const dir = await specFixture(REQUIREMENTS);
    const { io, logs, errors } = makeIO();

    const code = await handleBrownfieldCommand(['requirements', 'demo'], io, dir);

    expect(code).toBe(1);
    const text = logs.join('\n');
    expect(text).toContain('Asistente EARS');
    expect(text).toContain('COMPOUND_REQUIREMENT');
    expect(text).toContain('VAGUE_TERM');
    expect(text).toContain('patrones (solo conformes)');
    expect(errors).toHaveLength(0);
  });

  it('--suggest añade cada propuesta con su porqué y un ejemplo real citado', async () => {
    const dir = await specFixture(REQUIREMENTS);
    const { io, logs } = makeIO();

    const code = await handleBrownfieldCommand(['requirements', 'demo', '--suggest'], io, dir);

    expect(code).toBe(1);
    const text = logs.join('\n');
    expect(text).toContain('propuesta: The [drafter] shall emit a draft.');
    expect(text).toContain('propuesta: The [drafter] shall record the evidence.');
    expect(text).toContain('por qué:');
    expect(text).toContain('ejemplo:');
    expect(text).toContain('fuente: .sdd/specs/');
  });

  it('--json emite el sobre compartido con el informe y el evidence pack', async () => {
    const dir = await specFixture(REQUIREMENTS);
    const { io, logs } = makeIO();

    const code = await handleBrownfieldCommand(['requirements', 'demo', '--json'], io, dir);

    expect(code).toBe(1);
    expect(logs).toHaveLength(1);
    const envelope = JSON.parse(logs[0]) as JsonEnvelope<{
      report: EarsReport;
      evidencePack: Record<string, unknown>;
    }>;
    expect(envelope.ok).toBe(false);
    expect(envelope.command).toBe('brownfield requirements');
    expect(envelope.findings.errors.some((finding) => finding.id === 'COMPOUND_REQUIREMENT')).toBe(true);
    expect(envelope.findings.warnings.some((finding) => finding.id === 'VAGUE_TERM')).toBe(true);
    expect(envelope.data.report.total).toBe(2);
    // El pack viaja con la lista explícita de lo que no se pudo determinar (el término vago).
    expect(envelope.data.evidencePack.complete).toBe(true);
    expect(envelope.data.evidencePack.status).toBe('incomplete');
    expect((envelope.data.evidencePack.undetermined as string[]).length).toBeGreaterThan(0);
    expect(JSON.stringify(envelope.data.evidencePack)).toContain('noModelShipped');
  });

  it('analiza los enunciados de la delta y no los cuenta dos veces si repiten requirements.md', async () => {
    const delta = `# Delta: demo — cambio

Status: proposed

## ADDED

### REQ-DEMO-001 — Un compuesto

- Statement: The [drafter] shall emit a draft and shall record the evidence.
- Targets: src/draft.ts

### REQ-DEMO-002 — Nuevo

- Statement: The [engine] shall expose the counters and shall report them.
- Targets: src/metrics.ts
`;
    const dir = await specFixture(REQUIREMENTS, delta);
    const { io, logs } = makeIO();

    const code = await handleBrownfieldCommand(['requirements', 'demo', '--json'], io, dir);

    expect(code).toBe(1);
    const envelope = JSON.parse(logs[0]) as JsonEnvelope<{ report: EarsReport; notes: string[] }>;
    // 2 de requirements.md + 1 enunciado nuevo de la delta (el repetido no se cuenta dos veces).
    expect(envelope.data.report.total).toBe(3);
    expect(envelope.data.report.source).toContain('delta.md');
    expect(envelope.data.notes.join(' ')).toContain('no se cuentan dos veces');
    expect(logs.join('\n')).not.toContain('sin requirements.md');
  });

  it('sin requirements.md analiza solo la delta y lo dice', async () => {
    const delta = `# Delta: demo — cambio

Status: proposed

## ADDED

### REQ-DEMO-001 — Compuesto

- Statement: The [drafter] shall emit a draft and shall record the evidence.
- Targets: src/draft.ts
`;
    const dir = await specFixture(null, delta);
    const { io, logs } = makeIO();

    const code = await handleBrownfieldCommand(['requirements', 'demo'], io, dir);

    expect(code).toBe(1);
    expect(logs.join('\n')).toContain('solo se analizan los enunciados de la delta');
    expect(logs.join('\n')).toContain('COMPOUND_REQUIREMENT');
  });

  it('sin requirements.md ni delta.md falla sin analizar nada', async () => {
    const dir = await specFixture(null);
    const { io, logs, errors } = makeIO();

    const code = await handleBrownfieldCommand(['requirements', 'demo'], io, dir);

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('no hay requisitos que analizar');
    expect(logs).toHaveLength(0);
  });
});

describe('cli/brownfield requirements — nada se escribe sin selección', () => {
  it('--write sin --apply no escribe nada y lo explica', async () => {
    const dir = await specFixture(REQUIREMENTS);
    const before = await readRequirements(dir);
    const { io, logs, errors } = makeIO();

    const code = await handleBrownfieldCommand(['requirements', 'demo', '--write'], io, dir);

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('--apply');
    expect(await readRequirements(dir)).toBe(before);
    expect(logs.join('\n')).not.toContain('✓');
  });

  it('--apply <índice> sin --write muestra el diff y no toca el fichero', async () => {
    const dir = await specFixture(REQUIREMENTS);
    const before = await readRequirements(dir);
    const { io, logs } = makeIO();

    const code = await handleBrownfieldCommand(['requirements', 'demo', '--apply', '1'], io, dir);

    expect(code).toBe(0);
    const text = logs.join('\n');
    expect(text).toContain('--- a/.sdd/specs/demo/requirements.md');
    expect(text).toContain('- - The [drafter] shall emit a draft and shall record the evidence.');
    expect(text).toContain('+ - The [drafter] shall emit a draft.');
    expect(text).toContain('+ - The [drafter] shall record the evidence.');
    expect(text).toContain('Nada se ha escrito');
    expect(await readRequirements(dir)).toBe(before);
  });

  it('--apply <índice> --write reescribe exactamente las líneas seleccionadas', async () => {
    const dir = await specFixture(REQUIREMENTS);
    const { io, logs } = makeIO();

    const code = await handleBrownfieldCommand(['requirements', 'demo', '--apply', '1', '--write'], io, dir);

    expect(code).toBe(0);
    expect(logs.join('\n')).toContain('✓');
    const after = await readRequirements(dir);
    expect(after).toContain('- The [drafter] shall emit a draft.\n- The [drafter] shall record the evidence.');
    expect(after).not.toContain('and shall record the evidence.');
    // El resto del documento se conserva byte a byte.
    expect(after).toContain('# Requirements Document');
    expect(after).toContain('- The [engine] shall respond rápido.');
  });

  it('se niega a aplicar una propuesta que es una pregunta y no escribe nada', async () => {
    const dir = await specFixture(REQUIREMENTS);
    const before = await readRequirements(dir);
    const { io, logs } = makeIO();

    const code = await handleBrownfieldCommand(['requirements', 'demo', '--apply', '2', '--write'], io, dir);

    expect(code).toBe(1);
    expect(logs.join('\n')).toContain('PREGUNTA');
    expect(await readRequirements(dir)).toBe(before);
  });

  it('se niega a aplicar por código cuando el hallazgo es una pregunta', async () => {
    const dir = await specFixture(REQUIREMENTS);
    const before = await readRequirements(dir);
    const { io, logs } = makeIO();

    const code = await handleBrownfieldCommand(['requirements', 'demo', '--apply', 'VAGUE_TERM', '--write'], io, dir);

    expect(code).toBe(1);
    expect(logs.join('\n')).toContain('VAGUE_TERM');
    expect(await readRequirements(dir)).toBe(before);
  });

  it('una selección inexistente no escribe nada', async () => {
    const dir = await specFixture(REQUIREMENTS);
    const before = await readRequirements(dir);
    const { io, logs } = makeIO();

    const code = await handleBrownfieldCommand(['requirements', 'demo', '--apply', '99', '--write'], io, dir);

    expect(code).toBe(1);
    expect(logs.join('\n')).toContain('no existe la sugerencia 99');
    expect(await readRequirements(dir)).toBe(before);
  });

  it('--apply en modo --json devuelve el diff y el estado de escritura', async () => {
    const dir = await specFixture(REQUIREMENTS);
    const { io, logs } = makeIO();

    const code = await handleBrownfieldCommand(['requirements', 'demo', '--apply', '1', '--write', '--json'], io, dir);

    expect(code).toBe(0);
    const envelope = JSON.parse(logs[0]) as JsonEnvelope<{
      applied: EarsSuggestion[];
      diff: string[];
      written: boolean;
      files: string[];
    }>;
    expect(envelope.data.written).toBe(true);
    expect(envelope.data.applied).toHaveLength(1);
    expect(envelope.data.applied[0].code).toBe('COMPOUND_REQUIREMENT');
    expect(envelope.data.diff.length).toBeGreaterThan(0);
    expect(envelope.data.files).toEqual(['.sdd/specs/demo/requirements.md']);
  });
});

describe('cli/govern --advise-ears', () => {
  const governFixture = async (requirements: string, feature = 'demo'): Promise<string> => {
    const dir = await makeTemp('open-sdd-cli-advise-ears-');
    await mkdir(path.join(dir, 'tools', 'open-sdd'), { recursive: true });
    await writeFile(path.join(dir, 'tools', 'open-sdd', 'package.json'), '{"name":"fixture"}', 'utf8');
    const specDir = path.join(dir, '.sdd', 'specs', feature);
    await mkdir(specDir, { recursive: true });
    await writeFile(path.join(specDir, 'requirements.md'), requirements, 'utf8');
    return dir;
  };

  it('resume las specs y sale 1 solo con una sugerencia de severidad error', async () => {
    const dir = await governFixture(
      '- The [drafter] shall emit a draft and shall record the evidence.\n',
    );
    const { io, logs } = makeIO();

    const code = await handleGovernCommand(['--advise-ears'], io, dir);

    expect(code).toBe(1);
    const text = logs.join('\n');
    expect(text).toContain('Asistente EARS');
    expect(text).toContain('COMPOUND_REQUIREMENT');
    expect(text).toContain('demo');
    expect(text).toContain('brownfield requirements');
  });

  it('sale 0 cuando todas las specs son EARS, sin sugerencias', async () => {
    const dir = await governFixture('- When the probe fails, the [engine] shall reopen the circuit.\n');
    const { io, logs } = makeIO();

    const code = await handleGovernCommand(['--advise-ears'], io, dir);

    expect(code).toBe(0);
    expect(logs.join('\n')).toContain('Sin sugerencias');
  });

  it('un aviso no bloquea: solo el error decide el código de salida', async () => {
    const dir = await governFixture('- The [engine] shall respond rápido.\n');
    const { io, logs } = makeIO();

    const code = await handleGovernCommand(['--advise-ears'], io, dir);

    expect(code).toBe(0);
    expect(logs.join('\n')).toContain('VAGUE_TERM');
    expect(logs.join('\n')).toContain('aviso');
  });

  it('--json emite el sobre con el informe agregado y los hallazgos', async () => {
    const dir = await governFixture('- The [drafter] shall emit a draft and shall record the evidence.\n');
    const { io, logs } = makeIO();

    const code = await handleGovernCommand(['--advise-ears', '--json'], io, dir);

    expect(code).toBe(1);
    const envelope = JSON.parse(logs[0]) as JsonEnvelope<{
      report: EarsReport;
      specs: { feature: string; total: number }[];
    }>;
    expect(envelope.command).toBe('govern --advise-ears');
    expect(envelope.ok).toBe(false);
    expect(envelope.findings.errors.some((finding) => finding.id === 'COMPOUND_REQUIREMENT')).toBe(true);
    expect(envelope.data.specs.map((entry) => entry.feature)).toEqual(['demo']);
    expect(envelope.data.report.total).toBe(1);
  });

  it('sin specs no falla: informa que no se comprobó nada', async () => {
    const dir = await makeTemp('open-sdd-cli-advise-ears-none-');
    await mkdir(path.join(dir, 'tools', 'open-sdd'), { recursive: true });
    await writeFile(path.join(dir, 'tools', 'open-sdd', 'package.json'), '{"name":"fixture"}', 'utf8');
    const { io, logs } = makeIO();

    const code = await handleGovernCommand(['--advise-ears'], io, dir);

    expect(code).toBe(0);
    expect(logs.join('\n')).toContain('No se analizó ningún requisito');
  });

  it('una feature inexistente falla en vez de analizar otra cosa', async () => {
    const dir = await governFixture('- When the probe fails, the [engine] shall reopen the circuit.\n');
    const { io, errors } = makeIO();

    const code = await handleGovernCommand(['--advise-ears', 'nope'], io, dir);

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('No hay especificación');
  });
});
