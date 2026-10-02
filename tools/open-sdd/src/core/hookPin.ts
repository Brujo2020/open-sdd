/**
 * The CLI pin of the commit gate (G-36).
 *
 * The installed hook used to resolve the CLI through PATH as a last resort and trust whatever it
 * found. A stale global install (2.0.0 against a 3.4.0 project, measured in the field) enforced
 * nothing and exited 0: the gate failed OPEN while the configuration still read "blocking".
 *
 * `floor install` now records the CLI that installed the hook in a pin file NEXT TO THE HOOK. It is
 * per clone (inside the hooks directory, never in the committed tree), so an absolute machine path is
 * never shared with a team. The hook prefers the pin and accepts a PATH CLI only after its
 * `--version` proves it is at least the pinned version. `doctor` reads the same file to say whether
 * the hook and the CLI in play agree.
 *
 * The file name and the version floor are duplicated in `templates/hooks/pre-commit.mjs` (which can
 * import nothing); `test/hookPin.test.ts` asserts the two copies agree.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const HOOK_PIN_FILE = 'open-sdd-cli.json';
/** The oldest CLI that enforces the gate the hook runs; used when no pin exists. */
export const MIN_HOOK_CLI_VERSION = '3.4.0';

export interface HookPin {
  cli: string;
  version: string;
  pinnedAt: string;
}

export const hookPinPath = (hooksDir: string): string => path.join(hooksDir, HOOK_PIN_FILE);

export const writeHookPin = async (hooksDir: string, pin: HookPin): Promise<string> => {
  const target = hookPinPath(hooksDir);
  await writeFile(target, `${JSON.stringify(pin, null, 2)}\n`, 'utf8');
  return target;
};

/** `null` when absent or unreadable; a malformed pin is treated as absent, never as trusted. */
export const readHookPin = async (hooksDir: string): Promise<HookPin | null> => {
  try {
    const raw = JSON.parse(await readFile(hookPinPath(hooksDir), 'utf8')) as Partial<HookPin>;
    if (typeof raw.cli !== 'string' || raw.cli.length === 0) return null;
    return {
      cli: raw.cli,
      version: typeof raw.version === 'string' ? raw.version : '',
      pinnedAt: typeof raw.pinnedAt === 'string' ? raw.pinnedAt : '',
    };
  } catch {
    return null;
  }
};

export const parseSemver = (text: string): [number, number, number] | null => {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

/** `-1` older, `0` equal, `1` newer; `null` when either side is not a version. */
export const compareSemver = (a: string, b: string): -1 | 0 | 1 | null => {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left[i]! > right[i]!) return 1;
    if (left[i]! < right[i]!) return -1;
  }
  return 0;
};

/**
 * The compiled entry point of the CLI that is running, found by walking up from a module directory:
 * `dist/cli.js` both in a checkout and in the published package (and from `src/` under the test
 * runner, where the sibling `dist/` is the build). `null` when no compiled entry exists, in which case
 * no pin is written — a pin to a file that does not exist would be a lie.
 */
export const resolveSelfCli = (moduleDir: string): string | null => {
  let dir = moduleDir;
  for (let depth = 0; depth < 5; depth += 1) {
    if (path.basename(dir) === 'dist' && existsSync(path.join(dir, 'cli.js'))) return path.join(dir, 'cli.js');
    if (existsSync(path.join(dir, 'dist', 'cli.js'))) return path.join(dir, 'dist', 'cli.js');
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
};
