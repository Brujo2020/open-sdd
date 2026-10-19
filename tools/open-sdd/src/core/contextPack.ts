/**
 * El context pack: TODO lo que un host debe inyectar antes de editar, en UN objeto.
 *
 * Este módulo es la EXTRACCIÓN a `core` de lo que hasta ahora construía en exclusiva el handler MCP
 * `open_sdd_context_pack` (`src/mcp/tools.ts`). El CLI (`open-sdd context`) y el servidor MCP leen
 * el mismo repositorio con el mismo código, así que no pueden divergir: la alternativa —dos
 * implementaciones del mismo objeto— es cómo un host y una terminal acaban dando veredictos
 * distintos sobre el mismo repositorio.
 *
 * ── Compatibilidad con la superficie MCP ───────────────────────────────────────────────────────
 * `buildContextPack(...).pack` conserva EXACTAMENTE las claves y la forma del `data` que ya
 * devolvía `open_sdd_context_pack` (`root`, `sddDir`, `feature`, `complete`, `absent`,
 * `constitution`, `spec`, `moduleMap`, `rigor`). El handler MCP puede delegar mañana con una línea:
 *
 *     const { pack, isError, detail } = await buildContextPack(context.cwd, {
 *       ...(feature ? { feature } : {}),
 *       sddDir: context.sddDir,
 *     });
 *     return { data: pack, isError, detail };
 *
 * Esa edición NO se hace aquí: `src/mcp/**` lo posee otro cambio. Queda como seguimiento declarado.
 *
 * ── La regla que hereda del handler original ───────────────────────────────────────────────────
 * Cada pieza declara `present: false` y `reason` cuando falta, en vez de omitir la clave: un host
 * necesita distinguir «falta» de «no se preguntó». `complete` es false en cuanto una pieza falta, y
 * `absent` nombra las ausencias. `isError` se mantiene false para una ausencia declarada —igual que
 * en MCP—: una pieza ausente es un hecho del pack, no un fallo del transporte. Solo se degrada
 * `isError` si el propio ensamblado no puede inspeccionar (no ocurre: cada lector envuelve su fallo).
 *
 * Textos visibles en español, como el resto del motor.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildModuleMap, type ModuleMapEntry } from './bootstrap.js';
import { principlesInForce, validateConstitution, type ConstitutionIssue } from './constitution.js';
import { effectiveGates, loadRigorSettings, type SddRigorLevel } from './rigor.js';
import { resolveSddDir } from './specManager.js';
import { constitutionCandidates, findRepoRoot, focusFeature, inspectFeature, loadConstitution } from './status.js';
import type { DeltaSpec } from './deltaSpec.js';

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Leer un fichero distinguiendo «no existe» de «existe pero no se pudo leer». */
const readTextIfPresent = async (absPath: string): Promise<string | null> => {
  try {
    return await readFile(absPath, 'utf8');
  } catch {
    return null;
  }
};

/** Una sección de la spec: siempre con `present` y `reason` cuando falta. */
export interface ContextSpecPiece {
  present: boolean;
  path: string;
  text: string | null;
  reason?: string;
  /** Solo en la delta: la delta ya parseada, para no obligar al host a re-parsear el markdown. */
  parsed?: DeltaSpec;
}

export interface ContextConstitutionPiece {
  present: boolean;
  path: string | null;
  text: string;
  principlesInForce: Array<{ id: string; title: string; level: string; restriction: string }>;
  issues: ConstitutionIssue[];
  reason?: string;
}

export interface ContextSpec {
  present: boolean;
  feature: string | null;
  path: string;
  reason?: string;
  requirements?: ContextSpecPiece;
  plan?: ContextSpecPiece;
  tasks?: ContextSpecPiece;
  delta?: ContextSpecPiece;
}

export interface ContextModuleMap {
  present: boolean;
  modules: ModuleMapEntry[];
  complete: boolean;
  detail?: string;
  reason?: string;
}

export interface ContextRigor {
  present: boolean;
  level: SddRigorLevel | null;
  brownfield?: boolean;
  rationale?: string;
  activeGates: string[];
  reason?: string;
}

/**
 * El pack. Mismas claves que el `data` de `open_sdd_context_pack`; ningún campo se omite cuando
 * falta, se declara.
 */
export interface ContextPack {
  root: string;
  sddDir: string;
  feature: string | null;
  complete: boolean;
  absent: string[];
  constitution: ContextConstitutionPiece;
  spec: ContextSpec;
  moduleMap: ContextModuleMap;
  rigor: ContextRigor;
}

export interface ContextPackResult {
  pack: ContextPack;
  /** false salvo que el ensamblado no pudiera inspeccionar; una ausencia NO es un error aquí. */
  isError: boolean;
  detail: string;
}

export interface ContextPackOptions {
  /** Feature aplicable; por defecto la primera con delta, o la primera. */
  feature?: string;
  /** Directorio SDD ya resuelto (`.sdd` o el alias legacy `.kiro`). */
  sddDir?: string;
}

/**
 * Ensamblar el context pack de un repositorio.
 *
 * Igual que el handler MCP, NUNCA lanza por artefactos ausentes: resuelve el repositorio, lee cada
 * pieza y declara las ausencias. Las únicas excepciones posibles vendrían de un fallo de sistema
 * fuera de los `try` (p. ej. `findRepoRoot`), y aun así `complete`/`absent` describen el estado.
 */
export const buildContextPack = async (
  cwd: string = process.cwd(),
  options: ContextPackOptions = {},
): Promise<ContextPackResult> => {
  const root = await findRepoRoot(cwd);
  const sddDir = options.sddDir ?? (await resolveSddDir(root));
  const requested = options.feature;
  const feature = requested ?? (await focusFeature(root, sddDir));
  const absent: string[] = [];

  // ── Constitución ────────────────────────────────────────────────────────────────────────────
  const constitutionRead = await loadConstitution(root, sddDir);
  let constitution: ContextConstitutionPiece;
  if (constitutionRead.exists && constitutionRead.constitution !== null) {
    const text = await readTextIfPresent(path.join(root, constitutionRead.path ?? ''));
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
    const candidate = constitutionCandidates(sddDir)[0];
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

  // ── Especificación aplicable ────────────────────────────────────────────────────────────────
  let spec: ContextSpec;
  if (!feature) {
    spec = {
      present: false,
      feature: null,
      path: path.join(sddDir, 'specs'),
      reason: `no hay ninguna especificación en ${path.join(sddDir, 'specs')}`,
    };
    absent.push('spec');
  } else {
    const inspection = await inspectFeature(root, feature, sddDir);
    const specPath = path.join(sddDir, 'specs', feature);
    if (!inspection.dirExists) {
      spec = { present: false, feature, path: specPath, reason: 'la feature no existe en el repositorio' };
      absent.push('spec');
    } else {
      const piece = async (file: string): Promise<ContextSpecPiece> => {
        const rel = path.join(specPath, file);
        const text = await readTextIfPresent(path.join(root, rel));
        if (text === null) return { present: false, path: rel, text: null, reason: 'no presente' };
        if (text.trim().length === 0) return { present: true, path: rel, text, reason: 'presente pero vacío' };
        return { present: true, path: rel, text };
      };
      const planFile = inspection.files.includes('plan.md') ? 'plan.md' : 'design.md';
      const requirements = await piece('requirements.md');
      const plan = await piece(planFile);
      const tasks = await piece('tasks.md');
      const delta: ContextSpecPiece = await piece('delta.md');
      if (delta.present && inspection.delta) delta.parsed = inspection.delta;
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

  // ── Mapa de módulos ─────────────────────────────────────────────────────────────────────────
  let moduleMap: ContextModuleMap;
  try {
    const map = await buildModuleMap(root);
    moduleMap = {
      present: map.modules.length > 0,
      modules: map.modules,
      complete: map.complete,
      detail: map.detail,
      ...(map.modules.length > 0 ? {} : { reason: 'no se observó ningún módulo en el repositorio' }),
    };
    if (map.modules.length === 0) absent.push('moduleMap');
  } catch (error) {
    moduleMap = {
      present: false,
      modules: [],
      complete: false,
      reason: `no se pudo construir: ${errorMessage(error)}`,
    };
    absent.push('moduleMap');
  }

  // ── Rigor declarado ─────────────────────────────────────────────────────────────────────────
  let rigor: ContextRigor;
  try {
    const settings = await loadRigorSettings(root, sddDir);
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
      level: null,
      activeGates: [],
      reason: `el rigor declarado no se pudo leer (${errorMessage(error)}): no se degrada a spec-first`,
    };
    absent.push('rigor');
  }

  const pack: ContextPack = {
    root,
    sddDir,
    feature: feature ?? null,
    complete: absent.length === 0,
    absent,
    constitution,
    spec,
    moduleMap,
    rigor,
  };

  return {
    pack,
    isError: false,
    detail:
      absent.length === 0
        ? `Context pack completo: constitución, spec "${feature}", mapa de módulos y rigor declarado.`
        : `Context pack INCOMPLETO: ausente ${absent.join(', ')}. Las claves siguen presentes con present=false para que el host no confunda «falta» con «no se preguntó».`,
  };
};

/** Las ausencias con su razón, ya resueltas para pintar: es lo que un humano necesita leer. */
export interface ContextAbsence {
  key: string;
  reason: string;
}

/**
 * Emparejar cada nombre de `absent` con la razón que su piece declara. Una ausencia SIN razón se
 * reporta como tal: un `absent` sin causa sería el «se perdió algo» que este pack evita.
 */
export const contextAbsences = (pack: ContextPack): ContextAbsence[] => {
  const reasonOf: Record<string, () => string> = {
    constitution: () => pack.constitution.reason ?? 'ausente sin razón declarada',
    spec: () => pack.spec.reason ?? 'ausente sin razón declarada',
    moduleMap: () => pack.moduleMap.reason ?? 'ausente sin razón declarada',
    rigor: () => pack.rigor.reason ?? 'ausente sin razón declarada',
  };
  return pack.absent.map((key) => {
    const specific = reasonOf[key];
    if (specific) return { key, reason: specific() };
    const piece = key.startsWith('spec.')
      ? (pack.spec as unknown as Record<string, ContextSpecPiece | undefined>)[key.slice('spec.'.length)]
      : undefined;
    return { key, reason: piece?.reason ?? 'ausente sin razón declarada' };
  });
};
