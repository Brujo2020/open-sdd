/**
 * El libro de progreso: `.sdd/state/progress.json`, APPEND-ONLY y atómico.
 *
 * ── Para qué existe ─────────────────────────────────────────────────────────────────────────────
 * No es un sistema de recompensas ni una puntuación que se pueda inflar. Es CONSCIENCIA: la
 * respuesta escrita a «¿qué se consiguió, cuándo, y con qué evidencia?» para que ni el agente ni la
 * persona que vuelve a un proyecto horas después tengan que reconstruirlo de memoria. El dueño de
 * este módulo lo pidió con una frase: «marca siempre el progreso que seamos conscientes». Un
 * trinquete (`ratchet.ts`) impide BAJAR en silencio; este libro impide que lo conseguido se
 * desvanezca en silencio.
 *
 * ── Reglas que la forma impone (no son convenciones, son invariantes) ───────────────────────────
 *  1. `delta` es CALCULADO contra la entrada anterior, nunca aportado por el llamante. El tipo de
 *     `recordProgress` lo omite (`Omit<ProgressEntry,'at'|'delta'>`) y, aunque alguien lo cuele por un
 *     `as any`, se descarta y se recalcula: una mentira sobre el avance no debe ser expresable.
 *  2. Sin movimiento, `delta` es 0 y se DICE (`sin cambios`). No se disfraza de subida.
 *  3. `summary` es UNA línea en español que nombra lo conseguido. «se avanzó» no es un resumen: el
 *     módulo lo rechaza y pide el hecho concreto.
 *  4. Un libro corrupto NUNCA revienta y NUNCA se interpreta a ojo: se avisa y se empieza una serie
 *     nueva. Inventar una historia a partir de bytes ilegibles sería peor que no tener historia.
 *  5. Append-only de verdad: se lee, se añade al final y se reescribe el documento completo con
 *     `write tmp + rename` (el mismo patrón atómico que `ratchet.ts`). Ninguna entrada previa se
 *     reordena, se reescribe ni se borra.
 *
 * ── Qué NO toca ─────────────────────────────────────────────────────────────────────────────────
 * Este módulo posee `state/progress.json` y SOLO ese fichero. `adhesion.json` es del trinquete; la
 * tendencia de alineación, de otra pieza. Dos escritores sobre el mismo fichero se pisarían.
 *
 * Nota de idioma: los textos visibles son español, como el resto del CLI. Los identificadores son
 * estables (`kind`, `summary`, `score`, `delta`, `evidence`) porque viajan en el sobre JSON.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveSddDir } from './specManager.js';

export const PROGRESS_STATE_DIR = 'state';
export const PROGRESS_STATE_FILE = 'progress.json';
export const PROGRESS_STATE_VERSION = 1 as const;

/** Cuántas entradas caben en la «pantalla» por defecto del renderizador. */
export const DEFAULT_PROGRESS_LIMIT = 20;

export interface ProgressEntry {
  /** ISO-8601 del momento en que se registró. Lo pone el módulo, no el llamante. */
  at: string;
  /** Tipo estable de hito (`spec`, `implement`, `verify`, `gate`, `backup`, …). */
  kind: string;
  /** UNA línea en español que nombra lo conseguido. Nunca «se avanzó». */
  summary: string;
  /** La puntuación compuesta y la fase en ese momento (`core/sddScore.ts`). */
  score: { total: number; phase: 1 | 2 | 3 };
  /** Movimiento CALCULADO contra la entrada anterior. 0 = sin movimiento, y se dice. */
  delta: { score: number; phase: 0 | 1 | -1 };
  /** Evidencia recogida: comandos, ficheros, ids. Vacío es legítimo, inventado no. */
  evidence: string[];
}

/** El documento en disco. La versión permite reestablecer un formato desconocido en vez de adivinar. */
export interface ProgressLedger {
  version: typeof PROGRESS_STATE_VERSION;
  entries: ProgressEntry[];
}

export interface ProgressRead {
  /** Las entradas EN ORDEN de escritura. Vacío si no hay libro o si está corrupto. */
  entries: ProgressEntry[];
  /** El fichero existe pero no se pudo leer o no tiene la forma esperada. */
  corrupt: boolean;
  /** Motivo concreto, legible, para poder decirlo en voz alta. */
  detail: string;
}

export interface ProgressRecordResult {
  written: boolean;
  entry: ProgressEntry | null;
  detail: string;
}

/** `.sdd/state/progress.json` a partir del directorio SDD (absoluto o relativo). */
export const progressStatePath = (sddDir: string): string =>
  path.join(sddDir, PROGRESS_STATE_DIR, PROGRESS_STATE_FILE);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isPhase = (value: unknown): value is 1 | 2 | 3 => value === 1 || value === 2 || value === 3;

const isPhaseDelta = (value: unknown): value is 0 | 1 | -1 =>
  value === 0 || value === 1 || value === -1;

const isEntry = (value: unknown): value is ProgressEntry => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  const score = candidate.score as Record<string, unknown> | undefined;
  const delta = candidate.delta as Record<string, unknown> | undefined;
  return (
    typeof candidate.at === 'string' &&
    typeof candidate.kind === 'string' &&
    typeof candidate.summary === 'string' &&
    Boolean(score) &&
    isFiniteNumber(score?.total) &&
    isPhase(score?.phase) &&
    Boolean(delta) &&
    isFiniteNumber(delta?.score) &&
    isPhaseDelta(delta?.phase) &&
    Array.isArray(candidate.evidence) &&
    candidate.evidence.every((item) => typeof item === 'string')
  );
};

/**
 * Leer el libro. NUNCA lanza.
 *
 * «No existe» no es «corrupto»: un proyecto sin libro simplemente no ha registrado nada todavía.
 * «Existe pero no se entiende» sí lo es, y se declara. En ese caso se devuelven CERO entradas —no
 * las que se hayan podido rescatar a medias—: media historia presentada como historia es una
 * historia falsa.
 */
export const readProgress = async (
  cwd: string,
  opts: { sddDir?: string } = {},
): Promise<ProgressRead> => {
  const sddDir = opts.sddDir ?? (await resolveSddDir(cwd));
  const statePath = progressStatePath(sddDir);

  let raw: string;
  try {
    raw = await readFile(path.resolve(cwd, statePath), 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { entries: [], corrupt: false, detail: `Sin historial de progreso en ${statePath}: todavía no se ha registrado ningún hito.` };
    }
    return {
      entries: [],
      corrupt: true,
      detail: `El historial de progreso no se pudo leer (${statePath}: ${(err as Error).message}).`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      entries: [],
      corrupt: true,
      detail: `El historial de progreso no se pudo interpretar (${statePath}: JSON inválido — ${(err as Error).message}).`,
    };
  }

  const candidate = parsed as Partial<ProgressLedger> | null;
  if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.entries)) {
    return {
      entries: [],
      corrupt: true,
      detail: `El historial de progreso no tiene la forma esperada (${statePath}: falta la lista "entries").`,
    };
  }
  if (candidate.version !== PROGRESS_STATE_VERSION) {
    // Un formato desconocido se reestablece, no se interpreta a ojo.
    return {
      entries: [],
      corrupt: true,
      detail: `El historial de progreso usa una versión desconocida (${statePath}: ${String(candidate.version)}, se esperaba ${PROGRESS_STATE_VERSION}).`,
    };
  }
  const invalidIndex = candidate.entries.findIndex((entry) => !isEntry(entry));
  if (invalidIndex >= 0) {
    return {
      entries: [],
      corrupt: true,
      detail: `El historial de progreso tiene una entrada inválida en la posición ${invalidIndex} (${statePath}): no se rescata a medias.`,
    };
  }

  return { entries: candidate.entries as ProgressEntry[], corrupt: false, detail: `Historial de progreso con ${candidate.entries.length} entrada(s) en ${statePath}.` };
};

const persist = async (statePath: string, ledger: ProgressLedger): Promise<void> => {
  await mkdir(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.tmp`;
  await writeFile(tmp, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  await rename(tmp, statePath);
};

/**
 * Un resumen que no dice nada no es un resumen. La lista es corta y explícita a propósito: no
 * pretende juzgar la prosa, solo impedir que la frase vacía ocupe el lugar del hecho.
 */
const VAGUE_SUMMARIES = new Set([
  'se avanzo',
  'se avanzo en el proyecto',
  'avanzamos',
  'avance',
  'avances',
  'progreso',
  'se progreso',
  'hubo progreso',
  'sin novedades',
  'nada',
  'ok',
]);

const normalizeSummary = (summary: string): string =>
  summary
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[.!¡¿?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const validateInput = (
  entry: Omit<ProgressEntry, 'at' | 'delta'>,
): { ok: true; value: Omit<ProgressEntry, 'at' | 'delta'> } | { ok: false; detail: string } => {
  if (!entry || typeof entry !== 'object') {
    return { ok: false, detail: 'La entrada de progreso no tiene la forma esperada.' };
  }
  if (typeof entry.kind !== 'string' || entry.kind.trim().length === 0) {
    return { ok: false, detail: 'La entrada de progreso necesita un "kind" no vacío (spec, implement, verify, gate, backup…).' };
  }
  if (typeof entry.summary !== 'string' || entry.summary.trim().length === 0) {
    return { ok: false, detail: 'La entrada de progreso necesita un "summary": una línea que nombre lo conseguido.' };
  }
  if (/[\r\n]/.test(entry.summary)) {
    return { ok: false, detail: 'El "summary" debe ser UNA línea: un resumen partido en varias no cabe en la cronología.' };
  }
  if (VAGUE_SUMMARIES.has(normalizeSummary(entry.summary))) {
    return {
      ok: false,
      detail: `«${entry.summary.trim()}» no dice qué se consiguió. Nombra el hecho concreto (qué fichero, qué spec, qué veredicto): la frase vacía no entra en el libro.`,
    };
  }
  const score = entry.score as { total?: unknown; phase?: unknown } | undefined;
  if (!score || !isFiniteNumber(score.total) || score.total < 0 || score.total > 100) {
    return { ok: false, detail: 'La puntuación de la entrada debe ser un número entre 0 y 100.' };
  }
  if (!isPhase(score.phase)) {
    return { ok: false, detail: 'La fase de la entrada debe ser 1, 2 o 3.' };
  }
  if (!Array.isArray(entry.evidence) || !entry.evidence.every((item) => typeof item === 'string')) {
    return { ok: false, detail: 'La evidencia de la entrada debe ser una lista de cadenas (puede estar vacía).' };
  }
  return {
    ok: true,
    value: {
      kind: entry.kind.trim(),
      summary: entry.summary.trim(),
      score: { total: score.total, phase: score.phase },
      evidence: [...entry.evidence],
    },
  };
};

/**
 * Añadir un hito al final del libro.
 *
 * El `delta` se calcula aquí, contra la ÚLTIMA entrada del libro anterior. Sin entrada previa —o
 * cuando la anterior era ilegible— el delta es 0: no hay movimiento contra nada, y decir lo
 * contrario sería inventar una subida.
 *
 * Nunca lanza. Una entrada inválida no se escribe y se explica por qué. Un libro corrupto no impide
 * registrar: se avisa, se empieza una serie nueva (la anterior no es recuperable, y no se finge que
 * lo es) y el hito queda escrito.
 */
export const recordProgress = async (input: {
  cwd: string;
  entry: Omit<ProgressEntry, 'at' | 'delta'>;
  sddDir?: string;
}): Promise<ProgressRecordResult> => {
  const sddDir = input.sddDir ?? (await resolveSddDir(input.cwd));
  const statePath = progressStatePath(sddDir);

  const validated = validateInput(input.entry);
  if (!validated.ok) return { written: false, entry: null, detail: validated.detail };

  const read = await readProgress(input.cwd, { sddDir });
  const previous = read.corrupt ? null : read.entries[read.entries.length - 1] ?? null;

  const current = validated.value;
  const delta: ProgressEntry['delta'] = previous
    ? {
        score: current.score.total - previous.score.total,
        phase: Math.sign(current.score.phase - previous.score.phase) as 0 | 1 | -1,
      }
    : { score: 0, phase: 0 };

  const entry: ProgressEntry = { at: new Date().toISOString(), ...current, delta };
  // Append-only: la serie anterior se conserva tal cual; solo una lectura corrupta la sustituye.
  const ledger: ProgressLedger = {
    version: PROGRESS_STATE_VERSION,
    entries: [...(read.corrupt ? [] : read.entries), entry],
  };

  try {
    await persist(path.resolve(input.cwd, statePath), ledger);
  } catch (err) {
    return {
      written: false,
      entry: null,
      detail: `El hito no se pudo escribir en ${statePath} (${(err as Error).message}): el libro queda como estaba.`,
    };
  }

  const movement =
    delta.score === 0 && delta.phase === 0
      ? 'sin movimiento (delta 0): la puntuación y la fase no cambiaron, y así se registra'
      : `movimiento calculado contra la entrada anterior: ${delta.score >= 0 ? '+' : ''}${delta.score} punto(s), fase ${delta.phase === 0 ? 'sin cambio' : delta.phase > 0 ? '↑' : '↓'}`;
  const restart = read.corrupt
    ? ` El historial anterior no se pudo interpretar (${read.detail}) y se empieza una SERIE NUEVA: no se rescata historia a medias.`
    : '';

  return {
    written: true,
    entry,
    detail: `Hito registrado en ${statePath}: «${entry.summary}» · ${movement}.${restart}`,
  };
};

const formatAt = (at: string): string => {
  const parsed = Date.parse(at);
  if (!Number.isFinite(parsed)) return at;
  return at.slice(0, 16).replace('T', ' ');
};

const arrow = (phase: 0 | 1 | -1): string => (phase > 0 ? ' ↑' : phase < 0 ? ' ↓' : '');

/**
 * La cronología de una pantalla: `fecha · qué · puntuación con delta · fase`.
 *
 * Se renderiza de lo MÁS RECIENTE a lo más antiguo —el estado actual es lo primero que se lee— y
 * `limit` recorta a los últimos N hitos. No hay cabecera ni adornos: es la lista, y una entrada sin
 * movimiento lo dice (`delta 0 · sin cambios`) en vez de aparentar una subida.
 */
export const renderProgress = (input: { entries: ProgressEntry[]; limit?: number }): string[] => {
  const limit = input.limit ?? DEFAULT_PROGRESS_LIMIT;
  if (limit <= 0) return [];
  const window = input.entries.slice(Math.max(0, input.entries.length - limit));
  return window
    .slice()
    .reverse()
    .map((entry) => {
      const deltaScore = entry.delta.score === 0 ? 'delta 0' : `${entry.delta.score > 0 ? '+' : ''}${entry.delta.score}`;
      const movement = entry.delta.score === 0 && entry.delta.phase === 0 ? ' · sin cambios' : '';
      return `${formatAt(entry.at)} · ${entry.summary} · ${entry.score.total}/100 (${deltaScore}) · Fase ${entry.score.phase}${arrow(entry.delta.phase)}${movement}`;
    });
};
