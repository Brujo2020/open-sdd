/**
 * Documentary Triad integrity, the evidence lock and gate D1's decidable properties (§4.5, §9.7).
 *
 * The Triad is requirements.md -> plan.md -> tasks.md: requirements in EARS, architecture plus
 * impact and ADRs, and a DAG of atomic tasks that enables deterministic parallelism.
 *
 * Two honest observations are encoded rather than hidden:
 *
 *   1. This repository shipped `design.md` before the paper named `plan.md`. Both are accepted,
 *      but the alias is DECLARED here so the mapping is visible instead of guessed.
 *   2. C1 "chequea que exista una spec activa" and does not check assumptions or ambiguity — the
 *      paper says it "aprueba por proxy". So a Triad verdict of OK is a statement about
 *      PRESENCE and internal consistency, never about the quality of the content.
 */
export const TRIAD = [
    {
        canonical: 'requirements.md',
        aliases: [],
        role: 'Requisitos funcionales en sintaxis EARS.',
    },
    {
        canonical: 'plan.md',
        aliases: ['design.md'],
        role: 'Arquitectura, esquemas impactados y Architecture Decision Records. `design.md` se acepta como alias declarado de este repositorio.',
    },
    {
        canonical: 'tasks.md',
        aliases: [],
        role: 'Un grafo acíclico dirigido de tareas atómicas que habilita paralelismo determinista.',
    },
];
/** Evaluate Triad presence from the file names actually found in a spec directory. */
export const evaluateTriad = (filesPresent) => {
    const present = new Set(filesPresent.map((f) => f.toLowerCase()));
    const rows = TRIAD.map((f) => {
        const hit = [f.canonical, ...f.aliases].find((name) => present.has(name.toLowerCase()));
        return { canonical: f.canonical, presentAs: hit ?? null, role: f.role };
    });
    const missing = rows.filter((r) => r.presentAs === null).map((r) => r.canonical);
    return {
        complete: missing.length === 0,
        files: rows,
        missing,
        approvalIsByProxy: true,
        detail: missing.length === 0
            ? 'Tríada presente. C1 aprueba por proxy: verifica existencia y consistencia interna, no supuestos ni ambigüedad.'
            : `Tríada incompleta: falta ${missing.join(', ')}.`,
    };
};
// ---------------------------------------------------------------------------------------------
// Evidence lock (invariant I2)
// ---------------------------------------------------------------------------------------------
/** The marker a completed task must carry: a completed task without evidence is rejected. */
export const EVIDENCE_MARKER = '_Evidence:';
/**
 * Invariant I2 at task granularity: no completeness claim is accepted without the captured
 * output of the check that would have falsified it. Textually, a task marked complete with
 * evidence is indistinguishable from one marked complete without it — which is exactly why this
 * is a gate and not a test.
 */
export const checkEvidenceLock = (tasksMarkdown) => {
    const lines = tasksMarkdown.split(/\r?\n/);
    const findings = [];
    const taskRe = /^\s*-\s*\[( |x|X)\]\s*(\S+)?\s*(.*)$/;
    let current = null;
    const flush = () => {
        if (!current)
            return;
        findings.push({
            taskId: current.id,
            line: current.line,
            status: current.status,
            hasEvidence: current.evidence !== null,
            evidence: current.evidence,
        });
        current = null;
    };
    for (const line of lines) {
        const m = line.match(taskRe);
        if (m) {
            flush();
            const isDone = m[1].toLowerCase() === 'x';
            const id = (m[2] ?? '').replace(/[:.]$/, '') || `task@${findings.length + 1}`;
            current = {
                id,
                status: isDone ? 'completed' : 'pending',
                line: line.trim(),
                evidence: /_Evidence:/i.test(line) ? line.trim() : null,
            };
            continue;
        }
        if (current && /_Evidence:/i.test(line)) {
            current.evidence = line.trim();
        }
    }
    flush();
    const unproven = findings.filter((f) => f.status === 'completed' && !f.hasEvidence);
    return {
        satisfied: unproven.length === 0,
        checked: findings.filter((f) => f.status === 'completed').length,
        unprovenCompletions: unproven,
        detail: unproven.length === 0
            ? `${findings.filter((f) => f.status === 'completed').length} tarea(s) completadas con evidencia capturada.`
            : `${unproven.length} tarea(s) marcadas como completas sin línea ${EVIDENCE_MARKER}: una afirmación de completitud sin la salida de la comprobación que la habría falsado se rechaza.`,
    };
};
/**
 * §9.7's three DECIDABLE properties. The paper is explicit that the non-decidable part
 * (elegance, simplicity, quality of reasoning) is a warning with evidence that stops nobody, and
 * that a weak check is worse than an acknowledged gap — so these three are separated from any
 * claim about "measuring simplicity".
 */
export const checkDecidableDiscipline = (facts, budget) => {
    const lines = facts.addedLines + facts.removedLines;
    const scope = new Set(facts.declaredScope.map((s) => s.replace(/^\.\//, '')));
    const outOfScope = facts.changedFiles.filter((f) => {
        const norm = f.replace(/^\.\//, '');
        return !Array.from(scope).some((s) => norm === s || norm.startsWith(s.endsWith('/') ? s : `${s}/`));
    });
    return [
        {
            property: 'diff-budget',
            decidable: true,
            violated: lines > budget.maxLines || facts.changedFiles.length > budget.maxFiles,
            detail: `${lines} línea(s) y ${facts.changedFiles.length} fichero(s) frente al presupuesto declarado de ${budget.maxLines} líneas / ${budget.maxFiles} ficheros.`,
        },
        {
            property: 'scope-containment',
            decidable: true,
            violated: outOfScope.length > 0,
            detail: outOfScope.length === 0
                ? 'Ningún fichero fuera del alcance declarado por el nodo del DAG.'
                : `Ficheros fuera del alcance declarado: ${outOfScope.join(', ')}.`,
        },
        {
            property: 'declared-uncertainty',
            // NOT decidable from a diff. It requires the assumption register, which this call does not
            // receive, and reporting `ok` for something never inspected would be the vacuity the paper
            // rejects. Better an acknowledged gap than a weak check.
            decidable: false,
            violated: false,
            detail: 'No medible desde el diff: exige el registro de supuestos para comprobar que los puntos de incertidumbre declarados aparecen como preguntas y no como supuestos silenciosos.',
        },
    ];
};
/** The non-decidable remainder, kept as a warning that stops nobody — by design. */
export const NON_DECIDABLE_DISCIPLINE_NOTE = 'Elegancia, simplicidad y calidad del razonamiento no son decidibles: se emiten como advertencia con evidencia, alimentan la calibración del juez y no detienen a nadie. Una verificación débil es peor que una brecha reconocida.';
