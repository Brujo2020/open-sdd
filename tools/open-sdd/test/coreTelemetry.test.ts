import { describe, it, expect } from 'vitest';
import {
  GOVERNANCE_TOKEN_CEILING,
  CONTEXT_COMPACTION_TRIGGER,
  evaluateGovernanceBudget,
  evaluateCompaction,
  routeModel,
  escalateTier,
  compareLoopEconomy,
  COMPLEXITY_TIERS,
} from '../src/core/telemetry.js';

describe('core/telemetry — governance overhead budget (30% ceiling)', () => {
  it('declares the 30% ceiling', () => {
    expect(GOVERNANCE_TOKEN_CEILING).toBe(0.3);
  });

  it('passes exactly at the ceiling', () => {
    const verdict = evaluateGovernanceBudget(1000, 100, 100, 100);
    expect(verdict.withinBudget).toBe(true);
    expect(verdict.pct).toBeCloseTo(0.3, 10);
  });

  it('fails above the ceiling and degrades the expensive verification first', () => {
    const verdict = evaluateGovernanceBudget(1000, 150, 100, 51);
    expect(verdict.withinBudget).toBe(false);
    if (!verdict.withinBudget) {
      expect(verdict.action).toBe('sample-judge');
      expect(verdict.detail).toContain('CARA');
    }
  });

  it('treats a zero-token cycle as a zero governance share', () => {
    const verdict = evaluateGovernanceBudget(0, 10, 10, 10);
    expect(verdict.withinBudget).toBe(true);
    expect(verdict.pct).toBe(0);
  });

  it('accepts an installation-specific ceiling', () => {
    expect(evaluateGovernanceBudget(100, 20, 0, 0, 0.1).withinBudget).toBe(false);
    expect(evaluateGovernanceBudget(100, 20, 0, 0, 0.5).withinBudget).toBe(true);
  });
});

describe('core/telemetry — context compaction at 70% occupancy', () => {
  it('declares the 70% trigger', () => {
    expect(CONTEXT_COMPACTION_TRIGGER).toBe(0.7);
  });

  it('does not compact below the trigger', () => {
    const decision = evaluateCompaction(0.69);
    expect(decision.compact).toBe(false);
    expect(decision.steps).toEqual([]);
  });

  it('compacts at the trigger and forces a commit before resetting memory', () => {
    const decision = evaluateCompaction(0.7);
    expect(decision.compact).toBe(true);
    expect(decision.steps).toHaveLength(4);
    expect(decision.steps).toContain('Forzar un commit.');
  });
});

describe('core/telemetry — complexity routing and escalation (B.6)', () => {
  const candidates = [
    { model: 'cheap', historicalSuccessRate: 0.85, costPerMTok: 1 },
    { model: 'pricey', historicalSuccessRate: 0.95, costPerMTok: 5 },
    { model: 'weak', historicalSuccessRate: 0.5, costPerMTok: 0.1 },
  ];

  it('uses the cheapest model that clears the tier correctness bar', () => {
    const decision = routeModel('T1', candidates);
    expect(decision.tier).toBe('T1');
    expect(decision.chosenModel).toBe('cheap');
  });

  it('escalates to a human instead of faking a route when no model is viable', () => {
    const decision = routeModel('T3', [candidates[0], candidates[2]]);
    expect(decision.chosenModel).toBe('ninguno');
    expect(decision.detail).toContain('humano');
  });

  it('exposes the four complexity tiers with increasing bars', () => {
    expect(COMPLEXITY_TIERS.map((t) => t.tier)).toEqual(['T0', 'T1', 'T2', 'T3']);
    expect(COMPLEXITY_TIERS[3].correctnessBar).toBeGreaterThan(COMPLEXITY_TIERS[0].correctnessBar);
  });

  it('retries one tier up with the full failure in context', () => {
    const retry = escalateTier('T0', 1);
    expect(retry.nextTier).toBe('T1');
    expect(retry.detail).toContain('nunca a ciegas');
  });

  it('escalates to a human at the top tier or after the strike limit', () => {
    expect(escalateTier('T3', 1).nextTier).toBe('human');
    expect(escalateTier('T1', 3).nextTier).toBe('human');
    expect(escalateTier('T0', 2, 2).nextTier).toBe('human');
  });
});

describe('core/telemetry — harness ON/OFF loop economy', () => {
  it('reports the deltas for the same tickets', () => {
    const comparison = compareLoopEconomy(
      { tokensPerTask: 120, iterationsToGreen: 2, humanEscalations: 1, verificationLatencySeconds: 10 },
      { tokensPerTask: 100, iterationsToGreen: 1, humanEscalations: 0, verificationLatencySeconds: 4 },
    );
    expect(comparison.tokenDeltaPct).toBeCloseTo(0.2, 10);
    expect(comparison.iterationDelta).toBe(1);
    expect(comparison.escalationDelta).toBe(1);
    expect(comparison.latencyDeltaSeconds).toBe(6);
  });

  it('does not divide by zero when the OFF arm used no tokens', () => {
    const comparison = compareLoopEconomy(
      { tokensPerTask: 10, iterationsToGreen: 0, humanEscalations: 0, verificationLatencySeconds: 0 },
      { tokensPerTask: 0, iterationsToGreen: 0, humanEscalations: 0, verificationLatencySeconds: 0 },
    );
    expect(comparison.tokenDeltaPct).toBe(0);
  });
});
