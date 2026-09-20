import { describe, it, expect } from 'vitest';
import {
  WAVE_INVARIANTS,
  resolveWave,
  checkScope,
  planWorktrees,
  waveGitCommands,
  detectClaimConflicts,
  isClaimLive,
  type WavePlan,
  type FileClaim,
} from '../src/core/waves.js';

const plan: WavePlan = {
  feature: 'checkout',
  waveIndex: 2,
  integrationBranch: 'main',
  waveBranch: 'wave/checkout-2',
  tasks: [
    { id: '2.1', title: 'api', scope: ['src/api/'] },
    { id: '2.2', title: 'ui', scope: ['src/ui/checkout.ts'] },
    { id: '2.3', title: 'docs', scope: ['docs/'] },
  ],
  declaredScope: ['src/api/', 'src/ui/checkout.ts', 'docs/'],
};

describe('core/waves — atomic wave resolution (§7.2)', () => {
  it('merges the whole wave when every task passes', () => {
    const outcome = resolveWave(plan, [
      { taskId: '2.1', gatesPassed: true },
      { taskId: '2.2', gatesPassed: true },
      { taskId: '2.3', gatesPassed: true },
    ]);
    expect(outcome.state).toBe('merged');
    expect(outcome.intermediateObservable).toBe(false);
    expect(outcome.detail).toContain('main');
  });

  it('one failing task discards the WHOLE wave, including the tasks that passed', () => {
    const outcome = resolveWave(plan, [
      { taskId: '2.1', gatesPassed: true },
      { taskId: '2.2', gatesPassed: false },
      { taskId: '2.3', gatesPassed: true },
    ]);
    expect(outcome.state).toBe('discarded');
    expect(outcome.detail).toContain('2.2');
    expect(outcome.detail).toContain('incluidos los que pasaron');
  });

  it('never exposes an intermediate state to the repository, pass or fail', () => {
    const allPass = resolveWave(plan, plan.tasks.map((t) => ({ taskId: t.id, gatesPassed: true })));
    const oneFail = resolveWave(plan, [
      { taskId: '2.1', gatesPassed: true },
      { taskId: '2.2', gatesPassed: false },
    ]);
    expect(allPass.intermediateObservable).toBe(false);
    expect(oneFail.intermediateObservable).toBe(false);
  });

  it('states the atomicity property among the wave invariants', () => {
    expect(WAVE_INVARIANTS.join(' ')).toContain('no partial merge');
    expect(WAVE_INVARIANTS.join(' ')).toContain('Rollback is absence');
  });

  it('discards when every task fails', () => {
    const outcome = resolveWave(plan, plan.tasks.map((t) => ({ taskId: t.id, gatesPassed: false })));
    expect(outcome.state).toBe('discarded');
    expect(outcome.detail).toContain('3 tarea(s) fallaron');
  });
});

describe('core/waves — scope containment and worktrees', () => {
  it('accepts a changed file inside the declared scope', () => {
    const r = checkScope(plan.tasks[0], ['src/api/routes.ts']);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('flags a changed file outside the declared scope', () => {
    const r = checkScope(plan.tasks[0], ['src/api/routes.ts', 'src/db/schema.ts']);
    expect(r.ok).toBe(false);
    expect(r.violations).toEqual(['src/db/schema.ts']);
  });

  it('normalises ./ prefixes and matches exact files', () => {
    expect(checkScope(plan.tasks[1], ['./src/ui/checkout.ts']).ok).toBe(true);
    expect(checkScope(plan.tasks[1], ['src/ui/checkout.tsx']).ok).toBe(false);
  });

  it('plans one worktree per task with its own branch and provenance identity', () => {
    const assignments = planWorktrees(plan, '.wt');
    expect(assignments).toHaveLength(3);
    expect(assignments[0]).toEqual({
      taskId: '2.1',
      worktreePath: '.wt/checkout-w2-2.1',
      branch: 'wave/checkout-2/2.1',
      identity: 'checkout#w2#2.1',
    });
  });

  it('materialises the wave with git primitives only', () => {
    const commands = waveGitCommands(plan, planWorktrees(plan));
    expect(commands.create[0]).toBe('git branch wave/checkout-2 main');
    expect(commands.create).toHaveLength(4);
    // whole wave or nothing: exactly one merge of the wave branch
    expect(commands.merge.filter((c) => c.startsWith('git merge'))).toHaveLength(1);
    expect(commands.merge[1]).toContain('--no-ff wave/checkout-2');
    // rollback is absence: discard the worktrees and the branches
    expect(commands.discard).toHaveLength(7);
    expect(commands.discard).toContain('git branch -D wave/checkout-2');
  });
});

describe('core/waves — O7 claim overlap with TTL', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');
  const claim = (owner: string, grantedAt: string, ttlMs: number, path = 'src/a.ts'): FileClaim => ({
    path,
    owner,
    grantedAt,
    ttlMs,
  });

  it('treats a claim as live until its TTL elapses', () => {
    expect(isClaimLive(claim('a', '2026-01-01T11:59:00.000Z', 120_000), now)).toBe(true);
    expect(isClaimLive(claim('a', '2026-01-01T11:00:00.000Z', 60_000), now)).toBe(false);
  });

  it('detects two live claims on the same path before a race exists', () => {
    const conflicts = detectClaimConflicts(
      [
        claim('agent-a', '2026-01-01T11:59:00.000Z', 120_000),
        claim('agent-b', '2026-01-01T11:59:30.000Z', 120_000),
      ],
      now,
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].path).toBe('src/a.ts');
    expect(conflicts[0].holders.sort()).toEqual(['agent-a', 'agent-b']);
  });

  it('ignores stale claims so a crashed agent does not block the swarm forever', () => {
    const conflicts = detectClaimConflicts(
      [
        claim('agent-a', '2026-01-01T11:00:00.000Z', 60_000),
        claim('agent-b', '2026-01-01T11:00:00.000Z', 60_000),
      ],
      now,
    );
    expect(conflicts).toEqual([]);
  });

  it('reports no conflict when live claims cover different paths', () => {
    const conflicts = detectClaimConflicts(
      [
        claim('agent-a', '2026-01-01T11:59:00.000Z', 120_000, 'src/a.ts'),
        claim('agent-b', '2026-01-01T11:59:00.000Z', 120_000, 'src/b.ts'),
      ],
      now,
    );
    expect(conflicts).toEqual([]);
  });
});
