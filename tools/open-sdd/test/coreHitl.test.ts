import { describe, it, expect } from 'vitest';
import {
  HITL_DEFAULTS,
  evaluateEscalations,
  selectRigorMode,
  calibrateEscalationThreshold,
} from '../src/core/hitl.js';

const triggers = (signals: Parameters<typeof evaluateEscalations>[0]) =>
  evaluateEscalations(signals).map((d) => d.trigger);

describe('core/hitl — Table 25 escalation thresholds', () => {
  it('declares the paper starting values', () => {
    expect(HITL_DEFAULTS).toMatchObject({
      maxExternalDependenciesOutsidePlan: 3,
      maxConsecutiveRepairAttempts: 3,
      pairModeComplexity: 0.7,
      liteModeComplexity: 0.3,
      minJudgeAgreementKappa: 0.6,
      maxUselessEscalationRate: 0.2,
      contextCompactionOccupancy: 0.7,
      governanceTokenCeiling: 0.3,
    });
  });

  it('escalates architectural drift only ABOVE 3 external dependencies', () => {
    expect(triggers({ externalDependenciesOutsidePlan: 3 })).not.toContain('architectural-drift');
    expect(triggers({ externalDependenciesOutsidePlan: 4 })).toContain('architectural-drift');
  });

  it('escalates the repair loop at 3 consecutive failures (>= threshold)', () => {
    expect(triggers({ consecutiveRepairAttempts: 2 })).not.toContain('repair-loop-exhausted');
    const decision = evaluateEscalations({ consecutiveRepairAttempts: 3 }).find(
      (d) => d.trigger === 'repair-loop-exhausted',
    );
    expect(decision?.escalate).toBe(true);
    expect(decision?.attentionCost).toBe('high');
  });

  it('escalates pair mode at complexity >= 0.7 and not below it', () => {
    expect(triggers({ complexity: 0.69 })).not.toContain('pair-mode-complexity');
    expect(triggers({ complexity: 0.7 })).toContain('pair-mode-complexity');
  });

  it('escalates when the judge agreement falls below the substantial kappa floor', () => {
    expect(triggers({ judgeAgreementKappa: 0.6 })).not.toContain('judge-disagreement');
    expect(triggers({ judgeAgreementKappa: 0.59 })).toContain('judge-disagreement');
  });

  it('escalates an irreversible-damage or no-local-evaluator change regardless of model capability', () => {
    expect(triggers({ irreversibleDamage: true })).toContain('irreversible-damage');
    expect(triggers({ noLocalEvaluator: true })).toContain('no-local-evaluator');
    expect(triggers({ criticalGateFailed: true })).toContain('critical-gate-failure');
  });

  it('returns nothing to escalate for a small, familiar, reversible change', () => {
    expect(evaluateEscalations({ complexity: 0.2, consecutiveRepairAttempts: 0 })).toEqual([]);
  });

  it('accepts installation-specific thresholds', () => {
    const t = { ...HITL_DEFAULTS, pairModeComplexity: 0.5 };
    expect(evaluateEscalations({ complexity: 0.5 }, t).map((d) => d.trigger)).toContain(
      'pair-mode-complexity',
    );
  });
});

describe('core/hitl — rigor mode selection (§4.8/§4.10)', () => {
  it('a disposable-by-design change gets no spec at all', () => {
    expect(selectRigorMode({ discardedByDesign: true }).mode).toBe('none');
  });

  it('an unknown scope gets no spec: exploration first', () => {
    expect(selectRigorMode({ scopeKnown: false }).mode).toBe('none');
  });

  it('complexity below 0.3 selects the Lite flow and omits the Triad', () => {
    expect(selectRigorMode({ complexity: 0.29 }).mode).toBe('lite');
    expect(selectRigorMode({ complexity: 0.3 }).mode).not.toBe('lite');
  });

  it('cheap-to-misread selects spec-first', () => {
    expect(selectRigorMode({ misreadingIsCheap: true }).mode).toBe('spec-first');
  });

  it('reversible and unaudited selects spec-anchored', () => {
    expect(selectRigorMode({ reversible: true, audited: false }).mode).toBe('spec-anchored');
  });

  it('hard-to-reverse or audited defaults to spec-as-source', () => {
    expect(selectRigorMode({ reversible: false }).mode).toBe('spec-as-source');
    expect(selectRigorMode({ reversible: true, audited: true }).mode).toBe('spec-as-source');
  });

  it('discard-by-design outranks every other signal', () => {
    expect(
      selectRigorMode({ discardedByDesign: true, complexity: 0.9, reversible: false }).mode,
    ).toBe('none');
  });
});

describe('core/hitl — escalation-usefulness calibration', () => {
  it('is within target below 20% useless escalations', () => {
    const r = calibrateEscalationThreshold({ useful: 9, useless: 1 });
    expect(r.uselessRate).toBeCloseTo(0.1, 10);
    expect(r.withinTarget).toBe(true);
  });

  it('recommends raising the threshold when useless escalations reach 20%', () => {
    const r = calibrateEscalationThreshold({ useful: 4, useless: 1 });
    expect(r.uselessRate).toBeCloseTo(0.2, 10);
    expect(r.withinTarget).toBe(false);
    expect(r.recommendation).toContain('subir el umbral');
  });

  it('treats no escalations as a zero useless rate', () => {
    const r = calibrateEscalationThreshold({ useful: 0, useless: 0 });
    expect(r.uselessRate).toBe(0);
    expect(r.withinTarget).toBe(true);
  });
});
