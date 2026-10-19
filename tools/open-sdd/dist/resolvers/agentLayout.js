import { getAgentDefinition } from '../agents/registry.js';
export const resolveAgentLayout = (agent, config) => {
    const base = getAgentDefinition(agent).layout;
    const override = config?.agentLayouts?.[agent] ?? {};
    return { ...base, ...override };
};
