/**
 * El BORRADOR de constitución: "el día uno no es una página en blanco".
 *
 * Una constitución es el pivote que valida cada spec, así que un proyecto nuevo no debería
 * empezar sin una. Pero la autoridad no se inventa: un documento que nadie ratificó no puede
 * citarse en un veredicto bloqueante (invariante I1). Este módulo resuelve las dos cosas a la vez:
 *
 *   - ESCRIBE UN BORRADOR con lo que el código YA demuestra (reutiliza `reverseConstitution`, no
 *     inventa un segundo análisis) y con las prácticas deseadas que el código NO muestra, que
 *     viajan como PREGUNTAS, nunca como principios.
 *   - Lo marca como borrador principio a principio (`draft: true`), de modo que
 *     `constitution.ts:principlesInForce` lo excluye por construcción: un borrador no es autoridad
 *     porque el mecanismo que resuelve autoridad no lo ve, no porque alguien se acuerde de filtrarlo.
 *
 * La puerta humana es `ratifyDraft`: exige persona nombrada y motivo no vacío, se niega a promover
 * una propuesta sin evidencia y deja al ratificador y su razón escritos en el registro de enmiendas.
 * Ninguna otra función de la herramienta limpia la marca de borrador.
 *
 * Sobre "asistente de IA sin embarcar un modelo": esta herramienta no trae backend. En su lugar,
 * `evidencePackForHost` entrega a un modelo anfitrión exactamente lo que necesita para redactar la
 * prosa — hechos, candidatos con su evidencia, las reglas que su salida debe cumplir y lo que no se
 * pudo determinar — y dice explícitamente cuándo el paquete está incompleto.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { INJECTION_PATTERNS, parseConstitution, parseEvidenceArtifact, renderConstitution, } from './constitution.js';
import { scanProject } from './reverseEngineering.js';
import { buildDescriptiveConstitution, collectRepoFacts } from './reverseConstitution.js';
import { resolveSddDir } from './specManager.js';
/** The literal line that marks the artifact as a draft (first lines of `.draft.md`). */
export const DRAFT_MARKER = 'Status: draft';
/** File names the CLI writes and reads. Kept here so the two commands cannot disagree. */
export const DRAFT_FILE_NAME = 'constitution.draft.md';
export const IN_FORCE_FILE_NAME = 'constitution.md';
/** How the artifact tells a human to turn it into authority. */
export const RATIFY_INSTRUCTION = 'Para ratificar: open-sdd govern constitution --ratify --by "<nombre>" --rationale "<texto>" --write';
/** Recorded as the amendment proposer while the document is still a draft. */
export const DRAFT_PROPOSED_BY = 'constitution-draft';
/** `steering/constitution.draft.md` and `steering/constitution.md` for a resolved SDD directory. */
export const constitutionArtifactPaths = (cwd, sddDir = '.sdd') => ({
    draft: path.join(cwd, sddDir, 'steering', DRAFT_FILE_NAME),
    inForce: path.join(cwd, sddDir, 'steering', IN_FORCE_FILE_NAME),
});
export const DRAFT_VALIDATION_RULES = [
    {
        code: 'ID-FORMAT',
        severity: 'error',
        rule: 'Cada principio necesita un identificador citable: mayúsculas, dígitos y guiones (^[A-Z][A-Z0-9-]{2,}$), p. ej. C-API-COMPAT.',
    },
    {
        code: 'ID-POSITIONAL',
        severity: 'error',
        rule: 'Nada de identificadores posicionales (P-01, PRINCIPLE-1, RULE-3): se citan en veredictos y deben sobrevivir a reordenar.',
    },
    { code: 'ID-DUPLICATE', severity: 'error', rule: 'Dos principios no pueden compartir identificador.' },
    {
        code: 'FIELD-MISSING',
        severity: 'error',
        rule: 'La anatomía son seis campos: title, level, restriction, pattern y justification no pueden quedar vacíos.',
    },
    { code: 'LEVEL-INVALID', severity: 'error', rule: 'El nivel de imposición es exactamente MUST, SHOULD o MAY.' },
    {
        code: 'CWE-FORMAT',
        severity: 'error',
        rule: 'Una referencia CWE usa la forma canónica CWE-<número> (CWE-89), nunca "cwe 89" ni "CWE-abc".',
    },
    {
        code: 'CWE-MIGRATE',
        severity: 'warning',
        rule: 'Una referencia CWE pertenece a cweReference; threatReference queda para OWASP/ATLAS o ADR.',
    },
    {
        code: 'MUST-THREAT',
        severity: 'error',
        rule: 'Un MUST nombra la amenaza que previene (cweReference o threatReference). En un borrador se reporta como aviso, no como ley.',
    },
    {
        code: 'RATIONALE-THREAT',
        severity: 'error',
        rule: 'La justificación nombra el vector de ataque (al menos ~40 caracteres y 6 palabras). En un borrador se reporta como aviso.',
    },
    {
        code: 'EVIDENCE-MISSING',
        severity: 'error',
        rule: 'Un principio descriptivo cita la evidencia (ruta, símbolo o comando) que demuestra que el código ya lo cumple.',
    },
    {
        code: 'AMENDMENT-REQUIRED',
        severity: 'error',
        rule: 'Un MUST normativo solo entra por una enmienda gobernada: no se afirma como autoridad.',
    },
    {
        code: 'AMENDMENT-MIGRATION-PLAN',
        severity: 'error',
        rule: 'Una enmienda en vigor sin plan de migración no puede gobernar código existente.',
    },
    { code: 'AMENDMENT-UNKNOWN', severity: 'error', rule: 'La enmienda que cita un principio debe figurar en el registro de enmiendas.' },
    {
        code: 'PROVENANCE-FACTS',
        severity: 'warning',
        rule: 'Una constitución normativa no declara hechos del código; los hechos establecidos son de la descriptiva (brownfield).',
    },
    {
        code: 'LEVEL-BALANCE',
        severity: 'warning',
        rule: 'Con cuatro o más principios, no todos deberían ser MUST: usa SHOULD/MAY donde la desviación sea defendible.',
    },
    ...INJECTION_PATTERNS.map((pattern) => ({
        code: pattern.code,
        severity: 'error',
        rule: `Sin frases de excepción controlables desde fuera ni anulación de instrucciones: ${pattern.justification}`,
    })),
];
/**
 * Evidence a draft may cite: a path-shaped reference has to EXIST in the repository; anything that
 * is not path-shaped (a fact such as `package manager: npm`, a command, a symbol) is kept as-is
 * because a path lookup cannot falsify it. This is the house rule — nothing is reported as
 * inspected when it was not — applied to the one field the whole draft rests on.
 */
const verifiableEvidence = (entries, root) => {
    const kept = [];
    const dropped = [];
    for (const raw of entries) {
        const entry = raw.trim();
        if (!entry)
            continue;
        const artifact = parseEvidenceArtifact(entry, { cwd: root });
        if (artifact.file !== undefined && !artifact.resolvable)
            dropped.push(entry);
        else
            kept.push(entry);
    }
    return { kept, dropped };
};
/**
 * Construye el borrador sobre un repositorio real.
 *
 * Un principio propuesto SOLO existe si su evidencia existe; una práctica que el código no muestra
 * se convierte en pregunta. Las prácticas ausentes que `reverseConstitution` ya registra como
 * enmiendas propuestas viajan tal cual: son propuestas sin evidencia, así que `needsHumanDecision`
 * es true y `ratifyDraft` se negará a promocionarlas.
 */
export const buildConstitutionDraft = async (cwd, options = {}) => {
    const root = path.resolve(cwd);
    const sddDir = options.sddDir ?? (await resolveSddDir(root));
    const project = await scanProject(root);
    const facts = await collectRepoFacts(root, project);
    const { constitution, detected, deferred } = buildDescriptiveConstitution(facts, {
        proposedBy: DRAFT_PROPOSED_BY,
    });
    const proposals = [];
    const questions = [];
    const droppedEvidence = [];
    const proposedIds = new Set();
    for (const principle of constitution.principles) {
        const { kept, dropped } = verifiableEvidence(principle.evidence ?? [], root);
        for (const entry of dropped)
            droppedEvidence.push(`${principle.id}: ${entry}`);
        if (kept.length === 0) {
            // Never a principle: a practice without evidence is a wish, and a wish recorded as a fact is
            // exactly the failure the descriptive constitution exists to prevent.
            const question = `¿Se adopta "${principle.title}" (${principle.id})? El análisis no encontró ninguna prueba de esta práctica en el código, así que no puede ser un principio todavía.`;
            proposals.push({
                principle: { ...principle, evidence: [], draft: true },
                evidence: [],
                rationaleDraft: principle.justification,
                needsHumanDecision: true,
                question,
            });
            questions.push(question);
            continue;
        }
        proposedIds.add(principle.id);
        proposals.push({
            principle: { ...principle, evidence: kept, draft: true },
            evidence: kept,
            rationaleDraft: principle.justification,
            needsHumanDecision: false,
        });
    }
    // Desired-but-absent practices, reused from the descriptive generator's proposed amendments. They
    // are proposals by definition, so they can never enter the `## Principles` section of the draft.
    constitution.amendments.forEach((amendment, index) => {
        if (amendment.status === 'in-force')
            return;
        const id = amendment.id.startsWith('AMD-') ? `C-${amendment.id.slice(4)}` : `C-${amendment.id}`;
        if (proposedIds.has(id))
            return;
        proposedIds.add(id);
        // `buildDescriptiveConstitution` emits `deferred[i]` for `amendments[i]`; the pairing is only
        // trusted when the two lists still line up, so a future change degrades to the generic question
        // instead of attributing the wrong reason.
        const reason = deferred.length === constitution.amendments.length ? deferred[index] : undefined;
        const question = `¿Se adopta "${amendment.title}"? El código NO muestra la práctica` +
            `${reason ? ` (${reason})` : ''}: entra como enmienda propuesta ${amendment.id} y solo gobierna ` +
            'cuando una persona la ratifique y exista evidencia que la demuestre.';
        questions.push(question);
        proposals.push({
            principle: {
                id,
                title: amendment.title,
                level: 'SHOULD',
                restriction: 'Práctica deseada y no observada: no gobierna nada mientras siga siendo una propuesta sin evidencia.',
                pattern: 'Acordar la práctica, aplicarla y aportar la evidencia (ruta o símbolo) que la demuestre antes de ratificarla.',
                justification: `Propuesta registrada como ${amendment.id}: sin evidencia en el código no puede afirmarse como hecho.`,
                provenance: 'normative',
                evidence: [],
                amendment,
                draft: true,
            },
            evidence: [],
            rationaleDraft: amendment.title,
            needsHumanDecision: true,
            question,
        });
    });
    const evidencedPrinciples = proposals
        .filter((proposal) => !proposal.needsHumanDecision)
        .map((proposal) => proposal.principle);
    const document = {
        project: constitution.project,
        provenance: 'descriptive',
        ...(constitution.generatedAt ? { generatedAt: constitution.generatedAt } : {}),
        establishedFacts: constitution.establishedFacts,
        principles: evidencedPrinciples,
        amendments: constitution.amendments,
    };
    const rendered = renderConstitution(document);
    const lines = rendered.split('\n');
    const title = lines[0] ?? `# Constitution — ${constitution.project}`;
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
    if (questions.length > 0) {
        header.push('## Preguntas abiertas (prácticas deseadas que el código NO muestra; no son principios)', '');
        for (const question of questions)
            header.push(`- ${question}`);
        header.push('');
    }
    const text = [...header, ...body].join('\n');
    const pending = proposals.filter((proposal) => proposal.needsHumanDecision).length;
    const evidenced = proposals.length - pending;
    const complete = questions.length === 0;
    const inForceExists = existsSync(constitutionArtifactPaths(root, sddDir).inForce);
    const detail = `Borrador de constitución para "${constitution.project}" (${evidenced} propuesta(s) con evidencia, ` +
        `${pending} pregunta(s) sin evidencia de ${detected.length} hecho(s) observado(s)): ` +
        (complete
            ? 'sin preguntas abiertas, pero SIGUE sin estar en vigor hasta que una persona nombrada lo ratifique.'
            : `INCOMPLETO — hay ${questions.length} práctica(s) deseada(s) que el código no muestra; ninguna es un principio.`) +
        (droppedEvidence.length > 0
            ? ` Se descartaron ${droppedEvidence.length} referencia(s) de evidencia que no existen en el repositorio: no se citan como inspeccionadas.`
            : '') +
        (inForceExists
            ? ` Ya existe ${path.join(sddDir, 'steering', IN_FORCE_FILE_NAME)}: este borrador va al lado y no la toca.`
            : '');
    return {
        project: constitution.project,
        proposals,
        questions,
        text,
        detail,
        complete,
    };
};
/**
 * Exactly what a host model needs to write the prose: facts, evidence, candidate principles, the
 * validation rules it must satisfy, and the gaps. No model is shipped by this tool.
 *
 * The facts travel inside the document, so they are read back with `parseConstitution` instead of
 * being carried in a second field of `ConstitutionDraft`: one artifact, one reader.
 */
export const evidencePackForHost = (draft, options = {}) => {
    const maxEvidence = Math.max(0, options.maxEvidencePerItem ?? 8);
    const document = parseConstitution(draft.text);
    const facts = document.establishedFacts;
    const pending = draft.proposals.filter((proposal) => proposal.needsHumanDecision);
    const candidates = draft.proposals.map((proposal) => ({
        id: proposal.principle.id,
        title: proposal.principle.title,
        level: proposal.principle.level,
        provenance: proposal.principle.provenance,
        restriction: proposal.principle.restriction,
        pattern: proposal.principle.pattern,
        threatReference: proposal.principle.threatReference ?? null,
        cweReference: proposal.principle.cweReference ?? null,
        rationaleDraft: proposal.rationaleDraft,
        evidence: proposal.evidence.slice(0, maxEvidence),
        evidenceTotal: proposal.evidence.length,
        needsHumanDecision: proposal.needsHumanDecision,
        question: proposal.question ?? null,
        /** Solo una propuesta con evidencia puede convertirse en principio. */
        mayBecomePrinciple: !proposal.needsHumanDecision && proposal.evidence.length > 0,
    }));
    const incompleteBecause = [];
    if (!draft.complete) {
        incompleteBecause.push(`El borrador está INCOMPLETO: ${draft.questions.length} pregunta(s) abierta(s) exigen una decisión humana. No las conviertas en principios: una práctica que el código no muestra no tiene evidencia.`);
    }
    if (pending.length > 0) {
        incompleteBecause.push(`${pending.length} propuesta(s) sin evidencia (${pending.map((p) => p.principle.id).join(', ')}): el código no las demuestra, así que NO pueden ser principios.`);
    }
    if (facts.length === 0) {
        incompleteBecause.push('No se pudieron determinar hechos establecidos (proyecto sin manifiesto legible): no los inventes, declara lo que no se pudo determinar.');
    }
    if (candidates.every((candidate) => !candidate.mayBecomePrinciple)) {
        incompleteBecause.push('Ninguna propuesta tiene evidencia verificable: el borrador no puede producir ni un principio y debe declararse incompleto.');
    }
    return {
        kind: 'constitution-draft-evidence-pack',
        project: draft.project,
        marker: DRAFT_MARKER,
        status: draft.complete ? 'complete' : 'incomplete',
        complete: draft.complete,
        /** Un borrador completo SIGUE sin ser autoridad: la ratificación es una puerta humana aparte. */
        inForce: false,
        ratificationPending: true,
        incompleteBecause,
        facts,
        candidates,
        questions: draft.questions,
        ratify: {
            command: RATIFY_INSTRUCTION,
            requires: { by: 'nombre de la persona que ratifica', rationale: 'motivo no vacío', ids: 'C-A,C-B (opcional; sin --ids se ratifican todas las propuestas con evidencia)' },
            artifact: path.join('steering', IN_FORCE_FILE_NAME),
        },
        validationRules: DRAFT_VALIDATION_RULES.map((rule) => ({ ...rule })),
        validationCodes: DRAFT_VALIDATION_RULES.map((rule) => rule.code),
        evidenceCapPerItem: maxEvidence,
        noModelShipped: 'Esta herramienta no embarca ningún modelo: el texto final lo escribe tu modelo anfitrión a partir de este paquete, y lo ratifica una persona nombrada. Un borrador nunca es autoridad.',
    };
};
/** Principles still waiting for ratification. */
export const draftPrincipleIds = (constitution) => constitution.principles.filter((principle) => principle.draft === true).map((principle) => principle.id);
/**
 * La puerta humana. Ratificar exige persona nombrada y motivo no vacío; solo promueve principios que
 * el borrador propone; se niega, diciendo por qué, ante una propuesta sin evidencia; y deja al
 * ratificador y su razón escritos en el registro de enmiendas.
 *
 * Ninguna otra función limpia `draft`: es lo que hace del flag una puerta y no una etiqueta.
 */
export const ratifyDraft = (constitution, input) => {
    const by = input.by?.trim() ?? '';
    const rationale = input.rationale?.trim() ?? '';
    if (!by) {
        throw new Error('La ratificación exige una persona nombrada: pasa --by "<nombre>". Sin nombre no hay puerta humana, y un borrador no se convierte en autoridad porque sí.');
    }
    if (!rationale) {
        throw new Error('La ratificación exige un motivo no vacío: pasa --rationale "<texto>". Sin motivo no queda rastro de por qué se aceptó el principio.');
    }
    const byId = new Map(constitution.principles.map((principle) => [principle.id, principle]));
    const draftIds = new Set(draftPrincipleIds(constitution));
    const requested = [
        ...new Set((input.ids ?? [])
            .map((id) => id.trim())
            .filter((id) => id.length > 0)),
    ];
    const selection = requested.length > 0 ? requested : [...draftIds];
    const at = new Date().toISOString();
    const ratified = [];
    const refused = [];
    const promoted = new Map();
    const newAmendments = [];
    for (const id of selection) {
        const principle = byId.get(id);
        if (!principle) {
            refused.push({
                id,
                why: 'No figura en el borrador: la ratificación solo puede promover principios que el documento propone.',
            });
            continue;
        }
        if (!draftIds.has(id)) {
            refused.push({
                id,
                why: 'No es un principio en borrador (ya está en vigor o nunca fue una propuesta): no hay nada que ratificar.',
            });
            continue;
        }
        if ((principle.evidence ?? []).filter((entry) => entry.trim().length > 0).length === 0) {
            refused.push({
                id,
                why: 'Sin evidencia: una propuesta que el código no demuestra no puede convertirse en principio. Aporta la prueba o déjala como pregunta.',
            });
            continue;
        }
        const record = {
            id: `AMD-RATIFY-${principle.id}`,
            title: `Ratificación de ${principle.id} — ${principle.title}`,
            proposedBy: by,
            status: 'in-force',
            migrationPlan: 'Sin migración pendiente: la práctica ya está en el código y la evidencia observada es la prueba.',
            rationale,
            approvals: [{ actor: by, at }],
            updatedAt: at,
        };
        promoted.set(id, { ...principle, draft: false, amendment: record });
        newAmendments.push(record);
        ratified.push(id);
    }
    const keptAmendments = constitution.amendments.filter((amendment) => !newAmendments.some((added) => added.id === amendment.id));
    return {
        constitution: {
            ...constitution,
            principles: constitution.principles.map((principle) => promoted.get(principle.id) ?? principle),
            amendments: [...keptAmendments, ...newAmendments],
        },
        ratified,
        refused,
    };
};
