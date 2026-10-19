import { describe, it, expect } from 'vitest';
import {
  ENFORCEMENT_LEVELS,
  TOOL_ENFORCEMENT,
  HARD_SUBSET,
  DEFAULT_SENTINEL,
  interpretSentinel,
  resolveFloor,
  assertFloorIsOwned,
  applyDefaultFail,
  posturePasses,
  unresolvedReceipts,
  type GateObservation,
} from '../src/core/enforcement.js';

const observation = (over: Partial<GateObservation> = {}): GateObservation => ({
  gateId: 'C2',
  posture: 'blocking',
  sensorAvailable: true,
  fired: false,
  ...over,
});

describe('core/enforcement — behavioural sentinel', () => {
  it('exit 2 is a block: level A verified in execution', () => {
    const r = interpretSentinel(2);
    expect(r.outcome).toBe('blocked');
    expect(r.levelAVerified).toBe(true);
  });

  it('exit 1 is a hook failure, NOT a block (fail-open with a green dashboard)', () => {
    const r = interpretSentinel(1);
    expect(r.outcome).toBe('hook-failed-open');
    expect(r.levelAVerified).toBe(false);
    expect(r.detail.toLowerCase()).toContain('fail-open');
  });

  it('exit 0 means the probe was allowed: no write-time enforcement', () => {
    const r = interpretSentinel(0);
    expect(r.outcome).toBe('allowed');
    expect(r.levelAVerified).toBe(false);
  });

  it('an unrecognised exit code is inconclusive, never a verification', () => {
    const r = interpretSentinel(7);
    expect(r.outcome).toBe('inconclusive');
    expect(r.levelAVerified).toBe(false);
  });

  it('honours a host-specific blocked exit code', () => {
    const spec = { ...DEFAULT_SENTINEL, blockedExitCode: 3, hookFailureExitCodes: [2] };
    expect(interpretSentinel(3, spec).outcome).toBe('blocked');
    expect(interpretSentinel(2, spec).outcome).toBe('hook-failed-open');
  });
});

describe('core/enforcement — ceiling vs floor', () => {
  it('keeps B and C in the floor for every shipped tool by default', () => {
    expect(TOOL_ENFORCEMENT.length).toBeGreaterThan(0);
    for (const tool of TOOL_ENFORCEMENT) {
      const report = resolveFloor(tool.tool);
      const ids = report.floor.map((l) => l.id);
      expect(ids).toEqual(expect.arrayContaining(['B', 'C']));
      expect(report.floorIsOwned).toBe(true);
      // Without a sentinel run, level A is ceiling (nominal), never floor (guarantee).
      expect(ids).not.toContain('A');
    }
  });

  it('reports level A as nominal-only when the ceiling reaches it but no sentinel verified it', () => {
    const report = resolveFloor('claude-code');
    expect(report.ceiling).toContain('A');
    expect(report.floor.map((l) => l.id)).not.toContain('A');
    expect(report.nominalOnly).toContain('A');
    expect(report.warnings.join(' ')).toContain('ningún centinela lo verificó');
  });

  it('level A is reported above the floor, never as part of it', () => {
    const noSentinel = resolveFloor('claude-code');
    expect(noSentinel.floor.map((l) => l.id)).toEqual(['B', 'C']);
    expect(noSentinel.beyondFloor).toEqual([]);

    const verified = resolveFloor('claude-code', { levelAVerified: true });
    expect(verified.floor.map((l) => l.id)).toEqual(['B', 'C']);
    expect(verified.beyondFloor.map((l) => l.id)).toEqual(['A']);
    // A verified Level A is assurance above the floor; the floor stays organization-owned (I3).
    expect(verified.floorIsOwned).toBe(true);
  });

  it('a tool whose ceiling does not reach level A never gets A in the floor, even if a sentinel claims it', () => {
    const codex = TOOL_ENFORCEMENT.find((t) => t.tool === 'codex');
    expect(codex?.writeCeiling).toBe('advisory');
    const report = resolveFloor('codex', { levelAVerified: true });
    expect(report.floor.map((l) => l.id)).toEqual(['B', 'C']);
    expect(report.floorIsOwned).toBe(true);
    expect(() => assertFloorIsOwned(report)).not.toThrow();
  });

  it('an unmeasured tool degrades to the owned floor and says so', () => {
    const report = resolveFloor('not-a-real-tool');
    expect(report.floor.map((l) => l.id)).toEqual(['B', 'C']);
    expect(report.ceiling).toEqual(['B', 'C']);
    expect(report.nominalOnly).toEqual(['A']);
    expect(report.floorIsOwned).toBe(true);
    expect(report.warnings.join(' ')).toContain('sin techo medido');
  });

  it('assertFloorIsOwned throws when a borrowed level is declared as the floor', () => {
    const report = resolveFloor('claude-code', { levelAVerified: true });
    const borrowedFloor = { ...report, floor: [...report.floor, ...report.beyondFloor] };
    expect(borrowedFloor.floor.some((l) => l.ownedBy === 'third-party')).toBe(true);
    expect(() => assertFloorIsOwned(borrowedFloor)).toThrow(/I3 violado/);
    expect(() => assertFloorIsOwned(borrowedFloor)).toThrow(/A/);
  });

  it('B and C are the organization-owned levels', () => {
    const byId = new Map(ENFORCEMENT_LEVELS.map((l) => [l.id, l]));
    expect(byId.get('B')?.ownedBy).toBe('organization');
    expect(byId.get('C')?.ownedBy).toBe('organization');
    expect(byId.get('A')?.borrowed).toBe(true);
  });
});

describe('core/enforcement — default-FAIL posture (§9.2)', () => {
  it('a clean sensor pass is a pass when the posture is blocking', () => {
    const v = applyDefaultFail(observation({ posture: 'blocking' }));
    expect(v.outcome).toBe('pass');
    expect(v.requiresReceipt).toBe(false);
  });

  it('a sensor that ran and found something never self-authorizes, in either regime', () => {
    for (const regime of ['flexible', 'strict'] as const) {
      const v = applyDefaultFail(observation({ fired: true }), regime);
      expect(v.outcome).toBe('fail');
      expect(v.requiresReceipt).toBe(false);
    }
  });

  it('an unavailable sensor self-authorizes ONLY in the flexible regime, and requires a receipt', () => {
    const flexible = applyDefaultFail(observation({ sensorAvailable: false }), 'flexible');
    expect(flexible.outcome).toBe('self-authorized');
    expect(flexible.requiresReceipt).toBe(true);
    expect(flexible.detail).toContain('responsabilidad del operador');

    const strict = applyDefaultFail(observation({ sensorAvailable: false }), 'strict');
    expect(strict.outcome).toBe('fail');
    expect(strict.requiresReceipt).toBe(false);
  });

  it('the hard subset fails in both regimes when the sensor is unavailable', () => {
    for (const hardControl of HARD_SUBSET) {
      for (const regime of ['flexible', 'strict'] as const) {
        const v = applyDefaultFail(
          observation({ sensorAvailable: false, hardControl, posture: 'blocking' }),
          regime,
        );
        expect(v.outcome).toBe('fail');
        expect(v.detail).toContain(hardControl);
      }
    }
  });

  it('a vacuous gate cannot pass: activation is not measurement', () => {
    const blocking = applyDefaultFail(observation({ inspects: false, posture: 'blocking' }));
    expect(blocking.outcome).toBe('fail');
    expect(blocking.detail).toContain('no inspecciona nada');

    const advisory = applyDefaultFail(observation({ inspects: false, posture: 'advisory' }));
    expect(advisory.outcome).toBe('advisory');
    expect(advisory.outcome).not.toBe('pass');
  });

  it('aggregates a run: self-authorized relaxations do not pass silently', () => {
    const pass = applyDefaultFail(observation());
    const relaxed = applyDefaultFail(observation({ sensorAvailable: false }));
    const failed = applyDefaultFail(observation({ fired: true }));

    expect(posturePasses([pass, relaxed])).toBe(true);
    expect(posturePasses([pass, failed])).toBe(false);
    expect(unresolvedReceipts([pass, relaxed, failed]).map((v) => v.gateId)).toEqual(['C2']);
  });
});
