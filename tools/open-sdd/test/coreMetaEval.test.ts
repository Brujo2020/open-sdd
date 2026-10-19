import { describe, it, expect } from 'vitest';
import {
  cohensKappa,
  judgeErrorDirection,
  checkApprovalDrift,
  checkSelfPreference,
  checkJudgeIndependence,
  PREREGISTERED_N,
  KAPPA_RESET_THRESHOLD,
  type KappaInput,
} from '../src/core/metaEval.js';

const PILOT: KappaInput = { truePositive: 5, falseNegative: 1, falsePositive: 0, trueNegative: 9 };

describe('core/metaEval — Cohen kappa on the paper pilot matrix', () => {
  it('reports kappa 0.86 for 5 TP / 1 FN / 0 FP / 9 TN', () => {
    const r = cohensKappa(PILOT);
    expect(r.kappa).toBe(0.86);
    expect(r.n).toBe(15);
    expect(r.observedAgreement).toBeCloseTo(14 / 15, 4);
    expect(r.expectedAgreement).toBeCloseTo(8 / 15, 4);
  });

  it('bands 0.86 as almost-perfect (Landis-Koch)', () => {
    expect(cohensKappa(PILOT).band).toBe('almost-perfect');
  });

  it('flags the sample as too small to conclude: n = 15 < 120', () => {
    const r = cohensKappa(PILOT);
    expect(r.tooSmallToConclude).toBe(true);
    expect(r.preregisteredN).toBe(PREREGISTERED_N);
    expect(r.preregisteredN).toBe(120);
    expect(r.detail).toContain('señal piloto, no validación');
  });

  it('does not flag a sample at the pre-registered size', () => {
    const big = cohensKappa({ truePositive: 60, falseNegative: 0, falsePositive: 0, trueNegative: 60 });
    expect(big.n).toBe(120);
    expect(big.tooSmallToConclude).toBe(false);
  });

  it('leaves kappa undefined with no observations', () => {
    const r = cohensKappa({ truePositive: 0, falseNegative: 0, falsePositive: 0, trueNegative: 0 });
    expect(r.n).toBe(0);
    expect(Number.isNaN(r.kappa)).toBe(true);
    expect(r.tooSmallToConclude).toBe(true);
    // An undefined coefficient is its own band, not the weakest one.
    expect(r.band).toBe('undefined');
    expect(r.detail).toContain('Sin observaciones');
  });

  it('leaves kappa undefined when one rater has zero variance', () => {
    const r = cohensKappa({ truePositive: 5, falseNegative: 0, falsePositive: 0, trueNegative: 0 });
    expect(Number.isNaN(r.kappa)).toBe(true);
    expect(r.expectedAgreement).toBe(1);
    expect(r.detail).toContain('Varianza nula');
  });

  it('declares the kappa floor used to reset a judge', () => {
    expect(KAPPA_RESET_THRESHOLD).toBe(0.6);
  });
});

describe('core/metaEval — judge error direction', () => {
  it('a strict judge (FN only) is the safe direction', () => {
    expect(judgeErrorDirection({ truePositive: 0, falseNegative: 1, falsePositive: 0, trueNegative: 0 })).toContain(
      'strict',
    );
  });

  it('a lenient judge (FP only) is the unsafe direction', () => {
    expect(
      judgeErrorDirection({ truePositive: 0, falseNegative: 0, falsePositive: 1, trueNegative: 0 }),
    ).toContain('lenient');
  });

  it('reports no observed errors and mixed errors distinctly', () => {
    expect(
      judgeErrorDirection({ truePositive: 1, falseNegative: 0, falsePositive: 0, trueNegative: 1 }),
    ).toBe('sin errores observados');
    expect(
      judgeErrorDirection({ truePositive: 0, falseNegative: 1, falsePositive: 1, trueNegative: 0 }),
    ).toBe('mixta');
  });
});

describe('core/metaEval — drift monitors', () => {
  it('alerts when the recent approval rate is more than two sigma above the baseline', () => {
    const drift = checkApprovalDrift([0.4, 0.5, 0.6], [0.8]);
    expect(drift.baseline).toBeCloseTo(0.5, 10);
    expect(drift.sigma).toBeCloseTo(0.1, 10);
    expect(drift.zScore).toBeCloseTo(3, 10);
    expect(drift.alert).toBe(true);
  });

  it('stays quiet within two sigma', () => {
    expect(checkApprovalDrift([0.4, 0.5, 0.6], [0.6]).alert).toBe(false);
  });

  it('cannot measure drift without historical variance', () => {
    const drift = checkApprovalDrift([0.5, 0.5, 0.5], [0.9]);
    expect(drift.sigma).toBe(0);
    expect(drift.alert).toBe(false);
    expect(drift.detail).toContain('Sin varianza histórica');
  });

  it('forces recalibration when a blind sentinel is mis-rated', () => {
    expect(checkSelfPreference(3, 3).recalibrationForced).toBe(false);
    const bad = checkSelfPreference(3, 2);
    expect(bad.recalibrationForced).toBe(true);
    expect(bad.detail).toContain('recalibración');
  });

  it('reports self-preference as un-instrumented with no injected sentinels', () => {
    const none = checkSelfPreference(0, 0);
    expect(none.recalibrationForced).toBe(false);
    expect(none.detail).toContain('no está instrumentada');
  });
});

describe('core/metaEval — judge independence (I4)', () => {
  it('is blocking when the judge belongs to a different model family', () => {
    const r = checkJudgeIndependence({
      patchModelFamily: 'family-a',
      judgeModelFamily: 'family-b',
      temperature: 0,
    });
    expect(r.independent).toBe(true);
    expect(r.status).toBe('blocking');
  });

  it('degrades to advisory when the judge is the same family as PATCH', () => {
    const r = checkJudgeIndependence({
      patchModelFamily: 'Family-A',
      judgeModelFamily: 'family-a',
      temperature: 0,
    });
    expect(r.independent).toBe(false);
    expect(r.status).toBe('advisory');
    expect(r.detail).toContain('misma familia');
  });

  it('treats an unnamed family as dependent, never as independent', () => {
    const r = checkJudgeIndependence({ patchModelFamily: 'a', judgeModelFamily: '', temperature: 0 });
    expect(r.independent).toBe(false);
    expect(r.status).toBe('advisory');
  });
});
