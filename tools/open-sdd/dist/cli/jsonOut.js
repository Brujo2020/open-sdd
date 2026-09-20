/**
 * Sobre JSON compartido por los comandos del CLI (`--json`).
 *
 * El CLI tiene hoy un `--json` por comando, y cada uno inventó su forma. Eso hace que un script que
 * encadena comandos tenga que aprender cinco gramáticas distintas para lo mismo: «¿salió bien?»,
 * «¿qué datos?», «¿qué errores?». `jsonEnvelope` fija UNA forma estable:
 *
 *   { ok, command, data, findings: { errors, warnings }, detail }
 *
 * ── Reglas del sobre ────────────────────────────────────────────────────────────────────────────
 *  1. `ok` es la respuesta a «¿puedo seguir?» y se deriva de `errors`: sin errores, `ok: true`. Se
 *     puede forzar explícitamente cuando el veredicto no es simplemente «hay errores» (por ejemplo,
 *     un comando que sale con 0 pero quiere declarar que quedó algo sin inspeccionar).
 *  2. `findings` es SIEMPRE un objeto con dos listas, nunca ausente: un consumidor puede leer
 *     `.findings.errors.length` sin comprobar `undefined`. Cada hallazgo es `{ id?, message, artifact? }`;
 *     las cadenas sueltas se aceptan y se normalizan a `{ message }` para no obligar a reescribir el
 *     llamante.
 *  3. `detail` es una línea en español legible por humanos; `renderJsonEnvelope` la usa para el
 *     resumen de una línea. El orden de las claves del objeto es fijo, para que el JSON sea
 *     comparable por diff.
 *  4. El sobre NO ejecuta nada ni conoce los comandos: es forma, no lógica. Un comando adoptante
 *     sigue siendo responsable de su veredicto (y de su código de salida).
 *
 * ── Adopción incremental (declarada, no supuesta) ───────────────────────────────────────────────
 * Este helper es nuevo y se adopta comando a comando; NO se ha reescrito ningún comando existente
 * para no romper contratos ya fijados por tests (por ejemplo, `status --json` sin feature devuelve
 * la lista heredada por spec). Comandos que AÚN NO emiten este sobre y conservan su `--json` previo:
 *
 *   - src/cli/commands/status.ts       (`--json` heredado + StatusReport)
 *   - src/cli/commands/brownfield.ts   (survey/constitution/bootstrap/impact/contracts/reuse/delta)
 *   - src/cli/commands/paper.ts        (gates/govern/assure/waves/floor)
 *   - src/cli/commands/audit.ts
 *   - src/cli/commands/gap.ts
 *   - src/cli/commands/getspecs.ts
 *   - src/cli/commands/impl.ts
 *   - src/cli/commands/init.ts
 *   - src/cli/commands/verify.ts
 *   - src/cli/commands/help.ts         (no emite JSON; solo texto)
 *
 * Cuando un comando adopte el sobre, basta con devolver `jsonEnvelope(...)` como su salida `--json`;
 * no hay registro central que actualizar.
 */
const toFinding = (value) => {
    if (typeof value === 'string')
        return { message: value };
    const record = value;
    return {
        ...(typeof record.id === 'string' && record.id.length > 0 ? { id: record.id } : {}),
        message: typeof record.message === 'string' ? record.message : String(record.message ?? ''),
        ...(typeof record.artifact === 'string' && record.artifact.length > 0 ? { artifact: record.artifact } : {}),
    };
};
/**
 * Construir el sobre. Nunca lanza: cualquier entrada se normaliza a la forma estable, porque un
 * comando que revienta al serializar su propio informe es peor que un informe raro.
 */
export const jsonEnvelope = (input) => {
    const errors = (input.errors ?? []).map(toFinding);
    const warnings = (input.warnings ?? []).map(toFinding);
    const ok = input.ok ?? errors.length === 0;
    const detail = input.detail ??
        (ok
            ? `Comando «${input.command}» completado sin errores${warnings.length > 0 ? ` (${warnings.length} aviso(s))` : ''}.`
            : `Comando «${input.command}» con ${errors.length} error(es)${warnings.length > 0 ? ` y ${warnings.length} aviso(s)` : ''}.`);
    return { ok, command: input.command, data: input.data, findings: { errors, warnings }, detail };
};
/**
 * Aplanar los issues de core (`{ severity, id?, message }`) a las dos listas del sobre. Los issues de
 * severidad `info` no existen en este vocabulario: un «informativo» no es ni error ni aviso, y
 * inventarle una tercera lista rompería la estabilidad de la forma.
 */
export const findingsFromIssues = (issues) => {
    const findings = { errors: [], warnings: [] };
    for (const issue of issues) {
        const finding = toFinding({
            ...(typeof issue.id === 'string' && issue.id.length > 0 ? { id: issue.id } : {}),
            message: issue.message,
            ...(typeof issue.artifact === 'string' && issue.artifact.length > 0 ? { artifact: issue.artifact } : {}),
        });
        if (issue.severity === 'error')
            findings.errors.push(finding);
        if (issue.severity === 'warning')
            findings.warnings.push(finding);
    }
    return findings;
};
/** Atajo para el caso más común: `ok` ya calculado por el comando. */
export const isEnvelopeOk = (envelope) => envelope.ok;
/**
 * Renderizador de UNA línea, para la salida humana de un `--json` (o para un `--quiet`). Es texto
 * plano a propósito: el color es decisión del llamante y un resumen con ANSI no se puede comparar
 * en un test ni registrar en un log.
 */
export const renderJsonEnvelope = (envelope) => {
    const { errors, warnings } = envelope.findings;
    const verdict = envelope.ok ? 'ok' : 'error';
    const counts = `${errors.length} error(es)${warnings.length > 0 ? `, ${warnings.length} aviso(s)` : ''}`;
    return `open-sdd ${envelope.command} · ${verdict} · ${counts} · ${envelope.detail}`;
};
