/**
 * wave-2 — improvements (REQ-W2-010 … 013). Fixtures in `mkdtemp`; nothing is written to the repo.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadFeatureTrace, renderHtmlReport, renderMermaid } from '../src/core/trace.js';
import { renderBadge } from '../src/core/badge.js';
import { renderGateSummary } from '../src/core/gateSummary.js';
import { planVscodeTasks } from '../src/core/vscodeTasks.js';
import { shouldEmitScoreFooter } from '../src/cli/jsonOut.js';
import { handleInsightCommand } from '../src/cli/commands/insight.js';
import { handleGatesCommand } from '../src/cli/commands/paper.js';

const tempDirs: string[] = [];
afterEach(async () => {
  while (tempDirs.length > 0) await rm(tempDirs.pop() as string, { recursive: true, force: true });
});

const makeIO = () => {
  const logs: string[] = [];
  const errs: string[] = [];
  return { io: { log: (m: string) => logs.push(m), error: (m: string) => errs.push(m), exit: () => undefined }, logs, errs };
};

const REQUIREMENTS = `# Requirements — demo

### REQ-DEMO-001 — Login

- Statement: WHEN a user submits valid credentials, the [api] shall return 200.

### REQ-DEMO-002 — Logout

- Statement: WHEN a user logs out, the [api] shall revoke the session.

### REQ-DEMO-003 — Audit <b>

- Statement: The [api] shall log every login.
`;

const TASKS = `# Tasks

- [x] 1. Login endpoint — _Requirements: REQ-DEMO-001_
  - _Evidence: 4 tests in login.test.ts_
- [-] 2. Logout endpoint — _Requirements: REQ-DEMO-002_
- [ ] 3. Docs
`;

const makeRepo = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-w2i-'));
  tempDirs.push(dir);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const spec = path.join(dir, '.sdd', 'specs', 'demo');
  await mkdir(spec, { recursive: true });
  await writeFile(path.join(spec, 'requirements.md'), REQUIREMENTS);
  await writeFile(path.join(spec, 'tasks.md'), TASKS);
  return dir;
};

describe('REQ-W2-011 — trace', () => {
  it('links tasks to requirements, names gaps, keeps evidence', async () => {
    const trace = await loadFeatureTrace(await makeRepo(), '.sdd', 'demo');
    expect(trace?.requirements.map((r) => r.id)).toEqual(['REQ-DEMO-001', 'REQ-DEMO-002', 'REQ-DEMO-003']);
    expect(trace?.tasks.map((t) => [t.id, t.status, t.requirements])).toEqual([
      ['1', 'completed', ['REQ-DEMO-001']],
      ['2', 'in_progress', ['REQ-DEMO-002']],
      ['3', 'pending', []],
    ]);
    expect(trace?.tasks[0].evidence).toEqual(['4 tests in login.test.ts']);
    expect(trace?.uncovered).toEqual(['REQ-DEMO-003']);
    expect(trace?.unlinked).toEqual(['3']);
  });

  it('renders a Mermaid flowchart with an edge per citation and the gap classed', async () => {
    const mermaid = renderMermaid((await loadFeatureTrace(await makeRepo(), '.sdd', 'demo'))!);
    expect(mermaid.startsWith('flowchart LR\n')).toBe(true);
    expect(mermaid).toContain('R_REQ_DEMO_001 --> T_1');
    expect(mermaid).toContain('class R_REQ_DEMO_003 gap;');
    expect(mermaid).not.toContain('<b>');
  });

  it('exits 1 while a requirement is uncovered', async () => {
    const dir = await makeRepo();
    const ctx = makeIO();
    expect(await handleInsightCommand('trace', ['demo'], ctx.io, dir)).toBe(1);
    expect(ctx.logs.join('\n')).toContain('REQ-DEMO-003');
  });

  it('explain names the definition and the citing task', async () => {
    const dir = await makeRepo();
    const ctx = makeIO();
    expect(await handleInsightCommand('explain', ['REQ-DEMO-001', '--json'], ctx.io, dir)).toBe(0);
    const out = JSON.parse(ctx.logs.join('\n')) as { definitions: { feature: string; tasks: { id: string }[] }[] };
    expect(out.definitions[0].feature).toBe('demo');
    expect(out.definitions[0].tasks.map((t) => t.id)).toEqual(['1']);
    expect(await handleInsightCommand('explain', ['REQ-NOPE-1'], makeIO().io, dir)).toBe(1);
  });
});

describe('REQ-W2-012 — badge and HTML report', () => {
  it('the badge is deterministic SVG carrying the score', () => {
    const svg = renderBadge(87);
    expect(svg).toBe(renderBadge(87));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('aria-label="SDD: 87%"');
  });

  it('the report is self-contained and escapes spec text', async () => {
    const html = renderHtmlReport((await loadFeatureTrace(await makeRepo(), '.sdd', 'demo'))!, { generatedAt: 'T', score: 90 });
    expect(html).not.toMatch(/<script|https?:\/\/(?!www\.w3)/);
    expect(html).toContain('Audit &lt;b&gt;');
    expect(html).toContain('4 tests in login.test.ts');
  });

  it('artifact output never carries the score footer', () => {
    expect(shouldEmitScoreFooter(['badge'])).toBe(false);
    expect(shouldEmitScoreFooter(['report', 'demo', '--html'])).toBe(false);
    expect(shouldEmitScoreFooter(['trace', 'demo', '--mermaid'])).toBe(false);
    expect(shouldEmitScoreFooter(['trace', 'demo'])).toBe(true);
  });

  it('--out writes the file', async () => {
    const dir = await makeRepo();
    expect(await handleInsightCommand('report', ['demo', '--html', '--out', 'r.html'], makeIO().io, dir)).toBe(0);
    expect(await readFile(path.join(dir, 'r.html'), 'utf8')).toContain('<!doctype html>');
  });
});

describe('REQ-W2-010 — gate summary', () => {
  it('renders one row per finding and the verdict', () => {
    const md = renderGateSummary(
      { feature: 'f', regime: 'flexible' as never, passed: false, unavailable: ['C5'], findings: [
        { gateId: 'C2', outcome: 'fail', detail: 'secret | found', authority: 'C2' },
      ] },
      { profile: 'solo', strict: false, mode: 'diff', names: { C2: 'Security' } },
    );
    expect(md).toContain('does NOT pass');
    expect(md).toContain('| C2 | Security | ❌ fail | secret \\| found |');
    expect(md).toContain('C5');
  });

  it('--summary without a path and without $GITHUB_STEP_SUMMARY fails before running', async () => {
    const dir = await makeRepo();
    const saved = process.env.GITHUB_STEP_SUMMARY;
    delete process.env.GITHUB_STEP_SUMMARY;
    try {
      const ctx = makeIO();
      expect(await handleGatesCommand(['run', 'C2', '--summary'], ctx.io, dir)).toBe(1);
      expect(ctx.errs.join('\n')).toContain('GITHUB_STEP_SUMMARY');
      expect(ctx.logs.join('\n')).not.toContain('Ejecutando');
    } finally {
      if (saved !== undefined) process.env.GITHUB_STEP_SUMMARY = saved;
    }
  });

  it('--summary=<path> appends the table', async () => {
    const dir = await makeRepo();
    expect(await handleGatesCommand(['run', 'C2', `--summary=${path.join(dir, 's.md')}`], makeIO().io, dir)).toBe(0);
    expect(await readFile(path.join(dir, 's.md'), 'utf8')).toContain('| C2 |');
  });
});

describe('REQ-W2-013 — VS Code tasks', () => {
  it('creates, merges by label, then keeps', () => {
    const created = planVscodeTasks(null);
    expect(created.action).toBe('create');
    const existing = JSON.stringify({ version: '2.0.0', tasks: [{ label: 'mine' }, { label: 'SDD: doctor', command: 'custom' }] });
    const merged = planVscodeTasks(existing);
    expect(merged.action).toBe('update');
    if (merged.action !== 'update') return;
    const doc = JSON.parse(merged.content) as { tasks: { label: string; command?: string }[] };
    expect(doc.tasks[0].label).toBe('mine');
    expect(doc.tasks.find((t) => t.label === 'SDD: doctor')?.command).toBe('custom');
    expect(merged.added).not.toContain('SDD: doctor');
    expect(planVscodeTasks(merged.content).action).toBe('keep');
  });

  it('refuses JSON with comments instead of deleting them', () => {
    expect(planVscodeTasks('// mine\n{"tasks":[]}').action).toBe('refused');
  });
});
