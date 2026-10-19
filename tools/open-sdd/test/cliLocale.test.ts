/**
 * Locales honestas (REQ-RQC-012, W1 day 1).
 *
 * El defecto: `SUPPORTED_LOCALES = ['es','en']` pero `--lang ja` se aceptaba en silencio con salida
 * sin traducir, el defecto era un `'es'` hardcodeado y el `detail` del sobre JSON viajaba localizado.
 * Lo que se exige aquí:
 *   · una locale distinta de `es`/`en` se RECHAZA por nombre, listando las traducidas, con código 2;
 *   · el defecto sale del entorno (`LANG`…) y no de una constante;
 *   · `detail` es inglés estable bajo cualquier locale;
 *   · se conservan las reglas de honestidad (nunca vacío, claves marcadas, caídas registradas).
 */

import { describe, it, expect } from 'vitest';
import { runCli } from '../src/index.js';
import {
  DEFAULT_LOCALE,
  MISSING_KEY_MARKER,
  SUPPORTED_LOCALES,
  createTranslator,
  detectEnvironmentLocale,
  localeRefusal,
  normalizeLocale,
  resolveLocale,
  stableEnvelopeDetail,
} from '../src/cli/i18n.js';
import { jsonEnvelope } from '../src/cli/jsonOut.js';

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

describe('locale contract — honest locales', () => {
  it('SUPPORTED_LOCALES is the translated set and the default is a last resort', () => {
    expect([...SUPPORTED_LOCALES]).toEqual(['es', 'en']);
    expect(SUPPORTED_LOCALES).toContain(DEFAULT_LOCALE);
  });

  it('the default locale comes from the environment, never a hardcoded es', () => {
    expect(detectEnvironmentLocale({ LANG: 'en_US.UTF-8' })).toEqual({ locale: 'en', key: 'LANG' });
    expect(detectEnvironmentLocale({ LC_ALL: 'es_ES.UTF-8', LANG: 'en_US.UTF-8' })).toEqual({
      locale: 'es',
      key: 'LC_ALL',
    });
    expect(detectEnvironmentLocale({ LANG: 'fr_FR.UTF-8' })).toBeUndefined();
    expect(resolveLocale({ env: { LANG: 'en_US.UTF-8' } })).toMatchObject({ locale: 'en', source: 'environment' });
  });

  it('precedence: flag > OPEN_SDD_LANG > project config > environment > last resort', () => {
    expect(
      resolveLocale({ argv: ['--lang', 'es'], env: { OPEN_SDD_LANG: 'en', LANG: 'en_US.UTF-8' } }),
    ).toMatchObject({ locale: 'es', source: 'flag' });
    expect(resolveLocale({ env: { OPEN_SDD_LANG: 'es', LANG: 'en_US.UTF-8' } })).toMatchObject({
      locale: 'es',
      source: 'env',
    });
    expect(
      resolveLocale({ configured: { value: 'en', path: '.sdd/settings/lang.json' }, env: { LANG: 'es_ES.UTF-8' } }),
    ).toMatchObject({ locale: 'en', source: 'config' });
    // Sin ninguna señal, el contrato de «sin entorno» sigue cayendo al último recurso.
    expect(resolveLocale({})).toMatchObject({ locale: DEFAULT_LOCALE, source: 'default' });
  });

  it('normalizes regional variants and rejects the rest', () => {
    expect(normalizeLocale('EN')).toBe('en');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('es_ES')).toBe('es');
    expect(normalizeLocale('ja')).toBeUndefined();
  });

  it('refuses a locale other than es/en by name, listing the translated ones, with exit 2', async () => {
    const ctx = makeIO();
    const code = await runCli(['tour', '--lang', 'ja'], runtime, ctx.io, {});
    expect(code).toBe(2);
    const errs = ctx.errs.join('\n');
    expect(errs).toContain('unsupported locale `ja`');
    expect(errs).toContain('`es`');
    expect(errs).toContain('`en`');
    expect(errs).toContain('open-sdd --help');
  });

  it('refuses an untranslated locale on the installer path too', async () => {
    const ctx = makeIO();
    expect(await runCli(['--lang', 'zh-TW'], runtime, ctx.io, {})).toBe(2);
    expect(ctx.errs.join('\n')).toContain('unsupported locale `zh-TW`');
  });

  it('localeRefusal names the value and the translated list', () => {
    expect(localeRefusal('ja')).toContain('`ja`');
    expect(localeRefusal('ja')).toContain('`es`');
    expect(localeRefusal('ja')).toContain('`en`');
  });

  it('the json envelope detail is stable English under every locale', () => {
    const failed = { command: 'status', ok: false, errors: 1, warnings: 2 } as const;
    expect(stableEnvelopeDetail(failed)).toBe(stableEnvelopeDetail(failed));
    expect(stableEnvelopeDetail(failed)).toMatch(/^command "status" failed with 1 error\(s\), 2 warning\(s\)$/);
    expect(stableEnvelopeDetail({ command: 'status', ok: true })).toMatch(/^command "status" completed/);

    // El sobre compartido conserva la forma; el `detail` que se le pasa no depende del locale.
    const envelope = jsonEnvelope({
      command: 'status',
      data: null,
      errors: ['boom'],
      detail: stableEnvelopeDetail({ command: 'status', ok: false, errors: 1 }),
    });
    expect(envelope.detail).toMatch(/^command "status"/);
    expect(envelope.detail).not.toContain('Comando');
  });

  it('keeps the honesty rules: fallback recorded, missing key marked, never empty', () => {
    const t = createTranslator('en', { 'custom.only-es': { es: 'solo español' } });
    expect(t.t('custom.only-es')).toBe('solo español');
    expect(t.fallbacks()).toEqual([
      { key: 'custom.only-es', requested: 'en', used: 'es', reason: 'missing-translation' },
    ]);
    const missing = t.t('no.existe');
    expect(missing).toBe(MISSING_KEY_MARKER('no.existe'));
    expect(missing.length).toBeGreaterThan(0);
    expect(t.fallbacks().some((entry) => entry.reason === 'missing-key')).toBe(true);
  });
});
