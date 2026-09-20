/**
 * Cross-artifact consistency check (the open-sdd answer to spec-kit's `/speckit.analyze`).
 *
 * The toolchain already had every ingredient separately: `traceDelta` traces delta requirements to
 * tasks (both directions), `alignSpecWithConstitution` is the constitutional pivot, `extractContracts`
 * is the regression oracle, `resolveBoundaries` is the one boundary vocabulary. What was missing is
 * the ONE command that answers, in a single pass: «are requirements, plan, tasks and the delta
 * consistent with each other and with the code?».
 *
 * ── This module composes; it does not re-implement ──────────────────────────────────────────────
 * Every check below DELEGATES to the module that already owns the semantics. The pivot is called,
 * not copied; the trace is `traceDelta`'s, not a second id matcher; contracts come from
 * `extractContracts`; boundaries from `resolveBoundaries`. A second implementation would drift from
 * the first and the report would contradict the commands it aggregates.
 *
 * ── Honesty ─────────────────────────────────────────────────────────────────────────────────────
 * `checked` names every check that actually ran, with the numbers it saw; `notChecked` names every
 * check that could not run, with the REASON (no delta, no constitution, no changed files, ids that
 * are not delta ids, no declared boundary). An absent artifact is a declared gap, not a pass — the
 * house rule is that an `ok` over something that was not inspected is a lie with a report format.
 * `complete` is true only when nothing was left uninspected, independently of whether the checks
 * that ran found anything.
 *
 * Visible texts are Spanish, like the rest of the CLI.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { DELTA_ID_PATTERN, deltaSpecFileName, parseDeltaSpec, traceDelta } from './deltaSpec.js';
import { extractContracts } from './executionContract.js';
import { getModifiedFiles, isGitRepo } from './git.js';
import { resolveBoundaries, scanProject } from './reverseEngineering.js';
import { parseRequirementsMarkdown, parseTasksMarkdown, resolveSddDir } from './specManager.js';
import { alignSpecWithConstitution } from './specConstitution.js';
import { findRepoRoot, loadConstitution } from './status.js';
const SEVERITY_RANK = { error: 0, warning: 1, info: 2 };
const posix = (value) => value.split(path.sep).join('/');
const norm = (value) => posix(value.trim()).replace(/^\.\//, '').replace(/\/+$/, '');
const exists = async (p) => (await stat(p).catch(() => null)) !== null;
const readText = async (absPath) => {
    try {
        return { exists: true, content: await readFile(absPath, 'utf8') };
    }
    catch (err) {
        const code = err.code;
        if (code === 'ENOENT' || code === 'ENOTDIR')
            return { exists: false, content: null };
        // Exists but could not be read: the caller reports it as uninspected, never as empty.
        return { exists: true, content: null };
    }
};
const deriveChangedFiles = async (root, provided) => {
    if (provided !== undefined) {
        return { available: true, files: provided.map(norm).filter(Boolean), source: 'aportados por el llamante' };
    }
    if (!isGitRepo(root)) {
        return { available: false, files: [], source: '', reason: 'git no está disponible o el directorio no es un repositorio' };
    }
    return { available: true, files: getModifiedFiles(root).map(norm).filter(Boolean), source: 'árbol de trabajo e índice (git)' };
};
/** A target is comparable with a changed file when it looks like a path, not an endpoint or a verb. */
const isPathLikeTarget = (target) => {
    const value = target.trim();
    if (!value || /\s/.test(value))
        return false;
    if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i.test(value))
        return false;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value))
        return false;
    return value.includes('/') || /\.[A-Za-z0-9]+$/.test(value);
};
/** Does a changed file touch a declared target? Exact, by tail, or inside the target directory. */
const targetTouchedBy = (target, changedFiles) => {
    const t = norm(target).replace(/\/(\*\*|\*)$/, '');
    if (!t)
        return false;
    return changedFiles.some((raw) => {
        const file = norm(raw);
        return file === t || file.endsWith(`/${t}`) || t.endsWith(`/${file}`) || file.startsWith(`${t}/`);
    });
};
/** A declared contract exists when a discovered test matches it or its file is on disk. */
const contractBacked = async (root, declared, discovered) => {
    const file = norm(declared.split('::')[0] ?? declared);
    if (!file)
        return false;
    if (discovered.some((test) => norm(test.split('::')[0] ?? test) === file))
        return true;
    return exists(path.join(root, file));
};
/**
 * Does a boundary cover anything the code shows? True when the path exists, when it contains an
 * observed source/test directory, or when it lives inside one. `resolveBoundaries` supplies the
 * anchors, so the module map, the constitution and this check never disagree about where code is.
 */
const boundaryCoversSomething = async (root, boundary, anchors) => {
    const b = norm(boundary).replace(/\/(\*\*|\*)$/, '');
    if (!b)
        return false;
    if (b === '.' || b === '*' || b === '**')
        return anchors.length > 0;
    if (await exists(path.join(root, b)))
        return true;
    return anchors.some((anchor) => {
        const a = norm(anchor);
        if (!a)
            return false;
        return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
    });
};
const uniqueSorted = (values) => Array.from(new Set(values)).sort();
/** A `requirements.md` whose ids follow the delta grammar, traceable with the SAME matcher. */
const traceSourceFromRequirements = (markdown, feature, path) => {
    const ids = parseRequirementsMarkdown(markdown)
        .map((requirement) => requirement.id.toUpperCase())
        .filter((id) => DELTA_ID_PATTERN.test(id));
    if (ids.length === 0)
        return null;
    return {
        delta: {
            feature,
            title: 'requirements.md',
            status: 'approved',
            entries: ids.map((id) => ({ id, kind: 'ADDED', title: '', statement: '', targets: [] })),
        },
        ids,
        label: 'requirements.md',
        path,
    };
};
export const checkConsistency = async (input) => {
    const root = await findRepoRoot(input.cwd);
    const sddDir = input.sddDir ?? (await resolveSddDir(root));
    const feature = input.feature;
    const specDirRel = posix(path.join(sddDir, 'specs', feature));
    const requirementsRel = `${specDirRel}/requirements.md`;
    const planRel = `${specDirRel}/plan.md`;
    const designRel = `${specDirRel}/design.md`;
    const tasksRel = `${specDirRel}/tasks.md`;
    const deltaRel = `${specDirRel}/${deltaSpecFileName()}`;
    const findings = [];
    const checked = [];
    const notChecked = [];
    const requirementsRead = await readText(path.join(root, requirementsRel));
    const planRead = await readText(path.join(root, planRel));
    const designRead = await readText(path.join(root, designRel));
    const tasksRead = await readText(path.join(root, tasksRel));
    const deltaRead = await readText(path.join(root, deltaRel));
    const requirements = requirementsRead.content;
    const plan = planRead.content ?? designRead.content;
    const tasks = tasksRead.content;
    const deltaRaw = deltaRead.content;
    const present = [requirements, plan, tasks, deltaRaw].filter((text) => text !== null).length;
    if (present === 0 && !requirementsRead.exists && !planRead.exists && !designRead.exists && !tasksRead.exists && !deltaRead.exists) {
        for (const name of [
            'trazabilidad requisito→tarea',
            'objetivos de la delta contra los ficheros cambiados',
            'pivote constitucional',
            'contratos declarados',
            'fronteras declaradas contra el código',
        ]) {
            notChecked.push(`${name}: no existe ${specDirRel}, así que no hay nada que inspeccionar`);
        }
        return {
            feature,
            findings: [
                {
                    severity: 'error',
                    code: 'FEATURE_NOT_FOUND',
                    message: `No existe ${specDirRel}: no hay artefactos que contrastar entre sí.`,
                    artifacts: [specDirRel],
                },
            ],
            checked,
            notChecked,
            complete: false,
            detail: `Consistencia de "${feature}": 1 error(0); la especificación no existe, así que ninguna comprobación se ha ejecutado.`,
        };
    }
    // Files that exist but could not be read are declared, never treated as absent or empty.
    const unreadable = [];
    const trackUnreadable = (rel, read) => {
        if (read.exists && read.content === null)
            unreadable.push(rel);
    };
    trackUnreadable(requirementsRel, requirementsRead);
    trackUnreadable(planRel, planRead);
    trackUnreadable(designRel, designRead);
    trackUnreadable(tasksRel, tasksRead);
    trackUnreadable(deltaRel, deltaRead);
    for (const rel of unreadable)
        notChecked.push(`${rel}: existe pero no se pudo leer, así que no se inspeccionó`);
    const specArtifacts = uniqueSorted([
        ...(requirements !== null ? [requirementsRel] : []),
        ...(planRead.content !== null ? [planRel] : []),
        ...(designRead.content !== null ? [designRel] : []),
        ...(tasks !== null ? [tasksRel] : []),
        ...(deltaRaw !== null ? [deltaRel] : []),
    ]);
    const delta = deltaRaw === null ? undefined : parseDeltaSpec(deltaRaw);
    const project = await scanProject(root);
    const changed = await deriveChangedFiles(root, input.changedFiles);
    const changedForPivot = changed.available ? changed.files : [];
    // ── 1. requirement → task, and task → requirement (traceDelta, both directions) ───────────────
    if (tasks === null) {
        notChecked.push('trazabilidad requisito→tarea: no existe tasks.md');
    }
    else {
        const traceSource = delta
            ? { delta, ids: delta.entries.map((entry) => entry.id.toUpperCase()), label: 'delta.md', path: deltaRel }
            : requirements !== null
                ? traceSourceFromRequirements(requirements, feature, requirementsRel)
                : null;
        if (!traceSource) {
            notChecked.push(requirements === null
                ? 'trazabilidad requisito→tarea: no hay delta.md ni requirements.md que trazar'
                : 'trazabilidad requisito→tarea: los ids de requirements.md no siguen la forma REQ-<ÁREA>-<NNN>, así que el trazador de delta no puede casarlos');
        }
        else {
            const parsedTasks = parseTasksMarkdown(tasks);
            const trace = traceDelta(traceSource.delta, parsedTasks);
            // A task may legitimately cite a base requirement while a delta exists: an id that lives in
            // either artifact is known, and only an id in NEITHER is a phantom.
            const knownIds = new Set(traceSource.ids);
            if (delta && requirements !== null) {
                for (const requirement of parseRequirementsMarkdown(requirements))
                    knownIds.add(requirement.id.toUpperCase());
            }
            checked.push(`trazabilidad requisito→tarea (${traceSource.label}: ${traceSource.ids.length} requisito(s) sobre ${parsedTasks.length} tarea(s))`);
            for (const id of trace.unmapped) {
                findings.push({
                    severity: 'error',
                    code: 'REQUIREMENT_WITHOUT_TASK',
                    message: `El requisito ${id} de ${traceSource.label} no tiene ninguna tarea que lo implemente: una obligación sin tarea es una obligación que nadie va a cumplir.`,
                    artifacts: uniqueSorted([traceSource.path, tasksRel]),
                });
            }
            for (const phantom of trace.phantomTasks) {
                if (knownIds.has(phantom.cited.toUpperCase()))
                    continue;
                findings.push({
                    severity: 'error',
                    code: 'PHANTOM_REQUIREMENT_ID',
                    message: `La tarea ${phantom.taskId} cita ${phantom.cited}, que no existe en ${traceSource.label}: una tarea que apunta a un requisito inexistente no es trazable.`,
                    artifacts: uniqueSorted([tasksRel, traceSource.path]),
                });
            }
        }
    }
    // ── 2. delta targets that no changed file touches ─────────────────────────────────────────────
    if (!delta) {
        notChecked.push('objetivos de la delta contra los ficheros cambiados: no existe delta.md');
    }
    else if (!changed.available) {
        notChecked.push(`objetivos de la delta contra los ficheros cambiados: ${changed.reason ?? 'no se pudieron obtener los ficheros cambiados'}`);
    }
    else if (changed.files.length === 0) {
        notChecked.push(`objetivos de la delta contra los ficheros cambiados: no hay ficheros cambiados que analizar (origen: ${changed.source})`);
    }
    else {
        let decided = 0;
        const untouched = [];
        for (const entry of delta.entries) {
            const pathTargets = entry.targets.filter(isPathLikeTarget);
            if (pathTargets.length === 0) {
                notChecked.push(`objetivos de ${entry.id}: ningún objetivo es una ruta comparable con un fichero (${entry.targets.join(', ') || 'sin objetivos'})`);
                continue;
            }
            decided += 1;
            if (pathTargets.some((target) => targetTouchedBy(target, changed.files)))
                continue;
            untouched.push({ id: entry.id, targets: pathTargets });
        }
        // Two different situations live here and they deserve different severities: a diff that touches
        // SOME of the delta (the work is in flight — one warning per pending entry) and a diff that
        // touches NONE of it (the delta and the change are unrelated — an error).
        const unrelated = decided > 0 && untouched.length === decided;
        for (const entry of untouched) {
            findings.push({
                severity: unrelated ? 'error' : 'warning',
                code: 'DELTA_TARGET_UNTOUCHED',
                message: unrelated
                    ? `Ningún fichero cambiado toca NINGÚN objetivo de la delta; el primero es ${entry.id} (${entry.targets.join(', ')}): el cambio y la delta hablan de cosas distintas.`
                    : `Ningún fichero cambiado toca los objetivos de ${entry.id} (${entry.targets.join(', ')}): la delta declara un cambio que este diff todavía no respalda.`,
                artifacts: uniqueSorted([deltaRel, ...entry.targets]),
            });
        }
        checked.push(`objetivos de la delta contra los ficheros cambiados (${decided}/${delta.entries.length} entrada(s) con objetivo de ruta, ${decided - untouched.length} con objetivo tocado por el diff, ${changed.files.length} fichero(s) cambiado(s), origen: ${changed.source})`);
    }
    // ── 3. the constitutional pivot (reused, never re-implemented) ─────────────────────────────────
    const constitutionRead = await loadConstitution(root, sddDir);
    if (!constitutionRead.exists || constitutionRead.constitution === null) {
        notChecked.push(constitutionRead.exists
            ? `pivote constitucional: ${constitutionRead.path} existe pero no se pudo leer`
            : `pivote constitucional: no existe ${posix(path.join(sddDir, 'steering', 'constitution.md'))} — sin autoridad en vigor no hay contradicción que comprobar`);
    }
    else {
        const alignment = alignSpecWithConstitution({
            feature,
            constitution: constitutionRead.constitution,
            ...(requirements !== null ? { requirements } : {}),
            ...(plan !== null ? { plan } : {}),
            ...(tasks !== null ? { tasks } : {}),
            ...(delta ? { delta } : {}),
            changedFiles: changedForPivot,
        });
        checked.push(`pivote constitucional (${alignment.declared.length} principio(s) declarado(s), alineación ${(alignment.alignment * 100).toFixed(0)}%)`);
        for (const finding of alignment.findings) {
            const artifacts = new Set(specArtifacts);
            if (finding.artifactId && finding.artifactId.includes('/'))
                artifacts.add(norm(finding.artifactId));
            if (finding.artifactId && /^REQ-/i.test(finding.artifactId) && deltaRaw !== null)
                artifacts.add(deltaRel);
            findings.push({
                severity: finding.severity,
                code: finding.code,
                message: finding.message,
                artifacts: Array.from(artifacts).sort(),
            });
        }
        const gaps = alignment.detail.match(/No evaluado:\s*(.+?)\.(?:\s|$)/);
        if (gaps)
            notChecked.push(`pivote constitucional — ${gaps[1]}`);
    }
    // ── 4. declared contracts that do not exist (extractContracts) ─────────────────────────────────
    if (!delta) {
        notChecked.push('contratos declarados: no existe delta.md, así que la delta no declara ningún contrato');
    }
    else {
        const declaredContracts = delta.entries.flatMap((entry) => (entry.contracts ?? []).map((test) => ({ entry: entry.id, test })));
        if (declaredContracts.length === 0) {
            checked.push('contratos declarados: la delta no declara ningún contrato (nada que comprobar)');
            findings.push({
                severity: 'info',
                code: 'NO_DECLARED_CONTRACTS',
                message: 'La delta no declara ningún contrato de ejecución: no hay un oráculo declarado que demuestre que lo existente sigue intacto (los contratos descubiertos solo existen si hay ficheros cambiados).',
                artifacts: [deltaRel],
            });
        }
        else {
            const set = await extractContracts({
                cwd: root,
                feature,
                changedFiles: changedForPivot,
                delta,
                testDirs: project.testDirs,
                ...(project.testFramework ? { testFramework: project.testFramework } : {}),
            });
            const discovered = set.contracts.filter((contract) => contract.source === 'discovered').map((contract) => contract.test);
            const missing = [];
            for (const declared of declaredContracts) {
                if (await contractBacked(root, declared.test, discovered))
                    continue;
                missing.push(declared);
            }
            checked.push(`contratos declarados (${declaredContracts.length} declarado(s), ${discovered.length} descubierto(s), comando propuesto: ${set.testCommand})`);
            for (const item of missing) {
                findings.push({
                    severity: 'error',
                    code: 'DECLARED_CONTRACT_MISSING',
                    message: `La entrada ${item.entry} declara el contrato "${item.test}", que no existe en el conjunto extraído ni como fichero: el oráculo promete una protección que el repositorio no tiene.`,
                    artifacts: uniqueSorted([deltaRel]),
                });
            }
            if (!set.complete && missing.length === 0) {
                notChecked.push(`contratos de ejecución: ${set.detail}`);
            }
        }
    }
    // ── 5. declared boundaries against the code (resolveBoundaries) ────────────────────────────────
    const boundarySet = resolveBoundaries(project);
    if (tasks === null) {
        notChecked.push('fronteras declaradas contra el código: no existe tasks.md, y las fronteras se declaran con _Boundary:_');
    }
    else {
        const declaredBoundaries = uniqueSorted(parseTasksMarkdown(tasks)
            .flatMap((task) => task.boundary ?? [])
            .map(norm)
            .filter(Boolean));
        if (declaredBoundaries.length === 0) {
            findings.push({
                severity: 'warning',
                code: 'NO_DECLARED_BOUNDARY',
                message: 'Ninguna tarea declara `_Boundary:_`, así que la spec no dice qué código posee: sin frontera declarada no hay forma de detectar que el cambio se sale de su alcance.',
                artifacts: [tasksRel],
            });
            notChecked.push('fronteras declaradas contra el código: la spec no declara ninguna _Boundary:_');
        }
        else {
            const anchors = uniqueSorted([...boundarySet.boundaries, ...project.sourceDirs, ...project.testDirs].map(norm).filter(Boolean));
            const empty = [];
            for (const boundary of declaredBoundaries) {
                if (!(await boundaryCoversSomething(root, boundary, anchors)))
                    empty.push(boundary);
            }
            checked.push(`fronteras declaradas contra el código (${declaredBoundaries.length} frontera(s) declarada(s), ${anchors.length} ancla(s) observada(s))`);
            if (empty.length > 0) {
                findings.push({
                    severity: empty.length === declaredBoundaries.length ? 'error' : 'warning',
                    code: 'BOUNDARY_COVERS_NOTHING',
                    message: empty.length === declaredBoundaries.length
                        ? `Ninguna de las fronteras declaradas (${empty.join(', ')}) corresponde a código que el repositorio muestre: la spec se declara dueña de rutas que no existen ni caen dentro de ningún directorio observado.`
                        : `Estas fronteras declaradas no corresponden a código observado: ${empty.join(', ')}. Las demás sí.`,
                    artifacts: uniqueSorted([tasksRel, ...empty]),
                });
            }
        }
    }
    const ordered = [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        a.code.localeCompare(b.code) ||
        (a.artifacts[0] ?? '').localeCompare(b.artifacts[0] ?? '') ||
        a.message.localeCompare(b.message));
    const errors = ordered.filter((finding) => finding.severity === 'error').length;
    const warnings = ordered.filter((finding) => finding.severity === 'warning').length;
    const infos = ordered.filter((finding) => finding.severity === 'info').length;
    const complete = notChecked.length === 0;
    const detail = [
        `Consistencia de "${feature}": ${errors} error(es), ${warnings} aviso(s), ${infos} info; ${checked.length} comprobación(es) ejecutada(s)${complete ? '' : `, ${notChecked.length} sin inspeccionar: ${notChecked.join('; ')}`}.`,
        errors === 0 && checked.length > 0
            ? 'Sin errores en lo inspeccionado; lo que no se inspeccionó está declarado arriba y no cuenta como aprobado.'
            : '',
    ]
        .filter(Boolean)
        .join(' ');
    return { feature, findings: ordered, checked, notChecked, complete, detail };
};
