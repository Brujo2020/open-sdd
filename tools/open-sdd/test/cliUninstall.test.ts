import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CliIO } from '../src/cli/io.js';
import { handleUninstallCommand } from '../src/cli/commands/uninstall.js';
import { RECEIPT_FILE, recordReceipt } from '../src/core/receipt.js';

const dirs: string[] = [];
const makeRepo = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-uninstall-'));
  dirs.push(dir);
  return dir;
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const recorder = (): { io: CliIO; log: string[]; error: string[] } => {
  const log: string[] = [];
  const error: string[] = [];
  return { io: { log: (m) => log.push(m), error: (m) => error.push(m), exit: () => undefined }, log, error };
};

const seedCreatedFile = async (cwd: string): Promise<void> => {
  await mkdir(path.join(cwd, '.claude/skills/x'), { recursive: true });
  await writeFile(path.join(cwd, '.claude/skills/x/SKILL.md'), 'skill\n', 'utf8');
  await recordReceipt(cwd, [{ path: '.claude/skills/x/SKILL.md', action: 'create' }]);
};

describe('uninstall — plan first, and an honest answer when there is no receipt', () => {
  it('plans without a receipt and removes nothing', async () => {
    const cwd = await makeRepo();
    const { io, log } = recorder();
    const code = await handleUninstallCommand([], io, cwd);
    expect(code).toBe(0);
    expect(log.join('\n')).toContain('No hay recibo');
  });

  it('plans only by default: the file survives and the plan names it', async () => {
    const cwd = await makeRepo();
    await seedCreatedFile(cwd);
    const { io, log } = recorder();
    const code = await handleUninstallCommand([], io, cwd);
    expect(code).toBe(0);
    expect(existsSync(path.join(cwd, '.claude/skills/x/SKILL.md'))).toBe(true);
    expect(log.join('\n')).toContain('.claude/skills/x/SKILL.md');
    expect(log.join('\n')).toContain('--write');
  });

  it('--write removes what this tool created', async () => {
    const cwd = await makeRepo();
    await seedCreatedFile(cwd);
    const { io, error } = recorder();
    const code = await handleUninstallCommand(['--write'], io, cwd);
    expect(code).toBe(0);
    expect(error).toEqual([]);
    expect(existsSync(path.join(cwd, '.claude/skills/x/SKILL.md'))).toBe(false);
  });

  it('an unknown option is a usage error with exit code 2, not a governance failure', async () => {
    const cwd = await makeRepo();
    const { io, error } = recorder();
    const code = await handleUninstallCommand(['--nope'], io, cwd);
    expect(code).toBe(2);
    expect(error.join('\n')).toContain('exit code 2');
  });

  it('restore without --from names the flag it needs', async () => {
    const cwd = await makeRepo();
    const { io, error } = recorder();
    const code = await handleUninstallCommand(['restore'], io, cwd);
    expect(code).toBe(2);
    expect(error.join('\n')).toContain('--from');
  });

  it('restore --from reads an alternate receipt', async () => {
    const cwd = await makeRepo();
    await seedCreatedFile(cwd);
    const alternate = path.join(cwd, 'other-receipt.json');
    await writeFile(alternate, await readFile(path.join(cwd, RECEIPT_FILE), 'utf8'), 'utf8');

    const { io, log } = recorder();
    const code = await handleUninstallCommand(['restore', '--from', 'other-receipt.json'], io, cwd);
    expect(code).toBe(0);
    expect(log.join('\n')).toContain('.claude/skills/x/SKILL.md');
  });
});
