/**
 * Pruebas de comportamiento del trinquete constitucional y del modo estricto del gate (REQ-MAT-005).
 *
 * Los fixtures viven en `os.tmpdir()` y se limpian en `afterEach`: nada se escribe dentro del
 * repositorio. Se fija la REGLA, no la implementación: la primera ejecución nunca falla, un descenso
 * nombra al principio que salió, una subida mueve la base, un descenso aceptado queda registrado con
 * autor y motivo, un estado corrupto avisa y se reestablece, y `--strict` falla donde `--check` pasó.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ADHESION_STATE_FILE,
  adhesionStatePath,
  hashConstitution,
  readAdhesionState,
  runAdhesionRatchet,
  type AdhesionState,
} from '../src/core/ratchet.js';
import { handleStatusCommand } from '../src/cli/commands/status.js';
import { renderConstitution, type Constitution } from '../src/core/constitution.js';

const dirs: string[] = [];

const makeTmp = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-ratchet-'));
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

const readState = async (sddDir: string): Promise<AdhesionState> =>
  JSON.parse(await readFile(adhesionStatePath(sddDir), 'utf8')) as AdhesionState;

/** Directorio SDD ya creado, porque el trinquete escribe en `<sdd>/state/`. */
const sddOf = async (root: string): Promise<string> => {
  const sdd = path.join(root, '.sdd');
  await mkdir(sdd, { recursive: true });
  return sdd;
};

const FIXED_NOW = new Date('2026-01-01T00:00:00.000Z');

describe('core/ratchet — la línea base y sus cuatro movimientos', () => {
  it('la PRIMERA ejecución establece la base y nunca falla', async () => {
    const sdd = await sddOf(await makeTmp());

    const run = await runAdhesionRatchet({
      sddDir: sdd,
      feature: 'session',
      alignment: 1,
      principles: ['C-B', 'C-A'],
      constitutionHash: 'h1',
      now: FIXED_NOW,
    });

    expect(run.verdict).toBe('baseline');
    expect(run.findings.some((finding) => finding.severity === 'error')).toBe(false);

    const state = await readState(sdd);
    expect(state.features.session.alignment).toBe(1);
    // Los ids se guardan ordenados: la base no depende del orden en que la constitución los declare.
    expect(state.features.session.principles).toEqual(['C-A', 'C-B']);
    expect(state.features.session.constitutionHash).toBe('h1');
    expect(state.features.session.recordedAt).toBe(FIXED_NOW.toISOString());
  });

  it('un DESCENSO es un error que nombra el principio que salió y NO mueve la base', async () => {
    const sdd = await sddOf(await makeTmp());
    await runAdhesionRatchet({
      sddDir: sdd,
      feature: 'session',
      alignment: 1,
      principles: ['C-A', 'C-B'],
      constitutionHash: 'h1',
      now: FIXED_NOW,
    });

    const run = await runAdhesionRatchet({
      sddDir: sdd,
      feature: 'session',
      alignment: 1,
      principles: ['C-A'],
      constitutionHash: 'h2',
      now: FIXED_NOW,
    });

    expect(run.verdict).toBe('drop');
    const error = run.findings.find((finding) => finding.severity === 'error');
    expect(error?.code).toBe('ADHESION_DROP');
    expect(error?.message).toContain('C-B');
    expect(error?.principleId).toBe('C-B');

    // Un trinquete que se reajustara al bajar no sería un trinquete: la base sigue intacta.
    const state = await readState(sdd);
    expect(state.features.session.principles).toEqual(['C-A', 'C-B']);
    expect(state.features.session.constitutionHash).toBe('h1');
  });

  it('un descenso de RATIO sin principio que salga también es un error', async () => {
    const sdd = await sddOf(await makeTmp());
    await runAdhesionRatchet({
      sddDir: sdd,
      feature: 'session',
      alignment: 1,
      principles: ['C-A'],
      constitutionHash: 'h1',
      now: FIXED_NOW,
    });

    const run = await runAdhesionRatchet({
      sddDir: sdd,
      feature: 'session',
      alignment: 0.5,
      principles: ['C-A'],
      constitutionHash: 'h1',
      now: FIXED_NOW,
    });

    expect(run.verdict).toBe('drop');
    expect(run.findings.find((finding) => finding.severity === 'error')?.message).toContain('DESCENDIÓ');
  });

  it('un descenso ACEPTADO no falla y registra razón, autor y fecha en el mismo fichero', async () => {
    const sdd = await sddOf(await makeTmp());
    await runAdhesionRatchet({
      sddDir: sdd,
      feature: 'session',
      alignment: 1,
      principles: ['C-A', 'C-B'],
      constitutionHash: 'h1',
      now: FIXED_NOW,
    });

    const run = await runAdhesionRatchet({
      sddDir: sdd,
      feature: 'session',
      alignment: 0.5,
      principles: ['C-A'],
      constitutionHash: 'h2',
      acceptDrop: 'deuda aceptada por dirección hasta la enmienda AMD-002',
      actor: 'ana',
      now: FIXED_NOW,
    });

    expect(run.verdict).toBe('accepted-drop');
    expect(run.findings.some((finding) => finding.severity === 'error')).toBe(false);

    const state = await readState(sdd);
    expect(state.features.session.alignment).toBe(0.5);
    expect(state.features.session.principles).toEqual(['C-A']);
    const acceptance = state.acceptances.session[0];
    expect(acceptance.actor).toBe('ana');
    expect(acceptance.at).toBe(FIXED_NOW.toISOString());
    expect(acceptance.reason).toContain('deuda aceptada');
    expect(acceptance.droppedPrinciples).toEqual(['C-B']);
    expect(acceptance.from).toBe(1);
    expect(acceptance.to).toBe(0.5);
  });

  it('una SUBIDA actualiza la base (el trinquete solo sube)', async () => {
    const sdd = await sddOf(await makeTmp());
    await runAdhesionRatchet({
      sddDir: sdd,
      feature: 'session',
      alignment: 0.5,
      principles: ['C-A'],
      constitutionHash: 'h1',
      now: FIXED_NOW,
    });

    const run = await runAdhesionRatchet({
      sddDir: sdd,
      feature: 'session',
      alignment: 1,
      principles: ['C-A', 'C-B'],
      constitutionHash: 'h1',
      now: FIXED_NOW,
    });

    expect(run.verdict).toBe('rise');
    const state = await readState(sdd);
    expect(state.features.session.alignment).toBe(1);
    expect(state.features.session.principles).toEqual(['C-A', 'C-B']);
  });

  it('un estado CORRUPTO avisa, no revienta y se reestablece', async () => {
    const root = await makeTmp();
    const sdd = await sddOf(root);
    await write(root, `.sdd/state/${ADHESION_STATE_FILE}`, '{ esto no es json');

    const run = await runAdhesionRatchet({
      sddDir: sdd,
      feature: 'session',
      alignment: 0.25,
      principles: ['C-A'],
      constitutionHash: 'h1',
      now: FIXED_NOW,
    });

    expect(run.stateCorrupt).toBe(true);
    expect(run.verdict).toBe('corrupt-reestablished');
    const warning = run.findings.find((finding) => finding.code === 'ADHESION_STATE_CORRUPT');
    expect(warning?.severity).toBe('warning');
    expect(run.findings.some((finding) => finding.severity === 'error')).toBe(false);

    // Reestablecido: el fichero vuelve a ser legible y describe la ejecución actual.
    const state = await readState(sdd);
    expect(state.features.session.alignment).toBe(0.25);
  });

  it('un estado con la forma equivocada también se declara corrupto', async () => {
    const sdd = await sddOf(await makeTmp());
    await write(sdd, 'state/adhesion.json', JSON.stringify({ version: 1, features: { session: { alignment: 'uno' } } }));

    const read = await readAdhesionState(sdd);
    expect(read.corrupt).toBe(true);
    expect(read.state).toBeNull();
    expect(read.error).toContain('session');
  });

  it('una versión de estado desconocida se declara corrupta en vez de interpretarse a ojo', async () => {
    const sdd = await sddOf(await makeTmp());
    await write(sdd, 'state/adhesion.json', JSON.stringify({ version: 99, features: {}, acceptances: {} }));

    const read = await readAdhesionState(sdd);
    expect(read.corrupt).toBe(true);
    expect(read.error).toContain('versión 99');
  });

  it('el estado vive en state/adhesion.json y no toca la historia de tendencia', async () => {
    const sdd = await sddOf(await makeTmp());
    expect(adhesionStatePath(sdd)).toBe(path.join(sdd, 'state', 'adhesion.json'));
    await runAdhesionRatchet({
      sddDir: sdd,
      feature: 'session',
      alignment: 1,
      principles: ['C-A'],
      constitutionHash: 'h1',
      now: FIXED_NOW,
    });
    // La tendencia (`adhesion-history.json`) la escribe otra pieza: este módulo no la crea.
    await expect(readFile(path.join(sdd, 'state', 'adhesion-history.json'), 'utf8')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
// Superficie de consola: `--check` vs `--check --strict`
// ---------------------------------------------------------------------------------------------

const makeIO = () => {
  const logs: string[] = [];
  return {
    io: { log: (message: string) => logs.push(message), error: () => undefined, exit: () => undefined },
    get logs() {
      return logs;
    },
  };
};

const REQUIREMENTS = [
  '# Requirements: sesión',
  '',
  '### REQ-SESS-001: Registrar sesión',
  '',
  '- WHEN se invoque el endpoint, the system shall registrar la sesión con su marca de tiempo.',
  '',
].join('\n');

const TASKS = [
  '- [x] 1.1 implementar el registro — _Requirements: REQ-SESS-001_ — _Boundary:_ `src/session`',
  '  _Evidence: npx vitest run (3 passed)',
  '',
].join('\n');

/** Declara `C-STACK-FACT`: alineación 1, sin hallazgos. */
const PLAN_ALIGNED = ['# Plan: sesión', '', '## Constitution', '', '- C-STACK-FACT — el stack no se moderniza sin enmienda.', ''].join(
  '\n',
);

/** No declara nada: el pivote emite NO_PRINCIPLES_DECLARED (aviso) y la alineación es 0, sin errores. */
const PLAN_NO_DECLARATION = ['# Plan: sesión', '', '## Enfoque', '', '- Implementar el registro de sesión.', ''].join('\n');

const stackPrinciple = (id: string) => ({
  id,
  title: `Principio ${id}`,
  level: 'SHOULD' as const,
  threatReference: 'ADR-001',
  restriction: `El stack en vigor (Node.js, TypeScript ESM y vitest) se declara hecho establecido y no se moderniza sin una enmienda gobernada (${id}).`,
  pattern: 'Un cambio de stack se tramita como enmienda con plan de migración aprobado.',
  justification: 'Modernizar sin pedido destruye el comportamiento anclado que nadie autorizó a cambiar.',
  provenance: 'descriptive' as const,
  evidence: ['package.json'],
});

const constitutionWith = (ids: string[]): Constitution => ({
  project: 'demo',
  provenance: 'descriptive',
  establishedFacts: ['El stack en vigor es Node.js + TypeScript ESM + vitest.'],
  principles: ids.map(stackPrinciple),
  amendments: [],
});

const seed = async (root: string, plan: string, ids: string[] = ['C-STACK-FACT']): Promise<void> => {
  await write(root, '.sdd/steering/constitution.md', renderConstitution(constitutionWith(ids)));
  await write(
    root,
    '.sdd/settings/rigor.json',
    JSON.stringify({ level: 'spec-first', rationale: 'Fixture con motivo declarado.', brownfield: true }, null, 2),
  );
  await write(root, '.sdd/specs/session/requirements.md', REQUIREMENTS);
  await write(root, '.sdd/specs/session/plan.md', plan);
  await write(root, '.sdd/specs/session/tasks.md', TASKS);
};

describe('cli/status — el modo estricto del gate (REQ-MAT-005)', () => {
  it('--strict sale 1 con un AVISO donde --check a secas sale 0', async () => {
    const plainRoot = await makeTmp();
    await seed(plainRoot, PLAN_NO_DECLARATION);
    const plain = makeIO();
    const plainCode = await handleStatusCommand(['session', '--check'], plain.io, plainRoot);

    const strictRoot = await makeTmp();
    await seed(strictRoot, PLAN_NO_DECLARATION);
    const strict = makeIO();
    const strictCode = await handleStatusCommand(['session', '--check', '--strict'], strict.io, strictRoot);

    expect(plainCode).toBe(0);
    expect(strictCode).toBe(1);
    // El aviso existe en ambos; lo que cambia es el umbral, y el modo se imprime.
    expect(plain.logs.join('\n')).toContain('NO_PRINCIPLES_DECLARED');
    expect(strict.logs.join('\n')).toContain('NO_PRINCIPLES_DECLARED');
    expect(plain.logs.join('\n')).toContain('--check · modo errores');
    expect(strict.logs.join('\n')).toContain('--check · modo estricto');
    // «Lo que strict añade» se declara en los dos modos.
    expect(plain.logs.join('\n')).toMatch(/Modo estricto \(--strict\) añadiría 1 aviso/);
    expect(strict.logs.join('\n')).toMatch(/Añade 1 aviso/);
  });

  it('--check sin avisos sale 0 en los dos modos', async () => {
    const root = await makeTmp();
    await seed(root, PLAN_ALIGNED);
    const ctx = makeIO();

    const code = await handleStatusCommand(['session', '--check', '--strict'], ctx.io, root);

    expect(code).toBe(0);
    expect(ctx.logs.join('\n')).toContain('No hay avisos que escalar');
  });

  it('el veredicto estricto tiene forma de máquina (sobre de cli/jsonOut)', async () => {
    const root = await makeTmp();
    await seed(root, PLAN_NO_DECLARATION);
    const ctx = makeIO();

    const code = await handleStatusCommand(['session', '--json', '--check', '--strict'], ctx.io, root);
    const parsed = JSON.parse(ctx.logs.join('\n')) as {
      ok: boolean;
      command: string;
      data: { mode: string; strictExitCode: number; checkExitCode: number };
      findings: { errors: unknown[]; warnings: { id?: string }[] };
    };

    expect(code).toBe(1);
    expect(parsed.ok).toBe(false);
    expect(parsed.command).toBe('status');
    expect(parsed.data.mode).toBe('strict');
    expect(parsed.data.checkExitCode).toBe(0);
    expect(parsed.data.strictExitCode).toBe(1);
    expect(parsed.findings.errors).toEqual([]);
    expect(parsed.findings.warnings.some((finding) => finding.id === 'NO_PRINCIPLES_DECLARED')).toBe(true);
  });

  it('`--json --check` sin --strict conserva la forma heredada', async () => {
    const root = await makeTmp();
    await seed(root, PLAN_ALIGNED);
    const ctx = makeIO();

    const code = await handleStatusCommand(['session', '--json', '--check'], ctx.io, root);
    const parsed = JSON.parse(ctx.logs.join('\n')) as { alignment?: { alignment: number }; checkExitCode: number; ratchet?: { verdict: string } };

    expect(code).toBe(0);
    expect(parsed.alignment?.alignment).toBe(1);
    expect(parsed.checkExitCode).toBe(0);
    expect(parsed.ratchet?.verdict).toBe('baseline');
  });

  it(
    'un descenso del trinquete falla el gate y nombra al principio; --accept-drop lo autoriza',
    async () => {
      const root = await makeTmp();
      await seed(root, PLAN_ALIGNED, ['C-STACK-FACT', 'C-EXTRA']);
      const first = makeIO();
      expect(await handleStatusCommand(['session', '--check'], first.io, root)).toBe(0);

      // La constitución pierde C-EXTRA y la spec lo deja de declarar: el pivote no ve error, el trinquete sí.
      await seed(root, ['# Plan: sesión', '', '## Constitution', '', '- C-STACK-FACT — sigue en vigor.', ''].join('\n'), ['C-STACK-FACT']);
      const dropped = makeIO();
      const droppedCode = await handleStatusCommand(['session', '--check'], dropped.io, root);
      expect(droppedCode).toBe(1);
      expect(dropped.logs.join('\n')).toContain('ADHESION_DROP');
      expect(dropped.logs.join('\n')).toContain('C-EXTRA');

      const accepted = makeIO();
      const acceptedCode = await handleStatusCommand(
        ['session', '--check', '--accept-drop', 'C-EXTRA se retiró con la enmienda AMD-003'],
        accepted.io,
        root,
      );
      expect(acceptedCode).toBe(0);
      expect(accepted.logs.join('\n')).toContain('ADHESION_DROP_ACCEPTED');

      const state = await readState(path.join(root, '.sdd'));
      expect(state.acceptances.session.at(-1)?.reason).toContain('AMD-003');
      // «--accept-drop <razón>» no debe confundirse con el nombre de la feature.
      expect(accepted.logs.join('\n')).toContain('Specification: session');
    },
    // Tres pivotes completos + trinquete: en una suite cargada no cabe en los 5 s por defecto.
    30_000,
  );

  it('el hash de la constitución distingue dos autoridades con el mismo veredicto', async () => {
    expect(hashConstitution('a')).toBe(hashConstitution('a'));
    expect(hashConstitution('a')).not.toBe(hashConstitution('b'));
  });
});
