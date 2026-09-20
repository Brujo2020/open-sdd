/**
 * The Constitution: one model, two provenances.
 *
 * Objective 1 (brownfield) needs a DESCRIPTIVE constitution — the principles the existing code
 * already obeys, with the current stack declared an established fact, so an agent cannot silently
 * "modernize" what nobody asked it to modernize.
 *
 * Objective 2 (the Constitution proper, from the reference paper) needs a NORMATIVE constitution —
 * authored principles, amendment governance, and the authority a blocking verdict cites.
 *
 * Both are the same artifact with different provenance, so this module defines the model once.
 * A principle follows the six-field anatomy the reference architecture prescribes: identifier,
 * threat reference, imposition level, restriction, pattern, justification. A constitution where
 * everything is MUST imposes nothing, so the level is not decoration: descriptive principles must
 * carry evidence that the code already satisfies them, and anything aspirational has to travel as a
 * governed amendment with a migration plan instead of being asserted as fact.
 *
 * The CSDD paper fixes the anatomy as identifier · CWE reference · enforcement level · constraint ·
 * implementation pattern · rationale, so the CWE reference is a first-class field (`cweReference`)
 * and the rationale has to name the attack vector. `threatReference` stays for the non-CWE
 * references the other reference architecture uses (OWASP/ATLAS ids, ADR ids).
 *
 * The constitution is consumed by models as natural-language policy, which makes it an indirect
 * prompt-injection target: `validateConstitution` scans every principle for exception clauses a
 * user or an input controls and for instruction-override phrasing. The compliance traceability
 * matrix (CSDD §3.3/§4.2) maps each principle to the artifacts that satisfy it, which is what makes
 * audit, change-impact, gap detection and regression prevention answerable from this module.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const ID_PATTERN = /^[A-Z][A-Z0-9-]{2,}$/;
/** Canonical CWE reference form fixed by CSDD §3.2: `CWE-<número>`, case-insensitive on input. */
export const CWE_REFERENCE_PATTERN = /^CWE-\d+$/i;
/**
 * Canonicalise a CWE reference: case-insensitive input normalised to upper case, with the `CWE-`
 * prefix restored (`cwe 89` → `CWE-89`). Values that are not a CWE are upper-cased verbatim so a
 * non-conforming reference is reported by `validateConstitution` instead of silently rewritten.
 */
export const normalizeCweReference = (value) => {
    const trimmed = value.trim();
    if (!trimmed)
        return undefined;
    const match = trimmed.match(/^CWE[\s_-]*(\d+)$/i);
    return match ? `CWE-${match[1]}` : trimmed.toUpperCase();
};
const LEVELS = ['MUST', 'SHOULD', 'MAY'];
/**
 * Words that name a slot in a list instead of the concern a principle governs. An id built from one
 * of them plus a position (`P-01`, `RULE-3`, `PRINCIPLE-1`) is not citable: verdicts and the
 * traceability matrix cite ids, so an id must survive reordering and insertion.
 */
const POSITIONAL_ID_WORDS = new Set([
    'PRINCIPLE',
    'PRINCIPLES',
    'PRIN',
    'RULE',
    'RULES',
    'P',
    'ITEM',
    'ITEMS',
    'CLAUSE',
    'ARTICLE',
    'ART',
    'POINT',
    'CONSTRAINT',
    'CONSTRAINTS',
    'GENERIC',
    'REQ',
    'REQUIREMENT',
    'REQUIREMENTS',
    'NUM',
    'N',
    'ID',
    'ENTRY',
    'ROW',
    'LINE',
]);
/** True for auto-generated/positional ids such as `PRINCIPLE-1`, `P-01` or `RULE-3`. */
export const isPositionalIdentifier = (id) => {
    const match = id.trim().toUpperCase().match(/^([A-Z]+)-?(\d+)$/);
    return match ? POSITIONAL_ID_WORDS.has(match[1]) : false;
};
export const INJECTION_PATTERNS = [
    {
        code: 'INJ-IGNORE-PREVIOUS',
        pattern: /\bignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|preceding|above|foregoing)\b/i,
        justification: 'Anular instrucciones anteriores es la forma canónica de inyección indirecta: convierte el documento en una instrucción sustituible.',
    },
    {
        code: 'INJ-DISREGARD',
        pattern: /\bdisregard\s+(?:all\s+)?(?:the\s+)?(?:above|previous|prior|preceding|foregoing|instructions?|rules?)\b/i,
        justification: 'Descartar lo ya escrito permite que un contexto inyectado sustituya la política sin tocar el texto.',
    },
    {
        code: 'INJ-UNLESS-USER',
        pattern: /\bunless\s+(?:the\s+)?(?:user|users|caller|client|requester|input|request)s?\b/i,
        justification: 'Una excepción condicionada al usuario o a la entrada delega la política en quien ataca: el control pasa a ser opcional.',
    },
    {
        code: 'INJ-EXCEPT-INPUT',
        pattern: /\bexcept\s+(?:when\s+)?(?:the\s+)?(?:user|users|caller|client|requester|input|request|payload)s?\b/i,
        justification: 'Igual que "unless": una excepción controlable desde fuera anula la restricción en el caso que importa.',
    },
    {
        code: 'INJ-IF-USER-ASKS',
        pattern: /\bif\s+(?:the\s+)?(?:user|users|caller|client|requester)s?\s+(?:asks?|says?|requests?|demands?|wants?|specifies?|insists?)/i,
        justification: 'Convertir la restricción en una condición sobre la petición del usuario hace que el cumplimiento dependa del atacante.',
    },
    {
        code: 'INJ-AS-USER-REQUESTS',
        pattern: /\bas\s+(?:the\s+)?(?:user|users|caller|client|requester)s?\s+(?:requests?|wishes|prefers|desires|demands?|says?)/i,
        justification: 'Justificar la desviación por lo que pida el usuario es una cláusula de escape legible por el modelo.',
    },
    {
        code: 'INJ-OVERRIDE',
        pattern: /\boverrid(?:e|es|ing|den)\b/i,
        justification: 'El lenguaje de anulación ("override") autoriza a saltarse la restricción y es el objetivo declarado de la inyección de prompt.',
    },
    {
        code: 'INJ-BYPASS',
        pattern: /\bbypass(?:es|ed|ing)?\b/i,
        justification: 'Nombrar una vía de "bypass" en un principio convierte la prohibición en un procedimiento documentado.',
    },
    {
        code: 'INJ-HIDDEN-COMMENT',
        pattern: /<!--/,
        justification: 'Un comentario HTML no se renderiza pero sí se lee: es el canal oculto clásico para instrucciones escondidas en un documento de política.',
    },
];
/** Scan prose for the exported injection patterns. Returns one finding per matching pattern. */
export const detectInjection = (text) => {
    const findings = [];
    for (const { code, pattern, justification } of INJECTION_PATTERNS) {
        const match = text.match(pattern);
        if (match && match.index !== undefined) {
            const start = Math.max(0, match.index - 20);
            const end = Math.min(text.length, match.index + match[0].length + 20);
            findings.push({ code, excerpt: text.slice(start, end).trim(), justification });
        }
    }
    return findings;
};
/** A rationale has to be non-trivial enough to name a threat/attack vector, not to assert a taste. */
const MIN_RATIONALE_CHARS = 40;
const MIN_RATIONALE_WORDS = 6;
const rationaleNamesThreat = (justification) => {
    const text = justification.trim();
    if (text.length < MIN_RATIONALE_CHARS)
        return false;
    return text.split(/\s+/).filter(Boolean).length >= MIN_RATIONALE_WORDS;
};
/**
 * Validate a constitution.
 *
 * The rules that matter are the ones that stop the artifact from lying:
 *  - every principle needs all six anatomy fields, because a restriction without a pattern is an
 *    aspiration and a pattern without a justification is an arbitrary rule;
 *  - a DESCRIPTIVE principle must cite evidence, otherwise it is a wish recorded as a fact (the
 *    exact failure the reference architecture attributes to aspirational constitutions);
 *  - a normative principle is only in force through an approved amendment that carries a migration
 *    plan — otherwise it is a proposal wearing the clothes of authority.
 *
 * CSDD adds the rules that make the artifact trustworthy: a MUST names the vulnerability it
 * prevents, the rationale names the attack vector, and no principle contains a phrasing an injected
 * context could use to weaken it.
 */
export const validateConstitution = (constitution) => {
    const issues = [];
    const seen = new Set();
    if (constitution.provenance === 'normative' && constitution.establishedFacts.length > 0) {
        issues.push({
            severity: 'warning',
            code: 'PROVENANCE-FACTS',
            id: constitution.project,
            message: 'Una constitución normativa no declara hechos del código: los hechos establecidos son propios de la constitución descriptiva (brownfield).',
        });
    }
    for (const principle of constitution.principles) {
        if (!ID_PATTERN.test(principle.id)) {
            issues.push({
                severity: 'error',
                code: 'ID-FORMAT',
                id: principle.id || '(sin id)',
                message: 'El identificador debe ser estable y citable: mayúsculas, dígitos y guiones (p. ej. C-API-COMPAT).',
            });
        }
        else if (isPositionalIdentifier(principle.id)) {
            issues.push({
                severity: 'error',
                code: 'ID-POSITIONAL',
                id: principle.id,
                message: 'El identificador es posicional y no nombra la preocupación que gobierna: se cita en veredictos bloqueantes y en la matriz de trazabilidad (usa p. ej. SEC-002 o C-API-COMPAT).',
            });
        }
        if (seen.has(principle.id)) {
            issues.push({ severity: 'error', code: 'ID-DUPLICATE', id: principle.id, message: 'Identificador duplicado.' });
        }
        seen.add(principle.id);
        for (const field of ['title', 'restriction', 'pattern', 'justification']) {
            if (!principle[field] || principle[field].trim().length === 0) {
                issues.push({
                    severity: 'error',
                    code: 'FIELD-MISSING',
                    id: principle.id,
                    message: `Falta el campo "${field}": la anatomía de un principio son seis campos, no cuatro.`,
                });
            }
        }
        if (!LEVELS.includes(principle.level)) {
            issues.push({
                severity: 'error',
                code: 'LEVEL-INVALID',
                id: principle.id,
                message: 'El nivel de imposición debe ser MUST, SHOULD o MAY.',
            });
        }
        // Field 2 of the anatomy, in canonical form: `CWE-89`, never `cwe 89` or `CWE-abc`.
        if (principle.cweReference && !CWE_REFERENCE_PATTERN.test(principle.cweReference.trim())) {
            issues.push({
                severity: 'error',
                code: 'CWE-FORMAT',
                id: principle.id,
                message: `La referencia CWE debe tener la forma CWE-<número> (p. ej. CWE-89); se recibió "${principle.cweReference}".`,
            });
        }
        if (principle.threatReference &&
            !principle.cweReference &&
            CWE_REFERENCE_PATTERN.test(principle.threatReference.trim())) {
            issues.push({
                severity: 'warning',
                code: 'CWE-MIGRATE',
                id: principle.id,
                message: 'Una referencia CWE pertenece al campo cweReference; threatReference queda para referencias no-CWE (OWASP/ATLAS, ADR).',
            });
        }
        // CSDD §3.2/§6.1: a MUST names the vulnerability it prevents, or it is an arbitrary rule.
        //
        // A draft principle is a PROPOSAL, so the same defect is reported as a `warning` and never as an
        // `error`. The decision, and why: `error` is this validator's word for "this document cannot be
        // the authority a blocking verdict cites", and a draft is not the authority yet — flagging it
        // invalid would be a false accusation. Silence was the alternative and it is worse: the whole
        // point of the draft is that a named person ratifies it, and that person must see, before
        // ratifying, that this principle does not yet name the threat it prevents. So the finding stays
        // and only its severity changes — a draft is judged as a proposal, not as law.
        const draft = principle.draft === true;
        const draftNote = draft ? ' (borrador: se reporta para quien debe ratificarlo; todavía no es ley)' : '';
        if (principle.level === 'MUST' && !principle.cweReference && !principle.threatReference) {
            issues.push({
                severity: draft ? 'warning' : 'error',
                code: 'MUST-THREAT',
                id: principle.id,
                message: 'Un MUST debe nombrar la amenaza que previene (cweReference o threatReference): sin esa referencia la regla es arbitraria.' +
                    draftNote,
            });
        }
        if ((principle.level === 'MUST' || principle.level === 'SHOULD') &&
            Boolean(principle.justification) &&
            !rationaleNamesThreat(principle.justification)) {
            issues.push({
                severity: draft ? 'warning' : principle.level === 'MUST' ? 'error' : 'warning',
                code: 'RATIONALE-THREAT',
                id: principle.id,
                message: 'La justificación debe nombrar el vector de ataque que el principio previene: una razón de una línea no permite juzgar los casos límite.' +
                    draftNote,
            });
        }
        // The document is read by models: an exception a user or an input controls is an attack surface.
        const prose = [principle.title, principle.restriction, principle.pattern, principle.justification]
            .filter((part) => Boolean(part))
            .join('\n');
        for (const finding of detectInjection(prose)) {
            issues.push({
                severity: 'error',
                code: finding.code,
                id: principle.id,
                message: `Frase de inyección o excepción controlable desde fuera ("${finding.excerpt}"): ${finding.justification}`,
            });
        }
        if (principle.provenance === 'descriptive' && (principle.evidence ?? []).length === 0) {
            issues.push({
                severity: 'error',
                code: 'EVIDENCE-MISSING',
                id: principle.id,
                message: 'Un principio descriptivo sin evidencia es un deseo registrado como hecho. Aporta la prueba de que el código ya lo cumple o trámitalo como enmienda.',
            });
        }
        if (principle.provenance === 'normative' && principle.level === 'MUST' && !principle.amendment) {
            issues.push({
                severity: 'error',
                code: 'AMENDMENT-REQUIRED',
                id: principle.id,
                message: 'Un MUST normativo exige enmienda: la autoridad se introduce por un proceso gobernado, no por afirmación.',
            });
        }
        if (principle.amendment && principle.amendment.status === 'in-force' && !principle.amendment.migrationPlan) {
            issues.push({
                severity: 'error',
                code: 'AMENDMENT-MIGRATION-PLAN',
                id: principle.id,
                message: 'Una enmienda en vigor sin plan de migración no puede gobernar código existente.',
            });
        }
    }
    const declared = new Set(constitution.amendments.map((a) => a.id));
    for (const principle of constitution.principles) {
        const amendment = principle.amendment;
        if (amendment && !declared.has(amendment.id)) {
            issues.push({
                severity: 'error',
                code: 'AMENDMENT-UNKNOWN',
                id: principle.id,
                message: `La enmienda ${amendment.id} no figura en el registro de enmiendas.`,
            });
        }
    }
    // A constitution where everything is MUST imposes nothing: the level stops meaning anything.
    const levels = new Set(constitution.principles.map((p) => p.level));
    if (constitution.principles.length >= 4 && !levels.has('SHOULD') && !levels.has('MAY')) {
        issues.push({
            severity: 'warning',
            code: 'LEVEL-BALANCE',
            id: constitution.project,
            message: 'Todos los principios son MUST. Una constitución donde todo es MUST no impone nada: usa SHOULD/MAY donde la desviación sea defendible.',
        });
    }
    return issues;
};
/**
 * Principles currently in force: descriptive ones, plus normative ones with an in-force amendment.
 *
 * A DRAFT is excluded BY CONSTRUCTION, not by convention: a proposal nobody ratified has no
 * authority, so it must never resolve a citation, satisfy a gate or reach a verdict. The rule is
 * checked here — and not merely trusted to the callers — because this is the single place the
 * consumers of authority read: `specConstitution`'s pivot resolves a spec's citations against it and
 * `rigor` reports the citable authority from it. A draft that leaked into this list would turn "a
 * draft cannot be cited" into a comment instead of a property.
 *
 * `buildComplianceMatrix` is deliberately NOT filtered: it maps every principle, draft included, to
 * the artifacts that satisfy it, which is exactly what a ratifier wants to see before ratifying.
 */
export const principlesInForce = (constitution) => constitution.principles.filter((p) => p.draft !== true && (p.provenance === 'descriptive' || p.amendment?.status === 'in-force'));
const PATH_EXTENSIONS = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|kts|swift|php|cs|c|h|cpp|hpp|cc|sql|sh|bash|zsh|tf|tfvars|md|json|ya?ml|toml|ini|cfg|xml|html|css|scss|vue|svelte|dart|ex|exs|erl|hs|scala|clj|proto|graphql|gql)$/i;
/**
 * A path-shaped token has a separator or a source-file extension and no whitespace, so
 * `package manager: npm` (a fact) and `npm` (a command) are stored unresolvable but never dropped.
 */
const looksLikePath = (value) => {
    const token = value.trim();
    if (!token || /\s/.test(token))
        return false;
    return token.includes('/') || token.includes('\\') || PATH_EXTENSIONS.test(token);
};
/** Parse `file:line`, `file:14-24`, `file::symbol` and bare paths; keep anything else as-is. */
export const parseEvidenceArtifact = (reference, options = {}) => {
    const raw = reference.trim();
    const [pathFragment] = raw.split('::');
    const lineMatch = pathFragment.match(/^(.*?):(\d+)(?:\s*-\s*\d+)?$/);
    const pathPart = (lineMatch ? lineMatch[1] : pathFragment).trim();
    if (!looksLikePath(pathPart)) {
        return { reference: raw, resolvable: false };
    }
    const line = lineMatch ? Number(lineMatch[2]) : undefined;
    const resolvable = options.cwd ? existsSync(resolve(options.cwd, pathPart)) : true;
    return { reference: raw, file: pathPart, ...(line !== undefined ? { line } : {}), resolvable };
};
export const buildComplianceMatrix = (constitution, options = {}) => {
    const cwd = options.cwd ? resolve(options.cwd) : undefined;
    const entries = constitution.principles.map((principle) => {
        const artifacts = (principle.evidence ?? [])
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
            .map((entry) => parseEvidenceArtifact(entry, cwd ? { cwd } : {}));
        return {
            principleId: principle.id,
            level: principle.level,
            artifacts,
            covered: artifacts.some((artifact) => artifact.resolvable),
        };
    });
    const gaps = entries.filter((entry) => !entry.covered).map((entry) => entry.principleId);
    const covered = entries.filter((entry) => entry.covered).length;
    const coverage = entries.length === 0 ? 0 : covered / entries.length;
    const detail = `Matriz de trazabilidad: ${covered}/${entries.length} principios con artefacto resoluble ` +
        `(cobertura ${(coverage * 100).toFixed(0)}%).` +
        (gaps.length > 0 ? ` Huecos sin artefacto: ${gaps.join(', ')}.` : ' Sin huecos.');
    return { entries, gaps, coverage, detail };
};
/**
 * Change-impact query (the paper's second purpose for the matrix): given the paths a change
 * touches, which principles does it affect? Matching accepts an exact path, a suffix or a
 * repository-relative prefix so callers can pass git output directly.
 */
export const impactedPrinciples = (matrix, changedFiles) => {
    const normalize = (value) => value.trim().replace(/^\.\//, '').replace(/\\/g, '/');
    const changed = changedFiles.map(normalize).filter(Boolean);
    const impacted = [];
    for (const entry of matrix.entries) {
        const hit = entry.artifacts.some((artifact) => {
            if (!artifact.file)
                return false;
            const file = normalize(artifact.file);
            return changed.some((candidate) => candidate === file || candidate.endsWith(`/${file}`) || file.endsWith(`/${candidate}`));
        });
        if (hit && !impacted.includes(entry.principleId))
            impacted.push(entry.principleId);
    }
    return impacted;
};
/**
 * The authority a verdict cites (invariant I1: no blocking verdict may cite a rule nobody wrote).
 * A citation resolves to a principle id or to a requirement id; anything else is rejected.
 */
export const resolveAuthority = (constitution, citation) => {
    const principle = principlesInForce(constitution).find((p) => p.id === citation);
    if (principle) {
        return {
            known: true,
            kind: 'principle',
            detail: `${principle.id} (${principle.level}, ${principle.provenance})`,
        };
    }
    if (/^REQ-[A-Z0-9-]+$/i.test(citation)) {
        return {
            known: true,
            kind: 'requirement',
            detail: `${citation} — identificador de requisito (EARS/delta).`,
        };
    }
    return {
        known: false,
        kind: 'unknown',
        detail: `${citation} no resuelve a ningún principio ni requisito: un veredicto bloqueante no puede citar una regla que nadie escribió.`,
    };
};
/** Promote a proposed amendment to in-force. A migration plan is the price of admission. */
export const promoteAmendment = (constitution, amendmentId, migrationPlan, actor, at = new Date().toISOString()) => {
    const amendment = constitution.amendments.find((a) => a.id === amendmentId);
    if (!amendment) {
        throw new Error(`Enmienda desconocida: ${amendmentId}`);
    }
    if (!migrationPlan.trim()) {
        throw new Error('Una enmienda no entra en vigor sin plan de migración.');
    }
    if (!actor.trim()) {
        throw new Error('Una enmienda requiere un actor nombrado.');
    }
    const updated = {
        ...amendment,
        status: 'in-force',
        migrationPlan,
        approvals: [...(amendment.approvals ?? []), { actor, at }],
        updatedAt: at,
    };
    return {
        ...constitution,
        amendments: constitution.amendments.map((a) => (a.id === amendmentId ? updated : a)),
        principles: constitution.principles.map((p) => p.amendment?.id === amendmentId ? { ...p, amendment: updated } : p),
    };
};
// ---------------------------------------------------------------------------------------------
// Markdown round-trip: the constitution is a versioned artifact, not an in-memory type
// ---------------------------------------------------------------------------------------------
export const renderConstitution = (constitution) => {
    const lines = [];
    lines.push(`# Constitution — ${constitution.project}`);
    lines.push('');
    lines.push(`Provenance: ${constitution.provenance}`);
    if (constitution.generatedAt)
        lines.push(`Generated: ${constitution.generatedAt}`);
    lines.push('');
    if (constitution.establishedFacts.length > 0) {
        lines.push('## Established facts');
        lines.push('');
        for (const fact of constitution.establishedFacts)
            lines.push(`- ${fact}`);
        lines.push('');
    }
    lines.push('## Principles');
    for (const p of constitution.principles) {
        lines.push('');
        lines.push(`### ${p.id} — ${p.title}`);
        lines.push(`- Level: ${p.level}`);
        if (p.cweReference)
            lines.push(`- CWE: ${normalizeCweReference(p.cweReference)}`);
        if (p.threatReference)
            lines.push(`- Threat: ${p.threatReference}`);
        lines.push(`- Restriction: ${p.restriction}`);
        lines.push(`- Pattern: ${p.pattern}`);
        lines.push(`- Justification: ${p.justification}`);
        lines.push(`- Provenance: ${p.provenance}`);
        // Rendered only when set, so an in-force constitution keeps its previous byte-for-byte shape and
        // a reloaded draft stays a draft (`parseConstitution` reads the flag back).
        if (p.draft === true)
            lines.push('- Draft: true');
        if ((p.evidence ?? []).length > 0)
            lines.push(`- Evidence: ${(p.evidence ?? []).join('; ')}`);
        if (p.amendment)
            lines.push(`- Amendment: ${p.amendment.id} (${p.amendment.status})`);
    }
    lines.push('');
    if (constitution.amendments.length > 0) {
        lines.push('## Amendments');
        lines.push('');
        for (const a of constitution.amendments) {
            const attributes = [];
            if (a.migrationPlan)
                attributes.push(`plan: ${a.migrationPlan}`);
            if (a.rationale)
                attributes.push(`rationale: ${a.rationale}`);
            if (a.proposedBy)
                attributes.push(`by: ${a.proposedBy}`);
            if (a.updatedAt)
                attributes.push(`at: ${a.updatedAt}`);
            lines.push(`- ${a.id} — ${a.title} [${a.status}]${attributes.length > 0 ? ` · ${attributes.join(' · ')}` : ''}`);
        }
        lines.push('');
    }
    return lines.join('\n');
};
/** Parse the rendered form back. Used by tests and by the CLI to read a committed constitution. */
export const parseConstitution = (markdown) => {
    const lines = markdown.split('\n');
    const generatedAt = markdown.match(/^Generated:\s*(.+)$/m)?.[1]?.trim();
    const constitution = {
        project: (markdown.match(/^# Constitution — (.+)$/m)?.[1] ?? 'unknown').trim(),
        provenance: markdown.match(/^Provenance:\s*(descriptive|normative)$/m)?.[1] ?? 'normative',
        ...(generatedAt ? { generatedAt } : {}),
        establishedFacts: [],
        principles: [],
        amendments: [],
    };
    let section = 'none';
    let current = null;
    const push = () => {
        if (current)
            constitution.principles.push(current);
        current = null;
    };
    for (const raw of lines) {
        const line = raw.trimEnd();
        if (line === '## Established facts') {
            push();
            section = 'facts';
            continue;
        }
        if (line === '## Principles') {
            push();
            section = 'principles';
            continue;
        }
        if (line === '## Amendments') {
            push();
            section = 'amendments';
            continue;
        }
        if (section === 'facts' && line.startsWith('- ')) {
            constitution.establishedFacts.push(line.slice(2).trim());
            continue;
        }
        if (section === 'principles') {
            const heading = line.match(/^### ([A-Z][A-Z0-9-]{2,}) — (.+)$/);
            if (heading) {
                push();
                current = {
                    id: heading[1],
                    title: heading[2].trim(),
                    level: 'SHOULD',
                    restriction: '',
                    pattern: '',
                    justification: '',
                    provenance: constitution.provenance,
                };
                continue;
            }
            const field = line.match(/^- (Level|CWE|Threat|Restriction|Pattern|Justification|Provenance|Draft|Evidence|Amendment):\s*(.*)$/);
            if (field && current) {
                const [, key, value] = field;
                if (key === 'Level')
                    current.level = value.trim();
                else if (key === 'CWE') {
                    const cwe = normalizeCweReference(value);
                    if (cwe)
                        current.cweReference = cwe;
                }
                else if (key === 'Threat')
                    current.threatReference = value.trim();
                else if (key === 'Restriction')
                    current.restriction = value.trim();
                else if (key === 'Pattern')
                    current.pattern = value.trim();
                else if (key === 'Justification')
                    current.justification = value.trim();
                else if (key === 'Provenance')
                    current.provenance = value.trim();
                // Only `true` sets the flag: leaving it `undefined` for every other principle keeps the
                // round-trip of an in-force document byte-identical to what it was before drafts existed.
                else if (key === 'Draft') {
                    if (value.trim().toLowerCase() === 'true')
                        current.draft = true;
                }
                else if (key === 'Evidence')
                    current.evidence = value.split(';').map((v) => v.trim()).filter(Boolean);
                else if (key === 'Amendment') {
                    const parsed = value.match(/^([A-Z0-9-]+)\s*\(([a-z-]+)\)$/);
                    if (parsed) {
                        current.amendment = {
                            id: parsed[1],
                            title: '',
                            proposedBy: '',
                            status: parsed[2],
                        };
                    }
                }
            }
            continue;
        }
        if (section === 'amendments' && line.startsWith('- ')) {
            const [head, ...attributes] = line.slice(2).split(' · ');
            const parsed = head.match(/^([A-Z0-9-]+) — (.*?)\s*\[([a-z-]+)\]$/);
            if (parsed) {
                const amendment = {
                    id: parsed[1],
                    title: parsed[2],
                    proposedBy: '',
                    status: parsed[3],
                };
                for (const attribute of attributes) {
                    const pair = attribute.match(/^(plan|rationale|by|at):\s*(.+)$/);
                    if (!pair)
                        continue;
                    if (pair[1] === 'plan')
                        amendment.migrationPlan = pair[2];
                    else if (pair[1] === 'rationale')
                        amendment.rationale = pair[2];
                    else if (pair[1] === 'by')
                        amendment.proposedBy = pair[2];
                    else
                        amendment.updatedAt = pair[2];
                }
                constitution.amendments.push(amendment);
            }
        }
    }
    push();
    // Fidelity: a principle only rendered `Amendment: <id> (<status>)`, so merge the full record the
    // amendments section carries (migration plan, proposer, timestamp) back into it.
    for (const principle of constitution.principles) {
        if (!principle.amendment)
            continue;
        const declared = constitution.amendments.find((a) => a.id === principle.amendment?.id);
        if (declared)
            principle.amendment = { ...declared, status: principle.amendment.status };
    }
    return constitution;
};
