import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  RECEIPT_FILE,
  RECEIPT_SCHEMA,
  applyUninstall,
  planUninstall,
  readReceipt,
  receiptPath,
  recordReceipt,
  sha256Of,
} from '../src/core/receipt.js';

const dirs: string[] = [];
const makeRepo = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-receipt-'));
  dirs.push(dir);
  return dir;
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('receipt — what this tool wrote, so it can be undone', () => {
  it('records a created file with its hash and reads it back', async () => {
    const cwd = await makeRepo();
    await mkdir(path.join(cwd, '.claude'), { recursive: true });
    await writeFile(path.join(cwd, '.claude/created.json'), '{"a":1}\n', 'utf8');

    const { receipt, skipped } = await recordReceipt(cwd, [{ path: '.claude/created.json', action: 'create' }]);
    expect(skipped).toEqual([]);
    expect(receipt.entries).toHaveLength(1);
    expect(receipt.entries[0].sha256).toBe(sha256Of('{"a":1}\n'));

    const read = await readReceipt(cwd);
    expect(read.problem).toBeNull();
    expect(read.receipt.entries[0].path).toBe('.claude/created.json');
  });

  it('rejects a path that escapes the repository instead of recording it', async () => {
    const cwd = await makeRepo();
    const { receipt, skipped } = await recordReceipt(cwd, [{ path: '../outside.txt', action: 'create', content: 'x' }]);
    expect(receipt.entries).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toContain('fuera del repositorio');
  });

  it('plans removal only for files nobody changed, and refuses a human edit', async () => {
    const cwd = await makeRepo();
    await mkdir(path.join(cwd, '.claude'), { recursive: true });
    await writeFile(path.join(cwd, '.claude/untouched.json'), 'ours\n', 'utf8');
    await writeFile(path.join(cwd, '.claude/edited.json'), 'ours\n', 'utf8');
    await writeFile(path.join(cwd, '.claude/settings.json'), '{"mcp":{}}\n', 'utf8');

    await recordReceipt(cwd, [
      { path: '.claude/untouched.json', action: 'create' },
      { path: '.claude/edited.json', action: 'create' },
      { path: '.claude/settings.json', action: 'merge' },
    ]);
    await writeFile(path.join(cwd, '.claude/edited.json'), 'the human changed me\n', 'utf8');

    const plan = await planUninstall(cwd);
    const byPath = new Map(plan.entries.map((entry) => [entry.path, entry]));
    expect(byPath.get('.claude/untouched.json')?.state).toBe('remove');
    expect(byPath.get('.claude/edited.json')?.state).toBe('refused');
    expect(byPath.get('.claude/edited.json')?.reason).toContain('edición humana');
    expect(byPath.get('.claude/settings.json')?.state).toBe('refused');
    expect(byPath.get('.claude/settings.json')?.reason).toContain('deshace a mano');
    expect(plan.sddDir.willRemove).toBe(false);
  });

  it('refuses a corrupt receipt and never builds a delete plan from unreadable bytes', async () => {
    const cwd = await makeRepo();
    await mkdir(path.join(cwd, '.sdd'), { recursive: true });
    await writeFile(receiptPath(cwd), '{ this is not json', 'utf8');

    const plan = await planUninstall(cwd);
    expect(plan.hasReceipt).toBe(false);
    expect(plan.entries).toEqual([]);
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0]).toContain(RECEIPT_FILE);
  });

  it('removes what it created, prunes the empty directory, and keeps .sdd/', async () => {
    const cwd = await makeRepo();
    await mkdir(path.join(cwd, '.claude/skills/x'), { recursive: true });
    await writeFile(path.join(cwd, '.claude/skills/x/SKILL.md'), 'skill\n', 'utf8');
    await mkdir(path.join(cwd, '.sdd'), { recursive: true });
    await writeFile(path.join(cwd, '.sdd/keep.json'), '{}\n', 'utf8');
    await recordReceipt(cwd, [{ path: '.claude/skills/x/SKILL.md', action: 'create' }]);

    const plan = await planUninstall(cwd);
    const result = await applyUninstall(cwd, plan);

    expect(result.failed).toEqual([]);
    expect(existsSync(path.join(cwd, '.claude/skills/x/SKILL.md'))).toBe(false);
    expect(await readFile(path.join(cwd, '.sdd/keep.json'), 'utf8')).toBe('{}\n');
    expect(result.pruned).toContain('.claude/skills/x');
    expect(existsSync(path.join(cwd, '.claude'))).toBe(false);
  });

  it('removes .sdd/ only when --purge-sdd is explicit', async () => {
    const cwd = await makeRepo();
    await mkdir(path.join(cwd, '.sdd'), { recursive: true });
    await writeFile(path.join(cwd, '.sdd/note.json'), '{}\n', 'utf8');
    await recordReceipt(cwd, [{ path: '.sdd/note.json', action: 'create' }]);

    const plan = await planUninstall(cwd, { purgeSdd: true });
    expect(plan.sddDir.willRemove).toBe(true);
    await applyUninstall(cwd, plan);
    expect(existsSync(path.join(cwd, '.sdd'))).toBe(false);
  });
});
