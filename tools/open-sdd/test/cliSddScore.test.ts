/**
 * Pruebas del pie de puntuación en la superficie de consola (`cli/jsonOut.ts` + despachador).
 *
 * Lo que se afirma: el pie aparece en cada comando (también en no-TTY), es UNA línea, `--no-footer`
 * lo apaga, `--json`/`--quiet` lo apagan para no romper su contrato, y la puerta sin argumentos dice
 * el número y la ÚNICA acción siguiente SIN volcar una lista de comandos. Los fixtures viven en
 * `os.tmpdir()` y se limpian en `afterEach`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli } from '../src/index.js';
import { computeSddScore } from '../src/core/sddScore.js';
import {
  SCORE_FOOTER_FLAG,
  emitScoreFooter,
  jsonEnvelope,
  shouldEmitScoreFooter,
} from '../src/cli/jsonOut.js';

const runtime = { platform: 'darwin' } as const;

const dirs: string[] = [];

const makeTmp = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-score-cli-'));
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

const PLAN = ['# Plan: sesión', '', '## Constitution', '', '- C-STACK-FACT — el stack en vigor no se moderniza sin una enmienda gobernada.', ''].join('\n');

const TASKS_DONE = [
  '- [x] 1.1 implementar el registro — _Requirements: REQ-SESS-001_ — _Boundary:_ `src/session`',
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

/** Un repositorio con una spec completa y evidenciada: Fase 3. */
const seedComplete = async (): Promise<string> => {
  const root = await makeTmp();
  await write(root, '.sdd/steering/constitution.md', CONSTITUTION);
  await write(
    root,
    '.sdd/settings/rigor.json',
    JSON.stringify({ level: 'spec-first', rationale: 'Fixture: nivel declarado con motivo explícito.', brownfield: true }, null, 2),
  );
  await write(root, '.sdd/specs/session/requirements.md', REQUIREMENTS);
  await write(root, '.sdd/specs/session/plan.md', PLAN);
  await write(root, '.sdd/specs/session/tasks.md', TASKS_DONE);
  await write(root, '.sdd/specs/session/delta.md', DELTA);
  await write(root, 'test/session/register.test.ts', 'import { it } from "vitest"; it("x", () => {});');
  await write(root, 'package.json', JSON.stringify({ name: 'demo' }, null, 2));
  return root;
};

const footerLines = (logs: string[]): string[] => logs.filter((line) => line.startsWith('SDD '));

describe('cli/sddScore — el pie aparece en cada comando', () => {
  it('un comando normal, en no-TTY, termina con UNA línea de puntuación', async () => {
    const cwd = await seedComplete();
    const ctx = makeIO();

    const code = await runCli(['status', 'session'], runtime, ctx.io, {}, { cwd });

    expect(code).toBe(0);
    const lines = footerLines(ctx.logs);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^SDD \d+% · Fase \d · (Especificar|Implementar|Verificar) · /);
    expect(lines[0]).toContain('siguiente: open-sdd ');
    expect(lines[0].match(/open-sdd [a-z-]/g)).toHaveLength(1);
  });

  it('--no-footer lo apaga sin tocar el veredicto del comando', async () => {
    const cwd = await seedComplete();
    const ctx = makeIO();

    const code = await runCli(['status', 'session', SCORE_FOOTER_FLAG], runtime, ctx.io, {}, { cwd });

    expect(code).toBe(0);
    expect(footerLines(ctx.logs)).toHaveLength(0);
    expect(ctx.logs.join('\n')).toMatch(/Specification: session/);
  });

  it('--json lo apaga y la salida sigue siendo JSON parseable (contrato heredado)', async () => {
    const cwd = await seedComplete();
    const ctx = makeIO();

    const code = await runCli(['status', '--json'], runtime, ctx.io, {}, { cwd });

    expect(code).toBe(0);
    expect(footerLines(ctx.logs)).toHaveLength(0);
    const parsed = JSON.parse(ctx.logs.join('\n')) as { name: string }[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((spec) => spec.name === 'session')).toBe(true);
  });

  it('la puerta sin argumentos imprime el número y la ÚNICA acción, no una lista de comandos', async () => {
    const cwd = await makeTmp();
    const ctx = makeIO();

    const code = await runCli([], runtime, ctx.io, {}, { cwd });

    expect(code).toBe(0);
    expect(ctx.logs).toHaveLength(3);
    expect(ctx.logs[0]).toMatch(/^SDD \d+% · Fase 1 · Especificar/);
    expect(ctx.logs[0]).toContain('siguiente: open-sdd brownfield constitution . --write');
    expect(ctx.logs[1]).toContain('Por qué:');
    expect(ctx.logs[2]).toBe('todos los comandos: open-sdd --help');
    const text = ctx.logs.join('\n');
    expect(text).not.toContain('Usage: open-sdd');
    expect(text).not.toContain('/sdd-');
  });

  it('`--no-footer` a solas sigue siendo la puerta (el pie ES su salida)', async () => {
    const cwd = await makeTmp();
    const ctx = makeIO();

    const code = await runCli([SCORE_FOOTER_FLAG], runtime, ctx.io, {}, { cwd });

    expect(code).toBe(0);
    expect(ctx.logs[0]).toMatch(/^SDD \d+%/);
    expect(ctx.logs.at(-1)).toBe('todos los comandos: open-sdd --help');
  });
});

describe('cli/jsonOut — el sobre gana el score y el pie se decide en un solo sitio', () => {
  it('incluye el score cuando el comando lo aporta y no lo inventa cuando no', async () => {
    const root = await makeTmp();
    const score = await computeSddScore(root);

    const withScore = jsonEnvelope({ command: 'status', data: null, score });
    expect(withScore.score).toEqual(score);
    expect(Object.keys(withScore)).toContain('score');

    const withoutScore = jsonEnvelope({ command: 'status', data: null });
    expect(Object.keys(withoutScore)).toEqual(['ok', 'command', 'data', 'findings', 'detail']);
    expect(withoutScore.score).toBeUndefined();
  });

  it('suprime el pie con --no-footer, --json o --quiet', () => {
    expect(shouldEmitScoreFooter(['status'])).toBe(true);
    expect(shouldEmitScoreFooter(['status', SCORE_FOOTER_FLAG])).toBe(false);
    expect(shouldEmitScoreFooter(['status', '--json'])).toBe(false);
    expect(shouldEmitScoreFooter(['status', '--quiet'])).toBe(false);
  });

  it('emitScoreFooter escribe exactamente una línea y nunca lanza', async () => {
    const cwd = await makeTmp();
    const ctx = makeIO();

    const report = await emitScoreFooter(['status'], ctx.io, cwd);

    expect(report).not.toBeNull();
    expect(ctx.logs).toHaveLength(1);
    expect(ctx.logs[0].split('\n')).toHaveLength(1);
    expect(await emitScoreFooter(['status', SCORE_FOOTER_FLAG], ctx.io, cwd)).toBeNull();
    expect(ctx.logs).toHaveLength(1);
  });
});
