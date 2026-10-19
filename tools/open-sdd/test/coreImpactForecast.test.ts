import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { forecastImpact } from '../src/core/changeImpact.js';

const temps: string[] = [];

const makeTemp = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const write = async (root: string, rel: string, content: string): Promise<void> => {
  const full = path.join(root, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
};

/** Un workspace con un módulo `billing`, un símbolo reutilizable y un test que lo protege. */
const workspaceFixture = async (): Promise<string> => {
  const root = await makeTemp('open-sdd-forecast-');
  await write(
    root,
    'package.json',
    JSON.stringify(
      { name: 'forecast-fixture', private: true, workspaces: ['packages/*'], devDependencies: { typescript: '^5', vitest: '^4' } },
      null,
      2,
    ),
  );
  await write(root, 'packages/billing/package.json', JSON.stringify({ name: '@fixture/billing', version: '1.0.0' }, null, 2));
  await write(
    root,
    'packages/billing/src/invoice.ts',
    '// facturacion de recibos\nexport const renderInvoice = (id: string): string => `invoice-${id}`;\n',
  );
  await write(root, 'packages/billing/src/index.ts', "export { renderInvoice } from './invoice.js';\n");
  await write(
    root,
    'packages/billing/src/report.ts',
    "import { renderInvoice } from './invoice.js';\nexport const report = (): string => renderInvoice('1');\n",
  );
  await write(
    root,
    'packages/billing/test/invoice.test.ts',
    "import { renderInvoice } from '../src/invoice.js';\nimport { describe, it, expect } from 'vitest';\ndescribe('invoice', () => { it('renders', () => expect(renderInvoice('1')).toContain('invoice')); });\n",
  );
  return root;
};

describe('forecastImpact — antes de escribir nada', () => {
  it('nombra módulos, símbolos reutilizables, tests y radio esperado', async () => {
    const root = await workspaceFixture();

    const forecast = await forecastImpact({
      cwd: root,
      description: 'cambiar la facturacion de recibos de billing',
      symbols: ['renderInvoice'],
    });

    // Módulos: los que coinciden con las palabras clave de la descripción.
    const billing = forecast.modules.find((module) => module.path === 'packages/billing');
    expect(billing).toBeDefined();
    expect(billing!.matchedKeywords).toContain('billing');
    expect(billing!.matched).toContain('packages/billing/src/invoice.ts');

    // Símbolos: reutilización primero ANTES de crear nada.
    expect(forecast.reuseViolations).toContain('renderInvoice');
    expect(forecast.reuseCandidates.some((candidate) => candidate.symbol === 'renderInvoice')).toBe(true);

    // Tests que protegerían el cambio.
    expect(forecast.tests.map((test) => test.file)).toContain('packages/billing/test/invoice.test.ts');
    expect(forecast.tests[0].reasons.length).toBeGreaterThan(0);

    // Radio esperado: un número, no una promesa.
    expect(typeof forecast.expectedBlastRadius).toBe('number');
    expect(forecast.expectedBlastRadius!).toBeGreaterThan(0);
    expect(forecast.candidateFiles).toContain('packages/billing/src/invoice.ts');
    expect(forecast.detail).toMatch(/Pronóstico de impacto/);
    expect(forecast.keywords).toContain('billing');
  });

  it('declara como desconocido lo que no puede determinar, nunca como cero', async () => {
    const root = await workspaceFixture();

    const forecast = await forecastImpact({ cwd: root, description: 'quantum telemetry zzz' });

    expect(forecast.modules).toHaveLength(0);
    expect(forecast.expectedBlastRadius).toBeNull();
    expect(forecast.expectedBlastRadius).not.toBe(0);
    expect(forecast.complete).toBe(false);
    expect(forecast.unknown.join(' ')).toMatch(/Ningún módulo coincide/);
    expect(forecast.unknown.join(' ')).toMatch(/reutilización primero/);
  });

  it('sin símbolos declarados declara la incógnita en lugar de informar un cero limpio', async () => {
    const root = await workspaceFixture();

    const forecast = await forecastImpact({ cwd: root, description: 'cambiar la facturacion de billing' });

    expect(forecast.reuseCandidates).toHaveLength(0);
    expect(forecast.unknown.join(' ')).toMatch(/No se declararon símbolos/);
    expect(forecast.expectedBlastRadius).not.toBeNull();
    expect(forecast.modules.length).toBeGreaterThan(0);
  });
});
