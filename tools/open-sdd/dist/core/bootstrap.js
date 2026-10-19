/**
 * Brownfield bootstrap: one entry point from "repo as it is" to "governed workflow".
 *
 * The brownfield console already ships every piece this needs — `scanProject` (workspace-aware
 * reconnaissance), `findReuseCandidates` (search before you create), `collectRepoFacts` +
 * `buildDescriptiveConstitution` (the constitution derived from the code), and the delta commands.
 * What was missing was the composition and two artifacts:
 *
 *   1. the **module responsibility map**, with an answer to "where does new code go?"; and
 *   2. the **code-intelligence document** for agents (our answer to `repomix --skill-generate`).
 *
 * This module composes, it does not re-scan and it does not re-implement symbol search: every
 * module, source/test directory and reuse candidate below comes from those existing scanners.
 *
 * ── The rule that governs everything here ───────────────────────────────────────────────────────
 * Nothing is reported as inspected when it was not. An empty `responsibilities` array means the
 * evidence did not support a responsibility, not that the module has none; `complete: false` means
 * the map could not be fully derived and the `detail` says which part could not be read. A module
 * map that invents responsibilities is worse than no map, because an agent will place code by it.
 */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ECOSYSTEM_LABEL, resolveBoundaries, scanProject, } from './reverseEngineering.js';
import { findReuseCandidates } from './reuseFirst.js';
import { resolveSddDir } from './specManager.js';
/** Marker that identifies the code-intelligence document as ours, so it is safe to regenerate. */
export const CODE_INTELLIGENCE_MARKER = '<!-- generated-by: open-sdd brownfield bootstrap -->';
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.turbo']);
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|kt|rs)$/;
const CLI_FILE = /(^|\/)(cli|main)\.(ts|js|mjs|mts|cjs)$/;
const MAX_FILES_PER_MODULE = 800;
/**
 * Términos que no identifican una responsabilidad o propiedad de módulo: aparecen en cualquier
 * layout y harían que una descripción genérica («mejorar el paquete») pareciera una coincidencia.
 */
const MATCH_NOISE = new Set([
    'package',
    'json',
    'src',
    'test',
    'tests',
    'index',
    'main',
    'lib',
    'app',
    'los',
    'las',
    'una',
    'unos',
    'unas',
    'del',
    'con',
    'por',
    'para',
    'como',
    'que',
    'the',
    'and',
    'for',
    'with',
]);
const exists = async (p) => (await stat(p).catch(() => null)) !== null;
const posix = (p) => p.split(path.sep).join('/');
const readManifest = async (cwd, rel) => {
    if (!(await exists(path.join(cwd, rel))))
        return { pkg: null, unreadable: false };
    try {
        const parsed = JSON.parse(await readFile(path.join(cwd, rel), 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return { pkg: null, unreadable: true };
        return { pkg: parsed, unreadable: false };
    }
    catch {
        return { pkg: null, unreadable: true };
    }
};
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const manifestDeclaresWorkspaces = (pkg) => {
    if (!pkg)
        return false;
    const declared = pkg.workspaces;
    if (Array.isArray(declared))
        return declared.length > 0;
    return isRecord(declared) && Array.isArray(declared.packages) && declared.packages.length > 0;
};
/** Lista los ficheros de código bajo los directorios observados, sin inventar ninguno. */
const listModuleFiles = async (cwd, dirs) => {
    const files = [];
    const unreadable = [];
    let truncated = false;
    const seenDirs = new Set();
    const walk = async (rel, depth) => {
        if (truncated || depth > 8)
            return;
        let entries;
        try {
            entries = await readdir(path.join(cwd, rel), { withFileTypes: true });
        }
        catch {
            unreadable.push(rel);
            return;
        }
        for (const entry of entries) {
            if (truncated)
                return;
            if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name))
                continue;
            const child = posix(path.join(rel, entry.name));
            if (entry.isDirectory()) {
                await walk(child, depth + 1);
                continue;
            }
            if (!entry.isFile() || !SOURCE_EXT.test(entry.name))
                continue;
            if (files.length >= MAX_FILES_PER_MODULE) {
                truncated = true;
                return;
            }
            files.push(child);
        }
    };
    for (const dir of dirs) {
        if (seenDirs.has(dir))
            continue;
        seenDirs.add(dir);
        await walk(dir, 0);
    }
    return { files, unreadable, truncated };
};
/** Un fichero es `type-only` cuando solo declara tipos: no exporta nada en tiempo de ejecución. */
const isTypeOnlyFile = (content) => {
    const code = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const runtime = /(^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|enum)\s+[A-Za-z_$]/.test(code) ||
        /(^|\n)\s*export\s+default\b/.test(code) ||
        /(^|\n)\s*export\s*\{(?!\s*type\b)/.test(code) ||
        /(^|\n)\s*export\s*\*(?!\s*as\s+type\b)/.test(code);
    const typeDeclaration = /(^|\n)\s*(?:export\s+)?(?:declare\s+)?(?:type|interface)\s+[A-Za-z_$]/.test(code);
    return !runtime && typeDeclaration;
};
/**
 * Specifiers de import/export, incluyendo `from '…'`, `import('…')`, `require('…')` e
 * `import '…'` de efecto lateral. Solo se usan los relativos, que son los que cruzan módulos.
 */
const IMPORT_SPECIFIER = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|(?:^|\n)\s*import\s+)['"]([^'"]+)['"]/g;
const relativeTargets = (content, file) => {
    const targets = [];
    for (const match of content.matchAll(IMPORT_SPECIFIER)) {
        const specifier = match[1];
        if (!specifier.startsWith('.'))
            continue;
        targets.push(posix(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))));
    }
    return targets;
};
const tokensOf = (text) => Array.from(new Set(text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !MATCH_NOISE.has(token))));
const slugify = (value) => value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
export const buildModuleMap = async (cwd) => {
    const project = await scanProject(cwd);
    // The boundaries come from the ONE shared vocabulary, so the module map and the constitution
    // cannot name different boundaries for the same repository (REQ-MAT-010).
    const modulePaths = resolveBoundaries(project).boundaries;
    const workspaceRoots = modulePaths.filter((modulePath) => modulePath !== '.');
    const notes = [];
    let complete = true;
    // Ecosystem per module root. A path declared by two toolchains keeps the first declaration for
    // the label (the repository root prefers its primary manifest) and says so in the detail.
    const moduleInfo = new Map();
    const declaredByPath = new Map();
    for (const declared of project.declaredModules ?? []) {
        const ecosystems = declaredByPath.get(declared.path) ?? [];
        if (!ecosystems.includes(declared.ecosystem))
            ecosystems.push(declared.ecosystem);
        declaredByPath.set(declared.path, ecosystems);
        if (!moduleInfo.has(declared.path)) {
            moduleInfo.set(declared.path, { ecosystem: declared.ecosystem, manifest: declared.manifest });
        }
    }
    for (const modulePath of modulePaths) {
        if (!moduleInfo.has(modulePath))
            moduleInfo.set(modulePath, { ecosystem: 'unknown' });
    }
    for (const [modulePath, ecosystems] of declaredByPath) {
        if (ecosystems.length <= 1)
            continue;
        notes.push(`${modulePath} está declarado por más de un ecosistema (${ecosystems
            .map((ecosystem) => ECOSYSTEM_LABEL[ecosystem])
            .join(', ')}): el mapa usa ${ECOSYSTEM_LABEL[moduleInfo.get(modulePath).ecosystem]}.`);
    }
    // El módulo propietario de un directorio es el más específico (la ruta más larga) que lo contiene.
    const ordered = [...modulePaths].sort((a, b) => b.length - a.length);
    const ownerOf = (target) => {
        const normalized = posix(target);
        for (const candidate of ordered) {
            if (candidate === '.' || normalized === candidate || normalized.startsWith(`${candidate}/`))
                return candidate;
        }
        return '.';
    };
    const sourceByModule = new Map();
    const testByModule = new Map();
    for (const modulePath of modulePaths) {
        sourceByModule.set(modulePath, []);
        testByModule.set(modulePath, []);
    }
    for (const dir of project.sourceDirs)
        sourceByModule.get(ownerOf(dir)).push(posix(dir));
    for (const dir of project.testDirs)
        testByModule.get(ownerOf(dir)).push(posix(dir));
    // The manifest is whatever declared the module (`package.json`, `pom.xml`, `go.mod`, ...); Node
    // behaviour is unchanged because a Node module always resolves to its `package.json`.
    const manifestRel = (modulePath) => moduleInfo.get(modulePath)?.manifest ??
        (modulePath === '.' ? 'package.json' : `${modulePath}/package.json`);
    const manifests = new Map();
    const manifestExists = new Map();
    let readableManifests = 0;
    for (const modulePath of modulePaths) {
        const rel = manifestRel(modulePath);
        const present = await exists(path.join(cwd, rel));
        manifestExists.set(modulePath, present);
        if (!present) {
            manifests.set(modulePath, null);
            continue;
        }
        if (path.posix.basename(rel) === 'package.json') {
            const { pkg, unreadable } = await readManifest(cwd, rel);
            if (unreadable) {
                complete = false;
                notes.push(`No se pudo leer ${rel}: las dependencias declaradas de ese módulo no se inspeccionaron y su dependsOn puede estar incompleto.`);
            }
            if (pkg)
                readableManifests += 1;
            manifests.set(modulePath, pkg);
        }
        else {
            // A non-JSON manifest (pom.xml, go.mod, ...) is read for its existence; it declares no
            // package.json dependency edges, so `manifests` stays null and no edge is invented.
            const text = await readFile(path.join(cwd, rel), 'utf8').catch(() => null);
            if (text === null) {
                complete = false;
                notes.push(`No se pudo leer ${rel}: las dependencias declaradas de ese módulo no se inspeccionaron y su dependsOn puede estar incompleto.`);
            }
            else {
                readableManifests += 1;
            }
            manifests.set(modulePath, null);
        }
    }
    const nameOf = (modulePath) => {
        const pkg = manifests.get(modulePath);
        const declared = pkg?.name;
        if (typeof declared === 'string' && declared)
            return declared;
        if (modulePath === '.')
            return project.name;
        return path.posix.basename(modulePath);
    };
    // El registro de nombres solo admite nombres DECLARADOS en el manifiesto (o el basename como
    // último recurso): inventar alias produciría aristas de dependencia que nadie declaró.
    const nameToPath = new Map();
    for (const modulePath of modulePaths) {
        const pkg = manifests.get(modulePath);
        const declared = pkg?.name;
        if (typeof declared === 'string' && declared)
            nameToPath.set(declared, modulePath);
        else if (modulePath !== '.')
            nameToPath.set(path.posix.basename(modulePath), modulePath);
    }
    const filesByModule = new Map();
    let declaredEdges = 0;
    let relativeEdges = 0;
    const modules = [];
    for (const modulePath of modulePaths) {
        const pkg = manifests.get(modulePath) ?? null;
        const info = moduleInfo.get(modulePath) ?? { ecosystem: 'unknown' };
        const sourceDirs = sourceByModule.get(modulePath) ?? [];
        const testDirs = testByModule.get(modulePath) ?? [];
        const sourceWalk = await listModuleFiles(cwd, sourceDirs);
        const testWalk = await listModuleFiles(cwd, testDirs);
        filesByModule.set(modulePath, sourceWalk);
        for (const bad of [...sourceWalk.unreadable, ...testWalk.unreadable]) {
            complete = false;
            notes.push(`No se pudo listar ${bad}: parte de ese módulo queda fuera del mapa.`);
        }
        if (sourceWalk.truncated || testWalk.truncated) {
            complete = false;
            notes.push(`Se superó el límite de ${MAX_FILES_PER_MODULE} ficheros en ${modulePath}: la evidencia de ese módulo está truncada.`);
        }
        // --- dependsOn: manifiestos ∩ mapa de módulos -----------------------------------------------
        const dependsOn = new Set();
        if (pkg) {
            for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
                const declared = pkg[field];
                if (!isRecord(declared))
                    continue;
                for (const dependency of Object.keys(declared)) {
                    const target = nameToPath.get(dependency);
                    if (target && target !== modulePath) {
                        dependsOn.add(target);
                        declaredEdges += 1;
                    }
                }
            }
        }
        // --- dependsOn: imports relativos que cruzan la frontera del módulo --------------------------
        for (const file of sourceWalk.files) {
            let content;
            try {
                content = await readFile(path.join(cwd, file), 'utf8');
            }
            catch {
                complete = false;
                notes.push(`No se pudo leer ${file}: no se pudo comprobar si importa otro módulo.`);
                continue;
            }
            for (const resolved of relativeTargets(content, file)) {
                const target = ownerOf(resolved);
                if (target !== modulePath) {
                    dependsOn.add(target);
                    relativeEdges += 1;
                }
            }
        }
        // --- responsibilities: solo lo que la evidencia sostiene ------------------------------------
        const responsibilities = [];
        if (info.ecosystem !== 'node') {
            // The ecosystem is evidence: it is the toolchain that declared this module root.
            responsibilities.push(`módulo ${ECOSYSTEM_LABEL[info.ecosystem]}${info.manifest ? ` declarado por ${info.manifest}` : ''}`);
        }
        if (manifestDeclaresWorkspaces(pkg)) {
            responsibilities.push(`raíz de workspaces: agrupa ${workspaceRoots.length} módulo(s) observado(s)`);
        }
        else if (modulePath === '.' && info.ecosystem !== 'node' && workspaceRoots.length > 0) {
            responsibilities.push(`raíz del repositorio: agrupa ${workspaceRoots.length} módulo(s) observado(s) (${ECOSYSTEM_LABEL[info.ecosystem]})`);
        }
        const binDeclared = pkg?.bin && (typeof pkg.bin === 'string' || isRecord(pkg.bin));
        if (binDeclared) {
            responsibilities.push('expone un ejecutable CLI (declarado en package.json bin)');
        }
        else {
            const cliFile = sourceWalk.files.find((file) => CLI_FILE.test(file));
            if (cliFile)
                responsibilities.push(`punto de entrada CLI observado: ${cliFile}`);
        }
        if (pkg && (pkg.main !== undefined || pkg.module !== undefined || pkg.exports !== undefined)) {
            responsibilities.push('declara una API pública de paquete (main/module/exports en package.json)');
        }
        if (sourceWalk.files.length > 0) {
            const contents = await Promise.all(sourceWalk.files.map((file) => readFile(path.join(cwd, file), 'utf8').catch(() => null)));
            const readable = contents.filter((content) => content !== null);
            if (readable.length === sourceWalk.files.length && readable.every((content) => isTypeOnlyFile(content))) {
                responsibilities.push(`solo declara tipos: ${sourceWalk.files.length} fichero(s) sin implementación en tiempo de ejecución`);
            }
        }
        if (testWalk.files.length > 0 && testWalk.files.length >= sourceWalk.files.length) {
            responsibilities.push(`los tests dominan el módulo: ${testWalk.files.length} fichero(s) de test frente a ${sourceWalk.files.length} de código`);
        }
        const owns = [
            ...(manifestExists.get(modulePath) ? [manifestRel(modulePath)] : []),
            ...sourceDirs,
            ...testDirs,
        ];
        modules.push({
            path: modulePath,
            name: nameOf(modulePath),
            ecosystem: info.ecosystem,
            owns,
            responsibilities,
            dependsOn: Array.from(dependsOn).sort(),
            testDirs,
        });
    }
    if (readableManifests === 0 && project.sourceDirs.length === 0 && project.testDirs.length === 0) {
        complete = false;
        notes.push('No se observó ningún manifiesto legible ni ningún directorio de código o de tests: el mapa está vacío porque no había nada que inspeccionar, no porque no haya módulos.');
    }
    // A declared toolchain that could not be read is named here. The repository is NOT reported as
    // single-module on the strength of a failure to parse its workspace declaration.
    if (project.unreadableToolchains.length > 0) {
        complete = false;
        notes.push(`Declaración de toolchain ilegible (${project.unreadableToolchains.join(', ')}): no se pudo leer qué módulos declara, así que el mapa puede estar incompleto y el repositorio NO se trata como un único módulo.`);
    }
    const ecosystemCounts = new Map();
    for (const modulePath of modulePaths) {
        const ecosystem = moduleInfo.get(modulePath)?.ecosystem ?? 'unknown';
        ecosystemCounts.set(ecosystem, (ecosystemCounts.get(ecosystem) ?? 0) + 1);
    }
    const ecosystemDetail = Array.from(ecosystemCounts.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([ecosystem, count]) => `${ECOSYSTEM_LABEL[ecosystem]} (${count})`)
        .join(', ');
    const detail = [
        `Mapa de módulos: ${modules.length} módulo(s) observado(s) (raíz + ${workspaceRoots.length} workspace(s)).`,
        `Ecosistemas: ${ecosystemDetail}.`,
        `dependsOn derivado de ${declaredEdges} dependencia(s) declarada(s) en manifiestos y ${relativeEdges} import(s) relativo(s) entre módulos.`,
        ...notes,
    ].join(' ');
    return { modules, complete, detail };
};
const moduleHaystack = (entry) => new Set(tokensOf([entry.name, entry.path, ...entry.responsibilities, ...entry.owns].join(' ')));
/**
 * Answer "where does new code go?" from observed evidence, and answer the reuse question at the
 * same time — creating a symbol that already exists is the failure this is meant to prevent.
 */
export const answerCodePlacement = async (input) => {
    const { cwd, description } = input;
    const project = await scanProject(cwd);
    const map = await buildModuleMap(cwd);
    const requests = [
        ...(input.symbol?.trim() ? [{ symbol: input.symbol.trim(), reason: 'símbolo solicitado' }] : []),
        ...(input.candidates ?? [])
            .map((symbol) => symbol.trim())
            .filter(Boolean)
            .map((symbol) => ({ symbol, reason: 'candidato declarado por el llamante' })),
    ];
    const reuse = await findReuseCandidates({ cwd, requests, sourceDirs: project.sourceDirs });
    const reuseCandidates = reuse.candidates.map((candidate) => ({
        symbol: candidate.symbol,
        file: candidate.file,
        line: candidate.line,
        similarity: candidate.similarity,
    }));
    const evidence = [];
    if (!reuse.complete) {
        evidence.push(`la búsqueda de reutilización NO se ejecutó por completo: ${reuse.detail}`);
    }
    const descriptionTokens = tokensOf(description);
    const symbolTokens = tokensOf(requests.map((request) => request.symbol).join(' '));
    if (descriptionTokens.length === 0 && symbolTokens.length === 0) {
        evidence.push('la descripción y los símbolos no aportan ningún término utilizable');
    }
    const ordered = [...map.modules].sort((a, b) => b.path.length - a.path.length);
    const ownerOfFile = (file) => ordered.find((entry) => entry.path === '.' || file === entry.path || file.startsWith(`${entry.path}/`))?.path;
    let match = null;
    for (const entry of map.modules) {
        const haystack = moduleHaystack(entry);
        const hits = Array.from(new Set([...descriptionTokens, ...symbolTokens].filter((token) => haystack.has(token))));
        if (hits.length > 0 && (!match || hits.length > match.hits.length)) {
            match = { modulePath: entry.path, hits };
        }
    }
    // El símbolo existente es la evidencia más fuerte: si ya vive en un módulo, ahí va el cambio.
    const candidateOwners = new Map();
    for (const candidate of reuse.candidates) {
        const owner = ownerOfFile(candidate.file);
        if (!owner)
            continue;
        candidateOwners.set(owner, [...(candidateOwners.get(owner) ?? []), candidate]);
    }
    if (!match && candidateOwners.size > 0) {
        const [owner, candidates] = [...candidateOwners.entries()].sort((a, b) => b[1].length - a[1].length)[0];
        match = { modulePath: owner, hits: candidates.map((candidate) => candidate.symbol) };
    }
    if (match) {
        const entry = map.modules.find((module) => module.path === match.modulePath);
        evidence.push(`señales compartidas con el módulo ${entry.path} (${entry.name}): ${match.hits.join(', ')}`);
        evidence.push(entry.responsibilities.length > 0
            ? `responsabilidades observadas de ${entry.path}: ${entry.responsibilities.join(' · ')}`
            : `${entry.path} no tiene responsabilidades derivables de la evidencia: la coincidencia es por nombre/ruta/ficheros observados`);
        for (const candidate of reuse.candidates.slice(0, 5)) {
            evidence.push(`símbolo existente ${candidate.symbol} en ${candidate.file}:${candidate.line} (similitud ${candidate.similarity})`);
        }
        if (reuseCandidates.length === 0 && reuse.complete) {
            evidence.push('la búsqueda de reutilización se ejecutó y no encontró ningún símbolo parecido');
        }
        const rationale = `La descripción y las señales observadas apuntan a ${entry.path}: el código nuevo pertenece a un módulo ` +
            `existente, y la búsqueda de reutilización precede a cualquier símbolo nuevo. ` +
            (reuseCandidates.length > 0
                ? `Ya hay ${reuseCandidates.length} símbolo(s) reutilizable(s): reutilízalos o justifica la duplicación.`
                : 'No se encontró un símbolo reutilizable, así que crear uno nuevo es legítimo.');
        return { kind: 'existing-module', target: entry.path, evidence, rationale, reuseCandidates };
    }
    const workspaceRoots = project.workspaceRoots ?? [];
    if (workspaceRoots.length > 0) {
        // El contenedor es un directorio OBSERVADO (el padre de los workspaces); la hoja concreta la
        // decide quien cambia, no este informe.
        const container = path.posix.dirname(workspaceRoots[0]);
        evidence.push('ningún término de la descripción coincide con un módulo, responsabilidad o directorio observado');
        evidence.push(`el layout declara workspaces (${workspaceRoots.join(', ')}): el módulo es la unidad de cambio`);
        evidence.push(`contenedor observado para un módulo nuevo: ${container === '.' ? 'raíz del repositorio' : container}`);
        if (reuseCandidates.length > 0) {
            evidence.push(`aun así hay ${reuseCandidates.length} símbolo(s) existente(s) parecido(s): revísalos antes de crear el módulo`);
        }
        const rationale = `Nada observado coincide con la descripción, y el repositorio se organiza en workspaces, ` +
            `así que el código nuevo va en un módulo nuevo bajo ${container === '.' ? 'la raíz' : container}, ` +
            'no dentro de un módulo existente. La hoja concreta la decide quien cambia.';
        return { kind: 'new-module', target: container, evidence, rationale, reuseCandidates };
    }
    evidence.push('ningún término de la descripción coincide con un módulo, responsabilidad o directorio observado');
    evidence.push('el proyecto no declara workspaces ni un contenedor de módulos observable: no hay evidencia de que el módulo sea la unidad de cambio');
    if (reuseCandidates.length === 0 && reuse.complete) {
        evidence.push('la búsqueda de reutilización se ejecutó y no encontró ningún símbolo parecido');
    }
    const rationale = 'Sin coincidencia con lo observado y sin evidencia de un layout multi-módulo, no se puede responder dónde va ' +
        'el código nuevo. Falta: un contenedor de módulos observado o una descripción que nombre el área afectada.';
    return { kind: 'undecidable', evidence, rationale, reuseCandidates };
};
export const writeCodeIntelligence = async (input) => {
    const { cwd, write } = input;
    const project = await scanProject(cwd);
    const built = await buildModuleMap(cwd);
    const modules = input.modules ?? built.modules;
    const suppliedModules = input.modules !== undefined;
    const scripts = [];
    const collectScripts = async (rel, scope) => {
        const { pkg } = await readManifest(cwd, rel);
        if (!pkg || !isRecord(pkg.scripts))
            return;
        for (const [name, command] of Object.entries(pkg.scripts)) {
            if (typeof command === 'string')
                scripts.push({ scope, name, command });
        }
    };
    await collectScripts('package.json', 'raíz');
    for (const module of modules) {
        if (module.path === '.')
            continue;
        await collectScripts(`${module.path}/package.json`, module.path);
    }
    const sddDir = await resolveSddDir(cwd);
    const constitutionRel = posix(path.posix.join(sddDir, 'steering', 'constitution.md'));
    const constitutionExists = await exists(path.join(cwd, constitutionRel));
    const stackLines = [];
    const observedStack = project.language !== 'unknown';
    if (observedStack)
        stackLines.push(`- lenguaje: ${project.language}`);
    if (project.frameworks.length > 0)
        stackLines.push(`- frameworks: ${project.frameworks.join(', ')}`);
    if (project.packageManager)
        stackLines.push(`- gestor de paquetes: ${project.packageManager}`);
    if (project.buildTool)
        stackLines.push(`- build: ${project.buildTool}`);
    if (project.testFramework)
        stackLines.push(`- tests: ${project.testFramework}`);
    if (stackLines.length === 0)
        stackLines.push('- no se observó ningún indicador de stack (sin manifiestos ni config)');
    const notInspected = [
        'El interior de las dependencias (`node_modules`, `vendor`): solo se leen los manifiestos que las declaran.',
        'Artefactos generados (`dist`, `build`, `out`, `coverage`, lockfiles): existen, pero no describen el diseño.',
        'Ficheros fuera de los directorios de código y de tests observados.',
        'Comportamiento en ejecución: no se ha ejecutado ni un test ni un comando; este documento es estático.',
        'Servicios externos, infraestructura, secretos y resultados de CI.',
    ];
    if (!observedStack)
        notInspected.push('El stack no se pudo determinar: no se observaron manifiestos ni configuración de lenguaje.');
    if (scripts.length === 0)
        notInspected.push('No se observó ningún script en los manifiestos: no hay comandos que reportar.');
    if (suppliedModules)
        notInspected.push('El mapa de módulos lo aportó quien llamó; no se volvió a verificar contra el código.');
    if (!built.complete)
        notInspected.push(`El mapa de módulos está incompleto: ${built.detail}`);
    if (!constitutionExists) {
        notInspected.push(`No existe ${constitutionRel}: todavía no hay autoridad constitucional que citar. Genera con \`open-sdd brownfield constitution <root> --write\`.`);
    }
    const lines = [];
    lines.push(`# Inteligencia del código — ${project.name}`);
    lines.push('');
    lines.push(CODE_INTELLIGENCE_MARKER);
    lines.push('');
    lines.push('Documento para agentes: resume lo que el reconocimiento observó en este repositorio para que el ' +
        'agente trabaje sobre él sin reinventar lo que ya existe. Todo lo que aparece aquí está respaldado por ' +
        'archivos que existen; lo que no se pudo determinar se declara en la última sección.');
    lines.push('');
    lines.push('## Stack observado');
    lines.push('');
    lines.push(...stackLines);
    lines.push('');
    lines.push(`## Mapa de módulos (${modules.length})`);
    lines.push('');
    for (const module of modules) {
        lines.push(`### \`${module.path}\` — ${module.name}`);
        lines.push('');
        lines.push(`- posee: ${module.owns.length > 0 ? module.owns.join(', ') : 'no se observaron directorios de código ni de tests'}`);
        lines.push(`- responsabilidades: ${module.responsibilities.length > 0 ? module.responsibilities.join(' · ') : 'ninguna derivable de la evidencia'}`);
        lines.push(`- depende de: ${module.dependsOn.length > 0 ? module.dependsOn.join(', ') : 'ninguno observado'}`);
        lines.push(`- tests: ${module.testDirs.length > 0 ? module.testDirs.join(', ') : 'no se observó directorio de tests'}`);
        lines.push('');
    }
    lines.push('## Dónde viven los tests');
    lines.push('');
    if (project.testDirs.length > 0) {
        for (const dir of project.testDirs)
            lines.push(`- \`${dir}\``);
    }
    else {
        lines.push('No se observó ningún directorio de tests.');
    }
    lines.push('');
    lines.push('## Comandos que funcionan en este repositorio');
    lines.push('');
    lines.push('Reproducidos verbatim desde los manifiestos; no se han ejecutado desde aquí.');
    lines.push('');
    if (scripts.length > 0) {
        for (const script of scripts)
            lines.push(`- **${script.scope}** \`${script.name}\`: \`${script.command}\``);
    }
    else {
        lines.push('No se observó ningún script declarado.');
    }
    lines.push('');
    lines.push('## Autoridad');
    lines.push('');
    if (constitutionExists) {
        lines.push(`La constitución es la autoridad citable: \`${constitutionRel}\`. Este documento no la parafrasea; ` +
            'léela antes de proponer un cambio y cita sus principios (`C-…`) en los veredictos.');
    }
    else {
        lines.push(`Todavía no existe \`${constitutionRel}\`. Genérala con ` +
            '`open-sdd brownfield constitution <root> --write` antes de tratar cualquier regla como autoridad.');
    }
    lines.push('');
    lines.push('## Reutilización primero');
    lines.push('');
    lines.push('Antes de crear un símbolo nuevo, busca uno existente: `open-sdd brownfield reuse <feature> --symbols A,B`. ' +
        'En brownfield la duplicación es el riesgo dominante: dos copias divergen y la que se olvida es la que sigue en producción.');
    lines.push('');
    lines.push('## Lo que NO se ha inspeccionado');
    lines.push('');
    for (const item of notInspected)
        lines.push(`- ${item}`);
    lines.push('');
    const content = lines.join('\n');
    const relPath = posix(path.posix.join(sddDir, 'steering', 'codebase-intelligence.md'));
    const absolute = path.join(cwd, relPath);
    let written = false;
    const problems = [];
    if (write) {
        try {
            await mkdir(path.dirname(absolute), { recursive: true });
            await writeFile(absolute, content, 'utf8');
            written = true;
        }
        catch (error) {
            problems.push(`no se pudo escribir ${relPath}: ${error.message}`);
        }
    }
    const complete = built.complete && observedStack && problems.length === 0;
    const evidenceNotes = [
        `Documento de inteligencia: stack ${observedStack ? 'observado' : 'no determinado'}, ${modules.length} módulo(s), ${scripts.length} script(s) reproducido(s) verbatim.`,
        constitutionExists ? `constitución citada como autoridad: ${constitutionRel}` : `no existe ${constitutionRel}: sin autoridad que citar`,
        input.modules !== undefined
            ? 'mapa de módulos proporcionado por el llamante (no re-verificado).'
            : `mapa de módulos reconstruido desde el código (${built.complete ? 'completo' : 'incompleto'}).`,
        ...problems,
    ];
    const detail = complete
        ? evidenceNotes.join(' ')
        : `${evidenceNotes.join(' ')} Partes no determinadas: ${notInspected.slice(-3).join(' ')}`;
    return { path: relPath, content, written, complete, detail };
};
export const planBootstrap = async (input) => {
    const { cwd, focus } = input;
    const project = await scanProject(cwd);
    const map = await buildModuleMap(cwd);
    const sddDir = await resolveSddDir(cwd);
    // Templates adapted to the observed stack (evidence, not decoration). Loaded dynamically to keep
    // the dependency one-way; a failure here never breaks the plan, it is declared in `detail`.
    let templates = [];
    let adaptationDetail = 'templates adaptadas: no se pudieron derivar.';
    try {
        const { adaptTemplates } = await import('./templateAdaptation.js');
        const adaptation = await adaptTemplates({ cwd, modules: map.modules });
        templates = adaptation.templates;
        adaptationDetail =
            `${adaptation.templates.length} plantilla(s) adaptada(s) a la evidencia` +
                `${adaptation.complete ? '' : ' (incompleta)'}: ${adaptation.actions
                    .map((action) => `${action.path} ${action.action}`)
                    .join(', ')}.`;
    }
    catch (error) {
        adaptationDetail = `templates adaptadas: no se pudieron derivar (${error.message}).`;
    }
    const constitutionRel = posix(path.posix.join(sddDir, 'steering', 'constitution.md'));
    const intelligenceRel = posix(path.posix.join(sddDir, 'steering', 'codebase-intelligence.md'));
    const constitutionExists = await exists(path.join(cwd, constitutionRel));
    const intelligenceRaw = await readFile(path.join(cwd, intelligenceRel), 'utf8').catch(() => null);
    const artifacts = [];
    artifacts.push({
        path: constitutionRel,
        action: constitutionExists ? 'keep' : 'create',
        reason: constitutionExists
            ? 'ya existe una constitución: no se sobrescribe; cualquier cambio entra como enmienda gobernada'
            : 'no existe: el bootstrap la genera desde el código (descriptiva, con evidencia)',
    });
    if (intelligenceRaw === null) {
        artifacts.push({
            path: intelligenceRel,
            action: 'create',
            reason: 'no existe: el bootstrap escribe el documento de inteligencia del código',
        });
    }
    else if (intelligenceRaw.includes(CODE_INTELLIGENCE_MARKER)) {
        artifacts.push({
            path: intelligenceRel,
            action: 'update',
            reason: 'existe y lleva la marca de generación de open-sdd: se puede regenerar desde el código',
        });
    }
    else {
        artifacts.push({
            path: intelligenceRel,
            action: 'keep',
            reason: 'existe y no lleva la marca de generación de open-sdd: se conserva sin tocar',
        });
    }
    const focusSlug = focus ? slugify(focus) : '';
    if (focus && focusSlug) {
        const deltaRel = posix(path.posix.join(sddDir, 'specs', focusSlug, 'delta.md'));
        const deltaExists = await exists(path.join(cwd, deltaRel));
        artifacts.push({
            path: deltaRel,
            action: deltaExists ? 'keep' : 'create',
            reason: deltaExists
                ? 'ya existe una delta para el foco indicado: se conserva'
                : `semilla de delta para el foco «${focus}»`,
        });
    }
    const root = path.resolve(cwd);
    const steps = [
        `Reconocimiento — qué es hoy el repositorio: \`open-sdd brownfield survey ${root}\``,
        `Constitución descriptiva (el stack actual es un hecho establecido): \`open-sdd brownfield constitution ${root} --write\``,
        `Mapa de módulos y responsabilidades observadas (se imprime con el plan): \`open-sdd brownfield bootstrap ${root}\``,
        `Documento de inteligencia del código para agentes: \`open-sdd brownfield bootstrap ${root} --write\``,
        `Plantillas adaptadas al stack observado (se muestran con el plan; se escriben solo donde no haya una propia): \`open-sdd brownfield templates ${root} [--write]\``,
        focus && focusSlug
            ? `Semilla del contrato de cambio para «${focus}»: \`open-sdd delta init ${focusSlug} "${focus}"\``
            : 'Sin --focus no se siembra ninguna delta: cuando decidas el primer cambio, `open-sdd delta init <feature> "<qué cambia>"`',
        `Estado del contrato de cambio: \`open-sdd delta status${focus && focusSlug ? ` ${focusSlug}` : ''}\``,
    ];
    const toCreate = artifacts.filter((artifact) => artifact.action === 'create').length;
    const toKeep = artifacts.filter((artifact) => artifact.action === 'keep').length;
    const toUpdate = artifacts.filter((artifact) => artifact.action === 'update').length;
    const detail = [
        `Plan de bootstrap: ${map.modules.length} módulo(s), ${toCreate} artefacto(s) por crear, ${toUpdate} por regenerar, ${toKeep} conservado(s).`,
        map.detail,
        adaptationDetail,
        'Los pasos están pensados para ejecutarse desde cualquier directorio (usan la raíz resuelta).',
    ].join(' ');
    const complete = map.complete && project.language !== 'unknown';
    return { root, project, modules: map.modules, templates, artifacts, steps, detail, complete };
};
