import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), 'utf8');

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const pkg = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

/** Fenced code blocks only: an install command inside prose may legitimately quote the wrong one. */
const codeBlocks = (markdown: string): string[] =>
  [...markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);

describe('release integrity — one publishable identity', () => {
  it('the root manifest carries the public scope and a public access policy', () => {
    const root = pkg('package.json');
    expect(root.name).toBe('@brujo2020/open-sdd');
    expect(root.version).toMatch(/^\d+\.\d+\.\d+$/);
    // Scoped packages publish as private by default; this is the switch that makes them public.
    expect(root.publishConfig?.access).toBe('public');
  });

  it('the published artifact ships the CLI and the agent templates', () => {
    const root = pkg('package.json');
    expect(root.files).toContain('tools/open-sdd/dist');
    expect(root.files).toContain('tools/open-sdd/templates');
    // Every bin must point at a file that exists, or `npm i -g` installs a broken command.
    for (const target of Object.values(root.bin ?? {}) as string[]) {
      expect(existsSync(path.join(repoRoot, target)), `missing bin target ${target}`).toBe(true);
    }
    expect(existsSync(path.join(repoRoot, 'tools', 'open-sdd', 'dist', 'cli.js'))).toBe(true);
    expect(statSync(path.join(repoRoot, 'tools', 'open-sdd', 'dist', 'cli.js')).isFile()).toBe(true);
  });

  it('the workspace manifest is private, so it can never be published by accident', () => {
    // Two manifests live here: the root (the artifact) and tools/open-sdd (the build toolchain).
    // Before the rename, publishing ran from the workspace and would have shipped an unscoped
    // `open-sdd` while the repository had already decided on the scoped name.
    const workspace = pkg('tools/open-sdd/package.json');
    expect(workspace.private).toBe(true);
  });

  it('install:global installs the publishable package, not the private workspace', () => {
    const root = pkg('package.json');
    const script: string = root.scripts['install:global'];
    expect(script).toContain('npm install -g .');
    expect(script).not.toContain('./tools/open-sdd');
  });
});

describe('release integrity — the publish pipeline targets the right package', () => {
  const workflow = read('.github/workflows/publish.yml');

  it('publishes from the repository root with explicit public access', () => {
    expect(workflow).toContain('npm publish');
    expect(workflow).toContain('--access public');

    // A `working-directory` on the publish step would publish the private workspace manifest.
    const publishStep = workflow.slice(workflow.indexOf('- name: Publish'));
    expect(publishStep).not.toContain('working-directory');
  });

  it('refuses to publish a tree whose suite or gates are red', () => {
    const publishIndex = workflow.indexOf('npm publish');
    expect(workflow.indexOf('npm test')).toBeGreaterThan(-1);
    expect(workflow.indexOf('npm test')).toBeLessThan(publishIndex);
    expect(workflow).toContain('gates run');
    expect(workflow).toContain('assure claims --verify');
  });

  it('asserts the published name before publishing', () => {
    expect(workflow).toContain('@brujo2020/open-sdd');
    expect(workflow.indexOf('Confirm the published identity')).toBeLessThan(
      workflow.indexOf('npm publish'),
    );
  });
});

describe('release integrity — the documentation advertises what actually resolves', () => {
  const installDocs = [
    'README.md',
    'docs/INSTALLATION.md',
    'docs/QUICK-START.md',
    'tools/open-sdd/README.md',
    'docs/guides/brownfield-getspecs.md',
    'docs/guides/universal-brownfield-sdd.md',
  ];

  it('no code block tells a reader to run the unscoped package, which does not exist on npm', () => {
    const offenders: string[] = [];
    for (const rel of installDocs) {
      if (!existsSync(path.join(repoRoot, rel))) continue;
      for (const block of codeBlocks(read(rel))) {
        if (/npx\s+open-sdd@|install -g open-sdd@|uninstall -g open-sdd\b/.test(block)) {
          offenders.push(rel);
        }
      }
    }
    expect(offenders, `unscoped install commands in:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the entry-point documentation names the scoped package', () => {
    expect(read('README.md')).toContain('@brujo2020/open-sdd');
    expect(read('docs/INSTALLATION.md')).toContain('@brujo2020/open-sdd');
  });

  it('the root README states that the scoped package is not published yet', () => {
    // Promising `npx` before the first publish is the false claim the earlier docs made.
    expect(read('README.md')).toMatch(/not published yet/i);
  });
});

describe('release integrity — the installed CLI reports the released version', () => {
  it('resolves the version from the published manifest, not from a file that is not shipped', () => {
    const root = pkg('package.json');
    // The tarball ships dist + templates and never the workspace manifest, so a version read that
    // depends on `tools/open-sdd/package.json` prints "vdev" once installed. That was a real defect
    // of the published artifact, found by installing the packed tarball.
    expect(root.files).not.toContain('tools/open-sdd/package.json');
    expect(existsSync(path.join(repoRoot, 'tools', 'open-sdd', 'package.json'))).toBe(true);

    const cli = path.join(repoRoot, 'tools', 'open-sdd', 'dist', 'cli.js');
    const run = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('v' + root.version);
    expect(run.stdout).not.toContain('vdev');
  });
});

describe('release integrity — postinstall is silent for consumers, useful for contributors', () => {
  it('exits quietly when the workspace sources are absent (a published install)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'open-sdd-postinstall-'));
    tempDirs.push(dir);
    await mkdir(path.join(dir, 'scripts'), { recursive: true });
    await mkdir(path.join(dir, 'tools', 'open-sdd'), { recursive: true });
    await copyFile(
      path.join(repoRoot, 'scripts', 'postinstall.mjs'),
      path.join(dir, 'scripts', 'postinstall.mjs'),
    );
    await writeFile(
      path.join(dir, 'tools', 'open-sdd', 'package.json'),
      '{"name":"x","version":"1.0.0"}',
      'utf8',
    );

    const run = spawnSync(process.execPath, [path.join(dir, 'scripts', 'postinstall.mjs')], {
      encoding: 'utf8',
    });

    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe('');
    expect(run.stderr.trim()).toBe('');
  });

  it('still installs workspace dependencies in a source checkout', () => {
    const script = read('scripts/postinstall.mjs');
    // The condition that separates a contributor checkout from a consumer install.
    expect(script).toContain("existsSync(path.join(workspace, 'src'))");
    expect(script).toContain("spawnSync('npm'");
  });
});
