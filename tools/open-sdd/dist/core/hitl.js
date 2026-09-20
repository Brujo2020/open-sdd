/**
 * Quantified Human-in-the-Loop criteria (Table 25, §9.9, §4.10).
 *
 * Total automation is a liability, not a feature. Escalation is not a courtesy to nervous
 * managers — it is the shape the work already has: engineers use AI in ~60% of their work but
 * can delegate only 0–20% of tasks end-to-end.
 *
 * The table's values are explicitly DECLARED STARTING VALUES, not derived constants, and the
 * complexity score is a unitless internal scale: `>= 0.7` is not transferable to another
 * installation without recalibrating. They are exposed as configuration for that reason.
 */
/** Table 25 defaults, with the paper's own caveat attached. */
export const HITL_DEFAULTS = {
    maxExternalDependenciesOutsidePlan: 3,
    maxConsecutiveRepairAttempts: 3,
    pairModeComplexity: 0.7,
    liteModeComplexity: 0.3,
    minJudgeAgreementKappa: 0.6,
    maxUselessEscalationRate: 0.2,
    contextCompactionOccupancy: 0.7,
    governanceTokenCeiling: 0.3,
};
/**
 * Evaluate every quantified escalation criterion.
 *
 * Note the ordering of the two conditions that are NOT about model capability (§4.7): when
 * damage is irreversible and unbounded, or when nobody in the organization could evaluate the
 * output, the answer is not a stricter gate — it is a human hand on that action.
 */
export const evaluateEscalations = (signals, t = HITL_DEFAULTS) => {
    const out = [];
    if ((signals.externalDependenciesOutsidePlan ?? 0) > t.maxExternalDependenciesOutsidePlan) {
        out.push({
            trigger: 'architectural-drift',
            escalate: true,
            ask: '¿Se acepta esta dependencia externa fuera del alcance declarado?',
            detail: `${signals.externalDependenciesOutsidePlan} dependencias externas fuera del alcance de plan.md (umbral > ${t.maxExternalDependenciesOutsidePlan}).`,
            attentionCost: 'medium',
        });
    }
    if ((signals.consecutiveRepairAttempts ?? 0) >= t.maxConsecutiveRepairAttempts) {
        out.push({
            trigger: 'repair-loop-exhausted',
            escalate: true,
            ask: 'El bucle de reparación no converge: ¿seguir, cambiar de enfoque o revertir?',
            detail: `${signals.consecutiveRepairAttempts} intentos fallidos consecutivos (umbral ≥ ${t.maxConsecutiveRepairAttempts}).`,
            attentionCost: 'high',
        });
    }
    if (signals.criticalGateFailed) {
        out.push({
            trigger: 'critical-gate-failure',
            escalate: true,
            ask: 'Fallo de línea base de seguridad o intercepción de comando destructivo: ¿cómo se procede?',
            detail: 'El modo de falla es irreversible o tiene consecuencia externa.',
            attentionCost: 'high',
        });
    }
    if ((signals.complexity ?? 0) >= t.pairModeComplexity) {
        out.push({
            trigger: 'pair-mode-complexity',
            escalate: true,
            ask: 'Complejidad en el umbral de modo-pareja: ¿se revisa el plan antes de continuar?',
            detail: `Complejidad ${signals.complexity} ≥ ${t.pairModeComplexity}: se sustituye autonomía por modo-pareja. La escala es interna y no es transferible.`,
            attentionCost: 'medium',
        });
    }
    if (typeof signals.judgeAgreementKappa === 'number' &&
        signals.judgeAgreementKappa < t.minJudgeAgreementKappa) {
        out.push({
            trigger: 'judge-disagreement',
            escalate: true,
            ask: 'El juez automático perdió acuerdo sustancial: ¿se reinicia el evaluador?',
            detail: `κ = ${signals.judgeAgreementKappa} < ${t.minJudgeAgreementKappa}: por debajo del piso "sustancial" de Landis–Koch el juez dejó de ser comparable.`,
            attentionCost: 'low',
        });
    }
    // §4.7 — these two are NOT about model capability.
    if (signals.irreversibleDamage) {
        out.push({
            trigger: 'irreversible-damage',
            escalate: true,
            ask: 'Daño irreversible y sin límite: una mano humana en esta acción.',
            detail: 'No es un gate más estricto: es una acción que no se delega.',
            attentionCost: 'high',
        });
    }
    if (signals.noLocalEvaluator) {
        out.push({
            trigger: 'no-local-evaluator',
            escalate: true,
            ask: 'Nadie en la organización puede evaluar esta salida: ¿se delega igualmente?',
            detail: 'Un equipo no debería delegar aquello que no podría, en último extremo, hacer y comprobar por sí mismo.',
            attentionCost: 'high',
        });
    }
    return out;
};
/** Select the rigor mode for a change (§4.8 flow, §4.10 adaptive mode engine). */
export const selectRigorMode = (input, t = HITL_DEFAULTS) => {
    if (input.discardedByDesign) {
        return { mode: 'none', reason: 'Se descarta por diseño: invertir en spec se descartará con él.' };
    }
    if (input.scopeKnown === false) {
        return { mode: 'none', reason: 'Alcance desconocido: explorar primero; especificar ahora restringe el aprendizaje.' };
    }
    if ((input.complexity ?? 1) < t.liteModeComplexity) {
        return {
            mode: 'lite',
            reason: `Complejidad ${input.complexity} < ${t.liteModeComplexity}: flujo Lite — se omite la Tríada y quedan armados la Constitución y los gates críticos.`,
        };
    }
    if (input.misreadingIsCheap) {
        return { mode: 'spec-first', reason: 'Leerlo mal es barato: spec mínima/spec-first.' };
    }
    if (input.reversible && !input.audited) {
        return { mode: 'spec-anchored', reason: 'Reversible y no auditado: spec-anchored.' };
    }
    return {
        mode: 'spec-as-source',
        reason: 'Difícil de revertir o trazable por regulador: spec-anchored o superior, con regeneración como reparación.',
    };
};
/** The clause that keeps the important controls on: exempt by policy, not by erosion. */
export const RIGOR_POLICY = 'No es «SDD en todas partes» sino SDD donde un requisito mal leído sale caro, y nada en absoluto donde no. Eximir prototipos por política es cómo se mantienen encendidos los controles que importan.';
/**
 * Calibrate the escalation threshold (§9.9). Register a quarter of escalations, classify them
 * as useful (the human changed the result) or useless (the human confirmed what the system
 * already proposed), and move the threshold until the useless proportion falls below 20%.
 * A threshold that produces a majority of useless escalations does not protect: it trains
 * people to approve without reading.
 */
export const calibrateEscalationThreshold = (escalations, t = HITL_DEFAULTS) => {
    const total = escalations.useful + escalations.useless;
    const uselessRate = total === 0 ? 0 : escalations.useless / total;
    const withinTarget = uselessRate < t.maxUselessEscalationRate;
    return {
        uselessRate,
        withinTarget,
        recommendation: withinTarget
            ? 'Proporción de escalados inútiles dentro del objetivo (<20%): el umbral protege.'
            : `Proporción de escalados inútiles ${(uselessRate * 100).toFixed(1)}% ≥ 20%: subir el umbral hasta que baje, o el equipo aprenderá a aprobar sin leer.`,
    };
};
