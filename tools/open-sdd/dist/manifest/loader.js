import { readFile } from 'node:fs/promises';
export const loadManifest = async (filePath) => {
    let raw;
    try {
        raw = await readFile(filePath, 'utf8');
    }
    catch (e) {
        if (e && e.code === 'ENOENT')
            throw new Error(`Manifest not found: ${filePath}`);
        throw e;
    }
    let json;
    try {
        json = JSON.parse(raw);
    }
    catch (e) {
        const msg = e?.message ?? String(e);
        throw new Error(`Invalid JSON in manifest: ${msg}`);
    }
    if (!json || typeof json !== 'object')
        throw new Error('Manifest must be an object');
    const m = json;
    if (typeof m.version !== 'number')
        throw new Error('Manifest.version must be a number');
    if (!Array.isArray(m.artifacts))
        throw new Error('Manifest.artifacts must be an array');
    return m;
};
