/**
 * The integration matrix: ONE machine-checked source of truth per host.
 *
 * ── Why this file exists ────────────────────────────────────────────────────────────────────────
 * spec-kit's strongest asset is a documented reference with one key per supported agent AND the
 * invocation syntax each host uses, because slash-command syntax differs per host. open-sdd already
 * has more engine (MCP server, executable gates, delta specs, the constitution pivot, the audit
 * bundle) but its adoption surface was prose. This module turns that surface into data: the skills
 * layout, the exact in-chat invocation, the MCP configuration file per OS, the snippet that
 * registers our stdio server, the markers that prove a host is present, and the notes a `--write`
 * needs to be idempotent.
 *
 * ── The rule that is not negotiable ─────────────────────────────────────────────────────────────
 * `verified` is an EVIDENCE field, not a courtesy. It is `true` only for the shapes this project is
 * confident about, and the `notes` say how we know. Anything unconfirmed is `verified: false` and
 * the CLI prints it as **NO VERIFICADA** instead of presenting it as fact; `--write` refuses to
 * touch an unverified host config rather than guessing at a file it might corrupt. A snippet that
 * looks right and is wrong is worse than an acknowledged gap — the same rule the gates follow.
 *
 * ── Config shapes this matrix encodes ───────────────────────────────────────────────────────────
 *   • JSON with a top-level `mcpServers` object (Claude Code, Cursor, Windsurf, Cline, Gemini CLI).
 *   • TOML with a `[mcp_servers.<name>]` table (Codex).
 *   • VS Code / GitHub Copilot: a `servers` object with `type: "stdio"`, a STRING `command` and an
 *     `args` array, in `.vscode/mcp.json` (verified against the VS Code docs). The Copilot CLI is a
 *     SEPARATE surface — `~/.copilot/mcp-config.json` with the `mcpServers` shape — documented as an
 *     alternative rather than pretending one entry serves both.
 *   • OpenCode: a top-level `mcp` object with `type: "local"` and an ARRAY `command`
 *     (`["node", "<cli>", "mcp"]`) in `opencode.json` (verified against the OpenCode docs).
 *   • Zed: `context_servers` in `settings.json` with a STRING `command` and a sibling `args` array
 *     (verified against the Zed docs; an earlier guess nested `{ path, args }` inside `command`).
 *   • Antigravity: the two config PATHS are verified (`~/.gemini/config/mcp_config.json` global and
 *     `.agents/mcp_config.json` workspace) but the docs page is JS-rendered and did not yield the
 *     inner entry shape, so the snippet stays `verified: false`.
 */

import { stat } from 'node:fs/promises';
import path from 'node:path';

export type SnippetFormat = 'json' | 'toml';

/** The name our server registers under in every host config. */
export const MCP_SERVER_NAME = 'open-sdd';

export interface HostIntegration {
  /** 'claude-code' | 'cursor' | 'copilot' | 'codex' | 'gemini-cli' | 'windsurf' | 'opencode' | 'antigravity' | 'zed' | 'cline' */
  id: string;
  label: string;
  /** How the host discovers our skills/templates, and where they are installed. */
  skills: { layout: string; mode: 'skills' | 'commands' | 'prompt-file' };
  /** How the user invokes a workflow in that host's chat: the exact syntax, e.g. '/sdd-brownfield'. */
  invocation: string;
  /** The host's MCP configuration: file path(s) per OS and the exact snippet to register our stdio server. */
  mcp: {
    configPaths: { linux?: string; darwin?: string; win32?: string };
    snippetFormat: SnippetFormat;
    snippet: (cliPath: string) => string;
    verified: boolean;
    /** The host's own documentation page for the shape above, so a reader can re-check it. */
    docUrl?: string;
  };
  /** How we know the host is present: files/directories that exist. */
  detect: string[];
  /** Where the host's own config lives so `--write` can be idempotent. */
  notes: string[];
}

// ---------------------------------------------------------------------------------------------
// Snippet builders — the exact bytes that go into the host's own file.
// ---------------------------------------------------------------------------------------------

const jsonDoc = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** TOML basic string: backslashes and quotes escaped, because a Windows path is full of both. */
const tomlString = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** `{"mcpServers": {"open-sdd": {"command": "node", "args": ["<cli>", "mcp"]}}}` */
const mcpServersSnippet = (cliPath: string): string =>
  jsonDoc({ mcpServers: { [MCP_SERVER_NAME]: { command: 'node', args: [cliPath, 'mcp'] } } });

/** VS Code's `.vscode/mcp.json`: a `servers` object whose entries declare `type: "stdio"`. */
const vscodeServersSnippet = (cliPath: string): string =>
  jsonDoc({ servers: { [MCP_SERVER_NAME]: { type: 'stdio', command: 'node', args: [cliPath, 'mcp'] } } });

/** OpenCode's `opencode.json`: an `mcp` object whose entries declare `type: "local"` and an ARRAY `command`. */
const opencodeSnippet = (cliPath: string): string =>
  jsonDoc({
    $schema: 'https://opencode.ai/config.json',
    mcp: { [MCP_SERVER_NAME]: { type: 'local', command: ['node', cliPath, 'mcp'] } },
  });

/** Zed's `context_servers` entry: STRING `command` plus a sibling `args` array (not `{ path, args }`). */
const zedSnippet = (cliPath: string): string =>
  jsonDoc({
    context_servers: { [MCP_SERVER_NAME]: { command: 'node', args: [cliPath, 'mcp'], env: {} } },
  });

/** Codex's `config.toml`. */
const codexSnippet = (cliPath: string): string =>
  [
    `[mcp_servers.${MCP_SERVER_NAME}]`,
    'command = "node"',
    `args = [${tomlString(cliPath)}, "mcp"]`,
    '',
  ].join('\n');

const VERIFIED_JSON_MCP_SERVERS =
  'Forma VERIFICADA: objeto JSON de primer nivel `mcpServers` con una entrada por servidor, `command` + `args` para stdio. Es la forma documentada de este anfitrión y la que escribe su propio comando de alta.';

// Documentation pages the snippets above were checked against. A `docUrl` is EVIDENCE: it is the
// page a reader (or a future session) can fetch to re-confirm the exact key/shape, so it is set only
// where the shape was actually read from that page.
const DOC_COPILOT = 'https://code.visualstudio.com/docs/copilot/chat/mcp-servers';
const DOC_OPENCODE = 'https://opencode.ai/docs/mcp-servers/';
const DOC_ZED = 'https://zed.dev/docs/assistant/model-context-protocol';
const DOC_ANTIGRAVITY = 'https://antigravity.google/docs/mcp';

// ---------------------------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------------------------

export const HOST_INTEGRATIONS: HostIntegration[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    skills: { layout: '.claude/skills/sdd-*/SKILL.md', mode: 'skills' },
    invocation: '/sdd-brownfield',
    mcp: {
      configPaths: { linux: '.mcp.json', darwin: '.mcp.json', win32: '.mcp.json' },
      snippetFormat: 'json',
      snippet: mcpServersSnippet,
      verified: true,
    },
    detect: ['.claude/', '.claude/skills/', 'CLAUDE.md'],
    notes: [
      VERIFIED_JSON_MCP_SERVERS,
      'Ruta de proyecto: `.mcp.json` en la raíz del repositorio. Ámbito de usuario: `~/.claude.json`. El propio CLI del anfitrión escribe la misma entrada: `claude mcp add open-sdd -- node <cli> mcp`.',
      'Instalación de skills: `open-sdd --claude-code-skills --lang <es|en>`.',
    ],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    skills: { layout: '.cursor/skills/sdd-*/SKILL.md', mode: 'skills' },
    invocation: '/sdd-brownfield',
    mcp: {
      configPaths: { linux: '.cursor/mcp.json', darwin: '.cursor/mcp.json', win32: '.cursor/mcp.json' },
      snippetFormat: 'json',
      snippet: mcpServersSnippet,
      verified: true,
    },
    detect: ['.cursor/', '.cursor/mcp.json', '.cursorrules'],
    notes: [
      VERIFIED_JSON_MCP_SERVERS,
      'Ruta de proyecto: `.cursor/mcp.json`; ámbito de usuario: `~/.cursor/mcp.json`. Ambas usan la misma forma.',
      'Instalación de skills: `open-sdd --cursor-skills --lang <es|en>`.',
    ],
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    skills: { layout: '.github/skills/sdd-*/SKILL.md', mode: 'skills' },
    invocation: '/sdd-brownfield',
    mcp: {
      configPaths: { linux: '.vscode/mcp.json', darwin: '.vscode/mcp.json', win32: '.vscode/mcp.json' },
      snippetFormat: 'json',
      snippet: vscodeServersSnippet,
      verified: true,
      docUrl: DOC_COPILOT,
    },
    detect: ['.github/copilot-instructions.md', '.github/skills/', '.vscode/mcp.json'],
    notes: [
      'Forma VERIFICADA (superficie VS Code): objeto `servers` con `type: "stdio"`, `command` como CADENA y `args` como ARRAY, en `.vscode/mcp.json` del espacio de trabajo (el perfil de usuario se abre con `MCP: Open User Configuration`). Documentación: https://code.visualstudio.com/docs/copilot/chat/mcp-servers.',
      'El CLI de Copilot es una superficie DISTINTA y documentada: usa `~/.copilot/mcp-config.json` con el objeto `mcpServers` de la familia Claude/Cursor. No es la misma entrada que la de VS Code: elige la que corresponda a tu superficie en lugar de mezclar formas.',
      'Instalación de skills: `open-sdd --copilot-skills --lang <es|en>`.',
    ],
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    skills: { layout: '.agents/skills/sdd-*/SKILL.md', mode: 'skills' },
    invocation: '$sdd-brownfield',
    mcp: {
      configPaths: {
        linux: '~/.codex/config.toml',
        darwin: '~/.codex/config.toml',
        win32: '%USERPROFILE%\\.codex\\config.toml',
      },
      snippetFormat: 'toml',
      snippet: codexSnippet,
      verified: true,
    },
    detect: ['.codex/', '.agents/skills/', '.codex/config.toml'],
    notes: [
      'Forma VERIFICADA: TOML con una tabla `[mcp_servers.<nombre>]` y las claves `command` + `args` para un servidor stdio; es la forma documentada de `config.toml`.',
      'Ruta: `~/.codex/config.toml` (usuario). El merge es textual: si la tabla `[mcp_servers.open-sdd]` ya existe, se conserva; si no, se AÑADE al final, sin tocar el resto del archivo.',
      'Instalación de skills: `open-sdd --codex-skills --lang <es|en>`. La invocación en Codex es `$sdd-<workflow>`, no `/sdd-<workflow>`.',
    ],
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    skills: { layout: '.gemini/skills/sdd-*/SKILL.md', mode: 'skills' },
    invocation: '/sdd-brownfield',
    mcp: {
      configPaths: { linux: '.gemini/settings.json', darwin: '.gemini/settings.json', win32: '.gemini/settings.json' },
      snippetFormat: 'json',
      snippet: mcpServersSnippet,
      verified: true,
    },
    detect: ['.gemini/', 'GEMINI.md', '.gemini/settings.json'],
    notes: [
      VERIFIED_JSON_MCP_SERVERS,
      'Ruta de proyecto: `.gemini/settings.json` (la de usuario es `~/.gemini/settings.json`); el archivo lleva otras claves de la CLI, así que el merge preserva todo lo que ya haya.',
      'Instalación de skills: `open-sdd --gemini-cli-skills --lang <es|en>`.',
    ],
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    skills: { layout: '.windsurf/skills/sdd-*/SKILL.md', mode: 'skills' },
    invocation: '@sdd-brownfield',
    mcp: {
      configPaths: {
        linux: '~/.codeium/windsurf/mcp_config.json',
        darwin: '~/.codeium/windsurf/mcp_config.json',
        win32: '%USERPROFILE%\\.codeium\\windsurf\\mcp_config.json',
      },
      snippetFormat: 'json',
      snippet: mcpServersSnippet,
      verified: true,
    },
    detect: ['.windsurf/', '.windsurfrules', '.windsurf/skills/'],
    notes: [
      VERIFIED_JSON_MCP_SERVERS,
      'Ruta de usuario: `~/.codeium/windsurf/mcp_config.json`. Windsurf documenta la configuración MCP en ese archivo, no en un archivo de proyecto, así que `--write` escribe fuera del repositorio y lo dice.',
      'La invocación en Windsurf es `@sdd-<workflow>` (mención), no `/sdd-<workflow>`. Instalación: `open-sdd --windsurf-skills --lang <es|en>`.',
    ],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    skills: { layout: '.opencode/skills/sdd-*/SKILL.md', mode: 'skills' },
    invocation: '/sdd-brownfield',
    mcp: {
      configPaths: { linux: 'opencode.json', darwin: 'opencode.json', win32: 'opencode.json' },
      snippetFormat: 'json',
      snippet: opencodeSnippet,
      verified: true,
      docUrl: DOC_OPENCODE,
    },
    detect: ['.opencode/', 'opencode.json', '.opencode/skills/'],
    notes: [
      'Forma VERIFICADA: objeto `mcp` de primer nivel en `opencode.json`, entrada con `type: "local"` y `command` como ARRAY (`["node", "<cli>", "mcp"]`), distinta de la familia `mcpServers`. El `$schema` que emite el snippet es el de la propia documentación. Documentación: https://opencode.ai/docs/mcp-servers/.',
      'Instalación de skills: `open-sdd --opencode-skills --lang <es|en>`.',
    ],
  },
  {
    id: 'antigravity',
    label: 'Google Antigravity',
    skills: { layout: '.agent/skills/sdd-*/SKILL.md', mode: 'skills' },
    invocation: '/sdd-brownfield',
    mcp: {
      // The two documented paths are known; the INNER ENTRY SHAPE is not, so the snippet stays
      // unverified. The workspace path is the one declared here (it is the repo-local one, matching
      // the `.agents/` markers); the global path is recorded in the notes.
      configPaths: {
        linux: '.agents/mcp_config.json',
        darwin: '.agents/mcp_config.json',
        win32: '.agents/mcp_config.json',
      },
      snippetFormat: 'json',
      snippet: mcpServersSnippet,
      verified: false,
      docUrl: DOC_ANTIGRAVITY,
    },
    detect: ['.agent/', '.agent/skills/', '.agent/rules/'],
    notes: [
      'RUTAS VERIFICADAS (contra https://antigravity.google/docs/mcp): global `~/.gemini/config/mcp_config.json` (en Windows `%USERPROFILE%\\.gemini\\config\\mcp_config.json`) y de espacio de trabajo `.agents/mcp_config.json`. La matriz declara la de espacio de trabajo como `configPath`.',
      'FORMA DE LA ENTRADA NO CONFIRMADA: la página oficial se renderiza con JavaScript y su sección "MCP Configuration Structure" no expone la clave ni la estructura en una lectura simple, así que el snippet NO se presenta como un hecho y `--write` NO lo escribe. Para ver la forma exacta que genera el anfitrión, usa el Gestor MCP interactivo (`/mcp` en el prompt) → `View raw config`.',
      'El layout de skills sí está verificado por el instalador de este repositorio: `.agent/skills/sdd-*/SKILL.md` (bandera `--antigravity-skills`).',
    ],
  },
  {
    id: 'zed',
    label: 'Zed',
    skills: { layout: 'AGENTS.md', mode: 'prompt-file' },
    invocation: '@AGENTS.md run the sdd-brownfield workflow',
    mcp: {
      configPaths: {
        linux: '~/.config/zed/settings.json',
        darwin: '~/Library/Application Support/Zed/settings.json',
        win32: '%APPDATA%\\Zed\\settings.json',
      },
      snippetFormat: 'json',
      snippet: zedSnippet,
      verified: true,
      docUrl: DOC_ZED,
    },
    detect: ['.zed/', '.rules', 'AGENTS.md'],
    notes: [
      'Forma VERIFICADA: `context_servers` en el `settings.json` de Zed, con `command` como CADENA y `args` como array HERMANO (`{ "command": "node", "args": [...] }`). Una conjetura anterior anidaba `{ path, args }` dentro de `command`; la documentación la desmiente y el snippet ya no la usa. Documentación: https://zed.dev/docs/assistant/model-context-protocol.',
      'Rutas: `~/.config/zed/settings.json` (macOS/Linux) y `%APPDATA%\\Zed\\settings.json` (Windows); en macOS la ruta real de la app también es `~/Library/Application Support/Zed/settings.json`.',
      'Zed no tiene comandos de barra para skills: se referencia el archivo de reglas con una mención. No hay instalador de skills para Zed en el registro de agentes, así que `--write` solo registra el MCP.',
    ],
  },
  {
    id: 'cline',
    label: 'Cline',
    skills: { layout: '.clinerules/sdd-*.md', mode: 'prompt-file' },
    invocation: '@.clinerules/sdd-brownfield.md',
    mcp: {
      configPaths: {
        linux:
          '~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
        darwin:
          '~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
        win32:
          '%APPDATA%\\Code\\User\\globalStorage\\saoudrizwan.claude-dev\\settings\\cline_mcp_settings.json',
      },
      snippetFormat: 'json',
      snippet: mcpServersSnippet,
      verified: true,
    },
    detect: ['.clinerules/', '.clinerules'],
    notes: [
      VERIFIED_JSON_MCP_SERVERS,
      'Ruta de usuario (extensión de VS Code, id `saoudrizwan.claude-dev`): `cline_mcp_settings.json` dentro de `globalStorage`. Cline admite claves extra por servidor (`disabled`, `autoApprove`); el snippet no las emite porque son opcionales.',
      'Cline no tiene comandos de barra: sus reglas viven en `.clinerules/` y se adjuntan con una mención. No hay instalador de skills para Cline en el registro de agentes, así que `--write` solo registra el MCP.',
    ],
  },
];

// ---------------------------------------------------------------------------------------------
// Lookup, detection and registration
// ---------------------------------------------------------------------------------------------

export const integrationById = (id: string): HostIntegration | undefined =>
  HOST_INTEGRATIONS.find((host) => host.id === id);

const exists = async (p: string): Promise<boolean> => (await stat(p).catch(() => null)) !== null;

export interface IntegrationDetection {
  id: string;
  evidence: string[];
  alternatives: string[];
}

/**
 * Which host is present, with the evidence that says so and the alternatives that were also seen.
 *
 * Evidence is scored by how many markers matched, then by the matrix order (most specific host
 * first), so a repository that happens to carry an `AGENTS.md` next to a real `.cursor/` is
 * reported as Cursor with `AGENTS.md` as an alternative instead of the other way round.
 */
export const detectIntegration = async (cwd: string): Promise<IntegrationDetection | null> => {
  const matches: { id: string; evidence: string[] }[] = [];

  for (const host of HOST_INTEGRATIONS) {
    const evidence: string[] = [];
    for (const marker of host.detect) {
      if (await exists(path.join(cwd, marker))) {
        evidence.push(`${marker} existe`);
      }
    }
    if (evidence.length > 0) matches.push({ id: host.id, evidence });
  }

  if (matches.length === 0) return null;

  const ordered = [...matches].sort(
    (a, b) => b.evidence.length - a.evidence.length || indexOfHost(a.id) - indexOfHost(b.id),
  );
  const chosen = ordered[0];
  return {
    id: chosen.id,
    evidence: chosen.evidence,
    alternatives: ordered.slice(1).map((match) => match.id),
  };
};

const indexOfHost = (id: string): number => HOST_INTEGRATIONS.findIndex((host) => host.id === id);

/**
 * The path we would write for a host, or `null` when the host has no documented path.
 *
 * A path that is identical on every OS (and is not a home-relative one) is project-scoped, and
 * that is the one we return: a repository-local file is the only one `--write` can merge without
 * guessing at a user's home directory layout. Otherwise the path for the running platform wins.
 */
const pickConfigPath = (paths: HostIntegration['mcp']['configPaths']): string | null => {
  const entries = [paths.linux, paths.darwin, paths.win32].filter(
    (entry): entry is string => typeof entry === 'string' && entry.length > 0,
  );
  if (entries.length === 0) return null;

  const homeRelative = (entry: string): boolean => entry.startsWith('~') || entry.startsWith('%');
  if (new Set(entries).size === 1 && !homeRelative(entries[0])) return entries[0];

  const platform = process.platform as 'linux' | 'darwin' | 'win32';
  return paths[platform] ?? entries[0];
};

export interface McpRegistration {
  path: string | null;
  content: string;
  format: SnippetFormat;
  verified: boolean;
}

/**
 * The registration for one host: where it goes, the exact content, its format, and whether the
 * shape is verified. An unknown id returns `path: null` with no content — a caller that skipped
 * `integrationById` gets a null, never a plausible-looking wrong snippet.
 */
export const mcpRegistration = (
  id: string,
  opts: { cliPath: string },
): McpRegistration => {
  const host = integrationById(id);
  if (!host) return { path: null, content: '', format: 'json', verified: false };
  return {
    path: pickConfigPath(host.mcp.configPaths),
    content: host.mcp.snippet(opts.cliPath),
    format: host.mcp.snippetFormat,
    verified: host.mcp.verified,
  };
};
