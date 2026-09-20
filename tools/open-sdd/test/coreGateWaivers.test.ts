/**
 * El gate C2 y las excepciones de seguridad con dueño y caducidad (REQ-MAT-012).
 *
 * `core/securityAllowlist.ts` ya devuelve `decision.waivers`, pero un veredicto que solo imprime
 * `kind:id file:line` deja «el gate falla y dice a quién preguntar» como una promesa de la API, no
 * del producto. Estas pruebas fijan que C2 NOMBRA el caso: una excepción caducada devuelve el
 * hallazgo con dueño y fecha, y una excepción sin dueño se declara débil (aviso) sin convertirse en
 * fallo. Los fixtures viven en `os.tmpdir()` y se limpian en `afterEach`: nada se escribe dentro del
 * repositorio.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runGate, type GateRunContext } from '../src/core/gateRunner.js';
import { applySecurityAllowlist, type SecurityAllowlistEntry } from '../src/core/securityAllowlist.js';

const dirs: string[] = [];

const makeTmp = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-gate-waivers-'));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true });
});

const ctxFor = (cwd: string, over: Partial<GateRunContext> = {}): GateRunContext => ({
  cwd,
  sddDir: '.sdd',
  feature: 'demo',
  changedFiles: [],
  declaredScope: [],
  ...over,
});

/** Un fichero con un solo hallazgo: la clave AWS, que no dispara `generic-assignment`. */
const writeSecret = async (cwd: string, name: string): Promise<void> => {
  await writeFile(path.join(cwd, name), 'const awsKey = "AKIAIOSFODNN7EXAMPLE";\n', 'utf8');
};

const expiredEntry: SecurityAllowlistEntry = {
  path: 'expired.ts',
  ids: ['aws-access-key'],
  reason: 'fixture de prueba',
  actor: 'spec:demo',
  owner: 'equipo-seguridad',
  expires: '2020-01-01',
};

describe('core/gateRunner C2 — el dueño de una excepción caducada', () => {
  it('nombra al responsable y la fecha cuando el hallazgo se mantiene por caducidad', async () => {
    const cwd = await makeTmp();
    await writeSecret(cwd, 'expired.ts');

    const finding = await runGate(
      'C2',
      ctxFor(cwd, { changedFiles: ['expired.ts'], securityAllowlist: [expiredEntry] }),
    );

    // La excepción caducada NO suprime: el gate falla…
    expect(finding.outcome).toBe('fail');
    // …y el fallo dice a quién preguntar y desde cuándo.
    expect(finding.detail).toContain('excepción caducada el 2020-01-01');
    expect(finding.detail).toContain('responsable: equipo-seguridad');
    expect(finding.evidence?.join('\n')).toContain('excepción caducada el 2020-01-01');
    expect(finding.evidence?.join('\n')).toContain('responsable: equipo-seguridad');
    expect(finding.evidence?.join('\n')).toContain('expired.ts:1');
  });

  it('declara «sin dueño declarado» cuando la excepción caducada tampoco tiene owner', async () => {
    const cwd = await makeTmp();
    await writeSecret(cwd, 'expired.ts');

    const finding = await runGate(
      'C2',
      ctxFor(cwd, {
        changedFiles: ['expired.ts'],
        securityAllowlist: [{ ...expiredEntry, owner: undefined }],
      }),
    );

    expect(finding.outcome).toBe('fail');
    expect(finding.detail).toContain('excepción caducada el 2020-01-01');
    expect(finding.detail).toContain('responsable: (sin dueño declarado)');
  });

  it('una excepción SIN DUEÑO se aplica pero C2 la declara débil (aviso, no fallo)', async () => {
    const cwd = await makeTmp();
    await writeSecret(cwd, 'weak.ts');

    const finding = await runGate(
      'C2',
      ctxFor(cwd, {
        changedFiles: ['weak.ts'],
        securityAllowlist: [{ path: 'weak.ts', ids: ['aws-access-key'], reason: 'heredada sin dueño', actor: 'spec:demo' }],
      }),
    );

    // Suprime (la lista heredada no rompe el gate)…
    expect(finding.outcome).toBe('pass');
    // …pero el aviso nombra lo que falta y dónde arreglarlo.
    expect(finding.detail).toContain('waiverWeak');
    expect(finding.detail).toContain('sin dueño');
    expect(finding.detail).toContain('weak.ts');
    expect(finding.detail).toContain('.sdd/settings/security-allowlist.json');
    expect(finding.evidence?.join('\n')).toContain('waiverWeak');
    expect(finding.evidence?.join('\n')).toContain('excepción sin dueño ("owner") en weak.ts');
  });

  it('un hallazgo vigente convive con una excepción caducada y con una débil en el mismo veredicto', async () => {
    const cwd = await makeTmp();
    await writeSecret(cwd, 'expired.ts');
    await writeSecret(cwd, 'weak.ts');

    const finding = await runGate(
      'C2',
      ctxFor(cwd, {
        changedFiles: ['expired.ts', 'weak.ts'],
        securityAllowlist: [
          expiredEntry,
          { path: 'weak.ts', ids: ['aws-access-key'], reason: 'heredada sin dueño', actor: 'spec:demo' },
        ],
      }),
    );

    expect(finding.outcome).toBe('fail');
    expect(finding.detail).toContain('excepción caducada el 2020-01-01');
    expect(finding.detail).toContain('responsable: equipo-seguridad');
    expect(finding.detail).toContain('waiverWeak');
    expect(finding.detail).toContain('1 hallazgo(s) de línea base de seguridad');
  });

  it('no toca la forma de kept/suppressed que fija enforcementFloor', () => {
    // La superficie del gate es ADITIVA: `securityAllowlist` sigue devolviendo exactamente estas
    // claves, y por eso `test/enforcementFloor.test.ts` sigue pasando sin cambios.
    const decision = applySecurityAllowlist(
      [{ id: 'aws-access-key', kind: 'secret', file: 'expired.ts', line: 1 }],
      [expiredEntry],
    );

    expect(Object.keys(decision.kept[0]).sort()).toEqual(
      ['expires', 'file', 'id', 'kind', 'line', 'owner', 'waiverExpired'].sort(),
    );
    expect(decision.suppressed).toEqual([]);

    const suppressedDecision = applySecurityAllowlist(
      [{ id: 'aws-access-key', kind: 'secret', file: 'weak.ts', line: 3 }],
      [{ path: 'weak.ts', ids: ['aws-access-key'], reason: 'heredada sin dueño' }],
    );
    expect(Object.keys(suppressedDecision.suppressed[0]).sort()).toEqual(['file', 'id', 'line', 'reason']);
    expect(suppressedDecision.kept).toEqual([]);
  });
});
