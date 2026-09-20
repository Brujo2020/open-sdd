/**
 * Reverse-engineered constitution (brownfield objective, §12 of the reference architecture).
 *
 * The first brownfield constitution must be DESCRIPTIVE: the principles the code already obeys, with
 * the current stack declared an established fact. The purpose is narrow and concrete — stop an agent
 * from silently "modernizing" code nobody asked it to modernize. A routinely ignored aspirational
 * governance document is worse than none, because it teaches the team that the file does not matter.
 *
 * So this generator makes one distinction the whole design rests on:
 *
 *   PRESENT AND OBEYED  -> a descriptive principle, which must cite the evidence in the code.
 *   DESIRED BUT ABSENT  -> a proposed amendment, explicitly not in force, with a migration plan to
 *                          be written. Aspiration enters later as an explicit governed amendment.
 *
 * Nothing aspirational is ever emitted as a fact. That is not a stylistic preference: a descriptive
 * principle without evidence is a wish recorded as a fact, and `validateConstitution` rejects it.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveBoundaries, tomlArrayTables, tomlSections } from './reverseEngineering.js';
const exists = async (p) => (await stat(p).catch(() => null)) !== null;
const firstExisting = async (cwd, candidates) => {
    for (const candidate of candidates) {
        if (await exists(path.join(cwd, candidate)))
            return candidate;
    }
    return undefined;
};
const listDirs = async (cwd, candidates) => {
    const found = [];
    for (const candidate of candidates) {
        if (await exists(path.join(cwd, candidate)))
            found.push(candidate);
    }
    return found;
};
const listFiles = async (cwd, dir, limit = 200) => {
    const out = [];
    const walk = async (current, depth) => {
        if (depth > 4 || out.length >= limit)
            return;
        const entries = await readdir(path.join(cwd, current), { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            if (out.length >= limit)
                return;
            if (entry.name === 'node_modules' || entry.name === '.git')
                continue;
            const rel = path.join(current, entry.name);
            if (entry.isDirectory())
                await walk(rel, depth + 1);
            else
                out.push(rel);
        }
    };
    if (await exists(path.join(cwd, dir)))
        await walk(dir, 0);
    return out;
};
/**
 * The filename heuristic, kept ONLY as a labelled fallback for modules whose manifests declare no
 * public surface. A name matching this is a guess; a manifest field is a declaration.
 */
const API_ENTRY_NAME = /(^|\/)(index|main|mod|api|routes?)\.(ts|js|mjs|py|go|rb|java|rs)$/;
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
/**
 * A manifest field names the public surface only when it is a path inside the repository. A bare
 * package specifier (`"main": "lodash"`), a subpath import (`#internal`) or a URL is not one.
 */
const normalizeApiTarget = (value) => {
    const raw = value.trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('node:') || /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
        return null;
    }
    const stripped = raw.replace(/^\.\//, '');
    if (!stripped)
        return null;
    const last = stripped.split('/').pop() ?? '';
    if (!stripped.includes('/') && !last.includes('.'))
        return null;
    return stripped;
};
const joinModulePath = (root, target) => {
    const normalized = target.replace(/^\.\//, '');
    if (root === '.' || root === '')
        return normalized;
    return normalized.startsWith(`${root}/`) ? normalized : `${root}/${normalized}`;
};
const apiDeclarationsFromPackageJson = (pkg, root) => {
    const out = [];
    const push = (value, kind) => {
        if (typeof value !== 'string')
            return;
        const target = normalizeApiTarget(value);
        if (target)
            out.push({ module: root, source: 'package.json', kind, target: joinModulePath(root, target) });
    };
    push(pkg.main, 'main');
    push(pkg.module, 'module');
    if (isRecord(pkg.bin)) {
        for (const [binName, binValue] of Object.entries(pkg.bin))
            push(binValue, `bin:${binName}`);
    }
    else {
        push(pkg.bin, 'bin');
    }
    // `exports` is a nested tree of conditions and subpaths; every string leaf is a declared entry.
    const walkExports = (value, label) => {
        if (typeof value === 'string') {
            push(value, label ? `exports:${label}` : 'exports');
            return;
        }
        if (Array.isArray(value)) {
            for (const entry of value)
                walkExports(entry, label);
            return;
        }
        if (isRecord(value)) {
            for (const [key, entry] of Object.entries(value))
                walkExports(entry, label ? `${label}.${key}` : key);
        }
    };
    walkExports(pkg.exports, '');
    return out;
};
/** Resolve a Python `module.path:callable` entry point to the file that holds it, when it exists. */
const resolvePythonEntryPoint = async (cwd, root, value) => {
    const dotted = value.split(':')[0].trim();
    if (!dotted || !/^[A-Za-z_][\w.]*$/.test(dotted))
        return value.trim();
    const relPath = dotted.replace(/\./g, '/');
    const bases = root === '.' ? ['.', 'src'] : [root, `${root}/src`];
    for (const base of bases) {
        for (const candidate of [`${relPath}.py`, `${relPath}/__init__.py`]) {
            const joined = base === '.' ? candidate : `${base}/${candidate}`;
            if ((await stat(path.join(cwd, joined)).catch(() => null)) !== null)
                return joined;
        }
    }
    // Declared but not resolvable here: keep the declaration verbatim rather than inventing a path.
    return value.trim();
};
const apiDeclarationsFromPyproject = async (cwd, root, rel) => {
    const text = await readFile(path.join(cwd, rel), 'utf8').catch(() => null);
    if (text === null)
        return [];
    const out = [];
    const sections = tomlSections(text);
    for (const sectionName of ['project.scripts', 'project.gui-scripts', 'tool.poetry.scripts']) {
        const body = sections.get(sectionName);
        if (!body)
            continue;
        for (const match of body.matchAll(/^\s*([A-Za-z0-9_.-]+)\s*=\s*["']([^"']+)["']/gm)) {
            out.push({
                module: root,
                source: rel,
                kind: `entry-point:${match[1]}`,
                target: await resolvePythonEntryPoint(cwd, root, match[2]),
            });
        }
    }
    return out;
};
const apiDeclarationsFromCargo = async (cwd, root, rel) => {
    const text = await readFile(path.join(cwd, rel), 'utf8').catch(() => null);
    if (text === null)
        return [];
    const out = [];
    const sections = tomlSections(text);
    const lib = sections.get('lib');
    if (lib) {
        const declared = /(?:^|\n)\s*path\s*=\s*["']([^"']+)["']/.exec(lib)?.[1];
        out.push({ module: root, source: rel, kind: 'lib', target: joinModulePath(root, declared ?? 'src/lib.rs') });
    }
    for (const bin of tomlArrayTables(text, 'bin')) {
        const name = /(?:^|\n)\s*name\s*=\s*["']([^"']+)["']/.exec(bin)?.[1];
        const declared = /(?:^|\n)\s*path\s*=\s*["']([^"']+)["']/.exec(bin)?.[1];
        const target = declared ?? (name ? `src/bin/${name}.rs` : 'src/main.rs');
        out.push({ module: root, source: rel, kind: `bin${name ? `:${name}` : ''}`, target: joinModulePath(root, target) });
    }
    return out;
};
const apiDeclarationsFromSetupPy = async (cwd, root, rel) => {
    const text = await readFile(path.join(cwd, rel), 'utf8').catch(() => null);
    if (text === null)
        return [];
    const out = [];
    for (const marker of text.matchAll(/console_scripts/g)) {
        const window = text.slice(marker.index, marker.index + 400);
        for (const entry of window.matchAll(/([A-Za-z0-9_.-]+)\s*=\s*([A-Za-z_][\w.]*(?::[\w.]+)?)/g)) {
            out.push({
                module: root,
                source: rel,
                kind: `entry-point:${entry[1]}`,
                target: await resolvePythonEntryPoint(cwd, root, entry[2]),
            });
        }
    }
    return out;
};
/**
 * Read the public API surface from the manifests, module by module (REQ-MAT-003). The filename
 * heuristic runs only inside a module whose manifests declared no surface at all, and the result
 * always says which source produced it.
 */
const collectPublicApi = async (cwd, project) => {
    const moduleRoots = ['.', ...(project.workspaceRoots ?? [])].filter((root, index, all) => all.indexOf(root) === index);
    const orderedRoots = [...moduleRoots].sort((a, b) => b.length - a.length);
    const ownerOf = (target) => {
        const normalized = target.split(path.sep).join('/');
        for (const root of orderedRoots) {
            if (root === '.' || normalized === root || normalized.startsWith(`${root}/`))
                return root;
        }
        return '.';
    };
    const sourceDirsByModule = new Map();
    for (const dir of project.sourceDirs.length > 0 ? project.sourceDirs : ['src']) {
        const owner = ownerOf(dir);
        sourceDirsByModule.set(owner, [...(sourceDirsByModule.get(owner) ?? []), dir]);
    }
    const declarations = [];
    const heuristicFiles = [];
    let manifestModules = 0;
    let heuristicModules = 0;
    for (const root of moduleRoots) {
        const declaredForModule = [];
        for (const manifestName of ['package.json', 'pyproject.toml', 'Cargo.toml']) {
            const rel = root === '.' ? manifestName : `${root}/${manifestName}`;
            if ((await stat(path.join(cwd, rel)).catch(() => null)) === null)
                continue;
            if (manifestName === 'package.json') {
                const pkg = JSON.parse(await readFile(path.join(cwd, rel), 'utf8').catch(() => 'null'));
                if (isRecord(pkg))
                    declaredForModule.push(...apiDeclarationsFromPackageJson(pkg, root));
            }
            else if (manifestName === 'pyproject.toml') {
                declaredForModule.push(...(await apiDeclarationsFromPyproject(cwd, root, rel)));
            }
            else {
                declaredForModule.push(...(await apiDeclarationsFromCargo(cwd, root, rel)));
            }
        }
        const setupRel = root === '.' ? 'setup.py' : `${root}/setup.py`;
        if ((await stat(path.join(cwd, setupRel)).catch(() => null)) !== null) {
            declaredForModule.push(...(await apiDeclarationsFromSetupPy(cwd, root, setupRel)));
        }
        if (declaredForModule.length > 0) {
            manifestModules += 1;
            declarations.push(...declaredForModule);
            continue;
        }
        heuristicModules += 1;
        for (const dir of sourceDirsByModule.get(root) ?? []) {
            const files = await listFiles(cwd, dir, 600);
            for (const file of files)
                if (API_ENTRY_NAME.test(file))
                    heuristicFiles.push(file);
        }
    }
    const source = manifestModules > 0 && heuristicModules > 0
        ? 'manifest+filename-heuristic'
        : manifestModules > 0
            ? 'manifest'
            : heuristicModules > 0
                ? 'filename-heuristic'
                : 'none';
    const detail = source === 'manifest'
        ? `API pública declarada por manifiesto en ${manifestModules} módulo(s).`
        : source === 'manifest+filename-heuristic'
            ? `API pública declarada por manifiesto en ${manifestModules} módulo(s) e inferida por nombre de fichero en ${heuristicModules} módulo(s) sin declaración.`
            : source === 'filename-heuristic'
                ? 'API pública inferida por nombre de fichero (index/main/mod/api/routes): ningún manifiesto la declaró.'
                : 'API pública: ningún manifiesto la declaró y no se observó ningún fichero de entrada convencional.';
    const files = Array.from(new Set([...declarations.map((declaration) => declaration.target), ...heuristicFiles])).sort();
    return { files, declarations, source, detail };
};
/** Gather the facts a descriptive constitution needs to cite as evidence. */
export const collectRepoFacts = async (cwd, project) => {
    const lockfile = await firstExisting(cwd, [
        'package-lock.json',
        'pnpm-lock.yaml',
        'yarn.lock',
        'poetry.lock',
        'requirements.txt.lock',
        'Gemfile.lock',
        'go.sum',
        'Cargo.lock',
        'tools/open-sdd/package-lock.json',
    ]);
    const migrationDirs = await listDirs(cwd, [
        'migrations',
        'db/migrate',
        'database/migrations',
        'src/migrations',
        'prisma/migrations',
        'alembic/versions',
        'flyway',
        'liquibase',
    ]);
    const rollbackMigrations = [];
    for (const dir of migrationDirs) {
        const files = await listFiles(cwd, dir);
        for (const file of files) {
            // The token is a word inside the file name, not a prefix followed by a dot: matching only
            // `down.` missed `20240101_add_orders_down.sql` and `down_20240101.sql`, which under-reported
            // rollback coverage and made the C-DB-ROLLBACK principle wrong.
            const base = path.basename(file).toLowerCase();
            if (/(^|[._-])(down|rollback|revert)([._-]|$)/.test(base))
                rollbackMigrations.push(file);
        }
    }
    const ciWorkflows = (await listFiles(cwd, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f));
    // The declared surface, read from the manifests; the filename heuristic is a labelled fallback.
    const publicApi = await collectPublicApi(cwd, project);
    const configFiles = (await listFiles(cwd, '.', 400)).filter((f) => {
        const looksLikeConfig = /(^|\/)(\.env\.[a-z]+|config\.(ts|js|json|ya?ml)|settings\.(ts|py|json|ya?ml)|application\.(properties|ya?ml))$/.test(f);
        // `.env.example`, `.env.sample` and `.env.template` are documentation, not configuration in
        // force. Counting them as integration points inflates the evidence.
        const isExample = /\.(example|sample|template|dist)$/i.test(f);
        return looksLikeConfig && !isExample;
    });
    return {
        project,
        ...(lockfile ? { lockfile } : {}),
        migrationDirs,
        rollbackMigrations,
        ciWorkflows,
        publicApiFiles: publicApi.files,
        publicApiDeclarations: publicApi.declarations,
        publicApiSource: publicApi.source,
        publicApiDetail: publicApi.detail,
        configFiles,
    };
};
const amendment = (id, title, proposedBy) => ({
    id,
    title,
    proposedBy,
    status: 'proposed',
});
/**
 * Build the descriptive constitution.
 *
 * `proposedBy` is recorded on every amendment: governance that cannot name who proposes it is not
 * governance, it is text.
 */
export const buildDescriptiveConstitution = (facts, options = {}) => {
    const proposedBy = options.proposedBy ?? 'sdd-getspecs';
    const now = options.generatedAt ?? new Date().toISOString();
    const project = facts.project;
    const principles = [];
    const amendments = [];
    const detected = [];
    const deferred = [];
    // --- what the code already is: facts, with evidence ------------------------------------------
    /** Sentinel values that mean "not observed" — never evidence of anything. */
    const UNKNOWN = new Set(['unknown', '', 'n/a', 'undefined']);
    const observed = (value) => Boolean(value) && !UNKNOWN.has(String(value).toLowerCase());
    const stackParts = [
        ...(observed(project.language) ? [project.language] : []),
        ...project.frameworks,
        ...(observed(project.packageManager) ? [project.packageManager] : []),
        ...(observed(project.buildTool) ? [project.buildTool] : []),
    ].filter(Boolean);
    const stackEvidence = [
        observed(project.packageManager) ? `package manager: ${project.packageManager}` : undefined,
        facts.lockfile ? `lockfile: ${facts.lockfile}` : undefined,
        observed(project.buildTool) ? `build tool: ${project.buildTool}` : undefined,
    ].filter((v) => Boolean(v));
    if (stackParts.length > 0) {
        detected.push(`stack: ${stackParts.join(', ')}`);
        principles.push({
            id: 'C-STACK-FACT',
            title: 'El stack actual es un hecho establecido',
            threatReference: 'modernización silenciosa',
            level: 'MUST',
            restriction: 'No sustituir ni actualizar lenguaje, framework, gestor de paquetes o herramienta de build sin una enmienda gobernada.',
            pattern: 'Construir sobre el stack declarado; toda dependencia nueva se declara en el manifiesto y se justifica en la delta.',
            justification: 'Impide que el agente modernice por su cuenta código que nadie pidió modernizar, que es el modo de fallo dominante al adoptar SDD sobre un sistema en producción.',
            provenance: 'descriptive',
            evidence: stackEvidence.length > 0 ? stackEvidence : [`stack detectado: ${stackParts.join(', ')}`],
        });
    }
    if (facts.publicApiFiles.length > 0) {
        detected.push(`API pública: ${facts.publicApiFiles.length} punto(s) de entrada (origen: ${facts.publicApiSource})`);
        principles.push({
            id: 'C-API-COMPAT',
            title: 'Preservar la compatibilidad de la API pública',
            threatReference: 'cambio incompatible',
            level: 'MUST',
            restriction: 'Ninguna exportación, ruta o esquema público se altera de forma incompatible sin una entrada REMOVED o MODIFIED en la delta que declare su migración.',
            pattern: 'Preferir cambios aditivos; marcar como obsoleto antes de retirar; toda retirada viaja con su ruta de migración y sus contratos.',
            justification: 'Los consumidores externos e internos del sistema no están en este repositorio y no se pueden actualizar en el mismo cambio.',
            provenance: 'descriptive',
            evidence: [`origen de la API pública: ${facts.publicApiSource}`, ...facts.publicApiFiles.slice(0, 8)],
        });
    }
    // ONE boundary vocabulary (REQ-MAT-010): the same function the bootstrap module map uses. The
    // constitution names the boundaries the module map builds, never a second, private list.
    const boundarySet = resolveBoundaries(project);
    const hasBoundaryEvidence = project.sourceDirs.length > 0 || project.modules.length > 0;
    if (boundarySet.source === 'declared-modules' || hasBoundaryEvidence) {
        detected.push(`fronteras: ${boundarySet.boundaries.length} (${boundarySet.detail})`);
        principles.push({
            id: 'C-BOUNDARIES',
            title: 'Seguir los límites de servicio existentes',
            // SHOULD, not MUST: crossing a boundary is a legitimate engineering decision as long as the
            // delta declares it. A constitution where every line is MUST stops distinguishing between a
            // rule nobody may break and a rule that may be broken with justification — and stops meaning
            // anything, which the module's own validator warns about.
            level: 'SHOULD',
            restriction: 'Un cambio no cruza una frontera de módulo salvo que la delta declare explícitamente el cruce.',
            pattern: 'Mantener el cambio dentro de los límites declarados por el nodo del DAG de tareas; el cruce se justifica en el análisis de impacto.',
            justification: 'Las fronteras actuales codifican decisiones de arquitectura que siguen vigentes; ignorarlas convierte un cambio acotado en una refactorización involuntaria.',
            provenance: 'descriptive',
            evidence: boundarySet.boundaries.slice(0, 8),
        });
    }
    if (project.testFramework && project.testDirs.length > 0) {
        detected.push(`oráculo de regresión: ${project.testFramework} en ${project.testDirs.join(', ')}`);
        principles.push({
            id: 'C-REGRESSION-ORACLE',
            title: 'Los tests existentes son el oráculo de regresión',
            // A MUST must name the threat it prevents, or it is an arbitrary rule (CSDD §3.2). Here the
            // threat is a silent behaviour change that no test would catch.
            threatReference: 'cambio de comportamiento silencioso',
            level: 'MUST',
            restriction: 'Un comportamiento con cobertura no puede cambiar sin que sus contratos sigan pasando o se actualicen de forma explícita.',
            pattern: 'Toda entrada MODIFIED o REMOVED declara los contratos que cubren el comportamiento afectado; el pipeline los ejecuta.',
            justification: 'En brownfield el primer uso de la especificación extraída no es documentar sino proteger lo que no debe cambiar.',
            provenance: 'descriptive',
            evidence: [`${project.testFramework}`, ...project.testDirs.slice(0, 4)],
        });
    }
    else {
        deferred.push('oráculo de regresión (no se detectaron tests)');
        amendments.push(amendment('AMD-REGRESSION-ORACLE', 'Establecer un oráculo de regresión ejecutable', proposedBy));
    }
    if (facts.migrationDirs.length > 0 && facts.rollbackMigrations.length > 0) {
        detected.push(`migraciones con rollback: ${facts.rollbackMigrations.length}`);
        principles.push({
            id: 'C-DB-ROLLBACK',
            title: 'Toda migración de base de datos incluye plan de rollback',
            level: 'MUST',
            restriction: 'Ninguna migración se admite sin su contraparte de reversión.',
            pattern: 'Añadir el fichero down/rollback junto a la migración y verificar que se aplica.',
            justification: 'Una migración sin reversión convierte un fallo de despliegue en una pérdida de datos.',
            provenance: 'descriptive',
            evidence: [...facts.migrationDirs, ...facts.rollbackMigrations.slice(0, 4)],
        });
    }
    else if (facts.migrationDirs.length > 0) {
        deferred.push('rollback en migraciones (hay migraciones, no se detectó contraparte down/rollback)');
        amendments.push(amendment('AMD-DB-ROLLBACK', 'Exigir plan de rollback en toda migración', proposedBy));
    }
    if (facts.ciWorkflows.length > 0) {
        detected.push(`CI: ${facts.ciWorkflows.length} workflow(s)`);
    }
    // --- what is desired but not observed: amendments, never facts --------------------------------
    deferred.push('política de reutilización primero (práctica, no un hecho del código)');
    amendments.push(amendment('AMD-REUSE-FIRST', 'Política de reutilización primero al crear símbolos nuevos', proposedBy));
    deferred.push('documentación incremental: la cobertura crece donde se toca el código');
    amendments.push(amendment('AMD-INCREMENTAL-DOCS', 'Cobertura de especificación creciente en el punto de cambio', proposedBy));
    const constitution = {
        project: project.name,
        provenance: 'descriptive',
        generatedAt: now,
        establishedFacts: [
            ...(observed(project.language) ? [`Lenguaje: ${project.language}`] : []),
            ...(project.frameworks.length > 0 ? [`Frameworks: ${project.frameworks.join(', ')}`] : []),
            ...(project.packageManager ? [`Gestor de paquetes: ${project.packageManager}`] : []),
            ...(project.buildTool ? [`Build: ${project.buildTool}`] : []),
            ...(project.testFramework ? [`Tests: ${project.testFramework}`] : []),
            ...(facts.lockfile ? [`Dependencias fijadas por ${facts.lockfile}`] : []),
        ],
        principles,
        amendments,
    };
    return { constitution, detected, deferred };
};
