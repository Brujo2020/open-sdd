/**
 * El panel constitucional: puntuación de adhesión (0..100) y su TENDENCIA (REQ-MAT-011).
 *
 * `core/specConstitution.ts` exporta `adhesionScore`, `readAdhesionHistory`, `adhesionTrend`,
 * `recordAdhesionHistory` y `ADHESION_HISTORY_FILE`, pero nada los consumía: «subió 12 puntos desde
 * la última release» no aparecía en ninguna superficie. Estas pruebas fijan lo que ahora sí aparece:
 * la línea `Constitucional` carga el número y el movimiento, `--check` AÑADE la medición a la serie
 * (append-only) y una historia ilegible avisa y empieza de cero en vez de reventar o inventar una
 * tendencia. También se re-fija la delegación de `open_sdd_context_pack` a `core/contextPack.ts`
 * (mismo juego de claves, ausencias con `present:false` + `reason`).
 *
 * Los fixtures viven en `os.tmpdir()` y se limpian en `afterEach`: nada se escribe dentro del
 * repositorio.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleStatusCommand } from '../src/cli/commands/status.js';
import { callTool } from '../src/mcp/tools.js';
import { renderConstitution, type Constitution } from '../src/core/constitution.js';

const dirs: string[] = [];

const makeTmp = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-panel-adhesion-'));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true });
});

const write = async (root: string, rel: string, content: string): Promise<void> => {
  const target = path.join(root, rel);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
};

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
  };
};

const CONSTITUTION: Constitution = {
  project: 'demo',
  provenance: 'descriptive',
  establishedFacts: ['El stack en vigor es Node.js + TypeScript ESM + vitest.'],
  principles: [
    {
      id: 'C-STACK-FACT',
      title: 'Stack en vigor',
      level: 'SHOULD',
      threatReference: 'ADR-001',
      restriction:
        'El stack en vigor (Node.js, TypeScript ESM y vitest) se declara hecho establecido y no se moderniza sin una enmienda gobernada.',
      pattern: 'Un cambio de stack se tramita como enmienda con plan de migración aprobado.',
      justification: 'Modernizar sin pedido destruye el comportamiento anclado que nadie autorizó a cambiar.',
      provenance: 'descriptive',
      evidence: ['package.json'],
    },
  ],
  amendments: [],
};

const REQUIREMENTS = [
  '# Requirements: sesión',
  '',
  '### REQ-SESS-001: Registrar sesión',
  '',
  '- WHEN se invoque el endpoint, the system shall registrar la sesión con su marca de tiempo.',
  '',
].join('\n');

/** Declara `C-STACK-FACT`: alineación 1, sin hallazgos, adhesión 100. */
const PLAN_ALIGNED = [
  '# Plan: sesión',
  '',
  '## Constitution',
  '',
  '- C-STACK-FACT — el stack no se moderniza sin una enmienda gobernada.',
  '',
].join('\n');

/** No declara nada: aviso `NO_PRINCIPLES_DECLARED` y adhesión 0 (que NO es un aprobado). */
const PLAN_NO_DECLARATION = ['# Plan: sesión', '', '## Enfoque', '', '- Implementar el registro de sesión.', ''].join('\n');

const TASKS = [
  '- [x] 1.1 implementar el registro — _Requirements: REQ-SESS-001_ — _Boundary:_ `src/session`',
  '  _Evidence: npx vitest run (3 passed)',
  '',
].join('\n');

const DELTA_ADDED = [
  '# Delta: session — Registrar sesión',
  '',
  'Status: proposed',
  '',
  '## ADDED',
  '',
  '### REQ-SESS-001 — Registrar sesión',
  '- Statement: WHEN se invoque el endpoint, the system shall registrar la sesión.',
  '- Targets: src/session/register.ts',
  '- Strangler: new',
  '',
].join('\n');

const seed = async (root: string, options: { plan?: string; withDelta?: boolean } = {}): Promise<void> => {
  await write(
    root,
    '.sdd/specs/session/spec.json',
    JSON.stringify({ name: 'session', version: '1.0.0', phase: 'initialized', language: 'es', description: 'x' }),
  );
  await write(root, '.sdd/steering/constitution.md', renderConstitution(CONSTITUTION));
  await write(
    root,
    '.sdd/settings/rigor.json',
    JSON.stringify({ level: 'spec-first', rationale: 'Fixture con motivo declarado.', brownfield: true }, null, 2),
  );
  await write(root, '.sdd/specs/session/requirements.md', REQUIREMENTS);
  await write(root, '.sdd/specs/session/plan.md', options.plan ?? PLAN_ALIGNED);
  await write(root, '.sdd/specs/session/tasks.md', TASKS);
  if (options.withDelta) await write(root, '.sdd/specs/session/delta.md', DELTA_ADDED);
};

const HISTORY_REL = path.join('.sdd', 'state', 'adhesion-history.json');

const writeHistory = async (root: string, entries: unknown[]): Promise<void> =>
  write(root, HISTORY_REL, `${JSON.stringify(entries, null, 2)}\n`);

const readHistory = async (root: string): Promise<{ date: string; score: number; feature: string }[]> =>
  JSON.parse(await readFile(path.join(root, HISTORY_REL), 'utf8')) as { date: string; score: number; feature: string }[];

const PREVIOUS = (score: number, date = '2026-01-01T00:00:00.000Z') => ({ date, score, feature: 'session' });

describe('cli/status — la línea Constitucional lleva la adhesión y su tendencia', () => {
  it('primera ejecución: score + tendencia first-run', async () => {
    const root = await makeTmp();
    await seed(root);
    const ctx = makeIO();

    const code = await handleStatusCommand(['session'], ctx.io, root);
    const text = ctx.logs.join('\n');

    expect(code).toBe(0);
    expect(text).toContain('adhesión 100/100');
    expect(text).toContain('tendencia first-run (sin medición previa)');
  });

  it('subida: dice cuánto subió y contra qué medición', async () => {
    const root = await makeTmp();
    await seed(root);
    await writeHistory(root, [PREVIOUS(88)]);
    const ctx = makeIO();

    const code = await handleStatusCommand(['session'], ctx.io, root);
    const text = ctx.logs.join('\n');

    expect(code).toBe(0);
    expect(text).toContain('adhesión 100/100');
    expect(text).toMatch(/tendencia up \(\+12 puntos vs 88 del 2026-01-01\)/);
  });

  it('bajada: nombra el descenso contra la medición previa', async () => {
    const root = await makeTmp();
    await seed(root, { plan: PLAN_NO_DECLARATION });
    await writeHistory(root, [PREVIOUS(50)]);
    const ctx = makeIO();

    const code = await handleStatusCommand(['session'], ctx.io, root);
    const text = ctx.logs.join('\n');

    expect(code).toBe(0);
    expect(text).toMatch(/tendencia down \(-50 puntos vs 50 del 2026-01-01\)/);
  });

  it('estable: flat con delta 0, no un «sin tendencia»', async () => {
    const root = await makeTmp();
    await seed(root);
    await writeHistory(root, [PREVIOUS(100)]);
    const ctx = makeIO();

    const code = await handleStatusCommand(['session'], ctx.io, root);
    const text = ctx.logs.join('\n');

    expect(code).toBe(0);
    expect(text).toMatch(/tendencia flat \(0 puntos vs 100 del 2026-01-01\)/);
  });

  it('sin principios declarados la puntuación es 0 y se dice que NO es un aprobado', async () => {
    const root = await makeTmp();
    await seed(root, { plan: PLAN_NO_DECLARATION });
    const ctx = makeIO();

    const code = await handleStatusCommand(['session'], ctx.io, root);
    const text = ctx.logs.join('\n');

    expect(code).toBe(0);
    expect(text).toContain('adhesión 0/100 (la spec no declara principios: 0 NO es un aprobado)');
    expect(text).toContain('NO_PRINCIPLES_DECLARED');
    expect(text).not.toContain('alineación 100%');
  });

  it('una historia corrupta avisa, no revienta y no reporta una tendencia falsa', async () => {
    const root = await makeTmp();
    await seed(root);
    await write(root, HISTORY_REL, '{ esto no es json');
    const ctx = makeIO();

    const code = await handleStatusCommand(['session'], ctx.io, root);
    const text = ctx.logs.join('\n');

    expect(code).toBe(0);
    expect(text).toContain('historia de adhesión');
    expect(text).toContain('no es JSON válido');
    expect(text).toContain('se empieza una serie nueva');
    // La serie se reinicia: la única tendencia honesta es first-run, nunca un movimiento inventado.
    expect(text).toContain('tendencia first-run (sin medición previa)');
    expect(text).not.toMatch(/tendencia (up|down|flat)/);
  });
});

describe('cli/status --check — registro append-only de la medición', () => {
  it('añade la medición y la segunda ejecución conserva la primera fila', async () => {
    const root = await makeTmp();
    await seed(root);

    const first = makeIO();
    expect(await handleStatusCommand(['session', '--check'], first.io, root)).toBe(0);
    expect(first.logs.join('\n')).toContain('tendencia first-run');
    expect(first.logs.join('\n')).toContain('1 medición(es) en .sdd/state/adhesion-history.json');

    const afterFirst = await readHistory(root);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].feature).toBe('session');
    expect(afterFirst[0].score).toBe(100);

    const second = makeIO();
    expect(await handleStatusCommand(['session', '--check'], second.io, root)).toBe(0);

    const afterSecond = await readHistory(root);
    expect(afterSecond).toHaveLength(2);
    // Append-only: la primera fila no se reescribe ni se pierde.
    expect(afterSecond[0]).toEqual(afterFirst[0]);
    expect(afterSecond[1].score).toBe(100);
    // La tendencia del SEGUNDO panel compara contra la primera medición, no contra sí misma.
    expect(second.logs.join('\n')).toMatch(/tendencia flat \(0 puntos vs 100 del /);
    expect(second.logs.join('\n')).toContain('2 medición(es) en .sdd/state/adhesion-history.json');
  });

  it('con historia corrupta avisa, aparta la evidencia y arranca una serie nueva', async () => {
    const root = await makeTmp();
    await seed(root);
    await write(root, HISTORY_REL, '{ esto no es json');
    const ctx = makeIO();

    const code = await handleStatusCommand(['session', '--check'], ctx.io, root);
    const text = ctx.logs.join('\n');

    expect(code).toBe(0);
    expect(text).toContain('ADHESION_HISTORY_CORRUPT');
    expect(text).toContain('se empieza una serie nueva');

    const entries = await readHistory(root);
    expect(entries).toHaveLength(1);
    expect(entries[0].score).toBe(100);

    // El fichero ilegible no se borra: se aparta como evidencia.
    const stateFiles = await readdir(path.join(root, '.sdd', 'state'));
    expect(stateFiles.some((name) => name.startsWith('adhesion-history.json.corrupt-'))).toBe(true);
  });
});

describe('cli/status — las formas heredadas siguen intactas', () => {
  it('--json sin feature sigue devolviendo la lista por spec y el panel conserva Specification:/Phase:', async () => {
    const root = await makeTmp();
    await seed(root);

    const jsonCtx = makeIO();
    const jsonCode = await handleStatusCommand(['--json'], jsonCtx.io, root);
    const parsed = JSON.parse(jsonCtx.logs.join('\n')) as { name: string }[];

    expect(jsonCode).toBe(0);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((spec) => spec.name === 'session')).toBe(true);

    const panelCtx = makeIO();
    expect(await handleStatusCommand(['session'], panelCtx.io, root)).toBe(0);
    expect(panelCtx.logs.join('\n')).toMatch(/Specification:\s*session/);
    expect(panelCtx.logs.join('\n')).toMatch(/Phase:\s+initialized/);
  });
});

describe('mcp/open_sdd_context_pack — delegación a core/contextPack con las mismas claves', () => {
  const TOP_LEVEL_KEYS = ['absent', 'complete', 'constitution', 'feature', 'moduleMap', 'rigor', 'root', 'sddDir', 'spec'];

  it('mantiene el juego de claves y marca las ausencias con present:false y reason', async () => {
    const empty = await makeTmp();
    const emptyOutcome = await callTool('open_sdd_context_pack', {}, { cwd: empty, sddDir: '.sdd' });
    const emptyPack = emptyOutcome.data as Record<string, any>;

    expect(Object.keys(emptyPack).sort()).toEqual(TOP_LEVEL_KEYS);
    expect(emptyPack.constitution.present).toBe(false);
    expect(emptyPack.constitution.reason).toBeTruthy();
    expect(emptyPack.spec.present).toBe(false);
    expect(emptyPack.spec.reason).toBeTruthy();
    expect(emptyPack.absent).toContain('constitution');
    expect(emptyPack.absent).toContain('spec');
    expect(emptyOutcome.isError).toBe(false);
    expect(emptyOutcome.detail).toContain('INCOMPLETO');

    // Las claves de una pieza ausente no se omiten: son las mismas que las de una presente, más `reason`.
    expect(Object.keys(emptyPack.constitution).sort()).toEqual(['issues', 'path', 'present', 'principlesInForce', 'reason', 'text']);
    expect(Object.keys(emptyPack.spec).sort()).toEqual(['feature', 'path', 'present', 'reason']);
  });

  it('con el pack presente conserva la MISMA raíz y las mismas piezas anidadas', async () => {
    const empty = await makeTmp();
    const emptyPack = (await callTool('open_sdd_context_pack', {}, { cwd: empty, sddDir: '.sdd' })).data as Record<string, any>;

    const full = await makeTmp();
    await seed(full, { withDelta: true });
    const fullOutcome = await callTool('open_sdd_context_pack', { feature: 'session' }, { cwd: full, sddDir: '.sdd' });
    const fullPack = fullOutcome.data as Record<string, any>;

    // Clave por clave: delegar no puede haber eliminado ninguna.
    expect(Object.keys(fullPack).sort()).toEqual(Object.keys(emptyPack).sort());
    expect(Object.keys(fullPack).sort()).toEqual(TOP_LEVEL_KEYS);

    expect(fullPack.constitution.present).toBe(true);
    expect(Object.keys(fullPack.constitution).sort()).toEqual(['issues', 'path', 'present', 'principlesInForce', 'text']);
    expect(fullPack.constitution.principlesInForce.map((principle: { id: string }) => principle.id)).toContain('C-STACK-FACT');

    expect(fullPack.spec.present).toBe(true);
    expect(Object.keys(fullPack.spec).sort()).toEqual(['delta', 'feature', 'path', 'plan', 'present', 'requirements', 'tasks']);
    expect(fullPack.spec.requirements.present).toBe(true);
    expect(fullPack.spec.delta.present).toBe(true);
    expect(fullPack.spec.delta.parsed.entries).toHaveLength(1);

    expect(fullPack.rigor.present).toBe(true);
    expect(fullPack.rigor.level).toBe('spec-first');
    expect(Object.keys(fullPack.rigor)).toEqual(expect.arrayContaining(['present', 'level', 'brownfield', 'rationale', 'activeGates']));
    expect(Object.keys(fullPack.moduleMap)).toEqual(expect.arrayContaining(['present', 'modules', 'complete', 'detail']));
    expect(fullOutcome.isError).toBe(false);
  });

  it('nombra la feature ausente con present:false y reason (no omite la clave)', async () => {
    const root = await makeTmp();
    await seed(root);

    const outcome = await callTool('open_sdd_context_pack', { feature: 'no-existe' }, { cwd: root, sddDir: '.sdd' });
    const pack = outcome.data as Record<string, any>;

    expect(pack.spec.present).toBe(false);
    expect(pack.spec.feature).toBe('no-existe');
    expect(pack.spec.reason).toBeTruthy();
    expect(pack.absent).toContain('spec');
    expect(outcome.isError).toBe(false);
  });
});

describe('cli/status — la marca «derivado» del comando de contratos', () => {
  it('imprime «(derivado, no verificado)» cuando el comando es derivado', async () => {
    // La condición de `core/status.ts` estaba INVERTIDA: el marcador se imprimía justo cuando el
    // comando NO era derivado y se callaba cuando SÍ lo era, presentando una suposición como hecho.
    const root = await makeTmp();
    await seed(root, { withDelta: true });
    const ctx = makeIO();

    const code = await handleStatusCommand(['session'], ctx.io, root);
    const text = ctx.logs.join('\n');

    expect(code).toBe(0);
    expect(text).toContain('comando npm test (derivado, no verificado)');
  });

  it('hoy ningún comando de test puede presentarse como verificado (la rama negativa es inalcanzable)', async () => {
    // `testCommandFor` marca derivado TODO comando, incluido el runner reconocido y el `npm test`
    // inventado. Esa es la razón de que el «otro lado» de la condición no se pueda ejercer: no hay
    // ningún caso legítimo sin marca. Se fija aquí para que añadir un comando «verificado» obligue a
    // decidir explícitamente qué lo verifica.
    const { testCommandFor } = await import('../src/core/executionContract.js');
    for (const framework of [undefined, '', 'vitest', 'jest', 'mocha', 'framework-que-nadie-declara']) {
      expect(testCommandFor(framework).derived).toBe(true);
    }
  });
});
