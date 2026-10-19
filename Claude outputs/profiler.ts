import chalk from 'chalk';

/**
 * Performance profiler for spec-to-code execution
 * Real measurements: time per wave, files per wave, bottleneck detection
 */

export interface WaveMetrics {
  waveNum: number;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  tasksCompleted: number;
  filesCreated: number;
  filesModified: number;
  bytesWritten: number;
  throughputMBps?: number;
  bottleneck?: string;
}

export interface ProfileReport {
  feature: string;
  totalWaves: number;
  totalDuration: number;
  averageWaveDuration: number;
  fastestWave?: WaveMetrics;
  slowestWave?: WaveMetrics;
  totalFilesCreated: number;
  totalFilesModified: number;
  totalBytesWritten: number;
  overallThroughput: number;
  bottlenecks: string[];
}

// Global profile state
const profileData = new Map<string, WaveMetrics[]>();

/**
 * Start measuring a wave
 */
export function startWaveProfile(
  feature: string,
  waveNum: number,
  waveName: string
): WaveMetrics {
  const metric: WaveMetrics = {
    waveNum,
    name: waveName,
    startTime: Date.now(),
    tasksCompleted: 0,
    filesCreated: 0,
    filesModified: 0,
    bytesWritten: 0
  };

  if (!profileData.has(feature)) {
    profileData.set(feature, []);
  }

  profileData.get(feature)!.push(metric);
  return metric;
}

/**
 * End wave measurement
 */
export function endWaveProfile(
  feature: string,
  metric: WaveMetrics,
  filesCreated: number = 0,
  filesModified: number = 0,
  bytesWritten: number = 0
): WaveMetrics {
  const updated = { ...metric };
  updated.endTime = Date.now();
  updated.duration = updated.endTime - updated.startTime;
  updated.filesCreated = filesCreated;
  updated.filesModified = filesModified;
  updated.bytesWritten = bytesWritten;

  // Calculate throughput (MB/s)
  if (updated.duration > 0 && bytesWritten > 0) {
    const MB = bytesWritten / (1024 * 1024);
    const seconds = updated.duration / 1000;
    updated.throughputMBps = Math.round((MB / seconds) * 100) / 100;
  }

  // Detect bottlenecks (waves >5s)
  if (updated.duration! > 5000) {
    updated.bottleneck = `Slow: ${(updated.duration! / 1000).toFixed(1)}s`;
  }

  const waves = profileData.get(feature) || [];
  const idx = waves.findIndex(w => w.waveNum === metric.waveNum);
  if (idx >= 0) {
    waves[idx] = updated;
  }

  return updated;
}

/**
 * Generate profile report
 */
export function generateProfileReport(feature: string): ProfileReport {
  const waves = profileData.get(feature) || [];

  if (waves.length === 0) {
    return {
      feature,
      totalWaves: 0,
      totalDuration: 0,
      averageWaveDuration: 0,
      totalFilesCreated: 0,
      totalFilesModified: 0,
      totalBytesWritten: 0,
      overallThroughput: 0,
      bottlenecks: []
    };
  }

  const completedWaves = waves.filter(w => w.endTime);
  const totalDuration = completedWaves.reduce((sum, w) => sum + (w.duration || 0), 0);
  const averageDuration = completedWaves.length > 0 ? totalDuration / completedWaves.length : 0;

  const totalFilesCreated = waves.reduce((sum, w) => sum + w.filesCreated, 0);
  const totalFilesModified = waves.reduce((sum, w) => sum + w.filesModified, 0);
  const totalBytesWritten = waves.reduce((sum, w) => sum + w.bytesWritten, 0);
  const overallThroughput = totalDuration > 0
    ? Math.round(((totalBytesWritten / (1024 * 1024)) / (totalDuration / 1000)) * 100) / 100
    : 0;

  const bottlenecks = completedWaves
    .filter(w => w.bottleneck)
    .map(w => `Wave ${w.waveNum} (${w.name}): ${w.bottleneck}`);

  const fastestWave = completedWaves.reduce((min, w) =>
    (w.duration || 0) < (min.duration || Infinity) ? w : min
  );

  const slowestWave = completedWaves.reduce((max, w) =>
    (w.duration || 0) > (max.duration || 0) ? w : max
  );

  return {
    feature,
    totalWaves: completedWaves.length,
    totalDuration,
    averageWaveDuration: Math.round(averageDuration),
    fastestWave: completedWaves.length > 0 ? fastestWave : undefined,
    slowestWave: completedWaves.length > 0 ? slowestWave : undefined,
    totalFilesCreated,
    totalFilesModified,
    totalBytesWritten,
    overallThroughput,
    bottlenecks
  };
}

/**
 * Clear profile data
 */
export function clearProfileData(): void {
  profileData.clear();
}

/**
 * Render profile report
 */
export function renderProfileReport(report: ProfileReport): string[] {
  const lines: string[] = [];

  lines.push(chalk.cyan.bold(`\n⚡ Performance Profile: ${report.feature}`));
  lines.push('');

  lines.push(chalk.yellow.bold('Summary:'));
  lines.push(chalk.white(`  Total waves: ${report.totalWaves}`));
  lines.push(chalk.white(`  Total time: ${(report.totalDuration / 1000).toFixed(2)}s`));
  lines.push(chalk.white(`  Avg/wave: ${(report.averageWaveDuration / 1000).toFixed(2)}s`));
  lines.push('');

  lines.push(chalk.yellow.bold('Files:'));
  lines.push(chalk.green(`  Created: ${report.totalFilesCreated}`));
  lines.push(chalk.blue(`  Modified: ${report.totalFilesModified}`));
  lines.push(chalk.white(`  Total size: ${(report.totalBytesWritten / 1024).toFixed(1)} KB`));
  lines.push('');

  lines.push(chalk.yellow.bold('Throughput:'));
  lines.push(chalk.white(`  ${report.overallThroughput} MB/s`));
  lines.push('');

  if (report.fastestWave) {
    lines.push(chalk.green(`⚡ Fastest: Wave ${report.fastestWave.waveNum} (${report.fastestWave.name})`));
    lines.push(chalk.gray(`   ${(report.fastestWave.duration! / 1000).toFixed(2)}s`));
    lines.push('');
  }

  if (report.slowestWave) {
    lines.push(chalk.orange(`🐢 Slowest: Wave ${report.slowestWave.waveNum} (${report.slowestWave.name})`));
    lines.push(chalk.gray(`   ${(report.slowestWave.duration! / 1000).toFixed(2)}s`));
    lines.push('');
  }

  if (report.bottlenecks.length > 0) {
    lines.push(chalk.red.bold('⚠️  Bottlenecks:'));
    report.bottlenecks.forEach(b => {
      lines.push(chalk.gray(`  ${b}`));
    });
    lines.push('');
  }

  return lines;
}

/**
 * Compare two profiles
 */
export function compareProfiles(
  report1: ProfileReport,
  report2: ProfileReport
): string[] {
  const lines: string[] = [];

  lines.push(chalk.cyan.bold(`\n📊 Profile Comparison`));
  lines.push('');

  const timeDiff = report2.totalDuration - report1.totalDuration;
  const timeChangePercent = (timeDiff / report1.totalDuration) * 100;
  const timeIcon = timeDiff < 0 ? '🟢' : '🔴';

  lines.push(chalk.white(`${timeIcon} Time: ${report1.totalDuration}ms → ${report2.totalDuration}ms (${timeChangePercent > 0 ? '+' : ''}${timeChangePercent.toFixed(1)}%)`));

  const filesDiff = report2.totalFilesCreated - report1.totalFilesCreated;
  lines.push(chalk.white(`  Files: ${report1.totalFilesCreated} → ${report2.totalFilesCreated} (${filesDiff > 0 ? '+' : ''}${filesDiff})`));

  const throughputDiff = report2.overallThroughput - report1.overallThroughput;
  const throughputIcon = throughputDiff > 0 ? '🟢' : '🔴';
  lines.push(chalk.white(`${throughputIcon} Throughput: ${report1.overallThroughput} → ${report2.overallThroughput} MB/s`));

  lines.push('');

  return lines;
}
