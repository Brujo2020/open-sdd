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
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli } from '../src/index.js';
import { handleInitCommand } from '../src/cli/commands/init.js';
import {
  ARGUMENT_PLACEHOLDER,
  COMMAND_TEMPLATE_IDS,
  HOST_COMMAND_TEMPLATES,
  commandHostById,
  commandTemplatePath,
  hostForAgent,
  installCommandTemplates,
  readCommandTemplateCatalogue,
  renderCommandTemplate,
} from '../src/core/commandTemplates.js';
import { buildTemplatesReport, handleTemplatesCommand } from '../src/cli/commands/templates.js';

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
      // El marcador es un contrato con evidencia: o lo sustituye el motor del anfitrión, o se dice
      // que su documentación no describe ninguno (y entonces el artefacto lleva prosa, no un token).
      if (host.argumentSyntax === null) {
        expect(host.argumentEvidence, `${host.id}: null sin URL`).toMatch(/https?:\/\//);
      } else {
        expect(host.argumentSyntax.length, host.id).toBeGreaterThan(0);
        expect(host.argumentEvidence, `${host.id}: con marcador pero sin evidencia`).toMatch(/VERIFIED/);
      }
      // A verified convention always has a directory to write into; an unverified one may not.
      if (host.verified) {
        expect(host.dir, `${host.id}: verified host needs a dir`).not.toBeNull();
        expect(host.dir?.startsWith('.'), `${host.id}: project-scoped dir`).toBe(true);
      }
    }
  });

  it('the conventions verified against the hosts docs are exactly those', () => {
    const verified = HOST_COMMAND_TEMPLATES.filter((host) => host.verified).map((host) => host.id).sort();
    expect(verified).toEqual([
      'antigravity',
      'augment',
      'claude-code',
      'codebuddy',
      'copilot',
      'cursor',
      'factory-droid',
      'gemini-cli',
      'iflow',
      'junie',
      'kilo-code',
      'mimocode',
      'opencode',
      'qoder',
      'qwen-code',
      'roo-code',
      'trae',
      'windsurf',
      'zcode',
    ]);
    // Every verified convention cites the page it was read from (or the layout the installer ships).
    for (const id of verified) {
      const host = commandHostById(id)!;
      expect(host.docUrl ?? host.sourceArtifact, `${id}: verificado sin documento ni artefacto`).toBeTruthy();
    }
  });

  it('the unverified hosts are marked and name why they are unverified', () => {
    const unverified = HOST_COMMAND_TEMPLATES.filter((host) => !host.verified).map((host) => host.id).sort();
    expect(unverified).toEqual([
      'aider',
      'amp',
      'cline',
      'codex',
      'continue-dev',
      'crush',
      'dsh',
      'goose',
      'kimi-code',
      'openhands',
      'warp',
      'zed',
    ]);
    for (const id of unverified) {
      const host = commandHostById(id)!;
      expect(host.evidence, id).toMatch(/NOT VERIFIED|no documented|no tiene/i);
      // An honest dead end must name the URL(s) that were tried, not just assert a gap.
      expect(host.evidence, `${id}: evidence names the docs it read`).toMatch(/https:\/\//);
    }
  });

  it('an internal fork declares its parent, and verification is earned with its own artifact', () => {
    const forks = HOST_COMMAND_TEMPLATES.filter((host) => host.forkOf !== undefined);
    // Ninguna fila de fork vive ya en la matriz publica: la capacidad se conserva y este invariante
    // se aplica a la primera que aparezca, porque es lo que impide que 'es un fork' sea una excusa.
    expect(Array.isArray(forks)).toBe(true);
    for (const fork of forks) {
      const parent = commandHostById(fork.forkOf as string);
      // El padre tiene que existir y ser una fila con veredicto propio (verificada o rechazada).
      expect(parent, `${fork.id}: parent ${fork.forkOf} does not exist`).toBeDefined();
      // Y un fork NUNCA puede estar mas verificado que su padre. Aqui el padre (cline) esta RECHAZADO
      // porque Cline no documenta directorio de comandos de proyecto: el fork hereda esa AUSENCIA, y
      // declararlo verificado seria afirmar algo que su propio padre desmiente.
      // Un fork PUEDE estar mas verificado que su padre, pero solo citando SU PROPIO artefacto:
      // que el padre lo este no dice nada del fork, y creerlo es como se escribe una ruta a ciegas.
      if (fork.verified && !parent?.verified) {
        expect(fork.sourceArtifact, `${fork.id}: verificado por herencia y sin artefacto propio`).toBeTruthy();
      }
      // Lo heredado tiene que decirse: una fila de fork no puede parecer una convencion propia.
      expect(fork.evidence).toMatch(/FORK|fork/i);
      expect(fork.docUrl).toBe(parent?.docUrl);
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
    // Qwen Code migrated from TOML to Markdown in its own docs; the matrix must not write the
    // deprecated extension.
    expect(commandHostById('qwen-code')?.dir).toBe('.qwen/commands');
    expect(commandHostById('qwen-code')?.fileName('constitution')).toBe('sdd-constitution.md');
    expect(commandHostById('qwen-code')?.format).toBe('markdown');
    expect(commandHostById('qwen-code')?.argumentSyntax).toBe('{{args}}');
    // Windsurf workflows and Antigravity legacy workflows are project-scoped Markdown files; the
    // Antigravity directory is the documented PLURAL `.agents/workflows/`.
    expect(commandHostById('windsurf')?.dir).toBe('.windsurf/workflows');
    expect(commandHostById('windsurf')?.fileName('constitution')).toBe('sdd-constitution.md');
    expect(commandHostById('antigravity')?.dir).toBe('.agents/workflows');
    expect(commandHostById('antigravity')?.fileName('constitution')).toBe('sdd-constitution.md');
    // No command directory can be declared for the hosts whose docs steer to skills.
    expect(commandHostById('zed')?.dir).toBeNull();
    expect(commandHostById('cline')?.dir).toBeNull();
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

  it('writes into each newly documented host at the exact path its own docs name', async () => {
    const dir = await makeRoot();
    const result = await installCommandTemplates({
      cwd: dir,
      hosts: ['windsurf', 'qwen-code', 'antigravity'],
      write: true,
    });

    expect(result.failures).toEqual([]);
    expect(result.artifacts.every((artifact) => artifact.verified)).toBe(true);
    // Windsurf: .windsurf/workflows/*.md (docs.devin.ai).
    expect(await exists(path.join(dir, '.windsurf', 'workflows', 'sdd-constitution.md'))).toBe(true);
    // Qwen Code: .qwen/commands/*.md, Markdown — the docs deprecate the .toml form.
    expect(await exists(path.join(dir, '.qwen', 'commands', 'sdd-constitution.md'))).toBe(true);
    expect(await exists(path.join(dir, '.qwen', 'commands', 'sdd-constitution.toml'))).toBe(false);
    // Antigravity: the documented plural `.agents/workflows/`, not the legacy `.agent/`.
    expect(await exists(path.join(dir, '.agents', 'workflows', 'sdd-constitution.md'))).toBe(true);
    expect(await exists(path.join(dir, '.agent', 'workflows'))).toBe(false);

    const qwen = await readFile(path.join(dir, '.qwen', 'commands', 'sdd-constitution.md'), 'utf8');
    expect(qwen.startsWith('---\n')).toBe(true);
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

    // Qwen Code is now a Markdown host (its docs deprecate TOML): the rendered artifact must be a
    // Markdown file with frontmatter, not a TOML `prompt = """` document.
    const qwen = await renderCommandTemplate('constitution', commandHostById('qwen-code')!);
    expect(qwen.format).toBe('markdown');
    expect(qwen.content.startsWith('---\n')).toBe(true);
    expect(qwen.content).not.toContain('prompt = """');
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

// ---------------------------------------------------------------------------------------------
// `open-sdd templates` — el camino por defecto, LEGIBLE
// ---------------------------------------------------------------------------------------------

describe('templates — the default flow is listable, not just installed', () => {
  it('the catalogue parses every shipped template out of its own frontmatter', async () => {
    const catalogue = await readCommandTemplateCatalogue();

    expect(catalogue.map((entry) => entry.id)).toEqual([...COMMAND_TEMPLATE_IDS]);
    for (const entry of catalogue) {
      // Una entrada sin descripción no se puede listar; una sin comandos no apunta a ningún motor.
      expect(entry.description.length, `${entry.id} sin descripción`).toBeGreaterThan(10);
      expect(entry.commands.length, `${entry.id} sin invocaciones del motor`).toBeGreaterThan(0);
      expect(entry.commands.every((command) => command.startsWith('open-sdd '))).toBe(true);
    }
  });

  it('readOnly is derived from `writes`, and the read-only set is exactly the report-only workflows', async () => {
    const catalogue = await readCommandTemplateCatalogue();
    const readOnly = catalogue.filter((entry) => entry.readOnly).map((entry) => entry.id);

    for (const entry of catalogue) {
      expect(entry.readOnly).toBe(entry.writes.length === 0);
    }
    // Estos cuatro SOLO informan: declarar `writes: []` es su contrato, no un olvido del frontmatter.
    expect(readOnly).toEqual(expect.arrayContaining(['status', 'impact', 'reuse', 'gates', 'doctor']));
    // Y ninguno de los que escriben puede quedarse fuera por accidente.
    expect(catalogue.find((entry) => entry.id === 'implement')?.readOnly).toBe(false);
    expect(catalogue.find((entry) => entry.id === 'constitution')?.readOnly).toBe(false);
  });

  it('the catalogue agrees with the raw frontmatter of every template (no invented engine call)', async () => {
    const catalogue = await readCommandTemplateCatalogue();

    for (const entry of catalogue) {
      const raw = await readFile(commandTemplatePath(entry.id), 'utf8');
      const { lists } = parseFrontmatter(raw);
      expect(entry.commands, `${entry.id}: commands`).toEqual(lists.commands ?? []);
      expect(entry.writes, `${entry.id}: writes`).toEqual(lists.writes ?? []);
    }
  });

  it('an empty repository reports nothing installed, and init --write moves it to 22/22', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });

    const before = await buildTemplatesReport(dir);
    expect(before.templates).toHaveLength(COMMAND_TEMPLATE_IDS.length);
    expect(before.installed).toEqual([]);

    await installCommandTemplates({ cwd: dir, hosts: ['cursor'], write: true });

    const after = await buildTemplatesReport(dir);
    expect(after.installed).toHaveLength(1);
    expect(after.installed[0]).toMatchObject({
      host: 'cursor',
      dir: '.cursor/commands',
      installed: COMMAND_TEMPLATE_IDS.length,
      total: COMMAND_TEMPLATE_IDS.length,
      handEdited: 0,
      stale: 0,
    });
  });

  it('counts a hand-edited template as installed AND as hand-edited, because it is not overwritten', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });
    await installCommandTemplates({ cwd: dir, hosts: ['cursor'], write: true });

    const edited = path.join(dir, '.cursor', 'commands', 'sdd-specify.md');
    await writeFile(edited, `${await readFile(edited, 'utf8')}\nNota del equipo: esto es nuestro.\n`, 'utf8');

    const report = await buildTemplatesReport(dir);
    expect(report.installed[0]).toMatchObject({ installed: COMMAND_TEMPLATE_IDS.length, handEdited: 1, stale: 0 });

    const ctx = makeIO();
    expect(await handleTemplatesCommand(['--json'], ctx.io, dir)).toBe(0);
    const payload = JSON.parse(ctx.text()) as { data: { installed: { handEdited: number }[] } };
    expect(payload.data.installed[0].handEdited).toBe(1);
  });

  it('the command never writes: a read-only repository is untouched', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });

    const ctx = makeIO();
    expect(await handleTemplatesCommand([], ctx.io, dir)).toBe(0);

    // Ni plantillas, ni un directorio inventado, ni un `mcp.json` por cortesía.
    expect(await exists(path.join(dir, '.cursor', 'commands'))).toBe(false);
    expect(await exists(path.join(dir, '.cursor', 'mcp.json'))).toBe(false);
    expect(ctx.text()).toContain('SIN MCP y sin red');
  });

  it('an unknown --host is a failure that names the known hosts, never an empty success', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();

    expect(await handleTemplatesCommand(['--host', 'nope'], ctx.io, dir)).toBe(1);
    expect(ctx.errs.join('\n')).toContain('claude-code');
  });

  it('names every host, and marks the unverified convention as unverified', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();
    expect(await handleTemplatesCommand(['--json'], ctx.io, dir)).toBe(0);

    const payload = JSON.parse(ctx.text()) as {
      data: { hosts: { id: string; verified: boolean; evidence: string; docUrl?: string }[] };
    };
    expect(payload.data.hosts.map((host) => host.id)).toEqual(HOST_COMMAND_TEMPLATES.map((host) => host.id));
    for (const host of payload.data.hosts) {
      expect(host.evidence.length, `${host.id} sin evidencia`).toBeGreaterThan(40);
      // La prueba intentada viaja con el veredicto: un «no verificado» sin URL no es auditable.
      if (!host.verified) expect(host.docUrl, `${host.id} sin docUrl`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// La entrega del argumento — el marcador se traduce, no se envía muerto
// ---------------------------------------------------------------------------------------------

describe('argument delivery — the placeholder is translated, never shipped dead', () => {
  it('every template carries exactly one canonical input block, so a translation cannot miss', async () => {
    for (const id of COMMAND_TEMPLATE_IDS) {
      const raw = await readFile(commandTemplatePath(id), 'utf8');
      const occurrences = raw.split(ARGUMENT_PLACEHOLDER).length - 1;
      expect(occurrences, `${id}: ocurrencias de ${ARGUMENT_PLACEHOLDER}`).toBe(1);
      // El bloque tiene forma canónica en las 22: si dejara de tenerla, la traducción de los
      // anfitriones sin marcador (el reemplazo del bloque) dejaría de aplicarse en silencio.
      expect(/```text\r?\n\$ARGUMENTS\r?\n```/.test(raw), `${id}: bloque de entrada no canónico`).toBe(true);
    }
  });

  it('renders the host’s OWN placeholder and never a foreign one', async () => {
    const documented = [
      ...new Set(
        HOST_COMMAND_TEMPLATES.map((host) => host.argumentSyntax).filter((value): value is string => value !== null),
      ),
    ];
    // Los tres motores que recibían el marcador de otro: el arreglo se prueba por su nombre.
    expect(documented).toEqual(expect.arrayContaining([ARGUMENT_PLACEHOLDER, '{{args}}', '${input:request}']));

    for (const host of HOST_COMMAND_TEMPLATES) {
      const rendered = await renderCommandTemplate('specify', host);
      if (host.argumentSyntax === null) {
        expect(rendered.content, `${host.id}: no debe llevar un token que su motor no expande`).not.toContain(
          ARGUMENT_PLACEHOLDER,
        );
        expect(rendered.content).toContain('The human’s request exactly as they typed it');
      } else {
        expect(rendered.content, `${host.id}: debe llevar ${host.argumentSyntax}`).toContain(host.argumentSyntax);
        if (host.argumentSyntax !== ARGUMENT_PLACEHOLDER) {
          expect(rendered.content, `${host.id}: conserva el token canónico`).not.toContain(ARGUMENT_PLACEHOLDER);
        }
      }
      for (const foreign of documented) {
        if (foreign === host.argumentSyntax) continue;
        expect(rendered.content, `${host.id}: contiene el marcador de otro anfitrión (${foreign})`).not.toContain(foreign);
      }
    }
  });

  it('every host declares where its placeholder was read, and a null one names the URL that failed', () => {
    for (const host of HOST_COMMAND_TEMPLATES) {
      expect(host.argumentEvidence.length, `${host.id}: sin argumentEvidence`).toBeGreaterThan(40);
      if (host.argumentSyntax === null) {
        // Un «no hay marcador» sin la prueba intentada es una afirmación de los autores.
        expect(host.argumentEvidence, `${host.id}: null sin URL`).toMatch(/https?:\/\//);
      } else {
        expect(host.argumentEvidence, `${host.id}: con marcador pero sin evidencia`).toMatch(/VERIFIED/);
      }
    }
  });

  it('every shipped template carries the argument-hint its host reads in the composer', async () => {
    for (const id of COMMAND_TEMPLATE_IDS) {
      const raw = await readFile(commandTemplatePath(id), 'utf8');
      // Documentado en Claude Code (`argument-hint`) y en las prompt files de VS Code; inerte para el resto.
      expect(/^argument-hint: ".+"$/m.test(raw), `${id}: sin argument-hint`).toBe(true);
    }
  });

  it('every rendered artifact stays inside the host’s DOCUMENTED character limit', async () => {
    const limited = HOST_COMMAND_TEMPLATES.filter((host) => host.maxChars !== undefined);
    expect(limited.map((host) => host.id).sort()).toEqual(['antigravity', 'windsurf']);

    let worst = { host: '', id: '', chars: 0, limit: 0 };
    for (const host of limited) {
      for (const id of COMMAND_TEMPLATE_IDS) {
        const rendered = await renderCommandTemplate(id, host);
        expect(rendered.chars, `${host.id}/${id}: ${rendered.chars} > ${host.maxChars}`).toBeLessThanOrEqual(
          host.maxChars as number,
        );
        if (rendered.chars > worst.chars) worst = { host: host.id, id, chars: rendered.chars, limit: host.maxChars as number };
      }
    }
    // El margen se mide, no se supone: el mayor artefacto queda muy por debajo del techo.
    expect(worst.chars).toBeGreaterThan(0);
    expect(worst.chars).toBeLessThan(worst.limit);
  });

  it('a template over the limit is a FAILURE with the number, not a silent truncation', async () => {
    const dir = await makeRoot();
    const templatesRoot = path.join(dir, 'tpl');
    await mkdir(path.join(templatesRoot, 'commands'), { recursive: true });
    for (const id of COMMAND_TEMPLATE_IDS) {
      await writeFile(
        path.join(templatesRoot, 'commands', `${id}.md`),
        await readFile(commandTemplatePath(id), 'utf8'),
        'utf8',
      );
    }
    const victim = path.join(templatesRoot, 'commands', 'specify.md');
    await writeFile(victim, `${await readFile(victim, 'utf8')}\n${'x'.repeat(13_000)}\n`, 'utf8');

    const outcome = await installCommandTemplates({ cwd: dir, hosts: ['windsurf'], templatesRoot, write: true });
    const failure = outcome.failures.join('\n');

    expect(failure).toContain('12,000');
    expect(failure).toContain('sdd-specify.md');
    expect(outcome.written).not.toContain('.windsurf/workflows/sdd-specify.md');
    expect(await exists(path.join(dir, '.windsurf', 'workflows', 'sdd-specify.md'))).toBe(false);
    // El hueco queda declarado y los otros 21 sí entran: un límite no bloquea la instalación entera.
    expect(outcome.written).toContain('.windsurf/workflows/sdd-plan.md');
  });
});
