import { parseTasksMarkdown } from './specManager.js';
export const buildTaskDependencyWaves = (tasks, options = {}) => {
    const maxParallel = options.maxParallel ?? 4;
    const completedIds = new Set(tasks.filter((t) => t.status === 'completed').map((t) => t.id));
    const pending = tasks.filter((t) => t.status !== 'completed');
    if (pending.length === 0)
        return [];
    const waves = [];
    let remaining = [...pending];
    let waveIndex = 1;
    while (remaining.length > 0) {
        // Find all tasks whose dependencies are satisfied
        const readyTasks = remaining.filter((task) => {
            if (!task.depends || task.depends.length === 0)
                return true;
            return task.depends.every((depId) => completedIds.has(depId));
        });
        if (readyTasks.length === 0) {
            // Unresolved or circular dependency: force-pick the first task to break deadlock
            const forced = remaining[0];
            waves.push({
                waveIndex: waveIndex++,
                tasks: [forced],
                isParallel: false,
                boundaries: forced.boundary ?? [],
            });
            completedIds.add(forced.id);
            remaining = remaining.filter((t) => t.id !== forced.id);
            continue;
        }
        // Partition ready tasks ensuring disjoint boundaries (no race condition on same files)
        const waveTasks = [];
        const waveBoundaries = new Set();
        for (const task of readyTasks) {
            if (waveTasks.length >= maxParallel)
                break;
            const taskBounds = task.boundary ?? [];
            const hasConflict = taskBounds.some((b) => waveBoundaries.has(b));
            if (!hasConflict) {
                waveTasks.push(task);
                taskBounds.forEach((b) => waveBoundaries.add(b));
            }
        }
        if (waveTasks.length === 0) {
            // Fallback: take at least one task
            waveTasks.push(readyTasks[0]);
        }
        waves.push({
            waveIndex: waveIndex++,
            tasks: waveTasks,
            isParallel: waveTasks.length > 1,
            boundaries: Array.from(waveBoundaries).sort(),
        });
        // Mark wave tasks as completed for subsequent wave scheduling
        waveTasks.forEach((t) => completedIds.add(t.id));
        const scheduledIds = new Set(waveTasks.map((t) => t.id));
        remaining = remaining.filter((t) => !scheduledIds.has(t.id));
    }
    return waves;
};
export const createSchedulePlan = (feature, tasksMarkdown, options = {}) => {
    const allTasks = parseTasksMarkdown(tasksMarkdown);
    const pendingTasks = allTasks.filter((t) => t.status !== 'completed');
    const waves = buildTaskDependencyWaves(allTasks, options);
    const maxConcurrency = waves.reduce((max, w) => Math.max(max, w.tasks.length), 0);
    return {
        feature,
        totalTasks: allTasks.length,
        pendingTasks: pendingTasks.length,
        waves,
        maxConcurrency,
    };
};
