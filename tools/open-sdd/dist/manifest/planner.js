import { processManifest } from './processor.js';
import { loadManifest } from './loader.js';
import { contextFromResolved } from '../template/fromResolved.js';
export const planFromManifest = (manifest, resolved) => {
    const ctx = contextFromResolved(resolved);
    return processManifest(manifest, resolved.agent, ctx, resolved.resolvedOs);
};
export const planFromFile = async (manifestPath, resolved) => {
    const manifest = await loadManifest(manifestPath);
    return planFromManifest(manifest, resolved);
};
