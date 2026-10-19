/**
 * Security allow-list for gate C2 (G5, "Línea Base de Seguridad").
 *
 * A secret scanner has an unavoidable false-positive class: test fixtures that must LOOK like
 * credentials, the scanner's own pattern table, and documentation that quotes a destructive
 * command to forbid it. Run naively, C2 blocks those commits, and a gate that blocks honest work
 * is a gate that gets disabled — the exact dynamic the reference architecture documents.
 *
 * So suppression exists, under three rules that keep it a control rather than a mute button:
 *
 *   1. It is DECLARED, per (path, pattern id), never global.
 *   2. It is RECORDED: one entry per concession with a reason and an actor, in the same spirit as
 *      invariant I6 — every relaxation is an event, not an absence.
 *   3. It is REPORTED: a run prints how many findings were suppressed and which ones, so a
 *      suppression can never be mistaken for a clean scan.
 *
 * Known residual risk, stated rather than hidden: a REAL credential added to an allow-listed file
 * under an allow-listed pattern id is suppressed. The allow-list is per (file, id) precisely to
 * narrow that window, and the entries are reviewed like any other configuration.
 */

export interface SecurityAllowlistEntry {
  /** Repository-relative path, or a directory prefix ending in `/`. */
  path: string;
  /** Pattern ids from the scanner that are expected in this path. */
  ids: string[];
  /** Why the pattern is expected here. Required, non-empty. */
  reason: string;
  /** Who accepted the concession. Required, non-empty — a self-granted concession is not one. */
  actor?: string;
  /**
   * Quién responde HOY de la excepción (REQ-MAT-012). Opcional para no romper la forma heredada,
   * pero su ausencia se declara `waiverWeak`: una excepción sin dueño no tiene a quién preguntar.
   */
  owner?: string;
  /**
   * Fecha ISO (`YYYY-MM-DD`) en la que la excepción caduca. Opcional: la forma heredada sin caducidad
   * sigue siendo válida, pero una excepción caducada deja de aplicarse (ver `expiredWaivers`).
   */
  expires?: string;
}

export interface AllowlistParseResult {
  entries: SecurityAllowlistEntry[];
  /** Entries that were unusable, reported instead of being silently ignored. */
  rejected: { path: string; reason: string }[];
}

/** Parse and validate the allow-list. An entry without a path, ids or reason is rejected. */
export const parseSecurityAllowlist = (jsonText: string): AllowlistParseResult => {
  const entries: SecurityAllowlistEntry[] = [];
  const rejected: { path: string; reason: string }[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      entries: [],
      rejected: [{ path: '(documento)', reason: 'JSON inválido: no se pudo leer la lista' }],
    };
  }

  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { allow?: unknown })?.allow)
      ? (parsed as { allow: unknown[] }).allow
      : [];

  for (const raw of list) {
    const entry = raw as Partial<SecurityAllowlistEntry>;
    const path = typeof entry.path === 'string' ? entry.path.trim() : '';
    const ids = Array.isArray(entry.ids) ? entry.ids.filter((i) => typeof i === 'string') : [];
    const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';
    const owner = typeof entry.owner === 'string' && entry.owner.trim() ? entry.owner.trim() : undefined;
    const expires = typeof entry.expires === 'string' && entry.expires.trim() ? entry.expires.trim() : undefined;

    if (!path) {
      rejected.push({ path: '(sin ruta)', reason: 'falta path' });
      continue;
    }
    if (ids.length === 0) {
      rejected.push({ path, reason: 'falta ids (una excepción global no es una excepción)' });
      continue;
    }
    if (!reason) {
      rejected.push({ path, reason: 'falta reason: toda relajación es un evento registrado' });
      continue;
    }
    entries.push({
      path,
      ids,
      reason,
      ...(entry.actor ? { actor: entry.actor } : {}),
      ...(owner ? { owner } : {}),
      ...(expires ? { expires } : {}),
    });
  }

  return { entries, rejected };
};

/**
 * Una fecha `YYYY-MM-DD` caduca al FINAL de ese día (23:59:59.999 UTC), que es lo que «expires
 * 2027-03-31» significa para quien la escribe: válida durante todo el día. Una fecha con hora se
 * interpreta literalmente. Una caducidad ilegible NO se trata como caducada ni como eterna por
 * accidente: se ignora la caducidad (la excepción sigue aplicándose) y el llamante la ve como
 * excepción sin fecha. La alternativa —rechazar la entrada— borraría silenciosamente una excepción
 * declarada, que es peor que aplicarla con una fecha que no se entiende.
 */
const isExpired = (expires: string | undefined, now: Date): boolean => {
  if (!expires) return false;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(expires);
  const parsed = Date.parse(dateOnly ? `${expires}T23:59:59.999Z` : expires);
  if (Number.isNaN(parsed)) return false;
  return now.getTime() > parsed;
};

/** Excepciones cuya caducidad ya pasó, con `now` inyectable para que el reloj no sea un supuesto. */
export const expiredWaivers = (
  entries: SecurityAllowlistEntry[],
  now: Date = new Date(),
): SecurityAllowlistEntry[] => entries.filter((entry) => isExpired(entry.expires, now));

const normalize = (p: string): string => p.replace(/^\.\//, '');

/** Path match: exact, or directory prefix when the entry ends with `/`. */
const pathMatches = (file: string, entryPath: string): boolean => {
  const f = normalize(file);
  const e = normalize(entryPath);
  return e.endsWith('/') ? f.startsWith(e) || f.includes(`/${e}`) : f === e || f.endsWith(`/${e}`);
};

export interface AllowlistDecision {
  kept: {
    id: string;
    kind: string;
    file: string;
    line: number;
    /** La excepción que cubría este hallazgo estaba CADUCADA: no se aplicó. */
    waiverExpired?: true;
    owner?: string;
    expires?: string;
  }[];
  suppressed: { id: string; file: string; line: number; reason: string }[];
  /**
   * Notas de gobernanza de las excepciones (REQ-MAT-012). No todas las excepciones son iguales:
   * una caducada NO suprime y una sin dueño suprime pero se declara débil. El veredicto del gate
   * sigue viviendo en `kept`/`suppressed`; esto es lo que se puede contar y auditar.
   */
  waivers: WaiverNote[];
}

export interface WaiverNote {
  /**
   * `waiverExpired` = la excepción caducó y el hallazgo vuelve a contar. `waiverWeak` = sin dueño.
   * `waiverUnused` = el fichero se escaneó y la excepción no suprimió nada: deuda que nadie retirará.
   */
  code: 'waiverExpired' | 'waiverWeak' | 'waiverUnused';
  severity: 'error' | 'warning';
  id: string;
  file: string;
  line: number;
  reason: string;
  owner?: string;
  expires?: string;
  message: string;
  /** Ruta de la excepción, para poder ir a arreglarla. */
  waiverPath: string;
}

export interface ApplyAllowlistOptions {
  /** Reloj inyectable: sin él, «caducada» dependería del día en que se ejecute la prueba. */
  now?: Date;
  /**
   * Los ficheros que el escáner miró DE VERDAD. Sin esta lista no se puede afirmar que una excepción
   * no se usó —«no la vi» no es «no existe»—, así que `waiverUnused` solo se emite cuando se conoce el
   * conjunto escaneado y la ruta de la excepción cae dentro de él.
   */
  scannedFiles?: string[];
}

/**
 * Split findings into those that stand and those an entry covers, citing the covering reason.
 *
 * ── Caducidad y dueño (REQ-MAT-012) ─────────────────────────────────────────────────────────────
 *  1. Una excepción CADUCADA no se aplica: el hallazgo vuelve a `kept` marcado `waiverExpired: true`
 *     y con el dueño y la fecha, para que el gate falle NOMBRANDO a quién preguntar.
 *  2. Una excepción SIN DUEÑO sí se aplica (la supresión está declarada y motivada), pero se declara
 *     `waiverWeak` con severidad `warn`: nadie responde de ella y una excepción sin dueño es una
 *     excepción que nadie retirará. NO se convierte en fallo: eso convertiría cualquier lista
 *     heredada en un gate roto el día del despliegue, que es justo el motivo por el que el mecanismo
 *     de excepciones existe. La debilidad se REPORTA, que es lo que el contrato pide.
 */
export const applySecurityAllowlist = (
  findings: { id: string; kind: string; file: string; line: number }[],
  entries: SecurityAllowlistEntry[],
  options: ApplyAllowlistOptions = {},
): AllowlistDecision => {
  const now = options.now ?? new Date();
  const kept: AllowlistDecision['kept'] = [];
  const suppressed: AllowlistDecision['suppressed'] = [];
  const waivers: WaiverNote[] = [];
  const usedEntries = new Set<SecurityAllowlistEntry>();

  for (const finding of findings) {
    const entry = entries.find((e) => e.ids.includes(finding.id) && pathMatches(finding.file, e.path));
    if (!entry) {
      kept.push(finding);
      continue;
    }
    usedEntries.add(entry);

    if (isExpired(entry.expires, now)) {
      kept.push({
        ...finding,
        waiverExpired: true,
        ...(entry.owner ? { owner: entry.owner } : {}),
        ...(entry.expires ? { expires: entry.expires } : {}),
      });
      waivers.push({
        code: 'waiverExpired',
        severity: 'error',
        id: finding.id,
        file: finding.file,
        line: finding.line,
        reason: entry.reason,
        ...(entry.owner ? { owner: entry.owner } : {}),
        ...(entry.expires ? { expires: entry.expires } : {}),
        waiverPath: entry.path,
        message: `La excepción de ${entry.path} para "${finding.id}" caducó el ${entry.expires ?? '(sin fecha)'} y ya no se aplica: el hallazgo de ${finding.file}:${finding.line} vuelve a contar.${entry.owner ? ` Pregunta a ${entry.owner} si debe renovarse.` : ' La excepción no declara dueño, así que no hay a quién preguntar.'}`,
      });
      continue;
    }

    suppressed.push({ id: finding.id, file: finding.file, line: finding.line, reason: entry.reason });
    if (!entry.owner) {
      waivers.push({
        code: 'waiverWeak',
        severity: 'warning',
        id: finding.id,
        file: finding.file,
        line: finding.line,
        reason: entry.reason,
        ...(entry.expires ? { expires: entry.expires } : {}),
        waiverPath: entry.path,
        message: `La excepción de ${entry.path} para "${finding.id}" se aplicó pero no declara dueño: nadie responde de ella. Añade "owner" (y de ser posible "expires") en .sdd/settings/security-allowlist.json.`,
      });
    }
  }

  // ── Supresiones que ya no suprimen (REQ-STD-007) ──────────────────────────────────────────────
  // Una excepción cuyo fichero se escaneó y que no cubrió ningún hallazgo es deuda aceptada que nadie
  // retirará. Se emite como AVISO, nunca como fallo: convertir una lista heredada en un gate roto el
  // día del despliegue es justo lo que el mecanismo de excepciones existe para evitar. La diferencia
  // con no poder saberlo es `scannedFiles`: sin el conjunto escaneado, «no la vi» no es «no existe» y
  // este módulo se calla en vez de inventar una acusación.
  if (options.scannedFiles) {
    const scanned = options.scannedFiles;
    for (const entry of entries) {
      if (usedEntries.has(entry)) continue;
      if (!scanned.some((file) => pathMatches(file, entry.path))) continue;
      waivers.push({
        code: 'waiverUnused',
        severity: 'warning',
        id: entry.ids.join('/'),
        file: entry.path,
        line: 0,
        reason: entry.reason,
        ...(entry.owner ? { owner: entry.owner } : {}),
        ...(entry.expires ? { expires: entry.expires } : {}),
        waiverPath: entry.path,
        message: `La excepción de ${entry.path} para "${entry.ids.join(', ')}" no suprimió nada en este cambio: el fichero se escaneó y el hallazgo no apareció. Una excepción que ya no suprime es deuda que nadie retirará: bórrala, o explica por qué sigue declarada.`,
      });
    }
  }

  return { kept, suppressed, waivers };
};
