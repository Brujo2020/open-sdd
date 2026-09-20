/**
 * The gate runner: deterministic, ordinarу code with fixed inputs and outputs.
 *
 * This is where the architecture's determinism actually lives. Not in a sampler: the gates are
 * ordinary code, and their reproducibility does not depend on any property of a model. Each
 * check reports two independent facts — whether its SENSOR was available, and whether it FIRED —
 * because conflating "the instrument is missing" with "the instrument found nothing" is exactly
 * the silent failure the default-FAIL posture exists to prevent.
 *
 * Checks that need a model backend (C5) or a structural index (O3) do not pretend: they report
 * `sensorAvailable: false` or an explicitly degraded mode that does NOT count as evidence.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { getExecutableGate } from './gateCatalog.js';
import { applyDefaultFail } from './enforcement.js';
import { applySecurityAllowlist } from './securityAllowlist.js';
import { evaluateTriad, checkEvidenceLock } from './triad.js';
import { validateEarsRequirement } from './ears.js';
// --- secret & destructive-command detection (C2 / G5) ----------------------------------------
const SECRET_PATTERNS = [
    { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
    { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
    { id: 'openai-key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
    { id: 'private-key-block', re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
    { id: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
    { id: 'generic-assignment', re: /\b(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i },
];
const DESTRUCTIVE_PATTERNS = [
    // The trailing target may be the root itself (`rm -rf /`, `rm -rf ~`) or a path beneath it
    // (`rm -rf /etc`). A trailing `\b` after a non-word character never matches at end of input,
    // so it silently missed the most dangerous form of all.
    { id: 'rm-rf-root', re: /\brm\s+(?:-[a-zA-Z]+\s+)*-[a-zA-Z]*[rR][a-zA-Z]*f[a-zA-Z]*\s+(?:\/|~|\$HOME)/ },
    { id: 'git-push-force-main', re: /\bgit\s+push\b[^\n]*--force[^\n]*\b(main|master)\b/ },
    { id: 'drop-table', re: /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i },
    { id: 'truncate-table', re: /\bTRUNCATE\s+TABLE\b/i },
    { id: 'chmod-777', re: /\bchmod\s+(-R\s+)?777\b/ },
    { id: 'curl-pipe-shell', re: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba)?sh\b/ },
];
const INJECTION_PATTERNS = [
    { id: 'ignore-previous', re: /ignore (all )?(previous|prior|above) instructions/i },
    { id: 'system-prompt-exfil', re: /(reveal|print|repeat)[^\n]{0,30}(system prompt|initial instructions)/i },
    { id: 'hidden-comment-instruction', re: /<!--[^>]*\b(ignore|must|shall|execute)\b[^>]*-->/i },
];
/** Scan files for secrets, destructive commands and injection patterns (C2). */
export const scanSecurity = (files) => {
    const findings = [];
    for (const file of files) {
        const lines = file.content.split(/\r?\n/);
        lines.forEach((line, i) => {
            for (const p of SECRET_PATTERNS)
                if (p.re.test(line))
                    findings.push({ id: p.id, kind: 'secret', file: file.path, line: i + 1 });
            for (const p of DESTRUCTIVE_PATTERNS)
                if (p.re.test(line))
                    findings.push({ id: p.id, kind: 'destructive', file: file.path, line: i + 1 });
            for (const p of INJECTION_PATTERNS)
                if (p.re.test(line))
                    findings.push({ id: p.id, kind: 'injection', file: file.path, line: i + 1 });
        });
    }
    return findings;
};
export const buildSymbolIndex = (sources) => {
    const modules = new Map();
    for (const src of sources) {
        const mod = path.basename(src.path).replace(/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|kt|rs)$/, '');
        const set = modules.get(mod) ?? new Set();
        const re = /\b(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum|def|struct|func)\s+([A-Za-z_$][\w$]*)/g;
        let m;
        while ((m = re.exec(src.content)) !== null)
            set.add(m[1]);
        modules.set(mod, set);
    }
    return { modules };
};
/**
 * Classify referenced symbols. `prefix.symbol` where prefix is not a repo module is EXTERNAL or
 * UNDECIDABLE — never "absent". The historical false positives of the reference implementation
 * came precisely from emitting a verdict over standard-library methods and local variables.
 */
export const checkSymbols = (index, referenced) => referenced.map((ref) => {
    const [prefix, symbol] = ref.includes('.') ? ref.split('.') : ['', ref];
    const mod = index.modules.get(prefix);
    if (!prefix) {
        return { symbol: ref, classification: 'undecidable', detail: 'Referencia sin prefijo de módulo: fuera del dominio juzgable.' };
    }
    if (!mod) {
        return { symbol: ref, classification: 'external', detail: `"${prefix}" no es un módulo de este repositorio: veredicto indecidible.` };
    }
    if (mod.has(symbol)) {
        return { symbol: ref, classification: 'present', detail: `Definición encontrada en el módulo "${prefix}".` };
    }
    return { symbol: ref, classification: 'absent', detail: `El módulo "${prefix}" de este repositorio no define "${symbol}": referencia inventada.` };
});
// --- the runner -------------------------------------------------------------------------------
const readIfExists = async (p) => {
    try {
        return await readFile(p, 'utf8');
    }
    catch {
        return null;
    }
};
const HARD_CONTROL_BY_GATE = {
    C2: 'secretos',
    C3: 'bloqueo_por_evidencia',
};
/**
 * Run one declared control. Every branch reports sensor availability honestly; anything this
 * port does not implement yet is reported as unavailable rather than faked into a pass.
 */
export const runGate = async (gateId, ctx, regime = 'flexible') => {
    const gate = getExecutableGate(gateId);
    const posture = gate?.posture === 'blocking' ? 'blocking' : 'advisory';
    const specDir = path.join(ctx.cwd, ctx.sddDir, 'specs', ctx.feature);
    const finalize = (sensorAvailable, fired, detail, evidence) => {
        const verdict = applyDefaultFail({
            gateId,
            posture,
            sensorAvailable,
            fired,
            hardControl: HARD_CONTROL_BY_GATE[gateId],
            inspects: gate?.inspects,
        }, regime);
        return { gateId, outcome: verdict.outcome, detail: `${verdict.detail} ${detail}`.trim(), authority: gateId, evidence };
    };
    switch (gateId) {
        case 'C1': {
            const entries = await readdir(specDir).catch(() => []);
            if (entries.length === 0) {
                return finalize(true, true, `No existe la especificación "${ctx.feature}" en ${ctx.sddDir}/specs/.`);
            }
            const triad = evaluateTriad(entries);
            const reqText = await readIfExists(path.join(specDir, 'requirements.md'));
            const reqs = reqText
                ? reqText
                    .split(/\r?\n/)
                    .filter((l) => /^\s*(?:[-*]\s*)?(?:\*\*)?(?:REQ|R)\d+/i.test(l) || /\bshall\b/i.test(l))
                    .map((l) => l.trim())
                : [];
            const bad = reqs.map(validateEarsRequirement).filter((v) => !v.conforms);
            const fired = !triad.complete || bad.length > 0;
            return finalize(true, fired, `${triad.detail}${bad.length > 0 ? ` ${bad.length} requisito(s) no conformes a EARS.` : ''}`, bad.slice(0, 5).map((b) => `${b.pattern ?? 'sin-patrón'}: ${b.issues.map((i) => i.code).join(',')}`));
        }
        case 'C2': {
            const files = [];
            for (const rel of ctx.changedFiles) {
                // A pre-commit gate must judge what is being COMMITTED, not whatever happens to be on
                // disk: `--staged` supplies the index content as an override.
                const override = ctx.contentOverrides?.[rel];
                const content = override ?? (await readIfExists(path.join(ctx.cwd, rel)));
                if (content !== null)
                    files.push({ path: rel, content });
            }
            const raw = scanSecurity(files);
            const decision = applySecurityAllowlist(raw, ctx.securityAllowlist ?? []);
            const findings = decision.kept;
            const suppressedNote = decision.suppressed.length > 0
                ? ` ${decision.suppressed.length} hallazgo(s) suprimido(s) por la lista de excepciones (${[
                    ...new Set(decision.suppressed.map((s) => s.id)),
                ].join(', ')}).`
                : '';
            // ── Gobernanza de excepciones (REQ-MAT-012) ───────────────────────────────────────────────
            // `securityAllowlist` ya devuelve `decision.waivers` con dueño y caducidad, pero un veredicto
            // que solo imprime `kind:id file:line` deja «el gate falla y dice a quién preguntar» como una
            // promesa de la API, no del producto. Aquí se NOMBRA cada caso: una excepción caducada
            // devuelve el hallazgo con dueño y fecha, y una sin dueño se declara débil sin convertirse en
            // fallo (eso rompería listas heredadas el día del despliegue). `kept`/`suppressed` no se tocan:
            // su forma la fija `test/enforcementFloor.test.ts`.
            const expiredWaivers = decision.waivers.filter((waiver) => waiver.code === 'waiverExpired');
            const weakWaivers = decision.waivers.filter((waiver) => waiver.code === 'waiverWeak');
            const expiredNote = expiredWaivers.length > 0
                ? ` ${expiredWaivers.length} hallazgo(s) se mantienen porque su excepción CADUCÓ: ${expiredWaivers
                    .map((waiver) => `«excepción caducada el ${waiver.expires ?? '(sin fecha)'}; responsable: ${waiver.owner ?? '(sin dueño declarado)'}» (${waiver.id} en ${waiver.file}:${waiver.line})`)
                    .join('; ')}.`
                : '';
            const weakNote = weakWaivers.length > 0
                ? ` Aviso: ${weakWaivers.length} excepción(es) sin dueño declarado (waiverWeak) en ${[
                    ...new Set(weakWaivers.map((waiver) => waiver.waiverPath)),
                ].join(', ')}: nadie responde de la supresión; añade "owner" en .sdd/settings/security-allowlist.json.`
                : '';
            const evidence = [
                ...findings.map((f) => f.waiverExpired
                    ? `${f.kind}:${f.id} ${f.file}:${f.line} — excepción caducada el ${f.expires ?? '(sin fecha)'}; responsable: ${f.owner ?? '(sin dueño declarado)'}`
                    : `${f.kind}:${f.id} ${f.file}:${f.line}`),
                ...weakWaivers.map((waiver) => `waiverWeak ${waiver.id} ${waiver.file}:${waiver.line} — excepción sin dueño ("owner") en ${waiver.waiverPath}`),
            ];
            return finalize(true, findings.length > 0, (findings.length > 0
                ? `${findings.length} hallazgo(s) de línea base de seguridad.`
                : `${files.length} fichero(s) del cambio sin secretos, comandos destructivos ni patrones de inyección.`) +
                suppressedNote +
                expiredNote +
                weakNote, evidence);
        }
        case 'C3': {
            const tasksText = await readIfExists(path.join(specDir, 'tasks.md'));
            if (tasksText === null) {
                return finalize(true, false, 'Sin tasks.md: no hay afirmaciones de completitud que validar todavía.');
            }
            const lock = checkEvidenceLock(tasksText);
            return finalize(true, !lock.satisfied, lock.detail, lock.unprovenCompletions.map((u) => u.taskId));
        }
        case 'C4': {
            const refs = ctx.referencedSymbols ?? [];
            if (refs.length === 0) {
                return finalize(true, false, 'El cambio no referencia símbolos con prefijo de módulo.');
            }
            const sources = [];
            const walk = async (dir) => {
                const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
                for (const e of entries) {
                    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist')
                        continue;
                    const full = path.join(dir, e.name);
                    if (e.isDirectory())
                        await walk(full);
                    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) {
                        const content = await readIfExists(full);
                        if (content)
                            sources.push({ path: full, content });
                    }
                }
            };
            await walk(path.join(ctx.cwd, 'tools', 'open-sdd', 'src'));
            const verdicts = checkSymbols(buildSymbolIndex(sources), refs);
            const absent = verdicts.filter((v) => v.classification === 'absent');
            return finalize(true, absent.length > 0, `${verdicts.length - absent.length}/${verdicts.length} referencia(s) resueltas o declaradas indecidibles fuera del dominio.`, absent.map((a) => a.symbol));
        }
        case 'C5': {
            // No model backend: degrade honestly. A heuristic is NOT evidence of intent alignment.
            return finalize(false, false, 'mode=degraded: sin backend de modelo alcanzable se declara heurística de palabras clave, no juicio, y NO cuenta como evidencia de alineamiento de intención.');
        }
        case 'C6': {
            const missing = [];
            const candidates = ['README.md', 'CLAUDE.md', 'package.json', `tools/open-sdd/package.json`];
            for (const rel of candidates) {
                if ((await readIfExists(path.join(ctx.cwd, rel))) === null)
                    missing.push(rel);
            }
            return finalize(true, missing.length > 0, missing.length > 0
                ? `Documentación referenciada inexistente: ${missing.join(', ')}.`
                : 'Afirmaciones documentales con soporte presente en el repositorio.', missing);
        }
        case 'C7':
            // Declared but vacuous in the reference implementation, and we do not launder that.
            return finalize(true, false, 'Activación sin medición: el gate no inspecciona diff ni código, así que no acredita disciplina alguna.');
        case 'O1': {
            const manifest = (await readIfExists(path.join(ctx.cwd, 'package.json'))) !== null;
            const lock = (await readIfExists(path.join(ctx.cwd, 'tools/open-sdd/package-lock.json'))) !== null;
            return finalize(true, !manifest, manifest ? `Manifiesto presente. Lockfile ${lock ? 'presente' : 'ausente'}.` : 'Sin manifiesto de dependencias.', []);
        }
        case 'O2': {
            const declared = ctx.mcpServers ?? [];
            if (declared.length === 0)
                return finalize(true, false, 'No hay servidores MCP de terceros declarados.');
            const allow = new Set(ctx.mcpAllowlist ?? []);
            const unlisted = declared.filter((s) => !allow.has(s));
            return finalize(true, unlisted.length > 0, unlisted.length > 0 ? `Servidores MCP fuera de la lista blanca: ${unlisted.join(', ')}.` : `${declared.length} servidor(es) MCP verificados contra la lista blanca.`, unlisted);
        }
        case 'O3': {
            if (!ctx.graphIndexPath) {
                return finalize(false, false, 'Sin índice estructural construido: el grafo no existe todavía, así que la frescura no es medible.');
            }
            const exists = (await stat(path.join(ctx.cwd, ctx.graphIndexPath)).catch(() => null)) !== null;
            if (!exists)
                return finalize(false, false, `El índice declarado ${ctx.graphIndexPath} no existe.`);
            // Freshness is measured against HEAD, never against the working tree: anchoring it to the
            // tree declares the index stale the moment anyone edits a file, i.e. during all real work,
            // which turns the degraded mode into the normal mode and the control into a decoration.
            return finalize(true, false, 'Índice presente; la frescura se mide contra HEAD y no contra el árbol de trabajo.');
        }
        case 'O4': {
            const plan = (await readIfExists(path.join(specDir, 'plan.md'))) ?? (await readIfExists(path.join(specDir, 'design.md')));
            if (plan === null)
                return finalize(true, false, 'Sin plan.md/design.md: no hay referencias a ADRs que verificar.');
            const refs = Array.from(plan.matchAll(/ADR[-\s]?(\d+)/gi)).map((m) => m[1]);
            if (refs.length === 0)
                return finalize(true, false, 'El plan no cita ADRs.');
            const adrDir = path.join(ctx.cwd, 'docs', 'adr');
            const present = await readdir(adrDir).catch(() => []);
            const missing = refs.filter((n) => !present.some((f) => f.includes(n)));
            return finalize(true, missing.length > 0, missing.length > 0 ? `ADR(s) citados sin registro: ${missing.join(', ')}.` : `${refs.length} ADR(s) citados y presentes.`, missing);
        }
        case 'O5': {
            if (!ctx.memory) {
                return finalize(false, false, 'Memoria viva no configurada: no hay inbox que destilar.');
            }
            const { undigestedItems, hoursSinceLastDistillation, maxHoursBetweenDistillations } = ctx.memory;
            const stale = hoursSinceLastDistillation > maxHoursBetweenDistillations;
            return finalize(true, stale, stale ? `Inbox sin destilar ${hoursSinceLastDistillation}h (máximo ${maxHoursBetweenDistillations}h) con ${undigestedItems} ítem(s).` : 'Destilado al día.');
        }
        case 'O6': {
            const refs = ctx.contextReferences ?? [];
            if (refs.length === 0)
                return finalize(true, false, 'El contexto cargado no referencia ficheros.');
            const missing = [];
            for (const rel of refs) {
                if ((await stat(path.join(ctx.cwd, rel)).catch(() => null)) === null)
                    missing.push(rel);
            }
            return finalize(true, missing.length > 0, missing.length > 0 ? `Referencias de contexto inexistentes: ${missing.join(', ')}.` : `${refs.length} referencia(s) de contexto existen.`, missing);
        }
        case 'O7': {
            const claims = ctx.claims ?? [];
            const byPath = new Map();
            const now = Date.now();
            for (const c of claims) {
                if (now - new Date(c.grantedAt).getTime() >= c.ttlMs)
                    continue;
                const list = byPath.get(c.path) ?? [];
                list.push(c.owner);
                byPath.set(c.path, list);
            }
            const overlaps = Array.from(byPath.entries()).filter(([, owners]) => owners.length > 1);
            return finalize(true, overlaps.length > 0, overlaps.length > 0 ? `${overlaps.length} solapamiento(s) de reclamación de fichero.` : `${claims.length} reclamación(es) sin solapamiento vivo.`, overlaps.map(([p, o]) => `${p}: ${o.join(', ')}`));
        }
        default:
            return finalize(false, false, `Control "${gateId}" no reconocido en el catálogo declarado.`);
    }
};
/** Run the resolved chain in order and report declared-vs-executed honestly. */
export const runChain = async (gateIds, ctx, regime = 'flexible') => {
    const findings = [];
    for (const id of gateIds)
        findings.push(await runGate(id, ctx, regime));
    const unavailable = findings
        .filter((f) => f.outcome === 'self-authorized')
        .map((f) => f.gateId);
    return {
        feature: ctx.feature,
        regime,
        findings,
        passed: !findings.some((f) => f.outcome === 'fail'),
        unavailable,
    };
};
