/**
 * Análisis de impacto del cambio («SDD en Proyectos Brownfield», §5.2).
 *
 * El documento de investigación exige que un cambio identifique, antes de ejecutarse: componentes
 * afectados, cambios incompatibles, actualizaciones del grafo de dependencias, puntos de integración,
 * impacto en migraciones de base de datos y compatibilidad de la API pública. El propósito es el
 * patrón de estrangulamiento: mover una pieza del sistema legado al nuevo es una PROPUESTA DE CAMBIO,
 * nunca una reescritura. Y una propuesta de cambio que no puede decir a qué alcanza no es revisable.
 *
 * ── La fila que este módulo no puede falsear ────────────────────────────────────────────────────
 * `blastRadius` es la fila peligrosa. Un analizador que no consigue leer los directorios de código
 * fuente y aun así informa «radio de impacto: 0» está mintiendo con la misma cara que un gate que
 * aprueba lo que no inspeccionó. Por eso, cuando los directorios no se pueden recorrer, el informe
 * sale con `complete: false` y un aviso que lo dice, en lugar de un número pequeño y falso.
 *
 * ── Qué reutiliza y qué no ──────────────────────────────────────────────────────────────────────
 * `scanProject` aporta los directorios de fuente y los módulos; `collectRepoFacts` aporta los hechos
 * que ya sabe detectar (directorios de migración, contrapartes de rollback, puntos de entrada de la
 * API pública y ficheros de configuración/puntos de integración). No se duplica ninguno de esos
 * detectores. Lo que sí es propio de este módulo es el grafo de importaciones: ningún módulo
 * existente resuelve especificadores de import a ficheros del repositorio.
 *
 * Los textos visibles para el usuario son español, como el resto del CLI.
 */

import { spawnSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { buildModuleMap } from './bootstrap.js';
import type { DeltaSpec } from './deltaSpec.js';
import { findReuseCandidates, type ReuseCandidate } from './reuseFirst.js';
import { scanProject } from './reverseEngineering.js';
import { collectRepoFacts, type RepoFacts } from './reverseConstitution.js';

export type ImpactArea = 'components' | 'breaking' | 'dependencies' | 'integration' | 'database' | 'api';

export interface ImpactFinding {
  area: ImpactArea;
  severity: 'error' | 'warning' | 'info';
  message: string;              // Spanish, user-visible
  artifacts: string[];          // paths/symbols the finding is about
}

export interface ChangeImpactReport {
  feature?: string;
  findings: ImpactFinding[];
  /** Files/modules that import or depend on the changed files. */
  dependents: { file: string; imports: string[] }[];
  breakingChanges: { file: string; symbol: string; reason: string }[];
  integrationPoints: string[];
  migrations: { path: string; hasRollback: boolean }[];
  apiSurface: { file: string; symbols: string[] }[];
  /** How many files the change can reach, directly or through the dependency graph. */
  blastRadius: number;
  /** True when nothing that should have been inspected could not be. */
  complete: boolean;
  detail: string;
}

export interface ChangeImpactInput {
  cwd: string;
  changedFiles: string[];
  delta?: DeltaSpec;
  /** Exported symbols that existed before the change, when the caller knows them. */
  previousExports?: { file: string; symbols: string[] }[];
  /** Max depth when walking importers. Default 3. */
  maxDepth?: number;
}

// ---------------------------------------------------------------------------------------------
// Rutas: normalización y comparación
// ---------------------------------------------------------------------------------------------

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|kt|rs|vue|svelte)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.turbo']);

/** Posix, sin `./` inicial y sin separadores de Windows. */
const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');

/** Ruta sin extensión conocida. */
const stem = (p: string): string => norm(p).replace(SOURCE_EXT, '');

/** Clave de comparación de módulo: `src/a/index.ts` y `src/a.ts` son el mismo módulo. */
const canon = (p: string): string => stem(p).replace(/\/index$/, '');

/** ¿`file` vive dentro del directorio `dir` (o es el propio directorio)? */
const isInside = (file: string, dir: string): boolean => {
  const f = canon(file);
  const d = canon(dir);
  return f === d || f.startsWith(`${d}/`);
};

// ---------------------------------------------------------------------------------------------
// Extracción de exportaciones e importaciones (sintaxis ligera y deliberadamente conservadora)
// ---------------------------------------------------------------------------------------------

const EXPORT_PATTERNS: RegExp[] = [
  /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+default\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s*\{([^}]*)\}/g,
  /\bexport\s+type\s*\{([^}]*)\}/g,
];

/**
 * Nombres exportados por un fichero.
 *
 * Deliberadamente ESTRICTO: solo cuenta lo que se declara `export`. Una declaración sin `export` no
 * es superficie pública, y tratarla como si lo fuera ocultaría el peor cambio incompatible posible
 * —retirar el `export` dejando el símbolo en el fichero— que es justo lo que hay que detectar.
 */
export const extractExportNames = (content: string): string[] => {
  const names = new Set<string>();
  for (const pattern of EXPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      // `match[1]` es un nombre en las dos primeras formas y el interior de las llaves en la tercera
      // (`export { a, b as c }`), que puede llegar con espacios alrededor.
      const captured = match[1].trim();
      if (captured.includes(',') || captured.includes(' as ') || /\s/.test(captured)) {
        // `export { a, b as c }`: cada miembro por separado.
        for (const member of captured.split(',')) {
          const alias = member.includes(' as ') ? member.split(' as ')[1] : member;
          const clean = alias.replace(/^\s*type\s+/, '').trim();
          if (/^[A-Za-z_$][\w$]*$/.test(clean)) names.add(clean);
        }
        continue;
      }
      if (captured === 'default') {
        names.add('default');
        continue;
      }
      if (/^[A-Za-z_$][\w$]*$/.test(captured)) names.add(captured);
    }
  }
  if (/\bexport\s+default\b/.test(content)) names.add('default');
  return Array.from(names).sort();
};

const IMPORT_PATTERNS: RegExp[] = [
  /\bimport\s+(?:type\s+)?[^'"\n]*?from\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /^\s*from\s+([A-Za-z_][\w.]*)\s+import\b/gm,
  /\bexport\s+[^'"\n]*?from\s*['"]([^'"]+)['"]/g,
];

/** Especificadores importados por un fichero (`./x.js`, `../core/y`, `pkg`, `pkg.mod`). */
export const extractImportSpecifiers = (content: string): string[] => {
  const specs = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const spec = match[1].trim();
      if (spec) specs.add(spec);
    }
  }
  return Array.from(specs);
};

// ---------------------------------------------------------------------------------------------
// Recorrido del código fuente
// ---------------------------------------------------------------------------------------------

interface ScannedSource {
  /** Ruta relativa al cwd, posix. */
  path: string;
  content: string;
}

interface SourceWalk {
  files: ScannedSource[];
  /** Directorios o ficheros que existían y no se pudieron leer: la razón de `complete: false`. */
  unreadable: { path: string; reason: string }[];
  truncated: boolean;
}

const MAX_WALK_DEPTH = 8;
const MAX_WALK_FILES = 4000;

const walkSources = async (cwd: string, dirs: string[]): Promise<SourceWalk> => {
  const files: ScannedSource[] = [];
  const unreadable: { path: string; reason: string }[] = [];
  let truncated = false;

  const walk = async (rel: string, depth: number): Promise<void> => {
    if (truncated || depth > MAX_WALK_DEPTH) return;
    let entries;
    try {
      entries = await readdir(path.join(cwd, rel), { withFileTypes: true });
    } catch (err) {
      unreadable.push({ path: rel, reason: (err as Error).message });
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(child, depth + 1);
      } else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
        if (files.length >= MAX_WALK_FILES) {
          truncated = true;
          return;
        }
        try {
          files.push({ path: norm(child), content: await readFile(path.join(cwd, child), 'utf8') });
        } catch (err) {
          unreadable.push({ path: norm(child), reason: (err as Error).message });
        }
      }
    }
  };

  for (const dir of dirs) await walk(norm(dir), 0);
  return { files, unreadable, truncated };
};

// ---------------------------------------------------------------------------------------------
// Grafo de dependencias
// ---------------------------------------------------------------------------------------------

/**
 * Resolver un especificador de import a módulos del repositorio.
 *
 * Dos formas, que cubren lo que aparece en un repositorio real:
 *  - relativo (`./x.js`, `../core/y`): se resuelve contra el directorio del importador;
 *  - no relativo (paquete o alias de tsconfig, `core/auth.js`): se compara por cola de ruta contra
 *    los ficheros escaneados.
 *
 * Un especificador que no resuelve a ningún fichero del repositorio es una dependencia externa o un
 * import roto: no se inventa un destino, y por tanto no se cuenta en el radio de impacto.
 */
const resolveSpecifier = (importer: string, specifier: string, canonFiles: string[]): string[] => {
  const spec = norm(specifier);
  if (!spec) return [];

  if (spec.startsWith('.')) {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), spec));
    const target = canon(base);
    return canonFiles.filter((f) => f === target);
  }

  const specCanon = canon(spec);
  return canonFiles.filter((f) => f === specCanon || f.endsWith(`/${specCanon}`));
};

interface DependencyGraph {
  /** target -> ficheros escaneados que lo importan. Las claves son rutas canónicas (sin extensión). */
  importers: Map<string, string[]>;
  /** fichero escaneado -> módulos que importa. */
  imports: Map<string, string[]>;
  /** Clave canónica -> ruta real del fichero, para que el informe cite rutas abribles. */
  paths: Map<string, string>;
}

const buildDependencyGraph = (files: ScannedSource[]): DependencyGraph => {
  const canonFiles = Array.from(new Set(files.map((f) => canon(f.path))));
  const importers = new Map<string, string[]>();
  const imports = new Map<string, string[]>();
  const paths = new Map<string, string>();

  for (const file of files) {
    const own = canon(file.path);
    paths.set(own, file.path);
    const resolved = new Set<string>();
    for (const spec of extractImportSpecifiers(file.content)) {
      for (const target of resolveSpecifier(file.path, spec, canonFiles)) resolved.add(target);
    }
    imports.set(own, Array.from(resolved).sort());
    for (const target of resolved) {
      const list = importers.get(target) ?? [];
      list.push(own);
      importers.set(target, list);
    }
  }

  return { importers, imports, paths };
};

interface Reachability {
  /** Ficheros alcanzados (sin contar las semillas), con los módulos por los que dependen del cambio. */
  dependents: Map<string, Set<string>>;
  blastRadius: number;
}

/**
 * Recorrer el grafo hacia arriba (importadores) hasta `maxDepth`.
 *
 * `blastRadius` cuenta los ficheros ALCANZADOS DISTINTOS, excluyendo los propios ficheros cambiados:
 * contarlos inflaría el radio con el cambio mismo, que el llamante ya conoce.
 */
const walkImporters = (
  graph: DependencyGraph,
  seeds: string[],
  maxDepth: number,
): Reachability => {
  const seedSet = new Set(seeds.map(canon));
  const dependents = new Map<string, Set<string>>();
  let frontier = Array.from(seedSet);

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const target of frontier) {
      for (const importer of graph.importers.get(target) ?? []) {
        if (seedSet.has(importer)) continue;
        const via = dependents.get(importer) ?? new Set<string>();
        via.add(target);
        dependents.set(importer, via);
        if (!next.includes(importer)) next.push(importer);
      }
    }
    frontier = next;
  }

  return { dependents, blastRadius: dependents.size };
};

// ---------------------------------------------------------------------------------------------
// Migraciones
// ---------------------------------------------------------------------------------------------

const normalizeMigrationStem = (p: string): string =>
  path.posix
    .basename(stem(p))
    .toLowerCase()
    .replace(/(down|rollback|revert)/g, '')
    .replace(/[^a-z0-9]/g, '');

/**
 * ¿Tiene esta migración una contraparte de reversión en el mismo directorio?
 *
 * Se compara el nombre normalizado sin el token down/rollback/revert: así
 * `20240101_add_users.sql` empareja con `20240101_add_users.down.sql` y con `down_add_users.sql`,
 * pero no con la reversión de OTRA migración del mismo directorio. La comprobación burda («hay algún
 * fichero down en el directorio») daría por reversible una migración que no lo es.
 */
const hasRollbackCounterpart = (file: string, rollbackFiles: string[]): boolean => {
  const target = normalizeMigrationStem(file);
  const dir = path.posix.dirname(norm(file));
  return rollbackFiles.some((candidate) => {
    if (path.posix.dirname(norm(candidate)) !== dir) return false;
    const rollback = normalizeMigrationStem(candidate);
    if (!rollback) return false;
    return rollback === target || (rollback.length >= 4 && (target.includes(rollback) || rollback.includes(target)));
  });
};

/**
 * Plan de reversión DENTRO del propio fichero (Knex/Sequelize `exports.down`, Rails/Alembic
 * `def down`/`def downgrade`, Flyway `-- +migrate Down`). Sin esto, una migración perfectamente
 * reversible se reportaría como error solo porque su rollback no vive en otro fichero.
 */
const INLINE_ROLLBACK: RegExp[] = [
  /\bexports\.down\b/,
  /\bmodule\.exports\s*=\s*\{[^}]*\bdown\b/s,
  /\bexport\s+(?:async\s+)?(?:function|const|let|var)\s+down\b/,
  /\bdef\s+(?:down|downgrade)\b/,
  /\bfunc\s+(?:Down|Downgrade)\b/,
  /\bfunction\s+down\s*\(/,
  /\bdown\s*:\s*(?:async\s*)?\(/,
  /--\s*\+?migrate\s+Down\b/i,
];

// ---------------------------------------------------------------------------------------------
// Objetivos de la delta
// ---------------------------------------------------------------------------------------------

const isIdentifierTarget = (target: string): boolean => /^[A-Za-z_$][\w$]*$/.test(target);

/** ¿Un objetivo declarado en la delta corresponde a este fichero cambiado? */
const targetMatchesFile = (file: string, target: string, exportsOfFile: string[]): boolean => {
  const t = norm(target).trim();
  if (!t) return false;
  const f = norm(file);
  if (f === t || f.endsWith(`/${t}`) || canon(f) === canon(t)) return true;
  if (f.split('/').includes(t)) return true;
  if (stem(path.posix.basename(f)) === t) return true;
  if (isIdentifierTarget(t) && exportsOfFile.includes(t)) return true;
  return false;
};

/**
 * Existencia de una ruta en la revisión anterior (HEAD).
 *
 * `null` significa «no se pudo determinar» (git no disponible, `cwd` fuera de un repositorio o HEAD
 * ilegible). El análisis no convierte esa ignorancia en una violación: solo exige `previous` cuando
 * sabe que había un contrato previo que sustituir.
 */
const makeHeadProbe = (cwd: string): ((relPath: string) => boolean | null) => {
  const prefix = spawnSync('git', ['rev-parse', '--show-prefix'], { cwd, encoding: 'utf8' });
  const available = !prefix.error && prefix.status === 0;
  const repoPrefix = available ? prefix.stdout.trim() : '';
  const cache = new Map<string, boolean | null>();
  return (relPath: string): boolean | null => {
    if (!available) return null;
    const key = norm(relPath);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const probe = spawnSync('git', ['cat-file', '-e', `HEAD:${repoPrefix}${key}`], { cwd, encoding: 'utf8' });
    const value = probe.error ? null : probe.status === 0;
    cache.set(key, value);
    return value;
  };
};

/** Cómo se interpretó un objetivo de la delta: ruta de fichero o directorio que cubre lo de debajo. */
interface TargetShape {
  kind: 'directory' | 'file';
  /** Para un directorio: ruta normalizada sin la barra final. */
  dir?: string;
}

/**
 * ¿El objetivo nombra un directorio o un fichero?
 *
 * Un objetivo sin extensión (`LICENSE`, `Makefile`) NO es un directorio por ese solo hecho. Se trata
 * como directorio cuando termina en `/`, cuando `stat` confirma que lo es, o cuando algún fichero
 * cambiado vive debajo. En cualquier otro caso es una ruta de fichero y se exige coincidencia exacta.
 */
const classifyTarget = async (
  cwd: string,
  target: string,
  changedCanon: string[],
): Promise<TargetShape> => {
  const t = norm(target).trim();
  if (!t) return { kind: 'file' };
  if (t.endsWith('/')) return { kind: 'directory', dir: t.replace(/\/+$/, '') };
  try {
    if ((await stat(path.join(cwd, t))).isDirectory()) return { kind: 'directory', dir: t };
  } catch {
    // No existe en el árbol de trabajo: decide si algún fichero cambiado vive debajo.
  }
  const prefix = `${canon(t)}/`;
  if (changedCanon.some((file) => file.startsWith(prefix))) return { kind: 'directory', dir: t };
  return { kind: 'file' };
};

/** Clasifica cada objetivo distinto de la delta una sola vez por análisis. */
const classifyDeltaTargets = async (
  cwd: string,
  delta: DeltaSpec,
  changedFiles: string[],
): Promise<Map<string, TargetShape>> => {
  const changedCanon = changedFiles.map(canon);
  const shapes = new Map<string, TargetShape>();
  for (const entry of delta.entries) {
    for (const target of entry.targets) {
      const key = norm(target).trim();
      if (!key || shapes.has(key)) continue;
      shapes.set(key, await classifyTarget(cwd, key, changedCanon));
    }
  }
  return shapes;
};

/**
 * ¿Este objetivo declarado cubre este fichero cambiado?
 *
 * Un objetivo de fichero conserva la coincidencia de ruta (`targetMatchesFile`). Un objetivo de
 * directorio, además, cubre toda ruta por debajo: es lo que la delta declara al nombrar el
 * directorio entero y lo que evita que cada fichero de dentro se reporte como fuera de alcance.
 */
const targetCoversFile = (
  file: string,
  target: string,
  exportsOfFile: string[],
  shapes: Map<string, TargetShape>,
): boolean => {
  if (targetMatchesFile(file, target, exportsOfFile)) return true;
  const shape = shapes.get(norm(target).trim());
  if (shape?.kind !== 'directory' || !shape.dir) return false;
  const f = canon(file);
  const d = canon(shape.dir);
  return f === d || f.startsWith(`${d}/`);
};

/** Punto de integración: configuración, entorno o rutas (los que `collectRepoFacts` ya detecta). */
const isIntegrationPoint = (file: string, facts: RepoFacts): boolean => {
  if (facts.configFiles.some((c) => norm(c) === norm(file))) return true;
  return /(^|\/)(routes?|router|api)(\.[a-z]+)?$/i.test(stem(file)) || /\.(routes?|router)\.[a-z]+$/i.test(file);
};

// ---------------------------------------------------------------------------------------------
// El análisis
// ---------------------------------------------------------------------------------------------

export const analyzeChangeImpact = async (input: ChangeImpactInput): Promise<ChangeImpactReport> => {
  const cwd = input.cwd;
  const maxDepth = input.maxDepth ?? 3;
  const findings: ImpactFinding[] = [];
  let complete = true;

  const incomplete = (message: string, artifacts: string[]): void => {
    complete = false;
    findings.push({ area: 'dependencies', severity: 'warning', message, artifacts });
  };

  const changedFiles = Array.from(new Set(input.changedFiles.map(norm))).sort();

  if (changedFiles.length === 0) {
    findings.push({
      area: 'dependencies',
      severity: 'info',
      message: 'No se declaró ningún fichero cambiado: no hay impacto que analizar.',
      artifacts: [],
    });
  }

  // ── Hechos del repositorio (reutilizados, no reimplementados) ────────────────────────────────
  let facts: RepoFacts | null = null;
  let sourceDirs: string[] = [];
  try {
    const project = await scanProject(cwd);
    sourceDirs = project.sourceDirs;
    facts = await collectRepoFacts(cwd, project);
  } catch (err) {
    incomplete(
      `No se pudo reconocer el proyecto en ${cwd} (${(err as Error).message}): el impacto se informa como no evaluado, no como pequeño.`,
      [cwd],
    );
  }

  // ── Grafo de dependencias ───────────────────────────────────────────────────────────────────
  const walk: SourceWalk = sourceDirs.length > 0
    ? await walkSources(cwd, sourceDirs)
    : { files: [], unreadable: [], truncated: false };

  if (sourceDirs.length === 0) {
    incomplete(
      'No se detectó ningún directorio de código fuente: no se puede recorrer el grafo de dependencias, así que el radio de impacto no es fiable.',
      [cwd],
    );
  }
  for (const bad of walk.unreadable) {
    incomplete(
      `No se pudo leer ${bad.path} (${bad.reason}): parte del grafo de dependencias queda sin inspeccionar.`,
      [bad.path],
    );
  }
  if (walk.truncated) {
    incomplete(
      `Se superó el límite de ${MAX_WALK_FILES} ficheros fuente: el recorrido no fue exhaustivo y el radio de impacto es un mínimo, no una medida.`,
      sourceDirs,
    );
  }

  const graph = buildDependencyGraph(walk.files);
  const reach = walkImporters(graph, changedFiles, maxDepth);
  // `reach` trabaja con claves canónicas (sin extensión); el informe cita las rutas reales.
  const seedDisplay = new Map(changedFiles.map((file) => [canon(file), file]));
  const display = (key: string): string => graph.paths.get(key) ?? seedDisplay.get(key) ?? key;
  const dependents = Array.from(reach.dependents.entries())
    .map(([file, imports]) => ({ file: display(file), imports: Array.from(imports).map(display).sort() }))
    .sort((a, b) => a.file.localeCompare(b.file));

  findings.push({
    area: 'dependencies',
    severity: 'info',
    message: `Grafo de dependencias: el cambio alcanza ${reach.blastRadius} fichero(s) hasta profundidad ${maxDepth} (radio de impacto).`,
    artifacts: dependents.map((d) => d.file),
  });

  // ── Componentes afectados ───────────────────────────────────────────────────────────────────
  const components = new Set<string>();
  for (const file of changedFiles) {
    const dir = sourceDirs.find((d) => isInside(file, d));
    if (!dir) {
      components.add(path.posix.dirname(file) === '.' ? file : path.posix.dirname(file));
      continue;
    }
    const rest = norm(file).slice(canon(dir).length).replace(/^\//, '');
    const segment = rest.split('/')[0];
    components.add(rest.includes('/') ? segment : dir);
  }
  if (components.size > 0) {
    findings.push({
      area: 'components',
      severity: 'info',
      message: `Componentes afectados: ${Array.from(components).sort().join(', ')}.`,
      artifacts: Array.from(components).sort(),
    });
  }

  // ── Exportaciones actuales de los ficheros cambiados ────────────────────────────────────────
  const contentByCanon = new Map<string, string>();
  for (const file of walk.files) contentByCanon.set(canon(file.path), file.content);

  const readChanged = async (file: string): Promise<{ exists: boolean; content: string | null; error?: string }> => {
    const cached = contentByCanon.get(canon(file));
    if (cached !== undefined) return { exists: true, content: cached };
    try {
      return { exists: true, content: await readFile(path.join(cwd, file), 'utf8') };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return { exists: false, content: null };
      return { exists: true, content: null, error: (err as Error).message };
    }
  };

  const exportsByCanon = new Map<string, string[]>();
  for (const file of changedFiles) {
    const read = await readChanged(file);
    exportsByCanon.set(canon(file), read.content === null ? [] : extractExportNames(read.content));
    // Un fichero ausente es una eliminación legítima del cambio; uno que existe y no se puede leer es
    // un agujero de inspección, y se declara como tal.
    if (read.exists && read.content === null) {
      incomplete(
        `No se pudo leer el fichero cambiado ${file} (${read.error ?? 'error de lectura'}): sus exportaciones no se pudieron inspeccionar y la comprobación de compatibilidad queda incompleta.`,
        [file],
      );
    }
  }

  // ── Objetivos de la delta: forma (fichero o directorio) y revisión anterior ──────────────────
  // La forma se resuelve una sola vez y gobierna el contraste de alcance; el sondeo de HEAD se cachea
  // por fichero para no reabrir git en cada comprobación.
  const headProbe = input.delta ? makeHeadProbe(cwd) : null;
  const targetShapes = input.delta
    ? await classifyDeltaTargets(cwd, input.delta, changedFiles)
    : new Map<string, TargetShape>();

  // ── Cambios incompatibles ───────────────────────────────────────────────────────────────────
  const breakingChanges: ChangeImpactReport['breakingChanges'] = [];
  const declaredApiChange = new Set<string>();

  if (input.previousExports) {
    for (const previous of input.previousExports) {
      const file = norm(previous.file);
      const read = await readChanged(file);
      if (read.content === null && read.exists) {
        incomplete(
          `No se pudo leer ${file} para comparar sus exportaciones anteriores (${read.error ?? 'error de lectura'}): el veredicto de compatibilidad no se emite.`,
          [file],
        );
        continue;
      }
      const current = new Set(read.content === null ? [] : extractExportNames(read.content));
      for (const symbol of previous.symbols) {
        if (current.has(symbol)) continue;
        breakingChanges.push({
          file,
          symbol,
          reason: read.exists
            ? `La exportación "${symbol}" existía antes del cambio y ya no se declara en ${file}: retirar o renombrar una exportación es un cambio incompatible para quien la consume.`
            : `El fichero ${file} ya no existe: sus exportaciones (entre ellas "${symbol}") desaparecen y el cambio es incompatible.`,
        });
      }
    }
    for (const change of breakingChanges) {
      findings.push({
        area: 'breaking',
        severity: 'error',
        message: change.reason,
        artifacts: [change.file, change.symbol],
      });
    }
  }

  if (facts) {
    const publicApi = new Set(facts.publicApiFiles.map(norm));
    for (const file of changedFiles) {
      if (publicApi.has(file)) {
        findings.push({
          area: 'breaking',
          severity: 'warning',
          message: `${file} es un punto de entrada de la API pública: el cambio puede romper compatibilidad con consumidores que no están en este repositorio. Exige una entrada MODIFIED o REMOVED en la delta que declare \`previous\` y su ruta de migración.`,
          artifacts: [file],
        });
      }
    }
    if (input.delta) {
      for (const entry of input.delta.entries) {
        if (entry.kind === 'ADDED') continue;
        if (!entry.previous?.trim()) continue;
        for (const target of entry.targets) {
          for (const file of changedFiles) {
            const exportsForFile = exportsByCanon.get(canon(file)) ?? [];
            if (targetMatchesFile(file, target, exportsForFile)) declaredApiChange.add(canon(file));
          }
        }
      }

      for (const file of changedFiles) {
        // La exigencia de `previous` se decide por objetivo de FICHERO: los objetivos de directorio
        // se cubren en el contraste de alcance, donde sí declaran un conjunto de rutas.
        const targetingEntries = input.delta.entries.filter((entry) =>
          entry.targets.some((target) => targetMatchesFile(file, target, exportsByCanon.get(canon(file)) ?? [])),
        );
        if (targetingEntries.length === 0) continue;
        if (declaredApiChange.has(canon(file))) continue;

        // Solo hay comportamiento que sustituir si el fichero ya existía en la revisión anterior, o
        // si alguna entrada que lo declara es MODIFIED/REMOVED/RENAMED. Un objetivo nuevo (no
        // rastreado o ausente en HEAD) no puede declarar `previous`: exigírselo sería un falso positivo.
        const revisedBehaviour = targetingEntries.some((entry) => entry.kind !== 'ADDED');
        if (!revisedBehaviour) {
          const existed = headProbe ? headProbe(file) : null;
          if (existed === false) continue;
          if (existed === null) {
            findings.push({
              area: 'breaking',
              severity: 'info',
              message: `No se pudo determinar si ${file} existía en la revisión anterior (git no está disponible o HEAD no se pudo leer): sin ese dato no se sabe si hay un contrato previo que sustituir, así que no se exige la declaración \`previous\` ni se emite el aviso correspondiente.`,
              artifacts: [file],
            });
            continue;
          }
        }

        findings.push({
          area: 'breaking',
          severity: 'warning',
          message: `La delta declara ${file} como objetivo, pero ninguna entrada MODIFIED/REMOVED/RENAMED declara el comportamiento \`previous\` que sustituye: sin esa declaración no se sabe qué contrato existente debe seguir intacto.`,
          artifacts: [file],
        });
      }
    }
  }

  // ── API pública ─────────────────────────────────────────────────────────────────────────────
  const apiSurface: ChangeImpactReport['apiSurface'] = [];
  if (facts) {
    const publicApi = new Set(facts.publicApiFiles.map(norm));
    for (const file of changedFiles) {
      if (!publicApi.has(file)) continue;
      apiSurface.push({ file, symbols: exportsByCanon.get(canon(file)) ?? [] });
    }
    if (apiSurface.length > 0) {
      findings.push({
        area: 'api',
        severity: 'info',
        message: `Superficie de API pública tocada por el cambio: ${apiSurface.map((a) => `${a.file} (${a.symbols.length} exportación(es))`).join(', ')}.`,
        artifacts: apiSurface.map((a) => a.file),
      });
    }
  }

  // ── Migraciones de base de datos ────────────────────────────────────────────────────────────
  const migrations: ChangeImpactReport['migrations'] = [];
  if (facts && facts.migrationDirs.length > 0) {
    for (const file of changedFiles) {
      const dir = facts.migrationDirs.find((d) => isInside(file, d));
      if (!dir) continue;
      let hasRollback = hasRollbackCounterpart(file, facts.rollbackMigrations);
      if (!hasRollback) {
        const read = await readChanged(file);
        if (read.content !== null) hasRollback = INLINE_ROLLBACK.some((pattern) => pattern.test(read.content!));
      }
      migrations.push({ path: file, hasRollback });
      if (!hasRollback) {
        findings.push({
          area: 'database',
          severity: 'error',
          message: `La migración ${file} no declara plan de reversión (ni fichero con down/rollback/revert en ${dir} ni un down/downgrade dentro del propio fichero): toda migración de BD debe incluir plan de rollback.`,
          artifacts: [file, dir],
        });
      } else {
        findings.push({
          area: 'database',
          severity: 'info',
          message: `La migración ${file} declara su reversión: el cambio de esquema es reversible.`,
          artifacts: [file],
        });
      }
    }
  }

  // ── Puntos de integración ───────────────────────────────────────────────────────────────────
  const integrationPoints = facts ? changedFiles.filter((file) => isIntegrationPoint(file, facts)) : [];
  if (integrationPoints.length > 0) {
    findings.push({
      area: 'integration',
      severity: 'info',
      message: `Puntos de integración afectados (configuración, entorno o rutas): ${integrationPoints.join(', ')}.`,
      artifacts: integrationPoints,
    });
  }

  // ── Contraste con la delta ──────────────────────────────────────────────────────────────────
  if (input.delta) {
    for (const entry of input.delta.entries) {
      for (const target of entry.targets) {
        const touched = changedFiles.some((file) =>
          targetCoversFile(file, target, exportsByCanon.get(canon(file)) ?? [], targetShapes),
        );
        if (!touched) {
          const shape = targetShapes.get(norm(target).trim());
          const how = shape?.kind === 'directory'
            ? `interpretado como directorio (cubre toda ruta bajo "${shape.dir}/")`
            : 'interpretado como fichero (ruta exacta)';
          findings.push({
            area: 'components',
            severity: 'warning',
            message: `La entrada ${entry.id} (${entry.kind}) declara el objetivo "${target}", ${how}, pero este cambio no toca ningún fichero que le corresponda: la delta declara un objetivo que este cambio no toca.`,
            artifacts: [entry.id, target],
          });
        }
      }
    }

    // Un objetivo de directorio cubre lo que hay debajo: se dice qué se dio por cubierto, para que la
    // interpretación sea auditable en vez de invisible.
    const described = new Set<string>();
    for (const entry of input.delta.entries) {
      for (const target of entry.targets) {
        const key = norm(target).trim();
        const shape = targetShapes.get(key);
        if (shape?.kind !== 'directory' || !shape.dir || described.has(key)) continue;
        const matched = changedFiles.filter((file) =>
          targetCoversFile(file, target, exportsByCanon.get(canon(file)) ?? [], targetShapes),
        );
        if (matched.length === 0) continue;
        described.add(key);
        const sample = matched.slice(0, 5).join(', ');
        findings.push({
          area: 'components',
          severity: 'info',
          message: `El objetivo "${key}" se interpretó como directorio y cubre ${matched.length} fichero(s) cambiado(s) bajo "${shape.dir}/": ${sample}${matched.length > 5 ? ` (+${matched.length - 5} más)` : ''}.`,
          artifacts: matched,
        });
      }
    }

    const covered = (file: string): boolean =>
      input.delta!.entries.some((entry) =>
        entry.targets.some((target) =>
          targetCoversFile(file, target, exportsByCanon.get(canon(file)) ?? [], targetShapes),
        ),
      );
    for (const file of changedFiles) {
      if (covered(file)) continue;
      findings.push({
        area: 'components',
        severity: 'warning',
        message: `${file} cambia fuera del alcance declarado: ninguna entrada de la delta lo menciona en \`targets\`, así que este cambio no está gobernado por el contrato del cambio.`,
        artifacts: [file],
      });
    }
  } else {
    findings.push({
      area: 'components',
      severity: 'info',
      message: 'Sin delta no hay contraste de alcance: no se comprueba si cada fichero cambiado está declarado en el contrato del cambio.',
      artifacts: [],
    });
  }

  // ── Informe ─────────────────────────────────────────────────────────────────────────────────
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const lines = [
    `Impacto del cambio: ${changedFiles.length} fichero(s) cambiado(s), radio de impacto ${reach.blastRadius} (profundidad ${maxDepth}), ${breakingChanges.length} cambio(s) incompatible(s), ${migrations.length} migración(es), ${apiSurface.length} punto(s) de API pública, ${integrationPoints.length} punto(s) de integración.`,
    `${errors} error(es), ${warnings} aviso(s).`,
  ];
  if (input.delta) {
    lines.push(`Contraste con la delta "${input.delta.feature}": ${input.delta.entries.length} entrada(s) declarada(s).`);
  } else {
    lines.push('Contraste con la delta: omitido (no se proporcionó delta).');
  }
  if (!complete) {
    lines.push(
      'Análisis incompleto: hay directorios o ficheros que no se pudieron inspeccionar, así que el radio de impacto es un mínimo y no una medida. No se declara un aprobado sobre lo que no se inspeccionó.',
    );
  }

  return {
    ...(input.delta?.feature ? { feature: input.delta.feature } : {}),
    findings,
    dependents,
    breakingChanges,
    integrationPoints,
    migrations,
    apiSurface,
    blastRadius: reach.blastRadius,
    complete,
    detail: lines.join(' '),
  };
};

// ---------------------------------------------------------------------------------------------
// Pronóstico de impacto (antes de escribir nada)
// ---------------------------------------------------------------------------------------------

/**
 * `analyzeChangeImpact` responde DESPUÉS de que haya ficheros cambiados: mide el radio real sobre un
 * diff. `forecastImpact` responde ANTES, a partir de una descripción, que es lo que REQ-MAT-013 pide:
 * «el análisis de impacto pronosticará el radio de un cambio descrito antes de que se escriba».
 *
 * La regla que gobierna este módulo es la misma que la del análisis y la de `reuseFirst`: lo que no se
 * puede determinar se declara DESCONOCIDO. `expectedBlastRadius` es `null` cuando no hay base para
 * calcularlo, nunca `0` — un pronóstico de cero es una afirmación, y no saberlo no lo es.
 *
 * Reutiliza lo que ya existe en lugar de duplicar detectores: `bootstrap.buildModuleMap` para los
 * módulos, `reuseFirst.findReuseCandidates` para los símbolos reutilizables y el grafo de
 * dependencias de este mismo módulo para la propagación.
 */

const FORECAST_STOPWORDS = new Set([
  // English function words
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'shall', 'when', 'must', 'will',
  'should', 'are', 'was', 'were', 'has', 'have', 'had', 'not', 'but', 'all', 'any', 'can', 'our',
  'their', 'its', 'his', 'her', 'they', 'them', 'you', 'your', 'out', 'new', 'use', 'using',
  // Spanish function words
  'que', 'los', 'las', 'del', 'con', 'por', 'para', 'una', 'uno', 'unos', 'unas', 'como', 'mas',
  'más', 'sus', 'este', 'esta', 'esto', 'estos', 'estas', 'son', 'sea', 'ser', 'debe', 'deben',
  'debera', 'deberá', 'cuando', 'donde', 'desde', 'hasta', 'entre', 'sobre', 'todo', 'toda',
  'todos', 'todas', 'sin', 'su', 'al', 'lo', 'la', 'el', 'es', 'en', 'de', 'y', 'un', 'se',
]);

export interface ImpactForecastModule {
  /** Module path relative to the root, as `buildModuleMap` reports it. */
  path: string;
  name: string;
  /** Description keywords that hit this module's metadata or its files. */
  matchedKeywords: string[];
  /** Concrete evidence: files under the module whose path/content matched. */
  matched: string[];
  /** Source files the module owns (the denominator of the match). */
  fileCount: number;
  testDirs: string[];
}

export interface ImpactForecastTest {
  file: string;
  reasons: string[];
}

export interface ImpactForecastInput {
  cwd: string;
  /** What the change is meant to do, in prose. */
  description: string;
  /** Symbols an agent proposes to create: the reuse-first check runs over them. */
  symbols?: string[];
  /** Depth of the importer walk used for the expected radius. Default 3. */
  maxDepth?: number;
}

export interface ImpactForecast {
  description: string;
  keywords: string[];
  modules: ImpactForecastModule[];
  /** How many modules the map contained (the denominator of the match). */
  modulesConsidered: number;
  reuseCandidates: ReuseCandidate[];
  /** Proposed symbols that already have a reusable candidate: creating them would duplicate. */
  reuseViolations: string[];
  tests: ImpactForecastTest[];
  /** Files the description points at. */
  candidateFiles: string[];
  /** Expected reachable-file count, or null when it cannot be determined (never 0 as a stand-in). */
  expectedBlastRadius: number | null;
  /** Everything the forecast could NOT determine, each with its reason. */
  unknown: string[];
  complete: boolean;
  detail: string;
}

const forecastKeywords = (description: string): string[] =>
  Array.from(
    new Set(
      description
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((token) => token.length >= 3 && !FORECAST_STOPWORDS.has(token)),
    ),
  );

const mentions = (haystack: string, keyword: string): boolean => haystack.toLowerCase().includes(keyword);

export const forecastImpact = async (input: ImpactForecastInput): Promise<ImpactForecast> => {
  const cwd = input.cwd;
  const maxDepth = input.maxDepth ?? 3;
  const description = input.description;
  const keywords = forecastKeywords(description);
  const unknown: string[] = [];

  // ── Módulos (reutilizando buildModuleMap, no un segundo detector) ───────────────────────────
  let modulesConsidered = 0;
  let moduleEntries: ImpactForecastModule[] = [];
  let sourceDirs: string[] = [];
  let testDirs: string[] = [];
  let sourceWalk: SourceWalk = { files: [], unreadable: [], truncated: false };
  let testWalk: SourceWalk = { files: [], unreadable: [], truncated: false };

  try {
    const project = await scanProject(cwd);
    sourceDirs = project.sourceDirs;
    testDirs = project.testDirs;
    const map = await buildModuleMap(cwd);
    modulesConsidered = map.modules.length;
    if (!map.complete) {
      unknown.push(
        `El mapa de módulos quedó incompleto (${map.detail}): hay módulos cuyas dependencias no se inspeccionaron, así que la coincidencia y el radio son un mínimo, no una medida.`,
      );
    }

    sourceWalk = sourceDirs.length > 0 ? await walkSources(cwd, sourceDirs) : sourceWalk;
    testWalk = testDirs.length > 0 ? await walkSources(cwd, testDirs) : testWalk;
    for (const bad of [...sourceWalk.unreadable, ...testWalk.unreadable]) {
      unknown.push(`No se pudo leer ${bad.path} (${bad.reason}): queda fuera del pronóstico.`);
    }
    if (sourceWalk.truncated || testWalk.truncated) {
      unknown.push(
        `Se superó el límite de ficheros recorridos: el pronóstico no fue exhaustivo y el radio de impacto es un mínimo.`,
      );
    }

    const ownedFiles = (module: (typeof map.modules)[number]): string[] =>
      sourceWalk.files.filter((file) => module.owns.some((dir) => isInside(file.path, dir))).map((file) => file.path);

    moduleEntries = map.modules.map((module) => {
      const metadata = [module.path, module.name, ...module.owns, ...module.responsibilities, ...module.dependsOn];
      const metadataKeywords = keywords.filter((keyword) => metadata.some((value) => mentions(value, keyword)));
      const files = ownedFiles(module);
      const pathMatches = files.filter((file) => keywords.some((keyword) => mentions(file, keyword)));
      const matched = pathMatches.length > 0
        ? pathMatches
        : files.filter((file) => {
            const content = sourceWalk.files.find((candidate) => candidate.path === file)?.content ?? '';
            return keywords.some((keyword) => mentions(content, keyword));
          });
      const matchedKeywords = Array.from(
        new Set([
          ...metadataKeywords,
          ...keywords.filter((keyword) => matched.some((file) => mentions(file, keyword))),
        ]),
      );
      return {
        path: module.path,
        name: module.name,
        matchedKeywords,
        matched: Array.from(new Set([...(metadataKeywords.length > 0 ? [module.path] : []), ...matched])).sort(),
        fileCount: files.length,
        testDirs: module.testDirs,
      };
    });
    moduleEntries = moduleEntries
      .filter((module) => module.matched.length > 0)
      .sort((a, b) => b.matchedKeywords.length - a.matchedKeywords.length || a.path.localeCompare(b.path));
  } catch (error) {
    unknown.push(
      `No se pudo reconocer el proyecto en ${cwd} (${(error as Error).message}): el pronóstico se informa como no evaluado, no como pequeño.`,
    );
  }

  if (keywords.length === 0) {
    unknown.push('La descripción no aporta ninguna palabra significativa: no hay base para pronosticar el impacto.');
  } else if (moduleEntries.length === 0) {
    unknown.push(
      'Ningún módulo coincide con la descripción: no se puede identificar qué parte del sistema cambia, así que el radio esperado es desconocido (no cero).',
    );
  }

  const candidateFiles = Array.from(
    new Set(moduleEntries.flatMap((module) => module.matched.filter((entry) => SOURCE_EXT.test(entry)))),
  ).sort();
  if (moduleEntries.length > 0 && candidateFiles.length === 0) {
    unknown.push(
      'Los módulos coinciden por su nombre o responsabilidades, pero ningún fichero concreto coincide: el radio esperado no se puede calcular sin inventar objetivos.',
    );
  }

  // ── Radio esperado: grafo de dependencias + ficheros candidatos ─────────────────────────────
  let expectedBlastRadius: number | null = null;
  if (candidateFiles.length > 0) {
    const graph = buildDependencyGraph(sourceWalk.files);
    const reach = walkImporters(graph, candidateFiles, maxDepth);
    expectedBlastRadius = candidateFiles.length + reach.blastRadius;
  }

  // ── Tests que protegerían el cambio ─────────────────────────────────────────────────────────
  const candidateCanon = new Set(candidateFiles.map(canon));
  const tests: ImpactForecastTest[] = [];
  for (const file of testWalk.files) {
    const reasons: string[] = [];
    const parentModule = moduleEntries.find((module) => module.testDirs.some((dir) => isInside(file.path, dir)));
    if (parentModule) reasons.push(`vive en los tests del módulo "${parentModule.path}"`);

    const hitKeyword = keywords.find((keyword) => mentions(path.posix.basename(file.path), keyword));
    if (hitKeyword) reasons.push(`el nombre menciona "${hitKeyword}"`);

    for (const specifier of extractImportSpecifiers(file.content)) {
      const importsCandidate = specifier.startsWith('.')
        ? candidateCanon.has(canon(path.posix.normalize(path.posix.join(path.posix.dirname(file.path), norm(specifier)))))
        : candidateFiles.some((candidate) => {
            const target = canon(specifier);
            return candidate === target || candidate.endsWith(`/${target}`);
          });
      if (importsCandidate) {
        reasons.push(`importa un fichero candidato (${specifier})`);
        break;
      }
    }

    if (reasons.length === 0) {
      const keywordInContent = keywords.find((keyword) => mentions(file.content, keyword));
      if (keywordInContent) reasons.push(`su contenido menciona "${keywordInContent}"`);
    }
    if (reasons.length > 0) tests.push({ file: file.path, reasons });
  }
  tests.sort((a, b) => a.file.localeCompare(b.file));

  if (tests.length === 0) {
    unknown.push(
      testDirs.length === 0
        ? 'No se detectaron directorios de test: no se puede decir qué pruebas protegerían el cambio (no hay ninguna que lo haga hoy).'
        : 'No se identificó ningún test que cubra los módulos coincidentes: el cambio llegaría sin oráculo de regresión que lo proteja.',
    );
  }

  // ── Reutilización primero sobre los símbolos propuestos ─────────────────────────────────────
  const reuseCandidates: ReuseCandidate[] = [];
  const reuseViolations: string[] = [];
  const symbols = (input.symbols ?? []).map((symbol) => symbol.trim()).filter(Boolean);
  if (symbols.length === 0) {
    unknown.push(
      'No se declararon símbolos propuestos: la comprobación de reutilización primero NO se ejecutó, así que no se sabe si el cambio duplicaría algo existente.',
    );
  } else {
    try {
      const report = await findReuseCandidates({
        cwd,
        requests: symbols.map((symbol) => ({ symbol, reason: `propuesto en "${description.slice(0, 80)}"` })),
        sourceDirs,
      });
      reuseCandidates.push(...report.candidates);
      reuseViolations.push(...report.violations);
      if (!report.complete) {
        unknown.push(`La búsqueda de reutilización quedó incompleta: ${report.detail}`);
      }
    } catch (error) {
      unknown.push(
        `No se pudo ejecutar la búsqueda de reutilización (${(error as Error).message}): no se sabe si los símbolos propuestos ya existen.`,
      );
    }
  }

  const complete = unknown.length === 0;
  const radiusText =
    expectedBlastRadius === null
      ? 'radio esperado DESCONOCIDO (no se calculó: sin objetivos identificados no hay número honesto)'
      : `radio esperado ${expectedBlastRadius} fichero(s) (${candidateFiles.length} candidato(s) + dependientes alcanzables hasta profundidad ${maxDepth})`;
  const detail = `Pronóstico de impacto (nada escrito todavía): ${keywords.length} palabra(s) clave, ${moduleEntries.length}/${modulesConsidered} módulo(s) coincidente(s), ${candidateFiles.length} fichero(s) candidato(s), ${tests.length} test(s) que podrían protegerlo, ${reuseCandidates.length} candidato(s) de reutilización para ${symbols.length} símbolo(s) propuesto(s); ${radiusText}.${
    complete ? '' : ` ${unknown.length} incógnita(s) declarada(s).`
  }`;

  return {
    description,
    keywords,
    modules: moduleEntries,
    modulesConsidered,
    reuseCandidates,
    reuseViolations,
    tests,
    candidateFiles,
    expectedBlastRadius,
    unknown,
    complete,
    detail,
  };
};
