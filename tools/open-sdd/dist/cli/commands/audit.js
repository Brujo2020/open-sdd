/**
 * Audit evidence bundle (REQ-MAT-006) and SARIF 2.1.0 reporting (REQ-MAT-007).
 *
 * Two commands share this module:
 *
 *   audit <feature> [--regulatory] [--strict] [--json]
 *       The pre-existing compliance report (EU AI Act / NIST). Unchanged.
 *
 *   audit bundle [feature] [--out <dir>] [--json] [--sarif <path>]
 *   audit sarif  [feature] [--out <path>]
 *       An evidence bundle an auditor can read: the constitution (text, principles in force,
 *       compliance matrix), every spec, the gate chain results, the claims registry verdict, the
 *       constitutional alignment report and the declared rigor level with its active gates.
 *       Every artifact is written to disk with a sha256 in `manifest.json`, which also carries
 *       the tool version and the generation timestamp.
 *
 * The bundle is assembled by REUSING the modules that already decide each verdict — `runChain`,
 * `runClaimsRegistry`, `alignSpecWithConstitution`, `assessRigor`, `buildComplianceMatrix` — never
 * by re-implementing their logic. That is the whole point of an evidence bundle: it records what
 * the tool actually decided, so a third party can recompute every hash and re-read every verdict.
 *
 * Honesty rules that the shape enforces:
 *  - an absent artifact is recorded as `present: false` with a null hash, never as an empty file;
 *  - the exit code is the blocking contract (0 = pass, 1 = blocking finding, 2 = could not run);
 *    only a gate FAIL or a BROKEN claim is blocking. Alignment findings are severity-ranked in the
 *    report and the SARIF, but they do not silently become a different contract than the one the
 *    CLI documents;
 *  - `audit sarif` emits the same findings as SARIF without writing the bundle to disk.
 *
 * SARIF shape (OASIS SARIF 2.1.0, minimal but valid): one `run`, the tool as `tool.driver`, and one
 * `result` per finding with `ruleId`, `level`, `message.text` and a `physicalLocation`.
 * `validateSarifShape` is the validator-free correctness check: every result must carry those four
 * fields, every `ruleId` must be declared in `driver.rules`, and `version`/`$schema` must be the
 * exact 2.1.0 values.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { colors, formatHeading, formatSuccess, formatWarning } from '../ui/colors.js';
import { jsonEnvelope } from '../jsonOut.js';
import { auditAll, auditFeature } from '../../core/auditEngine.js';
import { listSpecs, resolveSddDir } from '../../core/specManager.js';
import { governanceProfiles, loadGovernanceSettings } from '../../core/governance.js';
import { findRepoRoot } from '../../core/status.js';
import { runChain } from '../../core/gateRunner.js';
import { resolveGateChain } from '../../core/gateCatalog.js';
import { parseSecurityAllowlist } from '../../core/securityAllowlist.js';
import { buildComplianceMatrix, parseConstitution, principlesInForce, } from '../../core/constitution.js';
import { alignSpecWithConstitution } from '../../core/specConstitution.js';
import { evaluateTriad } from '../../core/triad.js';
import { parseDeltaSpec } from '../../core/deltaSpec.js';
import { assessRigor, effectiveGates, loadRigorSettings, } from '../../core/rigor.js';
import { readClaimsRegistry, runClaimsRegistry } from '../../core/claimsRegistry.js';
import { detectRepoSignals } from './paper.js';
// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------
/** Schema id of the manifest written by `audit bundle`. */
export const AUDIT_BUNDLE_SCHEMA = 'open-sdd.audit-bundle/1';
/** Exact SARIF version this module emits. */
export const SARIF_VERSION = '2.1.0';
/** The canonical 2.1.0 schema location published by the OASIS SARIF TC. */
export const SARIF_SCHEMA = 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json';
/**
 * The exit-code contract, shared with `ci-integration.md` and `action.yml`.
 * 0 = pass, 1 = a blocking finding (gate FAIL or broken claim), 2 = the audit could not run.
 */
export const AUDIT_EXIT_CODES = { pass: 0, blocking: 1, couldNotRun: 2 };
const DEFAULT_CLAIMS_PATH = 'docs/claims/paper-claims.yaml';
const DEFAULT_CLAIMS_TIMEOUT_MS = 60_000;
/** Thrown when the audit cannot run at all; the command maps it to exit code 2. */
export class AuditBundleError extends Error {
}
// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------
export const sha256 = (content) => createHash('sha256').update(content).digest('hex');
const toPosix = (value) => value.split(path.sep).join('/');
const readTextOrNull = async (absPath) => {
    try {
        return await readFile(absPath, 'utf8');
    }
    catch {
        return null;
    }
};
/**
 * Version of the tool that produced the bundle.
 *
 * The published artifact ships `tools/open-sdd/dist` but not the workspace manifest, so an installed
 * copy must read the repository-root manifest five levels up; a checkout reads
 * `tools/open-sdd/package.json` three levels up. Both carry the released version. Returning `dev`
 * rather than a wrong number is deliberate.
 */
const readToolVersion = () => {
    const require = createRequire(import.meta.url);
    for (const candidate of ['../../../package.json', '../../../../../package.json', '../../../../package.json']) {
        try {
            const pkg = require(candidate);
            if (typeof pkg?.version === 'string' && pkg.version.length > 0)
                return pkg.version;
        }
        catch {
            // try the next candidate
        }
    }
    return 'dev';
};
/** `2026-09-19T21-18-29-493Z` — filesystem-safe and lexicographically sortable. */
export const bundleTimestamp = (date) => date.toISOString().replace(/[:.]/g, '-');
const profileFromGovernance = (governance) => {
    if (governance === 'team')
        return 'team';
    if (governance === 'enterprise')
        return 'regulated';
    return 'solo';
};
const SPEC_FILES = [
    { name: 'requirements.md', role: 'requirements', required: true },
    { name: 'plan.md', role: 'plan', required: true },
    { name: 'design.md', role: 'plan-alias', required: false },
    { name: 'tasks.md', role: 'tasks', required: true },
    { name: 'delta.md', role: 'delta', required: false },
    { name: 'spec.json', role: 'metadata', required: false },
];
const emptyConstitution = () => {
    try {
        return parseConstitution('');
    }
    catch {
        return { project: '', provenance: 'normative', establishedFacts: [], principles: [], amendments: [] };
    }
};
// ---------------------------------------------------------------------------------------------
// Findings and locations
// ---------------------------------------------------------------------------------------------
const specFileUri = (sddDir, feature, name) => toPosix(path.join(sddDir, 'specs', feature, name));
/** Where a gate finding points, derived from the gate's own evidence. Absent is never a crash. */
export const gateLocation = (gateId, evidence, sddDir, feature) => {
    if (gateId === 'C1')
        return { artifact: specFileUri(sddDir, feature, 'requirements.md') };
    if (gateId === 'C3')
        return { artifact: specFileUri(sddDir, feature, 'tasks.md') };
    if (gateId === 'C4')
        return { artifact: specFileUri(sddDir, feature, 'plan.md') };
    if (gateId === 'C6') {
        const missing = evidence?.[0];
        if (missing && /\.(md|json|ya?ml)$/i.test(missing))
            return { artifact: toPosix(missing) };
        return { artifact: 'README.md' };
    }
    if (gateId === 'C2') {
        // Evidence is rendered as `kind:id path:line` by the C2 control.
        const match = evidence?.[0]?.match(/(\S+):(\d+)$/);
        if (match)
            return { artifact: toPosix(match[1]), startLine: Number(match[2]) };
    }
    return { artifact: specFileUri(sddDir, feature, 'requirements.md') };
};
const alignmentUri = (sddDir, feature, artifactId) => {
    if (artifactId && /^TASK/i.test(artifactId))
        return specFileUri(sddDir, feature, 'tasks.md');
    return specFileUri(sddDir, feature, 'requirements.md');
};
const claimLine = (registryText, claimId) => {
    const lines = registryText.split(/\r?\n/);
    const escaped = claimId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^\\s*-\\s*id:\\s*['"]?${escaped}['"]?\\s*$`);
    const index = lines.findIndex((line) => re.test(line));
    return index >= 0 ? index + 1 : undefined;
};
// ---------------------------------------------------------------------------------------------
// Evidence collection (read-only; no bundle directory is touched)
// ---------------------------------------------------------------------------------------------
const loadSecurityAllowlist = async (root, sddDir) => {
    const raw = await readTextOrNull(path.join(root, sddDir, 'settings', 'security-allowlist.json'));
    if (raw === null)
        return { entries: [], rejected: [] };
    try {
        return parseSecurityAllowlist(raw);
    }
    catch {
        return { entries: [], rejected: [] };
    }
};
/** Assemble every piece of evidence in memory. Writes nothing; `assembleAuditBundle` persists it. */
export const collectEvidence = async (options) => {
    const root = await findRepoRoot(options.cwd);
    const sddDir = options.sddDir ?? (await resolveSddDir(root));
    const now = options.now ?? new Date();
    const features = options.feature ? [options.feature] : await listSpecs(root, sddDir);
    let rigor;
    try {
        rigor = await loadRigorSettings(root, sddDir);
    }
    catch (error) {
        throw new AuditBundleError(`No se pudo leer el nivel de rigor declarado: ${error.message}`);
    }
    const governance = await loadGovernanceSettings(root, sddDir).catch(() => undefined);
    const profile = options.profile ?? profileFromGovernance(governance?.profile);
    const regime = profile === 'regulated' ? 'strict' : 'flexible';
    const { signals } = await detectRepoSignals(root);
    const chain = resolveGateChain(profile, signals);
    const gateIds = chain.declared;
    const allowlist = await loadSecurityAllowlist(root, sddDir);
    const primaryFeature = options.feature ?? features[0] ?? 'governance';
    const gateReport = await runChain(gateIds, {
        cwd: root,
        sddDir,
        feature: primaryFeature,
        changedFiles: [],
        declaredScope: [],
        mcpServers: signals.declaresThirdPartyMcpServers ? ['declared-in-host-config'] : [],
        mcpAllowlist: [],
        graphIndexPath: toPosix(path.join(sddDir, '.graph', 'symbols.json')),
        securityAllowlist: allowlist.entries,
    }, regime);
    // ── Constitution: raw text, principles in force and the compliance matrix ────────────────────
    const constitutionCandidates = [
        path.join(sddDir, 'steering', 'constitution.md'),
        path.join(sddDir, 'constitution.md'),
    ];
    let constitutionSource = null;
    let constitutionText = null;
    for (const candidate of constitutionCandidates) {
        const text = await readTextOrNull(path.join(root, candidate));
        if (text !== null) {
            constitutionSource = toPosix(candidate);
            constitutionText = text;
            break;
        }
    }
    const constitution = constitutionText !== null ? parseConstitution(constitutionText) : emptyConstitution();
    const inForce = principlesInForce(constitution);
    const complianceMatrix = buildComplianceMatrix(constitution, { cwd: root });
    // ── Specs: requirements / plan / tasks / delta, with the alignment verdict per spec ──────────
    const specs = [];
    for (const feature of features) {
        const specDirAbs = path.join(root, sddDir, 'specs', feature);
        const entries = await readdir(specDirAbs).catch(() => []);
        const triad = evaluateTriad(entries);
        const contents = new Map();
        const files = [];
        for (const candidate of SPEC_FILES) {
            const text = entries.includes(candidate.name)
                ? await readTextOrNull(path.join(specDirAbs, candidate.name))
                : null;
            if (text !== null)
                contents.set(candidate.name, text);
            const source = text !== null ? toPosix(path.join(sddDir, 'specs', feature, candidate.name)) : null;
            files.push({
                name: candidate.name,
                present: text !== null,
                source,
                bundlePath: source !== null ? toPosix(path.join('specs', feature, candidate.name)) : null,
                sha256: text !== null ? sha256(text) : null,
            });
        }
        let delta;
        let deltaParseError;
        const deltaText = contents.get('delta.md');
        if (deltaText !== undefined) {
            try {
                delta = parseDeltaSpec(deltaText);
            }
            catch (error) {
                deltaParseError = error.message;
            }
        }
        const requirements = contents.get('requirements.md');
        const plan = contents.get('plan.md') ?? contents.get('design.md');
        const tasks = contents.get('tasks.md');
        const alignment = alignSpecWithConstitution({
            feature,
            constitution,
            ...(requirements !== undefined ? { requirements } : {}),
            ...(plan !== undefined ? { plan } : {}),
            ...(tasks !== undefined ? { tasks } : {}),
            ...(delta !== undefined ? { delta } : {}),
        });
        specs.push({
            feature,
            present: entries.length > 0,
            triad,
            files,
            alignment,
            ...(deltaParseError ? { deltaParseError } : {}),
        });
    }
    // ── Claims registry: the same module `assure claims --verify` executes ───────────────────────
    const claimsRelPath = options.claimsPath ?? DEFAULT_CLAIMS_PATH;
    let claimsRun = null;
    let claimsText = null;
    let claimsDetail;
    try {
        claimsText = await readClaimsRegistry(root, claimsRelPath);
        claimsRun = await runClaimsRegistry(claimsText, {
            cwd: root,
            timeoutMs: options.claimsTimeoutMs ?? DEFAULT_CLAIMS_TIMEOUT_MS,
        });
        claimsDetail = `${claimsRun.report.total} afirmación(es) ejecutada(s); ${claimsRun.report.broken} rota(s).`;
    }
    catch (error) {
        claimsDetail = `Registro de afirmaciones no ejecutable en ${claimsRelPath}: ${error.message}`;
    }
    // ── Findings: gate FAILs, alignment findings and broken claims ───────────────────────────────
    const findings = [];
    for (const finding of gateReport.findings) {
        if (finding.outcome !== 'fail')
            continue;
        const location = gateLocation(finding.gateId, finding.evidence, sddDir, primaryFeature);
        findings.push({
            kind: 'gate',
            ruleId: finding.gateId,
            level: 'error',
            message: `${finding.gateId} (${finding.authority}): ${finding.detail}`,
            artifact: location.artifact,
            ...(location.startLine !== undefined ? { startLine: location.startLine } : {}),
            authority: finding.authority,
        });
    }
    for (const spec of specs) {
        for (const finding of spec.alignment.findings) {
            findings.push({
                kind: 'alignment',
                ruleId: finding.code,
                level: finding.severity === 'error' ? 'error' : finding.severity === 'warning' ? 'warning' : 'note',
                message: finding.message,
                artifact: alignmentUri(sddDir, spec.feature, finding.artifactId),
                ...(finding.artifactId ? { authority: finding.artifactId } : {}),
            });
        }
    }
    if (claimsRun) {
        for (const { claim, status } of claimsRun.report.results) {
            if (status !== 'broken')
                continue;
            const line = claimsText !== null ? claimLine(claimsText, claim.id) : undefined;
            findings.push({
                kind: 'claim',
                ruleId: claim.id,
                level: 'error',
                message: `La afirmación ${claim.id} está ROTA: el verificador falla donde el texto dice que debería pasar. ${claim.statementEn}`,
                artifact: toPosix(claimsRelPath),
                ...(line !== undefined ? { startLine: line } : {}),
            });
        }
    }
    // Only a gate FAIL or a broken claim blocks. Alignment findings are ranked, not laundered.
    const blockedBy = findings
        .filter((finding) => finding.kind === 'gate' || finding.kind === 'claim')
        .map((finding) => finding.ruleId);
    const passed = blockedBy.length === 0;
    const exitCode = passed ? AUDIT_EXIT_CODES.pass : AUDIT_EXIT_CODES.blocking;
    const files = [];
    const artifacts = [];
    const addText = (id, role, relPath, content, source) => {
        files.push({ relPath, content, role });
        artifacts.push({
            id,
            role,
            path: relPath,
            present: true,
            sha256: sha256(content),
            bytes: Buffer.byteLength(content, 'utf8'),
            ...(source ? { source } : {}),
        });
    };
    const addAbsent = (id, role, source) => {
        artifacts.push({ id, role, path: null, present: false, sha256: null, bytes: null, source });
    };
    if (constitutionText !== null && constitutionSource !== null) {
        addText('constitution:text', 'constitution', 'constitution.md', constitutionText, constitutionSource);
    }
    else {
        addAbsent('constitution:text', 'constitution', toPosix(constitutionCandidates[0]));
    }
    addText('constitution:matrix', 'compliance-matrix', 'constitution.json', JSON.stringify({ present: constitutionText !== null, source: constitutionSource, principlesInForce: inForce, complianceMatrix }, null, 2) + '\n', constitutionSource ?? toPosix(constitutionCandidates[0]));
    for (const spec of specs) {
        for (const file of spec.files) {
            if (file.present && file.bundlePath !== null && file.source !== null) {
                const content = await readFile(path.join(root, ...file.source.split('/')), 'utf8');
                addText(`spec:${spec.feature}:${file.name}`, 'spec', file.bundlePath, content, file.source);
            }
            else {
                addAbsent(`spec:${spec.feature}:${file.name}`, 'spec', toPosix(path.join(sddDir, 'specs', spec.feature, file.name)));
            }
        }
        if (!spec.present)
            addAbsent(`spec:${spec.feature}`, 'spec', toPosix(path.join(sddDir, 'specs', spec.feature)));
    }
    addText('gates', 'gates', 'gates.json', JSON.stringify({ chain, report: gateReport, regime }, null, 2) + '\n');
    addText('claims', 'claims', 'claims.json', JSON.stringify({
        registry: claimsRelPath,
        present: claimsRun !== null,
        report: claimsRun?.report ?? null,
        runs: claimsRun?.runs ?? [],
        rejected: claimsRun?.rejected ?? [],
        timedOut: claimsRun?.timedOut ?? [],
        detail: claimsDetail,
    }, null, 2) + '\n', toPosix(claimsRelPath));
    addText('alignment', 'alignment', 'alignment.json', JSON.stringify({ specs: specs.map((spec) => ({ ...spec.alignment, feature: spec.feature, present: spec.present })) }, null, 2) + '\n');
    addText('rigor', 'rigor', 'rigor.json', JSON.stringify({ ...rigor, gates: effectiveGates(rigor.level, rigor.gates) }, null, 2) + '\n');
    const alignmentCounts = { error: 0, warning: 0, info: 0 };
    for (const spec of specs) {
        for (const finding of spec.alignment.findings)
            alignmentCounts[finding.severity] += 1;
    }
    const rigorAssessment = await assessRigor(root, {
        level: rigor.level,
        brownfield: rigor.brownfield,
        feature: options.feature,
        sddDir,
        gates: effectiveGates(rigor.level, rigor.gates),
    });
    const manifest = {
        schema: AUDIT_BUNDLE_SCHEMA,
        tool: { name: 'open-sdd', version: readToolVersion() },
        generatedAt: now.toISOString(),
        verdict: { passed, exitCode, blockedBy },
        scope: {
            root,
            sddDir,
            feature: options.feature ?? null,
            features,
            profile,
            changedFiles: [],
        },
        rigor: { ...rigor, gates: effectiveGates(rigor.level, rigor.gates), assessment: rigorAssessment },
        gates: {
            declared: chain.declared,
            executed: chain.executed,
            unavailable: gateReport.unavailable,
            vacuous: chain.vacuous.map((control) => control.id),
            regime,
            report: gateReport,
        },
        constitution: {
            present: constitutionText !== null,
            source: constitutionSource,
            principlesInForce: inForce,
            complianceMatrix,
        },
        specs,
        claims: {
            registry: claimsRelPath,
            present: claimsRun !== null,
            report: claimsRun?.report ?? null,
            runs: claimsRun?.runs ?? [],
            rejected: claimsRun?.rejected ?? [],
            timedOut: claimsRun?.timedOut ?? [],
            detail: claimsDetail,
        },
        artifacts,
        findings,
        summary: {
            gates: {
                declared: chain.declared.length,
                failed: gateReport.findings.filter((finding) => finding.outcome === 'fail').length,
                selfAuthorized: gateReport.unavailable.length,
            },
            claims: claimsRun
                ? {
                    total: claimsRun.report.total,
                    broken: claimsRun.report.broken,
                    verified: claimsRun.report.verified,
                    executed: claimsRun.report.executed,
                }
                : null,
            alignment: alignmentCounts,
            findings: findings.length,
        },
    };
    return { root, sddDir, manifest, files };
};
// ---------------------------------------------------------------------------------------------
// Writing the bundle
// ---------------------------------------------------------------------------------------------
/** Persist an already-collected evidence set plus its manifest. */
export const writeBundle = async (collected, options) => {
    const now = options.now ?? new Date();
    const dir = options.outDir
        ? path.resolve(collected.root, options.outDir)
        : path.join(collected.root, collected.sddDir, 'audit', bundleTimestamp(now));
    try {
        await mkdir(dir, { recursive: true });
    }
    catch (error) {
        throw new AuditBundleError(`No se pudo crear el directorio del bundle ${dir}: ${error.message}`);
    }
    for (const file of collected.files) {
        const abs = path.join(dir, ...file.relPath.split('/'));
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, file.content, 'utf8');
    }
    let sarifPath = null;
    if (options.sarifPath) {
        const log = buildSarifLog(collected.manifest);
        const problems = validateSarifShape(log);
        if (problems.length > 0) {
            throw new AuditBundleError(`El SARIF generado no es válido: ${problems.join('; ')}`);
        }
        const content = JSON.stringify(log, null, 2) + '\n';
        sarifPath = path.resolve(collected.root, options.sarifPath);
        await mkdir(path.dirname(sarifPath), { recursive: true });
        await writeFile(sarifPath, content, 'utf8');
        const inside = sarifPath === dir || sarifPath.startsWith(dir + path.sep);
        collected.manifest.artifacts.push({
            id: 'sarif',
            role: 'sarif',
            path: inside ? toPosix(path.relative(dir, sarifPath)) : toPosix(path.relative(collected.root, sarifPath)),
            present: true,
            sha256: sha256(content),
            bytes: Buffer.byteLength(content, 'utf8'),
            ...(inside ? {} : { external: true }),
        });
    }
    const manifestPath = path.join(dir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(collected.manifest, null, 2) + '\n', 'utf8');
    return { dir, manifest: collected.manifest, manifestPath, sarifPath };
};
/** Collect and persist in one call. */
export const assembleAuditBundle = async (options) => {
    const collected = await collectEvidence(options);
    return writeBundle(collected, options);
};
const ruleText = (ruleId) => {
    if (/^[CO]\d$/.test(ruleId))
        return `Control de la cadena Zero-Trust (${ruleId}).`;
    if (/^(CLAIM|PAPER)-/.test(ruleId))
        return `Afirmación registrada ${ruleId} del registro ejecutable (§9.6).`;
    return `Hallazgo de alineación constitucional (${ruleId}).`;
};
/** Build the minimal-but-valid SARIF 2.1.0 log for a manifest's findings. */
export const buildSarifLog = (manifest) => {
    const ruleIds = [...new Set(manifest.findings.map((finding) => finding.ruleId))];
    return {
        version: SARIF_VERSION,
        $schema: SARIF_SCHEMA,
        runs: [
            {
                tool: {
                    driver: {
                        name: 'open-sdd',
                        version: manifest.tool.version,
                        informationUri: 'https://github.com/Brujo2020/open-sdd',
                        rules: ruleIds.map((id) => ({ id, name: id, shortDescription: { text: ruleText(id) } })),
                    },
                },
                results: manifest.findings.map((finding) => ({
                    ruleId: finding.ruleId,
                    ruleIndex: ruleIds.indexOf(finding.ruleId),
                    level: finding.level,
                    message: { text: finding.message },
                    locations: [
                        {
                            physicalLocation: {
                                artifactLocation: { uri: finding.artifact },
                                ...(finding.startLine !== undefined ? { region: { startLine: finding.startLine } } : {}),
                            },
                        },
                    ],
                })),
                invocations: [
                    {
                        executionSuccessful: manifest.verdict.exitCode !== AUDIT_EXIT_CODES.couldNotRun,
                        exitCode: manifest.verdict.exitCode,
                        endTimeUtc: manifest.generatedAt,
                    },
                ],
            },
        ],
    };
};
const SARIF_LEVELS = new Set(['none', 'note', 'warning', 'error']);
/**
 * Validator-free correctness check of a SARIF 2.1.0 log against the subset this tool emits.
 * Returns an empty array when the log is valid; every problem is a human-readable sentence.
 */
export const validateSarifShape = (log) => {
    const problems = [];
    if (typeof log !== 'object' || log === null)
        return ['el SARIF no es un objeto'];
    const candidate = log;
    if (candidate.version !== SARIF_VERSION)
        problems.push(`version debe ser "${SARIF_VERSION}"`);
    if (candidate.$schema !== SARIF_SCHEMA)
        problems.push('$schema debe ser el esquema OASIS de SARIF 2.1.0');
    if (!Array.isArray(candidate.runs) || candidate.runs.length !== 1) {
        problems.push('runs debe contener exactamente una ejecución');
        return problems;
    }
    const run = candidate.runs[0];
    const driver = run?.tool?.driver;
    if (!driver || typeof driver.name !== 'string' || driver.name.length === 0) {
        problems.push('tool.driver.name es obligatorio');
    }
    const rules = Array.isArray(driver?.rules) ? driver.rules : [];
    const ruleIds = new Set(rules.map((rule) => rule?.id));
    if (!Array.isArray(run?.results)) {
        problems.push('run.results debe ser una lista');
        return problems;
    }
    run.results.forEach((result, index) => {
        const where = `results[${index}]`;
        if (typeof result?.ruleId !== 'string' || result.ruleId.length === 0) {
            problems.push(`${where}.ruleId es obligatorio`);
        }
        else if (!ruleIds.has(result.ruleId)) {
            problems.push(`${where}.ruleId "${result.ruleId}" no está declarado en driver.rules`);
        }
        if (!result?.level || !SARIF_LEVELS.has(result.level)) {
            problems.push(`${where}.level debe ser none|note|warning|error`);
        }
        if (typeof result?.message?.text !== 'string' || result.message.text.length === 0) {
            problems.push(`${where}.message.text es obligatorio`);
        }
        if (!Array.isArray(result?.locations) || result.locations.length === 0) {
            problems.push(`${where}.locations debe tener al menos una localización`);
            return;
        }
        for (const location of result.locations) {
            const uri = location?.physicalLocation?.artifactLocation?.uri;
            if (typeof uri !== 'string' || uri.length === 0) {
                problems.push(`${where}.locations[].physicalLocation.artifactLocation.uri es obligatorio`);
            }
            const startLine = location?.physicalLocation?.region?.startLine;
            if (startLine !== undefined && (!Number.isInteger(startLine) || startLine < 1)) {
                problems.push(`${where}.region.startLine debe ser un entero positivo cuando existe`);
            }
        }
    });
    return problems;
};
const VALUE_FLAGS = new Set(['--out', '--sarif', '--profile', '--sdd-dir', '--claims', '--claims-timeout']);
export const parseBundleArgs = (argv) => {
    const sub = argv[0] === 'sarif' ? 'sarif' : 'bundle';
    const rest = argv[0] === 'sarif' || argv[0] === 'bundle' ? argv.slice(1) : argv;
    const parsed = { sub, json: false };
    const positionals = [];
    for (let i = 0; i < rest.length; i += 1) {
        const token = rest[i];
        if (token.startsWith('--') && token.includes('=')) {
            const [flag, ...valueParts] = token.split('=');
            const value = valueParts.join('=');
            if (flag === '--out')
                parsed.outDir = value;
            else if (flag === '--sarif')
                parsed.sarifPath = value;
            else if (flag === '--profile')
                parsed.profile = value === 'team' || value === 'regulated' ? value : 'solo';
            else if (flag === '--sdd-dir')
                parsed.sddDir = value;
            else if (flag === '--claims')
                parsed.claimsPath = value;
            else if (flag === '--claims-timeout')
                parsed.claimsTimeoutMs = Number(value);
            continue;
        }
        if (VALUE_FLAGS.has(token)) {
            const value = rest[i + 1];
            if (value !== undefined) {
                if (token === '--out')
                    parsed.outDir = value;
                else if (token === '--sarif')
                    parsed.sarifPath = value;
                else if (token === '--profile')
                    parsed.profile = value === 'team' || value === 'regulated' ? value : 'solo';
                else if (token === '--sdd-dir')
                    parsed.sddDir = value;
                else if (token === '--claims')
                    parsed.claimsPath = value;
                else if (token === '--claims-timeout')
                    parsed.claimsTimeoutMs = Number(value);
                i += 1;
            }
            continue;
        }
        if (token === '--json') {
            parsed.json = true;
            continue;
        }
        if (token.startsWith('-'))
            continue;
        positionals.push(token);
    }
    if (positionals.length > 0)
        parsed.feature = positionals[0];
    if (sub === 'sarif' && parsed.sarifPath === undefined && parsed.outDir !== undefined) {
        // `audit sarif --out <path>` is the natural spelling for "write the report here".
        parsed.sarifPath = parsed.outDir;
        parsed.outDir = undefined;
    }
    return parsed;
};
const bundleOptions = (cwd, parsed) => ({
    cwd,
    ...(parsed.feature ? { feature: parsed.feature } : {}),
    ...(parsed.outDir ? { outDir: parsed.outDir } : {}),
    ...(parsed.profile ? { profile: parsed.profile } : {}),
    ...(parsed.sddDir ? { sddDir: parsed.sddDir } : {}),
    ...(parsed.claimsPath ? { claimsPath: parsed.claimsPath } : {}),
    ...(parsed.claimsTimeoutMs !== undefined && Number.isFinite(parsed.claimsTimeoutMs)
        ? { claimsTimeoutMs: parsed.claimsTimeoutMs }
        : {}),
});
export const renderBundleSummary = (result) => {
    const { manifest } = result;
    const failed = manifest.summary.gates.failed;
    const verdict = manifest.verdict.passed
        ? colors.green('PASA')
        : colors.red(`NO PASA (${manifest.verdict.blockedBy.join(', ')})`);
    const scope = manifest.scope.feature ?? (manifest.scope.features.join(', ') || '(sin specs)');
    const lines = [
        '',
        formatHeading(`Bundle de auditoría — ${scope}`),
        `  Veredicto:        ${verdict}`,
        `  Directorio:       ${result.dir}`,
        `  Manifest:         ${result.manifestPath}`,
        `  Herramienta:      open-sdd v${manifest.tool.version} · ${manifest.generatedAt}`,
        `  Perfil/régimen:   ${manifest.scope.profile} / ${manifest.gates.regime}`,
        `  Rigor declarado:  ${manifest.rigor.level} → gates ${manifest.rigor.gates.join(', ')}`,
        `  Gates:            ${manifest.gates.declared.length} declarados, ${failed} FAIL, ${manifest.gates.unavailable.length} sin sensor`,
        `  Constitución:     ${manifest.constitution.present
            ? `${manifest.constitution.principlesInForce.length} principio(s) en vigor · matriz ${(manifest.constitution.complianceMatrix.coverage * 100).toFixed(0)}%`
            : colors.yellow('ausente')}`,
        `  Alineamiento:     ${manifest.summary.alignment.error} error(es), ${manifest.summary.alignment.warning} aviso(s), ${manifest.summary.alignment.info} info`,
        `  Afirmaciones:     ${manifest.claims.present
            ? `${manifest.claims.report?.total ?? 0} ejecutadas, ${manifest.claims.report?.broken ?? 0} rota(s)`
            : colors.yellow('registro no ejecutable')}`,
        `  Artefactos:       ${manifest.artifacts.length} (${manifest.artifacts.filter((artifact) => artifact.present).length} presentes, sha256 por artefacto)`,
        `  Hallazgos:        ${manifest.findings.length}`,
    ];
    if (result.sarifPath)
        lines.push(`  SARIF:            ${result.sarifPath}`);
    lines.push('');
    return lines;
};
export const handleAuditBundleCommand = async (argv, io, cwd = process.cwd()) => {
    const parsed = parseBundleArgs(argv);
    try {
        if (parsed.sub === 'sarif') {
            const collected = await collectEvidence({
                ...bundleOptions(cwd, parsed),
                ...(parsed.sarifPath ? { sarifPath: parsed.sarifPath } : {}),
            });
            const log = buildSarifLog(collected.manifest);
            const problems = validateSarifShape(log);
            if (problems.length > 0) {
                io.error(colors.red(`El SARIF generado no es válido: ${problems.join('; ')}`));
                return AUDIT_EXIT_CODES.couldNotRun;
            }
            const content = JSON.stringify(log, null, 2) + '\n';
            if (parsed.sarifPath) {
                const target = path.resolve(cwd, parsed.sarifPath);
                await mkdir(path.dirname(target), { recursive: true });
                await writeFile(target, content, 'utf8');
                io.log(`SARIF 2.1.0 escrito en ${target} (${collected.manifest.findings.length} resultado(s)).`);
            }
            else {
                io.log(content);
            }
            return collected.manifest.verdict.exitCode;
        }
        const collected = await collectEvidence(bundleOptions(cwd, parsed));
        const result = await writeBundle(collected, {
            ...bundleOptions(cwd, parsed),
            ...(parsed.sarifPath ? { sarifPath: parsed.sarifPath } : {}),
        });
        if (parsed.json) {
            const errors = result.manifest.findings.filter((finding) => finding.level === 'error');
            const warnings = result.manifest.findings.filter((finding) => finding.level !== 'error');
            io.log(JSON.stringify(jsonEnvelope({
                command: 'audit bundle',
                data: result.manifest,
                ok: result.manifest.verdict.passed,
                errors,
                warnings,
                detail: `Bundle en ${result.dir} · ${result.manifest.verdict.passed
                    ? 'pasa'
                    : `bloqueado por ${result.manifest.verdict.blockedBy.join(', ')}`}`,
            }), null, 2));
            return result.manifest.verdict.exitCode;
        }
        for (const line of renderBundleSummary(result))
            io.log(line);
        if (result.manifest.verdict.passed) {
            io.log(formatSuccess('  La auditoría pasa: ningún gate FAIL ni afirmación rota.'));
        }
        else {
            io.log(formatWarning(`  Bloqueado por: ${result.manifest.verdict.blockedBy.join(', ')}`));
        }
        io.log('');
        return result.manifest.verdict.exitCode;
    }
    catch (error) {
        if (error instanceof AuditBundleError) {
            io.error(colors.red(`No se pudo ejecutar la auditoría: ${error.message}`));
            return AUDIT_EXIT_CODES.couldNotRun;
        }
        throw error;
    }
};
// ---------------------------------------------------------------------------------------------
// audit <feature> — the pre-existing compliance report
// ---------------------------------------------------------------------------------------------
const renderGates = (gates, io) => {
    if (!gates.length)
        return;
    io.log('');
    io.log(formatHeading('Checks:'));
    for (const g of gates) {
        const mark = g.outcome === 'pass'
            ? colors.green('ok     ')
            : g.outcome === 'fail'
                ? colors.red('blocked')
                : colors.yellow('heads up');
        io.log(`  ${mark}  ${g.label}`);
        if (g.outcome !== 'pass')
            io.log(`           ${colors.dim(g.detail)}`);
    }
};
export const handleAuditCommand = async (argv, io, cwd = process.cwd()) => {
    const isJson = argv.includes('--json');
    const isRegulatory = argv.includes('--regulatory');
    const isStrict = argv.includes('--strict') || argv.some((a) => a === '--mode=strict');
    const mode = isStrict ? 'strict' : undefined;
    const sddDirArg = argv.find((a) => a.startsWith('--sdd-dir='));
    const sddDir = sddDirArg ? sddDirArg.split('=')[1] : await resolveSddDir(cwd);
    const featureArg = argv.find((a) => !a.startsWith('-'));
    if (featureArg) {
        const result = await auditFeature(cwd, featureArg, { regulatory: isRegulatory, sddDir, mode });
        if (isJson) {
            io.log(JSON.stringify(result, null, 2));
            return result.inSync ? 0 : 1;
        }
        io.log('');
        io.log(formatHeading(`Open-SDD Audit: ${colors.bold(featureArg)}`));
        const gov = await loadGovernanceSettings(cwd, sddDir);
        const activeProfile = isStrict ? 'enterprise' : (gov.profile ?? 'solo');
        const blocking = gov.critical_invariants.length;
        io.log(`  Profile:           ${colors.cyan(activeProfile)} ${colors.dim(governanceProfiles[activeProfile].summary)}`);
        if (blocking === 0) {
            io.log(`  Blocking:          ${colors.dim('nothing — report only')}`);
        }
        else {
            io.log(`  Blocking:          ${colors.yellow(`${blocking} of 3 checks`)}`);
        }
        io.log(`  Health Score:      ${result.score >= 80 ? colors.green(`${result.score}/100`) : colors.yellow(`${result.score}/100`)}`);
        io.log(`  Status:            ${result.inSync ? colors.green('ok') : colors.red('needs attention')}`);
        io.log(`  Out-of-scope edits: ${result.driftDetected ? colors.yellow('yes') : colors.green('none')}`);
        renderGates(result.gates, io);
        if (result.regulatory) {
            io.log('');
            io.log(formatHeading('Regulatory Assessment (--regulatory):'));
            io.log(`  EU AI Act Art. 11 (Technical Documentation): ${result.regulatory.euAiActArt11 ? colors.green('PASS') : colors.red('FAIL')}`);
            io.log(`  EU AI Act Art. 12 (Traceability & Logs):    ${result.regulatory.euAiActArt12 ? colors.green('PASS') : colors.red('FAIL')}`);
            io.log(`  EU AI Act Art. 14 (Human Oversight Gate):   ${result.regulatory.euAiActArt14 ? colors.green('PASS') : colors.red('FAIL')}`);
            io.log(`  NIST AI RMF Invariant Alignment:            ${result.regulatory.nistAiRmf ? colors.green('PASS') : colors.red('FAIL')}`);
            io.log(`  Compliance Index:                           ${colors.cyan(`${result.regulatory.compliancePercent}%`)}`);
        }
        if (result.rtm.length > 0) {
            io.log('');
            io.log(formatHeading(`Requirements coverage:`));
            for (const entry of result.rtm) {
                const check = entry.verified ? colors.green('✓') : colors.dim('○');
                const tasksStr = entry.mappedTasks.length > 0 ? colors.cyan(entry.mappedTasks.join(', ')) : colors.yellow('NO TASKS');
                io.log(`  ${check} ${colors.bold(entry.requirementId)}: ${entry.title.slice(0, 35).padEnd(36)} → Tasks: [${tasksStr}]`);
            }
        }
        if (result.issues.length > 0) {
            io.log('');
            io.log(formatHeading(`Details (${result.issues.length}):`));
            for (const issue of result.issues) {
                const prefix = issue.severity === 'critical' ? colors.red('[CRITICAL]') : issue.severity === 'warning' ? colors.yellow('[WARNING]') : colors.dim('[INFO]');
                io.log(`  ${prefix} ${colors.bold(issue.code)}: ${issue.message}`);
            }
        }
        io.log('');
        return result.inSync ? 0 : 1;
    }
    // Project-wide audit
    const projectResult = await auditAll(cwd, { regulatory: isRegulatory, sddDir });
    if (isJson) {
        io.log(JSON.stringify(projectResult, null, 2));
        return projectResult.projectInSync ? 0 : 1;
    }
    io.log('');
    io.log(formatHeading(`Open-SDD Project-Wide Audit`));
    io.log(`  Overall Health Score: ${projectResult.overallScore >= 80 ? colors.green(`${projectResult.overallScore}/100`) : colors.yellow(`${projectResult.overallScore}/100`)}`);
    io.log(`  Project Alignment:    ${projectResult.projectInSync ? colors.green('ALL SPECS IN SYNC') : colors.yellow('DRIFT OR GAPS DETECTED')}`);
    io.log(`  Audited Specs:        ${projectResult.features.length}`);
    io.log('');
    for (const f of projectResult.features) {
        const statusStr = f.inSync ? colors.green('PASS') : colors.yellow('ATTENTION');
        io.log(`  • ${colors.bold(f.feature.padEnd(25))} Score: ${f.score}/100 [${statusStr}]`);
    }
    io.log('');
    return projectResult.projectInSync ? 0 : 1;
};
