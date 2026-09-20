/**
 * Pruebas de `src/core/celebrate.ts` — el momento verde y sus límites.
 *
 * Lo que se afirma aquí no es «hay animación», sino lo contrario: que NO hay celebración sin las
 * tres verdades a la vez, que un dato ausente se RECHAZA (nunca se celebra), que un rechazo no deja
 * rastro en el libro y que un libro corrupto se avisa y se reinicia sin inventar entradas. La
 * animación se prueba por índice (fotogramas puros), sin relojes reales. Los fixtures de libro viven
 * en `os.tmpdir()` y se limpian en `afterEach`: nada se escribe dentro del repositorio.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CELEBRATION_BAR_WIDTH,
  CELEBRATION_FRAME_COUNT,
  CELEBRATION_FRAME_MS,
  CELEBRATION_TOTAL_MS,
  appendCelebration,
  celebrateFeature,
  celebrationsStatePath,
  celebrationsToJson,
  deriveAchievements,
  judgeCelebration,
  judgeFeatureCelebration,
  levelFor,
  playCelebration,
  readCelebrations,
  renderCelebrationFooter,
  renderCelebrationFrame,
  renderCelebrationFrames,
  renderCelebrations,
  renderStreak,
  renderStreakPhrase,
} from '../src/core/celebrate.js';
import type {
  FeatureValidationInput,
  GatesSnapshot,
  PivotSnapshot,
  ValidationSnapshot,
} from '../src/core/celebrate.js';

const dirs: string[] = [];

const makeTmp = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-celebrate-'));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true });
});

/** Todo verde, a nivel de feature. */
const GOOD: FeatureValidationInput = {
  feature: 'checkout',
  requirements: { conforming: 12, total: 12, errors: 0 },
  pivot: { alignment: 1, errors: 0, evaluated: true },
  gates: { passed: 6, total: 6, failed: [] },
  score: 92,
  phase: 3,
  streak: 7,
};

const goodSnapshot = (): ValidationSnapshot => ({
  ears: { conforming: 12, total: 12, errors: 0 },
  pivot: { alignment: 1, errors: 0, evaluated: true },
  gates: { passed: 6, total: 6, failed: [] },
  score: { total: 92, phase: 3 },
  streak: 7,
});

/** Cuenta códigos ANSI de color. */
const ansiCount = (line: string): number => (line.match(/\u001b\[/g) ?? []).length;

// ── El veredicto de tres vías ───────────────────────────────────────────────────────────────────

describe('judgeCelebration — solo celebra las tres verdades a la vez', () => {
  it('celebra cuando EARS es conforme, el pivote se evaluó sin errores y los gates pasan', () => {
    const report = judgeCelebration(goodSnapshot(), { isTty: false });
    expect(report.verdict).toBe('celebrate');
    expect(report.reason).toContain('validación positiva');
  });

  it('muestra los tres números reales, no un «success» genérico', () => {
    const block = judgeCelebration(goodSnapshot(), { isTty: false }).staticLines.join('\n');
    expect(block).toContain('EARS 12/12 · pivote 100% · gates 6/6');
    expect(block).toContain('score 92/100 · fase 3/3');
    expect(block).toContain('racha: 7 cambios seguidos sin bajar la adhesión');
  });

  it('un solo error EARS → plain nombrando EARS', () => {
    const snapshot = goodSnapshot();
    snapshot.ears = { conforming: 11, total: 12, errors: 1 };
    const report = judgeCelebration(snapshot, { isTty: false });
    expect(report.verdict).toBe('plain');
    expect(report.reason).toContain('EARS');
    expect(report.reason).toContain('11/12');
    expect(report.reason).toContain('1 error');
  });

  it('EARS no conforme sin error contado → plain igualmente (nunca verde a medias)', () => {
    const snapshot = goodSnapshot();
    snapshot.ears = { conforming: 11, total: 12, errors: 0 };
    expect(judgeCelebration(snapshot, { isTty: false }).verdict).toBe('plain');
  });

  it('pivote sin evaluar → refused, y el motivo lo dice', () => {
    const snapshot = goodSnapshot();
    snapshot.pivot = { alignment: 0.9, errors: 0, evaluated: false };
    const report = judgeCelebration(snapshot, { isTty: false });
    expect(report.verdict).toBe('refused');
    expect(report.reason).toContain('no se puede celebrar');
    expect(report.reason).toContain('pivote');
    expect(report.reason).toContain('no se evaluó');
  });

  it('pivote con errores → plain nombrando el pivote y su alineación', () => {
    const snapshot = goodSnapshot();
    snapshot.pivot = { alignment: 0.8, errors: 2, evaluated: true };
    const report = judgeCelebration(snapshot, { isTty: false });
    expect(report.verdict).toBe('plain');
    expect(report.reason).toContain('pivote');
    expect(report.reason).toContain('2 error');
    expect(report.reason).toContain('80%');
  });

  it('un gate que falla → plain nombrando ESE gate', () => {
    const snapshot = goodSnapshot();
    snapshot.gates = { passed: 5, total: 6, failed: ['C2'] };
    const report = judgeCelebration(snapshot, { isTty: false });
    expect(report.verdict).toBe('plain');
    expect(report.reason).toContain('C2');
  });

  it('varios gates que fallan → plain los nombra a todos', () => {
    const snapshot = goodSnapshot();
    snapshot.gates = { passed: 4, total: 6, failed: ['C2', 'C6'] };
    const report = judgeCelebration(snapshot, { isTty: false });
    expect(report.verdict).toBe('plain');
    expect(report.reason).toContain('C2');
    expect(report.reason).toContain('C6');
  });

  it('gates pasados sin lista de fallos pero incompletos → plain, no verde', () => {
    const snapshot = goodSnapshot();
    snapshot.gates = { passed: 5, total: 6, failed: [] };
    expect(judgeCelebration(snapshot, { isTty: false }).verdict).toBe('plain');
  });

  it('refused: sin snapshot, sin requisitos, sin gates o sin evaluar', () => {
    const cases: Array<{ name: string; snapshot: ValidationSnapshot | null | undefined }> = [
      { name: 'sin snapshot', snapshot: null },
      { name: 'sin requisitos', snapshot: { ...goodSnapshot(), ears: { conforming: 0, total: 0, errors: 0 } } },
      { name: 'EARS notChecked', snapshot: { ...goodSnapshot(), ears: { conforming: 12, total: 12, errors: 0, evaluated: false } } },
      { name: 'sin gates', snapshot: { ...goodSnapshot(), gates: { passed: 0, total: 0, failed: [] } } },
      { name: 'gates notChecked', snapshot: { ...goodSnapshot(), gates: { passed: 6, total: 6, failed: [], evaluated: false } } },
      { name: 'pivote sin evaluar', snapshot: { ...goodSnapshot(), pivot: { alignment: 1, errors: 0, evaluated: false } } },
      {
        name: 'pivote con números desconocidos',
        snapshot: { ...goodSnapshot(), pivot: { alignment: Number.NaN, errors: 0, evaluated: true } },
      },
    ];
    for (const testCase of cases) {
      const report = judgeCelebration(testCase.snapshot, { isTty: false });
      expect(report.verdict, testCase.name).toBe('refused');
      expect(report.reason, testCase.name).toContain('no se puede celebrar');
    }
  });

  it('nunca celebra sobre datos ausentes: lo que falta manda sobre lo que falla', () => {
    const snapshot: ValidationSnapshot = {
      ears: { conforming: 5, total: 12, errors: 3 },
      pivot: { alignment: 0.4, errors: 1, evaluated: false },
      gates: { passed: 0, total: 0, failed: ['C1'] },
    };
    const report = judgeCelebration(snapshot, { isTty: false });
    expect(report.verdict).toBe('refused');
    // El primer dato ausente en orden es el pivote sin evaluar (EARS sí está medido).
    expect(report.reason).toContain('pivote');
  });
});

// ── Animación: TTY-only, por índice, acotada ────────────────────────────────────────────────────

describe('animación — solo en TTY, acotada y determinista', () => {
  it('no anima sin TTY', () => {
    const report = judgeCelebration(goodSnapshot(), { isTty: false, env: {} });
    expect(report.frames).toHaveLength(0);
    expect(report.lines).toEqual(report.staticLines);
  });

  it('quiet, json, NO_COLOR, CI y SDD_NO_ANIM dejan el bloque estático sin fotogramas', () => {
    const cases = [
      { name: 'quiet', opts: { isTty: true, quiet: true, env: {} } },
      { name: 'json', opts: { isTty: true, json: true, env: {} } },
      { name: 'NO_COLOR', opts: { isTty: true, env: { NO_COLOR: '1' } } },
      { name: 'CI', opts: { isTty: true, env: { CI: 'true' } } },
      { name: 'SDD_NO_ANIM', opts: { isTty: true, env: { SDD_NO_ANIM: '1' } } },
    ] as const;
    for (const testCase of cases) {
      const report = judgeCelebration(goodSnapshot(), { ...testCase.opts });
      expect(report.frames, testCase.name).toHaveLength(0);
      expect(report.verdict, testCase.name).toBe('celebrate');
    }
  });

  it('quiet y json devuelven una sola línea, y es el resumen estático', () => {
    for (const opts of [{ quiet: true }, { json: true }]) {
      const report = judgeCelebration(goodSnapshot(), { isTty: true, env: {}, ...opts });
      expect(report.lines).toHaveLength(1);
      expect(report.lines[0]).toBe(report.staticLines[report.staticLines.length - 1]);
    }
  });

  it('en TTY anima: un fotograma por índice y el bloque estático detrás', () => {
    const report = judgeCelebration(goodSnapshot(), { isTty: true, env: {} });
    expect(report.frames).toHaveLength(CELEBRATION_FRAME_COUNT);
    expect(report.lines).toHaveLength(CELEBRATION_FRAME_COUNT + report.staticLines.length);
    expect(report.lines.slice(-report.staticLines.length)).toEqual(report.staticLines);
  });

  it('los fotogramas son funciones puras del índice', () => {
    const a = renderCelebrationFrame(3, 'EARS 12/12 · pivote 100% · gates 6/6');
    const b = renderCelebrationFrame(3, 'EARS 12/12 · pivote 100% · gates 6/6');
    expect(a).toBe(b);
    expect(renderCelebrationFrame(-5, 'x')).toBe(renderCelebrationFrame(0, 'x'));
    expect(renderCelebrationFrame(999, 'x')).toBe(renderCelebrationFrame(CELEBRATION_FRAME_COUNT - 1, 'x'));
    expect(renderCelebrationFrames('x')).toHaveLength(CELEBRATION_FRAME_COUNT);
  });

  it('el último fotograma tiene la barra llena y crece de forma monótona', () => {
    const frames = renderCelebrationFrames('resumen');
    const filled = (line: string): number => (line.match(/█/g) ?? []).length;
    expect(filled(frames[0]!)).toBeLessThan(filled(frames[frames.length - 1]!));
    expect(filled(frames[frames.length - 1]!)).toBe(CELEBRATION_BAR_WIDTH);
    expect(new Set(frames).size).toBe(CELEBRATION_FRAME_COUNT);
  });

  it('la ÚLTIMA línea es siempre el resumen estático, incluso animando', () => {
    const animated = judgeCelebration(goodSnapshot(), { isTty: true, env: {} });
    expect(animated.lines[animated.lines.length - 1]).toBe(
      animated.staticLines[animated.staticLines.length - 1],
    );
    expect(animated.lines[animated.lines.length - 1]).toContain('EARS 12/12');
  });

  it('la animación está acotada por debajo de 700 ms', () => {
    expect(CELEBRATION_TOTAL_MS).toBe(CELEBRATION_FRAME_COUNT * CELEBRATION_FRAME_MS);
    expect(CELEBRATION_TOTAL_MS).toBeLessThan(700);
  });

  it('playCelebration escribe los fotogramas y termina con el bloque estático', async () => {
    const report = judgeFeatureCelebration(GOOD, { isTty: true, env: {} });
    const chunks: string[] = [];
    const result = await playCelebration(report, {
      out: { write: (chunk: string) => chunks.push(chunk) },
      frameMs: 0,
      sleep: async () => undefined,
    });
    expect(result).toEqual({ frames: CELEBRATION_FRAME_COUNT, animated: true });
    expect(chunks.some((chunk) => chunk.startsWith('\r'))).toBe(true);
    const output = chunks.join('');
    expect(output).toContain(report.staticLines[report.staticLines.length - 1]!);
    expect(output.endsWith('\n')).toBe(true);
  });

  it('playCelebration sin fotogramas escribe el bloque estático una vez', async () => {
    const report = judgeFeatureCelebration(GOOD, { isTty: false, env: {} });
    const chunks: string[] = [];
    const result = await playCelebration(report, { out: { write: (chunk: string) => chunks.push(chunk) } });
    expect(result).toEqual({ frames: 0, animated: false });
    expect(chunks.join('')).toBe(`${report.staticLines.join('\n')}\n`);
  });
});

// ── Color ───────────────────────────────────────────────────────────────────────────────────────

describe('color — verde para el sí, amarillo para plain, rojo para refused, y nada en json', () => {
  it('celebrate en TTY sale en verde', () => {
    const report = judgeCelebration(goodSnapshot(), { isTty: true, env: {} });
    expect(ansiCount(report.staticLines[1]!)).toBeGreaterThan(0);
    expect(report.staticLines[1]).toContain('\u001b[32m');
  });

  it('NO_COLOR quita todos los códigos de color', () => {
    const colored = judgeCelebration(goodSnapshot(), { isTty: true, env: {} });
    const plain = judgeCelebration(goodSnapshot(), { isTty: true, env: { NO_COLOR: '1' } });
    expect(colored.staticLines.some((line) => ansiCount(line) > 0)).toBe(true);
    expect(plain.staticLines.every((line) => ansiCount(line) === 0)).toBe(true);
    expect(plain.lines.every((line) => ansiCount(line) === 0)).toBe(true);
  });

  it('noColor: true también degrada a texto plano', () => {
    const report = judgeCelebration(goodSnapshot(), { isTty: true, noColor: true, env: {} });
    expect(report.lines.every((line) => ansiCount(line) === 0)).toBe(true);
  });

  it('plain se pinta en amarillo y refused en rojo', () => {
    const ears = goodSnapshot();
    ears.ears = { conforming: 11, total: 12, errors: 1 };
    const plain = judgeCelebration(ears, { isTty: true, env: {} });
    expect(plain.lines[0]).toContain('\u001b[33m');

    const refused = judgeCelebration(null, { isTty: true, env: {} });
    expect(refused.lines[0]).toContain('\u001b[31m');
  });

  it('la ruta --json nunca se colorea', () => {
    const report = judgeCelebration(goodSnapshot(), { isTty: true, json: true, env: {} });
    expect(report.lines.every((line) => ansiCount(line) === 0)).toBe(true);
    expect(report.staticLines.every((line) => ansiCount(line) === 0)).toBe(true);
    expect(report.frames).toHaveLength(0);
  });
});

// ── Racha ───────────────────────────────────────────────────────────────────────────────────────

describe('renderStreak — singular, plural y cero honesto', () => {
  it('0 cambios no finge una racha', () => {
    expect(renderStreakPhrase(0)).toContain('0 cambios seguidos');
    expect(renderStreakPhrase(0)).toContain('aún sin racha');
  });

  it('1 cambio usa el singular', () => {
    expect(renderStreakPhrase(1)).toContain('1 cambio seguido');
    expect(renderStreakPhrase(1)).not.toContain('1 cambios');
  });

  it('N cambios usa el plural', () => {
    expect(renderStreakPhrase(7)).toContain('7 cambios seguidos');
  });

  it('renderStreak añade score y fase reales', () => {
    expect(renderStreak({ score: 92, phase: 3, rises: 7 })).toBe(
      'racha: 7 cambios seguidos sin bajar la adhesión · score 92/100 · fase 3/3',
    );
    expect(renderStreak({ score: 92, phase: 3, rises: 1 })).toContain('1 cambio seguido');
  });
});

// ── Nivel y pie de status ───────────────────────────────────────────────────────────────────────

describe('niveles derivados del score real', () => {
  it('las bandas salen del score, sin puntos inventados', () => {
    expect(levelFor(10).id).toBe('inicio');
    expect(levelFor(50).id).toBe('especificando');
    expect(levelFor(70).id).toBe('implementando');
    expect(levelFor(85).id).toBe('verificando');
    expect(levelFor(98).id).toBe('consolidado');
    expect(levelFor(Number.NaN).id).toBe('inicio');
  });

  it('el pie muestra nivel, fase y racha (0, 1 y N)', () => {
    expect(renderCelebrationFooter({ score: 92, phase: 3, rises: 0 })).toContain('nivel Verificando');
    expect(renderCelebrationFooter({ score: 92, phase: 3, rises: 0 })).toContain('aún sin racha');
    expect(renderCelebrationFooter({ score: 92, phase: 3, rises: 1 })).toContain('1 cambio seguido');
    expect(renderCelebrationFooter({ score: 92, phase: 3, rises: 7 })).toContain('7 cambios seguidos');
  });
});

// ── A nivel de feature ──────────────────────────────────────────────────────────────────────────

describe('judgeFeatureCelebration — el momento es la feature entera', () => {
  it('celebra solo con las tres verdades a alcance de feature', () => {
    const report = judgeFeatureCelebration(GOOD, { isTty: false });
    expect(report.verdict).toBe('celebrate');
    expect(report.reason).toContain('[checkout]');
    expect(report.staticLines.join('\n')).toContain('FEATURE VALIDADA — checkout');
    expect(report.lines[report.lines.length - 1]).toContain('checkout');
    expect(report.lines[report.lines.length - 1]).toContain('EARS 12/12');
  });

  it('un requisito EARS no conforme hunde la celebración de la feature', () => {
    const input: FeatureValidationInput = {
      ...GOOD,
      requirements: { conforming: 11, total: 12, errors: 1 },
    };
    const report = judgeFeatureCelebration(input, { isTty: false });
    expect(report.verdict).toBe('plain');
    expect(report.reason).toContain('[checkout]');
    expect(report.reason).toContain('EARS');
  });

  it('un gate fallido a nivel de feature → plain nombrando el gate', () => {
    const input: FeatureValidationInput = {
      ...GOOD,
      gates: { passed: 5, total: 6, failed: ['C3'] },
    };
    const report = judgeFeatureCelebration(input, { isTty: false });
    expect(report.verdict).toBe('plain');
    expect(report.reason).toContain('C3');
  });

  it('pivote sin evaluar → refused con el motivo', () => {
    const input: FeatureValidationInput = {
      ...GOOD,
      pivot: { alignment: 0.95, errors: 0, evaluated: false },
    };
    const report = judgeFeatureCelebration(input, { isTty: false });
    expect(report.verdict).toBe('refused');
    expect(report.reason).toContain('pivote');
  });

  it('requisitos notChecked → refused, jamás celebración', () => {
    const input: FeatureValidationInput = {
      ...GOOD,
      requirements: { conforming: 12, total: 12, errors: 0, evaluated: false },
    };
    expect(judgeFeatureCelebration(input, { isTty: false }).verdict).toBe('refused');
  });

  it('sin score ni fase se celebra pero no se inventan números', () => {
    const input: FeatureValidationInput = {
      feature: 'envios',
      requirements: GOOD.requirements,
      pivot: GOOD.pivot,
      gates: GOOD.gates,
    };
    const report = judgeFeatureCelebration(input, { isTty: false });
    expect(report.verdict).toBe('celebrate');
    const block = report.staticLines.join('\n');
    expect(block).not.toContain('score');
    expect(block).toContain('EARS 12/12');
  });
});

// ── El libro ────────────────────────────────────────────────────────────────────────────────────

const gates = (passed: number, total: number): GatesSnapshot => ({ passed, total, failed: [] });
const pivot = (alignment: number): PivotSnapshot => ({ alignment, errors: 0, evaluated: true });

describe('libro de celebraciones — una entrada real, ni una inventada', () => {
  it('apunta una validación y se lee de vuelta', async () => {
    const dir = await makeTmp();
    const result = await appendCelebration(dir, {
      feature: 'checkout',
      score: 92,
      phase: 3,
      ears: { conforming: 12, total: 12 },
      pivot: { alignment: 1 },
      gates: { passed: 6, total: 6 },
      streak: 7,
      date: '2026-02-11T10:00:00.000Z',
    });
    expect(result.appended).toBe(true);
    expect(result.corrupt).toBe(false);

    const read = await readCelebrations(dir);
    expect(read.corrupt).toBe(false);
    expect(read.ledger?.entries).toHaveLength(1);
    expect(read.ledger?.entries[0]).toMatchObject({
      feature: 'checkout',
      score: 92,
      phase: 3,
      streak: 7,
      ears: { conforming: 12, total: 12 },
      pivot: { alignment: 1 },
      gates: { passed: 6, total: 6 },
    });
  });

  it('una segunda ejecución idéntica NO duplica la entrada', async () => {
    const dir = await makeTmp();
    const record = {
      feature: 'checkout',
      score: 92,
      phase: 3 as const,
      ears: { conforming: 12, total: 12 },
      pivot: { alignment: 1 },
      gates: { passed: 6, total: 6 },
      streak: 7,
      date: '2026-02-11T10:00:00.000Z',
    };
    expect((await appendCelebration(dir, record)).appended).toBe(true);
    const second = await appendCelebration(dir, record);
    expect(second.appended).toBe(false);
    expect(second.reason).toContain('ya registrada');
    expect((await readCelebrations(dir)).ledger?.entries).toHaveLength(1);
  });

  it('un rechazo NO toca el disco: el fichero no existe', async () => {
    const dir = await makeTmp();
    const run = await celebrateFeature(
      dir,
      { ...GOOD, requirements: { conforming: 11, total: 12, errors: 1 } },
      { isTty: false, env: {} },
    );
    expect(run.report.verdict).toBe('plain');
    expect(run.ledger).toBeNull();
    expect(existsSync(celebrationsStatePath(dir))).toBe(false);
  });

  it('un refused tampoco toca el disco y no altera un libro existente', async () => {
    const dir = await makeTmp();
    const first = await celebrateFeature(dir, GOOD, { isTty: false, env: {} });
    expect(first.ledger?.appended).toBe(true);
    const before = await readFile(celebrationsStatePath(dir), 'utf8');

    const refused = await celebrateFeature(
      dir,
      { ...GOOD, pivot: { alignment: 0.9, errors: 0, evaluated: false } },
      { isTty: false, env: {} },
    );
    expect(refused.report.verdict).toBe('refused');
    expect(refused.ledger).toBeNull();
    expect(await readFile(celebrationsStatePath(dir), 'utf8')).toBe(before);
  });

  it('celebrateFeature registra una sola vez por feature+fecha+score', async () => {
    const dir = await makeTmp();
    const input: FeatureValidationInput = { ...GOOD, date: '2026-02-11T10:00:00.000Z' };
    const first = await celebrateFeature(dir, input, { isTty: false, env: {} });
    const second = await celebrateFeature(dir, input, { isTty: false, env: {} });
    expect(first.ledger?.appended).toBe(true);
    expect(second.ledger?.appended).toBe(false);
    expect((await readCelebrations(dir)).ledger?.entries).toHaveLength(1);
  });

  it('no apunta entradas incompletas: gates que no pasan, sin score o sin racha', async () => {
    const dir = await makeTmp();
    const base = {
      feature: 'checkout',
      score: 92,
      phase: 3 as const,
      ears: { conforming: 12, total: 12 },
      pivot: { alignment: 1 },
      gates: { passed: 6, total: 6 },
      streak: 7,
    };
    expect((await appendCelebration(dir, { ...base, gates: gates(5, 6) })).appended).toBe(false);
    expect((await appendCelebration(dir, { ...base, score: undefined })).appended).toBe(false);
    expect((await appendCelebration(dir, { ...base, phase: undefined })).appended).toBe(false);
    expect((await appendCelebration(dir, { ...base, streak: undefined })).appended).toBe(false);
    expect((await appendCelebration(dir, { ...base, ears: { conforming: 11, total: 12 } })).appended).toBe(false);
    expect((await appendCelebration(dir, { ...base, pivot: pivot(1.4) })).appended).toBe(false);
    expect(existsSync(celebrationsStatePath(dir))).toBe(false);
  });

  it('un libro corrupto se avisa y se reinicia con la entrada real', async () => {
    const dir = await makeTmp();
    const statePath = celebrationsStatePath(dir);
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, '{ esto no es json', 'utf8');

    const read = await readCelebrations(dir);
    expect(read.corrupt).toBe(true);
    expect(read.ledger).toBeNull();

    const result = await appendCelebration(dir, {
      feature: 'checkout',
      score: 92,
      phase: 3,
      ears: { conforming: 12, total: 12 },
      pivot: { alignment: 1 },
      gates: { passed: 6, total: 6 },
      streak: 7,
      date: '2026-02-11T10:00:00.000Z',
    });
    expect(result.appended).toBe(true);
    expect(result.corrupt).toBe(true);
    expect(result.stateError).toBeTruthy();

    const after = await readCelebrations(dir);
    expect(after.corrupt).toBe(false);
    expect(after.ledger?.entries).toHaveLength(1); // solo la entrada real, ninguna inventada
  });

  it('readCelebrations marca corrupto un libro con forma equivocada', async () => {
    const dir = await makeTmp();
    const statePath = celebrationsStatePath(dir);
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify({ version: 1, entries: [{ feature: 'x' }] }), 'utf8');
    const read = await readCelebrations(dir);
    expect(read.corrupt).toBe(true);
    expect(read.error).toContain('entries');
  });

  it('status --celebrations lee el libro de vuelta y avisa si está corrupto', async () => {
    const dir = await makeTmp();
    await appendCelebration(dir, {
      feature: 'checkout',
      score: 92,
      phase: 3,
      ears: { conforming: 12, total: 12 },
      pivot: { alignment: 1 },
      gates: { passed: 6, total: 6 },
      streak: 7,
      date: '2026-02-11T10:00:00.000Z',
    });
    await appendCelebration(dir, {
      feature: 'api',
      score: 85,
      phase: 3,
      ears: { conforming: 9, total: 9 },
      pivot: { alignment: 0.95 },
      gates: { passed: 6, total: 6 },
      streak: 3,
      date: '2026-02-10T09:00:00.000Z',
    });

    const read = await readCelebrations(dir);
    const lines = renderCelebrations(read, { noColor: true });
    expect(lines.join('\n')).toContain('VALIDACIONES REGISTRADAS: 2');
    expect(lines.join('\n')).toContain('checkout');
    expect(lines.join('\n')).toContain('api');
    expect(lines.join('\n')).toContain('nivel: Verificando');

    const json = celebrationsToJson(read);
    expect(json.count).toBe(2);
    expect(json.features).toEqual(['checkout', 'api']);
    expect(json.latest?.feature).toBe('api');
    expect(json.corrupt).toBe(false);
    expect(json.entries).toHaveLength(2);

    const empty = await readCelebrations(await makeTmp());
    expect(renderCelebrations(empty, { noColor: true }).join('\n')).toContain('todavía no hay ninguna');

    const corruptDir = await makeTmp();
    const corruptPath = celebrationsStatePath(corruptDir);
    await mkdir(path.dirname(corruptPath), { recursive: true });
    await writeFile(corruptPath, 'nope', 'utf8');
    const corruptLines = renderCelebrations(await readCelebrations(corruptDir), { noColor: true }).join('\n');
    expect(corruptLines).toContain('aviso');
    expect(corruptLines).toContain('no se inventa ninguna entrada');
  });

  it('los logros se derivan de eventos reales, no de puntos', () => {
    expect(deriveAchievements([])).toEqual([]);
    expect(deriveAchievements([], { constitutionRatified: false, deltaMerged: false })).toEqual([]);

    const entry = {
      feature: 'checkout',
      date: '2026-02-11T10:00:00.000Z',
      score: 92,
      phase: 3 as const,
      ears: { conforming: 12, total: 12 },
      pivot: { alignment: 1 },
      gates: { passed: 6, total: 6 },
      streak: 7,
    };
    const ids = deriveAchievements([entry]).map((achievement) => achievement.id);
    expect(ids).toContain('primera-validacion');
    expect(ids).toContain('racha-5');
    expect(ids).not.toContain('tres-features');

    const many = ['a', 'b', 'c'].map((feature, index) => ({ ...entry, feature, date: `2026-02-1${index}T10:00:00.000Z` }));
    expect(deriveAchievements(many).map((a) => a.id)).toContain('tres-features');
    expect(deriveAchievements(many).find((a) => a.id === 'tres-features')?.evidence).toContain('3 features');

    const withFacts = deriveAchievements([entry], { constitutionRatified: true, deltaMerged: true });
    expect(withFacts.map((a) => a.id)).toEqual(
      expect.arrayContaining(['constitucion-ratificada', 'primera-delta']),
    );
    for (const achievement of withFacts) expect(achievement.evidence.length).toBeGreaterThan(0);
  });
});

// ── Sin dependencias nuevas ─────────────────────────────────────────────────────────────────────

describe('sin dependencias', () => {
  it('celebrate.ts solo importa builtins de node y módulos relativos', async () => {
    const source = await readFile(new URL('../src/core/celebrate.ts', import.meta.url), 'utf8');
    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]!);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier.startsWith('./') || specifier.startsWith('node:'), specifier).toBe(true);
    }
  });

  it('package.json no gana dependencias de runtime', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });
});
