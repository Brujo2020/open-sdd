/**
 * Modules ported from SteelForge: EARS → Gherkin, task-structure checks (through `consistency`), the discovery
 * brief gate and log, archive, steering readiness, the SDD modes matrix and stage guide, and their console.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { archiveFeature } from '../src/core/archive.js';
import { checkConsistency } from '../src/core/consistency.js';
import { appendDiscoveryLog, hasSecret, lintBrief, logLine } from '../src/core/discoveryBrief.js';
import { buildFeatureFile, earsToScenario, lintGherkin, parseEarsParts } from '../src/core/earsGherkin.js';
import { modulesFor, stagesFor } from '../src/core/sddModes.js';
import { checkSteering } from '../src/core/steeringCheck.js';
import { checkTaskStructure } from '../src/core/taskStructure.js';
import { findTechnologyInRequirements } from '../src/core/requirementTechnology.js';
import { parseRequirementsMarkdown } from '../src/core/specManager.js';
import { handleModesCommand } from '../src/cli/commands/modes.js';
import type { CliIO } from '../src/cli/io.js';

const temps: string[] = [];
const makeTemp = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'osdd-sf-'));
  temps.push(dir);
  return dir;
};
afterEach(async () => {
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
const makeIO = (): { io: CliIO; logs: string[]; errs: string[] } => {
  const logs: string[] = [];
  const errs: string[] = [];
  return { io: { log: (m: string) => logs.push(m), error: (m: string) => errs.push(m) }, logs, errs };
};
// Fake credentials are built at runtime so no literal looks like a real key to secret scanners.
const exists = async (p: string): Promise<boolean> => (await stat(p).catch(() => null)) !== null;

describe('EARS → Gherkin', () => {
  it('maps each EARS pattern to Given/When/Then without inventing data', () => {
    expect(parseEarsParts('WHEN the user saves, the system shall persist the draft')).toMatchObject({ pattern: 'event-driven', trigger: 'the user saves', subject: 'the system', modal: 'shall', response: 'persist the draft' });
    expect(parseEarsParts('WHILE offline, the app shall queue writes')?.pattern).toBe('state-driven');
    expect(parseEarsParts('WHERE export is enabled, the system shall offer CSV')?.pattern).toBe('optional');
    expect(parseEarsParts('IF the token expires, THEN the system shall ask to sign in again')).toMatchObject({ pattern: 'unwanted', condition: 'the token expires' });
    expect(parseEarsParts('WHILE offline, WHEN the user saves, the app shall queue the write')).toMatchObject({ pattern: 'complex', state: 'offline', trigger: 'the user saves' });
    expect(parseEarsParts('Cuando el pago falla, el sistema debe mostrar el motivo')).toMatchObject({ pattern: 'event-driven', modal: 'debe' });
    expect(parseEarsParts('The page should be fast')).toBeNull();
  });

  it('builds a feature file traced to each requirement and skips what is not EARS, with the reason', () => {
    const reqs = parseRequirementsMarkdown('### REQ-PAY-001: Retry\n- WHEN the payment fails, the system shall show the reason\n- It is nice\n### REQ-PAY-002: Empty\n');
    const f = buildFeatureFile('payments', reqs, 'en');
    expect(f.text).toContain('@REQ-PAY-001 @event-driven');
    expect(f.text).toContain('    When the payment fails');
    expect(f.text).toContain('    Then the system shall show the reason');
    expect(f.converted).toEqual(['REQ-PAY-001#1']);
    expect(f.skipped[0]).toMatch(/REQ-PAY-001: .*not EARS/);
    expect(f.empty).toEqual(['REQ-PAY-002']);
    expect(lintGherkin(f.text)).toEqual([]);
    expect(buildFeatureFile('pagos', reqs, 'es').text.startsWith('# language: es\nCaracterística: pagos')).toBe(true);
  });

  it('the lint rejects untraced scenarios, scenarios without Then and placeholders', () => {
    expect(lintGherkin('Feature: x\n  Scenario: a\n    Given y\n')).toEqual(['"a": no @REQ-… tag (the scenario is not traced to a requirement)', '"a": no Then/Entonces step (nothing is asserted)']);
    expect(lintGherkin('Feature: x\n  @REQ-1\n  Scenario: a\n    Then <value>\n')).toEqual(['"a": placeholder left in a step']);
    expect(earsToScenario('REQ-1', 'shall').ok).toBe(false);
  });
});

describe('task structure', () => {
  const run = (tasks: string, plan: string | null = null, requirementIds: string[] = []) =>
    checkTaskStructure({ tasks, plan, requirementIds, tasksRel: 't', planRel: 'p' }).map((f) => f.code);

  it('flags duplicate numbers, (P) without boundary, unknown dependencies, unverified tasks and requirements missing from the plan', () => {
    const tasks = [
      '- [ ] 1.1 (P) Build the form, verify with a unit test',
      '- [ ] 1.1 Wire the API _Depends:_ 9.9 — test: api.spec',
      '- [ ] 1.2 Write docs',
    ].join('\n');
    expect(run(tasks, 'covers REQ-A-001', ['REQ-A-001', 'REQ-A-002'])).toEqual(['TASK_DUPLICATE_ID', 'PARALLEL_WITHOUT_BOUNDARY', 'DEPENDS_ON_UNKNOWN_TASK', 'TASK_WITHOUT_VERIFICATION', 'REQUIREMENT_NOT_IN_PLAN']);
  });

  it('accepts a clean list, ignores unnumbered tasks for identity and skips the plan rule without a plan', () => {
    const tasks = '- [ ] 1 (P) Form _Boundary:_ `src/form.ts` — verify: form.test\n- [x] 2 Docs\n- [ ] Add logging, test it\n- [ ] Add metrics, test it';
    expect(run(tasks, null, ['REQ-A-001'])).toEqual([]);
  });

  it('runs inside `consistency`, which reports it as checked', async () => {
    const root = await makeTemp();
    const spec = path.join(root, '.sdd', 'specs', 'f');
    await mkdir(spec, { recursive: true });
    await writeFile(path.join(spec, 'requirements.md'), '### REQ-F-001: A\n- WHEN x, the system shall y\n');
    await writeFile(path.join(spec, 'plan.md'), '# Plan\nnothing named\n');
    await writeFile(path.join(spec, 'tasks.md'), '- [ ] 1 (P) Do it _Requirements: REQ-F-001_ — verify: unit test\n');
    const report = await checkConsistency({ cwd: root, feature: 'f', changedFiles: [] });
    const codes = report.findings.map((f) => f.code);
    expect(codes).toContain('PARALLEL_WITHOUT_BOUNDARY');
    expect(codes).toContain('REQUIREMENT_NOT_IN_PLAN');
    expect(report.checked.some((c) => c.startsWith('estructura de tasks.md'))).toBe(true);
  });
});

describe('technology in requirements', () => {
  const find = (criteria: string[]) => findTechnologyInRequirements(`### REQ-T-001: x\n${criteria.map((c) => `- ${c}`).join('\n')}\n`).map((h) => h.technology);

  it('flags unambiguous technology names, once per criterion, and reports the requirement', () => {
    expect(find(['WHEN the user saves, the system shall store the draft in a PostgreSQL table using React state', 'WHEN idle, the system shall expire the session in 15 minutes'])).toEqual(['PostgreSQL']);
    expect(findTechnologyInRequirements('### REQ-T-002: y\n- The API shall expose GraphQL queries\n')[0]).toMatchObject({ requirementId: 'REQ-T-002', technology: 'GraphQL' });
  });

  it('leaves alone ambiguous words, recorded constraints and substrings', () => {
    expect(find(['The system shall go to the next screen', 'The page shall express the total in euros', 'The Spring release shall include dark mode'])).toEqual([]);
    expect(find(['Constraint: the system shall persist data in PostgreSQL', 'The system shall use Redis per ADR-12', 'Restricción: el sistema debe usar Kafka'])).toEqual([]);
    expect(find(['The system shall support JavaScripty names', 'The reactor shall stop'])).toEqual([]);
  });

  it('surfaces as an informational finding in `consistency`', async () => {
    const root = await makeTemp();
    const spec = path.join(root, '.sdd', 'specs', 'f');
    await mkdir(spec, { recursive: true });
    await writeFile(path.join(spec, 'requirements.md'), '### REQ-F-001: A\n- WHEN x, the system shall cache it in Redis\n');
    await writeFile(path.join(spec, 'tasks.md'), '- [ ] 1 Do it _Requirements: REQ-F-001_ — test: unit\n');
    const report = await checkConsistency({ cwd: root, feature: 'f', changedFiles: [] });
    const hit = report.findings.find((f) => f.code === 'REQUIREMENT_NAMES_TECHNOLOGY');
    expect(hit?.severity).toBe('info');
    expect(hit?.artifacts).toEqual(['.sdd/specs/f/requirements.md']);
    expect(hit?.message).toContain('Redis');
  });
});

describe('discovery brief', () => {
  const brief = (overrides: Record<string, string> = {}): string => {
    const s = { problem: 'Shop owners lose orders', current: 'Orders arrive by email', outcome: 'Every order is in the queue within 5 minutes', approach: 'A webhook', out: 'Payments', assumptions: '| A1 | Owners have Wi-Fi | confirmed | survey |', ...overrides };
    return `# Brief: orders\n## Problem\n${s.problem}\n## Current State\n${s.current}\n## Desired Outcome\n${s.outcome}\n## Approach\n${s.approach}\n## Scope\n- **In**: queue\n- **Out**: ${s.out}\n## Assumptions\n| ID | Assumption | Status | How |\n|----|-----|-----|-----|\n${s.assumptions}\nWe rely on [ASSUMPTION A1].\n`;
  };

  it('passes a complete brief', () => {
    expect(lintBrief(brief())).toEqual({ ok: true, problems: [], pendingAssumptions: [] });
  });

  it('blocks on empty sections, missing non-goals, an unmeasurable outcome, a pending assumption and secrets', () => {
    expect(lintBrief(brief({ problem: '[who has the problem]' })).problems[0]).toMatch(/^Problem/);
    expect(lintBrief(brief({ out: '[what is excluded]' })).problems.some((p) => p.startsWith('Non-goals'))).toBe(true);
    expect(lintBrief(brief({ outcome: 'Orders are handled better' })).problems.some((p) => p.startsWith('Desired Outcome'))).toBe(true);
    const pending = lintBrief(brief({ assumptions: '| A1 | Owners have Wi-Fi | to confirm | survey |' }));
    expect(pending.ok).toBe(false);
    expect(pending.pendingAssumptions).toEqual(['A1']);
    expect(lintBrief(brief({ approach: `api_key: ${'sk-'}${'x'.repeat(20)}` })).ok).toBe(false);
    expect(hasSecret(`${'AK'}IA${'X'.repeat(16)}`)).toBe(true);
  });

  it('the log is append-only, typed and refuses secrets', async () => {
    const file = path.join(await makeTemp(), 'discovery.log.md');
    await appendDiscoveryLog(file, 'decision', 'use   webhooks');
    await appendDiscoveryLog(file, 'kill', 'no mobile app');
    expect((await readFile(file, 'utf8')).split('\n').filter((l) => l.startsWith('- ')).map((l) => l.split(' · ').slice(1).join(' · '))).toEqual(['decision · use webhooks', 'kill · no mobile app']);
    expect(() => logLine('opinion', 'x')).toThrow(/no válido/);
    expect(() => logLine('source', `token=${'z'.repeat(12)}`)).toThrow(/secreto/);
  });
});

describe('archive', () => {
  const setup = async (meta: object, tasks: string): Promise<string> => {
    const root = await makeTemp();
    const spec = path.join(root, '.sdd', 'specs', 'f');
    await mkdir(spec, { recursive: true });
    await writeFile(path.join(spec, 'spec.json'), JSON.stringify(meta));
    await writeFile(path.join(spec, 'tasks.md'), tasks);
    return root;
  };
  const done = { name: 'f', phase: 'verified', approvals: { requirements: true, design: true, tasks: true } };

  it('reports without moving unless confirmed, then moves once and never overwrites', async () => {
    const root = await setup(done, '- [x] 1 A\n- [x] 2 B\n');
    const dry = await archiveFeature({ root, sddDir: '.sdd', feature: 'f', confirm: false, today: '2026-10-11' });
    expect(dry).toMatchObject({ moved: false, destination: '.sdd/archive/2026-10-11-f' });
    expect(dry.readiness.ready).toBe(true);
    expect(await exists(path.join(root, '.sdd/specs/f'))).toBe(true);
    const real = await archiveFeature({ root, sddDir: '.sdd', feature: 'f', confirm: true, today: '2026-10-11' });
    expect(real.moved).toBe(true);
    expect(await exists(path.join(root, '.sdd/archive/2026-10-11-f/spec.json'))).toBe(true);
    expect(await exists(path.join(root, '.sdd/specs/f'))).toBe(false);
  });

  it('blocks open tasks, an unverified phase, unapproved tasks and an existing archive entry', async () => {
    const open = await archiveFeature({ root: await setup({ ...done, phase: 'in-progress', approvals: { tasks: false } }, '- [x] 1 A\n- [ ] 2 B\n'), sddDir: '.sdd', feature: 'f', confirm: true });
    expect(open.moved).toBe(false);
    expect(open.readiness.blockers.join(' | ')).toMatch(/1 tarea\(s\) sin completar: 2.*in-progress.*no están aprobadas/);
    const root = await setup(done, '- [x] 1 A\n');
    await mkdir(path.join(root, '.sdd/archive/2026-10-11-f'), { recursive: true });
    expect((await archiveFeature({ root, sddDir: '.sdd', feature: 'f', confirm: true, today: '2026-10-11' })).detail).toMatch(/no se sobrescribe/);
    await expect(archiveFeature({ root, sddDir: '.sdd', feature: '../x', confirm: true })).rejects.toThrow(/no válido/);
  });
});

describe('steering check', () => {
  it('is ready only with the three core files, valid inclusion, resolvable in-workspace refs and no markers', async () => {
    const root = await makeTemp();
    const dir = path.join(root, '.sdd', 'steering');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(root, 'README.md'), '# x');
    await writeFile(path.join(dir, 'product.md'), '---\ninclusion: always\n---\n# Product\nSee #[[file:README.md]]\n');
    await writeFile(path.join(dir, 'tech.md'), '---\ninclusion: fileMatch\nfileMatchPattern: "src/**"\n---\n# Tech\n');
    await writeFile(path.join(dir, 'structure.md'), '# Structure\nsrc/ holds code\n');
    expect((await checkSteering(root, dir)).ready).toBe(true);

    await writeFile(path.join(dir, 'structure.md'), '# Structure\nmonorepo (inferred)\n');
    await writeFile(path.join(dir, 'api.md'), '---\ninclusion: sometimes\n---\n#[[file:../../etc/passwd]] #[[file:missing.md]]\n');
    await writeFile(path.join(dir, 'tests.md'), '---\ninclusion: fileMatch\n---\n');
    const r = await checkSteering(root, dir);
    expect(r.ready).toBe(false);
    expect(r.files.find((f) => f.file === 'structure.md')?.pending).toBe(1);
    expect(r.files.find((f) => f.file === 'api.md')?.errors).toEqual([expect.stringMatching(/sometimes/), expect.stringMatching(/fuera del workspace/), expect.stringMatching(/missing\.md\]\] no existe/)]);
    expect(r.files.find((f) => f.file === 'tests.md')?.errors[0]).toMatch(/fileMatchPattern/);
  });
});

describe('SDD modes', () => {
  const state = (rows: ReturnType<typeof modulesFor>, id: string) => rows.find((r) => r.id === id)?.state;

  it('resolves the module matrix by level, terrain and governance', () => {
    const explore = modulesFor({ level: 'explore' });
    expect([state(explore, 'tiny'), state(explore, 'constitution'), state(explore, 'delta')]).toEqual(['on', 'off', 'off']);
    const anchored = modulesFor({ level: 'spec-anchored' });
    expect([state(anchored, 'gherkin'), state(anchored, 'archive'), state(anchored, 'approvals')]).toEqual(['on', 'opt', 'opt']);
    const brown = modulesFor({ level: 'spec-first', terrain: 'brownfield', governance: 'enterprise' });
    expect([state(brown, 'delta'), state(brown, 'steering'), state(brown, 'approvals')]).toEqual(['on', 'on', 'on']);
    expect(modulesFor({ level: 'spec-as-source' }).every((m) => m.why.length > 0)).toBe(true);
    expect(() => modulesFor({ level: 'max' as never })).toThrow(/nivel desconocido/);
  });

  it('the stage guide is sequential and names what is missing', () => {
    const base = { level: 'spec-first' as const, hasSddDir: true, constitution: true, artifacts: { requirements: true, design: true, tasks: false }, meta: { phase: 'design-drafted' as const, approvals: { requirements: true, design: false, tasks: false } }, tasks: { done: 0, total: 0 }, clarify: 0 };
    const g = stagesFor(base);
    expect(g.stages.map((s) => `${s.id}:${s.state}`)).toEqual(['init:done', 'constitution:done', 'requirements:done', 'design:active', 'tasks:pending', 'implement:pending', 'validate:pending']);
    expect(g.stages[3].needs).toBe('diseño sin aprobar');
    const brown = stagesFor({ ...base, terrain: 'brownfield', steering: { present: ['product.md'], ready: false } });
    expect(brown.stages[1]).toMatchObject({ id: 'steering', state: 'active', needs: 'faltan tech.md, structure.md' });
    expect(stagesFor({ ...base, level: 'explore', artifacts: { tiny: true }, tasks: { done: 2, total: 2 }, meta: { phase: 'verified', approvals: { requirements: false, design: false, tasks: false } } }).current).toBe(-1);
  });
});

describe('skills by project type', () => {
  it('every project type has a level, an ordered sequence and what to avoid, and skills it names exist', async () => {
    const { PROJECT_TYPES, projectTypes } = await import('../src/core/sddModes.js');
    const { readdir } = await import('node:fs/promises');
    const shipped = new Set(await readdir(path.join(__dirname, '..', 'templates', 'agents', '_shared', 'skills')));
    expect(PROJECT_TYPES.map((p) => p.id)).toEqual(['fuzzy-idea', 'spike', 'greenfield', 'multi-feature', 'brownfield-extension', 'legacy-untested', 'bug', 'refactor']);
    for (const p of PROJECT_TYPES) {
      expect(p.sequence.length, p.id).toBeGreaterThan(1);
      expect(p.avoid.length, p.id).toBeGreaterThan(0);
      for (const skill of [...p.sequence, ...p.avoid].join(' ').match(/\/sdd-[a-z-]+/g) ?? []) expect(shipped.has(skill.slice(1)), `${p.id}: ${skill} no existe`).toBe(true);
    }
    expect(projectTypes('bug')[0].sequence[0]).toMatch(/^\/sdd-bugfix/);
    expect(() => projectTypes('mobile')).toThrow(/desconocido/);
  });
});

describe('modes console', () => {
  it('modes --json lists the six flows and the matrix; gherkin --write writes acceptance.feature; archive needs --confirm', async () => {
    const root = await makeTemp();
    const spec = path.join(root, '.sdd', 'specs', 'f');
    await mkdir(spec, { recursive: true });
    await writeFile(path.join(spec, 'requirements.md'), '### REQ-F-001: Save\n- WHEN the user saves, the system shall persist the draft\n');
    await writeFile(path.join(spec, 'spec.json'), JSON.stringify({ name: 'f', phase: 'verified', approvals: { requirements: true, design: true, tasks: true } }));
    await writeFile(path.join(spec, 'tasks.md'), '- [x] 1 Save — test: save.spec\n');

    const m = makeIO();
    expect(await handleModesCommand('modes', ['--json', '--level', 'spec-anchored'], m.io, root)).toBe(0);
    const data = JSON.parse(m.logs.join('\n')).data;
    expect(data.flows.map((f: { id: string }) => f.id)).toEqual(['spec', 'quick', 'bugfix', 'plan', 'tiny', 'discovery']);
    expect(data.modules).toHaveLength(13);

    const g = makeIO();
    expect(await handleModesCommand('gherkin', ['f', '--write'], g.io, root)).toBe(0);
    expect(await readFile(path.join(spec, 'acceptance.feature'), 'utf8')).toContain('@REQ-F-001 @event-driven');

    const a = makeIO();
    expect(await handleModesCommand('archive', ['f'], a.io, root)).toBe(0);
    expect(await exists(spec)).toBe(true);
    expect(await handleModesCommand('archive', ['f', '--confirm'], makeIO().io, root)).toBe(0);
    expect(await exists(spec)).toBe(false);

    const bad = makeIO();
    expect(await handleModesCommand('steering', ['lint'], bad.io, root)).toBe(2);
  });
});
