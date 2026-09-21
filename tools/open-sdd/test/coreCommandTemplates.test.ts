/**
 * The prompt-template path — the DEFAULT adoption surface, machine-checked.
 *
 * Everything runs over `mkdtemp` fixtures and is cleaned in `afterEach`: the suite NEVER writes
 * inside the repository. Two contracts are under test, and both are about honesty rather than
 * convenience:
 *
 *   1. Every template is a real contract: its frontmatter carries the declared keys, its `commands:`
 *      list is the authoritative set of `open-sdd …` invocations, and every command it cites either
 *      appears in the CLI help or is verified by actually running it. A template that cites a command
 *      that does not exist is a broken template.
 *   2. The installer is idempotent and never clobbers a human: `create` when absent, `keep` when
 *      byte-identical OR hand-edited, `update` only when the file is provably one of ours (its sha256
 *      signature matches its own body) and has fallen behind. An unverified host convention is
 *      marked unverified and refused — the same rule the MCP matrix follows.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli } from '../src/index.js';
import { handleInitCommand } from '../src/cli/commands/init.js';
import {
  COMMAND_TEMPLATE_IDS,
  HOST_COMMAND_TEMPLATES,
  commandHostById,
  commandTemplatePath,
  hostForAgent,
  installCommandTemplates,
  renderCommandTemplate,
} from '../src/core/commandTemplates.js';

const tempDirs: string[] = [];

const makeRoot = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-templates-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

const makeIO = () => {
  const logs: string[] = [];
  const errs: string[] = [];
  return {
    io: {
      log: (message: string) => logs.push(message),
      error: (message: string) => errs.push(message),
      exit: () => undefined,
    },
    get logs() {
      return logs;
    },
    get errs() {
      return errs;
    },
    text: () => logs.join('\n'),
  };
};

const exists = async (p: string): Promise<boolean> => (await stat(p).catch(() => null)) !== null;

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

// ---------------------------------------------------------------------------------------------
// A minimal, strict frontmatter reader for the declared contract keys.
// ---------------------------------------------------------------------------------------------

interface Frontmatter {
  scalars: Record<string, string>;
  lists: Record<string, string[]>;
}

const parseFrontmatter = (raw: string): Frontmatter => {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) throw new Error('missing YAML frontmatter');
  const scalars: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  const lines = match[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const key = lines[i].match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);
    if (!key) continue;
    const [, name, inline] = key;
    if (inline.trim() === '[]') {
      lists[name] = [];
      continue;
    }
    if (inline.trim().length > 0) {
      scalars[name] = inline.trim();
      continue;
    }
    const items: string[] = [];
    while (i + 1 < lines.length) {
      const item = lines[i + 1].match(/^\s+-\s+(.*)$/);
      if (!item) break;
      i += 1;
      items.push(item[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"'));
    }
    lists[name] = items;
  }

  return { scalars, lists };
};

const readTemplate = async (id: string): Promise<{ raw: string; fm: Frontmatter }> => {
  const raw = await readFile(commandTemplatePath(id as (typeof COMMAND_TEMPLATE_IDS)[number]), 'utf8');
  return { raw, fm: parseFrontmatter(raw) };
};

// ---------------------------------------------------------------------------------------------
// "Does this command exist?" — help first, then actually run it.
// ---------------------------------------------------------------------------------------------

const UNKNOWN = /Unknown (?:flag|positional|argument|command)|Subcomando desconocido|no se reconoce/i;

/** Probes for the subcommands the static help text does not list. Verified by running them. */
const PROBES: Record<string, string[]> = {
  init: ['init', '.', '--json'],
  doctor: ['doctor', '--json'],
  'govern constitution': ['govern', 'constitution', '--matrix'],
  'brownfield analyze': ['brownfield', 'analyze', 'demo', '--json'],
  'brownfield requirements': ['brownfield', 'requirements', 'demo', '--suggest', '--json'],
  'brownfield templates': ['brownfield', 'templates', '--json'],
  'brownfield clarify': ['brownfield', 'clarify', 'demo', '--json'],
  'brownfield specify': ['brownfield', 'specify', 'demo', 'add login', '--json'],
  'brownfield converge': ['brownfield', 'converge', 'demo', '--json'],
  'brownfield forecast': ['brownfield', 'forecast', 'add login', '--json'],
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let helpText: string | null = null;
const cliHelp = async (): Promise<string> => {
  if (helpText !== null) return helpText;
  const ctx = makeIO();
  await runCli(['--help'], { platform: process.platform, env: process.env }, ctx.io);
  helpText = ctx.text();
  return helpText;
};

const helpBacks = (help: string, command: string, sub: string | undefined): boolean => {
  const word = (value: string): RegExp => new RegExp(`\\b${escapeRegExp(value)}\\b`);
  // The help line for a command starts with the command name (e.g. `brownfield survey [target]`);
  // requiring the start avoids matching the word "init" inside "delta init".
  return help
    .split('\n')
    .some((line) => line.trim().startsWith(command) && (sub === undefined || word(sub).test(line)));
};

const commandExists = async (signature: string, fixture: string): Promise<'help' | 'cli' | 'missing'> => {
  const help = await cliHelp();
  const tokens = signature.split(/\s+/);
  const sub = tokens[1] && /^[a-z][a-z-]*$/.test(tokens[1]) ? tokens[1] : undefined;
  if (helpBacks(help, tokens[0], sub)) return 'help';
  const probe = PROBES[`${tokens[0]}${sub ? ` ${sub}` : ''}`];
  if (!probe) return 'missing';
  const ctx = makeIO();
  await runCli(probe, { platform: process.platform, env: process.env }, ctx.io, {}, { cwd: fixture });
  return UNKNOWN.test(ctx.text()) || UNKNOWN.test(ctx.errs.join('\n')) ? 'missing' : 'cli';
};

// ---------------------------------------------------------------------------------------------
// 1. The inventory and the frontmatter contract
// ---------------------------------------------------------------------------------------------

describe('command templates — the inventory is a contract', () => {
  it('ships exactly the declared ids, one file each, with valid frontmatter', async () => {
    expect(COMMAND_TEMPLATE_IDS).toHaveLength(22);
    expect(new Set(COMMAND_TEMPLATE_IDS).size).toBe(22);

    for (const id of COMMAND_TEMPLATE_IDS) {
      expect(await exists(commandTemplatePath(id)), `${id}.md missing`).toBe(true);
      const { fm } = await readTemplate(id);
      expect(fm.scalars.id, `${id}: id`).toBe(id);
      expect(fm.scalars.description, `${id}: description`).toBeTruthy();
      expect(fm.scalars.description.includes('\n'), `${id}: description must be one line`).toBe(false);
      expect(fm.scalars.parallelSafe, `${id}: parallelSafe`).toMatch(/^(true|false)$/);
      // The lists exist even when empty; `[]` is a deliberate statement, not an omission.
      for (const key of ['writes', 'mustNotTouch', 'preconditions', 'handoffs', 'moves', 'commands', 'scripts']) {
        expect(Array.isArray(fm.lists[key]), `${id}: ${key} list`).toBe(true);
      }
    }
  });

  it('every template carries the four mandatory sections and the five-guarantee contract', async () => {
    for (const id of COMMAND_TEMPLATE_IDS) {
      const { raw } = await readTemplate(id);
      for (const section of [
        '## Input',
        '## Steps',
        '## Scope guard',
        '## Honesty',
        '## The constitution is the pivot',
        '## Evidence',
        '## Done when',
        '## Contract — the five guarantees for this template',
      ]) {
        expect(raw, `${id}: ${section}`).toContain(section);
      }
      // The identified pair: what it produces and what it refuses to do.
      expect(raw, `${id}: produces`).toContain('**Identified — produces:**');
      expect(raw, `${id}: refuses`).toContain('**Identified — refuses:**');
      expect(raw, `${id}: assured`).toContain('**Assured — backing check:**');
      expect(raw, `${id}: measured`).toContain('**Measured — components:**');
      expect(raw, `${id}: pivoted`).toContain('**Pivoted — the constitution is the pivot:**');
    }
  });

  it('handoffs point at templates that exist, and moves use only real score components', async () => {
    const ids = new Set<string>(COMMAND_TEMPLATE_IDS);
    const components = new Set(['constitution', 'ears', 'traceability', 'evidence', 'contracts', 'gates', 'alignment']);
    for (const id of COMMAND_TEMPLATE_IDS) {
      const { fm } = await readTemplate(id);
      for (const handoff of fm.lists.handoffs) expect(ids.has(handoff), `${id} → ${handoff}`).toBe(true);
      for (const move of fm.lists.moves) expect(components.has(move), `${id} moves ${move}`).toBe(true);
    }
  });

  it('every cited open-sdd command is backed by the commands list and exists in the CLI', async () => {
    const fixture = await makeRoot();
    const signatures = new Set<string>();
    const normalized = (value: string): string => value.replace(/<[^>]+>/g, '<>').replace(/\s+/g, ' ').trim();

    for (const id of COMMAND_TEMPLATE_IDS) {
      const { raw, fm } = await readTemplate(id);
      expect(fm.lists.commands.length, `${id}: commands`).toBeGreaterThan(0);

      const listed = fm.lists.commands;
      for (const entry of listed) {
        expect(entry.startsWith('open-sdd '), `${id}: command "${entry}"`).toBe(true);
      }

      // Rule 1: every `open-sdd …` string in the body must also be in `commands:`.
      for (const cited of new Set([...raw.matchAll(/`(open-sdd [^`]+)`/g)].map((match) => match[1]))) {
        const backed = listed.some(
          (entry) =>
            normalized(entry) === normalized(cited) ||
            normalized(entry).startsWith(normalized(cited)) ||
            normalized(cited).startsWith(normalized(entry)),
        );
        expect(backed, `${id}: cited but not listed → ${cited}`).toBe(true);
      }

      for (const entry of listed) {
        signatures.add(entry.replace(/^open-sdd\s+/, '').split(/\s+/).slice(0, 2).join(' '));
      }
    }

    for (const signature of signatures) {
      const backing = await commandExists(signature, fixture);
      expect(backing, `command "${signature}" is not backed by the CLI`).not.toBe('missing');
    }
  }, 300_000);

  it('the flow is chained: onboard reaches the constitution and the constitution reaches specify', async () => {
    const onboard = await readTemplate('onboard');
    expect(onboard.fm.lists.handoffs).toContain('constitution');
    const constitution = await readTemplate('constitution');
    expect(constitution.fm.lists.handoffs).toContain('specify');
    const specify = await readTemplate('specify');
    expect(specify.fm.lists.handoffs).toContain('clarify');
    const release = await readTemplate('release');
    expect(release.fm.lists.moves).toContain('gates');
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Host conventions
// ---------------------------------------------------------------------------------------------

describe('command templates — host conventions are declared, verified or refused', () => {
  it('every host declares its convention and how we know', () => {
    const ids = HOST_COMMAND_TEMPLATES.map((host) => host.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const host of HOST_COMMAND_TEMPLATES) {
      expect(host.label, host.id).toBeTruthy();
      expect(host.evidence.length, host.id).toBeGreaterThan(0);
      expect(host.argumentSyntax.length, host.id).toBeGreaterThan(0);
      // A verified convention always has a directory to write into; an unverified one may not.
      if (host.verified) {
        expect(host.dir, `${host.id}: verified host needs a dir`).not.toBeNull();
        expect(host.dir?.startsWith('.'), `${host.id}: project-scoped dir`).toBe(true);
      }
    }
  });

  it('the five conventions verified against the hosts docs are exactly those', () => {
    const verified = HOST_COMMAND_TEMPLATES.filter((host) => host.verified).map((host) => host.id).sort();
    expect(verified).toEqual(['claude-code', 'copilot', 'cursor', 'gemini-cli', 'opencode']);
    // Every verified convention cites the page it was read from (or the layout the installer ships).
    for (const id of verified) expect(commandHostById(id)?.docUrl, id).toBeTruthy();
  });

  it('the unverified hosts are marked and name why they are unverified', () => {
    const unverified = HOST_COMMAND_TEMPLATES.filter((host) => !host.verified).map((host) => host.id).sort();
    expect(unverified).toEqual(['antigravity', 'cline', 'codex', 'qwen-code', 'windsurf', 'zed']);
    for (const id of unverified) {
      const host = commandHostById(id)!;
      expect(host.evidence, id).toMatch(/NOT VERIFIED|no documented|no tiene/i);
    }
  });

  it('maps every agent-registry id to a host, and unknown agents to nothing', () => {
    expect(hostForAgent('claude-code-skills')).toBe('claude-code');
    expect(hostForAgent('cursor-skills')).toBe('cursor');
    expect(hostForAgent('github-copilot-skills')).toBe('copilot');
    expect(hostForAgent('gemini-cli-skills')).toBe('gemini-cli');
    expect(hostForAgent('codex-skills')).toBe('codex');
    expect(hostForAgent('not-an-agent')).toBeUndefined();
  });

  it('uses each host documented layout and file extension', () => {
    expect(commandHostById('claude-code')?.dir).toBe('.claude/commands');
    expect(commandHostById('cursor')?.dir).toBe('.cursor/commands');
    expect(commandHostById('opencode')?.dir).toBe('.opencode/commands');
    expect(commandHostById('gemini-cli')?.dir).toBe('.gemini/commands');
    expect(commandHostById('gemini-cli')?.fileName('constitution')).toBe('sdd-constitution.toml');
    expect(commandHostById('copilot')?.dir).toBe('.github/prompts');
    expect(commandHostById('copilot')?.fileName('constitution')).toBe('sdd-constitution.prompt.md');
    expect(commandHostById('claude-code')?.invocation('plan')).toBe('/sdd-plan');
  });
});

// ---------------------------------------------------------------------------------------------
// 3. installCommandTemplates — create / update / keep, never clobber
// ---------------------------------------------------------------------------------------------

describe('installCommandTemplates — create, keep, update, and refuse', () => {
  it('writes into a verified host documented layout and reports create', async () => {
    const dir = await makeRoot();
    const result = await installCommandTemplates({ cwd: dir, hosts: ['claude-code'], write: true });

    expect(result.failures).toEqual([]);
    expect(result.written).toHaveLength(COMMAND_TEMPLATE_IDS.length);
    expect(result.artifacts.every((artifact) => artifact.action === 'create')).toBe(true);
    expect(result.artifacts.every((artifact) => artifact.verified)).toBe(true);
    // Every write stayed inside the fixture; the repository was not touched.
    for (const written of result.written) {
      expect(path.resolve(dir, written).startsWith(dir)).toBe(true);
    }
    expect(await exists(path.join(dir, '.claude', 'commands', 'sdd-constitution.md'))).toBe(true);
    expect(await exists(path.join(dir, '.claude', 'commands', 'sdd-tasks-to-issues.md'))).toBe(true);
  });

  it('is idempotent: a second run reports keep for every artifact and rewrites nothing', async () => {
    const dir = await makeRoot();
    await installCommandTemplates({ cwd: dir, hosts: ['cursor'], write: true });
    const before = await readFile(path.join(dir, '.cursor', 'commands', 'sdd-plan.md'), 'utf8');

    const second = await installCommandTemplates({ cwd: dir, hosts: ['cursor'], write: true });
    expect(second.written).toEqual([]);
    expect(second.kept).toHaveLength(COMMAND_TEMPLATE_IDS.length);
    expect(second.artifacts.every((artifact) => artifact.action === 'keep')).toBe(true);
    expect(await readFile(path.join(dir, '.cursor', 'commands', 'sdd-plan.md'), 'utf8')).toBe(before);
  });

  it('NEVER overwrites a file a human edited: keep, with that reason', async () => {
    const dir = await makeRoot();
    await installCommandTemplates({ cwd: dir, hosts: ['opencode'], write: true });
    const target = path.join(dir, '.opencode', 'commands', 'sdd-constitution.md');
    const edited = `${await readFile(target, 'utf8')}\n<!-- equipo: ajuste local -->\n`;
    await writeFile(target, edited, 'utf8');

    const second = await installCommandTemplates({ cwd: dir, hosts: ['opencode'], write: true });
    const artifact = second.artifacts.find((entry) => entry.command === 'constitution');
    expect(artifact?.action).toBe('keep');
    expect(artifact?.reason).toMatch(/edit|edición/i);
    expect(await readFile(target, 'utf8')).toBe(edited);
  });

  it('refreshes a stale file that is provably ours and was not edited (update)', async () => {
    const dir = await makeRoot();
    await installCommandTemplates({ cwd: dir, hosts: ['claude-code'], write: true });

    // Simulate an older generated artifact: a different body, with a signature that matches it.
    const target = path.join(dir, '.claude', 'commands', 'sdd-tasks.md');
    const oldBody = 'OLD GENERATED BODY\n';
    await writeFile(
      target,
      `${oldBody}<!-- open-sdd:command-template id=tasks sha256=${sha256(oldBody)} -->\n`,
      'utf8',
    );

    const second = await installCommandTemplates({ cwd: dir, hosts: ['claude-code'], write: true });
    const artifact = second.artifacts.find((entry) => entry.command === 'tasks');
    expect(artifact?.action).toBe('update');
    expect(second.written).toContain('.claude/commands/sdd-tasks.md');
    expect(await readFile(target, 'utf8')).toContain('Tasks — ordered work with a proof attached');
  });

  it('an unverified host is marked unverified and refused by --write', async () => {
    const dir = await makeRoot();
    const result = await installCommandTemplates({ cwd: dir, hosts: ['codex'], write: true });

    expect(result.written).toEqual([]);
    expect(result.artifacts).toHaveLength(1);
    const [artifact] = result.artifacts;
    expect(artifact.verified).toBe(false);
    expect(artifact.action).toBe('keep');
    expect(artifact.reason).toMatch(/NO está verificada|no existe/i);
    expect(await exists(path.join(dir, '.codex'))).toBe(false);
  });

  it('refuses a host with no documented commands directory (zed, cline)', async () => {
    const dir = await makeRoot();
    for (const host of ['zed', 'cline']) {
      const result = await installCommandTemplates({ cwd: dir, hosts: [host], write: true });
      expect(result.written, host).toEqual([]);
      expect(result.artifacts[0].verified, host).toBe(false);
      expect(result.artifacts[0].action, host).toBe('keep');
    }
  });

  it('renders TOML for Gemini CLI and Markdown for the rest', async () => {
    const gemini = commandHostById('gemini-cli')!;
    const rendered = await renderCommandTemplate('constitution', gemini);
    expect(rendered.format).toBe('toml');
    expect(rendered.content.startsWith('description = "')).toBe(true);
    expect(rendered.content).toContain('prompt = """');
    expect(rendered.content).toMatch(/^# open-sdd:command-template id=constitution sha256=[0-9a-f]{64}$/m);

    const claude = await renderCommandTemplate('constitution', commandHostById('claude-code')!);
    expect(claude.format).toBe('markdown');
    expect(claude.content.startsWith('---\n')).toBe(true);
    expect(claude.content).toMatch(/^<!-- open-sdd:command-template id=constitution sha256=[0-9a-f]{64} -->$/m);
  });

  it('an unknown host id is a failure, never a plausible-looking write', async () => {
    const dir = await makeRoot();
    const result = await installCommandTemplates({ cwd: dir, hosts: ['not-a-host'], write: true });
    expect(result.written).toEqual([]);
    expect(result.failures.join(' ')).toContain('not-a-host');
  });
});

// ---------------------------------------------------------------------------------------------
// 4. init — templates by default, MCP only when asked
// ---------------------------------------------------------------------------------------------

describe('init — prompt templates by default, MCP opt-in', () => {
  const withCursor = async (): Promise<string> => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });
    return dir;
  };

  it('init --write installs the prompt templates and does NOT register MCP', async () => {
    const dir = await withCursor();
    const ctx = makeIO();

    expect(await handleInitCommand(['.', '--write', '--json'], ctx.io, dir)).toBe(0);
    const plan = JSON.parse(ctx.text()) as {
      commandTemplates: { host: string; action: string; verified: boolean };
      mcp: { requested: boolean; path: string | null };
      artifacts: { kind: string; action: string }[];
    };

    expect(plan.commandTemplates).toMatchObject({ host: 'cursor', action: 'create', verified: true });
    expect(plan.mcp.requested).toBe(false);
    expect(plan.mcp.path).toBeNull();
    expect(plan.artifacts.find((artifact) => artifact.kind === 'command-templates')?.action).toBe('create');
    expect(plan.artifacts.some((artifact) => artifact.kind === 'mcp-config')).toBe(false);

    expect(await exists(path.join(dir, '.cursor', 'commands', 'sdd-constitution.md'))).toBe(true);
    expect(await exists(path.join(dir, '.cursor', 'commands', 'sdd-release.md'))).toBe(true);
    expect(await exists(path.join(dir, '.cursor', 'mcp.json'))).toBe(false);
  });

  it('init --write is idempotent: the second run keeps every template', async () => {
    const dir = await withCursor();
    await handleInitCommand(['.', '--write'], makeIO().io, dir);
    const before = await readFile(path.join(dir, '.cursor', 'commands', 'sdd-specify.md'), 'utf8');

    const second = makeIO();
    expect(await handleInitCommand(['.', '--write', '--json'], second.io, dir)).toBe(0);
    const plan = JSON.parse(second.text()) as {
      artifacts: { action: string }[];
      outcome: { written: string[]; failures: string[] };
    };
    expect(plan.artifacts.every((artifact) => artifact.action === 'keep')).toBe(true);
    expect(plan.outcome.written).toEqual([]);
    expect(plan.outcome.failures).toEqual([]);
    expect(await readFile(path.join(dir, '.cursor', 'commands', 'sdd-specify.md'), 'utf8')).toBe(before);
  });

  it('init --write never overwrites a template the user edited', async () => {
    const dir = await withCursor();
    await handleInitCommand(['.', '--write'], makeIO().io, dir);
    const target = path.join(dir, '.cursor', 'commands', 'sdd-plan.md');
    const edited = `${await readFile(target, 'utf8')}\n<!-- nuestro cambio -->\n`;
    await writeFile(target, edited, 'utf8');

    const ctx = makeIO();
    await handleInitCommand(['.', '--write', '--json'], ctx.io, dir);
    const plan = JSON.parse(ctx.text()) as { outcome: { kept: string[] } };
    expect(plan.outcome.kept).toContain('.cursor/commands/sdd-plan.md');
    expect(await readFile(target, 'utf8')).toBe(edited);
  });

  it('init --write --mcp does BOTH: templates and the MCP registration', async () => {
    const dir = await withCursor();
    const ctx = makeIO();

    expect(await handleInitCommand(['.', '--write', '--mcp', '--json'], ctx.io, dir)).toBe(0);
    const plan = JSON.parse(ctx.text()) as {
      commandTemplates: { action: string };
      mcp: { requested: boolean; path: string | null; action: string | null; verified: boolean };
      artifacts: { kind: string; action: string }[];
      outcome: { written: string[]; failures: string[] };
    };

    expect(plan.commandTemplates.action).toBe('create');
    expect(plan.mcp).toMatchObject({ requested: true, path: '.cursor/mcp.json', action: 'create', verified: true });
    expect(plan.artifacts.find((artifact) => artifact.kind === 'mcp-config')?.action).toBe('create');
    expect(plan.outcome.failures).toEqual([]);

    expect(await exists(path.join(dir, '.cursor', 'commands', 'sdd-constitution.md'))).toBe(true);
    const mcp = JSON.parse(await readFile(path.join(dir, '.cursor', 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(mcp.mcpServers['open-sdd'].command).toBe('node');
    expect(mcp.mcpServers['open-sdd'].args.at(-1)).toBe('mcp');
  });

  it('init --write refuses the templates of a host whose convention is unverified', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.codex'), { recursive: true });
    const ctx = makeIO();

    expect(await handleInitCommand(['.', '--agent', 'codex-skills', '--write', '--json'], ctx.io, dir)).toBe(0);
    const plan = JSON.parse(ctx.text()) as {
      commandTemplates: { host: string; verified: boolean; action: string };
      artifacts: { kind: string; action: string }[];
      outcome: { written: string[] };
    };

    expect(plan.commandTemplates).toMatchObject({ host: 'codex', verified: false, action: 'keep' });
    expect(plan.artifacts.find((artifact) => artifact.kind === 'command-templates')?.action).toBe('keep');
    expect(plan.outcome.written).not.toContain('.codex/prompts');
    expect(await exists(path.join(dir, '.codex', 'prompts'))).toBe(false);
  });
});
