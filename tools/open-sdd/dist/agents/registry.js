const makeUpgradeNotice = (flag) => `This mode will be removed in a future release. Migrate now: npx open-sdd@latest ${flag}`;
export const agentDefinitions = {
    'claude-code': {
        label: 'Claude Code',
        description: 'Installs sdd prompts in `.claude/commands/sdd/`, shared settings in `{{SDD_DIR}}/settings/` (default `.sdd/settings/`), and an AGENTS.md quickstart.',
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
        description: 'Installs sdd prompts in `.claude/commands/sdd/`, a Claude agent library in `.claude/agents/sdd/`, shared settings in `{{SDD_DIR}}/settings/`, and a CLAUDE.md quickstart.',
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
        description: 'Installs sdd skills in `.claude/skills/sdd-*/`, shared settings in `{{SDD_DIR}}/settings/`, and a CLAUDE.md quickstart.',
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
        description: 'Deprecated: Codex no longer supports `.codex/prompts/`. Use `--codex-skills` instead.',
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
        description: 'Installs sdd skills in `.agents/skills/sdd-*/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
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
        description: 'Installs sdd prompts in `.cursor/commands/sdd/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
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
        description: 'Installs sdd skills in `.cursor/skills/sdd-*/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
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
        description: 'Installs sdd prompts in `.github/prompts/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
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
        description: 'Installs sdd skills in `.github/skills/sdd-*/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
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
        description: 'Installs sdd prompts in `.gemini/commands/sdd/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
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
        description: 'Installs sdd skills in `.gemini/skills/sdd-*/`, shared settings in `{{SDD_DIR}}/settings/`, and a GEMINI.md quickstart.',
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
        description: 'Installs sdd workflows in `.windsurf/workflows/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
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
        description: 'Installs sdd skills in `.windsurf/skills/sdd-*/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
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
        description: 'Installs sdd prompts in `.qwen/commands/sdd/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
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
        description: 'Installs sdd prompts in `.opencode/commands/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
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
        description: 'Installs sdd commands in `.opencode/commands/`, an sdd agent library in `.opencode/agents/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
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
        description: 'Installs sdd skills in `.opencode/skills/sdd-*/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
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
        description: 'Installs sdd skills in `.agent/skills/sdd-*/`, shared settings in `{{SDD_DIR}}/settings/`, and an AGENTS.md quickstart.',
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
};
export const getAgentDefinition = (agent) => {
    const definition = agentDefinitions[agent];
    if (!definition) {
        throw new Error(`Unknown agent: ${agent}`);
    }
    return definition;
};
export const agentList = Object.keys(agentDefinitions);
