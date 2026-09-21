/**
 * Prompt-template path — the DEFAULT integration, with no MCP and no network.
 *
 * ── Why this file exists ────────────────────────────────────────────────────────────────────────
 * MCP is a rich surface, but it is not universally available: some hosts do not implement it, and
 * some security policies block or allow-list it. The one integration that works everywhere an agent
 * reads files is the host's own **prompt template** convention — a Markdown (or TOML) file the user
 * invokes from chat, whose body is the instructions the agent follows. spec-kit proved the shape;
 * this module makes open-sdd's version of it the default, because our templates can point at a real
 * engine (`open-sdd status --json`, `open-sdd delta validate …`) instead of guessing.
 *
 * ── The rule that is not negotiable ─────────────────────────────────────────────────────────────
 * `verified` is an EVIDENCE field, not a courtesy, exactly as in `integrations.ts`. It is `true`
 * only for the layouts this project confirmed against the host's own documentation (or against the
 * path open-sdd itself already installs its prompt mode into); `evidence` says how we know. An
 * unverified host is printed as unverified and `--write` **refuses** to write into it rather than
 * guessing at a directory the host may never read — a plausible-looking wrong path is worse than an
 * acknowledged gap.
 *
 * ── Never overwrite a human's edit ──────────────────────────────────────────────────────────────
 * Every artifact this installer writes carries a signature line with the sha256 of the body it was
 * generated from. On a later run the installer recomputes the hash of the existing body: if it
 * matches the signature, the file is untouched and may be refreshed; if it does not, a human (or
 * another tool) edited it, and the file is reported `keep` with that reason and left alone.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir, fileExists } from '../utils/fs.js';
// ---------------------------------------------------------------------------------------------
// The template inventory
// ---------------------------------------------------------------------------------------------
/** The twenty-two prompt templates this project ships, by file id (the file name without `.md`). */
export const COMMAND_TEMPLATE_IDS = [
    'onboard',
    'constitution',
    'specify',
    'clarify',
    'plan',
    'tasks',
    'implement',
    'analyze',
    'checklist',
    'converge',
    'tasks-to-issues',
    'brownfield',
    'status',
    'contracts',
    'impact',
    'reuse',
    'gates',
    'audit',
    'import',
    'doctor',
    'tour',
    'release',
];
/** Bumped only when the rendering itself changes; the body hash is what detects real staleness. */
export const COMMAND_TEMPLATE_FORMAT_REVISION = 1;
const flatMarkdown = (id) => `sdd-${id}.md`;
/**
 * The command-template matrix, one row per host. Kept separate from `HOST_INTEGRATIONS` (which
 * describes MCP and skills) because the two surfaces are verified independently: a host can have a
 * confirmed command directory and an unconfirmed MCP snippet, or the other way round.
 */
export const HOST_COMMAND_TEMPLATES = [
    {
        id: 'claude-code',
        label: 'Claude Code',
        dir: '.claude/commands',
        fileName: flatMarkdown,
        format: 'markdown',
        invocation: (id) => `/sdd-${id}`,
        argumentSyntax: '$ARGUMENTS',
        verified: true,
        evidence: 'Claude Code documents custom slash commands as Markdown files in the commands directory, and this repository already installs its own prompt mode into `.claude/commands/sdd/` in `src/agents/registry.ts`.',
        docUrl: 'https://docs.anthropic.com/en/docs/claude-code/slash-commands',
    },
    {
        id: 'cursor',
        label: 'Cursor',
        dir: '.cursor/commands',
        fileName: flatMarkdown,
        format: 'markdown',
        invocation: (id) => `/sdd-${id}`,
        argumentSyntax: '$ARGUMENTS',
        verified: true,
        evidence: 'Cursor documents Commands as Markdown files invoked with `/` in Agent chat, and this repository already installs its own prompt mode into `.cursor/commands/sdd/`. Cursor is migrating Commands to Skills; the workspace commands directory still loads them.',
        docUrl: 'https://cursor.com/docs/customize-cursor.md',
    },
    {
        id: 'copilot',
        label: 'GitHub Copilot',
        dir: '.github/prompts',
        fileName: (id) => `sdd-${id}.prompt.md`,
        format: 'markdown',
        invocation: (id) => `/sdd-${id}`,
        argumentSyntax: '${input:name}',
        verified: true,
        evidence: 'VS Code documents workspace prompt files at `.github/prompts` with the `.prompt.md` extension, invoked with `/` in chat. The newer Agent Host migrates prompt files to skills; the Local agent still loads them.',
        docUrl: 'https://code.visualstudio.com/docs/agent-customization/prompt-files',
    },
    {
        id: 'gemini-cli',
        label: 'Gemini CLI',
        dir: '.gemini/commands',
        fileName: (id) => `sdd-${id}.toml`,
        format: 'toml',
        invocation: (id) => `/sdd-${id}`,
        argumentSyntax: '{{args}}',
        verified: true,
        evidence: 'Gemini CLI documents project commands as `.toml` files under `.gemini/commands/`, with `prompt` and optional `description`; a flat file becomes `/name`, a subdirectory namespaces it.',
        docUrl: 'https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/custom-commands.md',
    },
    {
        id: 'opencode',
        label: 'OpenCode',
        dir: '.opencode/commands',
        fileName: flatMarkdown,
        format: 'markdown',
        invocation: (id) => `/sdd-${id}`,
        argumentSyntax: '$ARGUMENTS',
        verified: true,
        evidence: 'OpenCode documents per-project commands as Markdown files in `.opencode/commands/`, with `description` in the frontmatter and `$ARGUMENTS` in the body.',
        docUrl: 'https://opencode.ai/docs/commands/',
    },
    {
        id: 'codex',
        label: 'Codex CLI',
        dir: '.codex/prompts',
        fileName: flatMarkdown,
        format: 'markdown',
        invocation: (id) => `/prompts:sdd-${id}`,
        argumentSyntax: '$ARGUMENTS',
        verified: false,
        evidence: 'NOT VERIFIED as a repository-scoped convention: `https://learn.chatgpt.com/docs/custom-prompts.md` (fetched) documents custom prompts as DEPRECATED and only in the user home — `~/.codex/prompts/*.md`, top-level Markdown files only, invoked `/prompts:<name>` — and states they "live in your local Codex home directory (for example, `~/.codex`), so they\'re not shared through your repository". `https://learn.chatgpt.com/docs/customization/overview.md` (fetched) documents the repository-scoped surface as skills in `.agents/skills/` (global `~/.agents/skills/`), with no project commands directory. No project-scoped `.codex/prompts/` is documented, so `--write` refuses it; use the Codex skills install instead.',
        docUrl: 'https://learn.chatgpt.com/docs/custom-prompts.md',
    },
    {
        id: 'windsurf',
        label: 'Windsurf',
        dir: '.windsurf/workflows',
        fileName: flatMarkdown,
        format: 'markdown',
        invocation: (id) => `/sdd-${id}`,
        argumentSyntax: '$ARGUMENTS',
        verified: true,
        evidence: 'Windsurf documentation (docs.windsurf.com now 308-redirects to docs.devin.ai) documents workflows as Markdown files in `.windsurf/workflows/`, each carrying a title/description and a series of steps, invoked in Cascade as `/[name-of-workflow]`. The same page documents the global location `~/.codeium/windsurf/global_workflows/` and the OS-specific system locations, and a 12,000-character per-file limit that every shipped template stays under. `.windsurf/workflows/` is the legacy path but is still read; the migration page names `.devin/workflows/` as the newer preferred path.',
        docUrl: 'https://docs.devin.ai/desktop/cascade/workflows.md',
    },
    {
        id: 'qwen-code',
        label: 'Qwen Code',
        dir: '.qwen/commands',
        fileName: flatMarkdown,
        format: 'markdown',
        invocation: (id) => `/sdd-${id}`,
        argumentSyntax: '{{args}}',
        verified: true,
        evidence: 'Qwen Code documents custom commands as Markdown files with optional YAML frontmatter (`description`) under `<project root>/.qwen/commands/` (flat file `sdd-<id>.md` becomes `/sdd-<id>`; a subdirectory would namespace it `/dir:name`), with `{{args}}` for parameter injection and project commands taking priority over `~/.qwen/commands/`. The documentation states TOML is deprecated but still supported pending automatic migration, so this matrix now writes Markdown (`sdd-<id>.md`) rather than the deprecated `sdd-<id>.toml`.',
        docUrl: 'https://raw.githubusercontent.com/QwenLM/qwen-code/main/docs/users/features/commands.md',
    },
    {
        id: 'antigravity',
        label: 'Google Antigravity',
        dir: '.agents/workflows',
        fileName: flatMarkdown,
        format: 'markdown',
        invocation: (id) => `/sdd-${id}`,
        argumentSyntax: '$ARGUMENTS',
        verified: true,
        evidence: 'Antigravity documents legacy workflows as single Markdown files with YAML frontmatter (`name`, `description`) plus a step body, at `.agents/workflows/<name>.md` (workspace) or `~/.gemini/config/workflows/<name>.md` (global), invoked in chat as `/<workflow-name>`, limited to 12,000 characters each. Note the documented directory is the PLURAL `.agents/workflows/`, not the `.agent/workflows/` this matrix previously assumed. The same page deprecates workflows with a stated retirement of 2026-11-01 in favour of Agent Skills at `.agents/skills/<name>/SKILL.md`; the Antigravity skills layout this repository already ships is that successor.',
        docUrl: 'https://antigravity.google/docs/migration/workflows-to-skills.md',
    },
    {
        id: 'zed',
        label: 'Zed',
        dir: null,
        fileName: flatMarkdown,
        format: 'markdown',
        invocation: (id) => `@AGENTS.md run the sdd-${id} workflow`,
        argumentSyntax: 'n/a',
        verified: false,
        evidence: 'NOT VERIFIED and no documented prompt/command directory: `https://zed.dev/docs/ai/skills.md` (fetched) documents Zed\'s slash commands as coming from Agent Skills (`SKILL.md` bundles, project or user scope), and `https://zed.dev/docs/ai/instructions.md` (fetched) documents `AGENTS.md` plus legacy `.rules` files as the instruction surface. Neither page documents a directory of Markdown prompt/command files, so there is nothing for the prompt-template installer to write and `--write` refuses it; use the Zed skills layout or reference the workflow from AGENTS.md.',
        docUrl: 'https://zed.dev/docs/ai/skills.md',
    },
    {
        id: 'cline',
        label: 'Cline',
        dir: null,
        fileName: flatMarkdown,
        format: 'markdown',
        invocation: (id) => `/sdd-${id}`,
        argumentSyntax: '$ARGUMENTS',
        verified: false,
        evidence: 'NOT VERIFIED and no documented prompt/command directory: `https://docs.cline.bot/core-workflows/using-commands.md` (fetched) lists only built-in slash commands (`/newtask`, `/smol`, `/newrule`, `/deep-planning`, `/reportbug`) plus enabled skills triggered by slash command; `https://docs.cline.bot/customization/skills.md` (fetched) documents the customization surface as skill directories in `.cline/skills/` (or `.clinerules/skills/`, global `~/.cline/skills/`) with a `SKILL.md` each; `https://docs.cline.bot/customization/cline-rules.md` (fetched) documents `.clinerules/` and `.cline/rules/` for rules only. No `.clinerules/workflows/` prompt directory is documented, so no directory is declared and `--write` refuses it.',
        docUrl: 'https://docs.cline.bot/core-workflows/using-commands.md',
    },
];
export const commandHostById = (id) => HOST_COMMAND_TEMPLATES.find((host) => host.id === id);
/**
 * Which command-template host an agent-registry id belongs to.
 *
 * `init` detects an agent (for example `claude-code-skills`), while this matrix is keyed by host
 * (`claude-code`). The mapping is explicit so a new agent entry cannot silently fall through to the
 * wrong directory.
 */
const AGENT_HOST = {
    'claude-code': 'claude-code',
    'claude-code-agent': 'claude-code',
    'claude-code-skills': 'claude-code',
    codex: 'codex',
    'codex-skills': 'codex',
    cursor: 'cursor',
    'cursor-skills': 'cursor',
    'github-copilot': 'copilot',
    'github-copilot-skills': 'copilot',
    'gemini-cli': 'gemini-cli',
    'gemini-cli-skills': 'gemini-cli',
    windsurf: 'windsurf',
    'windsurf-skills': 'windsurf',
    'qwen-code': 'qwen-code',
    opencode: 'opencode',
    'opencode-agent': 'opencode',
    'opencode-skills': 'opencode',
    'antigravity-skills': 'antigravity',
};
export const hostForAgent = (agent) => AGENT_HOST[agent];
// ---------------------------------------------------------------------------------------------
// Rendering: template file -> host artifact
// ---------------------------------------------------------------------------------------------
/** The shipped templates live at `<package>/templates/commands`; the path is stable in dist and src. */
export const commandTemplatesDir = (templatesRoot) => {
    if (templatesRoot)
        return path.join(templatesRoot, 'commands');
    return fileURLToPath(new URL('../../templates/commands', import.meta.url));
};
export const commandTemplatePath = (id, templatesRoot) => path.join(commandTemplatesDir(templatesRoot), `${id}.md`);
const splitFrontmatter = (raw) => {
    if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n'))
        return { frontmatter: '', body: raw };
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match)
        return { frontmatter: '', body: raw };
    return { frontmatter: match[1], body: raw.slice(match[0].length) };
};
const frontmatterDescription = (frontmatter) => {
    const line = frontmatter.split(/\r?\n/).find((entry) => entry.startsWith('description:'));
    if (!line)
        return '';
    return line.slice('description:'.length).trim().replace(/^["']|["']$/g, '');
};
/**
 * One frontmatter list (`key:` followed by `  - "value"` entries), or `[]` for the inline empty list.
 *
 * The frontmatter is a narrow YAML subset this project authors itself, so the parser is deliberately
 * narrow too: it reads the block list and stops at the first line that leaves it. Anything richer
 * would be a YAML implementation pretending to be a list reader.
 */
const frontmatterList = (frontmatter, key) => {
    const lines = frontmatter.split(/\r?\n/);
    const start = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (start < 0)
        return [];
    if (lines[start].slice(key.length + 1).trim() === '[]')
        return [];
    const out = [];
    for (let i = start + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (!/^\s+-\s/.test(line))
            break;
        // El valor va entrecomillado en el YAML que este proyecto escribe: se quitan las comillas
        // EXTERIORES y se desescapan las interiores, o un `--by \"<name>\"` llegaría al lector con las
        // barras invertidas dentro y dejaría de ser la orden que dice ser.
        const value = line
            .replace(/^\s+-\s+/, '')
            .trim()
            .replace(/^["']/, '')
            .replace(/["']$/, '')
            .replace(/\\"/g, '"');
        out.push(value);
    }
    return out;
};
/** Read the shipped templates and parse their contract out of the frontmatter, in inventory order. */
export const readCommandTemplateCatalogue = async (templatesRoot) => {
    const entries = [];
    for (const id of COMMAND_TEMPLATE_IDS) {
        const raw = await readFile(commandTemplatePath(id, templatesRoot), 'utf8');
        const { frontmatter } = splitFrontmatter(raw);
        const writes = frontmatterList(frontmatter, 'writes');
        entries.push({
            id,
            description: frontmatterDescription(frontmatter),
            writes,
            readOnly: writes.length === 0,
            parallelSafe: frontmatterList(frontmatter, 'parallelSafe')[0] === 'true',
            commands: frontmatterList(frontmatter, 'commands'),
        });
    }
    return entries;
};
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const signatureLine = (format, id, hash) => format === 'toml'
    ? `# open-sdd:command-template id=${id} sha256=${hash}`
    : `<!-- open-sdd:command-template id=${id} sha256=${hash} -->`;
const signaturePattern = (format) => format === 'toml'
    ? /^# open-sdd:command-template id=([a-z-]+) sha256=([0-9a-f]{64})\s*$/m
    : /^<!-- open-sdd:command-template id=([a-z-]+) sha256=([0-9a-f]{64}) -->\s*$/m;
/** A `"""` inside a TOML literal string would terminate it early; our bodies do not contain one. */
const tomlSafe = (value) => value.replace(/"""/g, '\\"\\"\\"');
/**
 * Render one template for one host. Markdown hosts receive the file as authored (frontmatter
 * included, because `description` is meaningful to them); TOML hosts receive the `description` key
 * plus the body as the multi-line `prompt` value.
 */
export const renderCommandTemplate = async (id, host, templatesRoot) => {
    const raw = await readFile(commandTemplatePath(id, templatesRoot), 'utf8');
    const { frontmatter, body } = splitFrontmatter(raw);
    const description = frontmatterDescription(frontmatter);
    let content;
    if (host.format === 'toml') {
        const prompt = tomlSafe(body.replace(/\s*$/, '\n'));
        content = `description = ${JSON.stringify(description)}\nprompt = """\n${prompt}"""\n`;
    }
    else {
        content = raw.endsWith('\n') ? raw : `${raw}\n`;
    }
    const hash = sha256(content);
    return {
        id,
        format: host.format,
        content: `${content}${signatureLine(host.format, id, hash)}\n`,
        hash,
    };
};
const toPosix = (value) => value.split(path.sep).join('/');
/**
 * Decide the action for ONE existing artifact without writing it.
 *
 * `create` when absent; `keep` when byte-identical to the current rendering (idempotent) and when the
 * file was hand-edited after we generated it; `update` only when the file is provably one of ours
 * (its signature's hash matches its own body) and has fallen behind the current template.
 */
const decideExisting = (existing, format, current) => {
    if (existing === current.content) {
        return { action: 'keep', reason: 'ya está instalado y es byte a byte la plantilla vigente: no se toca.' };
    }
    const pattern = signaturePattern(format);
    const match = existing.match(pattern);
    const trimmed = existing.trimEnd();
    const signatureIsLastLine = match ? trimmed.endsWith(match[0].trim()) : false;
    if (!match || !signatureIsLastLine) {
        return {
            action: 'keep',
            reason: 'el archivo existe y no es una plantilla generada por open-sdd (o la firma ya no es la última línea): NO se sobrescribe, porque puede ser una edición del equipo. Bórralo o mézclalo a mano para reinstalar.',
        };
    }
    const body = existing.slice(0, existing.indexOf(match[0]));
    if (sha256(body) !== match[2]) {
        return {
            action: 'keep',
            reason: 'el archivo se generó con open-sdd pero su cuerpo ya no coincide con la firma: alguien lo editó. NO se sobrescribe; mézclalo a mano.',
        };
    }
    return {
        action: 'update',
        reason: 'el archivo es una versión anterior generada por open-sdd y no fue editada (la firma coincide): se refresca con la plantilla vigente.',
    };
};
/**
 * Plan and (with `write`) install the prompt templates for the given hosts.
 *
 * Read-only when `write` is absent: the returned artifacts are exactly what a write would do, so the
 * plan and the outcome cannot diverge. An unverified host yields a single `keep` artifact and is
 * never written into — the same rule the MCP matrix follows.
 */
export const installCommandTemplates = async (input) => {
    const cwd = path.resolve(input.cwd);
    const write = input.write === true;
    const outcome = { artifacts: [], written: [], kept: [], failures: [], details: [] };
    if (input.hosts.length === 0) {
        outcome.details.push('sin anfitriones declarados: no hay plantillas que instalar.');
        return outcome;
    }
    // Cache the rendered bodies: the same template is rendered once per run, not once per host.
    const rendered = new Map();
    const render = async (id, host) => {
        const key = `${host.id}:${id}`;
        const cached = rendered.get(key);
        if (cached)
            return cached;
        const value = await renderCommandTemplate(id, host, input.templatesRoot);
        rendered.set(key, value);
        return value;
    };
    for (const hostId of input.hosts) {
        const host = commandHostById(hostId);
        if (!host) {
            outcome.failures.push(`anfitrión desconocido en la matriz de plantillas: ${hostId}`);
            continue;
        }
        if (!host.verified || host.dir === null) {
            outcome.artifacts.push({
                host: host.id,
                command: '*',
                path: host.dir ?? '(sin directorio de comandos documentado)',
                format: host.format,
                action: 'keep',
                verified: false,
                reason: `la convención de plantillas de ${host.label} NO está verificada o no existe: open-sdd no escribe en un directorio que el anfitrión podría no leer. ${host.evidence}`,
            });
            continue;
        }
        for (const id of COMMAND_TEMPLATE_IDS) {
            const relative = toPosix(path.join(host.dir, host.fileName(id)));
            const target = path.resolve(cwd, relative);
            const escapes = path.relative(cwd, target).startsWith('..');
            if (escapes) {
                outcome.failures.push(`ruta fuera del repositorio objetivo para ${id}: ${relative}`);
                continue;
            }
            let current;
            try {
                current = await render(id, host);
            }
            catch (error) {
                outcome.failures.push(`no se pudo renderizar ${id}.md (${error.message})`);
                continue;
            }
            const existing = (await fileExists(target)) ? await readFile(target, 'utf8') : null;
            const decision = existing === null
                ? {
                    action: 'create',
                    reason: `no existe: se crea la plantilla \`${host.invocation(id)}\` para ${host.label} (convención verificada).`,
                }
                : decideExisting(existing, host.format, current);
            outcome.artifacts.push({
                host: host.id,
                command: id,
                path: relative,
                format: host.format,
                action: decision.action,
                verified: true,
                reason: decision.reason,
            });
            if (!write || decision.action === 'keep') {
                if (decision.action === 'keep')
                    outcome.kept.push(relative);
                continue;
            }
            try {
                await ensureDir(path.dirname(target));
                await writeFile(target, current.content, 'utf8');
                outcome.written.push(relative);
            }
            catch (error) {
                outcome.failures.push(`no se pudo escribir ${relative} (${error.message})`);
            }
        }
    }
    if (write) {
        outcome.details.push(`plantillas de comando instaladas sin MCP ni red: ${outcome.written.length} escrita(s), ${outcome.kept.length} conservada(s).`);
    }
    return outcome;
};
/** Planning face of the installer: no writes at all, same artifacts and reasons. */
export const planCommandTemplates = async (input) => (await installCommandTemplates({ ...input, write: false })).artifacts;
/**
 * The `init` summary for one host: one row for the whole directory.
 *
 * `create` if anything is missing, `update` if anything is stale, `keep` otherwise — so the artifact
 * list stays readable while the per-file detail lives in the outcome.
 */
export const summarizeCommandTemplates = (artifacts, hostId) => {
    const host = commandHostById(hostId);
    const forHost = artifacts.filter((artifact) => artifact.host === hostId);
    const dir = host?.dir ?? '(sin directorio de comandos documentado)';
    if (forHost.some((artifact) => artifact.action === 'create')) {
        return {
            path: dir,
            action: 'create',
            reason: `no existen (o faltan) las plantillas de comando: se escriben para que cada workflow sea un comando del anfitrión, sin MCP ni red.`,
            verified: true,
        };
    }
    if (forHost.some((artifact) => artifact.action === 'update')) {
        return {
            path: dir,
            action: 'update',
            reason: `hay plantillas generadas por open-sdd que no fueron editadas y están desactualizadas: se refrescan; las editadas a mano se conservan.`,
            verified: true,
        };
    }
    const refused = forHost.find((artifact) => !artifact.verified);
    if (refused) {
        return { path: dir, action: 'keep', reason: refused.reason, verified: false };
    }
    return {
        path: dir,
        action: 'keep',
        reason: 'las plantillas de comando ya están instaladas y sin cambios: no se tocan.',
        verified: true,
    };
};
