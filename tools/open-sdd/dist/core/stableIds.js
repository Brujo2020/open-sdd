/**
 * Identificadores estables: un id no se renumera y un cambio de significado viaja con su delta.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────────────────────────
 * Un `REQ-AREA-014` es una cita: aparece en tareas, en contratos, en la delta y en los commits. Si
 * insertar un requisito renombra a todos los siguientes, cada cita pasa a significar otra cosa EN
 * SILENCIO —el fallo que la literatura documenta como «nothing errors, the references just quietly
 * mean something else»—. Este módulo hace dos cosas y ninguna más:
 *
 *  1. ASIGNA POR BLOQUES: el siguiente bloque libre de un área (010…019, 020…029), para que insertar
 *     un requisito no obligue a renumerar el resto.
 *  2. AUDITA CONTRA UNA BASE: compara los ids y sus enunciados contra otra revisión y reporta
 *     `ID-MUTATED` (mismo id, otro significado, sin delta que lo declare) e `ID-LOST` (el id
 *     desapareció sin una entrada REMOVED).
 *
 * No decide si el cambio es correcto: reporta lo que cambió sin declararlo. La delta es el canal
 * para declararlo, y esto es lo que hace visible que falta.
 */
import { execFileSync } from 'node:child_process';
/** La forma de un id citable: `REQ-<AREA>-<NNN>`, con al menos tres dígitos. */
export const ID_SHAPE = /^REQ-[A-Z0-9]+-\d{3,}$/;
/** Tamaño del bloque por área. Diez deja sitio para crecer sin renumerar. */
export const ID_BLOCK_SIZE = 10;
/** Normaliza un enunciado para comparar SIGNIFICADO, no formato. */
export const normalizeStatement = (statement) => statement
    .replace(/^[\s\-*>\d.)]+/, '')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
/**
 * Extrae `id → enunciado normalizado` de un `requirements.md` (o delta). Un id puede aparecer en un
 * encabezado (`### REQ-AUTH-014 — Título`) o al principio de una línea; el enunciado es el resto de
 * la línea. Si el mismo id aparece dos veces, gana el PRIMERO: duplicar un id es otro defecto y no
 * debe cambiar el veredicto de este.
 */
export const parseRequirementIds = (text) => {
    const found = new Map();
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim();
        const match = line.match(/^(REQ-[A-Z0-9]+-\d{3,})\b[\s:—-]*(.*)$/);
        if (!match)
            continue;
        const id = match[1];
        if (!found.has(id))
            found.set(id, normalizeStatement(match[2] ?? ''));
    }
    return found;
};
/**
 * La auditoría. `ID-MUTATED` es el mismo id con otro enunciado; `ID-LOST` es un id que ya no está.
 * Ambos se reportan porque ambos rompen citas; el canal para declararlos es la delta.
 */
export const auditIds = (input) => {
    const findings = [];
    for (const [id, statement] of input.before) {
        const now = input.after.get(id);
        if (now === undefined) {
            findings.push({
                code: 'ID-LOST',
                id,
                detail: 'el id desapareció: si el requisito se retiró, declara una entrada REMOVED en la delta; si solo se movió, no lo renumeres',
            });
            continue;
        }
        if (now !== statement) {
            findings.push({
                code: 'ID-MUTATED',
                id,
                detail: 'el mismo id cambió de enunciado: declara una entrada MODIFIED en la delta en vez de dejar que las citas signifiquen otra cosa en silencio',
            });
        }
    }
    return findings;
};
/**
 * El siguiente bloque libre de un área. `existing` son los ids ya usados de esa área; el bloque
 * empieza en el múltiplo de `size` siguiente al mayor número visto, así que insertar no renumera.
 */
export const allocateBlock = (area, existing, size = ID_BLOCK_SIZE) => {
    const shape = new RegExp(`^REQ-${area}-(\\d+)$`);
    const numbers = existing
        .map((id) => id.match(shape)?.[1])
        .filter((value) => value !== undefined)
        .map((value) => Number(value));
    const highest = numbers.length > 0 ? Math.max(...numbers) : 0;
    const start = Math.floor(highest / size) * size + size;
    return Array.from({ length: size }, (_, index) => `REQ-${area}-${String(start + index).padStart(3, '0')}`);
};
/** Lee un fichero en una revisión concreta. `null` cuando no existe en esa revisión (no es un fallo). */
export const readTextAtRef = (cwd, ref, relPath) => {
    try {
        // `stderr` se silencia a propósito: una base que no resuelve es un caso ESPERADO y se reporta en
        // `problems`, así que el «fatal: invalid object name» de git sería ruido en la salida del gate.
        return execFileSync('git', ['show', `${ref}:${relPath}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    }
    catch {
        return null;
    }
};
/**
 * La auditoría contra una base, lista para un gate de pull request. Lee `requirements.md` en la
 * revisión base y en el árbol de trabajo. Una base que no resuelve, o un fichero que no existe en la
 * base, viajan en `problems`: no se inventa un veredicto sobre lo que no se pudo leer.
 */
export const auditIdsAgainstBase = (input) => {
    const problems = [];
    const beforeText = readTextAtRef(input.cwd, input.base, input.requirementsRelPath);
    if (beforeText === null) {
        problems.push(`no se pudo leer ${input.requirementsRelPath} en \`${input.base}\`: la base no resuelve, o el fichero no existe allí. Sin base no hay auditoría.`);
    }
    if (input.afterText === null) {
        problems.push(`no se pudo leer ${input.requirementsRelPath} en el árbol de trabajo.`);
    }
    const before = parseRequirementIds(beforeText ?? '');
    const after = parseRequirementIds(input.afterText ?? '');
    return {
        beforeCount: before.size,
        afterCount: after.size,
        findings: problems.length > 0 ? [] : auditIds({ before, after }),
        problems,
    };
};
