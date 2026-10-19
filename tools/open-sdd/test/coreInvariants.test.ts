import { describe, it, expect } from 'vitest';
import {
  INVARIANTS,
  CONFORMITY_LEVELS,
  getInvariant,
  assessConformity,
  invariantsNotEvidenced,
  type InvariantEvidence,
  type InvariantId,
} from '../src/core/invariants.js';

const evidenceFor = (ids: InvariantId[], unsatisfied: InvariantId[] = []): InvariantEvidence[] =>
  ids.map((id) => ({
    id,
    satisfied: !unsatisfied.includes(id),
    detail: `${id} ${unsatisfied.includes(id) ? 'no' : 'sí'} evidenciada`,
  }));

const ALL: InvariantId[] = ['I1', 'I2', 'I3', 'I4', 'I5', 'I6'];

describe('core/invariants — Table 17', () => {
  it('declares I1-I6 with a statement, a prevented failure and an inspection', () => {
    expect(INVARIANTS.map((i) => i.id)).toEqual(ALL);
    for (const invariant of INVARIANTS) {
      expect(invariant.statement.length).toBeGreaterThan(0);
      expect(invariant.prevents.length).toBeGreaterThan(0);
      expect(invariant.inspection.length).toBeGreaterThan(0);
    }
    expect(getInvariant('I6')?.statement).toContain('relajación');
  });

  it('has no unspecified invariant id', () => {
    expect(getInvariant('I9' as InvariantId)).toBeUndefined();
  });
});

describe('core/invariants — conformity assessment (Table 18)', () => {
  it('C0 is declarative and imposes nothing', () => {
    const a = assessConformity([]);
    expect(a.level).toBe('C0');
    expect(a.name).toBe('Declarativo');
    expect(a.calibrated).toBe(false);
    expect(a.nextLevelRequires?.level).toBe('C1');
  });

  it('C1 requires ground: I1, I2 and I3', () => {
    const a = assessConformity(evidenceFor(['I1', 'I2', 'I3']));
    expect(a.level).toBe('C1');
    expect(a.nextLevelRequires?.level).toBe('C2');
  });

  it('does not reach C1 when one of the floor invariants is missing', () => {
    const a = assessConformity(evidenceFor(['I1', 'I2']));
    expect(a.level).toBe('C0');
    expect(invariantsNotEvidenced(a)).toEqual([]);
  });

  it('C2 adds mediation and relaxation records: I4 and I6', () => {
    const a = assessConformity(evidenceFor(['I1', 'I2', 'I3', 'I4', 'I6']));
    expect(a.level).toBe('C2');
    expect(a.nextLevelRequires?.level).toBe('C3');
  });

  it('C3 requires all six invariants but is only calibrated with a measured false-positive rate', () => {
    const declared = assessConformity(evidenceFor(ALL));
    expect(declared.level).toBe('C3');
    expect(declared.calibrated).toBe(false);
    expect(declared.nextLevelRequires).toBeNull();

    const measured = assessConformity(evidenceFor(ALL), 0.1);
    expect(measured.level).toBe('C3');
    expect(measured.calibrated).toBe(true);
  });

  it('lists unsatisfied invariants from the supplied evidence', () => {
    const a = assessConformity(evidenceFor(ALL, ['I5', 'I6']));
    expect(invariantsNotEvidenced(a)).toEqual(['I5', 'I6']);
  });

  it('the four conformity levels are cumulative', () => {
    expect(CONFORMITY_LEVELS.map((c) => c.level)).toEqual(['C0', 'C1', 'C2', 'C3']);
    expect(CONFORMITY_LEVELS[3].requires).toEqual(ALL);
  });
});
