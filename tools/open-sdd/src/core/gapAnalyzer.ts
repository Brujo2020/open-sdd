import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { GapAnalysis } from './types.js';
import { parseTasksMarkdown, resolveSddDir } from './specManager.js';

export const analyzeGap = async (
  cwd: string,
  feature: string,
  sddDir?: string,
): Promise<GapAnalysis> => {
  const resolvedDir = sddDir ?? (await resolveSddDir(cwd));
  const featureDir = path.join(cwd, resolvedDir, 'specs', feature);

  const boundariesSet = new Set<string>();
  const externalDependencies: string[] = [];
  const warnings: string[] = [];

  // Read tasks.md boundaries
  try {
    const taskContent = await readFile(path.join(featureDir, 'tasks.md'), 'utf8');
    const tasks = parseTasksMarkdown(taskContent);
    for (const task of tasks) {
      if (task.boundary) {
        task.boundary.forEach((b) => boundariesSet.add(b));
      }
    }
  } catch {
    // tasks.md might not exist yet
  }

  // Read design.md boundaries if present
  try {
    const designContent = await readFile(path.join(featureDir, 'design.md'), 'utf8');
    const matches = designContent.match(/`([^`\n]+\.[a-zA-Z0-9]+)`/g);
    if (matches) {
      for (const m of matches) {
        const cleaned = m.replace(/`/g, '').trim();
        if (
          (cleaned.startsWith('src/') ||
            cleaned.startsWith('lib/') ||
            cleaned.startsWith('packages/') ||
            cleaned.startsWith('tools/') ||
            cleaned.startsWith('app/') ||
            cleaned.startsWith('test/')) &&
          !cleaned.includes(' ')
        ) {
          boundariesSet.add(cleaned);
        }
      }
    }
  } catch {
    // design.md might not exist yet
  }

  const boundaries: GapAnalysis['boundaries'] = [];

  for (const b of boundariesSet) {
    const fullPath = path.resolve(cwd, b);
    if (!fullPath.startsWith(cwd)) {
      warnings.push(`Path traversal detected for boundary file: ${b}`);
      continue;
    }

    let exists = false;
    try {
      await stat(fullPath);
      exists = true;
    } catch {
      exists = false;
    }

    boundaries.push({
      file: b,
      exists,
      status: exists ? 'modify' : 'create',
    });
  }

  // Compute blast radius impact level
  const total = boundaries.length;
  const modifiesExisting = boundaries.filter((b) => b.exists).length;

  let impactLevel: GapAnalysis['impactLevel'] = 'LOW';
  if (modifiesExisting >= 8 || total >= 15) {
    impactLevel = 'CRITICAL';
  } else if (modifiesExisting >= 4 || total >= 8) {
    impactLevel = 'HIGH';
  } else if (modifiesExisting >= 2 || total >= 4) {
    impactLevel = 'MEDIUM';
  }

  return {
    feature,
    impactLevel,
    boundaries,
    externalDependencies,
    warnings,
  };
};
