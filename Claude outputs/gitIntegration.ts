import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';

/**
 * Git-native integration for SDD
 * Auto-commit per wave, branch management, tags
 */

export interface GitWaveCommit {
  wave: number;
  branch: string;
  commit: string;
  message: string;
  files: string[];
  timestamp: number;
  stats: { additions: number; deletions: number; filesChanged: number };
}

export interface GitFeatureTag {
  feature: string;
  version: string;
  commit: string;
  timestamp: number;
  message: string;
}

/**
 * Check if git is available
 */
export function isGitAvailable(): boolean {
  try {
    execSync('git --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get current git branch
 */
export function getCurrentBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Create feature branch
 */
export function createFeatureBranch(feature: string, baseBranch: string = 'main'): boolean {
  try {
    const branchName = `feat/${feature}`;
    execSync(`git checkout -b ${branchName}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Commit wave changes
 */
export async function commitWave(
  feature: string,
  waveNum: number,
  waveName: string,
  files: string[]
): Promise<GitWaveCommit | null> {
  if (!isGitAvailable()) {
    return null;
  }

  try {
    const branch = getCurrentBranch();

    // Stage files
    for (const file of files) {
      if (fs.existsSync(file)) {
        execSync(`git add ${file}`, { stdio: 'pipe' });
      }
    }

    // Commit
    const message = `wave(${feature}): ${waveName} - wave ${waveNum} complete`;
    const commit = execSync(`git commit -m "${message}" --quiet`, { encoding: 'utf-8' }).trim();
    const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();

    // Get stats
    const diffStats = execSync(
      `git diff HEAD^ HEAD --stat 2>/dev/null || echo ""`,
      { encoding: 'utf-8' }
    );

    const additions = (diffStats.match(/\+/g) || []).length;
    const deletions = (diffStats.match(/-/g) || []).length;

    return {
      wave: waveNum,
      branch,
      commit: hash,
      message,
      files,
      timestamp: Date.now(),
      stats: {
        additions,
        deletions,
        filesChanged: files.length
      }
    };
  } catch (error) {
    return null;
  }
}

/**
 * Tag feature version
 */
export async function tagFeatureVersion(
  feature: string,
  version: string,
  message?: string
): Promise<GitFeatureTag | null> {
  if (!isGitAvailable()) {
    return null;
  }

  try {
    const tagName = `${feature}@${version}`;
    const tagMessage = message || `Feature ${feature} v${version}`;

    execSync(`git tag -a ${tagName} -m "${tagMessage}" --quiet`, { stdio: 'pipe' });
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();

    return {
      feature,
      version,
      commit: commit.substring(0, 7),
      timestamp: Date.now(),
      message: tagMessage
    };
  } catch {
    return null;
  }
}

/**
 * Get feature branch history
 */
export function getFeatureHistory(feature: string): GitWaveCommit[] {
  if (!isGitAvailable()) {
    return [];
  }

  try {
    const branchName = `feat/${feature}`;
    const commits = execSync(
      `git log ${branchName} --oneline --grep="wave" --format=%H 2>/dev/null || echo ""`,
      { encoding: 'utf-8' }
    ).trim().split('\n').filter(Boolean);

    return commits.map((commit, idx) => ({
      wave: idx + 1,
      branch: branchName,
      commit: commit.substring(0, 7),
      message: `Wave ${idx + 1}`,
      files: [],
      timestamp: Date.now(),
      stats: { additions: 0, deletions: 0, filesChanged: 0 }
    }));
  } catch {
    return [];
  }
}

/**
 * Create pull request (GitHub CLI)
 */
export async function createPullRequest(
  feature: string,
  title: string,
  description: string,
  baseBranch: string = 'main'
): Promise<{ url: string } | null> {
  try {
    const result = execSync(
      `gh pr create --title "${title}" --body "${description}" --base ${baseBranch} --head feat/${feature} --web`,
      { encoding: 'utf-8' }
    ).trim();

    return { url: result };
  } catch {
    return null;
  }
}

/**
 * Render git wave commit
 */
export function renderGitWaveCommit(commit: GitWaveCommit): string[] {
  const lines: string[] = [];

  lines.push(chalk.green.bold(`✓ Wave ${commit.wave} committed`));
  lines.push(chalk.gray(`  Branch: ${commit.branch}`));
  lines.push(chalk.gray(`  Commit: ${commit.commit}`));
  lines.push(chalk.white(`  Message: ${commit.message}`));
  lines.push(chalk.gray(`  Stats: +${commit.stats.additions} -${commit.stats.deletions} (${commit.stats.filesChanged} files)`));
  lines.push('');

  return lines;
}

/**
 * Render feature tag
 */
export function renderFeatureTag(tag: GitFeatureTag): string[] {
  const lines: string[] = [];

  lines.push(chalk.green.bold(`✓ Tagged: ${tag.feature}@${tag.version}`));
  lines.push(chalk.gray(`  Commit: ${tag.commit}`));
  lines.push(chalk.white(`  Message: ${tag.message}`));
  lines.push('');

  return lines;
}

/**
 * Render feature history
 */
export function renderFeatureHistory(feature: string, history: GitWaveCommit[]): string[] {
  const lines: string[] = [];

  lines.push(chalk.cyan.bold(`📚 Feature History: ${feature}`));

  if (history.length === 0) {
    lines.push(chalk.gray('  No commits found'));
    lines.push('');
    return lines;
  }

  history.forEach(commit => {
    lines.push(chalk.white(`  Wave ${commit.wave}: ${commit.commit}`));
    lines.push(chalk.gray(`    ${commit.message}`));
  });

  lines.push('');

  return lines;
}

/**
 * Clean up feature branch
 */
export function cleanupFeatureBranch(feature: string, keepLocal: boolean = false): boolean {
  if (!isGitAvailable()) {
    return false;
  }

  try {
    const branchName = `feat/${feature}`;
    execSync(`git branch ${keepLocal ? '' : '-D'} ${branchName}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
