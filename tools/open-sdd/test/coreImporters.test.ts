/**
 * `open-sdd import` — absorbing Kiro, spec-kit and cc-sdd.
 *
 * Fixtures live in `mkdtemp` and are removed in `afterEach`: the suite NEVER writes inside the
 * repository. The contract under test is deliberately pessimistic, because the importer is:
 * a conversion is a MAPPING, every artifact we cannot map is a named `skip`, the plan says in
 * `detail` what it did not convert, an invalid constitution is reported instead of silently copied,
 * and `applyImport` never overwrites an existing file.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyImport, planImport } from '../src/core/importers.js';
import { handleImportCommand } from '../src/cli/commands/init.js';

const tempDirs: string[] = [];

const makeRoot = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-import-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

const makeIO = () => {
  const logs: string[] = [];
  const errs: string[] = [];
  return {
    io: {
      log: (message: string) => logs.push(message),
      error: (message: string) => errs.push(message),
      exit: () => undefined,
    },
    get logs() {
      return logs;
    },
    get errs() {
      return errs;
    },
    text: () => logs.join('\n'),
  };
};

const write = async (dir: string, rel: string, content: string): Promise<void> => {
  const full = path.join(dir, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
};

const exists = async (p: string): Promise<boolean> => (await stat(p).catch(() => null)) !== null;

const readText = (p: string): Promise<string> => readFile(p, 'utf8');

const kiroFixture = async (dir: string): Promise<void> => {
  await write(dir, '.kiro/steering/product.md', '# Product\n\nProject memory.\n');
  await write(dir, '.kiro/specs/order-flow/requirements.md', '# Requirements\n\n- R1\n');
  await write(dir, '.kiro/specs/order-flow/design.md', '# Design\n\nArchitecture.\n');
  await write(dir, '.kiro/specs/order-flow/tasks.md', '# Tasks\n\n- [ ] T1 _Boundary:_ src/a.ts\n');
  await write(dir, '.kiro/specs/order-flow/spec.json', '{ "specId": "order-flow" }\n');
  await write(dir, '.kiro/settings/rigor.json', '{ "level": "solo" }\n');
  await write(dir, '.kiro/settings/notes.txt', 'not a json setting\n');
};

describe('importers — Kiro', () => {
  it('plans the steering and triad mappings and skips what it cannot map', async () => {
    const dir = await makeRoot();
    await kiroFixture(dir);

    const plans = await planImport(dir);
    const kiro = plans.find((plan) => plan.source === 'kiro');
    expect(kiro).toBeDefined();
    if (!kiro) return;

    const from = (name: string) => kiro.conversions.find((conversion) => conversion.from.endsWith(name));

    expect(from('product.md')?.to).toBe('.sdd/steering/product.md');
    expect(from('product.md')?.action).toBe('copy');

    expect(from('requirements.md')?.to).toBe('.sdd/specs/order-flow/requirements.md');
    expect(from('requirements.md')?.action).toBe('copy');

    // `design.md` is a declared alias of `plan.md` in triad.ts: the mapping says so and normalizes.
    const design = from('design.md');
    expect(design?.to).toBe('.sdd/specs/order-flow/plan.md');
    expect(design?.action).toBe('convert');
    expect(design?.reason).toContain('triad.ts');

    expect(from('tasks.md')?.to).toBe('.sdd/specs/order-flow/tasks.md');
    expect(from('rigor.json')?.action).toBe('convert');

    // The two artifacts it cannot map are named, with a reason each.
    expect(from('spec.json')?.action).toBe('skip');
    expect(from('spec.json')?.reason).toContain('open-sdd init');
    expect(from('notes.txt')?.action).toBe('skip');
    expect(kiro.complete).toBe(false);
    expect(kiro.detail).toContain('NO se convierte');
    expect(kiro.detail).toContain('.kiro/settings/notes.txt');
  });

  it('applyImport never overwrites an existing file', async () => {
    const dir = await makeRoot();
    await kiroFixture(dir);
    await write(dir, '.sdd/steering/product.md', 'LOCAL EDIT — do not touch\n');

    const [kiro] = await planImport(dir, 'kiro');
    const outcome = await applyImport(dir, kiro, { write: true });

    expect(outcome.skipped.some((item) => item.includes('.sdd/steering/product.md'))).toBe(true);
    expect(outcome.written).not.toContain('.sdd/steering/product.md');
    expect(await readText(path.join(dir, '.sdd/steering/product.md'))).toBe('LOCAL EDIT — do not touch\n');

    // Everything that did not exist was written.
    expect(outcome.written).toContain('.sdd/specs/order-flow/requirements.md');
    expect(outcome.written).toContain('.sdd/specs/order-flow/plan.md');
    expect(await exists(path.join(dir, '.sdd/specs/order-flow/plan.md'))).toBe(true);
    expect(outcome.detail).toContain('Ningún fichero existente se ha sobrescrito');
  });

  it('without --write nothing is written at all', async () => {
    const dir = await makeRoot();
    await kiroFixture(dir);
    const [kiro] = await planImport(dir, 'kiro');

    const outcome = await applyImport(dir, kiro, { write: false });
    expect(outcome.written).toEqual([]);
    expect(outcome.skipped).toEqual([]);
    expect(await exists(path.join(dir, '.sdd'))).toBe(false);
  });

  it('warns that `.kiro` is already read in place, so two roots must not coexist', async () => {
    const dir = await makeRoot();
    await kiroFixture(dir);
    const [kiro] = await planImport(dir, 'kiro');
    expect(kiro.warnings.some((warning) => warning.includes('resolveSddDir'))).toBe(true);
  });
});

describe('importers — spec-kit', () => {
  const specKitFixture = async (dir: string): Promise<void> => {
    await write(
      dir,
      '.specify/memory/constitution.md',
      ['# Acme Constitution', '', '## Principles', '', '### P-01 — Library first', '', '- Level: MUST', '- Restriction: Every feature starts as a library.', ''].join('\n'),
    );
    await write(dir, '.specify/specs/001-auth/spec.md', '# Auth spec\n\n## User Scenarios\n\nA user signs in.\n');
    await write(dir, '.specify/specs/001-auth/plan.md', '# Plan\n');
    await write(dir, '.specify/specs/001-auth/tasks.md', '# Tasks\n');
    await write(dir, '.specify/specs/001-auth/research.md', '# Research\n');
    await write(dir, '.specify/specs/001-auth/notes.md', 'unmapped document\n');
    await write(dir, '.specify/templates/spec-template.md', 'template\n');
  };

  it('reports the validation issues of an invalid constitution instead of copying it silently', async () => {
    const dir = await makeRoot();
    await specKitFixture(dir);

    const [plan] = await planImport(dir, 'spec-kit');
    expect(plan.source).toBe('spec-kit');
    expect(plan.warnings.some((warning) => warning.includes('validateConstitution') && warning.includes('ID-POSITIONAL'))).toBe(
      true,
    );
    expect(plan.complete).toBe(false);

    const constitution = plan.conversions.find((conversion) => conversion.from.endsWith('constitution.md'));
    expect(constitution?.action).toBe('convert');
    expect(constitution?.reason).toContain('VERBATIM');

    const outcome = await applyImport(dir, plan, { write: true });
    expect(outcome.written).toContain('.sdd/steering/constitution.md');
    // Verbatim: the validator's findings never become silent edits.
    expect(await readText(path.join(dir, '.sdd/steering/constitution.md'))).toBe(
      await readText(path.join(dir, '.specify/memory/constitution.md')),
    );
  });

  it('maps spec.md to requirements.md behind a provenance banner and skips templates by design', async () => {
    const dir = await makeRoot();
    await specKitFixture(dir);

    const [plan] = await planImport(dir, 'spec-kit');
    const spec = plan.conversions.find((conversion) => conversion.from.endsWith('spec.md'));
    expect(spec?.to).toBe('.sdd/specs/001-auth/requirements.md');
    expect(spec?.action).toBe('convert');
    expect(spec?.reason).toContain('NO es EARS');

    const templates = plan.conversions.find((conversion) => conversion.from === '.specify/templates');
    expect(templates?.action).toBe('skip');
    expect(templates?.reason).toContain('distintas por diseño');

    const notes = plan.conversions.find((conversion) => conversion.from.endsWith('notes.md'));
    expect(notes?.action).toBe('skip');

    await applyImport(dir, plan, { write: true });
    const requirements = await readText(path.join(dir, '.sdd/specs/001-auth/requirements.md'));
    expect(requirements.startsWith('<!-- Importado por open-sdd')).toBe(true);
    expect(requirements).toContain('A user signs in.');
    expect(plan.detail).toContain('MAPEO');
  });

  it('with an explicit source, an empty repository still yields one honest plan', async () => {
    const dir = await makeRoot();
    const [plan] = await planImport(dir, 'spec-kit');
    expect(plan.found).toEqual([]);
    expect(plan.complete).toBe(false);
    expect(plan.detail).toContain('No se observó');
  });
});

describe('importers — cc-sdd', () => {
  it('maps the Kiro-compatible specs, reports boundary annotations and skips its skills', async () => {
    const dir = await makeRoot();
    await write(dir, 'package.json', JSON.stringify({ devDependencies: { 'cc-sdd': '^2.0.0' } }, null, 2));
    await write(dir, '.kiro/specs/f1/requirements.md', '# R\n');
    await write(dir, '.kiro/specs/f1/design.md', '# D\n');
    await write(
      dir,
      '.kiro/specs/f1/tasks.md',
      '# T\n\n- [ ] T1 _Boundary:_ src/a.ts\n- [ ] T2 _Depends:_ T1\n',
    );
    await write(dir, '.claude/skills/kiro-spec-requirements/SKILL.md', 'foreign skill\n');

    const plans = await planImport(dir);
    const ccSdd = plans.find((plan) => plan.source === 'cc-sdd');
    expect(ccSdd).toBeDefined();
    if (!ccSdd) return;

    expect(ccSdd.conversions.find((conversion) => conversion.from.endsWith('design.md'))?.to).toBe(
      '.sdd/specs/f1/plan.md',
    );
    expect(ccSdd.conversions.some((conversion) => conversion.action === 'skip' && conversion.from.includes('kiro-spec-requirements'))).toBe(
      true,
    );
    expect(ccSdd.warnings.some((warning) => warning.includes('_Boundary:_') && warning.includes('_Depends:_'))).toBe(true);
    expect(ccSdd.found.some((item) => item.kind === 'skills')).toBe(true);
  });
});

describe('importers — no incumbent observed', () => {
  it('planImport without a source returns nothing when no incumbent is present', async () => {
    const dir = await makeRoot();
    expect(await planImport(dir)).toEqual([]);
  });

  it('the CLI reports the absence and validates the source', async () => {
    const dir = await makeRoot();
    const empty = makeIO();
    expect(await handleImportCommand([], empty.io, dir)).toBe(0);
    expect(empty.text()).toContain('No se observó ningún incumbente');

    const bad = makeIO();
    expect(await handleImportCommand(['svn'], bad.io, dir)).toBe(1);
    expect(bad.errs.join('\n')).toContain('spec-kit');
  });

  it('the CLI emits the plan as JSON for a real fixture', async () => {
    const dir = await makeRoot();
    await kiroFixture(dir);
    const ctx = makeIO();
    expect(await handleImportCommand(['kiro', '--json'], ctx.io, dir)).toBe(0);

    const output = JSON.parse(ctx.text()) as { plans: { source: string; conversions: unknown[] }[] };
    expect(output.plans[0].source).toBe('kiro');
    expect(output.plans[0].conversions.length).toBeGreaterThan(0);
  });
});
