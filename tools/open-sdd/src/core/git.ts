import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { GitSettings } from './types.js';

export const defaultGitSettings: GitSettings = {
  mode: 'assisted',
  branch_prefix: 'feat/',
  auto_branch: true,
  auto_commit: true,
  auto_push: false,
  require_approved_spec: true,
};

export const isGitRepo = (cwd: string = process.cwd()): boolean => {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

export const getCurrentBranch = (cwd: string = process.cwd()): string | undefined => {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
};

export const hasUncommittedChanges = (cwd: string = process.cwd()): boolean => {
  try {
    const out = execSync('git status --porcelain', { cwd, encoding: 'utf8' }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
};

export const getModifiedFiles = (cwd: string = process.cwd()): string[] => {
  try {
    // Do NOT trim the output as a whole. The porcelain format is `XY<space>path`, and for the
    // common "modified, not staged" case the first character is a SPACE. Trimming stripped that
    // leading space from the FIRST line only, after which `slice(3)` ate a real character from the
    // path ("docs/x.md" became "ocs/x.md"). The victim was whichever file git happened to list
    // first, which is why it looked random — and the truncated path matched no declared boundary,
    // so it produced false ambient-drift findings.
    const out = execSync('git status --porcelain', { cwd, encoding: 'utf8' });
    if (!out.trim()) return [];
    return out
      .split('\n')
      .map((line) => line.replace(/\r$/, ''))
      .filter((line) => line.length > 3)
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};

export const loadGitSettings = async (
  cwd: string = process.cwd(),
  sddDir: string = '.sdd',
): Promise<GitSettings> => {
  const settingsPath = path.join(cwd, sddDir, 'settings', 'git.json');
  try {
    const content = await readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(content);
    return { ...defaultGitSettings, ...parsed };
  } catch {
    return defaultGitSettings;
  }
};

export const createAndCheckoutBranch = (
  branchName: string,
  cwd: string = process.cwd(),
): boolean => {
  try {
    execSync(`git checkout -b "${branchName}"`, { cwd, stdio: 'pipe' });
    return true;
  } catch {
    // Branch might already exist; try checkout
    try {
      execSync(`git checkout "${branchName}"`, { cwd, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
};

export const commitFiles = (
  files: string[],
  message: string,
  cwd: string = process.cwd(),
): boolean => {
  try {
    const fileArgs = files.map((f) => `"${f}"`).join(' ');
    execSync(`git add ${fileArgs}`, { cwd, stdio: 'pipe' });
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

export const pushCurrentBranch = (cwd: string = process.cwd()): boolean => {
  try {
    const branch = getCurrentBranch(cwd);
    if (!branch) return false;
    execSync(`git push -u origin "${branch}"`, { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};
