import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import {
  saveCheckpoint,
  loadCheckpoint,
  analyzeError,
  rollbackToCheckpoint,
  getRecoveryOptions,
  createFixForError,
  createTaskState,
  updateTaskState,
  renderCheckpointInfo,
  renderErrorAnalysis,
  renderRecoveryOptions,
  renderRollbackProgress,
  renderRetryAttempt,
  cleanupOldCheckpoints,
  type Checkpoint,
  type TaskState,
  type ErrorAnalysis
} from '../core/failureRecovery.js';

/**
 * /sdd-impl <feature> [--checkpoint] [--resume <wave>] [--rollback-to <wave>]
 *
 * Usage:
 *   /sdd-impl auth                 # Normal implementation
 *   /sdd-impl auth --checkpoint    # Enable checkpointing
 *   /sdd-impl auth --resume 2      # Resume from wave 2
 *   /sdd-impl auth --rollback-to 1 # Rollback to wave 1
 */

export async function handleRollbackRetry(args: string[]): Promise<void> {
  const feature = args[0];
  const checkpoint = args.includes('--checkpoint');
  const resumeWave = parseWaveNumber(args, '--resume');
  const rollbackWave = parseWaveNumber(args, '--rollback-to');

  if (!feature) {
    console.error(chalk.red('Error: feature name required\nUsage: /sdd-impl <feature-name>'));
    return;
  }

  const sddDir = '.sdd';
  const codebaseRoot = '.';

  // Handle rollback request
  if (rollbackWave !== null) {
    await handleRollbackRequest(feature, rollbackWave, sddDir, codebaseRoot);
    return;
  }

  // Handle resume request
  if (resumeWave !== null) {
    await handleResumeFromCheckpoint(feature, resumeWave, sddDir, codebaseRoot);
    return;
  }

  // Normal implementation with optional checkpointing
  await handleImplementationWithCheckpointing(feature, checkpoint, sddDir, codebaseRoot);
}

/**
 * Parse wave number from args
 */
function parseWaveNumber(args: string[], flag: string): number | null {
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) {
    const num = parseInt(args[index + 1], 10);
    return isNaN(num) ? null : num;
  }
  return null;
}

/**
 * Handle rollback to specific checkpoint
 */
async function handleRollbackRequest(
  feature: string,
  waveNum: number,
  sddDir: string,
  codebaseRoot: string
): Promise<void> {
  console.log(chalk.cyan.bold(`\n🔙 Rolling Back Feature: ${feature}\n`));

  const checkpoint = loadCheckpoint(feature, waveNum, sddDir);

  if (!checkpoint) {
    console.error(chalk.red(`✗ Checkpoint not found for wave ${waveNum}`));
    return;
  }

  renderCheckpointInfo(checkpoint).forEach(line => console.log(line));

  // Confirm rollback
  const confirmed = await promptConfirm(
    chalk.yellow(`Roll back to wave ${waveNum}? This will restore files to checkpoint state.`)
  );

  if (!confirmed) {
    console.log(chalk.gray('Cancelled.'));
    return;
  }

  // Perform rollback
  const { restored, failed } = await rollbackToCheckpoint(checkpoint, codebaseRoot);
  renderRollbackProgress(restored, checkpoint.fileSnapshots.size, failed)
    .forEach(line => console.log(line));

  // Cleanup old checkpoints
  const cleaned = cleanupOldCheckpoints(feature, 5, sddDir);
  if (cleaned > 0) {
    console.log(chalk.gray(`Cleaned up ${cleaned} old checkpoint(s)`));
  }
}

/**
 * Handle resume from checkpoint
 */
async function handleResumeFromCheckpoint(
  feature: string,
  fromWave: number,
  sddDir: string,
  codebaseRoot: string
): Promise<void> {
  console.log(chalk.cyan.bold(`\n▶️  Resuming Feature: ${feature}\n`));

  const checkpoint = loadCheckpoint(feature, fromWave, sddDir);

  if (!checkpoint) {
    console.error(chalk.red(`✗ Checkpoint not found for wave ${fromWave}`));
    return;
  }

  renderCheckpointInfo(checkpoint).forEach(line => console.log(line));

  console.log(chalk.cyan(`Next wave: ${fromWave + 1}`));
  console.log(chalk.gray(`Run: /sdd-impl ${feature} --checkpoint to continue\n`));
}

/**
 * Handle implementation with checkpointing
 */
async function handleImplementationWithCheckpointing(
  feature: string,
  enableCheckpointing: boolean,
  sddDir: string,
  codebaseRoot: string
): Promise<void> {
  if (!enableCheckpointing) {
    console.log(chalk.gray('💡 Use --checkpoint flag to enable rollback/retry on failure\n'));
    return;
  }

  console.log(chalk.cyan.bold(`🚀 Implementing: ${feature} (Checkpoint Enabled)\n`));

  const specDir = path.join(sddDir, 'specs', feature);

  if (!fs.existsSync(specDir)) {
    console.error(chalk.red(`Spec not found: ${specDir}`));
    return;
  }

  // Simulate multi-wave execution
  const waves = [
    { num: 1, name: 'Parse & Validate', tasks: ['Validate spec', 'Analyze dependencies'] },
    { num: 2, name: 'Code Generation', tasks: ['Generate core files', 'Generate tests'] },
    { num: 3, name: 'Integration', tasks: ['Wire router', 'Update package.json'] },
    { num: 4, name: 'Build & Verify', tasks: ['TypeScript build', 'Lint checks'] }
  ];

  let currentWave = 1;
  const fileSnapshots = new Map<string, string>();

  for (const wave of waves) {
    if (wave.num < currentWave) continue;

    console.log(chalk.blue.bold(`\n📊 Wave ${wave.num}: ${wave.name}`));
    console.log(chalk.gray(`├─ Tasks: ${wave.tasks.join(', ')}`));

    const taskStates = wave.tasks.map((name, i) =>
      createTaskState(`task-${wave.num}-${i}`, name, 3)
    );

    // Execute wave (simulate)
    let waveSuccess = true;

    for (let i = 0; i < taskStates.length; i++) {
      const task = taskStates[i];
      let retryAttempt = 1;
      let taskCompleted = false;

      while (retryAttempt <= task.maxRetries && !taskCompleted) {
        taskStates[i] = updateTaskState(task, 'running');

        // Simulate task execution (1 in 10 chance of failure for demo)
        const simulatedFailure = false; // Math.random() < 0.1;
        const taskDuration = Math.random() * 2000 + 500;

        console.log(chalk.gray(`  ├─ [${i + 1}/${wave.tasks.length}] ${task.name}... `));

        // Simulate async execution
        await new Promise(resolve => setTimeout(resolve, taskDuration));

        if (!simulatedFailure) {
          taskStates[i] = updateTaskState(taskStates[i], 'completed');
          console.log(chalk.green(`✓ ${task.name} (${Math.round(taskDuration)}ms)`));
          taskCompleted = true;
        } else if (retryAttempt < task.maxRetries) {
          // Simulate error and retry
          const stderr = `Error: Module not found in ${task.name}`;
          const analysis = analyzeError(stderr, '', task.name);

          renderErrorAnalysis(analysis).forEach(line => console.log(line));

          const fix = createFixForError(analysis);
          if (fix) {
            renderRetryAttempt(task.name, retryAttempt, task.maxRetries, fix)
              .forEach(line => console.log(line));
            retryAttempt++;
          } else {
            throw new Error(`Failed: ${task.name}`);
          }
        } else {
          // Max retries exceeded
          taskStates[i] = updateTaskState(taskStates[i], 'failed', 'Max retries exceeded');
          waveSuccess = false;
          break;
        }
      }

      if (!taskCompleted) {
        waveSuccess = false;
        break;
      }
    }

    if (!waveSuccess) {
      console.log(chalk.red.bold(`\n✗ Wave ${wave.num} failed\n`));

      // Save checkpoint before wave and offer recovery
      if (wave.num > 1) {
        await saveCheckpoint(feature, wave.num - 1, fileSnapshots, [], sddDir);
        console.log(chalk.green(`✓ Checkpoint saved (wave ${wave.num - 1})`));
      }

      const recovery = await promptRecovery(feature, wave.num - 1, sddDir);

      if (recovery === 'rollback' && wave.num > 1) {
        const prevCheckpoint = loadCheckpoint(feature, wave.num - 1, sddDir);
        if (prevCheckpoint) {
          const { restored } = await rollbackToCheckpoint(prevCheckpoint, codebaseRoot);
          renderRollbackProgress(restored, prevCheckpoint.fileSnapshots.size)
            .forEach(line => console.log(line));
        }
      } else if (recovery === 'skip') {
        console.log(chalk.yellow(`⚠️  Skipping wave ${wave.num}. Continue at your own risk.`));
        currentWave = wave.num + 1;
        continue;
      } else {
        return;
      }
    }

    // Success: save checkpoint after wave
    console.log(chalk.green(`✅ Wave ${wave.num} complete`));
    await saveCheckpoint(feature, wave.num, fileSnapshots, taskStates, sddDir);
    console.log(chalk.gray(`  └─ Checkpoint saved (wave ${wave.num})`));
  }

  console.log(chalk.green.bold(`\n✅ Implementation complete!\n`));
  console.log(chalk.gray(`Checkpoints available for:\n`));
  for (let i = 1; i < waves.length; i++) {
    console.log(chalk.gray(`  /sdd-impl ${feature} --rollback-to ${i}`));
  }
  console.log('');
}

/**
 * Prompt for recovery option
 */
async function promptRecovery(
  feature: string,
  lastSuccessfulWave: number,
  sddDir: string
): Promise<'retry' | 'skip' | 'rollback' | 'quit'> {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const options: string[] = ['[R]etry', '[S]kip', '[B]ackup/rollback', '[Q]uit'];

    console.log(chalk.yellow.bold(`\n🔄 Recovery Options:`));
    console.log(chalk.white(`  ${options.join(' | ')}\n`));

    rl.question(chalk.cyan('Choice: '), (answer: string) => {
      rl.close();

      switch (answer.trim().toLowerCase()) {
        case 'r':
          resolve('retry');
          break;
        case 's':
          resolve('skip');
          break;
        case 'b':
          resolve('rollback');
          break;
        case 'q':
        default:
          resolve('quit');
      }
    });
  });
}

/**
 * Prompt for confirmation
 */
async function promptConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(`${message} (y/n) [n]: `, (answer: string) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}
