/**
 * CLARIFY: la interrogación acotada, derivada y verificada.
 *
 * `/clarify` en la referencia (spec-kit) pregunta «hasta 5 preguntas muy dirigidas» y codifica las
 * respuestas en la especificación. Aquí el motor de ambigüedad ya existe y es determinista
 * (`earsAssistant.analyseEars`: `COMPOUND_REQUIREMENT`, `VAGUE_TERM`, `MISSING_TRIGGER`…), y la
 * trazabilidad delta→tareas ya sabe qué marcador `{{…}}` quedó sin rellenar
 * (`deltaSpec.traceDelta`). Lo que faltaba no era detectar: era CONVERTIR cada hallazgo en la
 * pregunta exacta que falta, aplicar la respuesta y DEMOSTRAR que el código desapareció.
 *
 * ── Las cinco reglas que gobiernan este módulo ─────────────────────────────────────────────────
 *
 *  1. LAS PREGUNTAS SE DERIVAN, NO SE INVENTAN. Toda pregunta cita el código que la levanta y el
 *     artefacto (fichero + línea) del que sale. Y, sobre todo: un dato que el repositorio ya puede
 *     calcular NO se pregunta — se responde desde la evidencia y se registra en `fromEvidence`. Por
 *     eso `NO_ACTOR` con actor dominante en el documento, `PASSIVE_VOICE` con agente nombrado,
 *     `MISSING_TRIGGER` cuya condición ya está en la frase, y el marcador `{{…}}` que nombra —o que
 *     la traza delta→tareas identifica sin ambigüedad— un id real, se resuelven sin molestar a nadie.
 *     Se pregunta solo lo que una persona debe decidir: el valor medible, la granularidad, el
 *     disparador que no está escrito.
 *
 *  2. ACOTADO Y HONESTO CON EL LÍMITE. Tope por defecto 5 (configurable con `max`). Cuando el lote
 *     se recorta, la sesión lo dice (`truncated`), publica `remaining` y lo repite en `detail`: nunca
 *     se calla que hay más preguntas que las mostradas.
 *
 *  3. TODA RESPUESTA SE ESCRIBE Y SE VERIFICA. `applyAnswers` reescribe SOLO la línea afectada
 *     (todo lo demás se copia byte a byte) y después RE-EJECUTA el análisis sobre el resultado para
 *     probar que el código se fue: informa `codeBefore`/`codeAfter`, qué ids quedaron `resolved` y
 *     cuáles siguen `stillOpen`. Una respuesta que no quita la ambigüedad se reporta como abierta,
 *     jamás como arreglada.
 *
 *  4. UNA RESPUESTA QUE NO ES UN DATO SE RECHAZA. Vacía, con `{{…}}` o `<…>` sin rellenar, que
 *     devuelve otra pregunta, o que es idéntica a lo que ya había («no cambia nada» ⇒ el código
 *     seguiría igual) van a `refused` con el motivo. Nunca se escribe una plantilla. Ojo: una
 *     respuesta DISTINTA que no consigue borrar el código sí se escribe, y entonces se reporta
 *     `stillOpen` (regla 3) — rechazar y no-resolver son dos cosas distintas y se informan distinto.
 *
 *  5. NO INTERACTIVO PRIMERO. `planClarify` funciona siempre sin terminal: su salida se entrega a
 *     una persona O a un agente anfitrión mediante el ciclo `--questions-file` / `--answers`. La CLI
 *     PUEDE preguntar en un TTY, pero cuando no hay TTY imprime las preguntas y no se bloquea.
 *
 * ── Qué NO hace ────────────────────────────────────────────────────────────────────────────────
 * No embarca ningún modelo (misma decisión que `earsAssistant`/`constitutionDraft`): no inventa
 * respuestas ni redacta el requisito por su cuenta. No escribe nada por heurística: sin `--answers`
 * (o sin respuestas interactivas) la especificación queda intacta. Y no declara «limpia» una spec que
 * no pudo analizar: cero preguntas sin artefactos se informa como «no se comprobó nada».
 *
 * ── Campos añadidos al mínimo acordado (aditivos, nunca sustitutos) ─────────────────────────────
 *  - `file`/`target`: para que la CLI agrupe las respuestas por fichero y localice la línea exacta;
 *    `artifact` es la etiqueta legible («fichero — línea»), no una ruta que haya que volver a parsear.
 *  - `answerKind`: `statement` (la respuesta es la frase EARS completa), `value` (es el dato que
 *    sustituye al término vago) o `id` (rellena el `{{…}}`). Sin esto, «responder» sería adivinar la
 *    forma y una reescritura correcta podría aplicarse mal.
 *  - `slot`: el término exacto que sustituye una respuesta `value`.
 *  - `fromEvidence`/`remaining`/`artifacts`/`evidenceScan`: lo que se respondió sin preguntar, cuántas
 *    quedaron fuera del tope y qué se inspeccionó. `stillOpen` y `codeAfter` no bastan para contar la
 *    parte honesta de la sesión.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { EARS_NEEDS_INFORMATION, analyseEars, deltaStatementText, isEarsProposalApplicable, } from './earsAssistant.js';
import { DELTA_ID_PATTERN, deltaSpecFileName, parseDeltaSpec, traceDelta } from './deltaSpec.js';
import { parseTasksMarkdown, resolveSddDir } from './specManager.js';
import { scanProject } from './reverseEngineering.js';
export const DEFAULT_CLARIFY_MAX = 5;
/**
 * El catálogo explícito. Un código que no esté aquí NO se convierte en pregunta: viaja a
 * `unresolvable` con su motivo. Inventar una pregunta para un código desconocido sería adivinar qué
 * dato falta, y ese es exactamente el fallo que este proyecto lleva tres revisiones quitando.
 *
 * Rango: el marcador `{{…}}` rompe la trazabilidad delta→tareas (`delta validate`) y va primero;
 * después los errores EARS (compuesto, objetivo, actor humano, sin actor, sin shall) y, por último,
 * los avisos que se corrigen dentro del propio requisito.
 */
const CLARIFY_CATALOGUE = [
    { code: 'UNFILLED_REQUIREMENT_PLACEHOLDER', short: 'PLACEHOLDER', severity: 'error', rank: 0, answerKind: 'id' },
    { code: 'COMPOUND_REQUIREMENT', short: 'COMPOUND', severity: 'error', rank: 1, answerKind: 'statement' },
    { code: 'NOT_TESTABLE', short: 'TESTABLE', severity: 'error', rank: 2, answerKind: 'statement' },
    { code: 'ACTOR_NOT_SYSTEM', short: 'ACTOR', severity: 'error', rank: 3, answerKind: 'statement' },
    { code: 'NO_ACTOR', short: 'NOACTOR', severity: 'error', rank: 4, answerKind: 'statement' },
    { code: 'NO_SHALL', short: 'SHALL', severity: 'error', rank: 5, answerKind: 'statement' },
    { code: 'VAGUE_TERM', short: 'VAGUE', severity: 'warning', rank: 6, answerKind: 'value' },
    { code: 'MISSING_TRIGGER', short: 'TRIGGER', severity: 'warning', rank: 7, answerKind: 'statement' },
    { code: 'PASSIVE_VOICE', short: 'PASSIVE', severity: 'warning', rank: 8, answerKind: 'statement' },
];
/** El catálogo, exportado para que un test o un host sepa qué códigos sabe interrogar este motor. */
export const CLARIFY_QUESTION_CODES = CLARIFY_CATALOGUE.map((rule) => rule.code);
const ruleOf = (code) => CLARIFY_CATALOGUE.find((rule) => rule.code.toUpperCase() === code.toUpperCase());
const SEVERITY_RANK = { error: 0, warning: 1, info: 2 };
// ---------------------------------------------------------------------------------------------
// Utilidades de texto (forma, nunca contenido)
// ---------------------------------------------------------------------------------------------
const PLACEHOLDER_TOKEN = /\{\{[^{}]*\}\}/;
const SLOT_MARKER = '<valor medible>';
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** La viñeta y el `Statement:` de una línea, para reescribir el enunciado sin tocar la decoración. */
const prefixOf = (line) => line.match(/^(\s*[-*+]\s+(?:Statement\s*:\s*)?)/i)?.[1] ?? line.match(/^(\s*)/)?.[1] ?? '';
const stripPrefix = (line) => line.slice(prefixOf(line).length);
/** El término vago citado en un problema EARS: `«rápido» no es comprobable…`. */
const termOf = (problem) => problem.match(/«([^»]+)»/)?.[1]?.trim() ?? '';
/** El agente nombrado en el `why` de una pasiva aplicable: `…declara ("the [engine]")`. */
const agentOf = (why) => why.match(/declara \("([^"]+)"\)/)?.[1]?.trim() ?? '';
/**
 * El dato medible que `earsAssistant` ya formuló para un término vago. Se extrae de su propia
 * propuesta/porqué en vez de re-implementar el léxico: si el formato cambiara, queda el genérico.
 */
const measurableHint = (suggestion) => {
    const fromProposal = suggestion.proposal.match(/no puedo inventar (.+?)\.\s*¿Cuál es el valor real\?/)?.[1];
    const fromWhy = suggestion.why.match(/Al sustituir «[^»]+» por (.+?), la frase conserva/)?.[1];
    return (fromProposal ?? fromWhy ?? 'el valor o criterio observable que la sustituya').trim();
};
const readIfExists = (file) => readFile(file, 'utf8').catch(() => null);
const relativePath = (root, file) => path.relative(root, file).split(path.sep).join('/');
const artifactLabel = (file, target) => `${file} — «${target}»`;
const buildEvidenceScan = (project) => {
    if (!project)
        return [];
    const facts = [];
    const stack = [
        project.language && project.language !== 'unknown' ? `lenguaje ${project.language}` : null,
        project.frameworks.length > 0 ? `frameworks ${project.frameworks.join(', ')}` : null,
        project.testFramework ? `tests ${project.testFramework}` : null,
        project.packageManager ? `gestor ${project.packageManager}` : null,
        project.buildTool ? `build ${project.buildTool}` : null,
    ].filter((value) => value !== null);
    if (stack.length > 0)
        facts.push(`stack: ${stack.join(', ')}`);
    if (project.modules.length > 0) {
        const shown = project.modules.slice(0, 5).join(', ');
        facts.push(`módulos (${project.modules.length}): ${shown}${project.modules.length > 5 ? ', …' : ''}`);
    }
    if (project.testDirs.length > 0)
        facts.push(`directorios de test: ${project.testDirs.slice(0, 5).join(', ')}`);
    return facts;
};
/**
 * Convierte un hallazgo EARS en pregunta, en evidencia o en irresoluble. Es la tabla de derivación:
 * un solo sitio decide, para cada código, si el dato lo tiene una persona o lo tiene el repositorio.
 */
const deriveFromSuggestion = (suggestion, context, out) => {
    const rule = ruleOf(suggestion.code);
    const target = suggestion.target;
    const artifact = artifactLabel(context.rel, target);
    const occurrences = context.text.split('\n').filter((line) => line.trim() === target).length;
    const unresolvable = (code, reason) => {
        const key = `${context.rel}|${code}|${target}`;
        if (out.unresolvable.some((entry) => entry.key === key))
            return;
        out.unresolvable.push({ key, order: context.order(), code, artifact, reason });
    };
    // La respuesta se escribirá en UNA línea: si la línea objetivo no es única, no hay sitio único
    // donde escribirla y preguntar produciría una reescritura a ciegas. Se declara, no se adivina.
    if (occurrences > 1) {
        unresolvable(suggestion.code, `la línea objetivo aparece ${occurrences} veces idénticas en ${context.rel}: la respuesta no se podría escribir en un lugar único, así que no se pregunta.`);
        return;
    }
    if (!rule) {
        unresolvable(suggestion.code, `no hay pregunta de clarificación definida para el código ${suggestion.code}: inventarla sería adivinar qué dato falta (fail-closed).`);
        return;
    }
    const base = {
        file: context.file,
        rel: context.rel,
        target,
        code: suggestion.code,
        severity: suggestion.severity,
        rank: rule.rank,
        answerKind: rule.answerKind,
    };
    const evidence = (detail, answer) => {
        out.evidence.push({
            short: rule.short,
            order: context.order(),
            rank: rule.rank,
            code: suggestion.code,
            artifact,
            file: context.file,
            target,
            evidence: detail,
            answer,
        });
    };
    const ask = (question, why, extra = {}) => {
        out.candidates.push({ ...base, order: context.order(), question, why, ...extra });
    };
    const applicable = isEarsProposalApplicable(suggestion);
    switch (rule.code) {
        case 'COMPOUND_REQUIREMENT': {
            // Siempre se pregunta: cuántos comportamientos hay y con qué actor/disparador cada uno es una
            // decisión de granularidad, no un cálculo. La partición mecánica se ofrece como plantilla.
            const shallCount = (stripPrefix(target).match(/\bshall\b/gi) ?? []).length;
            ask(`Esta frase encadena ${shallCount} respuestas "shall" y cada una es un comportamiento. ¿Cómo se escribe cada comportamiento como su propia frase EARS, con su actor y su disparador?`, `El requisito se partirá en ${shallCount} frases EARS verificables por separado: hoy no se puede probar un comportamiento sin probar el otro. La partición conserva cada respuesta palabra por palabra; lo que falta es la decisión de si son de verdad comportamientos distintos.`, {
                options: [
                    `Separar en ${shallCount} frases EARS, una por respuesta`,
                    'Es un único comportamiento: reescribir con un solo "shall"',
                ],
                ...(applicable ? { template: suggestion.proposal } : {}),
            });
            return;
        }
        case 'VAGUE_TERM': {
            const term = termOf(suggestion.problem) || termOf(suggestion.why);
            const hint = measurableHint(suggestion);
            const statement = stripPrefix(target);
            const template = term.length > 0 ? statement.replace(new RegExp(escapeRegExp(term), 'iu'), SLOT_MARKER) : undefined;
            ask(`¿Cuál es ${hint}? Sustituirá a «${term}» en la frase y la hará comprobable.`, suggestion.why, { ...(template ? { template } : {}), ...(term.length > 0 ? { slot: term } : {}) });
            return;
        }
        case 'MISSING_TRIGGER': {
            if (applicable) {
                // La condición ya está escrita en la frase; moverla al disparador es una operación de forma,
                // así que el repositorio ya tiene la respuesta y no se pregunta.
                evidence(`la condición necesaria de ${context.rel} ya está escrita en la propia frase («${target}»); moverla al disparador no añade ningún dato y la reescritura conserva el sentido.`, suggestion.proposal);
                return;
            }
            ask('La condición necesaria ("only …") está dentro de la respuesta y no se puede negar sin cambiar el sentido. ¿Es una condición necesaria (solo se cumple si X) o un disparador (cuando X, entonces …)?', suggestion.why, {
                options: [
                    'Es una condición necesaria: IF NOT <condición>, THEN <respuesta>',
                    'Es un disparador: WHEN <condición>, <respuesta>',
                ],
                template: 'WHEN <condición>, the <actor> shall <respuesta>. | IF NOT <condición>, THEN the <actor> shall not <respuesta>.',
            });
            return;
        }
        case 'PASSIVE_VOICE': {
            if (applicable) {
                const agent = agentOf(suggestion.why);
                evidence(`en ${context.rel} la frase nombra al agente${agent ? ` («${agent}»)` : ''}: pasarla a voz activa usa ese mismo agente y no añade ningún dato.`, suggestion.proposal);
                return;
            }
            ask('La respuesta está en pasiva y no dice quién ejecuta la acción. ¿Qué componente del sistema responde, y con qué acción?', suggestion.why, { template: 'WHEN <disparador>, the <agente> shall <verbo> <objeto>.' });
            return;
        }
        case 'NO_ACTOR': {
            if (applicable) {
                evidence(`el actor dominante de ${context.rel} ya resuelve la frase: ${suggestion.why}`, suggestion.proposal);
                return;
            }
            ask('No hay sujeto antes de "shall" y el documento no repite ningún actor del que tomarlo. ¿Qué componente del sistema debe actuar?', suggestion.why, { template: 'WHEN <disparador>, the <sistema> shall <respuesta>.' });
            return;
        }
        case 'ACTOR_NOT_SYSTEM': {
            const subject = suggestion.problem.match(/persona \("([^"]+)"\)/)?.[1]?.trim() ?? 'una persona';
            ask(`El sujeto de la frase es una persona («${subject}»), no el sistema. ¿Qué respuesta observable del sistema produce esa acción, y cuándo?`, suggestion.why, { template: 'WHEN <disparador>, the <sistema> shall <respuesta observable>.' });
            return;
        }
        case 'NOT_TESTABLE': {
            ask('Esta frase es un objetivo, no un comportamiento. ¿Qué respuesta observable del sistema demuestra que se cumple, y cuándo?', suggestion.why, { template: 'WHEN <disparador>, the <sistema> shall <respuesta observable>.' });
            return;
        }
        case 'NO_SHALL': {
            const should = /\bshould\b/i.test(stripPrefix(target));
            ask(`La frase no lleva el operador "shall"${should ? ' (lleva "should", que es una recomendación)' : ''}. ¿Cuál es la acción observable y obligatoria del sistema?`, suggestion.why, { template: 'WHEN <disparador>, the <sistema> shall <acción observable>.' });
            return;
        }
        default: {
            unresolvable(suggestion.code, `el código ${suggestion.code} no tiene una derivación de pregunta implementada en este motor.`);
        }
    }
};
/**
 * Planifica la interrogación de una feature. Nunca bloquea, nunca escribe: lee los artefactos de la
 * spec y devuelve las preguntas que una persona (o un agente anfitrión) debe responder, separadas de
 * lo que el repositorio ya respondió y de lo que no se puede resolver preguntando.
 */
export const planClarify = async (input) => {
    const root = path.resolve(input.cwd);
    const sddDir = input.sddDir ?? (await resolveSddDir(root));
    const feature = input.feature.trim();
    const requestedMax = input.max;
    const max = Number.isFinite(requestedMax) && requestedMax >= 0
        ? Math.floor(requestedMax)
        : DEFAULT_CLARIFY_MAX;
    const specDir = path.join(root, sddDir, 'specs', feature);
    const requirementsPath = path.join(specDir, 'requirements.md');
    const deltaPath = path.join(specDir, deltaSpecFileName());
    const tasksPath = path.join(specDir, 'tasks.md');
    const [requirementsRaw, deltaRaw, tasksRaw, project] = await Promise.all([
        readIfExists(requirementsPath),
        readIfExists(deltaPath),
        readIfExists(tasksPath),
        scanProject(root).catch(() => null),
    ]);
    const artifacts = [];
    if (requirementsRaw !== null)
        artifacts.push(relativePath(root, requirementsPath));
    if (deltaRaw !== null)
        artifacts.push(relativePath(root, deltaPath));
    if (tasksRaw !== null)
        artifacts.push(relativePath(root, tasksPath));
    const candidates = [];
    const evidenceCandidates = [];
    const unresolvableCandidates = [];
    const evidenceScan = buildEvidenceScan(project);
    let order = 0;
    const nextOrder = () => {
        order += 1;
        return order;
    };
    const out = { candidates, evidence: evidenceCandidates, unresolvable: unresolvableCandidates };
    let analysedRequirements = 0;
    const requirementsReport = requirementsRaw !== null ? analyseEars(requirementsRaw, { source: relativePath(root, requirementsPath) }) : null;
    if (requirementsReport) {
        analysedRequirements += requirementsReport.total;
        for (const suggestion of requirementsReport.suggestions) {
            deriveFromSuggestion(suggestion, {
                file: requirementsPath,
                rel: relativePath(root, requirementsPath),
                text: requirementsRaw ?? '',
                order: nextOrder,
            }, out);
        }
    }
    if (deltaRaw !== null) {
        // Solo se analizan los enunciados `- Statement:` que no repiten requirements.md: contarlos dos
        // veces inflaría el informe y haría parecer que hay el doble de requisitos.
        const deltaText = deltaStatementText(deltaRaw, requirementsReport?.statements ?? []);
        if (deltaText.statements > 0) {
            const deltaReport = analyseEars(deltaText.text, { source: relativePath(root, deltaPath) });
            analysedRequirements += deltaReport.total;
            for (const suggestion of deltaReport.suggestions) {
                deriveFromSuggestion(suggestion, {
                    file: deltaPath,
                    rel: relativePath(root, deltaPath),
                    text: deltaRaw,
                    order: nextOrder,
                }, out);
            }
        }
    }
    // ── Marcadores `{{…}}` de tasks.md: el dato que falta es un id de la delta, y la traza
    // delta→tareas puede tenerlo ya (el marcador lo nombra, o solo queda una entrada sin tarea).
    if (tasksRaw !== null) {
        const delta = deltaRaw !== null ? parseDeltaSpec(deltaRaw) : parseDeltaSpec('');
        const parsedTasks = parseTasksMarkdown(tasksRaw);
        const trace = traceDelta(delta, parsedTasks);
        const deltaRel = relativePath(root, deltaPath);
        const tasksRel = relativePath(root, tasksPath);
        for (const placeholder of trace.unfilledPlaceholders) {
            const inner = placeholder.cited.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
            const target = parsedTasks.find((task) => task.id === placeholder.taskId)?.raw ?? '';
            const line = target.length > 0 ? target : tasksRaw.split('\n').find((candidate) => candidate.includes(placeholder.cited))?.trim() ?? '';
            const artifact = `${tasksRel} — tarea ${placeholder.taskId || '(sin id)'} «${placeholder.cited}»`;
            if (line.length === 0) {
                unresolvableCandidates.push({
                    key: `UNFILLED_REQUIREMENT_PLACEHOLDER|${placeholder.cited}`,
                    order: nextOrder(),
                    code: 'UNFILLED_REQUIREMENT_PLACEHOLDER',
                    artifact,
                    reason: `no se encontró la línea de la tarea ${placeholder.taskId || '(sin id)'} que contiene ${placeholder.cited}: no hay dónde escribir la respuesta.`,
                });
                continue;
            }
            const occurrences = tasksRaw.split('\n').filter((candidate) => candidate.trim() === line).length;
            if (occurrences > 1) {
                unresolvableCandidates.push({
                    key: `UNFILLED_REQUIREMENT_PLACEHOLDER|${placeholder.cited}`,
                    order: nextOrder(),
                    code: 'UNFILLED_REQUIREMENT_PLACEHOLDER',
                    artifact,
                    reason: `la línea de la tarea aparece ${occurrences} veces idénticas en ${tasksRel}: la respuesta no se podría escribir en un lugar único, así que no se pregunta.`,
                });
                continue;
            }
            if (DELTA_ID_PATTERN.test(inner) && delta.entries.some((entry) => entry.id === inner)) {
                evidenceCandidates.push({
                    short: 'PLACEHOLDER',
                    order: nextOrder(),
                    rank: 0,
                    code: 'UNFILLED_REQUIREMENT_PLACEHOLDER',
                    artifact,
                    file: tasksPath,
                    target: line,
                    answer: inner,
                    evidence: `el propio marcador ${placeholder.cited} nombra ${inner} y esa entrada existe en ${deltaRel}: la sustitución no es una decisión humana.`,
                });
                continue;
            }
            if (trace.unmapped.length === 1) {
                evidenceCandidates.push({
                    short: 'PLACEHOLDER',
                    order: nextOrder(),
                    rank: 0,
                    code: 'UNFILLED_REQUIREMENT_PLACEHOLDER',
                    artifact,
                    file: tasksPath,
                    target: line,
                    answer: trace.unmapped[0],
                    evidence: `${trace.unmapped[0]} es la única entrada de la delta sin tarea que la cite (traza delta→tareas): el repositorio ya dice qué requisito implementa esta tarea.`,
                });
                continue;
            }
            const options = trace.unmapped.length > 1 ? [...trace.unmapped] : undefined;
            candidates.push({
                file: tasksPath,
                rel: tasksRel,
                target: line,
                code: 'UNFILLED_REQUIREMENT_PLACEHOLDER',
                severity: 'error',
                rank: 0,
                answerKind: 'id',
                order: nextOrder(),
                question: `La tarea ${placeholder.taskId || '(sin id)'} sigue citando el marcador de plantilla ${placeholder.cited}. ¿Qué id REQ-<ÁREA>-<NNN> de la delta implementa esta tarea?`,
                why: 'La tarea pasará a citar el requisito real y la trazabilidad delta→tareas dejará de romperse: un marcador sin rellenar no es un identificador y ninguna obligación puede apoyarse en él.',
                ...(options ? { options } : {}),
                template: 'REQ-<ÁREA>-<NNN>',
            });
        }
    }
    // ── Orden: severidad y, a igual severidad, lo que desbloquea la fase siguiente, y luego el orden
    // del documento (que es el orden en que se leen los artefactos).
    candidates.sort((a, b) => {
        const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
        if (bySeverity !== 0)
            return bySeverity;
        const byRank = a.rank - b.rank;
        if (byRank !== 0)
            return byRank;
        return a.order - b.order;
    });
    const kept = candidates.slice(0, max);
    const remaining = Math.max(0, candidates.length - kept.length);
    // Ids estables asignados en el orden en que se muestran: Q-COMPOUND-1, Q-COMPOUND-2…
    const counters = new Map();
    const questions = kept.map((candidate) => {
        const rule = ruleOf(candidate.code);
        const short = rule?.short ?? candidate.code.toUpperCase();
        const ordinal = (counters.get(short) ?? 0) + 1;
        counters.set(short, ordinal);
        return {
            id: `Q-${short}-${ordinal}`,
            code: candidate.code,
            artifact: artifactLabel(candidate.rel, candidate.target),
            question: candidate.question,
            why: candidate.why,
            severity: candidate.severity,
            file: candidate.file,
            target: candidate.target,
            answerKind: candidate.answerKind,
            ...(candidate.options ? { options: candidate.options } : {}),
            ...(candidate.template ? { template: candidate.template } : {}),
            ...(candidate.slot ? { slot: candidate.slot } : {}),
        };
    });
    evidenceCandidates.sort((a, b) => a.rank - b.rank || a.order - b.order);
    const evidenceCounters = new Map();
    const fromEvidence = evidenceCandidates.map((entry) => {
        const ordinal = (evidenceCounters.get(entry.short) ?? 0) + 1;
        evidenceCounters.set(entry.short, ordinal);
        return {
            id: `E-${entry.short}-${ordinal}`,
            code: entry.code,
            artifact: entry.artifact,
            evidence: entry.evidence,
            answer: entry.answer,
            file: entry.file,
            target: entry.target,
        };
    });
    unresolvableCandidates.sort((a, b) => a.order - b.order);
    const unresolvable = unresolvableCandidates.map(({ code, artifact, reason }) => ({
        code,
        artifact,
        reason,
    }));
    const detailParts = [];
    if (artifacts.length === 0) {
        detailParts.push(`No hay requirements.md, delta.md ni tasks.md para "${feature}": no hay nada que clarificar y NO se declara limpia (no se analizó nada).`);
    }
    else if (questions.length === 0 && fromEvidence.length === 0 && unresolvable.length === 0) {
        detailParts.push(`La especificación de "${feature}" está limpia: 0 preguntas de clarificación sobre ${artifacts.join(', ')} (${analysedRequirements} requisito(s) analizado(s), ninguno ambiguo). Nada que preguntar.`);
    }
    else {
        detailParts.push(`${questions.length} pregunta(s) de clarificación sobre ${artifacts.join(', ')} (${analysedRequirements} requisito(s) analizado(s)).`);
    }
    if (fromEvidence.length > 0) {
        detailParts.push(`${fromEvidence.length} hallazgo(s) NO se preguntan: el repositorio ya los responde (ver fromEvidence, ids ${fromEvidence.map((entry) => entry.id).join(', ')}).`);
    }
    if (unresolvable.length > 0) {
        detailParts.push(`${unresolvable.length} hallazgo(s) no se pueden resolver preguntando (ver unresolvable).`);
    }
    if (remaining > 0) {
        detailParts.push(`Lote RECORTADO al tope de ${max}: quedan ${remaining} pregunta(s) sin mostrar (sube --max para verlas).`);
    }
    if (evidenceScan.length > 0) {
        detailParts.push(`Evidencia del repositorio consultada para no preguntar lo que ya se sabe: ${evidenceScan.join('; ')}.`);
    }
    // OJO: `detail` NO afirma nada sobre escribir. `planClarify` nunca escribe, pero este resumen lo
    // reutiliza la CLI al aplicar respuestas; un «no se ha escrito nada» aquí se leería junto a
    // «1 fichero reescrito» y sería exactamente la clase de mentira que este proyecto persigue.
    detailParts.push('planClarify solo pregunta; quien escribe es la CLI, y solo con --write.');
    return {
        feature,
        questions,
        unresolvable,
        truncated: remaining > 0,
        detail: detailParts.join(' '),
        remaining,
        fromEvidence,
        artifacts,
        evidenceScan,
    };
};
const looksLikePlaceholderAnswer = (answer) => PLACEHOLDER_TOKEN.test(answer) ||
    /^<[^<>\n]+>$/.test(answer) ||
    /<\s*(disparador|actor|sistema|respuesta|valor|condici[oó]n|agente|acci[oó]n|[aá]rea|id|verbo|objeto|sujeto)\b[^<>\n]*>/i.test(answer);
/**
 * Aplica las respuestas a UN texto y demuestra el efecto. Devuelve el texto resultante (byte a byte
 * igual salvo las líneas reescritas), lo aplicado, lo rechazado y la verificación: cuántos códigos
 * había antes y después, qué preguntas quedaron resueltas y cuáles siguen abiertas.
 *
 * Solo se consideran las preguntas de `session.questions`: la CLI agrupa por fichero y llama a esta
 * función con el subconjunto que corresponde a cada texto.
 */
export const applyAnswers = (input) => {
    const original = input.text;
    const lines = original.split('\n');
    const applied = [];
    const refused = [];
    const attempted = [];
    const rewritten = new Map();
    for (const question of input.session.questions) {
        const raw = input.answers[question.id];
        if (raw === undefined)
            continue;
        const answer = String(raw).trim();
        const artifact = question.artifact;
        if (rewritten.has(question.target)) {
            refused.push({
                id: question.id,
                why: `la línea objetivo ya se reescribió al aplicar ${rewritten.get(question.target)}: aplica una pregunta por línea para no encadenar reescrituras a ciegas.`,
            });
            continue;
        }
        const index = lines.findIndex((line) => line.trim() === question.target);
        if (index < 0) {
            refused.push({
                id: question.id,
                why: `no se encontró la línea objetivo de ${artifact} en el texto dado: la respuesta no se aplica a este artefacto.`,
            });
            continue;
        }
        if (answer.length === 0) {
            refused.push({ id: question.id, why: 'respuesta vacía: no se escribe nada y no se deja ningún hueco a medias.' });
            continue;
        }
        if (looksLikePlaceholderAnswer(answer)) {
            refused.push({
                id: question.id,
                why: 'la respuesta todavía es un hueco de plantilla ({{…}} o <…>): falta el dato, y una plantilla disfrazada de frase es como un agente acaba inventando el requisito.',
            });
            continue;
        }
        if (answer.includes(EARS_NEEDS_INFORMATION) || /\bfalta informaci[oó]n\b/i.test(answer)) {
            refused.push({ id: question.id, why: 'la respuesta repite que falta información: no aporta el dato pedido.' });
            continue;
        }
        if (answer.endsWith('?')) {
            refused.push({ id: question.id, why: 'la respuesta es otra pregunta, no el dato pedido.' });
            continue;
        }
        const before = lines[index];
        let replacement;
        if (question.answerKind === 'id') {
            const token = before.match(PLACEHOLDER_TOKEN)?.[0];
            if (!token) {
                refused.push({ id: question.id, why: `la línea de ${artifact} no contiene ningún marcador {{…}} que rellenar.` });
                continue;
            }
            if (!DELTA_ID_PATTERN.test(answer)) {
                refused.push({
                    id: question.id,
                    why: `se esperaba un id de la delta con forma REQ-<ÁREA>-<NNN>; «${answer}» no lo es.`,
                });
                continue;
            }
            replacement = [before.replace(token, answer)];
        }
        else if (question.answerKind === 'value') {
            const slot = (question.slot ?? '').trim();
            if (slot.length === 0) {
                refused.push({ id: question.id, why: 'la pregunta no declara qué término sustituye la respuesta: no se puede aplicar sin adivinar dónde va.' });
                continue;
            }
            const slotRe = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(slot)}([^\\p{L}\\p{N}]|$)`, 'iu');
            if (!slotRe.test(before)) {
                refused.push({ id: question.id, why: `no se encontró «${slot}» en la línea objetivo: la respuesta no se puede colocar.` });
                continue;
            }
            if (answer.toLowerCase() === slot.toLowerCase()) {
                refused.push({ id: question.id, why: `la respuesta es el mismo término («${slot}»): no cambia el requisito y el código seguiría igual.` });
                continue;
            }
            replacement = [before.replace(slotRe, (_match, left, right) => `${left}${answer}${right}`)];
        }
        else {
            if (stripPrefix(before).trim() === answer) {
                refused.push({
                    id: question.id,
                    why: 'la respuesta no cambia el enunciado (es idéntico al actual): el código seguiría igual, así que no se escribe.',
                });
                continue;
            }
            const prefix = prefixOf(before);
            replacement = answer
                .split('\n')
                .map((line) => `${prefix}${line.trim()}`)
                .filter((line) => line.trim().length > 0);
            if (replacement.length === 0) {
                refused.push({ id: question.id, why: 'la respuesta no produce ninguna línea: no se vacía un requisito.' });
                continue;
            }
        }
        lines.splice(index, 1, ...replacement);
        rewritten.set(question.target, question.id);
        applied.push({ id: question.id, before, after: replacement.join('\n') });
        attempted.push({ question, before, after: replacement });
    }
    const resultText = lines.join('\n');
    // ── Verificación: se RE-EJECUTA el análisis sobre el resultado. Para los códigos EARS, «sigue»
    // significa que el mismo código aparece en la línea reescrita; para un marcador, que el `{{…}}`
    // continúa. Nada se declara resuelto por haber escrito la respuesta.
    const beforeReport = attempted.length > 0 ? analyseEars(original) : null;
    const afterReport = attempted.length > 0 ? analyseEars(resultText) : null;
    let codeBefore = 0;
    let codeAfter = 0;
    const resolved = [];
    const stillOpen = [];
    for (const entry of attempted) {
        const isPlaceholder = entry.question.answerKind === 'id';
        const afterTargets = entry.after.map((line) => line.trim());
        const beforeHit = isPlaceholder
            ? PLACEHOLDER_TOKEN.test(entry.before)
                ? 1
                : 0
            : (beforeReport?.suggestions ?? []).some((suggestion) => suggestion.code === entry.question.code && suggestion.target === entry.before.trim())
                ? 1
                : 0;
        const afterHit = isPlaceholder
            ? entry.after.some((line) => PLACEHOLDER_TOKEN.test(line))
                ? 1
                : 0
            : (afterReport?.suggestions ?? []).some((suggestion) => suggestion.code === entry.question.code && afterTargets.includes(suggestion.target))
                ? 1
                : 0;
        codeBefore += beforeHit;
        codeAfter += afterHit;
        if (afterHit > 0)
            stillOpen.push(entry.question.id);
        else
            resolved.push(entry.question.id);
    }
    return { text: resultText, applied, refused, verification: { codeBefore, codeAfter, resolved, stillOpen } };
};
// ---------------------------------------------------------------------------------------------
// Ciclo no interactivo: fichero de preguntas y fichero de respuestas
// ---------------------------------------------------------------------------------------------
/** La forma estable del `--questions-file`: lo que un humano o un agente anfitrión rellena. */
export const clarifyQuestionsFile = (session) => ({
    kind: 'clarify-questions',
    feature: session.feature,
    detail: session.detail,
    artifacts: session.artifacts,
    evidenceScan: session.evidenceScan,
    howToAnswer: 'Rellena `answers` con el id de cada pregunta. `answerKind: statement` espera la frase EARS completa; ' +
        '`value` espera el dato que sustituye al término (`slot`); `id` espera un REQ-<ÁREA>-<NNN>. ' +
        'Después: open-sdd brownfield clarify <feature> --answers <este fichero> --write',
    questions: session.questions.map((question) => ({ ...question })),
    fromEvidence: session.fromEvidence.map((entry) => ({ ...entry })),
    unresolvable: session.unresolvable.map((entry) => ({ ...entry })),
    answers: {},
});
/**
 * Lee un fichero de respuestas. Acepta la forma envuelta (`{ "answers": { … } }`, la que produce
 * `clarifyQuestionsFile`) o un mapa plano de id→texto. Se filtran las claves que no son ids de
 * pregunta/evidencia para que leer un fichero de preguntas sin rellenar no invente respuestas.
 */
export const readClarifyAnswers = (raw) => {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        return { answers: {}, error: `JSON ilegible: ${error.message}` };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { answers: {}, error: 'se esperaba un objeto JSON con las respuestas' };
    }
    const record = parsed;
    const wrapped = record.answers;
    const source = wrapped !== null && typeof wrapped === 'object' && !Array.isArray(wrapped)
        ? wrapped
        : record;
    const answers = {};
    for (const [key, value] of Object.entries(source)) {
        if (!/^[QE]-[A-Z0-9]+-\d+$/.test(key))
            continue;
        if (typeof value !== 'string')
            continue;
        answers[key] = value;
    }
    if (Object.keys(answers).length === 0) {
        return {
            answers: {},
            error: 'no se encontró ninguna respuesta: se esperaba `{ "answers": { "Q-…": "…" } }` o un mapa de ids de pregunta a texto.',
        };
    }
    return { answers };
};
