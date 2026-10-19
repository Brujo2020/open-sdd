/**
 * Pruebas del ASISTENTE EARS (propuestas, sugerencias y ejemplos).
 *
 * Cada test fija una regla, no una implementación: que una propuesta sea una frase EARS completa
 * sobre el mismo comportamiento, que lo que no se puede saber se PREGUNTE en vez de inventarse, que
 * la distribución de patrones se reporte, y que los ejemplos citados existan de verdad en los
 * documentos de este repositorio. Nada escribe aquí: son funciones puras sobre texto.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EARS_ASSISTANT_TEMPLATES,
  EARS_NEEDS_INFORMATION,
  EARS_PATTERNS,
  EARS_REPO_EXAMPLES,
  EARS_SUGGESTION_CATALOGUE,
  analyseEars,
  deltaStatementText,
  describeFromPlainLanguage,
  earsEvidencePack,
  isEarsProposalApplicable,
  mergeEarsReports,
  renderEarsReport,
  type EarsReport,
} from '../src/core/earsAssistant.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** El requisito compuesto REAL de este repositorio (`.sdd/specs/tool-maturity/delta.md`). */
const REAL_COMPOUND =
  'The [drafter] shall emit a draft marked as not in force, carrying the evidence behind each proposed principle, and the [engine] shall keep draft principles out of blocking verdicts until a human ratifies them.';

const suggestionFor = (report: EarsReport, code: string) => report.suggestions.find((entry) => entry.code === code);

const countShall = (text: string): number => (text.match(/\bshall\b/gi) ?? []).length;

describe('core/earsAssistant — propuestas que son frases EARS reales', () => {
  it('divide un requisito compuesto real de este repositorio en dos frases completas', () => {
    const report = analyseEars(`- Statement: ${REAL_COMPOUND}`, { source: 'delta.md' });
    const suggestion = suggestionFor(report, 'COMPOUND_REQUIREMENT');

    expect(suggestion).toBeDefined();
    expect(suggestion!.severity).toBe('error');
    const lines = suggestion!.proposal.split('\n');
    expect(lines).toHaveLength(2);
    // Palabra por palabra, sin inventar: cada respuesta conserva su actor y su texto.
    expect(lines[0]).toBe(
      'The [drafter] shall emit a draft marked as not in force, carrying the evidence behind each proposed principle.',
    );
    expect(lines[1]).toBe(
      'The [engine] shall keep draft principles out of blocking verdicts until a human ratifies them.',
    );
    for (const line of lines) {
      expect(countShall(line)).toBe(1);
      expect(line.endsWith('.')).toBe(true);
    }
    expect(report.conforming).toBe(0);
  });

  it('repite el actor cuando la segunda respuesta del compuesto no lo trae', () => {
    const report = analyseEars('- The [engine] shall expose the checks and shall report the status.', {
      source: 'inline',
    });
    const suggestion = suggestionFor(report, 'COMPOUND_REQUIREMENT');

    expect(suggestion!.proposal.split('\n')).toEqual([
      'The [engine] shall expose the checks.',
      'The [engine] shall report the status.',
    ]);
  });

  it('mueve la condición que viaja detrás de la respuesta al disparador, sin añadir nada', () => {
    const report = analyseEars('- The [validator] shall reject the commit, when the constitution is missing.', {
      source: 'inline',
    });
    const suggestion = suggestionFor(report, 'MISSING_TRIGGER');

    expect(suggestion).toBeDefined();
    expect(suggestion!.proposal).toBe('WHEN the constitution is missing, the [validator] shall reject the commit.');
    expect(isEarsProposalApplicable(suggestion!)).toBe(true);
  });

  it('convierte "only when X" en el patrón no deseado negando la condición de forma mecánica', () => {
    const report = analyseEars(
      '- The [constitution generator] shall emit a principle only when compliance with it is evidenced in the existing code.',
      { source: 'inline' },
    );
    const suggestion = suggestionFor(report, 'MISSING_TRIGGER');

    expect(suggestion!.proposal).toBe(
      'IF compliance with it is not evidenced in the existing code, THEN the [constitution generator] shall not emit a principle.',
    );
  });

  it('niega el primer verbo de la condición, no un auxiliar de una subordinada', () => {
    const report = analyseEars(
      '- The console shall report a check as passed only when it inspected the artifacts it claims to have checked.',
      { source: 'inline' },
    );
    const suggestion = suggestionFor(report, 'MISSING_TRIGGER');

    expect(suggestion!.proposal).toBe(
      'IF it did not inspect the artifacts it claims to have checked, THEN the console shall not report a check as passed.',
    );
  });

  it('deriva la forma con "shall" cuando el verbo es regular', () => {
    const report = analyseEars('- The [engine] exposes the checks.', { source: 'inline' });
    const suggestion = suggestionFor(report, 'NO_SHALL');

    expect(suggestion!.severity).toBe('error');
    expect(suggestion!.proposal).toBe('The [engine] shall expose the checks.');
  });

  it('reescribe la pasiva en activo solo cuando la propia frase nombra al agente', () => {
    const report = analyseEars('- The input shall be validated by the [validator].', { source: 'inline' });
    expect(suggestionFor(report, 'PASSIVE_VOICE')!.proposal).toBe('The [validator] shall validate the input.');
  });

  it('usa el actor dominante del documento para una frase sin sujeto, citando de dónde sale', () => {
    const report = analyseEars(
      ['- shall validate the input.', '- The [engine] shall log the result.', '- The [engine] shall reject bad input.'].join(
        '\n',
      ),
      { source: 'inline' },
    );
    const suggestion = suggestionFor(report, 'NO_ACTOR');

    expect(suggestion!.proposal).toBe('The [engine] shall validate the input.');
    expect(suggestion!.why).toContain('2 de 3');
  });

  it('no deja ningún hueco con forma de plantilla en una propuesta aplicable', () => {
    const report = analyseEars(
      [
        '- The [engine] shall expose the checks and shall report the status.',
        '- The [validator] shall reject the commit, when the constitution is missing.',
        '- The [engine] exposes the counters.',
        '- The input shall be validated by the [validator].',
      ].join('\n'),
      { source: 'mixed' },
    );
    expect(report.suggestions.length).toBeGreaterThan(0);
    for (const suggestion of report.suggestions) {
      if (!isEarsProposalApplicable(suggestion)) continue;
      expect(suggestion.proposal, suggestion.code).not.toMatch(/<[a-zà-ÿ][^>]*>/i);
      expect(suggestion.proposal, suggestion.code).not.toMatch(/\bTODO\b/);
    }
  });
});

describe('core/earsAssistant — lo que no se sabe se pregunta (honestidad)', () => {
  it('un término vago devuelve la pregunta por el valor medible, no una frase inventada', () => {
    const report = analyseEars('- The [engine] shall respond rápido.', { source: 'inline' });
    const suggestion = suggestionFor(report, 'VAGUE_TERM');

    expect(suggestion!.severity).toBe('warning');
    expect(suggestion!.proposal.startsWith(EARS_NEEDS_INFORMATION)).toBe(true);
    expect(suggestion!.proposal).toContain('milisegundos');
    expect(isEarsProposalApplicable(suggestion!)).toBe(false);
    expect(suggestion!.problem).toContain('rápido');
  });

  it('un objetivo (no un comportamiento) se pregunta en vez de convertirse en requisito', () => {
    const report = analyseEars('- The system should be user friendly.', { source: 'inline' });
    const suggestion = suggestionFor(report, 'NOT_TESTABLE');

    expect(suggestion!.severity).toBe('error');
    expect(isEarsProposalApplicable(suggestion!)).toBe(false);
    expect(suggestion!.proposal.startsWith(EARS_NEEDS_INFORMATION)).toBe(true);
    expect(report.conforming).toBe(0);
  });

  it('un actor persona se pregunta: EARS describe lo que hace el sistema', () => {
    const report = analyseEars('- The user shall export the report.', { source: 'inline' });
    const suggestion = suggestionFor(report, 'ACTOR_NOT_SYSTEM');

    expect(suggestion!.severity).toBe('error');
    expect(isEarsProposalApplicable(suggestion!)).toBe(false);
  });

  it('una pasiva sin agente se pregunta: no se inventa quién valida', () => {
    const report = analyseEars('- The input shall be validated.', { source: 'inline' });
    const suggestion = suggestionFor(report, 'PASSIVE_VOICE');

    expect(suggestion!.proposal.startsWith(EARS_NEEDS_INFORMATION)).toBe(true);
    expect(isEarsProposalApplicable(suggestion!)).toBe(false);
  });

  it('una negación que no es mecánica se pregunta en vez de cambiar el sentido', () => {
    const report = analyseEars('- The [engine] shall export the report only when the cache holds entries.', {
      source: 'inline',
    });
    const suggestion = suggestionFor(report, 'MISSING_TRIGGER');

    expect(isEarsProposalApplicable(suggestion!)).toBe(false);
    expect(suggestion!.proposal.startsWith(EARS_NEEDS_INFORMATION)).toBe(true);
  });

  it('sin "shall" y sin verbo derivable, pregunta por la acción observable', () => {
    const report = analyseEars('- The report must be reviewed.', { source: 'inline' });
    const suggestion = suggestionFor(report, 'NO_SHALL');

    expect(isEarsProposalApplicable(suggestion!)).toBe(false);
    expect(suggestion!.proposal.startsWith(EARS_NEEDS_INFORMATION)).toBe(true);
  });

  it('sin actor dominante inequívoco no inventa un sujeto', () => {
    const report = analyseEars('- shall validate the input.', { source: 'inline' });
    const suggestion = suggestionFor(report, 'NO_ACTOR');

    expect(isEarsProposalApplicable(suggestion!)).toBe(false);
  });
});

describe('core/earsAssistant — patrones, cobertura y ejemplos del repositorio', () => {
  it('clasifica por patrón solo los requisitos conformes y avisa del sesgo ubicuo', () => {
    const report = analyseEars(
      [
        '- The [engine] shall expose the checks.',
        '- When a delta is validated, the [validator] shall report every unmapped requirement.',
        '- While the circuit is open, the [gateway] shall return 503.',
        '- Where a client supplies a request ID, the [gateway] shall propagate it.',
        '- If a contract is missing, then the [oracle] shall refuse to pass.',
        '- The [engine] shall respond rápido.',
      ].join('\n'),
      { source: 'distribution' },
    );

    expect(report.total).toBe(6);
    expect(report.conforming).toBe(5);
    expect(report.patterns).toEqual({ ubiquitous: 1, event: 1, state: 1, option: 1, unwanted: 1 });
    expect(report.detail).toContain('Patrones de los conformes');
  });

  it('dice en voz alta que un documento 100 % ubicuo no tiene disparadores', () => {
    const report = analyseEars(
      ['- The [engine] shall expose the checks.', '- The [engine] shall log the result.'].join('\n'),
      { source: 'ubiquitous' },
    );
    expect(report.conforming).toBe(2);
    expect(report.detail).toContain('Todos los requisitos conformes son ubicuos');
  });

  it('reporta la ausencia del patrón IF…THEN cuando nadie lo usa', () => {
    const report = analyseEars(
      ['- The [engine] shall expose the checks.', '- When the probe fails, the [engine] shall reopen.'].join('\n'),
      { source: 'no-unwanted' },
    );
    expect(report.patterns.unwanted).toBe(0);
    expect(report.detail).toContain('IF…THEN');
  });

  it('complete es false cuando no había nada que analizar, y true cuando sí', () => {
    const empty = analyseEars('   \n\n# Solo un título\n', { source: 'vacío' });
    expect(empty.total).toBe(0);
    expect(empty.complete).toBe(false);
    expect(empty.detail).toContain('no se ha comprobado nada');

    const analysed = analyseEars('- The [engine] shall expose the checks.', { source: 'ok' });
    expect(analysed.complete).toBe(true);
  });

  it('no cuenta los campos "Objective" como requisitos, pero lo dice', () => {
    const report = analyseEars(
      ['**Objective:** As an engineer, I want the change described as a delta.', '- The [engine] shall expose the checks.'].join(
        '\n',
      ),
      { source: 'objetivos' },
    );
    expect(report.total).toBe(1);
    expect(report.detail).toContain('objetivo');
  });

  it('cada ejemplo citado existe de verdad en el fichero que cita', () => {
    expect(EARS_REPO_EXAMPLES.length).toBeGreaterThan(0);
    for (const example of EARS_REPO_EXAMPLES) {
      const content = readFileSync(path.join(repoRoot, example.source), 'utf8');
      expect(content, `${example.source} no contiene "${example.sentence}"`).toContain(example.sentence);
    }
  });

  it('las cinco plantillas traen un ejemplo real de este repositorio', () => {
    expect(EARS_ASSISTANT_TEMPLATES.map((template) => template.pattern)).toEqual([...EARS_PATTERNS]);
    for (const template of EARS_ASSISTANT_TEMPLATES) {
      expect(template.example, template.pattern).not.toBeNull();
      expect(template.exampleSource, template.pattern).not.toBeNull();
      expect(template.template).toContain('shall');
    }
  });

  it('no marca "flexible regime", que es vocabulario de dominio, pero sí "flexible" suelto', () => {
    const domain = analyseEars(
      '- If a sensor is unavailable under the flexible regime, then the [evaluator] shall self-authorize the gate.',
      { source: 'dominio' },
    );
    expect(suggestionFor(domain, 'VAGUE_TERM')).toBeUndefined();

    const vague = analyseEars('- The [engine] shall be flexible.', { source: 'vago' });
    expect(suggestionFor(vague, 'VAGUE_TERM')).toBeDefined();
  });

  it('el catálogo declara la severidad real de cada código', () => {
    const codes = EARS_SUGGESTION_CATALOGUE.map((rule) => rule.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'COMPOUND_REQUIREMENT',
        'NO_SHALL',
        'NOT_TESTABLE',
        'ACTOR_NOT_SYSTEM',
        'NO_ACTOR',
        'PASSIVE_VOICE',
        'VAGUE_TERM',
        'MISSING_TRIGGER',
      ]),
    );
    for (const rule of EARS_SUGGESTION_CATALOGUE) {
      expect(['error', 'warning']).toContain(rule.severity);
      expect(rule.detects.length).toBeGreaterThan(10);
    }
  });

  it('mergeEarsReports agrega totales, patrones y sugerencias de varias fuentes', () => {
    const a = analyseEars('- The [engine] shall expose the checks.', { source: 'a' });
    const b = analyseEars('- When the probe fails, the [engine] shall reopen.', { source: 'b' });
    const merged = mergeEarsReports([a, b]);

    expect(merged.total).toBe(2);
    expect(merged.conforming).toBe(2);
    expect(merged.patterns.ubiquitous).toBe(1);
    expect(merged.patterns.event).toBe(1);
    expect(merged.source).toBe('a + b');
    expect(merged.complete).toBe(true);
    expect(mergeEarsReports([]).complete).toBe(false);
  });

  it('deltaStatementText no cuenta dos veces un enunciado que ya está en requirements.md', () => {
    const delta = [
      '# Delta: demo — x',
      '## ADDED',
      '- Statement: The [engine] shall expose the checks.',
      '- Statement: When the probe fails, the [engine] shall reopen the circuit.',
    ].join('\n');
    const result = deltaStatementText(delta, ['The [engine] shall expose the checks.']);

    expect(result.duplicates).toBe(1);
    expect(result.statements).toBe(1);
    expect(result.text).toContain('When the probe fails');
    expect(result.text).not.toContain('shall expose the checks');
  });

  it('renderEarsReport imprime el diagnóstico y, con --suggest, la propuesta y el ejemplo', () => {
    const report = analyseEars('- The [engine] shall respond rápido.', { source: 'render' });
    const compact = renderEarsReport(report, { suggest: false }).join('\n');
    const full = renderEarsReport(report, { suggest: true }).join('\n');

    expect(compact).toContain('Asistente EARS — render');
    expect(compact).toContain('VAGUE_TERM');
    expect(compact).not.toContain('por qué:');
    expect(full).toContain('por qué:');
    expect(full).toContain('ejemplo:');
    expect(full).toContain('pregunta, no una frase');
  });
});

describe('core/earsAssistant — de lenguaje natural a candidatos EARS', () => {
  it('convierte una descripción con disparador en un candidato del patrón event', () => {
    const suggestions = describeFromPlainLanguage('quiero que el sistema avise cuando caduque un waiver');

    expect(suggestions).toHaveLength(1);
    const candidate = suggestions[0];
    expect(candidate.severity).toBe('info');
    expect(candidate.code).toBe('CANDIDATE_EVENT');
    expect(candidate.target).toBe('quiero que el sistema avise cuando caduque un waiver');
    expect(candidate.proposal).toBe('WHEN caduque un waiver, el sistema shall avise.');
    expect(candidate.why).toContain('event');
    expect(candidate.problem).toContain('SUGERENCIA');
    expect(candidate.example).toContain('.sdd/specs/brownfield-support/requirements.md');
  });

  it('marca el candidato como sugerencia a revisar y no traduce las palabras del usuario', () => {
    const [candidate] = describeFromPlainLanguage('el sistema debe registrar cada intento si el usuario falla');

    expect(candidate.code).toBe('CANDIDATE_UNWANTED');
    expect(candidate.proposal).toBe('IF el usuario falla, THEN el sistema shall registrar cada intento.');
    expect(candidate.why).toContain('unwanted');
    expect(candidate.why).toContain('forma base');
  });

  it('sin disparador devuelve el patrón ubicuo y dice que el actor es un hueco a confirmar', () => {
    const [candidate] = describeFromPlainLanguage('I want the report exported every night');

    expect(candidate.code).toBe('CANDIDATE_UBIQUITOUS');
    expect(candidate.proposal).toBe('The system shall export the report every night.');
    expect(candidate.why).toContain('ubiquitous');
    expect(candidate.why).toContain('the system');
    expect(candidate.why).toContain('pasiva');
  });

  it('con una descripción vacía no inventa ningún candidato', () => {
    expect(describeFromPlainLanguage('   ')).toEqual([]);
  });
});

describe('core/earsAssistant — evidence pack para el modelo anfitrión', () => {
  it('es serializable y entrega requisitos, hallazgos, plantillas con ejemplo y lo no determinado', () => {
    const report = analyseEars(
      [
        '- The [engine] shall expose the checks.',
        '- The [engine] shall respond rápido.',
        '- The system should be user friendly.',
      ].join('\n'),
      { source: 'pack' },
    );
    const pack = earsEvidencePack(report);
    const roundTrip = JSON.parse(JSON.stringify(pack)) as Record<string, unknown>;

    expect(roundTrip.kind).toBe('ears-assistant-evidence-pack');
    expect(roundTrip.complete).toBe(report.complete);
    expect(roundTrip.total).toBe(3);
    expect(roundTrip.requirements).toEqual(report.statements);
    expect((roundTrip.requirements as string[]).length).toBe(3);
    expect((roundTrip.findings as unknown[]).length).toBe(report.suggestions.length);
    expect((roundTrip.templates as { example: string | null }[]).every((template) => template.example !== null)).toBe(true);
    expect((roundTrip.rules as unknown[]).length).toBe(EARS_SUGGESTION_CATALOGUE.length);
    expect(roundTrip.codes).toContain('VAGUE_TERM');
    expect(String(roundTrip.noModelShipped)).toContain('no embarca ningún modelo');
    expect(roundTrip.limit).toBeTruthy();
    // Las dos sugerencias sin frase lista (vago y objetivo) viajan como NO determinadas.
    expect((roundTrip.undetermined as string[]).length).toBe(2);
    expect(roundTrip.status).toBe('incomplete');
    expect((roundTrip.incompleteBecause as string[]).length).toBeGreaterThan(0);
  });

  it('sin nada analizado declara el pack incompleto en vez de declararlo conforme', () => {
    const pack = earsEvidencePack(analyseEars('', { source: 'vacío' }));

    expect(pack.complete).toBe(false);
    expect(pack.status).toBe('incomplete');
    expect(pack.total).toBe(0);
    expect((pack.undetermined as string[]).length).toBeGreaterThan(0);
    expect((pack.incompleteBecause as string[]).join(' ')).toContain('No había requisitos');
  });

  it('recorta los hallazgos al máximo pedido y lo declara', () => {
    const report = analyseEars(
      Array.from({ length: 5 }, (_, index) => `- The [engine] shall respond rápido ${index}.`).join('\n'),
      { source: 'recorte' },
    );
    const pack = earsEvidencePack(report, { maxSuggestions: 2 });

    expect((pack.findings as unknown[]).length).toBe(2);
    expect(pack.findingsTotal).toBe(report.suggestions.length);
    expect(pack.findingsTruncated).toBe(report.suggestions.length - 2);
  });
});
