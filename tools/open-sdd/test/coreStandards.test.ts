/**
 * Pruebas del motor de estándares: el cargador rechaza-por-nombre y el ejecutor.
 *
 * Todo lo que se escribe ocurre en fixture `mkdtemp`; del repositorio solo se LEE el catálogo real
 * para comprobar que el que se envía es el mismo y que ninguna entrada pierde su `source`.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STANDARDS_DIR,
  appliesToArtifact,
  isBlocking,
  loadStandards,
  runStandard,
} from '../src/core/standards.js';
import type { StandardEntry } from '../src/core/standardsTypes.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const makeTemp = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'open-sdd-standards-'));
  temps.push(dir);
  return dir;
};

const baseEntry = (overrides: Partial<StandardEntry> = {}): StandardEntry => ({
  id: 'REQ-TEST-001',
  title: 'a test standard',
  category: 'requirements',
  severity: 'warning',
  blocking: false,
  appliesTo: ['requirements.md'],
  standard: 'internal',
  source: '.sdd/settings/rules/ears-format.md#one-template-per-requirement',
  detect: { kind: 'regex', patterns: ['secret'] },
  message: 'a test message',
  remedy: { autoFixable: false, grades: [{ grade: 'maybe-incorrect', text: 'fix it' }] },
  evidence: 'tools/open-sdd/src/core/standards.ts#runStandard',
  calibrated: { corpus: null, recall: null, fpr: null },
  ...overrides,
});

/** Escribe un catálogo con los ficheros dados (`nombre` → objeto JSON). */
const writeCatalogue = async (cwd: string, files: Record<string, unknown>): Promise<string> => {
  const dir = path.join(cwd, STANDARDS_DIR);
  await mkdir(dir, { recursive: true });
  for (const [name, value] of Object.entries(files)) {
    await writeFile(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf8');
  }
  return dir;
};

describe('core/standards — the shipped catalogue', () => {
  it('loads at least twelve entries and rejects none of them', async () => {
    const { entries, rejected } = await loadStandards(repoRoot);
    expect(rejected).toEqual([]);
    expect(entries.length).toBeGreaterThanOrEqual(12);
  });

  it('declares unique ids, a source and the evidence that implements each entry', async () => {
    const { entries } = await loadStandards(repoRoot);
    const ids = entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of entries) {
      expect(entry.source.length, entry.id).toBeGreaterThan(0);
      expect(entry.evidence.length, entry.id).toBeGreaterThan(0);
      expect(entry.blocking, entry.id).toBe(false);
      expect(entry.calibrated.corpus, entry.id).toBeNull();
    }
  });

  it('covers every EARS diagnostic ears.ts can emit', async () => {
    const { entries } = await loadStandards(repoRoot);
    const patterns = entries.flatMap((entry) => entry.detect.patterns ?? []);
    for (const code of [
      'NO_SHALL',
      'NO_TEMPLATE_MATCH',
      'MULTIPLE_TEMPLATES',
      'COMPOUND_REQUIREMENT',
      'MISSING_THEN',
      'VAGUE_TERM',
      'EMPTY_RESPONSE',
    ]) {
      expect(patterns, code).toContain(`ears-issue:${code}`);
    }
  });

  it('ships the same catalogue under the templates layout', async () => {
    const repoDir = path.join(repoRoot, STANDARDS_DIR);
    const templateDir = path.join(repoRoot, 'tools/open-sdd/templates/shared/settings/standards');
    const names = (await readdir(repoDir)).filter((name) => name.endsWith('.json')).sort();
    const templateNames = (await readdir(templateDir)).filter((name) => name.endsWith('.json')).sort();
    expect(templateNames).toEqual(names);
    for (const name of names) {
      expect(await readFile(path.join(templateDir, name), 'utf8'), name).toBe(
        await readFile(path.join(repoDir, name), 'utf8'),
      );
    }
  });
});

describe('core/standards — loadStandards rejects by name', () => {
  it('treats an absent catalogue as empty, not as an error', async () => {
    const cwd = await makeTemp();
    await expect(loadStandards(cwd)).resolves.toEqual({ entries: [], rejected: [] });
  });

  it('rejects a malformed entry naming its file and the missing field, and keeps the valid one', async () => {
    const cwd = await makeTemp();
    await writeCatalogue(cwd, {
      'broken.json': { id: 'REQ-BROKEN-001', title: 'no severity', category: 'requirements' },
      'good.json': baseEntry({ id: 'REQ-GOOD-001' }),
    });
    const { entries, rejected } = await loadStandards(cwd);
    expect(entries.map((entry) => entry.id)).toEqual(['REQ-GOOD-001']);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].file).toBe(`${STANDARDS_DIR}/broken.json`);
    expect(rejected[0].reason).toContain('severity');
  });

  it('rejects an unknown named structural rule instead of skipping it silently', async () => {
    const cwd = await makeTemp();
    await writeCatalogue(cwd, {
      'unknown.json': baseEntry({ detect: { kind: 'structural', patterns: ['no-such-rule'] } }),
    });
    const { entries, rejected } = await loadStandards(cwd);
    expect(entries).toEqual([]);
    expect(rejected[0].reason).toContain('no-such-rule');
  });

  it('rejects a question entry that prescribes remedies', async () => {
    const cwd = await makeTemp();
    await writeCatalogue(cwd, {
      'question-with-remedy.json': baseEntry({
        detect: { kind: 'question', patterns: [] },
        remedy: { autoFixable: false, grades: [{ grade: 'needs-human', text: 'do something' }] },
      }),
    });
    const { rejected } = await loadStandards(cwd);
    expect(rejected[0].reason).toContain('question');
  });

  it('rejects a non-question entry with no remedy at all', async () => {
    const cwd = await makeTemp();
    await writeCatalogue(cwd, { 'no-remedy.json': baseEntry({ remedy: { autoFixable: false, grades: [] } }) });
    const { rejected } = await loadStandards(cwd);
    expect(rejected[0].reason).toContain('remedio');
  });

  it('rejects an uncompilable regex and invalid JSON without throwing', async () => {
    const cwd = await makeTemp();
    await writeCatalogue(cwd, {
      'bad-regex.json': baseEntry({ detect: { kind: 'regex', patterns: ['('] } }),
      'bad-json.json': '{ not json',
    });
    const { entries, rejected } = await loadStandards(cwd);
    expect(entries).toEqual([]);
    expect(rejected).toHaveLength(2);
    expect(rejected.map((r) => r.reason).join(' | ')).toContain('no compila');
    expect(rejected.map((r) => r.reason).join(' | ')).toContain('JSON inválido');
  });

  it('rejects a duplicate id, keeping the first declaration', async () => {
    const cwd = await makeTemp();
    await writeCatalogue(cwd, {
      'a.json': baseEntry({ id: 'REQ-DUP-001' }),
      'b.json': baseEntry({ id: 'REQ-DUP-001' }),
    });
    const { entries, rejected } = await loadStandards(cwd);
    expect(entries.map((entry) => entry.id)).toEqual(['REQ-DUP-001']);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].file).toContain('b.json');
    expect(rejected[0].reason).toContain('REQ-DUP-001');
  });

  it('rejects a declared corpus without recall and fpr', async () => {
    const cwd = await makeTemp();
    await writeCatalogue(cwd, {
      'half-calibrated.json': baseEntry({ calibrated: { corpus: 'corpus/x.md', recall: null, fpr: null } }),
    });
    const { rejected } = await loadStandards(cwd);
    expect(rejected[0].reason).toContain('calibrated.recall');
  });
});

describe('core/standards — runStandard reports positioned findings', () => {
  it('reports the first regex match with its line, column and span', () => {
    const entry = baseEntry({ detect: { kind: 'regex', patterns: ['\\bsecret\\b'] } });
    const findings = runStandard(entry, { file: 'requirements.md', text: 'line one\nkeep secret here\nsecret again' });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ standardId: 'REQ-TEST-001', line: 2, column: 6, span: 'secret' });
  });

  it('delegates EARS diagnostics to ears.ts and anchors them at the statement', () => {
    const entry = baseEntry({
      detect: { kind: 'structural', patterns: ['ears-issue:NO_SHALL'] },
      severity: 'error',
    });
    const text = ['# Spec', '', '### REQ-X-001 — Thing', '', '- Statement: WHEN a request arrives, the system replies.'].join('\n');
    const findings = runStandard(entry, { file: 'requirements.md', text });
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(5);
    expect(findings[0].column).toBe(14);
    expect(findings[0].remedies.length).toBeGreaterThan(0);
  });

  it('abstains with a question and no remedy when a question entry cannot find its datum', () => {
    const entry = baseEntry({
      detect: { kind: 'question', patterns: ['"language"\\s*:'] },
      remedy: { autoFixable: false, grades: [] },
    });
    const missing = runStandard(entry, { file: 'spec.json', text: '{ "feature": "demo" }' });
    expect(missing).toHaveLength(1);
    expect(missing[0].remedies).toEqual([]);
    expect(missing[0].question).toBeTruthy();

    const found = runStandard(entry, { file: 'spec.json', text: '{ "language": "es" }' });
    expect(found).toEqual([]);
  });

  it('never fabricates a pass on an empty artifact, whatever the detection kind', () => {
    const text = '   \n';
    for (const kind of ['regex', 'structural', 'heuristic', 'question'] as const) {
      const patterns =
        kind === 'regex'
          ? ['secret']
          : kind === 'structural'
            ? ['ears-issue:NO_SHALL']
            : kind === 'heuristic'
              ? ['single-behaviour']
              : [];
      const entry = baseEntry({
        detect: { kind, patterns },
        ...(kind === 'question' ? { remedy: { autoFixable: false, grades: [] } } : {}),
      });
      const findings = runStandard(entry, { file: 'requirements.md', text });
      expect(findings.length, kind).toBeGreaterThan(0);
      for (const finding of findings) expect(finding.question, kind).toBeTruthy();
    }
  });

  it('honours blocking only when a corpus is measured, and publishes recall and fpr', async () => {
    const declared = baseEntry({ blocking: true });
    expect(isBlocking(declared)).toBe(false);

    const calibrated: StandardEntry = {
      ...declared,
      calibrated: { corpus: 'corpus/ears.md', recall: 0.9, fpr: 0.1 },
    };
    expect(isBlocking(calibrated)).toBe(true);
    const findings = runStandard(calibrated, { file: 'requirements.md', text: 'a secret here' });
    expect(findings[0].message).toContain('calibrado sobre `corpus/ears.md`');
    expect(findings[0].message).toContain('recall 0.9');
    expect(findings[0].message).toContain('fpr 0.1');
  });

  it('matches artifacts by basename or by glob', () => {
    const entry = baseEntry({ appliesTo: ['requirements.md', '.sdd/specs/**/*.md'] });
    expect(appliesToArtifact(entry, '.sdd/specs/demo/requirements.md')).toBe(true);
    expect(appliesToArtifact(entry, 'docs/other.md')).toBe(false);
    expect(appliesToArtifact(entry, 'plan.md')).toBe(false);
  });

  it('keeps the house style: lowercase-first, no trailing period', async () => {
    const { entries } = await loadStandards(repoRoot);
    for (const entry of entries) {
      for (const finding of runStandard(entry, { file: 'requirements.md', text: 'the gateway shall respond approximately' })) {
        expect(finding.message, entry.id).not.toMatch(/[.。]$/);
        expect(finding.message.charAt(0), entry.id).toBe(finding.message.charAt(0).toLowerCase());
      }
    }
  });
});
