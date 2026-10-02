/**
 * Uninstall for installations that predate the receipt (tenet 12, reversibility).
 *
 * `core/receipt.ts` refuses to remove anything without a receipt, which is correct — and leaves
 * every early adopter (every install before receipts existed) with no exit. This module is the
 * evidence-based fallback, opted into explicitly with `uninstall --legacy`:
 *
 *   - the commit hook is ours when it is byte-identical to a shipped hook template, or carries the
 *     gate's own header (an older version of it). A foreign hook that `floor install` preserved as
 *     `pre-commit.open-sdd-backup` is put back in its place. The hook's CLI pin goes with it.
 *   - a skill directory is ours when it sits in a skills layout the agent registry knows, its name is
 *     a shipped skill, its SKILL.md declares that same name, and every file in it is a file the shipped
 *     skill has. A directory with any extra file is REFUSED (a human added something) and listed.
 *
 * What it cannot prove, stated rather than hidden: without a receipt there is no hash of what was
 * written, so a shipped file a human later EDITED in place is indistinguishable from an unedited one.
 * That is why the plan is printed first and `--write` is required. `.sdd/` is never touched here.
 */
import { readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentList, getAgentDefinition } from '../agents/registry.js';
import { HOOK_PIN_FILE } from './hookPin.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_ROOT = path.resolve(MODULE_DIR, '..', '..', 'templates');
const HOOK_HEADER = 'open-sdd | pre-commit gate';

export interface LegacyEntry {
  path: string;
  kind: 'hook' | 'hook-pin' | 'hook-restore' | 'skill';
  state: 'remove' | 'refused';
  reason: string;
}

export interface LegacyPlan {
  entries: LegacyEntry[];
  /** What legacy mode does not cover, so a reader never assumes it does. */
  notCovered: string[];
}

const exists = async (p: string): Promise<boolean> => (await stat(p).catch(() => null)) !== null;
const isDir = async (p: string): Promise<boolean> => (await stat(p).catch(() => null))?.isDirectory() ?? false;

const listFiles = async (dir: string, base = dir): Promise<string[]> => {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full, base)));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
};

/** Shipped skill name → the relative files any agent's copy of it may contain. */
const shippedSkills = async (templatesRoot: string): Promise<Map<string, Set<string>>> => {
  const map = new Map<string, Set<string>>();
  const agentsDir = path.join(templatesRoot, 'agents');
  // Skills declare `shared-rules:` and the installer copies those files into `<skill>/rules/`
  // (plan/sharedRules.ts), so any shared rule is a file a shipped skill may legitimately hold.
  const sharedRules = (await readdir(path.join(templatesRoot, 'shared', 'settings', 'rules')).catch(() => [] as string[])).map(
    (name) => `rules/${name}`,
  );
  for (const agent of await readdir(agentsDir).catch(() => [] as string[])) {
    const skillsDir = path.join(agentsDir, agent, 'skills');
    for (const name of await readdir(skillsDir).catch(() => [] as string[])) {
      if (!name.startsWith('sdd-')) continue;
      const files = map.get(name) ?? new Set<string>();
      for (const file of await listFiles(path.join(skillsDir, name))) files.add(file);
      for (const rule of sharedRules) files.add(rule);
      map.set(name, files);
    }
  }
  return map;
};

const frontmatterName = (text: string): string | null => /^---\r?\n[\s\S]*?^name:\s*(\S+)\s*$/m.exec(text)?.[1] ?? null;

export const planLegacyUninstall = async (cwd: string, templatesRoot: string = TEMPLATES_ROOT): Promise<LegacyPlan> => {
  const entries: LegacyEntry[] = [];

  // The commit hook (classic .git directory layout, the one `floor install` writes).
  const hooksDir = path.join(cwd, '.git', 'hooks');
  const hook = path.join(hooksDir, 'pre-commit');
  const hookText = await readFile(hook, 'utf8').catch(() => null);
  if (hookText !== null) {
    const templates = await Promise.all(
      ['pre-commit.mjs', 'pre-commit'].map((name) => readFile(path.join(templatesRoot, 'hooks', name), 'utf8').catch(() => null)),
    );
    const identical = templates.some((t) => t !== null && t === hookText);
    if (identical || hookText.includes(HOOK_HEADER)) {
      entries.push({
        path: '.git/hooks/pre-commit',
        kind: 'hook',
        state: 'remove',
        reason: identical ? 'byte-identical to a shipped hook template' : 'carries the open-sdd gate header (an older version of the gate)',
      });
      if (await exists(`${hook}.open-sdd-backup`)) {
        entries.push({ path: '.git/hooks/pre-commit.open-sdd-backup', kind: 'hook-restore', state: 'remove', reason: 'your previous hook, preserved by floor install: put back as pre-commit' });
      }
    } else {
      entries.push({ path: '.git/hooks/pre-commit', kind: 'hook', state: 'refused', reason: 'a hook that is not ours: never touched' });
    }
  }
  if (await exists(path.join(hooksDir, HOOK_PIN_FILE))) {
    entries.push({ path: `.git/hooks/${HOOK_PIN_FILE}`, kind: 'hook-pin', state: 'remove', reason: 'the CLI pin of the commit hook' });
  }

  // Skills, in every skills layout the registry knows.
  const shipped = await shippedSkills(templatesRoot);
  const skillDirs = new Set<string>();
  for (const key of agentList) {
    const dir = getAgentDefinition(key).layout.commandsDir;
    if (/skills/.test(dir)) skillDirs.add(dir);
  }
  for (const rel of [...skillDirs].sort()) {
    const abs = path.join(cwd, rel);
    if (!(await isDir(abs))) continue;
    for (const name of (await readdir(abs).catch(() => [] as string[])).sort()) {
      const known = shipped.get(name);
      if (!known) continue;
      const dir = path.join(abs, name);
      if (!(await isDir(dir))) continue;
      const display = `${rel}/${name}`;
      const declared = frontmatterName(await readFile(path.join(dir, 'SKILL.md'), 'utf8').catch(() => ''));
      const files = await listFiles(dir);
      const extra = files.filter((file) => !known.has(file));
      if (declared !== name) {
        entries.push({ path: display, kind: 'skill', state: 'refused', reason: `SKILL.md does not declare name: ${name}` });
      } else if (extra.length > 0) {
        entries.push({ path: display, kind: 'skill', state: 'refused', reason: `holds files the shipped skill does not have: ${extra.slice(0, 3).join(', ')}` });
      } else {
        entries.push({ path: display, kind: 'skill', state: 'remove', reason: 'a shipped skill: name and file set match' });
      }
    }
  }

  return {
    entries,
    notCovered: [
      'chat command files, MCP registrations and Stop hooks are not detected without a receipt: `open-sdd integrate --list` shows where each host keeps them',
      'a shipped file edited in place cannot be told apart from an unedited one without a receipt hash',
      'root instruction files (AGENTS.md, CLAUDE.md, …) and the CI workflow may carry your edits: they are left for you to remove',
      '.sdd/ is your data and is never removed in legacy mode',
    ],
  };
};

export const applyLegacyUninstall = async (cwd: string, plan: LegacyPlan): Promise<{ removed: string[]; failed: { path: string; reason: string }[] }> => {
  const removed: string[] = [];
  const failed: { path: string; reason: string }[] = [];
  const restore = plan.entries.find((e) => e.kind === 'hook-restore' && e.state === 'remove');
  for (const entry of plan.entries) {
    if (entry.state !== 'remove' || entry.kind === 'hook-restore') continue;
    try {
      await rm(path.join(cwd, entry.path), { recursive: true, force: true });
      removed.push(entry.path);
    } catch (error) {
      failed.push({ path: entry.path, reason: (error as Error).message });
    }
  }
  if (restore && removed.includes('.git/hooks/pre-commit')) {
    try {
      await rename(path.join(cwd, restore.path), path.join(cwd, '.git', 'hooks', 'pre-commit'));
      removed.push(`${restore.path} → .git/hooks/pre-commit`);
    } catch (error) {
      failed.push({ path: restore.path, reason: (error as Error).message });
    }
  }
  return { removed, failed };
};
