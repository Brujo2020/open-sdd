/**
 * `open-sdd status` — la superficie de consola del panel único.
 *
 * Dos decisiones que la forma del comando hace explícitas:
 *
 *  1. El panel se pinta TONO A TONO. `renderStatus` devuelve texto plano, una entrada por línea, y
 *     aquí se colorea con `report.lines[i].tone`. Nada de ANSI en el core: el JSON queda limpio y el
 *     renderizador es testeable sin despojar códigos de escape.
 *  2. `--check` es el GATE del pivote constitucional. El panel informa; `--check` valida la spec
 *     CONTRA la constitución y devuelve 1 ante cualquier hallazgo de error — incluido «no se pudo
 *     validar», porque no poder inspeccionar no es aprobar.
 *  3. `--check --strict` (REQ-MAT-005) es el MISMO gate con el umbral bajado: un aviso también falla.
 *     El modo se imprime SIEMPRE (con o sin `--strict`) y con él lo que el modo estricto añadiría o
 *     añadió, para que nadie tenga que adivinar qué habría pasado en el otro modo. `--check` a secas
 *     conserva la semántica de hoy (solo errores).
 *  4. La misma ejecución pasa por el TRINQUETE (`core/ratchet.ts`): compara la alineación con la
 *     línea base persistida y un descenso no aceptado es un error. `--accept-drop "<razón>"` lo
 *     autoriza para ESA ejecución y lo registra con autor y fecha. El trinquete forma parte del
 *     veredicto: no es una anotación al margen del gate.
 *  5. La ADHESIÓN constitucional (`core/specConstitution.ts`) puntúa el pivote 0..100 y lleva su
 *     TENDENCIA append-only en `.sdd/state/adhesion-history.json`. La línea `Constitucional` del
 *     panel carga el número y el movimiento, y `--check` añade la medición a la serie. Dos ficheros
 *     y dos escalas que NO deben confundirse: `core/ratchet.ts` posee `.sdd/state/adhesion.json`
 *     con ratios 0..1 y bloquea descensos; aquí solo se lee/escribe `adhesion-history.json`, con
 *     puntuaciones 0..100. La conversión 0..1 → 0..100 la hace `adhesionScore`, nunca una división a
 *     ojo en esta capa.
 *
 * ── Compatibilidad heredada (documentada, no silenciosa) ────────────────────────────────────────
 * `test/cliSubcommands.test.ts` fija dos contratos anteriores que este comando conserva:
 *   · `status --json` SIN feature sigue devolviendo la lista de estados por spec (un array con
 *     `name`), no el `StatusReport`. `status <feature> --json` sí devuelve el `StatusReport`, que es
 *     la forma máquina-legible del panel.
 *   · `status <feature>` conserva los tokens `Specification:` y `Phase:` en la línea de la spec.
 * Nota de idioma: el resto de los textos visibles son español; esos dos tokens se mantienen porque
 * un test ya instalado los exige.
 *
 * ── El veredicto estricto en JSON ───────────────────────────────────────────────────────────────
 * `status <feature> --json --check` conserva la forma heredada (`StatusReport` + `alignment` +
 * `checkExitCode`) porque un test ya instalado la fija. Para ver el veredicto estricto por máquina se
 * usa `--json --check --strict`, que adopta el sobre estable de `cli/jsonOut.ts`
 * (`{ ok, command, data, findings, detail }`): reutilizarlo es lo que evita inventar una sexta
 * gramática, y `ok` refleja el veredicto ESTRICTO (forzado explícitamente, porque «hay errores» no
 * describe un modo en el que los avisos también fallan).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { colors } from '../ui/colors.js';
import { getSpecStatus, listSpecs, resolveSddDir } from '../../core/specManager.js';
import { alignFeature, buildStatus, constitutionCandidates, inspectFeature, loadConstitution, renderStatus, worstTone, } from '../../core/status.js';
import { principlesInForce } from '../../core/constitution.js';
import { assist, renderAssist } from '../../core/assistants.js';
import { analyseEars } from '../../core/earsAssistant.js';
import { getModifiedFiles, isGitRepo } from '../../core/git.js';
import { runChain } from '../../core/gateRunner.js';
import { celebrationsToJson, celebrateFeature, playCelebration, readCelebrations, renderCelebrations, } from '../../core/celebrate.js';
import { hashConstitution, runAdhesionRatchet } from '../../core/ratchet.js';
import { adhesionHistoryEntry, adhesionScore, adhesionTrend, readAdhesionHistory, recordAdhesionHistory, } from '../../core/specConstitution.js';
import { jsonEnvelope } from '../jsonOut.js';
import { computeSddScore } from '../../core/sddScore.js';
const TONE_PAINT = {
    ok: colors.green,
    warn: colors.yellow,
    err: colors.red,
    dim: colors.dim,
};
/** Cabecera de sección: `value` vacío. El contenido se colorea por su tono. */
const paint = (text, line) => line.value ? TONE_PAINT[line.tone](text) : colors.bold(colors.cyan(text));
const adhesionView = async (root, sddDir, alignment) => {
    const score = adhesionScore(alignment);
    const history = await readAdhesionHistory(root, sddDir);
    const trend = adhesionTrend(score.score, history.entries, { feature: alignment.feature });
    return {
        score,
        trend,
        feature: alignment.feature,
        historyFile: history.file,
        ...(history.warning ? { warning: history.warning } : {}),
    };
};
/** `adhesión N/100 · tendencia <first-run|up|down|flat> (…)`: número y movimiento en una línea. */
const formatAdhesion = (view) => {
    const { score, trend } = view;
    const value = score.inputs.declaredAny
        ? `adhesión ${score.score}/100`
        : `adhesión ${score.score}/100 (la spec no declara principios: 0 NO es un aprobado)`;
    const movement = trend.status === 'first-run'
        ? 'first-run (sin medición previa)'
        : `${trend.status} (${trend.delta > 0 ? '+' : ''}${trend.delta} puntos vs ${trend.previous} del ${trend.comparedTo?.slice(0, 10) ?? 'sin fecha'})`;
    return `${value} · tendencia ${movement}`;
};
/**
 * Añadir la adhesión a la línea `Constitucional` del panel.
 *
 * Una historia ilegible o un `0` sin principios declarados NUNCA pueden quedar teñidos de aprobado:
 * en ambos casos la línea se fuerza al menos a `warn` y el motivo viaja escrito. Devolver `false`
 * significa que el panel no tenía línea de alineación (pivote no ejecutado) y no hay nada que anexar.
 */
const applyAdhesion = (report, view) => {
    const line = report.lines.find((candidate) => candidate.label === 'Constitucional' && candidate.value.startsWith('declarados:'));
    if (!line)
        return false;
    line.value = `${line.value} · ${formatAdhesion(view)}`;
    if (view.warning)
        line.value = `${line.value} · historia de adhesión: ${view.warning}`;
    if (!view.score.inputs.declaredAny || view.warning)
        line.tone = worstTone([line.tone, 'warn']) ?? 'warn';
    return true;
};
/** Hash del contenido de la constitución tal y como está en disco (o del vacío si no se pudo leer). */
const constitutionHashAt = async (root, sddDir) => {
    for (const rel of constitutionCandidates(sddDir)) {
        try {
            return hashConstitution(await readFile(path.join(root, rel), 'utf8'));
        }
        catch {
            // Siguiente candidato; si ninguno existe, el hash del vacío deja constancia de «sin autoridad».
        }
    }
    return hashConstitution('');
};
/**
 * Ejecutar el pivote Y su trinquete. No poder ejecutarlo es un fallo (1): no se declara aprobado lo
 * no inspeccionado. El trinquete nunca lanza: un estado corrupto se declara como aviso.
 */
const runPivot = async (cwd, feature, sddDir, options) => {
    const outcome = await alignFeature(cwd, {
        ...(feature ? { feature } : {}),
        ...(sddDir ? { sddDir } : {}),
    });
    if (!outcome.alignment) {
        const message = outcome.error ?? 'el pivote no se pudo ejecutar';
        return {
            alignment: null,
            error: message,
            ratchet: null,
            adhesion: null,
            adhesionRecord: null,
            findings: [{ severity: 'error', code: 'PIVOT_UNAVAILABLE', message }],
            errorCount: 1,
            warningCount: 0,
            exitCode: 1,
            strictExitCode: 1,
        };
    }
    // El trinquete necesita la autoridad EN VIGOR y el contenido de la constitución, no solo el veredicto.
    const sddRel = sddDir ?? (await resolveSddDir(outcome.root));
    const constitution = await loadConstitution(outcome.root, sddRel);
    const principles = constitution.constitution
        ? principlesInForce(constitution.constitution).map((principle) => principle.id)
        : [];
    const constitutionHash = await constitutionHashAt(outcome.root, sddRel);
    const featureName = outcome.feature ?? feature ?? '(sin-feature)';
    const ratchet = await runAdhesionRatchet({
        sddDir: path.resolve(outcome.root, sddRel),
        feature: featureName,
        alignment: outcome.alignment.alignment,
        principles,
        constitutionHash,
        ...(options.acceptDrop ? { acceptDrop: options.acceptDrop } : {}),
        ...(options.actor ? { actor: options.actor } : {}),
    });
    // ── Adhesión: puntuar, comparar contra la serie y AÑADIR la medición (append-only) ───────────
    // La tendencia se calcula ANTES de registrar: si se registrara primero, toda ejecución parecería
    // `flat` contra su propia fila. El registro es de `--check` por construcción (este camino solo se
    // recorre con `--check`), así que el panel informativo nunca escribe.
    const adhesion = await adhesionView(outcome.root, sddRel, outcome.alignment);
    const record = await recordAdhesionHistory(outcome.root, adhesionHistoryEntry(adhesion.score, { feature: featureName }), sddRel);
    const findings = [
        ...outcome.alignment.findings.map((finding) => ({
            severity: finding.severity,
            code: finding.code,
            message: finding.message,
            ...(finding.principleId ? { principleId: finding.principleId } : {}),
            ...(finding.artifactId ? { artifactId: finding.artifactId } : {}),
        })),
        ...ratchet.findings.map((finding) => ({
            severity: finding.severity,
            code: finding.code,
            message: finding.message,
            ...(finding.principleId ? { principleId: finding.principleId } : {}),
        })),
    ];
    if (record.warning) {
        // Una historia ilegible se declara: no poder leer la serie no puede parecer «sin tendencia».
        findings.push({
            severity: 'warning',
            code: record.warning.includes('no se pudo escribir')
                ? 'ADHESION_HISTORY_UNWRITABLE'
                : 'ADHESION_HISTORY_CORRUPT',
            message: record.warning,
        });
    }
    const errorCount = findings.filter((finding) => finding.severity === 'error').length;
    const warningCount = findings.filter((finding) => finding.severity === 'warning').length;
    return {
        alignment: outcome.alignment,
        ratchet,
        adhesion,
        adhesionRecord: {
            file: record.file,
            entries: record.entries,
            ...(record.warning ? { warning: record.warning } : {}),
        },
        findings,
        errorCount,
        warningCount,
        exitCode: errorCount > 0 ? 1 : 0,
        strictExitCode: errorCount + warningCount > 0 ? 1 : 0,
    };
};
/**
 * Compatibilidad: la lista por spec que `status --json` (sin feature) devolvía antes del panel.
 * Se mantiene tal cual para no romper a quien la consume por máquina.
 */
const legacySpecList = async (cwd, sddDir) => {
    const dir = sddDir ?? (await resolveSddDir(cwd));
    const specs = await listSpecs(cwd, dir);
    return Promise.all(specs.map((feature) => getSpecStatus(cwd, feature, dir)));
};
/**
 * `status --celebrations`: el libro de validaciones registradas (`.sdd/state/celebrations.json`).
 *
 * Solo LEE. Un libro ilegible se avisa y se muestra vacío —`renderCelebrations` lo hace— pero nunca
 * se rellena ni se convierte en un error: no hay nada que el usuario deba arreglar para poder leer
 * un historial que no existe. `--json` emite el sobre del módulo (`celebrationsToJson`), que es
 * también lo que sirve `--lang`-agnóstico a un script.
 */
const handleCelebrations = async (args, io, cwd) => {
    const sddArg = args.find((arg) => arg.startsWith('--sdd-dir='));
    const sddDir = sddArg ? sddArg.slice('--sdd-dir='.length) : await resolveSddDir(cwd);
    // `readCelebrations` construye la ruta y la abre tal cual: se le pasa ABSOLUTA para que el `cwd`
    // del comando (una fixture, en los tests) sea el que manda y no el del proceso.
    const read = await readCelebrations(path.resolve(cwd, sddDir));
    if (args.includes('--json')) {
        io.log(JSON.stringify(celebrationsToJson(read), null, 2));
        return 0;
    }
    for (const line of renderCelebrations(read, { noColor: args.includes('--no-color') }))
        io.log(line);
    return 0;
};
/**
 * El momento verde de una ejecución de `--check`, impreso DESPUÉS del informe y ANTES del pie de
 * puntuación (el pie lo emite el despachador al volver este comando).
 *
 * NO HAY CELEBRACIÓN SIN LAS TRES VERDADES MEDIDAS, y aquí se miden las tres: EARS se analiza sobre
 * `requirements.md`, el pivote lo acaba de medir `runPivot` y la cadena de gates del nivel declarado
 * se ejecuta SOLO cuando las dos primeras ya están en verde (así una ejecución que no puede celebrar
 * no paga el coste de la cadena). Un veredicto que no sea `celebrate` no imprime nada: un `refused`
 * o un `plain` no son noticias y no deben añadir ruido a un panel que ya dijo lo suyo.
 *
 * La racha se DERIVA de la serie de adhesión que el trinquete escribe (`adhesion-history.json`): es
 * la misma serie, no una segunda verdad. `core/celebrate.ts` no inventa N —sin racha no imprime
 * racha— y `core/ratchet.ts` no lo expone hoy, así que la única fuente real es la serie medida.
 */
const celebrateValidatedFeature = async (io, root, sddDir, requestedFeature, pivot, declaredGates) => {
    if (!pivot.alignment || pivot.errorCount > 0)
        return;
    const feature = requestedFeature ?? pivot.alignment.feature;
    const inspection = await inspectFeature(root, feature, sddDir);
    if (!inspection || inspection.requirements === null)
        return;
    const ears = analyseEars(inspection.requirements, { source: 'requirements.md' });
    const earsErrors = ears.suggestions.filter((suggestion) => suggestion.severity === 'error').length;
    if (ears.total === 0 || earsErrors > 0 || ears.conforming !== ears.total)
        return;
    let gates;
    let gateRun;
    try {
        gateRun = await runChain(declaredGates, {
            cwd: root,
            sddDir,
            feature,
            changedFiles: isGitRepo(root) ? getModifiedFiles(root) : [],
            declaredScope: [],
        });
        if (gateRun.findings.length === 0)
            return;
        gates = {
            passed: gateRun.findings.filter((finding) => finding.outcome === 'pass' || finding.outcome === 'advisory').length,
            total: gateRun.findings.length,
            failed: gateRun.findings.filter((finding) => finding.outcome === 'fail').map((finding) => finding.gateId),
            evaluated: true,
        };
    }
    catch {
        // No poder ejecutar la cadena es NO MEDIDO, y sin gates medidos no hay celebración: se calla.
        return;
    }
    // El número compuesto se mide reutilizando la MISMA ejecución de la cadena (`gateRun`): el módulo
    // de puntuación no la vuelve a correr, así que el pie y la celebración no pueden discrepar.
    let score;
    let phase;
    try {
        const report = await computeSddScore(root, { feature, sddDir, gateRun });
        score = report.total;
        phase = report.phase;
    }
    catch {
        // Sin número medido no se apunta nada: `appendCelebration` exige score y fase reales. El
        // veredicto de tres verdades sigue siendo válido, pero el libro no puede inventar el número.
        return;
    }
    const history = await readAdhesionHistory(root, sddDir);
    const series = history.entries.filter((entry) => entry.feature === feature);
    let streak = 0;
    for (let i = series.length - 1; i > 0; i -= 1) {
        if (series[i].score >= series[i - 1].score)
            streak += 1;
        else
            break;
    }
    const celebration = await celebrateFeature(path.resolve(root, sddDir), {
        feature,
        requirements: { conforming: ears.conforming, total: ears.total, errors: earsErrors, evaluated: true },
        pivot: { alignment: pivot.alignment.alignment, errors: pivot.errorCount, evaluated: true },
        gates,
        score,
        phase,
        streak,
    }, { anim: false, isTty: false, json: false, quiet: false });
    if (celebration.report.verdict !== 'celebrate')
        return;
    await playCelebration(celebration.report, {
        out: {
            write: (chunk) => {
                for (const line of chunk.split('\n'))
                    if (line.length > 0)
                        io.log(line);
                return true;
            },
        },
    });
};
export const handleStatusCommand = async (args, io, cwd = process.cwd()) => {
    const isJson = args.includes('--json');
    const isCheck = args.includes('--check');
    const isStrict = args.includes('--strict');
    const isQuiet = args.includes('--quiet');
    const sddArg = args.find((arg) => arg.startsWith('--sdd-dir='));
    const sddDir = sddArg ? sddArg.slice('--sdd-dir='.length) : undefined;
    // El libro de validaciones tiene su propia superficie y se atiende ANTES que la lista heredada de
    // `--json`: si no, `status --celebrations --json` devolvería la lista por spec en su lugar.
    if (args.includes('--celebrations'))
        return handleCelebrations(args, io, cwd);
    // Un flag con valor no puede confundir a la detección de la feature: `--accept-drop "<razón>"`
    // tiene un token suelto que NO es el nombre de la spec.
    const flagValue = (flag) => {
        const inline = args.find((arg) => arg.startsWith(`${flag}=`));
        if (inline)
            return inline.slice(flag.length + 1);
        const at = args.indexOf(flag);
        if (at >= 0 && args[at + 1] !== undefined && !args[at + 1].startsWith('-'))
            return args[at + 1];
        return undefined;
    };
    const acceptDrop = flagValue('--accept-drop');
    const feature = args.find((arg) => !arg.startsWith('-') && arg !== acceptDrop);
    if (isJson && !feature && !isCheck) {
        io.log(JSON.stringify(await legacySpecList(cwd, sddDir), null, 2));
        return 0;
    }
    const report = await buildStatus(cwd, {
        ...(feature ? { feature } : {}),
        ...(sddDir ? { sddDir } : {}),
    });
    // ── Adhesión: el panel dice CUÁNTO, no solo qué falla ────────────────────────────────────────
    // `buildStatus` pinta la línea `Constitucional` con el detalle del pivote; aquí se le anexa la
    // puntuación 0..100 y su tendencia. Se calcula ANTES del registro de `--check` para que el
    // movimiento se mida contra la serie previa y no contra la fila que esa ejecución va a añadir.
    // Sin línea de alineación (pivote no ejecutado) no se llama al pivote una segunda vez.
    const alignmentLine = report.lines.some((line) => line.label === 'Constitucional' && line.value.startsWith('declarados:'));
    const sddRel = sddDir ?? (await resolveSddDir(report.root));
    const adhesionOutcome = alignmentLine
        ? await alignFeature(report.root, { ...(feature ? { feature } : {}), sddDir: sddRel })
        : null;
    const adhesion = adhesionOutcome?.alignment
        ? await adhesionView(report.root, sddRel, adhesionOutcome.alignment)
        : null;
    if (adhesion)
        applyAdhesion(report, adhesion);
    const rendered = renderStatus(report);
    const hasErrorLine = report.lines.some((line) => line.tone === 'err');
    // `--strict` solo se lee en la ruta de `--check`: sin pivote no hay avisos que escalar.
    const pivotOptions = {
        strict: isStrict,
        ...(acceptDrop ? { acceptDrop } : {}),
        actor: process.env.SDD_ACTOR?.trim() ||
            process.env.GIT_AUTHOR_NAME?.trim() ||
            process.env.USER?.trim() ||
            process.env.USERNAME?.trim() ||
            'desconocido',
    };
    // ── Guion: una sola línea, para scripts ─────────────────────────────────────────────────────
    if (isQuiet) {
        const worst = worstTone(report.lines.map((line) => line.tone)) ?? 'dim';
        io.log(`${report.level} · ${worst} · ${report.nextAction ?? 'sin acción determinada'}`);
        return hasErrorLine ? 1 : 0;
    }
    // ── JSON: el StatusReport (con el pivote añadido si se pidió --check) ───────────────────────
    if (isJson) {
        if (!isCheck) {
            io.log(JSON.stringify(report, null, 2));
            return hasErrorLine ? 1 : 0;
        }
        const pivot = await runPivot(cwd, feature, sddDir, pivotOptions);
        if (!isStrict) {
            // Forma heredada, fijada por un test: StatusReport + alignment + checkExitCode.
            io.log(JSON.stringify(pivot.alignment
                ? { ...report, alignment: pivot.alignment, ratchet: pivot.ratchet, checkExitCode: pivot.exitCode }
                : { ...report, alignmentError: pivot.error ?? 'el pivote no se pudo ejecutar', ratchet: pivot.ratchet, checkExitCode: pivot.exitCode }, null, 2));
            return hasErrorLine || pivot.exitCode !== 0 ? 1 : 0;
        }
        // Modo estricto: sobre estable (`cli/jsonOut.ts`), con `ok` forzado al veredicto estricto.
        // El sobre gana el número compuesto y la fase (`core/sddScore.ts`): es la misma medición que el
        // pie humano, para que máquina y persona no lean dos verdades distintas.
        const score = await computeSddScore(cwd, {
            ...(feature ? { feature } : {}),
            ...(sddDir ? { sddDir } : {}),
        });
        const envelope = jsonEnvelope({
            command: 'status',
            data: {
                ...report,
                mode: 'strict',
                ...(pivot.alignment ? { alignment: pivot.alignment } : { alignmentError: pivot.error ?? 'el pivote no se pudo ejecutar' }),
                ratchet: pivot.ratchet,
                checkExitCode: pivot.exitCode,
                strictExitCode: pivot.strictExitCode,
            },
            errors: pivot.findings
                .filter((finding) => finding.severity === 'error')
                .map((finding) => ({ id: finding.code, message: finding.message })),
            warnings: pivot.findings
                .filter((finding) => finding.severity === 'warning')
                .map((finding) => ({ id: finding.code, message: finding.message })),
            ok: pivot.strictExitCode === 0,
            score,
            detail: `Validación constitucional estricta de "${pivot.alignment?.feature ?? feature ?? '(sin-feature)'}": ${pivot.errorCount} error(es) y ${pivot.warningCount} aviso(s); en modo estricto ambos fallan.`,
        });
        io.log(JSON.stringify(envelope, null, 2));
        return hasErrorLine || pivot.strictExitCode !== 0 ? 1 : 0;
    }
    // ── Panel ───────────────────────────────────────────────────────────────────────────────────
    io.log('');
    rendered.forEach((text, index) => io.log(paint(text, report.lines[index])));
    let exitCode = hasErrorLine ? 1 : 0;
    if (isCheck) {
        const pivot = await runPivot(cwd, feature, sddDir, pivotOptions);
        const modeLabel = isStrict ? 'modo estricto' : 'modo errores';
        io.log('');
        io.log(colors.bold(colors.cyan(`Validación constitucional (--check · ${modeLabel})`)));
        if (!pivot.alignment) {
            io.log(`  ${colors.red('✗')} ${pivot.error ?? 'el pivote no se pudo ejecutar'}`);
            exitCode = 1;
        }
        else {
            const alignment = pivot.alignment;
            // «Sin hallazgos» significa sin errores NI avisos: los `info` (línea base, subida) no son
            // hallazgos, son el diario del trinquete, y no deben disfrazar un veredicto limpio.
            if (pivot.errorCount === 0 && pivot.warningCount === 0) {
                io.log(`  ${colors.green('✓')} ${alignment.detail.split(';')[0]}: sin hallazgos.`);
            }
            for (const finding of pivot.findings) {
                const mark = finding.severity === 'error' ? colors.red('error') : finding.severity === 'warning' ? colors.yellow('aviso') : colors.dim('info');
                const where = [finding.principleId, finding.artifactId].filter(Boolean).join(' → ');
                io.log(`  ${mark.padEnd(18)} ${finding.code.padEnd(22)} ${where}`);
                io.log(`      ${colors.dim(finding.message)}`);
            }
            if (pivot.ratchet) {
                io.log(`  ${colors.dim(`Trinquete: ${pivot.ratchet.verdict} · base ${(pivot.ratchet.baseline.alignment * 100).toFixed(0)}%${pivot.ratchet.droppedPrinciples.length > 0 ? ` · salieron ${pivot.ratchet.droppedPrinciples.join(', ')}` : ''}`)}`);
            }
            if (pivot.adhesionRecord) {
                // Lo que `--check` acaba de añadir a la serie, dicho en voz alta: es un acto de registro.
                io.log(`  ${colors.dim(`Adhesión: ${pivot.adhesionRecord.entries} medición(es) en ${pivot.adhesionRecord.file} · score ${pivot.adhesion?.score.score ?? '(no calculado)'}/100`)}`);
            }
            io.log(`  ${colors.dim(alignment.detail)}`);
            // Monótono: el veredicto del pivote/trinquete solo puede ENDURECER el del panel, nunca perdonar
            // una línea de error que el panel ya había marcado.
            exitCode = Math.max(exitCode, isStrict ? pivot.strictExitCode : pivot.exitCode);
            // Lo que el modo estricto añade, dicho en los DOS modos: nadie debería adivinar el otro veredicto.
            const warningCodes = [...new Set(pivot.findings.filter((f) => f.severity === 'warning').map((f) => f.code))];
            if (isStrict) {
                io.log(`  ${colors.yellow('Modo estricto')}: los avisos también fallan. ${pivot.warningCount > 0 ? `Añade ${pivot.warningCount} aviso(s) al veredicto (${warningCodes.join(', ')}).` : 'No hay avisos que escalar.'}`);
            }
            else {
                io.log(`  ${colors.dim(`Modo estricto (--strict) añadiría ${pivot.warningCount} aviso(s) al veredicto${warningCodes.length > 0 ? ` (${warningCodes.join(', ')})` : ''}.`)}`);
            }
        }
        // El asistente aparece junto a los hallazgos ya impresos y solo cuando tiene algo que decir:
        // con la constitución en vigor y hallazgos constitucionales devuelve cero sugerencias y no se
        // imprime nada (el silencio es una respuesta válida). Cubre los dos caminos —constitución
        // ausente (pivote no ejecutable) y pivote con hallazgos— y no toca el veredicto de arriba.
        const assistant = await assist({
            cwd: report.root,
            ...(feature ? { feature } : {}),
            sddDir: sddRel,
            findings: pivot.findings.map((finding) => ({ code: finding.code })),
        });
        for (const line of renderAssist(assistant.suggestions))
            io.log(colors.dim(`  ${line}`));
        // ── El momento verde: DESPUÉS del informe, ANTES del pie de puntuación ────────────────────
        // El pie lo emite el despachador al volver de aquí, así que imprimir ahora es imprimir antes
        // de él. Solo aparece si la feature valida de verdad (tres verdades medidas) y el veredicto es
        // `celebrate`. El guardia `exitCode === 0` es el invariante: el comando NUNCA celebra mientras
        // su propio veredicto dice que algo falla.
        if (exitCode === 0) {
            await celebrateValidatedFeature(io, report.root, sddRel, feature, pivot, report.gates);
        }
    }
    io.log('');
    return exitCode;
};
