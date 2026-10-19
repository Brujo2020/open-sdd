/**
 * `open-sdd doctor` — autodiagnóstico de la instalación y del repositorio gobernado.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────────────────────────
 * El objetivo del proyecto es «instalación y primer uso en minutos, en cualquier sistema operativo,
 * para enterprise y no-enterprise». Un onboarding que falla en silencio es peor que uno que falla:
 * el usuario no sabe qué arreglar. Este módulo convierte cada supuesto del arranque en una
 * comprobación con nombre y con el comando exacto que la repara.
 *
 * ── La regla que gobierna todo lo de aquí ───────────────────────────────────────────────────────
 * Nada se declara aprobado por no haberlo podido inspeccionar. Una comprobación que no se puede
 * ejecutar es `warn` con «no se pudo comprobar» en el detalle, nunca un `ok` silencioso. `ok` es
 * verdadero SOLO cuando no hay ningún `fail`: los avisos documentan deuda, no rompen la instalación.
 *
 * ── Comprobaciones y su porqué ──────────────────────────────────────────────────────────────────
 *  1. `node`             — la versión en uso contra el rango que el paquete declare (`engines`). Si
 *                          ningún manifiesto lo declara, se dice qué se asumió en vez de aprobar.
 *  2. `cli`              — el CLI es alcanzable y su versión reportada no es un marcador de
 *                          desarrollo: un artefacto publicado llegó a reportar `dev`.
 *  3. `hook`             — el hook de commit está instalado (respetando `core.hooksPath`), es
 *                          ejecutable y es NUESTRA versión (se compara con la plantilla embarcada;
 *                          el instalador llegó a negarse a refrescar una versión antigua de su
 *                          propio gate, dejando al contribuyente ejecutando el gate viejo).
 *  4. `hook-portability` — si el hook instalado depende de un shell POSIX y, en Windows, si `sh`
 *                          está disponible. Es un bloqueo real y conocido: se reporta tal cual.
 *  5. `settings`         — `.sdd/settings/rigor.json` presente, parseable, con nivel admitido y
 *                          rationale no vacío; cuando lo está, se reportan el nivel y sus gates.
 *  6. `constitution`     — la constitución presente, válida según `validateConstitution`, con
 *                          principios en vigor y el registro de enmiendas.
 *  7. `specs`            — qué especificaciones hay y si cada tríada está completa.
 *  8. `model-offline`    — postura sin modelo y sin red: es una comprobación POSITIVA, no un fallo.
 *  9. `environment`      — `git` disponible y la raíz del repositorio resoluble.
 *
 * Los textos visibles son español, como el resto del CLI. `renderDoctor` devuelve texto plano, una
 * línea por hallazgo, para que el JSON quede limpio y el render sea testeable sin quitar ANSI.
 */

import { chmod, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { colors, formatVerdict } from '../cli/ui/colors.js';
import { INSTALL_COMMAND } from '../cli/packageIdentity.js';
import type { CliIO } from '../cli/io.js';
import { parseConstitution, principlesInForce, validateConstitution } from './constitution.js';
import {
  DEFAULT_RIGOR_LEVEL,
  RIGOR_LEVELS,
  effectiveGates,
  isRigorLevel,
  resolveRigorSettings,
} from './rigor.js';
import { resolveSddDir } from './specManager.js';
import { STOP_HOOKS, STOP_HOOK_GATE_ARGS, installStopHook } from './stopHook.js';
import { evaluateTriad } from './triad.js';

export interface DoctorCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
  /** Concrete, runnable repair when the status is not `ok`. */
  fix?: string;
}

/**
 * Estado de un Stop hook de anfitrión verificado.
 *
 * No es una `DoctorCheck` porque un Stop hook NO es un requisito del suelo: es una mejora opcional
 * que instala `integrate --write`. Su ausencia es deuda (aviso), no un fallo de instalación, y por
 * eso viaja en su propia lista en vez de alterar el recuento de las nueve comprobaciones.
 */
export interface StopHookReport {
  host: string;
  path: string;
  installed: boolean;
  action: 'create' | 'update' | 'keep' | 'refused';
  detail: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
  counts: { ok: number; warn: number; fail: number };
  detail: string;
  /** Los Stop hooks de los anfitriones cuyo mecanismo está verificado (claude-code, codex). */
  stopHooks?: StopHookReport[];
}

export interface DoctorOptions {
  sddDir?: string;
  /**
   * Seam de testabilidad (mismo patrón que `runCli(argv, runtime, …)`): permite comprobar la rama de
   * Windows —disponibilidad de `sh`— sin depender del sistema en el que corre la suite. En uso real
   * se omite y se usa `process.platform`.
   */
  platform?: NodeJS.Platform;
  /**
   * Seam de testabilidad: manifiestos donde buscar `engines.node`. Por defecto se leen el del
   * proyecto, el del paquete y el de la raíz instalada. Permite comprobar la rama «ningún manifiesto
   * declara el rango» sin fabricar una instalación falsa.
   */
  manifestPaths?: string[];
}

/** Lo que las comprobaciones averiguaron y `--fix` necesita para reparar sin volver a adivinar. */
interface DoctorFacts {
  sddDir: string;
  settingsPath: string;
  settingsExists: boolean;
  hookPath: string | null;
  hookState: 'missing' | 'foreign' | 'stale' | 'not-executable' | 'current' | 'unverifiable' | 'absent';
  /** El hook instalado no puede ejecutarse en esta plataforma (shell POSIX sin `sh` en Windows). */
  hookPortabilityBlocks: boolean;
  hookTemplatePath: string | null;
  hookTemplateContent: string | null;
  repoRoot: string | null;
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Rango asumido cuando ningún manifiesto declara `engines.node`. */
const ASSUMED_NODE_RANGE = '>=20';

const exists = async (p: string): Promise<boolean> => (await stat(p).catch(() => null)) !== null;

const readText = async (
  p: string,
): Promise<{ exists: boolean; content: string | null; error?: string }> => {
  try {
    return { exists: true, content: await readFile(p, 'utf8') };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { exists: false, content: null };
    return { exists: true, content: null, error: (error as Error).message };
  }
};

const quote = (value: string): string => (/\s/.test(value) ? `"${value}"` : value);

const run = (
  command: string,
  args: string[],
  cwd: string,
): { ok: boolean; stdout: string; stderr: string; status: number | null } => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 15_000 });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    status: result.status,
  };
};

// ---------------------------------------------------------------------------------------------
// Comparación de versiones (sin dependencias nuevas)
// ---------------------------------------------------------------------------------------------

type SemVer = [number, number, number];

const parseVersion = (value: string): SemVer | null => {
  const match = value.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
};

const compare = (a: SemVer, b: SemVer): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const inClause = (version: SemVer, operator: string, base: SemVer, partial: boolean): boolean => {
  switch (operator) {
    case '>':
      return compare(version, base) > 0;
    case '<':
      return compare(version, base) < 0;
    case '<=':
      return compare(version, base) <= 0;
    case '^': {
      const upper: SemVer =
        base[0] > 0 ? [base[0] + 1, 0, 0] : base[1] > 0 ? [0, base[1] + 1, 0] : [0, 0, base[2] + 1];
      return compare(version, base) >= 0 && compare(version, upper) < 0;
    }
    case '~':
      return compare(version, base) >= 0 && compare(version, [base[0], base[1] + 1, 0]) < 0;
    case '>=':
      return compare(version, base) >= 0;
    case '=':
    default:
      if (partial) {
        // `20` o `20.1` como rango semver: >=base y por debajo del siguiente tramo declarado.
        const upper: SemVer = base[2] === 0 && base[1] === 0 ? [base[0] + 1, 0, 0] : [base[0], base[1] + 1, 0];
        return compare(version, base) >= 0 && compare(version, upper) < 0;
      }
      return compare(version, base) === 0;
  }
};

/**
 * ¿Cumple `version` el rango `range`? `null` = no se pudo comprobar (sintaxis no soportada), que es
 * una respuesta distinta de `false`: la primera se reporta como aviso, la segunda como fallo.
 */
export const satisfiesRange = (version: string, range: string): boolean | null => {
  const parsed = parseVersion(version);
  if (!parsed) return null;
  const alternatives = range
    .split('||')
    .map((part) => part.trim())
    .filter(Boolean);
  if (alternatives.length === 0) return null;

  let understood = false;
  for (const alternative of alternatives) {
    const parts = alternative.split(/\s+/).filter(Boolean);
    let matches = true;
    let clauseUnderstood = true;
    for (const part of parts) {
      if (/^[xX*]$/.test(part)) continue;
      const clause = part.match(/^(>=|<=|>|<|=|\^|~)?\s*v?([0-9xX*]+(?:\.[0-9xX*]+){0,2})$/);
      if (!clause) {
        clauseUnderstood = false;
        break;
      }
      const operator = clause[1] ?? '=';
      const raw = clause[2].split('.');
      if (raw.some((piece) => /^[xX*]$/.test(piece))) {
        // `20.x` no es un pin exacto: se trata como límite inferior del tramo declarado.
        if (/^[xX*]$/.test(raw[0])) continue;
        const base: SemVer = [Number(raw[0]), raw[1] && /^[xX*]$/.test(raw[1]) ? 0 : Number(raw[1] ?? 0), 0];
        if (operator === '<' || operator === '<=') continue;
        if (!inClause(parsed, '>=', base, false)) matches = false;
        continue;
      }
      const base: SemVer = [Number(raw[0]), Number(raw[1] ?? 0), Number(raw[2] ?? 0)];
      if (!inClause(parsed, operator, base, raw.length < 3)) matches = false;
    }
    if (!clauseUnderstood) continue;
    understood = true;
    if (matches) return true;
  }
  return understood ? false : null;
};

// ---------------------------------------------------------------------------------------------
// Localización de artefactos
// ---------------------------------------------------------------------------------------------

/** Manifiestos donde puede declararse `engines.node`, del más cercano al más general. */
const manifestCandidates = (cwd: string): string[] => {
  const candidates = [
    path.join(cwd, 'package.json'),
    path.join(cwd, 'tools', 'open-sdd', 'package.json'),
    path.resolve(MODULE_DIR, '..', '..', 'package.json'),
    path.resolve(MODULE_DIR, '..', '..', '..', '..', 'package.json'),
  ];
  return Array.from(new Set(candidates));
};

const CLI_CANDIDATES = (cwd: string): string[] =>
  Array.from(
    new Set([
      // Ejecutando desde `dist/core`: el CLI es su hermano.
      path.resolve(MODULE_DIR, '..', 'cli.js'),
      // Ejecutando desde `src/core` (tests): el CLI compilado del paquete.
      path.resolve(MODULE_DIR, '..', '..', 'dist', 'cli.js'),
      // Instalaciones habituales dentro del proyecto objetivo.
      path.join(cwd, 'tools', 'open-sdd', 'dist', 'cli.js'),
      path.join(cwd, 'dist', 'cli.js'),
      path.join(cwd, 'node_modules', 'open-sdd', 'tools', 'open-sdd', 'dist', 'cli.js'),
      path.join(cwd, 'node_modules', '@brujo2020', 'open-sdd', 'tools', 'open-sdd', 'dist', 'cli.js'),
      path.join(cwd, 'node_modules', '.bin', 'open-sdd'),
    ]),
  );

/**
 * Plantillas embarcadas del gate, en orden de preferencia.
 *
 * `pre-commit.mjs` es el gate portátil (Node, sin shell POSIX): es el que instala
 * `scripts/install-hooks.mjs` y el que `doctor --fix` prefiere. El `pre-commit` POSIX sigue siendo la
 * plantilla que copia `open-sdd floor install`, así que un hook instalado con CUALQUIERA de las dos
 * se reconoce como nuestro y vigente: negarlo haría que doctor declarase obsoleto un gate sano.
 */
const HOOK_TEMPLATE_FILES = ['pre-commit.mjs', 'pre-commit'];

const HOOK_TEMPLATE_CANDIDATES = (cwd: string): string[] => {
  const bases = [
    path.resolve(MODULE_DIR, '..', '..', 'templates', 'hooks'),
    path.join(cwd, 'tools', 'open-sdd', 'templates', 'hooks'),
    path.join(cwd, 'node_modules', 'open-sdd', 'tools', 'open-sdd', 'templates', 'hooks'),
    path.join(cwd, 'node_modules', '@brujo2020', 'open-sdd', 'tools', 'open-sdd', 'templates', 'hooks'),
  ];
  const out: string[] = [];
  for (const base of bases) {
    for (const file of HOOK_TEMPLATE_FILES) out.push(path.join(base, file));
  }
  return Array.from(new Set(out));
};

interface ShippedTemplate {
  path: string;
  content: string;
}

/** Plantillas embarcadas legibles, la preferida (portátil) primero. */
const shippedTemplates = async (cwd: string): Promise<ShippedTemplate[]> => {
  const templates: ShippedTemplate[] = [];
  for (const candidate of HOOK_TEMPLATE_CANDIDATES(cwd)) {
    if (!(await exists(candidate))) continue;
    const content = await readFile(candidate, 'utf8').catch(() => null);
    if (content !== null) templates.push({ path: candidate, content });
  }
  return templates;
};

// ---------------------------------------------------------------------------------------------
// Comprobaciones
// ---------------------------------------------------------------------------------------------

const checkNode = async (cwd: string, manifestPaths?: string[]): Promise<DoctorCheck> => {
  const current = process.version.replace(/^v/, '');
  let found: { path: string; range: string } | null = null;
  const unreadable: string[] = [];
  for (const candidate of manifestPaths ?? manifestCandidates(cwd)) {
    if (!(await exists(candidate))) continue;
    const raw = await readText(candidate);
    if (raw.content === null) {
      unreadable.push(candidate);
      continue;
    }
    try {
      const parsed = JSON.parse(raw.content) as { engines?: { node?: unknown } };
      const range = parsed?.engines?.node;
      if (typeof range === 'string' && range.trim().length > 0) {
        found = { path: candidate, range: range.trim() };
        break;
      }
    } catch {
      unreadable.push(candidate);
    }
  }

  if (!found) {
    const satisfied = satisfiesRange(current, ASSUMED_NODE_RANGE);
    const note =
      unreadable.length > 0
        ? ` (no se pudo leer ${unreadable.length} manifiesto(s): ${unreadable.map((p) => path.relative(cwd, p) || p).join(', ')})`
        : '';
    if (satisfied === false) {
      return {
        id: 'node',
        label: 'Versión de Node',
        status: 'fail',
        detail: `Ningún manifiesto declara engines.node: no se pudo comprobar un rango declarado${note}. Se asumió ${ASSUMED_NODE_RANGE} y Node v${current} NO lo cumple.`,
        fix: `Instala Node ${ASSUMED_NODE_RANGE} (LTS) y vuelve a ejecutar \`open-sdd doctor\`.`,
      };
    }
    return {
      id: 'node',
      label: 'Versión de Node',
      status: 'warn',
      detail: `Ningún manifiesto declara engines.node: no se pudo comprobar un rango declarado${note}. Se asumió ${ASSUMED_NODE_RANGE} y Node v${current} lo cumple.`,
      fix: 'Declara el rango soportado en `engines.node` del manifiesto para que esta comprobación sea verificable.',
    };
  }

  const satisfied = satisfiesRange(current, found.range);
  const relative = path.relative(cwd, found.path);
  const where = relative && !relative.startsWith('..') ? relative : found.path;
  if (satisfied === null) {
    return {
      id: 'node',
      label: 'Versión de Node',
      status: 'warn',
      detail: `El rango "${found.range}" declarado en ${where} no se pudo comprobar (sintaxis no soportada) frente a Node v${current}.`,
      fix: `Comprueba manualmente que Node v${current} cumple "${found.range}".`,
    };
  }
  return {
    id: 'node',
    label: 'Versión de Node',
    status: satisfied ? 'ok' : 'fail',
    detail: `Node v${current} ${satisfied ? 'cumple' : 'NO cumple'} el rango "${found.range}" declarado en ${where}.`,
    ...(satisfied ? {} : { fix: `Instala una versión de Node que cumpla "${found.range}" y vuelve a ejecutar \`open-sdd doctor\`.` }),
  };
};

/**
 * Ruta del CLI instalado, resolviendo los layouts reales (checkout, paquete instalado, shim de
 * `node_modules/.bin`). Es la ÚNICA fuente de verdad de «el instalador existente»: `init --skills`
 * delega en este binario en vez de reimplementar la copia de plantillas.
 */
export const resolveCliExecutable = async (cwd: string): Promise<string | null> => {
  for (const candidate of CLI_CANDIDATES(cwd)) {
    if (await exists(candidate)) return candidate;
  }
  return null;
};

const cliVersionCache = new Map<string, string | null>();

/** Versión reportada por un binario, o null si no responde. Cacheada: el binario no cambia de versión. */
const probeCliVersion = (candidate: string, cwd: string): string | null => {
  if (cliVersionCache.has(candidate)) return cliVersionCache.get(candidate) ?? null;
  const result = run(process.execPath, [candidate, '--version'], cwd);
  const reported = result.ok ? /v?(\S+)\s*$/.exec(result.stdout.split('\n')[0])?.[1] ?? null : null;
  cliVersionCache.set(candidate, reported);
  return reported;
};

const checkCli = async (cwd: string): Promise<DoctorCheck> => {
  const candidates = CLI_CANDIDATES(cwd);
  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue;
    const probed = probeCliVersion(candidate, cwd);
    if (probed === null) continue;
    const reported = probed;
    const isPlaceholder = reported.length === 0 || /^dev$/i.test(reported) || /^0\.0\.0$/.test(reported);
    const relative = path.relative(cwd, candidate);
    const where = relative && !relative.startsWith('..') ? relative : candidate;
    if (isPlaceholder) {
      return {
        id: 'cli',
        label: 'CLI alcanzable',
        status: 'warn',
        detail: `El CLI responde desde ${where || candidate} pero reporta la versión "${reported || '(vacía)'}", que es un marcador de desarrollo y no permite atribuir el artefacto.`,
        fix: `Instala una versión publicada y compruébala: \`${INSTALL_COMMAND} --version\`.`,
      };
    }
    return {
      id: 'cli',
      label: 'CLI alcanzable',
      status: 'ok',
      detail: `El CLI responde desde ${where || candidate} y reporta la versión ${reported}.`,
    };
  }

  return {
    id: 'cli',
    label: 'CLI alcanzable',
    status: 'fail',
    detail: `No se encontró ningún CLI ejecutable. Rutas probadas: ${candidates.length}. El hook de commit falla cerrado si el CLI no está: sin él no hay gate.`,
    fix: `Instala o compila el CLI: \`${INSTALL_COMMAND} --version\` (o \`npm --prefix tools/open-sdd run build\` en un checkout).`,
  };
};

interface HookProbe {
  check: DoctorCheck;
  hookPath: string | null;
  state: DoctorFacts['hookState'];
  templatePath: string | null;
  templateContent: string | null;
}

const checkHook = async (cwd: string, platform: NodeJS.Platform): Promise<HookProbe> => {
  const templates = await shippedTemplates(cwd);
  const preferred = templates[0] ?? null;
  const templatePath = preferred?.path ?? null;
  const templateContent = preferred?.content ?? null;

  const notRepo: HookProbe = {
    check: {
      id: 'hook',
      label: 'Hook de commit',
      status: 'warn',
      detail: 'Sin repositorio git (o sin `git` disponible) no se pudo comprobar el hook de commit: no hay ninguno que inspeccionar.',
      fix: `Inicializa el repositorio (\`git init\`) e instala el suelo: \`open-sdd floor install ${quote(cwd)}\`.`,
    },
    hookPath: null,
    state: 'absent',
    templatePath,
    templateContent,
  };

  const top = run('git', ['rev-parse', '--show-toplevel'], cwd);
  if (!top.ok) return notRepo;

  const gitPath = run('git', ['rev-parse', '--git-path', 'hooks/pre-commit'], cwd);
  const hooksPath = run('git', ['config', '--get', 'core.hooksPath'], cwd);
  if (!gitPath.ok || gitPath.stdout.length === 0) {
    return {
      check: {
        id: 'hook',
        label: 'Hook de commit',
        status: 'warn',
        detail: 'La ruta del hook no se pudo comprobar: `git rev-parse --git-path hooks/pre-commit` no devolvió ninguna.',
        fix: `Instala el suelo explícitamente: \`open-sdd floor install ${quote(cwd)}\`.`,
      },
      hookPath: null,
      state: 'unverifiable',
      templatePath,
      templateContent,
    };
  }

  const hookPath = path.resolve(cwd, gitPath.stdout.split('\n')[0].trim());
  const origin = hooksPath.stdout ? `core.hooksPath=${hooksPath.stdout.split('\n')[0].trim()}` : '.git/hooks';
  const relativeHook = path.relative(cwd, hookPath) || hookPath;

  const hookStat = await stat(hookPath).catch(() => null);
  if (hookStat === null) {
    return {
      check: {
        id: 'hook',
        label: 'Hook de commit',
        status: 'fail',
        detail: `El hook de commit no está instalado en ${relativeHook} (${origin}): el repositorio no tiene gate de commit.`,
        fix: `open-sdd floor install ${quote(cwd)}`,
      },
      hookPath,
      state: 'missing',
      templatePath,
      templateContent,
    };
  }

  const content = await readFile(hookPath, 'utf8').catch(() => null);
  if (content === null) {
    return {
      check: {
        id: 'hook',
        label: 'Hook de commit',
        status: 'warn',
        detail: `El hook existe en ${relativeHook} (${origin}) pero no se pudo leer: no se pudo comprobar si es nuestra versión.`,
        fix: `open-sdd floor install ${quote(cwd)}`,
      },
      hookPath,
      state: 'unverifiable',
      templatePath,
      templateContent,
    };
  }

  const ours = content.includes('open-sdd');
  if (!ours) {
    return {
      check: {
        id: 'hook',
        label: 'Hook de commit',
        status: 'fail',
        detail: `El hook instalado en ${relativeHook} es ajeno: no menciona open-sdd, así que el gate de commit no está en vigor.`,
        fix: `open-sdd floor install ${quote(cwd)} --force  (hace copia de seguridad del hook existente)`,
      },
      hookPath,
      state: 'foreign',
      templatePath,
      templateContent,
    };
  }

  // En Windows los bits de permiso de `stat` no son significativos: no se inventa un veredicto.
  const executable = platform === 'win32' ? null : (hookStat.mode & 0o111) !== 0;
  if (executable === false) {
    return {
      check: {
        id: 'hook',
        label: 'Hook de commit',
        status: 'fail',
        detail: `El hook está instalado en ${relativeHook} (${origin}) pero NO es ejecutable: git lo ignora en silencio y el gate no corre.`,
        fix: `chmod +x ${quote(hookPath)}`,
      },
      hookPath,
      state: 'not-executable',
      templatePath,
      templateContent,
    };
  }

  if (templateContent === null) {
    return {
      check: {
        id: 'hook',
        label: 'Hook de commit',
        status: 'warn',
        detail: `El hook instalado en ${relativeHook} es nuestro y es ejecutable, pero no se encontró la plantilla embarcada: no se pudo comprobar si es la versión vigente.`,
        fix: `open-sdd floor install ${quote(cwd)}`,
      },
      hookPath,
      state: 'unverifiable',
      templatePath,
      templateContent,
    };
  }

  const matched = templates.find((template) => template.content === content);
  if (!matched) {
    return {
      check: {
        id: 'hook',
        label: 'Hook de commit',
        status: 'warn',
        detail: `El hook instalado en ${relativeHook} es nuestro pero está DESACTUALIZADO respecto a las plantillas embarcadas (${templates.length}): seguiría ejecutando el gate viejo.`,
        fix: `open-sdd floor install ${quote(cwd)}  ·  o \`open-sdd doctor --fix\` para reinstalar la plantilla portátil`,
      },
      hookPath,
      state: 'stale',
      templatePath,
      templateContent,
    };
  }

  return {
    check: {
      id: 'hook',
      label: 'Hook de commit',
      status: 'ok',
      detail: `Hook instalado en ${relativeHook} (${origin}), ejecutable e idéntico a la plantilla vigente ${path.basename(matched.path)}.`,
    },
    hookPath,
    state: 'current',
    templatePath,
    templateContent,
  };
};

/**
 * Estado del hook de commit, sin veredicto: lo consumen el propio doctor y `init`, que necesita la
 * misma inspección para no duplicar la lógica de «¿es nuestro y está vigente?».
 */
export interface CommitHookStatus {
  state: 'absent' | 'missing' | 'foreign' | 'stale' | 'not-executable' | 'current' | 'unverifiable';
  hookPath: string | null;
  templatePath: string | null;
}

export const inspectCommitHook = async (
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): Promise<CommitHookStatus> => {
  const probe = await checkHook(cwd, platform);
  return { state: probe.state, hookPath: probe.hookPath, templatePath: probe.templatePath };
};

const POSIX_SHELL = /^#!\s*\S*(\/|\\)(env\s+)?(ba|z|da|k)?sh\b/;

const checkHookPortability = async (
  cwd: string,
  platform: NodeJS.Platform,
  hook: HookProbe,
): Promise<DoctorCheck> => {
  if (hook.hookPath === null || hook.state === 'absent' || hook.state === 'missing') {
    return {
      id: 'hook-portability',
      label: 'Portabilidad del hook',
      status: 'warn',
      detail: 'No hay hook de commit instalado: no se pudo comprobar su portabilidad.',
      fix: `open-sdd floor install ${quote(cwd)}`,
    };
  }

  const content = await readFile(hook.hookPath, 'utf8').catch(() => null);
  if (content === null) {
    return {
      id: 'hook-portability',
      label: 'Portabilidad del hook',
      status: 'warn',
      detail: 'El hook instalado no se pudo leer: no se pudo comprobar su portabilidad.',
      fix: `open-sdd floor install ${quote(cwd)}`,
    };
  }

  const firstLine = content.split('\n', 1)[0] ?? '';
  const needsPosix = POSIX_SHELL.test(firstLine) || /(^|\n)\s*set\s+-[a-z]*o\s+pipefail/.test(content);
  if (!needsPosix) {
    return {
      id: 'hook-portability',
      label: 'Portabilidad del hook',
      status: 'ok',
      detail: `El hook no invoca un shell POSIX (intérprete declarado: "${firstLine.replace(/^#!\s*/, '') || 'ninguno'}"): es portable a este sistema operativo.`,
    };
  }

  if (platform !== 'win32') {
    return {
      id: 'hook-portability',
      label: 'Portabilidad del hook',
      status: 'ok',
      detail: `El hook depende de un shell POSIX ("${firstLine.replace(/^#!\s*/, '')}") y en ${platform} está disponible.`,
    };
  }

  const sh = spawnSync('sh', ['-c', 'exit 0'], { encoding: 'utf8', timeout: 10_000 });
  if (sh.status === 0) {
    return {
      id: 'hook-portability',
      label: 'Portabilidad del hook',
      status: 'ok',
      detail: 'El hook depende de un shell POSIX y en Windows `sh` está disponible (lo aporta Git for Windows): el gate puede correr, pero depende de que Git siga instalado.',
    };
  }

  return {
    id: 'hook-portability',
    label: 'Portabilidad del hook',
    status: 'fail',
    detail: 'El hook depende de un shell POSIX ("' + firstLine.replace(/^#!\s*/, '') + '") y en Windows `sh` no está disponible: el gate de commit NO puede ejecutarse aunque el hook esté instalado.',
    fix: 'Instala Git for Windows (aporta `sh`) o reinstala el gate portátil, que no necesita shell: `open-sdd doctor --fix`.',
  };
};

const checkSettings = async (
  cwd: string,
  sddDir: string,
): Promise<{ check: DoctorCheck; settingsPath: string; settingsExists: boolean }> => {
  const settingsPath = path.join(cwd, sddDir, 'settings', 'rigor.json');
  const display = path.posix.join(sddDir, 'settings', 'rigor.json');
  const raw = await readText(settingsPath);

  if (!raw.exists) {
    return {
      check: {
        id: 'settings',
        label: 'Rigor declarado',
        status: 'fail',
        detail: `No existe ${display}: el repositorio no declara su nivel de rigor.`,
        fix: `open-sdd init . --write --level ${DEFAULT_RIGOR_LEVEL}`,
      },
      settingsPath,
      settingsExists: false,
    };
  }

  if (raw.content === null) {
    return {
      check: {
        id: 'settings',
        label: 'Rigor declarado',
        status: 'fail',
        detail: `${display} existe pero no se pudo leer (${raw.error ?? 'error de lectura'}): no se pudo comprobar su contenido y no se da por bueno.`,
        fix: `Revisa los permisos de ${display} o vuélvelo a declarar con \`open-sdd init . --write\`.`,
      },
      settingsPath,
      settingsExists: true,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.content);
  } catch (error) {
    return {
      check: {
        id: 'settings',
        label: 'Rigor declarado',
        status: 'fail',
        detail: `${display} no es JSON válido (${(error as Error).message}). No se degrada en silencio: un archivo roto no puede convertirse en una bajada invisible de exigencia.`,
        fix: `Corrige o elimina ${display} y vuelve a declararlo con \`open-sdd init . --write --level ${DEFAULT_RIGOR_LEVEL}\`.`,
      },
      settingsPath,
      settingsExists: true,
    };
  }

  try {
    const settings = resolveRigorSettings(parsed as Parameters<typeof resolveRigorSettings>[0]);
    const admitted = RIGOR_LEVELS.map((level) => level.level).join('|');
    if (!isRigorLevel(settings.level)) {
      throw new Error(`Nivel de rigor inválido. Admitidos: ${admitted}.`);
    }
    return {
      check: {
        id: 'settings',
        label: 'Rigor declarado',
        status: 'ok',
        detail: `nivel ${settings.level} · gates activos: ${effectiveGates(settings.level, settings.gates).join(', ')} · rationale declarado ("${settings.rationale.slice(0, 80)}${settings.rationale.length > 80 ? '…' : ''}").`,
      },
      settingsPath,
      settingsExists: true,
    };
  } catch (error) {
    return {
      check: {
        id: 'settings',
        label: 'Rigor declarado',
        status: 'fail',
        detail: `${display} es JSON válido pero no declara un rigor utilizable: ${(error as Error).message}`,
        fix: `Escribe un nivel admitido (${RIGOR_LEVELS.map((level) => level.level).join('|')}) y un rationale NO vacío en ${display}.`,
      },
      settingsPath,
      settingsExists: true,
    };
  }
};

const constitutionCandidates = (sddDir: string): string[] => [
  path.join(sddDir, 'steering', 'constitution.md'),
  path.join(sddDir, 'constitution.md'),
];

const checkConstitution = async (cwd: string, sddDir: string): Promise<DoctorCheck> => {
  const candidates = constitutionCandidates(sddDir);
  let found: string | null = null;
  for (const candidate of candidates) {
    if (await exists(path.join(cwd, candidate))) {
      found = candidate;
      break;
    }
  }

  if (found === null) {
    return {
      id: 'constitution',
      label: 'Constitución',
        status: 'fail',
        detail: `No existe ${path.posix.join(sddDir, 'steering', 'constitution.md')}: sin autoridad que citar, ningún veredicto bloqueante puede justificarse (obligatoria en los tres niveles de rigor).`,
      fix: '`open-sdd brownfield constitution . --write` la deriva del código cuando existe; en un proyecto nuevo, escríbela a mano antes de especificar.',
    };
  }

  const raw = await readText(path.join(cwd, found));
  if (raw.content === null) {
    return {
      id: 'constitution',
      label: 'Constitución',
        status: 'warn',
        detail: `La constitución existe en ${found} pero no se pudo comprobar (${raw.error ?? 'error de lectura'}): no se informa como válida.`,
      fix: `Revisa los permisos de ${found} y vuelve a ejecutar \`open-sdd doctor\`.`,
    };
  }

  const constitution = parseConstitution(raw.content);
  const issues = validateConstitution(constitution);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const inForce = principlesInForce(constitution);
  const amendments = constitution.amendments.filter((amendment) => amendment.status === 'proposed').length;

  if (errors.length > 0) {
    return {
      id: 'constitution',
      label: 'Constitución',
        status: 'fail',
        detail: `${found}: inválida (${errors.length} error(es)) — ${errors.map((issue) => `${issue.id}: ${issue.message}`).join(' | ')}`,
      fix: `Corrige los errores señalados en ${found} (la anatomía de un principio son seis campos, y un MUST debe nombrar su amenaza).`,
    };
  }

  if (inForce.length === 0) {
    return {
      id: 'constitution',
      label: 'Constitución',
        status: 'fail',
        detail: `${found}: válida en forma pero sin principios en vigor: no hay autoridad citable.`,
      fix: `Genera la constitución descriptiva: \`open-sdd brownfield constitution . --write\`.`,
    };
  }

  return {
    id: 'constitution',
    label: 'Constitución',
    status: 'ok',
    detail: `${found}: ${inForce.length} principio(s) en vigor · procedencia ${constitution.provenance} · ${amendments} enmienda(s) propuesta(s)${warnings.length > 0 ? ` · ${warnings.length} aviso(s)` : ''}.`,
  };
};

const checkSpecs = async (cwd: string, sddDir: string): Promise<DoctorCheck> => {
  const specsDir = path.join(cwd, sddDir, 'specs');
  let entries;
  try {
    entries = await readdir(specsDir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {
        id: 'specs',
        label: 'Especificaciones',
        status: 'ok',
        detail: `No hay especificaciones todavía (${path.posix.join(sddDir, 'specs')} no existe): no hay ninguna tríada que comprobar.`,
      };
    }
    return {
      id: 'specs',
      label: 'Especificaciones',
      status: 'warn',
      detail: `La tríada no se pudo comprobar en ninguna especificación: ${path.posix.join(sddDir, 'specs')} no se pudo leer (${(error as Error).message}).`,
      fix: `Revisa los permisos de ${path.posix.join(sddDir, 'specs')} y vuelve a ejecutar \`open-sdd doctor\`.`,
    };
  }

  const features = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'));
  if (features.length === 0) {
    return {
      id: 'specs',
      label: 'Especificaciones',
      status: 'ok',
      detail: 'No hay especificaciones todavía: no hay ninguna tríada que comprobar.',
    };
  }

  const incomplete: { feature: string; missing: string[] }[] = [];
  const unreadable: string[] = [];
  for (const feature of features) {
    const files = await readdir(path.join(specsDir, feature.name)).catch(() => null);
    if (files === null) {
      unreadable.push(feature.name);
      continue;
    }
    const verdict = evaluateTriad(files.filter((name) => !name.startsWith('.')));
    if (!verdict.complete) incomplete.push({ feature: feature.name, missing: verdict.missing });
  }

  if (incomplete.length > 0) {
    return {
      id: 'specs',
      label: 'Especificaciones',
      status: 'warn',
      detail: `${features.length} especificación(es); tríada incompleta en ${incomplete.length}: ${incomplete.map((item) => `${item.feature} → falta ${item.missing.join(', ')}`).join(' | ')}${unreadable.length > 0 ? ` (no se pudo comprobar: ${unreadable.join(', ')})` : ''}.`,
      fix: `Completa la tríada de la primera spec incompleta o consulta su estado: \`open-sdd status ${incomplete[0].feature}\`.`,
    };
  }

  if (unreadable.length > 0) {
    return {
      id: 'specs',
      label: 'Especificaciones',
      status: 'warn',
      detail: `En ${unreadable.length} especificación(es) no se pudo comprobar la tríada: ${unreadable.join(', ')}. Las legibles están completas.`,
      fix: `Revisa los permisos de ${path.posix.join(sddDir, 'specs', unreadable[0])} y vuelve a ejecutar \`open-sdd doctor\`.`,
    };
  }

  return {
    id: 'specs',
    label: 'Especificaciones',
    status: 'ok',
    detail: `${features.length} especificación(es) y todas con la tríada completa: ${features.map((feature) => feature.name).join(', ')}.`,
  };
};

/** Comprobación positiva: reporta una garantía del producto en vez de buscar un defecto. */
const checkModelOffline = (): DoctorCheck => ({
  id: 'model-offline',
  label: 'Sin modelo y sin red',
  status: 'ok',
  detail:
    'No se requiere backend de modelo ni acceso a red: el CLI es determinista y funciona offline. La alineación de intención (C5) se reporta como `mode=degraded` cuando no hay modelo, y NO se cuenta como evidencia.',
});

const checkEnvironment = (
  cwd: string,
  sddDir: string,
  repoRoot: string | null,
): DoctorCheck => {
  const git = run('git', ['--version'], cwd);
  const details: string[] = [];
  let status: DoctorCheck['status'] = 'ok';
  let fix: string | undefined;

  if (git.ok) {
    details.push(`git presente (${git.stdout || 'versión no reportada'})`);
  } else {
    status = 'fail';
    details.push('git NO está disponible: sin git no hay hook de commit ni trazabilidad de cambios');
    fix = 'Instala git (https://git-scm.com/downloads) y vuelve a ejecutar `open-sdd doctor`.';
  }

  if (repoRoot) {
    details.push(`raíz del repositorio resoluble: ${repoRoot}`);
  } else {
    if (status === 'ok') status = 'warn';
    details.push('raíz del repositorio NO resoluble: no se pudo comprobar (no es un repositorio git)');
    fix = fix ?? `Inicializa el repositorio con \`git init\` en ${quote(cwd)} si quieres el suelo de commit.`;
  }

  details.push(`directorio de diagnóstico: ${cwd} · SDD: ${sddDir}`);
  return {
    id: 'environment',
    label: 'Entorno',
    status,
    detail: details.join(' · '),
    ...(fix && status !== 'ok' ? { fix } : {}),
  };
};

// ---------------------------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------------------------

/**
 * Estado de los Stop hooks, SIN escribir nada: se reutiliza `installStopHook` en modo plan, que es
 * el mismo código que los instala, así que «instalado» significa exactamente lo que significará
 * cuando `integrate --write` corra. Solo se recorren los anfitriones VERIFICADOS (`STOP_HOOKS`):
 * para el resto no se reporta nada, porque no hay mecanismo que comprobar.
 *
 * Un `refused` de un anfitrión verificado (configuración ilegible o con forma inesperada) se reporta
 * como no instalado con su motivo; nunca se aprueba lo que no se pudo comprobar.
 *
 * La PRESENCIA se comprueba por estructura, no por identidad byte a byte: un hook que ejecuta la
 * MISMA invocación del gate (`STOP_HOOK_GATE_ARGS`) desde otra ruta del CLI está instalado, y decir
 * lo contrario sería un falso negativo por una diferencia que no cambia el comportamiento. El
 * `action` del instalador se conserva para poder decir qué haría `integrate --write`.
 */
const inspectStopHooks = async (cwd: string): Promise<StopHookReport[]> => {
  const cliPath = (await resolveCliExecutable(cwd)) ?? '<ruta-al-cli-open-sdd>';
  const reports: StopHookReport[] = [];
  for (const hook of STOP_HOOKS) {
    const install = await installStopHook({ cwd, host: hook.host, cliPath, write: false });
    const relative = install.path.length > 0 ? path.relative(cwd, install.path) || install.path : '(sin ruta)';

    let present = false;
    if (install.path.length > 0) {
      const raw = await readFile(install.path, 'utf8').catch(() => null);
      if (raw !== null) {
        try {
          const parsed = JSON.parse(raw) as { hooks?: { Stop?: unknown } };
          const stop = parsed?.hooks?.Stop;
          if (Array.isArray(stop)) {
            present = stop.some((entry) => {
              const serialized = JSON.stringify(entry);
              return STOP_HOOK_GATE_ARGS.every((arg) => serialized.includes(arg));
            });
          }
        } catch {
          // Un JSON inválido ya lo declara `install.reason`; aquí solo significa «no comprobado».
        }
      }
    }

    const installed = present || install.action === 'keep';
    reports.push({
      host: hook.host,
      path: install.path,
      installed,
      action: install.action,
      detail: installed
        ? install.action === 'keep'
          ? `instalado e idéntico en ${relative}.`
          : `instalado en ${relative} (ejecuta la misma invocación del gate; --write lo dejaría idéntico).`
        : install.action === 'refused'
          ? `no se pudo comprobar en ${relative}: ${install.reason}`
          : `no instalado en ${relative}: ${install.reason}`,
    });
  }
  return reports;
};

const computeDoctor = async (
  cwd: string,
  options: DoctorOptions = {},
): Promise<{ report: DoctorReport; facts: DoctorFacts }> => {
  const platform = options.platform ?? process.platform;
  const sddDir = options.sddDir ?? (await resolveSddDir(cwd));

  const top = run('git', ['rev-parse', '--show-toplevel'], cwd);
  const repoRoot = top.ok && top.stdout.length > 0 ? top.stdout.split('\n')[0].trim() : null;

  const hook = await checkHook(cwd, platform);
  const settings = await checkSettings(cwd, sddDir);
  const portability = await checkHookPortability(cwd, platform, hook);
  const stopHooks = await inspectStopHooks(cwd);

  const checks: DoctorCheck[] = [
    await checkNode(cwd, options.manifestPaths),
    await checkCli(cwd),
    hook.check,
    portability,
    settings.check,
    await checkConstitution(cwd, sddDir),
    await checkSpecs(cwd, sddDir),
    checkModelOffline(),
    checkEnvironment(cwd, sddDir, repoRoot),
  ];

  const counts = {
    ok: checks.filter((check) => check.status === 'ok').length,
    warn: checks.filter((check) => check.status === 'warn').length,
    fail: checks.filter((check) => check.status === 'fail').length,
  };
  const ok = counts.fail === 0;

  return {
    report: {
      checks,
      ok,
      counts,
      detail: `Diagnóstico de ${cwd}: ${counts.ok} ok · ${counts.warn} aviso(s) · ${counts.fail} fallo(s) — ${ok ? 'sin fallos' : 'hay fallos que bloquean'}.`,
      stopHooks,
    },
    facts: {
      sddDir,
      settingsPath: settings.settingsPath,
      settingsExists: settings.settingsExists,
      hookPath: hook.hookPath,
      hookState: hook.state,
      hookPortabilityBlocks: portability.status === 'fail',
      hookTemplatePath: hook.templatePath,
      hookTemplateContent: hook.templateContent,
      repoRoot,
    },
  };
};

export const runDoctor = async (cwd: string, options?: DoctorOptions): Promise<DoctorReport> =>
  (await computeDoctor(cwd, options)).report;

/** Una línea por comprobación, sin ANSI: el JSON queda limpio y el render es testeable. */
export const renderDoctor = (report: DoctorReport): string[] => {
  const mark: Record<DoctorCheck['status'], string> = { ok: '✓', warn: '!', fail: '✗' };
  const lines: string[] = [report.detail, ''];
  for (const check of report.checks) {
    lines.push(`${mark[check.status]} [${check.status.padEnd(4)}] ${check.label}: ${check.detail}`);
    if (check.status !== 'ok' && check.fix) lines.push(`      fix: ${check.fix}`);
  }
  if (report.stopHooks && report.stopHooks.length > 0) {
    lines.push('');
    lines.push('Stop hooks (el veredicto del gate dentro del bucle del agente; solo anfitriones verificados):');
    for (const hook of report.stopHooks) {
      lines.push(`${hook.installed ? '✓' : '!'} [${hook.installed ? 'ok' : 'warn'}] ${hook.host}: ${hook.detail}`);
      if (!hook.installed) lines.push(`      fix: open-sdd integrate ${hook.host} --write`);
    }
  }
  lines.push('');
  const failed = report.checks.filter((check) => check.status === 'fail');
  if (failed.length > 0) {
    lines.push(`FAIL — Corrige ${failed.length} fallo(s). \`open-sdd doctor --fix\` repara en sitio solo lo seguro: el hook y el archivo de rigor ausentes.`);
  } else {
    lines.push('PASS — Sin fallos. Los avisos documentan deuda, no bloquean: `open-sdd status --check` valida la spec contra la constitución.');
  }
  return lines;
};

const DEFAULT_RATIONALE = (level: string): string =>
  `Nivel ${level} elegido por \`open-sdd doctor --fix\` como valor por defecto del inicializador: exige requisitos en forma comprobable (EARS) y una constitución válida, y no exige todavía delta, ligado de evidencia ni detección de drift. Se sube editando este archivo, nunca bajando lo que el suelo ya comprueba.`;

/**
 * Reparaciones seguras e idempotentes. Solo dos, y ninguna toca un artefacto existente que no sea
 * nuestro propio hook: crear el archivo de rigor ausente y reinstalar el hook propio. Todo lo demás
 * se reporta con el comando que lo arregla, porque `--fix` no debe reescribir decisiones humanas.
 */
const applyFixes = async (cwd: string, facts: DoctorFacts): Promise<string[]> => {
  const done: string[] = [];
  const display = path.posix.join(facts.sddDir, 'settings', 'rigor.json');

  if (!facts.settingsExists) {
    try {
      await mkdir(path.dirname(facts.settingsPath), { recursive: true });
      await writeFile(
        facts.settingsPath,
        `${JSON.stringify(
          {
            level: DEFAULT_RIGOR_LEVEL,
            rationale: DEFAULT_RATIONALE(DEFAULT_RIGOR_LEVEL),
            brownfield: false,
            updated_at: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      done.push(`creado ${display} con nivel ${DEFAULT_RIGOR_LEVEL} y rationale declarado (no se sobrescribe nunca)`);
    } catch (error) {
      done.push(`no se pudo crear ${display} (${(error as Error).message})`);
    }
  } else {
    done.push(`= ${display} ya existe: se conserva sin tocar`);
  }

  const hookFixable =
    facts.hookPath !== null &&
    (facts.hookState === 'missing' || facts.hookState === 'stale' || facts.hookPortabilityBlocks);
  if (hookFixable && facts.hookTemplateContent !== null && facts.hookTemplatePath !== null) {
    try {
      await mkdir(path.dirname(facts.hookPath as string), { recursive: true });
      await writeFile(facts.hookPath as string, facts.hookTemplateContent, 'utf8');
      await chmod(facts.hookPath as string, 0o755);
      done.push(
        `reinstalado el hook de commit en ${path.relative(cwd, facts.hookPath as string)} desde la plantilla vigente (${path.basename(facts.hookTemplatePath)})`,
      );
    } catch (error) {
      done.push(`no se pudo reinstalar el hook (${(error as Error).message})`);
    }
  } else if (facts.hookState === 'not-executable' && facts.hookPath !== null) {
    try {
      await chmod(facts.hookPath, 0o755);
      done.push(`hook marcado como ejecutable: chmod +x ${facts.hookPath}`);
    } catch (error) {
      done.push(`no se pudo marcar el hook como ejecutable (${(error as Error).message})`);
    }
  } else if (facts.hookState === 'foreign') {
    done.push(
      `el hook instalado es ajeno: no se toca (una reparación automática no debe reemplazar decisiones humanas). Ejecuta: open-sdd floor install ${quote(cwd)} --force`,
    );
  } else if (facts.hookState === 'current') {
    done.push('= el hook de commit ya es la versión vigente: no se toca');
  }

  return done;
};

export const handleDoctorCommand = async (
  args: string[],
  io: CliIO,
  cwd: string = process.cwd(),
): Promise<number> => {
  const json = args.includes('--json');
  const fix = args.includes('--fix');
  const sddArg = args.find((arg) => arg.startsWith('--sdd-dir='));
  const sddDir = sddArg ? sddArg.slice('--sdd-dir='.length) : undefined;
  const positional = args.find((arg) => !arg.startsWith('-'));
  const target = positional ? path.resolve(cwd, positional) : cwd;
  const options: DoctorOptions = sddDir ? { sddDir } : {};

  let computed = await computeDoctor(target, options);
  const repaired: string[] = [];
  if (fix) {
    repaired.push(...(await applyFixes(target, computed.facts)));
    computed = await computeDoctor(target, options);
  }

  if (json) {
    io.log(JSON.stringify({ ...computed.report, fixes: repaired }, null, 2));
    return computed.report.ok ? 0 : 1;
  }

  const paint: Record<DoctorCheck['status'], (value: string) => string> = {
    ok: colors.green,
    warn: colors.yellow,
    fail: colors.red,
  };
  io.log('');
  for (const check of computed.report.checks) {
    const mark =
      check.status === 'ok' ? colors.green('✓') : check.status === 'warn' ? colors.yellow('!') : colors.red('✗');
    io.log(`${mark} ${paint[check.status](`[${check.status}]`)} ${colors.bold(check.label)}: ${check.detail}`);
    if (check.status !== 'ok' && check.fix) io.log(colors.dim(`      fix: ${check.fix}`));
  }
  io.log('');
  if (computed.report.stopHooks && computed.report.stopHooks.length > 0) {
    io.log(colors.bold(colors.cyan('Stop hooks (el gate dentro del bucle del agente; solo anfitriones verificados):')));
    for (const hook of computed.report.stopHooks) {
      io.log(`${hook.installed ? colors.green('✓') : colors.yellow('!')} ${colors.bold(hook.host)}: ${hook.detail}`);
      if (!hook.installed) io.log(colors.dim(`      fix: open-sdd integrate ${hook.host} --write`));
    }
    io.log('');
  }
  if (repaired.length > 0) {
    io.log(colors.bold(colors.cyan('Reparaciones de --fix (solo seguras e idempotentes):')));
    for (const item of repaired) io.log(`  ${item.startsWith('=') ? colors.dim(item) : colors.green(`✓ ${item}`)}`);
    io.log('');
  }
  io.log(
    formatVerdict(
      computed.report.ok ? 'pass' : 'fail',
      computed.report.ok ? colors.green(computed.report.detail) : colors.red(computed.report.detail),
    ),
  );
  io.log('');
  return computed.report.ok ? 0 : 1;
};
