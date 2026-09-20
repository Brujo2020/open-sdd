import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export const CONFIG_FILE = '.open-sdd.json';
export const resolveConfigPath = (cwd) => join(cwd, CONFIG_FILE);
export const loadUserConfig = async (cwd) => {
    const file = resolveConfigPath(cwd);
    try {
        const raw = await readFile(file, 'utf8');
        try {
            const parsed = JSON.parse(raw);
            return parsed ?? {};
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`Invalid JSON in ${CONFIG_FILE}: ${msg}`);
        }
    }
    catch (e) {
        if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR'))
            return {};
        throw e;
    }
};
export const saveUserConfig = async (cwd, cfg) => {
    const file = resolveConfigPath(cwd);
    const json = JSON.stringify(cfg, null, 2) + '\n';
    await writeFile(file, json, 'utf8');
};
