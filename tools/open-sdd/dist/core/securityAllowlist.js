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
/** Parse and validate the allow-list. An entry without a path, ids or reason is rejected. */
export const parseSecurityAllowlist = (jsonText) => {
    const entries = [];
    const rejected = [];
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    }
    catch {
        return {
            entries: [],
            rejected: [{ path: '(documento)', reason: 'JSON inválido: no se pudo leer la lista' }],
        };
    }
    const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.allow)
            ? parsed.allow
            : [];
    for (const raw of list) {
        const entry = raw;
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
const isExpired = (expires, now) => {
    if (!expires)
        return false;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(expires);
    const parsed = Date.parse(dateOnly ? `${expires}T23:59:59.999Z` : expires);
    if (Number.isNaN(parsed))
        return false;
    return now.getTime() > parsed;
};
/** Excepciones cuya caducidad ya pasó, con `now` inyectable para que el reloj no sea un supuesto. */
export const expiredWaivers = (entries, now = new Date()) => entries.filter((entry) => isExpired(entry.expires, now));
const normalize = (p) => p.replace(/^\.\//, '');
/** Path match: exact, or directory prefix when the entry ends with `/`. */
const pathMatches = (file, entryPath) => {
    const f = normalize(file);
    const e = normalize(entryPath);
    return e.endsWith('/') ? f.startsWith(e) || f.includes(`/${e}`) : f === e || f.endsWith(`/${e}`);
};
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
export const applySecurityAllowlist = (findings, entries, options = {}) => {
    const now = options.now ?? new Date();
    const kept = [];
    const suppressed = [];
    const waivers = [];
    for (const finding of findings) {
        const entry = entries.find((e) => e.ids.includes(finding.id) && pathMatches(finding.file, e.path));
        if (!entry) {
            kept.push(finding);
            continue;
        }
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
    return { kept, suppressed, waivers };
};
