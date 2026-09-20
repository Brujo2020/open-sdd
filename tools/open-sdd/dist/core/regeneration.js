/**
 * Regeneración: el bucle operable de spec-as-source (REQ-MAT-015).
 *
 * El tercer nivel de rigor declara que la spec ES la fuente y que la regeneración es el mecanismo de
 * reparación. Hasta ahora el asesor solo podía informar la brecha como «indecidible»: sabía que el
 * nivel exigía regeneración y no tenía forma de ejecutarla. Este módulo es ese bucle, con el orden de
 * operaciones que lo hace honesto:
 *
 *   (a) la spec manda: el nivel declarado debe ser `spec-as-source` Y la constitución debe estar en
 *       vigor. Sin autoridad no se repara nada — se rechaza con el motivo.
 *   (b) la reparación se REGISTRA primero: una entrada en `## Repairs` de la spec con el requisito al
 *       que sirve, la evidencia que la falsaría/sostiene y el generador declarado. El registro va
 *       antes de tocar el artefacto porque la spec es la fuente, no el acta de lo que ya se hizo.
 *   (c) se regenera el artefacto con el comando declarado por el llamante. Sin comando declarado no se
 *       inventa uno: se rechaza con el motivo, en lugar de afirmar una reparación que nadie ejecutó.
 *   (d) se informa la DERIVA hasta que el hash del artefacto coincide con el registrado. Y si el
 *       generador termina en 0 pero no cambia ningún fichero, no se declara reparación: `regenerated`
 *       es falso y el informe lo dice.
 *
 * La reparación se pisa a sí misma sin crecer sin límite: un registro por `target`, que se actualiza
 * con el hash reconciliado — la spec mantiene una sola verdad por artefacto.
 *
 * Los textos visibles para el usuario son español, como el resto del CLI.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseConstitution, principlesInForce } from './constitution.js';
import { constitutionArtifactPaths } from './constitutionDraft.js';
import { RIGOR_SETTINGS_FILE, loadRigorSettings } from './rigor.js';
import { resolveSddDir } from './specManager.js';
// ---------------------------------------------------------------------------------------------
// Registro de reparaciones en la spec
// ---------------------------------------------------------------------------------------------
/** The section the repair log lives in, inside the feature's `requirements.md`. */
export const REPAIRS_SECTION = '## Repairs';
export const renderRepairRecord = (record) => {
    const lines = [`### ${record.target}`, ''];
    if (record.requirement)
        lines.push(`- Requirement: ${record.requirement}`);
    if (record.evidence)
        lines.push(`- Evidence: ${record.evidence}`);
    if (record.generator)
        lines.push(`- Generator: ${record.generator}`);
    lines.push(`- Hash: ${record.hash ?? 'pending'}`);
    if (record.updatedAt)
        lines.push(`- Updated: ${record.updatedAt}`);
    return lines.join('\n');
};
/** Read back the repairs the spec records. Tolerant: a malformed line is skipped, not invented. */
export const parseRepairRecords = (markdown) => {
    const lines = markdown.split('\n');
    const sectionStart = lines.findIndex((line) => /^##\s+repairs\s*$/i.test(line.trim()));
    if (sectionStart < 0)
        return [];
    const records = [];
    let current = null;
    const flush = () => {
        if (current)
            records.push(current);
        current = null;
    };
    for (let i = sectionStart + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (/^##\s/.test(line))
            break;
        const heading = line.match(/^###\s+(.*)$/);
        if (heading) {
            flush();
            current = { target: heading[1].trim(), hash: null };
            continue;
        }
        if (!current)
            continue;
        const field = line.match(/^- (Requirement|Evidence|Generator|Hash|Updated):\s*(.*)$/);
        if (!field)
            continue;
        const [, key, value] = field;
        const text = value.trim();
        if (key === 'Requirement')
            current.requirement = text;
        else if (key === 'Evidence')
            current.evidence = text;
        else if (key === 'Generator')
            current.generator = text;
        else if (key === 'Hash')
            current.hash = text && text !== 'pending' ? text : null;
        else if (key === 'Updated')
            current.updatedAt = text;
    }
    flush();
    return records;
};
/**
 * Insert or replace the record for `record.target`, so the repair log keeps exactly one truth per
 * artifact instead of growing a new entry every run.
 */
export const upsertRepairRecord = (markdown, record) => {
    const block = renderRepairRecord(record).split('\n');
    const lines = markdown.split('\n');
    const sectionStart = lines.findIndex((line) => /^##\s+repairs\s*$/i.test(line.trim()));
    if (sectionStart < 0) {
        const text = markdown.endsWith('\n') ? markdown : `${markdown}\n`;
        return `${text}\n${REPAIRS_SECTION}\n\n${block.join('\n')}\n`;
    }
    let sectionEnd = lines.length;
    for (let i = sectionStart + 1; i < lines.length; i += 1) {
        if (/^##\s/.test(lines[i])) {
            sectionEnd = i;
            break;
        }
    }
    let recordStart = -1;
    let recordEnd = -1;
    for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
        const heading = lines[i].match(/^###\s+(.*)$/);
        if (!heading)
            continue;
        if (recordStart >= 0) {
            recordEnd = i;
            break;
        }
        if (heading[1].trim() === record.target.trim())
            recordStart = i;
    }
    if (recordStart >= 0 && recordEnd < 0) {
        recordEnd = sectionEnd;
        while (recordEnd > recordStart + 1 && lines[recordEnd - 1].trim() === '')
            recordEnd -= 1;
    }
    if (recordStart >= 0) {
        lines.splice(recordStart, recordEnd - recordStart, ...block);
        return lines.join('\n');
    }
    let insertAt = sectionEnd;
    while (insertAt > sectionStart + 1 && lines[insertAt - 1].trim() === '')
        insertAt -= 1;
    lines.splice(insertAt, 0, '', ...block);
    return lines.join('\n');
};
const posixRelative = (cwd, absolute) => path.relative(cwd, absolute).split(path.sep).join('/');
const sha256 = (content) => `sha256:${createHash('sha256').update(content).digest('hex')}`;
const defaultHashFile = async (absolutePath) => {
    try {
        return sha256(await readFile(absolutePath));
    }
    catch {
        return null;
    }
};
/**
 * `shell: true` so the declared command runs on every OS without a POSIX-shell dependency, the same
 * portability rule the commit gate follows.
 */
const defaultRunGenerator = (command, cwd) => new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (code) => {
        if (settled)
            return;
        settled = true;
        resolve({ code, stdout, stderr });
    };
    const child = spawn(command, { cwd, shell: true });
    child.stdout?.on('data', (chunk) => {
        stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
    });
    child.on('error', (error) => {
        stderr += String(error);
        done(1);
    });
    child.on('close', (code) => done(code ?? 1));
});
const readIfExists = async (file) => readFile(file, 'utf8').catch(() => null);
/**
 * The operable spec-as-source repair loop.
 *
 * Order matters and is the point of the module: authority → record the intended repair in the spec →
 * regenerate → reconcile the hash. Each refusal carries its reason, and no run claims a repair that
 * did not change a file.
 */
export const repairFromSpec = async (input) => {
    const cwd = path.resolve(input.cwd);
    const feature = input.feature;
    const target = input.target.replace(/\\/g, '/');
    const write = input.write === true;
    const sddDir = input.sddDir ?? (await resolveSddDir(cwd));
    const hashFile = input.hashFile ?? defaultHashFile;
    const runGenerator = input.runGenerator ?? defaultRunGenerator;
    const specDir = path.join(cwd, sddDir, 'specs', feature);
    const specFile = path.join(specDir, 'requirements.md');
    const specFileRel = posixRelative(cwd, specFile);
    const refusals = [];
    // ── (a) La spec manda ───────────────────────────────────────────────────────────────────────
    let level = 'spec-first';
    let levelKnown = false;
    try {
        level = (await loadRigorSettings(cwd, sddDir)).level;
        levelKnown = true;
    }
    catch (error) {
        refusals.push(`No se pudo leer el nivel de rigor declarado (${error.message}): no se repara a ciegas.`);
    }
    if (levelKnown && level !== 'spec-as-source') {
        refusals.push(`El nivel declarado es ${level} y la reparación desde la spec exige spec-as-source, donde la spec ES la fuente y la regeneración es el mecanismo de reparación. Declara "level": "spec-as-source" en ${RIGOR_SETTINGS_FILE} (con su rationale) o repara el código a mano.`);
    }
    const constitutionPath = constitutionArtifactPaths(cwd, sddDir).inForce;
    const constitutionRaw = await readIfExists(constitutionPath);
    if (constitutionRaw === null) {
        refusals.push(`La constitución no está en vigor (no existe ${posixRelative(cwd, constitutionPath)}): sin autoridad citable la reparación no tiene regla que la gobierne, así que se rechaza en lugar de ejecutarse.`);
    }
    else if (principlesInForce(parseConstitution(constitutionRaw)).length === 0) {
        refusals.push('La constitución existe pero no tiene principios en vigor: no hay autoridad que la reparación pueda citar.');
    }
    const specDirExists = (await stat(specDir).catch(() => null))?.isDirectory() === true;
    if (!specDirExists) {
        refusals.push(`No existe la spec de "${feature}" (${posixRelative(cwd, specDir)}): la reparación se registra primero EN la spec, así que sin spec no hay dónde registrarla.`);
    }
    if (refusals.length > 0) {
        return {
            feature,
            target,
            level,
            status: 'refused',
            operable: false,
            recorded: false,
            regenerated: false,
            drift: false,
            matches: false,
            recordedHash: null,
            beforeHash: null,
            afterHash: null,
            specFile: specFileRel,
            refusals,
            detail: `Reparación rechazada: ${refusals.join(' ')}`,
        };
    }
    // ── Estado: hashes y registro previo ────────────────────────────────────────────────────────
    const absoluteTarget = path.resolve(cwd, input.target);
    const beforeHash = await hashFile(absoluteTarget);
    const specRaw = (await readIfExists(specFile)) ?? `# Requirements — ${feature}\n`;
    const prior = parseRepairRecords(specRaw).find((record) => record.target === target) ?? null;
    let recordedHash = prior?.hash ?? null;
    const drift = recordedHash !== null && recordedHash !== beforeHash;
    const generator = input.command?.trim();
    if (!generator) {
        refusals.push(`No hay generador declarado para ${target}: en spec-as-source la regeneración es el mecanismo de reparación, así que sin comando declarado la reparación se rechaza en vez de afirmarse. Declara el comando del generador (input.command / --command "<comando>") para que sea auditable.`);
    }
    // ── Sin --write: plan, nunca una escritura ──────────────────────────────────────────────────
    if (!write) {
        const planned = `Plan de reparación (nada escrito): nivel ${level}, ${target}${recordedHash ? ` con hash registrado ${recordedHash}` : ' sin hash registrado todavía'}${drift ? ', en DERIVA respecto al hash registrado' : ''}.`;
        return {
            feature,
            target,
            level,
            status: refusals.length > 0 ? 'refused' : 'planned',
            operable: refusals.length === 0,
            recorded: false,
            regenerated: false,
            drift,
            matches: beforeHash !== null && recordedHash !== null && beforeHash === recordedHash,
            recordedHash,
            beforeHash,
            afterHash: null,
            specFile: specFileRel,
            refusals,
            detail: refusals.length > 0
                ? `${planned} ${refusals.join(' ')}`
                : `${planned} Añade write para registrar la reparación en la spec y regenerar.`,
        };
    }
    // ── (b) Registrar la reparación en la spec ANTES de regenerar ───────────────────────────────
    let currentSpec = specRaw;
    try {
        currentSpec = upsertRepairRecord(currentSpec, {
            target,
            ...(input.requirement ? { requirement: input.requirement } : {}),
            ...(input.evidence ? { evidence: input.evidence } : {}),
            ...(generator ? { generator } : {}),
            hash: recordedHash,
            updatedAt: new Date().toISOString(),
        });
        await mkdir(specDir, { recursive: true });
        await writeFile(specFile, currentSpec, 'utf8');
    }
    catch (error) {
        refusals.push(`No se pudo registrar la reparación en ${specFileRel} (${error.message}).`);
        return {
            feature,
            target,
            level,
            status: 'refused',
            operable: false,
            recorded: false,
            regenerated: false,
            drift,
            matches: false,
            recordedHash,
            beforeHash,
            afterHash: null,
            specFile: specFileRel,
            refusals,
            detail: `Reparación rechazada antes de regenerar: ${refusals.join(' ')}`,
        };
    }
    const recorded = true;
    // Sin generador: la reparación queda REGISTRADA (intención auditable) pero NO ejecutada.
    if (!generator) {
        return {
            feature,
            target,
            level,
            status: 'refused',
            operable: false,
            recorded,
            regenerated: false,
            drift,
            matches: false,
            recordedHash,
            beforeHash,
            afterHash: null,
            specFile: specFileRel,
            refusals,
            detail: `Reparación registrada en ${specFileRel} pero NO ejecutada: ${refusals.join(' ')}`,
        };
    }
    // ── (c) Regenerar con el comando declarado ──────────────────────────────────────────────────
    const run = await runGenerator(generator, cwd);
    const afterHash = await hashFile(absoluteTarget);
    const regenerated = afterHash !== null && afterHash !== beforeHash;
    if (run.code !== 0) {
        refusals.push(`El generador "${generator}" terminó con código ${run.code}: la regeneración no se completó${run.stderr.trim() ? ` (${run.stderr.trim().split('\n')[0]})` : ''}.`);
    }
    // ── (d) Reconciliar y reportar deriva ───────────────────────────────────────────────────────
    const matches = afterHash !== null && recordedHash !== null && afterHash === recordedHash;
    if (regenerated && afterHash !== null && run.code === 0) {
        // El artefacto cambió: la spec fija el hash reconciliado como su verdad para este target.
        try {
            currentSpec = upsertRepairRecord(currentSpec, {
                target,
                ...(input.requirement ? { requirement: input.requirement } : {}),
                ...(input.evidence ? { evidence: input.evidence } : {}),
                generator,
                hash: afterHash,
                updatedAt: new Date().toISOString(),
            });
            await writeFile(specFile, currentSpec, 'utf8');
            recordedHash = afterHash;
        }
        catch (error) {
            refusals.push(`El artefacto se regeneró pero no se pudo fijar su hash en ${specFileRel} (${error.message}): la spec queda sin la verdad reconciliada.`);
        }
        const resolved = afterHash === recordedHash;
        return {
            feature,
            target,
            level,
            status: resolved && run.code === 0 ? 'in-sync' : 'drift',
            operable: resolved,
            recorded,
            regenerated: true,
            drift,
            matches: resolved,
            recordedHash,
            beforeHash,
            afterHash,
            specFile: specFileRel,
            refusals,
            detail: `${drift ? 'Deriva detectada y resuelta por regeneración' : 'Reparación regenerada'}: ${target} cambió (${beforeHash ?? 'ausente'} → ${afterHash}). ${resolved ? `El hash registrado en ${specFileRel} coincide con el artefacto.` : refusals.join(' ')}`,
        };
    }
    // No cambió ningún fichero: no se declara reparación, se informa la deriva.
    return {
        feature,
        target,
        level,
        status: matches ? 'in-sync' : 'drift',
        operable: matches,
        recorded,
        regenerated: false,
        drift,
        matches,
        recordedHash,
        beforeHash,
        afterHash,
        specFile: specFileRel,
        refusals,
        detail: matches
            ? `El artefacto ${target} ya coincidía con el hash registrado en ${specFileRel}: no había nada que reparar y no se declara reparación (ningún fichero cambió).`
            : `Sin reparación: ningún fichero cambió (hash ${afterHash ?? 'ausente'}${recordedHash ? `, registrado ${recordedHash}` : ', sin hash registrado'}), así que no se puede afirmar que la reparación ocurrió.${refusals.length > 0 ? ` ${refusals.join(' ')}` : ''}`,
    };
};
