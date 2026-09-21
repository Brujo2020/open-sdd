/**
 * Contrato de códigos de salida y "sin línea de éxito tras un fallo" (W1.1, tenet 11).
 *
 * Lo que se protege:
 *   · un comando desconocido y un subcomando desconocido salen con 2 (uso), con sugerencia y con el
 *     puntero a `--help`, y NUNCA caen al camino de instalación;
 *   · un fallo nunca termina en la puerta de puntuación (`gates chainn` imprimía «gates OK» tras
 *     salir con 1);
 *   · `help exit-codes` documenta las cinco clases y reconcilia el centinela del bucle del anfitrión.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli } from '../src/index.js';
import { EXIT, EXIT_CODES } from '../src/cli/commands/help.js';

const runtime = { platform: 'darwin', env: {} } as const;
const FOOTER = /^SDD \d+%/m;

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

const makeCwd = (): Promise<string> => mkdtemp(path.join(tmpdir(), 'sdd-exit-'));

describe('exit-code contract', () => {
  it('EXIT defines the five classes of tenet 11', () => {
    expect(EXIT).toEqual({ PASSED: 0, GATE_FAILED: 1, USAGE: 2, ENVIRONMENT: 3, TOOL_BUG: 4 });
    expect(EXIT_CODES.map((entry) => entry.code)).toEqual([0, 1, 2, 3, 4]);
  });

  it('an unknown command exits 2, suggests the nearest match and points at --help', async () => {
    const ctx = makeIO();
    const code = await runCli(['statu'], runtime, ctx.io, {});
    expect(code).toBe(EXIT.USAGE);
    const errs = ctx.errs.join('\n');
    expect(errs).toContain('unknown command `statu`');
    expect(errs).toContain('did you mean `status`');
    expect(errs).toContain('open-sdd --help');
    // Nunca el camino de instalación, nunca una línea de éxito.
    expect(ctx.logs.join('\n')).not.toMatch(FOOTER);
    expect(ctx.logs.join('\n')).not.toContain('files written');
  });

  it('an unknown subcommand exits 2 with a suggestion and never prints the score door', async () => {
    const cwd = await makeCwd();
    const ctx = makeIO();
    const code = await runCli(['gates', 'chainn'], runtime, ctx.io, {}, { cwd });
    expect(code).toBe(EXIT.USAGE);
    const errs = ctx.errs.join('\n');
    expect(errs).toContain('unknown subcommand `chainn`');
    expect(errs).toContain('did you mean `chain`');
    const all = `${ctx.logs.join('\n')}\n${errs}`;
    expect(all).not.toMatch(FOOTER);
    expect(all).not.toContain('gates OK');
  });

  it('a subcommand unknown to `delta`, `brownfield` and `standards` is also a usage error', async () => {
    const cwd = await makeCwd();
    for (const argv of [
      ['delta', 'validat'],
      ['brownfield', 'survei'],
      ['standards', 'chek'],
      ['requirements', 'reviw'],
    ]) {
      const ctx = makeIO();
      const code = await runCli(argv, runtime, ctx.io, {}, { cwd });
      expect(code, argv.join(' ')).toBe(EXIT.USAGE);
      expect(ctx.errs.join('\n'), argv.join(' ')).toContain('unknown subcommand');
    }
  }, 20_000);

  it('a non-zero exit never prints the score door', async () => {
    const cwd = await makeCwd();
    const ctx = makeIO();
    const code = await runCli(['verify', 'no-such-feature'], runtime, ctx.io, {}, { cwd });
    expect(code).not.toBe(0);
    expect(ctx.logs.join('\n')).not.toMatch(FOOTER);
  });

  it('a gate-chain command keeps an honest footer even when it fails', async () => {
    const cwd = await makeCwd();
    const ctx = makeIO();
    const code = await runCli(['gates', 'run'], runtime, ctx.io, {}, { cwd });
    const out = ctx.logs.join('\n');
    expect(code).not.toBe(0);
    expect(out).not.toContain('gates OK');
    // El pie no puede reproducir la cadena que el propio comando ejecutó: la declara no medida.
    if (FOOTER.test(out)) expect(out).toContain('no medidos en esta ejecución');
  });

  it('help exit-codes documents 0–4 and reconciles the host-loop sentinel', async () => {
    const ctx = makeIO();
    const code = await runCli(['help', 'exit-codes'], runtime, ctx.io, {});
    expect(code).toBe(EXIT.PASSED);
    const out = ctx.logs.join('\n');
    for (const line of EXIT_CODES) expect(out, String(line.code)).toContain(String(line.code));
    expect(out).toContain('host-loop sentinel');
    expect(out).toContain('exit 2');
    expect(out).toContain('usage error');
    expect(out).toContain('governance failure');
  });

  it('explain resolves a gate code offline, and an unknown one is a usage error', async () => {
    const ok = makeIO();
    expect(await runCli(['explain', 'C1'], runtime, ok.io, {})).toBe(EXIT.PASSED);
    expect(ok.logs.join('\n')).toContain('C1');
    expect(ok.logs.join('\n')).toContain('posture');

    const bad = makeIO();
    expect(await runCli(['explain', 'C9'], runtime, bad.io, {})).toBe(EXIT.USAGE);
    expect(bad.errs.join('\n')).toContain('unknown gate code `C9`');
    expect(bad.errs.join('\n')).toContain('open-sdd gates list');
  });

  it('a bad --color value is a usage error', async () => {
    const ctx = makeIO();
    expect(await runCli(['--color=bogus'], runtime, ctx.io, {})).toBe(EXIT.USAGE);
    expect(ctx.errs.join('\n')).toContain('--color');
  });
});
