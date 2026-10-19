import { INSTALL_COMMAND } from '../cli/packageIdentity.js';

export interface AgentLayoutDefaults {
  commandsDir: string;
  agentDir: string;
  docFile: string;
}

export interface AgentCommandHints {
  spec: string;
  steering: string;
  steeringCustom: string;
}

export interface AgentCompletionGuide {
  prependSteps?: string[];
  appendSteps?: string[];
}

export interface AgentDefinition {
  label: string;
  description: string;
  aliasFlags: string[];
  recommendedModels?: string[];
  layout: AgentLayoutDefaults;
  commands: AgentCommandHints;
  manifestId?: string;
  completionGuide?: AgentCompletionGuide;
  templateFallbacks?: Record<string, string>;
  upgradeNotice?: string;
}

const makeUpgradeNotice = (flag: string): string =>
  `This mode will be removed in a future release. Migrate now: ${INSTALL_COMMAND} ${flag}`;

export const agentDefinitions = {
  'claude-code': {
    label: 'Claude Code',
    description:
      'Installs sdd prompts in `.claude/commands/sdd/`, shared settings in `{{SDD_DIR}}/settings/` (default `.sdd/settings/`), and an AGENTS.md quickstart.',
    aliasFlags: ['--claude-code', '--claude'],
    recommendedModels: ['Planning / review: Claude Opus 4.6 or newer', 'Implementation: Claude Sonnet 4.6 or newer'],
    layout: {
      commandsDir: '.claude/commands/sdd',
      agentDir: '.claude',
      docFile: 'CLAUDE.md',
    },
    commands: {
      spec: '`/sdd:spec-init <what-to-build>`',
      steering: '`/sdd:steering`',
      steeringCustom: '`/sdd:steering-custom <what-to-create-custom-steering-document>`',
    },
    upgradeNotice: makeUpgradeNotice('--claude-skills'),
    templateFallbacks: {
      'CLAUDE.md': '../../CLAUDE.md',
    },
    manifestId: 'claude-code',
  },
  'claude-code-agent': {
    label: 'Claude Code Agents',
    description:
      'Installs sdd prompts in `.claude/commands/sdd/`, a Claude agent library in `.claude/agents/sdd/`, shared settings in `{{SDD_DIR}}/settings/`, and a CLAUDE.md quickstart.',
    aliasFlags: ['--claude-code-agent', '--claude-agent'],
    recommendedModels: ['Planning / review: Claude Opus 4.6 or newer', 'Implementation: Claude Sonnet 4.6 or newer'],
    layout: {
      commandsDir: '.claude/commands/sdd',
      agentDir: '.claude',
      docFile: 'CLAUDE.md',
    },
    commands: {
      spec: '`/sdd:spec-quick <what-to-build>`',
      steering: '`/sdd:steering`',
      steeringCustom: '`/sdd:steering-custom <what-to-create-custom-steering-document>`',
    },
    upgradeNotice: makeUpgradeNotice('--claude-skills'),
    templateFallbacks: {
      'CLAUDE.md': '../../CLAUDE.md',
    },
    manifestId: 'claude-code-agent',
  },
  'claude-code-skills': {
    label: 'Claude Code Skills',
    description:
      'Installs sdd skills in `.claude/skills/sdd-*/`, shared settings in `{{SDD_DIR}}/settings/`, and a CLAUDE.md quickstart.',
    aliasFlags: ['--claude-code-skills', '--claude-skills'],
    recommendedModels: ['Planning / review: Claude Opus 4.6 or newer', 'Implementation: Claude Sonnet 4.6 or newer'],
    layout: {
      commandsDir: '.claude/skills',
      agentDir: '.claude',
      docFile: 'CLAUDE.md',
    },
    commands: {
      spec: '`/sdd-spec-init <what-to-build>`',
      steering: '`/sdd-steering`',
      steeringCustom: '`/sdd-steering-custom <what-to-create-custom-steering-document>`',
    },
    completionGuide: {
      prependSteps: [
        'If you are not sure whether the work should become one spec, many specs, or no spec at all, start with `/sdd-discovery <idea>`.',
      ],
      appendSteps: [
        'Use `/sdd-spec-quick <what-to-build> [--auto]` only when you intentionally want the fast path for a single spec.',
      ],
    },
    templateFallbacks: {
      'CLAUDE.md': '../../CLAUDE.md',
    },
    manifestId: 'claude-code-skills',
  },
  codex: {
    label: 'Codex CLI',
    description:
      'Deprecated: Codex no longer supports `.codex/prompts/`. Use `--codex-skills` instead.',
    aliasFlags: ['--codex', '--codex-cli'],
    recommendedModels: ['Planning / review: gpt-5.4 high or xhigh', 'Implementation: gpt-5.4'],
    layout: {
      commandsDir: '.codex/prompts',
      agentDir: '.codex',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/prompts:sdd-spec-init <what-to-build>`',
      steering: '`/prompts:sdd-steering`',
      steeringCustom: '`/prompts:sdd-steering-custom <what-to-create-custom-steering-document>`',
    },
    upgradeNotice: makeUpgradeNotice('--codex-skills'),
    manifestId: 'codex',
  },
  'codex-skills': {
    label: 'Codex Skills',
    description:
      'Installs sdd skills in `.agents/skills/sdd-*/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
    aliasFlags: ['--codex-skills'],
    recommendedModels: ['Planning / review: gpt-5.4 high or xhigh', 'Implementation: gpt-5.4'],
    layout: {
      commandsDir: '.agents/skills',
      agentDir: '.agents',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`$sdd-spec-init <what-to-build>`',
      steering: '`$sdd-steering`',
      steeringCustom: '`$sdd-steering-custom <what-to-create-custom-steering-document>`',
    },
    completionGuide: {
      prependSteps: [
        'If you are not sure whether the work should become one spec, many specs, or no spec at all, start with `$sdd-discovery <idea>`.',
      ],
      appendSteps: [
        'Use `$sdd-spec-quick <what-to-build> [--auto]` only when you intentionally want the fast path for a single spec.',
      ],
    },
    manifestId: 'codex-skills',
  },
  cursor: {
    label: 'Cursor IDE',
    description:
      'Installs sdd prompts in `.cursor/commands/sdd/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
    aliasFlags: ['--cursor'],
    recommendedModels: ['Planning / review: Claude Opus 4.6 or newer / gpt-5.4 high', 'Implementation: Claude Sonnet 4.6 or newer / gpt-5.4 / Composer 2'],
    layout: {
      commandsDir: '.cursor/commands/sdd',
      agentDir: '.cursor',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd/spec-init <what-to-build>`',
      steering: '`/sdd/steering`',
      steeringCustom: '`/sdd/steering-custom <what-to-create-custom-steering-document>`',
    },
    upgradeNotice: makeUpgradeNotice('--cursor-skills'),
    manifestId: 'cursor',
  },
  'cursor-skills': {
    label: 'Cursor Skills',
    description:
      'Installs sdd skills in `.cursor/skills/sdd-*/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
    aliasFlags: ['--cursor-skills'],
    recommendedModels: ['Planning / review: Claude Opus 4.6 or newer / gpt-5.4 high', 'Implementation: Claude Sonnet 4.6 or newer / gpt-5.4 / Composer 2'],
    layout: {
      commandsDir: '.cursor/skills',
      agentDir: '.cursor',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd-spec-init <what-to-build>`',
      steering: '`/sdd-steering`',
      steeringCustom: '`/sdd-steering-custom <what-to-create-custom-steering-document>`',
    },
    completionGuide: {
      prependSteps: [
        'If you are not sure whether the work should become one spec, many specs, or no spec at all, start with `/sdd-discovery <idea>`.',
      ],
      appendSteps: [
        'Use `/sdd-spec-quick <what-to-build> [--auto]` only when you intentionally want the fast path for a single spec.',
      ],
    },
    manifestId: 'cursor-skills',
  },
  'github-copilot': {
    label: 'GitHub Copilot',
    description:
      'Installs sdd prompts in `.github/prompts/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
    aliasFlags: ['--copilot', '--github-copilot'],
    recommendedModels: ['Planning / review: Claude Opus 4.6 or newer / gpt-5.4 high', 'Implementation: Claude Sonnet 4.6 or newer / gpt-5.4'],
    layout: {
      commandsDir: '.github/prompts',
      agentDir: '.github',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd-spec-init <what-to-build>`',
      steering: '`/sdd-steering`',
      steeringCustom: '`/sdd-steering-custom <what-to-create-custom-steering-document>`',
    },
    upgradeNotice: makeUpgradeNotice('--copilot-skills'),
    manifestId: 'github-copilot',
  },
  'github-copilot-skills': {
    label: 'GitHub Copilot Skills',
    description:
      'Installs sdd skills in `.github/skills/sdd-*/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
    aliasFlags: ['--copilot-skills', '--github-copilot-skills'],
    recommendedModels: ['Planning / review: Claude Opus 4.6 or newer / gpt-5.4 high', 'Implementation: Claude Sonnet 4.6 or newer / gpt-5.4'],
    layout: {
      commandsDir: '.github/skills',
      agentDir: '.github',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd-spec-init <what-to-build>`',
      steering: '`/sdd-steering`',
      steeringCustom: '`/sdd-steering-custom <what-to-create-custom-steering-document>`',
    },
    completionGuide: {
      prependSteps: [
        'If you are not sure whether the work should become one spec, many specs, or no spec at all, start with `/sdd-discovery <idea>`.',
      ],
      appendSteps: [
        'Use `/sdd-spec-quick <what-to-build> [--auto]` only when you intentionally want the fast path for a single spec.',
      ],
    },
    manifestId: 'github-copilot-skills',
  },
  'gemini-cli': {
    label: 'Gemini CLI',
    description:
      'Installs sdd prompts in `.gemini/commands/sdd/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
    aliasFlags: ['--gemini-cli', '--gemini'],
    recommendedModels: ['Planning / review: Gemini 3.1 Pro or newer', 'Implementation: Gemini 3 Flash or newer'],
    layout: {
      commandsDir: '.gemini/commands/sdd',
      agentDir: '.gemini',
      docFile: 'GEMINI.md',
    },
    commands: {
      spec: '`/sdd:spec-init <what-to-build>`',
      steering: '`/sdd:steering`',
      steeringCustom: '`/sdd:steering-custom <what-to-create-custom-steering-document>`',
    },
    upgradeNotice: makeUpgradeNotice('--gemini-skills'),
    manifestId: 'gemini-cli',
  },
  'gemini-cli-skills': {
    label: 'Gemini CLI Skills',
    description:
      'Installs sdd skills in `.gemini/skills/sdd-*/`, shared settings in `{{SDD_DIR}}/settings/`, and a GEMINI.md quickstart.',
    aliasFlags: ['--gemini-cli-skills', '--gemini-skills'],
    recommendedModels: ['Planning / review: Gemini 3.1 Pro or newer', 'Implementation: Gemini 3 Flash or newer'],
    layout: {
      commandsDir: '.gemini/skills',
      agentDir: '.gemini',
      docFile: 'GEMINI.md',
    },
    commands: {
      spec: '`/sdd-spec-init <what-to-build>`',
      steering: '`/sdd-steering`',
      steeringCustom: '`/sdd-steering-custom <what-to-create-custom-steering-document>`',
    },
    completionGuide: {
      prependSteps: [
        'If you are not sure whether the work should become one spec, many specs, or no spec at all, start with `/sdd-discovery <idea>`.',
      ],
      appendSteps: [
        'Use `/sdd-spec-quick <what-to-build> [--auto]` only when you intentionally want the fast path for a single spec.',
      ],
    },
    manifestId: 'gemini-cli-skills',
  },
  windsurf: {
    label: 'Windsurf IDE',
    description:
      'Installs sdd workflows in `.windsurf/workflows/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
    aliasFlags: ['--windsurf'],
    recommendedModels: ['Planning / review: Claude Opus 4.6 or newer / gpt-5.4 high', 'Implementation: Claude Sonnet 4.6 or newer / gpt-5.4'],
    layout: {
      commandsDir: '.windsurf/workflows',
      agentDir: '.windsurf',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd-spec-init <what-to-build>`',
      steering: '`/sdd-steering`',
      steeringCustom: '`/sdd-steering-custom <what-to-create-custom-steering-document>`',
    },
    upgradeNotice: makeUpgradeNotice('--windsurf-skills'),
    manifestId: 'windsurf',
  },
  'windsurf-skills': {
    label: 'Windsurf Skills',
    description:
      'Installs sdd skills in `.windsurf/skills/sdd-*/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
    aliasFlags: ['--windsurf-skills'],
    recommendedModels: ['Planning / review: Claude Opus 4.6 or newer / gpt-5.4 high', 'Implementation: Claude Sonnet 4.6 or newer / gpt-5.4'],
    layout: {
      commandsDir: '.windsurf/skills',
      agentDir: '.windsurf',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`@sdd-spec-init <what-to-build>`',
      steering: '`@sdd-steering`',
      steeringCustom: '`@sdd-steering-custom <what-to-create-custom-steering-document>`',
    },
    completionGuide: {
      prependSteps: [
        'If you are not sure whether the work should become one spec, many specs, or no spec at all, start with `@sdd-discovery <idea>`.',
      ],
      appendSteps: [
        'Use `@sdd-spec-quick <what-to-build> [--auto]` only when you intentionally want the fast path for a single spec.',
      ],
    },
    manifestId: 'windsurf-skills',
  },
  'qwen-code': {
    label: 'Qwen Code',
    description:
      'Installs sdd prompts in `.qwen/commands/sdd/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
    aliasFlags: ['--qwen-code', '--qwen'],
    layout: {
      commandsDir: '.qwen/commands/sdd',
      agentDir: '.qwen',
      docFile: 'QWEN.md',
    },
    commands: {
      spec: '`/sdd:spec-init <what-to-build>`',
      steering: '`/sdd:steering`',
      steeringCustom: '`/sdd:steering-custom`',
    },
    manifestId: 'qwen-code',
  },
  'opencode': {
    label: 'OpenCode',
    description:
      'Installs sdd prompts in `.opencode/commands/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
    aliasFlags: ['--opencode'],
    recommendedModels: ['Planning / review: gpt-5.4 high or xhigh', 'Implementation: gpt-5.4'],
    layout: {
      commandsDir: '.opencode/commands',
      agentDir: '.opencode',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd-spec-init <what-to-build>`',
      steering: '`/sdd-steering`',
      steeringCustom: '`/sdd-steering-custom <what-to-create-custom-steering-document>`',
    },
    upgradeNotice: makeUpgradeNotice('--opencode-skills'),
    manifestId: 'opencode',
  },
  'opencode-agent': {
    label: 'OpenCode Agents',
    description:
      'Installs sdd commands in `.opencode/commands/`, an sdd agent library in `.opencode/agents/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
    aliasFlags: ['--opencode-agent'],
    recommendedModels: ['Planning / review: gpt-5.4 high or xhigh', 'Implementation: gpt-5.4'],
    layout: {
      commandsDir: '.opencode/commands',
      agentDir: '.opencode',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd-spec-quick <what-to-build>`',
      steering: '`/sdd-steering`',
      steeringCustom: '`/sdd-steering-custom <what-to-create-custom-steering-document>`',
    },
    upgradeNotice: makeUpgradeNotice('--opencode-skills'),
    templateFallbacks: {
      'AGENTS.md': '../../AGENTS.md',
    },
    manifestId: 'opencode-agent',
  },
  'opencode-skills': {
    label: 'OpenCode Skills',
    description:
      'Installs sdd skills in `.opencode/skills/sdd-*/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
    aliasFlags: ['--opencode-skills'],
    recommendedModels: ['Planning / review: gpt-5.4 high or xhigh', 'Implementation: gpt-5.4'],
    layout: {
      commandsDir: '.opencode/skills',
      agentDir: '.opencode',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd-spec-init <what-to-build>`',
      steering: '`/sdd-steering`',
      steeringCustom: '`/sdd-steering-custom <what-to-create-custom-steering-document>`',
    },
    completionGuide: {
      prependSteps: [
        'If you are not sure whether the work should become one spec, many specs, or no spec at all, start with `/sdd-discovery <idea>`.',
      ],
      appendSteps: [
        'Use `/sdd-spec-quick <what-to-build> [--auto]` only when you intentionally want the fast path for a single spec.',
      ],
    },
    manifestId: 'opencode-skills',
  },
  'antigravity-skills': {
    label: 'Antigravity Skills',
    description:
      'Installs sdd skills in `.agent/skills/sdd-*/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
    aliasFlags: ['--antigravity-skills', '--antigravity'],
    layout: {
      commandsDir: '.agent/skills',
      agentDir: '.agent',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd-spec-init <what-to-build>`',
      steering: '`/sdd-steering`',
      steeringCustom: '`/sdd-steering-custom <what-to-create-custom-steering-document>`',
    },
    completionGuide: {
      prependSteps: [
        'If you are not sure whether the work should become one spec, many specs, or no spec at all, start with `/sdd-discovery <idea>`.',
      ],
      appendSteps: [
        'Use `/sdd-spec-quick <what-to-build> [--auto]` only when you intentionally want the fast path for a single spec.',
      ],
    },
    manifestId: 'antigravity-skills',
  },
  'factory-droid': {
    label: 'Factory Droid',
    description:
      'Installs the 22 sdd prompt templates in `.factory/commands/`, shared settings in `{{SDD_DIR}}/settings/`. Project instructions are read from AGENTS.md; the skills surface is a declared gap (see docs/PAPER-ALIGNMENT.md).',
    aliasFlags: ['--factory-droid', '--droid'],
    layout: {
      commandsDir: '.factory/commands',
      agentDir: '.factory',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd-specify <what-to-build>`',
      steering: '`/sdd-constitution`',
      steeringCustom: '`/sdd-constitution <amendment>`',
    },
  },
  'roo-code': {
    label: 'Roo Code',
    description:
      'Installs the 22 sdd prompt templates in `.roo/commands/`, shared settings in `{{SDD_DIR}}/settings/`. Project instructions are read from `.roo/rules/` and AGENTS.md; the skills surface is a declared gap.',
    aliasFlags: ['--roo-code', '--roo'],
    layout: {
      commandsDir: '.roo/commands',
      agentDir: '.roo',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd-specify <what-to-build>`',
      steering: '`/sdd-constitution`',
      steeringCustom: '`/sdd-constitution <amendment>`',
    },
  },
  'kilo-code': {
    label: 'Kilo Code',
    description:
      'Installs the 22 sdd prompt templates in `.kilo/commands/`, shared settings in `{{SDD_DIR}}/settings/`. Project instructions are read from `.kilo/rules/` and AGENTS.md; the skills surface is a declared gap.',
    aliasFlags: ['--kilo-code', '--kilo'],
    layout: {
      commandsDir: '.kilo/commands',
      agentDir: '.kilo',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd-specify <what-to-build>`',
      steering: '`/sdd-constitution`',
      steeringCustom: '`/sdd-constitution <amendment>`',
    },
  },
  'junie': {
    label: 'JetBrains Junie',
    description:
      'Installs the 22 sdd prompt templates in `.junie/commands/`, shared settings in `{{SDD_DIR}}/settings/`. Guidelines are read from `.junie/AGENTS.md` then AGENTS.md; the skills surface is a declared gap.',
    aliasFlags: ['--junie', '--jetbrains-junie'],
    layout: {
      commandsDir: '.junie/commands',
      agentDir: '.junie',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd-specify <what-to-build>`',
      steering: '`/sdd-constitution`',
      steeringCustom: '`/sdd-constitution <amendment>`',
    },
  },
  'mimocode': {
    label: 'MiMoCode (Xiaomi)',
    description:
      'Installs the 22 sdd prompt templates in `.mimocode/commands/`, shared settings in `{{SDD_DIR}}/settings/`. Project instructions are read from AGENTS.md; the skills surface is a declared gap.',
    aliasFlags: ['--mimocode', '--mimo'],
    layout: {
      commandsDir: '.mimocode/commands',
      agentDir: '.mimocode',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd-specify <what-to-build>`',
      steering: '`/sdd-constitution`',
      steeringCustom: '`/sdd-constitution <amendment>`',
    },
  },
  'iflow': {
    label: 'iFlow CLI',
    description:
      'Installs the 22 sdd prompt templates in `.iflow/commands/`, shared settings in `{{SDD_DIR}}/settings/`. The context file is `IFLOW.md` unless `contextFileName` points at AGENTS.md; the skills surface is a declared gap.',
    aliasFlags: ['--iflow'],
    layout: {
      commandsDir: '.iflow/commands',
      agentDir: '.iflow',
      docFile: 'IFLOW.md',
    },
    commands: {
      spec: '`/sdd-specify <what-to-build>`',
      steering: '`/sdd-constitution`',
      steeringCustom: '`/sdd-constitution <amendment>`',
    },
  },
  'zcode': {
    label: 'ZCode (Z.ai)',
    description:
      'Installs the 22 sdd prompt templates in `.zcode/commands/` (SOURCE-VERIFIED: the vendor resolver computes the path, its docs do not state it), shared settings in `{{SDD_DIR}}/settings/`. Reads a flat AGENTS.md; the skills surface is a declared gap.',
    aliasFlags: ['--zcode', '--z-ai'],
    layout: {
      commandsDir: '.zcode/commands',
      agentDir: '.zcode',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd-specify <what-to-build>`',
      steering: '`/sdd-constitution`',
      steeringCustom: '`/sdd-constitution <amendment>`',
    },
  },
  'augment': {
    label: 'Augment Code',
    description:
      'Installs the 22 sdd prompt templates in `.augment/commands/`, shared settings in `{{SDD_DIR}}/settings/`. Rules live in `.augment/rules/` and AGENTS.md; the skills surface is a declared gap.',
    aliasFlags: ['--augment', '--augment-code'],
    layout: {
      commandsDir: '.augment/commands',
      agentDir: '.augment',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd-specify <what-to-build>`',
      steering: '`/sdd-constitution`',
      steeringCustom: '`/sdd-constitution <amendment>`',
    },
  },
  'trae': {
    label: 'Trae (ByteDance)',
    description:
      'Installs the 22 sdd prompt templates in `.trae/commands/`, shared settings in `{{SDD_DIR}}/settings/`. Project rules are read from AGENTS.md (toggle required); the skills surface is a declared gap.',
    aliasFlags: ['--trae'],
    layout: {
      commandsDir: '.trae/commands',
      agentDir: '.trae',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd-specify <what-to-build>`',
      steering: '`/sdd-constitution`',
      steeringCustom: '`/sdd-constitution <amendment>`',
    },
  },
  'qoder': {
    label: 'Qoder (Alibaba)',
    description:
      'Installs the 22 sdd prompt templates in `.qoder/commands/`, shared settings in `{{SDD_DIR}}/settings/`. Qoder is the current name of Tongyi Lingma; rules live in `.qoder/rules/` with a documented 100,000-character budget, and the skills surface is a declared gap.',
    aliasFlags: ['--qoder', '--lingma'],
    layout: {
      commandsDir: '.qoder/commands',
      agentDir: '.qoder',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd-specify <what-to-build>`',
      steering: '`/sdd-constitution`',
      steeringCustom: '`/sdd-constitution <amendment>`',
    },
  },
  'codebuddy': {
    label: 'CodeBuddy (Tencent)',
    description:
      'Installs the 22 sdd prompt templates in `.codebuddy/commands/`, shared settings in `{{SDD_DIR}}/settings/`. Native instructions live in CODEBUDDY.md (AGENTS.md only as fallback); the skills surface is a declared gap.',
    aliasFlags: ['--codebuddy'],
    layout: {
      commandsDir: '.codebuddy/commands',
      agentDir: '.codebuddy',
      docFile: 'CODEBUDDY.md',
    },
    commands: {
      spec: '`/sdd-specify <what-to-build>`',
      steering: '`/sdd-constitution`',
      steeringCustom: '`/sdd-constitution <amendment>`',
    },
  },
  'agents-skills': {
    label: 'Cross-tool Agent Skills',
    description:
      'Installs the 22 sdd skills ONCE in `.agents/skills/sdd-*/`, the cross-tool path that this project verified for Roo Code, Kilo Code, Junie, MiMoCode, Crush, Amp, Kimi Code, Warp, Devin, Factory Droid, Augment, Goose, OpenHands and DeepSeek Harness — one neutral tree instead of one copy per host — plus shared settings in `{{SDD_DIR}}/settings/` and an AGENTS.md quickstart.',
    aliasFlags: ['--agents-skills'],
    layout: {
      commandsDir: '.agents/skills',
      agentDir: '.agents',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd-spec-quick <what-to-build>`',
      steering: '`/sdd-steering`',
      steeringCustom: '`/sdd-steering-custom <what-to-create-custom-steering-document>`',
    },
    manifestId: 'agents-skills',
  },
  'trae-skills': {
    label: 'Trae Skills',
    description:
      'Installs the 22 sdd skills in `.trae/skills/sdd-*/` from the SHARED neutral tree (Trae also documents `.agents/skills/`, but ships it OFF by default, so its own directory is the one that works), plus shared settings in `{{SDD_DIR}}/settings/`.',
    aliasFlags: ['--trae-skills'],
    layout: {
      commandsDir: '.trae/skills',
      agentDir: '.trae',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd-spec-quick <what-to-build>`',
      steering: '`/sdd-steering`',
      steeringCustom: '`/sdd-steering-custom <what-to-create-custom-steering-document>`',
    },
    manifestId: 'trae-skills',
  },
  'qoder-skills': {
    label: 'Qoder Skills',
    description:
      'Installs the 22 sdd skills in `.qoder/skills/sdd-*/` from the SHARED neutral tree, plus shared settings in `{{SDD_DIR}}/settings/`. Rules live in `.qoder/rules/` with a documented 100,000-character budget.',
    aliasFlags: ['--qoder-skills', '--lingma-skills'],
    layout: {
      commandsDir: '.qoder/skills',
      agentDir: '.qoder',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd-spec-quick <what-to-build>`',
      steering: '`/sdd-steering`',
      steeringCustom: '`/sdd-steering-custom <what-to-create-custom-steering-document>`',
    },
    manifestId: 'qoder-skills',
  },
  'zcode-skills': {
    label: 'ZCode Skills',
    description:
      'Installs the 22 sdd skills in `.zcode/skills/sdd-*/` from the SHARED neutral tree, plus shared settings in `{{SDD_DIR}}/settings/`. The project path is SOURCE-VERIFIED (the vendor resolver computes it; its docs state only the user scope).',
    aliasFlags: ['--zcode-skills'],
    layout: {
      commandsDir: '.zcode/skills',
      agentDir: '.zcode',
      docFile: 'AGENTS.md',
    },
    commands: {
      spec: '`/sdd-spec-quick <what-to-build>`',
      steering: '`/sdd-steering`',
      steeringCustom: '`/sdd-steering-custom <what-to-create-custom-steering-document>`',
    },
    manifestId: 'zcode-skills',
  },
  'codebuddy-skills': {
    label: 'CodeBuddy Skills',
    description:
      'Installs the 22 sdd skills in `.codebuddy/skills/sdd-*/` from the SHARED neutral tree, plus shared settings in `{{SDD_DIR}}/settings/`. Native instructions live in CODEBUDDY.md.',
    aliasFlags: ['--codebuddy-skills'],
    layout: {
      commandsDir: '.codebuddy/skills',
      agentDir: '.codebuddy',
      docFile: 'CODEBUDDY.md',
    },
    commands: {
      spec: '`/sdd-spec-quick <what-to-build>`',
      steering: '`/sdd-steering`',
      steeringCustom: '`/sdd-steering-custom <what-to-create-custom-steering-document>`',
    },
    manifestId: 'codebuddy-skills',
  },
} as const satisfies Record<string, AgentDefinition>;

export type AgentType = keyof typeof agentDefinitions;

export const getAgentDefinition = (agent: AgentType): AgentDefinition => {
  const definition = agentDefinitions[agent];
  if (!definition) {
    throw new Error(`Unknown agent: ${agent as string}`);
  }
  return definition as AgentDefinition;
};

export const agentList = Object.keys(agentDefinitions) as AgentType[];

/**
 * Install an agent declared OUTSIDE the repository, so `init --agent <id> --write` works for a host
 * nobody may publish. Returns false when the id is already taken: a local file never shadows a shipped
 * agent.
 */
export const registerLocalAgent = (id: string, definition: AgentDefinition): boolean => {
  const table = agentDefinitions as unknown as Record<string, AgentDefinition>;
  if (table[id]) return false;
  table[id] = definition;
  const list = agentList as string[];
  if (!list.includes(id)) list.push(id);
  return true;
};
