/**
 * Pruebas de la capa i18n (REQ-MAT-009).
 *
 * Lo que estos tests protegen no es «hay traducciones», sino la HONESTIDAD de la capa: que una
 * clave sin traducir caiga a español y se REPORTE (nunca una cadena vacía), que una clave
 * inexistente se vea en pantalla, que la precedencia de idioma no ignore un valor inválido, y que
 * TODA clave de las superficies que decimos traducidas tenga de verdad su inglés.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DEFAULT_LOCALE,
  MESSAGES,
  SUPPORTED_LOCALES,
  createTranslator,
  loadConfiguredLocale,
  normalizeLocale,
  openI18n,
  parseLangFlag,
  resolveLocale,
  type Locale,
} from '../src/cli/i18n.js';
import { runCli } from '../src/index.js';

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

const makeRepo = async (files: Record<string, string> = {}): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-i18n-'));
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'i18n-fixture', version: '1.0.0' }));
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), content, 'utf8');
  }
  return dir;
};

afterEach(() => {
  delete process.env.OPEN_SDD_LANG;
});

describe('catalog integrity', () => {
  it('toda clave tiene español no vacío (la base de la caída)', () => {
    for (const [key, entry] of Object.entries(MESSAGES)) {
      expect(entry.es.trim().length, key).toBeGreaterThan(0);
    }
  });

  it('toda clave de tour y context —las superficies que decimos traducidas— tiene inglés', () => {
    const translated = Object.entries(MESSAGES).filter(
      ([key]) => key.startsWith('tour.') || key.startsWith('context.'),
    );
    expect(translated.length).toBeGreaterThan(20);
    for (const [key, entry] of translated) {
      expect(entry.en?.trim().length, key).toBeGreaterThan(0);
    }
  });
});

describe('createTranslator', () => {
  it('sirve inglés cuando existe la traducción', () => {
    const t = createTranslator('en');
    expect(t.t('tour.heading', { target: 'repo' })).toBe('Guided tour — repo');
    expect(t.hasFallbacks()).toBe(false);
  });

  it('una clave sin traducir cae a ESPAÑOL y se REPORTA, nunca vacía', () => {
    const t = createTranslator('en', { 'custom.only-es': { es: 'solo español' } });
    expect(t.t('custom.only-es')).toBe('solo español');
    expect(t.hasFallbacks()).toBe(true);
    expect(t.fallbacks()).toEqual([
      { key: 'custom.only-es', requested: 'en', used: 'es', reason: 'missing-translation' },
    ]);
    expect(t.report()).toContain('custom.only-es');
    expect(t.report()).toMatch(/se sirvió español/);
  });

  it('una clave inexistente se ve como marcador y se reporta como missing-key', () => {
    const t = createTranslator('en');
    const rendered = t.t('no.existe');
    expect(rendered).toBe('⟦no.existe⟧');
    expect(rendered.length).toBeGreaterThan(0);
    expect(t.fallbacks()[0]).toMatchObject({ key: 'no.existe', used: null, reason: 'missing-key' });
  });

  it('no repite el mismo aviso de caída dos veces', () => {
    const t = createTranslator('en', { 'custom.only-es': { es: 'solo español' } });
    t.t('custom.only-es');
    t.t('custom.only-es');
    expect(t.fallbacks()).toHaveLength(1);
  });

  it('en español no hay caídas para las claves base', () => {
    const t = createTranslator('es');
    expect(t.t('tour.heading', { target: 'x' })).toBe('Recorrido guiado — x');
    expect(t.hasFallbacks()).toBe(false);
  });
});

describe('locale selection', () => {
  it('normaliza variantes regionales y rechaza idiomas no soportados', () => {
    expect(normalizeLocale('EN')).toBe('en');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('es_ES')).toBe('es');
    expect(normalizeLocale('fr')).toBeUndefined();
    expect(SUPPORTED_LOCALES).toContain(DEFAULT_LOCALE);
  });

  it('lee --lang y --lang=', () => {
    expect(parseLangFlag(['--lang', 'en'])).toBe('en');
    expect(parseLangFlag(['--lang=en'])).toBe('en');
    expect(parseLangFlag(['--json'])).toBeUndefined();
  });

  it('respeta la precedencia flag > entorno > configuración > defecto', () => {
    expect(resolveLocale({ argv: ['--lang', 'en'], env: { OPEN_SDD_LANG: 'es' }, configured: { value: 'es' } })).toMatchObject({
      locale: 'en',
      source: 'flag',
    });
    expect(resolveLocale({ env: { OPEN_SDD_LANG: 'en' }, configured: { value: 'es' } })).toMatchObject({
      locale: 'en',
      source: 'env',
    });
    expect(resolveLocale({ configured: { value: 'en', path: '.sdd/settings/lang.json' } })).toMatchObject({
      locale: 'en',
      source: 'config',
      configPath: '.sdd/settings/lang.json',
    });
    expect(resolveLocale({})).toMatchObject({ locale: DEFAULT_LOCALE, source: 'default' });
  });

  it('un valor inválido se REGISTRA y no corta la cascada', () => {
    const resolution = resolveLocale({ argv: ['--lang', 'fr'], env: { OPEN_SDD_LANG: 'en' } });
    expect(resolution.locale).toBe('en');
    expect(resolution.source).toBe('env');
    expect(resolution.rejected).toEqual([{ value: 'fr', source: 'flag' }]);
  });

  it('lee el idioma de .sdd/settings/lang.json y del campo lang de rigor.json', async () => {
    const withLang = await makeRepo({ '.sdd/settings/lang.json': JSON.stringify({ lang: 'en' }) });
    expect(await loadConfiguredLocale(withLang, '.sdd')).toMatchObject({
      value: 'en',
      path: '.sdd/settings/lang.json',
    });
    const withRigor = await makeRepo({ '.sdd/settings/rigor.json': JSON.stringify({ level: 'spec-first', lang: 'en' }) });
    expect(await loadConfiguredLocale(withRigor, '.sdd')).toMatchObject({
      value: 'en',
      path: '.sdd/settings/rigor.json',
    });
    const none = await makeRepo();
    expect(await loadConfiguredLocale(none, '.sdd')).toEqual({});
  });

  it('openI18n combina la configuración del disco con la resolución', async () => {
    const dir = await makeRepo({ '.sdd/settings/lang.json': JSON.stringify({ lang: 'en' }) });
    const { translator, resolution } = await openI18n({ cwd: dir, sddDir: '.sdd' });
    expect(translator.locale).toBe('en');
    expect(resolution.source).toBe('config');
  });
});

describe('CLI integration', () => {
  it('--lang en traduce la salida del tour y deja la report de caídas vacía', async () => {
    const dir = await makeRepo();
    const ctx = makeIO();
    const code = await runCli(['tour', '--lang', 'en'], runtime, ctx.io, {}, { cwd: dir });
    expect(code).toBe(0);
    const output = ctx.logs.join('\n');
    expect(output).toContain('Guided tour');
    expect(output).toContain('HUMAN DECISION');
    expect(output).not.toContain('sin traducción');
  });

  it('OPEN_SDD_LANG selecciona el idioma cuando no hay --lang', async () => {
    process.env.OPEN_SDD_LANG = 'en';
    const dir = await makeRepo();
    const ctx = makeIO();
    const code = await runCli(['tour'], runtime, ctx.io, {}, { cwd: dir });
    expect(code).toBe(0);
    expect(ctx.logs.join('\n')).toContain('Guided tour');
  });

  it('sin selección, el comportamiento por defecto sigue siendo español', async () => {
    const dir = await makeRepo();
    const ctx = makeIO();
    await runCli(['tour'], runtime, ctx.io, {}, { cwd: dir });
    expect(ctx.logs.join('\n')).toContain('Recorrido guiado');
  });
});

// Una aserción de tipo: `Locale` es uniones cerradas, no cadena libre.
const narrowed: Locale = 'en';
void narrowed;
