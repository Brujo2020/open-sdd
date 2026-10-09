import { describe, it, expect } from 'vitest';
import { buildFeature, earsToScenario } from '../src/core/gherkin.js';
import { parseRequirements } from '../src/core/requirementsCoach.js';

const scenario = (text: string) => {
  const r = earsToScenario('REQ-X-001', text);
  if ('skip' in r) throw new Error(r.skip);
  return r.scenario;
};

describe('earsToScenario (REQ-SSP-001)', () => {
  it('maps the ubiquitous pattern to a Then that keeps subject and shall', () => {
    const s = scenario('The gateway shall expose a health endpoint.');
    expect(s).toMatchObject({ pattern: 'ubiquitous', given: [], when: [], then: 'The gateway shall expose a health endpoint' });
  });

  it('maps event-driven to When', () => {
    const s = scenario('WHEN the payment service returns 5xx, the gateway shall increment the failure counter.');
    expect(s).toMatchObject({ pattern: 'event-driven', given: [], when: ['the payment service returns 5xx'], then: 'the gateway shall increment the failure counter' });
  });

  it('maps state-driven and optional to Given', () => {
    expect(scenario('While the circuit is open, the gateway shall return 503.')).toMatchObject({ pattern: 'state-driven', given: ['the circuit is open'], when: [] });
    expect(scenario('Where the client supplies a request ID, the gateway shall propagate it.')).toMatchObject({ pattern: 'optional', given: ['the client supplies a request ID'] });
  });

  it('maps unwanted to When and drops the THEN keyword from the response', () => {
    const s = scenario('If the probe fails, then the gateway shall reopen the circuit.');
    expect(s).toMatchObject({ pattern: 'unwanted', when: ['the probe fails'], then: 'the gateway shall reopen the circuit' });
  });

  it('maps WHILE s, WHEN x to complex Given + When', () => {
    const s = scenario('While the circuit is open, when a request arrives, the gateway shall return 503.');
    expect(s).toMatchObject({ pattern: 'complex', given: ['the circuit is open'], when: ['a request arrives'], then: 'the gateway shall return 503' });
  });

  it('keeps a quoted shall and an inner comma inside the condition', () => {
    expect(scenario('If a line contains neither `shall` nor `debe`, then the converter shall omit it.')).toMatchObject({
      pattern: 'unwanted',
      when: ['a line contains neither `shall` nor `debe`'],
      then: 'the converter shall omit it',
    });
    expect(scenario('When a, b or c happens, the system shall log it, with the id.')).toMatchObject({
      when: ['a, b or c happens'],
      then: 'the system shall log it, with the id',
    });
  });

  it('recognises Spanish EARS', () => {
    expect(scenario('Cuando el pago falla, el sistema debe registrar el error.')).toMatchObject({ pattern: 'event-driven', when: ['el pago falla'], then: 'el sistema debe registrar el error' });
    expect(scenario('Si el token caduca, entonces el sistema debe rechazar la petición.')).toMatchObject({ pattern: 'unwanted', then: 'el sistema debe rechazar la petición' });
  });
});

describe('skips, never invents (REQ-SSP-002)', () => {
  it('skips a statement without a normative verb', () => {
    expect(earsToScenario('REQ-X-001', 'The gateway is fast.')).toEqual({ skip: expect.stringContaining('no normative verb') });
  });
  it('skips a trigger with no comma before the response', () => {
    expect(earsToScenario('REQ-X-001', 'When x the gateway shall y')).toEqual({ skip: expect.stringContaining('comma') });
  });
});

const REQS = `# Requirements

## Requirements

### REQ-GW-001: Health
1. The gateway shall expose a health endpoint.
2. The gateway is pleasant.

### REQ-GW-002: Failures
1. When the upstream returns 5xx, the gateway shall increment the failure counter.
`;

describe('buildFeature (REQ-SSP-001, 003)', () => {
  it('tags each scenario with id and pattern and lists skips', () => {
    const f = buildFeature({ feature: 'gw', requirements: parseRequirements('requirements.md', REQS) });
    expect(f.scenarios.map((s) => s.requirementId)).toEqual(['REQ-GW-001', 'REQ-GW-002']);
    expect(f.skipped).toHaveLength(1);
    expect(f.skipped[0].requirementId).toBe('REQ-GW-001');
    expect(f.text).toContain('  @REQ-GW-002 @event-driven\n  Scenario: REQ-GW-002 Failures (1)\n    Given the system is running\n    When the upstream returns 5xx\n    Then the gateway shall increment the failure counter\n');
    expect(f.text.startsWith('Feature: gw\n')).toBe(true);
  });

  it('writes Spanish keywords when the spec language is es', () => {
    const f = buildFeature({ feature: 'gw', requirements: parseRequirements('requirements.md', REQS), language: 'es' });
    expect(f.text.startsWith('# language: es\nCaracterística: gw\n')).toBe(true);
    expect(f.text).toContain('Escenario: REQ-GW-002');
    expect(f.text).toContain('Dado que el sistema está en funcionamiento');
    expect(f.text).toContain('    Cuando the upstream returns 5xx');
    expect(f.text).toContain('    Entonces the gateway shall');
  });

  it('is deterministic', () => {
    const a = buildFeature({ feature: 'gw', requirements: parseRequirements('requirements.md', REQS) }).text;
    const b = buildFeature({ feature: 'gw', requirements: parseRequirements('requirements.md', REQS) }).text;
    expect(a).toBe(b);
  });
});
