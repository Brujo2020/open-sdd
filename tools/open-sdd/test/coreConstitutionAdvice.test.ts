/**
 * Pruebas del asesor de constitución (REQ-MAT-017) sobre fixtures `mkdtemp`.
 *
 * Lo que se fija aquí es que cada señal se deriva de evidencia LEÍDA y que nada se declara
 * comprobado sin serlo: una ruta caducada se detecta leyendo el disco, una evidencia que no es
 * ruta queda en `notChecked` (no como caducada), una enmienda sin fecha almacenada no inventa una
 * edad, y `complete` es exactamente `notChecked.length === 0`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  adviseConstitution,
  renderAdvice,
  DEFAULT_AMENDMENT_THRESHOLD_DAYS,
  type Advice,
  type AdviceKind,
} from '../src/core/constitutionAdvice.js';
import {
  renderConstitution,
  type AmendmentRecord,
  type Constitution,
  type ConstitutionPrinciple,
} from '../src/core/constitution.js';

const NOW = new Date('2026-10-01T00:00:00.000Z');
const day = 24 * 60 * 60 * 1000;
const daysAgoIso = (days: number): string => new Date(NOW.getTime() - days * day).toISOString();
const daysAheadIso = (days: number): string => new Date(NOW.getTime() + days * day).toISOString();

const LONG =
  'El texto explica el vector de ataque que el principio previene y permite juzgar sus casos límite sin ambigüedad.';

const temps: string[] = [];
const makeTemp = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const principle = (overrides: Partial<ConstitutionPrinciple> = {}): ConstitutionPrinciple => ({
  id: 'SEC-001',
  title: 'Principio de prueba',
  threatReference: 'amenaza de prueba',
  level: 'MUST',
  restriction: 'La restricción del principio de prueba.',
  pattern: 'El patrón que satisface la restricción.',
  justification: LONG,
  provenance: 'descriptive',
  evidence: ['package.json'],
  ...overrides,
});

const constitution = (principles: ConstitutionPrinciple[], amendments: AmendmentRecord[] = []): Constitution => ({
  project: 'fixture',
  provenance: 'descriptive',
  establishedFacts: [],
  principles,
  amendments,
});

const writeConstitution = async (dir: string, value: Constitution): Promise<void> => {
  await mkdir(path.join(dir, '.sdd', 'steering'), { recursive: true });
  await writeFile(path.join(dir, '.sdd', 'steering', 'constitution.md'), renderConstitution(value), 'utf8');
};

const writeJson = async (dir: string, rel: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await writeFile(path.join(dir, rel), JSON.stringify(value, null, 2), 'utf8');
};

const packageJson = async (dir: string): Promise<void> => {
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2),
    'utf8',
  );
};

const kindsOf = (advice: Advice[]): AdviceKind[] => advice.map((a) => a.kind);
const ofKind = (advice: Advice[], kind: AdviceKind): Advice[] => advice.filter((a) => a.kind === kind);

describe('core/constitutionAdvice — evidencia', () => {
  it('marca como caducada solo la evidencia con forma de ruta que no existe, y la no-ruta como no verificable', async () => {
    const dir = await makeTemp('open-sdd-advice-evidence-');
    await packageJson(dir);
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(path.join(dir, 'src', 'index.ts'), 'export const api = true;\n', 'utf8');
    await writeConstitution(
      dir,
      constitution([
        // Ambas pruebas están en el mismo principio; una resuelve y la otra no.
        principle({ id: 'C-API-COMPAT', evidence: ['src/index.ts', 'src/gone.ts'] }),
        // Una referencia que no es una ruta: hecho declarado, no artefacto. NO es caducidad.
        principle({ id: 'C-STACK-FACT', title: 'Stack', evidence: ['package manager: npm'] }),
      ]),
    );

    const report = await adviseConstitution(dir, { now: NOW });
    const expired = ofKind(report.advice, 'evidence-expired');

    expect(expired).toHaveLength(1);
    expect(expired[0].principleId).toBe('C-API-COMPAT');
    expect(expired[0].evidence.some((e) => e.includes('src/gone.ts'))).toBe(true);
    // La referencia que sí resuelve no se reporta.
    expect(expired[0].evidence.some((e) => e.includes('src/index.ts'))).toBe(false);
    // El principio cuya evidencia es un hecho no aparece como caducado.
    expect(expired.some((a) => a.principleId === 'C-STACK-FACT')).toBe(false);
    // Y sí aparece explícitamente como no comprobado.
    expect(report.notChecked.some((n) => /evidencia no verificable/i.test(n) && n.includes('C-STACK-FACT'))).toBe(true);
    expect(report.checked.some((c) => /con forma de ruta comprobada/i.test(c))).toBe(true);
  });

  it('cada consejo lleva un ejemplo con la anatomía de seis campos lista para pegar', async () => {
    const dir = await makeTemp('open-sdd-advice-example-');
    await packageJson(dir);
    await writeConstitution(dir, constitution([principle({ id: 'C-API-COMPAT', evidence: ['src/absent.ts'] })]));

    const report = await adviseConstitution(dir, { now: NOW });
    const advice = report.advice.find((a) => a.kind === 'evidence-expired');
    expect(advice).toBeDefined();
    const example = advice!.example;
    // Identificador en el encabezado, y los seis campos en el cuerpo.
    expect(example).toMatch(/^### ADV-EVIDENCE-C-API-COMPAT — /m);
    expect(example).toMatch(/- Level: (MUST|SHOULD|MAY)/);
    expect(example).toMatch(/- (CWE|Threat): /);
    expect(example).toMatch(/- Restriction: /);
    expect(example).toMatch(/- Pattern: /);
    expect(example).toMatch(/- Justification: /);
    // El comando de aplicación existe y apunta a la constitución descriptiva.
    expect(advice!.apply).toContain('brownfield constitution');
  });
});

describe('core/constitutionAdvice — práctica no declarada', () => {
  it('detecta desde los ficheros reales que todos los módulos tienen test, y que una dependencia está en todos los manifiestos', async () => {
    const dir = await makeTemp('open-sdd-advice-practice-');
    await mkdir(path.join(dir, 'src', 'alpha'), { recursive: true });
    await mkdir(path.join(dir, 'src', 'beta'), { recursive: true });
    await mkdir(path.join(dir, 'test'), { recursive: true });
    await writeFile(path.join(dir, 'src', 'alpha', 'a.ts'), 'export const a = 1;\n', 'utf8');
    await writeFile(path.join(dir, 'src', 'beta', 'b.ts'), 'export const b = 1;\n', 'utf8');
    await writeFile(path.join(dir, 'test', 'alpha.test.ts'), 'export const t = 1;\n', 'utf8');
    await writeFile(path.join(dir, 'test', 'beta.test.ts'), 'export const t = 1;\n', 'utf8');
    // Dos manifiestos con una dependencia común: la práctica también se mide.
    await writeJson(dir, 'package.json', { name: 'fixture', version: '1.0.0', devDependencies: { typescript: '^5' } });
    await writeJson(dir, 'tools/open-sdd/package.json', { name: 'fixture-cli', version: '1.0.0', devDependencies: { typescript: '^5' } });
    await writeConstitution(
      dir,
      constitution([
        principle({
          id: 'SEC-001',
          title: 'Consulta parametrizada',
          // Sin la palabra "prueba"/"test" en el texto: si un principio ya enunciara el tema,
          // la práctica no sería "no declarada" y el asesor no debería reportarla.
          threatReference: 'inyección SQL',
          restriction: 'Toda consulta usa parámetros vinculados.',
          pattern: 'Usar el constructor de consultas con parámetros.',
          evidence: ['src/alpha/a.ts'],
        }),
      ]),
    );

    const report = await adviseConstitution(dir, { now: NOW });
    const practices = ofKind(report.advice, 'practice-unstated');

    const perModule = practices.find((a) => a.title.includes('módulos con código tienen test'));
    expect(perModule).toBeDefined();
    // Dice CÓMO se detectó: el ratio observado y la lista de módulos.
    expect(perModule!.why).toMatch(/2\/2/);
    expect(perModule!.evidence.some((e) => e.includes('alpha') && e.includes('beta'))).toBe(true);

    const dep = practices.find((a) => a.title.includes('typescript'));
    expect(dep).toBeDefined();
    expect(dep!.why).toMatch(/2\/2/);
    expect(dep!.evidence.some((e) => e.includes('tools/open-sdd/package.json'))).toBe(true);
  });
});

describe('core/constitutionAdvice — enmiendas envejecidas', () => {
  it('reporta una enmienda sin decisión más vieja que el umbral y deja sin edad a la que no guarda fecha', async () => {
    const dir = await makeTemp('open-sdd-advice-amendment-');
    await packageJson(dir);
    const old: AmendmentRecord = {
      id: 'AMD-OLD',
      title: 'Adoptar consultas parametrizadas',
      proposedBy: 'security-lead',
      status: 'proposed',
      updatedAt: daysAgoIso(60),
    };
    const undated: AmendmentRecord = {
      id: 'AMD-NODATE',
      title: 'Política sin fecha registrada',
      proposedBy: 'security-lead',
      status: 'proposed',
    };
    await writeConstitution(
      dir,
      constitution([principle({ evidence: ['package.json'] })], [old, undated]),
    );

    const report = await adviseConstitution(dir, { now: NOW });
    const aged = ofKind(report.advice, 'amendment-aged');

    expect(aged).toHaveLength(1);
    expect(aged[0].principleId).toBe('AMD-OLD');
    expect(aged[0].ageDays).toBe(60);
    expect(aged[0].severity).toBe('warning');
    expect(aged[0].apply).toContain('--promote AMD-OLD');
    // La que no guarda fecha NO inventa una edad: se declara no comprobada.
    expect(aged.some((a) => a.principleId === 'AMD-NODATE')).toBe(false);
    expect(report.notChecked.some((n) => n.includes('AMD-NODATE'))).toBe(true);
    expect(report.notChecked.some((n) => /sin fecha registrada/i.test(n))).toBe(true);
  });

  it('un borrador viejo sin ratificar SÍ es amendment-aged, y el umbral es configurable', async () => {
    const dir = await makeTemp('open-sdd-advice-draft-');
    await packageJson(dir);
    const record: AmendmentRecord = {
      id: 'AMD-DRAFT',
      title: 'Principio propuesto pero no ratificado',
      proposedBy: 'sdd-getspecs',
      status: 'proposed',
      updatedAt: daysAgoIso(40),
    };
    await writeConstitution(
      dir,
      constitution(
        [
          principle({
            id: 'DRAFT-PRINCIPLE',
            draft: true,
            title: 'Propuesta sin ratificar',
            amendment: { ...record },
            evidence: [],
          }),
        ],
        [record],
      ),
    );

    const report = await adviseConstitution(dir, { now: NOW });
    const aged = ofKind(report.advice, 'amendment-aged');
    expect(aged).toHaveLength(1);
    expect(aged[0].principleId).toBe('DRAFT-PRINCIPLE');
    expect(aged[0].ageDays).toBe(40);

    // Con un umbral mayor que la edad deja de ser un hallazgo.
    const relaxed = await adviseConstitution(dir, { now: NOW, thresholdDays: 90 });
    expect(ofKind(relaxed.advice, 'amendment-aged')).toHaveLength(0);
    expect(DEFAULT_AMENDMENT_THRESHOLD_DAYS).toBe(30);
  });
});

describe('core/constitutionAdvice — contradicciones', () => {
  it('detecta dos principios en vigor que fijan gestores distintos y cita ambos identificadores', async () => {
    const dir = await makeTemp('open-sdd-advice-contradiction-');
    await packageJson(dir);
    await writeConstitution(
      dir,
      constitution([
        principle({
          id: 'SEC-NPM',
          title: 'Gestor npm',
          restriction: 'Usar exclusivamente npm para instalar las dependencias.',
          evidence: ['package.json'],
        }),
        principle({
          id: 'SEC-PNPM',
          title: 'Gestor pnpm',
          restriction: 'Usar exclusivamente pnpm para instalar las dependencias.',
          evidence: ['package.json'],
        }),
      ]),
    );

    const report = await adviseConstitution(dir, { now: NOW });
    const contradictions = ofKind(report.advice, 'contradictory-principles');
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0].severity).toBe('error');
    const allText = [contradictions[0].title, contradictions[0].why, ...contradictions[0].evidence].join('\n');
    expect(allText).toContain('SEC-NPM');
    expect(allText).toContain('SEC-PNPM');
    // El conflicto de familia se explica en el porqué.
    expect(contradictions[0].why).toMatch(/gestor de paquetes/i);
  });

  it('detecta polaridad opuesta (MUST frente a SHOULD) sobre el mismo objetivo y cita ambos ids', async () => {
    const dir = await makeTemp('open-sdd-advice-polarity-');
    await packageJson(dir);
    await writeConstitution(
      dir,
      constitution([
        principle({
          id: 'SEC-ENCRYPT-AT-REST',
          title: 'Cifrado en reposo',
          cweReference: 'CWE-311',
          level: 'MUST',
          restriction: 'Cifrar los datos en reposo con AES-256 antes de persistirlos.',
          pattern: 'Aplicar AES-256 en la capa de persistencia antes de escribir.',
          evidence: ['package.json'],
        }),
        principle({
          id: 'SEC-PLAIN-CACHE',
          title: 'Caché en claro',
          cweReference: 'CWE-311',
          level: 'SHOULD',
          restriction: 'No cifrar los datos en reposo de la caché para simplificar la depuración.',
          pattern: 'Mantener la caché en texto plano para simplificar la depuración.',
          evidence: ['package.json'],
        }),
      ]),
    );

    const report = await adviseConstitution(dir, { now: NOW });
    const contradictions = ofKind(report.advice, 'contradictory-principles');
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0].severity).toBe('error');
    const allText = [contradictions[0].title, contradictions[0].why, ...contradictions[0].evidence].join('\n');
    expect(allText).toContain('SEC-ENCRYPT-AT-REST');
    expect(allText).toContain('SEC-PLAIN-CACHE');
    // El objetivo compartido (la CWE) se cita como la razón del hallazgo.
    expect(contradictions[0].why).toContain('CWE-311');
  });
});

describe('core/constitutionAdvice — stack, fronteras, historial y exenciones', () => {
  it('detecta deriva de stack cuando el manifiesto fija un gestor distinto del que declara un principio', async () => {
    const dir = await makeTemp('open-sdd-advice-stack-');
    await packageJson(dir);
    await writeFile(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n', 'utf8');
    await writeConstitution(
      dir,
      constitution([
        principle({
          id: 'C-STACK-FACT',
          title: 'El stack es un hecho',
          restriction: 'Usar npm en todos los manifiestos del repositorio.',
          evidence: ['package.json'],
        }),
      ]),
    );

    const report = await adviseConstitution(dir, { now: NOW });
    const drift = ofKind(report.advice, 'stack-drifted');
    expect(drift).toHaveLength(1);
    expect(drift[0].severity).toBe('warning');
    expect(drift[0].evidence.join(' ')).toContain('pnpm');
    expect(drift[0].evidence.join(' ')).toContain('npm');
  });

  it('detecta fronteras que el mapa observa y la constitución no, y fronteras que la constitución nombra y ya no existen', async () => {
    const dir = await makeTemp('open-sdd-advice-boundary-');
    await packageJson(dir);
    await mkdir(path.join(dir, 'src', 'core'), { recursive: true });
    await mkdir(path.join(dir, 'src', 'cli'), { recursive: true });
    await writeFile(path.join(dir, 'src', 'core', 'a.ts'), 'export const a = 1;\n', 'utf8');
    await writeFile(path.join(dir, 'src', 'cli', 'b.ts'), 'export const b = 1;\n', 'utf8');
    await writeConstitution(
      dir,
      constitution([
        principle({
          id: 'C-BOUNDARIES',
          title: 'Seguir los límites de servicio existentes',
          level: 'SHOULD',
          restriction: 'Un cambio no cruza una frontera de módulo salvo que la delta declare el cruce.',
          evidence: ['legacy'],
        }),
      ]),
    );

    const report = await adviseConstitution(dir, { now: NOW });
    const boundaries = ofKind(report.advice, 'boundary-aged');
    expect(boundaries.length).toBeGreaterThanOrEqual(3);
    // Las dos observadas y no declaradas.
    expect(boundaries.some((a) => a.title.includes('core'))).toBe(true);
    expect(boundaries.some((a) => a.title.includes('cli'))).toBe(true);
    // Y la declarada que ya no existe.
    const vanished = boundaries.find((a) => a.evidence.some((e) => e.includes('legacy')));
    expect(vanished).toBeDefined();
    expect(vanished!.severity).toBe('warning');
    expect(report.checked.some((c) => /fronteras:/i.test(c))).toBe(true);
  });

  it('reporta violaciones recurrentes leyendo el histórico real y las declara no comprobadas cuando no existe', async () => {
    const dir = await makeTemp('open-sdd-advice-recurring-');
    await packageJson(dir);
    await writeJson(dir, '.sdd/memory/violations.json', [
      { principleId: 'SEC-001', at: daysAgoIso(2), reason: 'consulta concatenada detectada en revisión' },
      { principleId: 'SEC-001', at: daysAgoIso(5), reason: 'reincidencia en el módulo de informes' },
    ]);
    await writeConstitution(dir, constitution([principle({ evidence: ['package.json'] })]));

    const report = await adviseConstitution(dir, { now: NOW });
    const recurring = ofKind(report.advice, 'recurring-violation');
    expect(recurring).toHaveLength(1);
    expect(recurring[0].principleId).toBe('SEC-001');
    expect(recurring[0].severity).toBe('error');
    expect(recurring[0].evidence.join(' ')).toContain('violations.json');

    // Sin histórico, la señal es explícitamente no comprobada (la ausencia de datos no es un aprobado).
    const empty = await makeTemp('open-sdd-advice-nohistory-');
    await packageJson(empty);
    await writeConstitution(empty, constitution([principle({ evidence: ['package.json'] })]));
    const emptyReport = await adviseConstitution(empty, { now: NOW });
    expect(ofKind(emptyReport.advice, 'recurring-violation')).toHaveLength(0);
    expect(emptyReport.notChecked.some((n) => /no existe ningún histórico/i.test(n))).toBe(true);
  });

  it('reporta exenciones caducadas o a menos de 14 días, y omite las que no declaran expires', async () => {
    const dir = await makeTemp('open-sdd-advice-waiver-');
    await packageJson(dir);
    await writeJson(dir, '.sdd/settings/security-allowlist.json', {
      allow: [
        { path: 'src/expired.ts', ids: ['x'], reason: 'r', owner: 'ana', expires: daysAgoIso(1).slice(0, 10) },
        { path: 'src/soon.ts', ids: ['x'], reason: 'r', expires: daysAheadIso(5).slice(0, 10) },
        { path: 'src/no-date.ts', ids: ['x'], reason: 'r' },
      ],
    });
    await writeConstitution(dir, constitution([principle({ evidence: ['package.json'] })]));

    const report = await adviseConstitution(dir, { now: NOW });
    const waivers = ofKind(report.advice, 'waiver-expiring');
    expect(waivers).toHaveLength(2);
    expect(waivers.some((a) => a.title.includes('src/expired.ts') && a.severity === 'warning')).toBe(true);
    expect(waivers.some((a) => a.title.includes('src/soon.ts') && a.severity === 'info')).toBe(true);
    // La entrada sin expires se omite: la fecha es opcional, no una caducidad inventada.
    expect(waivers.some((a) => a.title.includes('src/no-date.ts'))).toBe(false);
    expect(report.checked.some((c) => /2 de 3 entrada\(s\) declaran expires/.test(c))).toBe(true);
  });
});

describe('core/constitutionAdvice — honestidad del informe', () => {
  it('complete es exactamente la ausencia de elementos no comprobados, y renderAdvice resume sin modelo', async () => {
    const dir = await makeTemp('open-sdd-advice-report-');
    await packageJson(dir);
    await writeConstitution(
      dir,
      constitution([principle({ id: 'C-API-COMPAT', evidence: ['src/absent.ts'] })]),
    );

    const report = await adviseConstitution(dir, { now: NOW });
    expect(report.complete).toBe(report.notChecked.length === 0);
    expect(report.checked.length).toBeGreaterThan(0);
    expect(report.detail).toMatch(/hallazgo/);

    const lines = renderAdvice(report);
    const text = lines.join('\n');
    expect(text).toContain('Consejo de constitución');
    expect(text).toContain('evidence-expired');
    expect(text).toContain('aplicar:'); // hay comando de aplicación para la evidencia caducada
    expect(text).toMatch(/Comprobado:/);
    expect(text).toMatch(/No comprobado:/);
  });

  it('sin constitución no inventa consejos: lo declara no comprobado y sigue siendo explícito', async () => {
    const dir = await makeTemp('open-sdd-advice-none-');
    const report = await adviseConstitution(dir, { now: NOW });
    expect(report.advice).toHaveLength(0);
    expect(report.complete).toBe(false);
    expect(report.notChecked.some((n) => /no hay constitución|no se encontró/i.test(n))).toBe(true);
    expect(kindsOf(report.advice)).toEqual([]);
  });
});
