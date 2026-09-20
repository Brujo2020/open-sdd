/**
 * Pruebas de comportamiento de las excepciones de seguridad con dueño y caducidad (REQ-MAT-012).
 *
 * Los fixtures viven en `os.tmpdir()` en lo que necesitan fichero; el resto son estructuras en
 * memoria. Lo que se fija es la REGLA: una excepción caducada no suprime y devuelve el hallazgo con
 * dueño y fecha; una sin dueño suprime pero se declara débil; la forma heredada sigue aceptándose; y
 * la lista viva del repositorio (15 entradas con owner/expires) sigue parseando entera.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applySecurityAllowlist,
  expiredWaivers,
  parseSecurityAllowlist,
  type SecurityAllowlistEntry,
} from '../src/core/securityAllowlist.js';

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true });
});

const makeTmp = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-waivers-'));
  dirs.push(dir);
  return dir;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const FINDING = { id: 'curl-pipe-shell', kind: 'destructive', file: 'tools/open-sdd/README.md', line: 12 };

describe('core/securityAllowlist — dueño y caducidad', () => {
  it('una excepción CADUCADA no suprime: el hallazgo vuelve con dueño y fecha', () => {
    const entries: SecurityAllowlistEntry[] = [
      {
        path: 'tools/open-sdd/README.md',
        ids: ['curl-pipe-shell'],
        reason: 'documenta el instalador soportado',
        actor: 'spec:paper-alignment',
        owner: 'mantenimiento (spec de registro)',
        expires: '2020-01-01',
      },
    ];

    const decision = applySecurityAllowlist([FINDING], entries, { now: new Date('2026-01-01T00:00:00Z') });

    // No suprime: el hallazgo vuelve a contar y el gate falla nombrando a quién preguntar.
    expect(decision.suppressed).toEqual([]);
    expect(decision.kept).toHaveLength(1);
    expect(decision.kept[0].waiverExpired).toBe(true);
    expect(decision.kept[0].owner).toBe('mantenimiento (spec de registro)');
    expect(decision.kept[0].expires).toBe('2020-01-01');

    const note = decision.waivers.find((waiver) => waiver.code === 'waiverExpired');
    expect(note?.severity).toBe('error');
    expect(note?.message).toContain('mantenimiento (spec de registro)');
    expect(note?.message).toContain('2020-01-01');
  });

  it('una excepción VÁLIDA (dueño y fecha futura) suprime normalmente', () => {
    const entries: SecurityAllowlistEntry[] = [
      {
        path: 'tools/open-sdd/README.md',
        ids: ['curl-pipe-shell'],
        reason: 'documenta el instalador soportado',
        actor: 'spec:paper-alignment',
        owner: 'mantenimiento (spec de registro)',
        expires: '2027-03-31',
      },
    ];

    const decision = applySecurityAllowlist([FINDING], entries, { now: new Date('2026-01-01T00:00:00Z') });

    expect(decision.kept).toEqual([]);
    expect(decision.suppressed).toEqual([
      { id: 'curl-pipe-shell', file: 'tools/open-sdd/README.md', line: 12, reason: 'documenta el instalador soportado' },
    ]);
    expect(decision.waivers).toEqual([]);
  });

  it('una excepción SIN DUEÑO se aplica pero se declara débil (warning, no fallo)', () => {
    const entries: SecurityAllowlistEntry[] = [
      { path: 'tools/open-sdd/README.md', ids: ['curl-pipe-shell'], reason: 'heredada sin dueño' },
    ];

    const decision = applySecurityAllowlist([FINDING], entries, { now: new Date('2026-01-01T00:00:00Z') });

    // Se aplica: la supresión está declarada y motivada, y convertirla en fallo rompería listas heredadas.
    expect(decision.kept).toEqual([]);
    expect(decision.suppressed).toHaveLength(1);
    const note = decision.waivers.find((waiver) => waiver.code === 'waiverWeak');
    expect(note?.severity).toBe('warning');
    expect(note?.message).toContain('no declara dueño');
  });

  it('expiredWaivers respeta el reloj inyectado y la semántica de fecha sin hora', () => {
    const entries: SecurityAllowlistEntry[] = [
      { path: 'a', ids: ['x'], reason: 'r', expires: '2027-03-31' },
      { path: 'b', ids: ['y'], reason: 'r', expires: '2020-01-01' },
      { path: 'c', ids: ['z'], reason: 'r' },
      { path: 'd', ids: ['w'], reason: 'r', expires: 'no-es-fecha' },
    ];

    // «expires 2027-03-31» es válida durante TODO el día 31.
    expect(expiredWaivers(entries, new Date('2027-03-31T23:00:00Z')).map((entry) => entry.path)).toEqual(['b']);
    expect(expiredWaivers(entries, new Date('2027-04-01T00:00:01Z')).map((entry) => entry.path)).toEqual(['a', 'b']);
    // Sin fecha o con fecha ilegible no se declara caducada (aplicar la excepción es lo honesto).
    expect(expiredWaivers(entries, new Date('2999-01-01T00:00:00Z')).map((entry) => entry.path)).toEqual(['a', 'b']);
  });

  it('el parser acepta la forma heredada y la nueva, y rechaza lo que ya rechazaba', () => {
    const { entries, rejected } = parseSecurityAllowlist(
      JSON.stringify({
        allow: [
          { path: 'legacy.ts', ids: ['aws-access-key'], reason: 'heredada', actor: 'spec:demo' },
          {
            path: 'new.ts',
            ids: ['openai-key'],
            reason: 'con dueño y caducidad',
            actor: 'spec:demo',
            owner: 'seguridad',
            expires: '2027-03-31',
          },
          { path: 'x.ts', ids: [], reason: 'global' },
        ],
      }),
    );

    expect(rejected).toHaveLength(1);
    expect(entries).toHaveLength(2);
    expect(entries[0].owner).toBeUndefined();
    expect(entries[0].expires).toBeUndefined();
    expect(entries[1].owner).toBe('seguridad');
    expect(entries[1].expires).toBe('2027-03-31');
  });

  it('la lista viva del repositorio (15 entradas) sigue parseando con dueño y caducidad', async () => {
    // Un tmp dir se crea para confirmar que la lectura de la lista no escribe nada en el repo.
    const scratch = await makeTmp();
    expect(path.isAbsolute(scratch)).toBe(true);
    const raw = await readFile(path.join(repoRoot, '.sdd', 'settings', 'security-allowlist.json'), 'utf8');
    const { entries, rejected } = parseSecurityAllowlist(raw);

    expect(rejected).toEqual([]);
    expect(entries).toHaveLength(15);
    for (const entry of entries) {
      expect(entry.owner?.trim().length ?? 0).toBeGreaterThan(0);
      expect(entry.expires).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // A día de hoy la lista entera sigue vigente; pasada la fecha, caduca entera (y eso se verá).
    expect(expiredWaivers(entries, new Date('2026-01-01T00:00:00Z'))).toHaveLength(0);
    expect(expiredWaivers(entries, new Date('2027-04-01T00:00:00Z'))).toHaveLength(15);
  });
});
