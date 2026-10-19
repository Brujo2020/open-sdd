/**
 * Pruebas de comportamiento del panel único y de su superficie de consola.
 *
 * Los fixtures viven en `os.tmpdir()` y se limpian en `afterEach`: nada se escribe dentro del
 * repositorio. El panel LEE el repositorio, así que cada fixture es un repositorio mínimo — .sdd +
 * spec + delta — y lo que se afirma es la LÍNEA exacta que produce, su tono y la acción siguiente.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildStatus, renderStatus } from '../src/core/status.js';
import { renderConstitution, type Constitution } from '../src/core/constitution.js';
import { handleStatusCommand } from '../src/cli/commands/status.js';

const dirs: string[] = [];

const makeTmp = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-status-'));
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

/** Línea de DATOS de una etiqueta: la cabecera de sección comparte etiqueta y tiene `value` vacío. */
const dataLine = (report: Awaited<ReturnType<typeof buildStatus>>, label: string) =>
  report.lines.find((line) => line.label === label && line.value !== '');

const makeIO = () => {
  const logs: string[] = [];
  const errs: string[] = [];
  return {
    io: {
      log: (message: string) => logs.push(message),
      error: (message: string) => errs.push(message),
      exit: () => undefined,
    },
    get logs() {
      return logs;
    },
    get errs() {
      return errs;
    },
  };
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
      justification:
        'Modernizar sin pedido destruye el comportamiento anclado que nadie autorizó a cambiar en este repositorio.',
      provenance: 'descriptive',
      evidence: ['package.json'],
    },
  ],
  amendments: [],
};

const REQUIREMENTS = [
  '# Requirements: sesión',
  '',
  '### REQ-SESS-001: Registrar sesión',
  '',
  '- WHEN se invoque el endpoint, the system shall registrar la sesión con su marca de tiempo.',
  '',
].join('\n');

const PLAN_ALIGNED = [
  '# Plan: sesión',
  '',
  '## Constitution',
  '',
  '- C-STACK-FACT — el stack en vigor no se moderniza sin una enmienda gobernada.',
  '',
].join('\n');

const PLAN_UNKNOWN = [
  '# Plan: sesión',
  '',
  '## Constitution',
  '',
  '- C-FANTASMA — un principio que la constitución no tiene.',
  '',
].join('\n');

const TASKS = [
  '- [x] 1.1 implementar el registro — _Requirements: REQ-SESS-001_ — _Boundary:_ `src/session`',
  '  _Evidence: npx vitest run (3 passed)',
  '',
].join('\n');

const DELTA_ADDED = [
  '# Delta: session — Registrar sesión',
  '',
  'Status: proposed',
  '',
  '## ADDED',
  '',
  '### REQ-SESS-001 — Registrar sesión',
  '- Statement: WHEN se invoque el endpoint, the system shall registrar la sesión.',
  '- Targets: src/session/register.ts',
  '- Strangler: new',
  '',
].join('\n');

const DELTA_MISSING_CONTRACT = [
  '# Delta: session — Registrar sesión',
  '',
  'Status: proposed',
  '',
  '## REMOVED',
  '',
  '### REQ-SESS-002 — Retirar el registro antiguo',
  '- Statement: WHEN se invoque el endpoint, the system shall usar solo el registro nuevo.',
  '- Previous: el registro antiguo de sesión',
  '- Targets: src/session/legacy.ts',
  '- Contracts: test/session/legacy.test.ts',
  '- Rationale: el registro nuevo lo sustituye por completo y mantiene la compatibilidad.',
  '- Strangler: legacy',
  '',
].join('\n');

const seed = async (
  root: string,
  options: { level?: string; plan?: string; delta?: string | null; constitution?: string | null } = {},
): Promise<void> => {
  if (options.constitution !== null) {
    await write(root, '.sdd/steering/constitution.md', options.constitution ?? renderConstitution(CONSTITUTION));
  }
  await write(
    root,
    '.sdd/settings/rigor.json',
    JSON.stringify(
      { level: options.level ?? 'spec-first', rationale: 'Fixture: nivel declarado con motivo explícito.', brownfield: true },
      null,
      2,
    ),
  );
  await write(root, '.sdd/specs/session/requirements.md', REQUIREMENTS);
  await write(root, '.sdd/specs/session/plan.md', options.plan ?? PLAN_ALIGNED);
  await write(root, '.sdd/specs/session/tasks.md', TASKS);
  if (options.delta !== null) await write(root, '.sdd/specs/session/delta.md', options.delta ?? DELTA_ADDED);
};

describe('core/status — panel único', () => {
  it('cubre las siete secciones en orden y respeta el nivel declarado', async () => {
    const root = await makeTmp();
    await seed(root);

    const report = await buildStatus(root, { feature: 'session' });

    expect(report.root).toBe(root);
    expect(report.level).toBe('spec-first');
    expect(report.gates).toEqual(['C1', 'C2']);
    expect(report.brownfield).toBe(true);
    expect(report.lines.filter((line) => !line.value).map((line) => line.label)).toEqual([
      'Constitución',
      'Specs',
      'Delta',
      'Contratos',
      'Constitucional',
      'Rigor',
      'Siguiente',
    ]);
  });

  it('reporta la tríada, la trazabilidad medida, la evidencia y los recuentos de la delta', async () => {
    const root = await makeTmp();
    await seed(root);

    const report = await buildStatus(root, { feature: 'session' });
    const spec = dataLine(report, 'Specification: session');
    expect(spec?.tone).toBe('ok');
    expect(spec?.value).toContain('Phase: initialized');
    expect(spec?.value).toContain('tríada completa');
    expect(spec?.value).toContain('trazabilidad 1/1');
    expect(spec?.value).toContain('evidencia 1/1');

    const deltaLine = dataLine(report, 'Delta de session');
    expect(deltaLine?.value).toContain('ADDED 1');
    expect(deltaLine?.value).toContain('Estrangulamiento');

    const constitution = dataLine(report, 'Constitución');
    expect(constitution?.tone).toBe('ok');
    expect(constitution?.value).toContain('1 principio(s) en vigor');

    const alignment = dataLine(report, 'Constitucional');
    expect(alignment?.tone).toBe('ok');
    expect(alignment?.value).toContain('C-STACK-FACT');
    expect(alignment?.value).toContain('alineación 100%');
    expect(alignment?.value).toContain('0 hallazgo(s)');

    const rigor = dataLine(report, 'Rigor');
    expect(rigor?.value).toContain('spec-first');
    expect(rigor?.value).toContain('C1, C2');

    expect(report.lines.some((line) => line.tone === 'err')).toBe(false);
  });

  it('dice "enmienda propuesta" cuando la constitución las tiene y las cuenta', async () => {
    const root = await makeTmp();
    const withAmendment = renderConstitution({
      ...CONSTITUTION,
      amendments: [
        {
          id: 'AMD-001',
          title: 'Añadir cobertura por mutación',
          proposedBy: 'arquitectura',
          status: 'proposed',
        },
      ],
    });
    await seed(root, { constitution: withAmendment });

    const report = await buildStatus(root, { feature: 'session' });
    const constitution = dataLine(report, 'Constitución');
    expect(constitution?.value).toContain('1 enmienda propuesta');
  });

  it('elige la siguiente acción respetando el nivel declarado', async () => {
    const root = await makeTmp();
    await seed(root);

    const specFirst = await buildStatus(root, { feature: 'session' });
    expect(specFirst.nextAction).toBe('open-sdd gates run C1 C2');
    expect(specFirst.nextAction).not.toContain('C4');

    const source = await makeTmp();
    await seed(source, { level: 'spec-as-source' });
    const specAsSource = await buildStatus(source, { feature: 'session' });
    expect(specAsSource.gates).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6']);
    expect(specAsSource.nextAction).toBe('open-sdd gates run C1 C2 C3 C4 C5 C6');
  });

  it('pide la delta solo cuando el nivel la exige, no a un proyecto spec-first', async () => {
    const specFirst = await makeTmp();
    await seed(specFirst, { delta: null });
    const first = await buildStatus(specFirst, { feature: 'session' });
    expect(first.nextAction).toBe('open-sdd gates run C1 C2');

    const anchored = await makeTmp();
    await seed(anchored, { delta: null, level: 'spec-anchored' });
    const report = await buildStatus(anchored, { feature: 'session' });
    expect(report.nextAction).toBe('open-sdd delta init session "..."');
    const deltaLine = dataLine(report, 'Delta');
    expect(deltaLine?.tone).toBe('err');
    expect(deltaLine?.value).toContain('brownfield sin delta');
  });

  it('señala los contratos declarados por la delta que no existen y apunta al comando que los revisa', async () => {
    const root = await makeTmp();
    await seed(root, { delta: DELTA_MISSING_CONTRACT });

    const report = await buildStatus(root, { feature: 'session' });
    expect(report.nextAction).toBe('open-sdd brownfield contracts session');
    expect(report.lines.some((line) => line.value.includes('declarados por la delta que no existen'))).toBe(true);
  });

  it('declara honestamente lo que no pudo inspeccionar en vez de aprobarlo', async () => {
    const root = await makeTmp();
    await seed(root, { constitution: null });

    // Un fichero que existe y no se puede leer (un directorio con el nombre del artefacto).
    await mkdir(path.join(root, '.sdd/steering/constitution.md'), { recursive: true });

    const report = await buildStatus(root, { feature: 'session' });
    const constitution = dataLine(report, 'Constitución');
    expect(constitution?.tone).toBe('warn');
    expect(constitution?.value).toContain('no se pudo leer');
    expect(constitution?.value).toContain('no evaluada, no válida');
    expect(report.complete).toBe(false);
    // Reconstruirla sin --write: sobrescribir lo que no se pudo leer perdería trabajo.
    expect(report.nextAction).toBe('open-sdd brownfield constitution .');
  });

  it('marca la constitución ausente como aviso y apunta a crearla', async () => {
    const root = await makeTmp();
    await seed(root, { constitution: null });

    const report = await buildStatus(root, { feature: 'session' });
    const constitution = dataLine(report, 'Constitución');
    expect(constitution?.tone).toBe('warn');
    expect(constitution?.value).toContain('ausente');
    expect(report.nextAction).toBe('open-sdd brownfield constitution . --write');
  });

  it('marca error en la constitución cuando existe pero no valida', async () => {
    const root = await makeTmp();
    await seed(root, {
      constitution: ['# Constitution — demo', '', 'Provenance: descriptive', '', '## Principles', ''].join('\n'),
    });

    const report = await buildStatus(root, { feature: 'session' });
    const constitution = dataLine(report, 'Constitución');
    expect(constitution?.tone).toBe('err');
    expect(constitution?.value).toContain('inválida');
    expect(report.nextAction).toBe('open-sdd brownfield constitution . --write');
  });

  it('cierra el informe como completo cuando el origen del cambio es inspeccionable', async () => {
    const root = await makeTmp();
    await seed(root);
    expect(spawnSync('git', ['init', '-q'], { cwd: root }).status).toBe(0);
    expect(spawnSync('git', ['add', '-A'], { cwd: root }).status).toBe(0);
    expect(
      spawnSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-q', '-m', 'fixture'], {
        cwd: root,
      }).status,
    ).toBe(0);

    const report = await buildStatus(root, { feature: 'session' });
    expect(report.complete).toBe(true);
    expect(report.nextAction).toBe('open-sdd gates run C1 C2');
  });
});

describe('core/status — renderizador', () => {
  it('devuelve una línea de texto plano por StatusLine, con las cabeceras distinguibles', async () => {
    const root = await makeTmp();
    await seed(root);

    const report = await buildStatus(root, { feature: 'session' });
    const rendered = renderStatus(report);

    expect(rendered).toHaveLength(report.lines.length);
    expect(rendered[0]).toBe('  Constitución');
    expect(rendered.every((line) => !line.includes('\u001b['))).toBe(true);
    const specLine = rendered[report.lines.findIndex((line) => line.label === 'Specification: session' && line.value !== '')];
    expect(specLine).toContain('Specification: session — Phase: initialized');
  });
});

describe('cli/status — superficie de consola', () => {
  it('imprime el panel y devuelve 0 cuando ninguna línea es de error', async () => {
    const root = await makeTmp();
    await seed(root);
    const ctx = makeIO();

    const code = await handleStatusCommand(['session'], ctx.io, root);

    expect(code).toBe(0);
    const out = ctx.logs.join('\n');
    expect(out).toMatch(/Specification: session/);
    expect(out).toMatch(/Phase:\s+initialized/);
    expect(out).toContain('Constitución');
    expect(out).toContain('Siguiente');
  });

  it('devuelve 1 cuando la feature pedida no existe', async () => {
    const root = await makeTmp();
    await seed(root);
    const ctx = makeIO();

    const code = await handleStatusCommand(['no-existe'], ctx.io, root);

    expect(code).toBe(1);
    expect(ctx.logs.join('\n')).toContain('no existe en .sdd/specs');
  });

  it('--json imprime un StatusReport parseable cuando se pide una feature', async () => {
    const root = await makeTmp();
    await seed(root);
    const ctx = makeIO();

    const code = await handleStatusCommand(['session', '--json'], ctx.io, root);
    const parsed = JSON.parse(ctx.logs.join('\n')) as {
      level: string;
      gates: string[];
      brownfield: boolean;
      nextAction?: string;
      complete: boolean;
      lines: { label: string; tone: string }[];
    };

    expect(code).toBe(0);
    expect(parsed.level).toBe('spec-first');
    expect(parsed.gates).toEqual(['C1', 'C2']);
    expect(parsed.brownfield).toBe(true);
    expect(parsed.nextAction).toBe('open-sdd gates run C1 C2');
    expect(Array.isArray(parsed.lines)).toBe(true);
    expect(parsed.lines.some((line) => line.label === 'Specification: session')).toBe(true);
  });

  it('--json sin feature conserva la lista por spec (contrato anterior)', async () => {
    const root = await makeTmp();
    await write(
      root,
      '.sdd/specs/feature-beta/spec.json',
      JSON.stringify({ name: 'feature-beta', version: '1.0.0', phase: 'initialized', language: 'es', description: 'x' }),
    );
    const ctx = makeIO();

    const code = await handleStatusCommand(['--json'], ctx.io, root);
    const parsed = JSON.parse(ctx.logs.join('\n')) as { name: string }[];

    expect(code).toBe(0);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((spec) => spec.name === 'feature-beta')).toBe(true);
  });

  it('--check devuelve 1 con un principio fantasma y 0 cuando la spec está alineada', async () => {
    const unknown = await makeTmp();
    await seed(unknown, { plan: PLAN_UNKNOWN });
    const unknownCtx = makeIO();

    const unknownCode = await handleStatusCommand(['session', '--check'], unknownCtx.io, unknown);
    expect(unknownCode).toBe(1);
    expect(unknownCtx.logs.join('\n')).toContain('UNKNOWN_PRINCIPLE');
    expect(unknownCtx.logs.join('\n')).toContain('Validación constitucional');

    const aligned = await makeTmp();
    await seed(aligned);
    const alignedCtx = makeIO();

    const alignedCode = await handleStatusCommand(['session', '--check'], alignedCtx.io, aligned);
    expect(alignedCode).toBe(0);
    expect(alignedCtx.logs.join('\n')).toContain('sin hallazgos');
  });

  it('--check devuelve 1 cuando el pivote no se puede ejecutar (sin constitución)', async () => {
    const root = await makeTmp();
    await seed(root, { constitution: null });
    const ctx = makeIO();

    const code = await handleStatusCommand(['session', '--check'], ctx.io, root);

    expect(code).toBe(1);
    expect(ctx.logs.join('\n')).toContain('constitución ausente');
  });

  it('--json --check añade la alineación al informe sin romper su forma', async () => {
    const root = await makeTmp();
    await seed(root);
    const ctx = makeIO();

    const code = await handleStatusCommand(['session', '--json', '--check'], ctx.io, root);
    const parsed = JSON.parse(ctx.logs.join('\n')) as {
      alignment?: { alignment: number; findings: unknown[] };
      checkExitCode: number;
      lines: unknown[];
    };

    expect(code).toBe(0);
    expect(parsed.checkExitCode).toBe(0);
    expect(parsed.alignment?.alignment).toBe(1);
    expect(parsed.alignment?.findings).toEqual([]);
    expect(Array.isArray(parsed.lines)).toBe(true);
  });

  it('--quiet imprime una sola línea con nivel, peor tono y siguiente acción', async () => {
    const root = await makeTmp();
    await seed(root);
    const ctx = makeIO();

    const code = await handleStatusCommand(['session', '--quiet'], ctx.io, root);

    expect(code).toBe(0);
    expect(ctx.logs).toHaveLength(1);
    expect(ctx.logs[0]).toMatch(/^spec-first · (ok|warn|err|dim) · open-sdd /);
    expect(ctx.logs[0]).toContain('open-sdd gates run C1 C2');
  });

  it('--quiet resume el peor tono cuando hay error', async () => {
    const root = await makeTmp();
    await seed(root);
    const ctx = makeIO();

    const code = await handleStatusCommand(['no-existe', '--quiet'], ctx.io, root);

    expect(code).toBe(1);
    expect(ctx.logs).toHaveLength(1);
    expect(ctx.logs[0]).toContain('· err ·');
  });
});
