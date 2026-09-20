/**
 * Panel único de la base open-sdd: todo el estado en una pantalla.
 *
 * El CLI tiene hoy un comando por modelo (gates, govern, assure, waves, brownfield, delta, floor).
 * Eso es potente y es exactamente el problema: para saber «¿dónde estoy?» hay que ejecutar seis
 * comandos y cruzar sus salidas. Este módulo es el agregado que faltaba — constitución, specs,
 * delta, contratos, pivote constitucional y rigor — con UNA siguiente acción concreta.
 *
 * ── Decisiones que el panel hace explícitas ─────────────────────────────────────────────────────
 *  1. AGREGAR, NO VOLCAR. Una línea por hecho, no un informe por sección. Lo que no cabe en una
 *     pantalla se resume; el detalle vive en el comando específico al que apunta `nextAction`.
 *  2. HONESTIDAD ANTE LA AUSENCIA. Un artefacto que no se pudo inspeccionar emite `warn` y lo dice;
 *     nunca un cero silencioso. `complete` es falso exactamente cuando algo quedó sin inspeccionar
 *     (un fichero ilegible, un rigor.json roto, un origen de cambio desconocido) — no cuando algo
 *     falta, porque una ausencia SÍ se inspeccionó.
 *  3. LÍNEAS SIN COLOR. `renderStatus` devuelve texto plano, una entrada por `StatusLine` y en el
 *     mismo orden, para que el llamante pueda colorear por `report.lines[i].tone` sin volver a
 *     parsear nada. Un renderizador que ya trae ANSI incrustado no se puede testear ni reutilizar en
 *     JSON, y esta pieza se consume desde ambos sitios.
 *  4. `nextAction` RESPETA EL NIVEL. Se deriva de `rigorRequires(level, brownfield)` y de
 *     `effectiveGates(level)`: a un proyecto `spec-first` no se le pide delta ni contratos, y su
 *     inspección es la cadena que su nivel activa (C1, C2), no la de `spec-as-source`.
 *
 * ── Nota de contrato ────────────────────────────────────────────────────────────────────────────
 * El contrato mencionaba `findRepoRoot` en `specManager.ts`; no está ahí, es una función local de
 * `cli/commands/brownfield.ts`. Se reimplementa aquí (6 niveles hacia arriba buscando el directorio
 * SDD) para que el panel funcione igual desde un subdirectorio, sin tocar el fichero de otro agente.
 * Los textos visibles son español, como el resto del CLI.
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { auditFeature } from './auditEngine.js';
import { parseConstitution, principlesInForce, validateConstitution } from './constitution.js';
import { deltaCounts, deltaSpecFileName, parseDeltaSpec, strangulationReport, validateDeltaSpec, } from './deltaSpec.js';
import { extractContracts, testCommandFor } from './executionContract.js';
import { getModifiedFiles, isGitRepo } from './git.js';
import { scanProject } from './reverseEngineering.js';
import { effectiveGates, loadRigorSettings, rigorRequires } from './rigor.js';
import { getSpecStatus, listSpecs, resolveSddDir } from './specManager.js';
import { checkEvidenceLock, evaluateTriad } from './triad.js';
import { alignSpecWithConstitution } from './specConstitution.js';
const TONE_RANK = { err: 0, warn: 1, ok: 2, dim: 3 };
/**
 * Exigencia estricta, para cuando el nivel declarado no se pudo leer.
 *
 * Con un `rigor.json` roto el nivel es DESCONOCIDO, y juzgar el repositorio con el suelo `spec-first`
 * sería una degradación silenciosa de la exigencia (justo lo que `loadRigorSettings` evita al no
 * tragarse un JSON inválido). Ante lo desconocido se exige todo: la línea de Rigor lo declara como no
 * evaluado y `complete` es falso.
 */
const STRICT_DEMANDS = {
    constitution: 'required',
    triad: 'required',
    delta: 'required',
    traceability: 'required',
    evidence: 'required',
    drift: 'required',
    contracts: 'required',
    regeneration: 'required',
};
/** El peor tono de una lista: `err` > `warn` > `ok` > `dim`. */
export const worstTone = (tones) => [...tones].sort((a, b) => TONE_RANK[a] - TONE_RANK[b])[0];
/** Una línea de contenido. Etiqueta + valor; `value` vacío marca una CABECERA de sección. */
const content = (label, value, tone, detail) => ({
    label,
    value,
    tone,
    ...(detail ? { detail } : {}),
});
/** Cabecera de sección: `value` vacío. `renderStatus` la reconoce y no la colorea por tono. */
const section = (label) => ({ label, value: '', tone: 'dim' });
/**
 * Raíz del proyecto: el ancestro más cercano con directorio SDD.
 *
 * Misma semántica que `findRepoRoot` de `cli/commands/brownfield.ts`, extendida a `.kiro` (que
 * `resolveSddDir` acepta como alias legacy), para que el panel se comporte igual desde `src/`.
 */
export const findRepoRoot = async (cwd) => {
    const start = path.resolve(cwd);
    let dir = start;
    for (let i = 0; i < 6; i += 1) {
        for (const candidate of ['.sdd', '.kiro']) {
            try {
                if ((await stat(path.join(dir, candidate))).isDirectory())
                    return dir;
            }
            catch {
                // sigue subiendo
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return start;
};
/** Leer un fichero distinguiendo «no existe» de «existe pero no se pudo leer». */
const readText = async (absPath) => {
    try {
        return { exists: true, content: await readFile(absPath, 'utf8') };
    }
    catch (err) {
        const code = err.code;
        if (code === 'ENOENT' || code === 'ENOTDIR')
            return { exists: false, content: null };
        return { exists: true, content: null, error: err.message };
    }
};
/** Candidatos de constitución, en el mismo orden que usa `assessRigor`. */
export const constitutionCandidates = (sddDir) => [
    path.join(sddDir, 'steering', 'constitution.md'),
    path.join(sddDir, 'constitution.md'),
];
/** Leer la constitución del proyecto (descriptiva o normativa: el modelo es el mismo). */
export const loadConstitution = async (root, sddDir) => {
    for (const candidate of constitutionCandidates(sddDir)) {
        const read = await readText(path.join(root, candidate));
        if (!read.exists)
            continue;
        if (read.content === null) {
            return { path: candidate, exists: true, constitution: null, error: read.error ?? 'error de lectura' };
        }
        return { path: candidate, exists: true, constitution: parseConstitution(read.content) };
    }
    return { path: null, exists: false, constitution: null };
};
/** Leer de una vez todo lo que el panel y el pivote necesitan de una feature. */
export const inspectFeature = async (root, feature, sddDir) => {
    const specDir = path.join(sddDir, 'specs', feature);
    const unreadable = [];
    let files = [];
    let dirExists = false;
    try {
        files = (await readdir(path.join(root, specDir), { withFileTypes: true }))
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name);
        dirExists = true;
    }
    catch (err) {
        const code = err.code;
        if (code !== 'ENOENT' && code !== 'ENOTDIR') {
            // El directorio existe pero no se pudo leer: se informa, no se trata como spec vacía.
            dirExists = true;
            unreadable.push(specDir);
        }
    }
    const readSpecFile = async (rel) => {
        const read = await readText(path.join(root, rel));
        if (read.exists && read.content === null)
            unreadable.push(rel);
        return read.content;
    };
    let planRel = null;
    for (const candidate of [path.join(specDir, 'plan.md'), path.join(specDir, 'design.md')]) {
        if (files.includes(path.basename(candidate))) {
            planRel = candidate;
            break;
        }
    }
    const requirements = await readSpecFile(path.join(specDir, 'requirements.md'));
    const plan = planRel ? await readSpecFile(planRel) : null;
    const tasks = await readSpecFile(path.join(specDir, 'tasks.md'));
    const deltaRaw = await readSpecFile(path.join(specDir, deltaSpecFileName()));
    return {
        feature,
        specDir,
        dirExists,
        files,
        requirements,
        plan,
        tasks,
        delta: deltaRaw === null ? null : parseDeltaSpec(deltaRaw),
        unreadable,
    };
};
const deltaExists = async (root, sddDir, feature) => (await readText(path.join(root, sddDir, 'specs', feature, deltaSpecFileName()))).exists;
/** Feature sobre la que se enfocan las secciones caras: la pedida, o la primera con delta. */
export const focusFeature = async (root, sddDir) => {
    const specs = await listSpecs(root, sddDir);
    for (const feature of specs) {
        if (await deltaExists(root, sddDir, feature))
            return feature;
    }
    return specs[0] ?? null;
};
/**
 * Ejecutar el pivote constitucional de una feature.
 *
 * Devuelve `alignment: null` con `error` cuando el pivote no puede ejecutarse en absoluto (no hay
 * constitución, no hay spec): un pivote que no corre no es un aprobado, y el llamante lo pinta como
 * aviso. Nunca lanza.
 */
export const alignFeature = async (cwd, options = {}) => {
    const root = await findRepoRoot(cwd);
    const sddDir = options.sddDir ?? (await resolveSddDir(root));
    const uninspected = [];
    const feature = options.feature ?? (await focusFeature(root, sddDir));
    if (!feature) {
        return {
            root,
            feature: null,
            alignment: null,
            error: `no hay ninguna especificación en ${path.join(sddDir, 'specs')} sobre la que ejecutar el pivote`,
            uninspected,
            changedFiles: [],
        };
    }
    const constitution = await loadConstitution(root, sddDir);
    if (!constitution.exists) {
        return {
            root,
            feature,
            alignment: null,
            error: `constitución ausente (${constitutionCandidates(sddDir)[0]}): sin autoridad no hay pivote que ejecutar`,
            uninspected,
            changedFiles: [],
        };
    }
    if (constitution.constitution === null) {
        const reason = `constitución ilegible (${constitution.path}: ${constitution.error ?? 'error de lectura'})`;
        uninspected.push(reason);
        return { root, feature, alignment: null, error: reason, uninspected, changedFiles: [] };
    }
    const inspection = await inspectFeature(root, feature, sddDir);
    if (!inspection.dirExists) {
        return {
            root,
            feature,
            alignment: null,
            error: `la feature "${feature}" no existe en ${path.join(sddDir, 'specs')}`,
            uninspected,
            changedFiles: [],
        };
    }
    uninspected.push(...inspection.unreadable.map((rel) => `${rel} no se pudo leer`));
    const gitRepo = isGitRepo(root);
    if (!gitRepo)
        uninspected.push('no es un repositorio git: el origen del cambio queda sin determinar');
    const changedFiles = gitRepo ? getModifiedFiles(root) : [];
    const alignment = alignSpecWithConstitution({
        feature,
        constitution: constitution.constitution,
        ...(inspection.requirements !== null ? { requirements: inspection.requirements } : {}),
        ...(inspection.plan !== null ? { plan: inspection.plan } : {}),
        ...(inspection.tasks !== null ? { tasks: inspection.tasks } : {}),
        ...(inspection.delta !== null ? { delta: inspection.delta } : {}),
        ...(gitRepo ? { changedFiles } : {}),
    });
    return { root, feature, alignment, uninspected, changedFiles };
};
/** Dos referencias de contrato apuntan al mismo fichero de prueba (ruta exacta o por cola). */
const sameTestFile = (a, b) => {
    const norm = (value) => value.split('::')[0].trim().replace(/\\/g, '/').replace(/^\.\//, '');
    const left = norm(a);
    const right = norm(b);
    if (!left || !right)
        return false;
    return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
};
/** La parte del `detail` del pivote que declara lo que NO se pudo decidir. */
const undecidedNote = (detail) => {
    const marker = 'No evaluado:';
    const at = detail.indexOf(marker);
    if (at < 0)
        return undefined;
    return detail.slice(at + marker.length).trim().replace(/\.$/, '');
};
/**
 * Construir el panel.
 *
 * Lee el repositorio y agrega. No lanza por artefactos ausentes: una ausencia es un hecho del
 * informe, no una excepción.
 */
export const buildStatus = async (cwd, options = {}) => {
    const root = await findRepoRoot(cwd);
    const sddDir = options.sddDir ?? (await resolveSddDir(root));
    const failures = [];
    const lines = [];
    // ── Rigor declarado: gobierna el nivel de exigencia de todo el panel ─────────────────────────
    let level = 'spec-first';
    let gates = [];
    let declaredBrownfield = false;
    let rigorError = null;
    try {
        const settings = await loadRigorSettings(root, sddDir);
        level = settings.level;
        declaredBrownfield = settings.brownfield;
        gates = effectiveGates(level, settings.gates);
    }
    catch (err) {
        // No se degrada en silencio a spec-first: el nivel se informa como NO EVALUADO.
        rigorError = err.message;
        failures.push(`el rigor declarado no se pudo leer (${rigorError})`);
    }
    // ── Constitución ────────────────────────────────────────────────────────────────────────────
    lines.push(section('Constitución'));
    const constitution = await loadConstitution(root, sddDir);
    let constitutionState;
    if (!constitution.exists) {
        constitutionState = 'missing';
        lines.push(content('Constitución', `ausente (${constitutionCandidates(sddDir)[0]}): no hay autoridad que citar`, 'warn', 'todo veredicto bloqueante debe poder citar un principio en vigor'));
    }
    else if (constitution.constitution === null) {
        constitutionState = 'unreadable';
        failures.push(`la constitución existe pero no se pudo leer (${constitution.path})`);
        lines.push(content('Constitución', `existe pero no se pudo leer (${constitution.error ?? 'error de lectura'}): no evaluada, no válida`, 'warn'));
    }
    else {
        const parsed = constitution.constitution;
        const issues = validateConstitution(parsed);
        const errors = issues.filter((issue) => issue.severity === 'error');
        const warnings = issues.filter((issue) => issue.severity === 'warning');
        const inForce = principlesInForce(parsed);
        const proposed = parsed.amendments.filter((amendment) => amendment.status === 'proposed' || amendment.status === 'under-review');
        const amendmentText = proposed.length > 0
            ? `${proposed.length} enmienda propuesta (sin entrar en vigor)`
            : parsed.amendments.length > 0
                ? `${parsed.amendments.length} enmienda(s), ninguna propuesta`
                : 'sin enmiendas';
        constitutionState = errors.length === 0 && inForce.length > 0 ? 'valid' : 'invalid';
        lines.push(content('Constitución', `presente y ${errors.length === 0 && inForce.length > 0 ? 'válida' : 'inválida'} · ${inForce.length} principio(s) en vigor · ${amendmentText}`, errors.length > 0 || inForce.length === 0 ? 'err' : warnings.length > 0 ? 'warn' : 'ok', errors.length > 0
            ? `${errors.length} error(es): ${errors.map((issue) => `${issue.id}: ${issue.message}`).slice(0, 2).join(' | ')}`
            : warnings.length > 0
                ? `${warnings.length} aviso(s) de validación`
                : undefined));
    }
    // ── Specs: tríada, trazabilidad medida y evidencia por feature ──────────────────────────────
    lines.push(section('Specs'));
    const specs = await listSpecs(root, sddDir);
    const requested = options.feature;
    const features = requested ? [requested] : specs;
    const demandsFor = (bf) => rigorError ? STRICT_DEMANDS : rigorRequires(level, bf);
    const demands = demandsFor(declaredBrownfield);
    if (features.length === 0) {
        lines.push(content('Specs', 'ninguna especificación en .sdd/specs', 'warn', 'crea una con open-sdd init <feature>'));
    }
    for (const feature of features) {
        const status = await getSpecStatus(root, feature, sddDir);
        if (!status.exists) {
            lines.push(content(`Specification: ${feature}`, 'no existe en .sdd/specs: no hay nada que inspeccionar', 'err', 'comprueba el nombre'));
            continue;
        }
        const inspection = await inspectFeature(root, feature, sddDir);
        failures.push(...inspection.unreadable.map((rel) => `${rel} no se pudo leer`));
        const triad = inspection.files.length > 0 ? evaluateTriad(inspection.files) : null;
        const triadText = triad
            ? triad.complete
                ? 'tríada completa'
                : `tríada incompleta (falta ${triad.missing.join(', ')})`
            : 'tríada no evaluada (no se pudo leer el directorio de la spec)';
        // Trazabilidad requisito→tarea: la matriz del motor de auditoría, medida, no estimada.
        let traceText = 'trazabilidad no evaluada';
        let traceTone = 'warn';
        try {
            const audit = await auditFeature(root, feature, { sddDir });
            const total = audit.rtm.length;
            const mapped = audit.rtm.filter((entry) => entry.mappedTasks.length > 0).length;
            if (total === 0) {
                traceText = 'trazabilidad no evaluada (requirements.md no declara REQ-*)';
                traceTone = 'warn';
            }
            else {
                traceText = `trazabilidad ${mapped}/${total}`;
                traceTone =
                    mapped === total
                        ? 'ok'
                        : demands.traceability === 'required'
                            ? 'err'
                            : demands.traceability === 'recommended'
                                ? 'warn'
                                : 'dim';
            }
        }
        catch (err) {
            failures.push(`la trazabilidad de "${feature}" no es evaluable (${err.message})`);
            traceText = 'trazabilidad no evaluada';
            traceTone = 'warn';
        }
        // Evidencia (I2) sobre las tareas completadas.
        let evidenceText = 'evidencia no evaluada (sin tasks.md)';
        let evidenceTone = 'warn';
        if (inspection.tasks !== null) {
            const lock = checkEvidenceLock(inspection.tasks);
            const unproven = lock.unprovenCompletions.length;
            evidenceText = `evidencia ${lock.checked - unproven}/${lock.checked} tarea(s) completada(s)`;
            evidenceTone =
                unproven === 0
                    ? 'ok'
                    : demands.evidence === 'required'
                        ? 'err'
                        : demands.evidence === 'recommended'
                            ? 'warn'
                            : 'dim';
        }
        const tones = [];
        if (!triad?.complete)
            tones.push('warn');
        if (traceTone !== 'ok')
            tones.push(traceTone);
        if (evidenceTone !== 'ok')
            tones.push(evidenceTone);
        lines.push(content(`Specification: ${feature}`, `Phase: ${status.phase} · ${triadText} · ${traceText} · ${evidenceText}`, worstTone(tones) ?? 'ok'));
    }
    // ── Foco de las secciones caras: la feature pedida o la primera con delta ────────────────────
    const focus = requested ?? (await focusFeature(root, sddDir));
    const focusInspection = focus ? await inspectFeature(root, focus, sddDir) : null;
    const brownfield = declaredBrownfield || (focusInspection?.delta !== null && focusInspection !== null);
    // ── Delta: recuento por tipo y progreso del estrangulamiento ────────────────────────────────
    lines.push(section('Delta'));
    const deltaCandidates = requested ? [requested] : specs;
    const deltas = [];
    for (const feature of deltaCandidates) {
        const inspection = await inspectFeature(root, feature, sddDir);
        if (inspection.delta)
            deltas.push({ feature, delta: inspection.delta });
    }
    /** Por encima de este tamaño se agrega en UNA línea: el panel no se convierte en un volcado. */
    const DELTA_LINES_MAX = 6;
    if (deltas.length > 0 && deltas.length <= DELTA_LINES_MAX) {
        for (const { feature, delta } of deltas) {
            const counts = deltaCounts(delta);
            const strangler = strangulationReport(delta);
            const deltaErrors = validateDeltaSpec(delta).filter((issue) => issue.severity === 'error');
            lines.push(content(`Delta de ${feature}`, `ADDED ${counts.ADDED} · MODIFIED ${counts.MODIFIED} · REMOVED ${counts.REMOVED} · RENAMED ${counts.RENAMED} (total ${delta.entries.length}) · ${strangler.detail}`, deltaErrors.length > 0 ? 'warn' : 'ok', deltaErrors.length > 0 ? `${deltaErrors.length} error(es) de validación de la delta` : undefined));
        }
    }
    else if (deltas.length > DELTA_LINES_MAX) {
        // Se agrega TODO lo inspeccionado: nunca se recorta una lista en silencio.
        const totals = { ADDED: 0, MODIFIED: 0, REMOVED: 0, RENAMED: 0 };
        const states = { legacy: 0, both: 0, new: 0 };
        let entries = 0;
        let deltaErrors = 0;
        for (const { delta } of deltas) {
            const counts = deltaCounts(delta);
            totals.ADDED += counts.ADDED;
            totals.MODIFIED += counts.MODIFIED;
            totals.REMOVED += counts.REMOVED;
            totals.RENAMED += counts.RENAMED;
            entries += delta.entries.length;
            for (const entry of delta.entries)
                states[entry.strangler ?? 'legacy'] += 1;
            deltaErrors += validateDeltaSpec(delta).filter((issue) => issue.severity === 'error').length;
        }
        lines.push(content('Delta', `${deltas.length} feature(s) con delta: ADDED ${totals.ADDED} · MODIFIED ${totals.MODIFIED} · REMOVED ${totals.REMOVED} · RENAMED ${totals.RENAMED} (total ${entries}) · Estrangulamiento: ${states.new}/${entries} entradas completamente en el camino nuevo; ${states.both} conviven y ${states.legacy} siguen en el legado.`, deltaErrors > 0 ? 'warn' : 'ok', deltaErrors > 0 ? `${deltaErrors} error(es) de validación de la delta` : undefined));
    }
    else {
        const deltaDemand = demandsFor(brownfield).delta;
        if (!brownfield) {
            lines.push(content('Delta', 'no aplica: proyecto greenfield declarado y sin delta.md', 'dim'));
        }
        else if (deltaDemand === 'required') {
            lines.push(content('Delta', `brownfield sin delta: el nivel ${level} exige el contrato del cambio`, 'err', `créala con open-sdd delta init ${focus ?? '<feature>'} "..."`));
        }
        else {
            lines.push(content('Delta', `brownfield sin delta: el nivel ${level} no la exige`, 'dim'));
        }
    }
    // ── Contratos: oráculo de regresión (declarado vs descubierto y huecos) ─────────────────────
    lines.push(section('Contratos'));
    const gitRepo = isGitRepo(root);
    if (!gitRepo) {
        failures.push('no es un repositorio git: el origen del cambio quedó sin determinar');
        lines.push(content('Contratos', 'cambios no evaluables: no es un repositorio git', 'warn', 'sin origen del cambio no hay huecos de cobertura que medir'));
    }
    const changedFiles = gitRepo ? getModifiedFiles(root) : [];
    let contractSet = null;
    let missingDeclared = [];
    if (focus && focusInspection?.delta) {
        try {
            const project = await scanProject(root);
            contractSet = await extractContracts({
                cwd: root,
                feature: focus,
                changedFiles,
                delta: focusInspection.delta,
                testDirs: project.testDirs,
                ...(project.testFramework ? { testFramework: project.testFramework } : {}),
            });
            const derived = testCommandFor(project.testFramework);
            const declared = contractSet.contracts.filter((contract) => contract.source === 'delta');
            const discovered = contractSet.contracts.length - declared.length;
            // «Declarado pero inexistente» = la prueba que la delta promete NO EXISTE como fichero (ni
            // resuelve a una prueba descubierta). Es la definición honesta del hueco: `verifyContracts`
            // compara declarado contra descubierto, y lo descubierto solo sale de los ficheros CAMBIADOS,
            // de modo que un contrato declarado sobre un fichero que ya existe pero no entra en este cambio
            // aparecería como «inexistente» sin serlo. Aquí un fichero que existe nunca es un contrato
            // ausente; lo que se denuncia es una promesa que el repositorio no tiene.
            const declaredContracts = [
                ...new Set(focusInspection.delta.entries.flatMap((entry) => entry.contracts ?? [])),
            ];
            const discoveredTests = contractSet.contracts
                .filter((contract) => contract.source === 'discovered')
                .map((contract) => contract.test);
            missingDeclared = declaredContracts.filter((declared) => {
                const file = declared.split('::')[0].trim();
                if (file && existsSync(path.join(root, file)))
                    return false;
                return !discoveredTests.some((test) => sameTestFile(test, declared));
            });
            const uncovered = contractSet.uncoveredChanges;
            const contractsDemand = demandsFor(brownfield).contracts;
            if (!contractSet.complete) {
                failures.push(`el conjunto de contratos de "${focus}" no está completo (${contractSet.detail})`);
            }
            lines.push(content(`Contratos de ${focus}`, `${contractSet.contracts.length} contrato(s): ${discovered} descubierto(s), ${declared.length} declarado(s) · ${uncovered.length} cambio(s) sin cobertura · comando ${derived.command}${derived.derived ? '' : ' (derivado, no verificado)'}`, uncovered.length > 0
                ? contractsDemand === 'required'
                    ? 'err'
                    : 'warn'
                : missingDeclared.length > 0
                    ? 'warn'
                    : contractSet.complete
                        ? 'ok'
                        : 'warn'));
            if (missingDeclared.length > 0) {
                lines.push(content(`Contratos de ${focus}`, `declarados por la delta que no existen: ${missingDeclared.join(', ')}`, 'warn'));
            }
            if (project.testDirs.length === 0) {
                lines.push(content(`Contratos de ${focus}`, 'sin directorios de test: no hay oráculo descubierto (no es un aprobado)', 'warn'));
            }
        }
        catch (err) {
            failures.push(`los contratos de "${focus}" no son evaluables (${err.message})`);
            lines.push(content(`Contratos de ${focus}`, `no evaluables (${err.message})`, 'warn'));
        }
    }
    else if (!focusInspection?.delta && gitRepo) {
        lines.push(content('Contratos', 'sin delta: no hay contratos declarados que extraer', 'dim'));
    }
    // ── Constitucional: el pivote de la pieza 1 ─────────────────────────────────────────────────
    lines.push(section('Constitucional'));
    const outcome = await alignFeature(root, { ...(focus ? { feature: focus } : {}), sddDir });
    failures.push(...outcome.uninspected);
    if (!outcome.alignment) {
        lines.push(content('Constitucional', `pivote no ejecutado: ${outcome.error ?? 'sin datos'}`, 'warn', 'no se puede afirmar que la spec respete una autoridad que no se pudo leer'));
    }
    else {
        const alignment = outcome.alignment;
        const errors = alignment.findings.filter((finding) => finding.severity === 'error');
        const warnings = alignment.findings.filter((finding) => finding.severity === 'warning');
        const note = undecidedNote(alignment.detail);
        lines.push(content('Constitucional', `declarados: ${alignment.declared.join(', ') || 'ninguno'} · alineación ${(alignment.alignment * 100).toFixed(0)}% · ${alignment.findings.length} hallazgo(s)${errors.length > 0 ? ` (${errors.length} error(es))` : ''}`, errors.length > 0 ? 'err' : warnings.length > 0 || note ? 'warn' : 'ok', alignment.findings.length > 0
            ? alignment.findings.slice(0, 3).map((finding) => `${finding.code}${finding.principleId ? ` (${finding.principleId})` : ''}`).join(', ')
            : undefined));
        if (note) {
            lines.push(content('Constitucional (no evaluado)', note, 'warn'));
        }
    }
    // ── Rigor: nivel declarado y gates que activa ───────────────────────────────────────────────
    lines.push(section('Rigor'));
    if (rigorError) {
        lines.push(content('Rigor', 'declarado no evaluable: se informa como no evaluado, no como spec-first', 'warn', rigorError));
    }
    else {
        lines.push(content('Rigor', `${level} · gates activos ${gates.join(', ') || '(ninguno)'} · ${brownfield ? 'brownfield' : 'greenfield'}`, 'ok'));
    }
    // ── Siguiente: una sola acción, ejecutable, coherente con el nivel ─────────────────────────
    const nextAction = chooseNextAction({
        constitutionState,
        level,
        brownfield,
        focus,
        focusHasDelta: Boolean(focusInspection?.delta),
        missingDeclared,
        uncoveredChanges: contractSet?.uncoveredChanges ?? [],
        changeOriginKnown: gitRepo,
        gates,
    });
    lines.push(section('Siguiente'));
    lines.push(content('Siguiente', nextAction ?? 'sin acción determinada', nextAction ? 'dim' : 'warn'));
    return {
        root,
        level,
        gates,
        brownfield,
        lines,
        ...(nextAction ? { nextAction } : {}),
        complete: failures.length === 0,
    };
};
/**
 * La única siguiente acción, en el orden del contrato. Todas son comandos ejecutables.
 *
 * El guardia de nivel es deliberado: el paso «no hay delta en brownfield» solo aplica cuando el
 * nivel DECLARADO exige la delta (`rigorRequires`), y la inspección final usa los gates que el nivel
 * activa (`effectiveGates`). Así un proyecto `spec-first` nunca recibe una exigencia de
 * `spec-as-source`.
 */
const chooseNextAction = (input) => {
    if (input.constitutionState === 'missing' || input.constitutionState === 'invalid') {
        return 'open-sdd brownfield constitution . --write';
    }
    // Ilegible: se re-deriva SIN --write, porque sobrescribir lo que no se pudo leer perdería trabajo.
    if (input.constitutionState === 'unreadable')
        return 'open-sdd brownfield constitution .';
    const demands = rigorRequires(input.level, input.brownfield);
    if (input.focus && input.brownfield && demands.delta === 'required' && !input.focusHasDelta) {
        return `open-sdd delta init ${input.focus} "..."`;
    }
    if (input.focus && input.missingDeclared.length > 0) {
        return `open-sdd brownfield contracts ${input.focus}`;
    }
    if (input.focus && input.changeOriginKnown && input.uncoveredChanges.length > 0) {
        return `open-sdd brownfield contracts ${input.focus} --write`;
    }
    return input.gates.length > 0 ? `open-sdd gates run ${input.gates.join(' ')}` : 'open-sdd gates run';
};
/**
 * Renderizar el panel a líneas de texto PLANO.
 *
 * Contrato del renderizador, elegido para que el llamante no tenga que parsear nada:
 *  - una entrada por `StatusLine`, en el mismo orden, para poder colorear con
 *    `report.lines[i].tone` (los índices coinciden exactamente);
 *  - sin ANSI: el color es decisión del llamante, y el JSON no lleva secuencias de escape;
 *  - `value` vacío marca cabecera de sección y se imprime como tal.
 */
export const renderStatus = (report) => report.lines.map((line) => {
    if (!line.value)
        return `  ${line.label}`;
    return `  ${line.label} — ${line.value}${line.detail ? ` (${line.detail})` : ''}`;
});
