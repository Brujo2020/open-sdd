/**
 * Audit evidence bundle (REQ-MAT-006) and SARIF 2.1.0 (REQ-MAT-007).
 *
 * Fixtures are real repositories in `fs.mkdtemp` directories, cleaned in `afterEach`. The suite
 * never spawns a CLI by name: it drives the command handler in-process, so a globally installed
 * `open-sdd` on PATH can never be resolved by accident. The one CLI-level test uses `runCli`
 * directly for the same reason.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUDIT_BUNDLE_SCHEMA,
  AUDIT_EXIT_CODES,
  SARIF_SCHEMA,
  SARIF_VERSION,
  assembleAuditBundle,
  buildSarifLog,
  bundleTimestamp,
  collectEvidence,
  handleAuditBundleCommand,
  parseBundleArgs,
  sha256,
  validateSarifShape,
} from '../src/cli/commands/audit.js';
import { runCli } from '../src/index.js';
import type { CliIO } from '../src/cli/io.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const makeIO = (): { io: CliIO; logs: string[]; errs: string[] } => {
  const logs: string[] = [];
  const errs: string[] = [];
  return {
    io: {
      log: (message: string) => logs.push(message),
      error: (message: string) => errs.push(message),
    },
    logs,
    errs,
  };
};

const EARS_REQUIREMENTS = `# Requirements — demo

### REQ-DEMO-001 — Evidence bundle

- WHEN an auditor requests the bundle, the console shall write a manifest with one sha256 per artifact.
`;

const PLAN = `# Design — demo

## Architecture

The bundle is written under .sdd/audit/.
`;

const TASKS_PENDING = `# Tasks — demo

- [ ] 1. Implement the bundle. _Requirements: REQ-DEMO-001_ _Boundary:_ \`tools/bundle.ts\`
`;

/** A completed task without the evidence marker: gate C3 must fail on it. */
const TASKS_UNPROVEN = `# Tasks — demo

- [x] 1. Implement the bundle. _Requirements: REQ-DEMO-001_ _Boundary:_ \`tools/bundle.ts\`
`;

const CONSTITUTION = `# Constitution — demo

Provenance: descriptive

## Established facts

- The tool is a TypeScript ESM CLI.

## Principles

### C-DEMO-FACT — Bundles are hashed

- Level: MUST
- Restriction: Every bundled artifact carries a sha256.
- Pattern: Hash the exact bytes on write.
- Justification: An auditor must be able to recompute every hash.
- Provenance: descriptive
- Evidence: package.json
`;

const FIXED_NOW = new Date('2026-09-19T21:18:29.493Z');

interface FixtureOptions {
  feature?: string;
  tasks?: string;
  spec?: boolean;
  constitution?: boolean;
  rigor?: string;
}

/** The four files gate C6 checks, plus the manifest layout a checkout has. */
const writeRepoDocs = async (dir: string): Promise<void> => {
  await writeFile(path.join(dir, 'README.md'), '# demo\n', 'utf8');
  await writeFile(path.join(dir, 'CLAUDE.md'), '# demo\n', 'utf8');
  await writeFile(path.join(dir, 'package.json'), '{"name":"demo","version":"0.0.0"}\n', 'utf8');
  await mkdir(path.join(dir, 'tools', 'open-sdd'), { recursive: true });
  await writeFile(
    path.join(dir, 'tools', 'open-sdd', 'package.json'),
    '{"name":"demo-tools","version":"0.0.0"}\n',
    'utf8',
  );
};

const makeFixture = async (
  options: FixtureOptions = {},
): Promise<{ dir: string; feature: string }> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'open-sdd-audit-'));
  tempDirs.push(dir);
  const feature = options.feature ?? 'demo';
  await mkdir(path.join(dir, '.sdd', 'specs'), { recursive: true });
  await mkdir(path.join(dir, '.sdd', 'settings'), { recursive: true });

  if (options.spec !== false) {
    const specDir = path.join(dir, '.sdd', 'specs', feature);
    await mkdir(specDir, { recursive: true });
    await writeFile(path.join(specDir, 'requirements.md'), EARS_REQUIREMENTS, 'utf8');
    await writeFile(path.join(specDir, 'plan.md'), PLAN, 'utf8');
    await writeFile(path.join(specDir, 'tasks.md'), options.tasks ?? TASKS_PENDING, 'utf8');
  }
  if (options.constitution) {
    await mkdir(path.join(dir, '.sdd', 'steering'), { recursive: true });
    await writeFile(path.join(dir, '.sdd', 'steering', 'constitution.md'), CONSTITUTION, 'utf8');
  }
  if (options.rigor !== undefined) {
    await writeFile(path.join(dir, '.sdd', 'settings', 'rigor.json'), options.rigor, 'utf8');
  }
  await writeRepoDocs(dir);
  return { dir, feature };
};

const readJson = async (file: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;

// ---------------------------------------------------------------------------------------------

describe('audit bundle — assembly and hashes', () => {
  it('writes a passing bundle to .sdd/audit/<timestamp>/manifest.json', async () => {
    const { dir } = await makeFixture({ constitution: true });

    const result = await assembleAuditBundle({ cwd: dir, now: FIXED_NOW });

    expect(result.dir).toBe(path.join(dir, '.sdd', 'audit', bundleTimestamp(FIXED_NOW)));
    expect(result.manifestPath).toBe(path.join(result.dir, 'manifest.json'));
    expect(result.manifest.schema).toBe(AUDIT_BUNDLE_SCHEMA);
    expect(result.manifest.verdict.passed).toBe(true);
    expect(result.manifest.verdict.exitCode).toBe(AUDIT_EXIT_CODES.pass);
    expect(result.manifest.verdict.blockedBy).toEqual([]);
    expect((await stat(result.manifestPath)).isFile()).toBe(true);

    // The constitution is in the bundle as text and as a compliance matrix.
    const constitutionText = await readFile(path.join(result.dir, 'constitution.md'), 'utf8');
    expect(constitutionText).toContain('C-DEMO-FACT');
    const matrix = await readJson(path.join(result.dir, 'constitution.json'));
    expect((matrix.principlesInForce as unknown[]).length).toBe(1);
    expect((matrix.complianceMatrix as { coverage: number }).coverage).toBeGreaterThan(0);
  });

  it('recomputes every per-artifact hash and matches the manifest', async () => {
    const { dir } = await makeFixture();
    const result = await assembleAuditBundle({ cwd: dir, now: FIXED_NOW });

    const hashed = result.manifest.artifacts.filter(
      (artifact) => artifact.present && artifact.path !== null && artifact.external !== true,
    );
    expect(hashed.length).toBeGreaterThanOrEqual(6);

    for (const artifact of hashed) {
      const onDisk = await readFile(path.join(result.dir, artifact.path as string), 'utf8');
      expect(sha256(onDisk)).toBe(artifact.sha256);
      expect(artifact.bytes).toBe(Buffer.byteLength(onDisk, 'utf8'));
    }

    // The manifest is what an auditor reads first; it must exist and carry the artifact table.
    const manifest = await readJson(result.manifestPath);
    expect(Array.isArray(manifest.artifacts)).toBe(true);
    expect((manifest.artifacts as unknown[]).length).toBe(result.manifest.artifacts.length);
  });

  it('records an absent artifact as not present with a null hash, never an empty file', async () => {
    const { dir, feature } = await makeFixture({ constitution: false });

    const result = await assembleAuditBundle({ cwd: dir, now: FIXED_NOW });

    const constitution = result.manifest.artifacts.find((artifact) => artifact.id === 'constitution:text');
    expect(constitution).toBeDefined();
    expect(constitution?.present).toBe(false);
    expect(constitution?.sha256).toBeNull();
    expect(constitution?.path).toBeNull();

    const delta = result.manifest.artifacts.find(
      (artifact) => artifact.id === `spec:${feature}:delta.md`,
    );
    expect(delta?.present).toBe(false);
    expect(delta?.sha256).toBeNull();
  });

  it('names the tool version and the generation timestamp in the manifest', async () => {
    const { dir } = await makeFixture();
    const packageJson = await readJson(
      fileURLToPath(new URL('../package.json', import.meta.url)),
    );

    const result = await assembleAuditBundle({ cwd: dir, now: FIXED_NOW });

    expect(result.manifest.tool.name).toBe('open-sdd');
    expect(result.manifest.tool.version).toBe(packageJson.version);
    expect(result.manifest.tool.version).not.toBe('dev');
    expect(result.manifest.generatedAt).toBe(FIXED_NOW.toISOString());
  });

  it('exits 1 when a gate FAILs, naming the gate that blocked', async () => {
    const { dir } = await makeFixture({ tasks: TASKS_UNPROVEN });
    const { io } = makeIO();

    const exitCode = await handleAuditBundleCommand(['bundle'], io, dir);
    const result = await assembleAuditBundle({ cwd: dir, now: FIXED_NOW });

    expect(exitCode).toBe(AUDIT_EXIT_CODES.blocking);
    expect(result.manifest.verdict.passed).toBe(false);
    expect(result.manifest.verdict.blockedBy).toContain('C3');
    expect(
      result.manifest.gates.report.findings.some(
        (finding) => finding.gateId === 'C3' && finding.outcome === 'fail',
      ),
    ).toBe(true);
  });

  it('reports a missing spec as not-as-pass and exits 1', async () => {
    const { dir } = await makeFixture({ feature: 'ghost', spec: false });
    const { io } = makeIO();

    const exitCode = await handleAuditBundleCommand(['bundle', 'ghost'], io, dir);
    const result = await assembleAuditBundle({ cwd: dir, feature: 'ghost', now: FIXED_NOW });

    expect(exitCode).toBe(AUDIT_EXIT_CODES.blocking);
    expect(result.manifest.verdict.passed).toBe(false);

    const spec = result.manifest.specs.find((entry) => entry.feature === 'ghost');
    expect(spec?.present).toBe(false);
    expect(spec?.triad.complete).toBe(false);

    const requirements = result.manifest.artifacts.find(
      (artifact) => artifact.id === 'spec:ghost:requirements.md',
    );
    expect(requirements?.present).toBe(false);
    expect(requirements?.sha256).toBeNull();
    expect(result.manifest.verdict.blockedBy).toContain('C1');
  });

  it('reports a missing claims registry honestly without inventing a broken claim', async () => {
    const { dir } = await makeFixture();
    const result = await assembleAuditBundle({ cwd: dir, now: FIXED_NOW });

    expect(result.manifest.claims.present).toBe(false);
    expect(result.manifest.claims.report).toBeNull();
    expect(result.manifest.claims.detail).toContain('no ejecutable');
    expect(result.manifest.findings.some((finding) => finding.kind === 'claim')).toBe(false);
    // An absent registry is a declared limitation, not a verdict: it must not fail the bundle.
    expect(result.manifest.verdict.passed).toBe(true);
  });

  it('returns exit 2 when the declared rigor settings cannot be read', async () => {
    const { dir } = await makeFixture({ rigor: '{ this is not json' });
    const { io, errs } = makeIO();

    const exitCode = await handleAuditBundleCommand(['bundle'], io, dir);

    expect(exitCode).toBe(AUDIT_EXIT_CODES.couldNotRun);
    expect(errs.join('\n')).toMatch(/No se pudo ejecutar la auditoría/);
  });
});

describe('audit bundle — SARIF 2.1.0', () => {
  it('emits a valid-per-shape log with one run and a result per finding', async () => {
    const { dir } = await makeFixture({ tasks: TASKS_UNPROVEN });
    const collected = await collectEvidence({ cwd: dir, now: FIXED_NOW });

    const log = buildSarifLog(collected.manifest);

    expect(validateSarifShape(log)).toEqual([]);
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0].results).toHaveLength(collected.manifest.findings.length);
    expect(collected.manifest.findings.length).toBeGreaterThan(0);
    for (const result of log.runs[0].results) {
      expect(result.ruleId.length).toBeGreaterThan(0);
      expect(['none', 'note', 'warning', 'error']).toContain(result.level);
      expect(result.message.text.length).toBeGreaterThan(0);
      expect(result.locations.length).toBeGreaterThan(0);
      expect(result.locations[0].physicalLocation.artifactLocation.uri.length).toBeGreaterThan(0);
    }
    expect(log.runs[0].tool.driver.name).toBe('open-sdd');
    expect(log.runs[0].tool.driver.rules.length).toBeGreaterThan(0);
  });

  it('uses the exact 2.1.0 version and the OASIS $schema', async () => {
    const { dir } = await makeFixture();
    const collected = await collectEvidence({ cwd: dir, now: FIXED_NOW });
    const log = buildSarifLog(collected.manifest) as unknown as Record<string, unknown>;

    expect(log.version).toBe('2.1.0');
    expect(SARIF_VERSION).toBe('2.1.0');
    expect(log.$schema).toBe(SARIF_SCHEMA);

    // The validator is the check we own: a mutated shape must be rejected, not silently accepted.
    expect(validateSarifShape({ ...log, version: '2.1' })).toContain('version debe ser "2.1.0"');
    expect(validateSarifShape({ ...log, $schema: 'https://example.com/sarif.json' })).not.toEqual([]);
  });

  it('writes SARIF to --out and exits 1 on a blocking finding', async () => {
    const { dir } = await makeFixture({ tasks: TASKS_UNPROVEN });
    const { io } = makeIO();
    const target = path.join(dir, 'open-sdd.sarif');

    const exitCode = await handleAuditBundleCommand(['sarif', '--out', target], io, dir);

    expect(exitCode).toBe(AUDIT_EXIT_CODES.blocking);
    const log = JSON.parse(await readFile(target, 'utf8')) as { runs: { results: unknown[] }[] };
    expect(validateSarifShape(log)).toEqual([]);
    expect(log.runs[0].results.length).toBeGreaterThan(0);
  });
});

describe('audit bundle — CLI surface', () => {
  it('dispatches through runCli and emits the shared JSON envelope', async () => {
    const { dir } = await makeFixture();
    const { io, logs } = makeIO();

    const exitCode = await runCli(
      ['audit', 'bundle', '--json'],
      { platform: 'darwin' },
      io,
      {},
      { cwd: dir },
    );

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(logs.join('\n')) as {
      ok: boolean;
      command: string;
      data: { schema: string; verdict: { passed: boolean } };
    };
    expect(envelope.command).toBe('audit bundle');
    expect(envelope.ok).toBe(true);
    expect(envelope.data.schema).toBe(AUDIT_BUNDLE_SCHEMA);
    expect(envelope.data.verdict.passed).toBe(true);

    // The default output location is stable: one timestamped directory under .sdd/audit/.
    const auditRoot = path.join(dir, '.sdd', 'audit');
    const entries = await readdir(auditRoot);
    expect(entries).toHaveLength(1);
  });

  it('parses the feature, the output directory, the sarif path and the json flag', () => {
    const parsed = parseBundleArgs([
      'bundle',
      'auth',
      '--out',
      'build/audit',
      '--sarif=build/open-sdd.sarif',
      '--profile',
      'regulated',
      '--json',
    ]);

    expect(parsed.sub).toBe('bundle');
    expect(parsed.feature).toBe('auth');
    expect(parsed.outDir).toBe('build/audit');
    expect(parsed.sarifPath).toBe('build/open-sdd.sarif');
    expect(parsed.profile).toBe('regulated');
    expect(parsed.json).toBe(true);

    // `audit sarif --out <path>` is the natural spelling for "write the report here".
    const sarif = parseBundleArgs(['sarif', '--out', 'report.sarif']);
    expect(sarif.sub).toBe('sarif');
    expect(sarif.sarifPath).toBe('report.sarif');
    expect(sarif.outDir).toBeUndefined();
  });

  it('bundleTimestamp is filesystem-safe and sortable', () => {
    const stamp = bundleTimestamp(FIXED_NOW);
    expect(stamp).toBe('2026-09-19T21-18-29-493Z');
    expect(stamp).not.toMatch(/[:.]/);
    expect(bundleTimestamp(new Date('2026-09-19T21:18:30.000Z')) > stamp).toBe(true);
  });
});
