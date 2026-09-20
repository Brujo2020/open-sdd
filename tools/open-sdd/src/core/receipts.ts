/**
 * Relaxation receipts (invariant I6) and the appeal channel with recalibration (§9.10).
 *
 * Invariant I6 is the one that makes the others auditable: "toda relajación es un evento
 * registrado con actor, motivo y el hash al que aplica". A framework whose exceptions are
 * invisible cannot be evaluated at all — without I6 the difference between an organization that
 * never relaxed a control and one that relaxed it daily is invisible in every artifact.
 *
 * An appeal channel is not a concession to comfort: it is a safety component. A control plane
 * without one does not remove false positives — it converts them into permanent debt, first as
 * workarounds and then as the environment variable with which the team turns governance off.
 */

export type AppealState = 'blocked' | 'overridden' | 'design-review';

export interface RelaxationReceipt {
  /** Gate that was relaxed. */
  gate: string;
  /** Hash of the artifact the relaxation applies to — I6 requires it. */
  targetHash: string;
  /** Who relaxed it. A concession that concedes itself does not count as a concession. */
  actor: string;
  /** Why. Free-text, required, non-empty. */
  reason: string;
  /** When, ISO-8601. */
  at: string;
  /** Outcome after the fact, once known. Feeds the "what did accepted risk cost us" question. */
  outcome?: string;
}

export interface AppealRecord {
  gate: string;
  targetHash: string;
  actor: string;
  reason: string;
  at: string;
}

export interface AppealOutcome {
  state: AppealState;
  receipt: RelaxationReceipt;
  detail: string;
}

export const makeReceipt = (input: {
  gate: string;
  targetHash: string;
  actor: string;
  reason: string;
  at?: string;
}): RelaxationReceipt => {
  if (!input.reason || input.reason.trim().length === 0) {
    throw new Error(
      'I6: una relajación sin motivo no es un evento registrado; el motivo es obligatorio.',
    );
  }
  if (!input.actor || input.actor.trim().length === 0) {
    throw new Error('I6: una relajación sin actor no es atribuible.');
  }
  if (input.targetHash.trim().length === 0) {
    throw new Error('I6: una relajación debe declarar el hash al que aplica.');
  }
  return {
    gate: input.gate,
    targetHash: input.targetHash,
    actor: input.actor,
    reason: input.reason,
    at: input.at ?? new Date().toISOString(),
  };
};

/**
 * Record an override at the point of block: cheap, logged, and in the same evidence journal as
 * approvals — so the audit trail contains human decisions against the system, not only the
 * system's own.
 */
export const recordOverride = (
  appeal: AppealRecord,
  journal: RelaxationReceipt[],
): { state: AppealState; receipts: RelaxationReceipt[] } => {
  const receipt = makeReceipt(appeal);
  return { state: 'overridden', receipts: [...journal, receipt] };
};

export interface OverrideCalibration {
  gate: string;
  overrides: number;
  blocks: number;
  overrideRate: number;
  /** True when the rate is at or above the sustained threshold (20%). */
  sustained: boolean;
  state: AppealState;
  action: string;
}

/** Override rate above which a gate enters design review instead of keeping on blocking. */
export const OVERRIDE_REVIEW_THRESHOLD = 0.2;

/**
 * Close the loop: overrides are the cheapest false-positive signal that exists, and they feed
 * the recalibration of the gate that caused them. A gate people systematically override is no
 * longer a control — it is an expensive survey about its own calibration, and it should be read.
 */
export const recalibrate = (
  counts: { gate: string; overrides: number; blocks: number }[],
  threshold: number = OVERRIDE_REVIEW_THRESHOLD,
): OverrideCalibration[] =>
  counts.map(({ gate, overrides, blocks }) => {
    const rate = blocks === 0 ? 0 : overrides / blocks;
    const sustained = rate >= threshold;
    return {
      gate,
      overrides,
      blocks,
      overrideRate: rate,
      sustained,
      state: sustained ? 'design-review' : 'blocked',
      action: sustained
        ? `Tasa de anulación ${(rate * 100).toFixed(1)}% ≥ ${(threshold * 100).toFixed(0)}% sostenido: el gate entra en revisión de diseño y deja de bloquear mientras se rediseña.`
        : `Tasa de anulación ${(rate * 100).toFixed(1)}% dentro de rango: el gate sigue bloqueando.`,
    };
  });

/** I6 evidence: an instance with relaxations but no receipts is outside the framework. */
export const assessI6 = (
  relaxationsObserved: number,
  journal: RelaxationReceipt[],
): { satisfied: boolean; detail: string } => {
  const missing = relaxationsObserved - journal.length;
  if (missing > 0) {
    return {
      satisfied: false,
      detail: `${missing} relajación(es) sin recibo: desactivación silenciosa. Una instancia que viola I6 queda fuera del framework por bien que satisfaga el resto.`,
    };
  }
  return {
    satisfied: true,
    detail:
      journal.length === 0
        ? 'No hubo relajaciones en el periodo; no se requiere recibo.'
        : `${journal.length} relajación(es) registradas con actor, motivo y hash.`,
  };
};

/**
 * The question no informal process can answer, and the reason receipts are worth their cost:
 * "de los riesgos que este equipo aceptó conscientemente, ¿cuáles terminaron costándonos algo?"
 */
export const acceptedRiskLedger = (journal: RelaxationReceipt[]) => ({
  accepted: journal.length,
  withOutcome: journal.filter((r) => r.outcome).length,
  costly: journal.filter((r) => r.outcome === 'costly').length,
  entries: journal.map((r) => ({
    gate: r.gate,
    actor: r.actor,
    reason: r.reason,
    outcome: r.outcome ?? 'sin resultado posterior registrado',
  })),
});
