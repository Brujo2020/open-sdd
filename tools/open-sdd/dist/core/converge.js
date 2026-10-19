/**
 * Convergencia brownfield MEDIDA POR UN MOTOR, no afirmada por un modelo.
 *
 * La idea es la de `converge` de spec-kit: leer las especificaciones como única fuente de intención,
 * contrastarlas con el código y anotar al final de `tasks.md` lo que todavía falta. La diferencia es
 * quién mide. Allí un agente lee ficheros y escribe hallazgos en prosa; aquí cada hallazgo lleva
 * evidencia recogida por el motor —`file:line`, una ratio medida o la salida de un comando— y un
 * hallazgo sin evidencia de máquina NO EXISTE (se descarta antes de emitirse).
 *
 * ── Los seis tipos de hueco, y cómo se detecta cada uno ────────────────────────────────────────
 *   missing      Un requisito (o una entrada de la delta) no tiene NINGUNA tarea que lo implemente
 *                (`traceDelta`), o una `_Boundary:_` declarada por una tarea no existe en el código
 *                (`stat`). Evidencia: `requirements.md:<línea>` / `tasks.md:<línea>` + `stat`.
 *   partial      Al menos una tarea traza al requisito y NO todas están completadas (incluye 0/N:
 *                planificado y no entregado). Evidencia: la ratio `completadas/total` + las líneas
 *                de las tareas pendientes.
 *   contradicts  Una tarea cita un id de requisito que la spec no define (`traceDelta.phantomTasks`),
 *                o el pivote constitucional (`alignSpecWithConstitution`) reporta un error.
 *                Evidencia: `tasks.md:<línea>` + el id citado; pivote: `alignSpecWithConstitution:<code>`.
 *   unrequested  Un fichero cambiado dentro de una frontera/objetivo declarados exporta un símbolo
 *                que NINGÚN texto de la spec nombra (`extractExportNames`). Evidencia: `file:line` +
 *                el número de tokens de la spec que lo nombran (0).
 *   unprotected  Un contrato declarado por la delta no existe ni en disco ni en el conjunto extraído
 *                por `extractContracts` (el hueco del oráculo de regresión). Evidencia: la ruta
 *                declarada + el recuento de contratos descubiertos.
 *   unbound      Una tarea marcada `[x]` no lleva `_Evidence:` (`checkEvidenceLock`): es una
 *                afirmación de completitud, no una completitud. Evidencia: `tasks.md:<línea>`.
 *
 * Cada tipo se mapea a un componente del SDD score en `scoreImpact`, porque el informe debe decir
 * qué espera mover en vez de dejar que el número cambie por su cuenta.
 *
 * ── APPEND-ONLY, byte a byte ───────────────────────────────────────────────────────────────────
 * `appendConvergence` añade UNA sección `## Phase N: Convergence` (N = el siguiente número libre,
 * sin renumerar nada) y NADA MÁS. Cuando no hay hallazgos no escribe: `converged: true` y el fichero
 * queda intacto (hay un test que compara los bytes). Nunca reescribe spec/plan, nunca reordena
 * tareas y nunca escribe código de aplicación.
 *
 * ── Idempotencia ───────────────────────────────────────────────────────────────────────────────
 * Cada tarea añadida lleva `_Convergence: F-<huella>_`, con la huella = sha256(`gapType|source`) en
 * 12 hex. La huella NO incluye números de línea ni evidencia (que cambian al anexar), así que es
 * estable. Antes de emitir un hallazgo, `analyseConvergence` lee las huellas ya presentes en
 * `tasks.md` y descarta las que ya constan: una segunda ejecución sobre un repositorio sin cambios
 * no duplica el hueco y reporta cero hallazgos nuevos.
 *
 * ── Lo que NO se mira, se dice ─────────────────────────────────────────────────────────────────
 * `checked` nombra lo que se inspeccionó con los números que vio; `notChecked` nombra lo que no se
 * pudo inspeccionar y POR QUÉ. `converged` exige las dos cosas: cero hallazgos nuevos y ningún
 * impedimento de lectura. Un fallo de lectura (`tasks.md` ilegible, directorio de tests ilegible,
 * toolchain ilegible) BLOQUEA la convergencia; la ausencia de un artefacto OPCIONAL (sin delta, sin
 * constitución, sin runner, sin diff) se declara en `notChecked` con su motivo y no se disfraza de
 * aprobado, pero tampoco impide declarar convergido lo que sí se midió. Una convergencia que no
 * encontró nada porque no miró nada es el fallo que este proyecto existe para evitar.
 *
 * ── Delegación (no se re-implementa nada) ──────────────────────────────────────────────────────
 * La traza requisito↔tarea, los contratos, el pivote constitucional y las fronteras vienen de
 * `traceDelta`, `extractContracts`, `alignSpecWithConstitution` y `resolveBoundaries`. La pasada
 * artefacto↔artefacto completa se DELEGA en `checkConsistency` (se ejecuta y se declara en
 * `checked`); converge solo levanta los códigos de error que él no posee, para no duplicar
 * hallazgos. Converge es la mitad artefacto↔CÓDIGO.
 *
 * Textos visibles en español, como el resto del CLI.
 */
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractExportNames } from './changeImpact.js';
import { principlesInForce } from './constitution.js';
import { checkConsistency } from './consistency.js';
import { deltaSpecFileName, parseDeltaSpec, traceDelta } from './deltaSpec.js';
import { extractContracts, testCommandFor } from './executionContract.js';
import { getModifiedFiles, isGitRepo } from './git.js';
import { resolveBoundaries, scanProject } from './reverseEngineering.js';
import { getSpecStatus, parseRequirementsMarkdown, parseTasksMarkdown, resolveSddDir } from './specManager.js';
import { alignSpecWithConstitution } from './specConstitution.js';
import { findRepoRoot, loadConstitution } from './status.js';
import { checkEvidenceLock } from './triad.js';
// ---------------------------------------------------------------------------------------------
// Vocabulario: severidad, orden y descripción de cada tipo de hueco
// ---------------------------------------------------------------------------------------------
export const GAP_TYPES = ['missing', 'partial', 'contradicts', 'unrequested', 'unprotected', 'unbound'];
/** La severidad por defecto de cada tipo. `high` es lo único que hace salir con 1. */
export const GAP_SEVERITY = {
    missing: 'high',
    partial: 'medium',
    contradicts: 'high',
    unrequested: 'low',
    unprotected: 'high',
    unbound: 'high',
};
/** Cómo se detecta cada tipo y qué evidencia lleva. Es la tabla que reproduce la guía. */
export const GAP_DETECTION = {
    missing: {
        detection: 'traceDelta no mapea ningún requisito/entrada de la delta a una tarea, o la `_Boundary:_` declarada por una tarea no existe en disco (stat).',
        evidence: 'requirements.md:<línea> o tasks.md:<línea> + el resultado de `stat` sobre la ruta declarada.',
    },
    partial: {
        detection: 'El requisito tiene tareas trazadas y no todas están `[x]`; se mide la ratio completadas/total (incluye 0/N).',
        evidence: 'la ratio medida + tasks.md:<línea> de cada tarea pendiente.',
    },
    contradicts: {
        detection: 'traceDelta reporta una tarea que cita un id inexistente, o alignSpecWithConstitution emite un error de pivote.',
        evidence: 'tasks.md:<línea> + el id citado; o `alignSpecWithConstitution:<code>` + el principio y el artefacto.',
    },
    unrequested: {
        detection: 'Un fichero cambiado dentro de una frontera/objetivo declarados exporta un símbolo que ningún token de la spec nombra (extractExportNames).',
        evidence: 'file:línea del export + el recuento de tokens de la spec que lo nombran (0).',
    },
    unprotected: {
        detection: 'Un contrato declarado por la delta no existe ni en disco ni en el conjunto extraído por extractContracts.',
        evidence: 'la ruta declarada + el recuento de contratos descubiertos/los hallazgos del pivote que lo piden.',
    },
    unbound: {
        detection: 'checkEvidenceLock encuentra una tarea `[x]` sin línea `_Evidence:`.',
        evidence: 'tasks.md:<línea> de la tarea + el recuento de completadas sin evidencia.',
    },
};
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
const posix = (value) => value.split(path.sep).join('/');
const norm = (value) => posix(value.trim()).replace(/^\.\//, '').replace(/\/+$/, '');
const uniqueSorted = (values) => Array.from(new Set(values.filter(Boolean))).sort();
/** Archivos fuente comparables con un export: los mismos ecosistemas que el resto del núcleo. */
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|kt|rs|vue|svelte)$/;
const TESTS_EXT = /\.(test|spec)\.[a-z]+$/i;
/** Leer distinguiendo «no existe» de «existe y no se pudo leer». La diferencia decide `blocked`. */
const readText = async (abs) => {
    try {
        return { exists: true, content: await readFile(abs, 'utf8') };
    }
    catch (err) {
        const code = err.code;
        if (code === 'ENOENT' || code === 'ENOTDIR')
            return { exists: false, content: null };
        return { exists: true, content: null, error: err.message };
    }
};
const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Línea (1-based) donde aparece `needle`; 0 si no aparece. Es la base de casi toda la evidencia. */
const lineOf = (content, needle) => {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (typeof needle === 'string' ? line.includes(needle) : needle.test(line))
            return i + 1;
    }
    return 0;
};
/** Línea del encabezado de un requisito (`### REQ-X — …` o `## Requirement X`). */
const lineOfRequirement = (requirements, id) => lineOf(requirements, new RegExp(`^#{2,4}\\s*(?:${escapeRe(id)}|Requirement\\s+${escapeRe(id.replace(/^REQ-/, ''))})\\b`, 'i'));
/** Línea de una tarea por su marcador de id (`- [x] 12.` o `- [ ] conv-1:`). */
const lineOfTask = (tasks, taskId) => lineOf(tasks, new RegExp(`^-\\s*\\[[ x-]\\]\\s*(\\*)?\\s*${escapeRe(taskId)}\\s*[:.]?(\\s|$)`));
const existsOnDisk = async (abs) => {
    try {
        await stat(abs);
        return { exists: true };
    }
    catch (err) {
        const code = err.code;
        if (code === 'ENOENT' || code === 'ENOTDIR')
            return { exists: false };
        return { exists: false, error: err.message };
    }
};
const stem = (value) => norm(value).replace(/\.[A-Za-z0-9]+$/, '');
const canon = (value) => stem(value).replace(/\/index$/, '');
/**
 * ¿`file` vive dentro de lo declarado por `declared`? Si lo declarado es un fichero fuente se exige
 * coincidencia canónica; si es un directorio, contención. Sin esta distinción `src/foo.ts` «contendría»
 * a `src/foo/bar.ts`, que es un falso positivo.
 */
const isInside = (file, declared) => {
    const d = norm(declared);
    const f = norm(file);
    if (!d || !f)
        return false;
    if (d === '.' || d === '*' || d === '**')
        return true;
    if (SOURCE_EXT.test(d))
        return canon(f) === canon(d);
    return canon(f) === canon(d) || canon(f).startsWith(`${canon(d)}/`);
};
/** Un objetivo/frontera es comparable con ficheros cuando parece una ruta, no un verbo ni una URL. */
const isPathLike = (target) => {
    const value = target.trim();
    if (!value || /\s/.test(value))
        return false;
    if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i.test(value))
        return false;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value))
        return false;
    return value.includes('/') || /\.[A-Za-z0-9]+$/.test(value);
};
// ---------------------------------------------------------------------------------------------
// Huella estable e idempotencia
// ---------------------------------------------------------------------------------------------
/** La marca que llevan las tareas de convergencia para no anotar dos veces el mismo hueco. */
export const CONVERGENCE_MARKER = '_Convergence:';
/**
 * Huella estable de un hueco: `gapType|source`. NO incluye evidencia ni números de línea porque
 * cambian al anexar; incluir `remainingWork` haría que una re-ejecución viera un hueco «nuevo».
 */
export const convergenceFingerprint = (gap) => createHash('sha256').update(`${gap.gapType}|${gap.source}`, 'utf8').digest('hex').slice(0, 12);
/** Huellas ya anotadas en `tasks.md`. */
export const fingerprintsInTasks = (tasksMarkdown) => {
    const found = new Set();
    for (const match of tasksMarkdown.matchAll(/_Convergence:\s*F-([0-9a-f]{6,})_/g))
        found.add(match[1]);
    return found;
};
const deriveChangedFiles = (root, provided) => {
    if (provided !== undefined) {
        return { available: true, files: uniqueSorted(provided.map(norm)), source: 'aportados por el llamante' };
    }
    if (!isGitRepo(root)) {
        return { available: false, files: [], source: '', reason: 'git no está disponible o el directorio no es un repositorio' };
    }
    return { available: true, files: uniqueSorted(getModifiedFiles(root).map(norm)), source: 'árbol de trabajo e índice (git)' };
};
/** Tokens que la spec nombra: palabras y trozos camelCase. Se usa para decidir «pedido/no pedido». */
const specTokens = (texts) => {
    const tokens = new Set();
    for (const text of texts) {
        for (const part of text.matchAll(/[A-Za-z][A-Za-z0-9]*/g)) {
            for (const piece of part[0].replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ')) {
                const token = piece.toLowerCase();
                if (token.length > 1)
                    tokens.add(token);
            }
        }
    }
    return tokens;
};
/** Un export está «pedido» si el nombre entero o ALGUNA de sus piezas aparece en la spec. */
const isRequestedExport = (name, tokens) => {
    if (tokens.has(name.toLowerCase()))
        return true;
    const parts = name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
    if (parts.length === 0)
        return true;
    return parts.some((part) => tokens.has(part));
};
/** Directorios de salida/generados: no son código que alguien escribiera «sin pedirlo». */
const GENERATED_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    'out',
    'coverage',
    '.next',
    '.turbo',
    'target',
    'vendor',
    '__pycache__',
    'obj',
]);
const isGenerated = (file) => norm(file).split('/').some((segment) => GENERATED_DIRS.has(segment));
/**
 * ¿El export es solo de TIPO? Un `type`/`interface` no es comportamiento: re-exportarlo desde un
 * barril no es «código que nadie pidió» y reportarlo llenaría el informe de ruido.
 */
const isTypeOnlyExport = (content, name) => {
    const valueDecl = new RegExp(`\\bexport\\s+(?:default\\s+)?(?:async\\s+)?(?:function|class|const|let|var|enum)\\s+${escapeRe(name)}\\b`);
    if (valueDecl.test(content))
        return false;
    if (new RegExp(`\\bexport\\s+(?:default\\s+)?(?:type|interface)\\s+${escapeRe(name)}\\b`).test(content))
        return true;
    if (new RegExp(`export\\s*\\{[^}]*\\btype\\s+${escapeRe(name)}\\b[^}]*\\}`).test(content))
        return true;
    for (const block of content.matchAll(/export\s+type\s*\{([^}]*)\}/g)) {
        if (new RegExp(`\\b${escapeRe(name)}\\b`).test(block[1]))
            return true;
    }
    const declaredType = new RegExp(`\\b(?:interface|type)\\s+${escapeRe(name)}\\b`);
    const declaredValue = new RegExp(`\\b(?:function|class|const|let|var|enum)\\s+${escapeRe(name)}\\b`);
    return declaredType.test(content) && !declaredValue.test(content);
};
const emptyGapCounts = () => ({
    missing: 0,
    partial: 0,
    contradicts: 0,
    unrequested: 0,
    unprotected: 0,
    unbound: 0,
});
/**
 * Acumulador que garantiza el invariante del módulo: sin evidencia no hay hallazgo, y `(gapType,
 * source)` es único (una pasada no anota el mismo hueco dos veces). Además guarda, por hueco, lo que
 * la tarea anexada debe declarar (`_Requirements:_`, `_Boundary:_`, `_Constitution:_`).
 */
class Collector {
    findings = [];
    seen = new Set();
    requirements = new Map();
    principles = new Map();
    boundaries = new Map();
    push(input) {
        const evidence = input.evidence.map((item) => item.trim()).filter(Boolean);
        if (evidence.length === 0)
            return; // Sin evidencia de máquina el hallazgo no existe.
        const key = `${input.gapType}|${input.source}`;
        if (this.seen.has(key))
            return;
        this.seen.add(key);
        this.findings.push({
            id: `F${this.findings.length + 1}`,
            gapType: input.gapType,
            severity: input.severity ?? GAP_SEVERITY[input.gapType],
            source: input.source,
            evidence,
            remainingWork: input.remainingWork,
        });
        if (input.requirements && input.requirements.length > 0)
            this.requirements.set(key, input.requirements);
        if (input.principle)
            this.principles.set(key, input.principle);
        if (input.boundary)
            this.boundaries.set(key, input.boundary);
    }
    ordered() {
        return [...this.findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
            GAP_TYPES.indexOf(a.gapType) - GAP_TYPES.indexOf(b.gapType) ||
            a.source.localeCompare(b.source));
    }
    requirementsFor(finding) {
        return this.requirements.get(`${finding.gapType}|${finding.source}`) ?? [];
    }
    principleFor(finding) {
        return this.principles.get(`${finding.gapType}|${finding.source}`);
    }
    boundaryFor(finding) {
        return this.boundaries.get(`${finding.gapType}|${finding.source}`);
    }
}
const SCORE_COMPONENT_REASON = {
    missing: { component: 'traceability', reason: 'un requisito sin tarea deja la traza incompleta' },
    partial: { component: 'evidence', reason: 'una tarea pendiente impide cerrar la evidencia del requisito' },
    contradicts: { component: 'alignment', reason: 'un id fantasma o una contradicción de principio rompe la alineación' },
    unrequested: { component: 'traceability', reason: 'código cambiado que ningún requisito reclama no es trazable' },
    unprotected: { component: 'contracts', reason: 'un contrato declarado que no existe deja el oráculo con un hueco' },
    unbound: { component: 'evidence', reason: 'una tarea completada sin `_Evidence:_` baja el componente de evidencia' },
};
const scoreImpactFor = (findings) => {
    const out = [];
    const seen = new Set();
    for (const finding of findings) {
        const entry = SCORE_COMPONENT_REASON[finding.gapType];
        if (seen.has(entry.component))
            continue;
        seen.add(entry.component);
        out.push({ component: entry.component, direction: 'up', reason: entry.reason });
    }
    return out.sort((a, b) => a.component.localeCompare(b.component));
};
/** Requisitos que cita una tarea (`_Requirements:_`), normalizados a mayúsculas. */
const requirementsForTask = (tasks, taskId) => {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task)
        return [];
    const declared = task.raw.match(/_Requirements:\s*([^_\n]+)_/i);
    if (declared) {
        return uniqueSorted(declared[1]
            .split(/[,;]/)
            .map((token) => token.trim().toUpperCase())
            .filter((token) => /^REQ-/.test(token)));
    }
    return uniqueSorted((task.raw.match(/REQ-[A-Z0-9-]+-\d{3}/gi) ?? []).map((token) => token.toUpperCase()));
};
const boundaryForTask = (taskId, declared) => {
    const boundaries = declared.get(taskId);
    return boundaries?.find((boundary) => isPathLike(boundary));
};
const boundaryForRequirement = (requirementId, tasks, declared, delta) => {
    const deltaTarget = delta?.entries
        .find((entry) => entry.id.toUpperCase() === requirementId)
        ?.targets.find((target) => isPathLike(target));
    if (deltaTarget)
        return norm(deltaTarget);
    for (const task of tasks) {
        if (!requirementsForTask(tasks, task.id).includes(requirementId))
            continue;
        const boundary = declared.get(task.id)?.find((candidate) => isPathLike(candidate));
        if (boundary)
            return norm(boundary);
    }
    return undefined;
};
/**
 * Construye la sección `## Phase N: Convergence` con las tareas de los hallazgos. N es el siguiente
 * número de fase libre: el máximo `## Phase <n>` del fichero más uno, o 1 si no hay ninguno. Los ids
 * `conv-K` continúan la numeración ya anexada para no colisionar entre pasadas.
 */
const renderSection = (tasksMarkdown, findings, collector, tddCommand) => {
    let next = 1;
    for (const match of tasksMarkdown.matchAll(/^##\s*Phase\s+(\d+)\b/gm))
        next = Math.max(next, Number(match[1]) + 1);
    let base = 0;
    for (const match of tasksMarkdown.matchAll(/^\s*-\s*\[[ x-]\]\s*(\*)?\s*conv-(\d+)\s*[:.]/gim)) {
        base = Math.max(base, Number(match[2]));
    }
    const lines = findings.map((finding, index) => {
        const parts = [`- [ ] conv-${base + index + 1}: ${finding.remainingWork}`];
        const requirements = collector.requirementsFor(finding);
        const principle = collector.principleFor(finding);
        if (requirements.length > 0)
            parts.push(`_Requirements: ${requirements.join(', ')}_`);
        else if (principle)
            parts.push(`_Constitution: ${principle}_`);
        parts.push(`_Boundary:_ \`${collector.boundaryFor(finding) ?? '.'}\`_`);
        if (tddCommand)
            parts.push(`_TDD:_ \`${tddCommand}\`_`);
        parts.push(`${CONVERGENCE_MARKER} F-${convergenceFingerprint(finding)}_`);
        return parts.join(' — ');
    });
    return `## Phase ${next}: Convergence\n\n${lines.join('\n')}\n`;
};
/**
 * Comando de test REAL de la tarea anexada: el `scripts.test` declarado en el manifiesto, o el que
 * deriva `testCommandFor` de un runner reconocido. Si nadie declaró runner, devuelve `null` y NO se
 * inventa un comando.
 */
const realTestCommand = (testFramework, declaredScript) => {
    const derived = testCommandFor(testFramework, declaredScript);
    if (!derived.derived)
        return { command: derived.command, declared: true };
    if (derived.command !== 'npm test')
        return { command: derived.command, declared: false };
    return { command: null, declared: false };
};
/**
 * Analizar la convergencia de una feature contra el código.
 *
 * No escribe nada. Devuelve el informe completo, incluido el texto que `appendConvergence` anexaría
 * (`appended`) o exactamente el `tasks.md` de entrada cuando no hay nada que anotar.
 */
export const analyseConvergence = async (input) => {
    const root = await findRepoRoot(input.cwd);
    const sddDir = input.sddDir ?? (await resolveSddDir(root));
    const feature = input.feature;
    const specDirRel = posix(path.join(sddDir, 'specs', feature));
    const requirementsRel = `${specDirRel}/requirements.md`;
    const planRel = `${specDirRel}/plan.md`;
    const designRel = `${specDirRel}/design.md`;
    const tasksRel = `${specDirRel}/tasks.md`;
    const deltaRel = `${specDirRel}/${deltaSpecFileName()}`;
    const base = {
        feature,
        findings: [],
        metrics: {
            requirementsChecked: 0,
            tasksChecked: 0,
            principlesChecked: 0,
            contractsChecked: 0,
            byGapType: emptyGapCounts(),
            bySeverity: { high: 0, medium: 0, low: 0 },
        },
        appended: null,
        tasksBefore: 0,
        tasksAfter: 0,
        converged: false,
        checked: [],
        notChecked: [],
        complete: false,
        detail: '',
        scoreImpact: [],
    };
    // Prerrequisito: sin requirements.md no hay fuente de intención y no se produce salida parcial.
    const status = await getSpecStatus(root, feature, sddDir);
    if (!status.exists || !status.files.requirements) {
        return {
            ...base,
            notChecked: [`${requirementsRel}: no existe`],
            detail: `Falta el prerrequisito: no existe ${requirementsRel}. ` +
                `Ejecuta primero \`/sdd-spec-requirements ${feature}\` (el CLI no inventa requisitos) y solo ` +
                `después \`open-sdd brownfield converge ${feature}\`. Nada se ha escrito.`,
        };
    }
    const requirementsRead = await readText(path.join(root, requirementsRel));
    const planRead = await readText(path.join(root, planRel));
    const designRead = await readText(path.join(root, designRel));
    const tasksRead = await readText(path.join(root, tasksRel));
    const deltaRead = await readText(path.join(root, deltaRel));
    if (requirementsRead.content === null) {
        return {
            ...base,
            notChecked: [`${requirementsRel}: existe pero no se pudo leer (${requirementsRead.error ?? 'error de lectura'})`],
            detail: `No se pudo leer ${requirementsRel}: sin la fuente de intención no hay convergencia que medir. Nada se ha escrito.`,
        };
    }
    const requirements = requirementsRead.content;
    const plan = planRead.content ?? designRead.content;
    const tasks = tasksRead.content ?? '';
    const deltaRaw = deltaRead.content;
    const checked = [];
    const notChecked = [];
    const blockers = [];
    // Un fichero que existe y no se pudo leer BLOQUEA la convergencia: no es lo mismo que no existir.
    if (tasksRead.content === null) {
        const reason = tasksRead.exists
            ? `${tasksRel}: existe pero no se pudo leer (${tasksRead.error ?? 'error de lectura'}); no se inspeccionó`
            : `${tasksRel}: no existe; créala con \`/sdd-spec-tasks ${feature}\` antes de converger`;
        notChecked.push(reason);
        blockers.push(reason);
    }
    if (deltaRead.exists && deltaRead.content === null) {
        const reason = `${deltaRel}: existe pero no se pudo leer (${deltaRead.error ?? 'error de lectura'}); no se inspeccionó`;
        notChecked.push(reason);
        blockers.push(reason);
    }
    const collector = new Collector();
    const requirementItems = parseRequirementsMarkdown(requirements);
    const requirementIds = requirementItems.map((item) => item.id.toUpperCase());
    const delta = deltaRaw === null ? null : parseDeltaSpec(deltaRaw);
    const deltaIds = (delta?.entries ?? []).map((entry) => entry.id.toUpperCase());
    const traceIds = uniqueSorted([...requirementIds, ...deltaIds]);
    const parsedTasks = parseTasksMarkdown(tasks);
    const changed = deriveChangedFiles(root, input.changedFiles);
    checked.push(`requisitos: ${requirementItems.length} en ${requirementsRel}${delta ? `; ${delta.entries.length} entrada(s) en ${deltaRel}` : ''}`);
    checked.push(`tareas: ${parsedTasks.length} en ${tasksRead.content === null ? `${tasksRel} (ILEGIBLE, no inspeccionado)` : tasksRel}`);
    const requirementLine = (id) => {
        const line = lineOfRequirement(requirements, id);
        return line > 0 ? `${requirementsRel}:${line}` : requirementsRel;
    };
    const taskLine = (taskId) => {
        const line = lineOfTask(tasks, taskId);
        return line > 0 ? `${tasksRel}:${line}` : tasksRel;
    };
    // ── 1. Traza requisito↔tarea (traceDelta, reutilizado) ────────────────────────────────────────
    const traceSource = {
        feature,
        title: 'requirements.md + delta.md',
        status: 'approved',
        entries: traceIds.map((id) => ({ id, kind: 'ADDED', title: '', statement: '', targets: [] })),
    };
    const deltaTasks = parsedTasks.map((task) => ({
        id: task.id,
        raw: task.raw,
        ...(task.boundary ? { boundary: task.boundary } : {}),
    }));
    const trace = traceDelta(traceSource, deltaTasks);
    const ownersOf = new Map();
    for (const entry of trace.mapped)
        ownersOf.set(entry.requirementId.toUpperCase(), entry.tasks);
    checked.push(`trazabilidad requisito↔tarea (traceDelta): ${trace.mapped.length}/${traceIds.length} requisito(s) con tarea, cobertura ${(trace.coverage * 100).toFixed(0)}%`);
    // Fronteras declaradas por tarea y objetivos de ruta de la delta: el vocabulario de alcance.
    const declaredBoundaries = new Map();
    for (const task of parsedTasks) {
        if (task.boundary && task.boundary.length > 0)
            declaredBoundaries.set(task.id, task.boundary);
    }
    const pathTargets = (delta?.entries ?? []).flatMap((entry) => entry.targets.filter(isPathLike).map((target) => norm(target)));
    // ── 2. `missing`: requisito sin tarea, y frontera declarada que no existe ─────────────────────
    for (const entry of trace.unmapped) {
        const id = entry.toUpperCase();
        if (!traceIds.includes(id))
            continue; // un id desconocido se reporta como `contradicts`
        const deltaTarget = delta?.entries
            .find((candidate) => candidate.id.toUpperCase() === id)
            ?.targets.find((target) => isPathLike(target));
        const boundary = deltaTarget ?? [...declaredBoundaries.values()].flat().find((candidate) => isPathLike(candidate)) ?? '.';
        collector.push({
            gapType: 'missing',
            source: id,
            evidence: [requirementLine(id), `traceDelta: 0 de ${parsedTasks.length} tarea(s) citan ${id}`],
            remainingWork: `El requisito ${id} no tiene ninguna tarea que lo implemente: crea la tarea que lo cubre y demuéstralo con evidencia.`,
            requirements: [id],
            boundary: norm(boundary),
        });
    }
    for (const [taskId, boundaries] of declaredBoundaries) {
        const missingPaths = [];
        for (const boundary of boundaries) {
            const candidate = norm(boundary).replace(/\/\*+$/, '');
            if (!candidate || candidate === '.' || candidate === '*' || candidate === '**')
                continue;
            const probe = await existsOnDisk(path.join(root, candidate));
            if (!probe.exists && probe.error) {
                const reason = `${tasksRel}: stat de la frontera \`${candidate}\` falló (${probe.error}); no se pudo inspeccionar`;
                notChecked.push(reason);
                blockers.push(reason);
                continue;
            }
            if (!probe.exists)
                missingPaths.push(candidate);
        }
        if (missingPaths.length === 0)
            continue;
        const ownerRequirements = requirementsForTask(parsedTasks, taskId);
        collector.push({
            gapType: 'missing',
            severity: 'medium',
            source: taskId,
            evidence: [taskLine(taskId), ...missingPaths.map((candidate) => `${candidate}: no existe (stat: ENOENT)`)],
            remainingWork: `La tarea ${taskId} declara una frontera que el código no muestra (${missingPaths.join(', ')}): corrige la frontera o implementa lo que falta.`,
            ...(ownerRequirements.length > 0 ? { requirements: ownerRequirements } : {}),
            boundary: missingPaths[0],
        });
    }
    // ── 3. `partial`: requisito con tareas, no todas completadas ──────────────────────────────────
    for (const [id, taskIds] of ownersOf) {
        if (!traceIds.includes(id))
            continue;
        const tasksOfRequirement = parsedTasks.filter((task) => taskIds.includes(task.id));
        const done = tasksOfRequirement.filter((task) => task.status === 'completed');
        if (tasksOfRequirement.length === 0 || done.length === tasksOfRequirement.length)
            continue;
        const pending = tasksOfRequirement.filter((task) => task.status !== 'completed');
        collector.push({
            gapType: 'partial',
            source: id,
            evidence: [
                requirementLine(id),
                `cobertura medida: ${done.length}/${tasksOfRequirement.length} tarea(s) completada(s)`,
                ...pending.map((task) => taskLine(task.id)),
            ],
            remainingWork: `El requisito ${id} está a medias (${done.length}/${tasksOfRequirement.length}): cierra ${pending
                .map((task) => task.id)
                .join(', ')} con evidencia y vuelve a ejecutar converge.`,
            requirements: [id],
            boundary: boundaryForRequirement(id, parsedTasks, declaredBoundaries, delta) ?? '.',
        });
    }
    // ── 4. `contradicts`: ids fantasma (traceDelta) ───────────────────────────────────────────────
    for (const phantom of trace.phantomTasks) {
        const cited = phantom.cited.toUpperCase();
        const ownerRequirements = requirementsForTask(parsedTasks, phantom.taskId);
        collector.push({
            gapType: 'contradicts',
            source: cited,
            evidence: [
                taskLine(phantom.taskId),
                `traceDelta: la tarea ${phantom.taskId} cita ${cited}, que no existe en la spec`,
            ],
            remainingWork: `La tarea ${phantom.taskId} cita ${cited}, que ningún requisito define: corrige la referencia o añade el requisito antes de seguir.`,
            ...(ownerRequirements.length > 0 ? { requirements: ownerRequirements } : {}),
            boundary: boundaryForTask(phantom.taskId, declaredBoundaries) ?? '.',
        });
    }
    // ── 5. `unbound`: tareas completadas sin `_Evidence:` (checkEvidenceLock) ─────────────────────
    const lock = checkEvidenceLock(tasks);
    checked.push(`evidencia (checkEvidenceLock): ${lock.checked} tarea(s) completada(s), ${lock.unprovenCompletions.length} sin _Evidence:_`);
    for (const unproven of lock.unprovenCompletions) {
        const ownerRequirements = requirementsForTask(parsedTasks, unproven.taskId);
        collector.push({
            gapType: 'unbound',
            source: unproven.taskId,
            evidence: [
                taskLine(unproven.taskId),
                `checkEvidenceLock: ${lock.unprovenCompletions.length} tarea(s) marcada(s) completada(s) sin \`_Evidence:_\``,
            ],
            remainingWork: `La tarea ${unproven.taskId} está marcada como completada sin \`_Evidence:_\`: captura la salida de la comprobación o vuelve a abrirla.`,
            ...(ownerRequirements.length > 0 ? { requirements: ownerRequirements } : {}),
            boundary: boundaryForTask(unproven.taskId, declaredBoundaries) ?? '.',
        });
    }
    // ── 6. El pivote constitucional (alignSpecWithConstitution) ───────────────────────────────────
    const constitutionRead = await loadConstitution(root, sddDir);
    const constitution = constitutionRead.constitution;
    let principlesChecked = 0;
    if (!constitutionRead.exists) {
        notChecked.push(`pivote constitucional: no existe ${posix(path.join(sddDir, 'steering', 'constitution.md'))} — sin autoridad en vigor no hay contradicción que comprobar`);
    }
    else if (!constitution) {
        const reason = `pivote constitucional: ${constitutionRead.path} existe pero no se pudo leer (${constitutionRead.error ?? 'error de lectura'})`;
        notChecked.push(reason);
        blockers.push(reason);
    }
    else {
        principlesChecked = principlesInForce(constitution).length;
        const alignment = alignSpecWithConstitution({
            feature,
            constitution,
            requirements,
            ...(plan !== null ? { plan } : {}),
            ...(tasksRead.content !== null ? { tasks } : {}),
            ...(delta ? { delta } : {}),
            changedFiles: changed.files,
        });
        checked.push(`pivote constitucional (alignSpecWithConstitution): ${principlesChecked} principio(s) en vigor, ${alignment.declared.length} declarado(s), alineación ${(alignment.alignment * 100).toFixed(0)}%`);
        for (const finding of alignment.findings) {
            if (finding.severity !== 'error')
                continue; // los avisos del pivote duplican a validateDeltaSpec
            const rawSource = finding.artifactId ?? finding.principleId ?? feature;
            const source = rawSource.toUpperCase();
            const gapType = finding.code === 'ORACLE_MISSING' ? 'unprotected' : 'contradicts';
            const evidence = [`alignSpecWithConstitution:${finding.code}`];
            if (finding.principleId)
                evidence.push(`principio ${finding.principleId}`);
            if (finding.artifactId) {
                evidence.push(/^REQ-/i.test(finding.artifactId)
                    ? requirementLine(finding.artifactId.toUpperCase())
                    : `${finding.artifactId}: artefacto citado por el pivote`);
            }
            collector.push({
                gapType,
                source,
                evidence,
                remainingWork: gapType === 'unprotected'
                    ? `El pivote constitucional reporta un oráculo ausente para ${rawSource}: declara el contrato que cubre el comportamiento o retira la promesa.`
                    : `El pivote constitucional reporta una contradicción (${finding.code}) sobre ${rawSource}: resuélvela o tramita una enmienda antes de converger.`,
                ...(/^REQ-/i.test(rawSource) ? { requirements: [source] } : {}),
                ...(finding.principleId ? { principle: finding.principleId } : {}),
                boundary: boundaryForRequirement(source, parsedTasks, declaredBoundaries, delta) ?? '.',
            });
        }
    }
    // ── 7. `unprotected`: contratos declarados que no existen (extractContracts) ──────────────────
    const project = await scanProject(root);
    for (const toolchain of project.unreadableToolchains ?? []) {
        const reason = `reconocimiento: la toolchain declarada ${toolchain} no se pudo leer, así que el stack y los módulos pueden estar incompletos`;
        notChecked.push(reason);
        blockers.push(reason);
    }
    const boundarySet = resolveBoundaries(project);
    checked.push(`fronteras observadas (resolveBoundaries): ${boundarySet.boundaries.join(', ')}`);
    const declaredContracts = (delta?.entries ?? []).flatMap((entry) => (entry.contracts ?? []).map((test) => ({ entry: entry.id.toUpperCase(), test })));
    let contractsChecked = 0;
    if (declaredContracts.length === 0 && changed.files.length === 0) {
        notChecked.push(delta
            ? 'contratos: la delta no declara contratos y no hay ficheros cambiados, así que no hay oráculo que medir'
            : 'contratos: no existe delta.md ni hay ficheros cambiados, así que no hay contratos que medir');
    }
    else {
        const set = await extractContracts({
            cwd: root,
            feature,
            changedFiles: changed.files,
            ...(delta ? { delta } : {}),
            testDirs: project.testDirs,
            ...(project.testFramework ? { testFramework: project.testFramework } : {}),
        });
        contractsChecked = set.contracts.length;
        const discovered = set.contracts
            .filter((contract) => contract.source === 'discovered')
            .map((contract) => contract.test);
        checked.push(`contratos (extractContracts): ${set.contracts.length} en el oráculo (${discovered.length} descubierto(s)), ${declaredContracts.length} declarado(s), comando propuesto \`${set.testCommand}\``);
        if (!set.complete) {
            const reason = `contratos de ejecución: ${set.detail}`;
            notChecked.push(reason);
            blockers.push(reason);
        }
        for (const contract of declaredContracts) {
            const file = norm(contract.test.split('::')[0] ?? contract.test);
            const probe = file ? await existsOnDisk(path.join(root, file)) : { exists: false };
            const backed = probe.exists ||
                discovered.some((test) => {
                    const candidate = norm(test.split('::')[0] ?? test);
                    return candidate === file || candidate.endsWith(`/${file}`) || file.endsWith(`/${candidate}`);
                });
            if (backed)
                continue;
            const entry = delta?.entries.find((candidate) => candidate.id.toUpperCase() === contract.entry);
            const dir = file.includes('/') ? path.posix.dirname(file) : '.';
            collector.push({
                gapType: 'unprotected',
                source: contract.test,
                evidence: [
                    `${deltaRel}: contrato declarado por ${contract.entry}`,
                    `${file || contract.test}: no existe (stat: ENOENT)`,
                    `extractContracts: 0 de ${set.contracts.length} contrato(s) del oráculo lo respaldan`,
                ],
                remainingWork: `El contrato declarado \`${contract.test}\` para ${contract.entry} no existe: escribe la prueba que protege ese comportamiento o retira la promesa de la delta.`,
                requirements: [contract.entry],
                boundary: norm(entry?.targets.find((target) => isPathLike(target)) ?? dir),
            });
        }
    }
    // ── 8. `unrequested`: exports cambiados que ningún requisito nombra ───────────────────────────
    if (!changed.available) {
        notChecked.push(`código no pedido: ${changed.reason ?? 'no se pudieron obtener los ficheros cambiados'}, así que no se inspeccionó ningún diff`);
    }
    else if (changed.files.length === 0) {
        checked.push(`código no pedido: 0 ficheros cambiados en el origen (${changed.source}); nada que medir`);
    }
    else {
        const roots = uniqueSorted([
            ...[...declaredBoundaries.values()].flat().map(norm).filter((value) => value && value !== '.'),
            ...pathTargets,
        ]);
        if (roots.length === 0) {
            notChecked.push('código no pedido: la spec no declara ninguna frontera ni objetivo de ruta con el que contrastar el diff');
        }
        else {
            const tokens = specTokens([requirements, plan ?? '', tasks, deltaRaw ?? '']);
            const sources = changed.files.filter((file) => SOURCE_EXT.test(file) &&
                !TESTS_EXT.test(file) &&
                !isGenerated(file) &&
                roots.some((dir) => isInside(file, dir)));
            let inspected = 0;
            for (const file of sources) {
                const read = await readText(path.join(root, file));
                if (read.content === null) {
                    const reason = `código no pedido: ${file} existe pero no se pudo leer (${read.error ?? 'error de lectura'}); no se inspeccionó`;
                    notChecked.push(reason);
                    blockers.push(reason);
                    continue;
                }
                inspected += 1;
                for (const name of extractExportNames(read.content)) {
                    if (isRequestedExport(name, tokens))
                        continue;
                    if (isTypeOnlyExport(read.content, name))
                        continue;
                    const line = lineOf(read.content, new RegExp(`\\b${escapeRe(name)}\\b`));
                    collector.push({
                        gapType: 'unrequested',
                        source: file,
                        evidence: [
                            `${file}:${Math.max(1, line)}`,
                            `${file}: export ${name}`,
                            `0 de ${tokens.size} token(s) de la spec nombran ${name}`,
                        ],
                        remainingWork: `El fichero ${file} expone ${name}, que ningún requisito de la spec nombra: vincúlalo a un requisito o retíralo del cambio.`,
                        boundary: file.includes('/') ? path.posix.dirname(file) : '.',
                    });
                }
            }
            checked.push(`código no pedido (extractExportNames): ${inspected}/${sources.length} fichero(s) fuente cambiado(s) dentro de las fronteras/objetivos declarados`);
        }
    }
    // ── 9. Delegación artefacto↔artefacto (checkConsistency) ──────────────────────────────────────
    const ownedByConverge = new Set([
        'REQUIREMENT_WITHOUT_TASK',
        'PHANTOM_REQUIREMENT_ID',
        'DECLARED_CONTRACT_MISSING',
        'BOUNDARY_COVERS_NOTHING',
        'UNKNOWN_PRINCIPLE',
        'MUST_CONTRADICTED',
        'TECH_LOCK_VIOLATION',
        'BOUNDARY_VIOLATION',
        'API_COMPAT_MISSING',
        'ORACLE_MISSING',
    ]);
    const consistency = await checkConsistency({
        cwd: root,
        feature,
        sddDir,
        ...(changed.available ? { changedFiles: changed.files } : {}),
    });
    checked.push(`consistencia cruzada artefacto↔artefacto (delegada a checkConsistency): ${consistency.checked.length} comprobación(es), ${consistency.findings.filter((finding) => finding.severity === 'error').length} error(es); converge no re-emite los códigos que ya posee`);
    for (const reason of consistency.notChecked)
        notChecked.push(`consistencia cruzada — ${reason}`);
    const lifted = consistency.findings.filter((finding) => finding.severity === 'error' && !ownedByConverge.has(finding.code));
    for (const finding of lifted) {
        collector.push({
            gapType: 'contradicts',
            severity: 'medium',
            source: finding.artifacts[0] ?? finding.code,
            evidence: [`checkConsistency:${finding.code}`, `artefactos: ${finding.artifacts.join(', ') || '(ninguno)'}`],
            remainingWork: `La comprobación de consistencia ${finding.code} reporta un error que converge no cubre: resuélvelo antes de declarar la convergencia.`,
        });
    }
    // ── Idempotencia: descartar los huecos ya anotados ────────────────────────────────────────────
    const alreadyAppended = fingerprintsInTasks(tasks);
    const allFindings = collector.ordered();
    const findings = allFindings.filter((finding) => !alreadyAppended.has(convergenceFingerprint(finding)));
    const skipped = allFindings.length - findings.length;
    if (skipped > 0) {
        checked.push(`idempotencia: ${skipped} hallazgo(s) ya constan como tarea en ${tasksRel} (\`${CONVERGENCE_MARKER} F-…_\`); no se vuelven a anotar`);
    }
    // ── Comando de test REAL de las tareas anexadas ───────────────────────────────────────────────
    const rootManifest = await readText(path.join(root, 'package.json'));
    let declaredScript;
    if (rootManifest.content) {
        try {
            const parsed = JSON.parse(rootManifest.content);
            declaredScript = parsed.scripts?.test;
        }
        catch {
            declaredScript = undefined;
        }
    }
    const tdd = realTestCommand(project.testFramework, declaredScript);
    if (!tdd.command) {
        notChecked.push('runner de test: ningún manifiesto declaró `scripts.test` ni se detectó un framework con comando asociado, así que las tareas no llevan `_TDD:_` (no se inventa un comando)');
    }
    // ── Texto resultante de tasks.md (con el tope `--max`, si lo hay) ─────────────────────────────
    const cap = input.max !== undefined && input.max > 0 ? input.max : findings.length;
    const toAppend = findings.slice(0, cap);
    let appended = tasksRead.content === null ? null : tasks;
    let tasksAfter = parsedTasks.length;
    if (toAppend.length > 0 && tasksRead.content !== null) {
        const section = renderSection(tasks, toAppend, collector, tdd.command);
        const prefix = tasks.length === 0 ? '' : tasks.endsWith('\n') ? '\n' : '\n\n';
        appended = `${tasks}${prefix}${section}`;
        tasksAfter = parseTasksMarkdown(appended).length;
    }
    else if (findings.length > 0) {
        appended = null;
    }
    const byGapType = emptyGapCounts();
    for (const finding of findings)
        byGapType[finding.gapType] += 1;
    const bySeverity = { high: 0, medium: 0, low: 0 };
    for (const finding of findings)
        bySeverity[finding.severity] += 1;
    const complete = notChecked.length === 0;
    const converged = findings.length === 0 && blockers.length === 0;
    const capped = toAppend.length < findings.length;
    const detail = [
        `Convergencia de "${feature}": ${findings.length} hueco(s) nuevo(s) [${bySeverity.high} alto, ${bySeverity.medium} medio, ${bySeverity.low} bajo] sobre ${traceIds.length} requisito(s) y ${parsedTasks.length} tarea(s)`,
        skipped > 0 ? `${skipped} hueco(s) ya anotado(s) antes y no repetido(s)` : '',
        findings.length === 0
            ? converged
                ? 'nada que anotar: tasks.md queda intacto'
                : 'nada nuevo que anotar, pero hay inspecciones sin hacer y no se declara convergencia'
            : `se anexarían ${toAppend.length} tarea(s)${capped ? ` (tope --max ${input.max})` : ''}`,
        !complete
            ? `${notChecked.length} cosa(s) sin inspeccionar (no cuentan como aprobado): ${notChecked.join('; ')}`
            : 'todo lo que converge debía inspeccionar se inspeccionó',
    ]
        .filter(Boolean)
        .join('; ');
    return {
        feature,
        findings,
        metrics: {
            requirementsChecked: traceIds.length,
            tasksChecked: parsedTasks.length,
            principlesChecked,
            contractsChecked,
            byGapType,
            bySeverity,
        },
        appended,
        tasksBefore: parsedTasks.length,
        tasksAfter,
        converged,
        checked,
        notChecked,
        complete,
        detail: `${detail}.`,
        scoreImpact: scoreImpactFor(findings),
    };
};
/**
 * Anexar la sección de convergencia que el informe ya calculó.
 *
 * Es una operación de ESCRITURA ÚNICA: no recalcula hallazgos, no toca nada por encima del final del
 * fichero y, si el informe no corresponde al `tasks.md` actual (alguien lo cambió entre el análisis y
 * el anexado), se niega en vez de escribir sobre una base distinta.
 */
export const appendConvergence = async (input) => {
    const root = await findRepoRoot(input.cwd);
    const sddDir = input.sddDir ?? (await resolveSddDir(root));
    const tasksRel = posix(path.join(sddDir, 'specs', input.feature, 'tasks.md'));
    const tasksPath = path.join(root, sddDir, 'specs', input.feature, 'tasks.md');
    const before = await readText(tasksPath);
    const tasksBefore = before.content === null ? 0 : parseTasksMarkdown(before.content).length;
    if (before.content === null) {
        return {
            written: false,
            path: tasksPath,
            tasksAfter: tasksBefore,
            detail: `No existe ${tasksRel} o no se pudo leer: créala con \`/sdd-spec-tasks ${input.feature}\` antes de anexar convergencia. Nada se ha escrito.`,
        };
    }
    if (input.report.findings.length === 0) {
        return {
            written: false,
            path: tasksPath,
            tasksAfter: tasksBefore,
            detail: 'No hay hallazgos nuevos: no se escribe nada y tasks.md queda byte a byte intacto.',
        };
    }
    if (input.report.appended === null || input.report.appended === before.content) {
        return {
            written: false,
            path: tasksPath,
            tasksAfter: tasksBefore,
            detail: 'El informe no aporta texto nuevo a tasks.md (tope --max o prerrequisito ausente). Nada se ha escrito.',
        };
    }
    if (!input.report.appended.startsWith(before.content)) {
        return {
            written: false,
            path: tasksPath,
            tasksAfter: tasksBefore,
            detail: `tasks.md cambió entre el análisis y el anexado: el informe ya no corresponde al fichero. Vuelve a ejecutar \`open-sdd brownfield converge ${input.feature}\`. Nada se ha escrito.`,
        };
    }
    const after = input.report.appended;
    if (input.write === true)
        await writeFile(tasksPath, after, 'utf8');
    const tasksAfter = parseTasksMarkdown(after).length;
    return {
        written: input.write === true,
        path: tasksPath,
        tasksAfter,
        detail: input.write === true
            ? `Anexada la sección de convergencia: ${tasksBefore} → ${tasksAfter} tarea(s). Nada por encima del final se ha tocado.`
            : `Se anexarían ${tasksAfter - tasksBefore} tarea(s) (sin --write no se escribe).`,
    };
};
/** Código de salida: 1 solo cuando hay un hueco `high` (un hueco real en una feature entregada). */
export const convergeExitCode = (report) => report.findings.some((finding) => finding.severity === 'high') ? 1 : 0;
