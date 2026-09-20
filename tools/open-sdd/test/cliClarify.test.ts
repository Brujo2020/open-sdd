/**
 * Clarify visto POR LA CLI: el ciclo no interactivo completo contra `runCli` (el mismo camino que
 * ejecuta una persona), con fixtures en `os.tmpdir()` y limpieza en `afterEach`.
 *
 * Fija las reglas que solo se pueden probar de punta a punta: que `--questions-file` escriba un
 * fichero rellenable, que `--answers` sin `--write` NO toque la especificación, que `--answers
 * --write` aplique y publique la verificación antes/después, que un lote recortado lo diga, y que
 * `--write` sin respuestas se rechace en vez de inventar.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli } from '../src/index.js';
import type { CliIO } from '../src/cli/io.js';

const runtime = { platform: 'darwin' } as const;
const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const makeIO = (): { io: CliIO; logs: string[]; errs: string[] } => {
  const logs: string[] = [];
  const errs: string[] = [];
  return {
    io: {
      log: (message) => logs.push(message),
      error: (message) => errs.push(message),
      exit: () => undefined,
    },
    logs,
    errs,
  };
};

const makeProject = async (body: string, feature = 'demo'): Promise<{ root: string; requirements: string }> => {
  const root = await mkdtemp(path.join(tmpdir(), 'sdd-cli-clarify-'));
  temps.push(root);
  const requirements = path.join(root, '.sdd', 'specs', feature, 'requirements.md');
  await mkdir(path.dirname(requirements), { recursive: true });
  await writeFile(requirements, `# Requirements: demo\n\n## Requirements\n\n${body}\n`, 'utf8');
  return { root, requirements };
};

const VAGUE = '- WHEN a payment arrives, the [engine] shall respond rápido.';

describe('CLI brownfield clarify — ciclo no interactivo', () => {
  it('--questions-file → rellenar answers → --answers --write reescribe y verifica antes/después', async () => {
    const { root, requirements } = await makeProject(`${VAGUE}\n`);
    const questionsPath = path.join(root, 'clarify-questions.json');
    const original = await readFile(requirements, 'utf8');

    const roundTrip = makeIO();
    const planCode = await runCli(
      ['brownfield', 'clarify', 'demo', '--questions-file', questionsPath],
      runtime,
      roundTrip.io,
      {},
      { cwd: root },
    );
    expect(planCode).toBe(0);
    expect(roundTrip.logs.join('\n')).toMatch(/preguntas escritas en/);

    const file = JSON.parse(await readFile(questionsPath, 'utf8')) as {
      kind: string;
      questions: { id: string; code: string }[];
      answers: Record<string, string>;
      howToAnswer: string;
    };
    expect(file.kind).toBe('clarify-questions');
    expect(file.howToAnswer).toContain('--answers');
    const vague = file.questions.find((question) => question.code === 'VAGUE_TERM');
    expect(vague).toBeDefined();
    file.answers[vague!.id] = '200 ms';
    await writeFile(questionsPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');

    const apply = makeIO();
    const applyCode = await runCli(
      ['brownfield', 'clarify', 'demo', '--answers', questionsPath, '--write'],
      runtime,
      apply.io,
      {},
      { cwd: root },
    );
    expect(applyCode).toBe(0);
    const written = apply.logs.join('\n');
    expect(written).toMatch(/aplicada/);
    expect(written).toMatch(/códigos antes 1 · después 0/);
    expect(written).toMatch(/resueltos Q-VAGUE-1/);
    // Honestidad: tras escribir, la salida no puede decir que no se escribió nada.
    expect(written).not.toMatch(/No se ha escrito nada/);
    expect(written).toMatch(/1 fichero\(s\) reescrito\(s\)/);

    const after = await readFile(requirements, 'utf8');
    expect(after).toContain('shall respond 200 ms.');
    expect(after).not.toContain('rápido');
    // Byte a byte salvo la línea reescrita.
    expect(after.replace('200 ms', 'rápido')).toBe(original);

    // Segunda pasada: la spec ya está limpia y se dice explícitamente.
    const clean = makeIO();
    const cleanCode = await runCli(['brownfield', 'clarify', 'demo'], runtime, clean.io, {}, { cwd: root });
    expect(cleanCode).toBe(0);
    expect(clean.logs.join('\n')).toMatch(/está limpia/);
    expect(clean.logs.join('\n')).toContain('0 preguntas');
  });

  it('--answers sin --write NO toca la especificación: solo muestra el antes/después', async () => {
    const { root, requirements } = await makeProject(`${VAGUE}\n`);
    const original = await readFile(requirements, 'utf8');
    const answersPath = path.join(root, 'answers.json');
    await writeFile(answersPath, JSON.stringify({ answers: { 'Q-VAGUE-1': '200 ms' } }), 'utf8');

    const ctx = makeIO();
    const code = await runCli(
      ['brownfield', 'clarify', 'demo', '--answers', answersPath],
      runtime,
      ctx.io,
      {},
      { cwd: root },
    );

    expect(code).toBe(0);
    expect(ctx.logs.join('\n')).toMatch(/sin --write, no escrita/);
    expect(ctx.logs.join('\n')).toMatch(/NO se ha tocado/);
    expect(await readFile(requirements, 'utf8')).toBe(original);
  });

  it('--write sin respuestas se rechaza y no escribe nada', async () => {
    const { root, requirements } = await makeProject(`${VAGUE}\n`);
    const original = await readFile(requirements, 'utf8');

    const ctx = makeIO();
    const code = await runCli(['brownfield', 'clarify', 'demo', '--write'], runtime, ctx.io, {}, { cwd: root });

    expect(code).toBe(1);
    expect(ctx.errs.join('\n')).toMatch(/--answers/);
    expect(ctx.errs.join('\n')).toMatch(/Nada se ha escrito/);
    expect(await readFile(requirements, 'utf8')).toBe(original);
  });

  it('una respuesta rechazada (vacía) sale con 1 y se informa como rechazada', async () => {
    const { root, requirements } = await makeProject(`${VAGUE}\n`);
    const original = await readFile(requirements, 'utf8');
    const answersPath = path.join(root, 'answers.json');
    await writeFile(answersPath, JSON.stringify({ answers: { 'Q-VAGUE-1': '   ' } }), 'utf8');

    const ctx = makeIO();
    const code = await runCli(
      ['brownfield', 'clarify', 'demo', '--answers', answersPath, '--write'],
      runtime,
      ctx.io,
      {},
      { cwd: root },
    );

    expect(code).toBe(1);
    expect(ctx.logs.join('\n')).toMatch(/rechazada/);
    expect(await readFile(requirements, 'utf8')).toBe(original);
  });

  it('--max acota el lote y la CLI lo declara con cuántas quedan fuera', async () => {
    const { root } = await makeProject(`${VAGUE}\n- The [engine] shall respond adecuado.\n- The [engine] shall respond robusto.\n`);

    const ctx = makeIO();
    const code = await runCli(['brownfield', 'clarify', 'demo', '--max', '1'], runtime, ctx.io, {}, { cwd: root });

    expect(code).toBe(0);
    const output = ctx.logs.join('\n');
    expect(output).toMatch(/lote recortado: 2 sin mostrar/);
    expect(output).toMatch(/Lote RECORTADO al tope de 1: quedan 2/);
  });

  it('--max inválido se rechaza con un error explícito', async () => {
    const { root } = await makeProject(`${VAGUE}\n`);

    const ctx = makeIO();
    const code = await runCli(['brownfield', 'clarify', 'demo', '--max', 'muchas'], runtime, ctx.io, {}, { cwd: root });

    expect(code).toBe(1);
    expect(ctx.errs.join('\n')).toMatch(/--max debe ser un entero/);
  });

  it('--json emite el sobre estable con la sesión y las preguntas como avisos', async () => {
    const { root } = await makeProject(`${VAGUE}\n`);

    const ctx = makeIO();
    const code = await runCli(['brownfield', 'clarify', 'demo', '--json'], runtime, ctx.io, {}, { cwd: root });

    expect(code).toBe(0);
    const envelope = JSON.parse(ctx.logs.join('\n')) as {
      ok: boolean;
      command: string;
      data: { session: { questions: { id: string; code: string }[]; detail: string } };
      findings: { errors: unknown[]; warnings: unknown[] };
    };
    expect(envelope.command).toBe('brownfield clarify');
    expect(envelope.ok).toBe(true);
    expect(envelope.data.session.questions.some((question) => question.code === 'VAGUE_TERM')).toBe(true);
    expect(envelope.findings.warnings.length).toBe(envelope.data.session.questions.length);
  });

  it('sin feature ni spec en el repositorio se rechaza con un error, sin tocar nada', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sdd-cli-clarify-empty-'));
    temps.push(root);

    const ctx = makeIO();
    const code = await runCli(['brownfield', 'clarify'], runtime, ctx.io, {}, { cwd: root });

    expect(code).toBe(1);
    expect(ctx.errs.join('\n')).toMatch(/No hay especificación que clarificar/);
  });
});
