import { agentList, getAgentDefinition } from '../agents/registry.js';
import { colors, formatAttention, formatHeading } from './ui/colors.js';
import { isInteractive, promptSelect } from './ui/prompt.js';
export const agentOptions = agentList.map((value) => {
    const definition = getAgentDefinition(value);
    return {
        value,
        label: definition.label,
        description: definition.description,
        flags: definition.aliasFlags,
    };
});
const DEFAULT_AGENT = 'claude-code-skills';
export const ensureAgentSelection = async (current, io) => {
    if (current)
        return current;
    if (!isInteractive())
        return DEFAULT_AGENT;
    io.log(formatHeading('Select the agent you want to set up:'));
    const option = await promptSelect('Agent number', agentOptions.map((opt) => ({
        value: opt.value,
        label: `${opt.label} (${opt.flags[0] ?? `--${opt.value}`})`,
        description: opt.description,
    })));
    return option;
};
const buildGuideSteps = (agent, sddDir) => {
    const definition = getAgentDefinition(agent);
    const steps = [
        `Start here: ${definition.commands.spec} to describe what you want to build.`,
        `Run ${definition.commands.steering} to document your codebase patterns (brownfield only).`,
        `Control enforcement in \`${sddDir}/settings/governance.json\` (solo = nothing blocks).`,
    ];
    if (definition.completionGuide?.prependSteps) {
        steps.unshift(...definition.completionGuide.prependSteps);
    }
    if (definition.completionGuide?.appendSteps) {
        steps.push(...definition.completionGuide.appendSteps);
    }
    return steps;
};
export const printCompletionGuide = (agent, io, sddDir = '.sdd') => {
    const definition = getAgentDefinition(agent);
    if (definition.upgradeNotice) {
        const line = '─'.repeat(60);
        io.log('');
        io.log(colors.yellow(line));
        io.log(formatAttention('  DEPRECATED: This mode is no longer recommended.'));
        io.log(formatAttention(`  ${definition.upgradeNotice}`));
        io.log(colors.yellow(line));
        io.log('');
    }
    const models = definition.recommendedModels;
    if (models && models.length > 0) {
        io.log(formatHeading('  Recommended models:'));
        models.forEach((model) => io.log(formatAttention(`    ${model}`)));
        io.log('');
    }
    io.log(formatHeading('  Get started:'));
    buildGuideSteps(agent, sddDir).forEach((step, idx) => {
        io.log(colors.cyan(`    ${idx + 1}. ${step}`));
    });
    io.log('');
};
