/**
 * El motor de estándares (W2): carga el catálogo de `.sdd/settings/standards/**` y ejecuta cada
 * estándar sobre un artefacto.
 *
 * Vive en `core/` porque es determinista y offline: no hay modelo, no hay red y no hay dependencia
 * nueva. El contrato de tipos está en `core/standardsTypes.ts` y NO se redefine aquí; este módulo es
 * su única implementación de referencia.
 *
 * ── Por qué un catálogo y no prosa ──────────────────────────────────────────────────────────────
 * `.sdd/settings/rules/*.md` son buena práctica que nada ejecuta. Una regla que no se puede ejecutar
 * se recuerda o se olvida. Este módulo convierte esas reglas en datos y las corre, de modo que una
 * violación sale con su posición y su remedio en vez de con un consejo.
 *
 * ── Rechazar por nombre, nunca ignorar ──────────────────────────────────────────────────────────
 * `loadStandards` valida TODOS los campos obligatorios y rechaza la entrada entera nombrando el
 * fichero y el campo que falta. No lanza sobre datos malos y no salta entradas en silencio: una
 * entrada ausente es visible en `rejected`.
 *
 * ── Advisoria hasta estar calibrada (REQ-STD-005) ───────────────────────────────────────────────
 * `blocking: true` NO basta. Solo una entrada que declare un corpus medido
 * (`calibrated.corpus`, no nulo) puede bloquear; el resto se comporta como advisoria aunque declare
 * `blocking: true`. Cuando hay corpus, `isBlocking` lo confirma y el hallazgo publica recall y fpr.
 *
 * ── Sin callejones sin salida (REQ-STD-004) ─────────────────────────────────────────────────────
 * `runStandard` no puede devolver un hallazgo sin remedio y sin pregunta. La construcción lo
 * garantiza: `makeFinding` adjunta los remedios de la entrada y, si no hay ninguno, convierte el
 * mensaje de la entrada en la pregunta por el dato que falta. Un `detect.kind: question` con
 * `remedy.grades` no vacío se rechaza al cargar, porque su contrato es preguntar, no prescribir.
 *
 * ── Detecciones soportadas ──────────────────────────────────────────────────────────────────────
 *   regex       — cada patrón es una fuente de expresión regular JavaScript; se compila con los
 *                 flags `im` (insensible a mayúsculas, `^`/`$` por línea) y se reporta el PRIMER
 *                 acierto con su línea, su columna y el texto casado.
 *   structural  — una regla con nombre, documentada en `STRUCTURAL_RULES`. `detect.patterns` nombra
 *                 la regla (`ears-issue:NO_SHALL`, `ears-template-order`, `ears-negative-coverage`,
 *                 `requirements-numeric-ids`, `requirements-acceptance-criteria`). Un nombre
 *                 desconocido se rechaza al cargar: una regla que no puede correr no puede pasar.
 *   heuristic   — una regla con nombre en `HEURISTIC_RULES` (`single-behaviour`): avisa, no decide.
 *   question    — la abstención explícita. `detect.patterns` son sondas del dato que la regla
 *                 necesita; si ninguna casa, la regla no puede inspeccionar y emite UNA pregunta con
 *                 el dato que falta y `remedies: []`, nunca un `ok` fabricado.
 *
 * Cuando una regla estructural o heurística no encuentra NADA que inspeccionar (ni un enunciado de
 * requisito, ni un encabezado), tampoco inventa un pase: emite la misma pregunta de inspección.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  StandardArtifact,
  StandardEntry,
  StandardFinding,
  StandardRemedy,
  StandardRunner,
  StandardSeverity,
} from './standardsTypes.js';
import {
  negativeRequirementGap,
  validateEarsRequirement,
  validateRequirements,
  type EarsIssueCode,
} from './ears.js';

/** Directorio del catálogo, relativo a la raíz del proyecto. */
export const STANDARDS_DIR = '.sdd/settings/standards';

export interface RejectedStandard {
  /** Ruta del fichero rechazado, relativa a `cwd`. Es el «nombre» del rechazo. */
  file: string;
  /** Motivo en una línea, en minúscula inicial, sin punto final y con backticks en los identificadores. */
  reason: string;
}

export interface LoadedStandards {
  entries: StandardEntry[];
  rejected: RejectedStandard[];
}

const CATEGORIES = ['requirements', 'design', 'tasks', 'steering', 'git', 'security', 'docs'] as const;
const SEVERITIES: readonly StandardSeverity[] = ['error', 'warning', 'info'];
const DETECTION_KINDS = ['regex', 'structural', 'heuristic', 'question'] as const;
const REMEDY_GRADES = ['machine-applicable', 'maybe-incorrect', 'needs-human'] as const;
const EARS_ISSUE_CODES: readonly EarsIssueCode[] = [
  'NO_SHALL',
  'NO_TEMPLATE_MATCH',
  'MULTIPLE_TEMPLATES',
  'COMPOUND_REQUIREMENT',
  'VAGUE_TERM',
  'MISSING_THEN',
  'EMPTY_RESPONSE',
];

/** Flags fijos de la detección `regex`; documentados aquí y en la cabecera del módulo. */
const REGEX_FLAGS = 'im';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Posiciones
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Línea (1-based) y columna (1-based) de un índice absoluto en el texto. */
const positionAt = (text: string, index: number): { line: number; column: number } => {
  const safe = Math.max(0, Math.min(index, text.length));
  const before = text.slice(0, safe);
  const line = before.split('\n').length;
  const lastBreak = before.lastIndexOf('\n');
  return { line, column: safe - lastBreak };
};

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Extracción de unidades inspeccionables
// ────────────────────────────────────────────────────────────────────────────────────────────────

interface Heading {
  level: number;
  text: string;
  line: number;
  column: number;
}

interface RequirementStatement {
  text: string;
  line: number;
  column: number;
}

const isFence = (line: string): boolean => /^\s*(?:```|~~~)/.test(line);

/** Encabezados markdown de nivel 1–6, ignorando los que viven dentro de un bloque de código. */
const extractHeadings = (text: string): Heading[] => {
  const headings: Heading[] = [];
  let inFence = false;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (isFence(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,6})\s+(.*\S)\s*$/.exec(raw);
    if (!match) continue;
    headings.push({
      level: match[1].length,
      text: match[2],
      line: i + 1,
      column: match[1].length + 2,
    });
  }
  return headings;
};

const STATEMENT_LABEL = /^\s*(?:\*\*)?(?:Statement|Requisito|Acceptance criterion|Criterio)(?:\*\*)?\s*:\s*/i;

/**
 * Enunciados de requisito: viñetas, puntos numerados y líneas con `shall` o con un disparador EARS
 * al principio. Se descartan encabezados, tablas y bloques de código; una línea de prosa que no
 * parece un requisito no se evalúa, para no convertir la detección en una fábrica de falsos positivos.
 */
const extractRequirementStatements = (text: string): RequirementStatement[] => {
  const statements: RequirementStatement[] = [];
  let inFence = false;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (isFence(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^\s*#{1,6}\s/.test(raw)) continue;
    if (/^\s*\|/.test(raw)) continue;
    const hadLabel = STATEMENT_LABEL.test(raw);
    const cleaned = raw
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
      .replace(STATEMENT_LABEL, '')
      .trim();
    if (cleaned.length === 0) continue;
    const looksLikeStatement =
      hadLabel || /\bshall\b/i.test(cleaned) || /^(?:WHEN|WHILE|WHERE|IF)\b/i.test(cleaned);
    if (!looksLikeStatement) continue;
    const found = raw.indexOf(cleaned);
    statements.push({ text: cleaned, line: i + 1, column: found >= 0 ? found + 1 : 1 });
  }
  return statements;
};

interface RequirementSection {
  heading: Heading;
  statements: RequirementStatement[];
}

/** Secciones cuyo encabezado (nivel ≥ 3) declara un identificador numérico: son los requisitos. */
const requirementSections = (text: string): RequirementSection[] => {
  const lines = text.split(/\r?\n/);
  const headings = extractHeadings(text);
  const byLine = new Map(headings.map((h) => [h.line, h]));
  const sections: RequirementSection[] = [];
  for (const heading of headings) {
    if (heading.level < 3 || !/\d/.test(heading.text)) continue;
    const bodyLines: string[] = [];
    for (let i = heading.line; i < lines.length; i += 1) {
      const next = byLine.get(i + 1);
      if (next && next.level <= heading.level) break;
      bodyLines.push(lines[i]);
    }
    sections.push({ heading, statements: extractRequirementStatements(bodyLines.join('\n')) });
  }
  return sections;
};

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Reglas con nombre
// ────────────────────────────────────────────────────────────────────────────────────────────────

interface RuleHit {
  line: number;
  column: number;
  span?: string;
  /** Detalle específico que se añade al mensaje de la entrada. */
  detail?: string;
  /** Pregunta por el dato que falta cuando la regla no puede inspeccionar. */
  question?: string;
}

type NamedRule = (artifact: StandardArtifact) => RuleHit[];

const cannotInspect = (question: string): RuleHit => ({ line: 1, column: 1, question });

const lower = (s: string): string => s.toLowerCase();

/** `structural:ears-issue:<CODE>` — delega en `ears.ts`, que es la implementación autoritativa. */
const earsIssueRule = (code: EarsIssueCode): NamedRule => (artifact) => {
  const statements = extractRequirementStatements(artifact.text);
  if (statements.length === 0) {
    return [cannotInspect('no se localizó ningún enunciado de requisito: ¿este artefacto es la especificación que se quiere comprobar?')];
  }
  const hits: RuleHit[] = [];
  for (const statement of statements) {
    const verdict = validateEarsRequirement(statement.text);
    for (const issue of verdict.issues) {
      if (issue.code !== code) continue;
      hits.push({ line: statement.line, column: statement.column, span: statement.text, detail: issue.message });
    }
  }
  return hits;
};

/**
 * `structural:ears-template-order` — la plantilla EARS empieza por su disparador. Un disparador
 * después de `shall` es la plantilla escrita en orden inverso; no lo detecta `ears.ts` porque su
 * clasificación mira el principio del enunciado.
 */
const earsTemplateOrderRule: NamedRule = (artifact) => {
  const statements = extractRequirementStatements(artifact.text);
  if (statements.length === 0) {
    return [cannotInspect('no se localizó ningún enunciado de requisito donde comprobar el orden de la plantilla')];
  }
  const hits: RuleHit[] = [];
  for (const statement of statements) {
    const shall = lower(statement.text).search(/\bshall\b/);
    if (shall < 0) continue;
    const before = statement.text.slice(0, shall);
    const after = statement.text.slice(shall);
    const triggerBefore = /(?:^|[,;])\s*(?:WHEN|WHILE|WHERE|IF)\b/i.test(before);
    const late = /\b(?:WHEN|WHILE|WHERE|IF)\b/i.exec(after);
    if (triggerBefore || !late) continue;
    hits.push({
      line: statement.line,
      column: statement.column + shall + late.index,
      span: late[0],
      detail: 'la cláusula de disparo debe preceder a `shall`: exactamente una plantilla por requisito',
    });
  }
  return hits;
};

/**
 * `structural:ears-negative-coverage` — un documento sin ningún `IF ... THEN` no declara
 * comportamiento no deseado. Delega en `negativeRequirementGap` de `ears.ts`.
 */
const earsNegativeCoverageRule: NamedRule = (artifact) => {
  const statements = extractRequirementStatements(artifact.text);
  if (statements.length === 0) {
    return [cannotInspect('no se localizó ningún enunciado de requisito del que derivar la cobertura de comportamiento no deseado')];
  }
  const gap = negativeRequirementGap(validateRequirements(statements.map((s) => s.text)));
  return gap ? [{ line: 1, column: 1, detail: gap }] : [];
};

/**
 * `structural:requirements-numeric-ids` — todo encabezado de requisito (nivel ≥ 3) declara un
 * identificador numérico. Los encabezados de nivel 1–2 son estructurales del documento, no
 * requisitos, y no se revisan.
 */
const requirementsNumericIdsRule: NamedRule = (artifact) => {
  const headings = extractHeadings(artifact.text).filter((h) => h.level >= 3);
  if (headings.length === 0) {
    return [cannotInspect('no se localizó ningún encabezado de nivel 3 o superior que comprobar como requisito')];
  }
  return headings
    .filter((h) => !/\d/.test(h.text))
    .map((h) => ({
      line: h.line,
      column: h.column,
      span: h.text,
      detail: 'el encabezado no declara un identificador numérico',
    }));
};

/**
 * `structural:ears-trigger-casing` — la palabra clave EARS se escribe en su forma canónica en
 * mayúsculas (`WHEN`, `WHILE`, `WHERE`, `IF`). Es una regla ortográfica: el cambio es seguro y por
 * eso el remedio es `machine-applicable`.
 */
const earsTriggerCasingRule: NamedRule = (artifact) => {
  const statements = extractRequirementStatements(artifact.text);
  if (statements.length === 0) {
    return [cannotInspect('no se localizó ningún enunciado de requisito donde comprobar la forma de la palabra clave')];
  }
  const hits: RuleHit[] = [];
  for (const statement of statements) {
    const match = /^(when|while|where|if)\b/.exec(statement.text);
    if (match === null) continue;
    hits.push({
      line: statement.line,
      column: statement.column + match.index + match[0].length - match[1].length,
      span: match[1],
      detail: 'la palabra clave EARS se escribe en mayúsculas: `WHEN`, `WHILE`, `WHERE`, `IF`',
    });
  }
  return hits;
};

/** `structural:requirements-acceptance-criteria` — cada requisito tiene al menos un criterio EARS. */
const requirementsAcceptanceCriteriaRule: NamedRule = (artifact) => {
  const sections = requirementSections(artifact.text);
  if (sections.length === 0) {
    return [cannotInspect('no se localizó ninguna sección de requisito con identificador numérico que comprobar')];
  }
  return sections
    .filter((section) => !section.statements.some((s) => validateEarsRequirement(s.text).conforms))
    .map((section) => ({
      line: section.heading.line,
      column: section.heading.column,
      span: section.heading.text,
      detail: 'la sección no contiene ningún criterio de aceptación conforme a EARS',
    }));
};

/** Reglas estructurales con nombre, direccionables desde `detect.patterns`. */
const STRUCTURAL_RULES: Record<string, NamedRule> = {
  'ears-template-order': earsTemplateOrderRule,
  'ears-trigger-casing': earsTriggerCasingRule,
  'ears-negative-coverage': earsNegativeCoverageRule,
  'requirements-numeric-ids': requirementsNumericIdsRule,
  'requirements-acceptance-criteria': requirementsAcceptanceCriteriaRule,
};

/**
 * `heuristic:single-behaviour` — un enunciado con más de una conjunción en la respuesta, o muy
 * largo, probablemente describe varios comportamientos. Es una heurística: avisa con un remedio
 * `maybe-incorrect`, no decide.
 */
const singleBehaviourRule: NamedRule = (artifact) => {
  const statements = extractRequirementStatements(artifact.text);
  if (statements.length === 0) {
    return [cannotInspect('no se localizó ningún enunciado de requisito del que medir la singularidad')];
  }
  const hits: RuleHit[] = [];
  for (const statement of statements) {
    const shall = lower(statement.text).search(/\bshall\b/);
    if (shall < 0) continue;
    const response = statement.text.slice(shall + 5);
    const conjunctions = (response.match(/\b(?:and|or|y|o)\b/gi) ?? []).length;
    const words = response.trim().split(/\s+/).filter(Boolean).length;
    if (conjunctions <= 1 && words <= 45) continue;
    hits.push({
      line: statement.line,
      column: statement.column,
      span: statement.text,
      detail: `la respuesta encadena ${conjunctions} conjunción(es) y ${words} palabra(s): probablemente son varios comportamientos`,
    });
  }
  return hits;
};

/** Reglas heurísticas con nombre. */
const HEURISTIC_RULES: Record<string, NamedRule> = {
  'single-behaviour': singleBehaviourRule,
};

/** Nombres de regla estructural aceptados por el cargador (para validar y para los tests). */
export const STRUCTURAL_RULE_NAMES: readonly string[] = [
  ...EARS_ISSUE_CODES.map((code) => `ears-issue:${code}`),
  ...Object.keys(STRUCTURAL_RULES),
];

/** Nombres de regla heurística aceptados por el cargador. */
export const HEURISTIC_RULE_NAMES: readonly string[] = Object.keys(HEURISTIC_RULES);

const structuralRuleFor = (name: string): NamedRule | undefined => {
  if (name.startsWith('ears-issue:')) {
    const code = name.slice('ears-issue:'.length) as EarsIssueCode;
    if ((EARS_ISSUE_CODES as readonly string[]).includes(code)) return earsIssueRule(code);
    return undefined;
  }
  return STRUCTURAL_RULES[name];
};

const heuristicRuleFor = (name: string): NamedRule | undefined => HEURISTIC_RULES[name];

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Validación del catálogo (rechazo por nombre)
// ────────────────────────────────────────────────────────────────────────────────────────────────

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

interface ValidationResult {
  entry?: StandardEntry;
  reason?: string;
}

const validateEntry = (raw: unknown): ValidationResult => {
  if (!isPlainObject(raw)) return { reason: 'la entrada no es un objeto JSON' };

  const { id, title, category, severity, blocking, appliesTo, standard, source, detect, message, remedy, evidence, calibrated } =
    raw as Record<string, unknown>;

  if (!nonEmptyString(id)) return { reason: 'falta el campo obligatorio `id`' };
  if (!nonEmptyString(title)) return { reason: `falta el campo obligatorio \`title\` en \`${id}\`` };
  if (!nonEmptyString(category) || !(CATEGORIES as readonly string[]).includes(category)) {
    return { reason: `\`category\` debe ser uno de ${CATEGORIES.map((c) => `\`${c}\``).join(', ')} en \`${id}\`` };
  }
  if (!nonEmptyString(severity) || !SEVERITIES.includes(severity as StandardSeverity)) {
    return { reason: `\`severity\` debe ser uno de \`error\`, \`warning\`, \`info\` en \`${id}\`` };
  }
  if (typeof blocking !== 'boolean') return { reason: `\`blocking\` debe ser booleano en \`${id}\`` };
  if (!Array.isArray(appliesTo) || appliesTo.length === 0 || !appliesTo.every(nonEmptyString)) {
    return { reason: `\`appliesTo\` debe ser una lista no vacía de patrones en \`${id}\`` };
  }
  if (!nonEmptyString(standard)) return { reason: `falta el campo obligatorio \`standard\` en \`${id}\`` };
  if (!nonEmptyString(source)) return { reason: `falta el campo obligatorio \`source\` en \`${id}\`` };

  if (!isPlainObject(detect)) return { reason: `falta el campo obligatorio \`detect\` en \`${id}\`` };
  const kind = detect.kind;
  if (!nonEmptyString(kind) || !(DETECTION_KINDS as readonly string[]).includes(kind)) {
    return { reason: `\`detect.kind\` debe ser uno de ${DETECTION_KINDS.map((k) => `\`${k}\``).join(', ')} en \`${id}\`` };
  }
  const patterns = detect.patterns;
  if (patterns !== undefined && (!Array.isArray(patterns) || !patterns.every((p) => typeof p === 'string' && p.length > 0))) {
    return { reason: `\`detect.patterns\` debe ser una lista de cadenas no vacías en \`${id}\`` };
  }
  const patternList = (patterns as string[] | undefined) ?? [];

  if (kind === 'regex') {
    if (patternList.length === 0) {
      return { reason: `\`detect.patterns\` está vacío: una entrada \`regex\` sin patrones no puede inspeccionar nada en \`${id}\`` };
    }
    for (const pattern of patternList) {
      try {
        new RegExp(pattern, REGEX_FLAGS);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { reason: `el patrón ${JSON.stringify(pattern)} no compila en \`${id}\`: ${detail}` };
      }
    }
  }
  if (kind === 'structural' || kind === 'heuristic') {
    if (patternList.length === 0) {
      return { reason: `\`detect.patterns\` está vacío: una entrada \`${kind}\` sin regla con nombre no puede inspeccionar nada en \`${id}\`` };
    }
    const known = kind === 'structural' ? STRUCTURAL_RULE_NAMES : HEURISTIC_RULE_NAMES;
    for (const pattern of patternList) {
      if (!known.includes(pattern)) {
        return { reason: `\`detect.patterns\` nombra una regla ${kind === 'structural' ? 'estructural' : 'heurística'} desconocida en \`${id}\`: \`${pattern}\`` };
      }
    }
  }
  if (kind === 'question' && patternList.length > 0) {
    for (const pattern of patternList) {
      try {
        new RegExp(pattern, REGEX_FLAGS);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { reason: `la sonda ${JSON.stringify(pattern)} no compila en \`${id}\`: ${detail}` };
      }
    }
  }

  if (!nonEmptyString(message)) return { reason: `falta el campo obligatorio \`message\` en \`${id}\`` };

  if (!isPlainObject(remedy)) return { reason: `falta el campo obligatorio \`remedy\` en \`${id}\`` };
  if (typeof remedy.autoFixable !== 'boolean') return { reason: `\`remedy.autoFixable\` debe ser booleano en \`${id}\`` };
  if (!Array.isArray(remedy.grades)) return { reason: `\`remedy.grades\` debe ser una lista en \`${id}\`` };
  const grades: StandardRemedy[] = [];
  for (const item of remedy.grades) {
    if (!isPlainObject(item)) return { reason: `cada remedio de \`remedy.grades\` debe ser un objeto en \`${id}\`` };
    if (!nonEmptyString(item.grade) || !(REMEDY_GRADES as readonly string[]).includes(item.grade)) {
      return { reason: `\`remedy.grades[].grade\` debe ser uno de ${REMEDY_GRADES.map((g) => `\`${g}\``).join(', ')} en \`${id}\`` };
    }
    if (!nonEmptyString(item.text)) return { reason: `\`remedy.grades[].text\` no puede estar vacío en \`${id}\`` };
    if (item.note !== undefined && !nonEmptyString(item.note)) {
      return { reason: `\`remedy.grades[].note\` debe ser una cadena no vacía cuando se declara en \`${id}\`` };
    }
    grades.push({
      grade: item.grade as StandardRemedy['grade'],
      text: item.text,
      ...(item.note === undefined ? {} : { note: item.note }),
    });
  }
  if (kind === 'question' && grades.length > 0) {
    return { reason: `\`remedy.grades\` debe estar vacío cuando \`detect.kind\` es \`question\` en \`${id}\`: esa entrada pregunta, no prescribe` };
  }
  if (kind !== 'question' && grades.length === 0) {
    return { reason: `\`remedy.grades\` está vacío en \`${id}\`: una entrada que no sea \`question\` debe ofrecer al menos un remedio` };
  }
  if (remedy.autoFixable === true && !grades.some((g) => g.grade === 'machine-applicable')) {
    return { reason: `\`remedy.autoFixable\` es \`true\` pero ningún remedio es \`machine-applicable\` en \`${id}\`` };
  }

  if (!nonEmptyString(evidence)) return { reason: `falta el campo obligatorio \`evidence\` en \`${id}\`` };

  if (!isPlainObject(calibrated)) return { reason: `falta el campo obligatorio \`calibrated\` en \`${id}\`` };
  const corpus = calibrated.corpus;
  const recall = calibrated.recall;
  const fpr = calibrated.fpr;
  if (corpus !== null && !nonEmptyString(corpus)) {
    return { reason: `\`calibrated.corpus\` debe ser una cadena no vacía o \`null\` en \`${id}\`` };
  }
  if (nonEmptyString(corpus)) {
    for (const [field, value] of [['recall', recall], ['fpr', fpr]] as const) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        return { reason: `\`calibrated.${field}\` debe ser un número entre 0 y 1 cuando se declara \`calibrated.corpus\` en \`${id}\`` };
      }
    }
  } else if (recall !== null || fpr !== null) {
    return { reason: `\`calibrated.recall\` y \`calibrated.fpr\` deben ser \`null\` mientras no haya corpus en \`${id}\`` };
  }

  return {
    entry: {
      id,
      title,
      category,
      severity: severity as StandardSeverity,
      blocking,
      appliesTo: appliesTo as string[],
      standard,
      source,
      detect: {
        kind: kind as StandardEntry['detect']['kind'],
        ...(patterns === undefined ? {} : { patterns: patternList }),
      },
      message,
      remedy: { autoFixable: remedy.autoFixable, grades },
      evidence,
      calibrated: {
        corpus: nonEmptyString(corpus) ? corpus : null,
        recall: nonEmptyString(corpus) ? (recall as number) : null,
        fpr: nonEmptyString(corpus) ? (fpr as number) : null,
      },
    },
  };
};

const listJsonFiles = async (root: string): Promise<string[]> => {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const dirents = await readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      const abs = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (dirent.isFile() && dirent.name.endsWith('.json')) found.push(abs);
    }
  };
  await walk(root);
  return found.sort();
};

/**
 * Lee y valida el catálogo completo. Nunca lanza por datos malos: un fichero ilegible o una entrada
 * inválida se devuelven en `rejected`, nombrados por su ruta, y el resto del catálogo sigue vivo.
 * Un directorio ausente es un catálogo vacío, no un error: no hay nada declarado que rechazar.
 */
export const loadStandards = async (cwd: string): Promise<LoadedStandards> => {
  const root = path.resolve(cwd, STANDARDS_DIR);
  const entries: StandardEntry[] = [];
  const rejected: RejectedStandard[] = [];
  const seen = new Map<string, string>();

  let files: string[];
  try {
    files = await listJsonFiles(root);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { entries, rejected };
    const detail = error instanceof Error ? error.message : String(error);
    return { entries, rejected: [{ file: STANDARDS_DIR, reason: `no se pudo leer el catálogo: ${detail}` }] };
  }

  for (const abs of files) {
    const rel = path.relative(cwd, abs).split(path.sep).join('/');
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(abs, 'utf8'));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      rejected.push({ file: rel, reason: `JSON inválido: ${detail}` });
      continue;
    }

    const candidates: { name: string; value: unknown }[] = Array.isArray(parsed)
      ? parsed.map((value, index) => ({
          name: nonEmptyString((value as { id?: unknown })?.id) ? `${rel}#${(value as { id: string }).id}` : `${rel}#${index}`,
          value,
        }))
      : [{ name: rel, value: parsed }];

    for (const candidate of candidates) {
      const result = validateEntry(candidate.value);
      if (result.entry === undefined) {
        rejected.push({ file: candidate.name, reason: result.reason ?? 'entrada inválida' });
        continue;
      }
      const previous = seen.get(result.entry.id);
      if (previous !== undefined) {
        rejected.push({ file: candidate.name, reason: `\`id\` duplicado: \`${result.entry.id}\` ya lo declara \`${previous}\`` });
        continue;
      }
      seen.set(result.entry.id, candidate.name);
      entries.push(result.entry);
    }
  }

  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { entries, rejected };
};

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Construcción de hallazgos: el invariante «remedio o pregunta» se garantiza aquí
// ────────────────────────────────────────────────────────────────────────────────────────────────

const stripTrailingPeriod = (value: string): string => value.replace(/[.。]\s*$/, '').trim();

/** Estilo de la casa: un diagnóstico empieza en minúscula (salvo que empiece por un identificador). */
const lowercaseFirst = (value: string): string =>
  value.length === 0 ? value : `${value.charAt(0).toLowerCase()}${value.slice(1)}`;

/** Añade la calibración al mensaje cuando la entrada declara un corpus medido (REQ-STD-005). */
const withCalibration = (entry: StandardEntry, message: string): string => {
  const corpus = entry.calibrated.corpus;
  if (typeof corpus !== 'string' || corpus.length === 0) return message;
  const recall = entry.calibrated.recall;
  const fpr = entry.calibrated.fpr;
  const measured = `recall ${typeof recall === 'number' ? recall : 'no declarado'}, fpr ${typeof fpr === 'number' ? fpr : 'no declarado'}`;
  return `${message} (calibrado sobre \`${corpus}\`: ${measured})`;
};

/** ¿Puede esta entrada detener un gate? Solo con corpus medido (REQ-STD-005). */
export const isBlocking = (entry: StandardEntry): boolean =>
  entry.blocking === true && typeof entry.calibrated.corpus === 'string' && entry.calibrated.corpus.trim().length > 0;

const makeFinding = (entry: StandardEntry, artifact: StandardArtifact, hit: RuleHit): StandardFinding => {
  const isQuestion = entry.detect.kind === 'question';
  const remedies: StandardRemedy[] = isQuestion ? [] : entry.remedy.grades;
  // El detalle de la regla es el diagnóstico concreto (qué cláusula, qué código EARS); el mensaje de
  // la entrada es el enunciado general del estándar y solo se usa cuando la regla no añade detalle.
  const base = hit.detail ?? entry.message;
  const message = withCalibration(entry, lowercaseFirst(stripTrailingPeriod(base)));
  const question = hit.question ?? (remedies.length === 0 ? entry.message : undefined);
  return {
    standardId: entry.id,
    severity: entry.severity,
    file: artifact.file,
    line: hit.line,
    column: hit.column,
    ...(hit.span === undefined ? {} : { span: hit.span }),
    message,
    remedies,
    ...(question === undefined ? {} : { question }),
  };
};

// ────────────────────────────────────────────────────────────────────────────────────────────────
// El ejecutor
// ────────────────────────────────────────────────────────────────────────────────────────────────

const runRegex = (entry: StandardEntry, artifact: StandardArtifact): StandardFinding[] => {
  if (artifact.text.trim().length === 0) {
    return [makeFinding(entry, artifact, { line: 1, column: 1, question: `no hay texto que inspeccionar en \`${artifact.file}\`` })];
  }
  const findings: StandardFinding[] = [];
  for (const pattern of entry.detect.patterns ?? []) {
    const match = new RegExp(pattern, REGEX_FLAGS).exec(artifact.text);
    if (match === null) continue;
    const { line, column } = positionAt(artifact.text, match.index);
    findings.push(makeFinding(entry, artifact, { line, column, span: match[0] }));
  }
  return findings;
};

const runNamed = (
  entry: StandardEntry,
  artifact: StandardArtifact,
  resolve: (name: string) => NamedRule | undefined,
): StandardFinding[] => {
  const findings: StandardFinding[] = [];
  for (const name of entry.detect.patterns ?? []) {
    const rule = resolve(name);
    if (rule === undefined) continue; // el cargador ya lo rechazó; defensa por si se construye a mano
    for (const hit of rule(artifact)) findings.push(makeFinding(entry, artifact, hit));
  }
  return findings;
};

const runQuestion = (entry: StandardEntry, artifact: StandardArtifact): StandardFinding[] => {
  const probes = entry.detect.patterns ?? [];
  const datumFound = probes.some((pattern) => new RegExp(pattern, REGEX_FLAGS).test(artifact.text));
  if (datumFound) return [];
  return [
    makeFinding(entry, artifact, {
      line: 1,
      column: 1,
      detail: `${entry.id} no puede decidir sin el dato que falta`,
      question: entry.message,
    }),
  ];
};

/**
 * Ejecuta un estándar sobre un artefacto. Nunca lanza y nunca devuelve un hallazgo sin remedio ni
 * pregunta: si la entrada no ofrece remedios, el hallazgo pregunta por el dato que falta.
 */
export const runStandard: StandardRunner = (entry, artifact) => {
  try {
    switch (entry.detect.kind) {
      case 'regex':
        return runRegex(entry, artifact);
      case 'structural':
        return runNamed(entry, artifact, structuralRuleFor);
      case 'heuristic':
        return runNamed(entry, artifact, heuristicRuleFor);
      case 'question':
        return runQuestion(entry, artifact);
      default:
        return [];
    }
  } catch {
    // Un estándar que revienta no puede tumbar el informe, pero tampoco puede fingir un pase: emite
    // la abstención explícita por el dato que no pudo inspeccionar.
    return [
      makeFinding(entry, artifact, {
        line: 1,
        column: 1,
        question: `el estándar \`${entry.id}\` no pudo inspeccionar \`${artifact.file}\``,
      }),
    ];
  }
};

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Aplicabilidad y descubrimiento de artefactos
// ────────────────────────────────────────────────────────────────────────────────────────────────

const globToRegExp = (glob: string): RegExp => {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        source += '.*';
        i += 1;
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    source += /[\\^$.|+()[\]{}]/.test(char) ? `\\${char}` : char;
  }
  return new RegExp(`^${source}$`);
};

const matchesPattern = (pattern: string, file: string): boolean => {
  const normalized = file.split(path.sep).join('/');
  if (!pattern.includes('/')) return globToRegExp(pattern).test(path.posix.basename(normalized));
  return globToRegExp(pattern).test(normalized);
};

/** ¿Aplica la entrada a este fichero? Por nombre base o por glob con `/`. */
export const appliesToArtifact = (entry: StandardEntry, file: string): boolean =>
  entry.appliesTo.some((pattern) => matchesPattern(pattern, file));

export interface DiscoveredArtifact {
  file: string;
  text: string;
}

const SKIPPED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.cache', 'vendor']);

export interface DiscoverOptions {
  /** Tope de ficheros inspeccionados; evita recorrer un monorepo entero por accidente. */
  maxFiles?: number;
}

/**
 * Descubre los artefactos que el catálogo declara, aplicando `appliesTo`. El recorrido es
 * determinista (orden alfabético) y acotado (`maxFiles`), y no lanza: un fichero ilegible se omite
 * del resultado pero su entrada correspondiente se reportará como no inspeccionada por el llamante.
 */
export const discoverArtifacts = async (
  cwd: string,
  entries: readonly StandardEntry[],
  options: DiscoverOptions = {},
): Promise<DiscoveredArtifact[]> => {
  const maxFiles = options.maxFiles ?? 200;
  const patterns = new Set<string>();
  for (const entry of entries) for (const pattern of entry.appliesTo) patterns.add(pattern);
  if (patterns.size === 0) return [];

  const found: DiscoveredArtifact[] = [];
  const seen = new Set<string>();
  let visited = 0;

  const walk = async (dir: string): Promise<void> => {
    if (found.length >= maxFiles || visited > 20000) return;
    let dirents;
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const dirent of dirents) {
      if (found.length >= maxFiles) return;
      const abs = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        if (SKIPPED_DIRS.has(dirent.name)) continue;
        await walk(abs);
        continue;
      }
      if (!dirent.isFile()) continue;
      visited += 1;
      const rel = path.relative(cwd, abs).split(path.sep).join('/');
      if (![...patterns].some((pattern) => matchesPattern(pattern, rel))) continue;
      if (seen.has(rel)) continue;
      try {
        const text = await readFile(abs, 'utf8');
        seen.add(rel);
        found.push({ file: rel, text });
      } catch {
        // ilegible: no entra en el conjunto inspeccionable
      }
    }
  };

  await walk(cwd);
  found.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return found;
};
