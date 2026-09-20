/**
 * Ratchet constitucional (REQ-MAT-005): la alineación de una spec NUNCA desciende en silencio.
 *
 * El pivote (`specConstitution.ts`) responde «¿cuánto de la autoridad que la spec cita resuelve hoy?».
 * Este módulo responde la pregunta que el pivote, por ser sin memoria, no puede contestar: «¿está eso
 * PEOR que la última vez que se comprobó?». Una comprobación que solo mira el presente convierte un
 * descenso en un número distinto; un trinquete lo convierte en un hecho con fecha, autor y motivo.
 *
 * ── La línea base ───────────────────────────────────────────────────────────────────────────────
 * Vive en `.sdd/state/adhesion.json`, por feature: la ratio de alineación, los ids de los principios
 * EN VIGOR en ese momento, el hash del contenido de la constitución y la marca de tiempo. Con esos
 * cuatro datos un descenso es decidible:
 *
 *   · RATIO MÁS BAJA  → la spec dejó de resolver autoridad que antes resolvía.
 *   · PRINCIPIO FUERA → un principio que estaba en vigor ya no lo está (fell out).
 *
 * «En vigor» y no «declarado» a propósito: el conjunto en vigor es un hecho de la constitución
 * (autoridad que existe), no una afirmación de la spec. Comparar declaraciones haría que reescribir
 * el mismo conjunto con otras palabras pareciera una regresión.
 *
 * ── El contrato del trinquete ───────────────────────────────────────────────────────────────────
 *  1. La PRIMERA ejecución establece la línea base y NUNCA falla: no hay descenso contra nada.
 *  2. Un DESCENSO es un `error` que nombra los principios que salieron, y NO actualiza la base — un
 *     trinquete que se reajusta solo al bajar no es un trinquete. Se corrige la spec o se acepta.
 *  3. `--accept-drop "<razón>"` autoriza ese descenso concreto: registra quién, qué y cuándo en el
 *     MISMO fichero y actualiza la base. Aceptar no es fallar, pero queda escrito.
 *  4. Una SUBIDA actualiza la base: el trinquete solo sube.
 *  5. Estado CORRUPTO o ilegible → `warning` y se reestablece. Nunca un aprobado silencioso (el aviso
 *     lo declara) y nunca una excepción: un trinquete que revienta es un trinquete que nadie ejecuta.
 *
 * ── Qué NO toca ─────────────────────────────────────────────────────────────────────────────────
 * Este módulo posee `adhesion.json` y SOLO ese fichero. `adhesion-history.json` (la tendencia) lo
 * escribe otra pieza: aquí nunca se lee ni se escribe, para que dos escritores no se pisen.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const ADHESION_STATE_DIR = 'state';
export const ADHESION_STATE_FILE = 'adhesion.json';
export const ADHESION_STATE_VERSION = 1;
/** `.sdd/state/adhesion.json` a partir del directorio SDD (absoluto o relativo). */
export const adhesionStatePath = (sddDir) => path.join(sddDir, ADHESION_STATE_DIR, ADHESION_STATE_FILE);
/** Hash de contenido de la constitución: sha256 hex. */
export const hashConstitution = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
/** Dos ratios son el mismo a efectos del trinquete (evita ruido de coma flotante). */
const EPSILON = 1e-9;
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isBaseline = (value) => {
    if (!value || typeof value !== 'object')
        return false;
    const candidate = value;
    return (isFiniteNumber(candidate.alignment) &&
        Array.isArray(candidate.principles) &&
        candidate.principles.every((id) => typeof id === 'string') &&
        typeof candidate.constitutionHash === 'string' &&
        typeof candidate.recordedAt === 'string');
};
/**
 * Leer el estado del trinquete. NUNCA lanza.
 *
 * «No existe» no es «corrupto»: un proyecto sin trinquete está en su primera ejecución. «Existe pero
 * no se entiende» sí lo es, y se declara — tratarlo como vacío sería el aprobado silencioso que este
 * módulo existe para impedir.
 */
export const readAdhesionState = async (sddDir) => {
    const statePath = adhesionStatePath(sddDir);
    let raw;
    try {
        raw = await readFile(statePath, 'utf8');
    }
    catch (err) {
        const code = err.code;
        if (code === 'ENOENT' || code === 'ENOTDIR')
            return { state: null, corrupt: false };
        return { state: null, corrupt: true, error: `${statePath}: ${err.message}` };
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        return { state: null, corrupt: true, error: `${statePath}: JSON inválido (${err.message})` };
    }
    const candidate = parsed;
    if (!candidate || typeof candidate !== 'object' || !candidate.features || typeof candidate.features !== 'object') {
        return { state: null, corrupt: true, error: `${statePath}: falta el mapa "features"` };
    }
    if (candidate.version !== ADHESION_STATE_VERSION) {
        // Una versión distinta se reestablece, no se interpreta a ojo: leer un formato desconocido como
        // si fuera el nuestro es exactamente un aprobado silencioso sobre algo no inspeccionado.
        return {
            state: null,
            corrupt: true,
            error: `${statePath}: versión ${String(candidate.version)} desconocida (se esperaba ${ADHESION_STATE_VERSION})`,
        };
    }
    const features = candidate.features;
    for (const [feature, baseline] of Object.entries(features)) {
        if (!isBaseline(baseline)) {
            return { state: null, corrupt: true, error: `${statePath}: la línea base de "${feature}" no tiene la forma esperada` };
        }
    }
    const acceptances = {};
    if (candidate.acceptances && typeof candidate.acceptances === 'object') {
        for (const [feature, list] of Object.entries(candidate.acceptances)) {
            if (Array.isArray(list))
                acceptances[feature] = list;
        }
    }
    return {
        state: { version: ADHESION_STATE_VERSION, features: features, acceptances },
        corrupt: false,
    };
};
const persistState = async (statePath, state) => {
    await mkdir(path.dirname(statePath), { recursive: true });
    const tmp = `${statePath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(tmp, statePath);
};
const dropMessage = (feature, previous, current, dropped) => {
    const from = (previous.alignment * 100).toFixed(0);
    const to = (current.alignment * 100).toFixed(0);
    const who = dropped.length > 0
        ? `los principios que salieron del conjunto en vigor: ${dropped.join(', ')}`
        : `ningún principio salió del conjunto en vigor, pero la cobertura de los declarados bajó (¿una autoridad fantasma nueva?)`;
    return `La alineación constitucional de "${feature}" DESCENDIÓ de ${from}% a ${to}% y ${who}. Un descenso silencioso es una regresión de cumplimiento: corrige la spec o autoriza el descenso con --accept-drop "<razón>", que lo registrará con autor y fecha.`;
};
/**
 * Ejecutar el trinquete: leer la base, comparar con la ejecución actual y, si procede, actualizarla.
 *
 * Nunca lanza. Un estado corrupto se declara con `warning` y se reestablece; un descenso no aceptado
 * se declara con `error` y NO se persiste (la base anterior sigue siendo la referencia).
 */
export const runAdhesionRatchet = async (input) => {
    const now = input.now ?? new Date();
    const statePath = adhesionStatePath(input.sddDir);
    const current = {
        alignment: input.alignment,
        principles: [...input.principles].sort(),
        constitutionHash: input.constitutionHash,
        recordedAt: now.toISOString(),
    };
    const findings = [];
    const read = await readAdhesionState(input.sddDir);
    if (read.corrupt) {
        // Se dice en voz alta y se reestablece: jamás un aprobado sobre un fichero que no se entendió.
        findings.push({
            severity: 'warning',
            code: 'ADHESION_STATE_CORRUPT',
            message: `El estado del trinquete no se pudo interpretar y se reestablece desde cero (${read.error ?? 'motivo desconocido'}). La línea base anterior se pierde: esta ejecución no puede comparar contra ella.`,
        });
    }
    const previous = read.state?.features[input.feature] ?? null;
    const features = { ...(read.state?.features ?? {}) };
    const acceptances = { ...(read.state?.acceptances ?? {}) };
    let verdict;
    let dropped = [];
    if (read.corrupt) {
        verdict = 'corrupt-reestablished';
        features[input.feature] = current;
        findings.push({
            severity: 'info',
            code: 'ADHESION_BASELINE',
            message: `Línea base de alineación reestablecida para "${input.feature}": ${(current.alignment * 100).toFixed(0)}% con ${current.principles.length} principio(s) en vigor. La próxima comprobación ya podrá comparar.`,
        });
    }
    else if (!previous) {
        verdict = 'baseline';
        features[input.feature] = current;
        findings.push({
            severity: 'info',
            code: 'ADHESION_BASELINE',
            message: `Primera comprobación de "${input.feature}": línea base establecida en ${(current.alignment * 100).toFixed(0)}% con ${current.principles.length} principio(s) en vigor. Sin base previa no hay descenso que imputar.`,
        });
    }
    else {
        dropped = previous.principles.filter((id) => !current.principles.includes(id));
        const ratioDropped = current.alignment < previous.alignment - EPSILON;
        const ratioRose = current.alignment > previous.alignment + EPSILON;
        if (ratioDropped || dropped.length > 0) {
            if (input.acceptDrop && input.acceptDrop.trim()) {
                verdict = 'accepted-drop';
                const actor = input.actor?.trim() || 'desconocido';
                const acceptance = {
                    feature: input.feature,
                    reason: input.acceptDrop.trim(),
                    actor,
                    at: now.toISOString(),
                    from: previous.alignment,
                    to: current.alignment,
                    droppedPrinciples: dropped,
                };
                acceptances[input.feature] = [...(acceptances[input.feature] ?? []), acceptance];
                features[input.feature] = current;
                findings.push({
                    severity: 'info',
                    code: 'ADHESION_DROP_ACCEPTED',
                    message: `Descenso de alineación de "${input.feature}" ACEPTADO por ${actor} el ${acceptance.at}: «${acceptance.reason}». Base actualizada a ${(current.alignment * 100).toFixed(0)}%. Queda registrado en ${ADHESION_STATE_FILE}.`,
                });
            }
            else {
                verdict = 'drop';
                // NO se actualiza la base: si el trinquete se reajustara al bajar, no sería un trinquete.
                findings.push({
                    severity: 'error',
                    code: 'ADHESION_DROP',
                    message: dropMessage(input.feature, previous, current, dropped),
                    ...(dropped.length === 1 ? { principleId: dropped[0] } : {}),
                });
            }
        }
        else if (ratioRose || previous.constitutionHash !== current.constitutionHash) {
            verdict = 'rise';
            features[input.feature] = current;
            if (ratioRose) {
                findings.push({
                    severity: 'info',
                    code: 'ADHESION_RISE',
                    message: `Alineación de "${input.feature}" subió de ${(previous.alignment * 100).toFixed(0)}% a ${(current.alignment * 100).toFixed(0)}%: línea base actualizada (el trinquete solo sube).`,
                });
            }
            else {
                findings.push({
                    severity: 'info',
                    code: 'ADHESION_RISE',
                    message: `La constitución de "${input.feature}" cambió sin bajar la alineación (${(current.alignment * 100).toFixed(0)}%): hash de la base actualizado.`,
                });
            }
        }
        else {
            verdict = 'stable';
            // Base intacta: mismo ratio, mismos principios, mismo hash. Sin hallazgo.
        }
    }
    const state = { version: ADHESION_STATE_VERSION, features, acceptances };
    // Un descenso no aceptado no se persiste: la referencia debe seguir siendo la anterior.
    const shouldPersist = verdict !== 'drop' && input.persist !== false;
    if (shouldPersist) {
        try {
            await persistState(statePath, state);
        }
        catch (err) {
            findings.push({
                severity: 'warning',
                code: 'ADHESION_STATE_UNWRITABLE',
                message: `El estado del trinquete no se pudo escribir en ${statePath} (${err.message}): esta comprobación no dejó línea base, así que la próxima volverá a empezar.`,
            });
            return {
                feature: input.feature,
                verdict,
                findings,
                baseline: verdict === 'drop' ? previous ?? current : current,
                previous,
                droppedPrinciples: dropped,
                stateCorrupt: read.corrupt,
                statePath,
                stateError: err.message,
            };
        }
    }
    return {
        feature: input.feature,
        verdict,
        findings,
        baseline: verdict === 'drop' ? previous ?? current : current,
        previous,
        droppedPrinciples: dropped,
        stateCorrupt: read.corrupt,
        statePath,
        ...(read.error ? { stateError: read.error } : {}),
    };
};
