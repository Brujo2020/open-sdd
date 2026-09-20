/**
 * La Constitución como PIVOTE de la especificación.
 *
 * Todo el mundo escribe specs. Lo que casi nadie hace es comprobar una spec CONTRA la autoridad
 * que dice respetar. Este módulo cierra ese hueco: dado el texto de una feature (requisitos, plan,
 * tareas y —en brownfield— la delta), responde a tres preguntas que un revisor humano no puede
 * contestar de forma consistente:
 *
 *   1. ¿Los principios que la spec CITA existen y están en vigor? Una autoridad fantasma es peor
 *      que ninguna: hace que un veredicto parezca justificado sin serlo (UNKNOWN_PRINCIPLE).
 *   2. ¿La spec CONTRADICE un MUST? Un requisito que propone migrar, reescribir o sustituir una
 *      tecnología que la constitución declara hecho establecido contradice la propia autoridad que
 *      invoca (MUST_CONTRADICTED), y una delta que añade una dependencia donde la constitución
 *      cierra el stack hace lo mismo por adición (TECH_LOCK_VIOLATION).
 *   3. ¿Los artefactos que la spec produce respetan las reglas de frontera, compatibilidad de API y
 *      oráculo de regresión que la constitución impone (BOUNDARY_VIOLATION, API_COMPAT_MISSING,
 *      ORACLE_MISSING)?
 *
 * ── La regla que gobierna todas las detecciones: nunca adivinar ─────────────────────────────────
 * Una comprobación que no puede decidir NO emite un hallazgo y NO cuenta como aprobado. La regla de
 * esta casa es que un `ok` sobre algo que no se inspeccionó es una mentira con formato de reporte,
 * así que cuando una regla no puede decidir el motivo viaja en `detail` («fronteras no evaluadas:
 * no se conoce ningún fichero cambiado»), nunca en un silencio. Por eso `MUST_CONTRADICTED` solo se
 * emite cuando el vocabulario de tecnologías reconoce la tecnología nombrada: ante la duda, nada.
 *
 * ── Solo cuentan los principios EN VIGOR ───────────────────────────────────────────────────────
 * `principlesInForce` filtra los normativos sin enmienda en vigor. Citarlos no es un error de
 * tecleo: es citar autoridad que todavía no existe (AMENDMENT-REQUIRED en `validateConstitution`),
 * de modo que un id que no está en vigor se reporta como UNKNOWN_PRINCIPLE igual que un fantasma.
 *
 * ── Contrato de campos ────────────────────────────────────────────────────────────────────────
 * El contrato verbal de esta pieza hablaba de `constraint`/`rationale`; el modelo real de
 * `constitution.ts` usa `restriction` (la restricción), `pattern` (cómo se cumple) y
 * `justification` (por qué). Este módulo usa los campos REALES y trata `restriction` + `pattern` +
 * `evidence` como «lo que el principio fija»: la evidencia nombra las herramientas observadas
 * (`package.json:60 (vitest)`), que es exactamente donde vive el stack fijado de la constitución
 * descriptiva. Los textos visibles son español, como el resto del CLI.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { principlesInForce } from './constitution.js';
import { parseTasksMarkdown } from './specManager.js';
/**
 * The marker a spec uses to declare the principles that govern it, e.g.
 * `_Constitution: C-STACK-FACT, C-API-COMPAT_`. Same shape as the `_Requirements:` / `_Boundary:_`
 * metadata the rest of the toolchain already writes, so the declaration lives next to the task it
 * constrains instead of in a separate registry that drifts.
 */
export const SPEC_PRINCIPLES_MARKER = '_Constitution:';
// ---------------------------------------------------------------------------------------------
// Qué principios declara una spec
// ---------------------------------------------------------------------------------------------
/** Identificador citable según `constitution.ts` (`^[A-Z][A-Z0-9-]{2,}$`). */
const ID_SHAPE = /^[A-Z][A-Z0-9-]{2,}$/;
/** Palabras que aparecen en una spec en mayúsculas y NO son identificadores de principio. */
const NON_PRINCIPLE_TOKENS = new Set([
    'MUST',
    'SHOULD',
    'MAY',
    'EARS',
    'ADSR',
    'API',
    'SDD',
    'TDD',
    'DDD',
    'MCP',
    'CI',
    'CD',
    'JSON',
    'YAML',
    'HTTP',
    'HTTPS',
    'URL',
    'SQL',
    'XSS',
    'CSRF',
    'CVE',
    'TODO',
    'TBD',
    'WIP',
]);
/** Referencias que se escriben en mayúsculas pero no son principios (amenazas, normas, requisitos). */
const REFERENCE_PREFIX = /^(?:REQ|CWE|OWASP|ATLAS|ADR|RFC|ISO|NIST|SOC|GDPR|SLSA|MITRE)-/;
const ID_TOKEN_RE = /(?<![A-Za-z0-9-])[A-Z][A-Z0-9-]{2,}(?![A-Za-z0-9-])/g;
const isDeclarableId = (token) => ID_SHAPE.test(token) && !NON_PRINCIPLE_TOKENS.has(token) && !REFERENCE_PREFIX.test(token);
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Identificadores en mayúsculas de un fragmento, ya filtrados los que no son citables. */
const declarationTokens = (text) => {
    const out = [];
    for (const match of text.matchAll(ID_TOKEN_RE)) {
        if (isDeclarableId(match[0]))
            out.push(match[0]);
    }
    return out;
};
/** `_Constitution: A, B_` — declaración explícita, admite ids que no existen (para poder citarlos). */
const markerDeclarations = (text) => {
    const out = [];
    const re = new RegExp(`${escapeRegExp(SPEC_PRINCIPLES_MARKER)}\\s*([^_\\n]+)`, 'gi');
    for (const match of text.matchAll(re)) {
        for (const token of declarationTokens(match[1]))
            out.push(token);
    }
    return out;
};
/**
 * Una sección `## Constitution` declara los principios que gobiernan la spec. Se leen sus líneas
 * como identificadores explícitos, así que un id inexistente escrito ahí se reporta como fantasma
 * (que es lo que el autor quiso declarar) en vez de ignorarse en silencio.
 */
const sectionDeclarations = (text) => {
    const out = [];
    let inSection = false;
    for (const line of text.split('\n')) {
        const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
        if (heading) {
            inSection = /constitution/i.test(heading[2]);
            continue;
        }
        if (!inSection)
            continue;
        for (const token of declarationTokens(line))
            out.push(token);
    }
    return out;
};
/**
 * Principles a spec declares: from a `## Constitution` section, `_Constitution: A, B_` lines, or
 * inline citations of principle ids.
 *
 * Las dos primeras fuentes son DECLARACIONES y se aceptan tal cual (por eso pueden producir
 * UNKNOWN_PRINCIPLE). La cita en línea solo reconoce los ids que se le pasan en `known`: escanear
 * mayúsculas sueltas como si fueran principios convertiría cualquier sigla en una acusación falsa.
 */
export const declaredPrinciples = (texts, known) => {
    const ordered = [...known].sort((a, b) => b.length - a.length);
    const inline = ordered.length > 0
        ? new RegExp(`(?<![A-Za-z0-9-])(${ordered.map(escapeRegExp).join('|')})(?![A-Za-z0-9-])`, 'g')
        : null;
    const found = [];
    const seen = new Set();
    const add = (id) => {
        if (seen.has(id))
            return;
        seen.add(id);
        found.push(id);
    };
    for (const text of texts) {
        if (!text)
            continue;
        for (const id of markerDeclarations(text))
            add(id);
        for (const id of sectionDeclarations(text))
            add(id);
        if (inline)
            for (const match of text.matchAll(inline))
                add(match[1]);
    }
    return found;
};
/** `[superficie escrita, nombre canónico]`. Las superficies largas se prueban primero. */
const TECH_TERMS = [
    // lenguaje
    ['typescript', 'typescript'],
    ['javascript', 'javascript'],
    ['node.js', 'node'],
    ['nodejs', 'node'],
    ['node', 'node'],
    ['python', 'python'],
    ['ruby', 'ruby'],
    ['php', 'php'],
    ['kotlin', 'kotlin'],
    ['scala', 'scala'],
    ['swift', 'swift'],
    ['dart', 'dart'],
    ['elixir', 'elixir'],
    ['erlang', 'erlang'],
    ['haskell', 'haskell'],
    ['golang', 'golang'],
    ['c#', 'csharp'],
    ['c++', 'cpp'],
    ['.net', 'dotnet'],
    // runtime
    ['deno', 'deno'],
    ['bun', 'bun'],
    // test
    ['vitest', 'vitest'],
    ['jest', 'jest'],
    ['mocha', 'mocha'],
    ['jasmine', 'jasmine'],
    ['playwright', 'playwright'],
    ['cypress', 'cypress'],
    ['pytest', 'pytest'],
    ['junit', 'junit'],
    ['rspec', 'rspec'],
    // framework
    ['react', 'react'],
    ['vue', 'vue'],
    ['angular', 'angular'],
    ['svelte', 'svelte'],
    ['next.js', 'nextjs'],
    ['nuxt', 'nuxt'],
    ['express', 'express'],
    ['fastify', 'fastify'],
    ['nestjs', 'nestjs'],
    ['django', 'django'],
    ['fastapi', 'fastapi'],
    ['laravel', 'laravel'],
    // gestor de paquetes
    ['npm', 'npm'],
    ['pnpm', 'pnpm'],
    ['yarn', 'yarn'],
    ['poetry', 'poetry'],
    ['maven', 'maven'],
    ['gradle', 'gradle'],
    ['cargo', 'cargo'],
    ['composer', 'composer'],
    ['nuget', 'nuget'],
    // bundler
    ['webpack', 'webpack'],
    ['vite', 'vite'],
    ['rollup', 'rollup'],
    ['esbuild', 'esbuild'],
    ['parcel', 'parcel'],
    ['babel', 'babel'],
    // base de datos
    ['postgresql', 'postgresql'],
    ['postgres', 'postgres'],
    ['mysql', 'mysql'],
    ['mariadb', 'mariadb'],
    ['sqlite', 'sqlite'],
    ['mongodb', 'mongodb'],
    ['redis', 'redis'],
    ['dynamodb', 'dynamodb'],
    ['sqlserver', 'sqlserver'],
    // orm
    ['prisma', 'prisma'],
    ['typeorm', 'typeorm'],
    ['sequelize', 'sequelize'],
    ['knex', 'knex'],
    ['mongoose', 'mongoose'],
    ['hibernate', 'hibernate'],
    // linter
    ['eslint', 'eslint'],
    ['prettier', 'prettier'],
    ['biome', 'biome'],
    ['tslint', 'tslint'],
    // cliente http
    ['axios', 'axios'],
    ['superagent', 'superagent'],
    ['node-fetch', 'node-fetch'],
    // ui
    ['tailwind', 'tailwind'],
    ['bootstrap', 'bootstrap'],
    ['jquery', 'jquery'],
    ['redux', 'redux'],
    ['zustand', 'zustand'],
    ['mobx', 'mobx'],
    ['sass', 'sass'],
    // infraestructura
    ['docker', 'docker'],
    ['kubernetes', 'kubernetes'],
    ['terraform', 'terraform'],
    ['ansible', 'ansible'],
    ['jenkins', 'jenkins'],
    ['circleci', 'circleci'],
];
const TECH_SLOT_OF = {
    typescript: 'lenguaje',
    javascript: 'lenguaje',
    python: 'lenguaje',
    ruby: 'lenguaje',
    php: 'lenguaje',
    kotlin: 'lenguaje',
    scala: 'lenguaje',
    swift: 'lenguaje',
    dart: 'lenguaje',
    elixir: 'lenguaje',
    erlang: 'lenguaje',
    haskell: 'lenguaje',
    golang: 'lenguaje',
    csharp: 'lenguaje',
    cpp: 'lenguaje',
    dotnet: 'lenguaje',
    node: 'runtime',
    deno: 'runtime',
    bun: 'runtime',
    vitest: 'test',
    jest: 'test',
    mocha: 'test',
    jasmine: 'test',
    playwright: 'test',
    cypress: 'test',
    pytest: 'test',
    junit: 'test',
    rspec: 'test',
    react: 'framework',
    vue: 'framework',
    angular: 'framework',
    svelte: 'framework',
    nextjs: 'framework',
    nuxt: 'framework',
    express: 'framework',
    fastify: 'framework',
    nestjs: 'framework',
    django: 'framework',
    fastapi: 'framework',
    laravel: 'framework',
    npm: 'gestor-de-paquetes',
    pnpm: 'gestor-de-paquetes',
    yarn: 'gestor-de-paquetes',
    poetry: 'gestor-de-paquetes',
    maven: 'gestor-de-paquetes',
    gradle: 'gestor-de-paquetes',
    cargo: 'gestor-de-paquetes',
    composer: 'gestor-de-paquetes',
    nuget: 'gestor-de-paquetes',
    webpack: 'bundler',
    vite: 'bundler',
    rollup: 'bundler',
    esbuild: 'bundler',
    parcel: 'bundler',
    babel: 'bundler',
    postgresql: 'base-de-datos',
    postgres: 'base-de-datos',
    mysql: 'base-de-datos',
    mariadb: 'base-de-datos',
    sqlite: 'base-de-datos',
    mongodb: 'base-de-datos',
    redis: 'base-de-datos',
    dynamodb: 'base-de-datos',
    sqlserver: 'base-de-datos',
    prisma: 'orm',
    typeorm: 'orm',
    sequelize: 'orm',
    knex: 'orm',
    mongoose: 'orm',
    hibernate: 'orm',
    eslint: 'linter',
    prettier: 'linter',
    biome: 'linter',
    tslint: 'linter',
    axios: 'cliente-http',
    superagent: 'cliente-http',
    'node-fetch': 'cliente-http',
    tailwind: 'ui',
    bootstrap: 'ui',
    jquery: 'ui',
    redux: 'ui',
    zustand: 'ui',
    mobx: 'ui',
    sass: 'ui',
    docker: 'infraestructura',
    kubernetes: 'infraestructura',
    terraform: 'infraestructura',
    ansible: 'infraestructura',
    jenkins: 'infraestructura',
    circleci: 'infraestructura',
};
// Fronteras deliberadas: a la izquierda no puede haber letra/dígito/`+`/`#` (para que `java` no
// capture el interior de `javascript` ni `bun` el de `bundle`), y a la derecha tampoco, SALVO punto y
// guion: `jest.` al final de una frase y `eslint-config` a mitad de un nombre son menciones reales, y
// excluir el punto las perdería. `node` captura también el `node` de `node.js`; ambos resuelven al
// mismo canónico, así que no hay ambigüedad.
const TECH_RE = new RegExp(`(?<![A-Za-z0-9_+#])(${[...TECH_TERMS]
    .map(([surface]) => surface)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')})(?![A-Za-z_+#])`, 'gi');
const SURFACE_TO_CANONICAL = new Map(TECH_TERMS);
/** Tecnologías canónicas nombradas en un texto. */
const techsIn = (text) => {
    const out = new Set();
    if (!text)
        return out;
    for (const match of text.matchAll(TECH_RE)) {
        const canonical = SURFACE_TO_CANONICAL.get(match[1].toLowerCase());
        if (canonical)
            out.add(canonical);
    }
    return out;
};
const slotsOf = (techs) => {
    const out = new Map();
    for (const tech of techs) {
        const slot = TECH_SLOT_OF[tech];
        if (!slot)
            continue;
        const bucket = out.get(slot) ?? new Set();
        bucket.add(tech);
        out.set(slot, bucket);
    }
    return out;
};
/** La primera tecnología del texto que ocupa un hueco YA reservado por otra distinta. */
const conflictingTech = (textTechs, locked) => {
    const lockedSlots = slotsOf(locked);
    const textSlots = slotsOf(textTechs);
    for (const [slot, techs] of textSlots) {
        const lockedInSlot = lockedSlots.get(slot);
        if (!lockedInSlot)
            continue;
        for (const tech of techs) {
            if (!lockedInSlot.has(tech))
                return tech;
        }
    }
    return undefined;
};
/** La tecnología concreta que el principio fija en el hueco de `conflict` (para poder citarla). */
const lockedTechInSlot = (locked, slot) => [...locked].find((tech) => TECH_SLOT_OF[tech] === slot);
/** Verbos que expresan intención de sustituir una tecnología fijada como hecho. */
const REPLACEMENT_INTENT_RE = /\b(migrar|migraci[óo]n|migra|migrate|migrating|reescribir|reescritura|reescribe|reemplazar|reemplazo|reemplaza|sustituir|sustituci[óo]n|sustituye|actualizar|actualizaci[óo]n|actualiza|rewrite|replace|upgrade)\b/i;
/** Un manifiesto de dependencias: tocar esto es declarar una dependencia nueva o cambiarla. */
const DEP_MANIFEST_RE = /(?:^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|requirements[.-]?[\w]*\.txt|pyproject\.toml|pipfile|poetry\.lock|go\.mod|go\.sum|cargo\.toml|cargo\.lock|pom\.xml|build\.gradle(?:\.kts)?|gemfile|gemfile\.lock|composer\.json|packages\.config\.json|paket\.dependencies)$/i;
const principleText = (principle) => [principle.id, principle.title, principle.restriction, principle.pattern, principle.justification]
    .filter(Boolean)
    .join(' ');
/** Lo que un principio FIJA: su restricción, su patrón de cumplimiento y la evidencia observada. */
const lockedText = (principle) => [principle.restriction, principle.pattern, ...(principle.evidence ?? [])].filter(Boolean).join(' ');
const BOUNDARY_RE = /boundar|frontera|l[íi]mite|limit|scope|alcance/i;
const API_RE = /\bapi\b|\bapis\b|compat|contract|contrato|interfaz|interface|breaking/i;
// Con límites de palabra a propósito: sin ellos «vitest» contendría «test» y cualquier principio que
// nombre el runner pasaría por oráculo de regresión.
const ORACLE_RE = /\bor[áa]culo\b|\bregres\w*|\bcontratos?\b|\bcontracts?\b|\bsuite\b|\bpruebas?\b|\btests?\b/i;
/**
 * Enunciados de `requirements.md`, asociados a su REQ-ID.
 *
 * `parseRequirementsMarkdown` devuelve id, título y criterios, pero no la línea del enunciado, y el
 * pivote necesita el ENUNCIADO para buscar tecnologías. El reconocimiento del encabezado replica su
 * gramática (`### REQ-<AREA>: <título>`) para que ambos lectores no se separen: la asociación
 * línea→REQ es lo único que se añade.
 */
const requirementStatements = (markdown) => {
    const out = [];
    let current;
    for (const raw of markdown.split('\n')) {
        const heading = raw.match(/^#{2,4}\s*(?:REQ-([A-Za-z0-9_-]+)|Requirement\s+([A-Za-z0-9_-]+)):?\s*(.*)$/i);
        if (heading) {
            current = `REQ-${heading[1] ?? heading[2]}`;
            if (heading[3]?.trim())
                out.push({ artifactId: current, text: heading[3].trim() });
            continue;
        }
        if (/^#{1,6}\s/.test(raw)) {
            current = undefined;
            continue;
        }
        const text = raw.replace(/^\s*[-*>\d.]+\s*/, '').trim();
        if (!text || text.startsWith('<!--'))
            continue;
        out.push(current ? { artifactId: current, text } : { text });
    }
    return out;
};
const deltaText = (delta) => {
    if (!delta)
        return undefined;
    const parts = [delta.feature, delta.title];
    for (const entry of delta.entries) {
        parts.push(entry.id, entry.title, entry.statement, ...entry.targets, ...(entry.contracts ?? []));
        if (entry.previous)
            parts.push(entry.previous);
        if (entry.rationale)
            parts.push(entry.rationale);
    }
    return parts.join('\n');
};
const entryText = (entry) => [entry.id, entry.title, entry.statement, ...entry.targets].filter(Boolean).join(' ');
/** Fronteras declaradas por las tareas (`_Boundary:_`), con la semántica de `getSpecStatus`. */
const boundariesFromTasks = (tasks) => {
    if (!tasks)
        return [];
    const set = new Set();
    for (const task of parseTasksMarkdown(tasks)) {
        for (const boundary of task.boundary ?? [])
            set.add(boundary);
    }
    return [...set];
};
const normalizePath = (value) => value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
/** Un `.` declarado cubre TODO (semántica de `getSpecStatus`); el resto es prefijo o ruta exacta. */
const coveredByBoundary = (file, boundaries) => {
    const target = normalizePath(file);
    return boundaries.some((raw) => {
        const boundary = normalizePath(raw).replace(/\/\*\*$/, '');
        if (!boundary)
            return false;
        if (boundary === '.' || boundary === '*' || boundary === '**')
            return true;
        if (boundary.endsWith('*'))
            return target.startsWith(boundary.slice(0, -1));
        return target === boundary || target.startsWith(`${boundary}/`);
    });
};
// ---------------------------------------------------------------------------------------------
// El pivote
// ---------------------------------------------------------------------------------------------
const SEVERITY_RANK = {
    error: 0,
    warning: 1,
    info: 2,
};
/**
 * Contrastar una spec con la constitución.
 *
 * Devuelve siempre `alignment` y `detail`; los hallazgos son la parte accionable. Nunca lanza: un
 * fallo de inspección se declara en `detail`, porque un pivote que revienta es un pivote que nadie
 * ejecuta.
 */
export const alignSpecWithConstitution = (input) => {
    const inForce = principlesInForce(input.constitution);
    const known = inForce.map((principle) => principle.id);
    const knownSet = new Set(known);
    const findings = [];
    // Dos listas distintas a propósito: una BRECHA de inspección (no se pudo mirar: no es un aprobado)
    // y una regla FUERA DE ALCANCE (no hay nada que mirar porque ningún principio la gobierna). Mezclar
    // ambas convertiría un «no aplica» en un aviso y enseñaría al lector a ignorar los avisos.
    const gaps = [];
    const outOfScope = [];
    const texts = [input.requirements, input.plan, input.tasks, deltaText(input.delta)].filter((text) => Boolean(text));
    const declared = declaredPrinciples(texts, known);
    const declaredSet = new Set(declared);
    const resolvable = declared.filter((id) => knownSet.has(id));
    const undeclared = known.filter((id) => !declaredSet.has(id));
    // ── 1. Autoridad fantasma ───────────────────────────────────────────────────────────────────
    for (const id of declared) {
        if (knownSet.has(id))
            continue;
        findings.push({
            severity: 'error',
            code: 'UNKNOWN_PRINCIPLE',
            principleId: id,
            message: `La spec declara el principio "${id}", que no está en vigor en la constitución: una autoridad fantasma es peor que ninguna. Corrige el identificador o tramita su enmienda antes de invocarlo.`,
        });
    }
    // ── 2. El pivote sin usar ───────────────────────────────────────────────────────────────────
    if (declared.length === 0) {
        findings.push({
            severity: 'warning',
            code: 'NO_PRINCIPLES_DECLARED',
            message: `La spec no declara ningún principio de la constitución: el pivote queda sin usar y no se puede afirmar que la spec lo respete. Declara los principios aplicables (p. ej. una línea ${SPEC_PRINCIPLES_MARKER} C-API-COMPAT_ o una sección "## Constitution").`,
        });
    }
    // 1 cuando no se declara nada es el error que este contrato prohíbe: 0 y aviso.
    const alignment = declared.length === 0 ? 0 : resolvable.length / declared.length;
    // ── 3. Contradicción de stack (MUST_CONTRADICTED / TECH_LOCK_VIOLATION) ─────────────────────
    const locking = inForce
        .map((principle) => ({ principle, techs: techsIn(lockedText(principle)) }))
        .filter((entry) => entry.techs.size > 0);
    const mustLocking = locking.filter((entry) => entry.principle.level === 'MUST');
    const reported = new Set();
    const report = (finding) => {
        const key = `${finding.code}::${finding.principleId ?? ''}::${finding.artifactId ?? ''}`;
        if (reported.has(key))
            return;
        reported.add(key);
        findings.push(finding);
    };
    for (const statement of input.requirements ? requirementStatements(input.requirements) : []) {
        const textTechs = techsIn(statement.text);
        if (textTechs.size === 0)
            continue;
        for (const entry of mustLocking) {
            const locked = entry.techs;
            const namedLocked = [...locked].find((tech) => textTechs.has(tech));
            if (namedLocked && REPLACEMENT_INTENT_RE.test(statement.text)) {
                report({
                    severity: 'error',
                    code: 'MUST_CONTRADICTED',
                    principleId: entry.principle.id,
                    ...(statement.artifactId ? { artifactId: statement.artifactId } : {}),
                    message: `El enunciado propone migrar, reescribir o sustituir "${namedLocked}", que ${entry.principle.id} (${entry.principle.level}) fija como hecho establecido: modernizar el stack exige una enmienda gobernada, no una afirmación en la spec.`,
                });
                continue;
            }
            const conflict = conflictingTech(textTechs, locked);
            if (conflict) {
                const lockedInSlot = lockedTechInSlot(locked, TECH_SLOT_OF[conflict]);
                report({
                    severity: 'error',
                    code: 'MUST_CONTRADICTED',
                    principleId: entry.principle.id,
                    ...(statement.artifactId ? { artifactId: statement.artifactId } : {}),
                    message: `El enunciado nombra "${conflict}" donde ${entry.principle.id} (${entry.principle.level}) fija "${lockedInSlot}": son tecnologías distintas del mismo hueco, y la constitución no autoriza el cambio.`,
                });
            }
        }
    }
    const delta = input.delta;
    if (delta) {
        for (const entry of delta.entries) {
            const text = entryText(entry);
            const textTechs = techsIn(text);
            if (textTechs.size === 0)
                continue;
            // MUST_CONTRADICTED: la entrada HABLA de lo fijado y propone otra cosa (sustitución).
            for (const lock of mustLocking) {
                const namedLocked = [...lock.techs].find((tech) => textTechs.has(tech));
                if (namedLocked && REPLACEMENT_INTENT_RE.test(text)) {
                    report({
                        severity: 'error',
                        code: 'MUST_CONTRADICTED',
                        principleId: lock.principle.id,
                        artifactId: entry.id,
                        message: `La entrada ${entry.id} propone sustituir "${namedLocked}", que ${lock.principle.id} (${lock.principle.level}) fija como hecho establecido: un cambio de stack se tramita como enmienda, no como entrada de delta.`,
                    });
                    continue;
                }
                const conflict = conflictingTech(textTechs, lock.techs);
                if (conflict && namedLocked) {
                    report({
                        severity: 'error',
                        code: 'MUST_CONTRADICTED',
                        principleId: lock.principle.id,
                        artifactId: entry.id,
                        message: `La entrada ${entry.id} nombra "${namedLocked}" y a la vez "${conflict}", dos tecnologías del mismo hueco que ${lock.principle.id} (${lock.principle.level}) mantiene fijado: es una sustitución no autorizada.`,
                    });
                }
            }
            // TECH_LOCK_VIOLATION: la entrada NO habla de lo fijado y AÑADE algo al stack.
            //
            // Diferencia con MUST_CONTRADICTED (los dos códigos son parientes y por eso se separan):
            //   MUST_CONTRADICTED   = contradice un hecho establecido: nombra la tecnología fijada y
            //                         propone otra (o anuncia migrarla). Hay una sustitución en juego.
            //   TECH_LOCK_VIOLATION = amplía el stack en silencio: declara una dependencia/framework nuevo
            //                         en targets/manifiesto o como entrada ADDED, ocupa un hueco que la
            //                         constitución reserva a otra tecnología y NUNCA nombra la fijada.
            // Solo se emite si MUST_CONTRADICTED no cubrió ya el par (principio, entrada), para que una
            // misma contradicción no se cuente dos veces.
            const introducesDependency = entry.kind === 'ADDED' || entry.targets.some((target) => DEP_MANIFEST_RE.test(normalizePath(target)));
            if (!introducesDependency)
                continue;
            for (const lock of locking) {
                const conflict = conflictingTech(textTechs, lock.techs);
                if (!conflict)
                    continue;
                if ([...lock.techs].some((tech) => textTechs.has(tech)))
                    continue;
                const lockedInSlot = lockedTechInSlot(lock.techs, TECH_SLOT_OF[conflict]);
                report({
                    severity: lock.principle.level === 'MUST' ? 'error' : 'warning',
                    code: 'TECH_LOCK_VIOLATION',
                    principleId: lock.principle.id,
                    artifactId: entry.id,
                    message: `La entrada ${entry.id} introduce "${conflict}" (dependencia o framework nuevo) en el hueco que ${lock.principle.id} (${lock.principle.level}) reserva a "${lockedInSlot}": la delta amplía el stack en lugar de sustituir algo, y la constitución no lo autoriza.`,
                });
            }
        }
    }
    // ── 4. Fronteras ────────────────────────────────────────────────────────────────────────────
    const boundaryPrinciples = inForce.filter((principle) => BOUNDARY_RE.test(principleText(principle)));
    const changedFiles = (input.changedFiles ?? []).map(normalizePath).filter(Boolean);
    const boundaries = (input.declaredBoundaries ?? boundariesFromTasks(input.tasks))
        .map(normalizePath)
        .filter(Boolean);
    if (boundaryPrinciples.length === 0) {
        outOfScope.push('fronteras: ningún principio en vigor las gobierna, así que no hay frontera que violar');
    }
    else if (changedFiles.length === 0) {
        gaps.push('fronteras no evaluadas: no se conoce ningún fichero cambiado');
    }
    else if (boundaries.length === 0) {
        gaps.push('fronteras no evaluadas: la spec no declara ninguna frontera (_Boundary:_), así que no hay contra qué contrastar los ficheros cambiados');
    }
    else {
        for (const file of changedFiles) {
            if (coveredByBoundary(file, boundaries))
                continue;
            for (const principle of boundaryPrinciples) {
                findings.push({
                    severity: principle.level === 'MUST' ? 'error' : 'warning',
                    code: 'BOUNDARY_VIOLATION',
                    principleId: principle.id,
                    artifactId: file,
                    message: `"${file}" queda fuera de las fronteras declaradas por la spec (${boundaries.join(', ')}): ${principle.id} (${principle.level}) exige que el cambio permanezca dentro del alcance declarado.`,
                });
            }
        }
    }
    // ── 5. Compatibilidad de API y oráculo de regresión ─────────────────────────────────────────
    const apiPrinciples = inForce.filter((principle) => API_RE.test(principleText(principle)));
    const oraclePrinciples = inForce.filter((principle) => ORACLE_RE.test(principleText(principle)));
    if (!delta) {
        outOfScope.push('compatibilidad de la delta: no hay delta declarada que contrastar');
    }
    else {
        const structural = delta.entries.filter((entry) => entry.kind === 'MODIFIED' || entry.kind === 'REMOVED' || entry.kind === 'RENAMED');
        if (structural.length > 0 && apiPrinciples.length === 0) {
            outOfScope.push('compatibilidad de API: ningún principio en vigor la gobierna');
        }
        for (const entry of structural) {
            const lacksPrevious = !entry.previous?.trim();
            const lacksContracts = (entry.contracts ?? []).length === 0;
            for (const principle of apiPrinciples) {
                // Severity fija 'warning' (anotación del contrato): `validateDeltaSpec` ya bloquea con error
                // MISSING_PREVIOUS / MISSING_CONTRACTS sobre la delta. Este hallazgo es la señal
                // constitucional duplicada — "hay un principio que hace de esto una obligación" —, no un
                // segundo veredicto bloqueante sobre el mismo hecho.
                if (lacksPrevious) {
                    report({
                        severity: 'warning',
                        code: 'API_COMPAT_MISSING',
                        principleId: principle.id,
                        artifactId: entry.id,
                        message: `La entrada ${entry.id} (${entry.kind}) no declara el comportamiento existente que sustituye (\`previous\`): ${principle.id} exige compatibilidad de API, y una modificación que no dice qué reemplaza es una reescritura.`,
                    });
                }
                if (entry.kind === 'REMOVED' && lacksContracts) {
                    report({
                        severity: 'warning',
                        code: 'API_COMPAT_MISSING',
                        principleId: principle.id,
                        artifactId: entry.id,
                        message: `La entrada ${entry.id} (REMOVED) no declara los contratos que cubrían el comportamiento retirado: ${principle.id} exige compatibilidad de API y sin contratos no hay oráculo que demuestre qué se rompe.`,
                    });
                }
            }
        }
        const removalsWithoutContracts = delta.entries.filter((entry) => entry.kind === 'REMOVED' && (entry.contracts ?? []).length === 0);
        if (removalsWithoutContracts.length > 0 && oraclePrinciples.length === 0) {
            outOfScope.push('oráculo de regresión: ningún principio en vigor lo nombra');
        }
        for (const entry of removalsWithoutContracts) {
            for (const principle of oraclePrinciples) {
                report({
                    severity: 'warning',
                    code: 'ORACLE_MISSING',
                    principleId: principle.id,
                    artifactId: entry.id,
                    message: `La entrada ${entry.id} (REMOVED) no declara contratos y ${principle.id} nombra el oráculo de regresión: una eliminación sin oráculo no es revisable.`,
                });
            }
        }
    }
    // ── 6. Contradicciones que no se pudieron decidir ───────────────────────────────────────────
    if (locking.length === 0) {
        outOfScope.push('contradicción de stack no evaluada: ningún principio en vigor nombra una tecnología reconocible, así que no hay nada que contrastar (no es un aprobado)');
    }
    const ordered = [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        a.code.localeCompare(b.code) ||
        (a.artifactId ?? '').localeCompare(b.artifactId ?? '') ||
        (a.principleId ?? '').localeCompare(b.principleId ?? ''));
    const errors = ordered.filter((finding) => finding.severity === 'error').length;
    const warnings = ordered.filter((finding) => finding.severity === 'warning').length;
    const coverage = declared.length === 0
        ? 'la spec no declara principios (alineación 0: NO es un aprobado)'
        : `${resolvable.length}/${declared.length} principio(s) declarado(s) resuelven a un principio en vigor (alineación ${(alignment * 100).toFixed(0)}%)`;
    const undeclaredText = undeclared.length > 0 ? `; en vigor y sin mencionar: ${undeclared.join(', ')}` : '; ningún principio en vigor queda sin mencionar';
    const gapsText = gaps.length > 0 ? ` No evaluado: ${gaps.join('; ')}.` : '';
    const scopeText = outOfScope.length > 0 ? ` Fuera del alcance del pivote (no es un aprobado, es un no aplica): ${outOfScope.join('; ')}.` : '';
    return {
        feature: input.feature,
        declared,
        undeclared,
        findings: ordered,
        alignment,
        detail: `Alineación constitucional de "${input.feature}": ${coverage}${undeclaredText}; ${errors} error(es) y ${warnings} aviso(s).${gapsText}${scopeText}`,
    };
};
// ---------------------------------------------------------------------------------------------
// Puntuación de adhesión y su tendencia (REQ-MAT-011)
//
// El pivote (`alignSpecWithConstitution`) ya dice, con detalle, qué falla. Lo que no decía es
// CUÁNTO: un 0..100 comparable entre features y entre releases, con sus entradas a la vista para
// que el número sea auditable en lugar de un oráculo. La puntuación es una FUNCIÓN PURA de la
// alineación —nunca lee el disco—, así que el mismo `SpecAlignment` da siempre el mismo número.
//
// ── Por qué NO se reutiliza `.sdd/state/adhesion.json` ────────────────────────────────────────
// Otro consumidor guarda ahí un ratchet (suelo por principio, para bloquear bajadas). Este módulo
// escribe una serie temporal APPEND-ONLY en `.sdd/state/adhesion-history.json`, con entradas
// `{ date, score, feature, version? }`: otra forma de clave y otro fichero, a propósito, para que
// la historia no colisione con el ratchet. La superposición es de tema, no de formato.
//
// ── Regla ante una historia ilegible ──────────────────────────────────────────────────────────
// Igual que el pivote: se declara en `warning` y se empieza una serie nueva. Un historial corrupto
// que revienta convertiría la medición en un fallo del build; uno que se ignora en silencio
// convertiría una serie rota en un «sin tendencia» indistinguible de la primera ejecución.
// ---------------------------------------------------------------------------------------------
/** Peso de cada hallazgo en la puntuación. Documentado y exportado: es contrato, no magia. */
export const ADHESION_PENALTIES = { error: 8, warning: 3, info: 1 };
/** Nombre del fichero de historia. Distinto del ratchet `.sdd/state/adhesion.json`. */
export const ADHESION_HISTORY_FILE = 'adhesion-history.json';
/** `.sdd/state/adhesion-history.json`, append-only, una entrada por ejecución. */
export const adhesionHistoryPath = (sddDir = '.sdd') => path.join(sddDir, 'state', ADHESION_HISTORY_FILE);
const clamp01 = (value) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
/**
 * Puntuación estable 0..100 de una alineación.
 *
 * `base = 100 × tasa de resolución` y se restan `8·error + 3·aviso + 1·info`. Una spec sin
 * principios declarados puntúa 0 con `declaredAny: false`, porque el pivote prohíbe leer esa
 * ausencia como un aprobado. La función es monótona en `alignment` con los hallazgos fijos: subir
 * la tasa de resolución nunca baja la puntuación.
 */
export const adhesionScore = (alignment) => {
    const declared = alignment.declared.length;
    const rate = clamp01(alignment.alignment);
    const resolved = declared === 0 ? 0 : Math.round(rate * declared);
    const errors = alignment.findings.filter((finding) => finding.severity === 'error').length;
    const warnings = alignment.findings.filter((finding) => finding.severity === 'warning').length;
    const infos = alignment.findings.filter((finding) => finding.severity === 'info').length;
    const penalty = errors * ADHESION_PENALTIES.error + warnings * ADHESION_PENALTIES.warning + infos * ADHESION_PENALTIES.info;
    const base = declared === 0 ? 0 : rate * 100;
    const score = Math.max(0, Math.min(100, Math.round(base - penalty)));
    const inputs = {
        declared,
        resolved,
        undeclared: alignment.undeclared.length,
        errors,
        warnings,
        infos,
        alignment: rate,
        penalty,
        declaredAny: declared > 0,
    };
    const coverage = declared === 0
        ? 'la spec no declara principios (0 no es un aprobado: el pivote queda sin usar)'
        : `${resolved}/${declared} principio(s) declarado(s) resuelven a autoridad en vigor (${(rate * 100).toFixed(0)}%)`;
    return {
        score,
        inputs,
        detail: `Adhesión ${score}/100 para "${alignment.feature}": ${coverage}; ${errors} error(es) y ${warnings} aviso(s) restan ${penalty} punto(s).`,
    };
};
/** Construir la entrada de historia de una puntuación, con la fecha inyectable para poder testear. */
export const adhesionHistoryEntry = (score, options) => ({
    date: options.date ?? new Date().toISOString(),
    score: score.score,
    feature: options.feature,
    ...(options.version ? { version: options.version } : {}),
    inputs: score.inputs,
});
const isHistoryEntry = (value) => {
    const entry = value;
    return (typeof entry === 'object' &&
        entry !== null &&
        typeof entry.date === 'string' &&
        entry.date.length > 0 &&
        typeof entry.score === 'number' &&
        Number.isFinite(entry.score) &&
        typeof entry.feature === 'string' &&
        entry.feature.length > 0);
};
/**
 * Leer la historia. NUNCA lanza: un fichero ausente es una serie vacía sin aviso; un fichero
 * ilegible o con basura es un aviso MÁS `seriesRestarted`, para que el llamante pueda decir que la
 * tendencia no es comparable en vez de inventarse un «sin tendencia».
 */
export const readAdhesionHistory = async (root, sddDir = '.sdd') => {
    const rel = adhesionHistoryPath(sddDir);
    const abs = path.join(root, rel);
    let raw;
    try {
        raw = await readFile(abs, 'utf8');
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT' || code === 'ENOTDIR')
            return { file: rel, entries: [], seriesRestarted: false };
        return {
            file: rel,
            entries: [],
            warning: `la historia de adhesión existe pero no se pudo leer (${error.message}): se empieza una serie nueva`,
            seriesRestarted: true,
        };
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        return {
            file: rel,
            entries: [],
            warning: `${rel} no es JSON válido (${error.message}): se empieza una serie nueva`,
            seriesRestarted: true,
        };
    }
    if (!Array.isArray(parsed)) {
        return {
            file: rel,
            entries: [],
            warning: `${rel} no contiene una lista de mediciones: se empieza una serie nueva`,
            seriesRestarted: true,
        };
    }
    const entries = parsed.filter(isHistoryEntry);
    const dropped = parsed.length - entries.length;
    return {
        file: rel,
        entries,
        ...(dropped > 0
            ? { warning: `${rel}: ${dropped} entrada(s) inválida(s) descartada(s); no cuentan para la tendencia` }
            : {}),
        seriesRestarted: false,
    };
};
/** Ordenar por fecha ascendente sin mutar la entrada; una fecha ilegible queda al principio. */
const chronological = (entries) => [...entries].sort((a, b) => a.date.localeCompare(b.date));
/**
 * Comparar la medición actual contra la última de la MISMA feature.
 *
 * Sin mediciones previas de esa feature es `first-run` (no un «flat»: no saber contra qué comparar
 * no es no haber cambiado).
 */
export const adhesionTrend = (current, history, options = {}) => {
    const feature = options.feature ?? '';
    const series = chronological(options.feature ? history.filter((entry) => entry.feature === options.feature) : history);
    const featureLabel = options.feature ? ` de "${options.feature}"` : '';
    if (series.length === 0) {
        return {
            status: 'first-run',
            current,
            previous: null,
            delta: 0,
            feature,
            comparedTo: null,
            entries: 0,
            detail: `primera medición${featureLabel} (${current}/100): no hay serie previa contra la que comparar`,
        };
    }
    const previousEntry = series[series.length - 1];
    const delta = current - previousEntry.score;
    const release = previousEntry.version && previousEntry.version.length > 0 ? ` de la release "${previousEntry.version}"` : '';
    const status = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    const movement = status === 'up'
        ? `subió ${delta} punto(s)`
        : status === 'down'
            ? `bajó ${Math.abs(delta)} punto(s)`
            : 'se mantuvo igual';
    return {
        status,
        current,
        previous: previousEntry.score,
        delta,
        feature,
        comparedTo: previousEntry.date,
        entries: series.length,
        detail: `${movement}${release} (${previousEntry.score} → ${current})`,
    };
};
/**
 * Añadir una medición al final de la serie (append-only). Nunca lanza: un fallo de escritura se
 * declara en `warning` y la puntuación ya calculada se devuelve igual. Si la historia era ilegible
 * se aparta a `…​.corrupt-<ts>` antes de empezar la serie nueva, para no borrar evidencia.
 */
export const recordAdhesionHistory = async (root, entry, sddDir = '.sdd') => {
    const rel = adhesionHistoryPath(sddDir);
    const abs = path.join(root, rel);
    const read = await readAdhesionHistory(root, sddDir);
    let entries = read.entries;
    let warning = read.warning;
    let seriesRestarted = read.seriesRestarted;
    if (seriesRestarted) {
        try {
            await rename(abs, `${abs}.corrupt-${Date.now()}`);
        }
        catch {
            // El respaldo es cortesía: si no se puede, la serie nueva se escribe igual.
        }
        entries = [];
    }
    const next = [...entries, entry];
    try {
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    }
    catch (error) {
        const writeWarning = `no se pudo escribir la historia de adhesión (${rel}: ${error.message}): la puntuación es válida pero la tendencia no se guardó`;
        warning = warning ? `${warning}; ${writeWarning}` : writeWarning;
        return { file: rel, entries: entries.length, seriesRestarted, ...(warning ? { warning } : {}) };
    }
    return { file: rel, entries: next.length, seriesRestarted, ...(warning ? { warning } : {}) };
};
