import { describe, it, expect } from 'vitest';
import { EVIDENCE_MARKER } from '../src/core/triad.js';
import { parseChecklist, verifyChecklist, resolveTrace } from '../src/core/checklist.js';

const checklist = [
  '# Checklist — fixture',
  '',
  '- [ ] CHK-001 — endpoint returns 201',
  '  - predicate: cmd `test -f package.json`',
  '- [x] CHK-002 — contract artifact exists',
  '  - predicate: artifact `.sdd/specs/fixture/requirements.md`',
  '- [ ] CHK-003 — traceability link',
  '  - predicate: trace `REQ-FIX-001 -> TEST-FIX-001`',
  '',
].join('\n');

const okCommand = () => ({ exitCode: 0, stdout: 'ok', stderr: '' });
const readAnything = () => 'artifact content';

describe('core/checklist — parsing', () => {
  it('reads items, predicates, checkbox state and recorded evidence', () => {
    const parsed = parseChecklist(checklist);
    expect(parsed.items).toHaveLength(3);
    expect(parsed.items[0].id).toBe('CHK-001');
    expect(parsed.items[0].title).toBe('endpoint returns 201');
    expect(parsed.items[0].predicates).toEqual([{ kind: 'cmd', value: 'test -f package.json', line: 4 }]);
    expect(parsed.items[1].checked).toBe(true);
    expect(parsed.problems).toEqual([]);
  });

  it('reports an item with no predicate as a problem instead of guessing', () => {
    const parsed = parseChecklist(['- [ ] CHK-009 — vague', '  - notes: not a predicate'].join('\n'));
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0].reason).toContain('declares no predicate');
  });

  it('rejects an unknown predicate kind by name', () => {
    const parsed = parseChecklist(['- [ ] CHK-010 — x', '  - predicate: manual `do it by hand`'].join('\n'));
    expect(parsed.problems[0].reason).toContain('does not declare a kind');
  });
});

describe('core/checklist — verify', () => {
  it('executes cmd predicates and records a digest as evidence in the triad format', () => {
    const result = verifyChecklist({ markdown: checklist, runCommand: okCommand, readFile: readAnything });
    expect(result.failures).toEqual([]);
    expect(result.content).toContain(EVIDENCE_MARKER);
    expect(result.content).toContain('sha256:');
    expect(result.evidenceMarker).toBe(EVIDENCE_MARKER);
  });

  it('fails a completed item with no recorded digest', () => {
    const markdown = ['- [x] CHK-001 — artifact missing', '  - predicate: artifact `missing.md`'].join('\n');
    const result = verifyChecklist({ markdown, runCommand: okCommand, readFile: () => null, exists: () => false });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toBe('marked complete with no recorded digest');

    const noPredicate = ['- [x] CHK-002 — no check at all'].join('\n');
    const second = verifyChecklist({ markdown: noPredicate, runCommand: okCommand });
    expect(second.failures[0].reason).toContain('without declaring any predicate');
  });

  it('fails a completed item whose predicate fails', () => {
    const markdown = ['- [x] CHK-001 — broken', '  - predicate: cmd `exit 1`'].join('\n');
    const result = verifyChecklist({ markdown, runCommand: () => ({ exitCode: 1, stdout: '', stderr: 'boom' }) });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toContain('predicate failed');
  });

  it('cannot verify a property predicate without a property runner', () => {
    const markdown = ['- [x] CHK-001 — property', '  - predicate: property `no duplicate ids`'].join('\n');
    const result = verifyChecklist({ markdown, runCommand: okCommand });
    expect(result.failures[0].reason).toContain('no recorded digest');
    expect(result.results[0].outcomes[0].executed).toBe(false);

    const withRunner = verifyChecklist({
      markdown,
      runCommand: okCommand,
      propertyRunner: () => ({ ok: true, detail: 'holds' }),
    });
    expect(withRunner.failures).toEqual([]);
  });

  it('reads artifact predicates through the injected reader', () => {
    const markdown = ['- [x] CHK-001 — artifact', '  - predicate: artifact `requirements.md`'].join('\n');
    const result = verifyChecklist({
      markdown,
      runCommand: okCommand,
      readFile: (file) => (file === 'requirements.md' ? 'shall do the thing' : null),
    });
    expect(result.failures).toEqual([]);
    expect(result.content).toContain(EVIDENCE_MARKER);
  });

  it('leaves pending items unproven without failing', () => {
    const markdown = ['- [ ] CHK-001 — pending', '  - predicate: cmd `exit 0`'].join('\n');
    const result = verifyChecklist({ markdown, runCommand: () => ({ exitCode: 0, stdout: '', stderr: '' }) });
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(1);
  });

  it('marks a recorded digest that no longer matches as stale', () => {
    const first = verifyChecklist({ markdown: checklist, runCommand: okCommand, readFile: readAnything });
    const second = verifyChecklist({
      markdown: first.content,
      runCommand: () => ({ exitCode: 0, stdout: 'changed output', stderr: '' }),
      readFile: readAnything,
    });
    expect(second.stale.length).toBeGreaterThan(0);
  });

  it('is idempotent: verifying the recorded content leaves no failure', () => {
    const first = verifyChecklist({ markdown: checklist, runCommand: okCommand, readFile: readAnything });
    const second = verifyChecklist({ markdown: first.content, runCommand: okCommand, readFile: readAnything });
    expect(second.failures).toEqual([]);
    expect(second.content).toBe(first.content);
  });

  it('resolves trace predicates against the artifacts', () => {
    const artifacts = [{ file: 'tasks.md', text: '- [ ] 1. do it — _Requirements: REQ-FIX-001_ — TEST-FIX-001' }];
    const good = resolveTrace('REQ-FIX-001 -> TEST-FIX-001', artifacts);
    expect(good.ok).toBe(true);
    const missing = resolveTrace('REQ-FIX-001 -> TEST-GONE-999', artifacts);
    expect(missing.ok).toBe(false);
    expect(missing.detail).toContain('TEST-GONE-999');
  });
});
