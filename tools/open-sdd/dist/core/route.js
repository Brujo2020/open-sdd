/**
 * Right-size the process to the change (EVOLUTION-PLAN W8.1 row 6).
 *
 * The field's measured failure is ceremony, not its absence: spec-kit was clocked at roughly 10× the
 * time of a conventional change with thousands of lines of markdown for hundreds of lines of code
 * (Scott Logic, 2025-11-26), OpenSpec concedes the process "may not pay off" for a trivial fix, and
 * BMAD answers it with a planning-path chooser. A governance tool that demands the full triad for a
 * typo trains people to bypass it.
 *
 * `classifyChange` is deterministic and offline: it reads the intent's words, the files the change
 * will touch (declared, or forecast by `forecastImpact`) and the forecast's blast radius, and returns
 * S / M / L with the evidence behind the class and the artifact set that class needs. It is
 * conservative by construction: when the size cannot be determined, the answer is never S.
 */
const RISK_TERMS = [
    { term: /\b(auth\w*|login|password|contraseñ\w*|credential\w*|token\w*|session\w*|sesi[oó]n)\b/i, label: 'authentication' },
    { term: /\b(payment\w*|billing|invoice\w*|pago\w*|factur\w*|stripe)\b/i, label: 'money' },
    { term: /\b(migration\w*|migraci[oó]n\w*|schema\w*|esquema\w*|database|base de datos|sql)\b/i, label: 'data schema' },
    { term: /\b(delete|remove|drop|elimin\w*|borr\w*|deprecat\w*)\b/i, label: 'removal' },
    { term: /\b(breaking|public api|api p[uú]blica|endpoint\w*|contract\w*|contrato\w*)\b/i, label: 'public contract' },
    { term: /\b(security|seguridad|permission\w*|permiso\w*|privacy|privacidad|pii|gdpr|encrypt\w*|cifr\w*)\b/i, label: 'security/privacy' },
];
const TRIVIAL_TERMS = /\b(typo\w*|errata\w*|ortograf\w*|docs?|readme|comment\w*|comentari\w*|format\w*|lint\w*|whitespace|changelog|bump|wording|copy|texto)\b/i;
export const slugFromIntent = (intent) => {
    const words = intent
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 3)
        .slice(0, 4);
    return words.length > 0 ? words.join('-') : 'change';
};
export const classifyChange = (input) => {
    const evidence = [];
    const unknown = [];
    const intent = input.intent.trim();
    const slug = slugFromIntent(intent);
    const risks = RISK_TERMS.filter((risk) => risk.term.test(intent)).map((risk) => risk.label);
    if (risks.length > 0)
        evidence.push(`risk signals in the intent: ${risks.join(', ')}`);
    const trivial = TRIVIAL_TERMS.test(intent);
    if (trivial)
        evidence.push('the intent reads as cosmetic (docs, typo, formatting or a bump)');
    const declared = input.files && input.files.length > 0 ? input.files : null;
    const files = declared ?? input.forecastFiles ?? [];
    const fileCount = declared ? declared.length : files.length > 0 ? files.length : null;
    if (declared)
        evidence.push(`${declared.length} file(s) declared with --files`);
    else if (fileCount !== null)
        evidence.push(`${fileCount} file(s) the forecast points at`);
    else
        unknown.push('no files declared and none forecast: pass --files a,b to size the change');
    const radius = input.blastRadius ?? null;
    if (radius !== null)
        evidence.push(`expected blast radius: ${radius} file(s)`);
    else if (!declared)
        unknown.push('blast radius not determinable');
    const touchesTests = files.some((file) => /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.\w+$/.test(file));
    const touchesSpecsOnly = files.length > 0 && files.every((file) => /\.(md|txt|rst)$/i.test(file));
    if (touchesSpecsOnly)
        evidence.push('every touched file is prose');
    let changeClass;
    if (risks.length >= 2 || (fileCount !== null && fileCount > 10) || (radius !== null && radius > 25)) {
        changeClass = 'L';
    }
    else if (risks.length === 0 &&
        (radius === null || radius <= 3) &&
        // Sized and small, or cosmetic by its own words (a docs/typo intent needs no size to be small).
        ((fileCount !== null && (fileCount <= 2 || trivial || touchesSpecsOnly)) || (fileCount === null && trivial))) {
        changeClass = 'S';
    }
    else {
        changeClass = 'M';
    }
    if (changeClass === 'M' && unknown.length > 0)
        evidence.push('size undetermined: classified M, never S, until --files says otherwise');
    const quotedIntent = intent.replace(/"/g, "'");
    const artifacts = {
        S: ['no spec: a commit with its test is the record', 'the commit gate (C1–C3) still runs'],
        M: ['a delta spec with EARS requirements and tasks (delta.md)', 'requirements approval bound to its sha256'],
        L: [
            'the full triad: requirements.md → plan.md → tasks.md',
            'three approvals (requirements, design, tasks), each bound to its sha256',
            'execution contracts: the tests that protect the touched files',
        ],
    };
    const next = {
        S: [touchesTests || trivial ? 'git commit  # the commit gate runs C1–C3 on the index' : 'add or update a test, then git commit'],
        M: [
            `open-sdd delta init ${slug} "${quotedIntent}"`,
            `open-sdd delta validate ${slug}`,
            `open-sdd approve ${slug} --gate requirements --by "<name>"`,
        ],
        L: [
            `open-sdd delta init ${slug} "${quotedIntent}"   # or /sdd-spec-init in your agent`,
            `open-sdd brownfield forecast "${quotedIntent}"`,
            `open-sdd approve ${slug} --gate requirements --by "<name>"   # then design, then tasks`,
            `open-sdd brownfield contracts ${slug} --verify`,
        ],
    };
    return { changeClass, slug, evidence, artifacts: artifacts[changeClass], next: next[changeClass], unknown };
};
