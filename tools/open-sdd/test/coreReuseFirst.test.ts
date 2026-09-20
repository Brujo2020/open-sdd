import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  findReuseCandidates,
  scanDeclarations,
  similarityOf,
  REUSE_FIRST_RULE,
} from '../src/core/reuseFirst.js';

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

const fixture = async (): Promise<string> => {
  const root = await makeTemp('open-sdd-reuse-');
  await write(root, 'package.json', JSON.stringify({ name: 'reuse-fixture' }, null, 2));
  await write(
    root,
    'src/auth/session.ts',
    ['export const UNUSED_HEADER = 0;', 'export function getUser() {', '  return 1;', '}', '', 'export class SessionStore {}', ''].join('\n'),
  );
  await write(root, 'src/auth/store.ts', 'export function getUserById() {\n  return 2;\n}\n');
  await write(root, 'src/billing/invoice.ts', 'export const computeInvoiceTotal = 1;\nexport const total = 1;\n');
  return root;
};

describe('reuseFirst — la política', () => {
  it('cita la política de reutilización primero', () => {
    expect(REUSE_FIRST_RULE).toContain('busca si ya existe uno reutilizable');
    expect(REUSE_FIRST_RULE).toContain('solo está permitido cuando no existe nada reutilizable');
  });

  it('indexa declaraciones con fichero y línea', () => {
    expect(scanDeclarations('export const a = 1;\nexport function b() {}\n')).toEqual([
      { symbol: 'a', line: 1 },
      { symbol: 'b', line: 2 },
    ]);
  });

  it('clasifica la similitud por bandas', () => {
    expect(similarityOf('getUser', 'getUser')).toEqual({ similarity: 1, kind: 'same-name' });
    expect(similarityOf('getUsers', 'getUser')).toEqual({ similarity: 0.8, kind: 'name-variant' });
    expect(similarityOf('getUser', 'getUserById')).toEqual({ similarity: 0.8, kind: 'name-variant' });
    expect(similarityOf('getUserByld', 'getUserById')).toEqual({ similarity: 0.6, kind: 'same-module' });
    expect(similarityOf('totallyNewThing', 'total')).toBeNull();
    expect(similarityOf('brandNewWidget', 'computeInvoiceTotal')).toBeNull();
  });
});

describe('findReuseCandidates — el gate', () => {
  it('viola la política ante un acierto exacto y ante una variante de nombre', async () => {
    const root = await fixture();

    const report = await findReuseCandidates({
      cwd: root,
      requests: [
        { symbol: 'getUser', reason: 'necesito leer el usuario' },
        { symbol: 'SessionStore', reason: 'necesito guardar la sesión' },
        { symbol: 'getUsers', reason: 'necesito listar usuarios' },
        { symbol: 'computeInvoiceTotals', reason: 'necesito el total' },
      ],
    });

    expect(report.complete).toBe(true);
    expect(report.violations).toEqual(['getUser', 'SessionStore', 'getUsers', 'computeInvoiceTotals']);
    expect(report.candidates).toContainEqual({
      symbol: 'getUser',
      file: 'src/auth/session.ts',
      line: 2,
      similarity: 1,
      kind: 'same-name',
    });
    // El informe deduplica por símbolo+fichero+línea (el candidato no lleva el símbolo pedido), así
    // que la variante se comprueba en un candidato propio.
    expect(report.candidates).toContainEqual({
      symbol: 'computeInvoiceTotal',
      file: 'src/billing/invoice.ts',
      line: 1,
      similarity: 0.8,
      kind: 'name-variant',
    });
    expect(report.detail).toContain('Violaciones de reutilización primero');
  });

  it('no viola la política cuando el símbolo no existe: crearlo es legítimo', async () => {
    const root = await fixture();

    const report = await findReuseCandidates({
      cwd: root,
      requests: [
        { symbol: 'getUser', reason: 'ya existe' },
        { symbol: 'brandNewWidget', reason: 'no existe nada parecido' },
        // `total` existe, pero un prefijo de 5 caracteres de un nombre de 15 no es una variante:
        // sin la proporción mínima el gate se convierte en ruido y nadie lo mira.
        { symbol: 'totallyNewThing', reason: 'solo comparte el arranque con `total`' },
      ],
    });

    expect(report.violations).toEqual(['getUser']);
    expect(report.violations).not.toContain('brandNewWidget');
    expect(report.violations).not.toContain('totallyNewThing');
    expect(report.candidates.some((c) => c.symbol === 'total')).toBe(false);
    expect(report.detail).toContain('crearlo es legítimo');
    expect(report.detail).toContain('brandNewWidget');
  });

  it('encuentra la variante difusa (Levenshtein ≤ 2) y respeta el umbral', async () => {
    const root = await fixture();

    const report = await findReuseCandidates({
      cwd: root,
      requests: [{ symbol: 'getUserByld', reason: 'typo deliberado' }],
    });
    expect(report.candidates).toContainEqual({
      symbol: 'getUserById',
      file: 'src/auth/store.ts',
      line: 1,
      similarity: 0.6,
      kind: 'same-module',
    });
    expect(report.violations).toEqual(['getUserByld']);

    const strict = await findReuseCandidates({
      cwd: root,
      requests: [{ symbol: 'getUserByld', reason: 'typo deliberado' }],
      threshold: 0.9,
    });
    expect(strict.violations).toEqual([]);
    expect(strict.detail).toContain('Sin candidato por encima del umbral');
  });

  it('solo considera candidatos por encima del umbral por defecto', async () => {
    const root = await fixture();

    const report = await findReuseCandidates({
      cwd: root,
      requests: [{ symbol: 'getUserByld', reason: 'typo' }],
      threshold: 0.85,
    });

    expect(report.candidates).toEqual([]);
    expect(report.violations).toEqual([]);
  });

  it('no declara «sin candidatos» cuando la búsqueda no pudo ejecutarse', async () => {
    const root = await fixture();

    const unreadable = await findReuseCandidates({
      cwd: root,
      requests: [{ symbol: 'getUser', reason: 'x' }],
      sourceDirs: ['no-existe'],
    });
    expect(unreadable.complete).toBe(false);
    expect(unreadable.detail).toContain('No se pudo leer');
    expect(unreadable.detail).toContain('Informe incompleto');

    const missing = path.join(tmpdir(), `open-sdd-reuse-missing-${Date.now()}`);
    const noDirs = await findReuseCandidates({ cwd: missing, requests: [{ symbol: 'getUser', reason: 'x' }] });
    expect(noDirs.complete).toBe(false);
    expect(noDirs.detail).toContain('NO se ejecutó');
  });
});
