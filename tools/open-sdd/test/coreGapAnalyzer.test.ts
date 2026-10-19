import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initSpec } from '../src/core/specManager.js';
import { analyzeGap } from '../src/core/gapAnalyzer.js';

describe('core/gapAnalyzer', () => {
  it('analyzes file boundaries and blast radius impact', async () => {
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'sdd-test-gap-'));
    const { specDir } = await initSpec(tmpDir, 'payment-gateway', { createBranch: false });

    // Existing file in project
    await mkdir(path.join(tmpDir, 'src', 'billing'), { recursive: true });
    await writeFile(path.join(tmpDir, 'src', 'billing', 'existing.ts'), 'export const a = 1;');

    // tasks.md with boundaries
    const tasksMd = `
# Tasks
- [ ] 1. Modify existing file _Boundary:_ \`src/billing/existing.ts\`
- [ ] 2. Create new gateway client _Boundary:_ \`src/billing/gateway.ts\`
- [ ] 3. Create test file _Boundary:_ \`test/billing/gateway.test.ts\`
`;
    await writeFile(path.join(specDir, 'tasks.md'), tasksMd, 'utf8');

    const gap = await analyzeGap(tmpDir, 'payment-gateway');
    expect(gap.feature).toBe('payment-gateway');
    expect(gap.boundaries).toHaveLength(3);

    const existingBoundary = gap.boundaries.find((b) => b.file === 'src/billing/existing.ts');
    expect(existingBoundary?.exists).toBe(true);
    expect(existingBoundary?.status).toBe('modify');

    const newBoundary = gap.boundaries.find((b) => b.file === 'src/billing/gateway.ts');
    expect(newBoundary?.exists).toBe(false);
    expect(newBoundary?.status).toBe('create');

    expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(gap.impactLevel);
  });
});
