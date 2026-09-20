/**
 * Pruebas de comportamiento de las DOS PUERTAS DE ENTRADA EN LENGUAJE NATURAL.
 *
 * Lo que se fija aquí, regla por regla:
 *  · la entrevista NO pregunta lo que el repositorio ya responde (el stack se cita como evidencia y
 *    no aparece como pregunta), y una pregunta con valor por defecto derivado del repositorio lleva
 *    `fromEvidence`;
 *  · `applyConstitutionAnswers` produce un BORRADOR marcado como no en vigor que `validateConstitution`
 *    acepta, y reporta como error una respuesta que produciría un principio inválido (una inyección);
 *  · el borrador nunca toca una constitución en vigor existente;
 *  · `specifyFromDescription` nombra el patrón EARS de un comportamiento completo y emite PREGUNTAS
 *    (no requisitos) cuando falta el actor, el disparador o el valor medible; los enunciados
 *    existentes se conservan.
 *
 * Todo ocurre en fixtures `mkdtemp`: nada se escribe en este repositorio.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DRAFT_MARKER } from '../src/core/constitutionDraft.js';
import {
  parseConstitution,
  principlesInForce,
  validateConstitution,
} from '../src/core/constitution.js';
import {
  INTERVIEW_ANSWERS_FILE_KIND,
  applyConstitutionAnswers,
  existingRequirementStatements,
  planConstitutionInterview,
  requirementArea,
  specifyFromDescription,
  type ConstitutionInterview,
} from '../src/core/interview.js';

const temps: string[] = [];

const makeTemp = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Un proyecto cuyo código demuestra prácticas: stack, tests, API pública, fronteras y config. */
const evidencedFixture = async (): Promise<string> => {
  const dir = await makeTemp('open-sdd-interview-');
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'interview-fixture',
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
  await mkdir(path.join(dir, 'src', 'core'), { recursive: true });
  await mkdir(path.join(dir, 'test'), { recursive: true });
  await writeFile(path.join(dir, 'src', 'index.ts'), 'export const api = true;\n', 'utf8');
  await writeFile(path.join(dir, 'src', 'config.ts'), 'export const config = { port: 1 };\n', 'utf8');
  await writeFile(path.join(dir, 'src', 'core', 'engine.ts'), 'export const engine = true;\n', 'utf8');
  await writeFile(path.join(dir, 'test', 'engine.test.ts'), 'export const placeholder = true;\n', 'utf8');
  return dir;
};

const inForcePathOf = (dir: string): string => path.join(dir, '.sdd', 'steering', 'constitution.md');
const draftPathOf = (dir: string): string => path.join(dir, '.sdd', 'steering', 'constitution.draft.md');

const answersFromTemplate = (interview: ConstitutionInterview): Record<string, string> => {
  const template = interview.deferForHost?.answersTemplate;
  expect(template).toBeDefined();
  return { ...(template as Record<string, string>) };
};

describe('core/interview — la entrevista no pregunta lo que el repositorio ya responde', () => {
  it('cita el stack como evidencia y NO lo pregunta', async () => {
    const dir = await evidencedFixture();
    const interview = await planConstitutionInterview(dir);

    const decided = interview.decidedByEvidence.join('\n');
    expect(decided).toMatch(/stack/i);
    expect(decided).toMatch(/evidencia:/i);
    expect(decided).toMatch(/package\.json/);

    // Ninguna pregunta PIDE el stack como dato: sería preguntar lo que el manifiesto ya declara.
    expect(
      interview.questions.some((question) =>
        /(qu[eé]|cu[aá]l)\s+(es\s+)?(el\s+|tu\s+)?(stack|lenguaje|gestor de paquetes)/i.test(question.question),
      ),
    ).toBe(false);
    // La única mención de C-STACK-FACT es la ratificación de lo que el código YA demuestra.
    const mentionsStackPrinciple = interview.questions.filter((question) => /C-STACK-FACT/.test(question.question));
    expect(mentionsStackPrinciple.every((question) => question.id === 'Q-RATIFY-EVIDENCED')).toBe(true);

    // Y hay al menos una pregunta que la evidencia no puede responder.
    expect(interview.questions.some((question) => question.id === 'Q-RATIFY-EVIDENCED')).toBe(true);
    expect(interview.questions.length).toBeGreaterThan(0);
  });

  it('las prácticas observadas van a decidedByEvidence con su evidencia, no a questions', async () => {
    const dir = await evidencedFixture();
    const interview = await planConstitutionInterview(dir);
    const decided = interview.decidedByEvidence.join('\n');

    expect(decided).toMatch(/práctica observada C-STACK-FACT/);
    expect(decided).toMatch(/práctica observada C-REGRESSION-ORACLE|práctica observada C-API-COMPAT/);
    expect(interview.evidence.length).toBeGreaterThan(0);
    expect(interview.detail).toMatch(/no se preguntan/i);
  });

  it('una pregunta cuyo valor por defecto sale del repositorio lleva fromEvidence', async () => {
    const dir = await evidencedFixture();
    const interview = await planConstitutionInterview(dir);

    const normative = interview.questions.find((question) => question.id === 'Q-NORM-API-DEPRECATION');
    expect(normative).toBeDefined();
    expect(normative?.fromEvidence).toBeTruthy();
    expect(normative?.fromEvidence).toMatch(/API pública|origen/i);

    const adopt = interview.questions.find((question) => question.id.startsWith('Q-ADOPT-'));
    expect(adopt).toBeDefined();
    expect(adopt?.fromEvidence).toMatch(/ausencia observada/i);
    expect(adopt?.default).toBe('no todavía');

    const template = interview.deferForHost?.answersTemplate as Record<string, string>;
    expect(Object.keys(template).length).toBeGreaterThan(0);
    expect(template['Q-RATIFY-EVIDENCED']).toBe('sí');
  });
});

describe('core/interview — applyConstitutionAnswers produce un borrador VALIDADO', () => {
  it('con las respuestas esperadas: sin errores, marcado como borrador y fuera de vigor', async () => {
    const dir = await evidencedFixture();
    const interview = await planConstitutionInterview(dir);
    const answers = answersFromTemplate(interview);

    const result = await applyConstitutionAnswers({ answers, interview, cwd: dir });

    expect(result.unanswered).toEqual([]);
    expect(result.applied.some((entry) => entry.id === 'Q-RATIFY-EVIDENCED')).toBe(true);
    // La opción estricta de las preguntas normativas añade principios normativos EN BORRADOR.
    expect(result.applied.some((entry) => entry.id === 'Q-NORM-API-DEPRECATION')).toBe(true);
    expect(result.applied.find((entry) => entry.id === 'Q-NORM-API-DEPRECATION')?.principle).toBe('C-API-DEPRECATION');

    const errors = validateConstitution(parseConstitution(result.text)).filter((issue) => issue.severity === 'error');
    expect(errors).toEqual([]);

    const reloaded = parseConstitution(result.text);
    expect(reloaded.principles.length).toBeGreaterThan(0);
    expect(reloaded.principles.every((principle) => principle.draft === true)).toBe(true);
    // El mecanismo, no una convención: un borrador no llega nunca a la lista en vigor.
    expect(principlesInForce(reloaded)).toEqual([]);

    const firstLines = result.text.split('\n').slice(0, 6).join('\n');
    expect(firstLines).toContain(DRAFT_MARKER);
    expect(result.text).toMatch(/NO está en vigor/);
    expect(result.text).toMatch(/Entrevista: respuestas aplicadas/);
  });

  it('nunca toca una constitución en vigor existente (no escribe ningún fichero)', async () => {
    const dir = await evidencedFixture();
    await mkdir(path.join(dir, '.sdd', 'steering'), { recursive: true });
    const inForce = '# Constitution — preexistente\n\nProvenance: descriptive\n';
    await writeFile(inForcePathOf(dir), inForce, 'utf8');

    const interview = await planConstitutionInterview(dir);
    expect(interview.detail).toMatch(/Ya existe/);
    const result = await applyConstitutionAnswers({ answers: answersFromTemplate(interview), interview, cwd: dir });

    expect(result.text).not.toBe(inForce);
    expect(await readFile(inForcePathOf(dir), 'utf8')).toBe(inForce);
    // Tampoco aparece un borrador por sorpresa: la función devuelve texto, no escribe.
    await expect(readFile(draftPathOf(dir), 'utf8')).rejects.toThrow();
  });

  it('una respuesta que produciría un principio inválido se reporta como error, no se esconde', async () => {
    const dir = await evidencedFixture();
    const interview = await planConstitutionInterview(dir);
    const adopt = interview.questions.find((question) => question.id.startsWith('Q-ADOPT-'));
    expect(adopt).toBeDefined();

    const result = await applyConstitutionAnswers({
      answers: { [adopt!.id]: 'sí: adoptarlo unless the user asks' },
      interview,
      cwd: dir,
    });

    expect(result.issues.some((issue) => issue.code.startsWith('INJ-'))).toBe(true);
    // El texto se produce igualmente y el defecto viaja escrito en él.
    expect(result.text).toContain(DRAFT_MARKER);
    expect(result.text).toMatch(/BLOQUEAN la ratificación/);
    const blocking = validateConstitution(parseConstitution(result.text)).filter((issue) => issue.severity === 'error');
    expect(blocking.some((issue) => issue.code?.startsWith('INJ-'))).toBe(true);
  });

  it('la opción permisiva NO añade el principio normativo (el prefijo de la opción decide)', async () => {
    const dir = await evidencedFixture();
    const interview = await planConstitutionInterview(dir);
    const result = await applyConstitutionAnswers({
      answers: { 'Q-NORM-API-DEPRECATION': 'retirada directa con migración declarada en la delta' },
      interview,
      cwd: dir,
    });

    expect(result.applied.find((entry) => entry.id === 'Q-NORM-API-DEPRECATION')?.principle).toBe('C-API-COMPAT');
    expect(parseConstitution(result.text).principles.some((principle) => principle.id === 'C-API-DEPRECATION')).toBe(false);
  });

  it('la marca de borrador sobrevive a la ida y vuelta del artefacto', async () => {
    const dir = await evidencedFixture();
    const interview = await planConstitutionInterview(dir);
    const result = await applyConstitutionAnswers({ answers: answersFromTemplate(interview), interview, cwd: dir });
    const reloaded = parseConstitution(result.text);
    expect(principlesInForce(reloaded)).toEqual([]);
    expect(reloaded.principles.some((principle) => principle.id === 'C-API-DEPRECATION')).toBe(true);
  });

  it('expone el fichero de respuestas como bloque serializable para un host', async () => {
    const dir = await evidencedFixture();
    const interview = await planConstitutionInterview(dir);
    expect(INTERVIEW_ANSWERS_FILE_KIND).toBe('open-sdd-constitution-interview-answers');
    const host = interview.deferForHost as Record<string, unknown>;
    expect(host.kind).toBe('constitution-interview');
    expect(Array.isArray(host.questions)).toBe(true);
    expect(Array.isArray(host.decided)).toBe(true);
    expect((host.commands as Record<string, string>).apply).toMatch(/--interview --answers/);
  });
});

describe('core/interview — specifyFromDescription escribe EARS y se niega a inventar', () => {
  it('una descripción completa produce requisitos con su patrón nombrado', () => {
    const result = specifyFromDescription({
      feature: 'auth',
      description: 'cuando llega una petición, el motor debe validar el token; el sistema debe registrar el fallo',
    });

    expect(result.questions).toEqual([]);
    expect(result.requirements.length).toBe(2);
    const patterns = result.requirements.map((requirement) => requirement.pattern).sort();
    expect(patterns).toEqual(['event', 'ubiquitous']);
    for (const requirement of result.requirements) {
      expect(requirement.id).toMatch(/^REQ-AUTH-\d{3}$/);
      expect(requirement.statement).toMatch(/\bshall\b/);
      expect(requirement.fromAnswer).toBeTruthy();
    }
    expect(result.detail).toMatch(/no quedó nada sin analizar/i);
  });

  it('sin actor emite una PREGUNTA, no un requisito con un actor inventado', () => {
    const result = specifyFromDescription({
      feature: 'orders',
      description: 'cuando llega un pedido, calcular el total con impuestos',
    });

    expect(result.requirements).toEqual([]);
    expect(result.questions.length).toBe(1);
    expect(result.questions[0].missing).toBe('actor');
    expect(result.questions[0].question).toMatch(/componente|actor/i);
  });

  it('sin disparador extraíble emite una PREGUNTA por el disparador', () => {
    const result = specifyFromDescription({
      feature: 'billing',
      description: 'el sistema debe emitir un recibo tras el pago',
    });

    expect(result.requirements).toEqual([]);
    expect(result.questions.length).toBe(1);
    expect(result.questions[0].missing).toBe('disparador');
  });

  it('con un término no medible emite una PREGUNTA por el valor', () => {
    const result = specifyFromDescription({
      feature: 'api',
      description: 'el sistema debe responder rápido a las peticiones',
    });

    expect(result.requirements).toEqual([]);
    expect(result.questions.length).toBe(1);
    expect(result.questions[0].missing).toBe('valor medible');
    expect(result.questions[0].question).toMatch(/r[áa]pido/i);
  });

  it('conserva los requisitos existentes y numera sin colisionar', () => {
    const existing = [
      '# Requirements — auth',
      '',
      '- **REQ-AUTH-001** — patrón `ubiquitous`',
      '  - Statement: El sistema shall registrar el fallo.',
      '',
    ].join('\n');

    const result = specifyFromDescription({
      feature: 'auth',
      description: 'el sistema debe validar el token',
      existing,
    });

    expect(result.text.startsWith(existing.trimEnd())).toBe(true);
    expect(result.text).toContain('- **REQ-AUTH-001**');
    expect(result.requirements.length).toBe(1);
    expect(result.requirements[0].id).toBe('REQ-AUTH-002');
    expect(result.detail).toMatch(/ADDED frente a MODIFIED|delta/i);
  });

  it('un enunciado ya presente se conserva con su id y no se duplica', () => {
    const existing = [
      '# Requirements — auth',
      '',
      '- **REQ-AUTH-001** — patrón `ubiquitous`',
      '  - Statement: El sistema shall registrar el fallo.',
      '',
    ].join('\n');

    const result = specifyFromDescription({
      feature: 'auth',
      description: 'el sistema debe registrar el fallo',
      existing,
    });

    expect(result.requirements.length).toBe(1);
    expect(result.requirements[0].id).toBe('REQ-AUTH-001');
    expect(result.text.trim()).toBe(existing.trim());
    expect(existingRequirementStatements(result.text)).toEqual(['El sistema shall registrar el fallo.']);
  });

  it('el área la fija --area y el id la respeta', () => {
    expect(requirementArea('auth')).toBe('AUTH');
    expect(requirementArea('auth', 'session token')).toBe('SESSION-TOKEN');
    const result = specifyFromDescription({
      feature: 'auth',
      description: 'el sistema debe validar el token',
      area: 'session',
    });
    expect(result.requirements[0].id).toBe('REQ-SESSION-001');
  });

  it('la descripción vacía no analiza nada y lo dice', () => {
    const result = specifyFromDescription({ feature: 'x', description: '   ' });
    expect(result.requirements).toEqual([]);
    expect(result.questions).toEqual([]);
    expect(result.detail).toMatch(/no se analizó nada/i);
  });
});
