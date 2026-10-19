import { describe, it, expect } from 'vitest';
import { reviewSpec, renderSpecReview, wordDiff } from '../src/core/specReview.js';
import type { StandardFinding } from '../src/core/standardsTypes.js';

const noRunner = (): StandardFinding[] => [];

const baseText = [
  '# Requirements — fixture',
  '',
  '## Requirements',
  '',
  '### REQ-FIX-001 — logging',
  '- Statement: The System shall log each authentication failure to the Audit_Trail.',
  '',
  '### REQ-FIX-003 — body limit',
  '- Statement: The System shall reject a body larger than 255 characters with HTTP 400.',
  '',
  '### REQ-FIX-004 — metric',
  '- Statement: The System shall emit a metric for every request.',
].join('\n');

const currentText = [
  '# Requirements — fixture',
  '',
  '## Requirements',
  '',
  '### REQ-FIX-001 — logging',
  '- Statement: The System shall log each authentication failure to the Audit_Trail.',
  '',
  '### REQ-FIX-002 — health',
  '- Statement: The System shall expose a health endpoint returning HTTP 200.',
  '',
  '### REQ-FIX-003 — body limit',
  '- Statement: The System shall reject a body larger than 300 characters with HTTP 400.',
].join('\n');

const tasksText = [
  '- [ ] 1. implement logging — _Requirements: REQ-FIX-001, REQ-FIX-003_ — _Boundary:_ src/log.ts',
  '- [ ] 2. unrelated — _Boundary:_ src/other.ts',
].join('\n');

const input = (approvals: { approved: boolean }) => ({
  feature: 'fixture',
  base: 'HEAD~1',
  artifacts: [
    { file: '.sdd/specs/fixture/requirements.md', text: currentText },
    { file: '.sdd/specs/fixture/tasks.md', text: tasksText },
  ],
  baseArtifacts: [{ file: '.sdd/specs/fixture/requirements.md', text: baseText }],
  contracts: { tests: [{ id: 'TEST-FIX-003', file: 'test/log.test.ts', covers: ['REQ-FIX-003'] }] },
  runner: noRunner,
  entries: [],
  approvals,
});

describe('core/specReview — word diff', () => {
  it('marks removed and added words separately', () => {
    const diff = wordDiff('shall reject a body larger than 255 characters', 'shall reject a body larger than 300 characters');
    expect(diff.some((s) => s.op === 'remove' && s.text.includes('255'))).toBe(true);
    expect(diff.some((s) => s.op === 'add' && s.text.includes('300'))).toBe(true);
    expect(diff.some((s) => s.op === 'equal' && s.text.includes('characters'))).toBe(true);
  });
});

describe('core/specReview — the one page', () => {
  it('reports added, modified and removed requirements', () => {
    const result = reviewSpec(input({ approved: false }));
    const byChange = (change: string) => result.rows.filter((r) => r.change === change).map((r) => r.id).sort();
    expect(byChange('added')).toEqual(['REQ-FIX-002']);
    expect(byChange('modified')).toEqual(['REQ-FIX-003']);
    expect(byChange('removed')).toEqual(['REQ-FIX-004']);
    expect(result.summary).toMatchObject({ added: 1, modified: 1, removed: 1, unchanged: 1 });
  });

  it('attaches covering tasks and the tests that would fail', () => {
    const result = reviewSpec(input({ approved: false }));
    const modified = result.rows.find((r) => r.id === 'REQ-FIX-003');
    expect(modified?.tasks.length).toBeGreaterThan(0);
    expect(modified?.tasks[0]).toContain('implement logging');
    expect(modified?.failingTests).toEqual(['TEST-FIX-003 (test/log.test.ts)']);
    const added = result.rows.find((r) => r.id === 'REQ-FIX-002');
    expect(added?.tasks).toEqual([]);
    expect(added?.riskFactors).toContain('+8 no covering task');
  });

  it('exits non-zero when a requirement changed without approval', () => {
    const unapproved = reviewSpec(input({ approved: false }));
    expect(unapproved.exitCode).toBe(1);
    expect(unapproved.unapprovedChanges.map((r) => r.id).sort()).toEqual(['REQ-FIX-002', 'REQ-FIX-003', 'REQ-FIX-004']);

    const approved = reviewSpec(input({ approved: true }));
    expect(approved.exitCode).toBe(0);
    expect(approved.unapprovedChanges).toEqual([]);
  });

  it('honours per-requirement approval ids', () => {
    const partial = reviewSpec({
      ...input({ approved: true }),
      approvals: { approved: true, approvedIds: ['REQ-FIX-002'] },
    });
    expect(partial.exitCode).toBe(1);
    expect(partial.unapprovedChanges.map((r) => r.id).sort()).toEqual(['REQ-FIX-003', 'REQ-FIX-004']);
  });

  it('scores risk with named factors', () => {
    const result = reviewSpec(input({ approved: false }));
    for (const row of result.rows) {
      expect(row.risk).toBeGreaterThanOrEqual(0);
      expect(row.risk).toBeLessThanOrEqual(100);
      expect(row.riskFactors.length).toBeGreaterThan(0);
    }
    const removed = result.rows.find((r) => r.id === 'REQ-FIX-004');
    expect(removed?.riskFactors.some((f) => f.includes('removed'))).toBe(true);
    expect(result.summary.risk).toBeGreaterThan(0);
  });

  it('renders one page that reports changes and never certifies correctness', () => {
    const page = renderSpecReview(reviewSpec(input({ approved: false })));
    expect(page).toContain('ADDED · REQ-FIX-002');
    expect(page).toContain('MODIFIED · REQ-FIX-003');
    expect(page).toContain('REMOVED · REQ-FIX-004');
    expect(page).toContain('UNAPPROVED');
    expect(page).toContain('does not certify the specification');
    expect(page).toContain('[-255-]');
    expect(page).toContain('{+300+}');
  });

  it('treats the whole set as added when no base is supplied', () => {
    const result = reviewSpec({ ...input({ approved: true }), baseArtifacts: undefined });
    expect(result.rows.every((r) => r.change === 'added')).toBe(true);
  });
});
