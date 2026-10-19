/**
 * La escalera de rigor: la PROPIEDAD que la hace una escalera, no la etiqueta de cada nivel.
 *
 * `coreRigor.test.ts` fija lo que exige cada nivel por separado. Este archivo fija lo que solo se
 * puede afirmar del conjunto:
 *
 *   1. Monotonía: cada nivel es un superconjunto del anterior, tanto en `requires` como en
 *      `gatesActive`. Un cambio futuro que quite una exigencia de un nivel superior —o que mueva
 *      un gate de sitio— tiene que fallar aquí, porque eso es exactamente dejar de ser una escalera.
 *   2. La Constitución es el SUELO: `required` + `blocking` en los tres niveles, greenfield y
 *      brownfield. Antes era advisory en `spec-first`; ese hueco es el que la política cerró.
 *   3. La configurable: `effectiveGates` y `validateGateOverride`. Un id desconocido se RECHAZA en
 *      lugar de ignorarse, porque un error de escritura reduciría la vigilancia en silencio.
 *   4. La superficie del CLI: compacta por defecto, `--verbose` con la tabla, `--gates` con la
 *      escalera, `--quiet` con una sola línea y el veredicto en el código de salida.
 *   5. El hook de commit llama a `govern rigor` en modo fluido (`--quiet --no-drift`), para que un
 *      commit no se lea como una auditoría.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_RIGOR_LEVEL,
  RIGOR_LADDER,
  RIGOR_LEVELS,
  RIGOR_SETTINGS_FILE,
  constitutionRequired,
  effectiveGates,
  validateGateOverride,
  type RigorDemand,
  type SddRigorLevel,
} from '../src/core/rigor.js';
import { renderConstitution, type Constitution } from '../src/core/constitution.js';
import { handleGovernCommand } from '../src/cli/commands/paper.js';
import type { CliIO } from '../src/cli/io.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// ---------------------------------------------------------------------------------------------
// Temp dirs (cleaned in afterEach)
// ---------------------------------------------------------------------------------------------

const tempDirs: string[] = [];

const makeRoot = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-rigor-ladder-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// Fixtures — copied in shape from coreRigor.test.ts so both files age together
// ---------------------------------------------------------------------------------------------

const REQUIREMENTS_MD = `# Requirements

### REQ-1: Endpoint de salud
- The Gateway shall expose a health endpoint.
`;

const PLAN_WITH_CONTRACTS_MD = `# Plan

Arquitectura mínima.

## Contracts

- api: GET /health → 200
`;

const TASKS_MD = `# Tasks

- [ ] 1. Implementar el endpoint _Requirements: REQ-1_ _Boundary:_ \`src/health.ts\`
`;

const writeTriad = async (root: string, feature = 'alpha'): Promise<string> => {
  const specDir = path.join(root, '.sdd', 'specs', feature);
  await mkdir(specDir, { recursive: true });
  await writeFile(path.join(specDir, 'requirements.md'), REQUIREMENTS_MD, 'utf8');
  await writeFile(path.join(specDir, 'plan.md'), PLAN_WITH_CONTRACTS_MD, 'utf8');
  await writeFile(path.join(specDir, 'tasks.md'), TASKS_MD, 'utf8');
  return specDir;
};

/** Justificación larga que nombra el vector de ataque, como exige la anatomía de seis campos. */
const LONG_RATIONALE =
  'Una consulta concatenada permite reescribir la sentencia desde la entrada y leer toda la base de datos: el atacante controla el texto que llega al motor.';

const IN_FORCE_AMENDMENT = {
  id: 'AMD-1',
  title: 'Adoptar consultas parametrizadas',
  proposedBy: 'security-lead',
  status: 'in-force' as const,
  migrationPlan: 'Migrar los repositorios módulo a módulo verificando los contratos.',
};

const validConstitution = (): Constitution => ({
  project: 'demo',
  provenance: 'normative',
  establishedFacts: [],
  principles: [
    {
      id: 'SEC-002',
      title: 'Consultas parametrizadas',
      cweReference: 'CWE-89',
      level: 'MUST',
      restriction: 'Las consultas deben usar sentencias parametrizadas o el ORM, nunca concatenación de texto.',
      pattern: 'Usar el constructor de consultas del ORM con parámetros vinculados en todo acceso a datos.',
      justification: LONG_RATIONALE,
      provenance: 'normative',
      amendment: { ...IN_FORCE_AMENDMENT },
    },
  ],
  amendments: [{ ...IN_FORCE_AMENDMENT }],
});

/** Un MUST normativo sin enmienda: `validateConstitution` lo rechaza (severity error). */
const invalidConstitution = (): Constitution => {
  const base = validConstitution();
  return {
    ...base,
    principles: base.principles.map(({ amendment: _amendment, ...rest }) => rest),
    amendments: [],
  };
};

const writeConstitution = async (root: string, constitution: Constitution): Promise<string> => {
  const steering = path.join(root, '.sdd', 'steering');
  await mkdir(steering, { recursive: true });
  const file = path.join(steering, 'constitution.md');
  await writeFile(file, renderConstitution(constitution), 'utf8');
  return file;
};

const writeRigorSettings = async (root: string, level: SddRigorLevel = 'spec-first'): Promise<void> => {
  await mkdir(path.dirname(path.join(root, RIGOR_SETTINGS_FILE)), { recursive: true });
  await writeFile(
    path.join(root, RIGOR_SETTINGS_FILE),
    JSON.stringify({ level, rationale: 'Nivel declarado por el repositorio de prueba.', brownfield: false }),
    'utf8',
  );
};

/** Un proyecto mínimo, válido y verde: triada completa, constitución citable y nivel declarado. */
const makeCliFixture = async (constitution: Constitution): Promise<string> => {
  const root = await makeRoot();
  await writeRigorSettings(root);
  await writeTriad(root);
  await writeConstitution(root, constitution);
  return root;
};

// ---------------------------------------------------------------------------------------------
// CLI recorder — the shape of `CliIO` (log | error | exit)
// ---------------------------------------------------------------------------------------------

interface CliRun {
  code: number;
  logLines: string[];
  errorLines: string[];
  out: string;
}

const createRecorder = (): { io: CliIO; logLines: string[]; errorLines: string[] } => {
  const logLines: string[] = [];
  const errorLines: string[] = [];
  return {
    io: {
      log: (msg: string) => logLines.push(msg),
      error: (msg: string) => errorLines.push(msg),
      // `govern rigor` returns its verdict as a number; nothing in the tested path should exit().
      exit: () => undefined,
    },
    logLines,
    errorLines,
  };
};

const runGovern = async (root: string, args: string[]): Promise<CliRun> => {
  const rec = createRecorder();
  const code = await handleGovernCommand(args, rec.io, root);
  return { code, logLines: rec.logLines, errorLines: rec.errorLines, out: [...rec.logLines, ...rec.errorLines].join('\n') };
};

// ---------------------------------------------------------------------------------------------
// 1. Monotonía: cada nivel solo AÑADE
// ---------------------------------------------------------------------------------------------

const DEMAND_RANK: Record<RigorDemand, number> = { 'not-required': 0, recommended: 1, required: 2 };

const requiredOf = (level: (typeof RIGOR_LEVELS)[number]): string[] =>
  Object.entries(level.requires)
    .filter(([, demand]) => demand === 'required')
    .map(([aspect]) => aspect)
    .sort();

const EXACT_GATES: Record<SddRigorLevel, string[]> = {
  'spec-first': ['C1', 'C2'],
  'spec-anchored': ['C1', 'C2', 'C3', 'C6'],
  'spec-as-source': ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
};

describe('core/rigor — la escalera es monótona (no hay nivel que quite nada)', () => {
  it('declara los tres niveles en orden y la escalera es una sola tabla', () => {
    expect(RIGOR_LEVELS.map((l) => l.level)).toEqual(['spec-first', 'spec-anchored', 'spec-as-source']);
    expect(DEFAULT_RIGOR_LEVEL).toBe('spec-first');
    expect(RIGOR_LADDER).toBe(RIGOR_LEVELS);
  });

  it('las exigencias required de cada nivel son un superconjunto de las del anterior', () => {
    for (let i = 1; i < RIGOR_LEVELS.length; i += 1) {
      const previous = requiredOf(RIGOR_LEVELS[i - 1]);
      const current = requiredOf(RIGOR_LEVELS[i]);
      for (const aspect of previous) {
        expect(current, `${RIGOR_LEVELS[i].level} debe seguir exigiendo ${aspect}`).toContain(aspect);
      }
    }
  });

  it('ningún aspecto baja de exigencia al subir de nivel', () => {
    // Quitar una demanda de un nivel superior es la regresión que esta prueba existe para cazar:
    // una escalera que baja un peldaño deja de ser una escalera.
    const aspects = Object.keys(RIGOR_LEVELS[0].requires);
    for (const aspect of aspects) {
      for (let i = 1; i < RIGOR_LEVELS.length; i += 1) {
        const before = RIGOR_LEVELS[i - 1].requires[aspect] as RigorDemand;
        const after = RIGOR_LEVELS[i].requires[aspect] as RigorDemand;
        expect(
          DEMAND_RANK[after],
          `${RIGOR_LEVELS[i].level} rebajó "${aspect}" de ${before} a ${after}`,
        ).toBeGreaterThanOrEqual(DEMAND_RANK[before]);
      }
    }
  });

  it('los gates activos crecen exactamente 2 → 4 → 6 y cada nivel conserva los del anterior', () => {
    expect(RIGOR_LEVELS.map((l) => l.gatesActive.length)).toEqual([2, 4, 6]);
    expect(RIGOR_LEVELS.map((l) => l.gatesActive)).toEqual([
      EXACT_GATES['spec-first'],
      EXACT_GATES['spec-anchored'],
      EXACT_GATES['spec-as-source'],
    ]);
    for (let i = 1; i < RIGOR_LEVELS.length; i += 1) {
      for (const gate of RIGOR_LEVELS[i - 1].gatesActive) {
        expect(RIGOR_LEVELS[i].gatesActive, `${RIGOR_LEVELS[i].level} debe conservar ${gate}`).toContain(gate);
      }
    }
  });

  it('C2 (secretos y comandos destructivos) está activo en los tres niveles: el suelo duro no se negocia', () => {
    for (const level of RIGOR_LEVELS) {
      expect(level.gatesActive, `${level.level} debe conservar C2`).toContain('C2');
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 2. La Constitución es el suelo de la escalera
// ---------------------------------------------------------------------------------------------

describe('core/rigor — la constitución es obligatoria en los tres niveles', () => {
  it('constitutionRequired devuelve required + blocking con motivo no vacío en todos los niveles y ambos caminos', () => {
    for (const level of RIGOR_LEVELS.map((l) => l.level)) {
      for (const brownfield of [false, true]) {
        const verdict = constitutionRequired(level, brownfield);
        expect(verdict.required, `${level} (brownfield=${brownfield})`).toBe(true);
        expect(verdict.severity, `${level} (brownfield=${brownfield})`).toBe('blocking');
        expect(verdict.reason.trim().length, `${level} (brownfield=${brownfield})`).toBeGreaterThan(0);
      }
    }
  });

  it('spec-first es blocking, no advisory: un veredicto bloqueante debe citar autoridad en cada nivel', () => {
    for (const brownfield of [false, true]) {
      const verdict = constitutionRequired('spec-first', brownfield);
      expect(verdict.required).toBe(true);
      expect(verdict.severity).toBe('blocking');
      expect(verdict.reason).toMatch(/suelo|autoridad/i);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 3. spec-first exige constitución y triada, y nada de lo de arriba
// ---------------------------------------------------------------------------------------------

describe('core/rigor — spec-first es el suelo y no exige lo que añaden los niveles superiores', () => {
  it('exige constitution y triad', () => {
    const first = RIGOR_LEVELS.find((l) => l.level === 'spec-first')!;
    expect(first.requires.constitution).toBe('required');
    expect(first.requires.triad).toBe('required');
    expect(first.missingArtifactPolicy).toBe('blocking');
  });

  it('no exige evidence, drift, contracts ni regeneration (eso se añade al subir)', () => {
    const first = RIGOR_LEVELS.find((l) => l.level === 'spec-first')!;
    for (const aspect of ['evidence', 'drift', 'contracts', 'regeneration']) {
      expect(first.requires[aspect], `spec-first no debe exigir ${aspect}`).toBe('not-required');
    }
  });

  it('exige exactamente los dos gates del suelo', () => {
    const first = RIGOR_LEVELS.find((l) => l.level === 'spec-first')!;
    expect(first.gatesActive).toEqual(['C1', 'C2']);
  });
});

// ---------------------------------------------------------------------------------------------
// 4. effectiveGates: el nivel decide las exigencias, el override decide las comprobaciones
// ---------------------------------------------------------------------------------------------

describe('core/rigor — effectiveGates', () => {
  it('sin override devuelve los gates del nivel', () => {
    for (const level of RIGOR_LEVELS.map((l) => l.level)) {
      expect(effectiveGates(level)).toEqual(EXACT_GATES[level]);
    }
  });

  it('un override válido se devuelve tal cual, aunque sea más estrecho que el nivel', () => {
    for (const level of RIGOR_LEVELS.map((l) => l.level)) {
      expect(effectiveGates(level, ['C3'])).toEqual(['C3']);
    }
    expect(effectiveGates('spec-as-source', ['C1'])).toEqual(['C1']);
  });

  it('un array vacío cae de vuelta a la lista del nivel (así lo documenta el módulo)', () => {
    for (const level of RIGOR_LEVELS.map((l) => l.level)) {
      expect(effectiveGates(level, [])).toEqual(EXACT_GATES[level]);
    }
  });

  it('devuelve una copia: mutar el resultado no muta la tabla declarada', () => {
    const gates = effectiveGates('spec-first');
    gates.push('C9');
    expect(RIGOR_LEVELS.find((l) => l.level === 'spec-first')!.gatesActive).toEqual(['C1', 'C2']);
  });

  it('rechaza un nivel desconocido en vez de adivinar', () => {
    expect(() => effectiveGates('strict' as never)).toThrow(/desconocido/i);
  });
});

// ---------------------------------------------------------------------------------------------
// 5. validateGateOverride: un typo no puede reducir la vigilancia en silencio
// ---------------------------------------------------------------------------------------------

describe('core/rigor — validateGateOverride', () => {
  it('undefined pasa a undefined: sin override no hay nada que validar', () => {
    expect(validateGateOverride(undefined)).toBeUndefined();
  });

  it('una lista válida devuelve una copia, no el array del llamante', () => {
    const input = ['C1', 'C2'];
    const result = validateGateOverride(input);
    expect(result).toEqual(['C1', 'C2']);
    result!.push('C3');
    expect(input).toEqual(['C1', 'C2']);
    expect(result).not.toBe(input);
  });

  it('un id desconocido se rechaza nombrando el id', () => {
    expect(() => validateGateOverride(['C9'])).toThrow(/C9/);
    expect(() => validateGateOverride(['C1', 'NOPE'])).toThrow(/NOPE/);
  });

  it('un valor que no es lista se rechaza', () => {
    expect(() => validateGateOverride('C1')).toThrow(/lista de identificadores/);
    expect(() => validateGateOverride({ 0: 'C1' })).toThrow(/lista de identificadores/);
  });

  it('una lista con elementos que no son strings se rechaza', () => {
    expect(() => validateGateOverride([1, 2])).toThrow(/lista de identificadores/);
    expect(() => validateGateOverride(['C1', null])).toThrow(/lista de identificadores/);
  });

  it('una lista vacía es válida a este nivel y cae al nivel en effectiveGates', () => {
    expect(validateGateOverride([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 6. El CLI: compacto por defecto, verboso a petición, fluido en el commit
// ---------------------------------------------------------------------------------------------

describe('cli — govern rigor', () => {
  const originalFeature = process.env.SDD_FEATURE;

  beforeEach(() => {
    // `firstSpec` encuentra la feature del fixture; fijarla evita que el entorno decida por nosotros.
    process.env.SDD_FEATURE = 'alpha';
  });

  afterEach(() => {
    if (originalFeature === undefined) delete process.env.SDD_FEATURE;
    else process.env.SDD_FEATURE = originalFeature;
  });

  it('por defecto es compacto: nivel + gates + exigencias, sin la tabla de niveles', async () => {
    const root = await makeCliFixture(validConstitution());
    const run = await runGovern(root, ['rigor']);

    expect(run.out).toMatch(/gates activos: C1, C2/);
    expect(run.out).toMatch(/exige: constitution, triad/);
    // La tabla de niveles (definición + evaluador) solo aparece con --verbose.
    expect(run.out).not.toContain('Spec-Anchored');
    expect(run.out).not.toContain('Spec-as-Source');
    expect(run.out).not.toContain('evaluador:');
    expect(run.code).toBe(0);
  });

  it('--verbose restaura la tabla completa con Spec-First y Spec-Anchored', async () => {
    const root = await makeCliFixture(validConstitution());
    const run = await runGovern(root, ['rigor', '--verbose']);

    expect(run.out).toContain('Spec-First');
    expect(run.out).toContain('Spec-Anchored');
    expect(run.out).toContain('Spec-as-Source');
    expect(run.out).toContain('evaluador:');
    expect(run.code).toBe(0);
  });

  it('--gates imprime la escalera y sale 0', async () => {
    const root = await makeCliFixture(validConstitution());
    const run = await runGovern(root, ['rigor', '--gates']);

    expect(run.out).toContain('La escalera');
    expect(run.out).toMatch(/spec-first\s+C1, C2/);
    expect(run.out).toMatch(/spec-anchored\s+C1, C2, C3, C6/);
    expect(run.out).toContain('C2 (secretos y comandos destructivos)');
    expect(run.code).toBe(0);
  });

  it('--quiet imprime exactamente una línea y deja el veredicto en el código de salida', async () => {
    const root = await makeCliFixture(validConstitution());
    const run = await runGovern(root, ['rigor', '--quiet']);

    expect(run.logLines.length + run.errorLines.length).toBe(1);
    expect(run.out).toMatch(/rigor spec-first: OK/);
    expect(run.code).toBe(0);
  });

  it('con una constitución INVÁLIDA las órdenes que evalúan salen 1', async () => {
    const root = await makeCliFixture(invalidConstitution());

    for (const args of [['rigor'], ['rigor', '--verbose'], ['rigor', '--quiet']]) {
      const run = await runGovern(root, args);
      expect(run.code, `${args.join(' ')} debe bloquear`).toBe(1);
    }

    const compact = await runGovern(root, ['rigor']);
    expect(compact.out).toMatch(/bloqueante/);
    expect(compact.out).toMatch(/Constitución inválida/);

    const quiet = await runGovern(root, ['rigor', '--quiet']);
    expect(quiet.logLines.length + quiet.errorLines.length).toBe(1);
    expect(quiet.out).toMatch(/bloqueante/);
  });

  it('--gates NO evalúa el repositorio: imprime la escalera y sale 0 aunque la constitución sea inválida', async () => {
    // Divergencia declarada, no corregida: `--gates` es un informe estático de la escalera y
    // regresa antes de `assessRigor`, así que no puede bloquear. Es la única orden de `govern
    // rigor` que no sale 1 con una constitución inválida.
    const root = await makeCliFixture(invalidConstitution());
    const run = await runGovern(root, ['rigor', '--gates']);

    expect(run.out).toContain('La escalera');
    expect(run.code).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 7. El hook de commit usa la escalera en modo fluido
// ---------------------------------------------------------------------------------------------

describe('templates/hooks/pre-commit — el commit no se lee como una auditoría', () => {
  it('invoca govern rigor con --quiet y --no-drift', async () => {
    const hookSource = await readFile(
      path.join(repoRoot, 'tools', 'open-sdd', 'templates', 'hooks', 'pre-commit'),
      'utf8',
    );

    const invocations = hookSource
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('node "$CLI" govern rigor'));

    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toContain('--quiet');
    expect(invocations[0]).toContain('--no-drift');
    // La línea exacta: un flag añadido o perdido aquí cambia lo que un commit comprueba.
    expect(invocations[0]).toBe('node "$CLI" govern rigor --no-drift --quiet');
  });
});
