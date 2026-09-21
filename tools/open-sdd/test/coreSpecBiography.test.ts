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

import { afterEach, describe, expect, it, vi } from 'vitest';
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

/**
 * Fachada de `git rev-parse --show-toplevel`: en Windows git anuncia la raíz como `D:/a/…`
 * mientras el `cwd` que conoce Node es `D:\a\…`. La suite no puede ejecutar Windows, así que la
 * fachada devuelve esa forma para el subcomando exacto y delega TODO lo demás al git real; es la
 * forma en que el job `windows` veía la raíz, y el único modo de reproducirlo fuera de Windows.
 * `null` desactiva la fachada: el resto de la suite corre contra el git real sin cambios.
 */
const toplevelShim = vi.hoisted(() => ({ path: null as string | null }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const shimmed = (file: unknown, args: unknown, options: unknown): unknown => {
    const argv = Array.isArray(args) ? (args as string[]) : [];
    if (
      toplevelShim.path !== null &&
      file === 'git' &&
      argv[0] === 'rev-parse' &&
      argv[1] === '--show-toplevel'
    ) {
      return toplevelShim.path;
    }
    return (actual.execFileSync as (...a: unknown[]) => unknown)(file, args, options);
  };
  return { ...actual, execFileSync: shimmed as typeof actual.execFileSync };
});

const tempDirs: string[] = [];

/**
 * Cada caso crea un repositorio git real y mide con `sddScore`, así que bajo la suite completa (122
 * ficheros en paralelo) 5 s por defecto no alcanzan: se fija un margen explícito.
 */
const slowIt = (name: string, run: () => Promise<void>): void => {
  it(name, run, 60_000);
};

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
  slowIt('spec escrita una vez y tres commits de código después → stale, y nombra el número', async () => {
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

  slowIt('el umbral de stale es una frontera comprobable: dos commits de código todavía no lo cruzan', async () => {
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

  slowIt('spec y código moviéndose juntos → alive', async () => {
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

  slowIt('spec escrita una vez y ningún commit de código → quiet (y se explica por qué no es orphan)', async () => {
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

  slowIt('un directorio sin git → unknown con la razón, sin reventar', async () => {
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
  slowIt('se acotan por `limit` y van del más reciente al más antiguo', async () => {
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

  slowIt('`added`/`removed` coinciden con lo que se commiteó de verdad', async () => {
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

  slowIt('spec.json deja el historial de fases y la fase declarada hoy', async () => {
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
  slowIt('muestra las entradas de la delta con el comportamiento anterior que reemplazan', async () => {
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

  slowIt('una ratificación de la constitución aparece con quién y cuándo', async () => {
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

  slowIt('las secciones que no existen se dicen, no se omiten en silencio', async () => {
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

  slowIt('la salida renderizada lleva la línea honesta: esto mide ritmo, no calidad', async () => {
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

describe('specBiography — el límite con git no depende de cómo el anfitrión escriba las rutas', () => {
  /**
   * Regresión del job `windows` (7 de 12 tests en rojo): la raíz que anuncia git y el `cwd` que
   * conoce Node venían de dos mundos distintos y el módulo las comparaba como rutas absolutas
   * (`realpathSync` + `path.relative`). En Windows git escribe `D:/a/…` y el `cwd` es `D:\a\…`;
   * cuando no encajaban, una spec DENTRO del árbol se declaraba «fuera del árbol» y la biografía
   * entera salía como `unknown`. La fachada de `--show-toplevel` reproduce esa respuesta aquí.
   */
  slowIt('mide la biografía aunque git anuncie la raíz en la forma del anfitrión', async () => {
    const dir = await makeRepo();
    await write(dir, `${specPath}/requirements.md`, requirements(1));
    commitAll(dir, 'spec: nace');
    for (let i = 1; i <= 3; i += 1) {
      await write(dir, `src/module-${i}.ts`, `export const v${i} = ${i};\n`);
      commitAll(dir, `code: cambio ${i}`);
    }

    toplevelShim.path = 'D:/open-sdd-windows-fixture-does-not-exist/root\r\n';
    try {
      const bio = await specBiography({ cwd: dir, feature: 'bio' });

      expect(bio.breathing).toBe('stale');
      expect(bio.breathingReason).toContain('3');
      expect(bio.activity).toEqual({ specCommits: 1, codeCommits: 3, sinceDays: expect.any(Number) });
      expect(bio.born).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(bio.lastChange).toBe(bio.born);
      expect(bio.events).toHaveLength(1);
      expect(bio.events[0]).toMatchObject({
        subject: 'spec: nace',
        artifact: 'requirements',
        added: 4,
        removed: 0,
      });
      expect(bio.complete).toBe(false);
    } finally {
      toplevelShim.path = null;
    }
  });

  /** El mismo contenido con finales de línea CRLF, como un checkout de Windows (RC-C). */
  const crlf = (text: string): string => text.replace(/\n/g, '\r\n');

  slowIt('una fixture escrita con CRLF produce la misma biografía que la escrita con LF', async () => {
    const measure = async (eol: (text: string) => string) => {
      const dir = await makeRepo();
      await write(dir, `${specPath}/requirements.md`, eol(requirements(1)));
      commitAll(dir, 'spec: nace');
      for (let i = 1; i <= 3; i += 1) {
        await write(dir, `src/module-${i}.ts`, eol(`export const v${i} = ${i};\n`));
        commitAll(dir, `code: cambio ${i}`);
      }
      return specBiography({ cwd: dir, feature: 'bio' });
    };

    const lf = await measure((text) => text);
    const windows = await measure(crlf);

    expect(lf.breathing).toBe('stale');
    expect(windows.breathing).toBe(lf.breathing);
    expect(windows.breathingReason).toContain('3');
    expect(windows.activity.specCommits).toBe(1);
    expect(windows.activity.codeCommits).toBe(3);
    expect(windows.activity.specCommits).toBe(lf.activity.specCommits);
    expect(windows.activity.codeCommits).toBe(lf.activity.codeCommits);
    expect(windows.events.map((event) => event.subject)).toEqual(lf.events.map((event) => event.subject));
    expect(windows.events[0]).toMatchObject({ artifact: 'requirements', added: 4, removed: 0 });
    expect(windows.events[0].added).toBe(lf.events[0].added);
  });
});
