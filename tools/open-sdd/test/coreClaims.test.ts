import { describe, it, expect } from 'vitest';
import {
  CLAIM_STATUSES,
  evaluateClaim,
  assessClaims,
  auditInventory,
  renderClaimsSummary,
  IMPLEMENTATION_STATUSES,
  type Claim,
  type ClaimStatus,
  type InventoryItem,
} from '../src/core/claims.js';

const claim = (expectation: Claim['expectation'], id = 'A1'): Claim => ({
  id,
  section: '§9.6',
  statementEs: 'afirmación',
  statementEn: 'claim',
  verifier: 'node check.js',
  expectation,
});

describe('core/claims — the five states', () => {
  it('declares exactly five statuses and only one halts publication', () => {
    expect(CLAIM_STATUSES).toHaveLength(5);
    const halting = CLAIM_STATUSES.filter((s) => s.haltsPublication).map((s) => s.status);
    expect(halting).toEqual(['broken']);
    expect(CLAIM_STATUSES.find((s) => s.status === 'broken')?.repairedBy).toBe('code');
    expect(CLAIM_STATUSES.find((s) => s.status === 'outdated-text')?.repairedBy).toBe('text');
  });

  it('a text that claims pass is verified on exit 0 and broken otherwise', () => {
    expect(evaluateClaim(claim('pass'), { claimId: 'A1', exitCode: 0 })).toBe('verified');
    expect(evaluateClaim(claim('pass'), { claimId: 'A1', exitCode: 1 })).toBe('broken');
  });

  it('a declared gap with a non-zero exit code is not-implemented, NEVER broken', () => {
    const status: ClaimStatus = evaluateClaim(claim('fail'), { claimId: 'A1', exitCode: 3 });
    expect(status).toBe('not-implemented');
    expect(status).not.toBe('broken');
  });

  it('a declared gap whose command now passes is outdated-text', () => {
    expect(evaluateClaim(claim('fail'), { claimId: 'A1', exitCode: 0 })).toBe('outdated-text');
  });

  it('a declared absence with a failing command stays not-measured', () => {
    expect(evaluateClaim(claim('absent'), { claimId: 'A1', exitCode: 1 })).toBe('not-measured');
  });

  it('a declared absence whose command now passes is outdated-text', () => {
    expect(evaluateClaim(claim('absent'), { claimId: 'A1', exitCode: 0 })).toBe('outdated-text');
  });

  it('a claim never executed is not-measured', () => {
    expect(evaluateClaim(claim('pass'), undefined)).toBe('not-measured');
    expect(evaluateClaim(claim('fail'), undefined)).toBe('not-measured');
  });
});

describe('core/claims — registry report', () => {
  const claims = [claim('pass', 'A1'), claim('pass', 'A2'), claim('fail', 'A3'), claim('absent', 'A4')];

  it('counts each state and executes only the runs supplied', () => {
    const report = assessClaims(claims, [
      { claimId: 'A1', exitCode: 0 },
      { claimId: 'A2', exitCode: 1 },
      { claimId: 'A3', exitCode: 1 },
    ]);
    expect(report.total).toBe(4);
    expect(report.verified).toBe(1);
    expect(report.broken).toBe(1);
    expect(report.notImplemented).toBe(1);
    expect(report.notMeasured).toBe(1);
    expect(report.outdatedText).toBe(0);
    expect(report.executed).toBe(3);
  });

  it('halts publication only on broken claims', () => {
    const report = assessClaims(claims, [
      { claimId: 'A1', exitCode: 0 },
      { claimId: 'A2', exitCode: 1 },
      { claimId: 'A3', exitCode: 1 },
      { claimId: 'A4', exitCode: 1 },
    ]);
    expect(report.halting.map((c) => c.id)).toEqual(['A2']);
    expect(report.results.map((r) => r.status)).toEqual([
      'verified',
      'broken',
      'not-implemented',
      'not-measured',
    ]);
  });

  it('shows declared gaps and non-measured claims in the summary instead of hiding them', () => {
    const report = assessClaims(claims, []);
    expect(report.notMeasured).toBe(4);
    expect(renderClaimsSummary(report)).toContain('4 no medidas');
  });
});

describe('core/claims — implementation-status inventory (§2.3)', () => {
  const items: InventoryItem[] = [
    { component: 'gate chain', status: 'measured', note: 'measured' },
    { component: 'worktrees', status: 'built', note: 'built' },
    { component: 'risk lab', status: 'proposed', note: 'designed only' },
  ];

  it('groups items by measured / built / proposed', () => {
    const report = auditInventory(items);
    expect(report.measured.map((i) => i.component)).toEqual(['gate chain']);
    expect(report.built.map((i) => i.component)).toEqual(['worktrees']);
    expect(report.proposed.map((i) => i.component)).toEqual(['risk lab']);
    expect(report.detail).toContain('1 medido(s), 1 construido(s), 1 propuesto(s)');
  });

  it('declares that no proposed component participates in today guarantees', () => {
    expect(IMPLEMENTATION_STATUSES.find((s) => s.status === 'proposed')?.participatesInGuarantees).toBe(false);
    expect(IMPLEMENTATION_STATUSES.find((s) => s.status === 'measured')?.participatesInGuarantees).toBe(true);
  });

  it('reports no guarantee leak while proposed items carry no participation claim', () => {
    expect(auditInventory(items).guaranteeLeaks).toEqual([]);
  });
});
