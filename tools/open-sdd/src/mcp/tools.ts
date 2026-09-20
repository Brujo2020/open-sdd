/**
 * Registro de herramientas y recursos MCP: la superficie AGNÓSTICA del producto.
 *
 * Cada entrada de este fichero mapea a UNA función que ya existe en `src/core/**`, sin lógica de
 * negocio nueva. Eso es deliberado: el CLI y el servidor MCP son dos pieles del mismo motor, así que
 * si una comprobación cambia, cambia para los dos. Un host (Claude Code, Cursor, cualquier cliente
 * MCP) obtiene aquí exactamente los mismos veredictos que `open-sdd` en la terminal.
 *
 * ── Reglas de la superficie ─────────────────────────────────────────────────────────────────────
 *  1. `additionalProperties: false` en TODOS los esquemas. Un host que manda un campo que no existe
 *     se equivoca en voz alta en vez de creer que se aplicó.
 *  2. `isError: true` cuando la comprobación subyacente reporta un error, y `false` solo cuando se
 *     pudo inspeccionar y no hay error. Un artefacto ausente que la herramienta declara en
 *     `detail`/`reason` no es un aprobado silencioso: es la ausencia, dicha.
 *  3. Nunca se lanza hacia el transporte: `callTool` convierte cualquier excepción en un resultado
 *     con `isError` y el mensaje. Solo un nombre de herramienta desconocido es un error JSON-RPC,
 *     porque eso es un error del protocolo, no del veredicto.
 *  4. Sin red, sin backend de modelo, sin claves. Todo son lecturas del repositorio y funciones puras
 *     sobre lo leído.
 *
 * `open_sdd_context_pack` es la pieza diferenciada: devuelve en UN objeto lo que un host debe
 * inyectar antes de editar (constitución + principios en vigor, spec aplicable, mapa de módulos y
 * rigor declarado con sus gates). Cada pieza declara `present: false` y `reason` cuando falta: el
 * host necesita saber que falta, no que la clave no exista.
 *
 * Textos visibles en español, como el resto del CLI.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  RIGOR_LEVELS,
  alignFeature,
  alignSpecWithConstitution,
  analyzeChangeImpact,
  assessRigor,
  buildModuleMap,
  buildStatus,
  constitutionCandidates,
  deltaCounts,
  effectiveGates,
  extractContracts,
  findRepoRoot,
  findReuseCandidates,
  focusFeature,
  getModifiedFiles,
  inspectFeature,
  listSpecs,
  loadConstitution,
  loadRigorSettings,
  parseDeltaSpec,
  parseTasksMarkdown,
  planBootstrap,
  principlesInForce,
  resolveSddDir,
  runChain,
  scanProject,
  strangulationReport,
  traceDelta,
  validateConstitution,
  validateDeltaSpec,
  type DeltaSpec,
  type GateRunContext,
  type SddRigorLevel,
} from '../core/index.js';
import { RPC_ERROR_CODES, RpcFault } from './protocol.js';

// ---------------------------------------------------------------------------------------------
// Tipos de la superficie
// ---------------------------------------------------------------------------------------------

export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  items?: { type: 'string' };
  enum?: string[];
}

export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
  additionalProperties: false;
}

/** Contexto de ejecución: SIEMPRE la raíz del repositorio y el directorio SDD ya resueltos. */
export interface McpToolContext {
  cwd: string;
  sddDir: string;
}

export interface ToolOutcome {
  /** Resultado JSON-serializable de la función de core. */
  data: unknown;
  /** true cuando la comprobación reporta error (o no pudo inspeccionar). */
  isError: boolean;
  /** Una línea en español con lo que el host debe saber. */
  detail: string;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchemaObject;
  handler: (args: Record<string, unknown>, context: McpToolContext) => Promise<ToolOutcome>;
}

/** Descriptor tal y como viaja en `tools/list`. */
export interface McpToolDescriptor {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchemaObject;
}

// ---------------------------------------------------------------------------------------------
// Utilidades de argumentos: validación estricta, mensajes claros
// ---------------------------------------------------------------------------------------------

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const requireString = (args: Record<string, unknown>, key: string, tool: string): string => {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${tool} exige el argumento requerido "${key}" (cadena no vacía).`);
  }
  return value.trim();
};

const optionalString = (args: Record<string, unknown>, key: string): string | undefined => {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`El argumento "${key}" debe ser una cadena.`);
  return value.trim().length > 0 ? value.trim() : undefined;
};

const optionalStringArray = (args: Record<string, unknown>, key: string): string[] | undefined => {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error(`El argumento "${key}" debe ser una lista de cadenas.`);
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const optionalNumber = (args: Record<string, unknown>, key: string): number | undefined => {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`El argumento "${key}" debe ser un número.`);
  }
  return value;
};

const optionalBoolean = (args: Record<string, unknown>, key: string): boolean | undefined => {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new Error(`El argumento "${key}" debe ser booleano.`);
  return value;
};

const optionalEnum = <T extends string>(args: Record<string, unknown>, key: string, allowed: readonly T[]): T | undefined => {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`El argumento "${key}" debe ser uno de: ${allowed.join(', ')}.`);
  }
  return value as T;
};

/** Leer un fichero distinguiendo «no existe» de «existe pero no se pudo leer». */
const readTextIfPresent = async (absPath: string): Promise<string | null> => {
  try {
    return await readFile(absPath, 'utf8');
  } catch {
    return null;
  }
};

const relativeSpecDir = (context: McpToolContext, feature: string): string =>
  path.join(context.sddDir, 'specs', feature);

const readDeltaIfPresent = async (context: McpToolContext, feature: string): Promise<DeltaSpec | undefined> => {
  const raw = await readTextIfPresent(path.join(context.cwd, relativeSpecDir(context, feature), 'delta.md'));
  return raw === null ? undefined : parseDeltaSpec(raw);
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// ---------------------------------------------------------------------------------------------
// Herramientas
// ---------------------------------------------------------------------------------------------

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'open_sdd_status',
    title: 'Panel único de estado',
    description:
      'Estado completo del proyecto en un solo objeto: constitución, specs (tríada, trazabilidad, evidencia), delta, contratos, pivote constitucional y rigor, con la siguiente acción concreta. Es la primera llamada que un host debería hacer para saber dónde está.',
    inputSchema: {
      type: 'object',
      properties: {
        feature: { type: 'string', description: 'Especificación sobre la que enfocar el panel. Si se omite, se agregan todas.' },
        sddDir: { type: 'string', description: 'Directorio SDD (por defecto .sdd, o .kiro como alias legacy).' },
      },
      required: [],
      additionalProperties: false,
    },
    handler: async (args, context) => {
      const feature = optionalString(args, 'feature');
      const report = await buildStatus(context.cwd, { ...(feature ? { feature } : {}), sddDir: context.sddDir });
      const failed = report.lines.filter((line) => line.tone === 'err');
      const isError = !report.complete || failed.length > 0;
      return {
        data: report,
        isError,
        detail: !report.complete
          ? 'Panel INCOMPLETO: hay artefactos que no se pudieron inspeccionar, y lo no inspeccionado no es un aprobado.'
          : failed.length > 0
            ? `Panel con ${failed.length} línea(s) en error.`
            : `Panel leído por completo con nivel ${report.level}.`,
      };
    },
  },
  {
    name: 'open_sdd_constitution_check',
    title: 'Pivote constitucional',
    description:
      'Contrasta una especificación CONTRA la constitución: resuelve los principios que la spec declara, detecta autoridad fantasma, contradicciones de stack (MUST_CONTRADICTED / TECH_LOCK_VIOLATION) y exigencias de frontera, compatibilidad de API y oráculo de regresión. Es el pivote: sin autoridad en vigor no hay veredicto. Acepta textos en línea (requirements/plan/tasks/delta) o lee la feature del repositorio.',
    inputSchema: {
      type: 'object',
      properties: {
        feature: { type: 'string', description: 'Especificación a contrastar. Si se omiten los textos, se lee del repositorio.' },
        requirements: { type: 'string', description: 'Texto de requirements.md para contrastarlo sin leer el disco.' },
        plan: { type: 'string', description: 'Texto del plan/design para contrastarlo sin leer el disco.' },
        tasks: { type: 'string', description: 'Texto de tasks.md para contrastarlo sin leer el disco.' },
        delta: { type: 'string', description: 'Markdown de la delta para contrastarlo sin leer el disco.' },
        changedFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ficheros cambiados por el cambio, para la comprobación de fronteras.',
        },
        sddDir: { type: 'string', description: 'Directorio SDD (por defecto .sdd).' },
      },
      required: [],
      additionalProperties: false,
    },
    handler: async (args, context) => {
      const feature = optionalString(args, 'feature');
      const requirements = optionalString(args, 'requirements');
      const plan = optionalString(args, 'plan');
      const tasks = optionalString(args, 'tasks');
      const delta = optionalString(args, 'delta');
      const changedFiles = optionalStringArray(args, 'changedFiles');
      const inline = Boolean(requirements || plan || tasks || delta);

      if (inline) {
        const read = await loadConstitution(context.cwd, context.sddDir);
        if (!read.exists || read.constitution === null) {
          return {
            data: {
              feature: feature ?? 'inline',
              constitutionPath: read.path,
              constitutionPresent: read.exists,
              alignment: null,
            },
            isError: true,
            detail: read.exists
              ? `Constitución ilegible (${read.path ?? 'ruta desconocida'}): sin autoridad legible no hay pivote que ejecutar.`
              : `Constitución ausente (${constitutionCandidates(context.sddDir)[0]}): sin autoridad no hay pivote que ejecutar.`,
          };
        }
        const alignment = alignSpecWithConstitution({
          feature: feature ?? 'inline',
          constitution: read.constitution,
          ...(requirements ? { requirements } : {}),
          ...(plan ? { plan } : {}),
          ...(tasks ? { tasks } : {}),
          ...(delta ? { delta: parseDeltaSpec(delta) } : {}),
          ...(changedFiles ? { changedFiles } : {}),
        });
        const errors = alignment.findings.filter((finding) => finding.severity === 'error').length;
        return { data: alignment, isError: errors > 0, detail: alignment.detail };
      }

      const outcome = await alignFeature(context.cwd, { ...(feature ? { feature } : {}), sddDir: context.sddDir });
      if (!outcome.alignment) {
        return {
          data: {
            root: outcome.root,
            feature: outcome.feature,
            alignment: null,
            changedFiles: outcome.changedFiles,
            uninspected: outcome.uninspected,
          },
          isError: true,
          detail: outcome.error ?? 'El pivote constitucional no se pudo ejecutar.',
        };
      }
      const errors = outcome.alignment.findings.filter((finding) => finding.severity === 'error').length;
      return {
        data: {
          root: outcome.root,
          feature: outcome.feature,
          alignment: outcome.alignment,
          changedFiles: outcome.changedFiles,
          uninspected: outcome.uninspected,
        },
        isError: errors > 0,
        detail: outcome.alignment.detail,
      };
    },
  },
  {
    name: 'open_sdd_validate_delta',
    title: 'Validar la delta',
    description:
      'Valida el contrato del cambio (delta.md): identificadores REQ-<ÁREA>-<NNN> propios de la delta, enunciados en forma EARS, objetivos, previous/contracts en modificaciones y eliminaciones, recuento por tipo, progreso del estrangulamiento y trazabilidad delta→tareas.',
    inputSchema: {
      type: 'object',
      properties: {
        feature: { type: 'string', description: 'Especificación cuya delta se valida.' },
        delta: { type: 'string', description: 'Markdown de la delta; si se omite se lee .sdd/specs/<feature>/delta.md.' },
        tasks: { type: 'string', description: 'Markdown de tasks.md para la trazabilidad; si se omite se lee del repositorio.' },
        sddDir: { type: 'string', description: 'Directorio SDD (por defecto .sdd).' },
      },
      required: ['feature'],
      additionalProperties: false,
    },
    handler: async (args, context) => {
      const feature = requireString(args, 'feature', 'open_sdd_validate_delta');
      const inlineDelta = optionalString(args, 'delta');
      const raw =
        inlineDelta ?? (await readTextIfPresent(path.join(context.cwd, relativeSpecDir(context, feature), 'delta.md')));
      if (raw === null) {
        return {
          data: { feature, present: false, path: relativeSpecDir(context, feature) },
          isError: true,
          detail: `No hay delta para "${feature}" en ${path.join(relativeSpecDir(context, feature), 'delta.md')}: sin contrato del cambio no hay nada que validar.`,
        };
      }

      const delta = parseDeltaSpec(raw);
      const issues = validateDeltaSpec(delta);
      const errors = issues.filter((issue) => issue.severity === 'error');

      const tasksRaw =
        optionalString(args, 'tasks') ??
        (await readTextIfPresent(path.join(context.cwd, relativeSpecDir(context, feature), 'tasks.md')));
      const tasks = tasksRaw
        ? parseTasksMarkdown(tasksRaw).map((task) => ({
            id: task.id,
            raw: task.raw,
            ...(task.boundary ? { boundary: task.boundary } : {}),
          }))
        : [];

      const data = {
        feature,
        present: true,
        path: path.join(relativeSpecDir(context, feature), 'delta.md'),
        delta,
        counts: deltaCounts(delta),
        strangulation: strangulationReport(delta),
        issues,
        traceability: traceDelta(delta, tasks),
      };
      return {
        data,
        isError: errors.length > 0,
        detail:
          errors.length > 0
            ? `Delta de "${feature}" INVÁLIDA: ${errors.length} error(es) — ${errors.map((issue) => `${issue.code} (${issue.id})`).join(', ')}.`
            : `Delta de "${feature}" válida: ${delta.entries.length} entrada(s), ${deltaCounts(delta).ADDED} ADDED y ${deltaCounts(delta).MODIFIED} MODIFIED.`,
      };
    },
  },
  {
    name: 'open_sdd_contracts',
    title: 'Oráculo de regresión',
    description:
      'Extrae el conjunto de contratos de ejecución del cambio: qué pruebas descubiertas protegen cada fichero cambiado, qué contratos declara la delta y qué cambios quedan SIN cobertura. Un run verde con un contrato declarado ausente no es un aprobado.',
    inputSchema: {
      type: 'object',
      properties: {
        feature: { type: 'string', description: 'Especificación cuyo conjunto de contratos se extrae.' },
        changedFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ficheros cambiados; si se omite se usa el diff del repositorio (git).',
        },
        sddDir: { type: 'string', description: 'Directorio SDD (por defecto .sdd).' },
      },
      required: ['feature'],
      additionalProperties: false,
    },
    handler: async (args, context) => {
      const feature = requireString(args, 'feature', 'open_sdd_contracts');
      const delta = await readDeltaIfPresent(context, feature);
      const changedFiles = optionalStringArray(args, 'changedFiles') ?? getModifiedFiles(context.cwd);
      const project = await scanProject(context.cwd);
      const set = await extractContracts({
        cwd: context.cwd,
        feature,
        changedFiles,
        ...(delta ? { delta } : {}),
        testDirs: project.testDirs,
        ...(project.testFramework ? { testFramework: project.testFramework } : {}),
      });
      const isError = !set.complete || set.uncoveredChanges.length > 0;
      return {
        data: set,
        isError,
        detail: !set.complete
          ? `Oráculo INCOMPLETO: ${set.detail}`
          : set.uncoveredChanges.length > 0
            ? `${set.uncoveredChanges.length} cambio(s) sin contrato que los proteja: un run verde no demuestra nada sobre ellos.`
            : set.detail,
      };
    },
  },
  {
    name: 'open_sdd_impact',
    title: 'Radio de impacto',
    description:
      'Analiza el radio de impacto de un cambio: ficheros/módulos dependientes, cambios incompatibles (símbolos exportados retirados), puntos de integración, migraciones y su rollback y superficie de API pública, con el tamaño del blast radius.',
    inputSchema: {
      type: 'object',
      properties: {
        changedFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ficheros cambiados; si se omite se usa el diff del repositorio (git).',
        },
        feature: { type: 'string', description: 'Especificación de la que tomar la delta declarada, si existe.' },
        maxDepth: { type: 'number', description: 'Profundidad máxima al recorrer importadores (por defecto 3).' },
        sddDir: { type: 'string', description: 'Directorio SDD (por defecto .sdd).' },
      },
      required: [],
      additionalProperties: false,
    },
    handler: async (args, context) => {
      const feature = optionalString(args, 'feature');
      const maxDepth = optionalNumber(args, 'maxDepth');
      const changedFiles = optionalStringArray(args, 'changedFiles') ?? getModifiedFiles(context.cwd);
      const delta = feature ? await readDeltaIfPresent(context, feature) : undefined;
      const report = await analyzeChangeImpact({
        cwd: context.cwd,
        changedFiles,
        ...(delta ? { delta } : {}),
        ...(maxDepth !== undefined ? { maxDepth } : {}),
      });
      const errors = report.findings.filter((finding) => finding.severity === 'error');
      const isError = !report.complete || errors.length > 0;
      return {
        data: report,
        isError,
        detail: !report.complete
          ? `Impacto NO evaluado por completo: ${report.detail}`
          : errors.length > 0
            ? `${errors.length} cambio(s) incompatible(s) detectado(s): ${errors.map((finding) => finding.message).join(' | ')}`
            : report.detail,
      };
    },
  },
  {
    name: 'open_sdd_reuse_search',
    title: 'Búsqueda de reutilización (antes de crear)',
    description:
      'Busca símbolos ya existentes que podrían reutilizarse antes de crear código nuevo. Es la llamada que un agente debe hacer ANTES de escribir un fichero: si hay candidato, crear sería duplicar. Devuelve similitud, fichero y línea.',
    inputSchema: {
      type: 'object',
      properties: {
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Nombres de símbolo que el agente pretende crear.',
        },
        reason: { type: 'string', description: 'Motivo de la búsqueda, para el informe.' },
        threshold: { type: 'number', description: 'Similitud mínima 0..1 (por defecto 0.6).' },
        sddDir: { type: 'string', description: 'Directorio SDD (por defecto .sdd).' },
      },
      required: ['symbols'],
      additionalProperties: false,
    },
    handler: async (args, context) => {
      const symbols = optionalStringArray(args, 'symbols') ?? [];
      if (symbols.length === 0) {
        throw new Error('open_sdd_reuse_search exige al menos un símbolo en "symbols".');
      }
      const reason = optionalString(args, 'reason') ?? 'búsqueda de reutilización previa a crear código nuevo';
      const threshold = optionalNumber(args, 'threshold');
      const report = await findReuseCandidates({
        cwd: context.cwd,
        requests: symbols.map((symbol) => ({ symbol, reason })),
        ...(threshold !== undefined ? { threshold } : {}),
      });
      const isError = !report.complete || report.violations.length > 0;
      return {
        data: report,
        isError,
        detail: !report.complete
          ? `Búsqueda NO concluyente: ${report.detail} «No hay candidatos» no está demostrado.`
          : report.violations.length > 0
            ? `NO crees todavía: ${report.violations.join(', ')} ya tienen candidato reutilizable.`
            : report.detail,
      };
    },
  },
  {
    name: 'open_sdd_module_map',
    title: 'Mapa de módulos',
    description:
      'Mapa de módulos observados del repositorio: ruta, nombre, ficheros que posee, responsabilidades derivadas de evidencia, dependencias y directorios de test.',
    inputSchema: {
      type: 'object',
      properties: {
        sddDir: { type: 'string', description: 'Directorio SDD (por defecto .sdd).' },
      },
      required: [],
      additionalProperties: false,
    },
    handler: async (_args, context) => {
      const map = await buildModuleMap(context.cwd);
      return {
        data: map,
        isError: !map.complete,
        detail: map.complete
          ? `Mapa de módulos completo: ${map.modules.length} módulo(s).`
          : `Mapa de módulos INCOMPLETO: ${map.detail}`,
      };
    },
  },
  {
    name: 'open_sdd_plan_bootstrap',
    title: 'Plan de bootstrap brownfield',
    description:
      'Plan de arranque para un repositorio existente: módulos, artefactos que se crearían/regenerarían/conservarían (constitución, inteligencia del código, semilla de delta) y los pasos ejecutables en orden. No escribe nada.',
    inputSchema: {
      type: 'object',
      properties: {
        focus: { type: 'string', description: 'Foco del primer cambio, para sembrar su delta.' },
        sddDir: { type: 'string', description: 'Directorio SDD (por defecto .sdd).' },
      },
      required: [],
      additionalProperties: false,
    },
    handler: async (args, context) => {
      const focus = optionalString(args, 'focus');
      const plan = await planBootstrap({ cwd: context.cwd, ...(focus ? { focus } : {}) });
      return {
        data: plan,
        isError: !plan.complete,
        detail: plan.complete
          ? plan.detail
          : `Plan INCOMPLETO (no se pudo reconocer del todo el proyecto): ${plan.detail}`,
      };
    },
  },
  {
    name: 'open_sdd_rigor',
    title: 'Rigor declarado y evaluación',
    description:
      'Nivel de rigor declarado en .sdd/settings/rigor.json, gates que activa y evaluación del repositorio contra ese nivel (constitución, tríada, delta, trazabilidad, evidencia, drift, contratos, regeneración). Incluye la escalera completa de niveles.',
    inputSchema: {
      type: 'object',
      properties: {
        feature: { type: 'string', description: 'Especificación a evaluar; si se omite, la evaluación es del repositorio.' },
        level: {
          type: 'string',
          enum: ['spec-first', 'spec-anchored', 'spec-as-source'],
          description: 'Nivel a evaluar; por defecto el declarado en rigor.json.',
        },
        brownfield: { type: 'boolean', description: 'Forzar el modo brownfield; por defecto el declarado.' },
        gates: {
          type: 'array',
          items: { type: 'string' },
          description: 'Sustituir el conjunto de gates activos (ids válidos del catálogo).',
        },
        sddDir: { type: 'string', description: 'Directorio SDD (por defecto .sdd).' },
      },
      required: [],
      additionalProperties: false,
    },
    handler: async (args, context) => {
      const settings = await loadRigorSettings(context.cwd, context.sddDir);
      const level = optionalEnum<SddRigorLevel>(args, 'level', ['spec-first', 'spec-anchored', 'spec-as-source']) ?? settings.level;
      const brownfield = optionalBoolean(args, 'brownfield') ?? settings.brownfield;
      const feature = optionalString(args, 'feature');
      const override = optionalStringArray(args, 'gates');
      const gates = effectiveGates(level, override ?? settings.gates);
      const assessment = await assessRigorSafely(context, { level, brownfield, feature, gates });
      return {
        data: { declared: settings, level, brownfield, activeGates: gates, levels: RIGOR_LEVELS, assessment },
        isError: !assessment.satisfied,
        detail: assessment.satisfied
          ? `Rigor "${level}" satisfecho con los gates ${gates.join(', ') || '(ninguno)'}.`
          : `Rigor "${level}" NO satisfecho: ${assessment.detail}`,
      };
    },
  },
  {
    name: 'open_sdd_gates_run',
    title: 'Ejecutar la cadena de gates',
    description:
      'Ejecuta la cadena Zero-Trust sobre la feature indicada (por defecto los gates que activa el rigor declarado) y devuelve el veredicto por gate con su autoridad. `passed` es falso si algún gate falla.',
    inputSchema: {
      type: 'object',
      properties: {
        gates: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ids de gate a ejecutar; por defecto los que activa el nivel de rigor declarado.',
        },
        feature: { type: 'string', description: 'Especificación bajo evaluación; por defecto la primera del repositorio.' },
        changedFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ficheros cambiados que la cadena juzga; si se omite se usa el diff del repositorio.',
        },
        declaredScope: {
          type: 'array',
          items: { type: 'string' },
          description: 'Alcance declarado de la tarea, para el gate de contención de alcance.',
        },
        regime: {
          type: 'string',
          enum: ['flexible', 'strict'],
          description: 'Régimen de postura: en strict un sensor no disponible cuenta como fallo.',
        },
        sddDir: { type: 'string', description: 'Directorio SDD (por defecto .sdd).' },
      },
      required: [],
      additionalProperties: false,
    },
    handler: async (args, context) => {
      const settings = await loadRigorSettings(context.cwd, context.sddDir);
      const gates = optionalStringArray(args, 'gates') ?? effectiveGates(settings.level, settings.gates);
      const regime = optionalEnum(args, 'regime', ['flexible', 'strict'] as const) ?? 'flexible';
      const feature =
        optionalString(args, 'feature') ?? (await listSpecs(context.cwd, context.sddDir))[0] ?? 'sin-feature';
      const changedFiles = optionalStringArray(args, 'changedFiles') ?? getModifiedFiles(context.cwd);
      const declaredScope = optionalStringArray(args, 'declaredScope') ?? [];
      if (gates.length === 0) {
        throw new Error('open_sdd_gates_run no recibió ningún gate: declara rigor.json o pasa "gates".');
      }
      const gateContext: GateRunContext = {
        cwd: context.cwd,
        sddDir: context.sddDir,
        feature,
        changedFiles,
        declaredScope,
      };
      const report = await runChain(gates, gateContext, regime);
      return {
        data: report,
        isError: !report.passed,
        detail: report.passed
          ? `La cadena pasa (${report.findings.length} control(es)) sobre "${feature}".`
          : `La cadena NO pasa sobre "${feature}": ${report.findings
              .filter((finding) => finding.outcome === 'fail')
              .map((finding) => finding.gateId)
              .join(', ')}.`,
      };
    },
  },
  {
    name: 'open_sdd_context_pack',
    title: 'Context pack (lo que el host debe inyectar)',
    description:
      'Devuelve en UN objeto todo lo que un host debe inyectar antes de editar: la constitución (texto + principios en vigor), la especificación aplicable (requirements/plan/tasks/delta), el mapa de módulos y el rigor declarado con sus gates activos. Cada pieza declara explícitamente `present: false` y `reason` cuando falta, en lugar de omitir la clave.',
    inputSchema: {
      type: 'object',
      properties: {
        feature: { type: 'string', description: 'Especificación aplicable; por defecto la primera con delta, o la primera.' },
        sddDir: { type: 'string', description: 'Directorio SDD (por defecto .sdd).' },
      },
      required: [],
      additionalProperties: false,
    },
    handler: async (args, context) => {
      const requested = optionalString(args, 'feature');
      const feature = requested ?? (await focusFeature(context.cwd, context.sddDir));
      const absent: string[] = [];

      // ── Constitución ────────────────────────────────────────────────────────────────────────
      const constitutionRead = await loadConstitution(context.cwd, context.sddDir);
      let constitution: Record<string, unknown>;
      if (constitutionRead.exists && constitutionRead.constitution !== null) {
        const text = await readTextIfPresent(path.join(context.cwd, constitutionRead.path ?? ''));
        constitution = {
          present: true,
          path: constitutionRead.path,
          text: text ?? '',
          principlesInForce: principlesInForce(constitutionRead.constitution).map((principle) => ({
            id: principle.id,
            title: principle.title,
            level: principle.level,
            restriction: principle.restriction,
          })),
          issues: validateConstitution(constitutionRead.constitution),
        };
      } else {
        const candidate = constitutionCandidates(context.sddDir)[0];
        constitution = {
          present: false,
          path: candidate,
          text: '',
          principlesInForce: [],
          issues: [],
          reason: constitutionRead.exists ? 'existe pero no se pudo leer' : 'no presente',
        };
        absent.push('constitution');
      }

      // ── Especificación aplicable ────────────────────────────────────────────────────────────
      let spec: Record<string, unknown>;
      if (!feature) {
        spec = {
          present: false,
          feature: null,
          path: path.join(context.sddDir, 'specs'),
          reason: `no hay ninguna especificación en ${path.join(context.sddDir, 'specs')}`,
        };
        absent.push('spec');
      } else {
        const inspection = await inspectFeature(context.cwd, feature, context.sddDir);
        const specPath = relativeSpecDir(context, feature);
        if (!inspection.dirExists) {
          spec = { present: false, feature, path: specPath, reason: 'la feature no existe en el repositorio' };
          absent.push('spec');
        } else {
          const piece = async (file: string): Promise<Record<string, unknown>> => {
            const rel = path.join(specPath, file);
            const text = await readTextIfPresent(path.join(context.cwd, rel));
            if (text === null) return { present: false, path: rel, text: null, reason: 'no presente' };
            if (text.trim().length === 0) return { present: true, path: rel, text, reason: 'presente pero vacío' };
            return { present: true, path: rel, text };
          };
          const planFile = inspection.files.includes('plan.md') ? 'plan.md' : 'design.md';
          const requirements = await piece('requirements.md');
          const plan = await piece(planFile);
          const tasks = await piece('tasks.md');
          const delta = await piece('delta.md');
          if (delta.present) delta.parsed = inspection.delta;
          for (const [key, value] of [
            ['requirements', requirements],
            ['plan', plan],
            ['tasks', tasks],
            ['delta', delta],
          ] as const) {
            if (value.present !== true) absent.push(`spec.${key}`);
          }
          if (requirements.present !== true && plan.present !== true && tasks.present !== true) absent.push('spec.triad');
          spec = { present: true, feature, path: specPath, requirements, plan, tasks, delta };
        }
      }

      // ── Mapa de módulos ─────────────────────────────────────────────────────────────────────
      let moduleMap: Record<string, unknown>;
      try {
        const map = await buildModuleMap(context.cwd);
        moduleMap = {
          present: map.modules.length > 0,
          modules: map.modules,
          complete: map.complete,
          detail: map.detail,
          ...(map.modules.length > 0 ? {} : { reason: 'no se observó ningún módulo en el repositorio' }),
        };
        if (map.modules.length === 0) absent.push('moduleMap');
      } catch (error) {
        moduleMap = { present: false, modules: [], complete: false, reason: `no se pudo construir: ${errorMessage(error)}` };
        absent.push('moduleMap');
      }

      // ── Rigor declarado ─────────────────────────────────────────────────────────────────────
      let rigor: Record<string, unknown>;
      try {
        const settings = await loadRigorSettings(context.cwd, context.sddDir);
        rigor = {
          present: true,
          level: settings.level,
          brownfield: settings.brownfield,
          rationale: settings.rationale,
          activeGates: effectiveGates(settings.level, settings.gates),
        };
      } catch (error) {
        rigor = {
          present: false,
          reason: `el rigor declarado no se pudo leer (${errorMessage(error)}): no se degrada a spec-first`,
          level: null,
          activeGates: [],
        };
        absent.push('rigor');
      }

      return {
        data: {
          root: context.cwd,
          sddDir: context.sddDir,
          feature: feature ?? null,
          complete: absent.length === 0,
          absent,
          constitution,
          spec,
          moduleMap,
          rigor,
        },
        isError: false,
        detail:
          absent.length === 0
            ? `Context pack completo: constitución, spec "${feature}", mapa de módulos y rigor declarado.`
            : `Context pack INCOMPLETO: ausente ${absent.join(', ')}. Las claves siguen presentes con present=false para que el host no confunda «falta» con «no se preguntó».`,
      };
    },
  },
];

/**
 * `assessRigor` con el import perezoso del módulo ya hecho: se aísla aquí para que el handler de
 * `open_sdd_rigor` no repita el tipo de retorno y para que un fallo de evaluación se pueda envolver
 * sin cambiar la forma del payload.
 */
const assessRigorSafely = async (
  context: McpToolContext,
  input: { level: SddRigorLevel; brownfield: boolean; feature?: string; gates: string[] },
): Promise<Awaited<ReturnType<typeof assessRigor>>> =>
  assessRigor(context.cwd, {
    level: input.level,
    brownfield: input.brownfield,
    ...(input.feature ? { feature: input.feature } : {}),
    sddDir: context.sddDir,
    gates: input.gates,
  });

const TOOL_INDEX = new Map<string, ToolDefinition>(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));

/** Nombres de todas las herramientas, en el orden declarado. */
export const TOOL_NAMES: readonly string[] = TOOL_DEFINITIONS.map((tool) => tool.name);

/** Descriptores para `tools/list`. */
export const listToolDescriptors = (): McpToolDescriptor[] =>
  TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));

/**
 * Ejecutar una herramienta.
 *
 * Un nombre desconocido es un error de PROTOCOLO (`-32602`): el host invocó algo que no existe. Un
 * fallo DENTRO de la herramienta (argumento inválido, fichero ilegible, excepción de core) es un
 * resultado con `isError: true`, porque el stream debe sobrevivir y el host debe poder leer por qué.
 */
export const callTool = async (
  name: string,
  args: Record<string, unknown>,
  context: McpToolContext,
): Promise<ToolOutcome> => {
  const tool = TOOL_INDEX.get(name);
  if (!tool) {
    throw new RpcFault(
      RPC_ERROR_CODES.invalidParams,
      `Herramienta desconocida: "${name}". Herramientas disponibles: ${TOOL_NAMES.join(', ')}.`,
    );
  }
  try {
    return await tool.handler(args, context);
  } catch (error) {
    const message = errorMessage(error);
    return {
      data: { tool: name, error: message },
      isError: true,
      detail: `La herramienta "${name}" no pudo completarse: ${message}`,
    };
  }
};

// ---------------------------------------------------------------------------------------------
// Recursos
// ---------------------------------------------------------------------------------------------

export const CONSTITUTION_URI = 'sdd://steering/constitution.md';
export const STATUS_URI = 'sdd://status';

const SPEC_RESOURCE_FILES = ['requirements.md', 'plan.md', 'tasks.md', 'delta.md'] as const;
const SPEC_RESOURCE_FILES_WITH_ALIAS: readonly string[] = [...SPEC_RESOURCE_FILES, 'design.md'];

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType: string;
  text: string;
  _meta?: Record<string, unknown>;
}

const specUri = (feature: string, file: string): string => `sdd://specs/${encodeURIComponent(feature)}/${file}`;

/** Recursos que EXISTEN ahora mismo. Un recurso ausente no se lista; pedirlo da un error claro. */
export const listResources = async (context: McpToolContext): Promise<McpResource[]> => {
  const resources: McpResource[] = [
    {
      uri: STATUS_URI,
      name: 'sdd-status',
      description: 'Panel único de estado del proyecto en JSON.',
      mimeType: 'application/json',
    },
  ];

  const constitution = await loadConstitution(context.cwd, context.sddDir);
  if (constitution.exists) {
    resources.push({
      uri: CONSTITUTION_URI,
      name: 'constitution',
      description: 'Constitución del proyecto: principios en vigor que un veredicto puede citar.',
      mimeType: 'text/markdown',
    });
  }

  for (const feature of await listSpecs(context.cwd, context.sddDir)) {
    const specPath = relativeSpecDir(context, feature);
    const names = await readdir(path.join(context.cwd, specPath)).catch(() => [] as string[]);
    const files: string[] = SPEC_RESOURCE_FILES.filter((file) => names.includes(file));
    if (!names.includes('plan.md') && names.includes('design.md')) files.push('design.md');
    for (const file of files) {
      resources.push({
        uri: specUri(feature, file),
        name: `${feature}/${file}`,
        description: `${file} de la especificación "${feature}".`,
        mimeType: 'text/markdown',
      });
    }
  }

  return resources;
};

const resourceNotFound = (uri: string, detail: string): RpcFault =>
  new RpcFault(RPC_ERROR_CODES.resourceNotFound, `Recurso no presente: ${uri} — ${detail}`);

/** Contenido de una pieza: si existe pero está vacía, se dice; nunca se confunde con ausente. */
const textContent = (uri: string, mimeType: string, text: string): McpResourceContent =>
  text.trim().length > 0
    ? { uri, mimeType, text }
    : { uri, mimeType, text, _meta: { empty: true, detail: 'el fichero existe pero está vacío' } };

/**
 * `resources/read`: contenido del fichero o error claro de «no presente».
 *
 * La regla del contrato es explícita: NUNCA una cadena vacía por un fichero ausente. Un ausente es un
 * error `-32002` que nombra la ruta; un fichero vacío es contenido con `_meta.empty`.
 */
export const readResource = async (uri: string, context: McpToolContext): Promise<McpResourceContent> => {
  if (uri === STATUS_URI) {
    const report = await buildStatus(context.cwd, { sddDir: context.sddDir });
    return { uri, mimeType: 'application/json', text: JSON.stringify(report, null, 2) };
  }

  if (uri === CONSTITUTION_URI) {
    for (const candidate of constitutionCandidates(context.sddDir)) {
      const text = await readTextIfPresent(path.join(context.cwd, candidate));
      if (text !== null) return textContent(uri, 'text/markdown', text);
    }
    throw resourceNotFound(
      uri,
      `no existe ninguna de las rutas ${constitutionCandidates(context.sddDir).join(' ni ')} (la ausencia no se devuelve como cadena vacía)`,
    );
  }

  const specMatch = uri.match(/^sdd:\/\/specs\/([^/]+)\/([^/]+)$/);
  if (specMatch) {
    const feature = decodeURIComponent(specMatch[1]);
    const file = specMatch[2];
    if (!SPEC_RESOURCE_FILES_WITH_ALIAS.includes(file)) {
      throw resourceNotFound(uri, `el recurso "${file}" no es una pieza de especificación conocida`);
    }
    const rel = path.join(relativeSpecDir(context, feature), file);
    const text = await readTextIfPresent(path.join(context.cwd, rel));
    if (text === null) throw resourceNotFound(uri, `no existe ${rel}`);
    return textContent(uri, 'text/markdown', text);
  }

  throw resourceNotFound(uri, 'URI de recurso desconocida');
};

/** Accesos de solo lectura a la superficie, para tests y para el servidor. */
export const findTool = (name: string): ToolDefinition | undefined => TOOL_INDEX.get(name);
