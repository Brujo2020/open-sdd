/**
 * Prompts que fallan nombrando la bandera (W1 day 1).
 *
 * El defecto: tres sitios lanzaban el desnudo `TTY required for interactive prompts`, que no dice
 * qué hacer. Ahora el error nombra `--yes` y `--no-input`, y `NONINTERACTIVE=1` / `OPEN_SDD_PROMPT=0`
 * desactivan los prompts.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  isInteractive,
  isPromptDisabled,
  nonInteractiveEnvReason,
  promptConfirm,
  promptSelect,
  promptsBlocked,
  setNonInteractive,
} from '../src/cli/ui/prompt.js';
import { runCli } from '../src/index.js';

const runtime = { platform: 'darwin', env: {} } as const;

afterEach(() => setNonInteractive(false));

describe('prompt contract', () => {
  it('a prompt that cannot run names --yes and --no-input', async () => {
    setNonInteractive(false);
    await expect(promptSelect('pick one', [{ value: 'a', label: 'A' }])).rejects.toThrow(/--yes/);
    await expect(promptSelect('pick one', [{ value: 'a', label: 'A' }])).rejects.toThrow(/--no-input/);
    await expect(promptConfirm('continue?')).rejects.toThrow(/--no-input/);
    // Nunca el mensaje desnudo anterior.
    await expect(promptConfirm('continue?')).rejects.not.toThrow(/^TTY required for interactive prompts$/);
  });

  it('NONINTERACTIVE=1 and OPEN_SDD_PROMPT=0 disable prompts, by name', () => {
    expect(nonInteractiveEnvReason({ NONINTERACTIVE: '1' })).toBe('`NONINTERACTIVE=1`');
    expect(nonInteractiveEnvReason({ OPEN_SDD_PROMPT: '0' })).toBe('`OPEN_SDD_PROMPT=0`');
    expect(nonInteractiveEnvReason({})).toBeNull();
    expect(promptsBlocked({ NONINTERACTIVE: '1' })).toBe('`NONINTERACTIVE=1`');
    expect(promptsBlocked({ OPEN_SDD_PROMPT: '0' })).toBe('`OPEN_SDD_PROMPT=0`');
    expect(promptsBlocked({})).toBeNull();
  });

  it('--no-input sets the non-interactive flag and is reported by name', () => {
    setNonInteractive(true);
    expect(isPromptDisabled()).toBe(true);
    expect(isInteractive()).toBe(false);
    expect(promptsBlocked()).toBe('`--no-input`');
  });

  it('runCli wires the global --no-input flag', async () => {
    const logs: string[] = [];
    const errs: string[] = [];
    const io = { log: (m: string) => logs.push(m), error: (m: string) => errs.push(m), exit: () => {} };
    expect(await runCli(['--no-input', '--version'], runtime, io, {})).toBe(0);
    expect(logs.join('\n')).toContain('open-sdd v');
    // El flag global no llega a `parseArgs` como bandera desconocida.
    expect(errs.join('\n')).not.toContain('Unknown flag');
  });
});
