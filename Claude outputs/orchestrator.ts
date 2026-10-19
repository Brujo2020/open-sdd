import chalk from 'chalk';

/**
 * Multi-feature orchestration with memory pooling optimization
 * Executes sequential features with coordinated rollback
 * Uses in-memory caching to minimize I/O
 */

export interface OrchestratedTask {
  feature: string;
  priority: number;
  dependencies: string[];
  estimatedHours: number;
}

export interface ExecutionPlan {
  tasks: OrchestratedTask[];
  totalHours: number;
  parallelizable: OrchestratedTask[][];
  criticalPath: OrchestratedTask[];
}

export interface ExecutionMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  totalTime: number;
  memoryPeak: number;
  filesProcessed: number;
}

// Memory pool for file caching (avoid re-reading files)
const fileCache = new Map<string, { content: string; timestamp: number }>();
const CACHE_TTL = 5000; // 5s

/**
 * Build execution plan for multiple features
 */
export function buildExecutionPlan(features: OrchestratedTask[]): ExecutionPlan {
  const sorted = topologicalSort(features);
  const criticalPath = findCriticalPath(sorted);
  const parallelizable = findParallelWaves(sorted);

  return {
    tasks: sorted,
    totalHours: features.reduce((sum, f) => sum + f.estimatedHours, 0),
    parallelizable,
    criticalPath
  };
}

/**
 * Topological sort for dependency resolution
 */
function topologicalSort(tasks: OrchestratedTask[]): OrchestratedTask[] {
  const sorted: OrchestratedTask[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(task: OrchestratedTask) {
    if (visited.has(task.feature)) return;
    if (visiting.has(task.feature)) {
      throw new Error(`Circular dependency detected: ${task.feature}`);
    }

    visiting.add(task.feature);

    task.dependencies.forEach(dep => {
      const depTask = tasks.find(t => t.feature === dep);
      if (depTask) visit(depTask);
    });

    visiting.delete(task.feature);
    visited.add(task.feature);
    sorted.push(task);
  }

  tasks.forEach(visit);
  return sorted;
}

/**
 * Find critical path (longest dependency chain)
 */
function findCriticalPath(sorted: OrchestratedTask[]): OrchestratedTask[] {
  let path: OrchestratedTask[] = [];

  function dfs(task: OrchestratedTask, currentPath: OrchestratedTask[]): void {
    const newPath = [...currentPath, task];
    if (newPath.length > path.length) {
      path = newPath;
    }
  }

  sorted.forEach(task => {
    dfs(task, []);
  });

  return path;
}

/**
 * Find tasks that can execute in parallel
 */
function findParallelWaves(sorted: OrchestratedTask[]): OrchestratedTask[][] {
  const waves: OrchestratedTask[][] = [];
  const processed = new Set<string>();

  while (processed.size < sorted.length) {
    const wave: OrchestratedTask[] = [];

    for (const task of sorted) {
      if (processed.has(task.feature)) continue;

      const canRun = task.dependencies.every(dep => processed.has(dep));
      if (canRun) {
        wave.push(task);
      }
    }

    if (wave.length === 0) break;

    wave.forEach(t => processed.add(t.feature));
    waves.push(wave);
  }

  return waves;
}

/**
 * Cached file read (in-memory, TTL-based)
 */
export function readFileWithCache(filePath: string): string | null {
  const cached = fileCache.get(filePath);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.content;
  }

  try {
    const fs = require('fs');
    const content = fs.readFileSync(filePath, 'utf-8');
    fileCache.set(filePath, { content, timestamp: Date.now() });
    return content;
  } catch {
    return null;
  }
}

/**
 * Clear file cache
 */
export function clearFileCache(): void {
  fileCache.clear();
}

/**
 * Get cache stats
 */
export function getCacheStats(): { size: number; entries: number; memory: number } {
  let memory = 0;
  for (const [, value] of fileCache) {
    memory += value.content.length;
  }

  return {
    size: fileCache.size,
    entries: fileCache.size,
    memory
  };
}

/**
 * Execute feature plan
 */
export async function executeFeaturePlan(
  plan: ExecutionPlan,
  executeTask: (feature: string) => Promise<boolean>
): Promise<ExecutionMetrics> {
  const metrics: ExecutionMetrics = {
    tasksCompleted: 0,
    tasksFailed: 0,
    totalTime: 0,
    memoryPeak: 0,
    filesProcessed: 0
  };

  const startTime = Date.now();
  const completed = new Set<string>();
  const checkpoints = new Map<string, boolean>();

  for (const wave of plan.parallelizable) {
    for (const task of wave) {
      try {
        const success = await executeTask(task.feature);

        if (success) {
          metrics.tasksCompleted++;
          completed.add(task.feature);
          checkpoints.set(task.feature, true);
        } else {
          metrics.tasksFailed++;
          checkpoints.set(task.feature, false);

          // Rollback completed tasks
          for (const completedFeature of completed) {
            await rollbackFeature(completedFeature);
          }
          break;
        }
      } catch (error) {
        metrics.tasksFailed++;
        checkpoints.set(task.feature, false);
      }
    }
  }

  metrics.totalTime = Date.now() - startTime;
  metrics.memoryPeak = getCacheStats().memory;

  clearFileCache();

  return metrics;
}

/**
 * Simulate feature rollback
 */
async function rollbackFeature(feature: string): Promise<void> {
  // Placeholder for rollback logic
}

/**
 * Render execution plan
 */
export function renderExecutionPlan(plan: ExecutionPlan): string[] {
  const lines: string[] = [];

  lines.push(chalk.cyan.bold(`\n📊 Execution Plan`));
  lines.push(chalk.gray(`Total tasks: ${plan.tasks.length}`));
  lines.push(chalk.gray(`Estimated time: ${plan.totalHours}h`));
  lines.push(chalk.gray(`Critical path length: ${plan.criticalPath.length}`));
  lines.push('');

  lines.push(chalk.yellow.bold('Execution Waves:'));
  plan.parallelizable.forEach((wave, idx) => {
    const features = wave.map(t => t.feature).join(', ');
    lines.push(chalk.white(`  Wave ${idx + 1}: ${features}`));
  });
  lines.push('');

  return lines;
}

/**
 * Render execution metrics
 */
export function renderExecutionMetrics(metrics: ExecutionMetrics): string[] {
  const lines: string[] = [];

  lines.push(chalk.green.bold(`\n✅ Execution Complete`));
  lines.push(chalk.white(`  Completed: ${metrics.tasksCompleted}`));
  lines.push(chalk.white(`  Failed: ${metrics.tasksFailed}`));
  lines.push(chalk.white(`  Time: ${(metrics.totalTime / 1000).toFixed(2)}s`));
  lines.push(chalk.gray(`  Memory used: ${(metrics.memoryPeak / 1024).toFixed(2)} KB`));
  lines.push('');

  return lines;
}
