import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { loadGovernanceSettings } from '../src/core/governance.js';
import { loadGitSettings } from '../src/core/git.js';

const manifestsDir = path.resolve('templates/manifests');
const sharedSettings = path.resolve('templates/shared/settings');

/**
 * Regression guard: governance.json and git.json must ship to `{{SDD_DIR}}/settings/`,
 * which is exactly where loadGovernanceSettings/loadGitSettings read them from.
 * They previously landed in `settings/templates/` and were silently never read.
 */
describe('settings config is shipped where the code reads it', () => {
  it('keeps the config files at the root of shared/settings', async () => {
    const entries = await readdir(sharedSettings);
    expect(entries).toContain('governance.json');
    expect(entries).toContain('git.json');

    const nested = await readdir(path.join(sharedSettings, 'templates'));
    expect(nested).not.toContain('governance.json');
    expect(nested).not.toContain('git.json');
  });

  it('every skills manifest ships both config files to settings/', async () => {
    const files = (await readdir(manifestsDir)).filter((f) => f.endsWith('.json'));
    let checked = 0;

    for (const file of files) {
      const manifest = JSON.parse(await readFile(path.join(manifestsDir, file), 'utf8'));
      const ids = manifest.artifacts.map((a: { id: string }) => a.id);

      // Legacy manifests copy the whole settings dir; skills manifests need explicit entries.
      if (!ids.includes('settings_templates')) continue;
      checked += 1;

      for (const name of ['governance', 'git']) {
        const art = manifest.artifacts.find((a: { id: string }) => a.id === `settings_${name}`);
        expect(art, `${file} is missing settings_${name}`).toBeDefined();
        expect(art.source.from).toBe(`templates/shared/settings/${name}.json`);
        expect(art.source.toDir).toBe('{{SDD_DIR}}/settings');
      }
    }

    expect(checked).toBeGreaterThan(0);
  });

  it('the shipped governance.json parses into the solo profile', async () => {
    const parsed = JSON.parse(await readFile(path.join(sharedSettings, 'governance.json'), 'utf8'));
    expect(parsed.profile).toBe('solo');
  });

  it('the shipped git.json never auto-pushes by default', async () => {
    const parsed = JSON.parse(await readFile(path.join(sharedSettings, 'git.json'), 'utf8'));
    expect(parsed.auto_push).toBe(false);
    expect(parsed.mode).toBe('assisted');
  });

  it('loaders accept the shipped files verbatim (comment keys are ignored)', async () => {
    // shared/settings doubles as a valid .sdd/settings layout for this assertion
    const root = path.resolve('templates/shared');
    const gov = await loadGovernanceSettings(root, 'settings');
    const git = await loadGitSettings(root, 'settings');
    expect(gov.profile).toBe('solo');
    expect(gov.critical_invariants).toEqual([]);
    expect(git.auto_push).toBe(false);
  });
});
