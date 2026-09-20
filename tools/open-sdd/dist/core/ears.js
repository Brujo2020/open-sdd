/**
 * EARS: the grammar that makes a requirement checkable (§4.6, Table 12).
 *
 * EARS is a restricted grammar for functional requirements: five sentence templates, each of
 * which names its own trigger condition. It is not a modelling language and produces no
 * artifact beyond the phrase — its entire contribution is making the ABSENCE of a trigger
 * condition visible.
 *
 * The paper's own limit is stated here rather than buried: EARS disciplines the STATEMENT of a
 * requirement, not its CORRECTNESS. A perfectly formed requirement can still specify the wrong
 * behaviour, so this module feeds gate G1 (clarity) and cannot substitute for judgement.
 */
export const EARS_TEMPLATES = [
    {
        pattern: 'ubiquitous',
        template: 'The <system> shall <response>.',
        example: 'The gateway shall expose a health endpoint returning HTTP 200.',
        keyword: null,
    },
    {
        pattern: 'event-driven',
        template: 'WHEN <trigger>, the <system> shall <response>.',
        example: 'WHEN the payment service returns 5xx, the gateway shall increment the failure counter.',
        keyword: 'WHEN',
    },
    {
        pattern: 'state-driven',
        template: 'WHILE <state>, the <system> shall <response>.',
        example: 'WHILE the circuit is open, the gateway shall return 503 without forwarding.',
        keyword: 'WHILE',
    },
    {
        pattern: 'optional',
        template: 'WHERE <feature>, the <system> shall <response>.',
        example: 'WHERE the client supplies a request ID, the gateway shall propagate it downstream.',
        keyword: 'WHERE',
    },
    {
        pattern: 'unwanted',
        template: 'IF <condition>, THEN the <system> shall <response>.',
        example: 'IF the half-open probe fails, THEN the gateway shall reopen the circuit and reset the timer.',
        keyword: 'IF',
    },
];
/** Keep the fixed trigger keywords and `shall` in English; only the variable parts are localized. */
const KEYWORD_PATTERNS = [
    { pattern: 'event-driven', re: /^\s*WHEN\b/i },
    { pattern: 'state-driven', re: /^\s*WHILE\b/i },
    { pattern: 'optional', re: /^\s*WHERE\b/i },
    { pattern: 'unwanted', re: /^\s*IF\b/i },
];
/** Ambiguous terms that make a requirement unfalsifiable. */
const VAGUE_TERMS = [
    'apropiado',
    'adecuado',
    'rápido',
    'rapido',
    'óptimo',
    'optimo',
    'eficiente',
    // NOTE: 'flexible' was removed. It is a domain term here (the default governance regime), and
    // flagging the architecture's own vocabulary is how a linter loses its readers.
    'robusto',
    'user-friendly',
    'fácil de usar',
    'facil de usar',
    'etc',
    'y/o',
    'approximately',
    'as needed',
    'si es necesario',
    'cuando sea posible',
];
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Whole-token containment. Plain `String.includes` fired inside ordinary words — `etc` matched
 * `fetch`, so a perfectly good requirement was flagged as vague and the signal was worthless.
 */
export const containsVagueTerm = (text, term) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}([^\\p{L}\\p{N}]|$)`, 'iu').test(text);
/**
 * Validate one functional requirement against the five templates.
 *
 * The diagnostic rule is the paper's: "un requisito que no encaja en ninguna es casi siempre
 * ambiguo, o dos requisitos vestidos de uno — el defecto que llega a un agente como licencia
 * para inventar." So a non-match is an error, not a warning.
 */
export const validateEarsRequirement = (text) => {
    const issues = [];
    const trimmed = text.trim();
    const matched = KEYWORD_PATTERNS.filter((k) => k.re.test(trimmed));
    const pattern = matched.length === 0 ? 'ubiquitous' : matched[0].pattern;
    /**
     * Compound trigger detection. Every trigger keyword is anchored at the start of the sentence,
     * so at most one can match there — which made an earlier check dead code. The rule that works
     * looks at CLAUSE STARTS: the trigger belongs before the response, and a second trigger begins
     * a new clause ("WHEN X, WHILE Y, ..."). Counting bare keyword occurrences instead would flag
     * ordinary English such as "passes where the text declared an absence" and turn the control
     * into a generator of false positives.
     */
    const lower = trimmed.toLowerCase();
    const shallIndex = lower.search(/\bshall\b/);
    const triggerClause = shallIndex >= 0 ? trimmed.slice(0, shallIndex) : trimmed;
    const triggerCount = triggerClause
        .split(/[,;]/)
        .filter((clause) => /^\s*(?:WHEN|WHILE|WHERE|IF)\b/i.test(clause)).length;
    if (triggerCount > 1) {
        issues.push({
            code: 'MULTIPLE_TEMPLATES',
            message: 'Más de un patrón EARS en la misma condición de disparo: exactamente una plantilla por requisito funcional.',
        });
    }
    if (!/\bshall\b/i.test(trimmed)) {
        issues.push({
            code: 'NO_SHALL',
            message: 'Falta el operador obligatorio "shall": sin él no hay requisito comprobable.',
        });
    }
    if (pattern === 'unwanted' && !/\bthen\b/i.test(trimmed)) {
        issues.push({
            code: 'MISSING_THEN',
            message: 'El patrón no deseado se escribe IF <condición>, THEN <respuesta>.',
        });
    }
    // A requirement without a trigger matching any template is the licensed-to-invent defect.
    if (matched.length === 0 && /\bshall\b/i.test(trimmed)) {
        const looksAmbiguous = VAGUE_TERMS.some((t) => containsVagueTerm(trimmed, t));
        if (looksAmbiguous) {
            issues.push({
                code: 'NO_TEMPLATE_MATCH',
                message: 'No encaja en ninguna plantilla y contiene términos ambiguos: casi siempre es un requisito ambiguo, o dos requisitos vestidos de uno.',
            });
        }
    }
    /**
     * Compound-requirement heuristic: a single trigger followed by more than one `shall`, or an
     * explicit conjunction of independent responses. One trigger condition per requirement.
     */
    const shallCount = (trimmed.match(/\bshall\b/gi) ?? []).length;
    if (shallCount > 1) {
        issues.push({
            code: 'COMPOUND_REQUIREMENT',
            message: `${shallCount} respuestas "shall" en un requisito: probablemente son ${shallCount} requisitos. Divide para que cada uno tenga una única condición de disparo.`,
        });
    }
    const vagueFound = VAGUE_TERMS.filter((t) => containsVagueTerm(trimmed, t));
    if (vagueFound.length > 0) {
        issues.push({
            code: 'VAGUE_TERM',
            message: `Término(s) no comprobable(s): ${vagueFound.join(', ')}.`,
        });
    }
    // Response after `shall` must not be empty.
    const shallIdx = lower.indexOf('shall');
    if (shallIdx >= 0 && trimmed.slice(shallIdx + 5).replace(/[.\s]/g, '').length === 0) {
        issues.push({ code: 'EMPTY_RESPONSE', message: 'La respuesta tras "shall" está vacía.' });
    }
    return { text: trimmed, pattern, conforms: issues.length === 0, issues };
};
/** Report over a whole requirements document, including which patterns nobody used. */
export const validateRequirements = (texts) => {
    const verdicts = texts.map(validateEarsRequirement);
    const byPattern = {
        ubiquitous: 0,
        'event-driven': 0,
        'state-driven': 0,
        optional: 0,
        unwanted: 0,
    };
    for (const v of verdicts)
        if (v.pattern)
            byPattern[v.pattern] += 1;
    return {
        total: verdicts.length,
        conforming: verdicts.filter((v) => v.conforms).length,
        byPattern,
        uncoveredPatterns: Object.keys(byPattern).filter((p) => byPattern[p] === 0),
        verdicts,
    };
};
/**
 * IF...THEN is the pattern teams omit, and it is the first-class home of NEGATIVE requirements.
 * Reporting its absence is how a spec stops being silently optimistic.
 */
export const negativeRequirementGap = (report) => report.byPattern.unwanted === 0
    ? 'Ningún requisito de comportamiento no deseado (IF...THEN): es el patrón que los equipos omiten y el único lugar de primera clase para requisitos negativos.'
    : null;
export const EARS_LIMIT = 'EARS disciplina el enunciado de un requisito, no su corrección: un requisito impecable puede especificar el comportamiento equivocado.';
