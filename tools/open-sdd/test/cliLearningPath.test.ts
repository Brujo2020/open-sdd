/**
 * learning-path (REQ-LRN-001 … 009).
 *
 * The defect: `--help` was one 120-line index of every command with no order of use, and a first run
 * met three traps — a scaffold the coach itself rejected, `init <feature> --write` failing without
 * naming the spec command, and an audit bundle stamped with a stale version. Here the default help is
 * the essentials, `help workflow` is one path per situation, and every command either surface names
 * is proved to be routed.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/index.js';
import {
  KNOWN_COMMANDS,
  STRICT_SUBCOMMANDS,
  renderEssentialHelp,
  renderFullHelp,
  renderHelpTopic,
} from '../src/cli/commands/help.js';
import { initSpec } from '../src/core/specManager.js';

const runtime = { platform: 'darwin', env: {} } as const;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const makeIO = () => {
  const logs: string[] = [];
  const errs: string[] = [];
  return {
    io: { log: (m: string) => logs.push(m), error: (m: string) => errs.push(m), exit: () => {} },
    logs,
    errs,
  };
};

const temps: string[] = [];
const tempDir = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-learn-'));
  temps.push(dir);
  return dir;
};
afterEach(async () => {
  while (temps.length > 0) await rm(temps.pop()!, { recursive: true, force: true });
});

/** Every `open-sdd <command> [<sub>]` a text names, with `<…>`/`"…"` placeholders left out. */
const namedInvocations = (text: string): { cmd: string; sub?: string }[] => {
  const found: { cmd: string; sub?: string }[] = [];
  for (const match of text.matchAll(/open-sdd ([a-z][a-z-]*)(?: ([a-z][a-z-]*))?/g)) {
    found.push({ cmd: match[1]!, ...(match[2] ? { sub: match[2] } : {}) });
  }
  return found;
};

describe('learning path — the default help is the essentials (REQ-LRN-001)', () => {
  it('`--help`, `-h` and `help` print the essentials, at most 40 lines, in the order of use', async () => {
    for (const argv of [['--help'], ['-h'], ['help']]) {
      const ctx = makeIO();
      expect(await runCli(argv, runtime, ctx.io, {}), argv.join(' ')).toBe(0);
      const out = ctx.logs.join('\n');
      expect(out, argv.join(' ')).toBe(renderEssentialHelp());
    }
    const help = renderEssentialHelp();
    expect(help.split('\n').length).toBeLessThanOrEqual(40);
    const order = ['START', 'DAILY LOOP', 'EXISTING CODE', 'PROOF', 'NEXT'].map((h) => help.indexOf(h));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('the essentials end on the three ways to learn more', () => {
    const tail = renderEssentialHelp().split('\n').slice(-3).join('\n');
    expect(tail).toContain('open-sdd help workflow');
    expect(tail).toContain('open-sdd help <command>');
    expect(tail).toContain('open-sdd --help --all');
  });
});

describe('learning path — the full index stays one flag away (REQ-LRN-002)', () => {
  it('`--help --all`, `help --all` and `help all` print the full index', async () => {
    for (const argv of [['--help', '--all'], ['help', '--all'], ['help', 'all']]) {
      const ctx = makeIO();
      expect(await runCli(argv, runtime, ctx.io, {}), argv.join(' ')).toBe(0);
      expect(ctx.logs.join('\n'), argv.join(' ')).toBe(renderFullHelp());
    }
  });
});

describe('learning path — one guided path per situation (REQ-LRN-003)', () => {
  it('`help workflow` gives five paths, each ending on the command that verifies it', async () => {
    const ctx = makeIO();
    expect(await runCli(['help', 'workflow'], runtime, ctx.io, {})).toBe(0);
    const out = ctx.logs.join('\n');
    for (const situation of ['A NEW FEATURE', 'A CHANGE TO EXISTING CODE', 'A SMALL FIX', 'COMING FROM', 'PROVING A CHANGE']) {
      expect(out, situation).toContain(situation);
    }
    expect(out.match(/done when:/g)?.length).toBe(5);
  });
});

describe('learning path — every named command exists (REQ-LRN-004)', () => {
  it('each command and subcommand in the essentials and the workflow is routed', async () => {
    const text = `${renderEssentialHelp()}\n${renderHelpTopic('workflow')}`;
    const named = namedInvocations(text);
    expect(named.length).toBeGreaterThan(20);
    const failures: string[] = [];
    for (const { cmd, sub } of named) {
      if (cmd === 'help') continue; // `help workflow` / `help <command>`: proved by the tests above
      if (!KNOWN_COMMANDS.has(cmd)) {
        failures.push(cmd);
        continue;
      }
      const strict = STRICT_SUBCOMMANDS[cmd];
      if (strict && sub && !strict.includes(sub)) failures.push(`${cmd} ${sub}`);
    }
    expect(failures).toEqual([]);
  });
});

describe('learning path — every pointer leads to the path (REQ-LRN-005)', () => {
  it('an unknown command names `--help --all` and `help workflow`', async () => {
    const ctx = makeIO();
    expect(await runCli(['statu'], runtime, ctx.io, {})).toBe(2);
    const errs = ctx.errs.join('\n');
    expect(errs).toContain('open-sdd --help --all');
    expect(errs).toContain('open-sdd help workflow');
  });
});

describe('learning path — the full index (REQ-LRN-006)', () => {
  it('leads its examples with `up` and carries no marketing heading', () => {
    const help = renderFullHelp();
    const examples = help.split('Quick Examples:\n')[1]!.split('\n');
    expect(examples[0]).toContain(' up --write');
    expect(help).not.toContain('Apple-grade');
  });
});

describe('learning path — the audit bundle states the released version (REQ-LRN-007)', () => {
  it('the workspace manifest carries the root version', async () => {
    const root = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')) as { version: string };
    const workspace = JSON.parse(await readFile(path.join(repoRoot, 'tools/open-sdd/package.json'), 'utf8')) as {
      version: string;
    };
    expect(workspace.version).toBe(root.version);
  });

  it('a bundle produced from the checkout names that version', async () => {
    const root = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')) as { version: string };
    const dir = await tempDir();
    await initSpec(dir, 'pay-flow', {});
    const ctx = makeIO();
    await runCli(['audit', 'bundle', 'pay-flow', '--json'], runtime, ctx.io, {}, { cwd: dir });
    const envelope = JSON.parse(ctx.logs.join('\n')) as { data: { tool: { version: string } } };
    expect(envelope.data.tool.version).toBe(root.version);
  });
});

describe('learning path — `init <slug> --write` names the spec command (REQ-LRN-008)', () => {
  it('exits 1 and names `open-sdd init <slug>`', async () => {
    const dir = await tempDir();
    const ctx = makeIO();
    expect(await runCli(['init', 'pay-flow', '--write'], runtime, ctx.io, {}, { cwd: dir })).toBe(1);
    expect(ctx.errs.join('\n')).toContain('`open-sdd init pay-flow` (without --write)');
  });
});

describe('learning path — the requirements stub teaches the accepted shape (REQ-LRN-009)', () => {
  const review = async (dir: string): Promise<{ code: number; findings: unknown[] }> => {
    const ctx = makeIO();
    const code = await runCli(['requirements', 'review', 'pay-flow', '--json'], runtime, ctx.io, {}, { cwd: dir });
    const envelope = JSON.parse(ctx.logs.join('\n')) as { data: { findings: unknown[] } };
    return { code, findings: envelope.data.findings };
  };

  it('an unedited stub is never a clean requirement', async () => {
    const dir = await tempDir();
    await initSpec(dir, 'pay-flow', {});
    const stub = await readFile(path.join(dir, '.sdd/specs/pay-flow/requirements.md'), 'utf8');
    expect(stub).toContain('{{');
    expect((await review(dir)).findings.length).toBeGreaterThan(0);
  });

  it('the stub filled in its own shape has no finding', async () => {
    const dir = await tempDir();
    await initSpec(dir, 'pay-flow', {});
    const file = path.join(dir, '.sdd/specs/pay-flow/requirements.md');
    const filled = (await readFile(file, 'utf8'))
      .replace('{{As a <who>, we want <what>, so that <why>}}', 'As a buyer, we want declined cards explained, so that I can retry.')
      .replace('{{AREA}}', 'PAY')
      .replace('{{title}}', 'Declined card is explained')
      .replace('{{the objective or user story this requirement serves}}', 'the objective above.')
      .replace(
        '{{Given <state>, When <action>, Then <measurable result with its unit>}}',
        'Given a declined test card, When the buyer pays, Then the decline reason is visible within 2000 ms.',
      )
      .replace(
        'When {{trigger}}, the [{{component}}] shall {{observable response with its unit}}.',
        'When the payment provider declines a card, the [checkout] shall show the decline reason within 2000 ms.',
      );
    expect(filled).not.toContain('{{');
    await writeFile(file, filled, 'utf8');
    const result = await review(dir);
    expect(result.findings).toEqual([]);
    expect(result.code).toBe(0);
  });
});
