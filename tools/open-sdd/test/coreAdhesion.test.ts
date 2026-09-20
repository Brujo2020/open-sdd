/**
 * Pruebas de la puntuación de adhesión y su tendencia (REQ-MAT-011).
 *
 * Cada test fija una REGLA: que la puntuación sea monótona en la alineación, que una spec sin
 * principios declare 0 sin disfrazarlo de aprobado, que la tendencia distinga subida/bajada/
 * primera ejecución, y que una historia ilegible AVISE y empiece una serie nueva en vez de reventar
 * o de fingir un «sin tendencia».
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, readdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ADHESION_HISTORY_FILE,
  ADHESION_PENALTIES,
  adhesionHistoryEntry,
  adhesionHistoryPath,
  adhesionScore,
  adhesionTrend,
  readAdhesionHistory,
  recordAdhesionHistory,
  type SpecAlignment,
} from '../src/core/specConstitution.js';
import type { ConstitutionalAlignmentFinding } from '../src/core/specConstitution.js';

const finding = (severity: ConstitutionalAlignmentFinding['severity']): ConstitutionalAlignmentFinding => ({
  severity,
  code: `CODE-${severity}`,
  message: `hallazgo ${severity}`,
});

/** Una alineación con la tasa pedida y los hallazgos pedidos. */
const alignment = (
  rate: number,
  options: { declared?: string[]; findings?: ConstitutionalAlignmentFinding[]; undeclared?: string[] } = {},
): SpecAlignment => {
  const declared = options.declared ?? ['C-A', 'C-B'];
  return {
    feature: 'demo',
    declared,
    undeclared: options.undeclared ?? [],
    findings: options.findings ?? [],
    alignment: rate,
    detail: '',
  };
};

describe('adhesionScore', () => {
  it('es monótona en la alineación con los hallazgos fijos', () => {
    const scores = [0, 0.25, 0.5, 0.75, 1].map((rate) => adhesionScore(alignment(rate)).score);
    expect(scores).toEqual([0, 25, 50, 75, 100]);
    for (let i = 1; i < scores.length; i += 1) expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
  });

  it('devuelve las entradas que produjeron el número', () => {
    const scored = adhesionScore(alignment(0.5));
    expect(scored.score).toBe(50);
    expect(scored.inputs).toMatchObject({
      declared: 2,
      resolved: 1,
      errors: 0,
      warnings: 0,
      alignment: 0.5,
      penalty: 0,
      declaredAny: true,
    });
  });

  it('resta los hallazgos con los pesos declarados', () => {
    const scored = adhesionScore(alignment(1, { findings: [finding('error'), finding('warning'), finding('info')] }));
    expect(scored.inputs.penalty).toBe(
      ADHESION_PENALTIES.error + ADHESION_PENALTIES.warning + ADHESION_PENALTIES.info,
    );
    expect(scored.score).toBe(100 - scored.inputs.penalty);
  });

  it('una spec sin principios declarados puntúa 0 y lo dice (no es un aprobado)', () => {
    const scored = adhesionScore(alignment(0, { declared: [] }));
    expect(scored.score).toBe(0);
    expect(scored.inputs.declaredAny).toBe(false);
    expect(scored.detail).toMatch(/no declara principios/);
    expect(scored.detail).toMatch(/no es un aprobado/);
  });

  it('no baja de 0 aunque los hallazgos superen la base', () => {
    const many = Array.from({ length: 30 }, () => finding('error'));
    expect(adhesionScore(alignment(0.2, { findings: many })).score).toBe(0);
  });
});

describe('adhesionTrend', () => {
  const history = [
    { date: '2026-01-01T00:00:00.000Z', score: 60, feature: 'demo', version: '1.0.0' },
    { date: '2026-02-01T00:00:00.000Z', score: 72, feature: 'demo', version: '1.1.0' },
  ];

  it('primera ejecución cuando no hay serie previa de la feature', () => {
    const trend = adhesionTrend(80, [], { feature: 'demo' });
    expect(trend.status).toBe('first-run');
    expect(trend.previous).toBeNull();
    expect(trend.delta).toBe(0);
  });

  it('detecta una subida y la frasea en puntos', () => {
    const trend = adhesionTrend(84, history, { feature: 'demo' });
    expect(trend.status).toBe('up');
    expect(trend.previous).toBe(72);
    expect(trend.delta).toBe(12);
    expect(trend.detail).toMatch(/subió 12 punto/);
    expect(trend.detail).toMatch(/1\.1\.0/);
  });

  it('detecta una bajada', () => {
    const trend = adhesionTrend(50, history, { feature: 'demo' });
    expect(trend.status).toBe('down');
    expect(trend.delta).toBe(-22);
    expect(trend.detail).toMatch(/bajó 22 punto/);
  });

  it('detecta un empate', () => {
    const trend = adhesionTrend(72, history, { feature: 'demo' });
    expect(trend.status).toBe('flat');
    expect(trend.delta).toBe(0);
  });

  it('compara solo contra la serie de la MISMA feature', () => {
    const mixed = [...history, { date: '2026-03-01T00:00:00.000Z', score: 10, feature: 'otra' }];
    const trend = adhesionTrend(84, mixed, { feature: 'demo' });
    expect(trend.previous).toBe(72);
    expect(adhesionTrend(84, mixed, { feature: 'otra' }).previous).toBe(10);
  });
});

describe('adhesion history on disk', () => {
  it('usa un fichero y una forma distintos del ratchet .sdd/state/adhesion.json', () => {
    expect(ADHESION_HISTORY_FILE).toBe('adhesion-history.json');
    expect(adhesionHistoryPath('.sdd')).toBe(path.join('.sdd', 'state', 'adhesion-history.json'));
    expect(adhesionHistoryPath('.sdd')).not.toBe(path.join('.sdd', 'state', 'adhesion.json'));
  });

  it('un fichero ausente es una serie vacía sin aviso', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sdd-adh-missing-'));
    const read = await readAdhesionHistory(dir, '.sdd');
    expect(read.entries).toEqual([]);
    expect(read.warning).toBeUndefined();
    expect(read.seriesRestarted).toBe(false);
  });

  it('una historia corrupta AVISA y empieza una serie nueva sin reventar', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sdd-adh-corrupt-'));
    await mkdir(path.join(dir, '.sdd', 'state'), { recursive: true });
    await writeFile(path.join(dir, adhesionHistoryPath('.sdd')), '{ esto no es json', 'utf8');

    const read = await readAdhesionHistory(dir, '.sdd');
    expect(read.entries).toEqual([]);
    expect(read.seriesRestarted).toBe(true);
    expect(read.warning).toMatch(/no es JSON válido/);

    const write = await recordAdhesionHistory(
      dir,
      { date: '2026-03-01T00:00:00.000Z', score: 90, feature: 'demo' },
      '.sdd',
    );
    expect(write.entries).toBe(1);
    expect(write.seriesRestarted).toBe(true);
    expect(write.warning).toMatch(/no es JSON válido/);
    const files = await readdir(path.join(dir, '.sdd', 'state'));
    expect(files.some((name) => name.startsWith('adhesion-history.json.corrupt-'))).toBe(true);
    const written = JSON.parse(await readFile(path.join(dir, '.sdd', 'state', 'adhesion-history.json'), 'utf8'));
    expect(written).toHaveLength(1);
  });

  it('un fichero que no se puede leer como fichero también avisa en vez de lanzar', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sdd-adh-dir-'));
    await mkdir(path.join(dir, '.sdd', 'state', 'adhesion-history.json'), { recursive: true });
    const read = await readAdhesionHistory(dir, '.sdd');
    expect(read.warning).toBeDefined();
    expect(read.seriesRestarted).toBe(true);
  });

  it('es append-only: una segunda medición conserva la primera', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sdd-adh-append-'));
    const first = await recordAdhesionHistory(dir, { date: '2026-01-01T00:00:00.000Z', score: 60, feature: 'demo' }, '.sdd');
    expect(first.entries).toBe(1);
    const second = await recordAdhesionHistory(dir, { date: '2026-02-01T00:00:00.000Z', score: 84, feature: 'demo' }, '.sdd');
    expect(second.entries).toBe(2);
    const read = await readAdhesionHistory(dir, '.sdd');
    expect(read.entries.map((entry) => entry.score)).toEqual([60, 84]);
    expect(adhesionTrend(90, read.entries, { feature: 'demo' })).toMatchObject({ previous: 84, delta: 6, status: 'up' });
  });

  it('la entrada de historia lleva fecha, puntuación, feature y sus entradas', () => {
    const entry = adhesionHistoryEntry(adhesionScore(alignment(0.5)), {
      feature: 'demo',
      date: '2026-04-01T00:00:00.000Z',
    });
    expect(entry).toMatchObject({ date: '2026-04-01T00:00:00.000Z', score: 50, feature: 'demo' });
    expect(entry.inputs?.declared).toBe(2);
  });
});
