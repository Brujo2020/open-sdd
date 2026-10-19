/**
 * LAS DOS PUERTAS DE ENTRADA EN LENGUAJE NATURAL: la entrevista de constitución y la especificación
 * EARS. Ninguna de las dos es un prompt: las dos terminan en algo COMPROBADO.
 *
 * ── Lo que este módulo NO hace ──────────────────────────────────────────────────────────────────
 * No embarca ningún modelo (misma decisión que `constitutionDraft.ts:evidencePackForHost` y
 * `earsAssistant.ts:earsEvidencePack`) y no reimplementa nada de lo que ya existe:
 *
 *   · El reconocimiento es `scanProject` + `collectRepoFacts` + `buildDescriptiveConstitution`.
 *   · El borrador con evidencia y su puerta humana son `buildConstitutionDraft` + `ratifyDraft`.
 *   · La validación es `validateConstitution`; la autoridad, `principlesInForce`.
 *   · Las plantillas y el análisis EARS son `describeFromPlainLanguage` + `analyseEars`
 *     (el MISMO analizador; aquí no hay un segundo).
 *
 * Lo único que aporta es la DECISIÓN que faltaba: qué se pregunta, qué NO se pregunta porque la
 * evidencia ya lo respondió, y qué se rechaza en vez de inventarse.
 *
 * ── 1. La entrevista de constitución ────────────────────────────────────────────────────────────
 * `planConstitutionInterview` parte de la constitución descriptiva (lo que el código YA demuestra) y
 * separa dos listas:
 *
 *   `decidedByEvidence`  lo que el reconocimiento resolvió — el stack, las prácticas observadas con
 *                        su evidencia, las fronteras, la superficie de API, los hechos establecidos.
 *                        Esto NO se pregunta: preguntar «¿cuál es tu stack?» teniendo el manifiesto
 *                        delante es el modo de fallo que esta herramienta existe para evitar.
 *   `questions`          lo que la evidencia NO puede responder porque es una ELECCIÓN: ratificar
 *                        los principios observados, adoptar una práctica que el código no muestra, y
 *                        las decisiones normativas (deprecación de API, suelo de regresión, cruce de
 *                        fronteras, datos sensibles). Cuando la elección tiene un valor por defecto
 *                        derivado del repositorio, la pregunta viaja con `fromEvidence` y con la
 *                        evidencia que lo sostiene.
 *
 * `applyConstitutionAnswers` reutiliza `buildConstitutionDraft` y produce SOLO un borrador: marca
 * `draft: true` en todo, escribe `Status: draft`, y NUNCA escribe el fichero en vigor (no escribe
 * fichero alguno: devuelve el texto; la CLI decide dónde va). Cada respuesta se convierte en un
 * principio y el documento ENTERO pasa por `validateConstitution` antes de ofrecerse; los hallazgos
 * se devuelven y se incrustan en el texto, nunca se esconden. Una respuesta que introduzca una frase
 * de excepción controlable desde fuera (una inyección) aparece como error bloqueante, no como ley.
 *
 * ── 2. De lenguaje natural a EARS ───────────────────────────────────────────────────────────────
 * `specifyFromDescription` divide la descripción en comportamientos, llama a
 * `describeFromPlainLanguage` (el analizador compartido) para cada uno y nombra el patrón que ese
 * analizador eligió. Después aplica la puerta de esta casa: si el candidato no queda en forma de
 * frase EARS —el analizador compartido tuvo que suponer el actor «the system», dejó un separador
 * vacío tras `shall`, el disparador no se pudo extraer, o el texto trae un término no medible— se
 * emite una PREGUNTA con lo que falta, jamás un requisito fabricado. Los requisitos que ya existían
 * se conservan palabra por palabra: decidir ADDED frente a MODIFIED es competencia de la delta.
 *
 * ── Nada se declara comprobado sin haberlo estado ───────────────────────────────────────────────
 * Toda parte que no se pudo analizar se nombra en `detail` (y en los campos de preguntas). Una
 * ejecución limpia lo dice explícitamente. Un borrador no es autoridad: `principlesInForce` lo
 * excluye por construcción hasta que una persona nombrada lo ratifique.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { parseConstitution, renderConstitution, validateConstitution, } from './constitution.js';
import { DRAFT_MARKER, RATIFY_INSTRUCTION, buildConstitutionDraft, constitutionArtifactPaths, } from './constitutionDraft.js';
import { buildDescriptiveConstitution, collectRepoFacts } from './reverseConstitution.js';
import { resolveBoundaries, scanProject } from './reverseEngineering.js';
import { resolveSddDir } from './specManager.js';
import { EARS_ASSISTANT_TEMPLATES, analyseEars, describeFromPlainLanguage, isEarsProposalApplicable, } from './earsAssistant.js';
const exists = async (target) => {
    try {
        await stat(target);
        return true;
    }
    catch {
        return false;
    }
};
const truncate = (values, max, label) => values.length <= max ? [...values] : [...values.slice(0, max), `… (+${values.length - max} ${label})`];
/** Cuántas preguntas presenta la entrevista por defecto. Es un tope de presentación, no una verdad. */
export const DEFAULT_INTERVIEW_MAX = 8;
/** Marca del fichero de respuestas de la entrevista y del fichero de preguntas de `specify`. */
export const INTERVIEW_ANSWERS_FILE_KIND = 'open-sdd-constitution-interview-answers';
export const SPECIFY_QUESTIONS_FILE_KIND = 'open-sdd-specify-questions';
/**
 * El catálogo normativo: elecciones que el código NO puede responder. Cada una se ofrece solo si la
 * evidencia que la hace relevante existe, y su valor por defecto se deriva de esa misma evidencia —
 * por eso la pregunta viaja con `fromEvidence`. Ninguna opción convierte una práctica ausente en un
 * hecho: la opción estricta añade un principio NORMATIVO en borrador, con enmienda propuesta.
 */
const NORMATIVE_QUESTIONS = [
    {
        id: 'Q-NORM-API-DEPRECATION',
        needs: 'public-api',
        question: '¿Toda retirada de la API pública exige deprecación previa antes de retirarla?',
        why: 'La API pública ya existe y la evidencia la declara, pero cuánto tiempo debe sobrevivir un consumidor que no está en este repositorio es una decisión del equipo, no un hecho del código.',
        options: ['deprecar antes de retirar', 'retirada directa con migración declarada en la delta'],
        confirms: 'C-API-COMPAT',
        evidence: (ctx) => `origen de la API pública: ${ctx.publicApiDetail} · ${truncate(ctx.publicApiFiles, 3, 'punto(s) de entrada').join(', ')}`,
        principle: {
            id: 'C-API-DEPRECATION',
            title: 'La retirada de API pública pasa por deprecación',
            level: 'SHOULD',
            threatReference: 'consumidor externo roto por una retirada sin aviso',
            restriction: 'Ninguna exportación, ruta o esquema público se retira en la misma entrega en que se marca como obsoleta.',
            pattern: 'Marcar como obsoleta, mantener la superficie anterior durante una release y solo entonces retirarla con su entrada REMOVED y su migración.',
            justification: 'Los consumidores de una API pública no están en este repositorio y no se pueden actualizar en el mismo cambio: una retirada sin aviso los rompe sin que el pipeline de este proyecto lo detecte.',
        },
    },
    {
        id: 'Q-NORM-REGRESSION-FLOOR',
        needs: 'test-oracle',
        question: '¿Un cambio MODIFIED exige añadir un test que cubra el nuevo comportamiento, o basta con que los tests actuales sigan verdes?',
        why: 'El oráculo de regresión existe y la evidencia lo demuestra, pero exigir cobertura NUEVA para cada modificación es una elección de rigor, no un hecho del código.',
        options: ['test nuevo obligatorio para MODIFIED', 'basta con los tests actuales en verde'],
        confirms: 'C-REGRESSION-ORACLE',
        evidence: (ctx) => `${ctx.testFramework ?? 'tests'} · ${truncate(ctx.testDirs, 3, 'directorio(s)').join(', ')}`,
        principle: {
            id: 'C-REGRESSION-ADDITIONS',
            title: 'Un cambio MODIFIED llega con cobertura nueva',
            level: 'SHOULD',
            threatReference: 'regresión no cubierta que ningún test existente detecta',
            restriction: 'Una entrada MODIFIED no se admite solo con los tests anteriores en verde: el comportamiento nuevo necesita un contrato nuevo.',
            pattern: 'Añadir el test que falla antes del cambio y pasa después, y declararlo en la entrada MODIFIED de la delta.',
            justification: 'Un cambio de comportamiento que solo reutiliza la cobertura anterior deja el caso nuevo sin oráculo: el pipeline seguirá verde aunque el comportamiento añadido sea incorrecto.',
        },
    },
    {
        id: 'Q-NORM-BOUNDARY-CROSSING',
        needs: 'boundaries',
        question: '¿Puede un cambio cruzar una frontera de módulo declarándolo en la delta, o exige una enmienda gobernada?',
        why: 'Las fronteras actuales están observadas, pero si cruzarlas es una decisión defendible en la delta o una violación que solo una enmienda puede autorizar es una elección del equipo.',
        options: ['cruce permitido si la delta lo declara', 'cruce prohibido sin enmienda'],
        confirms: 'C-BOUNDARIES',
        evidence: (ctx) => `${ctx.boundaryDetail} · ${truncate(ctx.boundaries, 4, 'frontera(s)').join(', ')}`,
    },
    {
        id: 'Q-NORM-DATA-CLASSIFICATION',
        needs: 'config',
        question: '¿El sistema trata datos personales, secretos o credenciales que exijan un principio propio de manejo de datos?',
        why: 'La presencia de configuración e integraciones está observada, pero QUÉ datos viajan por ellas y con qué obligación es una decisión de negocio que ningún manifiesto declara.',
        options: ['sí, añadir un principio de manejo de datos', 'no aplica; no se tratan datos sensibles'],
        confirms: 'C-STACK-FACT',
        evidence: (ctx) => `configuración observada: ${truncate(ctx.configFiles, 4, 'fichero(s)').join(', ')}`,
        principle: {
            id: 'C-DATA-HANDLING',
            title: 'Los datos sensibles se declaran y se controlan',
            level: 'SHOULD',
            threatReference: 'fuga de datos personales, secretos o credenciales',
            restriction: 'Ningún dato personal, secreto o credencial se registra en claro, se expone en una respuesta ni se comparte con un tercero sin una decisión declarada.',
            pattern: 'Clasificar el dato en la especificación, limitar su recogida a lo necesario y declarar su retención y su canal de transmisión.',
            justification: 'Un dato sensible sin principio explícito acaba copiado en un log o en una respuesta de error, que es donde una fuga se descubre tarde y sin rastro de quién la autorizó.',
        },
    },
];
const normativeApplies = (needs, ctx) => {
    if (needs === 'public-api')
        return ctx.publicApiFiles.length > 0;
    if (needs === 'test-oracle')
        return Boolean(ctx.testFramework) && ctx.testDirs.length > 0;
    if (needs === 'boundaries')
        return ctx.boundaries.length > 0;
    return ctx.configFiles.length > 0;
};
const UNKNOWN = new Set(['unknown', '', 'n/a', 'undefined']);
const observed = (value) => Boolean(value) && !UNKNOWN.has(String(value).toLowerCase());
/**
 * La entrevista. Es SOLO LECTURA: no escribe nada y no bloquea nunca (sin TTY imprime las
 * preguntas; con `--answers` se aplican y se produce el borrador).
 */
export const planConstitutionInterview = async (cwd, opts = {}) => {
    const root = path.resolve(cwd);
    const sddDir = opts.sddDir ?? (await resolveSddDir(root));
    const project = await scanProject(root);
    const facts = await collectRepoFacts(root, project);
    const { constitution, detected, deferred } = buildDescriptiveConstitution(facts);
    // ── Evidencia: qué puede citarse. Un manifiesto que existe es una declaración; su ausencia se
    // dice, no se rellena con una suposición.
    const manifestEvidence = [];
    for (const candidate of [
        'package.json',
        'pyproject.toml',
        'Cargo.toml',
        'go.mod',
        'pom.xml',
        'build.gradle',
        'Gemfile',
        'composer.json',
        'tsconfig.json',
        'deno.json',
    ]) {
        if (await exists(path.join(root, candidate)))
            manifestEvidence.push(candidate);
    }
    if (facts.lockfile)
        manifestEvidence.push(facts.lockfile);
    const stackParts = [
        ...(observed(project.language) ? [project.language] : []),
        ...project.frameworks,
        ...(observed(project.packageManager) ? [project.packageManager] : []),
        ...(observed(project.buildTool) ? [project.buildTool] : []),
    ].filter(Boolean);
    const evidencedPrinciples = constitution.principles.filter((principle) => (principle.evidence ?? []).length > 0);
    const boundarySet = resolveBoundaries(project);
    const ctx = {
        publicApiFiles: facts.publicApiFiles,
        publicApiDetail: facts.publicApiDetail,
        ...(project.testFramework ? { testFramework: project.testFramework } : {}),
        testDirs: project.testDirs,
        boundaries: boundarySet.boundaries,
        boundaryDetail: boundarySet.detail,
        configFiles: facts.configFiles,
    };
    // ── Lo que el reconocimiento YA decidió. Cada línea cita su evidencia; ninguna se pregunta.
    const decidedByEvidence = [];
    if (stackParts.length > 0) {
        decidedByEvidence.push(`stack (hecho establecido, no se pregunta): ${stackParts.join(', ')} — evidencia: ` +
            (manifestEvidence.length > 0
                ? manifestEvidence.join(', ')
                : 'detectado por extensión de fichero sin manifiesto legible (no es una declaración)'));
    }
    for (const principle of evidencedPrinciples) {
        decidedByEvidence.push(`práctica observada ${principle.id} "${principle.title}" (${principle.level}) — evidencia: ${(principle.evidence ?? []).join('; ')}`);
    }
    if (ctx.boundaries.length > 0 && (project.sourceDirs.length > 0 || project.modules.length > 0)) {
        decidedByEvidence.push(`fronteras de módulo (${ctx.boundaries.length}): ${truncate(ctx.boundaries, 6, 'frontera(s)').join(', ')} — ${ctx.boundaryDetail}`);
    }
    if (ctx.publicApiFiles.length > 0) {
        decidedByEvidence.push(`API pública: ${ctx.publicApiDetail} — evidencia: ${truncate(ctx.publicApiFiles, 5, 'punto(s) de entrada').join(', ')}`);
    }
    if (facts.ciWorkflows.length > 0) {
        decidedByEvidence.push(`CI: ${facts.ciWorkflows.length} workflow(s) — evidencia: ${truncate(facts.ciWorkflows, 4, 'workflow(s)').join(', ')}`);
    }
    if (facts.configFiles.length > 0) {
        decidedByEvidence.push(`puntos de integración/configuración: ${truncate(facts.configFiles, 5, 'fichero(s)').join(', ')}`);
    }
    if (constitution.establishedFacts.length > 0) {
        decidedByEvidence.push(`hechos establecidos: ${constitution.establishedFacts.join(' · ')}`);
    }
    if (decidedByEvidence.length === 0) {
        decidedByEvidence.push('el reconocimiento no pudo decidir nada por evidencia: no hay manifiesto legible ni prácticas que citar (no se inventa ninguna)');
    }
    // ── Preguntas: solo lo que la evidencia no puede responder.
    const questions = [];
    if (evidencedPrinciples.length > 0) {
        questions.push({
            id: 'Q-RATIFY-EVIDENCED',
            question: `¿Ratificas como vinculantes los principios que el código YA demuestra (${evidencedPrinciples.map((p) => p.id).join(', ')})?`,
            why: 'La evidencia demuestra la práctica, pero convertirla en autoridad citable es una decisión humana: el borrador no es autoridad hasta que una persona nombrada lo ratifique.',
            default: 'sí',
            options: ['sí', 'no'],
            fromEvidence: (evidencedPrinciples[0].evidence ?? [])[0],
        });
    }
    constitution.amendments.forEach((amendment, index) => {
        if (amendment.status === 'in-force')
            return;
        // `buildDescriptiveConstitution` emite `deferred[i]` para `amendments[i]`; el emparejamiento solo
        // se usa si las dos listas siguen alineadas (mismo guard que `buildConstitutionDraft`).
        const reason = deferred.length === constitution.amendments.length ? deferred[index] : undefined;
        questions.push({
            id: `Q-ADOPT-${amendment.id}`,
            question: `¿Se adopta "${amendment.title}"? El código NO muestra la práctica${reason ? ` (${reason})` : ''}.`,
            why: 'Una práctica que el código no demuestra no puede ser un hecho: entra como principio normativo con enmienda propuesta y no gobierna hasta que exista evidencia y una persona la ratifique.',
            default: 'no todavía',
            options: ['sí', 'no todavía'],
            ...(reason ? { fromEvidence: `ausencia observada: ${reason}` } : {}),
        });
    });
    for (const spec of NORMATIVE_QUESTIONS) {
        if (!normativeApplies(spec.needs, ctx))
            continue;
        questions.push({
            id: spec.id,
            question: spec.question,
            why: spec.why,
            default: spec.options[0],
            options: [...spec.options],
            fromEvidence: spec.evidence(ctx),
        });
    }
    const max = Math.max(1, opts.max ?? DEFAULT_INTERVIEW_MAX);
    const shown = questions.slice(0, max);
    const omitted = questions.slice(max);
    const inForcePath = constitutionArtifactPaths(root, sddDir).inForce;
    const inForceExists = await exists(inForcePath);
    const evidence = [
        ...constitution.establishedFacts.map((fact) => `hecho establecido: ${fact}`),
        ...detected,
        ...evidencedPrinciples.map((principle) => `${principle.id}: ${(principle.evidence ?? []).join('; ')}`),
        ...(facts.ciWorkflows.length > 0 ? [`CI: ${facts.ciWorkflows.join(', ')}`] : []),
    ];
    const answersTemplate = {};
    for (const question of shown)
        if (question.default !== undefined)
            answersTemplate[question.id] = question.default;
    const deferForHost = {
        kind: 'constitution-interview',
        project: constitution.project,
        questions: shown.map((question) => ({ ...question })),
        decided: [...decidedByEvidence],
        answersTemplate,
        commands: {
            apply: 'open-sdd brownfield constitution . --interview --answers <path> --write',
            ratify: RATIFY_INSTRUCTION,
        },
        instructions: 'Rellena `answersTemplate` (una respuesta por id) y pásalo en un fichero JSON con --answers. ' +
            'El motor escribe un BORRADOR validado y marcado como no en vigor; ninguna respuesta convierte una práctica sin evidencia en autoridad, y una respuesta con una frase de excepción controlable desde fuera se reporta como error bloqueante.',
    };
    const detailParts = [
        `Entrevista de constitución para "${constitution.project}": ${shown.length} pregunta(s) que la evidencia NO puede responder y ${decidedByEvidence.length} cosa(s) que el reconocimiento YA decidió (y por eso no se preguntan).`,
    ];
    if (shown.length === 0) {
        detailParts.push('La evidencia respondió todo lo que este motor puede comprobar: no hay preguntas abiertas, pero el borrador sigue sin estar en vigor hasta que una persona nombrada lo ratifique.');
    }
    if (omitted.length > 0) {
        detailParts.push(`AVISO: ${omitted.length} pregunta(s) no se muestran por el tope --max=${max}; es un límite de presentación, no una afirmación de que no existan.`);
    }
    if (stackParts.length === 0) {
        detailParts.push('No se pudo determinar el stack por evidencia (sin manifiesto legible): no se declara como hecho ni se pregunta por él; queda como desconocido.');
    }
    if (inForceExists) {
        detailParts.push(`Ya existe ${constitutionArtifactPaths(root, sddDir).inForce}: esta entrevista no lo toca; el resultado va al borrador.`);
    }
    return {
        project: constitution.project,
        evidence,
        questions: shown,
        decidedByEvidence,
        deferForHost,
        detail: detailParts.join(' '),
    };
};
// ---------------------------------------------------------------------------------------------
// Aplicar respuestas: de la elección humana al borrador VALIDADO
// ---------------------------------------------------------------------------------------------
const NEGATIVE_ANSWER = /^(?:no\b|not\b|nunca\b|ninguno\b|ninguna\b)/i;
const AFFIRMATIVE_ANSWER = /^(?:sí\b|si\b|yes\b|y\b|true\b|s\b|adopt|deprecar|test\s+nuevo)/i;
/**
 * Decide una respuesta. `no` es una decisión registrada; `yes`, también. Una respuesta que no se
 * reconoce es `unclear` y vuelve a `unanswered`: no se convierte en un principio por accidente.
 */
const decideAnswer = (question, answer) => {
    const normalized = answer.trim().toLowerCase();
    if (normalized.length === 0)
        return 'unclear';
    if (NEGATIVE_ANSWER.test(normalized))
        return 'no';
    if (AFFIRMATIVE_ANSWER.test(normalized))
        return 'yes';
    // Una opción declarada decide por su prefijo COMÚN MÁS LARGO, no por el primero que encaje: en
    // «cruce permitido…» / «cruce prohibido…» el prefijo corto es el mismo y elegir el primero
    // convertiría la opción permisiva en la estricta.
    const options = question.options ?? [];
    if (options.length >= 2) {
        let best = -1;
        let bestScore = 0;
        options.forEach((option, index) => {
            const lower = option.toLowerCase();
            const max = Math.min(lower.length, normalized.length);
            let score = 0;
            while (score < max && lower[score] === normalized[score])
                score += 1;
            if (score > bestScore) {
                bestScore = score;
                best = index;
            }
        });
        if (best >= 0 && bestScore >= Math.min(6, options[best].length))
            return best === 0 ? 'yes' : 'no';
    }
    if (answer.includes(':') || /^(?:MUST|SHOULD|MAY)\b/i.test(answer))
        return 'yes';
    return 'unclear';
};
/** Texto libre de una respuesta con forma `nivel: texto` o `sí: texto`. */
const freeTextOf = (answer) => {
    const index = answer.indexOf(':');
    return (index >= 0 ? answer.slice(index + 1) : '').trim();
};
const LEVELS = new Set(['MUST', 'SHOULD', 'MAY']);
/**
 * Nivel pedido por la respuesta. Un nivel que la anatomía no admite NO se corrige en silencio: se
 * devuelve tal cual para que `validateConstitution` lo reporte como `LEVEL-INVALID`.
 */
const levelOf = (answer) => {
    const prefixed = answer.match(/^\s*([A-Za-z][A-Za-z-]{1,})\s*:/);
    if (prefixed) {
        const token = prefixed[1].toUpperCase();
        if (LEVELS.has(token) || /^[A-Z][A-Z-]{2,}$/.test(token))
            return token;
    }
    const leading = answer.match(/^\s*(MUST|SHOULD|MAY)\b/i);
    return leading ? leading[1].toUpperCase() : undefined;
};
const amendmentRecord = (principle, title, rationale) => ({
    id: `AMD-INTERVIEW-${principle.id}`,
    title,
    proposedBy: 'constitution-interview',
    status: 'proposed',
    migrationPlan: 'Aplicar la práctica y aportar la evidencia (ruta, símbolo o comando) que la demuestre antes de ratificarla como principio observable.',
    rationale,
});
/** Una práctica ausente que la persona adopta: principio NORMATIVO en borrador, nunca un hecho. */
const adoptedFromAmendment = (amendment, answer) => {
    const free = freeTextOf(answer);
    const level = levelOf(answer) ?? 'SHOULD';
    const id = amendment.id.startsWith('AMD-') ? `C-${amendment.id.slice(4)}` : `C-${amendment.id}`;
    return {
        id,
        title: amendment.title,
        level: level,
        threatReference: 'práctica gobernada que el código todavía no demuestra',
        restriction: `Adoptar la práctica "${amendment.title}"; el código todavía no la demuestra, así que no se declara como hecho.`,
        pattern: free.length > 0 ? free : 'Adoptar la práctica y aportar la evidencia (ruta, símbolo o comando) que la demuestre.',
        justification: 'Entra por la entrevista de constitución: el reconocimiento no encontró evidencia de esta práctica, y una práctica que el código no demuestra no puede afirmarse como hecho; solo gobierna cuando exista evidencia y una persona la ratifique.',
        provenance: 'normative',
        amendment: { ...amendment, status: 'proposed' },
        draft: true,
    };
};
const normativePrinciple = (spec, answer) => {
    if (!spec.principle)
        return null;
    const base = spec.principle;
    const free = freeTextOf(answer);
    const principle = {
        id: base.id,
        title: base.title,
        level: base.level,
        threatReference: base.threatReference,
        restriction: base.restriction,
        pattern: free.length > 0 ? `${base.pattern} (decisión registrada: ${free})` : base.pattern,
        justification: base.justification,
        provenance: 'normative',
        draft: true,
    };
    return {
        ...principle,
        amendment: amendmentRecord(principle, `Adopción por entrevista de ${principle.id} — ${principle.title}`, 'Decisión registrada por la entrevista de constitución; sin evidencia todavía, no puede afirmarse como hecho.'),
    };
};
/** El borrador con la cabecera que dice, sin ambigüedad, qué se aplicó, qué falta y qué bloquea. */
const renderInterviewDraft = (document, input) => {
    const rendered = renderConstitution(document);
    const lines = rendered.split('\n');
    const title = lines[0] ?? `# Constitution — ${document.project}`;
    const body = lines.slice(1);
    while (body.length > 0 && body[0].trim() === '')
        body.shift();
    const header = [
        title,
        '',
        DRAFT_MARKER,
        'Este documento NO está en vigor: es un borrador y ninguno de sus principios puede citarse como autoridad.',
        RATIFY_INSTRUCTION,
        '',
    ];
    header.push('## Entrevista: respuestas aplicadas', '');
    if (input.applied.length === 0)
        header.push('- Ninguna respuesta se aplicó: no hay decisiones registradas.');
    for (const entry of input.applied)
        header.push(`- ${entry.id} → ${entry.principle}`);
    header.push('');
    header.push('## Entrevista: sin responder o no reconocidas (no cuentan como decisiones)', '');
    if (input.unanswered.length === 0)
        header.push('- Ninguna: todas las preguntas de la entrevista quedaron resueltas.');
    for (const id of input.unanswered)
        header.push(`- ${id}`);
    header.push('');
    const errors = input.issues.filter((issue) => issue.severity === 'error').length;
    header.push('## Validación del borrador (validateConstitution)', '');
    if (input.issues.length === 0) {
        header.push('- Sin hallazgos: el borrador se puede ofrecer a ratificación (sigue sin estar en vigor).');
    }
    else {
        header.push(errors > 0
            ? `- ${errors} error(es) BLOQUEAN la ratificación mientras no se corrijan: el borrador se produce igual, pero no se oculta el defecto.`
            : '- Sin errores bloqueantes; los avisos se listan para quien deba ratificar.');
        for (const issue of input.issues) {
            header.push(`- [${issue.severity}] ${issue.code ?? issue.id}: ${issue.message}`);
        }
    }
    header.push('');
    if (input.adopted.length > 0) {
        header.push('## Principios añadidos por la entrevista (normativos, en borrador)', '');
        for (const id of input.adopted)
            header.push(`- ${id}`);
        header.push('');
    }
    return [...header, ...body].join('\n');
};
/**
 * Aplica las respuestas y produce un BORRADOR. No escribe ficheros: devuelve el texto (la CLI decide
 * dónde va) y NUNCA puede tocar la constitución en vigor porque no abre ningún fichero en escritura.
 * Cada respuesta se convierte en un principio normativo en borrador y el documento entero se valida.
 */
export const applyConstitutionAnswers = async (input) => {
    const root = path.resolve(input.cwd);
    const draft = await buildConstitutionDraft(root);
    const base = parseConstitution(draft.text);
    const answers = input.answers ?? {};
    const answerOf = (id) => String(answers[id] ?? '').trim();
    const applied = [];
    const unanswered = [];
    const additions = [];
    const addedAmendments = [];
    const adoptedIds = new Set();
    const questionIds = new Set(input.interview.questions.map((question) => question.id));
    for (const question of input.interview.questions) {
        const answer = answerOf(question.id);
        if (answer.length === 0) {
            unanswered.push(question.id);
            continue;
        }
        const decision = decideAnswer(question, answer);
        if (decision === 'unclear') {
            unanswered.push(question.id);
            continue;
        }
        if (question.id.startsWith('Q-RATIFY')) {
            // La ratificación REAL limpia la marca de borrador en `ratifyDraft`, con persona nombrada y
            // motivo. Aquí solo se registra la confirmación: este documento sigue sin ser autoridad.
            const ids = base.principles.filter((principle) => (principle.evidence ?? []).length > 0).map((principle) => principle.id);
            applied.push({ id: question.id, principle: ids.length > 0 ? ids.join(', ') : '(ninguno)' });
            continue;
        }
        if (question.id.startsWith('Q-ADOPT-')) {
            if (decision === 'no') {
                applied.push({ id: question.id, principle: '(no adoptado: decisión registrada)' });
                continue;
            }
            const amendmentId = question.id.slice('Q-ADOPT-'.length);
            const amendment = base.amendments.find((candidate) => candidate.id === amendmentId);
            if (!amendment) {
                // No se puede adoptar lo que el borrador no registra: vuelve como pregunta, no se inventa.
                unanswered.push(question.id);
                continue;
            }
            const principle = adoptedFromAmendment(amendment, answer);
            if (!adoptedIds.has(principle.id)) {
                adoptedIds.add(principle.id);
                additions.push(principle);
            }
            applied.push({ id: question.id, principle: principle.id });
            continue;
        }
        if (question.id.startsWith('Q-NORM-')) {
            const spec = NORMATIVE_QUESTIONS.find((candidate) => candidate.id === question.id);
            if (!spec) {
                unanswered.push(question.id);
                continue;
            }
            if (decision === 'no') {
                applied.push({ id: question.id, principle: spec.confirms });
                continue;
            }
            const principle = normativePrinciple(spec, answer);
            if (!principle) {
                applied.push({ id: question.id, principle: spec.confirms });
                continue;
            }
            if (!adoptedIds.has(principle.id)) {
                adoptedIds.add(principle.id);
                additions.push(principle);
                if (principle.amendment)
                    addedAmendments.push(principle.amendment);
            }
            applied.push({ id: question.id, principle: principle.id });
            continue;
        }
        // Id desconocido: no se descarta en silencio, pero tampoco se convierte en principio.
        unanswered.push(question.id);
    }
    // Respuestas cuyo id no está en la entrevista: una decisión que no aterriza en nada se reporta.
    for (const id of Object.keys(answers)) {
        if (!questionIds.has(id) && answerOf(id).length > 0)
            unanswered.push(id);
    }
    const document = {
        ...base,
        principles: [...base.principles, ...additions],
        amendments: [...base.amendments.filter((amendment) => !addedAmendments.some((added) => added.id === amendment.id)), ...addedAmendments],
    };
    const validated = validateConstitution(document);
    const issues = validated.map((issue) => ({
        code: issue.code ?? issue.id,
        message: issue.message,
    }));
    const text = renderInterviewDraft(document, {
        applied,
        unanswered,
        issues: validated,
        adopted: additions.map((principle) => principle.id),
    });
    return { text, applied, unanswered, issues };
};
const bulletOf = /^\s*(?:[-*+•]|\d+[.)])\s+/;
const inlineBullet = /(?:^|\s)\d+[.)]\s+/g;
const sentenceBreak = /(?<=[.!?])\s+(?=(?:WHEN|WHILE|WHERE|IF|Cuando|Si|Mientras|Donde|El|La|Los|Las|The|A|An|Yo|Quiero|Necesito|Una|Dado)\b)/;
/** Divide la descripción en comportamientos sin decidir nada sobre ellos. */
const splitBehaviours = (description) => {
    const units = [];
    const withBullets = description.replace(inlineBullet, '\n');
    for (const rawLine of withBullets.split('\n')) {
        const line = rawLine.replace(bulletOf, '');
        for (const piece of line.split(/[;•]/)) {
            for (const sentence of piece.split(sentenceBreak))
                units.push(sentence.trim());
        }
    }
    return units.filter((unit) => unit.length > 0);
};
const MISSING_LABEL = {
    NO_SHALL: 'respuesta observable',
    NOT_TESTABLE: 'comportamiento observable',
    ACTOR_NOT_SYSTEM: 'actor del sistema',
    NO_ACTOR: 'actor',
    PASSIVE_VOICE: 'actor',
    MISSING_TRIGGER: 'disparador',
    VAGUE_TERM: 'valor medible',
    COMPOUND_REQUIREMENT: 'un comportamiento por requisito',
};
/** Códigos que, sin ser error, delatan un dato que la descripción no trae. */
const REFUSAL_CODES = new Set(['VAGUE_TERM', 'PASSIVE_VOICE', 'MISSING_TRIGGER']);
/** El analizador compartido deja el modal duplicado y un separador vacío tras `shall` en la forma
 * «cuando X, el actor debe Y». Se quitan esas dos marcas de forma; no se añade ni se cambia ninguna
 * palabra del usuario. */
const tidyCandidate = (proposal) => proposal
    .replace(/\bshall\s*[,;]\s*/gi, 'shall ')
    .replace(/\bshall\s+(?:que\s+)?(?:debe\s+de|debe|deben|deber[íi]a|deberian|tiene\s+que|tienen\s+que|ha\s+de|han\s+de|must|should)\s+/gi, 'shall ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
const MALFORMED_RESPONSE = [
    /\bshall\s*[,;]/i,
    /\bshall\s+(?:el|la|los|las|the|a|an|que|debe|deben|deber[íi]a|tiene|tienen)\b/i,
    /\bshall\s*\./i,
    /\bshall\s*$/i,
];
/** Un disparador se ha quedado fuera si el texto insinúa un momento o una condición y el analizador
 * compartido NO lo subió a `WHEN/WHILE/WHERE/IF`. */
const TRIGGER_HINT = /\b(?:cuando|when|whenever|mientras|while|si\b|if\b|donde|where|una\s+vez\s+que|once|tras\b|después\s+de|despues\s+de|upon\b|after\b|al\s+\w+(?:ar|er|ir)se\b)/i;
const patternFromCode = (code) => {
    const match = code.match(/^CANDIDATE_([A-Z]+)$/);
    return match ? match[1].toLowerCase() : 'ubiquitous';
};
/**
 * Analiza UN comportamiento con el analizador compartido y decide: requisito (con su patrón) o
 * pregunta (con el dato que falta). Nunca fabrica: si el candidato no es una frase EARS completa, se
 * pregunta por el dato ausente.
 */
const analyseBehaviour = (unit, source) => {
    const suggestions = describeFromPlainLanguage(unit);
    if (suggestions.length === 0)
        return null;
    const candidate = suggestions[0];
    if (!isEarsProposalApplicable(candidate)) {
        return { kind: 'question', missing: 'respuesta observable', question: `Sobre «${unit}»: ${candidate.proposal}` };
    }
    // El actor: el analizador compartido solo reconoce unas pocas formas. Si tuvo que suponer
    // «the system», esta puerta pregunta en vez de escribir un requisito con un actor inventado.
    const actorDefaulted = /(^|,\s*)the system shall\b/i.test(candidate.proposal) && !/\b(?:the\s+system|el\s+sistema)\b/i.test(unit);
    if (actorDefaulted) {
        return {
            kind: 'question',
            missing: 'actor',
            question: `Sobre «${unit}»: el texto no nombra el componente del sistema que responde y el analizador EARS ` +
                'tuvo que suponer «the system». ¿Qué componente responde? (EARS exige un actor como sujeto de "shall"; no se inventa)',
        };
    }
    const pattern = patternFromCode(candidate.code);
    if (pattern === 'ubiquitous' && TRIGGER_HINT.test(unit)) {
        return {
            kind: 'question',
            missing: 'disparador',
            question: `Sobre «${unit}»: el texto insinúa un momento o una condición, pero el disparador no se pudo extraer ` +
                'sin inventarlo. ¿Cuál es el disparador exacto y su condición (WHEN/IF/WHILE/WHERE)?',
        };
    }
    const tidied = tidyCandidate(candidate.proposal);
    if (MALFORMED_RESPONSE.some((patternRe) => patternRe.test(tidied))) {
        return {
            kind: 'question',
            missing: 'respuesta observable',
            question: `Sobre «${unit}»: el candidato EARS no quedó en forma de frase (la respuesta tras "shall" no es un verbo en ` +
                'forma base). ¿Cuál es la acción observable exacta del sistema? (no se fabrica el requisito)',
            malformed: true,
        };
    }
    // El MISMO validador que usa el resto de la herramienta decide si el candidato es aceptable.
    const report = analyseEars(tidied, { source });
    const blocking = report.suggestions.find((suggestion) => suggestion.severity === 'error' || REFUSAL_CODES.has(suggestion.code.toUpperCase()));
    if (blocking) {
        const missing = MISSING_LABEL[blocking.code.toUpperCase()] ?? 'dato que falta';
        return {
            kind: 'question',
            missing,
            question: `Sobre «${unit}»: ${blocking.problem} ${blocking.proposal}`,
        };
    }
    return { kind: 'requirement', pattern, statement: tidied, tidied: tidied !== candidate.proposal };
};
// ---------------------------------------------------------------------------------------------
// Requisitos existentes: se conservan, y la CLI los usa para informar `keep`
// ---------------------------------------------------------------------------------------------
const STATEMENT_FIELD = /^[-*+]?\s*(?:Statement|Enunciado)\s*:\s*(.+)$/i;
const REQ_ID = /\bREQ-([A-Z0-9]+)-(\d{3})\b/g;
/** Los enunciados que ya viven en un `requirements.md`. Solo lee; no interpreta EARS. */
export const existingRequirementStatements = (text) => {
    const out = [];
    for (const raw of (text ?? '').split('\n')) {
        const line = raw.trim();
        if (line.length === 0 || line.startsWith('#') || line.startsWith('<!--') || /^Fuente\s*:/i.test(line))
            continue;
        const field = line.match(STATEMENT_FIELD);
        if (field) {
            const statement = field[1].trim();
            if (statement.length > 0)
                out.push(statement);
            continue;
        }
        if (/\bshall\b/i.test(line))
            out.push(line.replace(/^[-*+]\s+/, '').trim());
    }
    return out;
};
/** Clave de comparación de enunciados: forma, no contenido (espacios, caso y puntuación final). */
export const normalizeRequirementStatement = (statement) => statement.replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.;]+$/, '');
/**
 * Enunciado existente → identificador que YA tiene, para que un requisito conservado se reporte con
 * su id real y no con uno nuevo. Solo lee el documento; no interpreta EARS.
 */
const existingStatementIds = (text) => {
    const map = new Map();
    let lastId = null;
    for (const raw of (text ?? '').split('\n')) {
        const line = raw.trim();
        if (line.length === 0)
            continue;
        const field = line.match(STATEMENT_FIELD);
        if (field) {
            if (lastId)
                map.set(normalizeRequirementStatement(field[1].trim()), lastId);
            continue;
        }
        const id = line.match(/\bREQ-[A-Z0-9]+-\d{3}\b/);
        if (id)
            lastId = id[0];
    }
    return map;
};
/** El área de los ids `REQ-<ÁREA>-<NNN>`: la que pide el llamante o una derivada de la feature. */
export const requirementArea = (feature, area) => {
    const declared = (area ?? '').trim();
    if (declared.length > 0)
        return declared.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toUpperCase() || 'REQ';
    const derived = feature
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toUpperCase();
    return derived || 'REQ';
};
const nextSequence = (existing, area) => {
    const prefix = `REQ-${area}-`;
    let max = 0;
    for (const match of (existing ?? '').matchAll(REQ_ID)) {
        if (`REQ-${match[1]}-` !== prefix)
            continue;
        max = Math.max(max, Number(match[2]));
    }
    return max + 1;
};
const pad = (value) => String(value).padStart(3, '0');
/**
 * De una descripción en lenguaje natural a requisitos EARS. Es SÍNCRONA y no toca el disco: lee la
 * descripción, usa el analizador compartido, y devuelve requisitos con su patrón o preguntas con el
 * dato que falta. Los requisitos existentes que se pasan en `existing` se conservan intactos:
 * decidir ADDED frente a MODIFIED es competencia de la delta (`open-sdd delta init|validate`).
 */
export const specifyFromDescription = (input) => {
    const feature = input.feature.trim();
    const description = (input.description ?? '').trim();
    const existingText = input.existing ?? '';
    const area = requirementArea(feature, input.area);
    const source = `specify:${feature}`;
    const existingStatements = new Set(existingRequirementStatements(existingText).map(normalizeRequirementStatement));
    const existingIds = new Set([...existingText.matchAll(REQ_ID)].map((match) => `REQ-${match[1]}-${match[2]}`));
    const idByStatement = existingStatementIds(existingText);
    const units = splitBehaviours(description);
    const requirements = [];
    const questions = [];
    const addedLines = [];
    const patternCounts = new Map();
    let requirementSequence = nextSequence(existingText, area);
    let questionSequence = 1;
    let tidied = 0;
    let malformed = 0;
    for (const unit of units) {
        const analysis = analyseBehaviour(unit, source);
        if (!analysis)
            continue;
        if (analysis.kind === 'question') {
            questions.push({
                id: `Q-${area}-${pad(questionSequence++)}`,
                question: analysis.question ?? `Sobre «${unit}»: falta un dato que no se ha inventado.`,
                missing: analysis.missing ?? 'dato que falta',
            });
            if (analysis.malformed)
                malformed += 1;
            continue;
        }
        const statement = analysis.statement ?? '';
        const pattern = analysis.pattern ?? 'ubiquitous';
        if (analysis.tidied)
            tidied += 1;
        patternCounts.set(pattern, (patternCounts.get(pattern) ?? 0) + 1);
        const key = normalizeRequirementStatement(statement);
        const alreadyPresent = existingStatements.has(key);
        let id;
        if (alreadyPresent) {
            // El enunciado ya existe: se conserva con su identificador real y NO se escribe otra vez.
            const mapped = idByStatement.get(key);
            if (mapped) {
                id = mapped;
            }
            else {
                id = `REQ-${area}-${pad(requirementSequence++)}`;
                while (existingIds.has(id))
                    id = `REQ-${area}-${pad(requirementSequence++)}`;
            }
            requirements.push({ id, pattern, statement, fromAnswer: unit });
            continue;
        }
        id = `REQ-${area}-${pad(requirementSequence++)}`;
        while (existingIds.has(id))
            id = `REQ-${area}-${pad(requirementSequence++)}`;
        existingIds.add(id);
        requirements.push({ id, pattern, statement, fromAnswer: unit });
        addedLines.push(`- **${id}** — patrón \`${pattern}\``, `  - Statement: ${statement}`, `  - Fuente: ${unit}`);
    }
    const kept = requirements.filter((requirement) => existingStatements.has(normalizeRequirementStatement(requirement.statement))).length;
    const section = [];
    if (addedLines.length > 0) {
        section.push('## ADDED — brownfield specify', '', ...addedLines, '');
    }
    const body = existingText.trim().length > 0
        ? `${existingText.replace(/\s+$/, '')}${section.length > 0 ? `\n\n${section.join('\n')}` : ''}\n`
        : [
            `# Requirements — ${feature}`,
            '',
            '<!-- Derivado por open-sdd brownfield specify a partir de una descripción en lenguaje natural.',
            '     Los requisitos existentes no se tocan: ADDED frente a MODIFIED lo decide la delta. -->',
            '',
            ...section,
        ]
            .join('\n')
            .replace(/\s+$/, '') + '\n';
    const text = body;
    const patternsUsed = [...patternCounts.entries()].map(([pattern, count]) => `${pattern} ${count}`).join(' · ');
    const detailParts = [];
    detailParts.push(`${requirements.length} requisito(s) EARS derivado(s) de ${units.length} comportamiento(s) descrito(s); ` +
        `${questions.length} pregunta(s) por datos que la descripción no trae.`);
    if (units.length === 0) {
        detailParts.push('La descripción está vacía: no se analizó nada y no se escribe ningún requisito.');
    }
    else if (questions.length === 0) {
        detailParts.push('Todos los comportamientos descritos se convirtieron en requisitos EARS con su patrón nombrado: no quedó nada sin analizar.');
    }
    else {
        detailParts.push('Los comportamientos sin dato suficiente NO se convirtieron en requisitos: viajan como preguntas con lo que falta.');
    }
    if (patternsUsed.length > 0)
        detailParts.push(`Patrones usados: ${patternsUsed}.`);
    detailParts.push(`Plantillas y análisis: ${EARS_ASSISTANT_TEMPLATES.length} plantillas EARS compartidas (no se escribe un segundo analizador).`);
    if (existingText.trim().length > 0) {
        detailParts.push(`Se conservan ${existingStatements.size} enunciado(s) existente(s) palabra por palabra (${kept} de los derivados ya estaban): ` +
            'decidir ADDED frente a MODIFIED es competencia de la delta (open-sdd delta init|validate), no de esta función.');
    }
    if (tidied > 0) {
        detailParts.push(`${tidied} candidato(s) se normalizaron: el analizador compartido dejó un separador vacío tras "shall" y el modal duplicado; se quitaron esas marcas de forma, sin cambiar ninguna palabra.`);
    }
    if (malformed > 0) {
        detailParts.push(`${malformed} comportamiento(s) se rechazaron porque el candidato no quedó en forma de frase: no se fabricó el requisito.`);
    }
    detailParts.push('La forma verbal tras "shall" se conserva tal como la escribió la descripción (no se conjuga ni se traduce): verifícala con `open-sdd brownfield requirements <feature>`.');
    return {
        feature,
        requirements,
        questions,
        text,
        detail: detailParts.join(' '),
    };
};
