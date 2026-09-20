import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  contractsFileName,
  extractContracts,
  verifyContracts,
  type ContractSet,
} from '../src/core/executionContract.js';
import type { DeltaSpec } from '../src/core/deltaSpec.js';

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

const project = async (): Promise<string> => {
  const root = await makeTemp('open-sdd-contracts-');
  await write(
    root,
    'package.json',
    JSON.stringify({ name: 'contracts-fixture', devDependencies: { typescript: '^5', vitest: '^4' } }, null, 2),
  );
  await write(root, 'src/auth/session.ts', 'export const session = 1;\n');
  await write(root, 'src/auth/token.ts', 'export const token = 1;\n');
  await write(root, 'test/auth/session.test.ts', "import { session } from '../../src/auth/session.js';\n");
  return root;
};

const deltaOf = (entries: DeltaSpec['entries']): DeltaSpec => ({
  feature: 'auth-change',
  title: 'Cambio de autenticación',
  status: 'proposed',
  entries,
});

describe('extractContracts — contratos descubiertos', () => {
  it('descubre el test cuyo nombre corresponde a un fichero cambiado', async () => {
    const root = await project();

    const set = await extractContracts({
      cwd: root,
      changedFiles: ['src/auth/session.ts', 'src/auth/token.ts'],
    });

    expect(set.testCommand).toBe('npx vitest run');
    expect(set.detail).toContain('derivado');
    const discovered = set.contracts.filter((c) => c.source === 'discovered');
    expect(discovered).toHaveLength(1);
    expect(discovered[0].test).toBe('test/auth/session.test.ts');
    expect(discovered[0].protects).toEqual(['src/auth/session.ts']);
    expect(discovered[0].description).toContain('Contrato descubierto');
    expect(set.complete).toBe(true);
  });

  it('informa el hueco: ficheros cambiados sin ningún contrato', async () => {
    const root = await project();

    const set = await extractContracts({
      cwd: root,
      changedFiles: ['src/auth/session.ts', 'src/auth/token.ts'],
    });

    expect(set.uncoveredChanges).toEqual(['src/auth/token.ts']);
    expect(set.detail).toContain('sin ningún contrato');
  });

  it('deriva el comando por defecto cuando no reconoce el framework', async () => {
    const root = await project();

    const set = await extractContracts({
      cwd: root,
      changedFiles: ['src/auth/session.ts'],
      testFramework: 'Playwright',
      testDirs: ['test'],
    });

    expect(set.testCommand).toBe('npm test');
    expect(set.detail).toContain('No se detectó framework');
  });

  it('marca completo:false cuando el directorio de test declarado no se puede leer', async () => {
    const root = await makeTemp('open-sdd-contracts-broken-');
    await write(root, 'src/auth/session.ts', 'export const session = 1;\n');

    const set = await extractContracts({
      cwd: root,
      changedFiles: ['src/auth/session.ts'],
      testDirs: ['test'],
    });

    expect(set.complete).toBe(false);
    expect(set.detail).toContain('No se pudo leer el directorio de test');
    expect(set.uncoveredChanges).toEqual(['src/auth/session.ts']);
  });

  it('no confunde «sin directorios de test» con «todo cubierto»', async () => {
    const root = await makeTemp('open-sdd-contracts-notests-');
    await write(root, 'src/auth/session.ts', 'export const session = 1;\n');

    const set = await extractContracts({ cwd: root, changedFiles: ['src/auth/session.ts'] });

    expect(set.detail).toContain('No se detectó ningún directorio de test');
    expect(set.uncoveredChanges).toEqual(['src/auth/session.ts']);
  });
});

describe('extractContracts — contratos declarados por la delta', () => {
  it('materializa los contratos declarados y avisa de un MODIFIED sin contratos', async () => {
    const root = await project();

    const set = await extractContracts({
      cwd: root,
      changedFiles: ['src/auth/session.ts'],
      delta: deltaOf([
        {
          id: 'REQ-AUTH-001',
          kind: 'MODIFIED',
          title: 'Modificar la sesión',
          statement: 'Cuando el usuario inicie sesión, el sistema debe registrar el intento.',
          targets: ['src/auth/session.ts'],
          previous: 'la sesión anterior',
          contracts: ['test/auth/session.test.ts'],
        },
        {
          id: 'REQ-AUTH-002',
          kind: 'MODIFIED',
          title: 'Modificar el token',
          statement: 'Cuando el token expire, el sistema debe renovarlo.',
          targets: ['src/auth/token.ts'],
          previous: 'el token anterior',
        },
      ]),
    });

    const declared = set.contracts.filter((c) => c.source === 'delta');
    expect(declared).toHaveLength(1);
    expect(declared[0].test).toBe('test/auth/session.test.ts');
    expect(declared[0].description).toContain('REQ-AUTH-001');
    expect(declared[0].protects).toEqual(['src/auth/session.ts']);
    expect(set.detail).toContain('REQ-AUTH-002');
    expect(set.detail).toContain('no declara contratos');
    // El contrato declarado existe como test: el conjunto sigue completo.
    expect(set.complete).toBe(true);
  });

  it('marca completo:false cuando una REMOVED declara un contrato que no existe', async () => {
    const root = await project();

    const set = await extractContracts({
      cwd: root,
      changedFiles: ['src/auth/session.ts'],
      delta: deltaOf([
        {
          id: 'REQ-AUTH-003',
          kind: 'REMOVED',
          title: 'Eliminar el inicio de sesión heredado',
          statement: 'Cuando el usuario use el camino heredado, el sistema no debe iniciar sesión.',
          targets: ['src/auth/session.ts'],
          previous: 'el inicio de sesión heredado',
          rationale: 'Se sustituye por el camino nuevo.',
          contracts: ['test/auth/legacy-login.test.ts'],
        },
      ]),
    });

    expect(set.complete).toBe(false);
    expect(set.detail).toContain('ERROR');
    expect(set.detail).toContain('test/auth/legacy-login.test.ts');
  });
});

describe('verifyContracts — el oráculo no se aprueba con un código de salida', () => {
  it('rechaza el éxito cuando faltan contratos declarados aunque el comando salga con 0', async () => {
    const root = await project();
    const set = await extractContracts({
      cwd: root,
      changedFiles: ['src/auth/session.ts'],
      delta: deltaOf([
        {
          id: 'REQ-AUTH-003',
          kind: 'REMOVED',
          title: 'Eliminar el camino heredado',
          statement: 'Cuando el usuario use el camino heredado, el sistema no debe iniciar sesión.',
          targets: ['src/auth/session.ts'],
          previous: 'el camino heredado',
          rationale: 'Sustituido.',
          contracts: ['test/auth/legacy-login.test.ts'],
        },
      ]),
    });

    const verdict = verifyContracts(set, { exitCode: 0, stdout: '10 passed' });

    expect(verdict.satisfied).toBe(false);
    expect(verdict.missing).toEqual(['test/auth/legacy-login.test.ts']);
    expect(verdict.detail).toContain('no es un aprobado');
  });

  it('satisface cuando el comando sale con 0 y todo contrato declarado existe', async () => {
    const root = await project();
    const set = await extractContracts({
      cwd: root,
      changedFiles: ['src/auth/session.ts'],
      delta: deltaOf([
        {
          id: 'REQ-AUTH-001',
          kind: 'MODIFIED',
          title: 'Modificar la sesión',
          statement: 'Cuando el usuario inicie sesión, el sistema debe registrar el intento.',
          targets: ['src/auth/session.ts'],
          previous: 'la sesión anterior',
          contracts: ['test/auth/session.test.ts::registra el intento'],
        },
      ]),
    });

    const verdict = verifyContracts(set, { exitCode: 0, stdout: '1 passed' });

    expect(verdict.missing).toEqual([]);
    expect(verdict.failed).toEqual([]);
    expect(verdict.satisfied).toBe(true);
    expect(verdict.detail).toContain('satisfechos');
  });

  it('nombra los contratos declarados que fallaron', async () => {
    const root = await project();
    const set = await extractContracts({
      cwd: root,
      changedFiles: ['src/auth/session.ts'],
      delta: deltaOf([
        {
          id: 'REQ-AUTH-001',
          kind: 'MODIFIED',
          title: 'Modificar la sesión',
          statement: 'Cuando el usuario inicie sesión, el sistema debe registrar el intento.',
          targets: ['src/auth/session.ts'],
          previous: 'la sesión anterior',
          contracts: ['test/auth/session.test.ts'],
        },
      ]),
    });

    const verdict = verifyContracts(set, {
      exitCode: 1,
      stdout: 'FAIL test/auth/session.test.ts',
      failedTests: ['test/auth/session.test.ts'],
    });

    expect(verdict.satisfied).toBe(false);
    expect(verdict.failed).toEqual(['test/auth/session.test.ts']);
    expect(verdict.missing).toEqual([]);
    expect(verdict.detail).toContain('NO satisfechos');
  });

  it('dice que la salida no identificó el fallo cuando no hay lista de pruebas fallidas', async () => {
    const root = await project();
    const set = await extractContracts({ cwd: root, changedFiles: ['src/auth/session.ts'] });

    const verdict = verifyContracts(set, { exitCode: 1, stdout: 'algo salió mal' });

    expect(verdict.satisfied).toBe(false);
    expect(verdict.failed).toEqual([]);
    expect(verdict.detail).toContain('no identificó las pruebas que fallaron');
  });

  it('un conjunto sin contratos declarados no convierte el código 0 en prueba de nada', async () => {
    const root = await project();
    const set = await extractContracts({ cwd: root, changedFiles: ['src/auth/session.ts'] });

    const verdict = verifyContracts(set, { exitCode: 0, stdout: 'ok' });

    expect(verdict.satisfied).toBe(true);
    expect(verdict.detail).toContain('no declara contratos');
    expect(verdict.detail).toContain('única señal');
  });

  it('no da por presente un contrato declarado solo porque exista otro con el mismo nombre base', async () => {
    const root = await project();

    const set = await extractContracts({
      cwd: root,
      changedFiles: ['src/auth/session.ts'],
      delta: deltaOf([
        {
          id: 'REQ-AUTH-009',
          kind: 'REMOVED',
          title: 'Eliminar el camino heredado',
          statement: 'Cuando el usuario use el camino heredado, el sistema no debe iniciar sesión.',
          targets: ['src/auth/session.ts'],
          previous: 'el camino heredado',
          rationale: 'Sustituido.',
          contracts: ['test/other/session.test.ts'],
        },
      ]),
    });

    const verdict = verifyContracts(set, { exitCode: 0, stdout: 'ok' });

    expect(set.complete).toBe(false);
    expect(verdict.missing).toEqual(['test/other/session.test.ts']);
    expect(verdict.satisfied).toBe(false);
  });

  it('publica el conjunto en contracts.json', () => {
    expect(contractsFileName()).toBe('contracts.json');
  });

  it('escribe un detalle explícito sobre un conjunto vacío de contratos', () => {
    const empty: ContractSet = {
      feature: 'x',
      testCommand: 'npm test',
      contracts: [],
      uncoveredChanges: [],
      complete: true,
      detail: '',
    };
    const verdict = verifyContracts(empty, { exitCode: 0, stdout: '' });
    expect(verdict.satisfied).toBe(true);
    expect(verdict.missing).toEqual([]);
  });
});
