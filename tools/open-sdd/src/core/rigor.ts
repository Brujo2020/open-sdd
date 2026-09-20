/**
 * Los tres niveles de rigor del SDD (Manual Maestro v3.0 §2.4; arquitectura de referencia §4.8/§4.10).
 *
 * Este módulo es la versión de primera clase de `hitl.selectRigorMode`: el mismo flujo de decisión,
 * pero con los artefactos que cada nivel EXIGE y con una evaluación real del repositorio, no solo la
 * etiqueta del nivel.
 *
 * ── Por qué la Constitución es OBLIGATORIA a partir de `spec-anchored` ─────────────────────────
 * La Constitución está en el vértice de la jerarquía («The Constitution sits at the apex of the
 * development hierarchy, governing all downstream artifacts», CSDD §3.4) y es la autoridad que todo
 * veredicto bloqueante debe poder citar (invariante I1: `constitution.ts:resolveAuthority`; §4.1 del
 * manual: «La constitución responde al qué (restricciones no negociables)»). Un proyecto que no
 * exige nada no tiene autoridad citable: sin constitución, un gate que bloquea cita una regla que
 * nadie escribió. Por eso, por encima de `spec-first`, su ausencia o invalidez es un hallazgo
 * BLOQUEANTE. En `spec-first` la conformidad se comprueba en el momento de crear la spec y la spec
 * puede desecharse (§2.4: «Spec escrita antes, puede desecharse»), así que ahí la constitución es
 * recomendada (advisory). Así los tres niveles se diferencian en sustancia y no en la etiqueta.
 *
 * ── Esta capa es una EXTENSIÓN POR ENCIMA de la cadena, no un gate nuevo ──────────────────────
 * `resolveGateChain` (gateCatalog.ts) debe seguir resolviendo exactamente 7 / 9 / 12 controles para
 * los perfiles solo / team / regulated, con los ids C1–C7 y O1–O7 de las Tablas 33/34 del paper. Este
 * módulo NO añade entradas a esas tablas ni cambia sus recuentos: declara qué controles de esa misma
 * cadena exige cada nivel de rigor. Es la pasarela que fija el nivel de exigencia por encima de la
 * cadena (y por eso `gatesActive` cita ids existentes de `gateCatalog.ts`, nunca ids nuevos). El test
 * `test/coreRigor.test.ts` fija los recuentos 7/9/12 como regresión para que nadie los mueva por la
 * puerta de atrás; `docs/PAPER-ALIGNMENT.md` sigue siendo cierto.
 *
 * ── Reglas que este módulo hace ejecutables ───────────────────────────────────────────────────
 *  1. `spec-first`      = conformidad comprobada SOLO al crear la spec: sin detección de drift ni
 *                         binding de evidencia (§2.4, nivel exploratorio).
 *  2. `spec-anchored`   = spec viva: trazabilidad + binding de evidencia + detección de drift por
 *                         cambio.
 *  3. `spec-as-source`  = todo lo anterior + contratos y regeneración como mecanismo de reparación
 *                         (la spec ES el código).
 *  4. Brownfield cambia los defaults: en legacy la delta (`delta.md` con entradas ADSR y REQ-IDs
 *     propios de la delta) es obligatoria a partir de `spec-anchored`; en greenfield la tríada
 *     normal la sustituye (§9.4/§9.6: «La spec delta es el contrato del cambio»).
 *
 * User-visible strings are Spanish, matching the rest of the CLI.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { HITL_DEFAULTS, type RigorMode } from './hitl.js';
import { EXECUTABLE_CHAIN, getExecutableGate } from './gateCatalog.js';
import {
  parseConstitution,
  principlesInForce,
  resolveAuthority,
  validateConstitution,
} from './constitution.js';
import { parseTasksMarkdown, resolveSddDir } from './specManager.js';
import {
  deltaSpecFileName,
  parseDeltaSpec,
  traceDelta,
  validateDeltaSpec,
  type DeltaSpec,
  type DeltaTask,
} from './deltaSpec.js';
import { checkEvidenceLock, evaluateTriad } from './triad.js';
import { auditFeature } from './auditEngine.js';
import { isGitRepo } from './git.js';

export type SddRigorLevel = 'spec-first' | 'spec-anchored' | 'spec-as-source';

/** What a level demands of one aspect: mandatory, advisable, or out of scope. */
export type RigorDemand = 'required' | 'recommended' | 'not-required';

/** Una fila por aspecto/artefacto: qué exige el nivel y por qué. */
export interface RigorRequirement {
  /** Aspect key shared with {@link RigorLevelSpec.requires}: constitution | triad | delta | ... */
  aspect: string;
  demand: RigorDemand;
  detail: string;
}

export interface RigorLevelSpec {
  level: SddRigorLevel;
  name: string;
  definition: string;
  /** What it demands, per aspect: constitution, triad, delta, traceability, evidence binding, drift detection, contracts, regeneration. */
  requires: Record<string, 'required' | 'recommended' | 'not-required'>;
  /** Gate ids from gateCatalog that this level keeps active/blocking. */
  gatesActive: string[];
  /** What an evaluator must be able to ask for — copied from the source documents where stated. */
  evaluatorCheck: string;
  /** How the level behaves when the artifact is missing. */
  missingArtifactPolicy: 'advisory' | 'blocking';
}

/** The aspects every level is described in. Shared so reports and tests agree on the vocabulary. */
export const RIGOR_ASPECTS = [
  'constitution',
  'triad',
  'delta',
  'traceability',
  'evidence',
  'drift',
  'contracts',
  'regeneration',
] as const;

/**
 * Las filas por aspecto.
 *
 * `delta` se declara para el caso brownfield (es «el contrato del cambio» del legado, §9.4/§9.6);
 * en greenfield {@link rigorRequires} la degrada porque la tríada normal la sustituye. El detalle de
 * cada fila dice de dónde viene la exigencia, para que la tabla no finja una precisión que no tiene.
 */
const ROWS: Record<SddRigorLevel, Array<[string, RigorDemand, string]>> = {
  'spec-first': [
    [
      'constitution',
      'required',
      'Obligatoria: es el SUELO de la escalera, no un extra del nivel. Todo veredicto bloqueante debe citar autoridad (CSDD §3.4, I1) y sin constitución no hay nada que citar. Lo que este nivel no exige es lo de arriba: drift, ligado de evidencia, contratos y regeneración se añaden al subir de nivel.',
    ],
    [
      'triad',
      'required',
      'Los requisitos escritos antes del cambio, en forma comprobable (EARS), son la única conformidad que este nivel comprueba. Se exigen porque un requisito que no dice nada verificable no se puede revisar; lo que no se exige es que sobrevivan al cambio.',
    ],
    ['delta', 'not-required', 'Un cambio exploratorio o desechable no justifica el contrato de una delta.'],
    [
      'traceability',
      'recommended',
      'Se reporta si existe, pero no se exige: el nivel no mantiene la spec después de crearla.',
    ],
    [
      'evidence',
      'not-required',
      'Sin binding de evidencia: no hay afirmación de completitud que la spec pueda sostener más adelante.',
    ],
    [
      'drift',
      'not-required',
      'Sin detección de drift: comprobar la distancia código↔spec exigiría una spec que sobreviva al cambio.',
    ],
    ['contracts', 'not-required', 'Sin contratos declarados: no hay comportamiento existente que preservar.'],
    ['regeneration', 'not-required', 'La spec no es la fuente: el código no se regenera desde ella.'],
  ],
  'spec-anchored': [
    [
      'constitution',
      'required',
      'Obligatoria: es el vértice de la jerarquía y la autoridad que cita todo veredicto bloqueante (CSDD §3.4, I1). Sin ella el nivel no tiene ley que anclar.',
    ],
    [
      'triad',
      'required',
      'Spec viva mantenida: requirements.md + plan.md/design.md + tasks.md presentes y coherentes (§2.4).',
    ],
    [
      'delta',
      'required',
      'En brownfield, obligatoria: gobernar la evolución del legado exige delta.md con ADSR y REQ-IDs de la delta (§9.4/§9.6). En greenfield la tríada la sustituye.',
    ],
    [
      'traceability',
      'required',
      'Cada requisito debe tener tarea trazable, y cada tarea de la delta cita REQ-IDs de la delta, no del sistema completo.',
    ],
    [
      'evidence',
      'required',
      'Binding de evidencia (I2): ninguna tarea completada se acepta sin la salida capturada de la comprobación que la habría falsado.',
    ],
    [
      'drift',
      'required',
      'Detección de drift por cambio: la build falla ante discrepancia entre código y spec.',
    ],
    ['contracts', 'recommended', 'Declarar los contratos de ejecución que cubren el comportamiento tocado es lo que hace revisable el cambio.'],
    [
      'regeneration',
      'not-required',
      'La reparación sigue siendo editar código y spec; la regeneración desde la spec no es todavía el mecanismo.',
    ],
  ],
  'spec-as-source': [
    [
      'constitution',
      'required',
      'Obligatoria y además gobernada: los Pattern Mandates y Security Patterns de la constitución son la fuente de la que se deriva el código.',
    ],
    [
      'triad',
      'required',
      'La spec es el código: la tríada no es contexto, es la fuente. Debe estar presente y aprobada.',
    ],
    [
      'delta',
      'required',
      'En brownfield, obligatoria: la delta es el único contrato legítimo de cambio sobre el comportamiento anclado.',
    ],
    ['traceability', 'required', 'Trazabilidad completa: principio → requisito → tarea → artefacto, sin eslabones sueltos.'],
    ['evidence', 'required', 'Binding de evidencia en cada tarea: sin prueba capturada no hay completitud que reclamar (I2).'],
    ['drift', 'required', 'Drift detection permanente: la build falla ante cualquier discrepancia código↔spec.'],
    [
      'contracts',
      'required',
      'Todo cambio sobre comportamiento existente declara sus contratos: es el oráculo de regresión del sistema crítico.',
    ],
    [
      'regeneration',
      'required',
      'La regeneración desde la spec es el MECANISMO DE REPARACIÓN: se repara la spec y se regenera el código, no al revés.',
    ],
  ],
};

/** Filas detalladas por nivel (una por aspecto). Material de reporte y de test. */
export const RIGOR_REQUIREMENTS: Record<SddRigorLevel, RigorRequirement[]> = {
  'spec-first': ROWS['spec-first'].map(([aspect, demand, detail]) => ({ aspect, demand, detail })),
  'spec-anchored': ROWS['spec-anchored'].map(([aspect, demand, detail]) => ({ aspect, demand, detail })),
  'spec-as-source': ROWS['spec-as-source'].map(([aspect, demand, detail]) => ({ aspect, demand, detail })),
};

/** Copia de las filas de un nivel: el llamante no puede mutar la tabla declarada. */
export const rigorRequirements = (level: SddRigorLevel): RigorRequirement[] => {
  const rows = RIGOR_REQUIREMENTS[level];
  if (!rows) throw new Error(`Nivel de rigor desconocido: ${String(level)}`);
  return rows.map((row) => ({ ...row }));
};

const requiresOf = (level: SddRigorLevel): Record<string, RigorDemand> =>
  Object.fromEntries(ROWS[level].map(([aspect, demand]) => [aspect, demand]));

/**
 * La escalera, en una tabla.
 *
 * | Nivel | Exige además | Gates activos |
 * |---|---|---|
 * | `spec-first` (por defecto, fluido) | requisitos EARS + constitución válida | C1, C2 |
 * | `spec-anchored` | + tríada viva, delta en brownfield, trazabilidad, ligado de evidencia, drift | C1, C2, C3, C6 |
 * | `spec-as-source` | + contratos declarados y regeneración como reparación | C1…C6 |
 *
 * C2 (secretos y comandos destructivos) está activo en TODOS los niveles a propósito: pertenece al
 * subconjunto duro que nunca se auto-autoriza (§9.2), así que bajarse de nivel no vuelve aceptable
 * una credencial commiteada. La exigencia que se ajusta con el nivel es la del `requires`, y cada
 * nivel solo AÑADE: ninguno quita el suelo.
 */
/**
 * La tabla §2.4, en sustancia.
 *
 * Los tres niveles exigen cosas distintas y por eso son niveles y no etiquetas: `spec-first` no
 * detecta drift ni ata evidencia; `spec-anchored` sí, en cada cambio; `spec-as-source` añade
 * contratos y regeneración como reparación.
 */
export const RIGOR_LEVELS: RigorLevelSpec[] = [
  {
    level: 'spec-first',
    name: 'Spec-First',
    definition:
      'La especificación se escribe antes del código y puede desecharse: la conformidad se comprueba en el momento de crearla, no se mantiene después.',
    requires: requiresOf('spec-first'),
    gatesActive: ['C1', 'C2'],
    evaluatorCheck:
      '¿Existen requisitos en forma comprobable (EARS) y una constitución válida con la que justificar cada veredicto? (C1 + C2.) Nada más: este es el nivel fluido por defecto.',
    missingArtifactPolicy: 'blocking',
  },
  {
    level: 'spec-anchored',
    name: 'Spec-Anchored',
    definition:
      'La spec es viva y se actualiza con el código: cada cambio deja trazabilidad requisito→tarea, evidencia capturada y detección de drift.',
    requires: requiresOf('spec-anchored'),
    gatesActive: ['C1', 'C2', 'C3', 'C6'],
    evaluatorCheck:
      '¿La spec viva refleja este cambio, cada requisito tiene tarea trazable y cada tarea completada cita la evidencia de la comprobación que la habría falsado? (C1 + C3 + C6.)',
    missingArtifactPolicy: 'blocking',
  },
  {
    level: 'spec-as-source',
    name: 'Spec-as-Source',
    definition:
      'La spec ES la fuente: el código se deriva de ella y toda reparación se hace primero en la spec, con contratos declarados y regeneración como mecanismo.',
    requires: requiresOf('spec-as-source'),
    gatesActive: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
    evaluatorCheck:
      '¿Puede regenerarse el código desde la spec y se reparó el cambio en la spec antes que en el código? ¿Los contratos declarados son los que gobiernan el cambio?',
    missingArtifactPolicy: 'blocking',
  },
];

const RIGOR_BY_NAME = new Map<SddRigorLevel, RigorLevelSpec>(
  RIGOR_LEVELS.map((spec) => [spec.level, spec]),
);

/** Type guard used by settings resolution and by callers reading user input. */
/** La escalera completa, ya declarada: 2 → 4 → 6 gates. */
export const RIGOR_LADDER = RIGOR_LEVELS;

export const isRigorLevel = (value: unknown): value is SddRigorLevel =>
  typeof value === 'string' && RIGOR_BY_NAME.has(value as SddRigorLevel);

/**
 * El nivel por defecto es el más ligero. Una instalación nueva no debe sorprender a nadie: el
 * perfil de gobierno por defecto (`solo`) no bloquea, y el rigor por defecto tampoco.
 */
export const DEFAULT_RIGOR_LEVEL: SddRigorLevel = 'spec-first';

// ---------------------------------------------------------------------------------------------
// Selección: la tabla de decisión de §8.2 y el flujo de la arquitectura de referencia (§4.8)
// ---------------------------------------------------------------------------------------------

export interface RigorSelectionInput {
  brownfield?: boolean;
  scopeKnown?: boolean;
  misreadingIsCheap?: boolean;
  reversible?: boolean;
  audited?: boolean;
  complexity?: number;
  /** Regulator-traceable or hard-to-reverse: authentication, authorization, payments, cross-team contracts, legacy modernization. */
  highConsequence?: boolean;
}

/**
 * Seleccionar el nivel desde la tabla de decisión (§8.2) y el flujo §4.8.
 *
 * Precedencia, en este orden (la primera condición decide):
 *   1. alcance desconocido            → `spec-first`  (exploration-first: no se especifica lo que no se conoce)
 *   2. consecuencia alta              → `spec-as-source` (pagos, contratos entre equipos, legacy; §8.2 y el doc de `highConsequence`)
 *   3. leerlo mal es barato           → `spec-first`  (la variable de decisión de todo el flujo)
 *   4. complejidad por debajo de Lite → `spec-first`  (bug de una línea, refactor ligero)
 *   5. auditado                       → `spec-as-source` (trazabilidad demostrable ante regulador)
 *   6. difícil de revertir            → `spec-as-source`
 *   7. reversible y no auditado       → `spec-anchored`
 *   8. brownfield                     → `spec-anchored` (migración de legacy: conocimiento crítico, auditoría)
 *   9. sin señal de reversibilidad    → `spec-as-source` (conservador, igual que `hitl.selectRigorMode`)
 *
 * Coherente con `hitl.selectRigorMode` en todos los inputs que ambos pueden expresar: `none`/`lite`
 * corresponden al nivel más ligero de este módulo (`spec-first`), no a un nivel propio, porque este
 * módulo describe los tres niveles del SDD y no la decisión de no aplicar SDD.
 */
export const selectRigorLevel = (input: RigorSelectionInput): { level: SddRigorLevel; reason: string } => {
  if (input.scopeKnown === false) {
    return {
      level: 'spec-first',
      reason:
        'Alcance poco claro: exploration-first. No se puede especificar lo que no se conoce, así que la spec más ligera es la única honesta y probablemente se reescriba.',
    };
  }
  if (input.highConsequence === true) {
    return {
      level: 'spec-as-source',
      reason:
        'Consecuencia alta o trazabilidad por regulador (autenticación, autorización, pagos, contratos entre equipos, modernización de legacy): la spec es la fuente y la regeneración es la reparación.',
    };
  }
  if (input.misreadingIsCheap === true) {
    return {
      level: 'spec-first',
      reason:
        'Leer mal un requisito es barato: el coste de mantener la spec supera el coste del error que previene. Spec mínima y desechable.',
    };
  }
  if (typeof input.complexity === 'number' && input.complexity < HITL_DEFAULTS.liteModeComplexity) {
    return {
      level: 'spec-first',
      reason: `Complejidad ${input.complexity} por debajo de ${HITL_DEFAULTS.liteModeComplexity}: cambio trivial; el overhead de gates ahoga la velocidad (bug de una línea, refactor ligero).`,
    };
  }
  if (input.audited === true) {
    return {
      level: 'spec-as-source',
      reason: 'Cambio auditado: se exige trazabilidad demostrable ante un regulador, no solo una spec que se mantiene viva.',
    };
  }
  if (input.reversible === false) {
    return {
      level: 'spec-as-source',
      reason: 'Difícil de revertir: el código debe poder regenerarse desde la spec para reparar sin arqueología.',
    };
  }
  if (input.reversible === true) {
    return {
      level: 'spec-anchored',
      reason: 'Reversible y no auditado: la spec se mantiene viva, con trazabilidad y evidencia por cambio, sin llegar a generación.',
    };
  }
  if (input.brownfield === true) {
    return {
      level: 'spec-anchored',
      reason:
        'Proyecto brownfield: el SDD no exige reescribir el legado, exige gobernar su evolución. Spec viva y trazabilidad de la delta (§9.4–§9.6).',
    };
  }
  return {
    level: 'spec-as-source',
    reason:
      'Reversibilidad desconocida: sin señal de que el daño sea reversible se aplica el nivel conservador. Declara reversible=true para bajar a spec-anchored.',
  };
};

// ---------------------------------------------------------------------------------------------
// La Constitución es obligatoria desde `spec-anchored`
// ---------------------------------------------------------------------------------------------

/**
 * ¿Exige este nivel una Constitución válida y versionada?
 *
 * Este es el punto del módulo. La Constitución es el vértice de la jerarquía (CSDD §3.4) y la
 * autoridad que todo veredicto bloqueante debe citar (I1). Por eso su ausencia es BLOQUEANTE en
 * `spec-anchored` y `spec-as-source`, y blocking en los tres niveles: es el suelo, no un extra del nivel, donde la spec puede
 * desecharse y no hay veredicto que anclar.
 *
 * `brownfield` no cambia el umbral (la política es la misma), pero sí la forma del documento: en
 * legacy la constitución debe ser DESCRIPTIVA — los principios que el código ya obedece, con
 * evidencia — para que un agente no «modernice» en silencio lo que nadie le pidió modernizar.
 */
export const constitutionRequired = (
  level: SddRigorLevel,
  brownfield: boolean,
): { required: boolean; severity: 'blocking' | 'advisory'; reason: string } => {
  if (!isRigorLevel(level)) {
    throw new Error(`Nivel de rigor desconocido: ${String(level)}`);
  }

  if (level === 'spec-first') {
    return {
      required: true,
      severity: 'blocking',
      reason: brownfield
        ? 'La constitución es el suelo del nivel por defecto: los requisitos EARS y la constitución descriptiva del legado son lo mínimo revisable, y todo veredicto bloqueante debe poder citarla. Sube de nivel para añadir drift, evidencia y contratos, no para tener autoridad.'
        : 'La constitución es el suelo del nivel por defecto: sin ella no hay autoridad que citar y el veredicto bloqueante no puede justificarse. Sube de nivel para añadir drift, evidencia y contratos, no para tener ley.',
    };
  }

  return {
    required: true,
    severity: 'blocking',
    reason: brownfield
      ? `El nivel ${level} emite veredictos bloqueantes y estos deben citar autoridad: sin una constitución DESCRIPTIVA y versionada del legado no hay regla que citar ni stack que declarar inmutable.`
      : `El nivel ${level} emite veredictos bloqueantes y estos deben citar autoridad: la constitución está en el vértice de la jerarquía (CSDD §3.4) y sin ella el proyecto no tiene ley que anclar.`,
  };
};

// ---------------------------------------------------------------------------------------------
// Configuración declarada: .sdd/settings/rigor.json
// ---------------------------------------------------------------------------------------------

export interface RigorSettings {
  level: SddRigorLevel;
  /** Por qué se eligió este nivel; auditable y no vacío. */
  rationale: string;
  brownfield: boolean;
  /**
   * Override opcional del conjunto de gates que activa el nivel. El nivel decide las EXIGENCIAS; esto
   * decide qué comprobaciones corren. Debe ser una lista válida del catálogo: un id desconocido se
   * rechaza en lugar de ignorarse, porque un error de escritura reduciría en silencio la vigilancia.
   */
  gates?: string[];
  updated_at?: string;
}

/**
 * Environment variable names and the gate catalogue are the two things a project may want to point
 * at without editing code. The level decides the DEMANDS; the gate set decides which checks run.
 */
export const effectiveGates = (level: SddRigorLevel, override?: string[]): string[] => {
  if (override && override.length > 0) return [...override];
  const spec = RIGOR_BY_NAME.get(level);
  if (!spec) throw new Error(`Nivel de rigor desconocido: ${String(level)}`);
  return [...spec.gatesActive];
};

/**
 * Validate an override before trusting it.
 *
 * Unknown ids are REJECTED rather than ignored: a typo in a gate id would otherwise silently reduce
 * the checks a project believes it is running, which is the failure mode this whole module exists to
 * prevent. Overriding is allowed — narrowing to fewer gates is a legitimate choice — but it has to be
 * an explicit, valid list.
 */
export const validateGateOverride = (ids: unknown): string[] | undefined => {
  if (ids === undefined) return undefined;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    throw new Error(`El campo "gates" de ${RIGOR_SETTINGS_FILE} debe ser una lista de identificadores.`);
  }
  const unknown = (ids as string[]).filter((id) => !getExecutableGate(id));
  if (unknown.length > 0) {
    throw new Error(
      `Gates desconocidos en ${RIGOR_SETTINGS_FILE}: ${unknown.join(', ')}. Admitidos: ${EXECUTABLE_CHAIN.map((g) => g.id).join(', ')}.`,
    );
  }
  return [...(ids as string[])];
};

/** Default location, mirroring `.sdd/settings/governance.json`. */
export const RIGOR_SETTINGS_FILE = '.sdd/settings/rigor.json';

const originRationale = (level: SddRigorLevel, origin: 'declarado' | 'fallback' | 'defecto'): string => {
  const spec = RIGOR_BY_NAME.get(level)!;
  return `Sin rationale en ${RIGOR_SETTINGS_FILE} (nivel ${origin}): se aplica «${spec.name}». Declara el motivo para que la elección de rigor sea auditable.`;
};

/**
 * Resolver la configuración con precedencia explícita:
 *   nivel explícito > fallbackLevel > DEFAULT_RIGOR_LEVEL
 *
 * Un nivel inválido o un rationale presente pero vacío se RECHAZAN (throw) en vez de degradarse en
 * silencio: una elección de rigor sin motivo declarado no es auditable, y aceptar un nivel
 * desconocido convertiría un error de escritura en un nivel de exigencia distinto.
 */
export const resolveRigorSettings = (
  parsed: Partial<RigorSettings> | undefined,
  fallbackLevel: SddRigorLevel = DEFAULT_RIGOR_LEVEL,
): RigorSettings => {
  const declared = parsed ?? {};

  if (!isRigorLevel(fallbackLevel)) {
    throw new Error(
      `Nivel de rigor de reserva inválido: "${String(fallbackLevel)}". Admitidos: ${RIGOR_LEVELS.map((l) => l.level).join(', ')}.`,
    );
  }
  if (declared.level !== undefined && !isRigorLevel(declared.level)) {
    throw new Error(
      `Nivel de rigor inválido: "${String(declared.level)}". Admitidos: ${RIGOR_LEVELS.map((l) => l.level).join(', ')}.`,
    );
  }
  if (declared.rationale !== undefined && declared.rationale.trim().length === 0) {
    throw new Error(
      'El nivel de rigor exige un rationale no vacío: una elección de rigor sin motivo declarado no es auditable.',
    );
  }

  const level = declared.level ?? fallbackLevel;
  const origin =
    declared.level !== undefined ? 'declarado' : fallbackLevel !== DEFAULT_RIGOR_LEVEL ? 'fallback' : 'defecto';

  return {
    level,
    rationale: declared.rationale?.trim() || originRationale(level, origin),
    brownfield: declared.brownfield === true,
    // The override must survive the trip through settings. It was validated and used at the API
    // level but never copied here, so a project could declare "gates": ["C1"] and keep running C1+C2
    // while the documentation said otherwise — the "documented but not wired" failure this module
    // exists to make impossible.
    ...(declared.gates !== undefined ? { gates: validateGateOverride(declared.gates) } : {}),
    ...(declared.updated_at ? { updated_at: declared.updated_at } : {}),
  };
};

/**
 * Leer `.sdd/settings/rigor.json`.
 *
 * - archivo ausente → defaults declarados (el nivel más ligero), nunca una excepción: una
 *   instalación sin configuración debe funcionar;
 * - JSON malformado → excepción. Degradar en silencio a `spec-first` convertiría un archivo roto en
 *   una bajada de exigencia invisible, que es justo el fallo que este módulo existe para evitar.
 */
export const loadRigorSettings = async (
  cwd: string = process.cwd(),
  sddDir?: string,
): Promise<RigorSettings> => {
  // `.sdd` or the legacy `.kiro`, resolved the same way assessRigor and the dashboard do. Defaulting
  // to the literal '.sdd' meant a .kiro project got the spec-first defaults while its own file said
  // otherwise: reading the declared rigor is the one thing that must never silently degrade.
  const dir = sddDir ?? (await resolveSddDir(cwd));
  const settingsPath = path.join(cwd, dir, 'settings', 'rigor.json');

  let content: string;
  try {
    content = await readFile(settingsPath, 'utf8');
  } catch {
    return resolveRigorSettings(undefined);
  }

  let parsed: Partial<RigorSettings>;
  try {
    parsed = JSON.parse(content) as Partial<RigorSettings>;
  } catch (err) {
    throw new Error(
      `${path.join(dir, 'settings', 'rigor.json')} no es JSON válido (${(err as Error).message}): corrígelo o elimínalo; no se degrada la exigencia en silencio.`,
    );
  }

  return resolveRigorSettings(parsed);
};

/**
 * Puente con `hitl.RigorMode`, que es la misma escala con los peldaños «no aplicar SDD»: `none` y
 * `lite` caen en el nivel más ligero de este módulo. Mantener el puente aquí evita que las dos
 * escalas se separen sin que nadie lo note.
 */
export const toSddRigorLevel = (mode: RigorMode): SddRigorLevel => {
  switch (mode) {
    case 'spec-as-source':
      return 'spec-as-source';
    case 'spec-anchored':
      return 'spec-anchored';
    default:
      return 'spec-first';
  }
};

// ---------------------------------------------------------------------------------------------
// Evaluación del repositorio contra el nivel declarado
// ---------------------------------------------------------------------------------------------

export interface RigorFinding {
  /** 'constitution' | 'triad' | 'delta' | 'traceability' | 'evidence' | 'drift' | 'contracts' | 'regeneration' */
  aspect: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** The artifact the finding is about, so a report can point at it. */
  artifact?: string;
}

export interface RigorAssessment {
  level: SddRigorLevel;
  brownfield: boolean;
  /** Gates this level activates, after any declared override. */
  gates: string[];
  findings: RigorFinding[];
  /** no error-severity findings */
  satisfied: boolean;
  detail: string;
}

/** Nivel de cada aspecto una vez aplicada la regla de sustitución greenfield (§9.4/§9.6). */
export const rigorRequires = (
  level: SddRigorLevel,
  brownfield: boolean,
): Record<string, RigorDemand> => {
  if (!isRigorLevel(level)) throw new Error(`Nivel de rigor desconocido: ${String(level)}`);
  const requires = requiresOf(level);
  // En greenfield no hay comportamiento anclado que preservar: la tríada normal sustituye a la
  // delta, que es el contrato del cambio del legado. Solo el camino brownfield la exige.
  if (!brownfield && requires.delta === 'required') requires.delta = 'not-required';
  return requires;
};

/** Read a file and distinguish «no existe» from «existe pero no se pudo leer». */
const readIfPresent = async (
  absPath: string,
): Promise<{ exists: boolean; content: string | null; error?: string }> => {
  try {
    const content = await readFile(absPath, 'utf8');
    return { exists: true, content };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { exists: false, content: null };
    return { exists: true, content: null, error: (err as Error).message };
  }
};

const constitutionCandidates = (sddDir: string): string[] => [
  path.join(sddDir, 'steering', 'constitution.md'),
  path.join(sddDir, 'constitution.md'),
];

const planCandidates = (specDir: string): string[] => [
  path.join(specDir, 'plan.md'),
  path.join(specDir, 'design.md'),
];

/**
 * Evaluar el repositorio contra el nivel declarado. Lee el sistema de archivos.
 *
 * Honestidad ante todo: ningún artefacto ausente o ilegible se convierte en un aprobado. Si no se
 * puede evaluar, se emite un hallazgo `info`/`warning` que dice exactamente eso. En `spec-first` no
 * se inventan hallazgos de drift: el nivel no los exige.
 */
export const assessRigor = async (
  cwd: string,
  options: { level: SddRigorLevel; brownfield: boolean; feature?: string; sddDir?: string; gates?: string[] },
): Promise<RigorAssessment> => {
  const spec = RIGOR_BY_NAME.get(options.level);
  if (!spec) throw new Error(`Nivel de rigor desconocido: ${String(options.level)}`);

  const level = options.level;
  const brownfield = options.brownfield === true;
  const sddDir = options.sddDir ?? (await resolveSddDir(cwd));
  const feature = options.feature;
  const requires = rigorRequires(level, brownfield);
  const findings: RigorFinding[] = [];

  const specDirRel = feature ? path.join(sddDir, 'specs', feature) : null;

  // ── Constitución ────────────────────────────────────────────────────────────────────────────
  const constitutionDemand = requires.constitution;
  const candidates = constitutionCandidates(sddDir);
  let constitutionPath: string | null = null;
  let constitutionRead: { exists: boolean; content: string | null; error?: string } | null = null;
  for (const candidate of candidates) {
    const read = await readIfPresent(path.join(cwd, candidate));
    if (read.exists) {
      constitutionPath = candidate;
      constitutionRead = read;
      break;
    }
  }

  if (constitutionPath === null) {
    if (constitutionDemand === 'required') {
      findings.push({
        aspect: 'constitution',
        severity: 'error',
        artifact: candidates[0],
        message: `Constitución ausente: el nivel ${spec.name} emite veredictos bloqueantes y estos deben citar autoridad, pero no hay principios en vigor que citar. Crea ${candidates[0]} (en brownfield, descriptiva y con evidencia) o baja el nivel declarado.`,
      });
    } else {
      findings.push({
        aspect: 'constitution',
        severity: 'info',
        artifact: candidates[0],
        message: 'Constitución ausente (recomendada, no exigida a este nivel): no hay autoridad citable, pero el nivel no la demanda.',
      });
    }
  } else if (constitutionRead!.content === null) {
    findings.push({
      aspect: 'constitution',
      severity: constitutionDemand === 'required' ? 'warning' : 'info',
      artifact: constitutionPath,
      message: `La constitución existe pero no se pudo leer (${constitutionRead!.error ?? 'error de lectura'}): se informa como no evaluada, no como válida.`,
    });
  } else {
    const constitution = parseConstitution(constitutionRead!.content);
    const issues = validateConstitution(constitution);
    const errors = issues.filter((i) => i.severity === 'error');
    const warnings = issues.filter((i) => i.severity === 'warning');
    const inForce = principlesInForce(constitution);
    const severity: RigorFinding['severity'] = constitutionDemand === 'required' ? 'error' : 'warning';

    if (errors.length > 0) {
      findings.push({
        aspect: 'constitution',
        severity,
        artifact: constitutionPath,
        message: `Constitución inválida (${errors.length} error(es)): ${errors.map((e) => `${e.id}: ${e.message}`).join(' | ')}`,
      });
    }

    if (inForce.length === 0) {
      findings.push({
        aspect: 'constitution',
        severity,
        artifact: constitutionPath,
        message:
          'La constitución no tiene principios en vigor: sin principios citables ningún veredicto bloqueante puede citar autoridad.',
      });
    } else {
      const citation = resolveAuthority(constitution, inForce[0].id);
      findings.push({
        aspect: 'constitution',
        severity: citation.known ? 'info' : severity,
        artifact: constitutionPath,
        message: citation.known
          ? `Constitución evaluable: ${inForce.length} principio(s) en vigor; autoridad citable ${citation.detail}.`
          : `La autoridad declarada no resuelve: ${citation.detail}`,
      });
    }

    for (const warning of warnings) {
      findings.push({
        aspect: 'constitution',
        severity: 'warning',
        artifact: constitutionPath,
        message: `${warning.id}: ${warning.message}`,
      });
    }
  }

  // ── Tríada ──────────────────────────────────────────────────────────────────────────────────
  let triadPresent: string[] | null = null;
  if (specDirRel) {
    try {
      const entries = await readdir(path.join(cwd, specDirRel), { withFileTypes: true });
      triadPresent = entries.filter((e) => e.isFile()).map((e) => e.name);
    } catch (err) {
      findings.push({
        aspect: 'triad',
        severity: requires.triad === 'required' ? 'warning' : 'info',
        artifact: specDirRel,
        message: `No se pudo leer ${specDirRel} (${(err as Error).message}): la tríada no se evalúa y no se da por buena.`,
      });
    }
  } else if (requires.triad !== 'not-required') {
    findings.push({
      aspect: 'triad',
      severity: 'info',
      artifact: sddDir,
      message: 'Sin --feature no hay directorio de spec que evaluar: la tríada queda como no evaluada, no como presente.',
    });
  }

  if (triadPresent !== null) {
    const verdict = evaluateTriad(triadPresent);
    if (verdict.complete) {
      findings.push({
        aspect: 'triad',
        severity: 'info',
        artifact: specDirRel ?? undefined,
        message: verdict.detail,
      });
    } else {
      findings.push({
        aspect: 'triad',
        severity: requires.triad === 'required' ? 'error' : 'warning',
        artifact: specDirRel ?? undefined,
        message: verdict.detail,
      });
    }
  }

  // ── Delta (solo brownfield) ─────────────────────────────────────────────────────────────────
  let delta: DeltaSpec | null = null;
  let tasksContentCache: string | null = null;
  const tasksRel = specDirRel ? path.join(specDirRel, 'tasks.md') : null;

  if (brownfield && requires.delta === 'required' && specDirRel) {
    const deltaRel = path.join(specDirRel, deltaSpecFileName());
    const deltaRead = await readIfPresent(path.join(cwd, deltaRel));
    if (!deltaRead.exists) {
      findings.push({
        aspect: 'delta',
        severity: 'error',
        artifact: deltaRel,
        message: `Proyecto brownfield sin delta: el nivel ${spec.name} exige ${deltaSpecFileName()} con entradas ADSR y REQ-IDs propios de la delta (§9.4/§9.6). Sin el contrato del cambio no se puede demostrar qué comportamiento existente se toca.`,
      });
    } else if (deltaRead.content === null) {
      findings.push({
        aspect: 'delta',
        severity: 'warning',
        artifact: deltaRel,
        message: `La delta existe pero no se pudo leer (${deltaRead.error ?? 'error de lectura'}): no evaluada ni dada por buena.`,
      });
    } else {
      delta = parseDeltaSpec(deltaRead.content);
      const deltaErrors = validateDeltaSpec(delta).filter((i) => i.severity === 'error');
      if (deltaErrors.length > 0) {
        findings.push({
          aspect: 'delta',
          severity: 'error',
          artifact: deltaRel,
          message: `Delta inválida (${deltaErrors.length} error(es)): ${deltaErrors.map((i) => `${i.id}: ${i.message}`).join(' | ')}`,
        });
      }
      if (delta.entries.length === 0) {
        findings.push({
          aspect: 'delta',
          severity: 'error',
          artifact: deltaRel,
          message: 'La delta no declara entradas ADDED/MODIFIED/REMOVED/RENAMED: no hay contrato del cambio que trazar.',
        });
      }
      findings.push({
        aspect: 'delta',
        severity: 'info',
        artifact: deltaRel,
        message: `Delta evaluada: ${delta.entries.length} entrada(s), estado ${delta.status}.`,
      });
    }
  } else if (brownfield && specDirRel && level === 'spec-first') {
    findings.push({
      aspect: 'delta',
      severity: 'info',
      artifact: path.join(specDirRel, deltaSpecFileName()),
      message: 'Proyecto brownfield: el nivel spec-first no exige delta; la exigencia empieza en spec-anchored.',
    });
  }

  // ── Contratos ───────────────────────────────────────────────────────────────────────────────
  if (requires.contracts === 'required') {
    if (delta) {
      const withoutContracts = delta.entries.filter((e) => (e.contracts ?? []).length === 0);
      if (withoutContracts.length > 0) {
        findings.push({
          aspect: 'contracts',
          severity: 'error',
          artifact: specDirRel ? path.join(specDirRel, deltaSpecFileName()) : undefined,
          message: `La delta no declara contratos de ejecución para ${withoutContracts.length} entrada(s): ${withoutContracts.map((e) => e.id).join(', ')}. Sin oráculo de regresión no hay forma de saber que lo existente sigue intacto.`,
        });
      } else {
        findings.push({
          aspect: 'contracts',
          severity: 'info',
          artifact: specDirRel ? path.join(specDirRel, deltaSpecFileName()) : undefined,
          message: 'Todas las entradas de la delta declaran contratos de ejecución.',
        });
      }
    } else if (specDirRel) {
      let planPath: string | null = null;
      let planContent: string | null = null;
      for (const candidate of planCandidates(specDirRel)) {
        const read = await readIfPresent(path.join(cwd, candidate));
        if (read.exists) {
          planPath = candidate;
          planContent = read.content;
          break;
        }
      }
      if (planPath === null) {
        findings.push({
          aspect: 'contracts',
          severity: 'warning',
          artifact: planCandidates(specDirRel)[0],
          message: 'No hay plan.md/design.md del que leer contratos: no evaluable, no aprobado.',
        });
      } else if (planContent === null) {
        findings.push({
          aspect: 'contracts',
          severity: 'info',
          artifact: planPath,
          message: 'El plan existe pero no se pudo leer: los contratos quedan sin evaluar.',
        });
      } else if (!/^#{1,6}\s*Contracts\b/mi.test(planContent) && !/^-?\s*Contracts:\s*\S/mi.test(planContent)) {
        findings.push({
          aspect: 'contracts',
          severity: 'error',
          artifact: planPath,
          message:
            'El nivel spec-as-source exige contratos declarados y el plan no declara ninguno (sección "Contracts" o campo "Contracts:"): sin ellos no hay oráculo de regresión.',
        });
      } else {
        findings.push({
          aspect: 'contracts',
          severity: 'info',
          artifact: planPath,
          message: 'Contratos declarados en el plan.',
        });
      }
    }
  }

  // ── Trazabilidad ────────────────────────────────────────────────────────────────────────────
  if (specDirRel && tasksRel && requires.traceability !== 'not-required') {
    if (brownfield && delta) {
      const tasksRead = await readIfPresent(path.join(cwd, tasksRel));
      if (!tasksRead.exists) {
        findings.push({
          aspect: 'traceability',
          severity: 'error',
          artifact: tasksRel,
          message: 'Sin tasks.md no hay trazabilidad de la delta: cada REQ-ID de la delta debe tener al menos una tarea.',
        });
      } else if (tasksRead.content === null) {
        findings.push({
          aspect: 'traceability',
          severity: 'warning',
          artifact: tasksRel,
          message: `tasks.md existe pero no se pudo leer (${tasksRead.error ?? 'error de lectura'}): trazabilidad no evaluada ni dada por buena.`,
        });
      } else {
        tasksContentCache = tasksRead.content;
        const deltaTasks: DeltaTask[] = parseTasksMarkdown(tasksRead.content).map((t) => ({
          id: t.id,
          raw: t.raw,
          ...(t.boundary ? { boundary: t.boundary } : {}),
        }));
        const trace = traceDelta(delta, deltaTasks);
        findings.push({
          aspect: 'traceability',
          severity: trace.unmapped.length > 0 || trace.phantomTasks.length > 0 ? 'error' : 'info',
          artifact: tasksRel,
          message: trace.detail,
        });
      }
    } else {
      // Greenfield: la matriz de trazabilidad requisito→tarea del motor de auditoría.
      try {
        const audit = await auditFeature(cwd, feature!, { sddDir });
        const unmapped = audit.issues.filter((i) => i.code === 'UNMAPPED_REQUIREMENT');
        if (audit.issues.some((i) => i.code === 'SPEC_NOT_FOUND')) {
          findings.push({
            aspect: 'traceability',
            severity: 'warning',
            artifact: specDirRel,
            message: `La feature "${feature}" no existe en ${path.join(sddDir, 'specs')}: trazabilidad no evaluable.`,
          });
        } else if (audit.rtm.length === 0) {
          findings.push({
            aspect: 'traceability',
            severity: 'warning',
            artifact: specDirRel,
            message: 'requirements.md no declara requisitos REQ-*: no hay nada que trazar (esto no es un aprobado).',
          });
        } else if (unmapped.length > 0) {
          findings.push({
            aspect: 'traceability',
            severity: requires.traceability === 'required' ? 'error' : 'warning',
            artifact: specDirRel,
            message: `${unmapped.length}/${audit.rtm.length} requisito(s) sin tarea trazable: ${unmapped.map((i) => i.message).join(' | ')}`,
          });
        } else {
          findings.push({
            aspect: 'traceability',
            severity: 'info',
            artifact: specDirRel,
            message: `Trazabilidad completa: ${audit.rtm.length} requisito(s) con tarea declarada.`,
          });
        }
      } catch (err) {
        findings.push({
          aspect: 'traceability',
          severity: 'info',
          artifact: specDirRel,
          message: `Trazabilidad no evaluable (${(err as Error).message}); no se da por buena.`,
        });
      }
    }
  }

  // ── Binding de evidencia ────────────────────────────────────────────────────────────────────
  if (specDirRel && tasksRel && requires.evidence !== 'not-required') {
    const tasksRead: { exists: boolean; content: string | null; error?: string } =
      tasksContentCache !== null
        ? { exists: true, content: tasksContentCache }
        : await readIfPresent(path.join(cwd, tasksRel));
    if (!tasksRead.exists) {
      findings.push({
        aspect: 'evidence',
        severity: 'warning',
        artifact: tasksRel,
        message: 'Sin tasks.md no se puede comprobar el evidence lock: no evaluable (y la tríada ya reporta su ausencia).',
      });
    } else if (tasksRead.content === null) {
      findings.push({
        aspect: 'evidence',
        severity: 'info',
        artifact: tasksRel,
        message: 'tasks.md existe pero no se pudo leer: evidence lock no evaluado.',
      });
    } else {
      const lock = checkEvidenceLock(tasksRead.content);
      findings.push({
        aspect: 'evidence',
        severity: lock.satisfied ? 'info' : requires.evidence === 'required' ? 'error' : 'warning',
        artifact: tasksRel,
        message: lock.detail,
      });
    }
  }

  // ── Detección de drift (nunca en spec-first) ────────────────────────────────────────────────
  if (requires.drift === 'required' && specDirRel) {
    if (!isGitRepo(cwd)) {
      findings.push({
        aspect: 'drift',
        severity: 'info',
        artifact: specDirRel,
        message: 'Detección de drift no evaluable: no es un repositorio git (la comparación código↔spec exige un índice).',
      });
    } else {
      try {
        const audit = await auditFeature(cwd, feature!, { sddDir });
        const driftIssues = audit.issues.filter((i) => i.code === 'AMBIENT_CODE_DRIFT');
        findings.push({
          aspect: 'drift',
          severity: audit.driftDetected ? 'error' : 'info',
          artifact: specDirRel,
          message: audit.driftDetected
            ? `Drift detectado: ${driftIssues.map((i) => i.message).join(' | ') || 'el código cambió fuera de los límites declarados'}`
            : 'Sin drift en los archivos modificados frente a los límites declarados.',
        });
      } catch (err) {
        findings.push({
          aspect: 'drift',
          severity: 'info',
          artifact: specDirRel,
          message: `Detección de drift no evaluable (${(err as Error).message}); no se da por buena.`,
        });
      }
    }
  }

  // ── Regeneración (spec-as-source) ───────────────────────────────────────────────────────────
  if (requires.regeneration === 'required') {
    // Ninguna comprobación de este repositorio puede demostrar que el código se regeneró desde la
    // spec: se declara la brecha en vez de fabricar un aprobado. Una comprobación que siempre dice
    // «ok» sería un gate siempre encendido, es decir, un gate siempre apagado.
    findings.push({
      aspect: 'regeneration',
      severity: 'info',
      artifact: specDirRel ?? sddDir,
      message:
        'La regeneración como mecanismo de reparación no es verificable desde los artefactos de este repositorio: se declara como brecha declarada, no como aprobado.',
    });
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const satisfied = errors.length === 0;

  return {
    level,
    brownfield,
    gates: effectiveGates(level, options.gates),
    findings,
    satisfied,
    detail: satisfied
      ? `${spec.name} satisfecho: ${findings.length} hallazgo(s), ${warnings.length} aviso(s), 0 errores.`
      : `${spec.name} NO satisfecho: ${errors.length} error(es) y ${warnings.length} aviso(s). ${errors.map((e) => `[${e.aspect}] ${e.message}`).join(' ')}`,
  };
};
