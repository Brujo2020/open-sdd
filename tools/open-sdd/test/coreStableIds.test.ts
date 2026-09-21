import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  allocateBlock,
  auditIds,
  auditIdsAgainstBase,
  normalizeStatement,
  parseRequirementIds,
} from '../src/core/stableIds.js';

const dirs: string[] = [];
const makeRepo = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-ids-'));
  dirs.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'gate@open-sdd.test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'gate'], { cwd: dir });
  return dir;
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const REQUIREMENTS = '.sdd/specs/payments/requirements.md';

describe('core/stableIds — a citation must keep meaning the same thing', () => {
  it('parses ids and their statements from headings and bullets', () => {
    const parsed = parseRequirementIds(
      [
        '### REQ-PAY-014 — The System shall record the refund.',
        '- REQ-PAY-015: The System shall notify the Customer.',
        'REQ-PAY-016 The System shall retry once.',
        'Not an id: REQ- lowercase.',
      ].join('\n'),
    );
    expect([...parsed.keys()]).toEqual(['REQ-PAY-014', 'REQ-PAY-015', 'REQ-PAY-016']);
    expect(parsed.get('REQ-PAY-014')).toBe(normalizeStatement('The System shall record the refund.'));
  });

  it('reports ID-MUTATED for the same id with another statement, and ID-LOST when it disappears', () => {
    const before = new Map([
      ['REQ-PAY-014', normalizeStatement('The System shall record the refund.')],
      ['REQ-PAY-015', normalizeStatement('The System shall notify the Customer.')],
    ]);
    const after = new Map([
      ['REQ-PAY-014', normalizeStatement('The System shall record the refund within 5 s.')],
    ]);

    const findings = auditIds({ before, after });
    expect(findings.map((finding) => finding.code).sort()).toEqual(['ID-LOST', 'ID-MUTATED']);
    expect(findings.find((finding) => finding.code === 'ID-MUTATED')?.id).toBe('REQ-PAY-014');
    expect(findings.find((finding) => finding.code === 'ID-LOST')?.id).toBe('REQ-PAY-015');
  });

  it('reports nothing when neither the ids nor their meaning moved', () => {
    const before = new Map([['REQ-PAY-014', normalizeStatement('The System shall record the refund.')]]);
    const after = new Map([['REQ-PAY-014', normalizeStatement('  the system SHALL record the refund. ')]]);
    expect(auditIds({ before, after })).toEqual([]);
  });

  it('allocates the next free block so inserting never renumbers', () => {
    expect(allocateBlock('PAY', [])[0]).toBe('REQ-PAY-010');
    expect(allocateBlock('PAY', ['REQ-PAY-007'])).toContain('REQ-PAY-010');
    // Con 014 usado, el siguiente bloque empieza en 020: no se reutiliza ni se renumera el 014.
    const next = allocateBlock('PAY', ['REQ-PAY-014', 'REQ-PAY-002']);
    expect(next[0]).toBe('REQ-PAY-020');
    expect(next).toHaveLength(10);
  });

  it('audits against a real base revision and names a changed meaning and a vanished id', async () => {
    const repo = await makeRepo();
    await mkdir(path.join(repo, '.sdd/specs/payments'), { recursive: true });
    const first = [
      '# Requirements — payments',
      '',
      '### REQ-PAY-014 — The System shall record the refund.',
      '### REQ-PAY-015 — The System shall notify the Customer.',
      '',
    ].join('\n');
    await writeFile(path.join(repo, REQUIREMENTS), first, 'utf8');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

    const second = ['# Requirements — payments', '', '### REQ-PAY-014 — The System shall record the refund within 5 s.', ''].join('\n');
    await writeFile(path.join(repo, REQUIREMENTS), second, 'utf8');

    const report = auditIdsAgainstBase({
      cwd: repo,
      base: 'HEAD',
      requirementsRelPath: REQUIREMENTS,
      afterText: await readFile(path.join(repo, REQUIREMENTS), 'utf8'),
    });

    expect(report.problems).toEqual([]);
    expect(report.beforeCount).toBe(2);
    expect(report.afterCount).toBe(1);
    expect(report.findings.map((finding) => finding.code).sort()).toEqual(['ID-LOST', 'ID-MUTATED']);
  });

  it('refuses to audit when the base does not resolve, instead of inventing a verdict', async () => {
    const repo = await makeRepo();
    await mkdir(path.join(repo, '.sdd/specs/payments'), { recursive: true });
    await writeFile(path.join(repo, REQUIREMENTS), '### REQ-PAY-014 — The System shall record the refund.\n', 'utf8');

    const report = auditIdsAgainstBase({
      cwd: repo,
      base: 'no-such-ref',
      requirementsRelPath: REQUIREMENTS,
      afterText: await readFile(path.join(repo, REQUIREMENTS), 'utf8'),
    });

    expect(report.findings).toEqual([]);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toContain('no se pudo leer');
  });
});
