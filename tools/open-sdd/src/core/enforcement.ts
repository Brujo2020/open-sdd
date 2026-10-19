/**
 * Enforcement levels, per-host ceilings and the default-FAIL posture (§6.3, §9.2, Table 19).
 *
 * The central claim of the reference architecture is structural: what a governance programme
 * can guarantee on day one is NOT universal write-time blocking but the commit/merge floor,
 * because that boundary does not depend on any vendor. Level A is borrowed; B and C are owned.
 *
 * A table of per-host ceilings expires with each ecosystem release. The ownership asymmetry
 * does not. So this module separates three things that are routinely conflated:
 *
 *   ceiling  — the strongest level a host tool ALLOWS (Table 19).
 *   floor    — the level an installation GUARANTEES right now, only after a behavioural
 *              sentinel proved it (a destructive test command that must come back blocked).
 *   claimed  — what the documentation says. Never trusted on its own (invariant I3).
 */

export type EnforcementLevelId = 'A' | 'B' | 'C' | 'D';

export interface EnforcementLevel {
  id: EnforcementLevelId;
  name: string;
  /** The process that materialises the level. */
  mechanism: string;
  /** Who owns the boundary: the organization, or a third party it does not govern. */
  ownedBy: 'organization' | 'third-party';
  /**
   * True when the boundary is only partly the organization's (Level D's proxy). Recorded so the
   * claim stays precise without pretending the proxy is fully owned or fully borrowed.
   */
  partiallyOwned?: boolean;
  /** True when the level works across every host tool. */
  universal: boolean;
  /** Borrowed from someone else's product surface. */
  borrowed: boolean;
  description: string;
}

export const ENFORCEMENT_LEVELS: EnforcementLevel[] = [
  {
    id: 'A',
    name: 'escritura',
    mechanism: 'el hook del anfitrión',
    ownedBy: 'third-party',
    universal: false,
    borrowed: true,
    description:
      'El arnés bloquea la acción del agente antes de que toque el disco o el shell. Requiere que la herramienta exponga hooks bloqueantes; es el nivel más fuerte y el menos disponible.',
  },
  {
    id: 'B',
    name: 'commit',
    mechanism: 'git',
    ownedBy: 'organization',
    universal: true,
    borrowed: false,
    description:
      'Hooks de pre-commit/pre-push ejecutan los gates críticos (secretos, comandos destructivos, evidencia, tríada SDD). Funciona en el 100% de las herramientas, porque git no pertenece a ninguna.',
  },
  {
    id: 'C',
    name: 'merge',
    mechanism: 'CI',
    ownedBy: 'organization',
    universal: true,
    borrowed: false,
    description:
      'La matriz completa de gates corre en CI sobre cada pull request. También universal, también barato.',
  },
  {
    id: 'D',
    name: 'MCP',
    mechanism: 'el proxy',
    ownedBy: 'organization',
    partiallyOwned: true,
    universal: false,
    borrowed: false,
    description:
      'El proxy media las llamadas a herramientas para cualquier agente que hable MCP, con independencia del IDE. En parte propio: se configura desde la organización, pero media un protocolo de terceros.',
  },
];

/** Strength of the write-time ceiling a host tool allows (Table 19, column "Nivel A"). */
export type WriteCeiling = 'total' | 'partial' | 'conditional' | 'advisory' | 'none';

export interface ToolEnforcement {
  /** Host tool key, matching the agent registry where possible. */
  tool: string;
  label: string;
  writeCeiling: WriteCeiling;
  /** The concrete mechanism that would have to be alive for level A to exist. */
  writeMechanism: string;
  /** Caveat attached to the ceiling, verbatim from Table 19. */
  caveat?: string;
  commit: boolean;
  merge: boolean;
  /** Level D is available only when the tool speaks MCP. */
  mcpProxy: boolean;
}

/**
 * Table 19 — real enforcement ceiling per tool, verified behaviourally on the reference
 * harness (mid-2026). `writeCeiling: 'advisory'` means the tool exposes no pre-write hook at
 * the time of writing, so no error message can turn that into a guarantee.
 */
export const TOOL_ENFORCEMENT: ToolEnforcement[] = [
  {
    tool: 'claude-code',
    label: 'Claude Code',
    writeCeiling: 'total',
    writeMechanism: 'hooks PreToolUse/Stop',
    commit: true,
    merge: true,
    mcpProxy: true,
  },
  {
    tool: 'opencode',
    label: 'OpenCode',
    writeCeiling: 'total',
    writeMechanism: 'plugin tool.execute.before',
    commit: true,
    merge: true,
    mcpProxy: true,
  },
  {
    tool: 'cursor',
    label: 'Cursor',
    writeCeiling: 'partial',
    writeMechanism: 'shell y MCP bloqueables pre-ejecución',
    caveat:
      'Las ediciones de fichero no tienen evento pre-escritura y solo admiten auditoría posterior.',
    commit: true,
    merge: true,
    mcpProxy: true,
  },
  {
    tool: 'cline',
    label: 'Cline y forks',
    writeCeiling: 'conditional',
    writeMechanism: 'hooks (cancel:true)',
    caveat:
      'Solo si el fork ejecuta el runtime de hooks y el usuario lo activa.',
    commit: true,
    merge: true,
    mcpProxy: true,
  },
  {
    tool: 'codex',
    label: 'Codex',
    writeCeiling: 'advisory',
    writeMechanism: 'sin API de hooks pre-escritura a fecha de escritura',
    commit: true,
    merge: true,
    mcpProxy: true,
  },
  {
    tool: 'antigravity',
    label: 'Antigravity',
    writeCeiling: 'advisory',
    writeMechanism: 'sin API de hooks pre-escritura a fecha de escritura',
    commit: true,
    merge: true,
    mcpProxy: true,
  },
  {
    tool: 'windsurf',
    label: 'Windsurf',
    writeCeiling: 'advisory',
    writeMechanism: 'sin API de hooks pre-escritura a fecha de escritura',
    commit: true,
    merge: true,
    mcpProxy: true,
  },
  {
    tool: 'github-copilot',
    label: 'Copilot',
    writeCeiling: 'advisory',
    writeMechanism: 'sin API de hooks pre-escritura a fecha de escritura',
    commit: true,
    merge: true,
    mcpProxy: true,
  },
  {
    tool: 'gemini-cli',
    label: 'Gemini CLI',
    writeCeiling: 'advisory',
    writeMechanism: 'sin API de hooks pre-escritura a fecha de escritura',
    commit: true,
    merge: true,
    mcpProxy: true,
  },
  {
    tool: 'kiro',
    label: 'Kiro',
    writeCeiling: 'advisory',
    writeMechanism: 'sin API de hooks pre-escritura a fecha de escritura',
    commit: true,
    merge: true,
    mcpProxy: true,
  },
];

export const getToolEnforcement = (tool: string): ToolEnforcement | undefined =>
  TOOL_ENFORCEMENT.find((t) => t.tool === tool);

// ---------------------------------------------------------------------------------------------
// Behavioural sentinel
// ---------------------------------------------------------------------------------------------

export interface SentinelSpec {
  /** The destructive probe launched inside the host tool. */
  probe: string;
  /** Exit code that means "blocked" for this host. */
  blockedExitCode: number;
  /**
   * Exit codes that mean the hook itself failed. In Claude Code only `exit 2` blocks: a hook
   * that dies with exit 1 fails OPEN while the configuration still reads "total blocking".
   * That is exactly the failure the paper lived through for thirty days.
   */
  hookFailureExitCodes: number[];
  notes: string;
}

export const DEFAULT_SENTINEL: SentinelSpec = {
  probe: 'command that must never be allowed to run (e.g. a recursive delete outside the sandbox)',
  blockedExitCode: 2,
  hookFailureExitCodes: [1],
  notes:
    'El centinela debe relanzarse periódicamente: la tabla describe el techo, no el suelo. Una sola verificación en la puesta en marcha no establece la garantía.',
};

export type SentinelOutcome =
  | 'blocked'
  | 'allowed'
  | 'hook-failed-open'
  | 'inconclusive';

export interface SentinelResult {
  outcome: SentinelOutcome;
  /** Whether level A may be CLAIMED for this host, given this run. */
  levelAVerified: boolean;
  detail: string;
}

/**
 * Interpret a sentinel run. A hook that crashes is not a block: it is a fail-open with a green
 * dashboard, so it is reported as its own outcome instead of being folded into success or
 * failure.
 */
export const interpretSentinel = (
  exitCode: number,
  spec: SentinelSpec = DEFAULT_SENTINEL,
): SentinelResult => {
  if (exitCode === spec.blockedExitCode) {
    return {
      outcome: 'blocked',
      levelAVerified: true,
      detail: `El centinela volvió bloqueado (exit ${exitCode}): el nivel A existe en ejecución, no solo en la configuración.`,
    };
  }
  if (spec.hookFailureExitCodes.includes(exitCode)) {
    return {
      outcome: 'hook-failed-open',
      levelAVerified: false,
      detail: `El hook terminó con exit ${exitCode}, que el anfitrión interpreta como fallo del hook y no como veredicto de bloqueo: nivel A nominal, ausente en ejecución (fail-open).`,
    };
  }
  if (exitCode === 0) {
    return {
      outcome: 'allowed',
      levelAVerified: false,
      detail: 'El centinela no fue bloqueado: no hay imposición en escritura.',
    };
  }
  return {
    outcome: 'inconclusive',
    levelAVerified: false,
    detail: `Exit ${exitCode} no es un veredicto de bloqueo reconocido; el resultado no establece el nivel A.`,
  };
};

// ---------------------------------------------------------------------------------------------
// Ceiling vs floor
// ---------------------------------------------------------------------------------------------

export interface BoundaryState {
  level: EnforcementLevelId;
  /** Verified by a sentinel run or by configuration the organization owns. */
  verified: boolean;
  detail: string;
}

export interface FloorReport {
  tool: string;
  ceiling: EnforcementLevelId[];
  /**
   * What the installation actually guarantees. The floor is by construction a set of boundaries
   * the organization owns (commit and merge, plus the MCP proxy when configured): that is
   * invariant I3, and it is why a verified Level A is reported as assurance ABOVE the floor
   * rather than as part of it.
   */
  floor: EnforcementLevel[];
  /** Verified levels that sit above the floor and can be withdrawn by a vendor. */
  beyondFloor: EnforcementLevel[];
  /** Levels the documentation could claim but that are not verified in execution. */
  nominalOnly: EnforcementLevelId[];
  /** True only when every level in the floor is owned by the organization (invariant I3). */
  floorIsOwned: boolean;
  warnings: string[];
}

const writeCeilingReachesLevelA = (ceiling: WriteCeiling): boolean =>
  ceiling === 'total' || ceiling === 'partial' || ceiling === 'conditional';

/**
 * Resolve the guaranteed floor for one host tool.
 *
 * Level A never joins the floor: it is borrowed from the host and can be withdrawn without
 * notice, so it is reported separately as achieved assurance. B and C enter unconditionally —
 * they are owned boundaries, which is the paper's whole point — and D enters when the tool speaks
 * MCP and a proxy is configured.
 */
export const resolveFloor = (
  tool: string,
  input: { levelAVerified?: boolean; mcpProxyConfigured?: boolean } = {},
): FloorReport => {
  const def = getToolEnforcement(tool);
  const warnings: string[] = [];

  if (!def) {
    return {
      tool,
      ceiling: ['B', 'C'],
      floor: ENFORCEMENT_LEVELS.filter((l) => l.id === 'B' || l.id === 'C'),
      beyondFloor: [],
      nominalOnly: ['A'],
      floorIsOwned: true,
      warnings: [
        `Herramienta "${tool}" sin techo medido: solo se declara el suelo que la organización posee (B y C).`,
      ],
    };
  }

  const ceiling: EnforcementLevelId[] = ['B', 'C'];
  if (writeCeilingReachesLevelA(def.writeCeiling)) ceiling.unshift('A');
  if (def.mcpProxy) ceiling.push('D');

  const guaranteesA = writeCeilingReachesLevelA(def.writeCeiling) && input.levelAVerified === true;
  const floorIds: EnforcementLevelId[] = ['B', 'C'];
  if (def.mcpProxy && input.mcpProxyConfigured) floorIds.push('D');

  if (writeCeilingReachesLevelA(def.writeCeiling) && !input.levelAVerified) {
    warnings.push(
      `${def.label} permite nivel A (${def.writeMechanism}) pero ningún centinela lo verificó: se declara techo, no garantía.`,
    );
  }
  if (def.caveat) warnings.push(`${def.label}: ${def.caveat}`);

  const floor = ENFORCEMENT_LEVELS.filter((l) => floorIds.includes(l.id));
  const beyondFloor = guaranteesA
    ? ENFORCEMENT_LEVELS.filter((l) => l.id === 'A')
    : [];
  const guaranteed = new Set<EnforcementLevelId>([...floorIds, ...beyondFloor.map((l) => l.id)]);
  const nominalOnly = ceiling.filter((id) => !guaranteed.has(id));

  return {
    tool,
    ceiling,
    floor,
    beyondFloor,
    nominalOnly,
    floorIsOwned: floor.every((l) => l.ownedBy === 'organization'),
    warnings,
  };
};

/**
 * Invariant I3: a guarantee may not rest on a borrowed boundary. Committing to level A as the
 * floor is the most common lie in the agentic-governance market, so it is a hard error here.
 *
 * The check derives ownership from the floor levels themselves rather than trusting the
 * precomputed `floorIsOwned` flag, so a report assembled by hand (or carrying a stale flag)
 * cannot slip a borrowed boundary past the guard.
 */
export const assertFloorIsOwned = (report: FloorReport): void => {
  const borrowed = report.floor.filter((l) => l.ownedBy === 'third-party').map((l) => l.id);
  if (borrowed.length > 0 || !report.floorIsOwned) {
    throw new Error(
      `I3 violado: el suelo declarado incluye nivel(es) ${borrowed.join(', ') || 'marcados como no propios'} prestados por un tercero. ` +
        'Una garantía debe construirse sobre una frontera que la organización posee (B y C).',
    );
  }
};

// ---------------------------------------------------------------------------------------------
// default-FAIL posture
// ---------------------------------------------------------------------------------------------

export type PostureRegime = 'flexible' | 'strict';

/**
 * The hard subset that admits NO self-authorization in any regime: secrets, destructive
 * commands, evidence lock and coverage threshold. Their failure modes are irreversible or have
 * external consequence.
 */
export const HARD_SUBSET = [
  'secretos',
  'comandos_destructivos',
  'bloqueo_por_evidencia',
  'umbral_de_cobertura',
] as const;

export type HardControl = (typeof HARD_SUBSET)[number];

export interface GateObservation {
  gateId: string;
  /** Optional membership in the never-self-authorizing subset. */
  hardControl?: HardControl;
  /** The check's posture in the chain. */
  posture: 'blocking' | 'advisory';
  /**
   * True when the sensor/instrument is present and ran.
   * False means the mechanism itself is unavailable — NOT that the check passed.
   */
  sensorAvailable: boolean;
  /** True when the check ran and found a violation. */
  fired: boolean;
  /** Present when a vacuous gate is being evaluated (activation without measurement). */
  inspects?: boolean;
}

export type GateOutcome = 'pass' | 'fail' | 'self-authorized' | 'advisory';

export interface GateVerdict {
  gateId: string;
  outcome: GateOutcome;
  /** Authority cited by a blocking verdict (invariant I1). */
  authority: string;
  detail: string;
  /** True when the outcome must be recorded as an I6 relaxation event. */
  requiresReceipt: boolean;
}

export interface PostureEvidence {
  gateId: string;
  hardControl?: HardControl;
  posture: 'blocking' | 'advisory';
  sensorAvailable: boolean;
  fired: boolean;
  inspects?: boolean;
  /** Authority the gate would cite: constitution principle or requirement id. */
  authority?: string;
}

/**
 * Apply the default-FAIL posture (§9.2).
 *
 * Two regimes, and the default is the flexible one: process gates self-authorize under the
 * operator's responsibility and leave a record, while the hard subset never admits
 * self-authorization. The precise promise is:
 *
 *   - an unavailable sensor is never read as a passed verification; in strict mode it FAILS,
 *     in flexible mode it self-authorizes AND requires a receipt (I6);
 *   - a sensor that ran and found something NEVER self-authorizes, in either regime —
 *     that would be access control by exclusion with extra steps;
 *   - a gate that inspected nothing cannot pass as a control (activation != measurement).
 */
export const applyDefaultFail = (
  observation: GateObservation,
  regime: PostureRegime = 'flexible',
): GateVerdict => {
  const authority = observation.gateId;

  // A vacuous gate is not a control: it is declared without measurement.
  if (observation.inspects === false) {
    return {
      gateId: observation.gateId,
      outcome: observation.posture === 'advisory' ? 'advisory' : 'fail',
      authority,
      detail:
        'Declarado pero vacío: el gate no inspecciona nada, así que no puede acreditar un control (activación ≠ medición).',
      requiresReceipt: false,
    };
  }

  // The instrument is missing. Absence of evidence is not evidence of absence (fail-safe default).
  if (!observation.sensorAvailable) {
    if (observation.hardControl || regime === 'strict') {
      return {
        gateId: observation.gateId,
        outcome: 'fail',
        authority,
        detail: observation.hardControl
          ? `Sensor no disponible para el subconjunto duro (${observation.hardControl}): no admite auto-autorización en ningún régimen.`
          : 'Sensor no disponible en modo estricto: un instrumento ausente no se lee como verificación aprobada.',
        requiresReceipt: false,
      };
    }
    return {
      gateId: observation.gateId,
      outcome: 'self-authorized',
      authority,
      detail:
        'Sensor no disponible: se auto-autoriza bajo responsabilidad del operador y deja registro (bloquear ante un instrumento roto enseña a desactivar instrumentos).',
      requiresReceipt: true,
    };
  }

  // The scanner ran and found something: never self-authorized, in any regime.
  if (observation.fired) {
    return {
      gateId: observation.gateId,
      outcome: 'fail',
      authority,
      detail:
        'El escáner corrió y encontró algo: no se auto-autoriza nunca, porque eso sería control de acceso por exclusión con pasos adicionales.',
      requiresReceipt: false,
    };
  }

  return {
    gateId: observation.gateId,
    outcome: observation.posture === 'advisory' ? 'advisory' : 'pass',
    authority,
    detail: 'El sensor corrió y no encontró violación.',
    requiresReceipt: false,
  };
};

/** A run passes when no gate returned `fail`; self-authorized relaxations must be receipted. */
export const posturePasses = (verdicts: GateVerdict[]): boolean =>
  !verdicts.some((v) => v.outcome === 'fail');

export const unresolvedReceipts = (verdicts: GateVerdict[]): GateVerdict[] =>
  verdicts.filter((v) => v.requiresReceipt);
