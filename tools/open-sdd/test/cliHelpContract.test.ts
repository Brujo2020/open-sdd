/**
 * Una sola superficie de ayuda (W1, day 1).
 *
 * El defecto: `open-sdd help` listaba 8 comandos contra los 58 de `--help`, e `help gates` ignoraba
 * su argumento. Aquí se exige que la MISMA tabla sirva las tres proyecciones: el índice de `--help`,
 * la ayuda de cada comando y los temas.
 */

import { describe, it, expect } from 'vitest';
import { runCli } from '../src/index.js';
import {
  COMMANDS,
  KNOWN_COMMANDS,
  ROUTED_COMMANDS,
  renderCommandHelp,
  renderFullHelp,
} from '../src/cli/commands/help.js';

const runtime = { platform: 'darwin', env: {} } as const;

const makeIO = () => {
  const logs: string[] = [];
  const errs: string[] = [];
  return {
    io: { log: (m: string) => logs.push(m), error: (m: string) => errs.push(m), exit: () => {} },
    get logs() {
      return logs;
    },
    get errs() {
      return errs;
    },
  };
};

describe('help contract — one table, three projections', () => {
  it(
    'every routed command has its own help',
    async () => {
      for (const name of ROUTED_COMMANDS) {
        const ctx = makeIO();
        const code = await runCli(['help', name], runtime, ctx.io, {});
        expect(code, `help ${name}`).toBe(0);
        expect(ctx.logs.join('\n'), `help ${name}`).toContain(`Command: open-sdd ${name}`);
      }
    },
    // Una invocación de CLI por comando enrutado: bajo carga paralela esto supera el tope por
    // defecto. El aserto no se relaja; solo se le da margen.
    30_000,
  );

  it(
    'every routed command answers `<command> --help`',
    async () => {
      for (const name of ROUTED_COMMANDS) {
        const ctx = makeIO();
        const code = await runCli([name, '--help'], runtime, ctx.io, {});
        expect(code, `${name} --help`).toBe(0);
        expect(ctx.logs.join('\n'), `${name} --help`).toContain(`Command: open-sdd ${name}`);
      }
    },
    30_000,
  );

  it('the routed table and the help table are the same set', () => {
    for (const name of ROUTED_COMMANDS) expect(KNOWN_COMMANDS.has(name), name).toBe(true);
    expect(ROUTED_COMMANDS).toEqual(COMMANDS.map((doc) => doc.name));
  });

  it('the full help lists every routed command that is part of the index', () => {
    const help = renderFullHelp();
    for (const name of ROUTED_COMMANDS) {
      if (name === 'explain') continue; // se anuncia en LEARN MORE, no en el índice
      expect(help, name).toContain(name);
    }
  });

  it('init --help, doctor --help and integrate --help are command-specific', async () => {
    for (const name of ['init', 'doctor', 'integrate']) {
      const ctx = makeIO();
      expect(await runCli([name, '--help'], runtime, ctx.io, {})).toBe(0);
      const out = ctx.logs.join('\n');
      expect(out).toContain(`Command: open-sdd ${name}`);
      expect(out).not.toContain('Zero-Trust console'); // no es el índice
    }
  });

  it('help gates returns gates help, not the index', async () => {
    const ctx = makeIO();
    expect(await runCli(['help', 'gates'], runtime, ctx.io, {})).toBe(0);
    const out = ctx.logs.join('\n');
    expect(out).toContain('Command: open-sdd gates');
    expect(out).toContain('crosswalk');
    expect(out).not.toContain('Zero-Trust console');
  });

  it('--help carries the LEARN MORE block with its five topics', () => {
    const help = renderFullHelp();
    expect(help).toContain('LEARN MORE');
    for (const topic of [
      'open-sdd help rigor',
      'open-sdd help exit-codes',
      'open-sdd help formatting',
      'open-sdd explain C1',
      'docs/PAPER-ALIGNMENT.md',
    ]) {
      expect(help, topic).toContain(topic);
    }
  });

  it('help rigor renders the ladder from the rigor module, not prose', async () => {
    const ctx = makeIO();
    expect(await runCli(['help', 'rigor'], runtime, ctx.io, {})).toBe(0);
    const out = ctx.logs.join('\n');
    for (const level of ['spec-first', 'spec-anchored', 'spec-as-source']) expect(out).toContain(level);
    expect(out).toContain('the levels only ADD');
  });

  it('help formatting documents the color rules and the machine surface', async () => {
    const ctx = makeIO();
    expect(await runCli(['help', 'formatting'], runtime, ctx.io, {})).toBe(0);
    const out = ctx.logs.join('\n');
    expect(out).toContain('NO_COLOR');
    expect(out).toContain('FORCE_COLOR');
    expect(out).toContain('--color=auto|always|never');
    expect(out).toContain('PASS');
    expect(out).toContain('never localized');
  });

  it('an unknown help topic is a usage error with a suggestion', async () => {
    const ctx = makeIO();
    expect(await runCli(['help', 'gatesz'], runtime, ctx.io, {})).toBe(2);
    expect(ctx.errs.join('\n')).toContain('unknown help topic `gatesz`');
    expect(ctx.errs.join('\n')).toContain('did you mean `gates`');
  });

  it('the install examples use the derived scoped package, never the bare name', () => {
    const help = renderFullHelp();
    expect(help).toContain('npx @brujo2020/open-sdd@latest');
    expect(help).not.toContain('npx open-sdd@');
  });

  it('renderCommandHelp returns undefined for a command that is not routed', () => {
    expect(renderCommandHelp('not-a-command')).toBeUndefined();
  });
});
