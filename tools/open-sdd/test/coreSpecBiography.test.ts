/**
 * `specBiography` — la biografía de una especificación viva.
 *
 * Todas las fixtures son directorios `fs.mkdtemp` con un `git init` real, un usuario local
 * configurado y commits reales; se borran en `afterEach`. NADA se escribe dentro de este
 * repositorio: la suite no toca la historia que mide.
 *
 * Las fechas de commit se fijan por entorno (`GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`) para que el
 * orden «más reciente primero» sea una propiedad del fixture y no del reloj de la máquina.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Constitution } from '../src/core/constitution.js';
import { renderConstitution } from '../src/core/constitution.js';
import type { DeltaSpec } from '../src/core/deltaSpec.js';
import { renderDeltaSpec } from '../src/core/deltaSpec.js';
import {
  ACTIVITY_IS_NOT_QUALITY,
  ALIVE_SPEC_SHARE,
  STALE_CODE_COMMITS,
  renderBiography,
  specBiography,
} from '../src/core/specBiography.js';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

/** Reloj monótono del fixture: cada commit nace un minuto después del anterior. */
let stamp = Date.UTC(2026, 0, 1, 0, 0, 0);
const nextDate = (): string => {
  stamp += 60_000;
  return new Date(stamp).toISOString();
};

const git = (cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): void => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env });
  expect(result.status, `git ${args.join(' ')} falló: ${result.stderr}`).toBe(0);
};

const makeRepo = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-bio-'));
  tempDirs.push(dir);
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'fixture@example.com']);
  git(dir, ['config', 'user.name', 'Fixture Author']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  return dir;
};

/** Directorio sin git: el caso en el que la respuesta honesta tiene que ser `unknown`. */
const makePlainDir = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-bio-nogit-'));
  tempDirs.push(dir);
  return dir;
};

const write = async (dir: string, rel: string, content: string): Promise<void> => {
  const file = path.join(dir, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, 'utf8');
};

const commitAll = (dir: string, subject: string): void => {
  git(dir, ['add', '-A']);
  const date = nextDate();
  git(dir, ['commit', '-q', '-m', subject], {
    ...process.env,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
};

const specPath = '.sdd/specs/bio';
const requirements = (version: number): string =>
  `# Requirements: bio\n\n### REQ-BIO-001: Version ${version}\n- WHEN the fixture is read, the system shall report version ${version}.\n`;

const SPEC_JSON = (phase: string): string => JSON.stringify({ name: 'bio', phase }, null, 2) + '\n';

// ---------------------------------------------------------------------------------------------

describe('specBiography — el ritmo se deriva de git, nunca se afirma', () => {
  it('spec escrita una vez y tres commits de código después → stale, y nombra el número', async () => {
    const dir = await makeRepo();
    await write(dir, `${specPath}/requirements.md`, requirements(1));
    commitAll(dir, 'spec: nace');
    for (let i = 1; i <= 3; i += 1) {
      await write(dir, `src/module-${i}.ts`, `export const v${i} = ${i};\n`);
      commitAll(dir, `code: cambio ${i}`);
    }

    const bio = await specBiography({ cwd: dir, feature: 'bio' });

    expect(bio.breathing).toBe('stale');
    // El número tiene que estar en la razón: «desactualizada» sin cifra no es una medición.
    expect(bio.breathingReason).toContain('3');
    expect(bio.activity).toEqual({ specCommits: 1, codeCommits: 3, sinceDays: expect.any(Number) });
    expect(bio.born).not.toBeNull();
    expect(bio.lastChange).toBe(bio.born);
  });

  it('el umbral de stale es una frontera comprobable: dos commits de código todavía no lo cruzan', async () => {
    const dir = await makeRepo();
    await write(dir, `${specPath}/requirements.md`, requirements(1));
    commitAll(dir, 'spec: nace');
    for (let i = 1; i <= 2; i += 1) {
      await write(dir, `src/module-${i}.ts`, `export const v${i} = ${i};\n`);
      commitAll(dir, `code: cambio ${i}`);
    }

    const bio = await specBiography({ cwd: dir, feature: 'bio' });

    expect(STALE_CODE_COMMITS).toBe(3);
    expect(bio.breathing).toBe('orphan');
  });

  it('spec y código moviéndose juntos → alive', async () => {
    const dir = await makeRepo();
    await write(dir, `${specPath}/requirements.md`, requirements(1));
    commitAll(dir, 'spec: nace');
    await write(dir, 'src/a.ts', 'export const a = 1;\n');
    commitAll(dir, 'code: primero');
    await write(dir, `${specPath}/tasks.md`, '- [ ] 1.1: tarea que acompaña al código\n');
    commitAll(dir, 'spec: tasks al día');
    await write(dir, 'src/a.ts', 'export const a = 2;\n');
    commitAll(dir, 'code: segundo');

    const bio = await specBiography({ cwd: dir, feature: 'bio' });

    expect(ALIVE_SPEC_SHARE).toBeCloseTo(1 / 3);
    expect(bio.breathing).toBe('alive');
    expect(bio.activity.specCommits).toBeGreaterThan(1);
  });

  it('spec escrita una vez y ningún commit de código → quiet (y se explica por qué no es orphan)', async () => {
    // Decisión: con cero commits de código NO es `orphan`. La definición de orphan exige que el
    // código se haya movido mientras la spec no; aquí no se movió nada, así que la lectura honesta
    // es quietud: la especificación puede seguir siendo correcta y todavía no ha hecho falta
    // tocarla. Tampoco es `stale`: no hay desfase material que nombrar.
    const dir = await makeRepo();
    await write(dir, `${specPath}/requirements.md`, requirements(1));
    commitAll(dir, 'spec: nace');

    const bio = await specBiography({ cwd: dir, feature: 'bio' });

    expect(bio.breathing).toBe('quiet');
    expect(bio.activity).toEqual({ specCommits: 1, codeCommits: 0, sinceDays: expect.any(Number) });
    expect(bio.breathingReason).toContain('ninguno');
  });

  it('un directorio sin git → unknown con la razón, sin reventar', async () => {
    const dir = await makePlainDir();
    await write(dir, `${specPath}/requirements.md`, requirements(1));

    const bio = await specBiography({ cwd: dir, feature: 'bio' });

    expect(bio.breathing).toBe('unknown');
    expect(bio.breathingReason).toContain('no es un repositorio git');
    expect(bio.born).toBeNull();
    expect(bio.lastChange).toBeNull();
    expect(bio.events).toEqual([]);
    expect(bio.activity).toEqual({ specCommits: 0, codeCommits: 0, sinceDays: 0 });
    expect(bio.complete).toBe(false);
    // La sección del alma sigue leyéndose de los artefactos: no medir el ritmo no es no leer nada.
    expect(bio.amendments).toEqual([]);
    expect(renderBiography(bio).join('\n')).toContain('unknown');
  });
});

describe('specBiography — eventos', () => {
  it('se acotan por `limit` y van del más reciente al más antiguo', async () => {
    const dir = await makeRepo();
    for (let i = 1; i <= 3; i += 1) {
      await write(dir, `${specPath}/requirements.md`, requirements(i));
      commitAll(dir, `spec: cambio ${i}`);
    }

    const full = await specBiography({ cwd: dir, feature: 'bio' });
    expect(full.events.map((event) => event.subject)).toEqual([
      'spec: cambio 3',
      'spec: cambio 2',
      'spec: cambio 1',
    ]);

    const bounded = await specBiography({ cwd: dir, feature: 'bio', limit: 2 });
    expect(bounded.events).toHaveLength(2);
    expect(bounded.events.map((event) => event.subject)).toEqual(['spec: cambio 3', 'spec: cambio 2']);
  });

  it('`added`/`removed` coinciden con lo que se commiteó de verdad', async () => {
    const dir = await makeRepo();
    await write(dir, `${specPath}/requirements.md`, 'alpha\nbeta\n');
    commitAll(dir, 'spec: dos líneas');
    await write(dir, `${specPath}/requirements.md`, 'alpha2\nbeta\n');
    commitAll(dir, 'spec: edita una');

    const bio = await specBiography({ cwd: dir, feature: 'bio' });

    expect(bio.events[0]).toMatchObject({ subject: 'spec: edita una', added: 1, removed: 1 });
    expect(bio.events[1]).toMatchObject({ subject: 'spec: dos líneas', added: 2, removed: 0 });
    // Un solo artefacto por commit: la clasificación es por fichero, no por commit.
    expect(bio.events[0].artifact).toBe('requirements');
    expect(bio.events[0].author).toBe('Fixture Author');
    expect(bio.events[0].commit).toMatch(/^[0-9a-f]{7,}$/);
  });

  it('spec.json deja el historial de fases y la fase declarada hoy', async () => {
    const dir = await makeRepo();
    await write(dir, `${specPath}/spec.json`, SPEC_JSON('initialized'));
    commitAll(dir, 'spec: fase inicial');
    await write(dir, `${specPath}/spec.json`, SPEC_JSON('verified'));
    commitAll(dir, 'spec: fase verificada');

    const bio = await specBiography({ cwd: dir, feature: 'bio' });

    expect(bio.phaseHistory.map((entry) => entry.phase)).toEqual(['initialized', 'verified']);
    expect(bio.currentPhase).toBe('verified');
  });
});

describe('specBiography — el alma de la especificación', () => {
  it('muestra las entradas de la delta con el comportamiento anterior que reemplazan', async () => {
    const dir = await makeRepo();
    const delta: DeltaSpec = {
      feature: 'bio',
      title: 'cambio acotado',
      status: 'approved',
      entries: [
        {
          id: 'REQ-BIO-001',
          kind: 'MODIFIED',
          title: 'La lectura cambia',
          statement: 'WHEN the biography is read, the [fixture] shall report the replaced behaviour.',
          targets: ['src/core/bio.ts'],
          previous: 'La lectura anterior solo miraba el directorio raíz.',
          merged: true,
        },
      ],
    };
    await write(dir, `${specPath}/delta.md`, renderDeltaSpec(delta));
    commitAll(dir, 'spec: delta');

    const bio = await specBiography({ cwd: dir, feature: 'bio' });

    expect(bio.amendments).toHaveLength(1);
    expect(bio.amendments[0]).toMatchObject({
      id: 'REQ-BIO-001',
      kind: 'MODIFIED',
      previous: 'La lectura anterior solo miraba el directorio raíz.',
      merged: true,
    });
    expect(renderBiography(bio).join('\n')).toContain(
      'reemplaza: La lectura anterior solo miraba el directorio raíz.',
    );
  });

  it('una ratificación de la constitución aparece con quién y cuándo', async () => {
    const dir = await makeRepo();
    await write(dir, `${specPath}/requirements.md`, requirements(1));
    commitAll(dir, 'spec: nace');

    const constitution: Constitution = {
      project: 'fixture',
      provenance: 'descriptive',
      establishedFacts: ['Lenguaje: TypeScript'],
      principles: [],
      amendments: [
        {
          id: 'AMD-RATIFY-C-X',
          title: 'Ratificación de C-X — El código manda',
          proposedBy: 'Ada Lovelace',
          status: 'in-force',
          rationale: 'la práctica ya está en el código y la evidencia la demuestra',
          updatedAt: '2026-02-03T04:05:06.000Z',
          approvals: [{ actor: 'Ada Lovelace', at: '2026-02-03T04:05:06.000Z' }],
        },
      ],
    };
    await write(dir, '.sdd/steering/constitution.md', renderConstitution(constitution));
    commitAll(dir, 'constitution: ratifica C-X');

    const bio = await specBiography({ cwd: dir, feature: 'bio' });

    expect(bio.ratifications).toHaveLength(1);
    expect(bio.ratifications[0].by).toBe('Ada Lovelace');
    expect(bio.ratifications[0].at).toBe('2026-02-03T04:05:06.000Z');
    const rendered = renderBiography(bio).join('\n');
    expect(rendered).toContain('Ada Lovelace');
    expect(rendered).toContain('2026-02-03T04:05:06.000Z');
  });

  it('las secciones que no existen se dicen, no se omiten en silencio', async () => {
    const dir = await makeRepo();
    await write(dir, `${specPath}/requirements.md`, requirements(1));
    commitAll(dir, 'spec: nace');

    const bio = await specBiography({ cwd: dir, feature: 'bio' });
    const rendered = renderBiography(bio).join('\n');

    expect(bio.ratifications).toEqual([]);
    expect(bio.amendments).toEqual([]);
    expect(bio.phaseHistory).toEqual([]);
    expect(rendered).toContain('sin enmiendas registradas');
    expect(rendered).toContain('ninguna ratificación registrada');
    expect(rendered).toContain('sin historial de fases');
    expect(rendered).toContain('sin delta.md');
  });

  it('la salida renderizada lleva la línea honesta: esto mide ritmo, no calidad', async () => {
    const dir = await makeRepo();
    await write(dir, `${specPath}/requirements.md`, requirements(1));
    commitAll(dir, 'spec: nace');
    await write(dir, 'src/a.ts', 'export const a = 1;\n');
    commitAll(dir, 'code: cambio');

    const bio = await specBiography({ cwd: dir, feature: 'bio' });
    const rendered = renderBiography(bio);

    expect(rendered.join('\n')).toContain(ACTIVITY_IS_NOT_QUALITY);
    expect(rendered.join('\n')).toMatch(/RITMO, no CALIDAD/);
    expect(rendered.join('\n')).toContain('puede ser correcta');
  });
});
