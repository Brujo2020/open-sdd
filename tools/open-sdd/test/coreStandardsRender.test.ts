/**
 * Pruebas del render determinista y del informe de deriva (REQ-STD-002).
 *
 * El render se materializa SOLO en fixture `mkdtemp`. Del repositorio se comprueba que `detectDrift`
 * nombra las entradas que discrepan y que NO ha tocado los `rules/*.md` reales.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStandards } from '../src/core/standards.js';
import { detectDrift, renderEntryBlock, renderRules, ruleFileOf, writeRules } from '../src/core/standardsRender.js';
import type { StandardEntry } from '../src/core/standardsTypes.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const makeTemp = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'open-sdd-render-'));
  temps.push(dir);
  return dir;
};

const entry = (id: string, source: string, title = id): StandardEntry => ({
  id,
  title,
  category: 'requirements',
  severity: 'warning',
  blocking: false,
  appliesTo: ['requirements.md'],
  standard: 'internal',
  source,
  detect: { kind: 'regex', patterns: ['secret'] },
  message: `${id} message`,
  remedy: { autoFixable: false, grades: [{ grade: 'maybe-incorrect', text: 'fix it' }] },
  evidence: 'tools/open-sdd/src/core/standards.ts#runStandard',
  calibrated: { corpus: null, recall: null, fpr: null },
});

describe('core/standardsRender — deterministic rendering', () => {
  it('groups entries by the rule file they cite and skips external URLs', () => {
    const entries = [
      entry('REQ-B-001', '.sdd/settings/rules/b.md#anchor'),
      entry('REQ-A-002', '.sdd/settings/rules/a.md#anchor'),
      entry('REQ-A-001', '.sdd/settings/rules/a.md#anchor'),
      entry('REQ-C-001', 'https://example.com/standard'),
    ];
    const rendered = renderRules(entries);
    expect(rendered.map((rule) => rule.file)).toEqual(['.sdd/settings/rules/a.md', '.sdd/settings/rules/b.md']);
    const a = rendered[0].content;
    expect(a.indexOf('REQ-A-001')).toBeLessThan(a.indexOf('REQ-A-002'));
    expect(rendered.map((rule) => rule.content).join('\n')).not.toContain('REQ-C-001');
  });

  it('is byte-deterministic for the same catalogue', () => {
    const entries = [entry('REQ-A-001', '.sdd/settings/rules/a.md#anchor')];
    expect(renderRules(entries)).toEqual(renderRules(entries));
  });

  it('reads the file out of an anchor and ignores non-markdown sources', () => {
    expect(ruleFileOf('.sdd/settings/rules/ears-format.md#one-template-per-requirement')).toBe(
      '.sdd/settings/rules/ears-format.md',
    );
    expect(ruleFileOf('./.sdd/settings/rules/x.md')).toBe('.sdd/settings/rules/x.md');
    expect(ruleFileOf('https://example.com/x.md#y')).toBeNull();
    expect(ruleFileOf('some/other/source.txt')).toBeNull();
  });
});

describe('core/standardsRender — drift names the entry that disagrees', () => {
  it('reports no drift right after writing the render', async () => {
    const cwd = await makeTemp();
    const entries = [
      entry('REQ-A-001', '.sdd/settings/rules/a.md#anchor'),
      entry('REQ-B-001', '.sdd/settings/rules/b.md#anchor'),
    ];
    const written = await writeRules(cwd, entries);
    expect(written.sort()).toEqual(['.sdd/settings/rules/a.md', '.sdd/settings/rules/b.md']);
    expect(await detectDrift(cwd, entries)).toEqual([]);
  });

  it('names the entry whose rendered block was hand-edited away', async () => {
    const cwd = await makeTemp();
    const a = entry('REQ-A-001', '.sdd/settings/rules/a.md#anchor');
    const b = entry('REQ-A-002', '.sdd/settings/rules/a.md#anchor');
    await writeRules(cwd, [a, b]);
    const abs = path.resolve(cwd, '.sdd/settings/rules/a.md');
    const onDisk = await readFile(abs, 'utf8');
    await (await import('node:fs/promises')).writeFile(abs, onDisk.replace(renderEntryBlock(b), 'edited by hand'), 'utf8');

    const drift = await detectDrift(cwd, [a, b]);
    expect(drift).toHaveLength(1);
    expect(drift[0].file).toBe('.sdd/settings/rules/a.md');
    expect(drift[0].reason).toBe('differs');
    expect(drift[0].entries).toEqual(['REQ-A-002']);
  });

  it('reports a rendered file that is missing from disk', async () => {
    const cwd = await makeTemp();
    const entries = [entry('REQ-A-001', '.sdd/settings/rules/a.md#anchor')];
    const drift = await detectDrift(cwd, entries);
    expect(drift).toEqual([{ file: '.sdd/settings/rules/a.md', reason: 'missing', entries: ['REQ-A-001'] }]);
  });

  it('reports the repository rules as drifted without overwriting them', async () => {
    const { entries } = await loadStandards(repoRoot);
    const drift = await detectDrift(repoRoot, entries);
    const byFile = new Map(drift.map((rule) => [rule.file, rule]));
    expect(byFile.has('.sdd/settings/rules/ears-format.md')).toBe(true);
    expect(byFile.has('.sdd/settings/rules/requirements-review-gate.md')).toBe(true);
    expect(byFile.get('.sdd/settings/rules/ears-format.md')?.entries).toContain('REQ-EARS-001');
    expect(byFile.get('.sdd/settings/rules/requirements-review-gate.md')?.entries).toContain('REQ-GATE-001');

    // El render vive en memoria; el markdown real conserva su prosa y no lleva marcadores generados.
    const onDisk = await readFile(path.resolve(repoRoot, '.sdd/settings/rules/ears-format.md'), 'utf8');
    expect(onDisk).toContain('## One template per requirement');
    expect(onDisk).not.toContain('<!-- standards:');
  });
});
