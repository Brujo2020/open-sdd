/**
 * `open-sdd integrate` — the adoption surface, machine-checked.
 *
 * Everything runs over `mkdtemp` fixtures and is cleaned in `afterEach`: the suite NEVER writes
 * inside the repository. The observable contract under test is the one the matrix promises:
 * `--list` prints every host with its invocation syntax, detection names its evidence, a verified
 * host yields a parseable JSON/TOML snippet while an unverified one is printed as NO VERIFICADO and
 * never written, and `--write` merges into an existing config without deleting unrelated keys and
 * is idempotent on the second run.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOST_INTEGRATIONS,
  detectIntegration,
  integrationById,
  mcpRegistration,
} from '../src/core/integrations.js';
import { handleIntegrateCommand, mergeMcpConfig, planIntegrate } from '../src/cli/commands/init.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const tempDirs: string[] = [];

const makeRoot = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-integrate-'));
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

const readJson = async (p: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(p, 'utf8')) as Record<string, unknown>;

describe('integrations — the matrix is the single source of truth', () => {
  it('--list prints every host with its skills layout and its invocation syntax', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();

    expect(await handleIntegrateCommand(['--list'], ctx.io, dir)).toBe(0);

    for (const host of HOST_INTEGRATIONS) {
      expect(ctx.text(), `host ${host.id} missing from --list`).toContain(host.id);
      expect(ctx.text(), `invocation of ${host.id} missing`).toContain(host.invocation);
      expect(ctx.text(), `skills layout of ${host.id} missing`).toContain(host.skills.layout);
    }
    expect(ctx.text()).toContain('verificado');
    expect(ctx.text()).toContain('NO VERIFICADA');
    // `--list` is read-only: nothing may appear in the fixture.
    expect(await exists(path.join(dir, '.cursor'))).toBe(false);
    expect(await exists(path.join(dir, '.mcp.json'))).toBe(false);
  });

  it('every id resolves and the matrix has no duplicate host', () => {
    const ids = HOST_INTEGRATIONS.map((host) => host.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(integrationById(id)?.id).toBe(id);
    expect(integrationById('does-not-exist')).toBeUndefined();
  });
});

describe('integrations — detection names its evidence', () => {
  it('detects Cursor from a `.cursor/` marker and publishes the evidence', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });

    const detected = await detectIntegration(dir);
    expect(detected?.id).toBe('cursor');
    expect(detected?.evidence.some((line) => line.includes('.cursor/'))).toBe(true);
  });

  it('without any marker there is nothing to detect', async () => {
    const dir = await makeRoot();
    expect(await detectIntegration(dir)).toBeNull();
  });

  it('the detected host is printed with its exact invocation line', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });
    const ctx = makeIO();

    expect(await handleIntegrateCommand([], ctx.io, dir)).toBe(0);
    expect(ctx.text()).toContain('cursor');
    expect(ctx.text()).toContain('/sdd-brownfield');
    expect(ctx.text()).toContain('.cursor/ existe');
  });

  it('without any marker it proposes the default host, like `init`, and says so', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();

    expect(await handleIntegrateCommand(['--json'], ctx.io, dir)).toBe(0);
    const plan = JSON.parse(ctx.text()) as {
      host: { id: string; source: string; evidence: string[] };
      complete: boolean;
      steps: string[];
    };
    expect(plan.host.source).toBe('defecto');
    expect(plan.host.id).toBe('claude-code');
    expect(plan.host.evidence.join(' ')).toContain('no se observó ningún marcador');
    expect(plan.complete).toBe(false);
    expect(plan.steps.some((step) => step.includes('por defecto'))).toBe(true);
  });

  it('an unknown host is an error that lists the admitted ids', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();
    expect(await handleIntegrateCommand(['not-a-host'], ctx.io, dir)).toBe(1);
    expect(ctx.errs.join('\n')).toContain('claude-code');
  });
});

describe('integrations — MCP registration is real or declared unverified', () => {
  it('a verified JSON host produces a parseable `mcpServers` snippet', () => {
    const cliPath = '/opt/open-sdd/dist/cli.js';
    const registration = mcpRegistration('claude-code', { cliPath });

    expect(registration.verified).toBe(true);
    expect(registration.format).toBe('json');
    expect(registration.path).toBe('.mcp.json');

    const parsed = JSON.parse(registration.content) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(parsed.mcpServers['open-sdd'].command).toBe('node');
    expect(parsed.mcpServers['open-sdd'].args).toEqual([cliPath, 'mcp']);
  });

  it('a verified TOML host produces a `[mcp_servers.open-sdd]` table', () => {
    const registration = mcpRegistration('codex', { cliPath: '/opt/open-sdd/dist/cli.js' });
    expect(registration.verified).toBe(true);
    expect(registration.format).toBe('toml');
    expect(registration.content).toContain('[mcp_servers.open-sdd]');
    expect(registration.content).toContain('command = "node"');
    expect(registration.content).toContain('args = ["/opt/open-sdd/dist/cli.js", "mcp"]');
  });

  it('a host whose shape is unverified is marked `verified:false`, printed as NO VERIFICADO and never written', async () => {
    // Every host in the shipped matrix is verified today, so the refusal path is exercised with a
    // synthetic unverified row pushed for the duration of the test and popped in `finally`. The
    // behaviour under test is what a FUTURE unverified host gets, not any current host's status.
    const dir = await makeRoot();
    const synthetic = {
      id: 'unverified-fixture',
      label: 'Unverified Fixture',
      skills: { layout: '.fixture/skills/sdd-*/SKILL.md', mode: 'skills' as const },
      invocation: '/sdd-brownfield',
      mcp: {
        configPaths: { linux: '.fixture/mcp.json', darwin: '.fixture/mcp.json', win32: '.fixture/mcp.json' },
        snippetFormat: 'json' as const,
        snippet: (cliPath: string) =>
          `${JSON.stringify({ mcpServers: { 'open-sdd': { command: 'node', args: [cliPath, 'mcp'] } } }, null, 2)}\n`,
        verified: false,
      },
      detect: ['.fixture/'],
      notes: ['fixture: forma deliberadamente no verificada'],
    };
    HOST_INTEGRATIONS.push(synthetic);
    try {
      const registration = mcpRegistration('unverified-fixture', { cliPath: '/opt/open-sdd/dist/cli.js' });
      expect(registration.verified).toBe(false);

      const plan = await planIntegrate({ cwd: dir, host: 'unverified-fixture' });
      expect(plan.mcp.verified).toBe(false);
      expect(plan.artifacts.find((artifact) => artifact.kind === 'mcp-config')?.action).toBe('keep');

      const ctx = makeIO();
      expect(await handleIntegrateCommand(['unverified-fixture'], ctx.io, dir)).toBe(0);
      expect(ctx.text()).toContain('NO VERIFICADO');
      expect(ctx.text()).toContain('no se escribe automáticamente');
    } finally {
      HOST_INTEGRATIONS.pop();
    }
  });

  it('copilot (VS Code surface) is verified: `servers` object, `type: "stdio"`, STRING command + args array', () => {
    const cliPath = '/opt/open-sdd/dist/cli.js';
    const host = integrationById('copilot')!;
    const registration = mcpRegistration('copilot', { cliPath });

    expect(registration.verified).toBe(true);
    expect(registration.path).toBe('.vscode/mcp.json');
    expect(host.mcp.docUrl).toBe('https://code.visualstudio.com/docs/copilot/chat/mcp-servers');
    expect(registration.content).toContain('"servers"');

    const parsed = JSON.parse(registration.content) as {
      servers: Record<string, { type: string; command: unknown; args: unknown }>;
    };
    const entry = parsed.servers['open-sdd'];
    expect(entry.type).toBe('stdio');
    // VS Code / Copilot wants a STRING `command` plus an `args` ARRAY.
    expect(typeof entry.command).toBe('string');
    expect(entry.command).toBe('node');
    expect(Array.isArray(entry.args)).toBe(true);
    expect(entry.args).toEqual([cliPath, 'mcp']);
  });

  it('opencode is verified: top-level `mcp` object, `type: "local"`, ARRAY command', () => {
    const cliPath = '/opt/open-sdd/dist/cli.js';
    const host = integrationById('opencode')!;
    const registration = mcpRegistration('opencode', { cliPath });

    expect(registration.verified).toBe(true);
    expect(registration.path).toBe('opencode.json');
    expect(host.mcp.docUrl).toBe('https://opencode.ai/docs/mcp-servers/');
    expect(registration.content).toContain('"mcp"');

    const parsed = JSON.parse(registration.content) as {
      mcp: Record<string, { type: string; command: unknown }>;
    };
    const entry = parsed.mcp['open-sdd'];
    expect(entry.type).toBe('local');
    // OpenCode's `command` is an ARRAY, unlike the `mcpServers` family.
    expect(Array.isArray(entry.command)).toBe(true);
    expect(entry.command).toEqual(['node', cliPath, 'mcp']);
  });

  it('zed is verified with a STRING `command` and a sibling `args` array, not the nested `{ path, args }` guess', () => {
    const cliPath = '/opt/open-sdd/dist/cli.js';
    const host = integrationById('zed')!;
    const registration = mcpRegistration('zed', { cliPath });

    expect(registration.verified).toBe(true);
    expect(host.mcp.docUrl).toBe('https://zed.dev/docs/assistant/model-context-protocol');
    expect(registration.content).toContain('"context_servers"');

    const parsed = JSON.parse(registration.content) as {
      context_servers: Record<string, { command: unknown; args: unknown }>;
    };
    const entry = parsed.context_servers['open-sdd'];
    // The correction: `command` is a STRING and `args` is its SIBLING array. The earlier guess
    // nested `{ path, args }` inside `command`, which the docs do not support.
    expect(typeof entry.command).toBe('string');
    expect(entry.command).toBe('node');
    expect(entry.command).not.toHaveProperty('path');
    expect(Array.isArray(entry.args)).toBe(true);
    expect(entry.args).toEqual([cliPath, 'mcp']);
  });

  it('antigravity is verified: `mcpServers` object with STRING command + args array, per the docs Markdown sibling', () => {
    const cliPath = '/opt/open-sdd/dist/cli.js';
    const host = integrationById('antigravity')!;
    const registration = mcpRegistration('antigravity', { cliPath });

    expect(registration.verified).toBe(true);
    expect(registration.path).toBe('.agents/mcp_config.json');
    expect(host.mcp.docUrl).toBe('https://antigravity.google/docs/mcp');
    expect(registration.content).toContain('"mcpServers"');

    const parsed = JSON.parse(registration.content) as {
      mcpServers: Record<string, { command: unknown; args: unknown }>;
    };
    const entry = parsed.mcpServers['open-sdd'];
    expect(typeof entry.command).toBe('string');
    expect(entry.command).toBe('node');
    expect(Array.isArray(entry.args)).toBe(true);
    expect(entry.args).toEqual([cliPath, 'mcp']);

    // Both documented paths are recorded, and the note names the field a remote entry would use.
    expect(host.mcp.configPaths.linux).toBe('.agents/mcp_config.json');
    const notes = host.notes.join(' ');
    expect(notes).toContain('~/.gemini/config/mcp_config.json');
    expect(notes).toContain('.agents/mcp_config.json');
    expect(notes).toContain('serverUrl');
    expect(notes).toContain('docs/mcp.md');
  });

  it('every host in the shipped matrix is verified, or is a declared fork that names the datum it lacks', () => {
    // La regla no se relaja: un anfitrion sin verificar solo se admite si es un FORK declarado de una
    // fila verificada y dice exactamente que dato le falta. «No lo sabemos» sin mas sigue siendo rojo.
    const unverified = HOST_INTEGRATIONS.filter((host) => !host.mcp.verified);
    expect(unverified.map((host) => host.id)).toEqual([]);
    for (const host of unverified) {
      expect(host.forkOf, `${host.id}: sin verificar y sin declarar su padre`).toBeTruthy();
      const parent = integrationById(host.forkOf as string);
      expect(parent, `${host.id}: el padre ${host.forkOf} no existe`).toBeDefined();
      expect(parent?.mcp.verified, `${host.id}: el padre ${host.forkOf} no esta verificado`).toBe(true);
      // Un rechazo accionable nombra el dato que lo convertiria en verificable.
      expect(host.notes.join('\n'), `${host.id}: no nombra el dato que falta`).toMatch(/DATO QUE FALTA/);
      expect(host.notes.join('\n'), `${host.id}: el dato que falta no esta concretado`).toMatch(/extension id|identificador de la extension/i);
    }
    // A docUrl, when present, is the page a reader can re-fetch; it must be a real https URL.
    for (const host of HOST_INTEGRATIONS.filter((entry) => entry.mcp.docUrl !== undefined)) {
      expect(host.mcp.docUrl, `docUrl of ${host.id}`).toMatch(/^https:\/\/\S+$/);
    }
  });

  it('an unknown id never yields a plausible-looking snippet', () => {
    const registration = mcpRegistration('nope', { cliPath: '/opt/cli.js' });
    expect(registration.path).toBeNull();
    expect(registration.content).toBe('');
    expect(registration.verified).toBe(false);
  });
});

describe('integrations --write — merge, never clobber, and idempotent', () => {
  const fixtureConfig = {
    mcpServers: {
      'other-tool': { command: 'uvx', args: ['other'] },
    },
    unrelatedTop: { keep: true },
  };

  it('merges into an EXISTING config and leaves unrelated keys untouched', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });
    await writeFile(path.join(dir, '.cursor', 'mcp.json'), `${JSON.stringify(fixtureConfig, null, 2)}\n`, 'utf8');

    const ctx = makeIO();
    expect(await handleIntegrateCommand(['cursor', '--write', '--json'], ctx.io, dir)).toBe(0);

    const output = JSON.parse(ctx.text()) as {
      artifacts: { kind: string; action: string }[];
      outcome: { written: string[]; kept: string[] };
    };
    expect(output.artifacts.find((artifact) => artifact.kind === 'mcp-config')?.action).toBe('update');
    expect(output.outcome.written).toContain('.cursor/mcp.json');

    const merged = (await readJson(path.join(dir, '.cursor', 'mcp.json'))) as {
      mcpServers: Record<string, unknown>;
      unrelatedTop: { keep: boolean };
    };
    // The untouched keys survive, byte for byte in meaning.
    expect(merged.unrelatedTop).toEqual({ keep: true });
    expect(merged.mcpServers['other-tool']).toEqual({ command: 'uvx', args: ['other'] });
    expect(merged.mcpServers['open-sdd']).toEqual({
      command: 'node',
      args: [expect.stringContaining('cli.js'), 'mcp'],
    });
  });

  it('a newly verified project-scoped host (opencode) is written and merges its `mcp` object', async () => {
    const dir = await makeRoot();
    await writeFile(
      path.join(dir, 'opencode.json'),
      `${JSON.stringify(
        { mcp: { 'other-tool': { type: 'local', command: ['uvx', 'other'] } }, theme: 'dark' },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const ctx = makeIO();
    expect(await handleIntegrateCommand(['opencode', '--write', '--json'], ctx.io, dir)).toBe(0);
    const output = JSON.parse(ctx.text()) as {
      artifacts: { kind: string; action: string }[];
      outcome: { written: string[] };
    };
    expect(output.artifacts.find((artifact) => artifact.kind === 'mcp-config')?.action).toBe('update');
    expect(output.outcome.written).toContain('opencode.json');

    const merged = (await readJson(path.join(dir, 'opencode.json'))) as {
      mcp: Record<string, unknown>;
      theme: string;
    };
    // Unrelated keys survive; only our entry inside `mcp` is added.
    expect(merged.theme).toBe('dark');
    expect(merged.mcp['other-tool']).toEqual({ type: 'local', command: ['uvx', 'other'] });
    expect(merged.mcp['open-sdd']).toEqual({
      type: 'local',
      command: ['node', expect.stringContaining('cli.js'), 'mcp'],
    });
  });

  it('a second --write reports keep for the MCP config (idempotent)', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });

    expect(await handleIntegrateCommand(['cursor', '--write', '--json'], makeIO().io, dir)).toBe(0);
    const before = await readFile(path.join(dir, '.cursor', 'mcp.json'), 'utf8');

    const ctx = makeIO();
    expect(await handleIntegrateCommand(['cursor', '--write', '--json'], ctx.io, dir)).toBe(0);
    const output = JSON.parse(ctx.text()) as {
      artifacts: { kind: string; action: string }[];
      outcome: { kept: string[] };
    };
    expect(output.artifacts.find((artifact) => artifact.kind === 'mcp-config')?.action).toBe('keep');
    expect(output.outcome.kept).toContain('.cursor/mcp.json');
    expect(await readFile(path.join(dir, '.cursor', 'mcp.json'), 'utf8')).toBe(before);
  });

  it('a config that does not parse is refused, not rewritten', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });
    const broken = '{ "mcpServers": { // comment\n';
    await writeFile(path.join(dir, '.cursor', 'mcp.json'), broken, 'utf8');

    const ctx = makeIO();
    expect(await handleIntegrateCommand(['cursor', '--write', '--json'], ctx.io, dir)).toBe(0);
    const output = JSON.parse(ctx.text()) as { artifacts: { kind: string; action: string }[] };
    expect(output.artifacts.find((artifact) => artifact.kind === 'mcp-config')?.action).toBe('keep');
    expect(await readFile(path.join(dir, '.cursor', 'mcp.json'), 'utf8')).toBe(broken);
  });

  it('--dry-run never writes even when --write is also present', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });

    expect(await handleIntegrateCommand(['cursor', '--write', '--dry-run'], makeIO().io, dir)).toBe(0);
    expect(await exists(path.join(dir, '.cursor', 'mcp.json'))).toBe(false);
  });
});


describe('Continue.dev — a YAML block the tool OWNS, never a YAML file it parses', () => {
  it('emits the documented LIST shape, not a map, and in the file Continue reads', () => {
    const registration = mcpRegistration('continue-dev', { cliPath: '/opt/cli.js' });
    expect(registration.verified).toBe(true);
    expect(registration.format).toBe('yaml');
    expect(registration.path).toBe('.continue/mcpServers/open-sdd.yaml');
    // `mcpServers` es una LISTA aqui: `- name:` y no `{ "name": {} }`. Es la diferencia que hace que
    // copiar el snippet de otro anfitrion no funcione.
    expect(registration.content).toContain('mcpServers:\n  - name: open-sdd');
    expect(registration.content).toContain('    type: stdio');
    expect(registration.content).toContain('    command: node');
    expect(registration.content).toContain('      - /opt/cli.js');
  });

  it('creates it, keeps it byte-identical, and CONSERVES a file whose content is not ours', async () => {
    const dir = await makeRoot();
    const host = integrationById('continue-dev')!;

    const created = await mergeMcpConfig(host, '/opt/cli.js', dir);
    expect(created.action).toBe('create');

    await mkdir(path.join(dir, '.continue', 'mcpServers'), { recursive: true });
    await writeFile(path.join(dir, '.continue', 'mcpServers', 'open-sdd.yaml'), created.content, 'utf8');
    const again = await mergeMcpConfig(host, '/opt/cli.js', dir);
    expect(again.action).toBe('keep');
    expect(again.reason).toContain('byte a byte');

    // Un fichero con NUESTRO nombre y contenido de otra persona no se toca: no hay parser YAML aqui,
    // y por tanto ningun YAML que no hayamos escrito puede ser reescrito por nosotros.
    await writeFile(path.join(dir, '.continue', 'mcpServers', 'open-sdd.yaml'), 'name: mio\n', 'utf8');
    const foreign = await mergeMcpConfig(host, '/opt/cli.js', dir);
    expect(foreign.action).toBe('keep');
    expect(foreign.reason).toContain('CONSERVA');
    expect(await readFile(path.join(dir, '.continue', 'mcpServers', 'open-sdd.yaml'), 'utf8')).toBe('name: mio\n');
  });
});

describe('cross-tool skills — ONE neutral tree for every host that reads `.agents/skills/`', () => {
  const manifestPath = path.join(repoRoot, 'tools/open-sdd/templates/manifests/agents-skills.json');
  const sharedTree = path.join(repoRoot, 'tools/open-sdd/templates/agents/_shared/skills');

  it('the shared tree ships the 21 skills, and the manifest installs IT rather than a per-host copy', () => {
    const skills = readdirSync(sharedTree, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    expect(skills.length).toBe(21);
    for (const skill of skills) {
      expect(existsSync(path.join(sharedTree, skill.name, 'SKILL.md')), `${skill.name} sin SKILL.md`).toBe(true);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      artifacts: { id: string; source: { fromDir?: string }; when: { agent: string } }[];
    };
    const artefact = manifest.artifacts.find((item) => item.id === 'skills');
    // Si alguien vuelve a apuntar el manifiesto a `{{AGENT}}`, cada anfitrion nuevo volveria a exigir
    // su propia copia de 21 ficheros: exactamente la duplicacion que este arbol existe para borrar.
    expect(artefact?.source.fromDir).toBe('templates/agents/_shared/skills');
    expect(manifest.artifacts.every((item) => item.when.agent === 'agents-skills')).toBe(true);
    expect(manifest.artifacts.some((item) => JSON.stringify(item.source).includes('{{AGENT}}'))).toBe(false);
  });

  it('every host mapped to the shared installer documents reading `.agents/skills/`', () => {
    const source = readFileSync(path.join(repoRoot, 'tools/open-sdd/src/cli/commands/init.ts'), 'utf8');
    const start = source.indexOf('const HOST_SKILL_AGENT');
    const block = source.slice(start, source.indexOf('};', start));
    // Las claves del mapa van entrecomilladas o no segun sean identificadores validos: se aceptan las dos.
    const mapped = [...block.matchAll(/^\s*'?([a-z0-9-]+)'?:\s*'agents-skills',/gm)].map((match) => match[1]);
    expect(mapped.length).toBeGreaterThanOrEqual(10);

    // Un mapeo sin evidencia seria escribir en una ruta que el anfitrion puede no leer.
    for (const id of mapped) {
      const host = HOST_INTEGRATIONS.find((entry) => entry.id === id);
      expect(host, `${id}: mapeado al arbol compartido sin fila en la matriz`).toBeDefined();
      expect(host?.notes.join('\n'), `${id}: no documenta leer .agents/skills/`).toContain('.agents/skills');
    }
    // Y los que NO lo documentan no estan mapeados: Trae lo tiene APAGADO por defecto.
    expect(mapped).not.toContain('trae');
    expect(mapped).not.toContain('qoder');
  });


  it('the four hosts that do NOT read the cross-tool path get their own manifest, never their own tree', async () => {
    const manifestsDir = path.join(repoRoot, 'tools/open-sdd', 'templates', 'manifests');
    const own = ['trae-skills', 'qoder-skills', 'zcode-skills', 'codebuddy-skills'];
    for (const id of own) {
      const manifest = JSON.parse(readFileSync(path.join(manifestsDir, `${id}.json`), 'utf8')) as {
        artifacts: { id: string; source: { fromDir?: string }; when: { agent: string } }[];
      };
      expect(manifest.artifacts.find((item) => item.id === 'skills')?.source.fromDir).toBe(
        'templates/agents/_shared/skills',
      );
      // Un manifiesto propio NO puede traer un arbol propio: eso reintroduciria la duplicacion.
      expect(existsSync(path.join(repoRoot, 'tools/open-sdd', 'templates', 'agents', id))).toBe(false);
    }

    // Y funciona de punta a punta, cada uno en SU layout documentado.
    const dir = await makeRoot();
    const ctx = makeIO();
    expect(await handleIntegrateCommand(['trae', '--write'], ctx.io, dir)).toBe(0);
    expect(readdirSync(path.join(dir, '.trae', 'skills'), { withFileTypes: true }).length).toBe(21);
    expect(existsSync(path.join(dir, '.trae', 'mcp.json'))).toBe(true);
  });

  it('installing for one of them writes the shared tree AND that host own MCP config', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();
    expect(await handleIntegrateCommand(['roo-code', '--write'], ctx.io, dir)).toBe(0);

    const installed = readdirSync(path.join(dir, '.agents', 'skills'), { withFileTypes: true });
    expect(installed.length).toBe(21);
    expect(existsSync(path.join(dir, '.agents', 'skills', 'sdd-brownfield', 'SKILL.md'))).toBe(true);
    expect(existsSync(path.join(dir, 'AGENTS.md'))).toBe(true);
    // El MCP del anfitrion va a SU fichero, no al compartido.
    expect(existsSync(path.join(dir, '.roo', 'mcp.json'))).toBe(true);
    // Y el informe dice donde escribe y por que, en vez de anunciar `.roo/skills/` y escribir otro sitio.
    expect(ctx.text()).toContain('la ruta transversal que Roo Code lee además de');
  });
});
