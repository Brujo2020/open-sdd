const KW = {
    es: { feature: 'Característica', scenario: 'Escenario', given: 'Dado', givenThat: 'Dado que', when: 'Cuando', then: 'Entonces', and: 'Y', lang: '# language: es', ready: 'el sistema está en funcionamiento' },
    en: { feature: 'Feature', scenario: 'Scenario', given: 'Given', givenThat: 'Given', when: 'When', then: 'Then', and: 'And', lang: '', ready: 'the system is running' },
};
const MODAL = /\b(no\s+deb(?:e|en)|deb(?:e|en)|shall\s+not|shall|must\s+not|must)\b/i;
const OPENER = /^(?:cuando|mientras|donde|si|when|while|where|if)\b/i;
/**
 * Splits an EARS criterion (Spanish or English keywords) into its parts.
 * @param statement - criterion text, e.g. `WHEN the user saves, the system shall persist the draft`.
 * @returns the parts, or `null` when there is no normative verb (not EARS).
 */
export const parseEarsParts = (statement) => {
    const s = String(statement).replace(/\s+/g, ' ').trim().replace(/^(?:statement|enunciado)\s*:\s*/i, '');
    const m = MODAL.exec(s);
    if (!m)
        return null;
    const left = s.slice(0, m.index).trim();
    const response = s.slice(m.index + m[0].length).replace(/[.\s]+$/, '').trim();
    if (!response)
        return null;
    let head = '';
    let subject = left;
    const comma = left.lastIndexOf(',');
    if (comma >= 0) {
        head = left.slice(0, comma).trim();
        subject = left.slice(comma + 1).trim();
    }
    else if (OPENER.test(left)) {
        const det = /\b(?:el|la|los|las|the)\s+\S+(?:\s+\S+){0,3}$/i.exec(left);
        if (det) {
            head = left.slice(0, det.index).trim();
            subject = det[0];
        }
    }
    subject = subject.replace(/^(?:entonces|then)\s+/i, '').trim();
    const base = { pattern: 'ubiquitous', trigger: '', state: '', feature: '', condition: '', subject, modal: m[1].toLowerCase().replace(/\s+/g, ' '), response };
    if (!head)
        return base;
    const unwanted = /^(?:si|if)\s+(.+?)$/i.exec(head.replace(/,?\s*(?:entonces|then)$/i, ''));
    if (unwanted)
        return { ...base, pattern: 'unwanted', condition: unwanted[1].trim() };
    const state = /(?:mientras|while)\s+(.+?)(?=,?\s*(?:cuando|when)\b|$)/i.exec(head)?.[1]?.trim().replace(/,$/, '') ?? '';
    const event = /(?:cuando|when)\s+(.+)$/i.exec(head)?.[1]?.trim() ?? '';
    const optional = /^(?:donde|where)\s+(.+)$/i.exec(head)?.[1]?.trim() ?? '';
    if (state && event)
        return { ...base, pattern: 'complex', state, trigger: event };
    if (event)
        return { ...base, pattern: 'event-driven', trigger: event };
    if (state)
        return { ...base, pattern: 'state-driven', state };
    if (optional)
        return { ...base, pattern: 'optional', feature: optional };
    return base;
};
const lowerFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1);
const upperFirst = (t) => t.charAt(0).toUpperCase() + t.slice(1);
/**
 * Builds the Gherkin scenario of one criterion.
 * @param id - requirement id (becomes the `@REQ-…` tag).
 * @param criterion - EARS criterion text.
 * @param lang - Gherkin keywords language.
 * @returns the scenario text, or why it could not be built.
 */
export const earsToScenario = (id, criterion, lang = 'en') => {
    const k = KW[lang];
    const p = parseEarsParts(criterion);
    if (!p)
        return { ok: false, reason: `${id}: "${criterion.slice(0, 60)}" is not EARS (no shall/debe); fix it with \`open-sdd requirements review\` first` };
    const name = upperFirst(p.response).slice(0, 70);
    const ready = `${k.given} ${k.ready}`;
    const steps = [];
    if (p.pattern === 'event-driven')
        steps.push(ready, `${k.when} ${p.trigger}`);
    else if (p.pattern === 'unwanted')
        steps.push(ready, `${k.when} ${p.condition}`);
    else if (p.pattern === 'state-driven')
        steps.push(`${k.givenThat} ${p.state}`);
    else if (p.pattern === 'optional')
        steps.push(`${k.givenThat} ${p.feature}`);
    else if (p.pattern === 'complex')
        steps.push(`${k.givenThat} ${p.state}`, `${k.when} ${p.trigger}`);
    else
        steps.push(ready);
    steps.push(`${k.then} ${lowerFirst(p.subject)} ${p.modal} ${p.response}`.replace(/\s+/g, ' '));
    const body = steps.map((step, i) => {
        const kw = step.split(' ')[0];
        return `    ${i > 0 && kw === steps[i - 1].split(' ')[0] ? step.replace(/^\S+/, k.and) : step}`;
    });
    return { ok: true, pattern: p.pattern, text: [`  @${id} @${p.pattern}`, `  ${k.scenario}: ${name}`, ...body].join('\n') };
};
/**
 * Builds `acceptance.feature` from the parsed requirements (one scenario per acceptance criterion).
 * @param feature - feature name (the `Feature:` title).
 * @param requirements - output of `parseRequirementsMarkdown`.
 * @param lang - Gherkin keywords language.
 */
export const buildFeatureFile = (feature, requirements, lang = 'en') => {
    const k = KW[lang];
    const scenarios = [];
    const converted = [];
    const skipped = [];
    const empty = [];
    for (const req of requirements) {
        if (req.acceptanceCriteria.length === 0) {
            empty.push(req.id);
            continue;
        }
        req.acceptanceCriteria.forEach((criterion, i) => {
            const r = earsToScenario(req.id, criterion, lang);
            if (r.ok) {
                scenarios.push(r.text);
                converted.push(`${req.id}#${i + 1}`);
            }
            else
                skipped.push(r.reason);
        });
    }
    const head = [k.lang, `${k.feature}: ${feature}`].filter(Boolean).join('\n');
    return { text: `${head}\n\n${scenarios.join('\n\n')}\n`, converted, skipped, empty };
};
/**
 * Structural lint of a `.feature`: every scenario has a requirement tag, a Then step and no placeholders.
 * @param text - `.feature` content.
 * @returns problems (empty when correct).
 */
export const lintGherkin = (text) => {
    const problems = [];
    let tags = [];
    const blocks = [];
    let current = null;
    for (const raw of String(text).split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#'))
            continue;
        if (/^(?:Escenario|Scenario)\s*:/.test(line)) {
            current = { name: line.replace(/^[^:]*:\s*/, '') || '?', tags, steps: [] };
            blocks.push(current);
            tags = [];
            continue;
        }
        if (/^@\S/.test(line)) {
            current = null;
            tags = tags.concat(line.split(/\s+/));
            continue;
        }
        if (current)
            current.steps.push(line);
    }
    if (blocks.length === 0)
        return ['no scenarios'];
    for (const b of blocks) {
        if (!b.tags.some((t) => /^@REQ-/i.test(t)))
            problems.push(`"${b.name}": no @REQ-… tag (the scenario is not traced to a requirement)`);
        if (!b.steps.some((s) => /^(?:Then|Entonces)\b/.test(s)))
            problems.push(`"${b.name}": no Then/Entonces step (nothing is asserted)`);
        if (b.steps.some((s) => /<[^>]+>|\bTODO\b|TKTK|\?\?\?/.test(s)))
            problems.push(`"${b.name}": placeholder left in a step`);
    }
    return problems;
};
