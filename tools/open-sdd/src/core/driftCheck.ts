/**
 * El centinela de drift: ¿cada ruta que cambió está cubierta por algún requisito declarado?
 *
 * ── Qué añade esto a lo que ya existía ────────────────────────────────────────────────────────
 * `rigor.ts` ya detectaba *drift ambiental* (código movido fuera de los límites declarados) con
 * `auditEngine`. Lo que faltaba es el binding explícito —qué globs reclama cada requisito— y el
 * canal para aceptar un cambio fuera de cobertura a sabiendas: un waiver con motivo, dueño y
 * caducidad, igual que la lista de excepciones de seguridad.
 *
 * ── Las tres reglas que lo mantienen honesto ───────────────────────────────────────────────────
 *  1. NO INVENTA COBERTURA. Un fichero se declara cubierto solo si el glob de un requisito lo toca;
 *     el resto es `uncovered`, y `coveredBy` nombra los ids que sí lo cubren.
 *  2. UN WAIVER CADUCADO NO CUBRE. Vuelve como `expired-waiver` nombrando a quién preguntar, para que
 *     el gate falle diciendo con quién hablar y no simplemente que algo falló.
 *  3. SIN CONJUNTO DE FICHEROS NO HAY VEREDICTO. Sin ficheros cambiados conocidos el informe viaja
 *     con un `problem`, no con un «sin drift» que sería un aprobado por no haber mirado.
 *
 * El binding sale de donde ya vive: `_Requirements:_` y `_Boundary:_` de cada tarea. Declararlo en un
 * registro aparte sería un segundo lugar que se desincroniza del primero.
 */

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const DRIFT_WAIVERS_FILE = '.sdd/settings/drift-waivers.json';

export interface DriftBinding {
  feature: string;
  /** Ids de requisito que esta tarea declara cubrir. */
  ids: string[];
  /** Globs declarados en `_Boundary:_`. */
  globs: string[];
}

export interface DriftWaiver {
  /** Ruta o glob eximido. */
  path: string;
  reason: string;
  owner?: string;
  expires?: string;
}

export type DriftState = 'covered' | 'uncovered' | 'waived' | 'expired-waiver';

export interface DriftFinding {
  file: string;
  state: DriftState;
  coveredBy: string[];
  waiver?: DriftWaiver;
}

export interface DriftReport {
  bindings: number;
  files: number;
  findings: DriftFinding[];
  uncovered: number;
  waived: number;
  expired: number;
  problems: string[];
}

/** Un glob de ruta a expresión regular. `**` cruza directorios; `*` y `?` no. */
export const matchesGlob = (file: string, glob: string): boolean => {
  const target = file.split(path.sep).join('/').replace(/^\.\//, '');
  const pattern = glob.split(path.sep).join('/').replace(/^\.\//, '');
  let out = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        out += '.*';
        index += 1;
        if (pattern[index + 1] === '/') index += 1;
      } else {
        out += '[^/]*';
      }
    } else if (char === '?') {
      out += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(char)) {
      out += `\\${char}`;
    } else {
      out += char;
    }
  }
  if (new RegExp(`^${out}$`).test(target)) return true;
  // Un glob de directorio (`tools/core`) cubre también lo que hay debajo.
  return new RegExp(`^${out}/`).test(target);
};

// `\b` no sirve aquí: `_Requirements: REQ-STD-003_` termina en guion bajo, que es carácter de
// palabra, así que el límite de palabra nunca cierra y el id se perdía en silencio.
const REQUIREMENT_ID = /(?<![A-Za-z0-9])REQ-[A-Z0-9]+-\d{3,}(?![0-9A-Za-z])/g;

/**
 * Deriva los bindings de un `tasks.md`. Se parte la línea por el separador de atributos en vez de
 * cortar en el primer `_`: una ruta con guion bajo (`.../agents/_shared/...`) truncaría la
 * declaración entera, que es un defecto ya visto en el parser de fronteras.
 */
export const parseDriftBindings = (feature: string, tasksText: string): DriftBinding[] => {
  const bindings: DriftBinding[] = [];
  for (const rawLine of tasksText.split(/\r?\n/)) {
    if (!/^\s*-\s*\[[ xX-]\]/.test(rawLine)) continue;
    const segments = rawLine.split('—');
    const requirementSegment = segments.find((segment) => segment.includes('_Requirements:'));
    const boundarySegment = segments.find((segment) => segment.includes('_Boundary:'));
    const ids = requirementSegment ? [...requirementSegment.matchAll(REQUIREMENT_ID)].map((match) => match[0]) : [];
    const globs = boundarySegment ? [...boundarySegment.matchAll(/`([^`]+)`/g)].map((match) => match[1]) : [];
    if (ids.length === 0 && globs.length === 0) continue;
    bindings.push({ feature, ids: [...new Set(ids)], globs: [...new Set(globs)] });
  }
  return bindings;
};

export const collectDriftBindings = async (
  cwd: string,
  sddDir: string,
): Promise<{ bindings: DriftBinding[]; problems: string[] }> => {
  const problems: string[] = [];
  const specsDir = path.join(cwd, sddDir, 'specs');
  if (!existsSync(specsDir)) {
    return { bindings: [], problems: [`no existe ${sddDir}/specs: no hay requisitos que declaren cobertura.`] };
  }
  const features = await readdir(specsDir, { withFileTypes: true }).catch(() => []);
  const bindings: DriftBinding[] = [];
  for (const entry of features) {
    if (!entry.isDirectory()) continue;
    const tasks = await readFile(path.join(specsDir, entry.name, 'tasks.md'), 'utf8').catch(() => null);
    if (tasks === null) {
      problems.push(`${entry.name}: sin tasks.md, así que no declara fronteras.`);
      continue;
    }
    bindings.push(...parseDriftBindings(entry.name, tasks));
  }
  return { bindings, problems };
};

export const readDriftWaivers = async (cwd: string): Promise<{ waivers: DriftWaiver[]; problem: string | null }> => {
  const file = path.join(cwd, DRIFT_WAIVERS_FILE);
  if (!existsSync(file)) return { waivers: [], problem: null };
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { allow?: unknown };
    const rows = Array.isArray(parsed?.allow) ? parsed.allow : [];
    const waivers: DriftWaiver[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const candidate = row as Partial<DriftWaiver>;
      if (typeof candidate.path !== 'string' || typeof candidate.reason !== 'string') continue;
      waivers.push({
        path: candidate.path,
        reason: candidate.reason,
        ...(candidate.owner ? { owner: candidate.owner } : {}),
        ...(candidate.expires ? { expires: candidate.expires } : {}),
      });
    }
    return { waivers, problem: null };
  } catch (error) {
    return {
      waivers: [],
      problem: `${DRIFT_WAIVERS_FILE} no se pudo leer (${String(error)}): se ignora y ningún waiver se aplica.`,
    };
  }
};

/** Una fecha sin hora vale para todo el día; una fecha ilegible no se declara caducada. */
export const isExpiredWaiver = (expires: string | undefined, now: Date): boolean => {
  if (!expires || !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return false;
  const end = new Date(`${expires}T23:59:59.999Z`);
  return end.getTime() < now.getTime();
};

/** El chequeo puro: ficheros contra bindings y waivers. No toca el disco y no lanza. */
export const checkDrift = (input: {
  files: readonly string[];
  bindings: readonly DriftBinding[];
  waivers?: readonly DriftWaiver[];
  now?: Date;
  problems?: readonly string[];
}): DriftReport => {
  const now = input.now ?? new Date();
  const waivers = input.waivers ?? [];
  const findings: DriftFinding[] = [];

  for (const file of input.files) {
    const coveredBy = [
      ...new Set(
        input.bindings
          .filter((binding) => binding.globs.some((glob) => matchesGlob(file, glob)))
          .flatMap((binding) => binding.ids),
      ),
    ];
    if (coveredBy.length > 0) {
      findings.push({ file, state: 'covered', coveredBy });
      continue;
    }
    const waiver = waivers.find((candidate) => matchesGlob(file, candidate.path));
    if (waiver) {
      findings.push({
        file,
        state: isExpiredWaiver(waiver.expires, now) ? 'expired-waiver' : 'waived',
        coveredBy: [],
        waiver,
      });
      continue;
    }
    findings.push({ file, state: 'uncovered', coveredBy: [] });
  }

  return {
    bindings: input.bindings.length,
    files: input.files.length,
    findings,
    uncovered: findings.filter((finding) => finding.state === 'uncovered').length,
    waived: findings.filter((finding) => finding.state === 'waived').length,
    expired: findings.filter((finding) => finding.state === 'expired-waiver').length,
    problems: [...(input.problems ?? [])],
  };
};
