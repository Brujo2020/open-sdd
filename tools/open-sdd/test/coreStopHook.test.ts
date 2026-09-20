/**
 * Stop hooks — only the two hosts whose blocking mechanism was read from their own docs.
 *
 * Everything here runs over `fs.mkdtemp` fixtures removed in `afterEach`: the suite NEVER writes inside
 * this repository. The important tests are behavioural: the produced argv is run as a real subprocess
 * against a fixture whose gates genuinely FAIL (staged secret → C2 → exit 1 → the adapter must turn
 * that into the host's blocking exit 2) and against a passing fixture (exit 0). The Codex string form
 * is additionally run through `sh -c`, because a shell string is where a quoting bug would silently
 * run the wrong thing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STOP_HOOKS,
  STOP_HOOK_GATE_ARGS,
  installStopHook,
  stopHookFor,
} from '../src/core/stopHook.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const hookTemplate = path.join(repoRoot, 'tools', 'open-sdd', 'templates', 'hooks', 'pre-commit.mjs');
const cliEntry = path.join(repoRoot, 'tools', 'open-sdd', 'dist', 'cli.js');

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await chmod(dir, 0o755).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

const tempDir = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
  output: string;
}

const run = (command: string, args: string[], cwd: string): RunResult => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return { status: result.status ?? -1, stdout, stderr, output: stdout + stderr };
};

const runGit = (cwd: string, args: string[]): RunResult => run('git', args, cwd);

/** A real git repo whose staged diff carries an AWS key: C2 fails, so the commit gate exits 1. */
const failingRepo = async (): Promise<string> => {
  const dir = await tempDir('sdd-stop-fail-');
  expect(runGit(dir, ['init', '-q']).status).toBe(0);
  await writeFile(path.join(dir, 'notes.txt'), 'aws=AKIAIOSFODNN7EXAMPLE\n', 'utf8');
  expect(runGit(dir, ['add', '-A']).status).toBe(0);
  return dir;
};

/** A real git repo with a present triad and a clean staged diff: C1/C2/C3 pass, exit 0. */
const passingRepo = async (): Promise<string> => {
  const dir = await tempDir('sdd-stop-pass-');
  expect(runGit(dir, ['init', '-q']).status).toBe(0);
  const spec = path.join(dir, '.sdd', 'specs', 'demo');
  await mkdir(spec, { recursive: true });
  await writeFile(path.join(spec, 'requirements.md'), '# Requirements\n', 'utf8');
  await writeFile(path.join(spec, 'plan.md'), '# Plan\n', 'utf8');
  await writeFile(path.join(spec, 'tasks.md'), '# Tasks\n', 'utf8');
  expect(runGit(dir, ['add', '-A']).status).toBe(0);
  return dir;
};

/** A script standing in for the CLI so the exit-code table can be driven precisely. */
const fakeCli = async (dir: string, code: number, record?: string): Promise<string> => {
  const file = path.join(dir, `fake-cli-${code}${record === undefined ? '' : '-record'}.mjs`);
  const body =
    record === undefined
      ? `process.exit(${code});\n`
      : `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)));\nprocess.exit(${code});\n`;
  await writeFile(file, body, 'utf8');
  return file;
};

const claude = stopHookFor('claude-code');
const codex = stopHookFor('codex');

if (claude === undefined || codex === undefined) {
  throw new Error('the two verified Stop hooks must exist');
}

describe('STOP_HOOKS — the two verified hosts, and only those', () => {
  it('declares exactly claude-code and codex, both on the Stop event', () => {
    expect(STOP_HOOKS.map((entry) => entry.host)).toEqual(['claude-code', 'codex']);
    for (const entry of STOP_HOOKS) {
      expect(entry.event).toBe('Stop');
      expect(entry.docUrl).toMatch(/^https:\/\//);
      expect(entry.notes.length).toBeGreaterThan(0);
      expect(entry.configPaths.darwin).toBe(entry.configPaths.linux);
      expect(entry.configPaths.linux).toBe(entry.configPaths.win32);
    }
  });

  it('returns the entry for a verified host and undefined for anyone else', () => {
    expect(stopHookFor('claude-code')?.event).toBe('Stop');
    expect(stopHookFor('codex')?.event).toBe('Stop');
    for (const host of ['gemini-cli', 'copilot', 'cursor', 'windsurf', 'cline', 'opencode', 'zed', 'antigravity']) {
      expect(stopHookFor(host)).toBeUndefined();
    }
  });
});

describe('the Claude Code snippet — documented exec form, no shell', () => {
  const snippet = claude.snippet({ cliPath: '/opt/open-sdd/dist/cli.js' });

  it('parses as JSON and uses command + args', () => {
    const parsed = JSON.parse(snippet) as {
      hooks: { Stop: { hooks: { type: string; command: string; args: string[] }[] }[] };
    };
    const handler = parsed.hooks.Stop[0].hooks[0];
    expect(handler.type).toBe('command');
    expect(handler.command).toBe('node');
    expect(Array.isArray(handler.args)).toBe(true);
    expect(Object.keys(handler)).toEqual(['type', 'command', 'args']);
  });

  it('contains no shell string anywhere', () => {
    const parsed = JSON.parse(snippet) as { hooks: { Stop: { hooks: { command: string }[] }[] } };
    const handler = parsed.hooks.Stop[0].hooks[0];
    expect(handler.command).not.toContain(' ');
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain('"shell"');
    // No pipe, chain, redirection, backtick or command substitution: the argv is exec-form only.
    expect(serialized).not.toMatch(/&&|\|\||[<>`]|\$\(/);
  });
});

describe('the Codex snippet — documented string command', () => {
  it('parses as JSON and uses a single string command (no args array)', () => {
    const snippet = codex.snippet({ cliPath: '/opt/open-sdd/dist/cli.js' });
    const parsed = JSON.parse(snippet) as { hooks: { Stop: { hooks: Record<string, unknown>[] }[] } };
    const handler = parsed.hooks.Stop[0].hooks[0];
    expect(handler.type).toBe('command');
    expect(typeof handler.command).toBe('string');
    expect(handler).not.toHaveProperty('args');
    // Every element is single-quoted, gate invocation last.
    expect(handler.command as string).toContain(
      "'gates' 'run' 'C1' 'C2' 'C3' '--staged' '--strict'",
    );
  });
});

describe('the argv — the commit gate, unchanged, behind the exit-code adapter', () => {
  it('keeps the gate invocation byte-identical to templates/hooks/pre-commit.mjs', () => {
    const source = readFileSync(hookTemplate, 'utf8');
    const match = /GATE_ARGS\s*=\s*\[([^\]]*)\]/.exec(source);
    expect(match, 'GATE_ARGS not found in the commit gate').not.toBeNull();
    const gateArgs = Array.from((match?.[1] ?? '').matchAll(/'([^']*)'/g), (entry) => entry[1]);

    expect(gateArgs).toEqual([...STOP_HOOK_GATE_ARGS]);
    for (const host of STOP_HOOKS) {
      const argv = host.argv('/opt/open-sdd/dist/cli.js');
      expect(Array.isArray(argv)).toBe(true);
      expect(argv.every((part) => typeof part === 'string')).toBe(true);
      expect(argv[0]).toBe('node');
      expect(argv).toContain('/opt/open-sdd/dist/cli.js');
      expect(argv.slice(-gateArgs.length)).toEqual(gateArgs);
    }
  });
});

describe('installStopHook — merge, idempotency, refusal', () => {
  const cliPath = '/opt/open-sdd/dist/cli.js';

  it('creates the project config on a fresh fixture', async () => {
    const dir = await tempDir('sdd-stop-create-');
    const result = await installStopHook({ cwd: dir, host: 'claude-code', cliPath });
    expect(result.action).toBe('create');
    expect(result.path).toBe(path.join(dir, '.claude', 'settings.json'));
    const parsed = JSON.parse(await readFile(result.path, 'utf8')) as { hooks: { Stop: unknown[] } };
    expect(parsed.hooks.Stop).toHaveLength(1);
  });

  it('writes the Codex hook to .codex/hooks.json', async () => {
    const dir = await tempDir('sdd-stop-codex-');
    const result = await installStopHook({ cwd: dir, host: 'codex', cliPath });
    expect(result.action).toBe('create');
    expect(result.path).toBe(path.join(dir, '.codex', 'hooks.json'));
    const parsed = JSON.parse(await readFile(result.path, 'utf8')) as { hooks: { Stop: unknown[] } };
    expect(parsed.hooks.Stop).toHaveLength(1);
  });

  it('merges into an existing config with unrelated keys and other hooks, leaving them identical', async () => {
    const dir = await tempDir('sdd-stop-merge-');
    await mkdir(path.join(dir, '.claude'), { recursive: true });
    const original = {
      model: 'opus',
      permissions: { allow: ['Bash(npm test)'] },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] },
    };
    const originalText = `${JSON.stringify(original, null, 2)}\n`;
    const target = path.join(dir, '.claude', 'settings.json');
    await writeFile(target, originalText, 'utf8');

    const result = await installStopHook({ cwd: dir, host: 'claude-code', cliPath });
    expect(result.action).toBe('update');

    const installed = JSON.parse(await readFile(target, 'utf8')) as typeof original & {
      hooks: typeof original.hooks & { Stop: unknown[] };
    };
    expect(installed.model).toBe(original.model);
    expect(JSON.stringify(installed.permissions)).toBe(JSON.stringify(original.permissions));
    expect(JSON.stringify(installed.hooks.PreToolUse)).toBe(JSON.stringify(original.hooks.PreToolUse));
    expect(Object.keys(installed)).toEqual(['model', 'permissions', 'hooks']);
    expect(Object.keys(installed.hooks)).toEqual(['PreToolUse', 'Stop']);
    expect(installed.hooks.Stop).toHaveLength(1);

    // Everything except the inserted Stop array re-serializes to the original bytes exactly.
    const withoutStop = { ...installed, hooks: { PreToolUse: installed.hooks.PreToolUse } };
    expect(`${JSON.stringify(withoutStop, null, 2)}\n`).toBe(originalText);
  });

  it('is idempotent: a second install keeps and does not write', async () => {
    const dir = await tempDir('sdd-stop-idem-');
    const first = await installStopHook({ cwd: dir, host: 'claude-code', cliPath });
    expect(first.action).toBe('create');
    const before = await readFile(first.path, 'utf8');

    // A read-only file: any write attempt would throw instead of silently succeeding.
    await chmod(first.path, 0o444);
    const second = await installStopHook({ cwd: dir, host: 'claude-code', cliPath });

    expect(second.action).toBe('keep');
    expect(second.reason).toContain('no se escribe nada');
    expect(await readFile(first.path, 'utf8')).toBe(before);
    await chmod(first.path, 0o644);
  });

  it('refuses every host without a verified entry, writing nothing at all', async () => {
    for (const host of ['gemini-cli', 'copilot', 'cursor', 'windsurf', 'cline', 'opencode', 'zed', 'antigravity']) {
      const dir = await tempDir(`sdd-stop-${host}-`);
      const result = await installStopHook({ cwd: dir, host, cliPath });
      expect(result.action, host).toBe('refused');
      expect(result.reason).toContain(host);
      expect(result.reason).toContain('no verificado');
      expect(result.snippet).toBe('');
      expect(result.path).toBe('');
      expect(await readdir(dir)).toEqual([]);
    }
  });

  it('refuses to rewrite a config that is not valid JSON', async () => {
    const dir = await tempDir('sdd-stop-badjson-');
    await mkdir(path.join(dir, '.claude'), { recursive: true });
    const target = path.join(dir, '.claude', 'settings.json');
    await writeFile(target, '{ not json', 'utf8');
    const result = await installStopHook({ cwd: dir, host: 'claude-code', cliPath });
    expect(result.action).toBe('refused');
    expect(await readFile(target, 'utf8')).toBe('{ not json');
  });

  it('write:false computes the action without touching the disk', async () => {
    const dir = await tempDir('sdd-stop-dry-');
    const result = await installStopHook({ cwd: dir, host: 'claude-code', cliPath, write: false });
    expect(result.action).toBe('create');
    expect(result.snippet).toContain('"Stop"');
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('the produced argv actually stops an agent (real subprocess fixtures)', () => {
  it('failing fixture: the adapter turns the gate FAIL into exit 2 and keeps the reason', async () => {
    const repo = await failingRepo();
    const result = run(claude.argv(cliEntry)[0], claude.argv(cliEntry).slice(1), repo);
    expect(result.status, result.output).toBe(2);
    // Requirement: a block must carry the CLI's own explanation, on the host-visible stream.
    expect(result.output).toMatch(/open-sdd/);
    expect(result.output.length).toBeGreaterThan(0);
  });

  it('passing fixture: the same argv returns 0', async () => {
    const repo = await passingRepo();
    const result = run(claude.argv(cliEntry)[0], claude.argv(cliEntry).slice(1), repo);
    expect(result.status, result.output).toBe(0);
  });

  it('maps the exit-code table 0→0, 1→2, 2→2 (and any other non-zero → 2)', async () => {
    const dir = await tempDir('sdd-stop-map-');
    for (const [code, expected] of [
      [0, 0],
      [1, 2],
      [2, 2],
      [7, 2],
    ] as const) {
      const cli = await fakeCli(dir, code);
      const argv = claude.argv(cli);
      const result = run(argv[0], argv.slice(1), dir);
      expect(result.status, `exit ${code} should map to ${expected}`).toBe(expected);
    }
  });
});

const shellDescribe = process.platform === 'win32' ? describe.skip : describe;

shellDescribe('the Codex string form survives a real shell (sh -c)', () => {
  const commandFor = (cliPath: string): string =>
    (
      JSON.parse(codex.snippet({ cliPath })) as {
        hooks: { Stop: { hooks: { command: string }[] }[] };
      }
    ).hooks.Stop[0].hooks[0].command;

  it('runs the gate through sh -c with the same mapping: 0 stays 0, a FAIL becomes 2', async () => {
    const passing = await passingRepo();
    const ok = run('sh', ['-c', commandFor(cliEntry)], passing);
    expect(ok.status, ok.output).toBe(0);

    const failing = await failingRepo();
    const blocked = run('sh', ['-c', commandFor(cliEntry)], failing);
    expect(blocked.status, blocked.output).toBe(2);
    expect(blocked.output).toMatch(/open-sdd/);
  }, 30_000);

  it('escapes embedded single quotes: a cli path with a quote reaches the CLI intact', async () => {
    const dir = await tempDir('sdd-stop-quote-');
    const record = path.join(dir, 'argv.json');
    const quotedCli = path.join(dir, "we'ird cli.mjs");
    await writeFile(
      quotedCli,
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)));\n`,
      'utf8',
    );

    const result = run('sh', ['-c', commandFor(quotedCli)], dir);
    expect(result.status, result.output).toBe(0);
    expect(JSON.parse(await readFile(record, 'utf8'))).toEqual([...STOP_HOOK_GATE_ARGS]);
  });
});
