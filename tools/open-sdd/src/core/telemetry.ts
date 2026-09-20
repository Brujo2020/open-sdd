/**
 * Telemetry and the overhead budget (§14.1, Appendix B.4, B.5, B.6).
 *
 * No governance architecture is free, and omitting its cost is the most common way to sell one
 * badly. Three distinct loads are budgeted separately because they behave differently: the
 * latency of verification, the inference cost of governance (tokens that produce no line of
 * code), and the human cost of escalation — the most expensive and the only one that does not
 * fall with model prices.
 *
 * The design rule: governance must not exceed a DECLARED fraction of the work it governs, and
 * that fraction is a configurable, audited parameter rather than a residue.
 */

export interface CostLine {
  id: 'verification-latency' | 'governance-inference' | 'human-escalation';
  name: string;
  unit: string;
  note: string;
  /** Only the human line does not get cheaper as models do. */
  fallsWithModelPrices: boolean;
}

export const COST_LINES: CostLine[] = [
  {
    id: 'verification-latency',
    name: 'Latencia de verificación',
    unit: 'segundos de reloj por cierre de tarea',
    note: 'Tiempo que el barrido de gates añade a cada cierre.',
    fallsWithModelPrices: true,
  },
  {
    id: 'governance-inference',
    name: 'Coste de inferencia del gobierno',
    unit: 'tokens',
    note: 'META-EVAL, etapa de auditoría y destilación de memoria: no producen ninguna línea de código.',
    fallsWithModelPrices: true,
  },
  {
    id: 'human-escalation',
    name: 'Coste humano del escalado',
    unit: 'minutos de atención de ingeniero por disparo HIL',
    note: 'La partida más cara de las tres y la única que no baja con el precio de los modelos.',
    fallsWithModelPrices: false,
  },
];

/** Ceiling: 30% of the cycle token budget for the three inference line items summed. */
export const GOVERNANCE_TOKEN_CEILING = 0.3;

export type BudgetVerdict =
  | { withinBudget: true; pct: number; detail: string }
  | {
      withinBudget: false;
      pct: number;
      detail: string;
      /** Degrade the EXPENSIVE verification first, before touching cheap verification. */
      action: 'sample-judge' | 'disable-optional-controls';
    };

/**
 * Evaluate the overhead budget. When the ceiling is hit, expensive verification degrades first
 * — the judge switches to sampling instead of a full sweep — because the alternative (letting
 * governance grow unbounded) produces the failure the alert-fatigue literature documents: not an
 * expensive system, but a switched-off one.
 */
export const evaluateGovernanceBudget = (
  cycleTokens: number,
  metrEvalTokens: number,
  auditTokens: number,
  distillationTokens: number,
  ceiling: number = GOVERNANCE_TOKEN_CEILING,
): BudgetVerdict => {
  const governance = metrEvalTokens + auditTokens + distillationTokens;
  const pct = cycleTokens === 0 ? 0 : governance / cycleTokens;

  if (pct <= ceiling) {
    return {
      withinBudget: true,
      pct,
      detail: `Gobierno en ${(pct * 100).toFixed(1)}% del presupuesto de tokens del ciclo (techo ${(ceiling * 100).toFixed(0)}%).`,
    };
  }

  return {
    withinBudget: false,
    pct,
    action: 'sample-judge',
    // The fourth account of B.5 in action: the cost was declared, not hidden.
    detail: `Gobierno en ${(pct * 100).toFixed(1)}% > techo ${(ceiling * 100).toFixed(0)}%: se degrada la verificación CARA primero — el juez pasa a muestreo en vez de barrido completo — antes que la barata.`,
  };
};

/** B.2 — adaptive history compression at 70% window occupancy. */
export const CONTEXT_COMPACTION_TRIGGER = 0.7;

export interface CompactionDecision {
  compact: boolean;
  detail: string;
  steps: string[];
}

/**
 * At the trigger, the harness distils: evict failure logs, collapse history into a decision
 * book, FORCE A COMMIT, and reset conversational memory to the distilled state. The forced
 * commit is the part teams skip, and it is what makes the reset safe.
 */
export const evaluateCompaction = (
  occupancy: number,
  trigger: number = CONTEXT_COMPACTION_TRIGGER,
): CompactionDecision => {
  if (occupancy < trigger) {
    return {
      compact: false,
      detail: `Ocupación ${(occupancy * 100).toFixed(0)}% < ${(trigger * 100).toFixed(0)}%: no se destila todavía.`,
      steps: [],
    };
  }
  return {
    compact: true,
    detail: `Ocupación ${(occupancy * 100).toFixed(0)}% ≥ ${(trigger * 100).toFixed(0)}%: destilar antes de que el contexto largo degrade la fiabilidad mientras aumenta el coste.`,
    steps: [
      'Desalojar los logs de fallo.',
      'Colapsar el historial en un libro de decisiones.',
      'Forzar un commit.',
      'Reiniciar la memoria conversacional al estado destilado.',
    ],
  };
};

// ---------------------------------------------------------------------------------------------
// Operational metric definitions (Appendix B.5)
// ---------------------------------------------------------------------------------------------

/**
 * These look bureaucratic and are not: every one of them is a place where a dashboard can be
 * made to lie in the organization's favour. Defining them once, in code, is what makes the
 * numbers comparable across teams.
 */
export const METRIC_DEFINITIONS = [
  {
    metric: 'escaped-defect',
    definition:
      'Fallo detectado DESPUÉS del merge a main cuyo origen se rastrea a un cambio que atravesó la cadena completa.',
  },
  {
    metric: 'production-bug',
    definition: 'Defecto escapado que llegó a un usuario final.',
  },
  {
    metric: 'lead-time',
    definition: 'De la creación del ticket al MERGE, no al despliegue.',
  },
  {
    metric: 'gate-trigger',
    definition: 'Cuenta UNA VEZ POR ARTEFACTO, no por reintento.',
  },
] as const;

export interface LoopEconomy {
  tokensPerTask: number;
  iterationsToGreen: number;
  humanEscalations: number;
  verificationLatencySeconds: number;
}

/**
 * Harness ON/OFF comparison for the same tickets (lab bank 5). Reporting the delta is what
 * replaces a hypothesis with provenance data; a governance programme that cannot produce this
 * table is selling the thing this module exists to avoid.
 */
export const compareLoopEconomy = (
  on: LoopEconomy,
  off: LoopEconomy,
): {
  tokenDeltaPct: number;
  iterationDelta: number;
  escalationDelta: number;
  latencyDeltaSeconds: number;
  detail: string;
} => {
  const tokenDeltaPct = off.tokensPerTask === 0 ? 0 : (on.tokensPerTask - off.tokensPerTask) / off.tokensPerTask;
  return {
    tokenDeltaPct,
    iterationDelta: on.iterationsToGreen - off.iterationsToGreen,
    escalationDelta: on.humanEscalations - off.humanEscalations,
    latencyDeltaSeconds: on.verificationLatencySeconds - off.verificationLatencySeconds,
    detail: `Gobierno ON vs OFF: ${(tokenDeltaPct * 100).toFixed(1)}% tokens/tarea, ${on.iterationsToGreen - off.iterationsToGreen} iteraciones, ${on.humanEscalations - off.humanEscalations} escalados humanos, +${(on.verificationLatencySeconds - off.verificationLatencySeconds).toFixed(1)}s de latencia de verificación.`,
  };
};

// ---------------------------------------------------------------------------------------------
// Complexity routing (B.6)
// ---------------------------------------------------------------------------------------------

export type ComplexityTier = 'T0' | 'T1' | 'T2' | 'T3';

export interface TierSpec {
  tier: ComplexityTier;
  name: string;
  /** Correctness bar this tier's model must historically exceed. */
  correctnessBar: number;
  tokenCeiling: number;
}

export const COMPLEXITY_TIERS: TierSpec[] = [
  { tier: 'T0', name: 'consulta trivial', correctnessBar: 0.7, tokenCeiling: 2_000 },
  { tier: 'T1', name: 'edición de un fichero', correctnessBar: 0.8, tokenCeiling: 6_000 },
  { tier: 'T2', name: 'feature multi-fichero', correctnessBar: 0.9, tokenCeiling: 24_000 },
  { tier: 'T3', name: 'arquitectura y seguridad', correctnessBar: 0.95, tokenCeiling: 80_000 },
];

export interface RoutingDecision {
  tier: ComplexityTier;
  chosenModel: string;
  detail: string;
}

/**
 * Route to the CHEAPEST model whose historical success rate exceeds the tier's correctness bar,
 * with downstream gates as an identical net for every tier: cheapening the executor must never
 * cheapen verification.
 */
export const routeModel = (
  tier: ComplexityTier,
  candidates: { model: string; historicalSuccessRate: number; costPerMTok: number }[],
): RoutingDecision => {
  const spec = COMPLEXITY_TIERS.find((t) => t.tier === tier)!;
  const viable = candidates
    .filter((c) => c.historicalSuccessRate >= spec.correctnessBar)
    .sort((a, b) => a.costPerMTok - b.costPerMTok);

  if (viable.length === 0) {
    return {
      tier,
      chosenModel: 'ninguno',
      detail: `Ningún modelo alcanza el listón de ${spec.correctnessBar} para ${tier}: se escala a un humano en vez de fingir una ruta.`,
    };
  }

  return {
    tier,
    chosenModel: viable[0].model,
    detail: `Modelo más barato que supera el listón ${spec.correctnessBar} de ${tier} (${spec.name}): ${viable[0].model}. Los gates aguas abajo son la misma red para todos los tiers.`,
  };
};

/**
 * Escalation on failure: a failure in tier N triggers a retry in N+1 WITH THE COMPLETE FAILURE
 * IN CONTEXT — never a blind retry, which pays twice for the same ignorance — and three
 * consecutive failures escalate to a human.
 */
export const escalateTier = (
  tier: ComplexityTier,
  consecutiveFailures: number,
  maxFailures = 3,
): { nextTier: ComplexityTier | 'human'; detail: string } => {
  if (consecutiveFailures >= maxFailures) {
    return {
      nextTier: 'human',
      detail: `${consecutiveFailures} fallos consecutivos: escalado a humano vía HIL (tres strikes, luego humano).`,
    };
  }
  const order: ComplexityTier[] = ['T0', 'T1', 'T2', 'T3'];
  const idx = order.indexOf(tier);
  const next = idx < order.length - 1 ? order[idx + 1] : 'human';
  return {
    nextTier: next,
    detail:
      next === 'human'
        ? 'Ya en el tier más alto: escalado a humano.'
        : `Reintento en ${next} con el fallo completo en contexto, nunca a ciegas.`,
  };
};

// ---------------------------------------------------------------------------------------------
// Harness self-failure asymmetry (B.5, third account)
// ---------------------------------------------------------------------------------------------

export type ControlKind = 'decidable' | 'model-judgment';

export interface SelfFailurePolicy {
  kind: ControlKind;
  behavior: 'fail-closed' | 'fail-open';
  detail: string;
}

/**
 * What the harness does when the harness fails, decided in advance. The asymmetry is deliberate:
 * blocking on an arguable component teaches teams to disable the whole harness, and a disabled
 * harness still shows as running in the compliance report.
 */
export const HARNESS_SELF_FAILURE: SelfFailurePolicy[] = [
  {
    kind: 'decidable',
    behavior: 'fail-closed',
    detail:
      'Controles decidibles (secretos, comandos destructivos, presencia de evidencia): fallan cerrados y detienen la tubería.',
  },
  {
    kind: 'model-judgment',
    behavior: 'fail-open',
    detail:
      'Controles de juicio de modelo: fallan abiertos, registran que no se evaluó y marcan el artefacto como NO AUDITADO.',
  },
];
