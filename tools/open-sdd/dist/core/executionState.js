import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
/**
 * Persists execution state to .sdd/.impl-state/{feature}.json
 * Allows resuming /sdd-impl if the process is interrupted
 */
export const getExecutionStateFile = (sddDir, feature, cwd = process.cwd()) => {
    return join(cwd, sddDir, '.impl-state', `${feature}.json`);
};
export const saveExecutionState = async (state, sddDir, cwd = process.cwd()) => {
    const stateDir = join(cwd, sddDir, '.impl-state');
    await mkdir(stateDir, { recursive: true });
    const file = getExecutionStateFile(sddDir, state.featureName, cwd);
    const timestamp = new Date().toISOString();
    const data = {
        ...state,
        lastUpdated: timestamp,
    };
    await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
};
export const loadExecutionState = async (feature, sddDir, cwd = process.cwd()) => {
    const file = getExecutionStateFile(sddDir, feature, cwd);
    try {
        const content = await readFile(file, 'utf8');
        const data = JSON.parse(content);
        // Remove lastUpdated before returning
        const { lastUpdated, ...state } = data;
        return state;
    }
    catch {
        return null;
    }
};
export const clearExecutionState = async (feature, sddDir, cwd = process.cwd()) => {
    const file = getExecutionStateFile(sddDir, feature, cwd);
    try {
        await import('node:fs/promises').then(fs => fs.rm(file));
    }
    catch {
        // File doesn't exist, that's OK
    }
};
