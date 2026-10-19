import { colors } from './colors.js';
export const renderProgressBar = (state) => {
    const lines = [];
    // Header
    lines.push('');
    lines.push(colors.bold(`🚀 Implementing ${state.featureName}`));
    lines.push('');
    // Progress bar (X/Y completed)
    const progress = state.completedTasks + state.failedTasks;
    const percent = Math.round((progress / state.totalTasks) * 100);
    const barLength = 30;
    const filledLength = Math.round((percent / 100) * barLength);
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
    const statusColor = state.failedTasks > 0 ? colors.red : colors.green;
    lines.push(`  ${bar} ${statusColor(`${progress}/${state.totalTasks}`)} (${percent}%) | Wave ${state.currentWave}/${state.totalWaves}`);
    lines.push('');
    // Task list with status
    const pending = state.tasks.filter(t => t.status === 'pending');
    const running = state.tasks.filter(t => t.status === 'running');
    const done = state.tasks.filter(t => t.status === 'done');
    const failed = state.tasks.filter(t => t.status === 'failed');
    // Completed tasks
    if (done.length > 0) {
        lines.push(colors.green('✓ Done:'));
        for (const task of done) {
            lines.push(`  ${colors.green('✓')} ${task.title}`);
        }
        lines.push('');
    }
    // Running tasks
    if (running.length > 0) {
        lines.push(colors.cyan('⟳ Running:'));
        for (const task of running) {
            lines.push(`  ${colors.cyan('⟳')} ${task.title}`);
        }
        lines.push('');
    }
    // Pending tasks
    if (pending.length > 0) {
        lines.push(colors.dim('⊙ Pending:'));
        for (const task of pending) {
            lines.push(`  ${colors.dim('⊙')} ${task.title}`);
        }
        lines.push('');
    }
    // Failed tasks
    if (failed.length > 0) {
        lines.push(colors.red('✗ Failed:'));
        for (const task of failed) {
            lines.push(`  ${colors.red('✗')} ${task.title}`);
        }
        lines.push('');
    }
    return lines;
};
export const renderTaskUpdate = (task, action) => {
    const icons = {
        start: colors.cyan('⟳'),
        complete: colors.green('✓'),
        fail: colors.red('✗'),
    };
    const messages = {
        start: `${icons[action]} Task ${colors.bold(task.id)} started: ${task.title}`,
        complete: `${icons[action]} Task ${colors.bold(task.id)} done: ${task.title}`,
        fail: `${icons[action]} Task ${colors.bold(task.id)} failed: ${task.title}`,
    };
    return messages[action];
};
export const renderWaveStart = (waveNum, totalWaves, parallelCount) => {
    return colors.cyan(`\n▶︎ Wave ${waveNum}/${totalWaves} (${parallelCount} parallel subagents running...)\n`);
};
export const renderExecutionSummary = (state) => {
    const lines = [];
    lines.push('');
    lines.push(colors.bold('═══════════════════════════════════'));
    lines.push(`Feature: ${colors.bold(state.featureName)}`);
    lines.push(`Completed: ${colors.green(`${state.completedTasks}/${state.totalTasks}`)} tasks`);
    if (state.failedTasks > 0) {
        lines.push(`Failed: ${colors.red(`${state.failedTasks} tasks`)}`);
    }
    lines.push(colors.bold('═══════════════════════════════════'));
    lines.push('');
    if (state.failedTasks === 0 && state.completedTasks === state.totalTasks) {
        lines.push(colors.green('✓ All tasks completed successfully!'));
    }
    else if (state.failedTasks > 0) {
        lines.push(colors.red(`✗ ${state.failedTasks} task(s) failed. Review and retry.`));
    }
    else {
        lines.push(colors.yellow(`⚠ ${state.totalTasks - state.completedTasks} tasks remaining.`));
    }
    lines.push('');
    return lines;
};
