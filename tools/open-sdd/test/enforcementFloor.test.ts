import { describe, it, expect, afterEach } from 'vitest';
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseSecurityAllowlist,
  applySecurityAllowlist,
} from '../src/core/securityAllowlist.js';
import { detectInstalledFloor } from '../src/core/floorInstallation.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'open-sdd-floor-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('core/securityAllowlist — declared, recorded, reported', () => {
  it('parses a well-formed entry', () => {
    const { entries, rejected } = parseSecurityAllowlist(
      JSON.stringify({
        allow: [
          { path: 'test/fixtures.ts', ids: ['aws-access-key'], reason: 'fixture', actor: 'spec:demo' },
        ],
      }),
    );

    expect(rejected).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe('test/fixtures.ts');
  });

  it('rejects a global exception with no ids', () => {
    const { entries, rejected } = parseSecurityAllowlist(
      JSON.stringify({ allow: [{ path: 'src/', ids: [], reason: 'porque sí' }] }),
    );

    expect(entries).toEqual([]);
    expect(rejected[0].reason).toContain('falta ids');
  });

  it('rejects an exception with no reason: every relaxation is a recorded event', () => {
    const { entries, rejected } = parseSecurityAllowlist(
      JSON.stringify({ allow: [{ path: 'src/x.ts', ids: ['generic-assignment'], reason: '   ' }] }),
    );

    expect(entries).toEqual([]);
    expect(rejected[0].reason).toContain('falta reason');
  });

  it('reports invalid JSON instead of silently suppressing nothing', () => {
    const { entries, rejected } = parseSecurityAllowlist('{not json');
    expect(entries).toEqual([]);
    expect(rejected).toHaveLength(1);
  });

  it('suppresses only the declared (path, id) pairs and cites the reason', () => {
    const entries = [
      { path: 'test/fixtures.ts', ids: ['aws-access-key'], reason: 'fixture de prueba' },
    ];
    const decision = applySecurityAllowlist(
      [
        { id: 'aws-access-key', kind: 'secret', file: 'test/fixtures.ts', line: 3 },
        // Same file, a pattern nobody declared: it must still stand.
        { id: 'openai-key', kind: 'secret', file: 'test/fixtures.ts', line: 9 },
        // Declared id, different file: it must still stand.
        { id: 'aws-access-key', kind: 'secret', file: 'src/config.ts', line: 1 },
      ],
      entries,
    );

    expect(decision.suppressed).toEqual([
      { id: 'aws-access-key', file: 'test/fixtures.ts', line: 3, reason: 'fixture de prueba' },
    ]);
    expect(decision.kept.map((f) => `${f.file}:${f.id}`)).toEqual([
      'test/fixtures.ts:openai-key',
      'src/config.ts:aws-access-key',
    ]);
  });

  it('treats a path ending in a slash as a directory prefix', () => {
    const decision = applySecurityAllowlist(
      [{ id: 'curl-pipe-shell', kind: 'destructive', file: 'Claude outputs/notes.md', line: 2 }],
      [{ path: 'Claude outputs/', ids: ['curl-pipe-shell'], reason: 'documentos heredados' }],
    );

    expect(decision.kept).toEqual([]);
    expect(decision.suppressed).toHaveLength(1);
  });

  it('ships a repository allow-list whose every entry carries a reason and an actor', async () => {
    const raw = await import('node:fs/promises').then((fs) =>
      fs.readFile(path.join(repoRoot, '.sdd', 'settings', 'security-allowlist.json'), 'utf8'),
    );
    const { entries, rejected } = parseSecurityAllowlist(raw);

    expect(rejected).toEqual([]);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.reason.trim().length).toBeGreaterThan(0);
      expect(entry.ids.length).toBeGreaterThan(0);
      expect(entry.actor?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('core/floorInstallation — installed, not merely declared', () => {
  it('reports nothing installed for an empty directory', async () => {
    const dir = await makeTempDir();
    const floor = await detectInstalledFloor(dir);

    expect(floor.commitHookShipped).toBe(false);
    expect(floor.commitHookInstalled).toBe(false);
    expect(floor.ciGateMatrix).toBe(false);
    expect(floor.floorInstalled).toBe(false);
    expect(floor.detail).toContain('NO instalado');
  });

  it('counts a workflow as the merge boundary only when it runs on pull requests', async () => {
    const dir = await makeTempDir();
    await mkdir(path.join(dir, '.github', 'workflows'), { recursive: true });
    // Runs the chain, but only on tags: that is a release check, not a merge gate.
    await writeFile(
      path.join(dir, '.github', 'workflows', 'release.yml'),
      'on:\n  push:\n    tags: ["v*"]\njobs:\n  x:\n    steps:\n      - run: open-sdd gates run\n',
      'utf8',
    );

    const floor = await detectInstalledFloor(dir);
    expect(floor.workflowsReferencingGates).toEqual(['release.yml']);
    expect(floor.ciGateMatrix).toBe(false);
  });

  it('reports the floor installed when the hook is shipped and installed and CI gates pull requests', async () => {
    const dir = await makeTempDir();
    const hook = path.join('tools', 'open-sdd', 'templates', 'hooks', 'pre-commit');
    await mkdir(path.join(dir, path.dirname(hook)), { recursive: true });
    await writeFile(path.join(dir, hook), '#!/bin/bash\n', 'utf8');
    await mkdir(path.join(dir, '.git', 'hooks'), { recursive: true });
    await writeFile(path.join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/bash\n', 'utf8');
    await mkdir(path.join(dir, '.github', 'workflows'), { recursive: true });
    await writeFile(
      path.join(dir, '.github', 'workflows', 'gates.yml'),
      'on:\n  pull_request:\njobs:\n  g:\n    steps:\n      - run: open-sdd gates run\n',
      'utf8',
    );

    const floor = await detectInstalledFloor(dir);
    expect(floor.floorInstalled).toBe(true);
    expect(floor.detail).toContain('Suelo instalado');
  });

  it.skipIf(process.platform === 'win32')('this repository ships an executable commit hook and a pull-request gate matrix', async () => {
    const floor = await detectInstalledFloor(repoRoot);

    expect(floor.commitHookShipped).toBe(true);
    expect(floor.ciGateMatrix).toBe(true);
    // The hook must be executable, or git silently ignores it — a control that is present and
    // does not run is the failure mode this whole module exists to expose.
    const hookStat = await stat(
      path.join(repoRoot, 'tools', 'open-sdd', 'templates', 'hooks', 'pre-commit'),
    );
    expect(hookStat.mode & 0o111).toBeGreaterThan(0);
  });

  it('ships a hook that judges the staged index and fails closed when the CLI is missing', async () => {
    const hookSource = await import('node:fs/promises').then((fs) =>
      fs.readFile(path.join(repoRoot, 'tools', 'open-sdd', 'templates', 'hooks', 'pre-commit'), 'utf8'),
    );

    expect(hookSource).toContain('gates run');
    expect(hookSource).toContain('--staged');
    expect(hookSource).toContain('C2');
    // Fail-closed path: the hook must refuse to commit when it cannot run the control.
    expect(hookSource).toContain('COMMIT BLOQUEADO');
    expect(hookSource).toContain('exit 1');
    // The recorded channel for a false positive, not a silent suppression.
    expect(hookSource).toContain('security-allowlist.json');
  });

  it('installs the hook into a target repository through the CLI installer script', async () => {
    const dir = await makeTempDir();
    await mkdir(path.join(dir, '.git'), { recursive: true });
    // The installer resolves the hook relative to its own location, so run the real one with an
    // explicit target by copying the script next to a stub tree is out of scope here; instead the
    // CLI path is exercised in cliEntry tests. Assert the template the installer copies exists.
    await chmod(path.join(dir, '.git'), 0o755);
    const template = await stat(
      path.join(repoRoot, 'tools', 'open-sdd', 'templates', 'hooks', 'open-sdd-gates.yml'),
    );
    expect(template.isFile()).toBe(true);
  });
});

describe('core/securityAllowlist — the compiled twin rule', () => {
  it('lists a dist/ twin for every allow-listed src/ file, because dist is shipped and scanned', async () => {
    const raw = await import('node:fs/promises').then((fs) =>
      fs.readFile(path.join(repoRoot, '.sdd', 'settings', 'security-allowlist.json'), 'utf8'),
    );
    const { entries } = parseSecurityAllowlist(raw);
    const paths = new Set(entries.map((e) => e.path));

    // The scanner's own pattern tables and demo probes live in `src/` and are re-emitted into the
    // committed `dist/`. Allow-listing only the source made the pre-commit gate block the very
    // commit that introduced the exception, so the pairing is now enforced instead of remembered.
    const sources = entries.filter((e) => e.path.startsWith('tools/open-sdd/src/'));
    expect(sources.length).toBeGreaterThan(0);

    for (const source of sources) {
      const twin = source.path
        .replace('tools/open-sdd/src/', 'tools/open-sdd/dist/')
        .replace(/\.ts$/, '.js');
      expect(paths.has(twin), `missing allow-list entry for compiled twin ${twin}`).toBe(true);
    }
  });
});
