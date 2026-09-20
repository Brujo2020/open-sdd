import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  DEFAULT_RIGOR_LEVEL,
  RIGOR_ASPECTS,
  RIGOR_LEVELS,
  RIGOR_REQUIREMENTS,
  RIGOR_SETTINGS_FILE,
  assessRigor,
  constitutionRequired,
  isRigorLevel,
  loadRigorSettings,
  resolveRigorSettings,
  rigorRequires,
  rigorRequirements,
  selectRigorLevel,
  toSddRigorLevel,
} from '../src/core/rigor.js';
import { renderConstitution, type Constitution } from '../src/core/constitution.js';
import { DEFAULT_SIGNALS, getExecutableGate, resolveGateChain } from '../src/core/gateCatalog.js';
import { selectRigorMode } from '../src/core/hitl.js';

// ---------------------------------------------------------------------------------------------
// Temp dirs (cleaned in afterEach)
// ---------------------------------------------------------------------------------------------

const tempDirs: string[] = [];

const makeRoot = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-rigor-'));
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
// Fixtures
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

const writeTriad = async (
  root: string,
  feature: string,
  tasks: string = TASKS_MD,
  plan: string = PLAN_WITH_CONTRACTS_MD,
): Promise<string> => {
  const specDir = path.join(root, '.sdd', 'specs', feature);
  await mkdir(specDir, { recursive: true });
  await writeFile(path.join(specDir, 'requirements.md'), REQUIREMENTS_MD, 'utf8');
  await writeFile(path.join(specDir, 'plan.md'), plan, 'utf8');
  await writeFile(path.join(specDir, 'tasks.md'), tasks, 'utf8');
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

/** Normative MUST without an amendment: validateConstitution rejects it (an error). */
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

const DELTA_MD = `# Delta: alpha — Endurecer autenticación

Status: approved
Base: 1.0.0

## ADDED

### REQ-AUTH-001 — Bloqueo por intentos fallidos
- Statement: WHEN five login attempts fail, the Gateway shall lock the account for fifteen minutes.
- Targets: src/auth/login.ts, src/auth/lock.ts
- Contracts: auth.login.lockout
- Strangler: new

## MODIFIED

### REQ-AUTH-002 — Expiración de sesión
- Statement: WHILE a session is idle, the Gateway shall expire the token after fifteen minutes.
- Previous: The session expired after sixty minutes.
- Targets: src/auth/session.ts
- Contracts: auth.session.ttl
- Strangler: both

## REMOVED

### REQ-AUTH-003 — Token en query string
- Statement: IF a request carries a token in the query string, THEN the Gateway shall reject it.
- Previous: The Gateway accepted tokens in the query string.
- Targets: src/auth/token.ts
- Contracts: auth.token.transport
- Rationale: Los tokens en la query acaban en logs y en cabeceras Referer.
- Strangler: legacy

## RENAMED
`;

const DELTA_TASKS_MD = `# Tasks

- [ ] 1. Bloquear la cuenta _Requirements: REQ-AUTH-001_ _Boundary:_ \`src/auth/login.ts\`
- [ ] 2. Acortar el TTL _Requirements: REQ-AUTH-002_ _Boundary:_ \`src/auth/session.ts\`
- [ ] 3. Retirar el token en query _Requirements: REQ-AUTH-003_ _Boundary:_ \`src/auth/token.ts\`
`;

const writeDelta = async (root: string, feature: string, markdown: string = DELTA_MD): Promise<string> => {
  const specDir = path.join(root, '.sdd', 'specs', feature);
  await mkdir(specDir, { recursive: true });
  const file = path.join(specDir, 'delta.md');
  await writeFile(file, markdown, 'utf8');
  return file;
};

// ---------------------------------------------------------------------------------------------
// The three levels differ in substance
// ---------------------------------------------------------------------------------------------

describe('core/rigor — los tres niveles (§2.4)', () => {
  it('declara exactamente los tres niveles del manual, en orden', () => {
    expect(RIGOR_LEVELS.map((l) => l.level)).toEqual(['spec-first', 'spec-anchored', 'spec-as-source']);
    expect(isRigorLevel('spec-anchored')).toBe(true);
    expect(isRigorLevel('strict')).toBe(false);
    expect(isRigorLevel(undefined)).toBe(false);
  });

  it('cada nivel exige cada aspecto y los tres conjuntos son distintos entre sí', () => {
    for (const level of RIGOR_LEVELS) {
      expect(Object.keys(level.requires).sort()).toEqual([...RIGOR_ASPECTS].sort());
      expect(Object.keys(level.requires).length).toBeGreaterThan(0);
    }

    const asJson = RIGOR_LEVELS.map((l) => JSON.stringify(l.requires));
    expect(new Set(asJson).size).toBe(3);
  });

  it('spec-first es el suelo: exige requisitos y constitución, y no exige evidencia, drift ni regeneración', () => {
    // Policy change, deliberate: the ladder is cumulative and the default level is the floor. The
    // constitution stopped being "recommended" at spec-first because a blocking verdict must cite an
    // authority at EVERY level; what distinguishes the levels is everything above (evidence binding,
    // drift, contracts, regeneration), not whether authority exists.
    const first = RIGOR_LEVELS.find((l) => l.level === 'spec-first')!;
    expect(first.requires.constitution).toBe('required');
    expect(first.requires.triad).toBe('required');
    expect(first.requires.evidence).toBe('not-required');
    expect(first.requires.drift).toBe('not-required');
    expect(first.requires.regeneration).toBe('not-required');
    expect(first.missingArtifactPolicy).toBe('blocking');
    // The default is fluid by running FEWER checks, not by running unenforced ones.
    expect(first.gatesActive).toEqual(['C1', 'C2']);
  });

  it('spec-anchored exige trazabilidad, evidencia y drift, pero no regeneración', () => {
    const anchored = RIGOR_LEVELS.find((l) => l.level === 'spec-anchored')!;
    expect(anchored.requires.traceability).toBe('required');
    expect(anchored.requires.evidence).toBe('required');
    expect(anchored.requires.drift).toBe('required');
    expect(anchored.requires.regeneration).toBe('not-required');
    expect(anchored.missingArtifactPolicy).toBe('blocking');
  });

  it('spec-as-source añade contratos y regeneración como reparación', () => {
    const source = RIGOR_LEVELS.find((l) => l.level === 'spec-as-source')!;
    expect(source.requires.contracts).toBe('required');
    expect(source.requires.regeneration).toBe('required');
    expect(source.missingArtifactPolicy).toBe('blocking');
  });

  it('la tabla de filas por aspecto cubre los mismos aspectos que requires', () => {
    for (const level of RIGOR_LEVELS) {
      const rows = rigorRequirements(level.level);
      expect(rows.map((r) => r.aspect).sort()).toEqual(Object.keys(level.requires).sort());
      expect(RIGOR_REQUIREMENTS[level.level]).toHaveLength(rows.length);
      // La copia no puede mutar la tabla declarada.
      rows[0].demand = 'required';
      expect(rigorRequirements(level.level)[0].demand).toBe(RIGOR_REQUIREMENTS[level.level][0].demand);
    }
  });

  it('gatesActive cita ids de la cadena existente y nunca el control vacuo C7', () => {
    for (const level of RIGOR_LEVELS) {
      expect(level.gatesActive.length).toBeGreaterThan(0);
      for (const id of level.gatesActive) {
        expect(getExecutableGate(id), `${id} debe existir en gateCatalog`).toBeDefined();
        expect(id).not.toBe('C7');
      }
    }
  });

  it('no toca la cadena del paper: sigue resolviendo 7 / 9 / 12 controles', () => {
    expect(resolveGateChain('solo', DEFAULT_SIGNALS).declared).toHaveLength(7);
    expect(resolveGateChain('team', DEFAULT_SIGNALS).declared).toHaveLength(9);
    expect(resolveGateChain('regulated', DEFAULT_SIGNALS).declared).toHaveLength(12);
  });

  it('rigorRequires degrada la delta solo en greenfield (la tríada la sustituye)', () => {
    expect(rigorRequires('spec-anchored', true).delta).toBe('required');
    expect(rigorRequires('spec-anchored', false).delta).toBe('not-required');
    expect(rigorRequires('spec-as-source', true).delta).toBe('required');
    expect(rigorRequires('spec-as-source', false).delta).toBe('not-required');
    expect(rigorRequires('spec-first', true).delta).toBe('not-required');
  });
});

// ---------------------------------------------------------------------------------------------
// La Constitución es obligatoria desde spec-anchored
// ---------------------------------------------------------------------------------------------

describe('core/rigor — constitutionRequired', () => {
  it('es blocking también en spec-first: la constitución es el suelo, no un extra del nivel', () => {
    for (const brownfield of [false, true]) {
      const verdict = constitutionRequired('spec-first', brownfield);
      expect(verdict.required).toBe(true);
      expect(verdict.severity).toBe('blocking');
      expect(verdict.reason.length).toBeGreaterThan(0);
    }
  });

  it('es blocking exactamente en spec-anchored y spec-as-source', () => {
    for (const level of ['spec-anchored', 'spec-as-source'] as const) {
      for (const brownfield of [false, true]) {
        const verdict = constitutionRequired(level, brownfield);
        expect(verdict.required).toBe(true);
        expect(verdict.severity).toBe('blocking');
        expect(verdict.reason).toMatch(/autoridad/i);
      }
    }
  });

  it('en brownfield nombra la constitución descriptiva del legado', () => {
    expect(constitutionRequired('spec-anchored', true).reason).toMatch(/DESCRIPTIVA/);
  });

  it('rechaza un nivel desconocido en vez de adivinar', () => {
    expect(() => constitutionRequired('strict' as never, false)).toThrow(/desconocido/i);
  });
});

// ---------------------------------------------------------------------------------------------
// Selección: tabla de decisión §8.2 + flujo §4.8
// ---------------------------------------------------------------------------------------------

describe('core/rigor — selectRigorLevel', () => {
  const cases: Array<[string, Parameters<typeof selectRigorLevel>[0], string]> = [
    ['alcance desconocido → el más ligero', { scopeKnown: false }, 'spec-first'],
    ['prototipo con alcance y lectura barata → spec-first', { misreadingIsCheap: true, reversible: false }, 'spec-first'],
    ['bug trivial por complejidad → spec-first', { complexity: 0.1, reversible: true }, 'spec-first'],
    ['reversible y no auditado → spec-anchored', { reversible: true }, 'spec-anchored'],
    ['reversible pero auditado → spec-as-source', { reversible: true, audited: true }, 'spec-as-source'],
    ['difícil de revertir → spec-as-source', { reversible: false }, 'spec-as-source'],
    ['API crítica de pagos → spec-as-source', { highConsequence: true, reversible: true }, 'spec-as-source'],
    ['migración de legacy sin otras señales → spec-anchored', { brownfield: true }, 'spec-anchored'],
    ['reversibilidad desconocida → conservador spec-as-source', {}, 'spec-as-source'],
  ];

  for (const [name, input, expected] of cases) {
    it(name, () => {
      const decision = selectRigorLevel(input);
      expect(decision.level).toBe(expected);
      expect(decision.reason.trim().length).toBeGreaterThan(0);
    });
  }

  it('la consecuencia alta domina a las señales de bajo coste', () => {
    expect(selectRigorLevel({ highConsequence: true, complexity: 0.05, misreadingIsCheap: true }).level).toBe(
      'spec-as-source',
    );
  });

  it('es coherente con hitl.selectRigorMode en todos los inputs que ambas escalas pueden expresar', () => {
    const shared: Array<Parameters<typeof selectRigorLevel>[0]> = [
      { scopeKnown: false },
      { misreadingIsCheap: true },
      { reversible: true },
      { reversible: true, audited: true },
      { reversible: false },
      { complexity: 0.1 },
      { complexity: 0.8, reversible: true },
      {},
    ];
    for (const input of shared) {
      const hitl = selectRigorMode(input);
      expect(toSddRigorLevel(hitl.mode)).toBe(selectRigorLevel(input).level);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------------------------

describe('core/rigor — resolveRigorSettings', () => {
  it('sin configuración devuelve el nivel por defecto con rationale no vacío', () => {
    const settings = resolveRigorSettings(undefined);
    expect(settings.level).toBe(DEFAULT_RIGOR_LEVEL);
    expect(settings.level).toBe('spec-first');
    expect(settings.brownfield).toBe(false);
    expect(settings.rationale.trim().length).toBeGreaterThan(0);
    expect(settings.updated_at).toBeUndefined();
  });

  it('el nivel explícito gana al fallback', () => {
    expect(resolveRigorSettings({ level: 'spec-anchored' }, 'spec-as-source').level).toBe('spec-anchored');
  });

  it('sin nivel explícito usa el fallback y lo declara en el rationale', () => {
    const settings = resolveRigorSettings({ brownfield: true }, 'spec-as-source');
    expect(settings.level).toBe('spec-as-source');
    expect(settings.brownfield).toBe(true);
    expect(settings.rationale).toMatch(/fallback/i);
  });

  it('rechaza un nivel inválido en vez de degradarlo', () => {
    expect(() => resolveRigorSettings({ level: 'strict' as never })).toThrow(/inválido/i);
    expect(() => resolveRigorSettings({}, 'strict' as never)).toThrow(/reserva inválido/i);
  });

  it('rechaza un rationale presente pero vacío', () => {
    expect(() => resolveRigorSettings({ level: 'spec-anchored', rationale: '   ' })).toThrow(/rationale/i);
  });

  it('conserva el rationale declarado y el updated_at', () => {
    const settings = resolveRigorSettings({
      level: 'spec-as-source',
      rationale: 'Pagos: la spec es la fuente y la regeneración repara.',
      brownfield: true,
      updated_at: '2026-01-02T03:04:05.000Z',
    });
    expect(settings.rationale).toMatch(/Pagos/);
    expect(settings.updated_at).toBe('2026-01-02T03:04:05.000Z');
  });

  it('declara la ruta por defecto del archivo de configuración', () => {
    expect(RIGOR_SETTINGS_FILE).toBe('.sdd/settings/rigor.json');
  });
});

describe('core/rigor — loadRigorSettings', () => {
  it('sin archivo devuelve los defaults, sin excepción', async () => {
    const root = await makeRoot();
    const settings = await loadRigorSettings(root);
    expect(settings.level).toBe(DEFAULT_RIGOR_LEVEL);
    expect(settings.rationale.trim().length).toBeGreaterThan(0);
  });

  it('lee un archivo declarado', async () => {
    const root = await makeRoot();
    const settingsDir = path.join(root, '.sdd', 'settings');
    await mkdir(settingsDir, { recursive: true });
    await writeFile(
      path.join(settingsDir, 'rigor.json'),
      JSON.stringify({ level: 'spec-anchored', rationale: 'Equipo compartido.', brownfield: true }),
      'utf8',
    );
    const settings = await loadRigorSettings(root);
    expect(settings.level).toBe('spec-anchored');
    expect(settings.brownfield).toBe(true);
  });

  it('un JSON malformado falla en voz alta y no baja la exigencia en silencio', async () => {
    const root = await makeRoot();
    const settingsDir = path.join(root, '.sdd', 'settings');
    await mkdir(settingsDir, { recursive: true });
    await writeFile(path.join(settingsDir, 'rigor.json'), '{ no soy json', 'utf8');
    await expect(loadRigorSettings(root)).rejects.toThrow(/JSON válido/i);
  });
});

// ---------------------------------------------------------------------------------------------
// assessRigor contra el sistema de archivos
// ---------------------------------------------------------------------------------------------

describe('core/rigor — assessRigor', () => {
  it('(a) la constitución ausente bloquea en los tres niveles, porque es el suelo de la escalera', async () => {
    const root = await makeRoot();
    await writeTriad(root, 'alpha');

    // Every level, the default included: the constitution is the floor of the ladder, so its absence
    // is blocking everywhere and the levels above only add other demands.
    for (const level of ['spec-first', 'spec-anchored', 'spec-as-source'] as const) {
      const assessment = await assessRigor(root, { level, brownfield: false, feature: 'alpha' });
      const blocking = assessment.findings.filter((f) => f.aspect === 'constitution' && f.severity === 'error');
      expect(blocking.length, `${level}: la constitución ausente debe bloquear`).toBeGreaterThan(0);
      expect(blocking[0].message).toMatch(/autoridad|Constitución ausente/i);
      expect(assessment.satisfied).toBe(false);
    }
  });

  it('spec-first no inventa hallazgos de drift (el nivel no los exige)', async () => {
    const root = await makeRoot();
    await writeTriad(root, 'alpha');
    const assessment = await assessRigor(root, { level: 'spec-first', brownfield: false, feature: 'alpha' });
    expect(assessment.findings.some((f) => f.aspect === 'drift')).toBe(false);
  });

  it('(b) con una constitución válida presente, spec-anchored queda satisfecho', async () => {
    const root = await makeRoot();
    await writeTriad(root, 'alpha');
    await writeConstitution(root, validConstitution());

    const assessment = await assessRigor(root, { level: 'spec-anchored', brownfield: false, feature: 'alpha' });
    expect(assessment.findings.filter((f) => f.aspect === 'constitution' && f.severity === 'error')).toHaveLength(0);
    expect(assessment.satisfied).toBe(true);
    expect(assessment.detail).toMatch(/satisfecho/i);
  });

  it('una constitución inválida bloquea en los tres niveles', async () => {
    const root = await makeRoot();
    await writeTriad(root, 'alpha');
    await writeConstitution(root, invalidConstitution());

    // An invalid constitution is a blocking finding at every level: the default demands a
    // constitution that can actually be cited, not merely a file with that name.
    for (const level of ['spec-first', 'spec-anchored', 'spec-as-source'] as const) {
      const assessment = await assessRigor(root, { level, brownfield: false, feature: 'alpha' });
      expect(
        assessment.findings.some((f) => f.aspect === 'constitution' && f.severity === 'error'),
        `${level}: una constitución inválida debe bloquear`,
      ).toBe(true);
      expect(assessment.satisfied).toBe(false);
    }
  });

  it('(c) brownfield sin delta bloquea en spec-anchored', async () => {
    const root = await makeRoot();
    await writeTriad(root, 'alpha');
    await writeConstitution(root, validConstitution());

    const assessment = await assessRigor(root, { level: 'spec-anchored', brownfield: true, feature: 'alpha' });
    const deltaErrors = assessment.findings.filter((f) => f.aspect === 'delta' && f.severity === 'error');
    expect(deltaErrors).toHaveLength(1);
    expect(deltaErrors[0].artifact).toMatch(/delta\.md$/);
    expect(deltaErrors[0].message).toMatch(/brownfield sin delta/i);
    expect(assessment.satisfied).toBe(false);
  });

  it('(d) brownfield con delta válida y tareas trazadas queda satisfecho', async () => {
    const root = await makeRoot();
    await writeTriad(root, 'alpha', DELTA_TASKS_MD);
    await writeDelta(root, 'alpha');
    await writeConstitution(root, validConstitution());

    const assessment = await assessRigor(root, { level: 'spec-anchored', brownfield: true, feature: 'alpha' });
    const errors = assessment.findings.filter((f) => f.severity === 'error');
    expect(errors, JSON.stringify(errors, null, 2)).toHaveLength(0);
    expect(assessment.satisfied).toBe(true);
    expect(assessment.findings.some((f) => f.aspect === 'delta' && f.severity === 'info')).toBe(true);
    expect(
      assessment.findings.some((f) => f.aspect === 'traceability' && /3\/3/.test(f.message)),
    ).toBe(true);
  });

  it('(d2) brownfield con delta pero tareas que no citan los REQ-ID bloquea la trazabilidad', async () => {
    const root = await makeRoot();
    await writeTriad(root, 'alpha', '# Tasks\n\n- [ ] 1. Tarea sin requisito _Boundary:_ `src/x.ts`\n');
    await writeDelta(root, 'alpha');
    await writeConstitution(root, validConstitution());

    const assessment = await assessRigor(root, { level: 'spec-anchored', brownfield: true, feature: 'alpha' });
    const traceErrors = assessment.findings.filter((f) => f.aspect === 'traceability' && f.severity === 'error');
    expect(traceErrors.length).toBeGreaterThan(0);
    expect(traceErrors[0].message).toMatch(/sin tarea/i);
    expect(assessment.satisfied).toBe(false);
  });

  it('greenfield sin delta no bloquea por delta: la tríada la sustituye', async () => {
    const root = await makeRoot();
    await writeTriad(root, 'alpha');
    await writeConstitution(root, validConstitution());

    const assessment = await assessRigor(root, { level: 'spec-anchored', brownfield: false, feature: 'alpha' });
    expect(assessment.findings.some((f) => f.aspect === 'delta' && f.severity === 'error')).toBe(false);
    expect(assessment.satisfied).toBe(true);
  });

  it('una tarea completada sin evidencia bloquea en spec-anchored (I2)', async () => {
    const root = await makeRoot();
    await writeTriad(
      root,
      'alpha',
      '# Tasks\n\n- [x] 1. Implementar el endpoint _Requirements: REQ-1_ _Boundary:_ `src/health.ts`\n',
    );
    await writeConstitution(root, validConstitution());

    const assessment = await assessRigor(root, { level: 'spec-anchored', brownfield: false, feature: 'alpha' });
    const evidenceErrors = assessment.findings.filter((f) => f.aspect === 'evidence' && f.severity === 'error');
    expect(evidenceErrors).toHaveLength(1);
    expect(evidenceErrors[0].message).toMatch(/evidencia|Evidence/i);
    expect(assessment.satisfied).toBe(false);
  });

  it('un artefacto que existe pero no se puede leer se reporta como no evaluado, nunca como aprobado', async () => {
    const root = await makeRoot();
    await writeTriad(root, 'alpha');
    // Un directorio en la ruta de la constitución: existe, pero readFile falla.
    await mkdir(path.join(root, '.sdd', 'steering', 'constitution.md'), { recursive: true });

    const assessment = await assessRigor(root, { level: 'spec-anchored', brownfield: false, feature: 'alpha' });
    const finding = assessment.findings.find((f) => f.aspect === 'constitution' && /no se pudo leer/i.test(f.message));
    expect(finding).toBeDefined();
    expect(['info', 'warning']).toContain(finding!.severity);
  });

  it('sin feature informa de que no puede evaluar, en vez de dar por bueno', async () => {
    const root = await makeRoot();
    await writeConstitution(root, validConstitution());

    const assessment = await assessRigor(root, { level: 'spec-anchored', brownfield: false });
    const triad = assessment.findings.find((f) => f.aspect === 'triad');
    expect(triad).toBeDefined();
    expect(triad!.message).toMatch(/--feature|no evaluad/i);
  });

  it('spec-as-source declara la regeneración como brecha, no como aprobado', async () => {
    const root = await makeRoot();
    await writeTriad(root, 'alpha');
    await writeConstitution(root, validConstitution());

    const assessment = await assessRigor(root, { level: 'spec-as-source', brownfield: false, feature: 'alpha' });
    const regeneration = assessment.findings.find((f) => f.aspect === 'regeneration');
    expect(regeneration).toBeDefined();
    expect(regeneration!.severity).toBe('info');
    expect(regeneration!.message).toMatch(/brecha declarada/i);
    // El plan declara contratos en el fixture: no debe haber error de contratos.
    expect(assessment.findings.some((f) => f.aspect === 'contracts' && f.severity === 'error')).toBe(false);
  });

  it('rechaza un nivel desconocido en vez de evaluar a ciegas', async () => {
    const root = await makeRoot();
    await expect(assessRigor(root, { level: 'strict' as never, brownfield: false })).rejects.toThrow(
      /desconocido/i,
    );
  });
});
