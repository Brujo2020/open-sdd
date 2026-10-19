/**
 * `open-sdd standards` — la consola del motor de estándares (W2, REQ-STD-003).
 *
 * Cuatro verbos de lectura y uno de escritura:
 *   list              — el catálogo cargado, con su postura (advisoria o no)
 *   show <id>         — la entrada completa
 *   explain <id>      — por qué la regla existe y qué la implementa, resuelto OFFLINE del catálogo
 *   check [--json]    — corre cada estándar sobre los artefactos que declara `appliesTo`
 *   fix <id> [--apply]— aplica SOLO remedios `machine-applicable`; un `needs-human` se rechaza con
 *                       la pregunta que nombra el dato que falta (REQ-STD-008)
 *
 * ── Advisoria no es «ok» ────────────────────────────────────────────────────────────────────────
 * `check` sale con 1 únicamente cuando un hallazgo viene de una entrada que PUEDE bloquear
 * (`isBlocking`: `blocking: true` Y corpus medido, REQ-STD-005). Un catálogo sin calibrar informa y
 * no rompe la construcción: eso es lo que la decisión 3 del plan pide. Una entrada que no pudo
 * inspeccionar aparece en `skipped`, nunca como un pase.
 *
 * ── Un solo sobre ───────────────────────────────────────────────────────────────────────────────
 * `--json` usa `cli/jsonOut.ts`: `data` lleva los registros completos y `findings` la proyección
 * estable. Un hallazgo advisorio viaja como aviso, jamás como error, porque no detiene nada.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { colors } from '../ui/colors.js';
import { jsonEnvelope } from '../jsonOut.js';
import { STANDARDS_DIR, appliesToArtifact, discoverArtifacts, isBlocking, loadStandards, runStandard, } from '../../core/standards.js';
import { detectDrift } from '../../core/standardsRender.js';
const USAGE = 'Usage: open-sdd standards <list|show <id>|explain <id>|check|fix <id>> [--json] [--apply]';
/**
 * Transformaciones que el motor sabe aplicar sin juicio. Se indexan por id de estándar y reciben el
 * hallazgo para localizar el tramo exacto que se reescribe. Un remedio `machine-applicable` sin
 * operación registrada se rechaza con una pregunta: nunca un no-op silencioso.
 */
const MACHINE_APPLICABLE_FIXES = {
    'REQ-EARS-010': (text, findings) => {
        const offsetAt = (line, column) => {
            let index = 0;
            for (let current = 1; current < line; current += 1) {
                const next = text.indexOf('\n', index);
                if (next < 0)
                    return -1;
                index = next + 1;
            }
            return index + (column - 1);
        };
        const edits = [];
        for (const finding of findings) {
            const start = offsetAt(finding.line, finding.column);
            if (start < 0)
                continue;
            const span = text.slice(start, start + (finding.span?.length ?? 0));
            if (!/^(?:when|while|where|if)$/i.test(span) || span === span.toUpperCase())
                continue;
            edits.push({ start, end: start + span.length, replacement: span.toUpperCase() });
        }
        edits.sort((a, b) => b.start - a.start);
        let next = text;
        for (const edit of edits)
            next = next.slice(0, edit.start) + edit.replacement + next.slice(edit.end);
        return { text: next, applied: edits.length };
    },
};
const posture = (entry) => isBlocking(entry) ? 'blocking' : 'advisory until a measured corpus exists';
const renderEntry = (entry, explain) => {
    const lines = [];
    lines.push(colors.bold(`${entry.id} — ${entry.title}`));
    lines.push(`  category: ${entry.category}`);
    lines.push(`  severity: ${entry.severity}`);
    lines.push(`  posture: ${posture(entry)}`);
    lines.push(`  applies to: ${entry.appliesTo.join(', ')}`);
    lines.push(`  standard: ${entry.standard}`);
    lines.push(`  source: ${entry.source}`);
    const patterns = entry.detect.patterns ?? [];
    lines.push(`  detection: ${entry.detect.kind}${patterns.length > 0 ? ` — ${patterns.join(', ')}` : ''}`);
    lines.push(`  message: ${entry.message}`);
    lines.push(`  evidence: ${entry.evidence}`);
    const corpus = entry.calibrated.corpus;
    lines.push(`  calibration: ${typeof corpus === 'string' && corpus.length > 0
        ? `corpus ${corpus}, recall ${entry.calibrated.recall}, fpr ${entry.calibrated.fpr}`
        : 'not measured'}`);
    if (entry.remedy.grades.length === 0) {
        lines.push('  remedies: none — this standard asks for the missing datum instead of prescribing');
    }
    else {
        lines.push('  remedies:');
        for (const remedy of entry.remedy.grades) {
            lines.push(`    - ${remedy.grade}: ${remedy.text}${remedy.note === undefined ? '' : ` (${remedy.note})`}`);
        }
    }
    if (explain) {
        lines.push(`  why: blocking is only honoured when \`calibrated.corpus\` is a measured string (REQ-STD-005); this entry is ${posture(entry)}`);
        lines.push('  offline: resolved from the catalogue, no network call');
    }
    return lines;
};
const renderFinding = (finding) => {
    const lines = [];
    lines.push(`${colors.yellow(finding.severity)} ${finding.standardId} ${finding.file}:${finding.line}:${finding.column}${finding.span === undefined ? '' : ` (${JSON.stringify(finding.span)})`}`);
    lines.push(`  ${finding.message}`);
    if (finding.question !== undefined)
        lines.push(`  question: ${finding.question}`);
    for (const remedy of finding.remedies)
        lines.push(`  fix(${remedy.grade}): ${remedy.text}`);
    return lines;
};
const loadContext = async (cwd) => {
    const { entries, rejected } = await loadStandards(cwd);
    return { entries, rejected, byId: new Map(entries.map((entry) => [entry.id, entry])) };
};
const catalogueSummary = (entry) => ({
    id: entry.id,
    title: entry.title,
    category: entry.category,
    severity: entry.severity,
    advisory: !isBlocking(entry),
    blocking: isBlocking(entry),
    appliesTo: entry.appliesTo,
    standard: entry.standard,
    source: entry.source,
    evidence: entry.evidence,
    detection: entry.detect.kind,
});
const standardFindingRecord = (finding) => ({
    id: finding.standardId,
    severity: finding.severity,
    file: finding.file,
    line: finding.line,
    column: finding.column,
    ...(finding.span === undefined ? {} : { span: finding.span }),
    message: finding.message,
    remedies: finding.remedies,
    ...(finding.question === undefined ? {} : { question: finding.question }),
});
export const handleStandardsCommand = async (args, io, cwd = process.cwd()) => {
    const json = args.includes('--json');
    const apply = args.includes('--apply');
    const positional = args.filter((arg) => !arg.startsWith('-'));
    const [sub, id] = positional;
    if (sub === undefined || sub === 'list') {
        const { entries, rejected } = await loadContext(cwd);
        if (json) {
            io.log(JSON.stringify(jsonEnvelope({
                command: 'standards list',
                data: { standardsDir: STANDARDS_DIR, entries: entries.map(catalogueSummary), rejected },
                warnings: rejected.map((r) => ({ id: r.file, message: r.reason })),
                detail: entries.length === 0
                    ? `no hay catálogo en \`${STANDARDS_DIR}\``
                    : `${entries.length} estándar(es), ${entries.filter((e) => isBlocking(e)).length} blocking`,
            }), null, 2));
            return 0;
        }
        if (entries.length === 0) {
            io.log(colors.yellow(`no hay catálogo de estándares en ${STANDARDS_DIR}`));
        }
        for (const entry of entries) {
            const tag = isBlocking(entry) ? colors.red('blocking') : colors.dim('advisory');
            io.log(`${entry.id.padEnd(16)} ${entry.severity.padEnd(8)} ${tag}  ${entry.title}`);
        }
        for (const rejectedEntry of rejected) {
            io.error(colors.red(`rejected ${rejectedEntry.file}: ${rejectedEntry.reason}`));
        }
        return 0;
    }
    if (sub === 'show' || sub === 'explain') {
        if (id === undefined || id.trim().length === 0) {
            io.error(colors.red(USAGE));
            return 1;
        }
        const { byId, rejected } = await loadContext(cwd);
        const entry = byId.get(id);
        if (entry === undefined) {
            io.error(colors.red(`estándar desconocido: ${id}`));
            io.error(colors.dim('open-sdd standards list'));
            return 1;
        }
        if (json) {
            const data = sub === 'show'
                ? { entry }
                : {
                    entry,
                    advisory: !isBlocking(entry),
                    blocking: isBlocking(entry),
                    rationale: 'blocking is only honoured when calibrated.corpus is a measured string (REQ-STD-005)',
                    offline: true,
                };
            io.log(JSON.stringify(jsonEnvelope({
                command: `standards ${sub}`,
                data,
                warnings: rejected.map((r) => ({ id: r.file, message: r.reason })),
                detail: `${entry.id}: ${entry.title}`,
            }), null, 2));
            return 0;
        }
        for (const line of renderEntry(entry, sub === 'explain'))
            io.log(line);
        return 0;
    }
    if (sub === 'check') {
        const { entries, rejected } = await loadContext(cwd);
        const artifacts = await discoverArtifacts(cwd, entries);
        const findings = [];
        const skipped = [];
        for (const entry of entries) {
            const applicable = artifacts.filter((artifact) => appliesToArtifact(entry, artifact.file));
            if (applicable.length === 0) {
                skipped.push({ id: entry.id, reason: `ningún artefacto en \`${cwd}\` casa con \`${entry.appliesTo.join(', ')}\`` });
                continue;
            }
            for (const artifact of applicable) {
                for (const finding of runStandard(entry, artifact))
                    findings.push({ entry, finding });
            }
        }
        const blockingFindings = findings.filter(({ entry }) => isBlocking(entry));
        const drift = await detectDrift(cwd, entries);
        if (json) {
            io.log(JSON.stringify(jsonEnvelope({
                command: 'standards check',
                data: {
                    standardsDir: STANDARDS_DIR,
                    artifacts: artifacts.map((a) => a.file),
                    findings: findings.map(({ entry, finding }) => ({
                        standardId: entry.id,
                        title: entry.title,
                        ...standardFindingRecord(finding),
                    })),
                    skipped,
                    rejected,
                    drift,
                },
                ok: blockingFindings.length === 0,
                errors: blockingFindings.map(({ finding }) => ({
                    id: finding.standardId,
                    message: finding.message,
                    artifact: `${finding.file}:${finding.line}:${finding.column}`,
                })),
                warnings: [
                    ...findings
                        .filter(({ entry }) => !isBlocking(entry))
                        .map(({ finding }) => ({
                        id: finding.standardId,
                        message: finding.message,
                        artifact: `${finding.file}:${finding.line}:${finding.column}`,
                    })),
                    ...skipped.map((s) => ({ id: s.id, message: `skipped: ${s.reason}` })),
                    ...rejected.map((r) => ({ id: r.file, message: r.reason })),
                    ...drift.map((d) => ({ id: d.file, message: `drift (${d.reason}): ${d.entries.join(', ')}` })),
                ],
                detail: `${findings.length} hallazgo(s), ${blockingFindings.length} blocking, ${skipped.length} skipped, ${drift.length} drifted`,
            }), null, 2));
            return blockingFindings.length === 0 ? 0 : 1;
        }
        if (entries.length === 0) {
            io.log(colors.yellow(`no hay catálogo de estándares en ${STANDARDS_DIR}: nada que comprobar`));
        }
        for (const { finding } of findings) {
            for (const line of renderFinding(finding))
                io.log(line);
        }
        for (const s of skipped)
            io.log(colors.dim(`skipped ${s.id}: ${s.reason}`));
        for (const r of rejected)
            io.error(colors.red(`rejected ${r.file}: ${r.reason}`));
        for (const d of drift)
            io.log(colors.dim(`drift ${d.file} (${d.reason}): ${d.entries.join(', ')}`));
        const summary = `${findings.length} hallazgo(s), ${blockingFindings.length} blocking, ${skipped.length} skipped, ${drift.length} drifted`;
        io.log(blockingFindings.length === 0 ? summary : colors.red(summary));
        return blockingFindings.length === 0 ? 0 : 1;
    }
    if (sub === 'fix') {
        if (id === undefined || id.trim().length === 0) {
            io.error(colors.red(USAGE));
            return 1;
        }
        const { byId, rejected } = await loadContext(cwd);
        const entry = byId.get(id);
        if (entry === undefined) {
            io.error(colors.red(`estándar desconocido: ${id}`));
            io.error(colors.dim('open-sdd standards list'));
            return 1;
        }
        const artifacts = await discoverArtifacts(cwd, [entry]);
        const applicable = artifacts.filter((artifact) => appliesToArtifact(entry, artifact.file));
        const findingsByFile = applicable.map((artifact) => ({ artifact, findings: runStandard(entry, artifact) }));
        const total = findingsByFile.reduce((sum, item) => sum + item.findings.length, 0);
        const machine = entry.remedy.grades.filter((grade) => grade.grade === 'machine-applicable');
        const human = entry.remedy.grades.find((grade) => grade.grade === 'needs-human');
        if (total === 0) {
            if (json) {
                io.log(JSON.stringify(jsonEnvelope({
                    command: 'standards fix',
                    data: { id: entry.id, applied: [], findings: [], rejected },
                    ok: true,
                    detail: `\`${entry.id}\` no encontró nada que arreglar en los artefactos declarados`,
                }), null, 2));
                return 0;
            }
            io.log(`\`${entry.id}\` no encontró nada que arreglar en los artefactos declarados`);
            return 0;
        }
        if (machine.length === 0) {
            const question = human?.text ?? `\`${entry.id}\` no declara ningún remedio aplicable por máquina`;
            if (json) {
                io.log(JSON.stringify(jsonEnvelope({
                    command: 'standards fix',
                    data: {
                        id: entry.id,
                        applied: [],
                        refused: { grade: human === undefined ? 'needs-human' : human.grade, question },
                        findings: findingsByFile.flatMap((item) => item.findings.map((finding) => standardFindingRecord(finding))),
                        rejected,
                    },
                    ok: false,
                    errors: [{ id: entry.id, message: question }],
                    detail: `\`${entry.id}\` exige una persona: ${question}`,
                }), null, 2));
                return 1;
            }
            io.error(colors.red(`\`${entry.id}\` no se aplica solo: ${question}`));
            io.log(colors.dim('responde la pregunta y vuelve a ejecutar `open-sdd standards check`'));
            return 1;
        }
        const transform = MACHINE_APPLICABLE_FIXES[entry.id];
        if (transform === undefined) {
            const question = `\`${entry.id}\` declara un remedio \`machine-applicable\` pero el motor no conoce su operación`;
            if (json) {
                io.log(JSON.stringify(jsonEnvelope({
                    command: 'standards fix',
                    data: { id: entry.id, applied: [], refused: { grade: 'machine-applicable', question }, rejected },
                    ok: false,
                    errors: [{ id: entry.id, message: question }],
                    detail: question,
                }), null, 2));
                return 1;
            }
            io.error(colors.red(question));
            return 1;
        }
        if (!apply) {
            if (json) {
                io.log(JSON.stringify(jsonEnvelope({
                    command: 'standards fix',
                    data: {
                        id: entry.id,
                        applied: [],
                        preview: findingsByFile.map((item) => ({
                            file: item.artifact.file,
                            findings: item.findings.map((finding) => standardFindingRecord(finding)),
                        })),
                        machineApplicable: machine.map((grade) => grade.text),
                        rejected,
                    },
                    ok: true,
                    detail: `${total} hallazgo(s) con remedio \`machine-applicable\`; añade \`--apply\` para escribirlos`,
                }), null, 2));
                return 0;
            }
            for (const item of findingsByFile) {
                for (const finding of item.findings)
                    for (const line of renderFinding(finding))
                        io.log(line);
            }
            io.log(colors.dim('preview: añade `--apply` para escribir los remedios `machine-applicable`'));
            return 0;
        }
        const applied = [];
        for (const item of findingsByFile) {
            const result = transform(item.artifact.text, item.findings);
            if (result.applied === 0 || result.text === item.artifact.text)
                continue;
            await writeFile(path.resolve(cwd, item.artifact.file), result.text, 'utf8');
            applied.push({ file: item.artifact.file, applied: result.applied });
        }
        if (json) {
            io.log(JSON.stringify(jsonEnvelope({
                command: 'standards fix',
                data: { id: entry.id, applied, rejected },
                ok: true,
                detail: `\`${entry.id}\`: ${applied.reduce((sum, a) => sum + a.applied, 0)} cambio(s) en ${applied.length} fichero(s)`,
            }), null, 2));
            return 0;
        }
        for (const item of applied)
            io.log(colors.green(`applied ${item.applied} cambio(s) en ${item.file}`));
        if (applied.length === 0)
            io.log(`\`${entry.id}\` no cambió nada`);
        return 0;
    }
    io.error(colors.red(USAGE));
    return 1;
};
