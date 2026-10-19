/**
 * Color y énfasis de la consola — reglas del contrato de consola (W1.1).
 *
 * ── Precedencia (de mayor a menor) ─────────────────────────────────────────────────────────────
 *   `--color=auto|always|never`  la decisión explícita del invocante (la fija `src/index.ts`).
 *   `FORCE_COLOR`                presente y distinto de `0`/`false` → color y énfasis.
 *   `NO_COLOR`                   presente y NO vacío → apaga el COLOR, nunca el énfasis (bold/dim).
 *   TTY                          sin ninguna de las señales anteriores, el color sigue a `isTTY`.
 *
 * La regla de `NO_COLOR` es la del propio contrato («present and non-empty disables»), no la del
 * literal `'1'`: `NO_COLOR=true` también apaga el color. El énfasis (bold/dim) NO es color: sigue
 * disponible porque un título en negrita no es una señal que dependa del color.
 *
 * ── El color nunca es la única señal ───────────────────────────────────────────────────────────
 * `formatVerdict` emite SIEMPRE el glifo (`✓`/`!`/`✗`) y la palabra (`PASS`/`WARN`/`FAIL`), con o
 * sin color. Un lector con daltonismo, un log sin ANSI o un `--color=never` siguen viendo el
 * veredicto.
 */

export type ColorMode = 'auto' | 'always' | 'never';

export interface ColorEnvironment {
  /** Modo explícito; por defecto, el fijado con `setColorMode`. */
  mode?: ColorMode;
  /** Entorno a consultar; por defecto, `process.env`. */
  env?: Record<string, string | undefined>;
  /** Si la salida es un TTY; por defecto, `process.stdout.isTTY`. */
  isTTY?: boolean;
}

export interface ColorSupport {
  /** Color de primer plano (verde, rojo, amarillo…). `NO_COLOR` lo apaga. */
  color: boolean;
  /** Énfasis (negrita, atenuado). `NO_COLOR` NO lo apaga. */
  style: boolean;
}

let colorMode: ColorMode = 'auto';

/** Fijar el modo global. Lo llama `src/index.ts` al leer `--color`. */
export const setColorMode = (mode: ColorMode): void => {
  colorMode = mode;
};

export const getColorMode = (): ColorMode => colorMode;

const forceColor = (env: Record<string, string | undefined>): boolean => {
  const raw = env.FORCE_COLOR;
  if (typeof raw !== 'string') return false;
  const value = raw.trim().toLowerCase();
  return value.length > 0 && value !== '0' && value !== 'false';
};

const noColor = (env: Record<string, string | undefined>): boolean =>
  typeof env.NO_COLOR === 'string' && env.NO_COLOR.length > 0;

/** Resolver color y énfasis. Función pura: testeable sin tocar el TTY real. */
export const resolveColorSupport = (input: ColorEnvironment = {}): ColorSupport => {
  const mode = input.mode ?? colorMode;
  if (mode === 'always') return { color: true, style: true };
  if (mode === 'never') return { color: false, style: false };
  const env = input.env ?? process.env;
  if (forceColor(env)) return { color: true, style: true };
  const isTTY = input.isTTY ?? !!process.stdout.isTTY;
  return { color: !noColor(env) && isTTY, style: isTTY };
};

const wrap = (open: string, close: string, kind: 'color' | 'style') => {
  return (value: string): string => {
    const support = resolveColorSupport();
    const enabled = kind === 'color' ? support.color : support.style;
    if (!enabled) return value;
    return `${open}${value}${close}`;
  };
};

export const colors = {
  green: wrap('\u001b[32m', '\u001b[39m', 'color'),
  red: wrap('\u001b[31m', '\u001b[39m', 'color'),
  yellow: wrap('\u001b[33m', '\u001b[39m', 'color'),
  cyan: wrap('\u001b[36m', '\u001b[39m', 'color'),
  magenta: wrap('\u001b[35m', '\u001b[39m', 'color'),
  bold: wrap('\u001b[1m', '\u001b[22m', 'style'),
  dim: wrap('\u001b[2m', '\u001b[22m', 'style'),
  white: wrap('\u001b[37m', '\u001b[39m', 'color'),
  reset: (value: string): string => value,
};

export const formatLabel = (label: string): string => colors.bold(colors.cyan(label));

export const formatHeading = (label: string): string => colors.bold(label);

export const formatSuccess = (msg: string): string => colors.green(msg);

export const formatWarning = (msg: string): string => colors.yellow(msg);

export const formatError = (msg: string): string => colors.red(msg);

export const formatAttention = (msg: string): string => {
  const { color, style } = resolveColorSupport();
  if (!color && !style) return msg;
  return `${color ? '\u001b[93m' : ''}${style ? '\u001b[1m' : ''}${msg}${style ? '\u001b[22m' : ''}${color ? '\u001b[39m' : ''}`;
};

/**
 * Título de sección en UNA línea con secuencias ANSI reales. La versión anterior escribía el
 * literal `[35m[1m== … ==[22m[39m` (sin ESC) y además partía la salida en dos líneas.
 */
export const formatSectionTitle = (label: string): string => {
  const { color, style } = resolveColorSupport();
  if (!color && !style) return `== ${label} ==`;
  const open = `${color ? '\u001b[35m' : ''}${style ? '\u001b[1m' : ''}`;
  const close = `${style ? '\u001b[22m' : ''}${color ? '\u001b[39m' : ''}`;
  return `${open}== ${label} ==${close}`;
};

export const formatBox = (title: string): string => {
  const line = '─'.repeat(title.length + 4);
  if (!resolveColorSupport().style) return `${line}\n  ${title}\n${line}`;
  return `${colors.dim(line)}\n  ${colors.bold(title)}\n${colors.dim(line)}`;
};

export const VERDICT_GLYPHS = { pass: '✓', warn: '!', fail: '✗' } as const;
export const VERDICT_WORDS = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' } as const;
export type Verdict = keyof typeof VERDICT_GLYPHS;

/**
 * Glifo + palabra + mensaje. El color es decoración: incluso en `--color=never` el veredicto se
 * lee por el glifo y por la palabra.
 */
export const formatVerdict = (verdict: Verdict, message: string): string => {
  const paint = verdict === 'pass' ? colors.green : verdict === 'warn' ? colors.yellow : colors.red;
  return `${paint(VERDICT_GLYPHS[verdict])} ${colors.bold(VERDICT_WORDS[verdict])} ${message}`;
};
