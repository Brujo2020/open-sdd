import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleRequirementsCommand } from '../src/cli/commands/requirements.js';
import { checkConsistency } from '../src/core/consistency.js';
import type { CliIO } from '../src/cli/io.js';

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const makeIO = () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const io: CliIO = { log: (m) => logs.push(m), error: (m) => errors.push(m), exit: () => undefined };
  return { io, logs, errors };
};

const project = async (files: Record<string, string>): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gherkin-'));
  temps.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), content, 'utf8');
  }
  return dir;
};

const SPEC = '.sdd/specs/gw';
const REQS = '# R\n\n## Requirements\n\n### REQ-GW-001: Health\n1. The gateway shall expose a health endpoint.\n';
const target = (dir: string) => path.join(dir, SPEC, 'acceptance.feature');

describe('requirements gherkin (REQ-SSP-004)', () => {
  it('without --write prints the feature and writes nothing', async () => {
    const dir = await project({ [`${SPEC}/requirements.md`]: REQS });
    const { io, logs } = makeIO();
    expect(await handleRequirementsCommand(['requirements', 'gherkin', 'gw'], io, dir)).toBe(0);
    expect(logs.join('\n')).toContain('@REQ-GW-001 @ubiquitous');
    await expect(readFile(target(dir), 'utf8')).rejects.toThrow();
  });

  it('--write creates acceptance.feature, and is idempotent', async () => {
    const dir = await project({ [`${SPEC}/requirements.md`]: REQS, [`${SPEC}/spec.json`]: '{"language":"es"}' });
    expect(await handleRequirementsCommand(['requirements', 'gherkin', 'gw', '--write'], makeIO().io, dir)).toBe(0);
    const first = await readFile(target(dir), 'utf8');
    expect(first.startsWith('# language: es\n')).toBe(true);
    expect(await handleRequirementsCommand(['requirements', 'gherkin', 'gw', '--write'], makeIO().io, dir)).toBe(0);
    expect(await readFile(target(dir), 'utf8')).toBe(first);
  });

  it('--write refuses to overwrite a different acceptance.feature and exits 1', async () => {
    const dir = await project({ [`${SPEC}/requirements.md`]: REQS, [`${SPEC}/acceptance.feature`]: 'hand edited\n' });
    const { io, errors } = makeIO();
    expect(await handleRequirementsCommand(['requirements', 'gherkin', 'gw', '--write'], io, dir)).toBe(1);
    expect(errors.join('\n')).toContain('left unchanged');
    expect(await readFile(target(dir), 'utf8')).toBe('hand edited\n');
  });

  it('a missing requirements.md exits 1 naming the file', async () => {
    const dir = await project({ [`${SPEC}/spec.json`]: '{}' });
    const { io, errors } = makeIO();
    expect(await handleRequirementsCommand(['requirements', 'gherkin', 'gw'], io, dir)).toBe(1);
    expect(errors.join('\n')).toContain('requirements.md');
  });
});

describe('consistency report carries the task grammar (REQ-SSP-005…008)', () => {
  it('reports a dangling dependency and records the check', async () => {
    const dir = await project({
      [`${SPEC}/requirements.md`]: REQS,
      [`${SPEC}/tasks.md`]: '- [ ] 1. Health — _Requirements: REQ-GW-001_ — _Depends:_ 9\n',
    });
    const report = await checkConsistency({ cwd: dir, feature: 'gw', changedFiles: [] });
    expect(report.findings.map((f) => f.code)).toContain('TASK_DEPENDS_UNKNOWN');
    expect(report.checked.some((c) => c.startsWith('gramática de tareas'))).toBe(true);
  });
});
