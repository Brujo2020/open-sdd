import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

/**
 * Checkpoint system for multi-wave task execution
 * Enables rollback and retry on failure
 */

export interface Checkpoint {
  feature: string;
  waveNum: number;
  timestamp: number;
  fileSnapshots: Map<string, string>;
  taskStates: TaskState[];
  metadata: {
    specVersion: string;
    completedTasks: number;
    totalTasks: number;
  };
}

export interface TaskState {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime?: number;
  endTime?: number;
  error?: string;
  retryCount: number;
  maxRetries: number;
}

export interface ErrorAnalysis {
  rootCause: string;
  category: 'import' | 'syntax' | 'logic' | 'dependency' | 'unknown';
  severity: 'critical' | 'high' | 'medium' | 'low';
  affectedFiles: string[];
  suggestedFix?: string;
  confidence: number;
}

export interface RecoveryOption {
  id: 'retry' | 'skip' | 'rollback' | 'quit';
  label: string;
  description: string;
  risky: boolean;
}

/**
 * Save checkpoint after successful wave completion
 */
export async function saveCheckpoint(
  feature: string,
  waveNum: number,
  fileSnapshots: Map<string, string>,
  taskStates: TaskState[],
  sddDir: string = '.sdd'
): Promise<string> {
  const checkpointDir = path.join(sddDir, '.checkpoints', feature);

  if (!fs.existsSync(checkpointDir)) {
    fs.mkdirSync(checkpointDir, { recursive: true });
  }

  const checkpoint: Checkpoint = {
    feature,
    waveNum,
    timestamp: Date.now(),
    fileSnapshots,
    taskStates,
    metadata: {
      specVersion: '1.0',
      completedTasks: taskStates.filter(t => t.status === 'completed').length,
      totalTasks: taskStates.length
    }
  };

  const checkpointPath = path.join(checkpointDir, `wave-${waveNum}.json`);
  fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), 'utf-8');

  return checkpointPath;
}

/**
 * Load checkpoint from disk
 */
export function loadCheckpoint(
  feature: string,
  waveNum: number,
  sddDir: string = '.sdd'
): Checkpoint | null {
  const checkpointPath = path.join(sddDir, '.checkpoints', feature, `wave-${waveNum}.json`);

  if (!fs.existsSync(checkpointPath)) {
    return null;
  }

  const content = fs.readFileSync(checkpointPath, 'utf-8');
  const checkpoint = JSON.parse(content) as Checkpoint;

  // Restore Map from serialized JSON
  checkpoint.fileSnapshots = new Map(Object.entries(checkpoint.fileSnapshots));

  return checkpoint;
}

/**
 * Analyze error output to determine root cause
 */
export function analyzeError(stderr: string, stdout: string, failedTaskName: string): ErrorAnalysis {
  const analysis: ErrorAnalysis = {
    rootCause: 'Unknown error occurred',
    category: 'unknown',
    severity: 'medium',
    affectedFiles: [],
    confidence: 0.5
  };

  const fullOutput = `${stderr}\n${stdout}`.toLowerCase();

  // Import/module errors
  if (fullOutput.includes('cannot find module') || fullOutput.includes('module not found')) {
    analysis.category = 'import';
    analysis.severity = 'critical';
    analysis.confidence = 0.95;
    analysis.rootCause = 'Missing or invalid import statement';

    const importMatch = fullOutput.match(/cannot find module ['"]([^'"]+)['"]/);
    if (importMatch) {
      analysis.suggestedFix = `Add missing module: npm install ${importMatch[1]}`;
    }
  }

  // Syntax errors
  if (fullOutput.includes('syntax error') || fullOutput.includes('unexpected token')) {
    analysis.category = 'syntax';
    analysis.severity = 'critical';
    analysis.confidence = 0.9;
    analysis.rootCause = 'Syntax error in generated code';
    analysis.suggestedFix = 'Review generated code for proper TypeScript/JavaScript syntax';
  }

  // Dependency errors
  if (fullOutput.includes('dependency') || fullOutput.includes('peer dependency')) {
    analysis.category = 'dependency';
    analysis.severity = 'high';
    analysis.confidence = 0.85;
    analysis.rootCause = 'Missing or incompatible dependency';
    analysis.suggestedFix = 'Install missing dependencies: npm install';
  }

  // Logic errors (runtime)
  if (fullOutput.includes('uncaught error') || fullOutput.includes('cannot read property')) {
    analysis.category = 'logic';
    analysis.severity = 'high';
    analysis.confidence = 0.8;
    analysis.rootCause = 'Logic error in implementation';
    analysis.suggestedFix = 'Review code logic for null/undefined references';
  }

  // Extract affected files
  const fileMatches = fullOutput.match(/(?:at |in |file:\/\/)?([a-z0-9_./:-]+\.(?:ts|js|json))/gi);
  if (fileMatches) {
    analysis.affectedFiles = [...new Set(fileMatches.map(f => f.toLowerCase()))];
  }

  return analysis;
}

/**
 * Rollback files to checkpoint state
 */
export async function rollbackToCheckpoint(
  checkpoint: Checkpoint,
  codebaseRoot: string
): Promise<{ restored: number; failed: string[] }> {
  const failed: string[] = [];
  let restored = 0;

  for (const [filePath, content] of checkpoint.fileSnapshots) {
    try {
      const fullPath = path.join(codebaseRoot, filePath);
      const dir = path.dirname(fullPath);

      // Ensure directory exists
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(fullPath, content, 'utf-8');
      restored++;
    } catch (error) {
      failed.push(filePath);
    }
  }

  return { restored, failed };
}

/**
 * Get recovery options based on error and retry count
 */
export function getRecoveryOptions(
  taskState: TaskState,
  analysis: ErrorAnalysis,
  retryAttempt: number = 1
): RecoveryOption[] {
  const options: RecoveryOption[] = [];

  // Retry option (always available up to max)
  if (retryAttempt < taskState.maxRetries) {
    options.push({
      id: 'retry',
      label: `[R] Retry (Attempt ${retryAttempt + 1}/${taskState.maxRetries})`,
      description: `Apply suggested fix and retry`,
      risky: false
    });
  }

  // Skip option (risky)
  options.push({
    id: 'skip',
    label: '[S] Skip and Continue',
    description: 'Skip this task and continue (may cause issues)',
    risky: true
  });

  // Rollback option
  options.push({
    id: 'rollback',
    label: '[B] Rollback All Changes',
    description: 'Restore to previous checkpoint',
    risky: false
  });

  // Quit option
  options.push({
    id: 'quit',
    label: '[Q] Quit and Save State',
    description: 'Exit and save current checkpoint for later retry',
    risky: false
  });

  return options;
}

/**
 * Create suggested fix based on error analysis
 */
export function createFixForError(analysis: ErrorAnalysis): string | null {
  if (!analysis.suggestedFix) {
    return null;
  }

  switch (analysis.category) {
    case 'import':
      return analysis.suggestedFix;

    case 'dependency':
      return 'Run: npm install && npm run build';

    case 'syntax':
      return 'Review generated code syntax; check TypeScript strict mode compliance';

    case 'logic':
      return 'Add null/undefined guards and type assertions';

    default:
      return analysis.suggestedFix || 'Manually review error output';
  }
}

/**
 * Track task execution state
 */
export function createTaskState(
  id: string,
  name: string,
  maxRetries: number = 3
): TaskState {
  return {
    id,
    name,
    status: 'pending',
    retryCount: 0,
    maxRetries
  };
}

/**
 * Update task state during execution
 */
export function updateTaskState(
  state: TaskState,
  status: TaskState['status'],
  error?: string
): TaskState {
  const updated = { ...state, status };

  if (status === 'running') {
    updated.startTime = Date.now();
  }

  if (status === 'completed' || status === 'failed') {
    updated.endTime = Date.now();
  }

  if (error) {
    updated.error = error;
  }

  return updated;
}

/**
 * Render checkpoint info
 */
export function renderCheckpointInfo(checkpoint: Checkpoint): string[] {
  const lines: string[] = [];
  const timestamp = new Date(checkpoint.timestamp).toLocaleString();

  lines.push(chalk.cyan.bold(`\n📌 Checkpoint Information`));
  lines.push(chalk.gray(`├─ Feature: ${checkpoint.feature}`));
  lines.push(chalk.gray(`├─ Wave: ${checkpoint.waveNum}`));
  lines.push(chalk.gray(`├─ Saved: ${timestamp}`));
  lines.push(chalk.gray(`├─ Files: ${checkpoint.fileSnapshots.size}`));
  lines.push(chalk.gray(`└─ Tasks: ${checkpoint.metadata.completedTasks}/${checkpoint.metadata.totalTasks} completed`));
  lines.push('');

  return lines;
}

/**
 * Render error analysis
 */
export function renderErrorAnalysis(analysis: ErrorAnalysis): string[] {
  const lines: string[] = [];
  const icon = analysis.severity === 'critical' ? '🔴' : analysis.severity === 'high' ? '🟠' : '🟡';

  lines.push(chalk.red.bold(`\n${icon} Error Analysis`));
  lines.push(chalk.white(`Root Cause: ${analysis.rootCause}`));
  lines.push(chalk.gray(`Category: ${analysis.category.toUpperCase()}`));
  lines.push(chalk.gray(`Severity: ${analysis.severity}`));
  lines.push(chalk.gray(`Confidence: ${Math.round(analysis.confidence * 100)}%`));

  if (analysis.affectedFiles.length > 0) {
    lines.push(chalk.yellow(`\nAffected Files:`));
    analysis.affectedFiles.forEach(f => {
      lines.push(chalk.gray(`  ├─ ${f}`));
    });
  }

  if (analysis.suggestedFix) {
    lines.push(chalk.green(`\n💡 Suggested Fix:`));
    lines.push(chalk.white(`  ${analysis.suggestedFix}`));
  }

  lines.push('');

  return lines;
}

/**
 * Render recovery options
 */
export function renderRecoveryOptions(options: RecoveryOption[]): string[] {
  const lines: string[] = [];

  lines.push(chalk.yellow.bold(`\n🔄 Recovery Options:`));
  options.forEach(opt => {
    const riskIcon = opt.risky ? chalk.red('⚠️ ') : chalk.green('✓ ');
    lines.push(chalk.white(`  ${opt.label}`));
    lines.push(chalk.gray(`     ${opt.description}`));
  });
  lines.push('');

  return lines;
}

/**
 * Render rollback progress
 */
export function renderRollbackProgress(
  restored: number,
  total: number,
  failed: string[] = []
): string[] {
  const lines: string[] = [];

  lines.push(chalk.yellow.bold(`\n🔙 Rolling Back Changes`));
  lines.push(chalk.green(`✓ Restored ${restored}/${total} files`));

  if (failed.length > 0) {
    lines.push(chalk.red(`⚠ Failed to restore ${failed.length} files:`));
    failed.forEach(f => {
      lines.push(chalk.gray(`  ├─ ${f}`));
    });
  }

  lines.push(chalk.cyan(`\nState saved. Run /sdd-impl to retry from next wave.\n`));

  return lines;
}

/**
 * Render retry attempt status
 */
export function renderRetryAttempt(
  taskName: string,
  attempt: number,
  maxRetries: number,
  fix: string
): string[] {
  const lines: string[] = [];

  lines.push(chalk.cyan.bold(`\n⟳ Retrying with Fix (Attempt ${attempt}/${maxRetries})`));
  lines.push(chalk.white(`Task: ${taskName}`));
  lines.push(chalk.gray(`Fix Applied: ${fix}`));
  lines.push(chalk.gray('Running...\n'));

  return lines;
}

/**
 * Cleanup old checkpoints (keep last N)
 */
export function cleanupOldCheckpoints(
  feature: string,
  keepCount: number = 5,
  sddDir: string = '.sdd'
): number {
  const checkpointDir = path.join(sddDir, '.checkpoints', feature);

  if (!fs.existsSync(checkpointDir)) {
    return 0;
  }

  const files = fs.readdirSync(checkpointDir)
    .filter(f => f.startsWith('wave-') && f.endsWith('.json'))
    .map(f => ({
      name: f,
      path: path.join(checkpointDir, f),
      time: fs.statSync(path.join(checkpointDir, f)).mtimeMs
    }))
    .sort((a, b) => b.time - a.time);

  let deleted = 0;
  for (let i = keepCount; i < files.length; i++) {
    try {
      fs.unlinkSync(files[i].path);
      deleted++;
    } catch (error) {
      // Continue on error
    }
  }

  return deleted;
}
