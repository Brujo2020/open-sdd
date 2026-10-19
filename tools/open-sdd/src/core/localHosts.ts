/**
 * Private host overlay — how a team wires a host that must not be published.
 *
 * ── The rule this file exists to make enforceable ───────────────────────────────────────────────
 * An internal fork, or a vendor package with no public documentation, is a real host with real
 * conventions. Those conventions belong to the team that owns the product, not to an MIT repository, so
 * the tool supports such a host **without ever naming it in public**: the rows live in a file OUTSIDE
 * the repository, and the shipped matrix never learns about them.
 *
 * The strongest guarantee available is structural, not procedural: the loader reads the environment
 * variable `OPEN_SDD_LOCAL_HOSTS` or `$XDG_CONFIG_HOME|~/.config/open-sdd/local-hosts.json`, and
 * **never a path inside the working tree**. A private row therefore cannot be committed by accident,
 * because the tool has no code path that would read one from the repository at all.
 *
 * ── Where it is wired, and why there ────────────────────────────────────────────────────────────
 * Only the CLI entry point (`cli.ts`) opts in. `commandTemplates.ts` and `integrations.ts` stay pure,
 * so a test that imports them sees the shipped matrix and nothing else — a developer's private file can
 * never make a suite pass or fail.
 *
 * ── The verdicts it cannot fake ─────────────────────────────────────────────────────────────────
 * A local row is **refused by default**. Saying `"verified": true` requires `sourceArtifact`: the
 * artifact the owning team supplied is the only evidence a private host can have, and a row that
 * claims it without naming it is exactly the plausible-looking guess this project refuses. A local row
 * may also never shadow a built-in one: the public row wins and the collision is reported, because a
 * local file must not be able to rewrite what the world can read.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  HOST_COMMAND_TEMPLATES,
  type CommandTemplateId,
  type HostCommandConvention,
} from './commandTemplates.js';
import {
  HOST_INTEGRATIONS,
  MCP_SNIPPETS,
  type HostIntegration,
  type SnippetFormat,
} from './integrations.js';
import { registerLocalAgent, type AgentDefinition } from '../agents/registry.js';
import { mapAgentToHost } from './commandTemplates.js';

export const LOCAL_HOSTS_ENV = 'OPEN_SDD_LOCAL_HOSTS';

/** `$XDG_CONFIG_HOME/open-sdd/local-hosts.json`, or `%APPDATA%` on Windows, or `~/.config`. */
export const defaultLocalHostsPath = (env: NodeJS.ProcessEnv = process.env): string => {
  const base =
    env.XDG_CONFIG_HOME ??
    (process.platform === 'win32' && env.APPDATA ? env.APPDATA : path.join(homedir(), '.config'));
  return path.join(base, 'open-sdd', 'local-hosts.json');
};

/** One row as the file declares it. Everything is optional except what the row must justify. */
export interface LocalHostRow {
  id?: unknown;
  label?: unknown;
  /** Command-template surface: the directory the host reads, or absent when it has none. */
  dir?: unknown;
  fileName?: unknown;
  invocation?: unknown;
  argumentSyntax?: unknown;
  sourceArtifact?: unknown;
  evidence?: unknown;
  forkOf?: unknown;
  verified?: unknown;
  skills?: { layout?: unknown; mode?: unknown };
  mcp?: {
    configPaths?: unknown;
    snippetRef?: unknown;
    snippetFormat?: unknown;
    verified?: unknown;
    docUrl?: unknown;
    notes?: unknown;
  };
  /** The agent row, so `init --agent <id>` can install the workflow surface like any shipped host. */
  agent?: {
    commandsDir?: unknown;
    agentDir?: unknown;
    docFile?: unknown;
    aliasFlags?: unknown;
    description?: unknown;
  };
  detect?: unknown;
  notes?: unknown;
}

export interface LocalHostsReport {
  path: string | null;
  loaded: string[];
  skipped: { id: string; reason: string }[];
  issues: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** `null` means "this host documents no placeholder"; absent means the same, and both render prose. */
const argumentSyntaxOf = (value: unknown): string | null => str(value);

const toPosix = (value: string): string => value.split(path.sep).join('/');

/** A repo-relative directory, never escaping it: the installer already checks, this checks earlier. */
const safeDir = (value: string): boolean =>
  value.startsWith('.') && !value.includes('..') && !path.isAbsolute(value);

export interface ValidatedLocalHost {
  command?: HostCommandConvention;
  integration?: HostIntegration;
  agent?: AgentDefinition;
}

/**
 * Turn one declared row into the matrix rows it describes, or say why it cannot.
 *
 * The function returns a reason instead of throwing: a private file that a team maintains by hand must
 * degrade into a named skip, never into a CLI that cannot start.
 */
export const validateLocalHost = (
  row: LocalHostRow,
  taken: Set<string>,
): { ok: true; host: ValidatedLocalHost; id: string } | { ok: false; id: string; reason: string } => {
  const id = str(row.id);
  if (!id) return { ok: false, id: '(sin id)', reason: 'la fila no declara `id`' };
  if (!/^[a-z0-9-]+$/.test(id)) {
    return { ok: false, id, reason: 'el `id` solo admite minusculas, digitos y guiones (es un id de matriz)' };
  }
  if (taken.has(id)) {
    // La fila publica gana: un fichero local no puede reescribir lo que el mundo puede leer.
    return { ok: false, id, reason: 'ese id ya existe en la matriz publica: la fila publicada gana y la local se descarta' };
  }
  const label = str(row.label) ?? id;
  const verified = row.verified === true;
  const sourceArtifact = str(row.sourceArtifact);
  if (verified && !sourceArtifact) {
    return {
      ok: false,
      id,
      reason:
        'declara `verified: true` sin `sourceArtifact`: el artefacto que aporta el equipo dueño es la unica evidencia que un anfitrion privado puede tener, y nombrarlo es obligatorio',
    };
  }

  const host: ValidatedLocalHost = {};

  const dir = str(row.dir);
  if (dir !== null) {
    if (!safeDir(dir)) {
      return { ok: false, id, reason: '`dir` tiene que ser una ruta relativa que empiece por punto y no salga del repositorio' };
    }
    const fileName = str(row.fileName) ?? `sdd-<id>.md`;
    const invocation = str(row.invocation) ?? `/sdd-<id>`;
    host.command = {
      id,
      label,
      dir: toPosix(dir),
      fileName: (templateId: CommandTemplateId) => fileName.split('<id>').join(templateId),
      format: 'markdown',
      invocation: (templateId: CommandTemplateId) => invocation.split('<id>').join(templateId),
      argumentSyntax: argumentSyntaxOf(row.argumentSyntax),
      argumentEvidence: str(row.evidence) ?? `declarado por el equipo dueño del anfitrion (${sourceArtifact ?? 'sin artefacto citado'})`,
      sourceArtifact: sourceArtifact ?? undefined,
      ...(str(row.forkOf) ? { forkOf: str(row.forkOf) as string } : {}),
      verified,
      evidence:
        str(row.evidence) ??
        `declarado en el overlay local: la evidencia la custodia el equipo dueño (${sourceArtifact ?? 'sin artefacto citado'})`,
    } as HostCommandConvention;
  }

  const mcp = isRecord(row.mcp) ? row.mcp : null;
  if (mcp) {
    const snippetRef = str(mcp.snippetRef) ?? 'mcpServers';
    const snippet = MCP_SNIPPETS[snippetRef];
    if (!snippet) {
      return {
        ok: false,
        id,
        reason: `\`mcp.snippetRef\` desconocido: ${snippetRef}. Conocidos: ${Object.keys(MCP_SNIPPETS).sort().join(', ')}`,
      };
    }
    const paths = isRecord(mcp.configPaths) ? mcp.configPaths : {};
    const configPaths: Record<string, string> = {};
    for (const os of ['linux', 'darwin', 'win32'] as const) {
      const value = str(paths[os]);
      if (value) configPaths[os] = toPosix(value);
    }
    if (Object.keys(configPaths).length === 0) {
      return { ok: false, id, reason: '`mcp.configPaths` no declara ninguna ruta por sistema operativo' };
    }
    const notes = Array.isArray(mcp.notes) ? mcp.notes.filter((n): n is string => typeof n === 'string') : [];
    const mcpVerified = mcp.verified === true;
    if (mcpVerified && !sourceArtifact) {
      return { ok: false, id, reason: '`mcp.verified: true` exige `sourceArtifact` en la misma fila' };
    }
    host.integration = {
      id,
      label,
      skills: {
        layout: str(row.skills?.layout) ?? '(sin layout de skills declarado: el anfitrion no lo documenta)',
        mode: (str(row.skills?.mode) as 'skills' | 'commands' | 'prompt-file') ?? 'prompt-file',
      },
      invocation: str(row.invocation) ?? '/sdd-<id>',
      mcp: {
        configPaths,
        snippetFormat: (str(mcp.snippetFormat) as SnippetFormat) ?? 'json',
        snippet,
        verified: mcpVerified,
        ...(str(mcp.docUrl) ? { docUrl: str(mcp.docUrl) as string } : {}),
      },
      detect: Array.isArray(row.detect) ? row.detect.filter((d): d is string => typeof d === 'string') : [],
      notes:
        notes.length > 0
          ? notes
          : [
              `Anfitrion PRIVADO cargado desde el overlay local (${LOCAL_HOSTS_ENV} o el fichero de usuario): no aparece en la matriz publica y su evidencia la custodia el equipo dueño${sourceArtifact ? ` (${sourceArtifact})` : ''}.`,
            ],
      ...(str(row.forkOf) ? { forkOf: str(row.forkOf) as string } : {}),
    } as HostIntegration;
  }

  const agent = isRecord(row.agent) ? row.agent : null;
  if (agent) {
    const commandsDir = str(agent.commandsDir) ?? dir;
    if (commandsDir === null || !safeDir(commandsDir)) {
      return { ok: false, id, reason: '`agent.commandsDir` (o `dir`) tiene que ser una ruta relativa que empiece por punto' };
    }
    const flags = Array.isArray(agent.aliasFlags)
      ? agent.aliasFlags.filter((f): f is string => typeof f === 'string')
      : [`--${id}`];
    host.agent = {
      label,
      description:
        str(agent.description) ??
        `Anfitrion PRIVADO instalado desde el overlay local: sus plantillas y su evidencia los custodia el equipo dueño.`,
      aliasFlags: flags,
      layout: {
        commandsDir: toPosix(commandsDir),
        agentDir: toPosix(str(agent.agentDir) ?? (commandsDir.includes('/') ? commandsDir.slice(0, commandsDir.lastIndexOf('/')) : '.')),
        docFile: str(agent.docFile) ?? 'AGENTS.md',
      },
      commands: {
        spec: `\`${(str(row.invocation) ?? '/sdd-<id>').split('<id>').join('specify')} <what-to-build>\``,
        steering: `\`${(str(row.invocation) ?? '/sdd-<id>').split('<id>').join('constitution')}\``,
        steeringCustom: `\`${(str(row.invocation) ?? '/sdd-<id>').split('<id>').join('constitution')} <amendment>\``,
      },
    };
  }

  if (!host.command && !host.integration && !host.agent) {
    return {
      ok: false,
      id,
      reason: 'la fila no declara ni `dir` (plantillas de comando), ni `mcp`, ni `agent`: no hay nada que cargar',
    };
  }
  return { ok: true, host, id };
};

/** Parse the file's bytes into validated rows. Never throws: every problem becomes an `issue`. */
export const parseLocalHosts = (raw: string): { rows: LocalHostRow[]; issues: string[] } => {
  const issues: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { rows: [], issues: [`el fichero no parsea como JSON (${(error as Error).message}): se ignora entero`] };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.hosts)) {
    return { rows: [], issues: ['el fichero no tiene una lista `hosts` en la raiz: se ignora entero'] };
  }
  return { rows: parsed.hosts.filter(isRecord).map((entry) => entry as LocalHostRow), issues };
};

/** Append the validated rows to the shipped matrices and report what happened. */
export const installLocalHosts = (rows: LocalHostRow[]): LocalHostsReport => {
  const report: LocalHostsReport = { path: null, loaded: [], skipped: [], issues: [] };
  const taken = new Set<string>([
    ...HOST_COMMAND_TEMPLATES.map((host) => host.id),
    ...HOST_INTEGRATIONS.map((host) => host.id),
  ]);

  for (const row of rows) {
    const result = validateLocalHost(row, taken);
    if (!result.ok) {
      report.skipped.push({ id: result.id, reason: result.reason });
      continue;
    }
    if (result.host.command) HOST_COMMAND_TEMPLATES.push(result.host.command);
    if (result.host.integration) HOST_INTEGRATIONS.push(result.host.integration);
    if (result.host.agent) {
      // El agente y su mapa: sin las dos cosas `init --agent <id>` no encontraria el host al que
      // pertenece, y el overlay seria una fila bonita que no instala nada.
      const registered = registerLocalAgent(result.id, result.host.agent);
      mapAgentToHost(result.id, result.id);
      if (!registered) {
        report.skipped.push({ id: result.id, reason: 'ya existe un agente con ese id: el publicado gana' });
        continue;
      }
    }
    taken.add(result.id);
    report.loaded.push(result.id);
  }
  return report;
};

/**
 * Read the overlay and install it. Called ONCE, by the CLI entry point.
 *
 * A missing file is the normal case and is not an issue. A broken file is reported and skipped, so the
 * CLI keeps working: the private overlay must never be able to break the public tool.
 */
export const loadLocalHosts = (options: { path?: string; env?: NodeJS.ProcessEnv } = {}): LocalHostsReport => {
  const env = options.env ?? process.env;
  const explicit = options.path ?? str(env[LOCAL_HOSTS_ENV]);
  const target = explicit ?? defaultLocalHostsPath(env);

  let raw: string;
  try {
    raw = readFileSync(target, 'utf8');
  } catch {
    if (explicit) {
      return { path: target, loaded: [], skipped: [], issues: [`${LOCAL_HOSTS_ENV} apunta a un fichero que no se puede leer: ${target}`] };
    }
    return { path: null, loaded: [], skipped: [], issues: [] };
  }

  const { rows, issues } = parseLocalHosts(raw);
  const report = installLocalHosts(rows);
  return { ...report, path: target, issues };
};

/** One line per outcome, for the CLI to print. Empty when there is nothing to say. */
export const renderLocalHostsReport = (report: LocalHostsReport): string[] => {
  const lines: string[] = [];
  if (report.issues.length > 0 || report.skipped.length > 0) {
    lines.push(`overlay local (${report.path ?? 'sin fichero'}):`);
    for (const issue of report.issues) lines.push(`  ! ${issue}`);
    for (const skip of report.skipped) lines.push(`  ! ${skip.id}: ${skip.reason}`);
  }
  return lines;
};
