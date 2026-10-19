/**
 * Pruebas de comportamiento del libro de progreso (`.sdd/state/progress.json`).
 *
 * Fixtures en `os.tmpdir()` y limpieza en `afterEach`: nada se escribe dentro del repositorio. Se
 * fija la REGLA, no la implementación: el delta se calcula (y una inyección del llamante se
 * descarta), sin movimiento el delta es 0 y se dice, el libro es append-only, un libro corrupto avisa
 * y empieza una serie nueva sin inventar historia, y `limit` recorta la cronología.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  PROGRESS_STATE_FILE,
  progressStatePath,
  readProgress,
  recordProgress,
  renderProgress,
  type ProgressEntry,
  type ProgressLedger,
} from '../src/core/progress.js';

const dirs: string[] = [];

const makeTmp = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-progress-'));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true });
});

/** Proyecto con `.sdd/` ya creado, que es donde vive el libro. */
const project = async (): Promise<string> => {
  const root = await makeTmp();
  await mkdir(path.join(root, '.sdd'), { recursive: true });
  return root;
};

const ledgerPath = (root: string): string => path.join(root, progressStatePath('.sdd'));

const readLedger = async (root: string): Promise<ProgressLedger> =>
  JSON.parse(await readFile(ledgerPath(root), 'utf8')) as ProgressLedger;

const entry = (
  summary: string,
  total: number,
  phase: 1 | 2 | 3,
  kind = 'spec',
): Omit<ProgressEntry, 'at' | 'delta'> => ({
  kind,
  summary,
  score: { total, phase },
  evidence: [`evidence:${kind}`],
});

describe('core/progress — el libro que hace consciente el avance', () => {
  it('calcula el delta POSITIVO contra la entrada anterior; el llamante no puede aportarlo', async () => {
    const root = await project();

    const first = await recordProgress({ cwd: root, entry: entry('Creé la especificación de auth', 40, 1) });
    expect(first.written).toBe(true);
    // La primera entrada no se compara con nada: delta 0, no una subida imaginaria.
    expect(first.entry?.delta).toEqual({ score: 0, phase: 0 });

    const second = await recordProgress({ cwd: root, entry: entry('Implementé el login OAuth con tests', 55, 2, 'implement') });
    expect(second.entry?.delta).toEqual({ score: 15, phase: 1 });

    // Una inyección de `delta` por un `as any` se descarta: la mentira no es expresable.
    const injected = {
      kind: 'verify',
      summary: 'Verifiqué la cadena de gates del nivel declarado',
      score: { total: 55, phase: 2 },
      evidence: ['gates run'],
      delta: { score: 999, phase: 1 },
    } as unknown as Omit<ProgressEntry, 'at' | 'delta'>;
    const third = await recordProgress({ cwd: root, entry: injected });
    expect(third.entry?.delta).toEqual({ score: 0, phase: 0 });

    const read = await readProgress(root);
    expect(read.corrupt).toBe(false);
    expect(read.entries.map((item) => item.summary)).toEqual([
      'Creé la especificación de auth',
      'Implementé el login OAuth con tests',
      'Verifiqué la cadena de gates del nivel declarado',
    ]);
  });

  it('sin movimiento el delta es 0 y SE DICE, sin reclamar una subida', async () => {
    const root = await project();
    await recordProgress({ cwd: root, entry: entry('Escribí los requisitos en forma EARS', 60, 2) });
    const same = await recordProgress({ cwd: root, entry: entry('Añadí evidencia a una tarea pendiente', 60, 2, 'implement') });

    expect(same.entry?.delta).toEqual({ score: 0, phase: 0 });
    expect(same.detail).toContain('sin movimiento');
    expect(same.detail).toContain('delta 0');

    const read = await readProgress(root);
    const lines = renderProgress({ entries: read.entries });
    expect(lines[0]).toContain('delta 0');
    expect(lines[0]).toContain('sin cambios');
    expect(lines[0]).not.toContain('+');
  });

  it('es append-only: registrar no reescribe ni reordena las entradas previas', async () => {
    const root = await project();
    await recordProgress({ cwd: root, entry: entry('Primero', 10, 1) });
    await recordProgress({ cwd: root, entry: entry('Segundo', 20, 1) });
    await recordProgress({ cwd: root, entry: entry('Tercero', 30, 2) });

    const before = (await readLedger(root)).entries;
    expect(before).toHaveLength(3);

    await recordProgress({ cwd: root, entry: entry('Cuarto', 45, 2) });
    const after = (await readLedger(root)).entries;
    expect(after).toHaveLength(4);
    expect(after.slice(0, 3)).toEqual(before);
  });

  it('un libro corrupto avisa y empieza una SERIE NUEVA, sin inventar historia', async () => {
    const root = await project();
    await mkdir(path.dirname(ledgerPath(root)), { recursive: true });
    await writeFile(ledgerPath(root), '{ esto no es json', 'utf8');

    const read = await readProgress(root);
    expect(read.corrupt).toBe(true);
    expect(read.entries).toEqual([]);
    expect(read.detail).toContain('JSON inválido');

    const recorded = await recordProgress({ cwd: root, entry: entry('Reanudé tras un libro ilegible', 12, 1) });
    expect(recorded.written).toBe(true);
    expect(recorded.detail).toContain('SERIE NUEVA');
    // El delta de la serie nueva es 0: no hay base anterior contra la que comparar.
    expect(recorded.entry?.delta).toEqual({ score: 0, phase: 0 });

    const after = await readProgress(root);
    expect(after.corrupt).toBe(false);
    expect(after.entries).toHaveLength(1);
  });

  it('una entrada con forma inválida también cuenta como corrupción declarada', async () => {
    const root = await project();
    await mkdir(path.dirname(ledgerPath(root)), { recursive: true });
    await writeFile(
      ledgerPath(root),
      JSON.stringify({ version: 1, entries: [{ at: '2026-01-01T00:00:00.000Z', kind: 'x', summary: 'y' }] }),
      'utf8',
    );

    const read = await readProgress(root);
    expect(read.corrupt).toBe(true);
    expect(read.entries).toEqual([]);
    expect(read.detail).toContain('entrada inválida');
  });

  it('limit recorta la cronología a los ÚLTIMOS N hitos, más reciente primero', async () => {
    const root = await project();
    for (const [summary, total] of [['Uno', 10], ['Dos', 20], ['Tres', 30], ['Cuatro', 40]] as const) {
      await recordProgress({ cwd: root, entry: entry(summary, total, 1) });
    }
    const { entries } = await readProgress(root);

    const limited = renderProgress({ entries, limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited[0]).toContain('Cuatro');
    expect(limited[1]).toContain('Tres');

    const all = renderProgress({ entries });
    expect(all).toHaveLength(4);
    expect(all[0]).toContain('Cuatro');
    expect(renderProgress({ entries, limit: 0 })).toEqual([]);
  });

  it('rechaza el resumen vacío o vago: «se avanzó» no es un resumen', async () => {
    const root = await project();

    const empty = await recordProgress({ cwd: root, entry: entry('   ', 10, 1) });
    expect(empty.written).toBe(false);
    expect(empty.entry).toBeNull();
    expect(empty.detail).toContain('summary');

    const vague = await recordProgress({ cwd: root, entry: entry('Se avanzó', 10, 1) });
    expect(vague.written).toBe(false);
    expect(vague.entry).toBeNull();
    expect(vague.detail).toContain('no dice qué se consiguió');

    const multi = await recordProgress({ cwd: root, entry: entry('Primera línea\nSegunda línea', 10, 1) });
    expect(multi.written).toBe(false);
    expect(multi.detail).toContain('UNA línea');

    // Nada de eso llegó al disco.
    expect((await readProgress(root)).entries).toEqual([]);
  });

  it('la marca de tiempo la pone el módulo, no el llamante', async () => {
    const root = await project();
    const forged = {
      kind: 'spec',
      summary: 'Falsifiqué la fecha de un hito',
      score: { total: 10, phase: 1 },
      evidence: [],
      at: '1999-01-01T00:00:00.000Z',
    } as unknown as Omit<ProgressEntry, 'at' | 'delta'>;

    const recorded = await recordProgress({ cwd: root, entry: forged });
    expect(recorded.entry?.at).not.toBe('1999-01-01T00:00:00.000Z');
    expect(Number.isFinite(Date.parse(recorded.entry?.at ?? ''))).toBe(true);
  });

  it('sin fichero no hay corrupción: simplemente no hay historial', async () => {
    const root = await project();
    const read = await readProgress(root);
    expect(read.corrupt).toBe(false);
    expect(read.entries).toEqual([]);
    expect(read.detail).toContain(PROGRESS_STATE_FILE);
    expect(renderProgress({ entries: read.entries })).toEqual([]);
  });
});
