/**
 * QA tier 5 — COMPLEX SCENARIOS (100 cases).
 *
 * Five families of twenty, each row a situation rather than a unit: a change set against three specs,
 * a pair of requirement revisions, a receipt against what actually happened on disk, a checklist whose
 * predicates succeed and fail in different combinations, and statements that carry several defects at
 * once. The rows are data; every one becomes its own case, so a failure names the scenario.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkDrift, parseDriftBindings } from '../src/core/driftCheck.js';
import { auditIds, normalizeStatement } from '../src/core/stableIds.js';
import { applyUninstall, planUninstall, recordReceipt } from '../src/core/receipt.js';
import { verifyChecklist } from '../src/core/checklist.js';
import { countByCheck } from '../src/core/requirementsCoach.js';
import { cleanupTempRepos, coachReview, makeTempRepo } from './qaSupport.js';

afterEach(cleanupTempRepos);

// ── A. Drift across three specs, twenty change sets ─────────────────────────────────────────────
const tasksA = '# Tasks\n\n- [ ] 1. Core — _Requirements: REQ-A-001_ — _Boundary:_ `src/core/**`';
const tasksB = '# Tasks\n\n- [ ] 2. Docs — _Requirements: REQ-B-001_ — _Boundary:_ `docs/**`, `README.md`';
const tasksC = '# Tasks\n\n- [ ] 3. Cli — _Requirements: REQ-C-001_ — _Boundary:_ `src/cli/*.ts`';
const BINDINGS = [...parseDriftBindings('a', tasksA), ...parseDriftBindings('b', tasksB), ...parseDriftBindings('c', tasksC)];
const VALID_WAIVER = { path: 'scripts/**', reason: 'retired', owner: 'ops', expires: '2027-03-31' };
const EXPIRED_WAIVER = { path: 'scripts/**', reason: 'retired', owner: 'ops', expires: '2020-01-01' };
const NOW = new Date('2026-01-01T00:00:00Z');

type DriftRow = { name: string; files: string[]; waivers?: typeof VALID_WAIVER[]; expect: Record<string, number> };
const DRIFT_ROWS: DriftRow[] = [
  { name: 'one core file', files: ['src/core/a.ts'], expect: { covered: 1, uncovered: 0, waived: 0, expired: 0 } },
  { name: 'one cli file', files: ['src/cli/main.ts'], expect: { covered: 1, uncovered: 0, waived: 0, expired: 0 } },
  { name: 'one doc', files: ['docs/guide.md'], expect: { covered: 1, uncovered: 0, waived: 0, expired: 0 } },
  { name: 'the README', files: ['README.md'], expect: { covered: 1, uncovered: 0, waived: 0, expired: 0 } },
  { name: 'cli file one level deeper is NOT covered by the single-segment glob', files: ['src/cli/sub/main.ts'], expect: { covered: 0, uncovered: 1, waived: 0, expired: 0 } },
  { name: 'two covered files', files: ['src/core/a.ts', 'docs/b.md'], expect: { covered: 2, uncovered: 0, waived: 0, expired: 0 } },
  { name: 'one uncovered file', files: ['scripts/one.sh'], expect: { covered: 0, uncovered: 1, waived: 0, expired: 0 } },
  { name: 'ten files, mixed', files: ['src/core/a.ts', 'docs/b.md', 'src/cli/c.ts', 'scripts/d.sh', 'Makefile'], expect: { covered: 3, uncovered: 2, waived: 0, expired: 0 } },
  { name: 'an uncovered file accepted by a valid waiver', files: ['scripts/one.sh'], waivers: [VALID_WAIVER], expect: { covered: 0, uncovered: 0, waived: 1, expired: 0 } },
  { name: 'an uncovered file whose waiver EXPIRED', files: ['scripts/one.sh'], waivers: [EXPIRED_WAIVER], expect: { covered: 0, uncovered: 0, waived: 0, expired: 1 } },
  { name: 'two waived files', files: ['scripts/a.sh', 'scripts/b.sh'], waivers: [VALID_WAIVER], expect: { covered: 0, uncovered: 0, waived: 2, expired: 0 } },
  { name: 'covered and waived together', files: ['src/core/a.ts', 'scripts/b.sh'], waivers: [VALID_WAIVER], expect: { covered: 1, uncovered: 0, waived: 1, expired: 0 } },
  { name: 'covered, waived and expired together', files: ['src/core/a.ts', 'scripts/b.sh', 'infra/c.tf'], waivers: [VALID_WAIVER], expect: { covered: 1, uncovered: 1, waived: 1, expired: 0 } },
  { name: 'no changed files at all', files: [], expect: { covered: 0, uncovered: 0, waived: 0, expired: 0 } },
  { name: 'the same file twice is counted twice by design', files: ['src/core/a.ts', 'src/core/a.ts'], expect: { covered: 2, uncovered: 0, waived: 0, expired: 0 } },
  { name: 'a dotfile at the root', files: ['.editorconfig'], expect: { covered: 0, uncovered: 1, waived: 0, expired: 0 } },
  { name: 'a nested docs path', files: ['docs/deep/guide.md'], expect: { covered: 1, uncovered: 0, waived: 0, expired: 0 } },
  { name: 'the package manifest', files: ['package.json'], expect: { covered: 0, uncovered: 1, waived: 0, expired: 0 } },
  { name: 'a workflow file', files: ['.github/workflows/gates.yml'], expect: { covered: 0, uncovered: 1, waived: 0, expired: 0 } },
  { name: 'a core file and a waived script', files: ['src/core/x/y/z.ts', 'scripts/z.sh'], waivers: [VALID_WAIVER], expect: { covered: 1, uncovered: 0, waived: 1, expired: 0 } },
];

// ── B. Stable identifiers, twenty revision pairs ────────────────────────────────────────────────
const m = (statement: string): Map<string, string> => new Map([['REQ-P-014', normalizeStatement(statement)]]);
type IdRow = { name: string; before: Map<string, string>; after: Map<string, string>; expect: string[] };
const ID_ROWS: IdRow[] = [
  { name: 'identical', before: m('record the refund'), after: m('record the refund'), expect: [] },
  { name: 'case only', before: m('record the refund'), after: m('RECORD THE REFUND'), expect: [] },
  { name: 'extra whitespace', before: m('record the refund'), after: m('  record   the  refund  '), expect: [] },
  { name: 'punctuation change counts as a change', before: m('record the refund'), after: m('record the refund.'), expect: ['ID-MUTATED'] },
  { name: 'one word added', before: m('record the refund'), after: m('record the refund promptly'), expect: ['ID-MUTATED'] },
  { name: 'one word removed', before: m('record the full refund'), after: m('record the refund'), expect: ['ID-MUTATED'] },
  { name: 'meaning reversed', before: m('record the refund'), after: m('do not record the refund'), expect: ['ID-MUTATED'] },
  { name: 'the id disappears', before: m('record the refund'), after: new Map(), expect: ['ID-LOST'] },
  { name: 'a new id appears alone', before: new Map(), after: m('record the refund'), expect: [] },
  { name: 'two ids, one lost', before: new Map([['REQ-P-001', 'a'], ['REQ-P-002', 'b']]), after: new Map([['REQ-P-001', 'a']]), expect: ['ID-LOST'] },
  { name: 'two ids, one mutated', before: new Map([['REQ-P-001', 'a'], ['REQ-P-002', 'b']]), after: new Map([['REQ-P-001', 'a'], ['REQ-P-002', 'c']]), expect: ['ID-MUTATED'] },
  { name: 'two ids, both changed', before: new Map([['REQ-P-001', 'a'], ['REQ-P-002', 'b']]), after: new Map([['REQ-P-001', 'x'], ['REQ-P-002', 'y']]), expect: ['ID-MUTATED', 'ID-MUTATED'] },
  { name: 'a renumbered id is a loss plus an addition', before: m('record the refund'), after: new Map([['REQ-P-015', normalizeStatement('record the refund')]]), expect: ['ID-LOST'] },
  { name: 'empty everywhere', before: new Map(), after: new Map(), expect: [] },
  { name: 'the id was reused with a different meaning', before: m('record the refund'), after: m('delete the account'), expect: ['ID-MUTATED'] },
  { name: 'whitespace collapsed inside', before: m('record    the refund'), after: m('record the refund'), expect: [] },
  { name: 'a trailing space', before: m('record the refund'), after: m('record the refund '), expect: [] },
  { name: 'markdown emphasis stripped', before: m('record the refund'), after: m('**record the refund**'), expect: [] },
  { name: 'a number added', before: m('retry three times'), after: m('retry four times'), expect: ['ID-MUTATED'] },
  { name: 'a unit added', before: m('respond in 100 ms'), after: m('respond in 100 ms per calendar month'), expect: ['ID-MUTATED'] },
];

// ── C. Receipts against what is actually on disk ────────────────────────────────────────────────
type ReceiptRow = {
  name: string;
  entries: { path: string; action: 'create' | 'merge' | 'overwrite' }[];
  mutate?: (cwd: string) => Promise<void>;
  purge?: boolean;
  expectState: string[];
  expectRemoved: number;
};
const RECEIPT_ROWS: ReceiptRow[] = [
  { name: 'one created file, untouched', entries: [{ path: 'a/x.txt', action: 'create' }], expectState: ['remove'], expectRemoved: 1 },
  { name: 'one created file, edited by a human', entries: [{ path: 'a/x.txt', action: 'create' }], mutate: async (c) => writeFile(path.join(c, 'a/x.txt'), 'edited\n', 'utf8'), expectState: ['refused'], expectRemoved: 0 },
  { name: 'a merged config', entries: [{ path: 'a/settings.json', action: 'merge' }], expectState: ['refused'], expectRemoved: 0 },
  { name: 'an overwritten file, untouched', entries: [{ path: 'a/x.txt', action: 'overwrite' }], expectState: ['remove'], expectRemoved: 1 },
  { name: 'an overwritten file, edited', entries: [{ path: 'a/x.txt', action: 'overwrite' }], mutate: async (c) => writeFile(path.join(c, 'a/x.txt'), 'edited\n', 'utf8'), expectState: ['refused'], expectRemoved: 0 },
  { name: 'a file that is already gone', entries: [{ path: 'a/gone.txt', action: 'create' }], mutate: async (c) => rm(path.join(c, 'a/gone.txt'), { force: true }), expectState: ['missing'], expectRemoved: 0 },
  { name: 'two created, both untouched', entries: [{ path: 'a/x.txt', action: 'create' }, { path: 'a/y.txt', action: 'create' }], expectState: ['remove', 'remove'], expectRemoved: 2 },
  { name: 'two created, one edited', entries: [{ path: 'a/x.txt', action: 'create' }, { path: 'a/y.txt', action: 'create' }], mutate: async (c) => writeFile(path.join(c, 'a/y.txt'), 'edited\n', 'utf8'), expectState: ['remove', 'refused'], expectRemoved: 1 },
  { name: 'a merge next to a create', entries: [{ path: 'a/x.txt', action: 'create' }, { path: 'a/settings.json', action: 'merge' }], expectState: ['remove', 'refused'], expectRemoved: 1 },
  { name: 'nested directories, emptied', entries: [{ path: 'a/b/c/d.txt', action: 'create' }], expectState: ['remove'], expectRemoved: 1 },
  { name: 'a root-level created file', entries: [{ path: 'top.txt', action: 'create' }], expectState: ['remove'], expectRemoved: 1 },
  { name: 'three created, one missing', entries: [{ path: 'a/x.txt', action: 'create' }, { path: 'a/y.txt', action: 'create' }, { path: 'a/z.txt', action: 'create' }], mutate: async (c) => rm(path.join(c, 'a/z.txt'), { force: true }), expectState: ['remove', 'remove', 'missing'], expectRemoved: 2 },
  { name: 'everything edited, nothing removed', entries: [{ path: 'a/x.txt', action: 'create' }, { path: 'a/y.txt', action: 'create' }], mutate: async (c) => {
      await writeFile(path.join(c, 'a/x.txt'), 'e1\n', 'utf8');
      await writeFile(path.join(c, 'a/y.txt'), 'e2\n', 'utf8');
    }, expectState: ['refused', 'refused'], expectRemoved: 0 },
  { name: 'a created file inside .sdd is removed with the rest', entries: [{ path: '.sdd/state.json', action: 'create' }], expectState: ['remove'], expectRemoved: 1 },
  { name: 'a created file plus purge', entries: [{ path: 'a/x.txt', action: 'create' }], purge: true, expectState: ['remove'], expectRemoved: 2 },
  { name: 'nothing recorded', entries: [], expectState: [], expectRemoved: 0 },
  { name: 'a merge and an edited create', entries: [{ path: 'a/x.txt', action: 'create' }, { path: 'a/settings.json', action: 'merge' }], mutate: async (c) => writeFile(path.join(c, 'a/x.txt'), 'edited\n', 'utf8'), expectState: ['refused', 'refused'], expectRemoved: 0 },
  { name: 'two merges', entries: [{ path: 'a/s1.json', action: 'merge' }, { path: 'a/s2.json', action: 'merge' }], expectState: ['refused', 'refused'], expectRemoved: 0 },
  { name: 'a created file whose content is empty', entries: [{ path: 'a/empty.txt', action: 'create' }], mutate: async (c) => writeFile(path.join(c, 'a/empty.txt'), '', 'utf8'), expectState: ['refused'], expectRemoved: 0 },
  { name: 'a created file rewritten with identical bytes stays removable', entries: [{ path: 'a/x.txt', action: 'create' }], mutate: async (c) => writeFile(path.join(c, 'a/x.txt'), 'same\n', 'utf8'), expectState: ['remove'], expectRemoved: 1 },
];

// ── D. Checklists: predicates that succeed and fail in combinations ─────────────────────────────
const cmdOk = { exitCode: 0, stdout: 'ok', stderr: '' };
const cmdFail = { exitCode: 1, stdout: '', stderr: 'boom' };
type CheckRow = {
  name: string;
  markdown: string;
  input?: Parameters<typeof verifyChecklist>[0];
  expectPassed: number;
  /** Blocking failures: only a COMPLETED item whose predicate fails. */
  expectFailures: number;
};
const item = (id: string, ...predicates: string[]): string =>
  [`- [ ] ${id} item`, ...predicates.map((p) => `  predicate: ${p}`), ''].join('\n');
const checked = (id: string, ...predicates: string[]): string =>
  [`- [x] ${id} item`, ...predicates.map((p) => `  predicate: ${p}`), ''].join('\n');
const TRACE_ARTIFACT = [{ file: 'requirements.md', text: '### REQ-A-001 — x\n\nTEST-A-001 covers it.' }];
const CHECK_ROWS: CheckRow[] = [
  { name: 'one cmd that passes', markdown: item('C1', 'cmd: npm test'), input: { runCommand: () => cmdOk }, expectPassed: 1, expectFailures: 0 },
  { name: 'one cmd that fails', markdown: item('C1', 'cmd: npm test'), input: { runCommand: () => cmdFail }, expectPassed: 0, expectFailures: 0 },
  { name: 'two cmds, both pass', markdown: item('C1', 'cmd: a', 'cmd: b'), input: { runCommand: () => cmdOk }, expectPassed: 1, expectFailures: 0 },
  { name: 'two cmds, one fails', markdown: item('C1', 'cmd: a', 'cmd: b'), input: { runCommand: (cmd) => (cmd === 'a' ? cmdOk : cmdFail) }, expectPassed: 0, expectFailures: 0 },
  { name: 'an artifact that exists', markdown: item('C1', 'artifact: docs/x.md'), input: { exists: () => true, readFile: () => 'x' }, expectPassed: 1, expectFailures: 0 },
  { name: 'an artifact that is missing', markdown: item('C1', 'artifact: docs/x.md'), input: { exists: () => false, readFile: () => null }, expectPassed: 0, expectFailures: 0 },
  { name: 'a property that holds', markdown: item('C1', 'property: p-1'), input: { propertyRunner: () => ({ ok: true }) }, expectPassed: 1, expectFailures: 0 },
  { name: 'a property that fails', markdown: item('C1', 'property: p-1'), input: { propertyRunner: () => ({ ok: false }) }, expectPassed: 0, expectFailures: 0 },
  { name: 'a property with no runner cannot be verified', markdown: item('C1', 'property: p-1'), input: {}, expectPassed: 0, expectFailures: 0 },
  { name: 'a trace of two ids in ONE artifact resolves', markdown: item('C1', 'trace: REQ-A-001 -> TEST-A-001'), input: { artifacts: TRACE_ARTIFACT }, expectPassed: 1, expectFailures: 0 },
  { name: 'a trace whose far end resolves to nothing', markdown: item('C1', 'trace: REQ-A-001 -> TEST-Z-999'), input: { artifacts: TRACE_ARTIFACT }, expectPassed: 0, expectFailures: 0 },
  { name: 'a trace split across artifacts does not resolve', markdown: item('C1', 'trace: REQ-A-001 -> TEST-A-001'), input: { artifacts: [{ file: 'a.md', text: 'REQ-A-001' }, { file: 'b.md', text: 'TEST-A-001' }] }, expectPassed: 0, expectFailures: 0 },
  { name: 'a trace naming a single id is refused as incomplete', markdown: item('C1', 'trace: REQ-A-001'), input: { artifacts: TRACE_ARTIFACT }, expectPassed: 0, expectFailures: 0 },
  { name: 'a COMPLETED item whose predicate fails is a BLOCKING failure', markdown: checked('C1', 'cmd: a'), input: { runCommand: () => cmdFail }, expectPassed: 0, expectFailures: 1 },
  { name: 'a COMPLETED item whose predicate passes is verified and records evidence', markdown: checked('C1', 'cmd: a'), input: { runCommand: () => cmdOk }, expectPassed: 1, expectFailures: 0 },
  { name: 'cmd plus artifact, both pass', markdown: item('C1', 'cmd: a', 'artifact: d.md'), input: { runCommand: () => cmdOk, exists: () => true, readFile: () => 'x' }, expectPassed: 1, expectFailures: 0 },
  { name: 'cmd passes, artifact missing', markdown: item('C1', 'cmd: a', 'artifact: d.md'), input: { runCommand: () => cmdOk, exists: () => false, readFile: () => null }, expectPassed: 0, expectFailures: 0 },
  { name: 'two items, both pass', markdown: `${item('C1', 'cmd: a')}${item('C2', 'cmd: b')}`, input: { runCommand: () => cmdOk }, expectPassed: 2, expectFailures: 0 },
  { name: 'two items, one fails', markdown: `${item('C1', 'cmd: a')}${item('C2', 'cmd: b')}`, input: { runCommand: (cmd) => (cmd === 'a' ? cmdOk : cmdFail) }, expectPassed: 1, expectFailures: 0 },
  { name: 'four predicates all passing', markdown: item('C1', 'cmd: a', 'artifact: d.md', 'property: p', 'trace: REQ-A-001 -> TEST-A-001'), input: { runCommand: () => cmdOk, exists: () => true, readFile: () => 'x', propertyRunner: () => ({ ok: true }), artifacts: TRACE_ARTIFACT }, expectPassed: 1, expectFailures: 0 },
];

// ── E. Statements that carry several defects at once ────────────────────────────────────────────
type MultiRow = { name: string; text: string; expect: string[] };
const MULTI_ROWS: MultiRow[] = [
  { name: 'compound + negation', text: '- The system shall validate the input and shall not fail.', expect: ['SIN-001'] },
  { name: 'escape clause + weak adjective', text: '- Where possible, the system shall be fast.', expect: ['AMB-003'] },
  { name: 'user subject + slash', text: '- The user shall read/write the record.', expect: ['EARS-007'] },
  { name: 'pronoun + temporal + comparative', text: '- It shall eventually be better than the old module.', expect: ['AMB-007'] },
  { name: 'placeholder + compound', text: '- The system shall encrypt with TBD and shall rotate keys.', expect: ['AMB-013', 'SIN-001'] },
  { name: 'absolute + availability', text: '- The system shall be available 100% of the time.', expect: ['SIN-008'] },
  { name: 'latency with no percentile or window', text: '- The service shall have a latency of 100 ms.', expect: ['NFR-002'] },
  { name: 'uptime with no window', text: '- The service shall provide 99.9% uptime.', expect: ['NFR-003'] },
  { name: 'two prohibitions', text: '- The system shall not fail and shall not crash.', expect: ['SIN-007'] },
  { name: 'open-ended list', text: '- The system shall log A, B, C, etc.', expect: ['AMB-004'] },
  { name: 'user subject alone', text: '- The user shall wait.', expect: ['EARS-007'] },
  { name: 'weak modal alone', text: '- The system should record each event.', expect: ['EARS-002'] },
  { name: 'number without a unit', text: '- The system shall handle 4 in 10 seconds.', expect: ['AMB-010'] },
  { name: 'minimize with no bound', text: '- The system shall minimize latency.', expect: ['AMB-012'] },
  { name: 'restated acceptance', text: '- The system shall work as expected.', expect: ['VER-006'] },
  { name: 'no measurable outcome', text: '- The system shall validate the request.', expect: ['VER-001'] },
  { name: 'compound pair', text: '- The system shall display X and shall record Y.', expect: ['SIN-001'] },
  { name: 'optionality clause', text: '- The system shall, if possible, comply.', expect: ['AMB-003'] },
  { name: 'bare prohibition', text: '- The system shall not be unavailable.', expect: ['SIN-007'] },
  { name: 'subjective pair', text: '- The process shall be simple and efficient.', expect: ['AMB-001'] },
];

/** The rows are written as bare statements; the heading is this tier's convention, so it stays here. */
const coach = (text: string) => coachReview(`# Requirements\n\n${text}\n`);

describe('tier 5 — complex scenarios', () => {
  describe('A. drift across three specs', () => {
    for (const row of DRIFT_ROWS) {
      it(`${row.name}`, () => {
        const report = checkDrift({
          files: row.files,
          bindings: BINDINGS,
          ...(row.waivers ? { waivers: row.waivers } : {}),
          now: NOW,
        });
        const counts: Record<string, number> = { covered: 0, uncovered: 0, waived: 0, expired: 0 };
        for (const finding of report.findings) {
          const key = finding.state === 'expired-waiver' ? 'expired' : finding.state;
          counts[key] = (counts[key] ?? 0) + 1;
        }
        expect(counts).toEqual(row.expect);
        expect(report.uncovered).toBe(row.expect.uncovered);
      });
    }
  });

  describe('B. stable identifiers across revisions', () => {
    for (const row of ID_ROWS) {
      it(`${row.name}`, () => {
        expect(auditIds({ before: row.before, after: row.after }).map((f) => f.code)).toEqual(row.expect);
      });
    }
  });

  describe('C. receipts against the disk', () => {
    for (const row of RECEIPT_ROWS) {
      it(`${row.name}`, async () => {
        const cwd = await makeTempRepo();
        for (const entry of row.entries) {
          await mkdir(path.dirname(path.join(cwd, entry.path)), { recursive: true });
          await writeFile(path.join(cwd, entry.path), 'same\n', 'utf8');
        }
        if (row.entries.length > 0) await recordReceipt(cwd, row.entries);
        if (row.mutate) await row.mutate(cwd);

        const plan = await planUninstall(cwd, row.purge ? { purgeSdd: true } : {});
        // El plan ordena por ruta, no por orden de declaración: se compara el multiconjunto.
        expect(plan.entries.map((entry) => entry.state).sort()).toEqual([...row.expectState].sort());

        const result = await applyUninstall(cwd, plan);
        expect(result.removed).toHaveLength(row.expectRemoved);
        expect(result.failed).toEqual([]);
      });
    }
  });

  describe('D. checklist predicates', () => {
    for (const row of CHECK_ROWS) {
      it(`${row.name}`, () => {
        const result = verifyChecklist({ markdown: row.markdown, ...(row.input ?? {}) });
        expect(result.passed).toBe(row.expectPassed);
        expect(result.failures).toHaveLength(row.expectFailures);
      });
    }
  });

  describe('E. statements that carry several defects', () => {
    for (const row of MULTI_ROWS) {
      it(`${row.name}`, () => {
        const report = coach(row.text);
        const counts = countByCheck(report.findings);
        for (const id of row.expect) {
          expect(counts[id] ?? 0, `${row.name}: expected ${id}`).toBeGreaterThan(0);
        }
        for (const finding of report.findings) {
          expect(finding.remedies.length > 0 || Boolean(finding.question)).toBe(true);
        }
      });
    }
  });
});
