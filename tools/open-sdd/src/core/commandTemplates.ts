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
] as const;

export type CommandTemplateId = (typeof COMMAND_TEMPLATE_IDS)[number];

/** Bumped only when the rendering itself changes; the body hash is what detects real staleness. */
export const COMMAND_TEMPLATE_FORMAT_REVISION = 1;

// ---------------------------------------------------------------------------------------------
// Host conventions
// ---------------------------------------------------------------------------------------------

export type CommandTemplateFormat = 'markdown' | 'toml';

/**
 * The ONE token the templates are authored with, translated per host at render time.
 *
 * This used to be decoration: the matrix declared each host's native placeholder "for the reader"
 * while every artifact shipped the literal `$ARGUMENTS`. Gemini CLI, Qwen Code and Copilot therefore
 * received a token their engine never substitutes — the argument a human typed after the command was
 * silently dropped, and a prompt that reads `$ARGUMENTS` is not the prompt anyone wrote. A declared
 * field that nothing consumes is the same class of defect as a gate that resolves to an empty scan.
 */
export const ARGUMENT_PLACEHOLDER = '$ARGUMENTS';

/** The fenced block every template uses to receive the human's request. */
const INPUT_BLOCK = /```text\r?\n\$ARGUMENTS\r?\n```/;

/** What replaces the block when the host documents no placeholder at all. */
const NEUTRAL_INPUT =
  'The human’s request exactly as they typed it after the command. If it is empty, ask for it before doing anything else.';

export interface HostCommandConvention {
  /** Same id vocabulary as `HOST_INTEGRATIONS` so the two matrices cannot drift apart silently. */
  id: string;
  label: string;
  /** Repo-relative directory the host reads, or `null` when the host has no documented commands dir. */
  dir: string | null;
  /** File name for one template id (extension included). */
  fileName: (id: CommandTemplateId) => string;
  format: CommandTemplateFormat;
  /** How the user invokes it in chat. */
  invocation: (id: CommandTemplateId) => string;
  /**
   * The placeholder the host's own engine substitutes, or `null` when its documentation describes no
   * argument mechanism. `renderCommandTemplate` TRANSLATES `ARGUMENT_PLACEHOLDER` into this; it is not
   * advice for the reader. `null` renders a plain instruction instead of a token that never expands.
   */
  argumentSyntax: string | null;
  /** Where that placeholder was read: the quoted mechanism and the URL, or the URLs that did not answer. */
  argumentEvidence: string;
  /**
   * Documented per-file size limit, in characters. A rendered artifact over it is a FAILURE, never a
   * silent truncation: a prompt cut in half is worse than a prompt that was not installed.
   */
  maxChars?: number;
  /**
   * Frontmatter keys the host requires in order to read the argument at all (Junie's
   * `allowPromptArgument`, for instance). Injected, never assumed: each one is named with the page
   * that documents it in `argumentEvidence` or `evidence`.
   */
  frontmatterKeys?: Record<string, string>;
  verified: boolean;
  /** The host this row inherits from, when it is an internal fork of a verified one (see integrations). */
  forkOf?: string;
  /**
   * The artifact a SOURCE-VERIFIED row was read from, when the host publishes no documentation — an
   * extension package, for instance. A verified fork cites its OWN artifact: "my parent is verified" is
   * not evidence about the fork, and treating it as such is how a plausible path gets written blind.
   */
  sourceArtifact?: string;
  /** How we know: the documented convention, or the path open-sdd itself already installs into. */
  evidence: string;
  /** The host's own documentation page, when the convention was read from it. */
  docUrl?: string;
}

const flatMarkdown = (id: CommandTemplateId): string => `sdd-${id}.md`;

/**
 * The command-template matrix, one row per host. Kept separate from `HOST_INTEGRATIONS` (which
 * describes MCP and skills) because the two surfaces are verified independently: a host can have a
 * confirmed command directory and an unconfirmed MCP snippet, or the other way round.
 */
export const HOST_COMMAND_TEMPLATES: HostCommandConvention[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    dir: '.claude/commands',
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: '$ARGUMENTS',
    argumentEvidence:
      'VERIFIED: `https://docs.claude.com/en/docs/claude-code/slash-commands.md` (fetched, 200 text/markdown) documents the "Arguments" section with the `$ARGUMENTS` placeholder, the positional `$1`/`$2` forms, and the `argument-hint` frontmatter key that shows the expected input in the chat composer.',
    verified: true,
    evidence:
      'Claude Code documents custom slash commands as Markdown files in the commands directory, and this repository already installs its own prompt mode into `.claude/commands/sdd/` in `src/agents/registry.ts`.',
    docUrl: 'https://docs.anthropic.com/en/docs/claude-code/slash-commands',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    dir: '.cursor/commands',
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: null,
    argumentEvidence:
      'NOT DOCUMENTED as an engine substitution: `https://cursor.com/docs/customize-cursor.md` (fetched, 200 text/markdown) lists "Commands — Reusable prompts you invoke with `/` in Agent chat. Commands are markdown files that define a focused workflow or action", and describes no argument placeholder; the dedicated pages `https://cursor.com/docs/commands.md`, `https://cursor.com/docs/agent/commands.md` and `https://cursor.com/docs/customize/commands.md` all return 404. The input is therefore delivered as a plain instruction instead of a token Cursor never expands.',
    verified: true,
    evidence:
      'Cursor documents Commands as Markdown files invoked with `/` in Agent chat, and this repository already installs its own prompt mode into `.cursor/commands/sdd/`. Cursor is migrating Commands to Skills; the workspace commands directory still loads them.',
    docUrl: 'https://cursor.com/docs/customize-cursor.md',
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    dir: '.github/prompts',
    fileName: (id) => `sdd-${id}.prompt.md`,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: '${input:request}',
    argumentEvidence:
      'VERIFIED: `https://code.visualstudio.com/docs/agent-customization/prompt-files` (fetched) documents the frontmatter key `argument-hint` ("Hint text shown in the chat input field") and the body syntax `${input:variableName}` / `${input:variableName:placeholder}`, adding that "Most language models understand this syntax and will prompt for these inputs" — it is a SOFT prompt, not an engine substitution, which is exactly why the template must carry it in that form and carry `argument-hint` in its frontmatter.',
    verified: true,
    evidence:
      'VS Code documents workspace prompt files at `.github/prompts` with the `.prompt.md` extension, invoked with `/` in chat. The newer Agent Host migrates prompt files to skills; the Local agent still loads them.',
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
    argumentEvidence:
      'VERIFIED: `https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/custom-commands.md` (fetched, 200) documents "Handling arguments" with "Context-aware injection with `{{args}}`": "If your `prompt` contains the special placeholder `{{args}}`, the CLI will…". The previous `$ARGUMENTS` never reached Gemini’s engine, so the argument was dropped.',
    verified: true,
    evidence:
      'Gemini CLI documents project commands as `.toml` files under `.gemini/commands/`, with `prompt` and optional `description`; a flat file becomes `/name`, a subdirectory namespaces it.',
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
    argumentEvidence:
      'VERIFIED: `https://opencode.ai/docs/commands/` (fetched) states "Pass arguments to commands using the `$ARGUMENTS` placeholder." and shows `$ARGUMENTS` inside the Markdown body.',
    verified: true,
    evidence:
      'OpenCode documents per-project commands as Markdown files in `.opencode/commands/`, with `description` in the frontmatter and `$ARGUMENTS` in the body.',
    docUrl: 'https://opencode.ai/docs/commands/',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    dir: '.codex/prompts',
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/prompts:sdd-${id}`,
    argumentSyntax: null,
    argumentEvidence:
      'NOT DOCUMENTED and refused anyway: `https://learn.chatgpt.com/docs/custom-prompts.md` documents the prompt surface as DEPRECATED and user-scoped only (`~/.codex/prompts/*.md`), with no project commands directory, so no placeholder is claimed.',
    verified: false,
    evidence:
      'NOT VERIFIED as a repository-scoped convention: `https://learn.chatgpt.com/docs/custom-prompts.md` (fetched) documents custom prompts as DEPRECATED and only in the user home — `~/.codex/prompts/*.md`, top-level Markdown files only, invoked `/prompts:<name>` — and states they "live in your local Codex home directory (for example, `~/.codex`), so they\'re not shared through your repository". `https://learn.chatgpt.com/docs/customization/overview.md` (fetched) documents the repository-scoped surface as skills in `.agents/skills/` (global `~/.agents/skills/`), with no project commands directory. No project-scoped `.codex/prompts/` is documented, so `--write` refuses it; use the Codex skills install instead.',
    docUrl: 'https://learn.chatgpt.com/docs/custom-prompts.md',
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    dir: '.windsurf/workflows',
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: null,
    argumentEvidence:
      'NOT DOCUMENTED: `https://docs.devin.ai/desktop/cascade/workflows.md` (fetched, 200 text/markdown) documents the workflow file, its title/description and its steps, and mentions no argument placeholder at all. The input is delivered as a plain instruction rather than as a token Windsurf never expands.',
    maxChars: 12_000,
    verified: true,
    evidence:
      'Windsurf documentation (docs.windsurf.com now 308-redirects to docs.devin.ai) documents workflows as Markdown files in `.windsurf/workflows/`, each carrying a title/description and a series of steps, invoked in Cascade as `/[name-of-workflow]`. The same page documents the global location `~/.codeium/windsurf/global_workflows/` and the OS-specific system locations, and a 12,000-character per-file limit that every shipped template stays under. `.windsurf/workflows/` is the legacy path but is still read; the migration page names `.devin/workflows/` as the newer preferred path.',
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
    argumentEvidence:
      'VERIFIED: `https://raw.githubusercontent.com/QwenLM/qwen-code/main/docs/users/features/commands.md` (fetched, 200) states "Use {{args}} for parameter injection." and tabulates "Context-aware Injection — `{{args}}`". The previous `$ARGUMENTS` was never injected by Qwen Code.',
    verified: true,
    evidence:
      'Qwen Code documents custom commands as Markdown files with optional YAML frontmatter (`description`) under `<project root>/.qwen/commands/` (flat file `sdd-<id>.md` becomes `/sdd-<id>`; a subdirectory would namespace it `/dir:name`), with `{{args}}` for parameter injection and project commands taking priority over `~/.qwen/commands/`. The documentation states TOML is deprecated but still supported pending automatic migration, so this matrix now writes Markdown (`sdd-<id>.md`) rather than the deprecated `sdd-<id>.toml`.',
    docUrl: 'https://raw.githubusercontent.com/QwenLM/qwen-code/main/docs/users/features/commands.md',
  },
  {
    id: 'antigravity',
    label: 'Google Antigravity',
    dir: '.agents/workflows',
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: null,
    argumentEvidence:
      'NOT DOCUMENTED: `https://antigravity.google/docs/migration/workflows-to-skills.md` (fetched, 200 text/markdown) documents the workflow file (`name`, `description`, step body), the 12,000-character limit and the migration to Agent Skills, and mentions no argument placeholder. The input is delivered as a plain instruction rather than as a token Antigravity never expands.',
    maxChars: 12_000,
    verified: true,
    evidence:
      'Antigravity documents legacy workflows as single Markdown files with YAML frontmatter (`name`, `description`) plus a step body, at `.agents/workflows/<name>.md` (workspace) or `~/.gemini/config/workflows/<name>.md` (global), invoked in chat as `/<workflow-name>`, limited to 12,000 characters each. Note the documented directory is the PLURAL `.agents/workflows/`, not the `.agent/workflows/` this matrix previously assumed. The same page deprecates workflows with a stated retirement of 2026-11-01 in favour of Agent Skills at `.agents/skills/<name>/SKILL.md`; the Antigravity skills layout this repository already ships is that successor.',
    docUrl: 'https://antigravity.google/docs/migration/workflows-to-skills.md',
  },
  {
    id: 'zed',
    label: 'Zed',
    dir: null,
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `@AGENTS.md run the sdd-${id} workflow`,
    argumentSyntax: null,
    argumentEvidence:
      'No documented command directory exists, so no placeholder is claimed: `https://zed.dev/docs/ai/skills.md` (fetched) documents slash commands as coming from Agent Skills and `https://zed.dev/docs/ai/instructions.md` (fetched) documents `AGENTS.md`, with no prompt-file directory in either. The host reads `AGENTS.md` instead and the workflow is referenced from there.',
    verified: false,
    evidence:
      'NOT VERIFIED and no documented prompt/command directory: `https://zed.dev/docs/ai/skills.md` (fetched) documents Zed\'s slash commands as coming from Agent Skills (`SKILL.md` bundles, project or user scope), and `https://zed.dev/docs/ai/instructions.md` (fetched) documents `AGENTS.md` plus legacy `.rules` files as the instruction surface. Neither page documents a directory of Markdown prompt/command files, so there is nothing for the prompt-template installer to write and `--write` refuses it; use the Zed skills layout or reference the workflow from AGENTS.md.',
    docUrl: 'https://zed.dev/docs/ai/skills.md',
  },
  {
    id: 'cline',
    label: 'Cline',
    dir: null,
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: null,
    argumentEvidence:
      'No documented prompt/command directory exists, so no placeholder is claimed: `https://docs.cline.bot/core-workflows/using-commands.md` (fetched) lists only built-in slash commands, and `https://docs.cline.bot/customization/skills.md` (fetched) puts customization in skill directories, where no argument placeholder is documented.',
    verified: false,
    evidence:
      'NOT VERIFIED and no documented prompt/command directory: `https://docs.cline.bot/core-workflows/using-commands.md` (fetched) lists only built-in slash commands (`/newtask`, `/smol`, `/newrule`, `/deep-planning`, `/reportbug`) plus enabled skills triggered by slash command; `https://docs.cline.bot/customization/skills.md` (fetched) documents the customization surface as skill directories in `.cline/skills/` (or `.clinerules/skills/`, global `~/.cline/skills/`) with a `SKILL.md` each; `https://docs.cline.bot/customization/cline-rules.md` (fetched) documents `.clinerules/` and `.cline/rules/` for rules only. No `.clinerules/workflows/` prompt directory is documented, so no directory is declared and `--write` refuses it.',
    docUrl: 'https://docs.cline.bot/core-workflows/using-commands.md',
  },
  {
    id: 'factory-droid',
    label: 'Factory Droid',
    dir: '.factory/commands',
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: '$ARGUMENTS',
    argumentEvidence:
      'VERIFIED: `https://docs.factory.ai/harness/custom-slash-commands.md` (fetched) documents project commands in `<repo>/.factory/commands/`, invoked `/command-name args`, with the `$ARGUMENTS` placeholder (and notes that `$1`/`$2` are NOT supported in the Markdown form).',
    verified: true,
    evidence:
      'Factory Droid documents custom slash commands as Markdown files in `.factory/commands/` (user scope `~/.factory/commands/`), with optional YAML frontmatter (`description`, `argument-hint`), invoked as `/command-name`.',
    docUrl: 'https://docs.factory.ai/harness/custom-slash-commands.md',
  },
  {
    id: 'roo-code',
    label: 'Roo Code',
    dir: '.roo/commands',
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: null,
    argumentEvidence:
      'NOT DOCUMENTED as an engine substitution: `https://roocodeinc.github.io/Roo-Code/features/slash-commands` (fetched) documents project commands in `.roo/commands/` (global `~/.roo/commands/`) as Markdown files with frontmatter, and `argument-hint` is display-only — there is no placeholder the engine substitutes, so the input arrives as a plain instruction.',
    verified: true,
    evidence:
      'Roo Code documents project slash commands as Markdown files in `.roo/commands/`, invoked `/name`.',
    docUrl: 'https://roocodeinc.github.io/Roo-Code/features/slash-commands',
  },
  {
    id: 'kilo-code',
    label: 'Kilo Code',
    dir: '.kilo/commands',
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: null,
    argumentEvidence:
      'NOT DOCUMENTED as an engine substitution: `https://kilocode.ai/docs/llms.txt` → `## Source: /customize/workflows` (fetched) documents project commands in `.kilo/commands/` (global `~/.config/kilo/commands/`) as Markdown files with frontmatter, and no argument placeholder; the page states there is no character limit on rule files.',
    verified: true,
    evidence:
      'Kilo Code documents project workflow files as Markdown in `.kilo/commands/`, invoked `/name`.',
    docUrl: 'https://kilocode.ai/docs/llms.txt',
  },
  {
    id: 'junie',
    label: 'JetBrains Junie',
    dir: '.junie/commands',
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: '$prompt',
    argumentEvidence:
      'VERIFIED: `https://junie.jetbrains.com/docs/custom-slash-commands.html` (fetched) documents project commands in `.junie/commands/` and NAMED placeholders (`$argumentName`); free-form input is opt-in — "add `allowPromptArgument: true` to the command\'s YAML frontmatter. This exposes an additional `$prompt` argument" — so the canonical block is rendered as `$prompt` and the frontmatter key is injected.',
    frontmatterKeys: { allowPromptArgument: 'true' },
    verified: true,
    evidence:
      'JetBrains Junie documents project slash commands as Markdown files in `.junie/commands/` (user `~/.junie/commands/`), invoked `/name`.',
    docUrl: 'https://junie.jetbrains.com/docs/custom-slash-commands.html',
  },
  {
    id: 'mimocode',
    label: 'MiMoCode (Xiaomi)',
    dir: '.mimocode/commands',
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: '$ARGUMENTS',
    argumentEvidence:
      'VERIFIED: `https://mimo.xiaomi.com/mimocode/commands` (fetched) documents project commands in `.mimocode/commands/` (global `~/.config/mimocode/commands/`), "Place them in: Global … Per-project `.mimocode/commands/`", invoked `/test`, with `$ARGUMENTS`, `$1`..`$N`, `` !`cmd` `` and `@file`.',
    verified: true,
    evidence:
      'MiMoCode documents custom commands as Markdown files in `.mimocode/commands/` with YAML frontmatter (`description`, `agent`, `model`), invoked `/name`.',
    docUrl: 'https://mimo.xiaomi.com/mimocode/commands',
  },
  {
    id: 'iflow',
    label: 'iFlow CLI',
    dir: '.iflow/commands',
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: '{{args}}',
    argumentEvidence:
      'VERIFIED: `https://raw.githubusercontent.com/iflow-ai/iflow-cli/main/docs_en/examples/subcommand.md` (fetched) documents project commands in `.iflow/commands/` (global `~/.iflow/commands/`, project wins) as `<name>.toml` (description + prompt) or `<name>.md` (frontmatter description), invoked `/command-name`, with the `{{args}}` placeholder — the same token Gemini CLI and Qwen Code use.',
    verified: true,
    evidence:
      'iFlow CLI documents project commands in `.iflow/commands/`, invoked `/command-name`; `--write` uses the Markdown form, which the same page documents.',
    docUrl: 'https://raw.githubusercontent.com/iflow-ai/iflow-cli/main/docs_en/examples/subcommand.md',
  },
  {
    id: 'zcode',
    label: 'ZCode (Z.ai)',
    dir: '.zcode/commands',
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: '$ARGUMENTS',
    argumentEvidence:
      'SOURCE-VERIFIED, not documented: `https://zcode.z.ai/en/docs/commands` (fetched) states only that "workspace-level commands live in the project directory"; the exact path comes from the vendor\'s own resolver at `https://raw.githubusercontent.com/zai-org/ZCode/main/apps/zcode-cli/packages/adapters/src/commands/roots.ts`, which resolves `<base>/.zcode/commands` and `<base>/.agents/commands` per directory up to the worktree root, and `$ARGUMENTS` from `packages/contracts/src/commands/index.ts`. The evidence names the source file so a reader can re-check it.',
    verified: true,
    evidence:
      'ZCode documents commands (user scope `~/.zcode/commands` verified) and its own resolver computes the project path `.zcode/commands`; the docs do not state the project path, so this row is SOURCE-VERIFIED and says so.',
    docUrl: 'https://zcode.z.ai/en/docs/commands',
  },
  {
    id: 'augment',
    label: 'Augment Code',
    dir: '.augment/commands',
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: '$ARGUMENTS',
    argumentEvidence:
      'VERIFIED: `https://docs.augmentcode.com/using-augment/custom-commands.md` (fetched, and note that this Mintlify host serves real Markdown bodies on 404 — always check the status) documents project commands in `.augment/commands/` (user `~/.augment/commands/`), invoked `/name` with `dir:name` namespacing, with `$ARGUMENTS`.',
    verified: true,
    evidence:
      'Augment Code documents custom commands as Markdown files in `.augment/commands/` with frontmatter (`description`, `argument-hint`, `model`).',
    docUrl: 'https://docs.augmentcode.com/using-augment/custom-commands.md',
  },
  {
    id: 'trae',
    label: 'Trae (ByteDance)',
    dir: '.trae/commands',
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: null,
    argumentEvidence:
      'NOT DOCUMENTED as an engine substitution: `https://docs.trae.ai/ide/slash-commands?_lang=en` (the SPA embeds its doc body as Quill-delta JSON in the served HTML, so it is readable without JS) documents project commands in `.trae/commands/` (up to three nesting levels) as `<name>.md` with the description below the frontmatter, invoked `/name`, and describes no argument placeholder.',
    verified: true,
    evidence:
      'Trae documents project slash commands as Markdown files in `.trae/commands/`, invoked `/name`; project rules are read from AGENTS.md once the toggle is on and are referenced as `#Rule`.',
    docUrl: 'https://docs.trae.ai/ide/slash-commands?_lang=en',
  },
  {
    id: 'qoder',
    label: 'Qoder (Alibaba)',
    dir: '.qoder/commands',
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: null,
    argumentEvidence:
      'NOT DOCUMENTED as an engine substitution: `https://docs.qoder.com/user-guide/commands.md` (fetched; note that this host gzip-encodes without `Content-Encoding`, so `curl --compressed` is required) documents project commands in `.qoder/commands/` as Markdown with `name` and `description` frontmatter, invoked `/name` (nested commands become `/git:commit`), and describes no placeholder. Qoder is the current name of Tongyi Lingma.',
    verified: true,
    evidence:
      'Qoder documents project commands in `.qoder/commands/` with `name`+`description` frontmatter, invoked `/name`; skills live in `.qoder/skills/` and rules in `.qoder/rules/` (with a documented 100,000-character budget across ALL active rule files).',
    docUrl: 'https://docs.qoder.com/user-guide/commands.md',
  },
  {
    id: 'codebuddy',
    label: 'CodeBuddy (Tencent)',
    dir: '.codebuddy/commands',
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: '$ARGUMENTS',
    argumentEvidence:
      'VERIFIED: `https://www.codebuddy.ai/docs/cli/slash-commands` (fetched; VitePress) documents project commands in `.codebuddy/commands/` as `<name>.md` with `argument-hint` frontmatter, nested commands becoming `/frontend:build`, and the `$ARGUMENTS` placeholder alongside `$1`..`$N`.',
    verified: true,
    evidence:
      'CodeBuddy documents project slash commands as Markdown files in `.codebuddy/commands/`, invoked `/name`; native instructions live in CODEBUDDY.md with AGENTS.md as fallback only when CODEBUDDY.md is absent.',
    docUrl: 'https://www.codebuddy.ai/docs/cli/slash-commands',
  },
  {
    id: 'continue-dev',
    label: 'Continue.dev',
    dir: null,
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: null,
    argumentEvidence:
      'Sin marcador que declarar mientras no haya directorio: la documentacion de Continue dice lo contrario de un placeholder — "type `/`, select the prompt, and type out any additional instructions you would like to add" (`https://raw.githubusercontent.com/continuedev/continue/main/docs/customize/deep-dives/prompts.mdx`, fetched).',
    verified: false,
    evidence:
      'NOT VERIFIED y con una trampa nombrada: `https://raw.githubusercontent.com/continuedev/continue/main/docs/customize/deep-dives/prompts.mdx` (fetched) documenta prompts como Markdown con frontmatter, pero NO declara ningun directorio de proyecto, y el canal alternativo que si documenta es de configuracion (`config.yaml`, `prompts:`), no un dot-directory. Se descargaron y greparon los 153 ficheros Markdown/MDX de `docs/` del repositorio del fabricante: la cadena `.continue/prompts` aparece CERO veces y la extension `.prompt` no se documenta en ninguna. Los caminos `.continue/<x>` que SI se documentan son rules, config, mcpServers, permissions, logs, models, index, configs, session, rule, dev y agents. NO se escribe en `.continue/prompts/` por muy extendida que este esa costumbre: no esta documentada.',
    docUrl: 'https://raw.githubusercontent.com/continuedev/continue/main/docs/customize/deep-dives/prompts.mdx',
  },
  {
    id: 'kimi-code',
    label: 'Kimi Code CLI (Moonshot)',
    dir: null,
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: null,
    argumentEvidence:
      'Sin marcador que declarar mientras no haya directorio de comandos: la convencion no existe y un placeholder seria una invencion; la documentacion revisada esta en `https://moonshotai.github.io/kimi-code/llms.txt` (fetched).',
    verified: false,
    evidence:
      'NOT VERIFIED y con la prueba del silencio: el indice completo de su propia documentacion (`https://moonshotai.github.io/kimi-code/llms.txt`, fetched) NO tiene pagina de comandos, y la pagina de barra dice que son "built-in control commands": un `/x` desconocido se envia como mensaje normal. NO existe directorio de comandos de proyecto, y por eso su integracion es skills + MCP, no plantillas.',
    docUrl: 'https://moonshotai.github.io/kimi-code/llms.txt',
  },
  {
    id: 'crush',
    label: 'Crush (Charm)',
    dir: null,
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: null,
    argumentEvidence:
      'Sin marcador que declarar mientras no haya directorio de comandos: la convencion no existe y un placeholder seria una invencion; la documentacion revisada esta en `https://raw.githubusercontent.com/charmbracelet/crush/main/README.md` (fetched).',
    verified: false,
    evidence:
      'NOT VERIFIED: su README (`https://raw.githubusercontent.com/charmbracelet/crush/main/README.md`, fetched) documenta las Agent Skills y el contexto de proyecto, y NO documenta comandos personalizados ni un directorio donde definirlos. Su superficie en este proyecto es MCP + skills.',
    docUrl: 'https://raw.githubusercontent.com/charmbracelet/crush/main/README.md',
  },
  {
    id: 'amp',
    label: 'Amp (Sourcegraph)',
    dir: null,
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: null,
    argumentEvidence:
      'Sin marcador que declarar mientras no haya directorio de comandos: la convencion no existe y un placeholder seria una invencion; la documentacion revisada esta en `https://ampcode.com/llms.txt` (fetched).',
    verified: false,
    evidence:
      'NOT VERIFIED por decision del fabricante: la propia documentacion dice "You do not need a slash command" (`https://ampcode.com/llms.txt`, fetched, indice de sus 54 paginas). No hay comandos de barra ni directorio de comandos: su superficie son las Agent Skills y AGENTS.md.',
    docUrl: 'https://ampcode.com/llms.txt',
  },
  {
    id: 'warp',
    label: 'Warp',
    dir: null,
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: null,
    argumentEvidence:
      'Sin marcador que declarar mientras no haya directorio de comandos: la convencion no existe y un placeholder seria una invencion; la documentacion revisada esta en `https://docs.warp.dev/_llms-txt/agents.txt` (fetched).',
    verified: false,
    evidence:
      'NOT VERIFIED: la copia para agentes de su documentacion (`https://docs.warp.dev/_llms-txt/agents.txt`, fetched) documenta `.warp/.mcp.json`, las diez rutas de skills y las reglas, y NO un directorio de comandos de proyecto (sus prompts viven en Warp Drive, en la nube). Su superficie aqui es MCP + skills.',
    docUrl: 'https://docs.warp.dev/_llms-txt/agents.txt',
  },
  {
    id: 'goose',
    label: 'Goose (Block)',
    dir: null,
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: null,
    argumentEvidence:
      'Sin marcador que declarar mientras no haya directorio de comandos: la convencion no existe y un placeholder seria una invencion; la documentacion revisada esta en `https://goose-docs.ai/docs/guides/context-engineering/using-skills.md` (fetched).',
    verified: false,
    evidence:
      'NOT VERIFIED: su superficie documentada son las RECIPES (`.goose/recipes/`, ficheros YAML/JSON) y las skills, no comandos (`https://goose-docs.ai/docs/guides/context-engineering/using-skills.md`, fetched). Una recipe se invoca desde el mapa de `recipe_path` de la configuracion GLOBAL, que no es una convencion de proyecto: no se escribe ninguna.',
    docUrl: 'https://goose-docs.ai/docs/guides/context-engineering/using-skills.md',
  },
  {
    id: 'openhands',
    label: 'OpenHands',
    dir: null,
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: null,
    argumentEvidence:
      'Sin marcador que declarar mientras no haya directorio de comandos: la convencion no existe y un placeholder seria una invencion; la documentacion revisada esta en `https://docs.openhands.dev/` (fetched).',
    verified: false,
    evidence:
      'NOT VERIFIED: los comandos existen dentro de PAQUETES de plugin (`commands/<n>.md` con frontmatter `name: /x`), no como convencion de proyecto; su documentacion (`https://docs.openhands.dev/`, fetched por la investigacion) documenta AGENTS.md, las skills y `~/.openhands/mcp.json`, y ningun directorio de comandos del repositorio. Su superficie aqui son las skills.',
    docUrl: 'https://docs.openhands.dev/',
  },
  {
    id: 'dsh',
    label: 'DeepSeek Harness (dsh)',
    dir: null,
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: null,
    argumentEvidence:
      'Sin marcador que declarar mientras no haya directorio de comandos: la convencion no existe y un placeholder seria una invencion; la documentacion revisada esta en `https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/subsystems/commands.md` (fetched).',
    verified: false,
    evidence:
      'NOT VERIFIED y con la cita del fabricante: `https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/subsystems/commands.md` (fetched) describe los comandos como "Plugin-owned command registration", es decir, se registran por plugin y no hay directorio de ficheros de prompt en ninguna parte de su documentacion. Su superficie aqui son las skills y AGENTS.md.',
    docUrl: 'https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/subsystems/commands.md',
  },
  {
    id: 'aider',
    label: 'Aider',
    dir: null,
    fileName: flatMarkdown,
    format: 'markdown',
    invocation: (id) => `/sdd-${id}`,
    argumentSyntax: null,
    argumentEvidence:
      'Sin marcador que declarar mientras no haya directorio de comandos: la convencion no existe y un placeholder seria una invencion; la documentacion revisada esta en `https://aider.chat/docs/usage/conventions.html` (fetched).',
    verified: false,
    evidence:
      'NOT VERIFIED tras revisar sus 84 paginas de documentacion: no hay comandos personalizados (solo los `/` incorporados), ni skills, ni MCP. Su unica superficie de integracion es el fichero de convenciones (`.aider.conf.yml` -> `read: CONVENTIONS.md`), documentado en `https://aider.chat/docs/usage/conventions.html` (fetched), y AGENTS.md aparece CERO veces en toda su documentacion. Es un rechazo, no un hueco pendiente.',
    docUrl: 'https://aider.chat/docs/usage/conventions.html',
  },
];

export const commandHostById = (id: string): HostCommandConvention | undefined =>
  HOST_COMMAND_TEMPLATES.find((host) => host.id === id);

/**
 * Which command-template host an agent-registry id belongs to.
 *
 * `init` detects an agent (for example `claude-code-skills`), while this matrix is keyed by host
 * (`claude-code`). The mapping is explicit so a new agent entry cannot silently fall through to the
 * wrong directory.
 */
const AGENT_HOST: Record<string, string> = {
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
  'factory-droid': 'factory-droid',
  'roo-code': 'roo-code',
  'kilo-code': 'kilo-code',
  junie: 'junie',
  mimocode: 'mimocode',
  iflow: 'iflow',
  zcode: 'zcode',
  augment: 'augment',
  trae: 'trae',
  qoder: 'qoder',
  codebuddy: 'codebuddy',
};

export const hostForAgent = (agent: string): string | undefined => AGENT_HOST[agent];

// ---------------------------------------------------------------------------------------------
// Rendering: template file -> host artifact
// ---------------------------------------------------------------------------------------------

/** The shipped templates live at `<package>/templates/commands`; the path is stable in dist and src. */
export const commandTemplatesDir = (templatesRoot?: string): string => {
  if (templatesRoot) return path.join(templatesRoot, 'commands');
  return fileURLToPath(new URL('../../templates/commands', import.meta.url));
};

export const commandTemplatePath = (id: CommandTemplateId, templatesRoot?: string): string =>
  path.join(commandTemplatesDir(templatesRoot), `${id}.md`);

const splitFrontmatter = (raw: string): { frontmatter: string; body: string } => {
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) return { frontmatter: '', body: raw };
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: '', body: raw };
  return { frontmatter: match[1], body: raw.slice(match[0].length) };
};

const frontmatterDescription = (frontmatter: string): string => {
  const line = frontmatter.split(/\r?\n/).find((entry) => entry.startsWith('description:'));
  if (!line) return '';
  return line.slice('description:'.length).trim().replace(/^["']|["']$/g, '');
};

/**
 * One frontmatter list (`key:` followed by `  - "value"` entries), or `[]` for the inline empty list.
 *
 * The frontmatter is a narrow YAML subset this project authors itself, so the parser is deliberately
 * narrow too: it reads the block list and stops at the first line that leaves it. Anything richer
 * would be a YAML implementation pretending to be a list reader.
 */
const frontmatterList = (frontmatter: string, key: string): string[] => {
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (start < 0) return [];
  if (lines[start].slice(key.length + 1).trim() === '[]') return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^\s+-\s/.test(line)) break;
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

/**
 * The catalogue a human reads to learn what a repository is about to get.
 *
 * `commands` is the load-bearing field: those are the engine invocations the template's frontmatter
 * declares, and `test/cliWiring.test.ts` proves every command the CLI names is really dispatched. A
 * prompt that promised a check this engine cannot run would show up here as a name that fails that
 * suite — which is the whole difference between a document and a control.
 */
export interface CommandTemplateCatalogueEntry {
  id: CommandTemplateId;
  description: string;
  /** Repo-relative artifacts the template may write; empty means the workflow is read-only. */
  writes: string[];
  readOnly: boolean;
  parallelSafe: boolean;
  commands: string[];
}

/** Read the shipped templates and parse their contract out of the frontmatter, in inventory order. */
export const readCommandTemplateCatalogue = async (
  templatesRoot?: string,
): Promise<CommandTemplateCatalogueEntry[]> => {
  const entries: CommandTemplateCatalogueEntry[] = [];
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

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const signatureLine = (format: CommandTemplateFormat, id: CommandTemplateId, hash: string): string =>
  format === 'toml'
    ? `# open-sdd:command-template id=${id} sha256=${hash}`
    : `<!-- open-sdd:command-template id=${id} sha256=${hash} -->`;

const signaturePattern = (format: CommandTemplateFormat): RegExp =>
  format === 'toml'
    ? /^# open-sdd:command-template id=([a-z-]+) sha256=([0-9a-f]{64})\s*$/m
    : /^<!-- open-sdd:command-template id=([a-z-]+) sha256=([0-9a-f]{64}) -->\s*$/m;

/** A `"""` inside a TOML literal string would terminate it early; our bodies do not contain one. */
const tomlSafe = (value: string): string => value.replace(/"""/g, '\\"\\"\\"');

export interface RenderedTemplate {
  id: CommandTemplateId;
  format: CommandTemplateFormat;
  /** The text the host consumes, including the signature line. */
  content: string;
  /** The hash recorded in the signature, over `content` minus the signature line. */
  hash: string;
  /** Code points in `content`, measured against the host's documented limit when it publishes one. */
  chars: number;
  /** The placeholder this artifact carries, or `null` when it carries the plain instruction instead. */
  argumentSyntax: string | null;
}

/**
 * Deliver the human's input in the form THIS host actually substitutes.
 *
 * Three cases, and the third is the one that was wrong: the host documents a different placeholder
 * (translate); the host's own placeholder is the canonical one (the body already carries it); the host
 * documents none (replace the fenced block with a plain instruction). Leaving a token the engine never
 * expands is what let Gemini CLI, Qwen Code and Copilot silently drop the argument.
 */
const translateInput = (raw: string, host: HostCommandConvention): string => {
  if (host.argumentSyntax === null) return raw.replace(INPUT_BLOCK, NEUTRAL_INPUT);
  if (host.argumentSyntax === ARGUMENT_PLACEHOLDER) return raw;
  return raw.split(ARGUMENT_PLACEHOLDER).join(host.argumentSyntax);
};

/**
 * Inject the frontmatter keys a host needs in order to read the argument at all.
 *
 * Junie is the case that forced this: it only exposes `$prompt` when the command's frontmatter says
 * `allowPromptArgument: true`, so rendering the token without the key would be a token that is never
 * substituted. Keys are injected (or replaced in place) and never invented: the page that documents
 * each one is named in the row's evidence.
 */
const adaptFrontmatter = (raw: string, host: HostCommandConvention, format: CommandTemplateFormat): string => {
  if (format !== 'markdown' || !host.frontmatterKeys) return raw;
  const entries = Object.entries(host.frontmatterKeys);
  if (entries.length === 0) return raw;
  const { frontmatter, body } = splitFrontmatter(raw);
  if (frontmatter === '') return raw;
  const lines = frontmatter.split(/\r?\n/);
  for (const [key, value] of entries) {
    const line = `${key}: ${value}`;
    const at = lines.findIndex((entry) => entry.startsWith(`${key}:`));
    if (at >= 0) lines[at] = line;
    else lines.push(line);
  }
  return `---\n${lines.join('\n')}\n---\n${body}`;
};

/**
 * Render one template for one host. Markdown hosts receive the file as authored (frontmatter
 * included, because `description` is meaningful to them); TOML hosts receive the `description` key
 * plus the body as the multi-line `prompt` value. In both cases the input is translated first.
 */
export const renderCommandTemplate = async (
  id: CommandTemplateId,
  host: HostCommandConvention,
  templatesRoot?: string,
): Promise<RenderedTemplate> => {
  const raw = await readFile(commandTemplatePath(id, templatesRoot), 'utf8');
  const translated = adaptFrontmatter(translateInput(raw, host), host, host.format);
  const { frontmatter, body } = splitFrontmatter(translated);
  const description = frontmatterDescription(frontmatter);

  let content: string;
  if (host.format === 'toml') {
    const prompt = tomlSafe(body.replace(/\s*$/, '\n'));
    content = `description = ${JSON.stringify(description)}\nprompt = """\n${prompt}"""\n`;
  } else {
    content = translated.endsWith('\n') ? translated : `${translated}\n`;
  }

  const hash = sha256(content);
  const full = `${content}${signatureLine(host.format, id, hash)}\n`;
  return {
    id,
    format: host.format,
    content: full,
    hash,
    chars: [...full].length,
    argumentSyntax: host.argumentSyntax,
  };
};

// ---------------------------------------------------------------------------------------------
// Install: create / update / keep, never clobber
// ---------------------------------------------------------------------------------------------

export interface CommandTemplateArtifact {
  host: string;
  /** `*` marks the single host-level refusal for an unverified convention. */
  command: CommandTemplateId | '*';
  /** POSIX path relative to the target repository (or the declared directory when refused). */
  path: string;
  format: CommandTemplateFormat;
  action: 'create' | 'update' | 'keep';
  verified: boolean;
  reason: string;
}

export interface InstallCommandTemplatesInput {
  cwd: string;
  hosts: string[];
  write?: boolean;
  templatesRoot?: string;
}

export interface CommandTemplatesOutcome {
  artifacts: CommandTemplateArtifact[];
  written: string[];
  kept: string[];
  failures: string[];
  details: string[];
}

const toPosix = (value: string): string => value.split(path.sep).join('/');

/**
 * Decide the action for ONE existing artifact without writing it.
 *
 * `create` when absent; `keep` when byte-identical to the current rendering (idempotent) and when the
 * file was hand-edited after we generated it; `update` only when the file is provably one of ours
 * (its signature's hash matches its own body) and has fallen behind the current template.
 */
const decideExisting = (
  existing: string,
  format: CommandTemplateFormat,
  current: RenderedTemplate,
): { action: 'update' | 'keep'; reason: string } => {
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
      reason:
        'el archivo existe y no es una plantilla generada por open-sdd (o la firma ya no es la última línea): NO se sobrescribe, porque puede ser una edición del equipo. Bórralo o mézclalo a mano para reinstalar.',
    };
  }

  const body = existing.slice(0, existing.indexOf(match[0]));
  if (sha256(body) !== match[2]) {
    return {
      action: 'keep',
      reason:
        'el archivo se generó con open-sdd pero su cuerpo ya no coincide con la firma: alguien lo editó. NO se sobrescribe; mézclalo a mano.',
    };
  }

  return {
    action: 'update',
    reason:
      'el archivo es una versión anterior generada por open-sdd y no fue editada (la firma coincide): se refresca con la plantilla vigente.',
  };
};

/**
 * Plan and (with `write`) install the prompt templates for the given hosts.
 *
 * Read-only when `write` is absent: the returned artifacts are exactly what a write would do, so the
 * plan and the outcome cannot diverge. An unverified host yields a single `keep` artifact and is
 * never written into — the same rule the MCP matrix follows.
 */
export const installCommandTemplates = async (
  input: InstallCommandTemplatesInput,
): Promise<CommandTemplatesOutcome> => {
  const cwd = path.resolve(input.cwd);
  const write = input.write === true;
  const outcome: CommandTemplatesOutcome = { artifacts: [], written: [], kept: [], failures: [], details: [] };

  if (input.hosts.length === 0) {
    outcome.details.push('sin anfitriones declarados: no hay plantillas que instalar.');
    return outcome;
  }

  // Cache the rendered bodies: the same template is rendered once per run, not once per host.
  const rendered = new Map<string, RenderedTemplate>();
  const render = async (id: CommandTemplateId, host: HostCommandConvention): Promise<RenderedTemplate> => {
    const key = `${host.id}:${id}`;
    const cached = rendered.get(key);
    if (cached) return cached;
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

      let current: RenderedTemplate;
      try {
        current = await render(id, host);
      } catch (error) {
        outcome.failures.push(`no se pudo renderizar ${id}.md (${(error as Error).message})`);
        continue;
      }

      // Un límite documentado por el anfitrión no es un consejo: una plantilla que se pasa NO se
      // escribe recortada (un prompt truncado es peor que uno no instalado) ni se escribe entera
      // fingiendo que cabe. Se nombra el número y se deja el hueco declarado.
      if (host.maxChars !== undefined && current.chars > host.maxChars) {
        outcome.failures.push(
          `${host.label} documenta un límite de ${host.maxChars.toLocaleString('en-US')} caracteres por archivo y ${relative} tendría ${current.chars.toLocaleString('en-US')}: NO se escribe.`,
        );
        continue;
      }

      const existing = (await fileExists(target)) ? await readFile(target, 'utf8') : null;
      const decision: { action: 'create' | 'update' | 'keep'; reason: string } =
        existing === null
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
        if (decision.action === 'keep') outcome.kept.push(relative);
        continue;
      }

      try {
        await ensureDir(path.dirname(target));
        await writeFile(target, current.content, 'utf8');
        outcome.written.push(relative);
      } catch (error) {
        outcome.failures.push(`no se pudo escribir ${relative} (${(error as Error).message})`);
      }
    }
  }

  if (write) {
    outcome.details.push(
      `plantillas de comando instaladas sin MCP ni red: ${outcome.written.length} escrita(s), ${outcome.kept.length} conservada(s).`,
    );
  }

  return outcome;
};

/** Planning face of the installer: no writes at all, same artifacts and reasons. */
export const planCommandTemplates = async (
  input: Omit<InstallCommandTemplatesInput, 'write'>,
): Promise<CommandTemplateArtifact[]> => (await installCommandTemplates({ ...input, write: false })).artifacts;

/**
 * The `init` summary for one host: one row for the whole directory.
 *
 * `create` if anything is missing, `update` if anything is stale, `keep` otherwise — so the artifact
 * list stays readable while the per-file detail lives in the outcome.
 */
export const summarizeCommandTemplates = (
  artifacts: CommandTemplateArtifact[],
  hostId: string,
): { path: string; action: 'create' | 'update' | 'keep'; reason: string; verified: boolean } => {
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
