/**
 * Color y accesibilidad (W1.1, W1 day 1).
 *
 * Los defectos: `formatSectionTitle` no emitía los bytes ESC e imprimía un literal `[35m…` en dos
 * líneas; `NO_COLOR !== '1'` solo reconocía el literal `1`; no había `FORCE_COLOR` ni `--color`; y el
 * color podía ser la única señal del veredicto.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  VERDICT_GLYPHS,
  VERDICT_WORDS,
  formatSectionTitle,
  formatVerdict,
  resolveColorSupport,
  setColorMode,
} from '../src/cli/ui/colors.js';
import { runCli } from '../src/index.js';

const runtime = { platform: 'darwin', env: {} } as const;

afterEach(() => setColorMode('auto'));

describe('color and accessibility', () => {
  it('formatSectionTitle emits real ANSI on one line', () => {
    setColorMode('always');
    const title = formatSectionTitle('X');
    // La igualdad exacta ya prueba que los bytes ESC están: el defecto era el literal sin ESC.
    expect(title).toBe('\u001b[35m\u001b[1m== X ==\u001b[22m\u001b[39m');
    expect(title).not.toContain('\n');
    expect(title.startsWith('\u001b[')).toBe(true);
  });

  it('formatSectionTitle is plain when color and style are off', () => {
    setColorMode('never');
    expect(formatSectionTitle('X')).toBe('== X ==');
  });

  it('NO_COLOR present and non-empty disables color but not bold/dim', () => {
    expect(resolveColorSupport({ mode: 'auto', env: { NO_COLOR: '1' }, isTTY: true })).toEqual({
      color: false,
      style: true,
    });
    expect(resolveColorSupport({ mode: 'auto', env: { NO_COLOR: 'true' }, isTTY: true })).toEqual({
      color: false,
      style: true,
    });
    // Presente pero vacío NO apaga (el contrato es «present and non-empty»).
    expect(resolveColorSupport({ mode: 'auto', env: { NO_COLOR: '' }, isTTY: true })).toEqual({
      color: true,
      style: true,
    });
    expect(resolveColorSupport({ mode: 'auto', env: {}, isTTY: true })).toEqual({ color: true, style: true });
    expect(resolveColorSupport({ mode: 'auto', env: {}, isTTY: false })).toEqual({ color: false, style: false });
  });

  it('FORCE_COLOR forces color without a TTY; 0/false do not', () => {
    expect(resolveColorSupport({ mode: 'auto', env: { FORCE_COLOR: '1' }, isTTY: false })).toEqual({
      color: true,
      style: true,
    });
    expect(resolveColorSupport({ mode: 'auto', env: { FORCE_COLOR: '0' }, isTTY: false })).toEqual({
      color: false,
      style: false,
    });
    expect(resolveColorSupport({ mode: 'auto', env: { FORCE_COLOR: 'false' }, isTTY: false })).toEqual({
      color: false,
      style: false,
    });
  });

  it('--color=never/always win over the environment', () => {
    expect(resolveColorSupport({ mode: 'never', env: { FORCE_COLOR: '1' }, isTTY: true })).toEqual({
      color: false,
      style: false,
    });
    expect(resolveColorSupport({ mode: 'always', env: { NO_COLOR: '1' }, isTTY: false })).toEqual({
      color: true,
      style: true,
    });
  });

  it('color is never the only signal: the glyph and the word are always present', () => {
    for (const verdict of ['pass', 'warn', 'fail'] as const) {
      setColorMode('never');
      const plain = formatVerdict(verdict, 'message');
      expect(plain).toContain(VERDICT_GLYPHS[verdict]);
      expect(plain).toContain(VERDICT_WORDS[verdict]);
      setColorMode('always');
      const colored = formatVerdict(verdict, 'message');
      expect(colored).toContain(VERDICT_GLYPHS[verdict]);
      expect(colored).toContain(VERDICT_WORDS[verdict]);
    }
  });

  it('the global --color flag is accepted and a bad value is refused', async () => {
    const logs: string[] = [];
    const errs: string[] = [];
    const io = { log: (m: string) => logs.push(m), error: (m: string) => errs.push(m), exit: () => {} };

    expect(await runCli(['--color=never', '--version'], runtime, io, {})).toBe(0);
    expect(logs.join('\n')).not.toContain('\u001b[');

    const bad = { log: () => {}, error: (m: string) => errs.push(m), exit: () => {} };
    expect(await runCli(['--color=maybe', 'help'], runtime, bad, {})).toBe(2);
    expect(errs.join('\n')).toContain('--color');
  });

  it('--color=always makes the help carry ANSI; --color=never keeps it plain', async () => {
    const capture = async (mode: string): Promise<string> => {
      const logs: string[] = [];
      const io = { log: (m: string) => logs.push(m), error: () => {}, exit: () => {} };
      await runCli([mode, 'help', 'formatting'], runtime, io, {});
      return logs.join('\n');
    };
    expect(await capture('--color=always')).toContain('\u001b[');
    expect(await capture('--color=never')).not.toContain('\u001b[');
  });
});
