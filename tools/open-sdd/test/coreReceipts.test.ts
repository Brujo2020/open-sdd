import { describe, it, expect } from 'vitest';
import {
  makeReceipt,
  recordOverride,
  recalibrate,
  assessI6,
  acceptedRiskLedger,
  OVERRIDE_REVIEW_THRESHOLD,
  type RelaxationReceipt,
} from '../src/core/receipts.js';

const validInput = {
  gate: 'C3',
  targetHash: 'abc123',
  actor: 'maria',
  reason: 'falso positivo confirmado por revisión manual',
  at: '2026-01-01T00:00:00.000Z',
};

describe('core/receipts — relaxation receipts (I6)', () => {
  it('makes a receipt only when actor, reason and target hash are all present', () => {
    const receipt = makeReceipt(validInput);
    expect(receipt).toEqual(validInput);
  });

  it('refuses a relaxation without a reason', () => {
    expect(() => makeReceipt({ ...validInput, reason: '   ' })).toThrow(/motivo/);
  });

  it('refuses a relaxation without an actor', () => {
    expect(() => makeReceipt({ ...validInput, actor: '' })).toThrow(/actor/);
  });

  it('refuses a relaxation without the hash it applies to', () => {
    expect(() => makeReceipt({ ...validInput, targetHash: ' ' })).toThrow(/hash/);
  });

  it('defaults the timestamp when none is supplied', () => {
    const { at, ...rest } = validInput;
    const receipt = makeReceipt(rest);
    expect(Number.isNaN(Date.parse(receipt.at))).toBe(false);
  });

  it('records an override by appending the receipt to the journal', () => {
    const journal: RelaxationReceipt[] = [makeReceipt(validInput)];
    const { state, receipts } = recordOverride(validInput, journal);
    expect(state).toBe('overridden');
    expect(receipts).toHaveLength(2);
    expect(receipts[1]).toEqual(validInput);
    // the original journal is not mutated
    expect(journal).toHaveLength(1);
  });
});

describe('core/receipts — recalibration at the 20% override rate', () => {
  it('exposes 20% as the sustained-review threshold', () => {
    expect(OVERRIDE_REVIEW_THRESHOLD).toBe(0.2);
  });

  it('puts a gate at or above 20% override rate into design-review', () => {
    const [atThreshold] = recalibrate([{ gate: 'C3', overrides: 2, blocks: 10 }]);
    expect(atThreshold.overrideRate).toBeCloseTo(0.2, 10);
    expect(atThreshold.sustained).toBe(true);
    expect(atThreshold.state).toBe('design-review');
    expect(atThreshold.action).toContain('revisión de diseño');
  });

  it('keeps a gate below 20% blocking', () => {
    const [below] = recalibrate([{ gate: 'C2', overrides: 1, blocks: 10 }]);
    expect(below.sustained).toBe(false);
    expect(below.state).toBe('blocked');
    expect(below.action).toContain('sigue bloqueando');
  });

  it('treats a gate with no blocks as a zero rate instead of dividing by zero', () => {
    const [none] = recalibrate([{ gate: 'C1', overrides: 5, blocks: 0 }]);
    expect(none.overrideRate).toBe(0);
    expect(Number.isFinite(none.overrideRate)).toBe(true);
    expect(none.state).toBe('blocked');
  });
});

describe('core/receipts — I6 evidence and accepted-risk ledger', () => {
  it('fails I6 when a relaxation has no receipt', () => {
    const r = assessI6(2, [makeReceipt(validInput)]);
    expect(r.satisfied).toBe(false);
    expect(r.detail).toContain('desactivación silenciosa');
  });

  it('passes I6 when every relaxation is receipted', () => {
    expect(assessI6(1, [makeReceipt(validInput)]).satisfied).toBe(true);
  });

  it('passes I6 vacuously when there were no relaxations', () => {
    const r = assessI6(0, []);
    expect(r.satisfied).toBe(true);
    expect(r.detail).toContain('No hubo relajaciones');
  });

  it('summarises the accepted-risk ledger, including costly outcomes', () => {
    const journal: RelaxationReceipt[] = [
      { ...makeReceipt(validInput), outcome: 'costly' },
      { ...makeReceipt({ ...validInput, gate: 'C2' }), outcome: 'benign' },
      makeReceipt({ ...validInput, gate: 'C1' }),
    ];
    const ledger = acceptedRiskLedger(journal);
    expect(ledger.accepted).toBe(3);
    expect(ledger.withOutcome).toBe(2);
    expect(ledger.costly).toBe(1);
    expect(ledger.entries[2].outcome).toBe('sin resultado posterior registrado');
  });
});
