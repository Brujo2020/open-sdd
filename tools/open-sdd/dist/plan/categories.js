import path from 'node:path';
const normalize = (value) => value.replace(/\\/g, '/');
export const categorizeTarget = (targetAbs, cwd, resolved) => {
    const rel = path.relative(cwd, targetAbs);
    const normalized = normalize(rel.split(path.sep).join('/'));
    const kiroSettingsPrefix = `${normalize(resolved.kiroDir)}/settings/`;
    const commandsPrefix = `${normalize(resolved.layout.commandsDir)}/`;
    const docPath = normalize(resolved.layout.docFile);
    if (normalized.startsWith(commandsPrefix))
        return 'commands';
    if (normalized.startsWith(kiroSettingsPrefix))
        return 'settings';
    if (normalized === docPath)
        return 'project-memory';
    return 'other';
};
const defaultCategoryLabels = {
    commands: 'Commands',
    'project-memory': 'Project Memory document',
    settings: 'Settings templates and rules',
    other: 'Other',
};
export const categoryLabels = defaultCategoryLabels;
export const getCategoryLabel = (category, resolved) => {
    if (category === 'commands' && resolved.layout.commandsDir.includes('skills')) {
        return 'Skills';
    }
    return defaultCategoryLabels[category];
};
export const categoryDescriptions = (category, resolved) => {
    switch (category) {
        case 'commands':
            return `${resolved.layout.commandsDir}/`;
        case 'project-memory':
            return resolved.layout.docFile;
        case 'settings':
            return `${resolved.kiroDir}/settings/`;
        default:
            return '';
    }
};
