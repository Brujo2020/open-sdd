import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  scanProject,
  bootstrapSteering,
  bootstrapSpecSeeds,
} from '../src/core/reverseEngineering.js';

describe('core/reverseEngineering', () => {
  it('introspects node project and bootstraps steering and spec seeds', async () => {
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'sdd-test-brownfield-'));

    // Create a mock TypeScript project
    const packageJson = {
      name: 'awesome-platform',
      dependencies: {
        express: '^4.19.0',
        typescript: '^5.0.0',
      },
      devDependencies: {
        vitest: '^1.0.0',
      },
    };
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(packageJson), 'utf8');
    await mkdir(path.join(tmpDir, 'src', 'auth'), { recursive: true });
    await mkdir(path.join(tmpDir, 'src', 'billing'), { recursive: true });
    await writeFile(path.join(tmpDir, 'src', 'auth', 'index.ts'), 'export const auth = true;');

    const project = await scanProject(tmpDir);
    expect(project.name).toBe('awesome-platform');
    expect(project.language).toBe('TypeScript');
    expect(project.frameworks).toContain('Express');
    expect(project.testFramework).toBe('Vitest');
    expect(project.modules).toContain('auth');
    expect(project.modules).toContain('billing');

    // Bootstrap steering
    const steering = await bootstrapSteering(tmpDir, project);
    expect(steering.filesCreated).toContain('product.md');
    expect(steering.filesCreated).toContain('tech.md');
    expect(steering.filesCreated).toContain('structure.md');

    // Bootstrap spec seeds
    const seeds = await bootstrapSpecSeeds(tmpDir);
    expect(seeds.seedsCreated.length).toBeGreaterThan(0);

    const checkSeed = await stat(path.join(tmpDir, '.sdd', 'specs', 'auth', 'spec.json'));
    expect(checkSeed.isFile()).toBe(true);
  });
});
