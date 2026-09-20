import { describe, it, expect } from 'vitest';
import {
  TRIAD,
  evaluateTriad,
  checkEvidenceLock,
  checkDecidableDiscipline,
  EVIDENCE_MARKER,
} from '../src/core/triad.js';

describe('core/triad — Documentary Triad presence', () => {
  it('accepts the canonical requirements.md / plan.md / tasks.md', () => {
    const v = evaluateTriad(['requirements.md', 'plan.md', 'tasks.md']);
    expect(v.complete).toBe(true);
    expect(v.missing).toEqual([]);
    expect(v.files.map((f) => f.presentAs)).toEqual(['requirements.md', 'plan.md', 'tasks.md']);
  });

  it('accepts design.md as the DECLARED alias of plan.md', () => {
    const v = evaluateTriad(['requirements.md', 'design.md', 'tasks.md']);
    expect(v.complete).toBe(true);
    expect(v.files.find((f) => f.canonical === 'plan.md')?.presentAs).toBe('design.md');
  });

  it('reports the missing documents without guessing content quality', () => {
    const v = evaluateTriad(['requirements.md']);
    expect(v.complete).toBe(false);
    expect(v.missing).toEqual(['plan.md', 'tasks.md']);
    expect(v.approvalIsByProxy).toBe(true);
  });

  it('matches file names case-insensitively', () => {
    expect(evaluateTriad(['Requirements.md', 'Plan.md', 'Tasks.md']).complete).toBe(true);
  });

  it('declares the alias in the catalog instead of inferring it', () => {
    expect(TRIAD.find((f) => f.canonical === 'plan.md')?.aliases).toEqual(['design.md']);
  });
});

describe('core/triad — evidence lock (I2)', () => {
  it('rejects a completed task without an _Evidence: line', () => {
    const r = checkEvidenceLock('- [x] 1.1 implement the parser\n');
    expect(r.satisfied).toBe(false);
    expect(r.checked).toBe(1);
    expect(r.unprovenCompletions).toHaveLength(1);
    expect(r.unprovenCompletions[0].taskId).toBe('1.1');
    expect(r.detail).toContain(EVIDENCE_MARKER);
  });

  it('accepts a completed task carrying _Evidence: on the same line', () => {
    const r = checkEvidenceLock('- [x] 1.1 implement the parser — _Evidence: npm test (14 passed)\n');
    expect(r.satisfied).toBe(true);
    expect(r.unprovenCompletions).toEqual([]);
    expect(r.detail).toContain('1 tarea(s) completadas con evidencia');
  });

  it('accepts a completed task carrying _Evidence: on a following indented line', () => {
    const md = ['- [x] 1.1 implement the parser', '  _Evidence: npx vitest run → 3 passed'].join('\n');
    const r = checkEvidenceLock(md);
    expect(r.satisfied).toBe(true);
    expect(r.checked).toBe(1);
  });

  it('does not require evidence from pending tasks', () => {
    const md = ['- [x] 1.1 done — _Evidence: output', '- [ ] 1.2 not started'].join('\n');
    const r = checkEvidenceLock(md);
    expect(r.satisfied).toBe(true);
    expect(r.checked).toBe(1);
  });

  it('reports every unproven completion in a mixed document', () => {
    const md = [
      '- [x] 1.1 done with proof — _Evidence: output',
      '- [x] 1.2 done without proof',
      '- [x] 1.3 also without proof',
      '- [ ] 1.4 pending',
    ].join('\n');
    const r = checkEvidenceLock(md);
    expect(r.satisfied).toBe(false);
    expect(r.checked).toBe(3);
    expect(r.unprovenCompletions.map((u) => u.taskId)).toEqual(['1.2', '1.3']);
  });

  it('is satisfied by an empty document (nothing claimed complete)', () => {
    expect(checkEvidenceLock('').satisfied).toBe(true);
  });
});

describe('core/triad — decidable discipline properties', () => {
  it('flags a diff over the declared budget', () => {
    const findings = checkDecidableDiscipline(
      { changedFiles: ['src/a.ts'], addedLines: 40, removedLines: 20, declaredScope: ['src'] },
      { maxLines: 50, maxFiles: 10 },
    );
    const budget = findings.find((f) => f.property === 'diff-budget');
    expect(budget?.decidable).toBe(true);
    expect(budget?.violated).toBe(true);
  });

  it('accepts a diff inside the scope and the budget', () => {
    const findings = checkDecidableDiscipline(
      { changedFiles: ['src/core/a.ts'], addedLines: 5, removedLines: 1, declaredScope: ['src/core'] },
      { maxLines: 50, maxFiles: 10 },
    );
    expect(findings.find((f) => f.property === 'diff-budget')?.violated).toBe(false);
    expect(findings.find((f) => f.property === 'scope-containment')?.violated).toBe(false);
  });

  it('flags files outside the declared DAG-node scope', () => {
    const findings = checkDecidableDiscipline(
      {
        changedFiles: ['src/core/a.ts', 'README.md'],
        addedLines: 1,
        removedLines: 0,
        declaredScope: ['./src/core/'],
      },
      { maxLines: 50, maxFiles: 10 },
    );
    const scope = findings.find((f) => f.property === 'scope-containment');
    expect(scope?.violated).toBe(true);
    expect(scope?.detail).toContain('README.md');
  });

  it('reports declared-uncertainty as not measurable from a diff alone', () => {
    // It needs the assumption register, which this call does not receive. Reporting `ok` for a
    // property nobody inspected is activation without measurement — the vacuity the paper rejects.
    const findings = checkDecidableDiscipline(
      { changedFiles: [], addedLines: 0, removedLines: 0, declaredScope: [] },
      { maxLines: 1, maxFiles: 1 },
    );
    const uncertainty = findings.find((f) => f.property === 'declared-uncertainty');
    expect(uncertainty?.decidable).toBe(false);
    expect(uncertainty?.violated).toBe(false);
    expect(uncertainty?.detail).toContain('No medible desde el diff');
  });
});
