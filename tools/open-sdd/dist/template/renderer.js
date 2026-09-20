const buildDict = (agent, ctx) => ({
    AGENT: agent,
    LANG_CODE: ctx.LANG_CODE,
    DEV_GUIDELINES: ctx.DEV_GUIDELINES,
    KIRO_DIR: ctx.KIRO_DIR,
    SDD_DIR: ctx.SDD_DIR ?? ctx.KIRO_DIR,
    AGENT_DIR: ctx.AGENT_DIR,
    AGENT_DOC: ctx.AGENT_DOC,
    AGENT_COMMANDS_DIR: ctx.AGENT_COMMANDS_DIR,
});
const replacePlaceholders = (input, dict) => input.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, key) => (key in dict ? dict[key] : m));
export const renderTemplateString = (input, agent, ctx) => {
    const dict = buildDict(agent, ctx);
    return replacePlaceholders(input, dict);
};
export const renderJsonTemplate = (input, agent, ctx) => {
    const rendered = renderTemplateString(input, agent, ctx);
    try {
        return JSON.parse(rendered);
    }
    catch (err) {
        throw new Error('Invalid JSON after template substitution');
    }
};
