import { resolveAgentLayout } from '../resolvers/agentLayout.js';
import { resolveOs } from '../resolvers/os.js';
import { resolveKiroDir } from '../resolvers/kiroDir.js';
const defaults = {
    agent: 'claude-code-skills',
    os: 'auto',
    lang: 'en',
    kiroDir: '.kiro',
    overwrite: 'prompt',
    backupDir: '.open-sdd.backup',
};
export const mergeConfigAndArgs = (args, config = {}, runtime = {}) => {
    const agent = (args.agent ?? config.agent ?? defaults.agent);
    const osInput = (args.os ?? config.os ?? defaults.os);
    const resolvedOs = resolveOs(osInput, runtime);
    const lang = (args.lang ?? config.lang ?? defaults.lang);
    const kiroDir = resolveKiroDir({ flag: args.kiroDir, config: config.kiroDir });
    const overwrite = (args.overwrite ?? config.overwrite ?? defaults.overwrite);
    const yes = !!args.yes;
    const effectiveOverwrite = yes && overwrite === 'prompt' ? 'force' : overwrite;
    const dryRun = !!args.dryRun;
    let backupEnabled = false;
    let backupDir = config.backupDir ?? defaults.backupDir;
    if (typeof args.backup !== 'undefined') {
        backupEnabled = !!args.backup || typeof args.backup === 'string';
        if (typeof args.backup === 'string' && args.backup.trim()) {
            backupDir = args.backup;
        }
    }
    const layout = resolveAgentLayout(agent, { agentLayouts: config.agentLayouts });
    return {
        agent,
        os: osInput,
        resolvedOs,
        lang,
        kiroDir,
        overwrite,
        effectiveOverwrite,
        dryRun,
        yes,
        backupEnabled,
        backupDir,
        layout,
    };
};
