/**
 * Pruebas de comportamiento del pivote constitucional.
 *
 * Cada test fija una REGLA, no una implementación: qué hallazgo exacto produce una spec que cita una
 * autoridad fantasma, que propone migrar el stack fijado, que se sale de sus fronteras o que deja la
 * delta sin oráculo — y qué NO produce cuando la regla no puede decidir.
 */

import { describe, it, expect } from 'vitest';
import {
  SPEC_PRINCIPLES_MARKER,
  alignSpecWithConstitution,
  declaredPrinciples,
} from '../src/core/specConstitution.js';
import type { Constitution, ConstitutionPrinciple } from '../src/core/constitution.js';
import type { DeltaEntry, DeltaSpec } from '../src/core/deltaSpec.js';

const principle = (over: Partial<ConstitutionPrinciple> & { id: string }): ConstitutionPrinciple => ({
  title: `Principio ${over.id}`,
  level: 'MUST',
  threatReference: 'ADR-001',
  restriction: 'Restricción declarada del principio.',
  pattern: 'Patrón de cumplimiento declarado.',
  justification:
    'La justificación nombra el vector de ataque que el principio previene, que es lo que permite juzgar los casos límite.',
  provenance: 'descriptive',
  evidence: ['package.json'],
  ...over,
});

const constitution = (
  principles: ConstitutionPrinciple[],
  amendments: Constitution['amendments'] = [],
): Constitution => ({
  project: 'demo',
  provenance: 'descriptive',
  establishedFacts: [],
  principles,
  amendments,
});

/** El patrón C-STACK-FACT: el stack observado se declara hecho, no aspiración. */
const STACK = principle({
  id: 'C-STACK-FACT',
  title: 'Stack en vigor',
  restriction:
    'El stack en vigor (Node.js 20, TypeScript ESM y vitest) se declara hecho establecido y no se moderniza sin una enmienda gobernada.',
  pattern: 'Un cambio de stack se tramita como enmienda con plan de migración.',
  evidence: ['package.json:60 (vitest)', 'package.json:25 (typescript)'],
});

const API = principle({
  id: 'C-API-COMPAT',
  title: 'Compatibilidad de API',
  restriction: 'Ningún contrato público cambia sin declarar el comportamiento anterior que sustituye.',
  pattern: 'Rellena Previous y Contracts en cada entrada de la delta.',
  justification:
    'Una API sin declaración de reemplazo rompe consumidores que nadie volvió a revisar antes del despliegue.',
});

const ORACLE = principle({
  id: 'C-ORACLE',
  level: 'SHOULD',
  title: 'Oráculo de regresión',
  restriction: 'Toda entrada de la delta declara los contratos que cubren el comportamiento tocado.',
  pattern: 'Cita la prueba que habría fallado si el comportamiento cambiara.',
  justification:
    'Sin oráculo de regresión una eliminación es indistinguible de un accidente silencioso y nadie puede revisarla.',
});

const BOUNDARIES = principle({
  id: 'C-BOUNDARIES',
  title: 'Fronteras del cambio',
  restriction: 'Todo cambio permanece dentro de las fronteras declaradas por la spec.',
  pattern: 'Declara _Boundary:_ en cada tarea y no toques nada fuera de ellas.',
  justification:
    'Un cambio fuera de alcance introduce comportamiento no especificado que nadie revisó ni aprobó.',
});

const entry = (over: Partial<DeltaEntry> & { id: string; kind: DeltaEntry['kind'] }): DeltaEntry => ({
  title: `Entrada ${over.id}`,
  statement: 'WHEN se reciba la petición, the system shall responder con el registro.',
  targets: ['src/session/register.ts'],
  ...over,
});

const delta = (entries: DeltaEntry[]): DeltaSpec => ({
  feature: 'session',
  title: 'Registrar sesión',
  status: 'proposed',
  entries,
});

/** Un plan que declara principios: la spec deja de estar «sin pivote». */
const declaring = (...ids: string[]): string =>
  ['# Plan: sesión', '', '## Constitution', '', `- ${ids.join(', ')} gobiernan este cambio.`, ''].join('\n');

const codes = (
  alignment: ReturnType<typeof alignSpecWithConstitution>,
): string[] => alignment.findings.map((finding) => finding.code);

describe('core/specConstitution — declaración de principios', () => {
  it('lee la línea marcador y conserva los ids que no existen (para poder acusarlos)', () => {
    expect(SPEC_PRINCIPLES_MARKER).toBe('_Constitution:');
    expect(declaredPrinciples(['texto\n_Constitution: C-STACK-FACT, C-FANTASMA_\nmás texto'], ['C-STACK-FACT'])).toEqual([
      'C-STACK-FACT',
      'C-FANTASMA',
    ]);
  });

  it('lee la sección "## Constitution"', () => {
    const text = ['# Plan: sesión', '', '## Constitution', '', '- C-STACK-FACT y C-API-COMPAT gobiernan este cambio.', ''].join('\n');
    expect(declaredPrinciples([text], ['C-STACK-FACT', 'C-API-COMPAT'])).toEqual(['C-STACK-FACT', 'C-API-COMPAT']);
  });

  it('reconoce la cita en línea de un principio en vigor', () => {
    expect(declaredPrinciples(['Este cambio respeta C-API-COMPAT en su totalidad.'], ['C-API-COMPAT'])).toEqual([
      'C-API-COMPAT',
    ]);
  });

  it('no inventa principios a partir de siglas ni de referencias de amenaza', () => {
    expect(declaredPrinciples(['ADR-007 · OWASP-API-1 · REQ-AUTH-001 · MUST · EARS'], ['C-API-COMPAT'])).toEqual([]);
  });
});

describe('core/specConstitution — autoridad fantasma y pivote sin usar', () => {
  it('reporta UNKNOWN_PRINCIPLE (error) cuando la spec cita un principio que no está en vigor', () => {
    const alignment = alignSpecWithConstitution({
      feature: 'session',
      constitution: constitution([API]),
      requirements: ['### REQ-SESS-001: Sesión', '- WHEN se invoque, the system shall registrar la sesión.', '', '_Constitution: C-FANTASMA_'].join('\n'),
    });

    expect(codes(alignment)).toContain('UNKNOWN_PRINCIPLE');
    const finding = alignment.findings.find((f) => f.code === 'UNKNOWN_PRINCIPLE');
    expect(finding?.severity).toBe('error');
    expect(finding?.principleId).toBe('C-FANTASMA');
    expect(finding?.message).toContain('no está en vigor');
    expect(alignment.alignment).toBe(0);
  });

  it('reporta NO_PRINCIPLES_DECLARED (aviso) y alineación 0 — nunca 1 — cuando la spec no declara nada', () => {
    const alignment = alignSpecWithConstitution({
      feature: 'session',
      constitution: constitution([STACK]),
      requirements: ['### REQ-SESS-001: Sesión', '- WHEN se invoque, the system shall registrar la sesión.'].join('\n'),
    });

    expect(alignment.declared).toEqual([]);
    expect(alignment.undeclared).toEqual(['C-STACK-FACT']);
    expect(alignment.alignment).toBe(0);
    const finding = alignment.findings.find((f) => f.code === 'NO_PRINCIPLES_DECLARED');
    expect(finding?.severity).toBe('warning');
    expect(alignment.detail).toContain('NO es un aprobado');
  });
});

describe('core/specConstitution — contradicción del stack fijado', () => {
  it('reporta MUST_CONTRADICTED (error) cuando un requisito propone migrar una tecnología fijada', () => {
    const alignment = alignSpecWithConstitution({
      feature: 'session',
      constitution: constitution([STACK]),
      requirements: [
        '### REQ-SESS-001: Sustituir el runner',
        '- WHEN se complete el trabajo, the system shall migrar de vitest a jest la suite completa.',
        '',
        '_Constitution: C-STACK-FACT_',
      ].join('\n'),
    });

    const finding = alignment.findings.find((f) => f.code === 'MUST_CONTRADICTED');
    expect(finding?.severity).toBe('error');
    expect(finding?.principleId).toBe('C-STACK-FACT');
    expect(finding?.artifactId).toBe('REQ-SESS-001');
    expect(finding?.message).toContain('vitest');
  });

  it('reporta MUST_CONTRADICTED cuando el enunciado nombra otra tecnología del mismo hueco', () => {
    const alignment = alignSpecWithConstitution({
      feature: 'session',
      constitution: constitution([STACK]),
      requirements: [
        '### REQ-SESS-001: Runner nuevo',
        '- WHEN se ejecute la suite, the system shall usar jest en lugar del runner actual.',
      ].join('\n'),
    });

    expect(codes(alignment)).toContain('MUST_CONTRADICTED');
    expect(alignment.findings.find((f) => f.code === 'MUST_CONTRADICTED')?.message).toContain('jest');
  });

  it('no adivina cuando el principio no fija ninguna tecnología reconocible', () => {
    const modular = principle({
      id: 'C-MODULAR',
      title: 'Modularidad',
      restriction: 'Cada módulo expone una interfaz explícita y no accede al interior de otro.',
      pattern: 'Importa solo desde el punto de entrada público del módulo.',
      justification:
        'El acceso al interior acopla módulos y hace que cualquier cambio se propague sin control por todo el sistema.',
    });

    const alignment = alignSpecWithConstitution({
      feature: 'session',
      constitution: constitution([modular]),
      requirements: [
        '### REQ-SESS-001: Runner',
        '- WHEN se ejecute la suite, the system shall migrar de vitest a jest y añadir axios.',
      ].join('\n'),
    });

    expect(codes(alignment)).not.toContain('MUST_CONTRADICTED');
    expect(codes(alignment)).not.toContain('TECH_LOCK_VIOLATION');
    expect(alignment.detail).toContain('Fuera del alcance');
    expect(alignment.detail).toContain('contradicción de stack no evaluada');
  });

  it('reporta TECH_LOCK_VIOLATION (no MUST_CONTRADICTED) cuando la delta AÑADE una dependencia al stack fijado', () => {
    const alignment = alignSpecWithConstitution({
      feature: 'session',
      constitution: constitution([STACK]),
      plan: declaring('C-STACK-FACT'),
      delta: delta([
        entry({
          id: 'REQ-SESS-001',
          kind: 'ADDED',
          statement: 'WHEN se ejecute la suite, the system shall usar jest como runner del proyecto.',
          targets: ['package.json'],
        }),
      ]),
    });

    expect(codes(alignment)).toEqual(['TECH_LOCK_VIOLATION']);
    const finding = alignment.findings[0];
    expect(finding.severity).toBe('error');
    expect(finding.artifactId).toBe('REQ-SESS-001');
    expect(finding.principleId).toBe('C-STACK-FACT');
    expect(finding.message).toContain('jest');
  });

  it('degrada a aviso la violación de un principio SHOULD', () => {
    const shouldStack = { ...STACK, level: 'SHOULD' as const };
    const alignment = alignSpecWithConstitution({
      feature: 'session',
      constitution: constitution([shouldStack]),
      plan: declaring('C-STACK-FACT'),
      delta: delta([
        entry({ id: 'REQ-SESS-001', kind: 'ADDED', statement: 'WHEN se ejecute, the system shall usar jest.', targets: ['package.json'] }),
      ]),
    });

    expect(alignment.findings.find((f) => f.code === 'TECH_LOCK_VIOLATION')?.severity).toBe('warning');
  });
});

describe('core/specConstitution — fronteras', () => {
  const tasksWith = (boundary: string): string =>
    `- [ ] 1.1 implementar — _Boundary:_ \`${boundary}\`\n`;

  it('reporta BOUNDARY_VIOLATION (error) para un fichero fuera de las fronteras declaradas', () => {
    const alignment = alignSpecWithConstitution({
      feature: 'session',
      constitution: constitution([BOUNDARIES]),
      plan: declaring('C-BOUNDARIES'),
      tasks: tasksWith('src/session'),
      changedFiles: ['src/session/register.ts', 'src/billing/invoice.ts'],
    });

    expect(codes(alignment)).toEqual(['BOUNDARY_VIOLATION']);
    expect(alignment.findings[0].artifactId).toBe('src/billing/invoice.ts');
    expect(alignment.findings[0].principleId).toBe('C-BOUNDARIES');
    expect(alignment.findings[0].severity).toBe('error');
  });

  it('no reporta nada cuando todos los ficheros caen dentro de la frontera', () => {
    const alignment = alignSpecWithConstitution({
      feature: 'session',
      constitution: constitution([BOUNDARIES]),
      plan: declaring('C-BOUNDARIES'),
      tasks: tasksWith('src/session'),
      changedFiles: ['src/session/register.ts'],
    });

    expect(alignment.findings).toEqual([]);
  });

  it('trata una frontera `.` como «cubre todo»', () => {
    const alignment = alignSpecWithConstitution({
      feature: 'session',
      constitution: constitution([BOUNDARIES]),
      plan: declaring('C-BOUNDARIES'),
      tasks: tasksWith('.'),
      changedFiles: ['cualquier/ruta/del/repositorio.ts'],
    });

    expect(alignment.findings).toEqual([]);
  });

  it('acepta una frontera `.` declarada explícitamente por el llamante', () => {
    const alignment = alignSpecWithConstitution({
      feature: 'session',
      constitution: constitution([BOUNDARIES]),
      plan: declaring('C-BOUNDARIES'),
      declaredBoundaries: ['.'],
      changedFiles: ['src/otro/sitio.ts'],
    });

    expect(alignment.findings).toEqual([]);
  });

  it('declara que no pudo evaluar las fronteras en vez de aprobarlas', () => {
    const alignment = alignSpecWithConstitution({
      feature: 'session',
      constitution: constitution([BOUNDARIES]),
      plan: declaring('C-BOUNDARIES'),
      tasks: '- [ ] 1.1 implementar sin frontera declarada\n',
      changedFiles: ['src/session/register.ts'],
    });

    expect(alignment.findings).toEqual([]);
    expect(alignment.detail).toContain('fronteras no evaluadas');
  });

  it('degrada a aviso la violación de frontera de un principio SHOULD', () => {
    const shouldBoundaries = { ...BOUNDARIES, level: 'SHOULD' as const };
    const alignment = alignSpecWithConstitution({
      feature: 'session',
      constitution: constitution([shouldBoundaries]),
      plan: declaring('C-BOUNDARIES'),
      tasks: tasksWith('src/session'),
      changedFiles: ['src/billing/invoice.ts'],
    });

    expect(alignment.findings.find((f) => f.code === 'BOUNDARY_VIOLATION')?.severity).toBe('warning');
  });
});

describe('core/specConstitution — compatibilidad de API y oráculo', () => {
  it('reporta API_COMPAT_MISSING y ORACLE_MISSING (avisos) desde la delta', () => {
    const alignment = alignSpecWithConstitution({
      feature: 'session',
      constitution: constitution([API, ORACLE]),
      plan: declaring('C-API-COMPAT', 'C-ORACLE'),
      delta: delta([
        entry({ id: 'REQ-SESS-001', kind: 'MODIFIED', previous: undefined }),
        entry({
          id: 'REQ-SESS-002',
          kind: 'REMOVED',
          previous: 'el registro antiguo de sesión',
          rationale: 'Se retira porque el nuevo registro lo sustituye por completo.',
        }),
      ]),
    });

    expect(codes(alignment)).toContain('API_COMPAT_MISSING');
    expect(codes(alignment)).toContain('ORACLE_MISSING');
    const api = alignment.findings.find((f) => f.code === 'API_COMPAT_MISSING');
    expect(api?.severity).toBe('warning');
    expect(api?.artifactId).toBe('REQ-SESS-001');
    expect(api?.principleId).toBe('C-API-COMPAT');
    const oracle = alignment.findings.find((f) => f.code === 'ORACLE_MISSING' && f.principleId === 'C-ORACLE');
    expect(oracle?.severity).toBe('warning');
    expect(oracle?.artifactId).toBe('REQ-SESS-002');
    expect(oracle?.principleId).toBe('C-ORACLE');
  });

  it('no emite esos códigos cuando ningún principio gobierna la compatibilidad', () => {
    const alignment = alignSpecWithConstitution({
      feature: 'session',
      constitution: constitution([STACK]),
      delta: delta([entry({ id: 'REQ-SESS-001', kind: 'MODIFIED', previous: undefined })]),
    });

    expect(codes(alignment)).not.toContain('API_COMPAT_MISSING');
    expect(codes(alignment)).not.toContain('ORACLE_MISSING');
    expect(alignment.detail).toContain('compatibilidad de API: ningún principio en vigor la gobierna');
  });
});

describe('core/specConstitution — spec sana', () => {
  it('produce cero hallazgos y alineación 1 cuando todo resuelve y nada se contradice', () => {
    const alignment = alignSpecWithConstitution({
      feature: 'session',
      constitution: constitution([STACK, API, BOUNDARIES]),
      requirements: [
        '# Requirements: sesión',
        '',
        '### REQ-SESS-001: Registrar sesión',
        '- WHEN se invoque el endpoint, the system shall registrar la sesión.',
      ].join('\n'),
      plan: ['# Plan: sesión', '', '## Constitution', '', '- C-STACK-FACT, C-API-COMPAT y C-BOUNDARIES gobiernan este cambio.'].join('\n'),
      tasks: '- [x] 1.1 implementar — _Requirements: REQ-SESS-001_ — _Boundary:_ `src/session`\n  _Evidence: npx vitest run (3 passed)\n',
      delta: delta([
        entry({ id: 'REQ-SESS-001', kind: 'ADDED', statement: 'WHEN se invoque el endpoint, the system shall registrar la sesión.' }),
      ]),
      changedFiles: ['src/session/register.ts'],
    });

    expect(alignment.findings).toEqual([]);
    expect(alignment.alignment).toBe(1);
    expect(alignment.declared).toEqual(['C-STACK-FACT', 'C-API-COMPAT', 'C-BOUNDARIES']);
    expect(alignment.undeclared).toEqual([]);
    expect(alignment.detail).not.toContain('No evaluado');
  });
});
