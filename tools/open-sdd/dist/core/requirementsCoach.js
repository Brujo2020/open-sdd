/**
 * Requirements coach (workstream W3).
 *
 * Deterministic checks over a spec's artifacts, seeded from
 * `docs/guides/requirements-quality-catalog.md` (42 checks, 8 families, tiers S1–S4). The catalogue
 * is another workstream's artifact; the checks here are TypeScript so the deterministic core runs
 * with no catalogue, no model, no network.
 *
 * Three rules shape the module:
 *
 *   1. **Dependency injection.** `reviewRequirements` receives `entries` (the standards catalogue)
 *      and a `runner: StandardRunner`. Tests pass a double, so nothing here imports the standards
 *      engine. Entries the coach implements itself run from TypeScript; every other catalogue entry
 *      is delegated to the injected runner.
 *   2. **No dead ends (tenet 2, REQ-RQC-003).** Every finding carries at least one remedy or one
 *      `question`. A defect that needs a datum the tool does not have — an undefined actor, an
 *      undecided threshold, a term used two ways, a doubtful necessity — abstains with a `question`
 *      naming that datum instead of guessing a rewrite.
 *   3. **Spec content is untrusted data (REQ-RQC-010).** `AI-002` flags instruction-shaped content
 *      and invisible characters, marks them for human escalation, and the module never interprets
 *      them as instructions. Nothing below reads a spec artifact control-flow wise.
 *
 * A check that cannot inspect its artifact is reported in `skipped` with a reason — never counted in
 * `checked` as a pass. The coach reports what passed and what was adjudicated; it never states that
 * a specification is correct (REQ-RQC-011).
 */
/** Where an artefact's kind comes from. Directory layout is the tool's, not the document's, job. */
export const classifyArtifact = (file) => {
    const base = file.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? file.toLowerCase();
    if (/requirement|requisito/.test(base))
        return 'requirements';
    if (/task|tarea/.test(base))
        return 'tasks';
    if (/plan|design|dise[nñ]o/.test(base))
        return 'plan';
    if (/test|spec|checklist|contract/.test(base))
        return 'test';
    return 'other';
};
/** A finding the model layer produced is reported, never load-bearing (REQ-RQC-002). */
export const asModelFinding = (finding) => ({
    ...finding,
    id: `MODEL-${finding.standardId}-${finding.line}-${finding.column}`,
    instrument: 'model',
    family: finding.standardId.split('-')[0] ?? 'MODEL',
    defaultSeverity: finding.severity,
    mayBlock: false,
    basis: 'model critique: advisory by construction (measured profile 47 % detection / 11 % false-flag)',
});
/** A deterministic or catalogue finding may block; a model finding never can. */
export const isBlockingFinding = (finding) => finding.instrument !== 'model' && (finding.severity === 'error' || finding.severity === 'warning');
const TIER_SEVERITY = {
    S1: 'error',
    S2: 'warning',
    S3: 'info',
    S4: 'info',
};
/** S1/S2 are the tiers a deterministic check may gate on (REQ-RQC-002). */
export const mayBlockTier = (tier) => tier === 'S1' || tier === 'S2';
/**
 * Measured per-smell precision from the catalogue's §1 (Femmer et al.). Stated on the finding when
 * recorded, so a reader can calibrate trust instead of reading every warning as a verdict.
 */
const MEASURED_PRECISION = {
    'AMB-001': 0.96,
    'AMB-005': 0.48,
    'AMB-006': 0.49,
    'AMB-007': 0.26,
    'SIN-007': 0.33,
};
const BASIS = {
    'EARS-001': 'INCOSE R1; ISO/IEC/IEEE 29148 §5.2.4',
    'EARS-002': 'RFC 2119/8174 (only the uppercase key words are normative)',
    'EARS-003': 'INCOSE R3; ISO/IEC/IEEE 29148 §5.2.4',
    'EARS-006': 'INCOSE R27; ISO/IEC/IEEE 29148 §5.2.4',
    'EARS-007': 'INCOSE R3; ISO/IEC/IEEE 29148 §5.2.4',
    'EARS-008': 'ISO/IEC/IEEE 29148 §5.2.8; NASA SEH',
    'AMB-001': 'INCOSE R7; ISO/IEC/IEEE 29148 §5.2.7',
    'AMB-002': 'INCOSE R34; NASA ARM fuzzy words',
    'AMB-003': 'INCOSE R8; ISO/IEC/IEEE 29148 §5.2.7',
    'AMB-004': 'INCOSE R9; ISO/IEC/IEEE 29148 §5.2.7',
    'AMB-005': 'ISO/IEC/IEEE 29148 §5.2.7; Femmer et al. (comparative P 0.48)',
    'AMB-007': 'INCOSE R24; Femmer et al. (vague pronoun P 0.26)',
    'AMB-008': 'INCOSE R35',
    'AMB-009': 'INCOSE R15, R17 (exceptions: SI units and ranges)',
    'AMB-010': 'INCOSE R6',
    'AMB-012': 'INCOSE R34',
    'AMB-013': 'ISO/IEC/IEEE 29148 §5.2.6; INCOSE C4; IEEE 830 §4.3.3.1',
    'SIN-001': 'ISO/IEC/IEEE 29148 §5.2.5; INCOSE R18/R19',
    'SIN-003': 'INCOSE R18',
    'SIN-007': 'INCOSE R16; ISO/IEC/IEEE 29148 §5.2.7 (negation inside a condition is not a defect)',
    'SIN-008': 'INCOSE R26, R32; Google SRE "avoid absolutes"',
    'VER-001': 'ISO/IEC/IEEE 29148 §5.2.5; IEEE 830',
    'VER-006': 'circular acceptance criterion: unfalsifiable by construction',
    'SET-003': 'INCOSE R36; IEEE 830 third conflict type',
    'SET-005': 'ISO/IEC/IEEE 29148 §6.4.3.5; NASA gold-plating rule',
    'SET-006': 'ISO/IEC/IEEE 29148 §6.4.3.5; 21 CFR 820.30(f)',
    'TRC-002': 'ISO/IEC/IEEE 29148 §6.4.3.5; Doorstop ERROR level',
    'NFR-002': 'Google SRE ch. 4 (an SLO says how it is measured)',
    'NFR-003': 'Google SRE availability table (nines need a window)',
    'AI-002': 'OWASP LLM01; NIST indirect prompt injection (resource control)',
    'AI-003': 'Gherkin / better Gherkin: an observable Then',
};
const ok = (matches = []) => ({ matches });
const skip = (reason) => ({ skipReason: reason });
// ---------------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------------
const findAll = (text, re) => {
    const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
    return Array.from(text.matchAll(new RegExp(re.source, flags)));
};
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const positionAt = (text, offset) => {
    const clamped = Math.max(0, Math.min(offset, text.length));
    let line = 1;
    let lineStart = 0;
    for (let i = 0; i < clamped; i += 1) {
        if (text.charCodeAt(i) === 10) {
            line += 1;
            lineStart = i + 1;
        }
    }
    return { line, column: clamped - lineStart + 1 };
};
const INVISIBLE_NAMES = {
    0x00ad: 'soft hyphen',
    0x180e: 'mongolian vowel separator',
    0x200b: 'zero width space',
    0x200c: 'zero width non-joiner',
    0x200d: 'zero width joiner',
    0x200e: 'left-to-right mark',
    0x200f: 'right-to-left mark',
    0x202a: 'left-to-right embedding',
    0x202b: 'right-to-left embedding',
    0x202c: 'pop directional formatting',
    0x202d: 'left-to-right override',
    0x202e: 'right-to-left override',
    0x2060: 'word joiner',
    0x2061: 'function application',
    0x2062: 'invisible times',
    0x2063: 'invisible separator',
    0x2064: 'invisible plus',
    0x2066: 'left-to-right isolate',
    0x2067: 'right-to-left isolate',
    0x2068: 'first strong isolate',
    0x2069: 'pop directional isolate',
    0xfeff: 'zero width no-break space',
};
const INVISIBLE_RE = /[\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
/** Collapse whitespace and render invisible characters as `\uXXXX` so a span stays printable. */
export const describeSpan = (text, offset, length) => {
    const raw = text.slice(offset, offset + Math.max(length, 1));
    const rendered = raw
        .replace(/[\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
        .replace(/\s+/g, ' ')
        .trim();
    return rendered.length > 160 ? `${rendered.slice(0, 157)}...` : rendered;
};
/**
 * Is `index` inside an `If`/`when`/`while`/`where`/`unless` condition? The catalogue's guard: a
 * negation inside a condition is not `SIN-007`, and a comparative that is a legitimate condition is
 * not `AMB-005`.
 */
const insideCondition = (text, index) => {
    const prefix = text.slice(0, index);
    const re = /\b(if|when|while|where|unless)\b/gi;
    let last = null;
    let m;
    while ((m = re.exec(prefix)) !== null)
        last = m;
    if (!last)
        return false;
    const tail = prefix.slice(last.index + last[0].length);
    return !/[,;]/.test(tail) && !/\bthen\b/i.test(tail);
};
const hasQuantity = (text) => /\d|[≤≥<>]|\b\d+(?:\.\d+)?\s*%/.test(text);
// ---------------------------------------------------------------------------------------------
// Artifact extraction
// ---------------------------------------------------------------------------------------------
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const REQ_ID_RE = /\bREQ-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-\d{1,4}\b/;
const ID_TOKEN_RE = /\b(?:REQ|TEST|TASK|NEED|BR|GOAL|OBJ)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-\d{1,4}\b/g;
const METADATA_PREFIX_RE = /^(?:\*\*)?(?:constitution|objective|out of scope|fuera de alcance|note|notes|notas|rationale|source|parent|tasks?|tests?|verification|evidence|acceptance criteria?|criterios de aceptaci[oó]n|background|context|assumptions?|supuestos?|references?|glossary|glosario)\b/i;
const cleanInline = (s) => s
    .replace(/\*\*/g, '')
    .replace(/^`|`$/g, '')
    .trim();
/**
 * Extract the statements a requirement check can judge. The primary shape is a `- Statement:` bullet
 * (or any bullet under a `### REQ-…` heading) inside the document's requirements region; a document
 * with no such structure falls back to its prose lines so a bare sentence is still checkable.
 */
export const extractStatements = (text, kind) => {
    const statements = [];
    const lines = text.split(/\r?\n/);
    const offsets = [];
    let cursor = 0;
    for (const line of lines) {
        offsets.push(cursor);
        cursor += line.length + 1;
    }
    let inFence = false;
    let inRegion = true;
    let regionSeen = false;
    let currentReqId = null;
    let currentSection = null;
    const pushStatement = (rawLine, lineStart, lineNumber, contentStart, body) => {
        const trimmed = body.trim();
        if (!trimmed)
            return;
        const localOffset = rawLine.indexOf(trimmed, contentStart);
        const textOffset = lineStart + (localOffset >= 0 ? localOffset : contentStart);
        statements.push({
            text: trimmed,
            raw: rawLine,
            textOffset,
            ...positionAt(text, textOffset),
            requirementId: currentReqId,
            section: currentSection,
            isAcceptanceCriterion: /acceptance|gherkin|scenario|criteri/i.test(currentSection ?? '') || /^(?:and\s+)?then\b/i.test(trimmed),
        });
    };
    for (let i = 0; i < lines.length; i += 1) {
        const rawLine = lines[i];
        const lineStart = offsets[i];
        const lineNumber = i + 1;
        if (/^\s*```/.test(rawLine)) {
            inFence = !inFence;
            continue;
        }
        if (inFence)
            continue;
        const heading = rawLine.match(HEADING_RE);
        if (heading) {
            const level = heading[1].length;
            const title = cleanInline(heading[2]);
            if (level <= 2 && /\b(requirements?|requisitos?)\b/i.test(title) && !/out of scope/i.test(title)) {
                inRegion = true;
                regionSeen = true;
            }
            else if (level <= 2 &&
                /\b(out of scope|fuera de alcance|non-goals?|notes?|notas?|assumptions?|supuestos?|background|context)\b/i.test(title)) {
                inRegion = false;
            }
            const idMatch = title.match(new RegExp(`^${REQ_ID_RE.source}`));
            if (idMatch)
                currentReqId = idMatch[0];
            currentSection = title;
            continue;
        }
        const bullet = rawLine.match(BULLET_RE);
        if (!bullet)
            continue;
        const contentStart = rawLine.indexOf(bullet[2]);
        const content = bullet[2].trim();
        if (/^\[[ xX-]\]/.test(content))
            continue;
        const statementPrefix = content.match(/^statement:\s*(.*)$/i);
        const inReqSection = currentReqId !== null;
        const isCandidate = statementPrefix !== null ||
            (inRegion &&
                inReqSection &&
                !METADATA_PREFIX_RE.test(content) &&
                !/^_/.test(content)) ||
            (inRegion &&
                !METADATA_PREFIX_RE.test(content) &&
                !/^_/.test(content) &&
                (/\bshall\b/i.test(content) || /^(the|when|while|where|if|upon|after|before)\b/i.test(content)));
        if (!isCandidate)
            continue;
        const body = statementPrefix ? statementPrefix[1] : content;
        pushStatement(rawLine, lineStart, lineNumber, contentStart, body);
    }
    if (statements.length === 0 && kind === 'requirements') {
        // Bare-sentence fallback: no bullets, no `REQ-` headings. Every non-trivial prose line is a
        // candidate, minus headings, tables, quotes, metadata and fences.
        let fallbackReqId = null;
        let fallbackSection = null;
        inFence = false;
        for (let i = 0; i < lines.length; i += 1) {
            const rawLine = lines[i];
            const trimmed = rawLine.trim();
            if (/^\s*```/.test(rawLine)) {
                inFence = !inFence;
                continue;
            }
            if (inFence)
                continue;
            const heading = rawLine.match(HEADING_RE);
            if (heading) {
                fallbackSection = cleanInline(heading[2]);
                const idMatch = fallbackSection.match(REQ_ID_RE);
                fallbackReqId = idMatch ? idMatch[0] : fallbackReqId;
                continue;
            }
            if (!trimmed || trimmed.length < 12)
                continue;
            if (/^[|>_*]/.test(trimmed))
                continue;
            if (/^(?:[-*+]|\d+[.)])\s*\[[ xX-]\]/.test(trimmed))
                continue;
            if (METADATA_PREFIX_RE.test(trimmed))
                continue;
            if (!/\s/.test(trimmed))
                continue;
            if (!/\bshall\b/i.test(trimmed) && !/^(the|when|while|where|if|upon|after|before)\b/i.test(trimmed))
                continue;
            const textOffset = offsets[i] + rawLine.indexOf(trimmed);
            statements.push({
                text: trimmed,
                raw: rawLine,
                textOffset,
                ...positionAt(text, textOffset),
                requirementId: fallbackReqId,
                section: fallbackSection,
                isAcceptanceCriterion: /acceptance|criteri/i.test(fallbackSection ?? '') || /^(?:and\s+)?then\b/i.test(trimmed),
            });
        }
    }
    return statements;
};
/**
 * Requirements of one artifact keyed by identifier, with their line range. `specReview` diffs these
 * across refs; a statement outside any identified requirement becomes `REQ-UNIDENTIFIED-<n>` so it
 * still reaches the review page instead of vanishing.
 */
export const parseRequirements = (file, markdown) => {
    const facts = collectFacts(file, markdown, classifyArtifact(file));
    const headingCount = facts.requirementSections.length;
    const totalLines = markdown.split(/\r?\n/).length;
    const out = [];
    for (let i = 0; i < headingCount; i += 1) {
        const section = facts.requirementSections[i];
        const next = facts.requirementSections[i + 1];
        const owned = facts.statements.filter((s) => s.requirementId === section.id &&
            s.textOffset >= section.offset &&
            (!next || s.textOffset < next.offset));
        out.push({
            id: section.id,
            title: section.title,
            file,
            text: owned.map((s) => s.text).join(' ') || section.title,
            line: section.line,
            endLine: next ? next.line - 1 : totalLines,
            statements: owned,
        });
    }
    let orphanIndex = 0;
    for (const stmt of facts.statements) {
        if (stmt.requirementId !== null)
            continue;
        orphanIndex += 1;
        out.push({
            id: `REQ-UNIDENTIFIED-${String(orphanIndex).padStart(3, '0')}`,
            title: stmt.text.slice(0, 60),
            file,
            text: stmt.text,
            line: stmt.line,
            endLine: stmt.line,
            statements: [stmt],
        });
    }
    return out;
};
const collectFacts = (file, text, kind) => {
    const statements = extractStatements(text, kind);
    const requirementIds = [];
    const requirementSections = [];
    const headingRe = /^(#{1,6})\s+(.*)$/gm;
    let m;
    while ((m = headingRe.exec(text)) !== null) {
        const title = cleanInline(m[2]);
        const idMatch = title.match(/^(REQ-[A-Za-z0-9-]+)/);
        if (!idMatch)
            continue;
        const id = idMatch[1];
        if (!requirementIds.includes(id))
            requirementIds.push(id);
        const sectionStart = m.index + m[0].length;
        const rest = text.slice(sectionStart);
        const nextHeading = rest.search(/^#{1,6}\s/m);
        const sectionText = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
        requirementSections.push({
            id,
            title,
            offset: m.index + m[0].indexOf(m[2]),
            ...positionAt(text, m.index + m[0].indexOf(m[2])),
            text: sectionText,
        });
    }
    // Definitions: an id that starts a heading, a checkbox item or an explicit `id:` field.
    const definitions = new Set();
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        const defMatch = trimmed.match(/^#{1,6}\s+(REQ-[A-Za-z0-9-]+)/) ??
            trimmed.match(/^[-*+]\s*\[[ xX-]\]\s*(REQ-[A-Za-z0-9-]+|TEST-[A-Za-z0-9-]+|TASK-[A-Za-z0-9-]+)/) ??
            trimmed.match(/^`?(REQ-[A-Za-z0-9-]+|TEST-[A-Za-z0-9-]+|TASK-[A-Za-z0-9-]+)`?\s*[:—]/);
        if (defMatch)
            definitions.add(defMatch[1]);
    }
    const references = [];
    for (const match of findAll(text, ID_TOKEN_RE)) {
        const offset = match.index ?? 0;
        references.push({
            id: match[0],
            offset,
            ...positionAt(text, offset),
            isDefinition: definitions.has(match[0]),
        });
    }
    return { file, kind, text, statements, requirementIds, requirementSections, references };
};
const hasUpstreamArtifact = (facts) => facts.some((f) => f.kind !== 'requirements' && /(brief|roadmap|needs?|goals?|vision|scope)/i.test(f.file));
const hasDownstreamArtifact = (facts) => facts.some((f) => f.kind === 'tasks' || f.kind === 'plan' || (f.kind === 'test' && /(task|test|check|contract)/i.test(f.file)));
const PARENT_POINTER_RE = /\b(parent|source|derives?\s+from|traces?\s+(?:to|from)|satisfies|implements|need|origin|rationale)\b\s*[:=]/i;
// ---------------------------------------------------------------------------------------------
// Statement checks
// ---------------------------------------------------------------------------------------------
const remedy = (text, grade = 'maybe-incorrect', note) => note ? { grade, text, note } : { grade, text };
const makeRule = (id, family, title, tier, appliesTo, run) => ({ id, family, title, tier, appliesTo, run });
/** Run a per-statement rule and collect matches at their absolute positions. */
const perStatement = (ctx, probe) => {
    if (ctx.statements.length === 0)
        return skip('no requirement statement could be extracted from the artifact');
    const matches = [];
    for (const stmt of ctx.statements) {
        for (const match of probe(stmt, ctx))
            matches.push(match);
    }
    return ok(matches);
};
const rel = (stmt, index, length, rest) => ({ offset: stmt.textOffset + index, length, ...rest });
const lineOffsets = (text) => {
    const out = [];
    let cursor = 0;
    for (const line of text.split(/\r?\n/)) {
        out.push(cursor);
        cursor += line.length + 1;
    }
    return out;
};
// --- EARS family -------------------------------------------------------------------------------
const EARS_001 = makeRule('EARS-001', 'EARS', 'no obligation modal', 'S1', ['requirements'], (ctx) => perStatement(ctx, (stmt) => {
    if (/\bshall\b/i.test(stmt.text))
        return [];
    if (/\b(must|should|will|may|might|can|could|would)\b/i.test(stmt.text))
        return [];
    return [
        rel(stmt, 0, stmt.text.length, {
            message: 'no obligation modal (`shall`): the statement describes behaviour instead of requiring it (`EARS-001`)',
            remedies: [remedy('rewrite as `The <System> shall <response>.`, naming the system and the observable response')],
        }),
    ];
}));
const NON_SHALL_MODAL_RE = /\b(must|should|will|may|might|can|could|would)\b/gi;
const EARS_002 = makeRule('EARS-002', 'EARS', 'non-shall modal carrying an obligation', 'S2', ['requirements'], (ctx) => perStatement(ctx, (stmt) => findAll(stmt.text, NON_SHALL_MODAL_RE).map((m) => rel(stmt, m.index ?? 0, m[0].length, {
    message: `obligation carried by \`${m[0].toLowerCase()}\` instead of the house modal \`shall\` (\`EARS-002\`)`,
    remedies: [remedy(`replace \`${m[0]}\` with \`shall\``)],
}))));
const EARS_003 = makeRule('EARS-003', 'EARS', 'missing subject or empty response', 'S2', ['requirements'], (ctx) => perStatement(ctx, (stmt) => {
    const shallIdx = stmt.text.search(/\bshall\b/i);
    if (shallIdx < 0)
        return [];
    const prefix = stmt.text.slice(0, shallIdx);
    const suffix = stmt.text.slice(shallIdx + 5);
    const withoutTrigger = prefix.replace(/^\s*(?:when|while|where|if|upon|after|before)\b/i, '');
    const lastChunk = withoutTrigger.includes(',')
        ? withoutTrigger.slice(withoutTrigger.lastIndexOf(',') + 1)
        : withoutTrigger;
    const hasSubject = /[\p{L}]{2,}/u.test(lastChunk.trim());
    const emptyResponse = suffix.replace(/[\s.,;:]/g, '').length < 2;
    if (hasSubject && !emptyResponse)
        return [];
    const remedies = emptyResponse
        ? [remedy('state the response after `shall`: what the system does, with its bound')]
        : [];
    return [
        rel(stmt, shallIdx, 5, {
            message: emptyResponse
                ? 'the response after `shall` is empty, so nothing is required (`EARS-003`)'
                : 'no identifiable subject before `shall`: the obligation has no owner (`EARS-003`)',
            remedies,
            question: hasSubject
                ? undefined
                : `which system component owns the obligation in \`${describeSpan(stmt.text, 0, stmt.text.length)}\`?`,
        }),
    ];
}));
const CONDITION_INTRO_RE = /^(in the event of|in case of|when|while|if|where|upon|during|after|before)\b/i;
const EARS_006 = makeRule('EARS-006', 'EARS', 'condition lives outside the statement', 'S1', ['requirements'], (ctx) => {
    const text = ctx.artifact.text;
    const lines = text.split(/\r?\n/);
    const offsets = lineOffsets(text);
    const matches = [];
    for (let i = 0; i < lines.length; i += 1) {
        const trimmed = lines[i].trim();
        if (!trimmed || /^\s*```/.test(trimmed))
            continue;
        const isHeading = /^#{1,6}\s+/.test(trimmed);
        const body = trimmed.replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '').trim();
        const condMatch = body.match(CONDITION_INTRO_RE);
        if (!condMatch)
            continue;
        if (!isHeading && !/[:：]\s*$/.test(body))
            continue;
        const bullets = [];
        for (let j = i + 1; j < lines.length && j <= i + 6; j += 1) {
            const next = lines[j].trim();
            if (!next)
                continue;
            if (/^#{1,6}\s/.test(next))
                break;
            const bullet = next.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
            if (!bullet)
                break;
            bullets.push(bullet[1]);
        }
        if (bullets.length === 0)
            continue;
        const keyword = condMatch[1];
        if (bullets.some((b) => new RegExp(`^${escapeRegExp(keyword)}\\b`, 'i').test(b.trim())))
            continue;
        if (!bullets.some((b) => /\bshall\b/i.test(b)))
            continue;
        const lineStart = offsets[i];
        matches.push({
            offset: lineStart + lines[i].indexOf(trimmed),
            length: trimmed.length,
            message: 'the trigger condition lives in a heading or list intro instead of the statement, so each bullet is unbound (`EARS-006`)',
            remedies: [remedy('repeat the condition inside each statement, e.g. `In the event of <condition>, the <System> shall ...`')],
        });
    }
    return ok(matches);
});
const EARS_007 = makeRule('EARS-007', 'EARS', 'subject is the user, not the system', 'S2', ['requirements'], (ctx) => perStatement(ctx, (stmt) => {
    const shallIdx = stmt.text.search(/\bshall\b/i);
    if (shallIdx < 0)
        return [];
    const prefix = stmt.text.slice(0, shallIdx);
    const lastChunk = prefix.includes(',') ? prefix.slice(prefix.lastIndexOf(',') + 1) : prefix;
    const USER_NOUN_RE = /\b(users?|operators?|developers?|admins?|administrators?|customers?|drivers?|humans?|persons?|people|end\s+users?)\b/i;
    const SYSTEM_NOUN_RE = /\b(system|service|server|gateway|client|application|app|module|component|api|database|engine|coach|runner|agent|daemon|worker|scheduler|manager|controller|pipeline|cli|tool)\b/i;
    if (SYSTEM_NOUN_RE.test(lastChunk))
        return [];
    const userMatch = lastChunk.match(USER_NOUN_RE);
    if (!userMatch)
        return [];
    const index = prefix.length - lastChunk.length + (userMatch.index ?? 0);
    return [
        rel(stmt, index, userMatch[0].length, {
            message: `the subject is the user (\`${userMatch[0].toLowerCase()}\`), not the system that must enforce the behaviour (\`EARS-007\`)`,
            remedies: [remedy('rewrite the subject as the system component that enforces it, e.g. `The <System> shall ...`')],
        }),
    ];
}));
const EARS_008 = makeRule('EARS-008', 'EARS', 'non-conforming or missing identifier', 'S2', ['requirements'], (ctx) => {
    const matches = [];
    const conforming = /^REQ-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3}$/;
    const headingRe = /^(#{2,6})\s+(REQ-[A-Za-z0-9-]+)/gm;
    for (const m of findAll(ctx.artifact.text, headingRe)) {
        const id = m[2];
        if (conforming.test(id))
            continue;
        const index = (m.index ?? 0) + m[0].indexOf(id);
        matches.push({
            offset: index,
            length: id.length,
            message: `identifier \`${id}\` is not \`REQ-<AREA>-<NNN>\` with a zero-padded three-digit sequence (\`EARS-008\`)`,
            remedies: [remedy(`rename it to \`REQ-<AREA>-${String(1).padStart(3, '0')}\` and never reuse the old id`)],
        });
    }
    if (ctx.requirementIds.length === 0 && ctx.statements.length > 0) {
        const first = ctx.statements[0];
        matches.push({
            offset: first.textOffset,
            length: first.text.length,
            message: 'the requirement set carries no `REQ-<AREA>-<NNN>` identifier (`EARS-008`)',
            remedies: [remedy('assign each requirement a stable `REQ-<AREA>-<NNN>` id before it is baselined')],
        });
    }
    else if (ctx.requirementIds.length > 0) {
        for (const stmt of ctx.statements) {
            if (stmt.requirementId !== null || stmt.isAcceptanceCriterion)
                continue;
            matches.push(rel(stmt, 0, stmt.text.length, {
                message: 'the statement sits outside any identified requirement, so it cannot be traced (`EARS-008`)',
                remedies: [remedy('move it under a `### REQ-<AREA>-<NNN>` heading or delete it')],
            }));
        }
    }
    return ok(matches);
});
// --- Ambiguity family --------------------------------------------------------------------------
const SUBJECTIVE_RE = /\b(simple|simply|easy|easily|efficient(?:ly)?|effective(?:ly)?|appropriate(?:ly)?|adequate(?:ly)?|reasonable|intuitive|user[- ]friendly|convenient|maintainable|robust|seamless|acceptable|state[- ]of[- ]the[- ]art|best practice|high[- ]quality|cost[- ]effective|nice|clean|modern)\b/gi;
const AMB_001 = makeRule('AMB-001', 'AMB', 'subjective or weak language', 'S2', ['requirements'], (ctx) => perStatement(ctx, (stmt) => findAll(stmt.text, SUBJECTIVE_RE).map((m) => {
    const term = m[0];
    const glossaryShaped = /[_A-Z]/.test(term);
    return rel(stmt, m.index ?? 0, term.length, {
        message: `subjective term \`${term.toLowerCase()}\` is not falsifiable as written (\`AMB-001\`)`,
        remedies: [remedy(`replace \`${term}\` with a measurable threshold, or cite the published standard that defines it`)],
        question: glossaryShaped
            ? `is \`${term}\` defined in the glossary with a measurable threshold?`
            : undefined,
    });
})));
const PERF_ADJECTIVE_RE = /\b(fast|quick(?:ly)?|rapid(?:ly)?|slow(?:ly)?|responsive|performant|high[- ]performance|low[- ]latency|high[- ]throughput|scalable|lightweight|instant(?:ly)?|real[- ]time)\b/gi;
const AMB_002 = makeRule('AMB-002', 'AMB', 'unquantified performance adjective', 'S2', ['requirements'], (ctx) => perStatement(ctx, (stmt) => {
    if (hasQuantity(stmt.text))
        return [];
    return findAll(stmt.text, PERF_ADJECTIVE_RE).map((m) => rel(stmt, m.index ?? 0, m[0].length, {
        message: `performance adjective \`${m[0].toLowerCase()}\` has no measured bound (\`AMB-002\`)`,
        question: `what measured value and unit define \`${m[0].toLowerCase()}\`, and under what load?`,
    }));
}));
const ESCAPE_CLAUSE_RE = /\b(if (?:at all )?possible|where(?:ver)? possible|when(?:ever)? possible|as (?:needed|required|appropriate|applicable|necessary|desired)|if (?:necessary|needed|required|appropriate|applicable)|where there is sufficient\b|sufficient(?:ly)?|to the extent possible|as far as possible|so far as possible|where practicable|if practicable|at the discretion of|subject to|unless otherwise)\b/gi;
const AMB_003 = makeRule('AMB-003', 'AMB', 'escape clause / loophole', 'S1', ['requirements'], (ctx) => perStatement(ctx, (stmt) => findAll(stmt.text, ESCAPE_CLAUSE_RE).map((m) => {
    const clause = m[0];
    const negotiated = /\b(subject to|at the discretion of|unless otherwise)\b/i.test(clause);
    return rel(stmt, m.index ?? 0, clause.length, {
        message: `escape clause \`${clause.toLowerCase()}\` makes the obligation non-binding (\`AMB-003\`)`,
        remedies: [remedy('delete the clause, or promote it to an explicit `Where`/`If` condition with its own requirement')],
        question: negotiated ? 'is this optionality a negotiated contractual limitation, and what bounds it?' : undefined,
    });
})));
const OPEN_LIST_RE = /\b(and so on|etc\.?|and the like|or similar|among others|including but not limited to|and more|such as)\b/gi;
const AMB_004 = makeRule('AMB-004', 'AMB', 'open-ended list', 'S1', ['requirements'], (ctx) => perStatement(ctx, (stmt) => findAll(stmt.text, OPEN_LIST_RE).map((m) => {
    const openByDesign = /\b(etc\.?|and so on|and the like)\b/i.test(m[0]);
    return rel(stmt, m.index ?? 0, m[0].length, {
        message: `open-ended enumeration \`${m[0].toLowerCase()}\` leaves the set undefined (\`AMB-004\`)`,
        remedies: [remedy('enumerate every member, or reference a versioned closed list')],
        question: openByDesign ? 'is this list open by design (e.g. plugin formats or an extensible taxonomy)?' : undefined,
    });
})));
const COMPARATIVE_RE = /\b(more|less|fewer|better|worse|faster|slower|higher|lower|greater|larger|smaller|cheaper|superior|inferior)\b/gi;
const AMB_005 = makeRule('AMB-005', 'AMB', 'comparative without a fixed baseline', 'S3', ['requirements'], (ctx) => perStatement(ctx, (stmt) => {
    const matches = [];
    for (const m of findAll(stmt.text, COMPARATIVE_RE)) {
        const index = m.index ?? 0;
        // Guard the catalogue insists on: a comparative that is a legitimate condition is not AMB-005.
        if (insideCondition(stmt.text, index))
            continue;
        const after = stmt.text.slice(index + m[0].length, index + m[0].length + 24);
        const before = stmt.text.slice(Math.max(0, index - 8), index);
        if (/\d|[<>=≤≥×]/.test(after) || /\d|[<>=≤≥×]/.test(before))
            continue;
        matches.push(rel(stmt, index, m[0].length, {
            message: `comparative \`${m[0].toLowerCase()}\` has no numeric baseline (\`AMB-005\`)`,
            question: `what numeric baseline and unit define \`${m[0].toLowerCase()}\`?`,
        }));
    }
    return matches;
}));
const AMB_007 = makeRule('AMB-007', 'AMB', 'pronoun with an external referent', 'S2', ['requirements'], (ctx) => perStatement(ctx, (stmt) => {
    const subject = stmt.text.match(/^(it|they|this|that|these|those|he|she)\b/i);
    const clause = stmt.text.match(/(?:[,;]\s*|\band\s+|\bbut\s+)(it|they|this|that|he|she)\s+(?:shall|should|must|will|is|are|was|were|has|have)\b/i);
    const hit = subject ?? clause;
    if (!hit)
        return [];
    const index = (hit.index ?? 0) + (subject ? 0 : hit[0].indexOf(hit[1]));
    return [
        rel(stmt, index, hit[1].length, {
            message: `pronoun \`${hit[1].toLowerCase()}\` has no referent inside its own statement (\`AMB-007\`)`,
            remedies: [remedy('repeat the noun, or name the referent identifier, in this statement')],
        }),
    ];
}));
const TEMPORAL_INDEFINITE_RE = /\b(eventually|promptly|timely|in a timely manner|immediately|as soon as possible|asap|soon|later|at some point|in the near future|from time to time|periodically|on a regular basis|regularly)\b/gi;
const AMB_008 = makeRule('AMB-008', 'AMB', 'temporal indefinite', 'S2', ['requirements'], (ctx) => perStatement(ctx, (stmt) => findAll(stmt.text, TEMPORAL_INDEFINITE_RE).map((m) => {
    const cadence = /\b(from time to time|periodically|on a regular basis|regularly)\b/i.test(m[0]);
    return rel(stmt, m.index ?? 0, m[0].length, {
        message: `temporal term \`${m[0].toLowerCase()}\` has no bounded deadline or cadence (\`AMB-008\`)`,
        remedies: [remedy('replace it with a bounded deadline, a rate, or a bounded ordering')],
        question: cadence ? `what cadence and measurement window does \`${m[0].toLowerCase()}\` mean?` : undefined,
    });
})));
const UNIT_ABBREVIATIONS = new Set([
    'km',
    'm',
    'cm',
    'mm',
    's',
    'sec',
    'secs',
    'ms',
    'us',
    'ns',
    'h',
    'hr',
    'hrs',
    'kg',
    'g',
    'mg',
    'l',
    'ml',
    'w',
    'kw',
    'v',
    'mv',
    'a',
    'ma',
    'mb',
    'gb',
    'tb',
    'kb',
    'hz',
    'khz',
    'mhz',
    'ghz',
    'pa',
    'kpa',
    'bit',
    'bits',
    'byte',
    'bytes',
    'fps',
    'px',
    'dpi',
    'rpm',
    'i',
    'o',
]);
const AMB_009 = makeRule('AMB-009', 'AMB', 'oblique slash or and/or', 'S2', ['requirements'], (ctx) => perStatement(ctx, (stmt) => {
    const matches = [];
    const andOr = stmt.text.match(/\band\s*\/\s*or\b/i);
    if (andOr) {
        matches.push(rel(stmt, andOr.index ?? 0, andOr[0].length, {
            message: `\`${andOr[0].toLowerCase()}\` leaves the disjunction undefined (\`AMB-009\`)`,
            remedies: [remedy('state the alternatives explicitly and say whether the disjunction is inclusive or exclusive')],
        }));
    }
    for (const m of findAll(stmt.text, /(\p{L}+)\s*\/\s*(\p{L}+)/gu)) {
        const index = m.index ?? 0;
        const left = m[1].toLowerCase();
        const right = m[2].toLowerCase();
        if (UNIT_ABBREVIATIONS.has(left) || UNIT_ABBREVIATIONS.has(right))
            continue;
        if (left.length === 1 && right.length === 1)
            continue;
        const before = stmt.text[index - 1] ?? '';
        const after = stmt.text[index + m[0].length] ?? '';
        if (before === '/' || after === '/' || before === '.' || after === '.')
            continue;
        matches.push(rel(stmt, index, m[0].length, {
            message: `oblique slash in \`${m[0]}\` hides two obligations in one statement (\`AMB-009\`)`,
            remedies: [remedy('split it into two statements, or write the logical `AND`/`OR` expression explicitly')],
        }));
    }
    return matches;
}));
const PREFIX_WORDS = new Set([
    'http',
    'https',
    'status',
    'code',
    'version',
    'v',
    'no',
    'num',
    'number',
    'figure',
    'fig',
    'clause',
    'section',
    'sha',
    'aes',
    'rsa',
    'iso',
    'ieee',
    'rfc',
    'tls',
    'req',
    'test',
    'task',
    'tier',
    'level',
]);
const COUNT_WORDS = new Set([
    'times',
    'retries',
    'retry',
    'attempts',
    'attempt',
    'records',
    'record',
    'requests',
    'request',
    'users',
    'user',
    'items',
    'item',
    'entries',
    'entry',
    'characters',
    'chars',
    'char',
    'lines',
    'line',
    'files',
    'file',
    'tasks',
    'task',
    'tests',
    'test',
    'percent',
    'calls',
    'call',
    'rows',
    'row',
    'events',
    'event',
    'tokens',
    'token',
    'threads',
    'thread',
    'workers',
    'worker',
    'nines',
]);
const AMB_010 = makeRule('AMB-010', 'AMB', 'number without a unit', 'S2', ['requirements'], (ctx) => perStatement(ctx, (stmt) => {
    const matches = [];
    for (const m of findAll(stmt.text, /(?<![\w.])-?\d+(?:[.,]\d+)?(?![\w])/g)) {
        const index = m.index ?? 0;
        const end = index + m[0].length;
        const prevChar = index > 0 ? stmt.text[index - 1] : '';
        const nextChar = end < stmt.text.length ? stmt.text[end] : '';
        if (prevChar === '-' || nextChar === '-' || prevChar === ':' || nextChar === ':')
            continue;
        const after = stmt.text.slice(end).match(/^\s*([%\u00b0]?[\p{L}µ]+(?:\/[A-Za-z]+)?)/u);
        const unit = after ? after[1].split('/')[0].toLowerCase() : '';
        if (unit && (UNIT_ABBREVIATIONS.has(unit) || COUNT_WORDS.has(unit)))
            continue;
        const before = stmt.text.slice(0, index).match(/([\p{L}]+)\s*$/u);
        if (before && PREFIX_WORDS.has(before[1].toLowerCase()))
            continue;
        matches.push(rel(stmt, index, m[0].length, {
            message: `number \`${m[0]}\` has no unit, so it cannot be verified (\`AMB-010\`)`,
            question: `what unit and measurement system apply to \`${m[0]}\`?`,
        }));
    }
    return matches;
}));
const MIN_MAX_RE = /\b(minimi[sz]e|maximi[sz]e|optimi[sz]e|minimum|maximum|minimal|maximal|optimal)\b/gi;
const AMB_012 = makeRule('AMB-012', 'AMB', 'minimize or maximize with no bound', 'S2', ['requirements'], (ctx) => perStatement(ctx, (stmt) => {
    if (hasQuantity(stmt.text))
        return [];
    return findAll(stmt.text, MIN_MAX_RE).map((m) => rel(stmt, m.index ?? 0, m[0].length, {
        message: `\`${m[0].toLowerCase()}\` states a direction without a bound (\`AMB-012\`)`,
        question: `what bound (\`≤\`/\`≥\` with a number and unit) defines \`${m[0].toLowerCase()}\`?`,
    }));
}));
const PLACEHOLDER_RE = /\b(TBD|TBS|TBR|TODO|FIXME|to be (?:determined|specified|resolved|defined|decided|confirmed|agreed))\b/gi;
const AMB_013 = makeRule('AMB-013', 'AMB', 'unresolved placeholder', 'S1', ['requirements'], (ctx) => perStatement(ctx, (stmt) => findAll(stmt.text, PLACEHOLDER_RE).map((m) => rel(stmt, m.index ?? 0, m[0].length, {
    message: `unresolved placeholder \`${m[0].toUpperCase()}\` in a baselined set (\`AMB-013\`)`,
    remedies: [
        remedy('resolve the placeholder, or record its cause, action, owner and deadline next to it'),
    ],
    question: `what value replaces \`${m[0].toUpperCase()}\`, owned by whom and by when?`,
}))));
// --- Singularity family ------------------------------------------------------------------------
const COMPOUND_CONJUNCTION_RE = /\bshall\b[^.!?]*?\b(?:and|or)\b[^.!?]*?\bshall\b/i;
const SIN_001 = makeRule('SIN-001', 'SIN', 'compound requirement', 'S1', ['requirements'], (ctx) => perStatement(ctx, (stmt) => {
    const shallCount = (stmt.text.match(/\bshall\b/gi) ?? []).length;
    if (shallCount < 2)
        return [];
    if (!COMPOUND_CONJUNCTION_RE.test(stmt.text))
        return [];
    const index = stmt.text.search(/\bshall\b/i);
    return [
        rel(stmt, index, stmt.text.length - index, {
            message: `${shallCount} obligations joined in one statement: it is likely ${shallCount} requirements (\`SIN-001\`)`,
            remedies: [remedy('split it into one requirement per obligation, repeating the condition in each')],
        }),
    ];
}));
const MODAL_COUNT_RE = /\b(shall|must|should|will)\b/gi;
const SIN_003 = makeRule('SIN-003', 'SIN', 'more than one sentence or modal', 'S2', ['requirements'], (ctx) => perStatement(ctx, (stmt) => {
    if (COMPOUND_CONJUNCTION_RE.test(stmt.text))
        return [];
    const sentenceCount = (stmt.text.match(/[.!?](?:\s|$)/g) ?? []).length;
    const modalCount = (stmt.text.match(MODAL_COUNT_RE) ?? []).length;
    if (sentenceCount < 2 && modalCount < 2)
        return [];
    const secondSentence = stmt.text.search(/[.!?]\s+\S/);
    const index = secondSentence >= 0 ? secondSentence + 1 : stmt.text.search(/\b(?:must|should|will)\b/i);
    return [
        rel(stmt, index >= 0 ? index : 0, stmt.text.length, {
            message: `more than one sentence or modal in one requirement (\`SIN-003\`)`,
            remedies: [remedy('split it into separate requirements, one modal and one sentence each')],
        }),
    ];
}));
const NEGATION_RE = /\b(?:not|without|cannot|can't|won't|isn't|aren't|doesn't|don't)\b/gi;
const SIN_007 = makeRule('SIN-007', 'SIN', 'negation that could be positive', 'S2', ['requirements'], (ctx) => perStatement(ctx, (stmt) => {
    const matches = [];
    for (const m of findAll(stmt.text, NEGATION_RE)) {
        const index = m.index ?? 0;
        // Guard 1: a negation inside an If/when/while condition is NOT SIN-007.
        if (insideCondition(stmt.text, index))
            continue;
        // Guard 2: `not more than 5` is a bound, not a negation of the system's behaviour.
        const after = stmt.text.slice(index + m[0].length);
        if (/^\s+(?:more|less|fewer|later|earlier|greater|longer|shorter|exceed|to exceed)\b/i.test(after))
            continue;
        matches.push(rel(stmt, index, m[0].length, {
            message: `negation \`${m[0].toLowerCase()}\` states what the system must not do instead of a bounded positive target (\`SIN-007\`)`,
            remedies: [
                remedy('state the positive bounded target (e.g. `shall have an Availability of ≥ 95%`), or move the negation inside an `If`/`when` condition'),
            ],
        }));
    }
    return matches;
}));
const ABSOLUTE_RE = /(?:100\s*%|\b(?:100\s*percent|never|always|all|any|every|none|zero|guaranteed|completely|totally|perfect|unlimited|infinite|no\s+downtime|zero\s+downtime)\b|24\/7|24x7)/gi;
const SIN_008 = makeRule('SIN-008', 'SIN', 'absolute or totality', 'S2', ['requirements'], (ctx) => perStatement(ctx, (stmt) => {
    const matches = [];
    for (const m of findAll(stmt.text, ABSOLUTE_RE)) {
        const index = m.index ?? 0;
        const after = stmt.text.slice(index + m[0].length);
        if (/^\s+(?:more|less|fewer|later|earlier|greater|other)\s+than\b/i.test(after))
            continue;
        const closesSet = /^(?:all|any|every|never|always|none)$/i.test(m[0]);
        matches.push(rel(stmt, index, m[0].length, {
            message: `absolute \`${m[0].toLowerCase()}\` has no defined closed set or error budget (\`SIN-008\`)`,
            remedies: [
                remedy('use a bounded target (`≥ 98% per calendar month`), or `each` instead of `all`/`any` over a defined closed set'),
            ],
            question: closesSet ? `is \`${m[0].toLowerCase()}\` a genuinely closed, enumerable set, and what is its bound?` : undefined,
        }));
    }
    return matches;
}));
// --- Verifiability family ----------------------------------------------------------------------
const OBSERVABLE_VERB_RE = /\b(return|returns|respond|responds|emit|emits|log|logs|record|records|create|creates|delete|deletes|remove|removes|send|sends|write|writes|display|displays|expose|exposes|reject|rejects|accept|accepts|grant|grants|deny|denies|notify|notifies|publish|publishes|persist|persists|increment|increments|decrement|decrements|redirect|redirects|update|updates|allow|allows|block|blocks|include|includes|cache|caches|schedule|schedules|enforce|enforces|require|requires)\b/i;
const VER_001 = makeRule('VER-001', 'VER', 'no measurable outcome', 'S2', ['requirements'], (ctx) => perStatement(ctx, (stmt) => {
    const shallIdx = stmt.text.search(/\bshall\b/i);
    if (shallIdx < 0)
        return [];
    const response = stmt.text.slice(shallIdx + 5);
    if (/\d/.test(response))
        return [];
    if (/(?:≤|≥|<|>|\bwithin\b|\bno more than\b|\bat least\b|\bat most\b|\bup to\b)/i.test(response))
        return [];
    if (OBSERVABLE_VERB_RE.test(response))
        return [];
    return [
        rel(stmt, 0, stmt.text.length, {
            message: 'the `shall` clause has no quantity, bound or observable state, so nothing can falsify it (`VER-001`)',
            remedies: [
                remedy('state an observable outcome with its bound, e.g. `shall reject a body > 255 characters with HTTP 400 within 100 ms`'),
            ],
        }),
    ];
}));
const RESTATED_RE = /\b(?:as expected|as intended|as designed|as required|as needed|as appropriate|correctly|properly|appropriately|satisfactorily|gracefully|successfully|without (?:any )?errors?|no errors?|works? (?:as|correctly|properly|fine)|functions? (?:as|correctly|properly)|behaves? (?:as|correctly|properly)|operates? (?:as|correctly|properly)|handles? (?:it |this )?(?:correctly|properly|as expected)|meets? the requirements?|to specification)\b/gi;
const VER_006 = makeRule('VER-006', 'VER', 'circular acceptance criterion', 'S1', ['requirements'], (ctx) => perStatement(ctx, (stmt) => {
    if (stmt.isAcceptanceCriterion || /^(?:and\s+)?then\b/i.test(stmt.text))
        return [];
    return findAll(stmt.text, RESTATED_RE).map((m) => rel(stmt, m.index ?? 0, m[0].length, {
        message: `\`${m[0].toLowerCase()}\` restates the requirement instead of defining a falsifiable outcome (\`VER-006\`)`,
        remedies: [
            remedy('replace it with an observable acceptance criterion (a Gherkin `Then` with a measurable result)'),
        ],
        question: /expected|correctly|properly|appropriately|gracefully/i.test(m[0])
            ? `what observable, measurable outcome shows that \`${m[0].toLowerCase()}\`?`
            : undefined,
    }));
}));
// --- Set-level family --------------------------------------------------------------------------
const SYNONYM_PAIRS = [
    { a: /\busers?\b/i, b: /\bcustomers?\b/i, label: 'user|customer' },
    { a: /\bdelete\b/i, b: /\bremove\b/i, label: 'delete|remove' },
    { a: /\bconfig\b/i, b: /\bconfiguration\b/i, label: 'config|configuration' },
    { a: /\blog ?in\b/i, b: /\bsign ?in\b/i, label: 'log in|sign in' },
    { a: /\berror\b/i, b: /\bfailure\b/i, label: 'error|failure' },
    { a: /\bmodify\b/i, b: /\bupdate\b/i, label: 'modify|update' },
    { a: /\bpassword\b/i, b: /\bpassphrase\b/i, label: 'password|passphrase' },
    { a: /\bendpoint\b/i, b: /\broute\b/i, label: 'endpoint|route' },
];
const SET_003 = makeRule('SET-003', 'SET', 'inconsistent terminology', 'S3', ['requirements'], (ctx) => {
    const body = ctx.statements.map((s) => s.text).join('\n');
    if (!body)
        return skip('no requirement statement could be extracted from the artifact');
    const matches = [];
    for (const pair of SYNONYM_PAIRS) {
        if (!pair.a.test(body) || !pair.b.test(body))
            continue;
        const second = findAll(body, new RegExp(pair.b.source, pair.b.flags.includes('i') ? 'i' : ''));
        const hit = second[0];
        if (!hit)
            continue;
        const offset = ctx.artifact.text.indexOf(hit[0], ctx.statements[0].textOffset);
        matches.push({
            offset: offset >= 0 ? offset : ctx.statements[0].textOffset,
            length: hit[0].length,
            message: `the set uses \`${pair.label.replace('|', '` and `')}\` for the same item, so the requirement is read two ways (\`SET-003\`)`,
            question: `which term is canonical for \`${pair.label}\`: define exactly one in the glossary`,
        });
    }
    return ok(matches);
});
const SET_005 = makeRule('SET-005', 'SET', 'orphan requirement with no parent', 'S2', ['requirements'], (ctx) => {
    if (!ctx.hasUpstream)
        return skip('no brief, roadmap or needs artifact is available to resolve an upward link');
    if (ctx.requirementIds.length === 0)
        return skip('no `REQ-<AREA>-<NNN>` identifier is available to resolve');
    const matches = [];
    for (const section of ctx.requirementSections) {
        const hasPointer = PARENT_POINTER_RE.test(section.text);
        const referencedUpstream = ctx.allFacts.some((f) => f.kind !== 'requirements' && new RegExp(escapeRegExp(section.id)).test(f.text));
        if (hasPointer || referencedUpstream)
            continue;
        matches.push({
            offset: section.offset,
            length: section.id.length,
            message: `requirement \`${section.id}\` has no upward link to a need, goal or parent (\`SET-005\`)`,
            question: `which need or goal authorises \`${section.id}\`? link it or delete it`,
        });
    }
    return ok(matches);
});
const SET_006 = makeRule('SET-006', 'SET', 'no downstream task or evidence', 'S2', ['requirements'], (ctx) => {
    if (!ctx.hasDownstream)
        return skip('no tasks, plan or verification artifact is available to resolve a downstream link');
    if (ctx.requirementIds.length === 0)
        return skip('no `REQ-<AREA>-<NNN>` identifier is available to resolve');
    const downstream = ctx.allFacts.filter((f) => f.kind === 'tasks' || f.kind === 'plan' || f.kind === 'test');
    const matches = [];
    for (const section of ctx.requirementSections) {
        const idRe = new RegExp(escapeRegExp(section.id));
        if (downstream.some((f) => idRe.test(f.text)))
            continue;
        matches.push({
            offset: section.offset,
            length: section.id.length,
            message: `requirement \`${section.id}\` has no downstream task or verification artefact (\`SET-006\`)`,
            remedies: [remedy(`add a task or a test that cites \`${section.id}\`, e.g. \`TEST-<AREA>-<NNN>\``)],
        });
    }
    return ok(matches);
});
// --- Traceability family -----------------------------------------------------------------------
const TRC_002 = makeRule('TRC-002', 'TRC', 'dangling trace reference', 'S1', ['requirements'], (ctx) => {
    const defined = new Set();
    for (const f of ctx.allFacts) {
        for (const id of f.requirementIds)
            defined.add(id);
        for (const ref of f.references)
            if (ref.isDefinition)
                defined.add(ref.id);
    }
    if (defined.size === 0)
        return skip('no identifier is defined anywhere to resolve a reference against');
    const seen = new Set();
    const matches = [];
    for (const f of ctx.allFacts) {
        for (const ref of f.references) {
            if (ref.isDefinition || defined.has(ref.id))
                continue;
            if (seen.has(ref.id))
                continue;
            seen.add(ref.id);
            matches.push({
                offset: ref.offset,
                length: ref.id.length,
                message: `trace reference \`${ref.id}\` does not resolve to any definition in this spec (\`TRC-002\`)`,
                question: `which artifact defines or replaces \`${ref.id}\`? offer candidates; do not guess`,
            });
        }
    }
    return ok(matches);
});
// --- NFR family --------------------------------------------------------------------------------
const SLO_NOUN_RE = /\b(latency|throughput|response time|error rate|fail(?:ure)? rate|slo|sli|rps|qps|requests? per second|percentile)\b/i;
const PERCENTILE_RE = /\bp\d{1,3}\b|\b\d{1,3}(?:st|nd|rd|th)\s+percentile\b|\bpercentile\b|\b\d+(?:\.\d+)?\s*%\s+of\b/i;
const WINDOW_RE = /\bper\s+(?:calendar\s+)?(?:second|minute|hour|day|week|month|quarter|year|request|transaction|call)\b|\bover\s+(?:a|an|the|\d)|averaged over|rolling\s+(?:\d+|window)|measurement window|window of|\bduring\b|\bwithin a\b|\bmonthly\b|\bweekly\b|\bdaily\b|\bannually\b|\bper period\b/i;
const NFR_002 = makeRule('NFR-002', 'NFR', 'SLO without percentile or window', 'S2', ['requirements'], (ctx) => perStatement(ctx, (stmt) => {
    if (/\b(availability|uptime)\b/i.test(stmt.text) && !SLO_NOUN_RE.test(stmt.text))
        return [];
    if (!SLO_NOUN_RE.test(stmt.text))
        return [];
    const hasPercentile = PERCENTILE_RE.test(stmt.text);
    const hasWindow = WINDOW_RE.test(stmt.text);
    if (hasPercentile && hasWindow)
        return [];
    const missing = !hasPercentile && !hasWindow ? 'a percentile and a measurement window' : !hasPercentile ? 'a percentile' : 'a measurement window';
    return [
        rel(stmt, 0, stmt.text.length, {
            message: `operational target without ${missing}, so it cannot be measured as an SLO (\`NFR-002\`)`,
            question: `what percentile and measurement window define \`${describeSpan(stmt.text, 0, stmt.text.length)}\`?`,
        }),
    ];
}));
const NFR_003 = makeRule('NFR-003', 'NFR', 'availability without a window', 'S2', ['requirements'], (ctx) => perStatement(ctx, (stmt) => {
    if (!/\b(availability|uptime|available)\b/i.test(stmt.text))
        return [];
    if (!/\d+(?:\.\d+)?\s*%|\b\d+\s*nines\b|\b(?:three|four|five)\s+nines\b/i.test(stmt.text))
        return [];
    if (WINDOW_RE.test(stmt.text))
        return [];
    return [
        rel(stmt, 0, stmt.text.length, {
            message: 'availability target with no measurement window, so the nines are undefined (`NFR-003`)',
            question: `over what window is that availability measured (e.g. \`per calendar month\`)?`,
        }),
    ];
}));
// --- AI-specific family ------------------------------------------------------------------------
const INJECTION_PATTERNS = [
    /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|preceding)\s+(?:instructions?|prompts?|messages?|rules?)\b/gi,
    /\b(?:you are|you're)\s+(?:now\s+)?(?:an?\s+)?(?:ai|assistant|agent|language model|chatbot)\b/gi,
    /\b(?:system prompt|assistant message|developer message|system message|new instructions?|updated instructions?|override (?:the )?(?:previous|system))\b/gi,
    /\b(?:mark|treat|consider)\s+(?:this|it|the (?:spec|requirement))\s+(?:as\s+)?(?:approved|correct|complete|done|valid)\b/gi,
    /\b(?:do not|don't|never)\s+(?:tell|inform|report|mention|notify|ask)\b/gi,
    /\b(?:skip|bypass|ignore|disable)\s+(?:the\s+)?(?:checks?|gates?|validation|review|verification|tests?)\b/gi,
    /\b(?:execute|run|invoke)\s+(?:the following|this)\s+(?:command|code|script|tool)\b/gi,
    /<\/?(?:system|assistant)\b|<\|[a-z_]+\|>/gi,
    /\b(?:exfiltrate|send|upload|post)\s+(?:the\s+)?(?:secrets?|credentials?|api[ _-]?keys?|tokens?|env(?:ironment)? variables?|\.env)\b/gi,
    /\bprompt injection\b/gi,
];
const AI_002 = makeRule('AI-002', 'AI', 'instruction-shaped or invisible content', 'S1', ['any'], (ctx) => {
    const text = ctx.artifact.text;
    const matches = [];
    for (const m of findAll(text, INVISIBLE_RE)) {
        const offset = m.index ?? 0;
        const code = m[0].charCodeAt(0);
        const name = INVISIBLE_NAMES[code] ?? 'invisible character';
        matches.push({
            offset,
            length: 1,
            message: `invisible character \`U+${code.toString(16).toUpperCase().padStart(4, '0')}\` (${name}) in spec content: quarantined for human provenance review, never followed (\`AI-002\`)`,
            remedies: [
                remedy('strip the invisible character', 'machine-applicable'),
                remedy('quarantine the span and escalate it for provenance review before acting on the spec', 'needs-human'),
            ],
            question: `who authored \`U+${code.toString(16).toUpperCase().padStart(4, '0')}\` and may this span be removed?`,
            escalate: true,
            fix: { start: offset, end: offset + 1, replacement: '' },
        });
    }
    for (const pattern of INJECTION_PATTERNS) {
        for (const m of findAll(text, pattern)) {
            const offset = m.index ?? 0;
            const span = describeSpan(text, offset, m[0].length);
            matches.push({
                offset,
                length: m[0].length,
                message: `instruction-shaped content quoted as data, never followed: \`${span}\` (\`AI-002\`)`,
                remedies: [
                    remedy('quarantine the span and escalate it for provenance review before acting on the spec', 'needs-human'),
                ],
                question: `who authored \`${span}\` and may it be quarantined?`,
                escalate: true,
                fix: { start: offset, end: offset + m[0].length, replacement: '' },
            });
        }
    }
    return ok(matches);
});
const AI_003 = makeRule('AI-003', 'AI', 'unfalsifiable acceptance criterion', 'S1', ['requirements'], (ctx) => perStatement(ctx, (stmt) => {
    if (!stmt.isAcceptanceCriterion)
        return [];
    const restated = findAll(stmt.text, RESTATED_RE);
    const noOutcome = restated.length === 0 &&
        !/\d/.test(stmt.text) &&
        !OBSERVABLE_VERB_RE.test(stmt.text);
    if (restated.length === 0 && !noOutcome)
        return [];
    const index = restated[0]?.index ?? 0;
    const span = describeSpan(stmt.text, index, restated[0]?.[0].length ?? stmt.text.length);
    return [
        rel(stmt, index, restated[0]?.[0].length ?? stmt.text.length, {
            message: `acceptance criterion \`${span}\` is not falsifiable as written (\`AI-003\`)`,
            remedies: [
                remedy('rewrite it as a Gherkin `Then` with an observable result, e.g. `Then the API shall return HTTP 201 with a Location header within 200 ms`'),
            ],
            question: `what observable, measurable outcome shows \`${span}\`?`,
        }),
    ];
}));
// ---------------------------------------------------------------------------------------------
// The registry — ordered, so finding ids and output are deterministic
// ---------------------------------------------------------------------------------------------
export const DETERMINISTIC_CHECKS = [
    EARS_001,
    EARS_002,
    EARS_003,
    EARS_006,
    EARS_007,
    EARS_008,
    AMB_001,
    AMB_002,
    AMB_003,
    AMB_004,
    AMB_005,
    AMB_007,
    AMB_008,
    AMB_009,
    AMB_010,
    AMB_012,
    AMB_013,
    SIN_001,
    SIN_003,
    SIN_007,
    SIN_008,
    VER_001,
    VER_006,
    SET_003,
    SET_005,
    SET_006,
    TRC_002,
    NFR_002,
    NFR_003,
    AI_002,
    AI_003,
];
/** Ids the coach implements deterministically; every other catalogue entry is delegated. */
export const BUILT_IN_CHECK_IDS = DETERMINISTIC_CHECKS.map((c) => c.id);
export const COACH_FAMILIES = ['EARS', 'AMB', 'SIN', 'VER', 'SET', 'TRC', 'NFR', 'AI'];
// ---------------------------------------------------------------------------------------------
// The review
// ---------------------------------------------------------------------------------------------
const SEVERITY_RANK = { error: 0, warning: 1, info: 2 };
const definedIdsBuiltIn = new Set(BUILT_IN_CHECK_IDS);
/**
 * Run every deterministic check plus every catalogue entry the coach does not implement, over the
 * declared artifacts. The `runner` is injected: tests pass a double, the CLI passes the standards
 * engine, and this module never imports it.
 */
export const reviewRequirements = (input) => {
    const entriesById = new Map();
    for (const entry of input.entries)
        entriesById.set(entry.id, entry);
    const facts = input.artifacts.map((a) => collectFacts(a.file, a.text, classifyArtifact(a.file)));
    const hasUpstream = hasUpstreamArtifact(facts) || facts.some((f) => f.kind === 'requirements' && PARENT_POINTER_RE.test(f.text));
    const hasDownstream = hasDownstreamArtifact(facts);
    const definedIds = new Set();
    for (const f of facts) {
        for (const id of f.requirementIds)
            definedIds.add(id);
        for (const ref of f.references)
            if (ref.isDefinition)
                definedIds.add(ref.id);
    }
    const findings = [];
    const skipped = new Set();
    let checked = 0;
    let sequence = 0;
    const push = (check, artifact, raw, instrument, basis, severity) => {
        sequence += 1;
        const pos = positionAt(artifact.text, raw.offset);
        const remedies = raw.remedies ?? [];
        findings.push({
            id: `RQC-${String(sequence).padStart(4, '0')}`,
            standardId: check.id,
            severity,
            file: artifact.file,
            line: pos.line,
            column: pos.column,
            span: describeSpan(artifact.text, raw.offset, raw.length),
            message: raw.message,
            remedies,
            ...(raw.question ? { question: raw.question } : {}),
            instrument,
            family: check.family,
            defaultSeverity: TIER_SEVERITY[check.tier],
            mayBlock: instrument !== 'model' && (severity === 'error' || severity === 'warning'),
            basis,
            ...(MEASURED_PRECISION[check.id] !== undefined ? { precision: MEASURED_PRECISION[check.id] } : {}),
            ...(raw.escalate ? { escalate: true } : {}),
            ...(raw.fix ? { fix: raw.fix } : {}),
        });
    };
    for (const check of DETERMINISTIC_CHECKS) {
        for (const artifact of input.artifacts) {
            const kind = classifyArtifact(artifact.file);
            if (!check.appliesTo.includes('any') && !check.appliesTo.includes(kind))
                continue;
            const artifactFacts = facts.find((f) => f.file === artifact.file && f.text === artifact.text);
            if (!artifactFacts)
                continue;
            const ctx = {
                artifact,
                kind,
                statements: artifactFacts.statements,
                requirementIds: artifactFacts.requirementIds,
                requirementSections: artifactFacts.requirementSections,
                definedIds,
                references: artifactFacts.references,
                allArtifacts: input.artifacts,
                allFacts: facts,
                hasUpstream,
                hasDownstream,
            };
            const outcome = check.run(ctx);
            if (outcome.skipReason) {
                skipped.add(`${check.id}: ${outcome.skipReason}`);
                continue;
            }
            checked += 1;
            const entry = entriesById.get(check.id);
            const severity = entry?.severity ?? TIER_SEVERITY[check.tier];
            const basis = BASIS[check.id] ?? check.title;
            for (const raw of outcome.matches ?? [])
                push(check, artifact, raw, 'deterministic', basis, severity);
        }
    }
    // Delegate every catalogue entry the coach does not implement to the injected runner.
    for (const entry of input.entries) {
        if (definedIdsBuiltIn.has(entry.id))
            continue;
        for (const artifact of input.artifacts) {
            try {
                const produced = input.runner(entry, artifact);
                checked += 1;
                for (const finding of produced) {
                    sequence += 1;
                    const pos = positionAt(artifact.text, 0);
                    findings.push({
                        ...finding,
                        id: `RQC-${String(sequence).padStart(4, '0')}`,
                        instrument: 'catalogue',
                        family: entry.category || entry.id.split('-')[0] || 'CATALOGUE',
                        defaultSeverity: entry.severity,
                        mayBlock: finding.severity === 'error' || finding.severity === 'warning',
                        basis: entry.source,
                        file: finding.file || artifact.file,
                        line: finding.line || pos.line,
                        column: finding.column || pos.column,
                    });
                }
            }
            catch (error) {
                skipped.add(`${entry.id}: runner could not inspect ${artifact.file} (${error instanceof Error ? error.message : String(error)})`);
            }
        }
    }
    // REQ-RQC-001: a check whose catalogue entry is missing is reported, not silently omitted. Only
    // meaningful when a catalogue was supplied at all.
    if (input.entries.length > 0) {
        for (const id of BUILT_IN_CHECK_IDS) {
            if (!entriesById.has(id))
                skipped.add(`${id}: not present in the supplied standards catalogue`);
        }
    }
    findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        a.file.localeCompare(b.file) ||
        a.line - b.line ||
        a.column - b.column ||
        a.standardId.localeCompare(b.standardId));
    const instruments = { deterministic: 0, catalogue: 0, model: 0 };
    for (const finding of findings)
        instruments[finding.instrument] += 1;
    const normalized = findings.map((finding) => ({
        ...finding,
        // The dead-end contract is enforced here too: a finding with neither a remedy nor a question
        // would be a bug, so it gets an explicit escalation instead of silently disappearing.
        remedies: finding.remedies.length > 0 || finding.question
            ? finding.remedies
            : [remedy('adjudicate this finding with a recorded reason in the existing allowlist channel', 'needs-human')],
    }));
    return {
        feature: input.feature,
        findings: normalized,
        checked,
        skipped: [...skipped].sort(),
        blocking: normalized.filter(isBlockingFinding),
        advisory: normalized.filter((f) => !isBlockingFinding(f)),
        instruments,
    };
};
/** Counts by check id, for a report line that never claims correctness. */
export const countByCheck = (findings) => {
    const out = {};
    for (const finding of findings)
        out[finding.standardId] = (out[finding.standardId] ?? 0) + 1;
    return out;
};
/** The one-line verdict the coach is allowed to state (REQ-RQC-011: it never certifies). */
export const summarizeReview = (report) => {
    const blocking = report.blocking.length;
    const escalations = report.findings.filter((f) => f.escalate).length;
    return `${report.checked} check(s) inspected an artifact · ${report.findings.length} finding(s) · ${blocking} may block · ${report.skipped.length} check(s) could not inspect · ${escalations} escalated to a human · this reports checks and adjudication, not correctness`;
};
/**
 * Apply a finding's machine-applicable fix. Returns the patched text plus the applied splice, or
 * `null` when the finding carries no exact fix (a `question` or a prose remedy is not applied
 * silently).
 */
export const applyCoachFix = (text, finding) => {
    if (!finding.fix)
        return null;
    const { start, end, replacement } = finding.fix;
    if (start < 0 || end < start || end > text.length)
        return null;
    return { text: `${text.slice(0, start)}${replacement}${text.slice(end)}`, applied: finding.fix };
};
/** The policy the module enforces around untrusted spec content, stated once. */
export const UNTRUSTED_SPEC_POLICY = 'spec artifacts are data: instruction-shaped content is reported and escalated, never executed or followed';
