import type { TaskProgress, ExecutionState } from '../cli/ui/progressBar.js';

/**
 * Simulates autonomous task execution with realistic progress updates.
 * In production, this would spawn real subagents and stream results.
 * For demo/test, it shows what the real flow will look like.
 */
export interface TaskDef {
  id: string;
  title: string;
  wave: number;
  durationMs?: number; // For demo simulation
}

export const createMockExecutionState = (
  featureName: string,
  tasks: TaskDef[],
  totalWaves: number,
): ExecutionState => ({
  featureName,
  totalTasks: tasks.length,
  completedTasks: 0,
  failedTasks: 0,
  currentWave: 1,
  totalWaves,
  tasks: tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: 'pending' as const,
    wave: t.wave,
  })),
});

export const simulateTaskExecution = async (
  state: ExecutionState,
  taskId: string,
  onUpdate: (state: ExecutionState, task: TaskProgress, action: 'start' | 'complete' | 'fail') => void,
): Promise<void> => {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;

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
  } else {
    task.status = 'failed';
    state.failedTasks += 1;
    onUpdate(state, task, 'fail');
  }
};

export const groupTasksByWave = (tasks: TaskProgress[]): Map<number, TaskProgress[]> => {
  const map = new Map<number, TaskProgress[]>();
  for (const task of tasks) {
    if (!map.has(task.wave)) {
      map.set(task.wave, []);
    }
    map.get(task.wave)!.push(task);
  }
  return map;
};
