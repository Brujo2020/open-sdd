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
 *     `.agents/mcp_config.json` workspace) AND the inner entry shape is now verified too: the page's
 *     advertised Markdown sibling (`https://antigravity.google/docs/mcp.md`, the `View Markdown`
 *     target the rendered page itself links to) documents a single top-level `mcpServers` object whose
 *     stdio entries carry `command` (string) + `args` (array), so it joins the `mcpServers` family and
 *     uses the same snippet as Claude Code. Remote entries use `serverUrl`, not `url`/`httpUrl`.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
/** The name our server registers under in every host config. */
export const MCP_SERVER_NAME = 'open-sdd';
// ---------------------------------------------------------------------------------------------
// Snippet builders — the exact bytes that go into the host's own file.
// ---------------------------------------------------------------------------------------------
const jsonDoc = (value) => `${JSON.stringify(value, null, 2)}\n`;
/** TOML basic string: backslashes and quotes escaped, because a Windows path is full of both. */
const tomlString = (value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
/** Kilo Code and MiMoCode: top-level `mcp`, `type: "local"`, command as an ARRAY (not string+args). */
const localArraySnippet = (cliPath) => jsonDoc({ mcp: { [MCP_SERVER_NAME]: { type: 'local', command: ['node', cliPath, 'mcp'] } } });
/** Crush's `.crush.json`: top-level `mcp`, but the entry keeps a STRING command plus a sibling `args`. */
const mcpKeySnippet = (cliPath) => jsonDoc({ mcp: { [MCP_SERVER_NAME]: { command: 'node', args: [cliPath, 'mcp'] } } });
/** ZCode's `config.json`: the servers live one level down, under `mcp.servers`. */
const zcodeSnippet = (cliPath) => jsonDoc({ mcp: { servers: { [MCP_SERVER_NAME]: { command: 'node', args: [cliPath, 'mcp'] } } } });
/** Amp's `.amp/settings.json`: the key itself is namespaced, `amp.mcpServers`. */
const ampSnippet = (cliPath) => jsonDoc({ 'amp.mcpServers': { [MCP_SERVER_NAME]: { command: 'node', args: [cliPath, 'mcp'] } } });
/** CodeBuddy reuses the `mcpServers` family but requires an explicit `type: "stdio"` on the entry. */
const stdioTypedSnippet = (cliPath) => jsonDoc({ mcpServers: { [MCP_SERVER_NAME]: { type: 'stdio', command: 'node', args: [cliPath, 'mcp'] } } });
/** `{"mcpServers": {"open-sdd": {"command": "node", "args": ["<cli>", "mcp"]}}}` */
const mcpServersSnippet = (cliPath) => jsonDoc({ mcpServers: { [MCP_SERVER_NAME]: { command: 'node', args: [cliPath, 'mcp'] } } });
/** VS Code's `.vscode/mcp.json`: a `servers` object whose entries declare `type: "stdio"`. */
const vscodeServersSnippet = (cliPath) => jsonDoc({ servers: { [MCP_SERVER_NAME]: { type: 'stdio', command: 'node', args: [cliPath, 'mcp'] } } });
/** OpenCode's `opencode.json`: an `mcp` object whose entries declare `type: "local"` and an ARRAY `command`. */
const opencodeSnippet = (cliPath) => jsonDoc({
    $schema: 'https://opencode.ai/config.json',
    mcp: { [MCP_SERVER_NAME]: { type: 'local', command: ['node', cliPath, 'mcp'] } },
});
/** Zed's `context_servers` entry: STRING `command` plus a sibling `args` array (not `{ path, args }`). */
const zedSnippet = (cliPath) => jsonDoc({
    context_servers: { [MCP_SERVER_NAME]: { command: 'node', args: [cliPath, 'mcp'], env: {} } },
});
/** Codex's `config.toml`. */
const codexSnippet = (cliPath) => [
    `[mcp_servers.${MCP_SERVER_NAME}]`,
    'command = "node"',
    `args = [${tomlString(cliPath)}, "mcp"]`,
    '',
].join('\n');
const VERIFIED_JSON_MCP_SERVERS = 'Forma VERIFICADA: objeto JSON de primer nivel `mcpServers` con una entrada por servidor, `command` + `args` para stdio. Es la forma documentada de este anfitrión y la que escribe su propio comando de alta.';
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
export const HOST_INTEGRATIONS = [
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
            // The two documented paths are known AND the inner entry shape is now verified: the page's
            // advertised Markdown sibling documents a single top-level `mcpServers` object with
            // `command` (string) + `args` (array) for stdio entries, so it joins that family. The workspace
            // path is the one declared here (it is the repo-local one, matching the `.agents/` markers);
            // the global path is recorded in the notes.
            configPaths: {
                linux: '.agents/mcp_config.json',
                darwin: '.agents/mcp_config.json',
                win32: '.agents/mcp_config.json',
            },
            snippetFormat: 'json',
            snippet: mcpServersSnippet,
            verified: true,
            docUrl: DOC_ANTIGRAVITY,
        },
        detect: ['.agent/', '.agent/skills/', '.agent/rules/'],
        notes: [
            'Forma VERIFICADA (contra el Markdown que la propia página anuncia en `View Markdown`): `https://antigravity.google/docs/mcp.md` documenta un ÚNICO objeto de primer nivel `mcpServers` con una entrada por servidor; para stdio, `command` es una CADENA y `args` un ARRAY (`{"command":"node","args":["<cli>","mcp"]}`), opcionalmente con `env`, `cwd`, `disabled` y `disabledTools`. Es la misma familia que Claude Code/Cursor, así que el snippet es el `mcpServersSnippet` compartido. Documentación: https://antigravity.google/docs/mcp.',
            'Rutas VERIFICADAS: global `~/.gemini/config/mcp_config.json` (en Windows `%USERPROFILE%\\.gemini\\config\\mcp_config.json`) y de espacio de trabajo `.agents/mcp_config.json`. La matriz declara la de espacio de trabajo como `configPath`, que es la única que `--write` puede fusionar sin adivinar el home del usuario.',
            'Conexiones remotas: el campo documentado es `serverUrl`; `url` y `httpUrl` quedan explícitamente NO soportados. Nuestro servidor es stdio, así que el snippet no emite ninguno de los tres.',
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
                linux: '~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
                darwin: '~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
                win32: '%APPDATA%\\Code\\User\\globalStorage\\saoudrizwan.claude-dev\\settings\\cline_mcp_settings.json',
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
    {
        id: 'factory-droid',
        label: 'Factory Droid',
        skills: { layout: '.factory/skills/sdd-*/SKILL.md', mode: 'skills' },
        invocation: '/sdd-brownfield',
        mcp: {
            configPaths: {
                linux: '.factory/mcp.json',
                darwin: '.factory/mcp.json',
                win32: '.factory/mcp.json',
            },
            snippetFormat: 'json',
            snippet: mcpServersSnippet,
            verified: true,
            docUrl: 'https://docs.factory.ai/llms-full.txt',
        },
        detect: ['.factory/'],
        notes: [
            'Forma VERIFICADA: `.factory/mcp.json` en la raiz del proyecto con el objeto `mcpServers` y entradas stdio de `command` (cadena) + `args` (array) hermanos. Documentacion: https://docs.factory.ai/llms-full.txt (seccion MCP, "Configuration file"); espejo por pagina: https://docs.factory.ai/droid-cli/settings.md.',
            'Los servidores de proyecto se leen en modo solo lectura desde el CLI (`droid mcp remove` no puede borrarlos) y no deben contener secretos: el snippet registra un servidor local (node <cli> mcp), no una credencial.',
            'Skills: `.factory/skills/<n>/SKILL.md` documentado; el instalador de skills es el siguiente incremento (G-35).',
        ],
    },
    {
        id: 'roo-code',
        label: 'Roo Code',
        skills: { layout: '.roo/skills/sdd-*/SKILL.md', mode: 'skills' },
        invocation: '/sdd-brownfield',
        mcp: {
            configPaths: {
                linux: '.roo/mcp.json',
                darwin: '.roo/mcp.json',
                win32: '.roo/mcp.json',
            },
            snippetFormat: 'json',
            snippet: mcpServersSnippet,
            verified: true,
            docUrl: 'https://roocodeinc.github.io/Roo-Code/features/mcp/using-mcp-in-roo',
        },
        detect: ['.roo/', '.roorules'],
        notes: [
            'Forma VERIFICADA: `.roo/mcp.json` con el objeto `mcpServers` y entradas stdio de `command` (cadena) + `args` (array). Documentacion: https://roocodeinc.github.io/Roo-Code/features/mcp/using-mcp-in-roo.',
            'Roo Code tambien lee `.agents/skills/` y AGENTS.md; el instalador de skills es el siguiente incremento (G-35).',
        ],
    },
    {
        id: 'kilo-code',
        label: 'Kilo Code',
        skills: { layout: '.kilo/skills/sdd-*/SKILL.md', mode: 'skills' },
        invocation: '/sdd-brownfield',
        mcp: {
            configPaths: {
                linux: '.kilo/kilo.jsonc',
                darwin: '.kilo/kilo.jsonc',
                win32: '.kilo/kilo.jsonc',
            },
            snippetFormat: 'json',
            snippet: localArraySnippet,
            verified: true,
            docUrl: 'https://kilocode.ai/docs/llms.txt',
        },
        detect: ['.kilo/'],
        notes: [
            'Forma VERIFICADA y DISTINTA de la familia `mcpServers`: clave de primer nivel `mcp`, entrada con `type: "local"` y `command` como ARRAY (no `command`+`args`), con `environment` en lugar de `env`. Documentacion: https://kilocode.ai/docs/llms.txt.',
            'El archivo documentado es `.kilo/kilo.jsonc`: si ya contiene comentarios, el merge se NIEGA a reescribirlo en vez de destruirlos (el lector es JSON estricto) y lo dice.',
            'Kilo Code lee `.agents/skills/`, `.claude/skills/` y AGENTS.md; el instalador de skills es el siguiente incremento (G-35).',
        ],
    },
    {
        id: 'junie',
        label: 'JetBrains Junie',
        skills: { layout: '.junie/skills/sdd-*/SKILL.md', mode: 'skills' },
        invocation: '/sdd-brownfield',
        mcp: {
            configPaths: {
                linux: '.junie/mcp/mcp.json',
                darwin: '.junie/mcp/mcp.json',
                win32: '.junie/mcp/mcp.json',
            },
            snippetFormat: 'json',
            snippet: mcpServersSnippet,
            verified: true,
            docUrl: 'https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html',
        },
        detect: ['.junie/'],
        notes: [
            'Forma VERIFICADA: `.junie/mcp/mcp.json` (usuario `~/.junie/mcp/mcp.json`) con el objeto `mcpServers` y entradas stdio de `command` (cadena) + `args` (array). Documentacion: https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html; ajustes del plugin: https://junie.jetbrains.com/docs/junie-plugin-mcp-settings.html.',
            'Ojo con el anfitrion de documentacion: `www.jetbrains.com/help/junie/*` devuelve 200 pero son cascaras de redireccion de 203 bytes; la documentacion real vive en junie.jetbrains.com/docs/.',
            'Skills: `.junie/skills/<n>/SKILL.md` documentado; el instalador de skills es el siguiente incremento (G-35).',
        ],
    },
    {
        id: 'mimocode',
        label: 'MiMoCode (Xiaomi)',
        skills: { layout: '.mimocode/skills/**/SKILL.md', mode: 'skills' },
        invocation: '/sdd-brownfield',
        mcp: {
            configPaths: {
                linux: '.mimocode/mimocode.json',
                darwin: '.mimocode/mimocode.json',
                win32: '.mimocode/mimocode.json',
            },
            snippetFormat: 'json',
            snippet: localArraySnippet,
            verified: true,
            docUrl: 'https://mimo.xiaomi.com/mimocode/mcp-servers',
        },
        detect: ['.mimocode/'],
        notes: [
            'Forma VERIFICADA y DISTINTA: `.mimocode/mimocode.json` (o `.jsonc`; usuario `~/.config/mimocode/mimocode.jsonc`) con la clave `mcp`, entrada `type: "local"` y `command` como ARRAY, y `environment` en lugar de `env`. Documentacion: https://mimo.xiaomi.com/mimocode/mcp-servers.',
            'Skills: `.mimocode/skills/**/SKILL.md` documentado (tambien los compatibles `.claude/`, `.agents/`, `.codex/`, `.opencode/`); el instalador de skills es el siguiente incremento (G-35).',
        ],
    },
    {
        id: 'iflow',
        label: 'iFlow CLI',
        skills: { layout: 'IFLOW.md (skills no documentados)', mode: 'prompt-file' },
        invocation: '/sdd-brownfield',
        mcp: {
            configPaths: {
                linux: '.iflow/settings.json',
                darwin: '.iflow/settings.json',
                win32: '.iflow/settings.json',
            },
            snippetFormat: 'json',
            snippet: mcpServersSnippet,
            verified: true,
            docUrl: 'https://raw.githubusercontent.com/iflow-ai/iflow-cli/main/docs_en/examples/mcp.md',
        },
        detect: ['.iflow/', 'IFLOW.md'],
        notes: [
            'Forma VERIFICADA: `.iflow/settings.json` (usuario `~/.iflow/settings.json`) con el objeto `mcpServers` y entradas stdio de `command` (cadena) + `args` (array). Documentacion: https://raw.githubusercontent.com/iflow-ai/iflow-cli/main/docs_en/examples/mcp.md.',
            'Sin Agent Skills documentados para el CLI (el repo iflow-ai/iflow-skills apunta a otros anfitriones): no se declara un layout de skills que nadie haya documentado.',
            'El fichero de contexto por defecto es IFLOW.md; `contextFileName` puede apuntarlo a AGENTS.md.',
        ],
    },
    {
        id: 'zcode',
        label: 'ZCode (Z.ai)',
        skills: { layout: '.zcode/skills/sdd-*/SKILL.md', mode: 'skills' },
        invocation: '/sdd-brownfield',
        mcp: {
            configPaths: {
                linux: '.zcode/config.json',
                darwin: '.zcode/config.json',
                win32: '.zcode/config.json',
            },
            snippetFormat: 'json',
            snippet: zcodeSnippet,
            verified: true,
            docUrl: 'https://zcode.z.ai/en/docs/mcp-services',
        },
        detect: ['.zcode/'],
        notes: [
            'Forma VERIFICADA: los servidores viven bajo `mcp.servers` en `.zcode/config.json` (usuario `~/.zcode/cli/config.json`), con `command` (cadena) + `args` (array); el mismo documento admite el compatible `.agents/mcp.json` con la clave `mcpServers`. Documentacion: https://zcode.z.ai/en/docs/mcp-services.',
            'El path de proyecto de comandos y skills es SOURCE-VERIFIED (resolver del propio vendor), no documentado; ver la fila de plantillas de comando.',
            'AGENTS.md plano (sin fusion anidada); limites publicados de skill: descripcion <=1024 caracteres y cuerpo >100 KB truncado.',
        ],
    },
    {
        id: 'trae',
        label: 'Trae (ByteDance)',
        skills: { layout: '.trae/skills/sdd-*/SKILL.md', mode: 'skills' },
        invocation: '/sdd-brownfield',
        mcp: {
            configPaths: {
                linux: '.trae/mcp.json',
                darwin: '.trae/mcp.json',
                win32: '.trae/mcp.json',
            },
            snippetFormat: 'json',
            snippet: mcpServersSnippet,
            verified: true,
            docUrl: 'https://docs.trae.ai/ide/add-mcp-servers?_lang=en',
        },
        detect: ['.trae/'],
        notes: [
            'Forma VERIFICADA: `.trae/mcp.json` en el proyecto con el objeto `mcpServers` y entradas stdio de `command` (cadena) + `args` (array). Documentacion: https://docs.trae.ai/ide/add-mcp-servers?_lang=en.',
            'Las paginas de docs.trae.ai son una SPA de ByteDance que embebe el cuerpo del documento como JSON Quill-delta en el HTML servido: se lee sin JavaScript, y `.md`/`sitemap.xml`/`llms.txt` devuelven la SPA, no el documento.',
        ],
    },
    {
        id: 'qoder',
        label: 'Qoder (Alibaba)',
        skills: { layout: '.qoder/skills/sdd-*/SKILL.md', mode: 'skills' },
        invocation: '/sdd-brownfield',
        mcp: {
            configPaths: {
                linux: '.mcp.json',
                darwin: '.mcp.json',
                win32: '.mcp.json',
            },
            snippetFormat: 'json',
            snippet: mcpServersSnippet,
            verified: true,
            docUrl: 'https://docs.qoder.com/cli/mcp-servers.md',
        },
        detect: ['.qoder/'],
        notes: [
            'Forma VERIFICADA: `.mcp.json` en el proyecto con el objeto `mcpServers`; el lado chino documenta ademas `<proyecto>/.qoder/settings[.local].json` y las reglas en `.qoder/rules/**/*.md` con un presupuesto documentado de 100.000 caracteres entre TODOS los ficheros de reglas activos. Documentacion: https://docs.qoder.com/cli/mcp-servers.md.',
            'Qoder es el nombre actual de Tongyi Lingma. docs.qoder.com y help.aliyun.com sirven gzip SIN negociar `Content-Encoding`: hay que usar `curl --compressed` o se obtiene binario.',
        ],
    },
    {
        id: 'codebuddy',
        label: 'CodeBuddy (Tencent)',
        skills: { layout: '.codebuddy/skills/sdd-*/SKILL.md', mode: 'skills' },
        invocation: '/sdd-brownfield',
        mcp: {
            configPaths: {
                linux: '.mcp.json',
                darwin: '.mcp.json',
                win32: '.mcp.json',
            },
            snippetFormat: 'json',
            snippet: stdioTypedSnippet,
            verified: true,
            docUrl: 'https://www.codebuddy.ai/docs/cli/mcp',
        },
        detect: ['.codebuddy/', 'CODEBUDDY.md'],
        notes: [
            'Forma VERIFICADA: `.mcp.json` en la raiz con la clave `mcpServers`, y la entrada exige un `type: "stdio"` EXPLICITO (ademas de `command` cadena y `args` array). Documentacion: https://www.codebuddy.ai/docs/cli/mcp.',
            'CODEBUDDY.md es el fichero de instrucciones nativo; AGENTS.md se lee solo como respaldo cuando CODEBUDDY.md no existe.',
            'docs.codebuddy.ai y codebuddy.ai/docs no resuelven por DNS (HTTP 000): la documentacion viva esta en www.codebuddy.ai.',
        ],
    },
    {
        id: 'crush',
        label: 'Crush (Charm)',
        skills: { layout: '.crush/skills/sdd-*/SKILL.md', mode: 'skills' },
        invocation: 'skills: sdd-* (auto-loaded)',
        mcp: {
            configPaths: {
                linux: '.crush.json',
                darwin: '.crush.json',
                win32: '.crush.json',
            },
            snippetFormat: 'json',
            snippet: mcpKeySnippet,
            verified: true,
            docUrl: 'https://raw.githubusercontent.com/charmbracelet/crush/main/docs/config/README.md',
        },
        detect: ['.crush.json', '.crushrc'],
        notes: [
            'Forma VERIFICADA: `./.crush.json` (o `./.crushrc`, que es bash) con la clave de primer nivel `mcp` y entradas de `command` (cadena) + `args` (array); el ambito de usuario es `~/.config/crush/crush.json|crushrc`. Documentacion: https://raw.githubusercontent.com/charmbracelet/crush/main/docs/config/README.md.',
            'Crush no tiene comandos personalizados: su superficie son las Agent Skills (proyecto `.crush/skills`, `.agents/skills`, `.claude/skills`, `.cursor/skills`) y el contexto de proyecto via AGENTS.md.',
            'El instalador de skills para Crush es el siguiente incremento (G-35): hoy `integrate crush --write` escribe el MCP y declara el hueco de skills.',
        ],
    },
    {
        id: 'amp',
        label: 'Amp (Sourcegraph)',
        skills: { layout: '.agents/skills/sdd-*/SKILL.md', mode: 'skills' },
        invocation: 'skills: sdd-* (auto-selected)',
        mcp: {
            configPaths: {
                linux: '.amp/settings.json',
                darwin: '.amp/settings.json',
                win32: '.amp/settings.json',
            },
            snippetFormat: 'json',
            snippet: ampSnippet,
            verified: true,
            docUrl: 'https://ampcode.com/docs/markdown/customize/mcp',
        },
        detect: ['.amp/'],
        notes: [
            'Forma VERIFICADA: `.amp/settings.json` del espacio de trabajo con la clave NAMESPACED `amp.mcpServers` (usuario `~/.config/amp/settings.json`), entradas de `command` (cadena) + `args` (array). Documentacion: https://ampcode.com/docs/markdown/customize/mcp.',
            'Amp no tiene comandos de barra ("You do not need a slash command"): su superficie son las skills del proyecto (`.agents/skills/`, `.claude/skills/`) y AGENTS.md/AGENT.md/CLAUDE.md leidos en el cwd y sus ancestros.',
            'Amp publica Markdown crudo en `/docs/markdown/<ruta>` para sus 54 paginas, indexadas en https://ampcode.com/llms.txt.',
        ],
    },
    {
        id: 'kimi-code',
        label: 'Kimi Code CLI (Moonshot)',
        skills: { layout: '.kimi-code/skills/sdd-*/SKILL.md', mode: 'skills' },
        invocation: '/skill:sdd-brownfield',
        mcp: {
            configPaths: {
                linux: '.kimi-code/mcp.json',
                darwin: '.kimi-code/mcp.json',
                win32: '.kimi-code/mcp.json',
            },
            snippetFormat: 'json',
            snippet: mcpServersSnippet,
            verified: true,
            docUrl: 'https://raw.githubusercontent.com/MoonshotAI/kimi-code/main/docs/en/customization/mcp.md',
        },
        detect: ['.kimi-code/'],
        notes: [
            'Forma VERIFICADA: `.kimi-code/mcp.json` en el proyecto (usuario `~/.kimi-code/mcp.json`) con el objeto `mcpServers` y entradas stdio de `command` (cadena) + `args` (array). Documentacion: https://raw.githubusercontent.com/MoonshotAI/kimi-code/main/docs/en/customization/mcp.md.',
            'NO tiene comandos personalizados: su propio TOC de documentacion (https://moonshotai.github.io/kimi-code/llms.txt) no tiene pagina de comandos y dice que las barras son "built-in control commands"; un `/x` desconocido se envia como mensaje normal. Por eso NO hay fila de plantillas de comando para este anfitrion.',
            'Skills: proyecto `.kimi-code/skills/` y `.agents/skills/`, invocadas `/skill:<name>`; el instalador de skills es el siguiente incremento (G-35).',
        ],
    },
    {
        id: 'warp',
        label: 'Warp',
        skills: { layout: '.agents/skills/sdd-*/SKILL.md', mode: 'skills' },
        invocation: '/sdd-brownfield (skill)',
        mcp: {
            configPaths: {
                linux: '.warp/.mcp.json',
                darwin: '.warp/.mcp.json',
                win32: '.warp/.mcp.json',
            },
            snippetFormat: 'json',
            snippet: mcpServersSnippet,
            verified: true,
            docUrl: 'https://docs.warp.dev/_llms-txt/agents.txt',
        },
        detect: ['.warp/'],
        notes: [
            'Forma VERIFICADA: `.warp/.mcp.json` (usuario `~/.warp/.mcp.json`; el Warp Agent CLI usa `~/.warp_cli/.mcp.json`) con el objeto `mcpServers` y entradas stdio de `command` (cadena) + `args` (array) + `env` opcional. Documentacion: https://docs.warp.dev/_llms-txt/agents.txt.',
            'Warp NO documenta directorio de comandos de proyecto (sus prompts viven en Warp Drive, en la nube): la integracion es por Agent Skills, con `.agents/skills/` como ruta recomendada entre las diez que documenta, y AGENTS.md/WARP.md en mayusculas.',
            'El instalador de skills para Warp es el siguiente incremento (G-35).',
        ],
    },
    {
        id: 'devin',
        label: 'Devin (Cognition)',
        skills: { layout: '.devin/skills/sdd-*/SKILL.md', mode: 'skills' },
        invocation: '/sdd-brownfield (skill)',
        mcp: {
            configPaths: {
                linux: '.devin/mcp_config.json',
                darwin: '.devin/mcp_config.json',
                win32: '.devin/mcp_config.json',
            },
            snippetFormat: 'json',
            snippet: mcpServersSnippet,
            verified: true,
            docUrl: 'https://docs.devin.ai/cli/extensibility/mcp/configuration.md',
        },
        detect: ['.devin/'],
        notes: [
            'Forma VERIFICADA: `.devin/mcp_config.json` para el ambito de proyecto y `~/.config/devin/mcp_config.json` para el de usuario (`%APPDATA%\\devin\\mcp_config.json` en Windows), con el objeto `mcpServers` y entradas stdio de `command` (cadena) + `args` (array) + `env`. Documentacion: https://docs.devin.ai/cli/extensibility/mcp/configuration.md.',
            'Migracion documentada: desde la v3000.3 los servidores viven en ficheros dedicados; ANTES estaban en la clave `mcpServers` de `.devin/config.json`. El merge escribe el fichero nuevo, no el antiguo.',
            'Devin no documenta directorio de comandos de proyecto: su superficie es skills (`.devin/skills/`, `.agents/skills/`, `.windsurf/skills/`) y reglas. El instalador de skills es el siguiente incremento (G-35).',
        ],
    },
];
// ---------------------------------------------------------------------------------------------
// Lookup, detection and registration
// ---------------------------------------------------------------------------------------------
export const integrationById = (id) => HOST_INTEGRATIONS.find((host) => host.id === id);
const exists = async (p) => (await stat(p).catch(() => null)) !== null;
/**
 * Which host is present, with the evidence that says so and the alternatives that were also seen.
 *
 * Evidence is scored by how many markers matched, then by the matrix order (most specific host
 * first), so a repository that happens to carry an `AGENTS.md` next to a real `.cursor/` is
 * reported as Cursor with `AGENTS.md` as an alternative instead of the other way round.
 */
export const detectIntegration = async (cwd) => {
    const matches = [];
    for (const host of HOST_INTEGRATIONS) {
        const evidence = [];
        for (const marker of host.detect) {
            if (await exists(path.join(cwd, marker))) {
                evidence.push(`${marker} existe`);
            }
        }
        if (evidence.length > 0)
            matches.push({ id: host.id, evidence });
    }
    if (matches.length === 0)
        return null;
    const ordered = [...matches].sort((a, b) => b.evidence.length - a.evidence.length || indexOfHost(a.id) - indexOfHost(b.id));
    const chosen = ordered[0];
    return {
        id: chosen.id,
        evidence: chosen.evidence,
        alternatives: ordered.slice(1).map((match) => match.id),
    };
};
const indexOfHost = (id) => HOST_INTEGRATIONS.findIndex((host) => host.id === id);
/**
 * The path we would write for a host, or `null` when the host has no documented path.
 *
 * A path that is identical on every OS (and is not a home-relative one) is project-scoped, and
 * that is the one we return: a repository-local file is the only one `--write` can merge without
 * guessing at a user's home directory layout. Otherwise the path for the running platform wins.
 */
const pickConfigPath = (paths) => {
    const entries = [paths.linux, paths.darwin, paths.win32].filter((entry) => typeof entry === 'string' && entry.length > 0);
    if (entries.length === 0)
        return null;
    const homeRelative = (entry) => entry.startsWith('~') || entry.startsWith('%');
    if (new Set(entries).size === 1 && !homeRelative(entries[0]))
        return entries[0];
    const platform = process.platform;
    return paths[platform] ?? entries[0];
};
/**
 * The registration for one host: where it goes, the exact content, its format, and whether the
 * shape is verified. An unknown id returns `path: null` with no content — a caller that skipped
 * `integrationById` gets a null, never a plausible-looking wrong snippet.
 */
export const mcpRegistration = (id, opts) => {
    const host = integrationById(id);
    if (!host)
        return { path: null, content: '', format: 'json', verified: false };
    return {
        path: pickConfigPath(host.mcp.configPaths),
        content: host.mcp.snippet(opts.cliPath),
        format: host.mcp.snippetFormat,
        verified: host.mcp.verified,
    };
};
