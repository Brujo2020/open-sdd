import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadStandards } from '../src/core/standards.js';
import { detectDrift, injectRules } from '../src/core/standardsRender.js';

const dirs: string[] = [];
const makeRepo = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-inject-'));
  dirs.push(dir);
  return dir;
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const ENTRY = {
  id: 'REQ-INJ-001',
  title: 'A standard that lives in a rule file',
  category: 'requirements',
  severity: 'warning',
  blocking: false,
  appliesTo: ['requirements.md'],
  standard: 'EARS',
  source: '.sdd/settings/rules/ears-format.md#anchor',
  detect: { kind: 'regex', patterns: ['\\bshall\\b'] },
  message: 'the message',
  remedy: { autoFixable: false, grades: [{ grade: 'needs-human', text: 'ask a human' }] },
  evidence: 'core/standards.ts',
  calibrated: { corpus: null, recall: null, fpr: null },
};

const RULE = '.sdd/settings/rules/ears-format.md';

const seed = async (cwd: string, ruleContent: string): Promise<void> => {
  await mkdir(path.join(cwd, '.sdd/settings/standards'), { recursive: true });
  await writeFile(path.join(cwd, '.sdd/settings/standards/req-inj-001.json'), JSON.stringify(ENTRY), 'utf8');
  await mkdir(path.join(cwd, '.sdd/settings/rules'), { recursive: true });
  await writeFile(path.join(cwd, RULE), ruleContent, 'utf8');
};

describe('core/standardsRender — injecting into a living document', () => {
  it('appends the generated block and keeps the hand-written prose byte for byte', async () => {
    const cwd = await makeRepo();
    const prose = '# EARS Format Guidelines\n\nHand-written prose that must survive.\n';
    await seed(cwd, prose);

    const { entries } = await loadStandards(cwd);
    const first = await injectRules(cwd, entries);
    expect(first.find((item) => item.file === RULE)?.action).toBe('updated');

    const after = await readFile(path.join(cwd, RULE), 'utf8');
    expect(after).toContain('Hand-written prose that must survive.');
    expect(after).toContain('<!-- standards:REQ-INJ-001:begin -->');
    expect(after).toContain('## Generated standards');
    // El chequeo de drift que ya existía pasa a cero: el bloque está y coincide.
    expect(await detectDrift(cwd, entries)).toEqual([]);
  });

  it('is idempotent: a second pass changes nothing', async () => {
    const cwd = await makeRepo();
    await seed(cwd, '# EARS\n\nProse.\n');
    const { entries } = await loadStandards(cwd);

    await injectRules(cwd, entries);
    const before = await readFile(path.join(cwd, RULE), 'utf8');
    const second = await injectRules(cwd, entries);

    expect(second.find((item) => item.file === RULE)?.action).toBe('kept');
    expect(await readFile(path.join(cwd, RULE), 'utf8')).toBe(before);
  });

  it('replaces an existing marked block in place, and touches nothing outside it', async () => {
    const cwd = await makeRepo();
    const stale = [
      '# EARS',
      '',
      'Prose before.',
      '',
      '<!-- standards:REQ-INJ-001:begin -->',
      '## REQ-INJ-001 — STALE TITLE',
      '<!-- standards:REQ-INJ-001:end -->',
      '',
      'Prose after.',
      '',
    ].join('\n');
    await seed(cwd, stale);

    const { entries } = await loadStandards(cwd);
    await injectRules(cwd, entries);

    const after = await readFile(path.join(cwd, RULE), 'utf8');
    expect(after).toContain('Prose before.');
    expect(after).toContain('Prose after.');
    expect(after).not.toContain('STALE TITLE');
    expect(after).toContain('A standard that lives in a rule file');
    // No se añade una segunda sección: el bloque existía y se reemplazó.
    expect(after.match(/## Generated standards/g) ?? []).toHaveLength(0);
  });

  it('creates the rule file when it does not exist yet', async () => {
    const cwd = await makeRepo();
    await mkdir(path.join(cwd, '.sdd/settings/standards'), { recursive: true });
    await writeFile(path.join(cwd, '.sdd/settings/standards/req-inj-001.json'), JSON.stringify(ENTRY), 'utf8');

    const { entries } = await loadStandards(cwd);
    const result = await injectRules(cwd, entries);
    expect(result.find((item) => item.file === RULE)?.action).toBe('created');
    const created = await readFile(path.join(cwd, RULE), 'utf8');
    expect(created).toContain('GENERATED from .sdd/settings/standards');
  });
});
