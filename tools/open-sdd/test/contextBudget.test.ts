import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { estimateTokens, measureContextBudget, skillDescription } from '../src/core/contextBudget.js';
import { handleContextReportCommand } from '../src/cli/commands/contextReport.js';
import type { CliIO } from '../src/cli/io.js';

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const seed = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'open-sdd-ctx-'));
  temps.push(root);
  await writeFile(path.join(root, 'CLAUDE.md'), 'x'.repeat(400), 'utf8'); // 100 tokens, always
  const skill = path.join(root, '.claude', 'skills', 'sdd-demo');
  await mkdir(skill, { recursive: true });
  await writeFile(path.join(skill, 'SKILL.md'), `---\nname: sdd-demo\ndescription: ${'d'.repeat(40)}\n---\n${'b'.repeat(800)}\n`, 'utf8');
  return root;
};

const makeIO = () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const io: CliIO = { log: (m) => logs.push(m), error: (m) => errors.push(m), exit: () => undefined };
  return { io, logs, errors };
};

describe('core/contextBudget', () => {
  it('splits always-loaded (root file + skill descriptions) from on-demand (skill bodies)', async () => {
    const report = await measureContextBudget(await seed());
    const claude = report.surfaces.find((s) => s.path === 'CLAUDE.md')!;
    const skills = report.surfaces.find((s) => s.path === '.claude/skills')!;
    expect(claude.always).toBe(100);
    expect(skills.always).toBe(estimateTokens('d'.repeat(40)));
    expect(skills.onDemand).toBeGreaterThan(200);
    expect(report.totals.always).toBe(110);
    expect(report.rule).toContain('estimate');
  });

  it('reads a folded multi-line description', () => {
    expect(skillDescription('---\nname: a\ndescription: one\n  two\nother: x\n---\nbody')).toBe('one two');
    expect(skillDescription('no frontmatter')).toBe('');
  });

  it('an empty repository costs 0', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'open-sdd-ctx-empty-'));
    temps.push(root);
    expect((await measureContextBudget(root)).totals).toEqual({ always: 0, onDemand: 0, files: 0 });
  });
});

describe('open-sdd context --report', () => {
  it('reports with exit 0, fails over --budget with exit 1, and refuses a bad budget with 2', async () => {
    const root = await seed();
    const plain = makeIO();
    expect(await handleContextReportCommand(['--report'], plain.io, root)).toBe(0);
    expect(plain.logs.join('\n')).toContain('.claude/skills');
    expect(await handleContextReportCommand(['--report', '--budget', '50'], makeIO().io, root)).toBe(1);
    expect(await handleContextReportCommand(['--report', '--budget', '5000'], makeIO().io, root)).toBe(0);
    expect(await handleContextReportCommand(['--report', '--budget', 'lots'], makeIO().io, root)).toBe(2);
    const json = makeIO();
    expect(await handleContextReportCommand(['--report', '--budget', '50', '--json'], json.io, root)).toBe(1);
    expect(JSON.parse(json.logs.join('\n')).findings.errors[0].id).toBe('CONTEXT-OVER-BUDGET');
  });
});
