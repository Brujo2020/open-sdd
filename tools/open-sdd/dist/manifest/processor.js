const shouldIncludeForAgent = (art, agent) => {
    const cond = art.when?.agent;
    if (!cond)
        return true;
    if (Array.isArray(cond))
        return cond.includes(agent);
    return cond === agent;
};
const shouldIncludeForOs = (art, os) => {
    const cond = art.when?.os;
    if (!cond)
        return true;
    if (Array.isArray(cond))
        return cond.includes(os);
    return cond === os;
};
const applyPlaceholders = (input, agent, ctx) => {
    const dict = {
        AGENT: agent,
        LANG_CODE: ctx.LANG_CODE,
        DEV_GUIDELINES: ctx.DEV_GUIDELINES,
        KIRO_DIR: ctx.KIRO_DIR,
        SDD_DIR: ctx.SDD_DIR ?? ctx.KIRO_DIR,
        AGENT_DIR: ctx.AGENT_DIR,
        AGENT_DOC: ctx.AGENT_DOC,
        AGENT_COMMANDS_DIR: ctx.AGENT_COMMANDS_DIR,
    };
    return input.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_m, key) => dict[key] ?? _m);
};
export const processManifest = (manifest, agent, ctx, os) => {
    const out = [];
    for (const art of manifest.artifacts) {
        if (!shouldIncludeForAgent(art, agent))
            continue;
        if (!shouldIncludeForOs(art, os))
            continue;
        if (art.source.type === 'staticDir') {
            const from = applyPlaceholders(art.source.from, agent, ctx);
            const toDir = applyPlaceholders(art.source.toDir, agent, ctx);
            out.push({ id: art.id, source: { type: 'staticDir', from, toDir } });
            continue;
        }
        if (art.source.type === 'templateFile') {
            const from = applyPlaceholders(art.source.from, agent, ctx);
            const toDir = applyPlaceholders(art.source.toDir, agent, ctx);
            const outFile = deriveOutFile(from, art.source.rename, agent, ctx);
            out.push({ id: art.id, source: { type: 'templateFile', from, toDir, outFile } });
            continue;
        }
        if (art.source.type === 'templateDir') {
            const fromDir = applyPlaceholders(art.source.fromDir, agent, ctx);
            const toDir = applyPlaceholders(art.source.toDir, agent, ctx);
            out.push({ id: art.id, source: { type: 'templateDir', fromDir, toDir } });
            continue;
        }
    }
    return out;
};
const deriveOutFile = (fromPath, rename, agent, ctx) => {
    if (rename && rename.trim()) {
        return applyPlaceholders(rename, agent, ctx);
    }
    const base = fromPath.split('/').pop() ?? fromPath;
    if (base.endsWith('.tpl.md'))
        return base.slice(0, -('.tpl.md'.length)) + '.md';
    if (base.endsWith('.tpl.json'))
        return base.slice(0, -('.tpl.json'.length)) + '.json';
    return base;
};
