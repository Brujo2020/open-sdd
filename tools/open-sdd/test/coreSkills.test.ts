import { describe, it, expect } from 'vitest';
import {
  SKILL_CLASSES,
  checkMcpPermissions,
  checkBidirectionalPermissions,
  evaluateCandidate,
  evaluateCandidateExpiry,
  type McpConcession,
  type SkillCandidate,
} from '../src/core/skills.js';

const NOW = new Date('2026-06-01T00:00:00.000Z');

const concession = (over: Partial<McpConcession> = {}): McpConcession => ({
  skill: 'db-migrations',
  server: 'postgres-prod',
  actor: 'maria',
  reason: 'la skill necesita leer el esquema',
  grantedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('core/skills — hard rule: no skill widens reachable MCP servers', () => {
  it('rejects a skill declaring an MCP server with no concession and lists it as undeclared', () => {
    const check = checkMcpPermissions(
      [{ skill: 'db-migrations', servers: ['postgres-prod'] }],
      [],
      NOW,
    );
    expect(check.ok).toBe(false);
    expect(check.undeclared).toEqual([{ skill: 'db-migrations', server: 'postgres-prod' }]);
    expect(check.expired).toEqual([]);
    expect(check.detail).toContain('no válida');
  });

  it('accepts a declared server covered by a complete, live concession', () => {
    const check = checkMcpPermissions(
      [{ skill: 'db-migrations', servers: ['postgres-prod'] }],
      [concession()],
      NOW,
    );
    expect(check.ok).toBe(true);
    expect(check.undeclared).toEqual([]);
    expect(check.expired).toEqual([]);
  });

  it('does not count a concession with an empty actor', () => {
    const check = checkMcpPermissions(
      [{ skill: 'db-migrations', servers: ['postgres-prod'] }],
      [concession({ actor: '   ' })],
      NOW,
    );
    expect(check.ok).toBe(false);
    expect(check.undeclared).toEqual([]);
    // An invalid grant is not a timing problem: it is reported on its own.
    expect(check.invalid).toEqual([
      { skill: 'db-migrations', server: 'postgres-prod', why: 'sin actor humano nombrado' },
    ]);
    expect(check.expired).toEqual([]);
  });

  it('does not count a concession with an empty reason', () => {
    const check = checkMcpPermissions(
      [{ skill: 'db-migrations', servers: ['postgres-prod'] }],
      [concession({ reason: '' })],
      NOW,
    );
    expect(check.ok).toBe(false);
    expect(check.invalid).toEqual([
      { skill: 'db-migrations', server: 'postgres-prod', why: 'sin motivo registrado' },
    ]);
    expect(check.expired).toEqual([]);
  });

  it('does not count an expired concession', () => {
    const check = checkMcpPermissions(
      [{ skill: 'db-migrations', servers: ['postgres-prod'] }],
      [concession({ expiresAt: '2026-05-31T23:59:59.000Z' })],
      NOW,
    );
    expect(check.ok).toBe(false);
    expect(check.expired).toEqual([{ skill: 'db-migrations', server: 'postgres-prod' }]);
  });

  it('accepts a concession expiring exactly at the check instant (strictly before is expired)', () => {
    const check = checkMcpPermissions(
      [{ skill: 'db-migrations', servers: ['postgres-prod'] }],
      [concession({ expiresAt: NOW.toISOString() })],
      NOW,
    );
    expect(check.ok).toBe(true);
  });

  it('reports undeclared and expired servers separately across several skills', () => {
    const check = checkMcpPermissions(
      [
        { skill: 'a', servers: ['s1'] },
        { skill: 'b', servers: ['s2'] },
      ],
      [concession({ skill: 'b', server: 's2', actor: '' })],
      NOW,
    );
    expect(check.undeclared).toEqual([{ skill: 'a', server: 's1' }]);
    expect(check.invalid).toEqual([
      { skill: 'b', server: 's2', why: 'sin actor humano nombrado' },
    ]);
    expect(check.expired).toEqual([]);
    expect(check.ok).toBe(false);
  });
});

describe('core/skills — bidirectional permission graph', () => {
  it('is consistent when the agent and server lists agree', () => {
    const r = checkBidirectionalPermissions(
      [{ agent: 'patch', servers: ['graph'] }],
      [{ server: 'graph', agents: ['patch'] }],
    );
    expect(r.consistent).toBe(true);
    expect(r.discrepancies).toEqual([]);
  });

  it('flags an agent invoking a server that does not declare it', () => {
    const r = checkBidirectionalPermissions(
      [{ agent: 'patch', servers: ['graph'] }],
      [{ server: 'graph', agents: [] }],
    );
    expect(r.consistent).toBe(false);
    expect(r.discrepancies.join(' ')).toContain('no autoriza');
  });

  it('flags a server authorizing an agent that does not declare it', () => {
    const r = checkBidirectionalPermissions([], [{ server: 'graph', agents: ['patch'] }]);
    expect(r.consistent).toBe(false);
    expect(r.discrepancies.join(' ')).toContain('no lo declara alcanzable');
  });

  it('flags an agent invoking an unknown server', () => {
    const r = checkBidirectionalPermissions([{ agent: 'patch', servers: ['ghost'] }], []);
    expect(r.consistent).toBe(false);
    expect(r.discrepancies.join(' ')).toContain('no declara a nadie');
  });
});

describe('core/skills — Auto-Skill Factory candidate gate', () => {
  const base: SkillCandidate = {
    id: 'cand-1',
    pattern: 'missing evidence line on completed task',
    observations: 3,
    klass: 'procedimental',
    declaresMcpServers: [],
    provenance: { blocks: ['C3'], humanCorrections: ['fix tasks.md'], files: ['test/a.ts'] },
    generatedBy: 'patch-agent',
    evaluatedBy: 'judge-agent',
    generatingModelFamily: 'family-a',
    evaluatingModelFamily: 'family-b',
    reviewDate: '2026-12-01T00:00:00.000Z',
    activationCycles: 0,
  };

  it('mounts a valid candidate at level 1, which grants no privilege', () => {
    const verdict = evaluateCandidate(base);
    expect(verdict.mountable).toBe(true);
    expect(verdict.level).toBe(1);
    expect(verdict.reasons.join(' ')).toContain('ningún privilegio');
  });

  it('never lets a generated candidate declare MCP servers', () => {
    const verdict = evaluateCandidate({ ...base, declaresMcpServers: ['postgres-prod'] });
    expect(verdict.mountable).toBe(false);
    expect(verdict.level).toBe(0);
    expect(verdict.reasons.join(' ')).toContain('MCP');
  });

  it('requires a judge different from the author and of a different model family', () => {
    expect(evaluateCandidate({ ...base, evaluatedBy: base.generatedBy }).reasons.join(' ')).toContain('I4');
    expect(
      evaluateCandidate({ ...base, evaluatingModelFamily: 'FAMILY-A' }).reasons.join(' '),
    ).toContain('Heterogeneidad');
  });

  it('requires at least two observations and a review date and an originating pattern', () => {
    expect(evaluateCandidate({ ...base, observations: 1 }).reasons.join(' ')).toContain('una sola vez');
    expect(evaluateCandidate({ ...base, reviewDate: '' }).reasons.join(' ')).toContain('fecha de revisión');
    expect(
      evaluateCandidate({ ...base, provenance: { ...base.provenance, blocks: [] } }).reasons.join(' '),
    ).toContain('patrón de origen');
  });
});

describe('core/skills — candidate expiry', () => {
  const candidateWith = (activationCycles: number): SkillCandidate => ({
    id: 'cand-1',
    pattern: 'p',
    observations: 2,
    klass: 'normativa',
    declaresMcpServers: [],
    provenance: { blocks: ['C3'], humanCorrections: [], files: [] },
    generatedBy: 'a',
    evaluatedBy: 'b',
    generatingModelFamily: 'x',
    evaluatingModelFamily: 'y',
    reviewDate: '2026-12-01T00:00:00.000Z',
    activationCycles,
  });

  it('retires a candidate whose originating pattern vanished', () => {
    expect(evaluateCandidateExpiry(candidateWith(0), false).action).toBe('retire');
  });

  it('degrades a candidate after two cycles without activation', () => {
    expect(evaluateCandidateExpiry(candidateWith(2), true).action).toBe('degrade');
  });

  it('keeps a candidate whose pattern is current and recently activated', () => {
    expect(evaluateCandidateExpiry(candidateWith(0), true).action).toBe('keep');
  });

  it('only the instrumental class widens capability', () => {
    expect(SKILL_CLASSES.filter((c) => c.widensCapability).map((c) => c.klass)).toEqual(['instrumental']);
  });
});
