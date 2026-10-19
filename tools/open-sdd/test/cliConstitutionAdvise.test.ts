/**
 * Pruebas de comportamiento del asesor de constitución POR LA CLI (REQ-MAT-017).
 *
 * `open-sdd govern constitution --advise` imprime el consejo de forma compacta (o JSON con --json)
 * y sale 1 SOLO cuando un consejo es `severity: 'error'` (violación recurrente o contradicción).
 * Un aviso — evidencia caducada, enmienda vieja, práctica no declarada — no bloquea. Todo ocurre en
 * fixtures `mkdtemp`: nada se toca en este repositorio.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleGovernCommand } from '../src/cli/commands/paper.js';
import { renderConstitution, type Constitution, type ConstitutionPrinciple } from '../src/core/constitution.js';
import type { AdviceReport } from '../src/core/constitutionAdvice.js';
import type { CliIO } from '../src/cli/io.js';

const day = 24 * 60 * 60 * 1000;
// La CLI no acepta un `now` inyectado: las fechas de los fixtures se calculan contra el reloj real,
// no contra una constante, para que el umbral y la ventana de recurrencia sean medibles siempre.
const nowMs = Date.now();
const daysAgoIso = (days: number): string => new Date(nowMs - days * day).toISOString();

const temps: string[] = [];
const makeTemp = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const makeIO = (): { io: CliIO; logs: string[]; errors: string[] } => {
  const logs: string[] = [];
  const errors: string[] = [];
  const io: CliIO = {
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
    exit: () => undefined,
  };
  return { io, logs, errors };
};

const LONG =
  'El texto explica el vector de ataque que el principio previene y permite juzgar sus casos límite sin ambigüedad.';

const principle = (overrides: Partial<ConstitutionPrinciple> = {}): ConstitutionPrinciple => ({
  id: 'SEC-001',
  title: 'Consulta parametrizada',
  cweReference: 'CWE-89',
  level: 'MUST',
  restriction: 'Las consultas usan sentencias parametrizadas.',
  pattern: 'Usar el constructor de consultas con parámetros vinculados.',
  justification: LONG,
  provenance: 'descriptive',
  evidence: ['package.json'],
  ...overrides,
});

const fixture = async (
  prefix: string,
  principles: ConstitutionPrinciple[],
  amendments: Constitution['amendments'] = [],
): Promise<string> => {
  const dir = await makeTemp(prefix);
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2), 'utf8');
  await mkdir(path.join(dir, '.sdd', 'steering'), { recursive: true });
  const constitution: Constitution = {
    project: 'fixture-cli',
    provenance: 'descriptive',
    establishedFacts: [],
    principles,
    amendments,
  };
  await writeFile(
    path.join(dir, '.sdd', 'steering', 'constitution.md'),
    renderConstitution(constitution),
    'utf8',
  );
  return dir;
};

describe('cli/govern constitution --advise', () => {
  it('--json imprime el informe completo y sale 0 cuando solo hay avisos', async () => {
    const dir = await fixture('open-sdd-cli-advise-ok-', [
      principle({ id: 'C-API-COMPAT', evidence: ['src/absent.ts'] }),
    ]);
    const { io, logs } = makeIO();

    const code = await handleGovernCommand(['constitution', '--advise', '--json'], io, dir);

    expect(code).toBe(0);
    expect(logs).toHaveLength(1);
    const report = JSON.parse(logs[0]) as AdviceReport;
    expect(report.project).toBe('fixture-cli');
    expect(Array.isArray(report.advice)).toBe(true);
    expect(report.advice.some((a) => a.kind === 'evidence-expired' && a.severity === 'warning')).toBe(true);
    expect(report.advice.some((a) => a.severity === 'error')).toBe(false);
    expect(Array.isArray(report.checked)).toBe(true);
    expect(Array.isArray(report.notChecked)).toBe(true);
    expect(report.complete).toBe(report.notChecked.length === 0);
    // El ejemplo listo para pegar viaja incluso en JSON.
    expect(report.advice[0].example).toContain('- Restriction:');
  });

  it('la salida compacta muestra tipo, severidad, una línea de evidencia y el comando de aplicación', async () => {
    const dir = await fixture('open-sdd-cli-advise-compact-', [
      principle({ id: 'C-API-COMPAT', evidence: ['src/absent.ts'] }),
    ]);
    const { io, logs } = makeIO();

    const code = await handleGovernCommand(['constitution', '--advise'], io, dir);

    expect(code).toBe(0);
    const text = logs.join('\n');
    expect(text).toContain('Consejo de constitución');
    expect(text).toContain('evidence-expired');
    expect(text).toContain('por qué:');
    expect(text).toContain('evidencia:');
    expect(text).toContain('aplicar: open-sdd brownfield constitution . --write');
  });

  it('sale 1 SOLO con un consejo de severidad error (violación recurrente)', async () => {
    const dir = await fixture('open-sdd-cli-advise-error-', [principle()]);
    await mkdir(path.join(dir, '.sdd', 'memory'), { recursive: true });
    await writeFile(
      path.join(dir, '.sdd', 'memory', 'violations.json'),
      JSON.stringify(
        [
          { principleId: 'SEC-001', at: daysAgoIso(3), reason: 'consulta concatenada en revisión' },
          { principleId: 'SEC-001', at: daysAgoIso(8), reason: 'reincidencia en informes' },
        ],
        null,
        2,
      ),
      'utf8',
    );
    const { io, logs } = makeIO();

    const code = await handleGovernCommand(['constitution', '--advise', '--json'], io, dir);

    expect(code).toBe(1);
    const report = JSON.parse(logs[0]) as AdviceReport;
    expect(report.advice.some((a) => a.kind === 'recurring-violation' && a.severity === 'error')).toBe(true);
  });

  it('--threshold-days gobierna qué enmiendas se consideran envejecidas', async () => {
    const record = {
      id: 'AMD-OLD',
      title: 'Enmienda sin decidir',
      proposedBy: 'security-lead',
      status: 'proposed' as const,
      updatedAt: daysAgoIso(40),
    };
    const dir = await fixture('open-sdd-cli-advise-threshold-', [principle()], [record]);

    const strict = makeIO();
    expect(await handleGovernCommand(['constitution', '--advise', '--json'], strict.io, dir)).toBe(0);
    const strictReport = JSON.parse(strict.logs[0]) as AdviceReport;
    expect(strictReport.advice.some((a) => a.kind === 'amendment-aged')).toBe(true);

    const relaxed = makeIO();
    expect(
      await handleGovernCommand(['constitution', '--advise', '--json', '--threshold-days', '90'], relaxed.io, dir),
    ).toBe(0);
    const relaxedReport = JSON.parse(relaxed.logs[0]) as AdviceReport;
    expect(relaxedReport.advice.some((a) => a.kind === 'amendment-aged')).toBe(false);
  });

  it('sin constitución no falla por un consejo: informa lo no comprobado y sale 0', async () => {
    const dir = await makeTemp('open-sdd-cli-advise-none-');
    const { io, logs } = makeIO();

    const code = await handleGovernCommand(['constitution', '--advise', '--json'], io, dir);

    expect(code).toBe(0);
    const report = JSON.parse(logs[0]) as AdviceReport;
    expect(report.advice).toHaveLength(0);
    expect(report.complete).toBe(false);
    expect(report.notChecked.some((n) => /no se encontró/i.test(n))).toBe(true);
  });
});
