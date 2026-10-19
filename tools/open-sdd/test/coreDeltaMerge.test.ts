import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  mergeDeltaIntoBase,
  parseDeltaSpec,
  renderDeltaSpec,
  type DeltaEntry,
  type DeltaSpec,
} from '../src/core/deltaSpec.js';
import { handleDeltaCommand } from '../src/cli/commands/brownfield.js';
import type { CliIO } from '../src/cli/io.js';

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

const makeIO = (): { io: CliIO; logs: string[]; errors: string[] } => {
  const logs: string[] = [];
  const errors: string[] = [];
  const io: CliIO = {
    log: (msg) => logs.push(msg),
    error: (msg) => errors.push(msg),
    exit: () => undefined,
  };
  return { io, logs, errors };
};

const BASE = `# Requirements — demo

**Objective:** demostrar la fusión.

## Requirements

### REQ-AUTH-001 — Sesión emitida

- Statement: WHEN a valid credential is presented, the service shall issue a session.
- Statement: The service shall log the issuance.

### REQ-AUTH-002 — Sesión revocada

- Statement: WHEN a session is revoked, the service shall reject it.

## Notes

Esta sección no es de requisitos y debe sobrevivir byte a byte.

- nota uno
`;

const entry = (overrides: Partial<DeltaEntry> = {}): DeltaEntry => ({
  id: 'REQ-AUTH-003',
  kind: 'ADDED',
  title: 'Auditoría',
  statement: 'WHEN a session is issued, the service shall record an audit entry.',
  targets: ['src/auth/audit.ts'],
  strangler: 'new',
  ...overrides,
});

const delta = (entries: DeltaEntry[], overrides: Partial<DeltaSpec> = {}): DeltaSpec => ({
  feature: 'demo',
  title: 'Cambio',
  status: 'proposed',
  entries,
  ...overrides,
});

const notesOf = (text: string): string => text.slice(text.indexOf('## Notes'));

describe('mergeDeltaIntoBase — ADSR', () => {
  it('ADDED inserta un bloque en la sección de requisitos y conserva el resto byte a byte', () => {
    const report = mergeDeltaIntoBase(delta([entry()]), BASE);

    expect(report.changed).toBe(true);
    expect(report.applied.map((c) => c.outcome)).toEqual(['added']);
    expect(report.text).toContain('### REQ-AUTH-003 — Auditoría');
    expect(report.text).toContain('- Statement: WHEN a session is issued, the service shall record an audit entry.');
    // El bloque nuevo vive dentro de `## Requirements`, antes de la sección ajena.
    expect(report.text.indexOf('### REQ-AUTH-003')).toBeLessThan(report.text.indexOf('## Notes'));
    expect(report.text.indexOf('### REQ-AUTH-003')).toBeGreaterThan(report.text.indexOf('### REQ-AUTH-002'));
    // Preservación: cabecera y sección ajena, idénticas.
    expect(report.text.slice(0, report.text.indexOf('### REQ-AUTH-001'))).toBe(
      BASE.slice(0, BASE.indexOf('### REQ-AUTH-001')),
    );
    expect(notesOf(report.text)).toBe(notesOf(BASE));
  });

  it('MODIFIED reescribe el bloque existente conservando su identificador', () => {
    const report = mergeDeltaIntoBase(
      delta([
        entry({
          id: 'REQ-AUTH-001',
          kind: 'MODIFIED',
          title: 'Sesión emitida (v2)',
          statement: 'WHEN a valid credential is presented, the service shall issue a signed session.',
          previous: 'REQ-AUTH-001 — Sesión emitida',
          contracts: ['test/auth.test.ts'],
        }),
      ]),
      BASE,
    );

    expect(report.changed).toBe(true);
    expect(report.text).toContain('### REQ-AUTH-001 — Sesión emitida (v2)');
    expect(report.text).toContain('- Statement: WHEN a valid credential is presented, the service shall issue a signed session.');
    expect(report.text).not.toContain('shall log the issuance');
    expect(report.text).toContain('### REQ-AUTH-002 — Sesión revocada');
    expect(notesOf(report.text)).toBe(notesOf(BASE));
  });

  it('REMOVED elimina el bloque y deja una sola separación en blanco', () => {
    const report = mergeDeltaIntoBase(
      delta([
        entry({
          id: 'REQ-AUTH-002',
          kind: 'REMOVED',
          title: 'Sesión revocada',
          statement: 'The service shall no longer revoke sessions.',
          previous: 'REQ-AUTH-002',
          rationale: 'Se retira el endpoint obsoleto.',
          contracts: ['test/auth.test.ts'],
        }),
      ]),
      BASE,
    );

    expect(report.changed).toBe(true);
    expect(report.text).not.toContain('REQ-AUTH-002');
    expect(report.text).toContain('REQ-AUTH-001');
    expect(report.text).not.toContain('\n\n\n');
    expect(notesOf(report.text)).toBe(notesOf(BASE));
  });

  it('RENAMED cambia solo el encabezado: el cuerpo sobrevive byte a byte', () => {
    const report = mergeDeltaIntoBase(
      delta([
        entry({
          id: 'REQ-AUTH-004',
          kind: 'RENAMED',
          title: 'Revocación',
          statement: 'WHEN a session is revoked, the service shall reject it.',
          previous: 'REQ-AUTH-002',
        }),
      ]),
      BASE,
    );

    expect(report.changed).toBe(true);
    expect(report.text).toContain('### REQ-AUTH-004 — Revocación');
    expect(report.text).not.toContain('### REQ-AUTH-002');
    expect(report.text).toContain('- Statement: WHEN a session is revoked, the service shall reject it.');
    expect(report.applied[0].outcome).toBe('renamed');
    expect(notesOf(report.text)).toBe(notesOf(BASE));
  });
});

describe('mergeDeltaIntoBase — rechazos', () => {
  it('rechaza un REMOVED cuyo objetivo no existe en la base y no toca la base', () => {
    const report = mergeDeltaIntoBase(
      delta([
        entry({
          id: 'REQ-AUTH-999',
          kind: 'REMOVED',
          title: 'Fantasma',
          statement: 'The service shall not do the thing.',
          previous: 'REQ-AUTH-999',
          rationale: 'No aplica.',
          contracts: ['test/auth.test.ts'],
        }),
      ]),
      BASE,
    );

    expect(report.changed).toBe(false);
    expect(report.text).toBe(BASE);
    expect(report.applied).toHaveLength(0);
    expect(report.refusals).toHaveLength(1);
    expect(report.refusals[0].message).toMatch(/no se puede eliminar/i);
    expect(report.detail).toMatch(/rechazada/i);
  });

  it('rechaza un MODIFIED sin `previous`', () => {
    const report = mergeDeltaIntoBase(
      delta([
        entry({ id: 'REQ-AUTH-001', kind: 'MODIFIED', title: 'Sin previous', statement: 'The service shall change.' }),
      ]),
      BASE,
    );

    expect(report.changed).toBe(false);
    expect(report.text).toBe(BASE);
    expect(report.refusals[0].message).toMatch(/previous/);
  });

  it('rechaza un RENAMED cuyo objetivo no existe', () => {
    const report = mergeDeltaIntoBase(
      delta([entry({ id: 'REQ-AUTH-004', kind: 'RENAMED', title: 'Nuevo', previous: 'REQ-AUTH-404' })]),
      BASE,
    );

    expect(report.changed).toBe(false);
    expect(report.refusals[0].message).toMatch(/no hay requisito que renombrar|no encuentra/i);
  });

  it('la fusión es todo o nada: una entrada rechazada impide aplicar las demás', () => {
    const report = mergeDeltaIntoBase(
      delta([
        entry(),
        entry({
          id: 'REQ-AUTH-999',
          kind: 'REMOVED',
          title: 'Fantasma',
          statement: 'The service shall not do the thing.',
          previous: 'REQ-AUTH-999',
          rationale: 'No aplica.',
          contracts: ['test/auth.test.ts'],
        }),
      ]),
      BASE,
    );

    expect(report.text).toBe(BASE);
    expect(report.applied).toHaveLength(0);
    expect(report.refusals).toHaveLength(1);
  });
});

describe('mergeDeltaIntoBase — idempotencia', () => {
  it('la segunda fusión reporta sin cambios y no duplica secciones', () => {
    const change = delta([
      entry(),
      entry({
        id: 'REQ-AUTH-002',
        kind: 'REMOVED',
        title: 'Sesión revocada',
        statement: 'The service shall no longer revoke sessions.',
        previous: 'REQ-AUTH-002',
        rationale: 'Se retira.',
        contracts: ['test/auth.test.ts'],
      }),
    ]);

    const first = mergeDeltaIntoBase(change, BASE);
    expect(first.changed).toBe(true);

    // El CLI marca las entradas como fusionadas al escribir; una REMOVED cuyo objetivo ya no está
    // necesita ese registro para distinguirse de una entrada que nunca tuvo objetivo.
    const merged: DeltaSpec = {
      ...change,
      status: 'merged',
      entries: change.entries.map((e) => ({ ...e, merged: true })),
    };
    const second = mergeDeltaIntoBase(merged, first.text);

    expect(second.changed).toBe(false);
    expect(second.text).toBe(first.text);
    expect(second.detail).toMatch(/sin cambios/);
    expect(second.applied).toHaveLength(0);
    expect((second.text.match(/### REQ-AUTH-003/g) ?? []).length).toBe(1);
    expect(second.text).not.toContain('REQ-AUTH-002');
  });

  it('sin el registro de fusión, una REMOVED sin objetivo se rechaza en vez de fingir éxito', () => {
    const change = delta([
      entry({
        id: 'REQ-AUTH-002',
        kind: 'REMOVED',
        title: 'Sesión revocada',
        statement: 'The service shall no longer revoke sessions.',
        previous: 'REQ-AUTH-002',
        rationale: 'Se retira.',
        contracts: ['test/auth.test.ts'],
      }),
    ]);
    const first = mergeDeltaIntoBase(change, BASE);
    const second = mergeDeltaIntoBase(change, first.text);

    // Contradicción declarada con el modelo: (delta, base) no basta para probar que la ausencia del
    // objetivo es una fusión previa. El registro por entrada (`Merged: true`) es lo que lo decide.
    expect(second.changed).toBe(false);
    expect(second.refusals).toHaveLength(1);
    expect(second.text).toBe(first.text);
  });

  it('`Merged: true` sobrevive al ida y vuelta markdown', () => {
    const spec = delta([entry({ merged: true })]);
    const round = parseDeltaSpec(renderDeltaSpec(spec));
    expect(round.entries[0].merged).toBe(true);
  });
});

describe('delta merge — CLI', () => {
  const cliFixture = async (): Promise<{ root: string; reqPath: string; deltaPath: string; change: DeltaSpec }> => {
    const root = await makeTemp('open-sdd-merge-');
    const change = delta([entry()]);
    await write(root, '.sdd/specs/demo/requirements.md', BASE);
    await write(root, '.sdd/specs/demo/delta.md', renderDeltaSpec(change));
    return {
      root,
      reqPath: path.join(root, '.sdd', 'specs', 'demo', 'requirements.md'),
      deltaPath: path.join(root, '.sdd', 'specs', 'demo', 'delta.md'),
      change,
    };
  };

  it('sin --write imprime el resumen y NO escribe la base', async () => {
    const { root, reqPath, deltaPath } = await cliFixture();
    const before = await readFile(reqPath, 'utf8');
    const deltaBefore = await readFile(deltaPath, 'utf8');
    const { io, logs } = makeIO();

    const code = await handleDeltaCommand(['merge', 'demo'], io, root);

    expect(code).toBe(0);
    expect(await readFile(reqPath, 'utf8')).toBe(before);
    expect(await readFile(deltaPath, 'utf8')).toBe(deltaBefore);
    const out = logs.join('\n');
    expect(out).toMatch(/Fusión de la delta/);
    expect(out).toMatch(/Nada se ha escrito/);
    expect(out).toContain('REQ-AUTH-003');
  });

  it('--write escribe la base y solo entonces marca la delta como merged', async () => {
    const { root, reqPath, deltaPath } = await cliFixture();
    const before = await readFile(reqPath, 'utf8');
    const { io } = makeIO();

    const code = await handleDeltaCommand(['merge', 'demo', '--write'], io, root);

    expect(code).toBe(0);
    const after = await readFile(reqPath, 'utf8');
    expect(after).not.toBe(before);
    expect(after).toContain('### REQ-AUTH-003 — Auditoría');
    const deltaAfter = await readFile(deltaPath, 'utf8');
    expect(deltaAfter).toMatch(/^Status: merged$/m);
    expect(deltaAfter).toMatch(/^- Merged: true$/m);
  });

  it('repetir --write reporta sin cambios y no duplica el bloque', async () => {
    const { root, reqPath } = await cliFixture();
    const { io, logs } = makeIO();

    await handleDeltaCommand(['merge', 'demo', '--write'], io, root);
    const afterFirst = await readFile(reqPath, 'utf8');
    logs.length = 0;

    const code = await handleDeltaCommand(['merge', 'demo', '--write'], io, root);

    expect(code).toBe(0);
    expect(await readFile(reqPath, 'utf8')).toBe(afterFirst);
    expect((afterFirst.match(/### REQ-AUTH-003/g) ?? []).length).toBe(1);
    expect(logs.join('\n')).toMatch(/sin cambios/i);
  });

  it('--json sin --write devuelve un informe con written:false', async () => {
    const { root, reqPath } = await cliFixture();
    const before = await readFile(reqPath, 'utf8');
    const { io, logs } = makeIO();

    const code = await handleDeltaCommand(['merge', 'demo', '--json'], io, root);

    expect(code).toBe(0);
    const payload = JSON.parse(logs.join('\n')) as { changed: boolean; written: boolean; applied: unknown[] };
    expect(payload.changed).toBe(true);
    expect(payload.written).toBe(false);
    expect(payload.applied).toHaveLength(1);
    expect(await readFile(reqPath, 'utf8')).toBe(before);
  });

  it('una fusión rechazada sale con 1 y deja la base intacta', async () => {
    const root = await makeTemp('open-sdd-merge-refuse-');
    const change = delta([
      entry({
        id: 'REQ-AUTH-999',
        kind: 'REMOVED',
        title: 'Fantasma',
        statement: 'The service shall not do the thing.',
        previous: 'REQ-AUTH-999',
        rationale: 'No aplica.',
        contracts: ['test/auth.test.ts'],
      }),
    ]);
    await write(root, '.sdd/specs/demo/requirements.md', BASE);
    await write(root, '.sdd/specs/demo/delta.md', renderDeltaSpec(change));
    const { io } = makeIO();

    const code = await handleDeltaCommand(['merge', 'demo', '--write'], io, root);

    expect(code).toBe(1);
    expect(await readFile(path.join(root, '.sdd', 'specs', 'demo', 'requirements.md'), 'utf8')).toBe(BASE);
  });
});
