/**
 * Pruebas del recorrido guiado (`open-sdd tour`) y del context pack en la terminal (`open-sdd context`).
 *
 * Fijan las reglas del recorrido: que se DETENGA en la decisión humana —ratificar no se automatiza—,
 * que sea de solo lectura salvo `--write`, que un prerrequisito que falta se NOMBRE en lugar de
 * saltarse el paso, y que el context pack diga qué está presente y qué ausente con su motivo.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli } from '../src/index.js';
import { renderConstitution, type Constitution } from '../src/core/constitution.js';

const runtime = { platform: 'darwin', env: {} } as const;

const makeIO = () => {
  const logs: string[] = [];
  const errs: string[] = [];
  return {
    io: { log: (m: string) => logs.push(m), error: (m: string) => errs.push(m), exit: () => {} },
    get logs() {
      return logs;
    },
    get errs() {
      return errs;
    },
    get text() {
      return logs.join('\n');
    },
  };
};

/** Un repositorio mínimo y legible: package.json es lo que el reconocimiento observa. */
const makeRepo = async (files: Record<string, string> = {}): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-tour-'));
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'tour-fixture', version: '1.0.0', dependencies: { express: '^4.19.0' } }, null, 2),
  );
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), content, 'utf8');
  }
  return dir;
};

const exists = async (target: string): Promise<boolean> =>
  (await stat(target).catch(() => null)) !== null;

const ratifiedConstitution = (): string =>
  renderConstitution({
    project: 'tour-fixture',
    provenance: 'descriptive',
    establishedFacts: [],
    principles: [
      {
        id: 'C-STACK',
        title: 'Stack en vigor',
        threatReference: 'ADR-001',
        level: 'MUST',
        restriction: 'El stack observado no se moderniza sin una enmienda gobernada.',
        pattern: 'Todo cambio de stack se tramita como enmienda.',
        justification: 'Sin autoridad citable un veredicto bloqueante no tiene fundamento.',
        provenance: 'descriptive',
        evidence: ['package.json'],
      },
    ],
    amendments: [],
  } satisfies Constitution);

describe('open-sdd tour', () => {
  it('inspecciona el repositorio y recorre los pasos con el comando real y su salida', async () => {
    const dir = await makeRepo();
    const ctx = makeIO();
    const code = await runCli(['tour'], runtime, ctx.io, {}, { cwd: dir });

    expect(code).toBe(0);
    expect(ctx.text).toContain('Recorrido guiado');
    expect(ctx.text).toContain('Recorrido guiado — .');
    // El comando real de reconocimiento, su porqué y su salida.
    expect(ctx.text).toContain('open-sdd brownfield survey .');
    expect(ctx.text).toContain('Comando: open-sdd brownfield constitution . --draft');
    expect(ctx.text).toContain('Salida real:');
    // Sin claves sin traducir en el camino en español.
    expect(ctx.text).not.toContain('⟦');
    expect(ctx.text).not.toContain('sin traducción');
  });

  it('se DETIENE en la decisión humana de ratificar y no la automatiza', async () => {
    const dir = await makeRepo();
    const ctx = makeIO();
    await runCli(['tour'], runtime, ctx.io, {}, { cwd: dir });

    expect(ctx.text).toContain('DECISIÓN HUMANA');
    expect(ctx.text).toContain('ratificar la constitución');
    expect(ctx.text).toContain('nunca se automatiza');
    expect(ctx.text).toContain('open-sdd govern constitution --ratify --by');
    expect(ctx.text).toContain('El recorrido se detiene');
    // Ratificar jamás se ejecuta: no se crea la constitución en vigor.
    expect(await exists(path.join(dir, '.sdd', 'steering', 'constitution.md'))).toBe(false);
  });

  it('es de SOLO LECTURA por defecto: ni borrador, ni estado, ni delta', async () => {
    const dir = await makeRepo();
    const ctx = makeIO();
    await runCli(['tour'], runtime, ctx.io, {}, { cwd: dir });

    expect(await exists(path.join(dir, '.sdd', 'steering', 'constitution.draft.md'))).toBe(false);
    expect(await exists(path.join(dir, '.sdd', 'state'))).toBe(false);
    expect(await exists(path.join(dir, '.sdd', 'specs'))).toBe(false);
    expect(ctx.text).toContain('Modo solo lectura');
  });

  it('con --write escribe el BORRADOR pero nunca la constitución en vigor, y sigue parando', async () => {
    const dir = await makeRepo();
    const ctx = makeIO();
    const code = await runCli(['tour', '--write'], runtime, ctx.io, {}, { cwd: dir });

    expect(code).toBe(0);
    expect(await exists(path.join(dir, '.sdd', 'steering', 'constitution.draft.md'))).toBe(true);
    expect(await exists(path.join(dir, '.sdd', 'steering', 'constitution.md'))).toBe(false);
    expect(ctx.text).toContain('DECISIÓN HUMANA');
    expect(ctx.text).toContain('--write');
  });

  it('nombra el prerrequisito que falta en vez de saltarse el paso en silencio', async () => {
    const dir = await makeRepo();
    const ctx = makeIO();
    await runCli(['tour'], runtime, ctx.io, {}, { cwd: dir });

    // Detenido en la decisión: check/status quedan bloqueados nombrando la constitución ratificada.
    expect(ctx.text).toContain('Prerrequisito que falta: una constitución ratificada');
    // La delta pide sus datos humanos.
    expect(ctx.text).toContain('un slug de feature y una descripción del cambio');
    expect(ctx.text).toContain('open-sdd delta init');
    expect(ctx.text).toContain('open-sdd delta validate');
  });

  it('un objetivo inexistente se nombra a sí mismo y sale 1', async () => {
    const dir = await makeRepo();
    const ctx = makeIO();
    const code = await runCli(['tour', 'no-existe'], runtime, ctx.io, {}, { cwd: dir });

    expect(code).toBe(1);
    expect(ctx.text).toContain('no existe o no es legible');
    expect(ctx.text).toContain('Prerrequisito que falta');
  });

  it('--json entrega el recorrido estructurado con haltedAt y estados', async () => {
    const dir = await makeRepo();
    const ctx = makeIO();
    const code = await runCli(['tour', '--json'], runtime, ctx.io, {}, { cwd: dir });

    expect(code).toBe(0);
    const report = JSON.parse(ctx.text);
    expect(report.command).toBe('tour');
    expect(report.readOnly).toBe(true);
    expect(report.haltedAt).toBe('constitution');
    expect(report.fallbacks).toEqual([]);
    const byId = Object.fromEntries(report.steps.map((step: { id: string }) => [step.id, step]));
    expect(byId.recon.status).toBe('ran');
    expect(byId.constitution.status).toBe('handover');
    expect(byId.constitution.humanDecision).toContain('ratificar');
    expect(byId.check.status).toBe('blocked');
    expect(byId.check.prerequisite).toContain('constitución ratificada');
    expect(byId.status.status).toBe('blocked');
    expect(byId.delta.status).toBe('handover');
  });

  it('inspecciona el OBJETIVO, no el repositorio desde el que se invoca', async () => {
    // El llamante TIENE constitución ratificada; el objetivo no. El recorrido debe leer el objetivo.
    const caller = await makeRepo({ '.sdd/steering/constitution.md': ratifiedConstitution() });
    const target = await makeRepo();
    const ctx = makeIO();
    const code = await runCli(['tour', target, '--json'], runtime, ctx.io, {}, { cwd: caller });

    expect(code).toBe(0);
    const report = JSON.parse(ctx.text);
    expect(report.haltedAt).toBe('constitution');
    const byId = Object.fromEntries(report.steps.map((step: { id: string }) => [step.id, step]));
    expect(byId.constitution.status).toBe('handover');
    expect(byId.constitution.humanDecision).toContain('ratificar');
  });

  it('con la constitución ya ratificada, check y status SÍ se ejecutan', async () => {
    const dir = await makeRepo({ '.sdd/steering/constitution.md': ratifiedConstitution() });
    const ctx = makeIO();
    const code = await runCli(['tour', '--json'], runtime, ctx.io, {}, { cwd: dir });

    expect(code).toBe(0);
    const report = JSON.parse(ctx.text);
    expect(report.haltedAt).toBeNull();
    const byId = Object.fromEntries(report.steps.map((step: { id: string }) => [step.id, step]));
    expect(byId.constitution.status).toBe('satisfied');
    expect(byId.check.status).toBe('ran');
    expect(byId.check.executed).toBe(true);
    expect(byId.status.status).toBe('ran');
    expect(byId.delta.status).toBe('handover');
    expect(byId.delta.prerequisite).toContain('slug de feature');
  });
});

describe('open-sdd context', () => {
  it('pinta qué está presente y qué ausente con su motivo', async () => {
    const dir = await makeRepo();
    const ctx = makeIO();
    const code = await runCli(['context'], runtime, ctx.io, {}, { cwd: dir });

    expect(code).toBe(0);
    expect(ctx.text).toContain('Context pack');
    expect(ctx.text).toContain('INCOMPLETO');
    expect(ctx.text).toContain('Constitución: AUSENTE');
    expect(ctx.text).toContain('motivo:');
    expect(ctx.text).toContain('Ausente, y por qué');
  });

  it('--json conserva la forma del context pack que sirve el MCP', async () => {
    const dir = await makeRepo();
    const ctx = makeIO();
    const code = await runCli(['context', '--json'], runtime, ctx.io, {}, { cwd: dir });

    expect(code).toBe(0);
    const pack = JSON.parse(ctx.text);
    expect(pack.command).toBe('context');
    // Las claves del `data` de open_sdd_context_pack, ni una de menos.
    for (const key of ['root', 'sddDir', 'feature', 'complete', 'absent', 'constitution', 'spec', 'moduleMap', 'rigor']) {
      expect(pack, key).toHaveProperty(key);
    }
    expect(pack.complete).toBe(false);
    expect(pack.constitution.present).toBe(false);
    expect(pack.constitution.reason).toBe('no presente');
    expect(pack.spec.present).toBe(false);
    expect(pack.absent).toContain('constitution');
    expect(pack.absent).toContain('spec');
  });

  it('nombra las piezas AUSENTES de la especificación (tríada incompleta)', async () => {
    const dir = await makeRepo({
      '.sdd/specs/demo/requirements.md': '### REQ-DEMO-001 — algo\n\n- Statement: WHEN x, the [system] shall y.\n- _Constitution: C-STACK_\n',
      '.sdd/specs/demo/plan.md': '# Plan demo\n',
    });
    const ctx = makeIO();
    await runCli(['context', 'demo', '--json'], runtime, ctx.io, {}, { cwd: dir });

    const pack = JSON.parse(ctx.text);
    expect(pack.feature).toBe('demo');
    expect(pack.spec.present).toBe(true);
    expect(pack.spec.requirements.present).toBe(true);
    expect(pack.spec.plan.present).toBe(true);
    expect(pack.spec.tasks.present).toBe(false);
    expect(pack.spec.tasks.reason).toBe('no presente');
    expect(pack.absent).toContain('spec.tasks');
    expect(pack.spec.triad).toBeUndefined();
  });

  it('una feature inexistente se declara, no se omite', async () => {
    const dir = await makeRepo();
    const ctx = makeIO();
    const code = await runCli(['context', 'fantasma'], runtime, ctx.io, {}, { cwd: dir });

    expect(code).toBe(0);
    const pack = JSON.parse(ctx.logs.filter((line) => line.trim().startsWith('{')).join('\n') || '{}');
    // Sin --json imprime el render humano; el JSON de la feature inexistente se prueba aparte.
    expect(ctx.text).toContain('Context pack');
    expect(ctx.text).toContain('no existe en el repositorio');
    expect(pack).toBeDefined();
  });

  it('la feature inexistente en --json lleva present:false y su motivo', async () => {
    const dir = await makeRepo();
    const ctx = makeIO();
    await runCli(['context', 'fantasma', '--json'], runtime, ctx.io, {}, { cwd: dir });
    const pack = JSON.parse(ctx.text);
    expect(pack.spec.present).toBe(false);
    expect(pack.spec.feature).toBe('fantasma');
    expect(pack.spec.reason).toContain('no existe en el repositorio');
    expect(pack.absent).toContain('spec');
  });

  it('--lang en traduce el render humano del pack', async () => {
    const dir = await makeRepo();
    const ctx = makeIO();
    await runCli(['context', '--lang', 'en'], runtime, ctx.io, {}, { cwd: dir });
    expect(ctx.text).toContain('Context pack');
    expect(ctx.text).toContain('Absent, and why');
    expect(ctx.text).toContain('ABSENT');
  });
});
