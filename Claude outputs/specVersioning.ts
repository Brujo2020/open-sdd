import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

/**
 * Spec versioning & diff tracking
 * Compare specs between versions and track changes
 */

export interface SpecVersion {
  version: string;
  timestamp: number;
  hash: string;
  files: Map<string, string>;
  metadata: {
    requirements: number;
    filesPlanned: number;
    estimatedHours: number;
  };
}

export interface SpecDiff {
  version1: string;
  version2: string;
  addedRequirements: string[];
  removedRequirements: string[];
  modifiedRequirements: Array<{ before: string; after: string }>;
  newFilesPlanned: string[];
  removedFilesPlanned: string[];
  impact: 'low' | 'medium' | 'high';
  changePercentage: number;
}

/**
 * Calculate SHA hash of spec content
 */
export function hashSpecContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

/**
 * Save spec version to disk
 */
export async function saveSpecVersion(
  feature: string,
  version: string,
  requirementsContent: string,
  designContent: string,
  sddDir: string = '.sdd'
): Promise<SpecVersion> {
  const versionsDir = path.join(sddDir, '.versions', feature);

  if (!fs.existsSync(versionsDir)) {
    fs.mkdirSync(versionsDir, { recursive: true });
  }

  const files = new Map([
    ['requirements.md', requirementsContent],
    ['design.md', designContent]
  ]);

  const fullContent = `${requirementsContent}\n${designContent}`;
  const hash = hashSpecContent(fullContent);

  const specVersion: SpecVersion = {
    version,
    timestamp: Date.now(),
    hash,
    files,
    metadata: {
      requirements: countMatches(requirementsContent, /^[-*]\s+/gm),
      filesPlanned: countMatches(designContent, /\.(ts|js|tsx|jsx|md|json)$/gm),
      estimatedHours: Math.ceil(countMatches(requirementsContent, /^[-*]\s+/gm) / 3)
    }
  };

  const versionPath = path.join(versionsDir, `v${version}.json`);
  fs.writeFileSync(versionPath, JSON.stringify(specVersion,
    (key, value) => value instanceof Map ? Object.fromEntries(value) : value,
    2
  ), 'utf-8');

  return specVersion;
}

/**
 * Load spec version
 */
export function loadSpecVersion(
  feature: string,
  version: string,
  sddDir: string = '.sdd'
): SpecVersion | null {
  const versionPath = path.join(sddDir, '.versions', feature, `v${version}.json`);

  if (!fs.existsSync(versionPath)) {
    return null;
  }

  const content = fs.readFileSync(versionPath, 'utf-8');
  const data = JSON.parse(content);

  data.files = new Map(Object.entries(data.files));
  return data as SpecVersion;
}

/**
 * List all versions of a feature
 */
export function listSpecVersions(
  feature: string,
  sddDir: string = '.sdd'
): SpecVersion[] {
  const versionsDir = path.join(sddDir, '.versions', feature);

  if (!fs.existsSync(versionsDir)) {
    return [];
  }

  return fs.readdirSync(versionsDir)
    .filter(f => f.startsWith('v') && f.endsWith('.json'))
    .map(f => {
      const content = fs.readFileSync(path.join(versionsDir, f), 'utf-8');
      const data = JSON.parse(content);
      data.files = new Map(Object.entries(data.files));
      return data as SpecVersion;
    })
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Compare two spec versions
 */
export function compareSpecVersions(
  v1: SpecVersion,
  v2: SpecVersion
): SpecDiff {
  const reqs1 = extractRequirements(v1.files.get('requirements.md') || '');
  const reqs2 = extractRequirements(v2.files.get('requirements.md') || '');

  const files1 = extractFiles(v1.files.get('design.md') || '');
  const files2 = extractFiles(v2.files.get('design.md') || '');

  const added = reqs2.filter(r => !reqs1.includes(r));
  const removed = reqs1.filter(r => !reqs2.includes(r));
  const modified = reqs1
    .filter(r => reqs2.includes(r))
    .map(r => ({ before: r, after: r }));

  const newFiles = files2.filter(f => !files1.includes(f));
  const removedFiles = files1.filter(f => !files2.includes(f));

  const totalChanges = added.length + removed.length + newFiles.length + removedFiles.length;
  const totalItems = Math.max(reqs1.length + files1.length, 1);
  const changePercentage = Math.round((totalChanges / totalItems) * 100);

  let impact: 'low' | 'medium' | 'high' = 'low';
  if (changePercentage > 50) impact = 'high';
  else if (changePercentage > 20) impact = 'medium';

  return {
    version1: v1.version,
    version2: v2.version,
    addedRequirements: added,
    removedRequirements: removed,
    modifiedRequirements: modified,
    newFilesPlanned: newFiles,
    removedFilesPlanned: removedFiles,
    impact,
    changePercentage
  };
}

/**
 * Extract requirements from markdown
 */
function extractRequirements(content: string): string[] {
  const matches = content.match(/^[-*]\s+(.+)$/gm) || [];
  return matches.map(m => m.replace(/^[-*]\s+/, '').trim());
}

/**
 * Extract planned files from markdown
 */
function extractFiles(content: string): string[] {
  const matches = content.match(/([a-zA-Z0-9_./:-]+\.(ts|js|tsx|jsx|md|json))/g) || [];
  return [...new Set(matches)];
}

/**
 * Count regex matches
 */
function countMatches(text: string, regex: RegExp): number {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

/**
 * Render spec version info
 */
export function renderSpecVersionInfo(version: SpecVersion): string[] {
  const lines: string[] = [];
  const timestamp = new Date(version.timestamp).toLocaleString();

  lines.push(chalk.cyan.bold(`📌 Spec Version ${version.version}`));
  lines.push(chalk.gray(`├─ Hash: ${version.hash.substring(0, 8)}`));
  lines.push(chalk.gray(`├─ Saved: ${timestamp}`));
  lines.push(chalk.gray(`├─ Requirements: ${version.metadata.requirements}`));
  lines.push(chalk.gray(`├─ Files planned: ${version.metadata.filesPlanned}`));
  lines.push(chalk.gray(`└─ Estimated: ${version.metadata.estimatedHours}h`));
  lines.push('');

  return lines;
}

/**
 * Render spec diff
 */
export function renderSpecDiff(diff: SpecDiff): string[] {
  const lines: string[] = [];
  const icon = diff.impact === 'high' ? '🔴' : diff.impact === 'medium' ? '🟠' : '🟢';

  lines.push(chalk.cyan.bold(`\n${icon} Spec Diff: v${diff.version1} → v${diff.version2}`));
  lines.push(chalk.gray(`Impact: ${diff.impact.toUpperCase()} (${diff.changePercentage}% changed)`));
  lines.push('');

  if (diff.addedRequirements.length > 0) {
    lines.push(chalk.green(`✨ Added Requirements (${diff.addedRequirements.length}):`));
    diff.addedRequirements.slice(0, 5).forEach(r => {
      lines.push(chalk.white(`  + ${r}`));
    });
    if (diff.addedRequirements.length > 5) {
      lines.push(chalk.gray(`  ... and ${diff.addedRequirements.length - 5} more`));
    }
    lines.push('');
  }

  if (diff.removedRequirements.length > 0) {
    lines.push(chalk.red(`✗ Removed Requirements (${diff.removedRequirements.length}):`));
    diff.removedRequirements.slice(0, 5).forEach(r => {
      lines.push(chalk.gray(`  - ${r}`));
    });
    if (diff.removedRequirements.length > 5) {
      lines.push(chalk.gray(`  ... and ${diff.removedRequirements.length - 5} more`));
    }
    lines.push('');
  }

  if (diff.newFilesPlanned.length > 0) {
    lines.push(chalk.green(`📄 New Files (${diff.newFilesPlanned.length}):`));
    diff.newFilesPlanned.slice(0, 5).forEach(f => {
      lines.push(chalk.white(`  + ${f}`));
    });
    if (diff.newFilesPlanned.length > 5) {
      lines.push(chalk.gray(`  ... and ${diff.newFilesPlanned.length - 5} more`));
    }
    lines.push('');
  }

  if (diff.removedFilesPlanned.length > 0) {
    lines.push(chalk.red(`🗑️  Removed Files (${diff.removedFilesPlanned.length}):`));
    diff.removedFilesPlanned.slice(0, 5).forEach(f => {
      lines.push(chalk.gray(`  - ${f}`));
    });
    if (diff.removedFilesPlanned.length > 5) {
      lines.push(chalk.gray(`  ... and ${diff.removedFilesPlanned.length - 5} more`));
    }
    lines.push('');
  }

  return lines;
}
