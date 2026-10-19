import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildTaskDependencyWaves,
  createSchedulePlan,
  runCli,
  type TaskItem,
} from '../src/index.js';

const runtime = { platform: 'darwin' } as const;

const makeIO = () => {
  const logs: string[] = [];
  const errs: string[] = [];
  let exitCode: number | null = null;
  return {
    io: {
      log: (m: string) => logs.push(m),
      error: (m: string) => errs.push(m),
      exit: (c: number) => {
        exitCode = c;
      },
    },
    get logs() {
      return logs;
    },
    get errs() {
      return errs;
    },
    get exitCode() {
      return exitCode;
    },
  };
};

describe('Core Scheduler - Parallel Wave Engine', () => {
  it('schedules independent tasks into a single parallel wave', () => {
    const tasks: TaskItem[] = [
      { id: '1.1', title: 'Task 1.1', status: 'pending', boundary: ['src/a.ts'], raw: '' },
      { id: '1.2', title: 'Task 1.2', status: 'pending', boundary: ['src/b.ts'], raw: '' },
      { id: '1.3', title: 'Task 1.3', status: 'pending', boundary: ['src/c.ts'], raw: '' },
    ];

    const waves = buildTaskDependencyWaves(tasks, { maxParallel: 4 });
    expect(waves.length).toBe(1);
    expect(waves[0].isParallel).toBe(true);
    expect(waves[0].tasks.length).toBe(3);
    expect(waves[0].boundaries).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('respects topological dependency order across waves', () => {
    const tasks: TaskItem[] = [
      { id: '1.1', title: 'Task 1.1', status: 'pending', raw: '' },
      { id: '1.2', title: 'Task 1.2', status: 'pending', raw: '' },
      { id: '2.1', title: 'Task 2.1', status: 'pending', depends: ['1.1', '1.2'], raw: '' },
      { id: '3.1', title: 'Task 3.1', status: 'pending', depends: ['2.1'], raw: '' },
    ];

    const waves = buildTaskDependencyWaves(tasks, { maxParallel: 4 });
    expect(waves.length).toBe(3);
    expect(waves[0].waveIndex).toBe(1);
    expect(waves[0].tasks.map((t) => t.id)).toEqual(['1.1', '1.2']);
    expect(waves[1].tasks.map((t) => t.id)).toEqual(['2.1']);
    expect(waves[2].tasks.map((t) => t.id)).toEqual(['3.1']);
  });

  it('partitions tasks with overlapping boundaries into separate waves to prevent race conditions', () => {
    const tasks: TaskItem[] = [
      { id: '1.1', title: 'Modify core A', status: 'pending', boundary: ['src/shared.ts', 'src/a.ts'], raw: '' },
      { id: '1.2', title: 'Modify core B', status: 'pending', boundary: ['src/shared.ts', 'src/b.ts'], raw: '' },
      { id: '1.3', title: 'Modify core C', status: 'pending', boundary: ['src/c.ts'], raw: '' },
    ];

    // 1.1 and 1.2 both touch src/shared.ts, so they CANNOT run simultaneously.
    // 1.3 touches src/c.ts, so it can run alongside 1.1 in Wave 1.
    const waves = buildTaskDependencyWaves(tasks, { maxParallel: 4 });
    expect(waves.length).toBe(2);

    const wave1Ids = waves[0].tasks.map((t) => t.id);
    expect(wave1Ids).toContain('1.1');
    expect(wave1Ids).toContain('1.3');
    expect(wave1Ids).not.toContain('1.2');

    const wave2Ids = waves[1].tasks.map((t) => t.id);
    expect(wave2Ids).toContain('1.2');
  });

  it('respects maxParallel limit', () => {
    const tasks: TaskItem[] = [
      { id: '1', title: 'Task 1', status: 'pending', boundary: ['f1.ts'], raw: '' },
      { id: '2', title: 'Task 2', status: 'pending', boundary: ['f2.ts'], raw: '' },
      { id: '3', title: 'Task 3', status: 'pending', boundary: ['f3.ts'], raw: '' },
      { id: '4', title: 'Task 4', status: 'pending', boundary: ['f4.ts'], raw: '' },
    ];

    const waves = buildTaskDependencyWaves(tasks, { maxParallel: 2 });
    expect(waves.length).toBe(2);
    expect(waves[0].tasks.length).toBe(2);
    expect(waves[1].tasks.length).toBe(2);
  });

  it('handles circular dependencies gracefully without infinite loop', () => {
    const tasks: TaskItem[] = [
      { id: 'A', title: 'Task A', status: 'pending', depends: ['B'], raw: '' },
      { id: 'B', title: 'Task B', status: 'pending', depends: ['A'], raw: '' },
    ];

    const waves = buildTaskDependencyWaves(tasks);
    expect(waves.length).toBe(2);
  });

  it('skips already completed tasks in pending list', () => {
    const markdown = `# Tasks
- [x] 1.1 Done task _Boundary:_ \`src/done.ts\`
- [ ] 2.1 Pending task _Depends:_ 1.1 _Boundary:_ \`src/pending.ts\`
`;
    const plan = createSchedulePlan('my-feature', markdown);
    expect(plan.totalTasks).toBe(2);
    expect(plan.pendingTasks).toBe(1);
    expect(plan.waves.length).toBe(1);
    expect(plan.waves[0].tasks[0].id).toBe('2.1');
  });
});

describe('CLI - open-sdd impl command', () => {
  it('outputs formatted execution schedule for a feature', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'sdd-cli-impl-'));
    const specDir = path.join(cwd, '.sdd', 'specs', 'parallel-feat');
    await mkdir(specDir, { recursive: true });

    const tasksMd = `# Tasks: Parallel Feat
- [ ] 1.1 Database layer _Boundary:_ \`src/db.ts\`
- [ ] 1.2 Auth layer _Boundary:_ \`src/auth.ts\`
- [ ] 2.1 API endpoints _Depends:_ 1.1, 1.2 _Boundary:_ \`src/api.ts\`
`;
    await writeFile(path.join(specDir, 'tasks.md'), tasksMd, 'utf8');

    const ctx = makeIO();
    const code = await runCli(['impl', 'parallel-feat'], runtime, ctx.io, {}, { cwd });
    expect(code).toBe(0);

    const output = ctx.logs.join('\n');
    expect(output).toMatch(/Parallel Execution Schedule:.*parallel-feat/);
    expect(output).toMatch(/Execution Waves:\s+2/);
    expect(output).toMatch(/Wave 1.*\[PARALLEL: 2 subagents\]/);
    expect(output).toMatch(/Wave 2.*\[SEQUENTIAL\]/);
    expect(output).toMatch(/\/sdd-impl parallel-feat --parallel/);
  });

  it('supports --json flag for programmatic consumption', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'sdd-cli-impl-json-'));
    const specDir = path.join(cwd, '.sdd', 'specs', 'json-feat');
    await mkdir(specDir, { recursive: true });

    const tasksMd = `# Tasks
- [ ] 1.1 Task A _Boundary:_ \`src/a.ts\`
- [ ] 1.2 Task B _Boundary:_ \`src/b.ts\`
`;
    await writeFile(path.join(specDir, 'tasks.md'), tasksMd, 'utf8');

    const ctx = makeIO();
    const code = await runCli(['impl', 'json-feat', '--json'], runtime, ctx.io, {}, { cwd });
    expect(code).toBe(0);

    const parsed = JSON.parse(ctx.logs.join('\n'));
    expect(parsed.feature).toBe('json-feat');
    expect(parsed.totalTasks).toBe(2);
    expect(parsed.maxConcurrency).toBe(2);
    expect(parsed.waves.length).toBe(1);
    expect(parsed.waves[0].tasks.length).toBe(2);
  });

  it('fails gracefully when tasks.md is missing', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'sdd-cli-impl-missing-'));
    const ctx = makeIO();
    const code = await runCli(['impl', 'nonexistent'], runtime, ctx.io, {}, { cwd });
    expect(code).toBe(1);
    expect(ctx.errs.join('\n')).toMatch(/No tasks\.md found/);
  });
});
