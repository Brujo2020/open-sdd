import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { classifyChange, slugFromIntent } from '../src/core/route.js';
import { handleRouteCommand } from '../src/cli/commands/route.js';
import type { CliIO } from '../src/cli/io.js';

describe('core/route — right-size the process', () => {
  it('a typo with one file is S: no spec, the commit gate still runs', () => {
    const d = classifyChange({ intent: 'fix typo in README', files: ['README.md'] });
    expect(d.changeClass).toBe('S');
    expect(d.next.join(' ')).toContain('git commit');
  });

  it('a cosmetic intent is S even unsized', () => {
    expect(classifyChange({ intent: 'update docs wording' }).changeClass).toBe('S');
  });

  it('an unsized, non-cosmetic change is never S: M, with the unknown stated', () => {
    const d = classifyChange({ intent: 'add export to csv' });
    expect(d.changeClass).toBe('M');
    expect(d.unknown.length).toBeGreaterThan(0);
  });

  it('one risk signal on a few files is M with a delta and a requirements approval', () => {
    const d = classifyChange({ intent: 'add password reset', files: ['src/a.ts', 'src/b.ts', 'src/c.ts'] });
    expect(d.changeClass).toBe('M');
    expect(d.next[0]).toBe(`open-sdd delta init ${d.slug} "add password reset"`);
  });

  it('two risk signals, many files or a wide radius are L with the full triad', () => {
    expect(classifyChange({ intent: 'migrate billing schema', files: ['a.ts'] }).changeClass).toBe('L');
    expect(classifyChange({ intent: 'refactor widgets', files: Array.from({ length: 11 }, (_, i) => `f${i}.ts`) }).changeClass).toBe('L');
    expect(classifyChange({ intent: 'refactor widgets', files: ['a.ts'], blastRadius: 40 }).changeClass).toBe('L');
    expect(classifyChange({ intent: 'migrar esquema de pagos', files: ['a.ts'] }).artifacts[0]).toContain('triad');
  });

  it('slugs are ascii kebab-case from the first meaningful words', () => {
    expect(slugFromIntent('Añadir exportación a CSV para facturas')).toBe('anadir-exportacion-csv-para');
    expect(slugFromIntent('!!')).toBe('change');
  });
});

describe('open-sdd route — CLI', () => {
  const makeIO = () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const io: CliIO = { log: (m) => logs.push(m), error: (m) => errors.push(m), exit: () => undefined };
    return { io, logs, errors };
  };

  it('prints the class, the evidence and the next commands; --json is an envelope', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'open-sdd-route-'));
    try {
      const human = makeIO();
      expect(await handleRouteCommand(['fix', 'typo', '--files', 'README.md'], human.io, dir)).toBe(0);
      expect(human.logs.join('\n')).toContain('S — small');
      const machine = makeIO();
      expect(await handleRouteCommand(['add billing', '--no-forecast', '--json'], machine.io, dir)).toBe(0);
      expect(JSON.parse(machine.logs.join('\n')).data.changeClass).toBe('M');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('no intent is a usage error (2)', async () => {
    expect(await handleRouteCommand([], makeIO().io, tmpdir())).toBe(2);
  });
});
