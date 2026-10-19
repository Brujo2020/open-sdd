/**
 * El ASISTENTE EARS: no solo valida el requisito, ayuda a escribirlo y a repararlo.
 *
 * `ears.ts` responde a «¿esto es EARS?» y devuelve códigos (`COMPOUND_REQUIREMENT`, `VAGUE_TERM`,
 * `NO_SHALL`…). Eso deja al autor con un diagnóstico y ninguna salida. Este módulo responde a la
 * pregunta siguiente: «¿y cómo se escribe bien?», con una propuesta lista para pegar, el patrón que
 * usa y un ejemplo real de los documentos de ESTE repositorio.
 *
 * ── La regla que gobierna todo lo demás: no se inventa ──────────────────────────────────────────
 * Una propuesta solo se emite cuando es una frase EARS COMPLETA sobre el mismo comportamiento. Si
 * hace falta un dato que el texto no trae —el umbral que sustituye a «rápido», el actor de una
 * pasiva, el disparador de un objetivo— la propuesta NO se fabrica: empieza por
 * `EARS_NEEDS_INFORMATION` y dice exactamente qué falta y qué hay que responder. Nunca se emite una
 * plantilla con huecos (`<verbo>`) como propuesta: un hueco disfrazado de frase es la forma más
 * rápida de que un agente invente el requisito.
 *
 * ── Por qué hay un «evidence pack» y no un modelo ───────────────────────────────────────────────
 * Esta herramienta no embarca ningún backend de modelo (misma decisión que
 * `constitutionDraft.ts:evidencePackForHost`). En su lugar, `earsEvidencePack` entrega al modelo
 * anfitrión del usuario exactamente lo que necesita para redactar: el texto de los requisitos, los
 * hallazgos con su propuesta, los patrones presentes y ausentes, las cinco plantillas EARS con un
 * ejemplo real de este repositorio cada una, y la lista explícita de lo que no se pudo determinar.
 *
 * ── `complete` significa cobertura, no veredicto ────────────────────────────────────────────────
 * `EarsReport.complete` es true solo si TODO el documento se pudo analizar (había requisitos y
 * ninguna línea con aspecto de requisito quedó sin interpretar). Que una propuesta sea una pregunta
 * no hace que el documento esté «sin analizar»: eso viaja en `undetermined` dentro del evidence pack,
 * que es donde el anfitrión lo lee. Nada se declara comprobado sin haberlo estado.
 *
 * ── Nota de nombres ─────────────────────────────────────────────────────────────────────────────
 * `EarsPattern` y `EarsReport` ya existen en `ears.ts` con otro vocabulario (`event-driven` frente a
 * `event`). Por eso el barrel `core/index.ts` re-exporta este módulo con una lista explícita de
 * nombres en vez de `export *`: la ambigüedad se resuelve nombrando, no renombrando el contrato.
 */

import { EARS_LIMIT, EARS_TEMPLATES, containsVagueTerm, type EarsPattern as ValidatorPattern } from './ears.js';

export type EarsPattern = 'ubiquitous' | 'event' | 'state' | 'option' | 'unwanted';

export const EARS_PATTERNS: readonly EarsPattern[] = ['ubiquitous', 'event', 'state', 'option', 'unwanted'];

export interface EarsSuggestion {
  /** The requirement or line this is about. */
  target: string;
  /** Stable machine code, e.g. COMPOUND_REQUIREMENT, VAGUE_TERM, MISSING_TRIGGER, PASSIVE_VOICE, NO_ACTOR, NOT_TESTABLE. */
  code: string;
  severity: 'error' | 'warning' | 'info';
  /** What is wrong, in Spanish, one line. */
  problem: string;
  /** The rewrite, ready to paste. MUST be a real EARS sentence, not a template with placeholders left. */
  proposal: string;
  /** Why the proposal is better, naming the EARS pattern it uses. */
  why: string;
  /** A worked example from this project's own documents when one exists (cite the file). */
  example?: string;
}

export interface EarsReport {
  source: string;
  total: number;
  conforming: number;
  suggestions: EarsSuggestion[];
  patterns: Record<EarsPattern, number>;
  detail: string;
  complete: boolean;
  /**
   * Additive to the agreed minimum: every requirement statement analysed, in document order. The
   * evidence pack needs the requirements TEXT to hand it to a host model, and the report is the only
   * object that travels; without this field the pack could only show the lines that already failed.
   */
  statements?: string[];
}

/** Prefijo que marca una propuesta como PREGUNTA, nunca como frase lista para pegar. */
export const EARS_NEEDS_INFORMATION = 'Falta información:';

/** Una propuesta es aplicable solo si es una frase real, no una pregunta por el dato que falta. */
export const isEarsProposalApplicable = (suggestion: EarsSuggestion): boolean =>
  !suggestion.proposal.trim().startsWith(EARS_NEEDS_INFORMATION);

// ---------------------------------------------------------------------------------------------
// Plantillas y ejemplos reales de este repositorio
// ---------------------------------------------------------------------------------------------

const VALIDATOR_TO_ASSISTANT: Record<ValidatorPattern, EarsPattern> = {
  ubiquitous: 'ubiquitous',
  'event-driven': 'event',
  'state-driven': 'state',
  optional: 'option',
  unwanted: 'unwanted',
};

const KEYWORD_OF: Record<EarsPattern, string | null> = {
  ubiquitous: null,
  event: 'WHEN',
  state: 'WHILE',
  option: 'WHERE',
  unwanted: 'IF',
};

/**
 * Un ejemplo REAL por patrón, copiado de los documentos de este repositorio. No se inventa ninguno:
 * si un patrón no está representado, su ejemplo viaja como `null` y el evidence pack lo dice. El test
 * `coreEarsAssistant.test.ts` verifica contra el fichero citado que cada frase sigue ahí.
 */
export const EARS_REPO_EXAMPLES: readonly { pattern: EarsPattern; sentence: string; source: string }[] = [
  {
    pattern: 'ubiquitous',
    sentence: 'The engine shall keep working with no model backend and no network access.',
    source: '.sdd/specs/tool-maturity/requirements.md',
  },
  {
    pattern: 'event',
    sentence: 'When a repository is surveyed, the [constitution generator] shall emit only principles with evidence in the code.',
    source: '.sdd/specs/brownfield-support/requirements.md',
  },
  {
    pattern: 'state',
    sentence: 'While every principle of a constitution of four or more principles is MUST, the [constitution validator] shall warn that the levels no longer distinguish anything.',
    source: '.sdd/specs/brownfield-support/requirements.md',
  },
  {
    pattern: 'option',
    sentence: 'Where a repository signal is detected, the [resolver] shall activate the opt-in control the signal justifies.',
    source: '.sdd/specs/paper-alignment/requirements.md',
  },
  {
    pattern: 'unwanted',
    sentence: 'If a requirement is REMOVED, then the [validator] shall require its rationale and its covering contracts.',
    source: '.sdd/specs/brownfield-support/requirements.md',
  },
];

export interface EarsAssistantTemplate {
  pattern: EarsPattern;
  /** Plantilla canónica; las palabras clave EARS se quedan en inglés, como fija el paper. */
  template: string;
  keyword: string | null;
  /** Ejemplo real de este repositorio, o `null` si ningún documento lo contiene. */
  example: string | null;
  exampleSource: string | null;
}

/** Las cinco plantillas de `ears.ts` (reutilizadas, no re-escritas) con un ejemplo real cada una. */
export const EARS_ASSISTANT_TEMPLATES: EarsAssistantTemplate[] = EARS_TEMPLATES.map((template) => {
  const pattern = VALIDATOR_TO_ASSISTANT[template.pattern];
  const found = EARS_REPO_EXAMPLES.find((candidate) => candidate.pattern === pattern);
  return {
    pattern,
    template: template.template,
    keyword: template.keyword,
    example: found?.sentence ?? null,
    exampleSource: found?.source ?? null,
  };
});

/** «<frase real> (fuente: <fichero>)», o undefined si el patrón no está representado en el repositorio. */
const exampleFor = (pattern: EarsPattern): string | undefined => {
  const found = EARS_REPO_EXAMPLES.find((candidate) => candidate.pattern === pattern);
  return found ? `${found.sentence} (fuente: ${found.source})` : undefined;
};

export interface EarsSuggestionRule {
  code: string;
  severity: 'error' | 'warning' | 'info';
  /** Qué detecta y qué propone, en una línea. */
  detects: string;
}

/**
 * El catálogo de códigos con su severidad REAL. Es la mitad «contrato» del evidence pack: un modelo
 * anfitrión que no sepa qué códigos existen inventará los suyos. Mantenerlo sincronizado con las
 * detecciones de este módulo es parte del trato.
 */
export const EARS_SUGGESTION_CATALOGUE: readonly EarsSuggestionRule[] = [
  {
    code: 'COMPOUND_REQUIREMENT',
    severity: 'error',
    detects: 'Dos o más respuestas "shall" en una frase: se divide en una frase EARS por comportamiento, repitiendo el actor cuando la segunda no lo trae.',
  },
  {
    code: 'NO_SHALL',
    severity: 'error',
    detects: 'La frase no lleva el operador "shall" (o lleva "should", que es una recomendación): se deriva la forma con shall o se pregunta por la acción observable.',
  },
  {
    code: 'NOT_TESTABLE',
    severity: 'error',
    detects: 'Es un objetivo (quiero/objetivo/should be/be able to) y no un comportamiento: se pregunta por la respuesta observable del sistema.',
  },
  {
    code: 'ACTOR_NOT_SYSTEM',
    severity: 'error',
    detects: 'El sujeto es una persona (usuario, desarrollador, cliente): EARS describe lo que hace el sistema, así que se pregunta por su respuesta.',
  },
  {
    code: 'NO_ACTOR',
    severity: 'error',
    detects: 'No hay sujeto antes de "shall": se usa el actor dominante del documento (citando de dónde sale) o se pregunta.',
  },
  {
    code: 'PASSIVE_VOICE',
    severity: 'warning',
    detects: '"shall be <participio>": se reescribe en activo si la frase nombra al agente; si no, se pregunta quién ejecuta.',
  },
  {
    code: 'VAGUE_TERM',
    severity: 'warning',
    detects: 'Término no medible (rápido, adecuado, etc, flexible, robusto, fácil): se pide el valor o criterio que lo hace comprobable.',
  },
  {
    code: 'MISSING_TRIGGER',
    severity: 'warning',
    detects: 'La condición viaja dentro de la respuesta (", cuando…", "only when…") en vez de abrir la frase: se mueve al disparador conservando el sentido, o se pregunta.',
  },
];

// ---------------------------------------------------------------------------------------------
// Léxico
// ---------------------------------------------------------------------------------------------

/** Términos ambiguos. Es la lista de `ears.ts` más `flexible`, con la excepción de dominio documentada. */
const VAGUE_TERMS: readonly string[] = [
  'rápido',
  'rapido',
  'adecuado',
  'apropiado',
  'etc',
  'flexible',
  'robusto',
  'robusta',
  'fácil',
  'facil',
  'óptimo',
  'optimo',
  'eficiente',
  'y/o',
  'approximately',
  'as needed',
  'si es necesario',
  'cuando sea posible',
  'user-friendly',
  'fácil de usar',
  'facil de usar',
];

/**
 * `flexible` es el único término de la lista que TAMBIÉN es vocabulario de dominio aquí: nombra el
 * régimen de gobierno por defecto (`.sdd/specs/paper-alignment/requirements.md`: «under the flexible
 * regime»). Marcarlo como vago sería el mismo error que `ears.ts` ya documentó al quitarlo de su
 * lista: un linter que señala el vocabulario propio del proyecto pierde a sus lectores.
 */
const isDomainFlexible = (text: string): boolean => /\bflexible\s+(regime|régimen|governance|gobierno)\b/i.test(text);

const VAGUE_HINTS: readonly { re: RegExp; hint: string }[] = [
  {
    re: /^(rápido|rapido|eficiente|óptimo|optimo)$/i,
    hint: 'el límite de tiempo (percentil y milisegundos) que hace medible la rapidez',
  },
  {
    re: /^(adecuado|apropiado)$/i,
    hint: 'el criterio observable que decide qué se acepta y qué se rechaza',
  },
  { re: /^etc$/i, hint: 'la lista completa de elementos, porque «etc» deja el alcance abierto' },
  {
    re: /^(robusto|robusta)$/i,
    hint: 'la condición adversa concreta ante la que el sistema debe seguir funcionando',
  },
  {
    re: /^(fácil|facil|fácil de usar|facil de usar|user-friendly)$/i,
    hint: 'la tarea concreta y el número de pasos que se considera admisible',
  },
  { re: /^flexible$/i, hint: 'los grados de libertad admitidos y el límite que no se puede cruzar' },
  { re: /^y\/o$/i, hint: 'si las dos opciones son obligatorias a la vez o alternativas' },
];

const hintFor = (term: string): string =>
  VAGUE_HINTS.find((entry) => entry.re.test(term))?.hint ?? 'el valor o criterio observable que la sustituya';

const KEYWORD_PATTERNS: readonly { re: RegExp; pattern: EarsPattern; keyword: string }[] = [
  { re: /^\s*WHEN\b/i, pattern: 'event', keyword: 'WHEN' },
  { re: /^\s*WHILE\b/i, pattern: 'state', keyword: 'WHILE' },
  { re: /^\s*WHERE\b/i, pattern: 'option', keyword: 'WHERE' },
  { re: /^\s*IF\b/i, pattern: 'unwanted', keyword: 'IF' },
];

const keywordToPattern = (keyword: string): EarsPattern => {
  const lower = keyword.toLowerCase();
  if (lower === 'if' || lower === 'si') return 'unwanted';
  if (lower === 'while' || lower === 'mientras') return 'state';
  if (lower === 'where') return 'option';
  return 'event';
};

/** Sujeto inmediato antes de `shall`: descarta el disparador y todo lo anterior a la última coma. */
const subjectOf = (lead: string): string => {
  let text = lead.trim();
  if (/^(?:WHEN|WHILE|WHERE|IF)\b/i.test(text)) {
    const comma = text.indexOf(',');
    if (comma >= 0) text = text.slice(comma + 1).trim();
  }
  const comma = text.lastIndexOf(',');
  if (comma >= 0) text = text.slice(comma + 1).trim();
  return text;
};

const PERSON_ACTOR =
  /\b(?:the|a|an|el|la|los|las|un|una)?\s*\[?(?:user|users|usuario|usuarios|developer|developers|desarrollador|desarrolladores|client|clients|cliente|clientes|customer|customers|person|persona|human|humano|operator|operador|engineer|ingeniero|auditor|auditors)\b/i;

const capitalizeFirst = (text: string): string =>
  text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);

const lowerFirstWord = (text: string): string =>
  /^\[/.test(text) ? text : text.replace(/^([A-ZÀ-Þ])/, (m) => m.toLowerCase());

const SENTENCE_END = /[.!?]\s*$/;

const withPeriod = (text: string): string => {
  const trimmed = text.trim().replace(/[,;:]+$/, '').trim();
  return SENTENCE_END.test(trimmed) ? trimmed : `${trimmed}.`;
};

// ---------------------------------------------------------------------------------------------
// Extracción de requisitos
// ---------------------------------------------------------------------------------------------

interface Candidate {
  /** La línea tal y como aparece en el documento (con viñeta y `Statement:`), para poder reescribirla. */
  line: string;
  /** El enunciado sin decoración: sobre esto se analiza. */
  statement: string;
}

interface Extraction {
  requirements: Candidate[];
  /** Objetivos declarados como tales (`**Objective:**`): metas, no comportamientos. */
  goals: string[];
  /** Viñetas que no son requisitos (Targets, Contracts, campos de la delta…). */
  ignored: number;
  /** Líneas con aspecto de requisito que no se pudieron interpretar: hacen que `complete` sea false. */
  unparsed: string[];
}

const NON_STATEMENT_FIELD =
  /^(?:previous|anterior|targets|objetivos|contracts|contratos|rationale|motivo|justificaci[oó]n|strangler|merged|base|status|estado|depends|depende|acceptance|aceptaci[oó]n|objective|objetivo|scope|alcance|risks|riesgos|notes|notas)\b/i;

const looksLikeRequirementStart = (body: string): boolean =>
  /^(?:the|el|la|los|las|un|una|when|whenever|while|where|if|once|after|upon|shall|cuando|si|mientras|all|every|cada|todo|toda)\b/i.test(
    body,
  ) || /^\[[^\]]+\]/.test(body);

/**
 * Extrae los requisitos del documento sin inventar estructura: viñetas con `shall`, campos
 * `Statement:` (que es como la delta escribe sus enunciados) y líneas de prosa con `shall`. Las
 * viñetas que no son requisitos se cuentan (`ignored`) en vez de desaparecer en silencio.
 */
const extractRequirements = (text: string): Extraction => {
  const requirements: Candidate[] = [];
  const goals: string[] = [];
  const unparsed: string[] = [];
  let ignored = 0;
  let inFence = false;
  let inComment = false;

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();

    if (inFence) {
      if (/^(?:```|~~~)/.test(trimmed)) inFence = false;
      continue;
    }
    if (inComment) {
      if (trimmed.includes('-->')) inComment = false;
      continue;
    }
    if (/^(?:```|~~~)/.test(trimmed)) {
      inFence = true;
      continue;
    }
    if (trimmed.startsWith('<!--')) {
      if (!trimmed.includes('-->')) inComment = true;
      continue;
    }
    if (trimmed.length === 0 || /^#{1,6}\s/.test(trimmed) || trimmed.startsWith('|')) continue;

    const bullet = trimmed.match(/^[-*+]\s+(.*)$/);
    if (bullet) {
      const body = bullet[1].trim();
      if (/^(?:\*\*)?(?:objective|objetivo)\b/i.test(body)) {
        goals.push(body);
        continue;
      }
      const statementField = body.match(/^(?:Statement|Enunciado)\s*:\s*(.*)$/i);
      if (statementField) {
        const statement = statementField[1].trim();
        if (statement.length === 0) unparsed.push(trimmed);
        else requirements.push({ line: trimmed, statement });
        continue;
      }
      if (NON_STATEMENT_FIELD.test(body)) {
        ignored += 1;
        continue;
      }
      if (/\bshall\b/i.test(body) || looksLikeRequirementStart(body)) {
        requirements.push({ line: trimmed, statement: body });
        continue;
      }
      ignored += 1;
      continue;
    }

    // Prosa: una línea con `shall` es un requisito aunque no lleve viñeta.
    if (/\bshall\b/i.test(trimmed)) requirements.push({ line: trimmed, statement: trimmed });
  }

  return { requirements, goals, ignored, unparsed };
};

// ---------------------------------------------------------------------------------------------
// Detecciones
// ---------------------------------------------------------------------------------------------

interface DominantActor {
  subject: string;
  count: number;
  total: number;
}

/**
 * El actor dominante del documento, con su forma textual (`The [engine]`). Solo se usa para reparar
 * una frase sin sujeto, y solo cuando es inequívoco: aparece al menos dos veces y en ≥60 % de los
 * requisitos. La propuesta cita de dónde sale; no es un actor inventado.
 */
const dominantActor = (candidates: Candidate[]): DominantActor | null => {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const lead = candidate.statement.slice(0, Math.max(0, candidate.statement.search(/\bshall\b/i)));
    const match = lead.match(/((?:the|el|la|los|las|The|El|La|Los|Las)\s+\[[^\]]+\])\s*$/);
    if (match) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0 || candidates.length === 0) return null;
  const [subject, count] = sorted[0];
  if (count < 2 || count / candidates.length < 0.6) return null;
  return { subject, count, total: candidates.length };
};

const IRREGULAR_BASE: Record<string, string> = {
  written: 'write',
  sent: 'send',
  kept: 'keep',
  made: 'make',
  taken: 'take',
  given: 'give',
  done: 'do',
  built: 'build',
  found: 'find',
  held: 'hold',
  shown: 'show',
  read: 'read',
  set: 'set',
  put: 'put',
  cut: 'cut',
  split: 'split',
  stored: 'store',
  used: 'use',
  issued: 'issue',
  caused: 'cause',
  based: 'base',
  closed: 'close',
  parsed: 'parse',
  released: 'release',
  exposed: 'expose',
  required: 'require',
  provided: 'provide',
};

/** Participio/pasado → forma base. Devuelve null cuando no se puede derivar sin adivinar. */
const baseVerb = (word: string): string | null => {
  const lower = word.toLowerCase();
  if (IRREGULAR_BASE[lower]) return IRREGULAR_BASE[lower];
  if (/(at|it|ut|ov|ur|iz|is|os|us|as|or|u|o)ed$/.test(lower)) return lower.slice(0, -1);
  if (/ed$/.test(lower)) {
    let stem = lower.slice(0, -2);
    if (/([bdgklmnprt])\1$/.test(stem)) stem = stem.slice(0, -1);
    return stem.length >= 2 ? stem : null;
  }
  if (/ies$/.test(lower)) return `${lower.slice(0, -3)}y`;
  if (/(?:ss|sh|ch|x|z)es$/.test(lower)) return lower.slice(0, -2);
  if (/s$/.test(lower) && !/ss$/.test(lower)) return lower.slice(0, -1);
  return null;
};

const AUXILIARY = /\b(is|are|was|were|has|have|had|can|could|may|might|must|will|would|should|does|do|did)\b/i;
const DETERMINER_OR_PREPOSITION =
  /^(?:the|a|an|its|their|his|her|that|this|those|these|to|for|with|in|on|at|from|into|by|each|every)$/;

/**
 * Negación mecánica de una condición, para convertir «only when X» en «IF NOT X». Solo se acepta
 * cuando la negación es una operación de forma (auxiliar o do-support con complemento reconocible):
 * una negación dudosa produciría un requisito con otro sentido, que es peor que preguntar.
 *
 * La negación se aplica al PRIMER verbo de la condición, no a cualquier auxiliar: en «it inspected
 * the artifacts it claims to have checked», negar el auxiliar «have» daba «claims to have not
 * checked», que niega la subordinada y deja la condición principal intacta — un requisito distinto
 * disfrazado de reescritura.
 */
const negateClause = (clause: string): string | null => {
  const words = clause.split(/\s+/);
  const candidates: { index: number; replacement: string }[] = [];

  const auxiliary = clause.match(AUXILIARY);
  if (auxiliary && auxiliary.index !== undefined) {
    const at = auxiliary.index + auxiliary[0].length;
    candidates.push({ index: auxiliary.index, replacement: `${clause.slice(0, at)} not${clause.slice(at)}` });
  }

  for (let i = 1; i < words.length; i += 1) {
    const bare = words[i].replace(/[^A-Za-zÀ-ÿ]/g, '');
    const next = (words[i + 1] ?? '').toLowerCase().replace(/[^a-zà-ÿ]/g, '');
    if (bare.length < 3 || !DETERMINER_OR_PREPOSITION.test(next)) continue;
    const past = /ed$/.test(bare) ? baseVerb(bare) : null;
    const present = /s$/.test(bare) && !/ss$/.test(bare) ? baseVerb(bare) : null;
    const base = past ?? present;
    if (!base) continue;
    const replacement = words.map((word, index) => (index === i ? `${past ? 'did' : 'does'} not ${base}` : word)).join(' ');
    candidates.push({ index: clause.indexOf(words[i]), replacement });
    break;
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.index - b.index);
  return candidates[0].replacement;
};

const NON_PASSIVE_PARTICIPLES =
  /^(?:able|unable|available|responsible|consistent|idempotent|present|absent|visible|empty|valid|true|false|required|allowed|expected|possible|necessary|ready|sure)$/i;

const CONJUNCTION_SEPARATOR = /(?:[,;]\s*(?:and\s+|y\s+)?|\s+and\s+|\s+y\s+)/gi;
const SENTENCE_SEPARATOR = /[.;!?]\s+/g;

/**
 * Divide un requisito compuesto en una frase EARS por respuesta. Es una operación de forma, no de
 * contenido: cada respuesta se conserva palabra por palabra y el actor se repite cuando la segunda
 * cláusula no trae el suyo. Si no se puede reconstruir una frase completa (falta el sujeto, una
 * respuesta está vacía), devuelve null y quien llama pregunta en vez de inventar.
 */
const splitCompound = (statement: string): string[] | null => {
  const marks = [...statement.matchAll(/\bshall\b/gi)].map((match) => match.index ?? -1);
  if (marks.length < 2 || marks.some((index) => index < 0)) return null;

  const firstLead = statement.slice(0, marks[0]).trim();
  const segments: { lead: string; response: string; inherited: boolean }[] = [];
  let lead = firstLead;

  for (let index = 0; index < marks.length; index += 1) {
    const start = marks[index];
    const end = index + 1 < marks.length ? marks[index + 1] : statement.length;
    const between = statement.slice(start, end);
    let response = between;
    let nextLead = '';

    if (index + 1 < marks.length) {
      const sentenceBreaks = [...between.matchAll(SENTENCE_SEPARATOR)];
      const separators = sentenceBreaks.length > 0 ? sentenceBreaks : [...between.matchAll(CONJUNCTION_SEPARATOR)];
      const last = separators[separators.length - 1];
      if (!last || last.index === undefined) return null;
      response = between.slice(0, last.index);
      nextLead = between.slice(last.index + last[0].length);
    }

    const inherited = index > 0 && nextLead.trim().length === 0;
    segments.push({ lead, response, inherited });
    if (index + 1 < marks.length) {
      const candidate = nextLead.trim();
      lead = candidate.length > 0 ? candidate : lead;
    }
  }

  const sentences: string[] = [];
  for (const segment of segments) {
    const subject = segment.lead.trim();
    const response = segment.response.trim();
    if (subject.length === 0 || response.replace(/\bshall\b/i, '').trim().length === 0) return null;
    const sentence = withPeriod(`${subject} ${response}`);
    sentences.push(segment.inherited ? capitalizeFirst(sentence) : sentence);
  }
  return sentences.length >= 2 ? sentences : null;
};

const classifyStatement = (statement: string): { pattern: EarsPattern; keyword: string | null } => {
  const trimmed = statement.trim();
  for (const entry of KEYWORD_PATTERNS) {
    if (entry.re.test(trimmed)) return { pattern: entry.pattern, keyword: entry.keyword };
  }
  return { pattern: 'ubiquitous', keyword: null };
};

const isGoal = (statement: string): boolean =>
  /\b(quiero|necesito|deseo|objetivo|meta|i want|we want|be able to|ser capaz de|as an? [a-zà-ÿ]+)\b/i.test(statement) ||
  /\bshould\s+(?:be|have|ser)\b/i.test(statement) ||
  /\b(?:be|ser)\s+(?:más|more|mejor|better|usable|user-friendly|friendly|escalable|maintainable)\b/i.test(statement);

/** Deriva la forma con `shall` de una frase que no lo lleva, sin inventar el verbo. */
const deriveShall = (statement: string): string | null => {
  const match = statement.match(
    /^((?:The|El|La|Los|Las|the|el|la|los|las)\s+(?:\[[^\]]+\]|[A-Za-zÀ-ÿ][\w.-]*))\s+([A-Za-zÀ-ÿ]+)\b(.*)$/,
  );
  if (!match) return null;
  const [, subject, verb, rest] = match;
  const base = baseVerb(verb);
  if (!base || base.length < 2) return null;
  return `${subject} shall ${base}${rest}`.trim();
};

interface AnalysisContext {
  dominant: DominantActor | null;
}

const analyseCandidate = (candidate: Candidate, context: AnalysisContext): EarsSuggestion[] => {
  const statement = candidate.statement;
  const target = candidate.line;
  const classified = classifyStatement(statement);
  const example = exampleFor(classified.pattern);
  const suggestions: EarsSuggestion[] = [];
  const shallMarks = [...statement.matchAll(/\bshall\b/gi)];
  const shallIndex = statement.search(/\bshall\b/i);

  const push = (suggestion: Omit<EarsSuggestion, 'example'>): void => {
    suggestions.push(example ? { ...suggestion, example } : suggestion);
  };

  if (shallMarks.length > 1) {
    const split = splitCompound(statement);
    if (split) {
      push({
        target,
        code: 'COMPOUND_REQUIREMENT',
        severity: 'error',
        problem: `${shallMarks.length} respuestas "shall" en un requisito: son ${shallMarks.length} comportamientos y cada uno necesita su propia frase.`,
        proposal: split.join('\n'),
        why: `Dividir conserva el patrón ${classified.pattern} y deja una única respuesta por frase, así que cada una se puede verificar por separado; el actor se repite donde la segunda cláusula no lo traía.`,
      });
    } else {
      push({
        target,
        code: 'COMPOUND_REQUIREMENT',
        severity: 'error',
        problem: `${shallMarks.length} respuestas "shall" en un requisito, y no se pueden separar sin saber a quién pertenece cada una.`,
        proposal: `${EARS_NEEDS_INFORMATION} hay ${shallMarks.length} respuestas "shall" en una sola frase y no puedo repartirlas sin inventar el sujeto o el disparo de cada una. ¿Qué actor y qué disparador corresponden a cada respuesta?`,
        why: `Un requisito compuesto se convierte en una frase EARS por comportamiento (patrón ${classified.pattern}); para separarlas hace falta el sujeto de cada respuesta, y eso solo lo sabe quien escribe el requisito.`,
      });
    }
  } else if (shallMarks.length === 0) {
    if (isGoal(statement)) {
      push({
        target,
        code: 'NOT_TESTABLE',
        severity: 'error',
        problem: 'Es un objetivo, no un comportamiento: no dice qué hace el sistema, así que no se puede probar.',
        proposal: `${EARS_NEEDS_INFORMATION} no puedo escribir la frase EARS sin saber qué respuesta observable del sistema demuestra este objetivo. ¿Qué hace el sistema, y cuándo, para cumplirlo?`,
        why: 'EARS describe comportamiento del sistema (disparador + actor + shall + respuesta), no metas. Un objetivo se convierte en uno o más requisitos con una respuesta observable; la meta no es verificable por sí sola.',
      });
    } else {
      const derived = deriveShall(statement);
      const shouldNote = /\bshould\b/i.test(statement)
        ? ' Además, "should" expresa recomendación: el operador de EARS es "shall".'
        : '';
      push({
        target,
        code: 'NO_SHALL',
        severity: 'error',
        problem: `La frase no lleva el operador "shall"${shouldNote ? ' (lleva "should")' : ''}: sin él no hay requisito comprobable.`,
        proposal: derived
          ? derived
          : `${EARS_NEEDS_INFORMATION} la frase no lleva "shall" y no puedo derivar el verbo sin inventarlo. ¿Qué acción observable debe realizar el actor?`,
        why: derived
          ? `"shall" es el operador obligatorio de EARS y la forma derivada conserva el mismo verbo en su forma base, con el patrón ${classified.pattern}.${shouldNote}`
          : `EARS exige el operador "shall" seguido de una respuesta. Añadirlo sin saber el verbo produciría una frase distinta de la que querías.${shouldNote}`,
      });
    }
  } else {
    const lead = shallIndex >= 0 ? statement.slice(0, shallIndex) : '';
    const subject = subjectOf(lead);

    // Pasiva: "shall be <participio>". Si la frase nombra al agente, la reescritura es mecánica.
    const passive = statement.match(/\bshall\s+be\s+([A-Za-zÀ-ÿ]+)\b([\s\S]*)$/i);
    if (passive && passive.index !== undefined && !NON_PASSIVE_PARTICIPLES.test(passive[1])) {
      const participle = passive[1];
      const tail = passive[2];
      const object = subjectOf(statement.slice(0, passive.index)) || lead.trim();
      const agent = tail.match(/\bby\s+((?:the\s+)?(?:\[[^\]]+\]|[A-Za-zÀ-ÿ][\w.-]*))/i);
      const base = baseVerb(participle);
      if (agent && base && object.length > 0) {
        push({
          target,
          code: 'PASSIVE_VOICE',
          severity: 'warning',
          problem: `La respuesta está en pasiva ("shall be ${participle}"): el actor aparece detrás, no como sujeto.`,
          proposal: withPeriod(`${capitalizeFirst(agent[1])} shall ${base} ${lowerFirstWord(object)}`),
          why: `EARS nombra al actor como sujeto de "shall". La reescritura en activo usa el agente que la propia frase declara ("${agent[1]}"), sin añadir ninguno.`,
        });
      } else {
        push({
          target,
          code: 'PASSIVE_VOICE',
          severity: 'warning',
          problem: `La respuesta está en pasiva ("shall be ${participle}") y no dice quién ejecuta la acción.`,
          proposal: `${EARS_NEEDS_INFORMATION} la frase está en pasiva y no nombra al agente${base ? ` del verbo "${base}"` : ''}. ¿Qué componente del sistema responde, y con qué acción?`,
          why: 'Una pasiva sin agente no permite verificar nada: no se sabe quién debe actuar. EARS exige un actor explícito como sujeto de "shall".',
        });
      }
    }

    // Sujeto ausente: `shall ...` o `WHEN X, shall ...`.
    if (subject.length === 0 || /^(?:then|entonces)$/i.test(subject)) {
      const trigger = lead.match(/^\s*((?:WHEN|WHILE|WHERE|IF)\b[^,]*,\s*)/i);
      const remainder = trigger ? lead.slice(trigger[1].length) : lead;
      if (remainder.trim().length === 0) {
        const dominant = context.dominant;
        if (dominant) {
          push({
            target,
            code: 'NO_ACTOR',
            severity: 'error',
            problem: 'No hay sujeto antes de "shall": no se sabe quién responde.',
            proposal: withPeriod(`${trigger ? trigger[1] : ''}${dominant.subject} ${statement.slice(shallIndex)}`),
            why: `El actor "${dominant.subject}" se toma de ${dominant.count} de ${dominant.total} requisitos de este documento (no se inventa). Confírmalo antes de pegarlo.`,
          });
        } else {
          push({
            target,
            code: 'NO_ACTOR',
            severity: 'error',
            problem: 'No hay sujeto antes de "shall" y el documento no tiene un actor dominante del que tomarlo.',
            proposal: `${EARS_NEEDS_INFORMATION} no puedo escribir la frase sin saber quién ejecuta la respuesta. ¿Qué componente del sistema debe actuar?`,
            why: 'EARS exige un actor como sujeto de "shall"; sin él la frase no dice quién responde y no se puede verificar.',
          });
        }
      }
    } else if (PERSON_ACTOR.test(subject)) {
      push({
        target,
        code: 'ACTOR_NOT_SYSTEM',
        severity: 'error',
        problem: `El sujeto es una persona ("${subject}"), no el sistema: describe un paso de uso, no un requisito del sistema.`,
        proposal: `${EARS_NEEDS_INFORMATION} el actor de esta frase es una persona, y EARS describe lo que hace el sistema. ¿Qué respuesta observable del sistema produce esa acción de la persona?`,
        why: 'Una frase EARS tiene al sistema como actor (disparador + actor + shall + respuesta). Un requisito sobre lo que hace una persona no lo puede verificar el sistema.',
      });
    }

    // Condición dentro de la respuesta: ", cuando…" u "only when…".
    if (classified.pattern === 'ubiquitous' && shallIndex >= 0) {
      const response = statement.slice(shallIndex + 'shall'.length);
      const trailing = response.match(
        /,\s*(when|whenever|if|while|once|after|upon|si|cuando|mientras)\s+(.+)$/i,
      );
      const onlyWhen = response.match(/\bonly\s+(when|if|si|cuando)\s+(.+)$/i);
      if (trailing) {
        const clause = trailing[2].trim().replace(/[.;]+$/, '');
        const body = response.slice(0, trailing.index ?? 0).trim().replace(/[,;]+$/, '');
        if (clause.split(/\s+/).length >= 2 && body.length > 0) {
          const pattern = keywordToPattern(trailing[1]);
          const keyword = KEYWORD_OF[pattern] ?? 'WHEN';
          push({
            target,
            code: 'MISSING_TRIGGER',
            severity: 'warning',
            problem: `La condición viaja detrás de la respuesta (", ${trailing[1]} ${clause}") en vez de abrir la frase.`,
            proposal:
              pattern === 'unwanted'
                ? withPeriod(`IF ${clause}, THEN ${lowerFirstWord(lead.trim())} shall ${body}`)
                : withPeriod(`${keyword} ${clause}, ${lowerFirstWord(lead.trim())} shall ${body}`),
            why: `El patrón ${pattern} pone el disparador delante para que la frase diga CUÁNDO ocurre. La condición se mueve palabra por palabra: no se añade ningún disparador nuevo.`,
          });
        }
      } else if (onlyWhen) {
        const clause = onlyWhen[2].trim().replace(/[.;]+$/, '');
        const body = response.slice(0, onlyWhen.index ?? 0).trim().replace(/[,;]+$/, '');
        const negated = negateClause(clause);
        if (negated && body.length > 0) {
          push({
            target,
            code: 'MISSING_TRIGGER',
            severity: 'warning',
            problem: `La condición necesaria ("only ${onlyWhen[1]} ${clause}") está dentro de la respuesta en vez de ser un disparador.`,
            proposal: withPeriod(`IF ${negated}, THEN ${lowerFirstWord(lead.trim())} shall not ${body}`),
            why: 'El patrón unwanted (IF…THEN) es el hogar del requisito negativo. "Solo si X" equivale a "si no X, entonces no": la negación es mecánica y conserva el sentido, sin inventar un disparador nuevo.',
          });
        } else {
          push({
            target,
            code: 'MISSING_TRIGGER',
            severity: 'warning',
            problem: `La condición necesaria ("only ${onlyWhen[1]} ${clause}") está dentro de la respuesta y no se puede negar sin cambiar el sentido.`,
            proposal: `${EARS_NEEDS_INFORMATION} no puedo convertir "only ${onlyWhen[1]} ${clause}" en un disparador sin negar la condición, y esa negación no es mecánica aquí. ¿Es una condición necesaria (solo se cumple si X) o un disparador (cuando X, entonces …)?`,
            why: 'El patrón unwanted exige negar la condición para conservar el sentido de "solo si". Cuando la negación no es una operación de forma, inventarla cambiaría el requisito.',
          });
        }
      }
    }
  }

  for (const term of VAGUE_TERMS) {
    if (!containsVagueTerm(statement, term)) continue;
    if (term.toLowerCase() === 'flexible' && isDomainFlexible(statement)) continue;
    const hint = hintFor(term);
    push({
      target,
      code: 'VAGUE_TERM',
      severity: 'warning',
      problem: `«${term}» no es comprobable: la frase no dice qué umbral o criterio la hace verdadera o falsa.`,
      proposal: `${EARS_NEEDS_INFORMATION} «${term}» no es comprobable y no puedo inventar ${hint}. ¿Cuál es el valor real?`,
      why: `Ningún patrón EARS admite términos no medibles. Al sustituir «${term}» por ${hint}, la frase conserva el patrón ${classified.pattern} y pasa a ser verificable.`,
    });
  }

  return suggestions;
};

// ---------------------------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------------------------

const emptyPatterns = (): Record<EarsPattern, number> => ({
  ubiquitous: 0,
  event: 0,
  state: 0,
  option: 0,
  unwanted: 0,
});

/**
 * Analiza un documento de requisitos. Devuelve el informe completo: qué se analizó, la distribución
 * de patrones de los requisitos conformes, y una sugerencia por defecto con propuesta lista para
 * pegar o con la pregunta exacta que falta responder.
 */
export const analyseEars = (text: string, options: { source?: string } = {}): EarsReport => {
  const source = options.source?.trim() || '(texto sin fuente)';
  const extraction = extractRequirements(text ?? '');
  const context: AnalysisContext = { dominant: dominantActor(extraction.requirements) };

  const analysed = extraction.requirements.map((candidate) => ({
    candidate,
    pattern: classifyStatement(candidate.statement).pattern,
    suggestions: analyseCandidate(candidate, context),
  }));

  const patterns = emptyPatterns();
  let conforming = 0;
  for (const entry of analysed) {
    if (entry.suggestions.length > 0) continue;
    conforming += 1;
    patterns[entry.pattern] += 1;
  }

  const suggestions = analysed.flatMap((entry) => entry.suggestions);
  const errors = suggestions.filter((suggestion) => suggestion.severity === 'error').length;
  const warnings = suggestions.filter((suggestion) => suggestion.severity === 'warning').length;
  const open = suggestions.filter((suggestion) => !isEarsProposalApplicable(suggestion)).length;
  const complete = analysed.length > 0 && extraction.unparsed.length === 0;

  const detail: string[] = [];
  if (analysed.length === 0) {
    detail.push(`No se encontró ningún requisito en ${source}: no se ha comprobado nada.`);
  } else {
    detail.push(
      `${analysed.length} requisito(s) analizado(s) en ${source}: ${conforming} conforme(s), ${suggestions.length} sugerencia(s) (${errors} error, ${warnings} aviso).`,
    );
    detail.push(`Patrones de los conformes: ${EARS_PATTERNS.map((p) => `${p} ${patterns[p]}`).join(' · ')}.`);
    if (conforming > 0 && patterns.ubiquitous === conforming) {
      detail.push(
        'Todos los requisitos conformes son ubicuos: el documento no dice CUÁNDO ocurre nada, así que no hay disparadores que probar.',
      );
    } else if (patterns.unwanted === 0) {      detail.push(
        'Ningún requisito conforme usa IF…THEN: es el patrón que los equipos omiten y el único hogar de primera clase para requisitos negativos.',
      );
    }
    if (open > 0) {
      detail.push(`${open} sugerencia(s) no traen una frase lista: falta información y no se ha inventado ninguna propuesta.`);
    }
  }
  if (extraction.goals.length > 0) {
    detail.push(
      `${extraction.goals.length} objetivo(s) declarados como "Objective" no se han contado como requisitos: son metas, no comportamientos.`,
    );
  }
  if (extraction.ignored > 0) {
    detail.push(`${extraction.ignored} viñeta(s) que no son requisitos (campos de la delta, listas) se han ignorado: no se cuentan.`);
  }
  if (!complete) {
    detail.push(
      analysed.length === 0
        ? 'Análisis INCOMPLETO: no había requisitos que analizar.'
        : `Análisis INCOMPLETO: ${extraction.unparsed.length} línea(s) con aspecto de requisito no se pudieron interpretar.`,
    );
  }

  return {
    source,
    total: analysed.length,
    conforming,
    suggestions,
    patterns,
    detail: detail.join(' '),
    complete,
    statements: extraction.requirements.map((candidate) => candidate.statement),
  };
};

/** Agrega varios informes (requirements.md + delta.md, o todas las specs del proyecto) en uno. */
export const mergeEarsReports = (reports: EarsReport[]): EarsReport => {
  const usable = reports.filter((report) => report !== undefined && report !== null);
  if (usable.length === 0) {
    return {
      source: '(sin fuentes)',
      total: 0,
      conforming: 0,
      suggestions: [],
      patterns: emptyPatterns(),
      detail: 'No hay fuentes que analizar.',
      complete: false,
      statements: [],
    };
  }

  const patterns = emptyPatterns();
  const suggestions: EarsSuggestion[] = [];
  const statements: string[] = [];
  let total = 0;
  let conforming = 0;
  for (const report of usable) {
    total += report.total;
    conforming += report.conforming;
    for (const pattern of EARS_PATTERNS) patterns[pattern] += report.patterns[pattern] ?? 0;
    suggestions.push(...report.suggestions);
    statements.push(...(report.statements ?? []));
  }

  const errors = suggestions.filter((suggestion) => suggestion.severity === 'error').length;
  const warnings = suggestions.filter((suggestion) => suggestion.severity === 'warning').length;
  const complete = usable.every((report) => report.complete);
  return {
    source: usable.map((report) => report.source).join(' + '),
    total,
    conforming,
    suggestions,
    patterns,
    detail:
      `Análisis agregado de ${usable.length} fuente(s): ${total} requisito(s), ${conforming} conforme(s), ` +
      `${suggestions.length} sugerencia(s) (${errors} error, ${warnings} aviso). ` +
      (complete ? 'Todas las fuentes se analizaron por completo.' : 'INCOMPLETO: alguna fuente no se pudo analizar por completo.'),
    complete,
    statements,
  };
};

/**
 * Los enunciados `- Statement:` de una delta que NO repiten un enunciado ya analizado. La delta de
 * este repositorio reformula requisitos que también viven en `requirements.md`: contarlos dos veces
 * inflaría el informe y haría parecer que hay el doble de requisitos. Es una operación de texto, así
 * que vive aquí y no en cada comando.
 */
export const deltaStatementText = (
  deltaMarkdown: string,
  alreadyAnalysed: Iterable<string> = [],
): { text: string; statements: number; duplicates: number } => {
  const seen = new Set([...alreadyAnalysed].map((statement) => statement.replace(/\s+/g, ' ').trim()));
  const kept: string[] = [];
  let duplicates = 0;
  for (const raw of deltaMarkdown.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const match = line.trim().match(/^[-*+]\s+(?:Statement|Enunciado)\s*:\s*(.*)$/i);
    if (!match) continue;
    const statement = match[1].trim();
    if (statement.length === 0) continue;
    if (seen.has(statement.replace(/\s+/g, ' ').trim())) {
      duplicates += 1;
      continue;
    }
    kept.push(line.trim());
  }
  return { text: kept.join('\n'), statements: kept.length, duplicates };
};

// ---------------------------------------------------------------------------------------------
// De lenguaje natural a candidatos EARS
// ---------------------------------------------------------------------------------------------
const INTENT_PREFIX =
  /^\s*(?:yo\s+)?(?:quiero|necesito|deseo|me\s+gustar[íi]a|pretendo|i\s+want|we\s+want|i\s+need|we\s+need|the\s+system\s+should|el\s+sistema\s+deber[íi]a)\s+(?:que\s+)?/i;

const TRIGGER_PHRASES: readonly { re: RegExp; pattern: EarsPattern }[] = [
  { re: /\b(?:cuando|when|whenever|una vez que|once)\s+([^,.;]+)/i, pattern: 'event' },
  { re: /\b(?:mientras|while)\s+([^,.;]+)/i, pattern: 'state' },
  { re: /\b(?:si|if)\s+([^,.;]+)/i, pattern: 'unwanted' },
  { re: /\b(?:donde|where)\s+([^,.;]+)/i, pattern: 'option' },
];

const ACTOR_PHRASES: readonly RegExp[] = [
  /\b(?:el|the)\s+(?:sistema|system)\b/i,
  /\b(?:la|the)\s+(?:herramienta|tool)\b/i,
  /\b(?:el|the)\s+(?:motor|engine)\b/i,
];

/** Modal del enunciado («debe», «tiene que», «must»): no es la respuesta, es el operador. */
const MODAL_PREFIX = /^(?:debe\s+de|debe|deber[íi]a|tiene\s+que|tienen\s+que|ha\s+de|han\s+de|must|should|shall|to)\s+/i;

const normalizeResponse = (text: string): string =>
  text
    .trim()
    .replace(/^(?:que\s+)?/i, '')
    .replace(MODAL_PREFIX, '')
    .replace(/[.;,]+$/, '')
    .trim();

const looksSpanish = (text: string): boolean => /[áéíóúñ¿¡]|\b(?:el|la|los|las|que|cuando|sistema|usuario)\b/i.test(text);

/** «the report exported every night» es una pasiva sin agente: se reordena a activo con su verbo. */
const PASSIVE_FRAGMENT = /^(the|a|an|el|la|los|las)\s+([\wÀ-ÿ-]+)\s+([A-Za-zÀ-ÿ]+ed)\b(.*)$/;

const reorderPassiveFragment = (response: string): { response: string; reordered: boolean } => {
  const match = response.match(PASSIVE_FRAGMENT);
  if (!match) return { response, reordered: false };
  const base = baseVerb(match[3]);
  if (!base) return { response, reordered: false };
  return { response: `${base} ${match[1]} ${match[2]}${match[4]}`, reordered: true };
};

/**
 * Convierte una descripción en lenguaje natural en CANDIDATOS EARS: frases completas que reordenan
 * las palabras del usuario (no las sustituyen) y que están marcadas como sugerencias a revisar.
 *
 * La transformación es de forma: se toma el disparador que el usuario ya nombró, el actor que ya
 * nombró y la respuesta que ya escribió. Si el actor no aparece, se usa el actor del sistema y la
 * sugerencia lo dice: el nombre real del componente lo pone quien escribe, no este módulo. La forma
 * verbal se deja tal cual (no se conjuga ni se traduce): por eso el candidato es una sugerencia.
 */
export const describeFromPlainLanguage = (description: string): EarsSuggestion[] => {
  const target = description?.trim() ?? '';
  if (target.length === 0) return [];

  let working = target.replace(INTENT_PREFIX, '').trim();
  let pattern: EarsPattern = 'ubiquitous';
  let trigger = '';

  for (const phrase of TRIGGER_PHRASES) {
    const match = working.match(phrase.re);
    if (!match) continue;
    pattern = phrase.pattern;
    trigger = match[1].trim();
    working = working.replace(match[0], ' ').trim();
    break;
  }

  const actorMatch = ACTOR_PHRASES.map((re) => working.match(re)).find((match) => match !== null);
  const subject = actorMatch ? actorMatch[0].trim() : 'the system';
  if (actorMatch) working = working.replace(actorMatch[0], ' ').trim();

  const response = normalizeResponse(working);
  const reordered = reorderPassiveFragment(response);
  const keyword = KEYWORD_OF[pattern];
  const proposal =
    response.length === 0
      ? `${EARS_NEEDS_INFORMATION} la descripción no contiene ninguna respuesta (qué debe hacer el sistema) además del disparador. ¿Qué debe hacer?`
      : withPeriod(
          pattern === 'unwanted'
            ? `IF ${trigger}, THEN ${subject} shall ${reordered.response}`
            : keyword
              ? `${keyword} ${trigger}, ${subject} shall ${reordered.response}`
              : `${capitalizeFirst(subject)} shall ${reordered.response}`,
        );

  const suggestion: EarsSuggestion = {
    target,
    code: `CANDIDATE_${pattern.toUpperCase()}`,
    severity: 'info',
    problem: 'Es una SUGERENCIA a revisar, no una validación: reordena tus palabras en la plantilla EARS sin cambiar el contenido.',
    proposal,
    why:
      `Patrón ${pattern}${keyword ? ` (${keyword})` : ''}: ` +
      (pattern === 'ubiquitous'
        ? 'sin disparador, porque la descripción no nombra ninguno; si el comportamiento depende de algo, añade el WHEN.'
        : `el disparador "${trigger}" abre la frase y la respuesta va detrás de "shall".`) +
      (actorMatch ? '' : ' El actor es "the system": sustitúyelo por el componente real.') +
      (reordered.reordered ? ' La respuesta venía en pasiva sin agente y se reordena a voz activa.' : '') +
      ' La forma verbal queda como la escribiste: tras "shall" va el verbo en forma base.' +
      (looksSpanish(target) ? ' Revisa también la concordancia: el candidato conserva tus palabras, no las traduce.' : ''),
  };
  const example = exampleFor(pattern);
  return [example ? { ...suggestion, example } : suggestion];
};

// ---------------------------------------------------------------------------------------------
// Evidence pack para el modelo anfitrión
// ---------------------------------------------------------------------------------------------

/**
 * Lo que un usuario entrega a SU modelo: el texto de los requisitos, los hallazgos con su propuesta,
 * los patrones usados y ausentes, las cinco plantillas EARS con un ejemplo real de este repositorio
 * cada una, y la lista explícita de lo que no se pudo determinar. Ningún modelo viaja aquí.
 */
export const earsEvidencePack = (
  report: EarsReport,
  options: { maxSuggestions?: number } = {},
): Record<string, unknown> => {
  const maxSuggestions = Math.max(0, options.maxSuggestions ?? 20);
  const open = report.suggestions.filter((suggestion) => !isEarsProposalApplicable(suggestion));

  const undetermined: string[] = [];
  for (const suggestion of open) {
    undetermined.push(`${suggestion.code} en «${suggestion.target}»: ${suggestion.proposal}`);
  }
  if (!report.complete) {
    undetermined.push(
      report.total === 0
        ? `No se analizó ningún requisito de ${report.source}: no hay nada comprobado que informar.`
        : `El documento ${report.source} no se analizó por completo: hay líneas con aspecto de requisito sin interpretar.`,
    );
  }

  const incompleteBecause: string[] = [];
  if (!report.complete) incompleteBecause.push(`La cobertura de ${report.source} está incompleta (ver undetermined).`);
  if (open.length > 0) {
    incompleteBecause.push(
      `${open.length} hallazgo(s) no traen una frase lista: falta un dato que solo puede aportar quien escribe el requisito. No los rellenes inventando: pregúntalo.`,
    );
  }
  if (report.total === 0) incompleteBecause.push('No había requisitos que analizar: no declares que el documento es conforme.');

  const missingPatterns = EARS_PATTERNS.filter((pattern) => (report.patterns[pattern] ?? 0) === 0);
  const allUbiquitous = report.conforming > 0 && report.patterns.ubiquitous === report.conforming;

  const findings = report.suggestions.slice(0, maxSuggestions).map((suggestion) => ({
    target: suggestion.target,
    code: suggestion.code,
    severity: suggestion.severity,
    problem: suggestion.problem,
    proposal: suggestion.proposal,
    why: suggestion.why,
    example: suggestion.example ?? null,
    /** Solo una propuesta aplicable es una frase real: las demás son preguntas. */
    applicable: isEarsProposalApplicable(suggestion),
  }));

  return {
    kind: 'ears-assistant-evidence-pack',
    source: report.source,
    status: report.complete && undetermined.length === 0 ? 'complete' : 'incomplete',
    complete: report.complete,
    total: report.total,
    conforming: report.conforming,
    requirements: report.statements ?? [],
    findings,
    findingsTotal: report.suggestions.length,
    findingsTruncated: Math.max(0, report.suggestions.length - findings.length),
    patterns: { ...report.patterns },
    patternGaps: {
      missing: missingPatterns,
      allUbiquitous,
      note: allUbiquitous
        ? 'Todos los requisitos conformes son ubicuos: no hay disparadores. Pregunta CUÁNDO ocurre cada comportamiento.'
        : missingPatterns.length > 0
          ? `Ningún requisito conforme usa: ${missingPatterns.join(', ')}.`
          : 'Los cinco patrones están representados.',
    },
    templates: EARS_ASSISTANT_TEMPLATES.map((template) => ({
      pattern: template.pattern,
      template: template.template,
      keyword: template.keyword,
      example: template.example,
      exampleSource: template.exampleSource,
      ...(template.example === null
        ? { exampleUnavailable: 'Ningún documento de este repositorio usa este patrón: no se inventa un ejemplo.' }
        : {}),
    })),
    rules: EARS_SUGGESTION_CATALOGUE.map((rule) => ({ ...rule })),
    codes: EARS_SUGGESTION_CATALOGUE.map((rule) => rule.code),
    undetermined,
    incompleteBecause,
    limit: EARS_LIMIT,
    noModelShipped:
      'Esta herramienta no embarca ningún modelo: el texto final lo escribe tu modelo anfitrión a partir de este paquete. Toda propuesta marcada como pregunta exige un dato que solo conoce quien escribe el requisito: no la rellenes inventando.',
  };
};

// ---------------------------------------------------------------------------------------------
// Salida humana
// ---------------------------------------------------------------------------------------------

/**
 * El informe en líneas de texto plano (sin color: el color es decisión del llamante). Con
 * `suggest: false` imprime el diagnóstico compacto; con `suggest: true` (por defecto) añade cada
 * propuesta con su porqué y su ejemplo.
 */
export const renderEarsReport = (report: EarsReport, options: { suggest?: boolean } = {}): string[] => {
  const suggest = options.suggest !== false;
  const lines: string[] = [];
  const errors = report.suggestions.filter((suggestion) => suggestion.severity === 'error').length;
  const warnings = report.suggestions.filter((suggestion) => suggestion.severity === 'warning').length;

  lines.push(`Asistente EARS — ${report.source}`);
  lines.push(
    `  ${report.total} requisito(s) · ${report.conforming} conforme(s) · ${report.suggestions.length} sugerencia(s) (${errors} error, ${warnings} aviso) · ${report.complete ? 'análisis completo' : 'INCOMPLETO'}`,
  );
  lines.push(
    `  patrones (solo conformes): ${EARS_PATTERNS.map((pattern) => `${pattern} ${report.patterns[pattern] ?? 0}`).join(' · ')}`,
  );
  lines.push('');

  if (report.suggestions.length === 0) {
    lines.push(
      report.total === 0
        ? '  No se encontró ningún requisito: no se ha comprobado nada.'
        : '  Sin sugerencias: todos los requisitos analizados son EARS.',
    );
  }

  report.suggestions.forEach((suggestion, index) => {
    lines.push(`  [${index + 1}] ${suggestion.severity} ${suggestion.code}`);
    lines.push(`      requisito: ${suggestion.target}`);
    lines.push(`      problema: ${suggestion.problem}`);
    if (suggest) {
      if (isEarsProposalApplicable(suggestion)) {
        for (const line of suggestion.proposal.split('\n')) lines.push(`      propuesta: ${line}`);
      } else {
        lines.push(`      propuesta: (pregunta, no una frase) ${suggestion.proposal}`);
      }
      lines.push(`      por qué: ${suggestion.why}`);
      if (suggestion.example) lines.push(`      ejemplo: ${suggestion.example}`);
    }
  });

  lines.push('');
  lines.push(`  ${report.detail}`);
  return lines;
};
