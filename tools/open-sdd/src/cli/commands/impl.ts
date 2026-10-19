import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CliIO } from '../io.js';
import { colors, formatHeading, formatSuccess } from '../ui/colors.js';
import { createSchedulePlan } from '../../core/scheduler.js';
import { getSpecStatus, resolveSddDir } from '../../core/specManager.js';

export const handleImplCommand = async (
  argv: string[],
  io: CliIO,
  cwd: string = process.cwd(),
): Promise<number> => {
  const isJson = argv.includes('--json');
  const sddDirArg = argv.find((a) => a.startsWith('--sdd-dir='));
  const sddDir = sddDirArg ? sddDirArg.split('=')[1] : await resolveSddDir(cwd);

  const featureArg = argv.find((a) => !a.startsWith('-'));
  if (!featureArg) {
    io.error(colors.red('Usage: open-sdd impl <feature-slug> [--parallel] [--json]'));
    return 1;
  }

  const specDir = path.join(cwd, sddDir, 'specs', featureArg);
  const status = await getSpecStatus(cwd, featureArg, sddDir);

  if (!status.exists || !status.files.tasks) {
    io.error(colors.red(`No tasks.md found for "${featureArg}". Run /sdd-spec-tasks ${featureArg} first.`));
    return 1;
  }

  let tasksContent = '';
  try {
    tasksContent = await readFile(path.join(specDir, 'tasks.md'), 'utf8');
  } catch (err) {
    io.error(colors.red(`Failed to read tasks.md: ${String(err)}`));
    return 1;
  }

  const maxParallelArg = argv.find((a) => a.startsWith('--max-parallel='));
  const maxParallel = maxParallelArg ? parseInt(maxParallelArg.split('=')[1], 10) : 4;

  const plan = createSchedulePlan(featureArg, tasksContent, { maxParallel });

  if (isJson) {
    io.log(JSON.stringify(plan, null, 2));
    return 0;
  }

  io.log('');
  io.log(formatHeading(`Parallel Execution Schedule: ${colors.bold(featureArg)}`));
  io.log(`  Total Tasks:       ${plan.totalTasks}`);
  io.log(`  Pending Tasks:     ${plan.pendingTasks}`);
  io.log(`  Execution Waves:   ${plan.waves.length}`);
  io.log(`  Max Concurrency:   ${colors.green(`${plan.maxConcurrency} parallel subagents`)}`);

  if (plan.waves.length === 0) {
    io.log('');
    io.log(formatSuccess('All tasks are already completed [x]!'));
    io.log('');
    return 0;
  }

  io.log('');
  io.log(formatHeading('Parallel Wave Breakdown:'));

  for (const wave of plan.waves) {
    const waveType = wave.isParallel
      ? colors.cyan(`[PARALLEL: ${wave.tasks.length} subagents]`)
      : colors.dim(`[SEQUENTIAL]`);

    io.log(`  Wave ${wave.waveIndex} ${waveType}:`);
    for (const task of wave.tasks) {
      const boundStr = task.boundary && task.boundary.length > 0 ? colors.dim(` (boundary: ${task.boundary.join(', ')})`) : '';
      io.log(`    • Task ${colors.bold(task.id)}: ${task.title}${boundStr}`);
    }
    if (wave.boundaries.length > 0) {
      io.log(`      ${colors.dim(`Disjoint boundaries locked: ${wave.boundaries.join(', ')}`)}`);
    }
  }

  io.log('');
  io.log(formatHeading('Autonomous Execution:'));
  io.log(`  To launch parallel subagents in your agent, type:`);
  io.log(`  ${colors.bold(`/sdd-impl ${featureArg} --parallel`)}`);
  io.log('');
  return 0;
};
