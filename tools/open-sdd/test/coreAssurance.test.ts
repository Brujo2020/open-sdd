import { describe, it, expect } from 'vitest';
import {
  OWASP_AGENTIC_MAP,
  REGULATORY_MAP,
  RISK_LAB_BANKS,
  REFUTATION_THRESHOLDS,
  LAB_ARTIFACT_FIELDS,
  REGULATORY_CONTEXT,
  ZERO_TRUST_BOUNDARY,
} from '../src/core/assurance.js';
import { LOGICAL_GATES } from '../src/core/gateCatalog.js';

describe('core/assurance — OWASP Agentic Top 10 map (Table 24)', () => {
  it('maps all ten risks to gates and complementary controls', () => {
    expect(OWASP_AGENTIC_MAP).toHaveLength(10);
    for (const row of OWASP_AGENTIC_MAP) {
      expect(row.risk.length).toBeGreaterThan(0);
      expect(row.complementaryControl.length).toBeGreaterThan(0);
    }
  });

  it('only cites logical gates that exist in the catalog', () => {
    const known = new Set(LOGICAL_GATES.map((g) => g.id));
    for (const row of OWASP_AGENTIC_MAP) {
      for (const gate of row.primaryGates) expect(known.has(gate)).toBe(true);
    }
  });

  it('keeps ATLAS ids when known and null when unmapped', () => {
    expect(OWASP_AGENTIC_MAP.find((r) => r.risk.startsWith('Inyección'))?.atlas).toBe('AML.T0051');
    expect(OWASP_AGENTIC_MAP.find((r) => r.risk.startsWith('Agencia excesiva'))?.atlas).toBeNull();
  });
});

describe('core/assurance — regulatory crosswalk (Table 39)', () => {
  it('maps each control to EU AI Act, NIST AI RMF and ISO 42001', () => {
    expect(REGULATORY_MAP.length).toBeGreaterThan(0);
    for (const row of REGULATORY_MAP) {
      expect(row.control.length).toBeGreaterThan(0);
      expect(row.euAiAct).toMatch(/Art\./);
      expect(row.nistAiRmf.length).toBeGreaterThan(0);
      expect(row.iso42001).toMatch(/A\./);
    }
    expect(REGULATORY_CONTEXT).toContain('2026');
  });
});

describe('core/assurance — risk-lab protocol (§14.3)', () => {
  it('declares five runnable banks with a purpose, an artifact and a standard', () => {
    expect(RISK_LAB_BANKS).toHaveLength(5);
    expect(RISK_LAB_BANKS.map((b) => b.id)).toEqual([
      'bank-1',
      'bank-2',
      'bank-3',
      'bank-4',
      'bank-5',
    ]);
    for (const bank of RISK_LAB_BANKS) {
      expect(bank.status).toBe('runnable');
      expect(bank.artifact.length).toBeGreaterThan(0);
      expect(bank.mapsTo.length).toBeGreaterThan(0);
    }
  });

  it('fixes the four artifact fields that make lab numbers comparable', () => {
    expect(LAB_ARTIFACT_FIELDS).toHaveLength(4);
    expect(LAB_ARTIFACT_FIELDS).toContain('hash de configuración');
  });

  it('publishes pre-registered refutation thresholds with a bench', () => {
    expect(REFUTATION_THRESHOLDS.length).toBeGreaterThanOrEqual(5);
    for (const threshold of REFUTATION_THRESHOLDS) {
      expect(threshold.refutedIf.length).toBeGreaterThan(0);
      expect(threshold.bench.match(/^bank-\d$/)).toBeTruthy();
    }
    const kappa = REFUTATION_THRESHOLDS.find((t) => t.id === 'meta-eval-kappa');
    expect(kappa?.status).toBe('preregistered');
    expect(kappa?.refutedIf).toContain('n ≥ 120');
  });

  it('keeps the measured C4 false-positive rate visible', () => {
    const c4 = REFUTATION_THRESHOLDS.find((t) => t.id === 'c4-fpr');
    expect(c4?.status).toBe('measured');
    expect(c4?.measured).toContain('20,0%');
  });

  it('states the Zero-Trust borrowing boundary instead of overclaiming', () => {
    expect(ZERO_TRUST_BOUNDARY.notClaimed.length).toBeGreaterThan(0);
    expect(ZERO_TRUST_BOUNDARY.notClaimed.join(' ')).toContain('microsegmentación');
  });
});
