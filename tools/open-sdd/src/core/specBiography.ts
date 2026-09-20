/**
 * `specBiography` — la biografía de una especificación viva.
 *
 * Las especificaciones son ficheros en git, así que tienen historia, y hasta ahora nadie la
 * mostraba. Este módulo no juzga la especificación: mide su RITMO. Cuándo nació, cuándo se movió
 * por última vez, si el código siguió moviéndose sin ella, qué enmiendas (entradas de la delta)
 * cambiaron su comportamiento y quién ratificó la autoridad contra la que se lee.
 *
 * ── Regla primera: actividad no es calidad ─────────────────────────────────────────────────────
 * Todo lo que viaja aquí viene de git o de los artefactos. No hay narrativa inferida ni prosa sobre
 * «lo que probablemente pasó»: si git no está disponible, se dice y se devuelve `unknown` en vez de
 * adivinar. Y la salida renderizada lleva SIEMPRE una línea que lo declara: una especificación que
 * nunca cambia puede ser correcta, y una que cambia todos los días puede ser un desastre. Medir el
 * ritmo no es medir el contenido.
 *
 * ── La regla de respiración, con sus umbrales ──────────────────────────────────────────────────
 * `breathing` se DERIVA de los números medidos, nunca se afirma sin ellos. En orden:
 *
 *   1. sin git (o spec fuera del árbol de trabajo)            → `unknown`
 *   2. git nunca registró la spec (nacimiento nulo)           → `orphan`
 *   3. el código no se movió desde el nacimiento              → `quiet`
 *   4. código posterior al último cambio de la spec ≥ 3       → `stale` (nombra el número)
 *   5. la spec se escribió una sola vez y el código se movió  → `orphan`
 *   6. ningún commit de código posterior al último de la spec → `alive`
 *   7. proporción de commits de spec ≥ 1/3 del total          → `alive`
 *   8. en otro caso                                           → `quiet`
 *
 * Los dos umbrales son decisiones, no verdades; viven aquí con nombre para poder discutirlos y
 * cambiarlos en un solo sitio, y para que los tests fijen la frontera:
 *
 *   · `STALE_CODE_COMMITS = 3` — un commit aislado puede ser un arreglo que no cambia el contrato;
 *     tres commits de código sin que la especificación se mueva ya son movimiento material, y la
 *     distancia deja de explicarse por el ruido normal del trabajo. Es el mínimo a partir del cual
 *     el silencio de la spec se nombra como `stale` en vez de como una simple pausa.
 *   · `ALIVE_SPEC_SHARE = 1/3` — una de cada tres piezas que se mueven desde el nacimiento es de la
 *     especificación. Por debajo, la spec solo aparece al principio o al final del trabajo.
 *
 * Precedencia deliberada: `stale` gana a `orphan`. Una especificación que nació una vez y vio pasar
 * tres commits de código está huérfana Y desactualizada; el número mayor es la señal más fuerte, así
 * que se nombra como `stale`. `orphan` queda para el abandono temprano (uno o dos commits de código
 * posteriores), donde decir «se quedó huérfana» describe mejor lo que pasó.
 *
 * ── Qué se muestra además del ritmo (el alma de la spec) ───────────────────────────────────────
 *   · las entradas de la delta que la dieron forma, con el comportamiento anterior que reemplazan;
 *   · las ratificaciones de la constitución, con quién y cuándo;
 *   · las fases declaradas en `spec.json` a lo largo de git, más la fase declarada hoy;
 *   · el estado actual que mide `sddScore` (los gates NO se re-ejecutan aquí: se declaran no
 *     medidos, que es lo honesto cuando este módulo no ejecutó la cadena).
 * Si alguna de esas piezas no existe para una feature, se dice; no se omite en silencio.
 *
 * Nota de idioma: los textos visibles son español, como el resto del CLI.
 */

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Constitution } from './constitution.js';
import { deltaSpecFileName, parseDeltaSpec } from './deltaSpec.js';
import { isGitRepo } from './git.js';
import { computeSddScore, type SddPhase } from './sddScore.js';
import { getSpecStatus, readSpecMetadata, resolveSddDir } from './specManager.js';
import { loadConstitution } from './status.js';

/** Cuántos eventos se devuelven por defecto. La actividad se mide sobre la historia completa. */
export const DEFAULT_EVENT_LIMIT = 20;

/**
 * Commits de código posteriores al último cambio de la spec a partir de los cuales el silencio de
 * la especificación es `stale`. Ver la cabecera para la justificación.
 */
export const STALE_CODE_COMMITS = 3;

/**
 * Proporción mínima de commits de spec sobre el total (spec + código) desde el nacimiento para
 * declarar `alive` cuando la spec no va por delante del último commit de código.
 */
export const ALIVE_SPEC_SHARE = 1 / 3;

/** La advertencia que la salida renderizada lleva siempre: ritmo no es calidad. */
export const ACTIVITY_IS_NOT_QUALITY =
  'Esto mide RITMO, no CALIDAD: una especificación que nunca cambia puede ser correcta y una que cambia todos los días puede ser un desastre.';

/** Qué fichero de la spec cambió. `design.md` es alias aceptado de `plan.md` y por eso cuenta como `plan`. */
export type SpecArtifact =
  | 'requirements'
  | 'plan'
  | 'tasks'
  | 'delta'
  | 'spec.json'
  | 'constitution'
  | 'other';

export interface SpecEvent {
  /** ISO-8601 tal y como lo da git (`%aI`). */
  date: string;
  author: string;
  /** SHA corto. */
  commit: string;
  subject: string;
  artifact: SpecArtifact;
  /** Líneas añadidas/quitadas de ESE fichero en ESE commit. */
  added: number;
  removed: number;
}

/** El veredicto de ritmo. Se deriva; nunca se afirma sin los números. */
export type Breathing = 'alive' | 'quiet' | 'stale' | 'orphan' | 'unknown';

/** Una entrada de la delta: la enmienda que dio forma a la spec y lo que reemplazó. */
export interface SpecAmendment {
  id: string;
  kind: string;
  title: string;
  statement: string;
  previous: string | null;
  merged: boolean;
}

/** Una fase declarada en `spec.json` en un commit concreto. */
export interface SpecPhaseEvent {
  date: string;
  commit: string;
  phase: string;
}

/** Una ratificación de la constitución: quién, cuándo y por qué. */
export interface SpecRatification {
  id: string;
  by: string;
  at: string;
  rationale: string;
}

export interface SpecBiography {
  feature: string;
  /** El primer commit que tocó el directorio de la spec. */
  born: string | null;
  lastChange: string | null;
  /** Más reciente primero, acotado por `limit`. */
  events: SpecEvent[];
  /**
   * Commits que tocaron la spec frente al código desde que la spec nació, medidos desde git.
   * `codeCommits` cuenta los commits que no tocaron ni el directorio de la spec ni la constitución
   * (la constitución es autoridad compartida del proyecto, no movimiento de esta feature).
   */
  activity: { specCommits: number; codeCommits: number; sinceDays: number };
  breathing: Breathing;
  breathingReason: string;
  /** Los registros de ratificación de la constitución, cuando existen. */
  ratifications: SpecRatification[];
  detail: string;
  /** True cuando la biografía se pudo medir entera: hay git, la spec nació y no hubo lecturas fallidas. */
  complete: boolean;
  /** Las entradas de la delta con el comportamiento anterior que reemplazaron. */
  amendments: SpecAmendment[];
  /** Las fases por las que pasó el `spec.json` en git, de la más antigua a la más reciente. */
  phaseHistory: SpecPhaseEvent[];
  /** La fase declarada hoy en el `spec.json` de trabajo. */
  currentPhase: string | null;
  /** El estado actual según `sddScore` (gates declarados no medidos: aquí no se ejecuta la cadena). */
  score: { total: number; phase: SddPhase; phaseLabel: string } | null;
  /** Lo que no se pudo leer, dicho explícitamente en vez de omitido. */
  notes: string[];
}

// ---------------------------------------------------------------------------------------------
// git: envoltorio mínimo, sin rebanar rutas (el defecto que `git.ts` acaba de corregir)
// ---------------------------------------------------------------------------------------------

const gitOut = (cwd: string, args: string[]): string | null => {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return out as string;
  } catch {
    return null;
  }
};

const countCommits = (root: string, args: string[]): number => {
  const out = gitOut(root, ['rev-list', '--count', ...args]);
  if (out === null) return 0;
  const n = Number.parseInt(out.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

const toPosix = (value: string): string => value.replace(/\\/g, '/');

/**
 * `--numstat` imprime `añadidas\tquitadas\truta`. En un renombrado git usa `viejo => nuevo` o
 * `{viejo => nuevo}/resto`; se toma la ruta RESULTANTE. Nunca se rebanan columnas fijas: el nombre
 * de fichero puede llevar espacios y una rebanada ciega ya produjo una ruta truncada una vez.
 */
const normalizeNumstatPath = (raw: string): string => {
  if (!raw.includes('=>')) return raw.trim();
  const brace = raw.match(/\{[^{}]*=>\s*([^{}]*)\}/);
  if (brace) return raw.replace(brace[0], brace[1]).replace(/\s+/g, ' ').trim();
  const index = raw.lastIndexOf('=>');
  return raw.slice(index + 2).trim();
};

/** `-` es lo que git imprime para un fichero binario: no son líneas, así que no se inventan. */
const numstatCount = (value: string | undefined): number => {
  if (!value || !/^\d+$/.test(value)) return 0;
  return Number.parseInt(value, 10);
};

const readDeclaredPhase = (content: string): string | null => {
  try {
    const parsed = JSON.parse(content) as { phase?: unknown };
    return typeof parsed.phase === 'string' && parsed.phase.trim().length > 0 ? parsed.phase : null;
  } catch {
    return null;
  }
};

interface TextRead {
  exists: boolean;
  content: string | null;
}

/** Leer un fichero distinguiendo «no existe» de «existe pero no se pudo leer». */
const readText = async (file: string): Promise<TextRead> => {
  try {
    return { exists: true, content: await readFile(file, 'utf8') };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { exists: code !== 'ENOENT' && code !== 'ENOTDIR', content: null };
  }
};

// ---------------------------------------------------------------------------------------------
// El alma de la especificación: delta, ratificaciones
// ---------------------------------------------------------------------------------------------

const collectRatifications = (constitution: Constitution | null): SpecRatification[] => {
  if (!constitution) return [];
  return constitution.amendments
    .filter(
      (amendment) =>
        amendment.status === 'in-force' ||
        amendment.status === 'approved' ||
        (amendment.approvals?.length ?? 0) > 0,
    )
    .map((amendment) => ({
      id: amendment.id,
      // El render de la constitución escribe `by:`/`at:`; `parseConstitution` los devuelve como
      // `proposedBy`/`updatedAt`, y una ratificación de `ratifyDraft`/`promoteAmendment` lleva la
      // huella completa en `approvals`. Se prefieren los campos que el documento sí conserva.
      by: amendment.proposedBy || amendment.approvals?.[0]?.actor || '',
      at: amendment.updatedAt ?? amendment.approvals?.[0]?.at ?? '',
      rationale: amendment.rationale ?? '',
    }));
};

// ---------------------------------------------------------------------------------------------
// El veredicto de ritmo: derivado, con sus umbrales a la vista
// ---------------------------------------------------------------------------------------------

const percent = (value: number): number => Math.round(value * 100);

const decideBreathing = (measured: {
  specCommits: number;
  codeCommits: number;
  codeSinceLastChange: number;
  born: string | null;
}): { breathing: Breathing; reason: string } => {
  const { specCommits, codeCommits, codeSinceLastChange, born } = measured;

  if (born === null) {
    return {
      breathing: 'orphan',
      reason:
        'git nunca ha registrado esta especificación: no hay ni un commit que la contenga, así que no tiene historia que medir.',
    };
  }

  if (codeCommits === 0) {
    return {
      breathing: 'quiet',
      reason: `la especificación tiene ${specCommits} commit(s) y el código ninguno desde el nacimiento: no hay movimiento de código con el que compararla. Quieta, no huérfana.`,
    };
  }

  if (codeSinceLastChange >= STALE_CODE_COMMITS) {
    return {
      breathing: 'stale',
      reason: `el código cambió materialmente desde el último cambio de la especificación: ${codeSinceLastChange} commit(s) posteriores a ese cambio y ninguno la tocó (umbral de ${STALE_CODE_COMMITS}).`,
    };
  }

  if (specCommits <= 1) {
    return {
      breathing: 'orphan',
      reason: `la especificación se escribió una sola vez (${specCommits} commit) y nunca se volvió a tocar, mientras el código se movió ${codeSinceLastChange} commit(s) después: quedó huérfana.`,
    };
  }

  if (codeSinceLastChange === 0) {
    return {
      breathing: 'alive',
      reason: `todo commit de código desde el nacimiento tiene un cambio de la especificación igual de reciente o posterior: se mueven juntos (${specCommits} de spec, ${codeCommits} de código).`,
    };
  }

  const share = specCommits / (specCommits + codeCommits);
  if (share >= ALIVE_SPEC_SHARE) {
    return {
      breathing: 'alive',
      reason: `la especificación acompaña al código en proporción suficiente: ${specCommits} commit(s) de spec frente a ${codeCommits} de código (${percent(share)}%, umbral ${percent(ALIVE_SPEC_SHARE)}%).`,
    };
  }

  return {
    breathing: 'quiet',
    reason: `el código se mueve más que la especificación: ${specCommits} commit(s) de spec frente a ${codeCommits} de código (${percent(share)}%, por debajo del umbral ${percent(ALIVE_SPEC_SHARE)}%) y solo ${codeSinceLastChange} sin tocar la spec: quietud, todavía no desfase material.`,
  };
};

// ---------------------------------------------------------------------------------------------
// La biografía
// ---------------------------------------------------------------------------------------------

export const specBiography = async (input: {
  cwd: string;
  feature: string;
  limit?: number;
  sddDir?: string;
}): Promise<SpecBiography> => {
  const cwd = input.cwd;
  const feature = input.feature;
  const limit = Math.max(1, Math.floor(input.limit ?? DEFAULT_EVENT_LIMIT));
  const sddDir = input.sddDir ?? (await resolveSddDir(cwd, '.sdd'));

  const specDir = path.join(cwd, sddDir, 'specs', feature);
  const notes: string[] = [];

  // ── El alma, leída de los artefactos (no depende de git) ─────────────────────────────────────
  const deltaRead = await readText(path.join(specDir, deltaSpecFileName()));
  const amendments: SpecAmendment[] = deltaRead.content
    ? parseDeltaSpec(deltaRead.content).entries.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        title: entry.title,
        statement: entry.statement,
        previous: entry.previous?.trim() ? entry.previous.trim() : null,
        merged: entry.merged === true,
      }))
    : [];
  if (!deltaRead.exists) {
    notes.push('sin delta.md: no hay enmiendas registradas (que no es lo mismo que «no hubo cambios»).');
  } else if (deltaRead.content === null) {
    notes.push('delta.md existe pero no se pudo leer: las enmiendas no se pueden mostrar.');
  } else if (amendments.length === 0) {
    notes.push('delta.md no declara entradas: no hay enmiendas que mostrar.');
  }

  const constitutionRead = await loadConstitution(cwd, sddDir);
  if (constitutionRead.exists && constitutionRead.constitution === null) {
    notes.push(
      `constitución presente pero ilegible (${constitutionRead.path ?? sddDir}): no se pudo leer el registro de ratificaciones.`,
    );
  }
  const ratifications = collectRatifications(constitutionRead.constitution);

  const metadata = await readSpecMetadata(cwd, feature, sddDir);
  const currentPhase = metadata?.phase ?? null;
  const status = await getSpecStatus(cwd, feature, sddDir);

  // ── Sin git no se mide: se dice y se devuelve unknown ────────────────────────────────────────
  const unknown = (reason: string): SpecBiography => ({
    feature,
    born: null,
    lastChange: null,
    events: [],
    activity: { specCommits: 0, codeCommits: 0, sinceDays: 0 },
    breathing: 'unknown',
    breathingReason: reason,
    ratifications,
    detail: `Biografía de «${feature}»: ritmo NO medido. ${reason}`,
    complete: false,
    amendments,
    phaseHistory: [],
    currentPhase,
    score: null,
    notes,
  });

  if (!isGitRepo(cwd)) {
    return unknown(
      'no es un repositorio git (o git no está disponible): sin historia no se puede medir el ritmo y no se adivina.',
    );
  }

  const root = gitOut(cwd, ['rev-parse', '--show-toplevel'])?.trim();
  if (!root) {
    return unknown('git está presente pero no se pudo resolver la raíz del repositorio: no hay historia que leer.');
  }

  const specAbs = path.resolve(cwd, specDir);
  const specRel = toPosix(path.relative(root, specAbs));
  if (!specRel || specRel.startsWith('..') || path.isAbsolute(specRel)) {
    return unknown(
      'el directorio de la especificación queda fuera del árbol de trabajo de git: no hay historia que medir para esta feature.',
    );
  }

  const constitutionRels = [
    toPosix(path.join(sddDir, 'steering', 'constitution.md')),
    toPosix(path.join(sddDir, 'constitution.md')),
  ];
  const specSystemPaths = [specRel, ...constitutionRels];

  // ── Nacimiento y último cambio ───────────────────────────────────────────────────────────────
  const bornLog = gitOut(root, ['log', '--reverse', '--format=%H|%h|%aI', '--', specRel]);
  const bornLine = bornLog?.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? null;
  const bornSha = bornLine?.split('|')[0] ?? null;
  const born = bornLine?.split('|')[2] ?? null;

  const lastLine =
    gitOut(root, ['log', '-n', '1', '--format=%H|%h|%aI', '--', specRel])
      ?.split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? null;
  const lastSha = lastLine?.split('|')[0] ?? null;
  const lastChange = lastLine?.split('|')[2] ?? null;

  // ── Actividad: spec vs código desde el nacimiento ────────────────────────────────────────────
  let activity = { specCommits: 0, codeCommits: 0, sinceDays: 0 };
  let codeSinceLastChange = 0;
  if (bornSha) {
    const headCount = countCommits(root, ['HEAD']);
    const hasParent = gitOut(root, ['rev-parse', '--verify', '--quiet', `${bornSha}^`]) !== null;
    const beforeBorn = hasParent ? countCommits(root, [`${bornSha}^`]) : 0;
    const sinceBorn = Math.max(0, headCount - beforeBorn);
    const specSystemSinceBorn = hasParent
      ? countCommits(root, [`${bornSha}^..HEAD`, '--', ...specSystemPaths])
      : countCommits(root, ['HEAD', '--', ...specSystemPaths]);
    const specCommits = countCommits(root, ['HEAD', '--', specRel]);
    const codeCommits = Math.max(0, sinceBorn - specSystemSinceBorn);
    const parsedBorn = born ? Date.parse(born) : Number.NaN;
    const sinceDays = Number.isFinite(parsedBorn)
      ? Math.max(0, Math.floor((Date.now() - parsedBorn) / 86_400_000))
      : 0;
    activity = { specCommits, codeCommits, sinceDays };
    if (lastSha) codeSinceLastChange = countCommits(root, [`${lastSha}..HEAD`]);
  }

  // ── Eventos: un evento por fichero cambiado y commit, más reciente primero ────────────────────
  const classify = (file: string): SpecArtifact | null => {
    const rel = normalizeNumstatPath(toPosix(file));
    if (constitutionRels.includes(rel)) return 'constitution';
    if (rel !== specRel && !rel.startsWith(`${specRel}/`)) return null;
    const base = rel.slice(rel.lastIndexOf('/') + 1);
    if (base === 'requirements.md') return 'requirements';
    if (base === 'plan.md' || base === 'design.md') return 'plan';
    if (base === 'tasks.md') return 'tasks';
    if (base === deltaSpecFileName()) return 'delta';
    if (base === 'spec.json') return 'spec.json';
    return 'other';
  };

  const log = gitOut(root, [
    'log',
    '-n',
    String(limit),
    '--date=iso-strict',
    '--format=@@%H|%h|%aI|%an|%s',
    '--numstat',
    '--',
    ...specSystemPaths,
  ]);

  const allEvents: SpecEvent[] = [];
  let current: { date: string; author: string; commit: string; subject: string } | null = null;
  for (const raw of (log ?? '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('@@')) {
      const [full, short, date, author, ...subjectParts] = line.slice(2).split('|');
      current = {
        date: date ?? '',
        author: author ?? '',
        commit: short ?? full ?? '',
        subject: subjectParts.join('|'),
      };
      continue;
    }
    if (!current || line.trim().length === 0) continue;
    const columns = line.split('\t');
    if (columns.length < 3) continue;
    const artifact = classify(columns.slice(2).join('\t'));
    if (!artifact) continue;
    allEvents.push({
      date: current.date,
      author: current.author,
      commit: current.commit,
      subject: current.subject,
      artifact,
      added: numstatCount(columns[0]),
      removed: numstatCount(columns[1]),
    });
  }
  const events = allEvents.slice(0, limit);

  // ── Fases declaradas a lo largo de git ───────────────────────────────────────────────────────
  const phaseHistory: SpecPhaseEvent[] = [];
  const seenCommits = new Set<string>();
  for (const event of events) {
    if (event.artifact !== 'spec.json' || seenCommits.has(event.commit)) continue;
    seenCommits.add(event.commit);
    const content = gitOut(root, ['show', `${event.commit}:${specRel}/spec.json`]);
    if (content === null) continue;
    const phase = readDeclaredPhase(content);
    if (phase) phaseHistory.push({ date: event.date, commit: event.commit, phase });
  }
  phaseHistory.reverse();

  const decision = decideBreathing({
    specCommits: activity.specCommits,
    codeCommits: activity.codeCommits,
    codeSinceLastChange,
    born,
  });

  // ── Estado actual según sddScore: los gates NO se re-ejecutan aquí ───────────────────────────
  let score: SpecBiography['score'] = null;
  if (status.exists) {
    try {
      const report = await computeSddScore(cwd, { feature, sddDir, gateContext: 'external' });
      score = { total: report.total, phase: report.phase, phaseLabel: report.phaseLabel };
    } catch (err) {
      notes.push(`el estado actual no se pudo medir (${(err as Error).message}).`);
      score = null;
    }
  }

  const complete = born !== null && notes.length === 0;
  const detail = `Biografía de «${feature}»: ${activity.specCommits} commit(s) de spec frente a ${activity.codeCommits} de código en ${activity.sinceDays} día(s) desde el nacimiento · respiración ${decision.breathing}.`;

  return {
    feature,
    born,
    lastChange,
    events,
    activity,
    breathing: decision.breathing,
    breathingReason: decision.reason,
    ratifications,
    detail,
    complete,
    amendments,
    phaseHistory,
    currentPhase,
    score,
    notes,
  };
};

// ---------------------------------------------------------------------------------------------
// Render: texto plano, honesto, sin adjetivos que no estén respaldados por un número
// ---------------------------------------------------------------------------------------------

const renderAmendment = (amendment: SpecAmendment): string => {
  if (amendment.previous) {
    return `  - ${amendment.id} [${amendment.kind}] ${amendment.title} — reemplaza: ${amendment.previous}${amendment.merged ? ' (fusionada en la base)' : ''}`;
  }
  if (amendment.kind === 'ADDED') {
    return `  - ${amendment.id} [${amendment.kind}] ${amendment.title} — comportamiento nuevo, no reemplaza nada${amendment.merged ? ' (fusionada en la base)' : ''}`;
  }
  return `  - ${amendment.id} [${amendment.kind}] ${amendment.title} — sin comportamiento anterior declarado${amendment.merged ? ' (fusionada en la base)' : ''}`;
};

export const renderBiography = (bio: SpecBiography): string[] => {
  const lines: string[] = [];

  lines.push(`Biografía de la especificación «${bio.feature}»`);
  lines.push(
    `Nacimiento: ${bio.born ?? '(git nunca registró esta especificación)'} · Último cambio: ${bio.lastChange ?? '(sin cambios registrados)'}`,
  );
  lines.push(
    `Actividad: ${bio.activity.specCommits} commit(s) de la spec · ${bio.activity.codeCommits} commit(s) de código · ${bio.activity.sinceDays} día(s) desde el nacimiento`,
  );
  lines.push(`Respiración: ${bio.breathing} — ${bio.breathingReason}`);
  lines.push('');
  lines.push(bio.detail);
  lines.push(ACTIVITY_IS_NOT_QUALITY);
  lines.push('');

  lines.push('Enmiendas (entradas de la delta y el comportamiento que reemplazaron)');
  if (bio.amendments.length === 0) {
    lines.push('  (sin enmiendas registradas para esta especificación)');
  } else {
    for (const amendment of bio.amendments) lines.push(renderAmendment(amendment));
  }
  lines.push('');

  lines.push('Ratificaciones (quién ratificó, cuándo y por qué)');
  if (bio.ratifications.length === 0) {
    lines.push('  (ninguna ratificación registrada en la constitución)');
  } else {
    for (const ratification of bio.ratifications) {
      const at = ratification.at || '(sin fecha registrada)';
      const by = ratification.by || '(sin ratificador registrado)';
      const rationale = ratification.rationale ? ` · ${ratification.rationale}` : '';
      lines.push(`  - ${ratification.id} · por ${by} · ${at}${rationale}`);
    }
  }
  lines.push('');

  lines.push('Fases declaradas en spec.json a lo largo de git');
  if (bio.phaseHistory.length === 0) {
    lines.push('  (sin historial de fases: ningún commit de esta spec contiene un spec.json con fase)');
  } else {
    for (const phase of bio.phaseHistory) lines.push(`  - ${phase.date} · ${phase.commit} · ${phase.phase}`);
  }
  lines.push(`  Fase declarada hoy (spec.json de trabajo): ${bio.currentPhase ?? '(sin spec.json)'}`);
  if (bio.score) {
    lines.push(
      `  Estado actual (sddScore): ${bio.score.total}% · ${bio.score.phaseLabel} (los gates no se re-ejecutan aquí; el pie de puntuación del comando es la medición completa).`,
    );
  } else {
    lines.push('  Estado actual (sddScore): no medido en esta biografía.');
  }
  lines.push('');

  lines.push(`Eventos (${bio.events.length}, más reciente primero)`);
  if (bio.events.length === 0) {
    lines.push('  (sin eventos: git no tiene historia de esta especificación)');
  } else {
    for (const event of bio.events) {
      lines.push(
        `  ${event.date} · ${event.commit} · ${event.author} · ${event.artifact} +${event.added}/-${event.removed} · ${event.subject}`,
      );
    }
  }

  if (bio.notes.length > 0) {
    lines.push('');
    lines.push('Notas de lectura (lo que no se pudo leer, dicho en vez de omitido)');
    for (const note of bio.notes) lines.push(`  - ${note}`);
  }

  return lines;
};
