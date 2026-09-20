/**
 * Capa de mensajes bilingüe (español / inglés), mínima y sin dependencias (REQ-MAT-009).
 *
 * ── Qué está traducido y qué NO ────────────────────────────────────────────────────────────────
 * Esta capa NO traduce el CLI entero, y decirlo es parte del contrato: una capa i18n que promete
 * más de lo que hace es peor que ninguna. El alcance exacto es:
 *
 *   TRADUCIDO (claves de este catálogo, servidas por `t()`):
 *     · `open-sdd tour`  — TODA su salida propia (pasos, comandos, motivos, handover).
 *     · `open-sdd context` — su render humano (`context.*`).
 *
 *   NO TRADUCIDO (permanece en español, con o sin `--lang en`):
 *     · El resto de comandos: status, brownfield, delta, gates, govern, assure, waves, floor,
 *       doctor, init, audit, gap, getspecs, verify, impl, help.
 *     · Los textos `detail`/`message` que produce el MOTOR (`src/core/**`): el pivote, el rigor,
 *       los gates… viajan en español y esta capa no los reescribe; solo traduce la "envoltura" de
 *       consola.
 *     · El texto de `--help` de `src/index.ts`.
 *
 * `TRANSLATED_SURFACES` y `UNTRANSLATED_SURFACES` hacen ese alcance legible por máquina, para que
 * un test o un lector no tengan que deducirlo del catálogo.
 *
 * ── La regla que hace honesta la caída a español ───────────────────────────────────────────────
 * Si una clave no tiene traducción al idioma pedido, `t()` NO devuelve cadena vacía: devuelve el
 * texto español y lo REGISTRA. Si la clave no existe en absoluto (ni en español), devuelve un
 * marcador visible `⟦clave⟧` y lo registra como error. `report()` pinta esos registros para que el
 * usuario sepa que leyó español y por qué. El silencio es el único resultado prohibido.
 *
 * ── Selección de idioma ────────────────────────────────────────────────────────────────────────
 * Precedencia: `--lang` > `OPEN_SDD_LANG` > configuración adyacente a `rigor.json`
 * (`.sdd/settings/lang.json`, o un campo `lang` en el propio `rigor.json`) > `es` (comportamiento
 * actual). Un valor no soportado se REGISTRA en `rejected` en vez de ignorarse.
 */

/**
 * Idiomas que ESTA capa sabe servir. El CLI instalador conoce más idiomas de plantillas
 * (`src/constants/languages.ts`); son cosas distintas y no se mezclan: aquí solo hay mensajes de
 * consola, y prometer un idioma que devolvería español en silencio sería la mentira que el header
 * prohíbe.
 */
export const SUPPORTED_LOCALES = ['es', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'es';

/** Superficies realmente traducidas por esta capa. */
export const TRANSLATED_SURFACES: readonly string[] = ['open-sdd tour', 'open-sdd context (render humano)'];
/** Superficies que siguen en español a propósito. */
export const UNTRANSLATED_SURFACES: readonly string[] = [
  'status',
  'brownfield',
  'delta',
  'gates',
  'govern',
  'assure',
  'waves',
  'floor',
  'gitflow',
  'progress',
  'backup',
  'biography',
  'doctor',
  'init',
  'audit',
  'gap',
  'getspecs',
  'verify',
  'impl',
  'help',
  'los textos detail/message que produce src/core/**',
  'el texto de --help de src/index.ts',
];

export interface MessageEntry {
  /** Texto base. Obligatorio: es a lo que cae cualquier idioma sin traducción. */
  es: string;
  en?: string;
}

/**
 * Catálogo. `es` es la base y SIEMPRE está; `en` es la traducción. Las claves se agrupan por
 * superficie (`tour.*`, `context.*`) para que el alcance sea visible.
 */
export const MESSAGES: Record<string, MessageEntry> = {
  // ── tour ────────────────────────────────────────────────────────────────────────────────────
  'tour.heading': { es: 'Recorrido guiado — {target}', en: 'Guided tour — {target}' },
  'tour.readOnly': {
    es: 'Modo solo lectura: ningún paso escribe (pasa --write para habilitar los que escriben).',
    en: 'Read-only mode: no step writes (pass --write to enable the writing ones).',
  },
  'tour.readWrite': {
    es: 'Modo --write: los pasos que escriben lo declaran antes de hacerlo; ratificar NUNCA se automatiza.',
    en: '--write mode: writing steps declare it before doing so; ratifying is NEVER automated.',
  },
  'tour.step': { es: 'Paso {n}/{total} — {title}', en: 'Step {n}/{total} — {title}' },
  'tour.command': { es: 'Comando: {command}', en: 'Command: {command}' },
  'tour.why': { es: 'Por qué: {why}', en: 'Why: {why}' },
  'tour.output': { es: 'Salida real:', en: 'Actual output:' },
  'tour.noOutput': { es: '(el comando no produjo salida)', en: '(the command produced no output)' },
  'tour.satisfied': { es: 'Ya satisfecho: {detail}', en: 'Already satisfied: {detail}' },
  'tour.prerequisite': {
    es: 'Prerrequisito que falta: {what}. El paso no se ejecuta y NO se salta en silencio.',
    en: 'Missing prerequisite: {what}. The step does not run and is NOT skipped silently.',
  },
  'tour.humanDecision': {
    es: 'DECISIÓN HUMANA: {what}. El recorrido se detiene aquí y te la entrega.',
    en: 'HUMAN DECISION: {what}. The tour stops here and hands it over to you.',
  },
  'tour.handover': { es: 'Entrega: ejecuta tú mismo {command}', en: 'Hand-over: run {command} yourself' },
  'tour.halted': {
    es: 'El recorrido se detiene en el paso {step}: los pasos siguientes quedan bloqueados hasta que una persona ratifique.',
    en: 'The tour stops at step {step}: the remaining steps stay blocked until a human ratifies.',
  },
  'tour.done': { es: 'Fin del recorrido.', en: 'End of tour.' },
  'tour.fallbacks': {
    es: 'i18n: {count} mensaje(s) sin traducción a "{locale}"; se sirvió español y se declara aquí (no en silencio).',
    en: 'i18n: {count} message(s) without a "{locale}" translation; Spanish was served and is declared here (not silently).',
  },
  'tour.recon.title': { es: 'Reconocimiento', en: 'Reconnaissance' },
  'tour.recon.why': {
    es: 'no se puede gobernar un repositorio que no se ha mirado; esto observa stack, tooling y módulos.',
    en: 'you cannot govern a repository you have not looked at; this observes stack, tooling and modules.',
  },
  'tour.constitution.title': { es: 'Borrador de constitución', en: 'Constitution draft' },
  'tour.constitution.why': {
    es: 'la constitución es la autoridad que un veredicto bloqueante debe poder citar; el borrador NO está en vigor.',
    en: 'the constitution is the authority a blocking verdict must be able to cite; the draft is NOT in force.',
  },
  'tour.constitution.satisfied': {
    es: 'constitución en vigor con {n} principio(s): no hay nada que ratificar en este paso',
    en: 'constitution in force with {n} principle(s): nothing to ratify at this step',
  },
  'tour.constitution.decision': {
    es: 'revisar y ratificar la constitución (una persona nombrada y un motivo; nunca se automatiza)',
    en: 'review and ratify the constitution (a named person and a reason; never automated)',
  },
  'tour.check.title': { es: 'Comprobación', en: 'Check' },
  'tour.check.why': {
    es: 'comprueba el repositorio contra el rigor declarado; un «no se pudo comprobar» nunca es un aprobado.',
    en: 'checks the repository against the declared rigor; a "could not check" is never a pass.',
  },
  'tour.status.title': { es: 'Panel de estado', en: 'Status dashboard' },
  'tour.status.why': {
    es: 'un solo panel con el estado completo y el siguiente comando concreto.',
    en: 'one dashboard with the complete state and the single next command.',
  },
  'tour.delta.title': { es: 'Contrato del cambio (delta)', en: 'Contract of change (delta)' },
  'tour.delta.why': {
    es: 'en brownfield la unidad de especificación es la delta, no el sistema entero.',
    en: 'in brownfield the unit of specification is the delta, not the whole system.',
  },
  'tour.prereq.constitution': {
    es: 'una constitución ratificada y en vigor (.sdd/steering/constitution.md)',
    en: 'a ratified constitution in force (.sdd/steering/constitution.md)',
  },
  'tour.prereq.target': {
    es: 'un directorio de repositorio legible (el reconocimiento no pudo correr)',
    en: 'a readable repository directory (reconnaissance could not run)',
  },
  'tour.target.missing': {
    es: 'el directorio objetivo "{target}" no existe o no es legible',
    en: 'the target directory "{target}" does not exist or is not readable',
  },
  'tour.stepFailed': {
    es: 'el paso falló: {error}',
    en: 'the step failed: {error}',
  },
  'tour.prereq.identity': {
    es: 'un slug de feature y una descripción del cambio, que aporta una persona',
    en: 'a feature slug and a description of the change, supplied by a human',
  },
  // ── context ─────────────────────────────────────────────────────────────────────────────────
  'context.heading': { es: 'Context pack — {feature}', en: 'Context pack — {feature}' },
  'context.featureNone': { es: '(sin feature)', en: '(no feature)' },
  'context.complete': {
    es: 'COMPLETO: constitución, spec, mapa de módulos y rigor presentes.',
    en: 'COMPLETE: constitution, spec, module map and rigor are present.',
  },
  'context.incomplete': {
    es: 'INCOMPLETO: falta {list}.',
    en: 'INCOMPLETE: missing {list}.',
  },
  'context.constitution': { es: 'Constitución', en: 'Constitution' },
  'context.spec': { es: 'Especificación', en: 'Spec' },
  'context.moduleMap': { es: 'Mapa de módulos', en: 'Module map' },
  'context.rigor': { es: 'Rigor declarado', en: 'Declared rigor' },
  'context.present': { es: 'presente', en: 'present' },
  'context.absentLabel': { es: 'AUSENTE', en: 'ABSENT' },
  'context.principles': { es: '{n} principio(s) en vigor', en: '{n} principle(s) in force' },
  'context.issues': { es: '{n} problema(s) de validación', en: '{n} validation issue(s)' },
  'context.modules': { es: '{n} módulo(s)', en: '{n} module(s)' },
  'context.gates': { es: 'gates activos: {gates}', en: 'active gates: {gates}' },
  'context.reason': { es: 'motivo: {reason}', en: 'reason: {reason}' },
  'context.absentHeading': { es: 'Ausente, y por qué', en: 'Absent, and why' },
  'context.absentNone': {
    es: 'nada ausente: el pack está completo',
    en: 'nothing absent: the pack is complete',
  },
  'context.nextCommand': { es: 'Siguiente: {command}', en: 'Next: {command}' },
};

export interface TranslationFallback {
  key: string;
  requested: Locale;
  /** Idioma realmente servido; null cuando la clave no existe ni en español. */
  used: Locale | null;
  reason: 'missing-translation' | 'missing-key';
}

/** Marcador visible para una clave inexistente: nunca una cadena vacía. */
export const MISSING_KEY_MARKER = (key: string): string => `⟦${key}⟧`;

export interface Translator {
  locale: Locale;
  /** Traducir con interpolación `{var}`. Registra caídas; nunca devuelve vacío. */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Caídas observadas, en orden de primera aparición. */
  fallbacks: () => TranslationFallback[];
  hasFallbacks: () => boolean;
  /** Una línea para la consola; cadena vacía cuando no hay caídas. */
  report: () => string;
  /** Idempotente desde el punto de vista del llamante: reinicia el registro. */
  reset: () => void;
}

const interpolate = (template: string, vars?: Record<string, string | number>): string => {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
};

/**
 * Crear un traductor para un idioma. `catalog` es inyectable para poder PROBAR la caída sin tocar
 * el catálogo real (y para que un consumidor pueda añadir mensajes propios).
 */
export const createTranslator = (
  locale: Locale = DEFAULT_LOCALE,
  catalog: Record<string, MessageEntry> = MESSAGES,
): Translator => {
  const seen = new Set<string>();
  const fallbacks: TranslationFallback[] = [];

  const record = (fallback: TranslationFallback): void => {
    const id = `${fallback.reason}:${fallback.key}`;
    if (seen.has(id)) return;
    seen.add(id);
    fallbacks.push(fallback);
  };

  const t = (key: string, vars?: Record<string, string | number>): string => {
    const entry = catalog[key];
    if (!entry) {
      record({ key, requested: locale, used: null, reason: 'missing-key' });
      return MISSING_KEY_MARKER(key);
    }
    if (locale !== DEFAULT_LOCALE && !entry[locale]) {
      record({ key, requested: locale, used: DEFAULT_LOCALE, reason: 'missing-translation' });
      return interpolate(entry[DEFAULT_LOCALE], vars);
    }
    return interpolate(entry[locale] ?? entry[DEFAULT_LOCALE], vars);
  };

  return {
    locale,
    t,
    fallbacks: () => [...fallbacks],
    hasFallbacks: () => fallbacks.length > 0,
    report: () => {
      if (fallbacks.length === 0) return '';
      const keys = fallbacks.map((fallback) => fallback.key).join(', ');
      return `i18n: ${fallbacks.length} mensaje(s) sin traducción a "${locale}": ${keys}; se sirvió español y se declara aquí (no en silencio).`;
    },
    reset: () => {
      seen.clear();
      fallbacks.length = 0;
    },
  };
};

/** Normalizar `en`, `EN`, `en-US`, `es_ES`… a un idioma soportado; `undefined` si no lo es. */
export const normalizeLocale = (value: string | undefined | null): Locale | undefined => {
  if (typeof value !== 'string') return undefined;
  const base = value.trim().toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(base) ? (base as Locale) : undefined;
};

export interface RejectedLocale {
  value: string;
  source: LocaleSource;
}

export type LocaleSource = 'flag' | 'env' | 'config' | 'default';

export interface LocaleResolution {
  locale: Locale;
  source: LocaleSource;
  /** Valores pedidos que no se reconocen, nombrados en vez de ignorados. */
  rejected: RejectedLocale[];
  /** De dónde salió el valor de configuración, cuando aplica. */
  configPath?: string;
}

/** `--lang en` y `--lang=en`, sin depender del parser de flags global (los subcomandos van antes). */
export const parseLangFlag = (argv: string[]): string | undefined => {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--lang') {
      const next = argv[i + 1];
      return next === undefined || next.startsWith('-') ? '' : next;
    }
    if (token.startsWith('--lang=')) return token.slice('--lang='.length);
  }
  return undefined;
};

export interface ConfiguredLocale {
  value?: string;
  /** Ruta del fichero del que salió (relativa), para poder reportarla. */
  path?: string;
}

const readJsonLang = async (abs: string): Promise<string | undefined> => {
  try {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(abs, 'utf8');
    const parsed = JSON.parse(raw) as { lang?: unknown; language?: unknown };
    const value = parsed?.lang ?? parsed?.language;
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  } catch {
    // Ausente o ilegible: la configuración no puede tumbar la selección de idioma.
    return undefined;
  }
};

/**
 * Leer el idioma de la configuración adyacente a `rigor.json`.
 *
 * Primero `.sdd/settings/lang.json` (`{ "lang": "en" }`), después un campo `lang`/`language` dentro
 * del propio `.sdd/settings/rigor.json`. Ausente o ilegible → `undefined` sin lanzar: no hay
 * configuración de idioma obligatoria.
 */
export const loadConfiguredLocale = async (cwd: string, sddDir: string = '.sdd'): Promise<ConfiguredLocale> => {
  const path = await import('node:path');
  const dedicated = path.join(cwd, sddDir, 'settings', 'lang.json');
  const fromDedicated = await readJsonLang(dedicated);
  if (fromDedicated) return { value: fromDedicated, path: path.posix.join(sddDir, 'settings', 'lang.json') };
  const rigor = path.join(cwd, sddDir, 'settings', 'rigor.json');
  const fromRigor = await readJsonLang(rigor);
  if (fromRigor) return { value: fromRigor, path: path.posix.join(sddDir, 'settings', 'rigor.json') };
  return {};
};

export interface ResolveLocaleInput {
  argv?: string[];
  env?: Record<string, string | undefined>;
  /** Resultado de `loadConfiguredLocale`; se pasa ya leído para no atar esta función a fs. */
  configured?: ConfiguredLocale;
}

/**
 * Resolver el idioma. Precedencia: `--lang` > `OPEN_SDD_LANG` > configuración > `es`.
 *
 * Un valor no soportado NO corta la cascada: se registra en `rejected` y se sigue mirando la
 * siguiente fuente, porque un `--lang fr` mal tecleado no debe impedir que `OPEN_SDD_LANG=en` surta
 * efecto. Al final, el idioma es siempre uno soportado.
 */
export const resolveLocale = (input: ResolveLocaleInput = {}): LocaleResolution => {
  const rejected: RejectedLocale[] = [];
  const consider = (raw: string | undefined, source: LocaleSource): Locale | undefined => {
    if (raw === undefined) return undefined;
    const normalized = normalizeLocale(raw);
    if (!normalized && raw.trim().length > 0) rejected.push({ value: raw, source });
    return normalized;
  };

  const flag = consider(parseLangFlag(input.argv ?? []), 'flag');
  if (flag) return { locale: flag, source: 'flag', rejected };
  const env = consider(input.env?.OPEN_SDD_LANG, 'env');
  if (env) return { locale: env, source: 'env', rejected };
  const config = consider(input.configured?.value, 'config');
  if (config) {
    return {
      locale: config,
      source: 'config',
      rejected,
      ...(input.configured?.path ? { configPath: input.configured.path } : {}),
    };
  }
  return { locale: DEFAULT_LOCALE, source: 'default', rejected };
};

/** Resolver + leer configuración + construir el traductor: la puerta que usan los comandos. */
export const openI18n = async (input: {
  argv?: string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
  sddDir?: string;
}): Promise<{ translator: Translator; resolution: LocaleResolution }> => {
  const configured = input.cwd ? await loadConfiguredLocale(input.cwd, input.sddDir ?? '.sdd') : {};
  const resolution = resolveLocale({
    ...(input.argv ? { argv: input.argv } : {}),
    ...(input.env ? { env: input.env } : {}),
    configured,
  });
  return { translator: createTranslator(resolution.locale), resolution };
};

/** Los valores rechazados, en una línea, para que `--lang fr` se vea en vez de caer a español. */
export const rejectionsReport = (resolution: LocaleResolution): string =>
  resolution.rejected.length === 0
    ? ''
    : `i18n: idioma solicitado no soportado (${resolution.rejected
        .map((entry) => `"${entry.value}" desde ${entry.source}`)
        .join(', ')}); admitidos: ${SUPPORTED_LOCALES.join(', ')}. Se usa "${resolution.locale}".`;
