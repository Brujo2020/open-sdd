/**
 * Readiness check of `.sdd/steering/`: the three core files exist, their front matter declares a valid
 * `inclusion` mode, `#[[file:…]]` references resolve inside the workspace, and no inferred/unclear marker is
 * left for a human to confirm.
 *
 * ── Why it is included (ported from SteelForge plugins/sdd/steering.js; ideas from Kiro and cc-sdd) ───────
 * `/sdd-getspecs` and `/sdd-steering` write steering that is partly INFERRED from code. Until a person confirms
 * it, every spec built on top inherits guesses as if they were project rules. open-sdd had no gate for that:
 *   - `inclusion: always | fileMatch | manual` (Kiro) tells hosts when to load each file; a typo silently meant
 *     "never loaded", and `fileMatch` without `fileMatchPattern` matched nothing;
 *   - `#[[file:path]]` (Kiro) pulls a file into context; a reference outside the workspace is an exfiltration
 *     path, and a dangling one is a rule nobody can read;
 *   - `(inferred)` / `(inferido)` and `[NEEDS CLARIFICATION]` mark what the generator guessed: steering with
 *     those markers is a draft, not a source of truth, so the brownfield stage guide does not advance.
 */
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export const CORE_STEERING = ['product.md', 'tech.md', 'structure.md'] as const;
const INCLUSION = new Set(['always', 'fileMatch', 'manual']);
const MARKERS = /\[NEEDS CLARIFICATION\]|\((?:inferred|inferido|inferida)\)/gi;

export interface SteeringFileReport {
  file: string;
  inclusion: string;
  errors: string[];
  /** Unresolved markers (count). */
  pending: number;
}

export interface SteeringReport {
  /** Core files present. */
  present: string[];
  missing: string[];
  files: SteeringFileReport[];
  /** True when every core file exists, no file has errors and no marker is left. */
  ready: boolean;
}

/** Front matter `key: value` pairs (no YAML dependency: steering front matter is flat). */
export const frontMatter = (text: string): Record<string, string> => {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  const out: Record<string, string> = {};
  for (const line of m?.[1].split('\n') ?? []) {
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
};

const inside = (root: string, target: string): boolean => {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/**
 * Checks the steering directory.
 * @param root - repository root (references are resolved against it).
 * @param steeringDir - absolute path of `.sdd/steering`.
 */
export const checkSteering = async (root: string, steeringDir: string): Promise<SteeringReport> => {
  const names = (await readdir(steeringDir).catch(() => [] as string[])).filter((n) => n.endsWith('.md')).sort();
  const realRoot = await realpath(root).catch(() => root);
  const files: SteeringFileReport[] = [];
  for (const name of names) {
    const text = await readFile(path.join(steeringDir, name), 'utf8');
    const fm = frontMatter(text);
    const errors: string[] = [];
    const inclusion = fm.inclusion ?? 'always';
    if (!INCLUSION.has(inclusion)) errors.push(`inclusion «${inclusion}» no es always, fileMatch ni manual: el anfitrión no sabrá cuándo cargarlo`);
    if (inclusion === 'fileMatch' && !fm.fileMatchPattern) errors.push('inclusion: fileMatch sin fileMatchPattern: no se carga nunca');
    for (const ref of text.matchAll(/#\[\[file:([^\]]+)\]\]/g)) {
      const target = path.resolve(realRoot, ref[1].trim());
      const real = await realpath(target).catch(() => null);
      if (!inside(realRoot, real ?? target)) errors.push(`#[[file:${ref[1]}]] apunta fuera del workspace: no se admite`);
      else if (!real || !(await stat(real).catch(() => null))?.isFile()) errors.push(`#[[file:${ref[1]}]] no existe`);
    }
    files.push({ file: name, inclusion, errors, pending: (text.match(MARKERS) ?? []).length });
  }
  const present = CORE_STEERING.filter((n) => names.includes(n));
  const missing = CORE_STEERING.filter((n) => !names.includes(n));
  return { present: [...present], missing: [...missing], files, ready: missing.length === 0 && files.every((f) => f.errors.length === 0 && f.pending === 0) };
};
