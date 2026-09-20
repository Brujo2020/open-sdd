/**
 * `celebrate` — el momento verde, y lo que hace falta para merecerlo.
 *
 * El producto ya sabe decir «no» de muchas formas (EARS, pivote constitucional, gates, trinquete).
 * Lo que no tenía era un «sí» visible: cuando una feature entera valida, el reporte se ve igual que
 * un reporte a medias. Este módulo produce ese momento — y su regla primera es la que le da valor:
 * **NO HAY CELEBRACIÓN SIN LAS TRES VERDADES A LA VEZ.**
 *
 * ── Las tres verdades (y por qué las tres) ──────────────────────────────────────────────────────
 *  1. REQUISITOS EARS conformes   `ears.errors === 0` y `ears.conforming === ears.total`.
 *  2. PIVOTE constitucional       `pivot.evaluated === true`, `pivot.errors === 0`.
 *  3. GATES en verde              `gates.failed.length === 0`.
 * Un veredicto que no se pudo establecer (sin requisitos, pivote sin evaluar, sin resultado de
 * gates, o cualquier sección marcada `notChecked`/`evaluated: false`) NO se celebra y NO se
 * convierte en un «plain» amable: se **rechaza** (`refused`) nombrando el dato que falta. Celebrar
 * un aprobado no comprobado es exactamente la mentira que este proyecto existe para eliminar.
 *
 * Precedencia deliberada: primero se busca lo que FALTA (refused) y solo después lo que FALLA
 * (plain). Si los requisitos fallan y además el pivote no se evaluó, el veredicto es `refused`: el
 * problema mayor es que no hay veredicto, no que un número sea bajo.
 *
 * ── A nivel de feature, no de fichero ───────────────────────────────────────────────────────────
 * El momento que merece animación es una FEATURE validando entera (`judgeFeatureCelebration`):
 * todos sus requisitos en forma, su spec alineada con la constitución en vigor y sus gates en
 * verde. `judgeCelebration` queda para el caso por comprobación; ambos comparten el mismo núcleo,
 * así que no pueden divergir.
 *
 * ── La gamificación con sustancia: la racha ────────────────────────────────────────────────────
 * `racha: N cambios seguidos sin bajar la adhesión`. N lo aporta el llamador — el trinquete
 * (`ratchet.ts`) ya sabe si la adhesión bajó, y volver a deducirlo aquí sería una segunda verdad.
 * Sin N no se imprime racha: una racha vacía es decoración. Los logros (`deriveAchievements`) se
 * derivan de eventos realmente registrados en el libro (`.sdd/state/celebrations.json`); si no hay
 * evento, no hay logro. Sin puntos, sin insignias por nada.
 *
 * ── El libro ────────────────────────────────────────────────────────────────────────────────────
 * Una validación real se apunta UNA vez en `.sdd/state/celebrations.json`, con escritura atómica
 * (tmp + rename, el mismo patrón que el trinquete). Un libro ilegible NO revienta ni se completa a
 * mano: se avisa y se empieza uno nuevo con la entrada real. Nunca un rechazo deja huella.
 *
 * ── Animación ───────────────────────────────────────────────────────────────────────────────────
 * Solo en TTY y acotada: 10 fotogramas × 60 ms = 600 ms (< 700). Cada fotograma es una función pura
 * del índice (`renderCelebrationFrame`), así que se prueba sin relojes. La ÚLTIMA línea que recibe
 * el llamador es SIEMPRE el resumen estático legible, de modo que un log capturado durante una
 * animación termina con una línea que se puede leer. Sin dependencias: solo caracteres de caja y
 * códigos ANSI crudos, y todo degrada a texto plano.
 *
 * ── Límites honestos ────────────────────────────────────────────────────────────────────────────
 * Verde significa «las comprobaciones que corrieron dijeron que sí», NO «el software es bueno». Una
 * comprobación que no corrió no se celebra: se rechaza.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SddPhase } from './sddScore.js';

// ── Paleta mínima (sin dependencias) ────────────────────────────────────────────────────────────

const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const RED = '\u001b[31m';
const RESET = '\u001b[39m';

// ── Forma de los tres veredictos ────────────────────────────────────────────────────────────────

/** Requisitos en forma EARS. `evaluated: false` es `notChecked`: no se celebra jamás. */
export interface EarsSnapshot {
  conforming: number;
  total: number;
  errors: number;
  /** `false` ⇒ la comprobación no se ejecutó (notChecked). Por defecto se asume ejecutada. */
  evaluated?: boolean;
}

/** Pivote constitucional: cuánta autoridad declarada resuelve hoy la spec. */
export interface PivotSnapshot {
  /** 0..1, como en `ratchet.ts` y el pivote. */
  alignment: number;
  errors: number;
  evaluated: boolean;
}

/** Cadena de gates. `failed` vacío con `passed === total` es el único verde válido. */
export interface GatesSnapshot {
  passed: number;
  total: number;
  failed: string[];
  /** `false` ⇒ la cadena no corrió (notChecked). Por defecto se asume ejecutada. */
  evaluated?: boolean;
}

export interface ScoreSnapshot {
  total: number;
  phase: SddPhase;
}

/**
 * Las tres comprobaciones (más contexto opcional). Todo lo opcional se OMITE si falta; nada se
 * inventa. `streak.rises` lo aporta el trinquete, no este módulo.
 */
export interface ValidationSnapshot {
  ears: EarsSnapshot;
  pivot: PivotSnapshot;
  gates: GatesSnapshot;
  score?: ScoreSnapshot;
  /** Cambios consecutivos sin que la adhesión bajara, según el trinquete. */
  streak?: number;
}

export type CelebrationVerdict = 'celebrate' | 'plain' | 'refused';

export interface CelebrationOptions {
  /** `false` fuerza el bloque estático. Por defecto `true` (animar solo si el resto lo permite). */
  anim?: boolean;
  /** TTY real. Por defecto `process.stdout.isTTY === true`. */
  isTty?: boolean;
  /** Salida de una línea (convención del repo para `--quiet`). */
  quiet?: boolean;
  /** Desactiva color (equivalente a `--no-color`). */
  noColor?: boolean;
  /** Ruta JSON: nunca se colorea. */
  json?: boolean;
  /** Entorno; en tests se inyecta. Por defecto `process.env`. */
  env?: Record<string, string | undefined>;
}

export interface CelebrationReport {
  verdict: CelebrationVerdict;
  /** Por qué ese veredicto, en una línea. */
  reason: string;
  /**
   * Lo que un llamador escribe. Con animación: `[...frames, ...staticLines]`. Sin animación:
   * `staticLines`. En `quiet`/`json`: solo la última línea (el resumen), sin decoración.
   * La última línea es SIEMPRE el resumen estático para un veredicto `celebrate`.
   */
  lines: string[];
  /** Fotogramas de animación; `[]` siempre que no se anime. */
  frames: string[];
  /** El bloque legible estático completo (su última línea es el resumen). */
  staticLines: string[];
}

// ── Validación de forma (nada se asume) ─────────────────────────────────────────────────────────

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isPhase = (value: unknown): value is SddPhase => value === 1 || value === 2 || value === 3;

const missingEars = (ears: EarsSnapshot | null | undefined): string | null => {
  if (!ears || typeof ears !== 'object') return 'no hay requisitos medidos (EARS no corrió)';
  if (ears.evaluated === false) return 'los requisitos están sin comprobar (EARS notChecked)';
  if (!isFiniteNumber(ears.conforming) || !isFiniteNumber(ears.total) || !isFiniteNumber(ears.errors)) {
    return 'los requisitos llegaron con números desconocidos (EARS)';
  }
  if (ears.total <= 0) return 'no hay ningún requisito que comprobar (0 requisitos)';
  return null;
};

const missingPivot = (pivot: PivotSnapshot | null | undefined): string | null => {
  if (!pivot || typeof pivot !== 'object') return 'el pivote constitucional no se midió';
  if (pivot.evaluated !== true) return 'el pivote constitucional no se evaluó (evaluated ≠ true)';
  if (!isFiniteNumber(pivot.alignment) || !isFiniteNumber(pivot.errors)) {
    return 'el pivote constitucional llegó con números desconocidos';
  }
  return null;
};

const missingGates = (gates: GatesSnapshot | null | undefined): string | null => {
  if (!gates || typeof gates !== 'object') return 'no hay resultado de gates';
  if (gates.evaluated === false) return 'los gates están sin comprobar (notChecked)';
  if (!Array.isArray(gates.failed) || !isFiniteNumber(gates.passed) || !isFiniteNumber(gates.total)) {
    return 'los gates llegaron con forma desconocida';
  }
  if (gates.total <= 0) return 'no se ejecutó ningún gate (0 gates)';
  return null;
};

const percent = (alignment: number): string => `${Math.round(alignment * 100)}%`;

const gateList = (failed: readonly string[]): string =>
  failed.length === 1 ? `el gate ${failed[0]} no pasa` : `los gates ${failed.join(', ')} no pasan`;

// ── El núcleo del veredicto ─────────────────────────────────────────────────────────────────────

interface JudgeParts {
  ears: EarsSnapshot | null | undefined;
  pivot: PivotSnapshot | null | undefined;
  gates: GatesSnapshot | null | undefined;
  score?: ScoreSnapshot;
  streak?: number;
}

interface JudgeVerdict {
  verdict: CelebrationVerdict;
  reason: string;
  detail: { ears: EarsSnapshot; pivot: PivotSnapshot; gates: GatesSnapshot; score?: ScoreSnapshot; streak?: number } | null;
}

/**
 * Decide el veredicto. Puro: no escribe, no colorea, no anima. La precedencia es refused > plain >
 * celebrate porque un dato ausente es peor que un dato malo: sin dato no hay veredicto que dar.
 */
const judgeVerdict = (parts: JudgeParts, prefix: string): JudgeVerdict => {
  const earsGap = missingEars(parts.ears);
  if (earsGap) return { verdict: 'refused', reason: `${prefix}no se puede celebrar: ${earsGap}.`, detail: null };
  const pivotGap = missingPivot(parts.pivot);
  if (pivotGap) return { verdict: 'refused', reason: `${prefix}no se puede celebrar: ${pivotGap}.`, detail: null };
  const gatesGap = missingGates(parts.gates);
  if (gatesGap) return { verdict: 'refused', reason: `${prefix}no se puede celebrar: ${gatesGap}.`, detail: null };

  const ears = parts.ears as EarsSnapshot;
  const pivot = parts.pivot as PivotSnapshot;
  const gates = parts.gates as GatesSnapshot;

  if (ears.errors > 0 || ears.conforming !== ears.total) {
    const errors = ears.errors > 0 ? `, ${ears.errors} error(es)` : '';
    return {
      verdict: 'plain',
      reason: `${prefix}sin celebración: los requisitos EARS no son conformes (${ears.conforming}/${ears.total}${errors}).`,
      detail: null,
    };
  }
  if (pivot.errors > 0) {
    return {
      verdict: 'plain',
      reason: `${prefix}sin celebración: el pivote constitucional tiene ${pivot.errors} error(es) (alineación ${percent(pivot.alignment)}).`,
      detail: null,
    };
  }
  if (gates.failed.length > 0 || gates.passed !== gates.total) {
    const why = gates.failed.length > 0 ? gateList(gates.failed) : `no todos los gates pasan (${gates.passed}/${gates.total})`;
    return { verdict: 'plain', reason: `${prefix}sin celebración: ${why}.`, detail: null };
  }
  return {
    verdict: 'celebrate',
    reason: `${prefix}validación positiva: requisitos EARS conformes, pivote constitucional sin errores y gates en verde.`,
    detail: { ears, pivot, gates, score: parts.score, streak: parts.streak },
  };
};

// ── Render estático ─────────────────────────────────────────────────────────────────────────────

export const CELEBRATION_RULE_WIDTH = 64;

/** La frase de la racha. Singular/plural explícitos; 0 no finge una racha. */
export const renderStreakPhrase = (rises: number): string => {
  const n = isFiniteNumber(rises) && rises > 0 ? Math.floor(rises) : 0;
  if (n === 0) return 'racha: 0 cambios seguidos sin bajar la adhesión (aún sin racha)';
  return n === 1
    ? 'racha: 1 cambio seguido sin bajar la adhesión'
    : `racha: ${n} cambios seguidos sin bajar la adhesión`;
};

/** `racha: … · score N/100 · fase N/3`. Los campos ausentes se omiten, no se rellenan. */
export const renderStreak = (input: { score: number; phase: SddPhase; rises: number }): string => {
  const parts = [renderStreakPhrase(input.rises)];
  if (isFiniteNumber(input.score)) parts.push(`score ${Math.round(input.score)}/100`);
  if (isPhase(input.phase)) parts.push(`fase ${input.phase}/3`);
  return parts.join(' · ');
};

const progressLine = (score: ScoreSnapshot | undefined, streak: number | undefined): string | null => {
  if (score && isFiniteNumber(score.total) && isPhase(score.phase) && isFiniteNumber(streak)) {
    return renderStreak({ score: score.total, phase: score.phase, rises: streak });
  }
  if (score && isFiniteNumber(score.total) && isPhase(score.phase)) {
    return `score ${Math.round(score.total)}/100 · fase ${score.phase}/3`;
  }
  if (isFiniteNumber(streak)) return renderStreakPhrase(streak);
  return null;
};

const summaryLine = (input: {
  feature?: string;
  ears: EarsSnapshot;
  pivot: PivotSnapshot;
  gates: GatesSnapshot;
  score?: ScoreSnapshot;
  streak?: number;
}): string => {
  const head = input.feature ? `✅ ${input.feature}` : '✅ VALIDACIÓN POSITIVA';
  const parts = [
    head,
    `EARS ${input.ears.conforming}/${input.ears.total}`,
    `pivote ${percent(input.pivot.alignment)}`,
    `gates ${input.gates.passed}/${input.gates.total}`,
  ];
  if (input.score && isFiniteNumber(input.score.total) && isPhase(input.score.phase)) {
    parts.push(`score ${Math.round(input.score.total)}/100`, `fase ${input.score.phase}`);
  }
  if (isFiniteNumber(input.streak)) parts.push(`racha ${input.streak}`);
  return parts.join(' · ');
};

interface CelebrationBlockInput {
  headline: string;
  feature?: string;
  ears: EarsSnapshot;
  pivot: PivotSnapshot;
  gates: GatesSnapshot;
  score?: ScoreSnapshot;
  streak?: number;
}

const buildStaticLines = (input: CelebrationBlockInput): string[] => {
  const rule = '═'.repeat(CELEBRATION_RULE_WIDTH);
  const lines = [
    rule,
    ` ✔ ${input.headline}`,
    ` EARS ${input.ears.conforming}/${input.ears.total} · pivote ${percent(input.pivot.alignment)} · gates ${input.gates.passed}/${input.gates.total}`,
  ];
  const progress = progressLine(input.score, input.streak);
  if (progress) lines.push(` ${progress}`);
  lines.push(' las comprobaciones que corrieron dijeron que sí; no es una garantía de calidad.');
  lines.push(rule);
  lines.push(summaryLine(input));
  return lines;
};

// ── Animación: fotogramas puros ─────────────────────────────────────────────────────────────────

export const CELEBRATION_FRAME_COUNT = 10;
export const CELEBRATION_FRAME_MS = 60;
/** 600 ms < 700: la animación está acotada por construcción. */
export const CELEBRATION_TOTAL_MS = CELEBRATION_FRAME_COUNT * CELEBRATION_FRAME_MS;
export const CELEBRATION_BAR_WIDTH = 20;

/** Un fotograma: mismo índice ⇒ misma línea. Sin reloj, sin estado, sin `\r`. */
export const renderCelebrationFrame = (
  index: number,
  summary: string,
  opts: { color?: boolean } = {},
): string => {
  const safe = isFiniteNumber(index) ? Math.trunc(index) : 0;
  const clamped = Math.max(0, Math.min(CELEBRATION_FRAME_COUNT - 1, safe));
  const filled = Math.round(((clamped + 1) / CELEBRATION_FRAME_COUNT) * CELEBRATION_BAR_WIDTH);
  const bar = `${'█'.repeat(filled)}${'░'.repeat(CELEBRATION_BAR_WIDTH - filled)}`;
  const line = `${bar}  ${summary}`;
  return opts.color ? `${GREEN}${line}${RESET}` : line;
};

export const renderCelebrationFrames = (summary: string, opts: { color?: boolean } = {}): string[] =>
  Array.from({ length: CELEBRATION_FRAME_COUNT }, (_unused, index) => renderCelebrationFrame(index, summary, opts));

// ── Opciones → modo de salida ───────────────────────────────────────────────────────────────────

const truthyEnv = (value: string | undefined): boolean =>
  value !== undefined && value !== '' && value !== '0' && value !== 'false' && value !== 'no';

interface RenderMode {
  animate: boolean;
  color: boolean;
  minimal: boolean;
}

const resolveMode = (opts: CelebrationOptions): RenderMode => {
  const env = opts.env ?? process.env;
  const isTty = opts.isTty ?? process.stdout.isTTY === true;
  const noColorEnv = truthyEnv(env.NO_COLOR);
  const noAnimEnv = truthyEnv(env.SDD_NO_ANIM);
  const ciEnv = truthyEnv(env.CI);
  const quiet = opts.quiet === true;
  const json = opts.json === true;
  const animate =
    (opts.anim ?? true) && isTty === true && !quiet && !json && !noColorEnv && !noAnimEnv && !ciEnv;
  const color = opts.noColor !== true && !json && !noColorEnv && isTty === true;
  return { animate, color, minimal: quiet || json };
};

const paint = (verdict: CelebrationVerdict, line: string, color: boolean): string => {
  if (!color) return line;
  if (verdict === 'celebrate') return `${GREEN}${line}${RESET}`;
  if (verdict === 'plain') return `${YELLOW}${line}${RESET}`;
  return `${RED}${line}${RESET}`;
};

interface AssembledReport {
  verdict: CelebrationVerdict;
  reason: string;
  staticLines: string[];
  frames: string[];
  lines: string[];
}

const assemble = (
  verdict: CelebrationVerdict,
  reason: string,
  block: CelebrationBlockInput | null,
  opts: CelebrationOptions,
): CelebrationReport => {
  const mode = resolveMode(opts);
  const staticLines = block ? buildStaticLines(block).map((line) => paint(verdict, line, mode.color)) : [];
  if (verdict !== 'celebrate' || !block) {
    return { verdict, reason, lines: [paint(verdict, reason, mode.color)], frames: [], staticLines: [] };
  }
  const summary = staticLines[staticLines.length - 1]!;
  const frames = mode.animate ? renderCelebrationFrames(summary, { color: mode.color }) : [];
  const lines = mode.minimal ? [summary] : mode.animate ? [...frames, ...staticLines] : [...staticLines];
  return { verdict, reason, lines, frames, staticLines };
};

// ── API pública ─────────────────────────────────────────────────────────────────────────────────

/** Veredicto por comprobación (el caso `plain`). Para el momento completo, ver `judgeFeatureCelebration`. */
export const judgeCelebration = (
  snapshot: ValidationSnapshot | null | undefined,
  opts: CelebrationOptions = {},
): CelebrationReport => {
  const parts: JudgeParts = {
    ears: snapshot?.ears,
    pivot: snapshot?.pivot,
    gates: snapshot?.gates,
    score: snapshot?.score,
    streak: snapshot?.streak,
  };
  const judged = judgeVerdict(parts, '');
  const headline = 'VALIDACIÓN POSITIVA';
  const block = judged.detail ? { headline, ...judged.detail } : null;
  return assemble(judged.verdict, judged.reason, block, opts);
};

/**
 * El momento que importa: una FEATURE entera valida. Las tres verdades se juzgan al alcance de la
 * feature (todos sus requisitos, su pivote, sus gates). Añade `feature`, `score`, `phase` y `streak`.
 */
export interface FeatureValidationInput {
  feature: string;
  requirements: EarsSnapshot;
  pivot: PivotSnapshot;
  gates: GatesSnapshot;
  score?: number;
  phase?: SddPhase;
  streak?: number;
  /** ISO-8601; inyectable para que una re-ejecución de la MISMA validación deduplique. */
  date?: string;
}

export const judgeFeatureCelebration = (
  input: FeatureValidationInput,
  opts: CelebrationOptions = {},
): CelebrationReport => {
  const rawFeature = typeof input?.feature === 'string' ? input.feature.trim() : '';
  const feature = rawFeature.length > 0 ? rawFeature : '';
  const score = isFiniteNumber(input?.score) && isPhase(input?.phase) ? input.score : undefined;
  const phase = isPhase(input?.phase) ? input.phase : undefined;
  const parts: JudgeParts = {
    ears: input?.requirements,
    pivot: input?.pivot,
    gates: input?.gates,
    score: score !== undefined && phase !== undefined ? { total: score, phase } : undefined,
    streak: input?.streak,
  };
  const judged = judgeVerdict(parts, feature.length > 0 ? `[${feature}] ` : '');
  const headline = feature.length > 0 ? `FEATURE VALIDADA — ${feature}` : 'FEATURE VALIDADA';
  const block = judged.detail
    ? { headline, ...(feature.length > 0 ? { feature } : {}), ...judged.detail }
    : null;
  return assemble(judged.verdict, judged.reason, block, opts);
};

// ── Reproducción (opcional): TTY-only, acotada, stdout ──────────────────────────────────────────

export interface CelebrationWriter {
  write(chunk: string): unknown;
}

export interface PlayCelebrationOptions {
  /** Destino; por defecto `process.stdout`. En tests se inyecta. */
  out?: CelebrationWriter;
  /** Milisegundos por fotograma; por defecto `CELEBRATION_FRAME_MS`. */
  frameMs?: number;
  /** Inyectable en tests para no esperar de verdad. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Escribe el reporte: fotogramas con `\r` (sin librería de escape) y después el bloque estático.
 * Nunca anima si el reporte no trae fotogramas (no-TTY, quiet, json, NO_COLOR, CI, SDD_NO_ANIM).
 */
export const playCelebration = async (
  report: CelebrationReport,
  opts: PlayCelebrationOptions = {},
): Promise<{ frames: number; animated: boolean }> => {
  const out = opts.out ?? process.stdout;
  if (report.frames.length === 0 || report.verdict !== 'celebrate') {
    if (report.lines.length > 0) out.write(`${report.lines.join('\n')}\n`);
    return { frames: 0, animated: false };
  }
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const frameMs = isFiniteNumber(opts.frameMs) ? Math.max(0, opts.frameMs) : CELEBRATION_FRAME_MS;
  const width = report.frames.reduce((max, frame) => Math.max(max, frame.length), 0);
  for (const frame of report.frames) {
    out.write(`\r${frame}`);
    await sleep(frameMs);
  }
  out.write(`\r${' '.repeat(width)}\r`);
  out.write(`${report.staticLines.join('\n')}\n`);
  return { frames: report.frames.length, animated: true };
};

// ── Niveles y logros: derivados, nunca inventados ───────────────────────────────────────────────

export type CelebrationLevelId = 'inicio' | 'especificando' | 'implementando' | 'verificando' | 'consolidado';

export interface CelebrationLevel {
  id: CelebrationLevelId;
  index: 0 | 1 | 2 | 3 | 4;
  label: string;
}

const LEVEL_LABELS: Record<CelebrationLevelId, string> = {
  inicio: 'Inicio',
  especificando: 'Especificando',
  implementando: 'Implementando',
  verificando: 'Verificando',
  consolidado: 'Consolidado',
};

/** Bandas de `sddScore` + fase. No hay puntos: el nivel es una lectura del score real. */
export const levelFor = (score: number, _phase?: SddPhase): CelebrationLevel => {
  const total = isFiniteNumber(score) ? Math.max(0, Math.min(100, score)) : 0;
  let id: CelebrationLevelId = 'inicio';
  let index: 0 | 1 | 2 | 3 | 4 = 0;
  if (total >= 95) {
    id = 'consolidado';
    index = 4;
  } else if (total >= 80) {
    id = 'verificando';
    index = 3;
  } else if (total >= 60) {
    id = 'implementando';
    index = 2;
  } else if (total >= 40) {
    id = 'especificando';
    index = 1;
  }
  return { id, index, label: LEVEL_LABELS[id] };
};

/** Línea de pie para `status`: nivel + fase + racha. Cada campo sale de un dato real. */
export const renderCelebrationFooter = (input: {
  score: number;
  phase: SddPhase;
  rises: number;
}): string => {
  const level = levelFor(input.score, input.phase);
  const parts = [`nivel ${level.label}`, `fase ${input.phase}/3`, `score ${Math.round(input.score)}/100`];
  parts.push(renderStreakPhrase(input.rises));
  return parts.join(' · ');
};

export interface CelebrationAchievement {
  id: string;
  label: string;
  /** El evento real del que sale: sin evento, este logro no existe. */
  evidence: string;
}

export interface AchievementContext {
  /** Hecho aportado por el llamador (constitución realmente ratificada). Sin `true`, no hay logro. */
  constitutionRatified?: boolean;
  /** Hecho aportado por el llamador (delta realmente fusionada). Sin `true`, no hay logro. */
  deltaMerged?: boolean;
}

const dateOnly = (iso: string): string => (iso.length >= 10 ? iso.slice(0, 10) : iso);

/** Logros derivados del libro + hechos explícitos. Nada se concede sin su evento. */
export const deriveAchievements = (
  entries: readonly CelebrationEntry[],
  context: AchievementContext = {},
): CelebrationAchievement[] => {
  const out: CelebrationAchievement[] = [];
  const features = [...new Set(entries.map((entry) => entry.feature))];
  const first = entries[0];
  if (first) {
    out.push({
      id: 'primera-validacion',
      label: 'primera validación registrada',
      evidence: `"${first.feature}" validó el ${dateOnly(first.date)} con score ${first.score}/100`,
    });
  }
  if (features.length >= 3) {
    out.push({
      id: 'tres-features',
      label: '3 features validadas',
      evidence: `${features.length} features distintas en el libro: ${features.slice(0, 5).join(', ')}`,
    });
  }
  if (features.length >= 10) {
    out.push({
      id: 'diez-features',
      label: '10 features validadas',
      evidence: `${features.length} features distintas en el libro`,
    });
  }
  const best = entries.reduce<CelebrationEntry | null>(
    (top, entry) => (top === null || entry.streak > top.streak ? entry : top),
    null,
  );
  if (best && best.streak >= 5) {
    out.push({
      id: 'racha-5',
      label: '5 cambios seguidos sin bajar la adhesión',
      evidence: `mayor racha registrada: ${best.streak} cambios seguidos ("${best.feature}", ${dateOnly(best.date)})`,
    });
  }
  if (best && best.streak >= 10) {
    out.push({
      id: 'racha-10',
      label: '10 cambios seguidos sin bajar la adhesión',
      evidence: `mayor racha registrada: ${best.streak} cambios seguidos ("${best.feature}")`,
    });
  }
  if (context.constitutionRatified === true) {
    out.push({
      id: 'constitucion-ratificada',
      label: 'constitución ratificada',
      evidence: 'hecho real aportado por el llamador: la constitución está ratificada',
    });
  }
  if (context.deltaMerged === true) {
    out.push({
      id: 'primera-delta',
      label: 'primera delta fusionada',
      evidence: 'hecho real aportado por el llamador: hay una delta fusionada',
    });
  }
  return out;
};

// ── El libro: `.sdd/state/celebrations.json` ────────────────────────────────────────────────────

export const CELEBRATIONS_STATE_DIR = 'state';
export const CELEBRATIONS_STATE_FILE = 'celebrations.json';
export const CELEBRATIONS_STATE_VERSION = 1 as const;

export interface CelebrationEntry {
  feature: string;
  /** ISO-8601 del momento de la validación. */
  date: string;
  /** 0..100, el `sddScore` real. */
  score: number;
  phase: SddPhase;
  ears: { conforming: number; total: number };
  /** 0..1, la alineación del pivote. */
  pivot: { alignment: number };
  gates: { passed: number; total: number };
  /** Cambios consecutivos sin bajar la adhesión, según el trinquete. */
  streak: number;
}

export interface CelebrationsLedger {
  version: typeof CELEBRATIONS_STATE_VERSION;
  entries: CelebrationEntry[];
}

export const celebrationsStatePath = (sddDir: string): string =>
  path.join(sddDir, CELEBRATIONS_STATE_DIR, CELEBRATIONS_STATE_FILE);

const isCelebrationEntry = (value: unknown): value is CelebrationEntry => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.feature !== 'string' || entry.feature.length === 0) return false;
  if (typeof entry.date !== 'string' || entry.date.length === 0) return false;
  if (!isFiniteNumber(entry.score) || !isPhase(entry.phase)) return false;
  if (!isFiniteNumber(entry.streak) || entry.streak < 0) return false;
  const ears = entry.ears as Record<string, unknown> | undefined;
  const pivot = entry.pivot as Record<string, unknown> | undefined;
  const gates = entry.gates as Record<string, unknown> | undefined;
  if (!ears || !isFiniteNumber(ears.conforming) || !isFiniteNumber(ears.total)) return false;
  if (!pivot || !isFiniteNumber(pivot.alignment)) return false;
  if (!gates || !isFiniteNumber(gates.passed) || !isFiniteNumber(gates.total)) return false;
  return true;
};

export interface CelebrationsLedgerRead {
  ledger: CelebrationsLedger | null;
  /** El fichero existía pero no se pudo leer o no tiene la forma esperada. */
  corrupt: boolean;
  path: string;
  error?: string;
}

export const readCelebrations = async (sddDir: string): Promise<CelebrationsLedgerRead> => {
  const statePath = celebrationsStatePath(sddDir);
  let raw: string;
  try {
    raw = await readFile(statePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ledger: null, corrupt: false, path: statePath };
    return { ledger: null, corrupt: true, path: statePath, error: `${statePath}: ${(err as Error).message}` };
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch (err) {
    return {
      ledger: null,
      corrupt: true,
      path: statePath,
      error: `${statePath}: JSON inválido (${(err as Error).message})`,
    };
  }
  if (!candidate || typeof candidate !== 'object') {
    return { ledger: null, corrupt: true, path: statePath, error: `${statePath}: no es un objeto` };
  }
  const ledger = candidate as Record<string, unknown>;
  if (ledger.version !== CELEBRATIONS_STATE_VERSION) {
    return {
      ledger: null,
      corrupt: true,
      path: statePath,
      error: `${statePath}: versión ${String(ledger.version)} desconocida (se esperaba ${CELEBRATIONS_STATE_VERSION})`,
    };
  }
  if (!Array.isArray(ledger.entries) || !ledger.entries.every(isCelebrationEntry)) {
    return { ledger: null, corrupt: true, path: statePath, error: `${statePath}: "entries" no tiene la forma esperada` };
  }
  return { ledger: { version: CELEBRATIONS_STATE_VERSION, entries: ledger.entries as CelebrationEntry[] }, corrupt: false, path: statePath };
};

/** Escritura atómica: tmp + rename, el mismo patrón que `ratchet.ts`. */
const persistLedger = async (statePath: string, ledger: CelebrationsLedger): Promise<void> => {
  await mkdir(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.tmp`;
  await writeFile(tmp, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  await rename(tmp, statePath);
};

export interface CelebrationRecordInput {
  feature: string;
  score?: number;
  phase?: SddPhase;
  ears: { conforming: number; total: number };
  pivot: { alignment: number };
  gates: { passed: number; total: number };
  streak?: number;
  /** Inyectable en tests; por defecto `new Date().toISOString()`. */
  date?: string;
}

export interface CelebrationAppendResult {
  appended: boolean;
  reason: string;
  path: string;
  /** El libro previo existía y no se pudo leer: se reinició (el llamador debe avisar). */
  corrupt: boolean;
  stateError?: string;
  entry?: CelebrationEntry;
}

const celebrationKey = (entry: Pick<CelebrationEntry, 'feature' | 'date' | 'score'>): string =>
  `${entry.feature}|${entry.date}|${entry.score}`;

/**
 * Apunta UNA validación real. No inventa: una entrada incompleta (score/phase ausentes, gates que no
 * pasan, EARS que no son conformes, pivote sin alineación) se rechaza con motivo y NO se escribe. Un
 * libro corrupto se avisa y se reinicia con la entrada real. Deduplica por feature+date+score.
 */
export const appendCelebration = async (
  sddDir: string,
  input: CelebrationRecordInput,
): Promise<CelebrationAppendResult> => {
  const statePath = celebrationsStatePath(sddDir);
  const reject = (reason: string, corrupt = false, stateError?: string): CelebrationAppendResult => ({
    appended: false,
    reason,
    path: statePath,
    corrupt,
    ...(stateError ? { stateError } : {}),
  });

  const feature = typeof input?.feature === 'string' ? input.feature.trim() : '';
  if (feature.length === 0) return reject('entrada sin feature: no se apunta nada');
  if (!isFiniteNumber(input.score) || input.score < 0 || input.score > 100) {
    return reject('entrada sin score real (0..100): no se apunta nada');
  }
  if (!isPhase(input.phase)) return reject('entrada sin fase (1|2|3): no se apunta nada');
  if (
    !input.ears ||
    !isFiniteNumber(input.ears.conforming) ||
    !isFiniteNumber(input.ears.total) ||
    input.ears.total <= 0 ||
    input.ears.conforming !== input.ears.total
  ) {
    return reject('los requisitos no son EARS conformes: no se apunta nada');
  }
  if (!input.pivot || !isFiniteNumber(input.pivot.alignment) || input.pivot.alignment < 0 || input.pivot.alignment > 1) {
    return reject('el pivote no tiene alineación real (0..1): no se apunta nada');
  }
  if (
    !input.gates ||
    !isFiniteNumber(input.gates.passed) ||
    !isFiniteNumber(input.gates.total) ||
    input.gates.total <= 0 ||
    input.gates.passed !== input.gates.total
  ) {
    return reject('los gates no están todos en verde: no se apunta nada');
  }
  if (!isFiniteNumber(input.streak) || input.streak < 0) {
    return reject('falta la racha real del trinquete: no se apunta nada');
  }

  const entry: CelebrationEntry = {
    feature,
    date: typeof input.date === 'string' && input.date.length > 0 ? input.date : new Date().toISOString(),
    score: Math.round(input.score),
    phase: input.phase,
    ears: { conforming: input.ears.conforming, total: input.ears.total },
    pivot: { alignment: input.pivot.alignment },
    gates: { passed: input.gates.passed, total: input.gates.total },
    streak: Math.floor(input.streak),
  };

  const read = await readCelebrations(sddDir);
  const entries = read.ledger?.entries ?? [];
  if (entries.some((candidate) => celebrationKey(candidate) === celebrationKey(entry))) {
    return {
      appended: false,
      reason: `ya registrada: "${entry.feature}" el ${dateOnly(entry.date)} con score ${entry.score}/100 (dedupe feature+fecha+score)`,
      path: statePath,
      corrupt: read.corrupt,
      ...(read.error ? { stateError: read.error } : {}),
    };
  }
  const ledger: CelebrationsLedger = { version: CELEBRATIONS_STATE_VERSION, entries: [...entries, entry] };
  try {
    await persistLedger(statePath, ledger);
  } catch (err) {
    return reject(
      `no se pudo escribir el libro en ${statePath} (${(err as Error).message}): esta validación no quedó registrada`,
      read.corrupt,
      read.error,
    );
  }
  return {
    appended: true,
    reason: read.corrupt
      ? `libro anterior ilegible (${read.error ?? 'motivo desconocido'}): se reinició con esta validación real`
      : `registrada: "${entry.feature}" el ${dateOnly(entry.date)} con score ${entry.score}/100`,
    path: statePath,
    corrupt: read.corrupt,
    ...(read.error ? { stateError: read.error } : {}),
    entry,
  };
};

export interface FeatureCelebrationRun {
  report: CelebrationReport;
  /** `null` cuando el veredicto no fue `celebrate`: en ese caso NO se tocó el disco. */
  ledger: CelebrationAppendResult | null;
}

/**
 * Entrada principal: juzga una feature y, SOLO si el veredicto es `celebrate`, apunta la validación.
 * Un `refused`/`plain` no lee ni escribe el libro: el rechazo no deja huella.
 */
export const celebrateFeature = async (
  sddDir: string,
  input: FeatureValidationInput,
  opts: CelebrationOptions & { record?: boolean } = {},
): Promise<FeatureCelebrationRun> => {
  const report = judgeFeatureCelebration(input, opts);
  if (report.verdict !== 'celebrate' || opts.record === false) return { report, ledger: null };
  const ledger = await appendCelebration(sddDir, {
    feature: input.feature,
    score: input.score,
    phase: input.phase,
    ears: { conforming: input.requirements.conforming, total: input.requirements.total },
    pivot: { alignment: input.pivot.alignment },
    gates: { passed: input.gates.passed, total: input.gates.total },
    streak: input.streak,
    date: input.date,
  });
  return { report, ledger };
};

// ── Superficie `status --celebrations` ──────────────────────────────────────────────────────────

export interface CelebrationsJson {
  count: number;
  features: string[];
  latest: CelebrationEntry | null;
  achievements: CelebrationAchievement[];
  entries: CelebrationEntry[];
  corrupt: boolean;
}

/** Sobre JSON del libro: lo que `status --celebrations --json` debe emitir. */
export const celebrationsToJson = (
  read: CelebrationsLedgerRead,
  context: AchievementContext = {},
): CelebrationsJson => {
  const entries = read.ledger?.entries ?? [];
  return {
    count: entries.length,
    features: [...new Set(entries.map((entry) => entry.feature))],
    latest: entries.length > 0 ? entries[entries.length - 1]! : null,
    achievements: deriveAchievements(entries, context),
    entries,
    corrupt: read.corrupt,
  };
};

/**
 * Líneas humanas para `status --celebrations`. Vacío no se disfraza: dice que no hay nada. Un libro
 * corrupto se AVISA y se muestra vacío, nunca se rellena.
 */
export const renderCelebrations = (
  read: CelebrationsLedgerRead,
  opts: { noColor?: boolean } = {},
): string[] => {
  const color = opts.noColor !== true;
  const paintOk = (line: string): string => (color ? `${GREEN}${line}${RESET}` : line);
  const paintWarn = (line: string): string => (color ? `${YELLOW}${line}${RESET}` : line);
  const lines: string[] = [];
  if (read.corrupt) {
    lines.push(paintWarn(`aviso: ${read.error ?? `${read.path}: libro ilegible`}`));
    lines.push(paintWarn('el libro se reiniciará en la próxima validación real (no se inventa ninguna entrada).'));
  }
  const entries = read.ledger?.entries ?? [];
  if (entries.length === 0) {
    lines.push('todavía no hay ninguna validación registrada en .sdd/state/celebrations.json');
    return lines;
  }
  lines.push(`VALIDACIONES REGISTRADAS: ${entries.length}`);
  for (const entry of entries) {
    lines.push(
      paintOk(
        `  ✔ ${entry.feature}  ${dateOnly(entry.date)}  score ${entry.score}/100 · fase ${entry.phase} · ` +
          `EARS ${entry.ears.conforming}/${entry.ears.total} · pivote ${percent(entry.pivot.alignment)} · ` +
          `gates ${entry.gates.passed}/${entry.gates.total} · racha ${entry.streak}`,
      ),
    );
  }
  const latest = entries[entries.length - 1]!;
  lines.push(`nivel: ${levelFor(latest.score, latest.phase).label} · fase ${latest.phase}/3 · score ${latest.score}/100`);
  const achievements = deriveAchievements(entries);
  if (achievements.length > 0) {
    lines.push(`logros: ${achievements.map((achievement) => achievement.label).join(' · ')}`);
  }
  return lines;
};
