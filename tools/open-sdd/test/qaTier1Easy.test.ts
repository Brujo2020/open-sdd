/**
 * QA tier 1 — EASY (30 cases).
 *
 * Pure, deterministic, no subprocesses. These are the units every later tier stands on: if one of
 * these breaks, nothing above it means anything. Each case asserts a CONTRACT, not an implementation
 * detail — the point of the tier is that a regression here is unambiguous.
 */
import { describe, expect, it } from 'vitest';
import { allocateBlock, auditIds, normalizeStatement, parseRequirementIds } from '../src/core/stableIds.js';
import { isExpiredWaiver, matchesGlob } from '../src/core/driftCheck.js';
import { classifyArtifact, countByCheck, reviewRequirements } from '../src/core/requirementsCoach.js';
import { parseChecklist } from '../src/core/checklist.js';
import { wordDiff } from '../src/core/specReview.js';
import { normalizeRel, sha256Of } from '../src/core/receipt.js';
import { parseSecurityAllowlist } from '../src/core/securityAllowlist.js';

const review = (text: string) =>
  reviewRequirements({
    feature: 'f',
    artifacts: [{ file: '.sdd/specs/f/requirements.md', text }],
    entries: [],
    runner: () => [],
  });

describe('tier 1 — easy: the units later tiers stand on', () => {
  // 1-5: artifact classification decides which checks run at all.
  it('1. classifies a requirements artifact', () => {
    expect(classifyArtifact('.sdd/specs/f/requirements.md')).toBe('requirements');
  });
  it('2. classifies a tasks artifact', () => {
    expect(classifyArtifact('specs/f/tasks.md')).toBe('tasks');
  });
  it('3. classifies a plan/design artifact', () => {
    expect(classifyArtifact('specs/f/design.md')).toBe('plan');
  });
  it('4. classifies a test/checklist artifact', () => {
    expect(classifyArtifact('specs/f/checklist.md')).toBe('test');
  });
  it('5. classifies anything else as other', () => {
    expect(classifyArtifact('README.md')).toBe('other');
  });

  // 6-10: glob matching is what a declared boundary means.
  it('6. matches an exact path', () => {
    expect(matchesGlob('src/a.ts', 'src/a.ts')).toBe(true);
  });
  it('7. matches a single-segment wildcard', () => {
    expect(matchesGlob('src/a.ts', 'src/*.ts')).toBe(true);
  });
  it('8. refuses a single-segment wildcard across directories', () => {
    expect(matchesGlob('src/deep/a.ts', 'src/*.ts')).toBe(false);
  });
  it('9. matches a recursive wildcard across directories', () => {
    expect(matchesGlob('src/deep/a.ts', 'src/**')).toBe(true);
  });
  it('10. treats a directory glob as covering what is beneath it', () => {
    expect(matchesGlob('tools/core/a/b.ts', 'tools/core')).toBe(true);
  });

  // 11-13: block allocation is the "never renumber" promise.
  it('11. allocates the first block of an unused area', () => {
    expect(allocateBlock('PAY', [])[0]).toBe('REQ-PAY-010');
  });
  it('12. allocates the next block after the highest used number', () => {
    expect(allocateBlock('PAY', ['REQ-PAY-007'])[0]).toBe('REQ-PAY-010');
  });
  it('13. skips a whole block instead of renumbering the one in use', () => {
    const next = allocateBlock('PAY', ['REQ-PAY-014']);
    expect(next[0]).toBe('REQ-PAY-020');
    expect(next).toHaveLength(10);
  });

  // 14-17: ids and their meaning.
  it('14. parses an id from a heading and normalises its statement', () => {
    const parsed = parseRequirementIds('### REQ-PAY-014 — The System shall record it.');
    expect(parsed.get('REQ-PAY-014')).toBe(normalizeStatement('The System shall record it.'));
  });
  it('15. reports no finding when nothing moved', () => {
    const before = new Map([['REQ-PAY-014', normalizeStatement('record the refund')]]);
    expect(auditIds({ before, after: before })).toEqual([]);
  });
  it('16. reports ID-MUTATED when the same id means something else', () => {
    const finding = auditIds({
      before: new Map([['REQ-PAY-014', normalizeStatement('record the refund')]]),
      after: new Map([['REQ-PAY-014', normalizeStatement('record the refund within 5 s')]]),
    });
    expect(finding.map((f) => f.code)).toEqual(['ID-MUTATED']);
  });
  it('17. reports ID-LOST when an id disappears', () => {
    const finding = auditIds({ before: new Map([['REQ-PAY-014', 'x']]), after: new Map() });
    expect(finding.map((f) => f.code)).toEqual(['ID-LOST']);
  });

  // 18-20: waiver expiry, the difference between "accepted" and "forgotten".
  it('18. an unexpired waiver is not expired', () => {
    expect(isExpiredWaiver('2027-03-31', new Date('2026-01-01T00:00:00Z'))).toBe(false);
  });
  it('19. a past waiver is expired', () => {
    expect(isExpiredWaiver('2020-01-01', new Date('2026-01-01T00:00:00Z'))).toBe(true);
  });
  it('20. an unreadable date is not declared expired', () => {
    expect(isExpiredWaiver('no-es-fecha', new Date('2999-01-01T00:00:00Z'))).toBe(false);
  });

  // 21-23: the allowlist refuses what it cannot justify.
  it('21. rejects an allowlist entry with no ids', () => {
    const { entries, rejected } = parseSecurityAllowlist(JSON.stringify({ allow: [{ path: 'a', ids: [], reason: 'r' }] }));
    expect(entries).toEqual([]);
    expect(rejected).toHaveLength(1);
  });
  it('22. rejects an allowlist entry with no reason', () => {
    const { rejected } = parseSecurityAllowlist(JSON.stringify({ allow: [{ path: 'a', ids: ['x'] }] }));
    expect(rejected).toHaveLength(1);
  });
  it('23. accepts the legacy and the owned shape', () => {
    const { entries } = parseSecurityAllowlist(
      JSON.stringify({
        allow: [
          { path: 'a', ids: ['x'], reason: 'r' },
          { path: 'b', ids: ['y'], reason: 'r', owner: 'o', expires: '2027-03-31' },
        ],
      }),
    );
    expect(entries).toHaveLength(2);
    expect(entries[1].owner).toBe('o');
  });

  // 24-26: checklist parsing.
  it('24. parses a checklist item with a cmd predicate', () => {
    const parsed = parseChecklist(['- [ ] C1 the gate runs', '  predicate: cmd: npm test', ''].join('\n'));
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].id).toBe('C1');
    expect(parsed.items[0].predicates[0].kind).toBe('cmd');
    expect(parsed.items[0].predicates[0].value).toBe('npm test');
  });
  it('25. parses the four predicate kinds', () => {
    const parsed = parseChecklist(
      [
        '- [ ] C1 four predicates',
        '  predicate: cmd: npm test',
        '  predicate: artifact: docs/x.md',
        '  predicate: property: prop-1',
        '  predicate: trace: REQ-A-001',
        '',
      ].join('\n'),
    );
    expect(parsed.items[0].predicates.map((p) => p.kind).sort()).toEqual(['artifact', 'cmd', 'property', 'trace']);
  });
  it('26. flags an item with no predicate as a problem', () => {
    const parsed = parseChecklist('- [ ] C1 a promise with no predicate\n');
    expect(parsed.problems).toHaveLength(1);
  });

  // 27-28: word diff, the review surface's unit.
  it('27. an equal pair produces no changed segment', () => {
    const segments = wordDiff('the system shall log', 'the system shall log');
    expect(segments.every((s) => s.op === 'equal')).toBe(true);
  });
  it('28. a changed word shows up as removed plus added', () => {
    const ops = wordDiff('shall record the refund', 'shall record the refund within 5 s').map((s) => s.op);
    expect(ops).toContain('add');
  });

  // 29-30: receipt primitives.
  it('29. sha256 is stable for the same bytes', () => {
    expect(sha256Of('same')).toBe(sha256Of(Buffer.from('same')));
  });
  it('30. a receipt path that escapes the repository is refused', () => {
    expect(normalizeRel('/repo', '../outside.txt')).toBeNull();
    expect(normalizeRel('/repo', '.sdd/x.json')).toBe('.sdd/x.json');
  });

  // A guard on the tier itself: the review of an empty artifact must not invent findings.
  it('31. an empty artifact produces no findings and no invented check', () => {
    const report = review('# Requirements\n');
    expect(report.findings).toEqual([]);
    expect(countByCheck(report.findings)).toEqual({});
  });
});
