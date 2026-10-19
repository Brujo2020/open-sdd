import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DELTA_ID_PATTERN,
  DELTA_KINDS,
  DELTA_SIZE_WARNING,
  deltaCounts,
  deltaSpecFileName,
  parseDeltaSpec,
  renderDeltaSpec,
  strangulationReport,
  traceDelta,
  validateDeltaSpec,
  type DeltaEntry,
  type DeltaSpec,
} from '../src/core/deltaSpec.js';
import { parseTasksMarkdown } from '../src/core/specManager.js';
import { handleDeltaCommand } from '../src/cli/commands/brownfield.js';
import type { CliIO } from '../src/cli/io.js';

const temps: string[] = [];

const makeTemp = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const makeIO = (): { io: CliIO; logs: string[]; errors: string[] } => {
  const logs: string[] = [];
  const errors: string[] = [];
  const io: CliIO = {
    log: (msg) => logs.push(msg),
    error: (msg) => errors.push(msg),
    exit: () => undefined,
  };
  return { io, logs, errors };
};

/** A valid delta entry; override whichever field the test is about. */
const entry = (overrides: Partial<DeltaEntry> = {}): DeltaEntry => ({
  id: 'REQ-AUTH-001',
  kind: 'ADDED',
  title: 'Sesión emitida',
  statement: 'WHEN a valid credential is presented, the service shall issue a session.',
  targets: ['src/auth/session.ts'],
  strangler: 'both',
  ...overrides,
});

const delta = (entries: DeltaEntry[], overrides: Partial<DeltaSpec> = {}): DeltaSpec => ({
  feature: 'demo',
  title: 'Demo',
  status: 'proposed',
  entries,
  ...overrides,
});

const errorCodes = (spec: DeltaSpec): string[] =>
  validateDeltaSpec(spec)
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.code);

describe('core/deltaSpec', () => {
  it('exposes the ADSR kinds, the id grammar, the size ceiling and the file name', () => {
    expect(DELTA_KINDS).toEqual(['ADDED', 'MODIFIED', 'REMOVED', 'RENAMED']);
    expect(DELTA_SIZE_WARNING).toBe(25);
    expect(deltaSpecFileName()).toBe('delta.md');

    expect(DELTA_ID_PATTERN.test('REQ-AUTH-001')).toBe(true);
    expect(DELTA_ID_PATTERN.test('REQ-DB-MIGRATION-042')).toBe(true);
    expect(DELTA_ID_PATTERN.test('AUTH-001')).toBe(false);
    expect(DELTA_ID_PATTERN.test('REQ-AUTH-01')).toBe(false);
    expect(DELTA_ID_PATTERN.test('REQ-AUTH-0001')).toBe(false);
  });

  it('round-trips a delta with entries of all four kinds through render/parse', () => {
    // Every optional field is populated on every entry so the round-trip exercises each parser field
    // (including `previous` on an ADDED entry, which the parser must preserve verbatim).
    const spec: DeltaSpec = {
      feature: 'brownfield-demo',
      title: 'Contrato de cambio',
      base: 'spec-base',
      status: 'approved',
      entries: [
        {
          id: 'REQ-AUTH-001',
          kind: 'ADDED',
          title: 'Sesión emitida',
          statement: 'WHEN a valid credential is presented, the service shall issue a session.',
          targets: ['src/auth/session.ts', 'POST /sessions'],
          previous: 'legacy session endpoint',
          contracts: ['test/auth.test.ts::issues a session'],
          rationale: 'The legacy endpoint cannot be audited.',
          strangler: 'both',
        },
        {
          id: 'REQ-AUTH-002',
          kind: 'MODIFIED',
          title: 'Sesión renovada',
          statement: 'WHILE the session is active, the service shall refresh the token.',
          targets: ['src/auth/refresh.ts'],
          previous: 'fixed 24h sessions',
          contracts: ['test/refresh.test.ts::refreshes the token'],
          rationale: 'Tokens must not outlive the revocation contract.',
          strangler: 'legacy',
        },
        {
          id: 'REQ-DB-003',
          kind: 'REMOVED',
          title: 'Tabla legacy',
          statement: 'The service shall drop the legacy sessions table.',
          targets: ['migrations/drop_legacy_sessions.sql'],
          previous: 'legacy sessions table',
          contracts: ['test/db.test.ts::schema has no legacy table'],
          rationale: 'Dropped after the backfill; consumers migrated to the new table.',
          strangler: 'new',
        },
        {
          id: 'REQ-API-004',
          kind: 'RENAMED',
          title: 'Ruta renombrada',
          statement: 'The service shall expose GET /v2/sessions.',
          targets: ['src/api/routes.ts'],
          previous: 'GET /sessions',
          contracts: ['test/api.test.ts::serves v2 sessions'],
          rationale: 'The rename aligns the route with the versioned contract.',
          strangler: 'both',
        },
      ],
    };

    const round = parseDeltaSpec(renderDeltaSpec(spec));

    expect(round.feature).toBe(spec.feature);
    expect(round.title).toBe(spec.title);
    expect(round.status).toBe('approved');
    expect(round.base).toBe('spec-base');
    expect(round.entries).toHaveLength(4);

    const byId = new Map(round.entries.map((e) => [e.id, e]));
    for (const expected of spec.entries) {
      expect(byId.get(expected.id)).toEqual(expected);
    }
  });

  it('ignores a commented-out example entry but parses the same entry when uncommented', () => {
    const scaffold = (commented: boolean): string =>
      [
        '# Delta: demo — Demo',
        '',
        'Status: proposed',
        '',
        '## ADDED',
        ...(commented
          ? [
              '<!--',
              '### REQ-AUTH-001 — Sesión emitida',
              '- Statement: WHEN a valid credential is presented, the service shall issue a session.',
              '- Targets: src/auth/session.ts',
              '- Strangler: legacy',
              '-->',
            ]
          : [
              '### REQ-AUTH-001 — Sesión emitida',
              '- Statement: WHEN a valid credential is presented, the service shall issue a session.',
              '- Targets: src/auth/session.ts',
              '- Strangler: legacy',
            ]),
        '',
        '## MODIFIED',
        '',
        '## REMOVED',
        '',
        '## RENAMED',
        '',
      ].join('\n');

    const commented = parseDeltaSpec(scaffold(true));
    expect(commented.entries).toEqual([]);

    const uncommented = parseDeltaSpec(scaffold(false));
    expect(uncommented.entries).toHaveLength(1);
    expect(uncommented.entries[0]).toMatchObject({
      id: 'REQ-AUTH-001',
      kind: 'ADDED',
      title: 'Sesión emitida',
      targets: ['src/auth/session.ts'],
      strangler: 'legacy',
    });
  });

  it('reports the exact error code for every blocking rule', () => {
    // Bad id: not REQ-<AREA>-<NNN>.
    expect(errorCodes(delta([entry({ id: 'AUTH-001' })]))).toEqual(['ID_FORMAT']);

    // Duplicate id.
    expect(errorCodes(delta([entry(), entry()]))).toEqual(['DUPLICATE_ID']);

    // Missing statement.
    expect(errorCodes(delta([entry({ statement: '   ' })]))).toEqual(['NO_STATEMENT']);

    // Statement that is not EARS (no `shall`).
    expect(
      errorCodes(delta([entry({ statement: 'The service issues a session when credentials are presented.' })])),
    ).toEqual(['EARS']);

    // No targets.
    expect(errorCodes(delta([entry({ targets: [] })]))).toEqual(['NO_TARGETS']);

    // MODIFIED without `previous`.
    expect(
      errorCodes(delta([entry({ kind: 'MODIFIED', contracts: ['test/auth.test.ts::x'] })])),
    ).toEqual(['MISSING_PREVIOUS']);

    // REMOVED without rationale.
    expect(
      errorCodes(
        delta([
          entry({
            kind: 'REMOVED',
            previous: 'legacy session endpoint',
            contracts: ['test/auth.test.ts::x'],
          }),
        ]),
      ),
    ).toEqual(['MISSING_RATIONALE']);

    // REMOVED without contracts.
    expect(
      errorCodes(
        delta([
          entry({
            kind: 'REMOVED',
            previous: 'legacy session endpoint',
            rationale: 'Retirado tras la migración de sus consumidores.',
          }),
        ]),
      ),
    ).toEqual(['MISSING_CONTRACTS']);
  });

  it('warns (never errors) on MODIFIED without contracts', () => {
    const issues = validateDeltaSpec(
      delta([entry({ kind: 'MODIFIED', previous: 'legacy session endpoint' })]),
    );

    const contracts = issues.filter((issue) => issue.code === 'MISSING_CONTRACTS');
    expect(contracts).toHaveLength(1);
    expect(contracts[0].severity).toBe('warning');
    expect(issues.some((issue) => issue.severity === 'error' && issue.code === 'MISSING_CONTRACTS')).toBe(false);
  });

  it('warns NOT_A_DELTA only above the size ceiling', () => {
    const many = (count: number): DeltaSpec =>
      delta(
        Array.from({ length: count }, (_, i) =>
          entry({ id: `REQ-BULK-${String(i + 1).padStart(3, '0')}`, title: `Cambio ${i + 1}` }),
        ),
      );

    const atCeiling = validateDeltaSpec(many(DELTA_SIZE_WARNING));
    expect(atCeiling.some((issue) => issue.code === 'NOT_A_DELTA')).toBe(false);

    const aboveCeiling = validateDeltaSpec(many(DELTA_SIZE_WARNING + 1));
    const oversized = aboveCeiling.find((issue) => issue.code === 'NOT_A_DELTA');
    expect(oversized).toBeDefined();
    expect(oversized?.severity).toBe('warning');
  });

  it('counts entries per kind and reports strangulation progress', () => {
    const spec = delta([
      entry({ id: 'REQ-A-001', kind: 'ADDED', strangler: 'new' }),
      entry({ id: 'REQ-A-002', kind: 'ADDED', strangler: undefined }),
      entry({
        id: 'REQ-A-003',
        kind: 'MODIFIED',
        previous: 'older behaviour',
        contracts: ['test/a.test.ts::x'],
        strangler: 'both',
      }),
      entry({
        id: 'REQ-A-004',
        kind: 'REMOVED',
        previous: 'removed behaviour',
        rationale: 'Retirado con su migración.',
        contracts: ['test/a.test.ts::y'],
        strangler: 'new',
      }),
    ]);

    expect(deltaCounts(spec)).toEqual({ ADDED: 2, MODIFIED: 1, REMOVED: 1, RENAMED: 0 });

    const report = strangulationReport(spec);
    expect(report.total).toBe(4);
    expect(report.byState).toEqual({ legacy: 1, both: 1, new: 2 });
    // A missing `strangler` counts as legacy, and everything not fully on the new path stays pending.
    expect(report.pending).toEqual(['REQ-A-002', 'REQ-A-003']);

    const empty = strangulationReport(delta([]));
    expect(empty.total).toBe(0);
    expect(empty.pending).toEqual([]);
    expect(empty.detail).toBe('Delta vacía.');
  });

  it('traces delta requirements to tasks and reports phantoms in both directions', () => {
    const spec = delta([
      entry({ id: 'REQ-BF-001', targets: ['src/brown/index.ts'] }),
      entry({ id: 'REQ-BF-002', targets: ['src/brown/other.ts'] }),
    ]);

    const tasksMarkdown = [
      '- [ ] 1.1 Emitir la sesión _Requirements: REQ-BF-001_ _Boundary:_ `src/brown`',
      '- [ ] 1.2 Auditar el acceso _Requirements: REQ-XX-999_',
    ].join('\n');
    const tasks = parseTasksMarkdown(tasksMarkdown);

    const trace = traceDelta(spec, tasks);
    expect(trace.mapped).toHaveLength(1);
    expect(trace.mapped[0]).toEqual({
      requirementId: 'REQ-BF-001',
      tasks: ['1.1'],
      targets: ['src/brown/index.ts'],
    });
    expect(trace.unmapped).toEqual(['REQ-BF-002']);
    expect(trace.phantomTasks).toEqual([{ taskId: '1.2', cited: 'REQ-XX-999' }]);
    expect(trace.coverage).toBe(0.5);
  });

  it('reports full coverage when every entry is mapped and no phantoms remain', () => {
    const spec = delta([
      entry({ id: 'REQ-BF-001' }),
      entry({ id: 'REQ-XX-999' }),
    ]);
    const tasks = parseTasksMarkdown(
      [
        '- [ ] 1.1 Emitir la sesión _Requirements: REQ-BF-001_',
        '- [ ] 1.2 Auditar el acceso _Requirements: REQ-XX-999_',
      ].join('\n'),
    );

    const trace = traceDelta(spec, tasks);
    expect(trace.coverage).toBe(1);
    expect(trace.unmapped).toEqual([]);
    expect(trace.phantomTasks).toEqual([]);
    expect(trace.mapped.map((m) => m.requirementId)).toEqual(['REQ-BF-001', 'REQ-XX-999']);
  });

  it('scaffolds, refuses to overwrite without --force and validates the empty scaffold', async () => {
    const dir = await makeTemp('open-sdd-delta-cli-');
    // Make the repo root unambiguous: findRepoRoot climbs up until it finds `.sdd`.
    await mkdir(path.join(dir, '.sdd'), { recursive: true });

    const { io, logs, errors } = makeIO();

    const created = await handleDeltaCommand(['init', 'demo'], io, dir);
    expect(created).toBe(0);

    const file = path.join(dir, '.sdd', 'specs', 'demo', deltaSpecFileName());
    const first = await readFile(file, 'utf8');
    expect(first).toContain('# Delta: demo');
    // The scaffold's example entry is commented out, so the delta starts empty.
    expect(parseDeltaSpec(first).entries).toHaveLength(0);

    const second = await handleDeltaCommand(['init', 'demo'], io, dir);
    expect(second).toBe(1);
    expect(await readFile(file, 'utf8')).toBe(first);
    expect(errors.join('\n')).toContain(deltaSpecFileName());
    expect(errors.join('\n')).toContain('--force');

    const validated = await handleDeltaCommand(['validate', 'demo'], io, dir);
    expect(validated).toBe(0);
    expect(logs.some((line) => line.includes('Validación de la delta'))).toBe(true);
  });
});
