/**
 * LOS ASISTENTES BAJO DEMANDA: un único punto de decisión que hace APARECER lo que ya existe
 * cuando de verdad hace falta, sin bloquear y sin ruido.
 *
 * `earsAssistant.ts` ya sabe reescribir un requisito y `constitutionDraft.ts` ya sabe proponer una
 * constitución con la evidencia del código. El problema que resuelve este módulo no es de
 * capacidad, es de DESCUBRIMIENTO: hoy hay que saber que esos asistentes existen y llamarlos a
 * mano. Aquí se decide, a partir del estado real del repositorio y de los hallazgos que un comando
 * ya calculó, si toca asistir, con qué, y con qué comando se avanza.
 *
 * ── Las cuatro reglas que lo mantienen honesto ────────────────────────────────────────────────
 *
 *  1. NO ESCRIBE NADA. Ninguna función de este módulo abre un fichero en modo escritura. La
 *     colaboración sobre una constitución ausente termina siempre en dos comandos que EJECUTA la
 *     persona; el asistente jamás redacta la constitución ni dice haberlo hecho.
 *  2. NO BLOQUEA. `assist` devuelve sugerencias y nada más: no lanza, no toca el `exitCode` de
 *     nadie. Quien llama decide si imprime; el veredicto del comando no cambia porque el asistente
 *     tenga algo que decir.
 *  3. NO REPITE. Un registro a nivel de proceso deduplica por contenido: el mismo hallazgo visto
 *     por `delta validate` y luego por `brownfield requirements` se imprime UNA vez por ejecución.
 *     `resetAssistLedger()` existe para los tests, que comparten proceso.
 *  4. NO INVENTA. Cuando un dato no está (el actor, el disparador, el valor medible, el id que
 *     sustituye a `{{…}}`), la propuesta es una PREGUNTA explícita por ese dato, nunca una plantilla
 *     con huecos disfrazada de frase.
 *
 * ── Por qué un punto único y no una llamada por comando ───────────────────────────────────────
 * El EARS compuesto, el marcador sin rellenar y la constitución ausente son el mismo problema
 * ("falta un dato y el siguiente gate no puede avanzar") visto desde tres comandos distintos. Si
 * cada comando decidiera por su cuenta cuándo asistir, el criterio divergiría y el asistente
 * aparecería en unos sitios y no en otros. La decisión vive aquí; los comandos solo imprimen lo que
 * este módulo devuelve.
 *
 * ── Orden de las sugerencias ──────────────────────────────────────────────────────────────────
 * Ver `compareSuggestions`: primero la severidad (error › aviso › info) y, dentro de la misma
 * severidad, lo que DESBLOQUEA LA FASE SIGUIENTE — la constitución gobierna todos los veredictos, un
 * marcador `{{…}}` rompe la trazabilidad delta→tareas, y una ambigüedad EARS se reescribe sin salir
 * del propio requisito. Así lo primero que se lee es lo que desatasca el gate siguiente y no lo más
 * fácil de arreglar.
 *
 * ── `notChecked` ──────────────────────────────────────────────────────────────────────────────
 * Lo que no se pudo inspeccionar viaja explícito. Un asistente que calla "no lo miré" se lee como
 * "está bien", y ese es exactamente el fallo que este proyecto lleva tres revisiones quitando.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateConstitution, principlesInForce } from './constitution.js';
import { analyseEars, deltaStatementText, type EarsSuggestion } from './earsAssistant.js';
import { deltaSpecFileName, parseDeltaSpec, traceDelta } from './deltaSpec.js';
import { scanProject } from './reverseEngineering.js';
import { buildDescriptiveConstitution, collectRepoFacts } from './reverseConstitution.js';
import { listSpecs, parseTasksMarkdown, resolveSddDir } from './specManager.js';
import { loadConstitution } from './status.js';

export type AssistTrigger =
  | 'constitution-missing'
  | 'constitution-invalid'
  | 'ears-ambiguity'
  | 'ears-nontestable'
  | 'unfilled-placeholder';

export interface AssistSuggestion {
  trigger: AssistTrigger;
  severity: 'error' | 'warning' | 'info';
  /** One line: what is missing or ambiguous, in Spanish, with the artifact cited. */
  headline: string;
  /** The concrete proposal, ready to paste, or an explicit question when the datum is unknown. */
  proposal: string;
  /** A worked example from this repository when one exists (cite the file). */
  example?: string;
  /** Exactly one command that resolves or advances it. */
  action: string;
}

/** Los comandos exactos de la colaboración constitucional, en el orden en que se ejecutan. */
export const CONSTITUTION_DRAFT_COMMAND = 'open-sdd brownfield constitution . --draft --write';
export const CONSTITUTION_RATIFY_COMMAND =
  'open-sdd govern constitution --ratify --by "<nombre>" --rationale "<texto>" --write';

/**
 * Orden: severidad primero y, a igual severidad, desbloqueo de la fase siguiente. La constitución
 * es la autoridad que citan los veredictos bloqueantes (rango 0, desbloquea todo); el marcador sin
 * rellenar rompe la trazabilidad delta→tareas (rango 1, desbloquea `delta validate`); una
 * ambigüedad EARS se corrige dentro del requisito (rango 2, la fase ya avanzó sin ella).
 */
const SEVERITY_RANK: Record<AssistSuggestion['severity'], number> = { error: 0, warning: 1, info: 2 };
const UNBLOCK_RANK: Record<AssistTrigger, number> = {
  'constitution-missing': 0,
  'constitution-invalid': 0,
  'unfilled-placeholder': 1,
  'ears-nontestable': 2,
  'ears-ambiguity': 2,
};

const compareSuggestions = (a: AssistSuggestion, b: AssistSuggestion): number => {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;
  const byUnblock = UNBLOCK_RANK[a.trigger] - UNBLOCK_RANK[b.trigger];
  if (byUnblock !== 0) return byUnblock;
  return a.headline.localeCompare(b.headline);
};

/**
 * Registro de lo ya emitido en esta ejecución. Vive a nivel de módulo porque una "ejecución" es el
 * proceso completo: dos comandos encadenados (`open-sdd delta validate X && open-sdd brownfield
 * requirements X`) deben imprimir el mismo hallazgo una sola vez. Cada invocación del CLI es un
 * proceso, así que el registro nunca sobrevive a una ejecución real.
 */
const emittedThisRun = new Set<string>();

/** Los tests comparten proceso con varias ejecuciones lógicas: aquí se separa una de otra. */
export const resetAssistLedger = (): void => {
  emittedThisRun.clear();
};

/**
 * Dos hallazgos son "el mismo" solo si comparten trigger, titular, propuesta y acción. La propuesta
 * entra en la clave a propósito: dos requisitos compuestos distintos producen el mismo titular
 * ("2 respuestas shall…") pero reescrituras distintas, y deduplicarlos por el titular se comería
 * hallazgos reales; el mismo requisito visto por dos comandos produce la MISMA propuesta y sí se
 * deduplica.
 */
const keyOf = (suggestion: AssistSuggestion): string =>
  `${suggestion.trigger}|${suggestion.headline}|${suggestion.proposal}|${suggestion.action}`;

// ---------------------------------------------------------------------------------------------
// Clasificación de hallazgos EARS
// ---------------------------------------------------------------------------------------------

/**
 * El validador de la delta colapsa todos los fallos EARS en un único código (`EARS`) con el detalle
 * dentro del mensaje; el asistente de requisitos emite el código fino (`COMPOUND_REQUIREMENT`,
 * `VAGUE_TERM`…). Los dos se reconocen aquí, sin inventar un tercer vocabulario.
 */
const EARS_GENERIC_CODES = new Set(['EARS']);
const EARS_NONTESTABLE_CODES = new Set(['NOT_TESTABLE', 'NO_SHALL']);

const isEarsFinding = (code: string): boolean => {
  const upper = code.toUpperCase();
  if (EARS_GENERIC_CODES.has(upper)) return true;
  if (EARS_NONTESTABLE_CODES.has(upper)) return true;
  return (
    upper === 'COMPOUND_REQUIREMENT' ||
    upper === 'VAGUE_TERM' ||
    upper === 'MISSING_TRIGGER' ||
    upper === 'PASSIVE_VOICE' ||
    upper === 'ACTOR_NOT_SYSTEM' ||
    upper === 'NO_ACTOR'
  );
};

// ---------------------------------------------------------------------------------------------
// Constitución: estado y colaboración
// ---------------------------------------------------------------------------------------------

type ConstitutionState =
  | { kind: 'valid'; detail: string }
  | { kind: 'missing'; path: string }
  | { kind: 'invalid'; path: string | null; reason: string };

const checkConstitution = async (root: string, sddDir: string): Promise<ConstitutionState> => {
  const read = await loadConstitution(root, sddDir);
  if (!read.exists) {
    return { kind: 'missing', path: path.join(sddDir, 'steering', 'constitution.md') };
  }
  if (!read.constitution) {
    return {
      kind: 'invalid',
      path: read.path,
      reason: `no se pudo leer (${read.error ?? 'lectura fallida'}): no hay autoridad que citar`,
    };
  }
  const issues = validateConstitution(read.constitution);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const inForce = principlesInForce(read.constitution);
  if (errors.length > 0) {
    const named = errors
      .slice(0, 3)
      .map((issue) => issue.code ?? issue.id)
      .join(', ');
    return {
      kind: 'invalid',
      path: read.path,
      reason: `${errors.length} error(es) de validación (${named}${errors.length > 3 ? ', …' : ''})`,
    };
  }
  if (inForce.length === 0) {
    return {
      kind: 'invalid',
      path: read.path,
      reason: 'ningún principio en vigor (borradores o propuestas no son autoridad citable)',
    };
  }
  return { kind: 'valid', detail: `${inForce.length} principio(s) en vigor` };
};

/** Una línea del hecho observado, tal y como el reconocimiento lo registró. */
const evidenceLine = (project: Awaited<ReturnType<typeof scanProject>>, detected: string[]): string => {
  const stack = [
    project.language !== 'unknown' ? `lenguaje ${project.language}` : null,
    project.frameworks.length > 0 ? `frameworks ${project.frameworks.join(', ')}` : null,
    project.packageManager ? `gestor ${project.packageManager}` : null,
    project.buildTool ? `build ${project.buildTool}` : null,
    project.testFramework ? `tests ${project.testFramework}` : null,
  ].filter((value): value is string => value !== null);
  const parts = [
    ...(stack.length > 0 ? [`stack: ${stack.join(', ')}`] : []),
    // El reconocimiento ya emite una línea `stack:` propia: repetirla con otro formato es ruido,
    // así que se resume en la línea sintetizada de arriba y se toman solo los demás hechos.
    ...detected.filter((item) => !/^stack:/i.test(item)).slice(0, 4),
  ];
  return parts.length > 0 ? parts.join('; ') : '(el reconocimiento no encontró hechos con evidencia)';
};

/**
 * La colaboración real sobre una constitución ausente o inválida.
 *
 * No es un volcado de fichero: muestra la evidencia que el reconocimiento YA encontró (reutiliza
 * `collectRepoFacts`/`buildDescriptiveConstitution`, la misma fuente que la constitución
 * descriptiva), el conjunto MÍNIMO de preguntas normativas que solo una persona puede responder
 * (con propuesta por defecto y su porqué), y los dos comandos exactos. Nunca escribe nada.
 */
const constitutionCollaboration = async (
  root: string,
  state: Exclude<ConstitutionState, { kind: 'valid' }>,
): Promise<AssistSuggestion> => {
  const project = await scanProject(root);
  const facts = await collectRepoFacts(root, project);
  const { constitution, detected, deferred } = buildDescriptiveConstitution(facts);

  const observed = constitution.principles.filter((principle) => (principle.evidence ?? []).length > 0);
  const observedList =
    observed
      .slice(0, 5)
      .map((principle) => `${principle.id} (${principle.title})`)
      .join(', ') || '(ninguna práctica con evidencia)';
  const observedIds = observed.map((principle) => principle.id).join(', ') || '(ninguno)';

  // El conjunto mínimo de decisiones humanas: ratificar lo que el código demuestra y, como mucho,
  // una práctica ausente. Todo lo demás se repite en el mismo patrón y no añade información.
  const questions: string[] = [
    `1) ¿Ratificas como vinculantes los principios que el código YA demuestra (${observedIds})? ` +
      'Propuesta por defecto: SÍ — la evidencia observada lo demuestra hoy, y cambiarla después exige una enmienda gobernada.',
  ];
  if (deferred.length > 0) {
    questions.push(
      `2) ¿Se adopta "${deferred[0]}"? Propuesta por defecto: NO todavía — el código NO muestra la práctica, ` +
        'así que entra como enmienda propuesta y solo gobierna cuando exista evidencia que la demuestre.' +
        (deferred.length > 1 ? ` (Hay ${deferred.length - 1} práctica(s) deseada(s) más en el reconocimiento.)` : ''),
    );
  }

  const headline =
    state.kind === 'missing'
      ? `Falta ${state.path}: sin constitución no hay autoridad citable y ningún veredicto puede apoyarse en ella.`
      : `La constitución ${state.path ?? '(ruta desconocida)'} no es válida: ${state.reason}.`;

  const proposal = [
    `Evidencia que el reconocimiento YA encontró (leída del repositorio, no inventada): ${evidenceLine(project, detected)}.`,
    `Prácticas observadas con evidencia: ${observedList}.`,
    'Preguntas que solo una persona puede responder (elección normativa, con propuesta por defecto):',
    ...questions.map((question) => `  ${question}`),
    'Comandos, en este orden:',
    `  ${CONSTITUTION_DRAFT_COMMAND}`,
    `  ${CONSTITUTION_RATIFY_COMMAND}`,
    'Nada se ha escrito: este asistente solo propone; el borrador y la ratificación los ejecutas tú.',
  ].join('\n');

  return {
    trigger: state.kind === 'missing' ? 'constitution-missing' : 'constitution-invalid',
    severity: 'error',
    headline,
    proposal,
    example:
      'Flujo ya implementado en este repositorio: tools/open-sdd/src/core/constitutionDraft.ts (borrador con evidencia y puerta humana `ratifyDraft`). ' +
      'La constitución de este repositorio, ya ratificada, vive en .sdd/steering/constitution.md.',
    action: CONSTITUTION_DRAFT_COMMAND,
  };
};

// ---------------------------------------------------------------------------------------------
// EARS: de hallazgo a sugerencia
// ---------------------------------------------------------------------------------------------

const earsTriggerOf = (code: string): AssistTrigger =>
  EARS_NONTESTABLE_CODES.has(code.toUpperCase()) ? 'ears-nontestable' : 'ears-ambiguity';

const toEarsSuggestion = (suggestion: EarsSuggestion, source: string, action: string): AssistSuggestion => ({
  trigger: earsTriggerOf(suggestion.code),
  severity: suggestion.severity,
  headline: `${suggestion.code} en ${source}: ${suggestion.problem}`,
  // La propuesta ya viene en español y ya es, o la frase lista, o la pregunta por el dato que falta.
  proposal: suggestion.proposal,
  ...(suggestion.example ? { example: suggestion.example } : {}),
  action,
});

// ---------------------------------------------------------------------------------------------
// Marcadores sin rellenar
// ---------------------------------------------------------------------------------------------

const TEMPLATE_PLACEHOLDER = /\{\{[^{}]*\}\}/;

const placeholderSuggestion = (cited: string, feature: string, taskId?: string): AssistSuggestion => {
  const inner = cited.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
  const looksLikeDeltaId = /^REQ-[A-Z0-9]+(-[A-Z0-9]+)*-\d{3}$/.test(inner);
  const where = taskId ? `La tarea ${taskId}` : 'Una tarea';
  return {
    trigger: 'unfilled-placeholder',
    severity: 'error',
    headline: `UNFILLED_REQUIREMENT_PLACEHOLDER: ${where} cita ${cited}, el marcador de plantilla sin rellenar (no es un id de la delta).`,
    proposal: looksLikeDeltaId
      ? `Sustituye exactamente ${cited} por ${inner} en .sdd/specs/${feature}/tasks.md (el id que el propio marcador ya nombra).`
      : `Falta información: sustituye exactamente ${cited} por el id REQ-<ÁREA>-<NNN> de la entrada de la delta que esta tarea implementa; el marcador no nombra ninguno y no puedo inventarlo.`,
    action: `open-sdd delta validate ${feature}`,
  };
};

// ---------------------------------------------------------------------------------------------
// Punto de decisión
// ---------------------------------------------------------------------------------------------

const readIfExists = (file: string): Promise<string | null> => readFile(file, 'utf8').catch(() => null);

export const assist = async (input: {
  cwd: string;
  feature?: string;
  sddDir?: string;
  findings?: { code: string; artifact?: string }[];
}): Promise<{ suggestions: AssistSuggestion[]; notChecked: string[]; detail: string }> => {
  const root = path.resolve(input.cwd);
  const sddDir = input.sddDir ?? (await resolveSddDir(root));
  const notChecked: string[] = [];
  const collected: AssistSuggestion[] = [];

  const findings = input.findings;
  const findingCodes = new Set((findings ?? []).map((finding) => finding.code.toUpperCase()));

  // ── 1. Constitución: se comprueba SIEMPRE, esté o no entre los hallazgos. Una ejecución sin
  // constitución no puede avanzar ningún gate, así que es la primera cosa que debe aparecer.
  const constitution = await checkConstitution(root, sddDir);
  if (constitution.kind !== 'valid') {
    collected.push(await constitutionCollaboration(root, constitution));
  }

  // ── 2. La feature sobre la que asistir en materia de requisitos.
  const requested = input.feature?.trim();
  const feature = requested && requested.length > 0 ? requested : ((await listSpecs(root, sddDir))[0] ?? null);

  if (!feature) {
    notChecked.push('EARS: no hay ninguna especificación bajo specs/ sobre la que analizar requisitos');
  } else {
    const specDir = path.join(root, sddDir, 'specs', feature);
    const requirementsRel = path.posix.join(sddDir, 'specs', feature, 'requirements.md');
    const deltaRel = path.posix.join(sddDir, 'specs', feature, deltaSpecFileName());
    const requirementsRaw = await readIfExists(path.join(specDir, 'requirements.md'));
    const deltaRaw = await readIfExists(path.join(specDir, deltaSpecFileName()));

    // Con hallazgos en la mano solo se re-analiza si alguno es EARS: un `status --check` cuyos
    // hallazgos son constitucionales no debe arrastrar un informe EARS que nadie pidió.
    const wantsEars = findings === undefined || [...findingCodes].some(isEarsFinding);
    const wantsPlaceholders = findings === undefined || findingCodes.has('UNFILLED_REQUIREMENT_PLACEHOLDER');

    if (wantsEars) {
      if (requirementsRaw === null && deltaRaw === null) {
        notChecked.push(
          `EARS: no existe ${requirementsRel} ni ${deltaRel} para "${feature}": no hay requisitos que analizar`,
        );
      } else {
        const action = `open-sdd brownfield requirements ${feature} --suggest`;
        const requirementsReport =
          requirementsRaw !== null ? analyseEars(requirementsRaw, { source: requirementsRel }) : null;
        const deltaReport =
          deltaRaw !== null
            ? (() => {
                const deltaText = deltaStatementText(deltaRaw, requirementsReport?.statements ?? []);
                return deltaText.statements > 0
                  ? { report: analyseEars(deltaText.text, { source: deltaRel }), origin: 'delta' as const }
                  : null;
              })()
            : null;

        const tagged = [
          ...(requirementsReport?.suggestions ?? []).map((suggestion) => ({
            suggestion,
            source: requirementsRel,
            origin: 'requirements' as const,
          })),
          ...(deltaReport?.report.suggestions ?? []).map((suggestion) => ({
            suggestion,
            source: deltaRel,
            origin: 'delta' as const,
          })),
        ];

        for (const entry of tagged) {
          const code = entry.suggestion.code.toUpperCase();
          // El código genérico `EARS` solo puede ampliarse contra las sugerencias de la delta: es la
          // única fuente que ese validador inspeccionó, y ampliarlo a requirements.md sacaría a la
          // luz hallazgos que el comando no imprimió.
          const include =
            findings === undefined ||
            findingCodes.has(code) ||
            (entry.origin === 'delta' && [...findingCodes].some((finding) => EARS_GENERIC_CODES.has(finding)));
          if (include) collected.push(toEarsSuggestion(entry.suggestion, entry.source, action));
        }
      }
    } else {
      notChecked.push(
        `EARS: los hallazgos de esta ejecución no incluyen ningún código EARS (${findingCodes.size} código(s) ajenos): no se re-analizan las specs`,
      );
    }

    // ── 3. Marcadores `{{…}}` de tasks.md. El dato que falta es el id real; si el propio marcador lo
    // nombra, la propuesta es la sustitución exacta; si no, es la pregunta por el id.
    if (wantsPlaceholders) {
      const cited: { cited: string; taskId?: string }[] = [];
      if (findings !== undefined) {
        for (const finding of findings) {
          if (finding.code.toUpperCase() !== 'UNFILLED_REQUIREMENT_PLACEHOLDER') continue;
          const token = finding.artifact?.match(TEMPLATE_PLACEHOLDER)?.[0];
          if (token) cited.push({ cited: token });
        }
      } else if (deltaRaw !== null) {
        const tasksRaw = await readIfExists(path.join(specDir, 'tasks.md'));
        if (tasksRaw !== null) {
          const trace = traceDelta(parseDeltaSpec(deltaRaw), parseTasksMarkdown(tasksRaw));
          for (const placeholder of trace.unfilledPlaceholders) {
            cited.push({ cited: placeholder.cited, taskId: placeholder.taskId });
          }
        }
      }
      const seen = new Set<string>();
      for (const item of cited) {
        if (seen.has(item.cited)) continue;
        seen.add(item.cited);
        collected.push(placeholderSuggestion(item.cited, feature, item.taskId));
      }
    }
  }

  // ── 4. Orden, dedupe de la ejecución y recuento honesto.
  const ordered = collected.sort(compareSuggestions);
  const suggestions: AssistSuggestion[] = [];
  for (const suggestion of ordered) {
    const key = keyOf(suggestion);
    if (emittedThisRun.has(key)) continue;
    emittedThisRun.add(key);
    suggestions.push(suggestion);
  }

  const errors = suggestions.filter((suggestion) => suggestion.severity === 'error').length;
  const warnings = suggestions.filter((suggestion) => suggestion.severity === 'warning').length;
  const detail =
    suggestions.length === 0
      ? `Sin nada que asistir: ningún hallazgo accionable${notChecked.length > 0 ? `; ${notChecked.length} cosa(s) no comprobada(s)` : ''}.`
      : `${suggestions.length} sugerencia(s) (${errors} error, ${warnings} aviso) ordenadas por severidad y por desbloqueo de la fase siguiente` +
        `${notChecked.length > 0 ? `; ${notChecked.length} cosa(s) no comprobada(s)` : ''}. ` +
        'El asistente no cambia ningún veredicto.';

  return { suggestions, notChecked, detail };
};

/** Un bloque legible por humanos para la CLI; sin color, que el color es decisión de quien llama. */
export const renderAssist = (suggestions: AssistSuggestion[], opts: { max?: number } = {}): string[] => {
  if (suggestions.length === 0) return [];
  const max = Math.max(1, opts.max ?? 3);
  const shown = suggestions.slice(0, max);
  const lines: string[] = [
    `Asistente bajo demanda — ${suggestions.length} sugerencia(s); no cambia ningún veredicto:`,
  ];
  for (const suggestion of shown) {
    lines.push(`  [${suggestion.severity}] ${suggestion.trigger} · ${suggestion.headline}`);
    const proposal = suggestion.proposal.split('\n');
    proposal.forEach((line, index) => {
      lines.push(`      ${index === 0 ? 'propuesta: ' : '           '}${line}`);
    });
    if (suggestion.example) lines.push(`      ejemplo: ${suggestion.example}`);
    lines.push(`      acción: ${suggestion.action}`);
  }
  if (suggestions.length > max) {
    lines.push(`  ver más: ${suggestions[max].action}`);
  }
  return lines;
};
