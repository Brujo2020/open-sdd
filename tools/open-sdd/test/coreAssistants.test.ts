/**
 * El punto de decisión de los asistentes, en el core.
 *
 * Lo que se fija aquí es el COMPORTAMIENTO que hace útil al asistente y no ruido: colabora de
 * verdad cuando falta la constitución (evidencia + preguntas con default + comandos exactos, sin
 * escribir nada), distingue una constitución inválida de una ausente, propone la reescritura EARS
 * con su ejemplo, convierte un marcador `{{…}}` en una sustitución exacta o en una pregunta, ordena
 * por severidad y desbloqueo, deduplica dentro de la ejecución y CALLA cuando no hay nada que decir.
 *
 * Todos los fixtures viven en `os.tmpdir()` y se limpian en `afterEach`: nada se escribe dentro del
 * repositorio.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  assist,
  renderAssist,
  resetAssistLedger,
  CONSTITUTION_DRAFT_COMMAND,
  CONSTITUTION_RATIFY_COMMAND,
  type AssistSuggestion,
} from '../src/core/assistants.js';
import { renderConstitution, type Constitution } from '../src/core/constitution.js';

const temps: string[] = [];

const makeTemp = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// El registro de deduplicación vive a nivel de proceso: cada test es una ejecución lógica distinta.
beforeEach(() => resetAssistLedger());

const write = async (root: string, rel: string, content: string): Promise<void> => {
  const target = path.join(root, rel);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
};

/** Una constitución descriptiva que `validateConstitution` acepta y con un principio en vigor. */
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
      justification: 'Modernizar sin pedido destruye el comportamiento anclado que nadie autorizó a cambiar.',
      provenance: 'descriptive',
      evidence: ['src/index.ts'],
    },
  ],
  amendments: [],
};

const CLEAN_REQUIREMENTS = [
  '# Requirements Document',
  '',
  '## Requirements',
  '',
  '- The [engine] shall keep working with no model backend and no network access.',
  '',
].join('\n');

const COMPOUND_REQUIREMENTS = [
  '# Requirements Document',
  '',
  '## Requirements',
  '',
  '- The [drafter] shall emit a draft and shall record the evidence.',
  '',
].join('\n');

const VALID_CONSTITUTION_MD = renderConstitution(CONSTITUTION);

/** Un repositorio real (manifiesto + lockfile + código + test) SIN `.sdd/steering`. */
const bareRepo = async (requirements = CLEAN_REQUIREMENTS): Promise<string> => {
  const dir = await makeTemp('open-sdd-assist-bare-');
  await write(
    dir,
    'package.json',
    JSON.stringify(
      {
        name: 'assist-fixture',
        version: '1.0.0',
        scripts: { test: 'vitest run' },
        devDependencies: { typescript: '^5.9.3', vitest: '^4.0.18' },
      },
      null,
      2,
    ),
  );
  await write(dir, 'package-lock.json', JSON.stringify({ lockfileVersion: 3 }, null, 2));
  await write(dir, 'tsconfig.json', '{ "compilerOptions": { "strict": true } }');
  await write(dir, 'src/index.ts', 'export const api = true;\n');
  await write(dir, 'test/api.test.ts', 'export const placeholder = true;\n');
  await write(dir, '.sdd/specs/demo/requirements.md', requirements);
  return dir;
};

/** Una spec con constitución en vigor: aísla los hallazgos EARS de la colaboración constitucional. */
const specRepo = async (options: {
  requirements?: string;
  delta?: string;
  tasks?: string;
  constitution?: string | null;
} = {}): Promise<string> => {
  const dir = await makeTemp('open-sdd-assist-spec-');
  const constitution = options.constitution === undefined ? VALID_CONSTITUTION_MD : options.constitution;
  if (constitution !== null) await write(dir, '.sdd/steering/constitution.md', constitution);
  await write(dir, '.sdd/specs/demo/requirements.md', options.requirements ?? CLEAN_REQUIREMENTS);
  if (options.delta !== undefined) await write(dir, '.sdd/specs/demo/delta.md', options.delta);
  if (options.tasks !== undefined) await write(dir, '.sdd/specs/demo/tasks.md', options.tasks);
  return dir;
};

const DELTA_COMPOUND = [
  '# Delta: demo — cambio',
  '',
  'Status: proposed',
  '',
  '## ADDED',
  '',
  '### REQ-DEMO-001 — Compuesto',
  '- Statement: The [drafter] shall emit a draft and shall record the evidence.',
  '- Targets: src/demo.ts',
  '',
].join('\n');

const TASKS_WITH_PLACEHOLDERS = [
  '# Tasks',
  '',
  '- [ ] 1.1 Rellenar la plantilla _Requirements: {{REQ-ORD-001}}_',
  '- [ ] 1.2 Marcador genérico _Requirements: {{REQUIREMENT_IDS}}_',
  '',
].join('\n');

describe('assist — constitución ausente: colaboración, no volcado', () => {
  it('muestra la evidencia observada, una pregunta con default y los comandos exactos; no escribe nada', async () => {
    const dir = await bareRepo();
    const steering = path.join(dir, '.sdd', 'steering');
    expect(existsSync(steering)).toBe(false);

    const out = await assist({ cwd: dir, feature: 'demo' });

    // Nada en disco: el asistente solo propone.
    expect(existsSync(steering)).toBe(false);
    expect(existsSync(path.join(steering, 'constitution.md'))).toBe(false);
    expect(existsSync(path.join(steering, 'constitution.draft.md'))).toBe(false);

    const suggestion = out.suggestions.find((candidate) => candidate.trigger === 'constitution-missing');
    expect(suggestion).toBeDefined();
    expect(suggestion!.severity).toBe('error');
    expect(suggestion!.headline).toContain('.sdd/steering/constitution.md');

    // Evidencia que el reconocimiento ya encontró, no prosa genérica.
    expect(suggestion!.proposal).toContain('Evidencia que el reconocimiento YA encontró');
    expect(suggestion!.proposal).toMatch(/TypeScript/);
    expect(suggestion!.proposal).toMatch(/npm/);
    expect(suggestion!.proposal).toContain('Prácticas observadas con evidencia');
    expect(suggestion!.proposal).toContain('C-STACK-FACT');

    // La decisión normativa que solo una persona puede tomar, con su default y su porqué.
    expect(suggestion!.proposal).toContain('Propuesta por defecto: SÍ');
    expect(suggestion!.proposal).toContain('¿Ratificas');

    // Los dos comandos exactos, en orden, y la constancia de que no se ha escrito nada.
    expect(suggestion!.proposal).toContain(CONSTITUTION_DRAFT_COMMAND);
    expect(suggestion!.proposal).toContain('open-sdd govern constitution --ratify --by "<nombre>" --rationale "<texto>"');
    expect(CONSTITUTION_RATIFY_COMMAND).toContain('--ratify --by');
    expect(suggestion!.proposal).toMatch(/Nada se ha escrito/);
    expect(suggestion!.action).toBe(CONSTITUTION_DRAFT_COMMAND);

    // Un ejemplo real de este repositorio, citando el fichero.
    expect(suggestion!.example).toContain('constitutionDraft.ts');
  });
});

describe('assist — constitución inválida: un trigger distinto que nombra lo inválido', () => {
  const INVALID = [
    '# Constitution — demo',
    '',
    'Provenance: descriptive',
    '',
    '## Principles',
    '',
    '### PRINCIPLE-01 — Uno posicional',
    '',
    '- Level: SHOULD',
    '- Threat: regresión silenciosa',
    '- Restriction: El cambio se prueba antes de cerrarse.',
    '- Pattern: Ejecutar la suite completa y registrar el resultado.',
    '- Justification: Una suite verde es la prueba de que el comportamiento existente sigue intacto y no se rompió nada.',
    '- Evidence: src/index.ts',
    '',
  ].join('\n');

  it('no es "missing" y nombra el error de validación', async () => {
    const dir = await specRepo({ constitution: INVALID });
    const out = await assist({ cwd: dir, feature: 'demo' });

    const suggestion = out.suggestions.find((candidate) => candidate.trigger === 'constitution-invalid');
    expect(suggestion).toBeDefined();
    expect(suggestion!.severity).toBe('error');
    expect(suggestion!.headline).toMatch(/no es válida/i);
    expect(suggestion!.headline).toContain('ID-POSITIONAL');
    expect(out.suggestions.some((candidate) => candidate.trigger === 'constitution-missing')).toBe(false);
  });
});

describe('assist — EARS: la propuesta, el ejemplo y la acción', () => {
  it('un requisito compuesto se propone dividido, con ejemplo citado y una única acción', async () => {
    const dir = await specRepo({ requirements: COMPOUND_REQUIREMENTS });

    const out = await assist({
      cwd: dir,
      feature: 'demo',
      findings: [{ code: 'COMPOUND_REQUIREMENT' }],
    });

    expect(out.suggestions).toHaveLength(1);
    const suggestion = out.suggestions[0];
    expect(suggestion.trigger).toBe('ears-ambiguity');
    expect(suggestion.severity).toBe('error');
    expect(suggestion.headline).toContain('requirements.md');
    expect(suggestion.proposal).toContain('The [drafter] shall emit a draft.');
    expect(suggestion.proposal).toContain('The [drafter] shall record the evidence.');
    expect(suggestion.example).toBeDefined();
    expect(suggestion.example!).toContain('fuente:');
    expect(suggestion.action).toBe('open-sdd brownfield requirements demo --suggest');
  });

  it('un término vago pide el dato medible en vez de emitir un hueco', async () => {
    const dir = await specRepo({
      requirements: ['# Requirements Document', '', '- The [engine] shall respond rápido.', ''].join('\n'),
    });

    const out = await assist({ cwd: dir, feature: 'demo', findings: [{ code: 'VAGUE_TERM' }] });

    expect(out.suggestions).toHaveLength(1);
    const [suggestion] = out.suggestions;
    expect(suggestion.trigger).toBe('ears-ambiguity');
    expect(suggestion.severity).toBe('warning');
    expect(suggestion.proposal).toMatch(/^Falta información:/);
    expect(suggestion.proposal).toContain('rápido');
    expect(suggestion.proposal).toContain('¿');
  });

  it('un objetivo no testeable usa el trigger propio ears-nontestable', async () => {
    const dir = await specRepo({
      requirements: ['# Requirements Document', '', '- The [engine] should be faster.', ''].join('\n'),
    });

    const out = await assist({ cwd: dir, feature: 'demo', findings: [{ code: 'NOT_TESTABLE' }] });

    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0].trigger).toBe('ears-nontestable');
    expect(out.suggestions[0].severity).toBe('error');
  });
});

describe('assist — UNFILLED_REQUIREMENT_PLACEHOLDER: la sustitución exacta', () => {
  it('propone el id cuando el marcador lo nombra y pregunta cuando no', async () => {
    const dir = await specRepo({
      requirements: CLEAN_REQUIREMENTS,
      delta: DELTA_COMPOUND,
      tasks: TASKS_WITH_PLACEHOLDERS,
    });

    const out = await assist({
      cwd: dir,
      feature: 'demo',
      findings: [
        { code: 'UNFILLED_REQUIREMENT_PLACEHOLDER', artifact: '{{REQ-ORD-001}}' },
        { code: 'UNFILLED_REQUIREMENT_PLACEHOLDER', artifact: '{{REQUIREMENT_IDS}}' },
      ],
    });

    expect(out.suggestions).toHaveLength(2);
    expect(out.suggestions.every((suggestion) => suggestion.trigger === 'unfilled-placeholder')).toBe(true);
    expect(out.suggestions.every((suggestion) => suggestion.severity === 'error')).toBe(true);
    expect(out.suggestions[0].headline).toContain('UNFILLED_REQUIREMENT_PLACEHOLDER');
    expect(out.suggestions[0].proposal).toContain('Sustituye exactamente {{REQ-ORD-001}} por REQ-ORD-001');
    expect(out.suggestions[1].proposal).toMatch(/^Falta información:/);
    expect(out.suggestions[1].proposal).toContain('{{REQUIREMENT_IDS}}');
    expect(out.suggestions[0].action).toBe('open-sdd delta validate demo');
  });

  it('los descubre solo, sin que nadie los pase como hallazgo', async () => {
    const dir = await specRepo({
      requirements: CLEAN_REQUIREMENTS,
      delta: DELTA_COMPOUND.replace(
        '- Statement: The [drafter] shall emit a draft and shall record the evidence.',
        '- Statement: When a task is traced, the [validator] shall cite the delta requirement it implements.',
      ),
      tasks: TASKS_WITH_PLACEHOLDERS,
    });

    const out = await assist({ cwd: dir, feature: 'demo' });

    expect(out.suggestions).toHaveLength(2);
    expect(out.suggestions.every((suggestion) => suggestion.trigger === 'unfilled-placeholder')).toBe(true);
  });
});

describe('assist — ruido: cuando no hay nada que asistir, calla', () => {
  it('una spec limpia con la constitución en vigor devuelve CERO sugerencias', async () => {
    const dir = await specRepo();

    const out = await assist({ cwd: dir, feature: 'demo' });

    expect(out.suggestions).toEqual([]);
    expect(renderAssist(out.suggestions)).toEqual([]);
    expect(out.detail).toMatch(/Sin nada que asistir/);
  });
});

describe('assist — orden, dedupe y tope', () => {
  it('ordena por severidad y por desbloqueo: la constitución ausente va primero', async () => {
    const dir = await bareRepo(COMPOUND_REQUIREMENTS);

    const out = await assist({ cwd: dir, feature: 'demo', findings: [{ code: 'COMPOUND_REQUIREMENT' }] });

    // Dos errores: el desempate lo decide lo que desbloquea la fase siguiente.
    expect(out.suggestions.length).toBeGreaterThanOrEqual(2);
    expect(out.suggestions[0].trigger).toBe('constitution-missing');
    expect(out.suggestions[1].trigger).toBe('ears-ambiguity');
  });

  it('no repite la misma sugerencia dos veces en la misma ejecución', async () => {
    const dir = await specRepo({ requirements: COMPOUND_REQUIREMENTS });
    const input = { cwd: dir, feature: 'demo', findings: [{ code: 'COMPOUND_REQUIREMENT' }] };

    const first = await assist(input);
    expect(first.suggestions).toHaveLength(1);

    const second = await assist(input);
    expect(second.suggestions).toEqual([]);

    resetAssistLedger();
    const third = await assist(input);
    expect(third.suggestions).toHaveLength(1);
  });

  it('el tope por defecto es 3 y añade la línea "ver más"', () => {
    const suggestion = (index: number): AssistSuggestion => ({
      trigger: 'ears-ambiguity',
      severity: 'error',
      headline: `hallazgo ${index}`,
      proposal: 'propuesta',
      action: `cmd-${index}`,
    });
    const all = [suggestion(0), suggestion(1), suggestion(2), suggestion(3)];

    const lines = renderAssist(all);
    expect(lines.filter((line) => /^ {2}\[(error|warning|info)\] /.test(line))).toHaveLength(3);
    expect(lines.some((line) => line.includes('acción: cmd-0'))).toBe(true);
    expect(lines.some((line) => line.includes('acción: cmd-2'))).toBe(true);
    expect(lines.some((line) => line.includes('acción: cmd-3'))).toBe(false);
    expect(lines.some((line) => line.includes('ver más: cmd-3'))).toBe(true);
  });
});
