/**
 * `sddScore` — UN número compuesto y UNA fase.
 *
 * El producto creció a una superficie grande (constitución, EARS, delta, trazabilidad, evidencia,
 * contratos, gates, pivote, trinquete…) y cada pieza sabe decirlo por separado. Lo que faltaba era la
 * síntesis: «¿dónde estoy, de 0 a 100, y qué hago ahora?». Este módulo es esa síntesis, y su regla
 * primera es NO INVENTAR UN ORÁCULO NUEVO: cada componente es el resultado de una comprobación que ya
 * existe y ya está testeada. Aquí solo se pondera y se resume.
 *
 * ── Qué se reutiliza (nada se reimplementa) ─────────────────────────────────────────────────────
 *   constitución   `constitution.ts`            → `validateConstitution` + `principlesInForce`
 *   EARS           `earsAssistant.analyseEars`  → conformidad de los enunciados de requirements.md
 *   trazabilidad   `deltaSpec.traceDelta`       → requisito de la delta con tarea (y fantasmas)
 *   evidencia      `triad.checkEvidenceLock`    → tarea completada con `_Evidence:` capturada
 *   contratos      `executionContract.extractContracts` → contrato declarado vs. oráculo real
 *   gates          `gateRunner.runChain`        → la cadena que activa el nivel declarado
 *                    (si el comando de la MISMA invocación ya ejecutó la cadena con sus propios ids,
 *                     perfil y alcance, el pie no la reproduce: la declara NO MEDIDA en vez de
 *                     arriesgar un «gates OK» que ese comando desmiente — ver el invariante abajo)
 *   alineación     `specConstitution.alignSpecWithConstitution` → el pivote constitucional
 * Las lecturas del repositorio (raíz, constitución, spec, rigor) se apoyan en `status.ts` y
 * `specManager.ts`, que ya resuelven las mismas rutas: una segunda resolución de rutas sería una
 * segunda verdad.
 *
 * ── Pesos (suman 100) y por qué ─────────────────────────────────────────────────────────────────
 *   constitución 20  Es la autoridad que cita todo veredicto bloqueante y el suelo de TODOS los
 *                    niveles de rigor; sin ella ninguna otra comprobación tiene contra qué juzgar.
 *   EARS         15  Un requisito que no está en forma comprobable no se puede verificar: es la
 *                    puerta de la fase 1 y el insumo del gate C1.
 *   trazabilidad 15  Requisito→tarea es lo que hace auditable la cobertura; en brownfield es el
 *                    contrato de la delta. Mismo peso que EARS: sin traza, la conformidad no se
 *                    puede atribuir a nada.
 *   evidencia    15  Invariante I2: la diferencia entre «hecho» y «afirmado hecho». Mismo peso que
 *                    EARS y traza porque cierra la fase 2.
 *   contratos    10  El oráculo de regresión. Pesa menos porque solo los proyectos brownfield/delta
 *                    pueden medirlo: un componente que no siempre es medible no puede dominar.
 *   gates        15  La cadena del nivel declarado es el suelo de ejecución; su veredicto ya es
 *                    bloqueante por sí mismo, así que aquí se pondera, no se duplica la autoridad.
 *   alineación   10  El pivote/trinquete constitucional. Pesa menos que los gates porque ya tiene su
 *                    propio veredicto bloqueante en `status --check`; aquí se resume.
 *
 * ── Reglas de fase (implementadas tal cual) ─────────────────────────────────────────────────────
 *   Fase 1 · Especificar  la especificación está INCOMPLETA: no hay constitución (o no es válida, o
 *                         no se pudo leer), no hay ninguna especificación, falta requirements.md (o no
 *                         se pudo leer), EARS no encontró ningún requisito, o EARS reporta errores.
 *   Fase 2 · Implementar  la especificación está sana pero la implementación no está cerrada: no
 *                         todas las tareas están completadas CON evidencia capturada (o no hay
 *                         tasks.md que inspeccionar), o la cadena de gates del nivel no pasa.
 *   Fase 3 · Verificar    TODAS las tareas llevan evidencia y la cadena del nivel declarado pasa sin
 *                         gates auto-autorizados. Es la única fase que se declara terminada.
 * Una fase NUNCA se apoya en un componente que no se inspeccionó: lo no medible se declara en
 * `notMeasured` y su peso se excluye del denominador (ver `detail`), en vez de puntuarse 0 o 1.
 *
 * Nota de idioma: los textos visibles son español, como el resto del CLI. Los identificadores son
 * estables (`constitution`, `ears`, `traceability`, …) porque viajan en el sobre JSON.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { principlesInForce, validateConstitution, } from './constitution.js';
import { analyseEars } from './earsAssistant.js';
import { traceDelta } from './deltaSpec.js';
import { extractContracts } from './executionContract.js';
import { runChain } from './gateRunner.js';
import { getModifiedFiles, isGitRepo } from './git.js';
import { scanProject } from './reverseEngineering.js';
import { effectiveGates, loadRigorSettings } from './rigor.js';
import { parseTasksMarkdown, resolveSddDir } from './specManager.js';
import { alignSpecWithConstitution } from './specConstitution.js';
import { constitutionCandidates, findRepoRoot, focusFeature, inspectFeature, loadConstitution, } from './status.js';
import { checkEvidenceLock } from './triad.js';
const PHASE_LABELS = {
    1: 'Fase 1 · Especificar',
    2: 'Fase 2 · Implementar',
    3: 'Fase 3 · Verificar',
};
const PHASE_SHORT = { 1: 'Especificar', 2: 'Implementar', 3: 'Verificar' };
/** Pesos declarados en la cabecera; suman 100 por construcción. */
export const SDD_SCORE_WEIGHTS = {
    constitution: 20,
    ears: 15,
    traceability: 15,
    evidence: 15,
    contracts: 10,
    gates: 15,
    alignment: 10,
};
const LABELS = {
    constitution: 'constitución',
    ears: 'EARS',
    traceability: 'trazabilidad',
    evidence: 'evidencia',
    contracts: 'contratos',
    gates: 'gates',
    alignment: 'alineación',
};
const measured = (id, score, evidence) => ({
    id,
    measured: true,
    score: Math.max(0, Math.min(1, score)),
    evidence,
});
const unmeasured = (id, reason, name) => ({
    id,
    measured: false,
    score: 0,
    evidence: `NO MEDIDO (peso ${SDD_SCORE_WEIGHTS[id]} excluido del total): ${reason}`,
    ...(name ? { name } : {}),
});
/** Comparación de referencias de contrato (`ruta::prueba`, `./ruta`) tolerante a prefijos. */
const sameContractRef = (a, b) => {
    const norm = (value) => value.split('::')[0].trim().replace(/\\/g, '/').replace(/^\.\//, '');
    const left = norm(a);
    const right = norm(b);
    if (!left || !right)
        return false;
    return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
};
const unreadable = (inspection, fileName) => Boolean(inspection?.unreadable.some((rel) => rel.endsWith(fileName)));
export const computeSddScore = async (cwd, opts = {}) => {
    const root = await findRepoRoot(cwd);
    const sddDir = opts.sddDir ?? (await resolveSddDir(root));
    const feature = opts.feature ?? (await focusFeature(root, sddDir));
    const constitutionRead = await loadConstitution(root, sddDir);
    const constitution = constitutionRead.constitution;
    const inspection = feature ? await inspectFeature(root, feature, sddDir) : null;
    const gitRepo = isGitRepo(root);
    const changedFiles = gitRepo ? getModifiedFiles(root) : [];
    const outcomes = [];
    const extraNotMeasured = [];
    // ── 1. Constitución: presente + válida + principios en vigor ──────────────────────────────────
    let constitutionValid = false;
    if (!constitutionRead.exists) {
        outcomes.push(measured('constitution', 0, `ausente (${constitutionCandidates(sddDir)[0]}): no hay autoridad que citar`));
    }
    else if (!constitution) {
        outcomes.push(unmeasured('constitution', `existe pero no se pudo leer (${constitutionRead.error ?? 'error de lectura'})`));
    }
    else {
        const issues = validateConstitution(constitution);
        const errors = issues.filter((issue) => issue.severity === 'error');
        const warnings = issues.filter((issue) => issue.severity === 'warning');
        const inForce = principlesInForce(constitution);
        constitutionValid = errors.length === 0 && inForce.length > 0;
        outcomes.push(measured('constitution', constitutionValid ? 1 : 0, `presente y ${constitutionValid ? 'válida' : 'inválida'} · ${inForce.length} principio(s) en vigor` +
            `${errors.length > 0 ? ` · ${errors.length} error(es)` : ''}${warnings.length > 0 ? ` · ${warnings.length} aviso(s)` : ''}`));
    }
    // ── 2. EARS: conformidad de los enunciados de requirements.md ────────────────────────────────
    let earsErrors = 0;
    let earsTotal = 0;
    if (!inspection || inspection.requirements === null) {
        if (unreadable(inspection, 'requirements.md')) {
            outcomes.push(unmeasured('ears', 'requirements.md existe pero no se pudo leer'));
        }
        else {
            outcomes.push(measured('ears', 0, 'requirements.md ausente: no hay enunciados que comprobar'));
        }
    }
    else {
        const report = analyseEars(inspection.requirements, { source: 'requirements.md' });
        earsTotal = report.total;
        earsErrors = report.suggestions.filter((suggestion) => suggestion.severity === 'error').length;
        const warnings = report.suggestions.filter((suggestion) => suggestion.severity === 'warning').length;
        if (report.total === 0) {
            outcomes.push(measured('ears', 0, 'requirements.md sin requisitos REQ-*: no se comprobó ningún enunciado'));
        }
        else {
            outcomes.push(measured('ears', report.conforming / report.total, `${report.conforming}/${report.total} requisito(s) conforme(s) · ${earsErrors} error(es) · ${warnings} aviso(s)`));
        }
    }
    // ── 3. Trazabilidad: requisito de la delta → tarea ───────────────────────────────────────────
    let traceGap = 0;
    if (!inspection || inspection.delta === null) {
        outcomes.push(unreadable(inspection, 'delta.md')
            ? unmeasured('traceability', 'delta.md existe pero no se pudo leer')
            : unmeasured('traceability', 'delta.md ausente: no hay contrato de cambio que trazar'));
    }
    else if (inspection.tasks === null) {
        outcomes.push(unreadable(inspection, 'tasks.md')
            ? unmeasured('traceability', 'tasks.md existe pero no se pudo leer')
            : unmeasured('traceability', 'tasks.md ausente: no hay tareas contra las que trazar'));
    }
    else {
        const delta = inspection.delta;
        if (delta.entries.length === 0) {
            outcomes.push(measured('traceability', 0, 'delta sin entradas: no hay requisito que trazar'));
        }
        else {
            const trace = traceDelta(delta, parseTasksMarkdown(inspection.tasks));
            traceGap = trace.unmapped.length + trace.phantomTasks.length + trace.unfilledPlaceholders.length;
            const sound = trace.phantomTasks.length === 0 && trace.unfilledPlaceholders.length === 0;
            outcomes.push(measured('traceability', sound ? trace.coverage : 0, trace.detail));
        }
    }
    // ── 4. Evidencia: tareas completadas con `_Evidence:` capturada ──────────────────────────────
    let tasksTotal = 0;
    let evidenceScore = 0;
    let evidenceMeasured = false;
    if (!inspection || inspection.tasks === null) {
        outcomes.push(unreadable(inspection, 'tasks.md')
            ? unmeasured('evidence', 'tasks.md existe pero no se pudo leer')
            : unmeasured('evidence', 'tasks.md ausente: no hay completitud que acreditar'));
    }
    else {
        const parsed = parseTasksMarkdown(inspection.tasks);
        tasksTotal = parsed.length;
        if (tasksTotal === 0) {
            evidenceMeasured = true;
            outcomes.push(measured('evidence', 0, 'tasks.md sin tareas: no hay completitud que acreditar'));
        }
        else {
            const lock = checkEvidenceLock(inspection.tasks);
            const withEvidence = lock.checked - lock.unprovenCompletions.length;
            evidenceMeasured = true;
            evidenceScore = withEvidence / tasksTotal;
            outcomes.push(measured('evidence', evidenceScore, `${withEvidence}/${tasksTotal} tarea(s) con evidencia · ${lock.unprovenCompletions.length} completada(s) sin _Evidence:_ · ${tasksTotal - lock.checked} pendiente(s)`));
        }
    }
    // ── 5. Contratos: lo declarado por la delta vs. el oráculo que existe ────────────────────────
    if (!inspection || inspection.delta === null) {
        outcomes.push(unmeasured('contracts', 'sin delta: no hay contratos declarados que extraer'));
    }
    else {
        const declaredRefs = [
            ...new Set(inspection.delta.entries.flatMap((entry) => entry.contracts ?? []).map((ref) => ref.trim()).filter(Boolean)),
        ];
        try {
            const project = await scanProject(root);
            if (declaredRefs.length === 0 && project.testDirs.length === 0) {
                outcomes.push(unmeasured('contracts', 'la delta no declara contratos y no se detectó ningún directorio de test'));
            }
            else {
                const set = await extractContracts({
                    cwd: root,
                    ...(feature ? { feature } : {}),
                    changedFiles,
                    delta: inspection.delta,
                    testDirs: project.testDirs,
                    ...(project.testFramework ? { testFramework: project.testFramework } : {}),
                });
                if (declaredRefs.length > 0) {
                    const fileExists = (ref) => {
                        const file = ref.split('::')[0].trim();
                        return file.length > 0 && existsSync(path.join(root, file));
                    };
                    const backed = declaredRefs.filter((ref) => fileExists(ref) || set.contracts.some((contract) => sameContractRef(contract.test, ref)));
                    const missing = declaredRefs.filter((ref) => !backed.includes(ref));
                    outcomes.push(measured('contracts', backed.length / declaredRefs.length, `${backed.length}/${declaredRefs.length} contrato(s) declarado(s) respaldado(s)${missing.length > 0 ? ` · faltan: ${missing.join(', ')}` : ''}`));
                }
                else {
                    const score = set.contracts.length === 0 ? 0 : set.uncoveredChanges.length === 0 ? 1 : 0.5;
                    outcomes.push(measured('contracts', score, `${set.contracts.length} contrato(s) descubierto(s) · ${set.uncoveredChanges.length} cambio(s) sin cobertura`));
                }
            }
        }
        catch (err) {
            outcomes.push(unmeasured('contracts', `no evaluables (${err.message})`));
        }
    }
    let gatesPassed = false;
    let gatesMeasured = false;
    /** Ids de la cadena realmente puntuada; se guarda aparte para que el análisis de flujo los vea. */
    let gatesAssessed = [];
    /**
     * Puntuar una ejecución de la cadena. Existe como función para que el MISMO código puntúe la
     * cadena que corre el pie y la que le inyecta un llamante (o un test): dos caminos distintos
     * producirían dos veredictos distintos, que es exactamente el defecto que se está corrigiendo.
     */
    const applyGateReport = (report) => {
        gatesAssessed = report.findings.map((finding) => finding.gateId);
        if (report.findings.length === 0) {
            outcomes.push(unmeasured('gates', 'la cadena no produjo ningún hallazgo: no se inspeccionó nada'));
            return;
        }
        const selfAuthorized = report.findings.filter((finding) => finding.outcome === 'self-authorized');
        for (const finding of selfAuthorized)
            extraNotMeasured.push(`gate ${finding.gateId} (auto-autorizado)`);
        if (selfAuthorized.length === report.findings.length) {
            outcomes.push(unmeasured('gates', `todos los gates se auto-autorizaron (sensores no disponibles): ${report.findings.map((finding) => finding.gateId).join(', ')}`));
            return;
        }
        gatesMeasured = true;
        gatesPassed = report.passed && report.unavailable.length === 0;
        const credit = report.findings.filter((finding) => finding.outcome === 'pass' || finding.outcome === 'advisory').length;
        const failed = report.findings.filter((finding) => finding.outcome === 'fail').length;
        const assessed = report.findings.map((finding) => finding.gateId).join(', ');
        outcomes.push(measured('gates', credit / report.findings.length, `${credit}/${report.findings.length} gate(s) acreditan el control (${assessed}) · ${failed} fallo(s)` +
            `${selfAuthorized.length > 0 ? ` · ${selfAuthorized.length} auto-autorizado(s) sin acreditar` : ''}`));
    };
    // ── 6. Gates: la cadena que activa el nivel declarado ───────────────────────────────────────
    //
    // INVARIANTE: el pie NUNCA puede decir «gates OK» mientras el comando de esta misma invocación
    // acaba de decir que la cadena NO pasa. Por eso hay tres caminos, y solo uno corre la cadena:
    //   · `gateRun` inyectado → se puntúa ESA ejecución (el comando la produjo; opción (a)).
    //   · `gateContext: 'external'` → el comando acaba de ejecutar la cadena con SUS ids, su perfil,
    //     su régimen y su alcance (`--staged`/`--base`); el pie no puede reproducirla, así que la
    //     declara NO MEDIDA en vez de inventarse un veredicto (opción (c)).
    //   · por defecto → el pie mide la cadena del nivel declarado (`effectiveGates`), que es lo que
    //     documenta este componente.
    if (opts.gateContext === 'external') {
        outcomes.push(unmeasured('gates', 'la cadena la ejecutó este comando en esta invocación (sus ids, su perfil, su alcance): el pie no puede conocer su veredicto', 'gates (no medidos en esta ejecución)'));
    }
    else if (opts.gateRun) {
        applyGateReport(opts.gateRun);
    }
    else {
        try {
            const settings = await loadRigorSettings(root, sddDir);
            const gates = effectiveGates(settings.level, settings.gates);
            if (gates.length === 0) {
                outcomes.push(unmeasured('gates', `el nivel ${settings.level} no activa ningún gate`));
            }
            else {
                applyGateReport(await runChain(gates, {
                    cwd: root,
                    sddDir,
                    feature: feature ?? '(sin-feature)',
                    changedFiles,
                    declaredScope: [],
                }));
            }
        }
        catch (err) {
            outcomes.push(unmeasured('gates', `el rigor declarado no se pudo leer (${err.message})`));
        }
    }
    // ── 7. Alineación: el pivote constitucional ─────────────────────────────────────────────────
    if (!constitution) {
        outcomes.push(unmeasured('alignment', `constitución ${constitutionRead.exists ? 'ilegible' : 'ausente'}: sin autoridad no hay pivote que ejecutar`));
    }
    else if (!inspection || !inspection.dirExists) {
        outcomes.push(unmeasured('alignment', 'no hay especificación sobre la que ejecutar el pivote'));
    }
    else {
        try {
            const alignment = alignSpecWithConstitution({
                feature: inspection.feature,
                constitution,
                ...(inspection.requirements !== null ? { requirements: inspection.requirements } : {}),
                ...(inspection.plan !== null ? { plan: inspection.plan } : {}),
                ...(inspection.tasks !== null ? { tasks: inspection.tasks } : {}),
                ...(inspection.delta !== null ? { delta: inspection.delta } : {}),
                ...(gitRepo ? { changedFiles } : {}),
            });
            const errors = alignment.findings.filter((finding) => finding.severity === 'error');
            outcomes.push(measured('alignment', errors.length > 0 ? 0 : alignment.alignment, `declarados: ${alignment.declared.join(', ') || 'ninguno'} · alineación ${(alignment.alignment * 100).toFixed(0)}% · ${errors.length} error(es)` +
                `${gitRepo ? '' : ' · origen del cambio sin determinar (no es un repositorio git)'}`));
        }
        catch (err) {
            outcomes.push(unmeasured('alignment', `el pivote no se pudo ejecutar (${err.message})`));
        }
    }
    // ── El total: media ponderada SOLO sobre lo medido ───────────────────────────────────────────
    const components = outcomes.map((outcome) => ({
        id: outcome.id,
        label: LABELS[outcome.id],
        weight: SDD_SCORE_WEIGHTS[outcome.id],
        score: outcome.score,
        evidence: outcome.evidence,
    }));
    const notMeasured = [
        ...outcomes.filter((outcome) => !outcome.measured).map((outcome) => outcome.name ?? LABELS[outcome.id]),
        ...extraNotMeasured,
    ];
    const measuredOutcomes = outcomes.filter((outcome) => outcome.measured);
    const measuredWeight = measuredOutcomes.reduce((sum, outcome) => sum + SDD_SCORE_WEIGHTS[outcome.id], 0);
    const raw = measuredOutcomes.reduce((sum, outcome) => sum + SDD_SCORE_WEIGHTS[outcome.id] * outcome.score, 0);
    const total = measuredWeight === 0 ? 0 : Math.round((raw / measuredWeight) * 100);
    // ── Fase: las tres reglas de la cabecera, en orden ───────────────────────────────────────────
    const incomplete = [];
    if (!constitutionValid)
        incomplete.push('constitución ausente o no válida');
    if (!feature)
        incomplete.push('sin ninguna especificación');
    else if (!inspection || inspection.requirements === null)
        incomplete.push('requirements.md ausente');
    else if (earsTotal === 0)
        incomplete.push('EARS no encontró ningún requisito');
    else if (earsErrors > 0)
        incomplete.push(`${earsErrors} error(es) EARS`);
    const specSound = incomplete.length === 0;
    const phase = !specSound
        ? 1
        : evidenceMeasured && evidenceScore === 1 && tasksTotal > 0 && gatesPassed
            ? 3
            : 2;
    const phaseLabel = PHASE_LABELS[phase];
    const nextAction = chooseNextAction({
        constitutionState: !constitutionRead.exists ? 'missing' : !constitution ? 'unreadable' : constitutionValid ? 'valid' : 'invalid',
        feature,
        requirementsMissing: !inspection || inspection.requirements === null,
        earsErrors,
        traceGap,
        traceabilityMeasured: outcomes.find((outcome) => outcome.id === 'traceability')?.measured ?? false,
        evidenceMeasured,
        evidenceScore,
        contractsMeasured: outcomes.find((outcome) => outcome.id === 'contracts')?.measured ?? false,
        contractsScore: outcomes.find((outcome) => outcome.id === 'contracts')?.score ?? 0,
        gatesMeasured,
        gatesPassed,
        gates: gatesAssessed,
    });
    const detail = `Total ${total}/100 = Σ(peso·score de lo medido) / Σ(peso medido) = ${raw.toFixed(1)}/${measuredWeight} · ` +
        `peso medido ${measuredWeight}/100 · peso NO medido ${100 - measuredWeight}/100` +
        `${notMeasured.length > 0 ? ` (${notMeasured.join(', ')})` : ''}: lo no medido NO se puntúa 0 ni 1, se excluye del denominador y se declara en notMeasured. ` +
        `Fase ${phase} · ${PHASE_SHORT[phase]}: ${specSound ? 'especificación sana' : `especificación incompleta (${incomplete.join('; ')})`}` +
        `${phase === 2 ? '; la implementación no está cerrada con evidencia' : ''}` +
        `${phase === 3 ? '; todas las tareas llevan evidencia y los gates del nivel pasan' : ''}.`;
    return {
        total,
        phase,
        phaseLabel,
        components,
        nextAction,
        notMeasured,
        detail,
    };
};
/**
 * La única siguiente acción, en el orden que fija la fase. Todas son comandos ejecutables.
 *
 * La prioridad es deliberada: primero la autoridad (sin constitución no se juzga nada), después la
 * forma del requisito (EARS), después la traza, después la implementación y por último la
 * verificación. Un proyecto `spec-first` sin delta nunca recibe una exigencia de nivel superior
 * porque la traza sin medir no entra en este cálculo.
 */
const chooseNextAction = (input) => {
    if (input.constitutionState === 'missing' || input.constitutionState === 'invalid') {
        return 'open-sdd brownfield constitution . --write';
    }
    if (input.constitutionState === 'unreadable')
        return 'open-sdd brownfield constitution .';
    if (!input.feature)
        return 'open-sdd init <feature>';
    if (input.requirementsMissing)
        return `open-sdd init ${input.feature}`;
    if (input.earsErrors > 0)
        return `open-sdd govern --advise-ears ${input.feature}`;
    if (input.traceabilityMeasured && input.traceGap > 0)
        return `open-sdd delta validate ${input.feature}`;
    if (input.evidenceMeasured && input.evidenceScore < 1)
        return `open-sdd impl ${input.feature}`;
    if (input.contractsMeasured && input.contractsScore < 1)
        return `open-sdd brownfield contracts ${input.feature}`;
    if (input.gatesMeasured && !input.gatesPassed) {
        return input.gates.length > 0 ? `open-sdd gates run ${input.gates.join(' ')}` : 'open-sdd gates run';
    }
    return 'open-sdd status --check';
};
/** Por qué ESA acción, en una línea. La usa la puerta sin argumentos. */
export const explainNextAction = (report) => {
    const action = report.nextAction;
    if (action.includes('brownfield constitution') && action.includes('--write')) {
        return 'no hay constitución: es el suelo de todos los niveles.';
    }
    if (action.includes('brownfield constitution')) {
        return 'la constitución existe pero no se pudo leer: se re-deriva sin --write para no perder trabajo.';
    }
    if (action === 'open-sdd init <feature>' || action.startsWith('open-sdd init ')) {
        return 'no hay ninguna especificación que inspeccionar.';
    }
    if (action.includes('--advise-ears')) {
        return 'los requisitos no están en forma EARS comprobable.';
    }
    if (action.includes('delta validate')) {
        return 'la delta tiene requisitos que no trazan a ninguna tarea.';
    }
    if (action.startsWith('open-sdd impl ')) {
        return 'la especificación está sana y quedan tareas sin evidencia capturada.';
    }
    if (action.includes('brownfield contracts')) {
        return 'hay contratos declarados que el repositorio no respalda.';
    }
    if (action.includes('gates run')) {
        return 'la cadena de gates del nivel declarado no pasa.';
    }
    if (action.includes('status --check')) {
        return 'todo lleva evidencia: falta el veredicto constitucional que cierra la verificación.';
    }
    return 'es la comprobación que cierra la fase actual.';
};
/**
 * UNA línea, siempre. Es el pie que aparece en cada comando y la salida de la puerta sin argumentos.
 * Formato: `SDD <total>% · Fase <n> · <Verbo> · <componente> <pct>% · … · siguiente: <comando>`.
 * Los componentes no medidos se omiten del porcentaje y se agrupan en `sin medir: …`.
 */
export const renderScoreFooter = (report) => {
    const parts = [`SDD ${report.total}%`, `Fase ${report.phase}`, PHASE_SHORT[report.phase]];
    // Un componente no medido se omite del porcentaje. El nombre puede llevar un matiz entre
    // paréntesis («gates (no medidos en esta ejecución)»), así que se compara por prefijo.
    const isUnmeasured = (label) => report.notMeasured.some((name) => name === label || name.startsWith(`${label} (`));
    for (const component of report.components) {
        if (isUnmeasured(component.label))
            continue;
        if (component.id === 'gates') {
            // Name the gates that were assessed: "gates OK" alone reads as "the whole chain passed",
            // which is a different claim. The score judges the gates the DECLARED LEVEL activates, while
            // the gates command can execute a different set (for example the full seven).
            const assessed = (component.evidence.match(/C\d+|O\d+/g) ?? []).join(', ');
            const suffix = assessed.length > 0 ? ` (${assessed}, las del nivel declarado)` : '';
            parts.push(component.score === 1
                ? `gates OK${suffix}`
                : `gates ${Math.round(component.score * 100)}%${suffix}`);
            continue;
        }
        parts.push(`${component.label} ${Math.round(component.score * 100)}%`);
    }
    if (report.notMeasured.length > 0)
        parts.push(`sin medir: ${report.notMeasured.join(', ')}`);
    parts.push(`siguiente: ${report.nextAction}`);
    return parts.join(' · ');
};
