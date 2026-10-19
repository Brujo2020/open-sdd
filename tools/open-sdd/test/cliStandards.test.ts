/**
 * Pruebas de comportamiento de la consola `standards` (REQ-STD-003, REQ-STD-008).
 *
 * Cada caso monta un proyecto en `mkdtemp` con una copia del catálogo real y artefactos con
 * violaciones conocidas. Nada se escribe en este repositorio.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleStandardsCommand } from '../src/cli/commands/standards.js';
import type { CliIO } from '../src/cli/io.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const makeIO = (): { io: CliIO; logs: string[]; errors: string[] } => {
  const logs: string[] = [];
  const errors: string[] = [];
  const io: CliIO = {
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
    exit: () => undefined,
  };
  return { io, logs, errors };
};

const REQUIREMENTS = [
  '# Demo Requirements',
  '',
  '## Requirements',
  '',
  '### REQ-DEMO-001 — Access',
  '',
  '- Statement: WHEN a request arrives, the gateway shall log it.',
  '- Statement: when the user submits the form, the gateway shall log it.',
  '- Statement: The gateway shall respond approximately.',
  '- Statement: The gateway shall store the record in PostgreSQL.',
  '',
].join('\n');

const fixture = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'open-sdd-cli-standards-'));
  temps.push(dir);
  await cp(path.join(repoRoot, '.sdd/settings/standards'), path.join(dir, '.sdd/settings/standards'), {
    recursive: true,
  });
  await mkdir(path.join(dir, '.sdd/specs/demo'), { recursive: true });
  await writeFile(path.join(dir, '.sdd/specs/demo/requirements.md'), REQUIREMENTS, 'utf8');
  await writeFile(path.join(dir, '.sdd/specs/demo/spec.json'), '{ "feature": "demo" }', 'utf8');
  return dir;
};

const envelope = (logs: string[]): Record<string, unknown> => JSON.parse(logs.join('\n')) as Record<string, unknown>;

describe('cli/standards — list, show, explain', () => {
  it('lists the catalogue and marks it advisory', async () => {
    const cwd = await fixture();
    const { io, logs } = makeIO();
    const code = await handleStandardsCommand(['list'], io, cwd);
    expect(code).toBe(0);
    const output = logs.join('\n');
    expect(output).toContain('REQ-EARS-001');
    expect(output).toContain('advisory');
  });

  it('emits the list inside the single JSON envelope', async () => {
    const cwd = await fixture();
    const { io, logs } = makeIO();
    await handleStandardsCommand(['list', '--json'], io, cwd);
    const parsed = envelope(logs);
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('standards list');
    const data = parsed.data as { entries: { id: string; blocking: boolean }[] };
    expect(data.entries.length).toBeGreaterThanOrEqual(12);
    expect(data.entries.every((entry) => entry.blocking === false)).toBe(true);
  });

  it('shows one entry with its source and the evidence that implements it', async () => {
    const cwd = await fixture();
    const { io, logs } = makeIO();
    await handleStandardsCommand(['show', 'REQ-EARS-001', '--json'], io, cwd);
    const parsed = envelope(logs);
    const data = parsed.data as { entry: { id: string; source: string; evidence: string } };
    expect(data.entry.id).toBe('REQ-EARS-001');
    expect(data.entry.source).toContain('.sdd/settings/rules/');
    expect(data.entry.evidence).toContain('ears.ts');
  });

  it('explains a standard offline, with its rationale', async () => {
    const cwd = await fixture();
    const { io, logs } = makeIO();
    await handleStandardsCommand(['explain', 'REQ-GATE-003', '--json'], io, cwd);
    const parsed = envelope(logs);
    const data = parsed.data as { offline: boolean; advisory: boolean; entry: { source: string } };
    expect(data.offline).toBe(true);
    expect(data.advisory).toBe(true);
    expect(parsed.detail).toContain('REQ-GATE-003');
  });

  it('refuses an unknown id by name', async () => {
    const cwd = await fixture();
    const { io, errors } = makeIO();
    const code = await handleStandardsCommand(['show', 'REQ-NOPE-999'], io, cwd);
    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('REQ-NOPE-999');
  });
});

describe('cli/standards — check', () => {
  it('reports positioned findings and stays ok while everything is advisory', async () => {
    const cwd = await fixture();
    const { io, logs } = makeIO();
    const code = await handleStandardsCommand(['check', '--json'], io, cwd);
    expect(code).toBe(0);
    const parsed = envelope(logs);
    expect(parsed.ok).toBe(true);
    const data = parsed.data as {
      findings: { standardId: string; file: string; line: number; column: number; message: string }[];
    };
    const casing = data.findings.find((finding) => finding.standardId === 'REQ-EARS-010');
    expect(casing).toMatchObject({ file: '.sdd/specs/demo/requirements.md', line: 8, column: 14 });
    expect(data.findings.some((finding) => finding.standardId === 'REQ-GATE-003')).toBe(true);
    expect(data.findings.some((finding) => finding.standardId === 'REQ-DOC-001')).toBe(true);
  });

  it('reports rule drift instead of rewriting the rule files (REQ-STD-002)', async () => {
    const cwd = await fixture();
    const { io, logs } = makeIO();
    await handleStandardsCommand(['check', '--json'], io, cwd);
    const data = envelope(logs).data as { drift: { file: string; reason: string; entries: string[] }[] };
    const ears = data.drift.find((rule) => rule.file === '.sdd/settings/rules/ears-format.md');
    expect(ears?.reason).toBe('missing');
    expect(ears?.entries).toContain('REQ-EARS-001');
  });

  it('renders file:line:column in the human output', async () => {
    const cwd = await fixture();
    const { io, logs } = makeIO();
    await handleStandardsCommand(['check'], io, cwd);
    expect(logs.join('\n')).toContain('.sdd/specs/demo/requirements.md:8:14');
  });

  it('exits 1 only when a calibrated standard is allowed to block', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'open-sdd-cli-blocking-'));
    temps.push(dir);
    const standardsDir = path.join(dir, '.sdd/settings/standards');
    await mkdir(standardsDir, { recursive: true });
    await writeFile(
      path.join(standardsDir, 'blocking.json'),
      JSON.stringify(
        {
          id: 'REQ-CAL-001',
          title: 'a calibrated blocker',
          category: 'requirements',
          severity: 'error',
          blocking: true,
          appliesTo: ['requirements.md'],
          standard: 'internal',
          source: '.sdd/settings/rules/requirements-review-gate.md#mechanical-checks',
          detect: { kind: 'regex', patterns: ['forbidden'] },
          message: 'the artifact contains `forbidden`',
          remedy: { autoFixable: false, grades: [{ grade: 'maybe-incorrect', text: 'remove `forbidden`' }] },
          evidence: 'tools/open-sdd/src/core/standards.ts#runStandard',
          calibrated: { corpus: 'corpus/measured.md', recall: 0.9, fpr: 0.1 },
        },
        null,
        2,
      ),
      'utf8',
    );
    await writeFile(path.join(dir, 'requirements.md'), 'The system shall expose a forbidden field.\n', 'utf8');

    const { io, logs } = makeIO();
    const code = await handleStandardsCommand(['check', '--json'], io, dir);
    expect(code).toBe(1);
    const parsed = envelope(logs);
    expect(parsed.ok).toBe(false);
    expect((parsed.findings as { errors: unknown[] }).errors).toHaveLength(1);
  });
});

describe('cli/standards — fix applies only machine-applicable remedies', () => {
  it('previews without writing and applies the canonical-casing remedy with --apply', async () => {
    const cwd = await fixture();
    const file = path.join(cwd, '.sdd/specs/demo/requirements.md');
    const before = await readFile(file, 'utf8');

    const preview = makeIO();
    expect(await handleStandardsCommand(['fix', 'REQ-EARS-010'], preview.io, cwd)).toBe(0);
    expect(await readFile(file, 'utf8')).toBe(before);
    expect(preview.logs.join('\n')).toContain('--apply');

    const applied = makeIO();
    expect(await handleStandardsCommand(['fix', 'REQ-EARS-010', '--apply'], applied.io, cwd)).toBe(0);
    const after = await readFile(file, 'utf8');
    expect(after).toContain('WHEN the user submits the form');
    expect(after).not.toContain('when the user submits the form');
  });

  it('refuses a needs-human remedy with the question that names the missing datum', async () => {
    const cwd = await fixture();
    const file = path.join(cwd, '.sdd/specs/demo/requirements.md');
    const before = await readFile(file, 'utf8');
    const { io, errors } = makeIO();
    const code = await handleStandardsCommand(['fix', 'REQ-EARS-006', '--apply'], io, cwd);
    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('no se aplica solo');
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('surfaces a rejected catalogue entry instead of hiding it', async () => {
    const cwd = await fixture();
    await writeFile(path.join(cwd, '.sdd/settings/standards', 'broken.json'), '{ "id": "REQ-BROKEN-001" }', 'utf8');
    const { io, logs } = makeIO();
    await handleStandardsCommand(['list', '--json'], io, cwd);
    const parsed = envelope(logs);
    const data = parsed.data as { rejected: { file: string; reason: string }[] };
    expect(data.rejected).toHaveLength(1);
    expect(data.rejected[0].file).toContain('broken.json');
    expect((parsed.findings as { warnings: unknown[] }).warnings).toHaveLength(1);
  });
});
