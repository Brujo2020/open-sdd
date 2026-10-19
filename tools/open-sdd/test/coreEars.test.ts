import { describe, it, expect } from 'vitest';
import {
  validateEarsRequirement,
  validateRequirements,
  negativeRequirementGap,
  EARS_TEMPLATES,
} from '../src/core/ears.js';

describe('core/ears — the five templates', () => {
  it('declares exactly five patterns', () => {
    expect(EARS_TEMPLATES).toHaveLength(5);
    expect(EARS_TEMPLATES.map((t) => t.pattern)).toEqual([
      'ubiquitous',
      'event-driven',
      'state-driven',
      'optional',
      'unwanted',
    ]);
  });

  it('accepts the ubiquitous template (no trigger keyword)', () => {
    const v = validateEarsRequirement('The gateway shall expose a health endpoint returning HTTP 200.');
    expect(v.conforms).toBe(true);
    expect(v.pattern).toBe('ubiquitous');
    expect(v.issues).toEqual([]);
  });

  it('accepts WHEN (event-driven)', () => {
    const v = validateEarsRequirement(
      'WHEN the payment service returns 5xx, the gateway shall increment the failure counter.',
    );
    expect(v.conforms).toBe(true);
    expect(v.pattern).toBe('event-driven');
  });

  it('accepts WHILE (state-driven)', () => {
    const v = validateEarsRequirement(
      'WHILE the circuit is open, the gateway shall return 503 without forwarding.',
    );
    expect(v.conforms).toBe(true);
    expect(v.pattern).toBe('state-driven');
  });

  it('accepts WHERE (optional feature)', () => {
    const v = validateEarsRequirement(
      'WHERE the client supplies a request ID, the gateway shall propagate it downstream.',
    );
    expect(v.conforms).toBe(true);
    expect(v.pattern).toBe('optional');
  });

  it('accepts IF...THEN (unwanted behaviour)', () => {
    const v = validateEarsRequirement(
      'IF the half-open probe fails, THEN the gateway shall reopen the circuit and reset the timer.',
    );
    expect(v.conforms).toBe(true);
    expect(v.pattern).toBe('unwanted');
  });

  it('is case-insensitive about the fixed keywords', () => {
    const v = validateEarsRequirement('when the job finishes, the worker shall emit a metric.');
    expect(v.pattern).toBe('event-driven');
    expect(v.conforms).toBe(true);
  });
});

describe('core/ears — rejected requirements', () => {
  it('rejects a requirement without the mandatory "shall"', () => {
    const v = validateEarsRequirement('The system must expose a health endpoint.');
    expect(v.conforms).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain('NO_SHALL');
  });

  it('rejects an IF pattern without THEN', () => {
    const v = validateEarsRequirement('IF the probe fails, the gateway shall reopen the circuit.');
    expect(v.conforms).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain('MISSING_THEN');
  });

  it('rejects a compound requirement carrying more than one "shall"', () => {
    const v = validateEarsRequirement('The gateway shall log the failure and shall retry once.');
    expect(v.conforms).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain('COMPOUND_REQUIREMENT');
    expect(v.issues.find((i) => i.code === 'COMPOUND_REQUIREMENT')?.message).toContain('2');
  });

  it('rejects vague terms that make a requirement unfalsifiable', () => {
    const v = validateEarsRequirement('The system shall retry as needed.');
    expect(v.conforms).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain('VAGUE_TERM');
  });

  it('does not flag "etc" appearing inside an ordinary word', () => {
    // Whole-token matching: "fetch" must not be read as the vague term "etc".
    const v = validateEarsRequirement('The gateway shall fetch data.');
    expect(v.issues.map((i) => i.code)).not.toContain('VAGUE_TERM');
    expect(v.conforms).toBe(true);
  });

  it('rejects two trigger keywords in the same trigger clause', () => {
    const v = validateEarsRequirement(
      'WHEN the cron fires, WHILE the lock is held, the worker shall skip the run.',
    );
    expect(v.issues.map((i) => i.code)).toContain('MULTIPLE_TEMPLATES');
  });

  it('does not treat a trigger keyword inside the response as a second pattern', () => {
    const v = validateEarsRequirement(
      'WHEN the cron fires, the worker shall skip the run while the lock is held.',
    );
    expect(v.pattern).toBe('event-driven');
    expect(v.issues.map((i) => i.code)).not.toContain('MULTIPLE_TEMPLATES');
  });

  it('rejects an empty response after "shall"', () => {
    const v = validateEarsRequirement('The gateway shall.');
    expect(v.issues.map((i) => i.code)).toContain('EMPTY_RESPONSE');
  });

  it('trims the stored text', () => {
    expect(validateEarsRequirement('   The gateway shall respond.  ').text).toBe(
      'The gateway shall respond.',
    );
  });
});

describe('core/ears — document report and negative-requirement gap', () => {
  const texts = [
    'The gateway shall expose a health endpoint.',
    'WHEN the payment service returns 5xx, the gateway shall increment the failure counter.',
    'WHILE the circuit is open, the gateway shall return 503.',
    'WHERE the client supplies a request ID, the gateway shall propagate it downstream.',
  ];

  it('counts conforming requirements and used patterns', () => {
    const report = validateRequirements(texts);
    expect(report.total).toBe(4);
    expect(report.conforming).toBe(4);
    expect(report.byPattern).toEqual({
      ubiquitous: 1,
      'event-driven': 1,
      'state-driven': 1,
      optional: 1,
      unwanted: 0,
    });
    expect(report.uncoveredPatterns).toEqual(['unwanted']);
  });

  it('reports the missing IF...THEN pattern as the negative-requirement gap', () => {
    expect(negativeRequirementGap(validateRequirements(texts))).toContain('IF...THEN');
  });

  it('reports no gap once an unwanted-behaviour requirement exists', () => {
    const withUnwanted = [
      ...texts,
      'IF the probe fails, THEN the gateway shall reopen the circuit.',
    ];
    expect(negativeRequirementGap(validateRequirements(withUnwanted))).toBeNull();
  });

  it('counts non-conforming requirements in the report', () => {
    const report = validateRequirements([...texts, 'The system must be robust.']);
    expect(report.conforming).toBe(4);
    expect(report.verdicts[4].conforms).toBe(false);
  });
});
