/**
 * Pruebas de comportamiento POR LA CLI de las dos puertas en lenguaje natural.
 *
 * Lo que se fija aquí es el contrato de la superficie:
 *  · `brownfield specify <feature> "<descripción>"` es headless-first: sin `--write` no toca la
 *    especificación, escribe las preguntas con `--questions-file`, y `--write` solo AÑADE (nunca
 *    sobrescribe un requisito existente: lo informa como `keep`);
 *  · `brownfield constitution <target> --interview` imprime las preguntas y lo que la evidencia ya
 *    decidió, y con `--answers <path> --write` deja el BORRADOR en `constitution.draft.md` sin tocar
 *    `constitution.md`.
 *
 * Todo ocurre en fixtures `mkdtemp`: nada se escribe en este repositorio.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleBrownfieldCommand } from '../src/cli/commands/brownfield.js';
import { parseConstitution, principlesInForce } from '../src/core/constitution.js';
import { DRAFT_MARKER } from '../src/core/constitutionDraft.js';
import { SPECIFY_QUESTIONS_FILE_KIND } from '../src/core/interview.js';
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

/** Un proyecto cuyo código demuestra prácticas: stack, tests, API pública, fronteras y config. */
const fixture = async (): Promise<string> => {
  const dir = await makeTemp('open-sdd-cli-interview-');
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'cli-interview-fixture',
        version: '1.0.0',
        main: 'src/index.ts',
        scripts: { test: 'vitest run' },
        devDependencies: { typescript: '^5.9.3', vitest: '^4.0.18' },
      },
      null,
      2,
    ),
    'utf8',
  );
  await writeFile(path.join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3 }, null, 2), 'utf8');
  await writeFile(path.join(dir, 'tsconfig.json'), '{\n  "compilerOptions": { "strict": true }\n}\n', 'utf8');
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await mkdir(path.join(dir, 'test'), { recursive: true });
  await writeFile(path.join(dir, 'src', 'index.ts'), 'export const api = true;\n', 'utf8');
  await writeFile(path.join(dir, 'src', 'config.ts'), 'export const config = { port: 1 };\n', 'utf8');
  await writeFile(path.join(dir, 'test', 'api.test.ts'), 'export const placeholder = true;\n', 'utf8');
  return dir;
};

const requirementsPathOf = (dir: string, feature: string): string =>
  path.join(dir, '.sdd', 'specs', feature, 'requirements.md');
const inForcePathOf = (dir: string): string => path.join(dir, '.sdd', 'steering', 'constitution.md');
const draftPathOf = (dir: string): string => path.join(dir, '.sdd', 'steering', 'constitution.draft.md');

describe('cli/interview — brownfield specify', () => {
  it('sin --write no escribe requirements.md y lo dice', async () => {
    const dir = await fixture();
    const { io, logs, errors } = makeIO();
    const code = await handleBrownfieldCommand(['specify', 'auth', 'el sistema debe validar el token'], io, dir);

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(existsSync(requirementsPathOf(dir, 'auth'))).toBe(false);
    expect(logs.join('\n')).toMatch(/REQ-AUTH-001/);
    expect(logs.join('\n')).toMatch(/Solo previsualización/);
  });

  it('--write crea requirements.md y una segunda ejecución conserva (keep) sin reescribir', async () => {
    const dir = await fixture();
    const first = makeIO();
    const code = await handleBrownfieldCommand(
      ['specify', 'auth', 'el sistema debe validar el token', '--write'],
      first.io,
      dir,
    );
    expect(code).toBe(0);
    expect(first.errors).toEqual([]);
    const written = await readFile(requirementsPathOf(dir, 'auth'), 'utf8');
    expect(written).toContain('- **REQ-AUTH-001**');
    expect(written).toContain('El sistema shall validar el token.');

    const second = makeIO();
    const again = await handleBrownfieldCommand(
      ['specify', 'auth', 'el sistema debe validar el token', '--write'],
      second.io,
      dir,
    );
    expect(again).toBe(0);
    expect(second.errors).toEqual([]);
    expect(await readFile(requirementsPathOf(dir, 'auth'), 'utf8')).toBe(written);
    expect(second.logs.join('\n')).toMatch(/keep/);
    expect(second.logs.join('\n')).toMatch(/no se ha tocado/);
  });

  it('--write solo añade: el requisito existente se conserva y el nuevo no colisiona', async () => {
    const dir = await fixture();
    const first = makeIO();
    await handleBrownfieldCommand(['specify', 'auth', 'el sistema debe validar el token', '--write'], first.io, dir);
    const before = await readFile(requirementsPathOf(dir, 'auth'), 'utf8');

    const second = makeIO();
    const code = await handleBrownfieldCommand(
      ['specify', 'auth', 'el sistema debe registrar el fallo', '--write'],
      second.io,
      dir,
    );
    expect(code).toBe(0);
    const after = await readFile(requirementsPathOf(dir, 'auth'), 'utf8');
    expect(after.startsWith(before.trimEnd())).toBe(true);
    expect(after).toContain('- **REQ-AUTH-001**');
    expect(after).toContain('- **REQ-AUTH-002**');
  });

  it('una descripción incompleta sale 1 y escribe las preguntas en --questions-file', async () => {
    const dir = await fixture();
    const questionsPath = path.join(dir, 'questions.json');
    const { io, logs, errors } = makeIO();
    const code = await handleBrownfieldCommand(
      ['specify', 'orders', 'cuando llega un pedido, calcular el total con impuestos', '--questions-file', questionsPath],
      io,
      dir,
    );

    expect(code).toBe(1);
    expect(errors).toEqual([]);
    expect(existsSync(requirementsPathOf(dir, 'orders'))).toBe(false);
    expect(logs.join('\n')).toMatch(/NO son requisitos/);

    const payload = JSON.parse(await readFile(questionsPath, 'utf8')) as {
      kind: string;
      feature: string;
      area: string;
      questions: { id: string; missing: string; question: string }[];
      accepted: unknown[];
    };
    expect(payload.kind).toBe(SPECIFY_QUESTIONS_FILE_KIND);
    expect(payload.feature).toBe('orders');
    expect(payload.area).toBe('ORDERS');
    expect(payload.questions.length).toBe(1);
    expect(payload.questions[0].missing).toBe('actor');
    expect(payload.accepted).toEqual([]);
  });

  it('--json emite el sobre y declara ok solo cuando no quedan preguntas', async () => {
    const dir = await fixture();
    const complete = makeIO();
    const code = await handleBrownfieldCommand(
      ['specify', 'auth', 'el sistema debe validar el token', '--json'],
      complete.io,
      dir,
    );
    expect(code).toBe(0);
    const envelope = JSON.parse(complete.logs.join('\n')) as {
      ok: boolean;
      command: string;
      data: { requirements: { id: string; pattern: string }[]; questions: unknown[] };
    };
    expect(envelope.command).toBe('brownfield specify');
    expect(envelope.ok).toBe(true);
    expect(envelope.data.requirements[0].id).toBe('REQ-AUTH-001');
    expect(envelope.data.requirements[0].pattern).toBe('ubiquitous');
    expect(envelope.data.questions).toEqual([]);

    const incomplete = makeIO();
    const incompleteCode = await handleBrownfieldCommand(
      ['specify', 'auth', 'cuando llega un pedido, calcular el total', '--json'],
      incomplete.io,
      dir,
    );
    expect(incompleteCode).toBe(1);
    const other = JSON.parse(incomplete.logs.join('\n')) as { ok: boolean; data: { questions: { missing: string }[] } };
    expect(other.ok).toBe(false);
    expect(other.data.questions[0].missing).toBe('actor');
  });
});

describe('cli/interview — brownfield constitution --interview', () => {
  it('sin --answers imprime lo decidido por evidencia y las preguntas que quedan', async () => {
    const dir = await fixture();
    const { io, logs, errors } = makeIO();
    const code = await handleBrownfieldCommand(['constitution', dir, '--interview'], io, dir);

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    const output = logs.join('\n');
    expect(output).toMatch(/Decidido por evidencia \(NO se pregunta\)/);
    expect(output).toMatch(/stack/);
    expect(output).toMatch(/evidencia:/);
    expect(output).toMatch(/Q-RATIFY-EVIDENCED/);
    expect(output).toMatch(/--answers/);
    // La entrevista no escribe nada.
    expect(existsSync(draftPathOf(dir))).toBe(false);
    expect(existsSync(inForcePathOf(dir))).toBe(false);
  });

  it('--json imprime la entrevista y el bloque que un host rellena', async () => {
    const dir = await fixture();
    const { io, logs, errors } = makeIO();
    const code = await handleBrownfieldCommand(['constitution', dir, '--interview', '--json'], io, dir);
    expect(code).toBe(0);
    expect(errors).toEqual([]);
    const envelope = JSON.parse(logs.join('\n')) as {
      ok: boolean;
      data: { decidedByEvidence: string[]; questions: { id: string }[]; deferForHost: Record<string, unknown> };
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.decidedByEvidence.length).toBeGreaterThan(0);
    expect(envelope.data.questions.some((question) => question.id === 'Q-RATIFY-EVIDENCED')).toBe(true);
    const host = envelope.data.deferForHost as { kind: string; answersTemplate: Record<string, string> };
    expect(host.kind).toBe('constitution-interview');
    expect(host.answersTemplate['Q-RATIFY-EVIDENCED']).toBe('sí');
  });

  it('--answers --write deja el borrador y NUNCA toca constitution.md', async () => {
    const dir = await fixture();
    await mkdir(path.join(dir, '.sdd', 'steering'), { recursive: true });
    const inForce = '# Constitution — preexistente\n\nProvenance: descriptive\n';
    await writeFile(inForcePathOf(dir), inForce, 'utf8');

    // La plantilla de respuestas sale del propio JSON de la entrevista (ida y vuelta por la CLI).
    const jsonRun = makeIO();
    const jsonCode = await handleBrownfieldCommand(['constitution', dir, '--interview', '--json'], jsonRun.io, dir);
    expect(jsonCode).toBe(0);
    const interview = JSON.parse(jsonRun.logs.join('\n')) as {
      data: { deferForHost: { answersTemplate: Record<string, string> } };
    };
    const answers = interview.data.deferForHost.answersTemplate;
    expect(answers['Q-RATIFY-EVIDENCED']).toBe('sí');
    const answersPath = path.join(dir, 'answers.json');
    await writeFile(answersPath, JSON.stringify(answers, null, 2), 'utf8');

    const run = makeIO();
    const code = await handleBrownfieldCommand(
      ['constitution', dir, '--interview', '--answers', answersPath, '--write'],
      run.io,
      dir,
    );
    expect(code).toBe(0);
    expect(run.errors).toEqual([]);
    expect(existsSync(draftPathOf(dir))).toBe(true);
    // La constitución en vigor queda byte a byte igual.
    expect(await readFile(inForcePathOf(dir), 'utf8')).toBe(inForce);
    expect(run.logs.join('\n')).toMatch(/no se ha tocado/);

    const draft = await readFile(draftPathOf(dir), 'utf8');
    expect(draft.split('\n').slice(0, 6).join('\n')).toContain(DRAFT_MARKER);
    expect(draft).toMatch(/NO está en vigor/);
    const reloaded = parseConstitution(draft);
    expect(reloaded.principles.length).toBeGreaterThan(0);
    expect(reloaded.principles.every((principle) => principle.draft === true)).toBe(true);
    expect(principlesInForce(reloaded)).toEqual([]);
    expect(reloaded.principles.some((principle) => principle.id === 'C-API-DEPRECATION')).toBe(true);
  });

  it('sin --write produce el borrador en la salida (headless) y no lo escribe', async () => {
    const dir = await fixture();
    const jsonRun = makeIO();
    await handleBrownfieldCommand(['constitution', dir, '--interview', '--json'], jsonRun.io, dir);
    const template = (
      JSON.parse(jsonRun.logs.join('\n')) as { data: { deferForHost: { answersTemplate: Record<string, string> } } }
    ).data.deferForHost.answersTemplate;
    const answersPath = path.join(dir, 'answers.json');
    await writeFile(answersPath, JSON.stringify({ answers: template }, null, 2), 'utf8');

    const { io, logs, errors } = makeIO();
    const code = await handleBrownfieldCommand(
      ['constitution', dir, '--interview', '--answers', answersPath],
      io,
      dir,
    );
    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(existsSync(draftPathOf(dir))).toBe(false);
    expect(logs.join('\n')).toContain(DRAFT_MARKER);
    expect(logs.join('\n')).toMatch(/NO está en vigor/);
  });

  it('una respuesta que produciría un principio inválido sale 1 y lo dice', async () => {
    const dir = await fixture();
    const answersPath = path.join(dir, 'bad-answers.json');
    await writeFile(
      answersPath,
      JSON.stringify({ 'Q-ADOPT-AMD-REUSE-FIRST': 'sí: adoptarlo unless the user asks' }, null, 2),
      'utf8',
    );

    const { io, logs, errors } = makeIO();
    const code = await handleBrownfieldCommand(
      ['constitution', dir, '--interview', '--answers', answersPath, '--write'],
      io,
      dir,
    );

    expect(code).toBe(1);
    expect(errors).toEqual([]);
    const output = logs.join('\n');
    expect(output).toMatch(/INJ-/);
    expect(output).toMatch(/BLOQUEAN la ratificación/);
    // El borrador se produce igual (no se oculta el defecto) pero declara el error.
    const draft = await readFile(draftPathOf(dir), 'utf8');
    expect(draft).toMatch(/BLOQUEAN la ratificación/);
  });

  it('un fichero de respuestas ilegible o vacío se rechaza sin escribir', async () => {
    const dir = await fixture();
    const missing = makeIO();
    const missingCode = await handleBrownfieldCommand(
      ['constitution', dir, '--interview', '--answers', path.join(dir, 'nope.json')],
      missing.io,
      dir,
    );
    expect(missingCode).toBe(1);
    expect(missing.errors.join('\n')).toMatch(/No se puede leer/);

    const emptyPath = path.join(dir, 'empty.json');
    await writeFile(emptyPath, '{}', 'utf8');
    const empty = makeIO();
    const emptyCode = await handleBrownfieldCommand(
      ['constitution', dir, '--interview', '--answers', emptyPath],
      empty.io,
      dir,
    );
    expect(emptyCode).toBe(1);
    expect(empty.errors.join('\n')).toMatch(/ninguna respuesta reconocible/);
    expect(existsSync(draftPathOf(dir))).toBe(false);
  });
});
