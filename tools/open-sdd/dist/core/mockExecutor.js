export const createMockExecutionState = (featureName, tasks, totalWaves) => ({
    featureName,
    totalTasks: tasks.length,
    completedTasks: 0,
    failedTasks: 0,
    currentWave: 1,
    totalWaves,
    tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: 'pending',
        wave: t.wave,
    })),
});
export const simulateTaskExecution = async (state, taskId, onUpdate) => {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task)
        return;
    // Mark as running
    task.status = 'running';
    onUpdate(state, task, 'start');
    // Simulate work (500ms - 2000ms random)
    const duration = Math.random() * 1500 + 500;
    await new Promise((resolve) => setTimeout(resolve, duration));
    // Mark as done (95% success rate for demo)
    const success = Math.random() < 0.95;
    if (success) {
        task.status = 'done';
        state.completedTasks += 1;
        onUpdate(state, task, 'complete');
    }
    else {
        task.status = 'failed';
        state.failedTasks += 1;
        onUpdate(state, task, 'fail');
    }
};
export const groupTasksByWave = (tasks) => {
    const map = new Map();
    for (const task of tasks) {
        if (!map.has(task.wave)) {
            map.set(task.wave, []);
        }
        map.get(task.wave).push(task);
    }
    return map;
};
