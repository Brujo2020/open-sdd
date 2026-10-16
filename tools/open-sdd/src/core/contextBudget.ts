/**
 * The context tax of an installation (EVOLUTION-PLAN W7 / W8.1 row 7).
 *
 * Every skill, command and rule file a tool installs is text some agent may load. The field measured
 * it: spec-kit issue #1401 reported ~18.6k tokens per session for an unconditionally installed
 * surface, and cc-sdd issue #188 ~6.9k tokens per iteration. A governance tool that never states its
 * own cost cannot ask anyone to budget theirs.
 *
 * This module measures what is ON DISK in the repository, for every host layout the agent registry
 * knows, and splits it the way hosts load it:
 *
 *   - always: loaded into every session — the host's root instruction file (`CLAUDE.md`,
 *     `AGENTS.md`, `GEMINI.md`, …) and the `description:` frontmatter of each skill, which hosts
 *     read to decide whether to open the skill;
 *   - onDemand: the rest — a skill's body or a command file is read only when invoked.
 *
 * Tokens are ESTIMATED as ceil(characters / 4). That is a stated heuristic, not a tokenizer: the
 * report says so, and a budget compared against it is a budget on the estimate.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { agentList, getAgentDefinition } from '../agents/registry.js';

export const TOKEN_ESTIMATE_RULE = 'tokens ≈ ceil(characters / 4) — an estimate, not a tokenizer';

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export interface ContextSurface {
  /** Repository-relative path of the measured file or directory. */
  path: string;
  kind: 'instructions' | 'skills' | 'commands';
  files: number;
  always: number;
  onDemand: number;
}

export interface ContextBudgetReport {
  surfaces: ContextSurface[];
  totals: { always: number; onDemand: number; files: number };
  rule: string;
  budget: number | null;
  overBudget: boolean;
}

const TEXT_FILE = /\.(md|mdc|toml|txt|prompt\.md|json|ya?ml)$/i;

const isDir = async (p: string): Promise<boolean> => (await stat(p).catch(() => null))?.isDirectory() ?? false;
const isFile = async (p: string): Promise<boolean> => (await stat(p).catch(() => null))?.isFile() ?? false;

const walk = async (dir: string, depth = 0): Promise<string[]> => {
  if (depth > 4) return [];
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, depth + 1)));
    else if (entry.isFile() && TEXT_FILE.test(entry.name)) out.push(full);
  }
  return out;
};

/** The frontmatter `description:` of a skill — the part a host loads to decide whether to open it. */
export const skillDescription = (text: string): string => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return '';
  const lines = match[1]!.split(/\r?\n/);
  const start = lines.findIndex((line) => /^description\s*:/.test(line));
  if (start < 0) return '';
  const collected = [lines[start]!.replace(/^description\s*:\s*/, '')];
  for (const line of lines.slice(start + 1)) {
    if (/^\S[^:]*:/.test(line)) break; // next key
    collected.push(line.trim());
  }
  return collected.join(' ').trim();
};

const measureDir = async (root: string, rel: string, kind: 'skills' | 'commands'): Promise<ContextSurface | null> => {
  const dir = path.join(root, rel);
  if (!(await isDir(dir))) return null;
  const files = await walk(dir);
  if (files.length === 0) return null;
  let always = 0;
  let onDemand = 0;
  for (const file of files) {
    const text = await readFile(file, 'utf8').catch(() => '');
    if (kind === 'skills' && /SKILL\.md$/i.test(file)) {
      const description = estimateTokens(skillDescription(text));
      always += description;
      onDemand += Math.max(0, estimateTokens(text) - description);
    } else {
      onDemand += estimateTokens(text);
    }
  }
  return { path: rel, kind, files: files.length, always, onDemand };
};

export const measureContextBudget = async (root: string, budget: number | null = null): Promise<ContextBudgetReport> => {
  const dirs = new Map<string, 'skills' | 'commands'>();
  const docs = new Set<string>();
  for (const key of agentList) {
    const layout = getAgentDefinition(key).layout;
    dirs.set(layout.commandsDir, /skills/.test(layout.commandsDir) ? 'skills' : 'commands');
    if (layout.docFile) docs.add(layout.docFile);
  }

  const surfaces: ContextSurface[] = [];
  for (const doc of [...docs].sort()) {
    const file = path.join(root, doc);
    if (!(await isFile(file))) continue;
    const text = await readFile(file, 'utf8').catch(() => '');
    surfaces.push({ path: doc, kind: 'instructions', files: 1, always: estimateTokens(text), onDemand: 0 });
  }
  for (const [rel, kind] of [...dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const surface = await measureDir(root, rel, kind);
    if (surface) surfaces.push(surface);
  }

  const totals = surfaces.reduce(
    (acc, s) => ({ always: acc.always + s.always, onDemand: acc.onDemand + s.onDemand, files: acc.files + s.files }),
    { always: 0, onDemand: 0, files: 0 },
  );
  return { surfaces, totals, rule: TOKEN_ESTIMATE_RULE, budget, overBudget: budget !== null && totals.always > budget };
};
