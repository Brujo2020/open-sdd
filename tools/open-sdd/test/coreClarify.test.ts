/**
 * Pruebas del motor de CLARIFY.
 *
 * Cada test fija una regla, no una implementación: que la pregunta se derive del código que la
 * levanta y cite el artefacto; que lo que el repositorio ya sabe NO se pregunte y quede registrado
 * como evidencia; que el lote se acote y lo diga; que toda respuesta se escriba byte a byte salvo la
 * línea afectada y se VERIFIQUE re-ejecutando el análisis; que una respuesta que no resuelve se
 * reporte abierta y no como arreglada; y que una respuesta vacía se rechace.
 *
 * Todos los fixtures viven en `os.tmpdir()` y se limpian en `afterEach`: nada se escribe dentro del
 * repositorio.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  applyAnswers,
  clarifyQuestionsFile,
  planClarify,
  readClarifyAnswers,
  type ClarifySession,
} from '../src/core/clarify.js';

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const makeProject = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-clarify-'));
  temps.push(dir);
  return dir;
};

const write = async (root: string, rel: string, content: string): Promise<void> => {
  const target = path.join(root, rel);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
};

const readBack = (root: string, rel: string): Promise<string> =>
  import('node:fs/promises').then((fs) => fs.readFile(path.join(root, rel), 'utf8'));

const REQUIREMENTS_HEADER = '# Requirements: demo\n\n## Requirements\n\n';

const VAGUE_REQUIREMENT = '- WHEN a payment arrives, the [engine] shall respond rápido.';

const projectWithRequirements = async (body: string, feature = 'demo'): Promise<{ root: string; file: string }> => {
  const root = await makeProject();
  const file = `.sdd/specs/${feature}/requirements.md`;
  await write(root, file, `${REQUIREMENTS_HEADER}${body}\n`);
  return { root, file };
};

describe('core/clarify — la pregunta se deriva del código y cita el artefacto', () => {
  it('un requisito compuesto produce UNA pregunta específica que cita el código y el artefacto', async () => {
    const { root, file } = await projectWithRequirements(
      '- The [engine] shall validate the input and shall write an audit log.\n',
    );

    const session = await planClarify({ cwd: root, feature: 'demo' });

    expect(session.questions).toHaveLength(1);
    const question = session.questions[0];
    expect(question.code).toBe('COMPOUND_REQUIREMENT');
    expect(question.id).toMatch(/^Q-COMPOUND-\d+$/);
    expect(question.artifact).toContain(file);
    expect(question.artifact).toContain('validate the input');
    expect(question.target).toBe('- The [engine] shall validate the input and shall write an audit log.');
    expect(question.severity).toBe('error');
    expect(question.answerKind).toBe('statement');
    // La partición mecánica se ofrece como plantilla, no se aplica sin preguntar.
    expect(question.template).toContain('shall validate the input');
    expect(question.options).toBeDefined();
  });

  it('un término vago produce una pregunta por el valor medible, con su hueco marcado', async () => {
    const { root } = await projectWithRequirements(`${VAGUE_REQUIREMENT}\n`);

    const session = await planClarify({ cwd: root, feature: 'demo' });

    const question = session.questions.find((candidate) => candidate.code === 'VAGUE_TERM');
    expect(question).toBeDefined();
    expect(question!.answerKind).toBe('value');
    expect(question!.slot).toBe('rápido');
    expect(question!.question).toMatch(/límite de tiempo|valor o criterio/);
    expect(question!.question).toContain('rápido');
    expect(question!.template).toContain('<valor medible>');
    expect(question!.why.length).toBeGreaterThan(0);
  });
});

describe('core/clarify — el repositorio responde y entonces NO se pregunta', () => {
  it('NO_ACTOR con actor dominante en el documento no se pregunta: viaja como evidencia', async () => {
    const { root, file } = await projectWithRequirements(
      [
        '- WHEN a session starts, the [session service] shall issue a token.',
        '- WHEN the token expires, the [session service] shall rotate the secret.',
        '- WHEN a request arrives, shall reject it without a token.',
      ].join('\n') + '\n',
    );

    const session = await planClarify({ cwd: root, feature: 'demo' });

    expect(session.questions.some((question) => question.code === 'NO_ACTOR')).toBe(false);
    const evidence = session.fromEvidence.find((entry) => entry.code === 'NO_ACTOR');
    expect(evidence).toBeDefined();
    expect(evidence!.evidence).toContain(file);
    expect(evidence!.evidence).toMatch(/2 de 3/);
    expect(evidence!.answer).toBe('WHEN a request arrives, the [session service] shall reject it without a token.');
    expect(session.detail).toContain(evidence!.id);
  });

  it('un marcador {{…}} que nombra una entrada REAL de la delta no se pregunta: se responde', async () => {
    const root = await makeProject();
    await write(
      root,
      '.sdd/specs/login/requirements.md',
      `${REQUIREMENTS_HEADER}- WHEN a user signs in, the [auth service] shall issue a session token.\n`,
    );
    await write(
      root,
      '.sdd/specs/login/delta.md',
      [
        '# Delta: login — Login',
        '',
        'Status: proposed',
        '',
        '## ADDED',
        '',
        '### REQ-AUTH-001 — Login',
        '- Statement: WHEN a user signs in, the [auth service] shall issue a session token.',
        '- Targets: src/auth/session.ts',
        '- Strangler: legacy',
        '',
        '## MODIFIED',
        '',
        '## REMOVED',
        '',
        '## RENAMED',
        '',
      ].join('\n'),
    );
    await write(
      root,
      '.sdd/specs/login/tasks.md',
      '# Tasks: login\n\n- [ ] 1.1 Implement login _Requirements:_ {{REQ-AUTH-001}} _Boundary:_ src/auth/session.ts\n',
    );

    const session = await planClarify({ cwd: root, feature: 'login' });

    expect(session.questions.some((question) => question.code === 'UNFILLED_REQUIREMENT_PLACEHOLDER')).toBe(false);
    const evidence = session.fromEvidence.find((entry) => entry.code === 'UNFILLED_REQUIREMENT_PLACEHOLDER');
    expect(evidence).toBeDefined();
    expect(evidence!.answer).toBe('REQ-AUTH-001');
    expect(evidence!.evidence).toContain('REQ-AUTH-001');
    expect(evidence!.evidence).toContain('delta.md');
  });
});

describe('core/clarify — lote acotado y honesto con el tope', () => {
  it('recorta al tope, lo declara y dice cuántas preguntas quedan fuera', async () => {
    const terms = ['rápido', 'adecuado', 'etc', 'robusto', 'fácil', 'óptimo', 'eficiente'];
    const { root } = await projectWithRequirements(terms.map((term) => `- The [engine] shall respond ${term}.`).join('\n') + '\n');

    const full = await planClarify({ cwd: root, feature: 'demo', max: 50 });
    expect(full.questions.length).toBeGreaterThan(2);
    expect(full.truncated).toBe(false);
    expect(full.remaining).toBe(0);

    const capped = await planClarify({ cwd: root, feature: 'demo', max: 2 });
    expect(capped.questions).toHaveLength(2);
    expect(capped.truncated).toBe(true);
    expect(capped.remaining).toBe(full.questions.length - 2);
    expect(capped.detail).toContain(String(capped.remaining));
    expect(capped.detail).toMatch(/RECORTADO/);
    // Los ids son estables y por código.
    expect(capped.questions.map((question) => question.id)).toEqual(['Q-VAGUE-1', 'Q-VAGUE-2']);
  });
});

describe('core/clarify — applyAnswers escribe y VERIFICA', () => {
  const fixture = async (): Promise<{ root: string; file: string; text: string; session: ClarifySession }> => {
    const { root, file } = await projectWithRequirements(`${VAGUE_REQUIREMENT}\n`);
    const text = await readBack(root, file);
    const session = await planClarify({ cwd: root, feature: 'demo' });
    return { root, file, text, session };
  };

  it('una línea indentada también se localiza y se verifica: el prefijo se conserva y el código se va', async () => {
    const { root, file } = await projectWithRequirements(`  ${VAGUE_REQUIREMENT}\n`);
    const text = await readBack(root, file);
    const session = await planClarify({ cwd: root, feature: 'demo' });
    const question = session.questions.find((candidate) => candidate.code === 'VAGUE_TERM')!;

    const report = applyAnswers({ text, session, answers: { [question.id]: '200 ms' } });

    expect(report.refused).toHaveLength(0);
    expect(report.text).toContain('  - WHEN a payment arrives, the [engine] shall respond 200 ms.');
    expect(report.verification.codeBefore).toBe(1);
    expect(report.verification.codeAfter).toBe(0);
    expect(report.verification.resolved).toContain(question.id);
  });

  it('una respuesta que quita el código se aplica, se prueba (codeAfter < codeBefore) y el id queda resuelto', async () => {
    const { text, session } = await fixture();
    const question = session.questions.find((candidate) => candidate.code === 'VAGUE_TERM')!;

    const report = applyAnswers({ text, session, answers: { [question.id]: '200 ms' } });

    expect(report.refused).toHaveLength(0);
    expect(report.applied).toHaveLength(1);
    expect(report.applied[0].id).toBe(question.id);
    expect(report.text).toContain('shall respond 200 ms.');
    expect(report.text).not.toContain('rápido');
    // Byte a byte: lo único que cambia es el término.
    expect(report.text.replace('200 ms', 'rápido')).toBe(text);
    expect(report.verification.codeBefore).toBe(1);
    expect(report.verification.codeAfter).toBe(0);
    expect(report.verification.resolved).toContain(question.id);
    expect(report.verification.stillOpen).toHaveLength(0);
  });

  it('una respuesta que NO quita la ambigüedad se reporta stillOpen y jamás como arreglada', async () => {
    const { text, session } = await fixture();
    const question = session.questions.find((candidate) => candidate.code === 'VAGUE_TERM')!;

    const report = applyAnswers({ text, session, answers: { [question.id]: 'muy rápido' } });

    expect(report.applied).toHaveLength(1);
    expect(report.text).toContain('muy rápido');
    expect(report.verification.codeBefore).toBe(1);
    expect(report.verification.codeAfter).toBe(1);
    expect(report.verification.resolved).toHaveLength(0);
    expect(report.verification.stillOpen).toContain(question.id);
  });

  it('una respuesta vacía se rechaza y no se escribe nada', async () => {
    const { text, session } = await fixture();
    const question = session.questions.find((candidate) => candidate.code === 'VAGUE_TERM')!;

    const report = applyAnswers({ text, session, answers: { [question.id]: '   ' } });

    expect(report.applied).toHaveLength(0);
    expect(report.refused).toHaveLength(1);
    expect(report.refused[0].id).toBe(question.id);
    expect(report.refused[0].why).toMatch(/vacía/i);
    expect(report.text).toBe(text);
    expect(report.verification.codeBefore).toBe(0);
  });

  it('una respuesta con hueco de plantilla también se rechaza: nunca se escribe un {{…}} ni un <…>', async () => {
    const { text, session } = await fixture();
    const question = session.questions.find((candidate) => candidate.code === 'VAGUE_TERM')!;

    const report = applyAnswers({ text, session, answers: { [question.id]: '<200 ms>' } });

    expect(report.applied).toHaveLength(0);
    expect(report.refused[0].why).toMatch(/hueco de plantilla/);
    expect(report.text).toBe(text);
  });

  it('rellena el marcador {{…}} de una tarea con el id de la delta y verifica que desaparece', async () => {
    const root = await makeProject();
    await write(
      root,
      '.sdd/specs/login/delta.md',
      [
        '# Delta: login — Login',
        '',
        'Status: proposed',
        '',
        '## ADDED',
        '',
        '### REQ-AUTH-001 — Login',
        '- Statement: WHEN a user signs in, the [auth service] shall issue a session token.',
        '- Targets: src/auth/session.ts',
        '- Strangler: legacy',
        '',
        '### REQ-AUTH-002 — Logout',
        '- Statement: WHEN a user signs out, the [auth service] shall revoke the session token.',
        '- Targets: src/auth/session.ts',
        '- Strangler: legacy',
        '',
        '## MODIFIED',
        '',
        '## REMOVED',
        '',
        '## RENAMED',
        '',
      ].join('\n'),
    );
    await write(
      root,
      '.sdd/specs/login/tasks.md',
      '# Tasks: login\n\n- [ ] 1.1 Implement the session endpoint _Requirements:_ {{REQ-AUTH-003}} _Boundary:_ src/auth/session.ts\n',
    );

    const file = '.sdd/specs/login/tasks.md';
    const text = await readBack(root, file);
    const session = await planClarify({ cwd: root, feature: 'login' });
    const question = session.questions.find((candidate) => candidate.code === 'UNFILLED_REQUIREMENT_PLACEHOLDER');
    expect(question).toBeDefined();
    expect(question!.answerKind).toBe('id');
    // El repositorio ofrece las dos entradas sin tarea como opciones.
    expect(question!.options).toEqual(expect.arrayContaining(['REQ-AUTH-001', 'REQ-AUTH-002']));

    const bad = applyAnswers({ text, session: { ...session, questions: [question!] }, answers: { [question!.id]: 'no-es-un-id' } });
    expect(bad.applied).toHaveLength(0);
    expect(bad.refused[0].why).toMatch(/REQ-<ÁREA>-<NNN>/);

    const report = applyAnswers({ text, session: { ...session, questions: [question!] }, answers: { [question!.id]: 'REQ-AUTH-001' } });
    expect(report.applied).toHaveLength(1);
    expect(report.text).toContain('_Requirements:_ REQ-AUTH-001');
    expect(report.text).not.toContain('{{REQ-AUTH-003}}');
    expect(report.verification.codeBefore).toBe(1);
    expect(report.verification.codeAfter).toBe(0);
    expect(report.verification.resolved).toContain(question!.id);
  });
});

describe('core/clarify — límites honestos', () => {
  it('una spec limpia devuelve cero preguntas con un mensaje explícito de limpieza', async () => {
    const { root } = await projectWithRequirements('- The [engine] shall keep working with no model backend and no network access.\n');

    const session = await planClarify({ cwd: root, feature: 'demo' });

    expect(session.questions).toHaveLength(0);
    expect(session.fromEvidence).toHaveLength(0);
    expect(session.unresolvable).toHaveLength(0);
    expect(session.detail).toMatch(/está limpia/);
    expect(session.detail).toContain('0 preguntas');
  });

  it('una línea objetivo duplicada es IRRESOLUBLE: no hay un lugar único donde escribir la respuesta', async () => {
    const { root } = await projectWithRequirements(`${VAGUE_REQUIREMENT}\n${VAGUE_REQUIREMENT}\n`);

    const session = await planClarify({ cwd: root, feature: 'demo' });

    expect(session.questions).toHaveLength(0);
    expect(session.unresolvable).toHaveLength(1);
    expect(session.unresolvable[0].code).toBe('VAGUE_TERM');
    expect(session.unresolvable[0].reason).toMatch(/2 veces/);
  });

  it('sin artefactos no se declara limpia: se dice que no se comprobó nada', async () => {
    const root = await makeProject();
    await mkdir(path.join(root, '.sdd', 'specs', 'demo'), { recursive: true });

    const session = await planClarify({ cwd: root, feature: 'demo' });

    expect(session.questions).toHaveLength(0);
    expect(session.detail).toMatch(/NO se declara limpia/);
  });
});

describe('core/clarify — ciclo no interactivo de preguntas y respuestas', () => {
  it('el fichero de preguntas es rellenable y readClarifyAnswers lo lee en sus dos formas', async () => {
    const { root } = await projectWithRequirements(`${VAGUE_REQUIREMENT}\n`);
    const session = await planClarify({ cwd: root, feature: 'demo' });

    const file = clarifyQuestionsFile(session);
    expect(file.kind).toBe('clarify-questions');
    expect(file.answers).toEqual({});
    expect(String(file.howToAnswer)).toContain('--answers');
    expect((file.questions as unknown[]).length).toBe(session.questions.length);

    const wrapped = readClarifyAnswers(JSON.stringify({ answers: { 'Q-VAGUE-1': '200 ms' } }));
    expect(wrapped.error).toBeUndefined();
    expect(wrapped.answers['Q-VAGUE-1']).toBe('200 ms');

    const flat = readClarifyAnswers(JSON.stringify({ 'Q-VAGUE-1': '200 ms' }));
    expect(flat.answers['Q-VAGUE-1']).toBe('200 ms');

    // Un fichero de preguntas sin rellenar no produce respuestas inventadas.
    const unfilled = readClarifyAnswers(JSON.stringify(file));
    expect(unfilled.error).toBeDefined();
    expect(readClarifyAnswers('{ no es json').error).toBeDefined();
  });
});
