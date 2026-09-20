/**
 * El respaldo restaurable: una copia completa de `.sdd/` con un manifiesto que se puede comprobar.
 *
 * ── Para quién es esto (y en qué se diferencia del bundle de auditoría) ──────────────────────────
 * `audit bundle` (`src/cli/commands/audit.ts`) produce evidencia para un TERCERO: qué decidió el
 * tool, con qué autoridad y con un sha256 por artefacto, para que un auditor recompute. Esto es lo
 * contrario y es complementario: un respaldo es para TI. No demuestra cumplimiento; devuelve tu
 * trabajo. Por eso copia el árbol ENTERO de `.sdd/` —settings, specs, steering con la constitución y
 * los libros de estado— en vez de un conjunto seleccionado de artefactos, y por eso la restauración
 * es una operación de primera clase y no una nota al pie.
 *
 * ── La forma: un directorio, no un tarball ──────────────────────────────────────────────────────
 * `<out>/manifest.json` + `<out>/files/…` (el árbol de `.sdd/` espejado). Se eligió directorio a
 * propósito: (a) se verifica y se restaura sin descomprimir nada, con las mismas primitivas del
 * sistema; (b) un `sha256` por fichero es trivial de recomputar; (c) un respaldo a medias es visible
 * —falta el fichero, no un tar truncado que parece íntegro—; y (d) `restore --only` puede traer un
 * solo fichero sin tocar el resto. El precio es más inodos; para `.sdd/` (unos miles de ficheros de
 * texto) no es un precio. La justificación completa vive en `docs/guides/progress-and-backup.md`.
 *
 * ── Lo que NUNCA entra ──────────────────────────────────────────────────────────────────────────
 *   · `node_modules`, `dist`, `.git`: son reproducibles o ya están versionados; copiarlos multiplica
 *     el tamaño y esconde la única pregunta que importa (¿está mi estado de gobernanza?).
 *   · ficheros con forma de credencial (`.npmrc`, `.env*`, `.netrc`, `.git-credentials`, claves
 *     privadas `id_rsa`/`id_ed25519`…): se OMITEN y se NOMBRAN en `manifest.detail`. Un respaldo que
 *     guarda un token en texto plano no es un respaldo, es una fuga con fecha.
 *   · enlaces simbólicos: no se siguen (podrían salirse del árbol o copiar contenido ajeno) y se
 *     nombran en `detail`.
 *   · el propio directorio de respaldos (`<sdd>/backups/`) y el directorio de salida: de lo contrario
 *     cada respaldo incluiría al anterior.
 *
 * ── Las tres operaciones y sus contratos ────────────────────────────────────────────────────────
 *   `createBackup`  escribe el árbol + el manifiesto (atómico por fichero; el manifiesto va último,
 *                   así que un manifiesto presente implica carga completa). Se niega a escribir
 *                   sobre un directorio existente sin `force`.
 *   `verifyBackup`  recomputa TODOS los hashes y reporta cada discrepancia y cada ausencia. Un
 *                   respaldo que no supera su propio manifiesto NUNCA se declara bueno.
 *   `restoreBackup` NUNCA sobrescribe en silencio. Fichero a fichero: `restored` o `skipped` con
 *                   motivo (idéntico, difiere, más reciente en disco, ausente, hash que no cuadra) y
 *                   una RUTA QUE ESCAPA DE LA RAÍZ ES UN RECHAZO, no una restauración. Sin `write`
 *                   solo se informa de lo que se haría.
 *
 * Solo biblioteca estándar. Nunca lanza por un fichero ilegible: lo declara.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getCurrentBranch, hasUncommittedChanges, isGitRepo } from './git.js';
import { resolveSddDir } from './specManager.js';
export const BACKUP_SCHEMA = 'open-sdd.backup/1';
export const BACKUP_MANIFEST_FILE = 'manifest.json';
/** Subdirectorio del respaldo donde vive el árbol espejado; la raíz de restauración es ESTA. */
export const BACKUP_PAYLOAD_DIR = 'files';
/** Subdirectorio de `.sdd/` donde caen los respaldos por defecto. */
export const BACKUP_BACKUPS_DIR = 'backups';
/** Directorios que jamás se copian, en cualquier profundidad. */
export const BACKUP_EXCLUDED_DIRS = ['node_modules', 'dist', '.git'];
/** Nombres con forma de credencial: se omiten y se nombran, nunca se copian. */
export const BACKUP_CREDENTIAL_PATTERNS = [
    /^\.npmrc$/,
    /^\.env(\..+)?$/,
    /^\.netrc$/,
    /^\.git-credentials$/,
    /^id_(rsa|dsa|ecdsa|ed25519)$/,
];
/** Motivos estables de omisión en una restauración. */
export const RESTORE_SKIP_REASONS = {
    escapesBackupRoot: 'escapa de la raíz del respaldo',
    outsideAllowedRoot: 'fuera de la raíz permitida',
    absentInBackup: 'ausente en el respaldo',
    hashMismatch: 'no coincide con el manifiesto (hash)',
    existsAndDiffers: 'existe y difiere',
    newerOnDisk: 'más reciente en disco',
    alreadyIdentical: 'ya idéntico',
    notAFile: 'existe y no es un fichero',
};
const sha256 = (content) => createHash('sha256').update(content).digest('hex');
const toPosix = (value) => value.split(path.sep).join('/');
/** `2026-09-19T21-18-29-493Z` — seguro para el sistema de ficheros y ordenable. */
const backupTimestamp = (date) => date.toISOString().replace(/[:.]/g, '-');
/**
 * Versión del tool que produjo el respaldo. Misma resolución que `audit bundle` (no se importa de
 * `src/cli/` para no invertir las capas): el paquete instalado lee el manifiesto raíz cinco niveles
 * arriba, un checkout lo lee tres. Devolver `dev` antes que un número equivocado es deliberado.
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
            // siguiente candidato
        }
    }
    return 'dev';
};
/** ¿`child` está dentro de `parent` (o es `parent`)? Comparación por ruta resuelta. */
const isInside = (child, parent) => {
    const c = path.resolve(child);
    const p = path.resolve(parent);
    return c === p || c.startsWith(p + path.sep);
};
/**
 * Une una ruta relativa POSIX a una raíz sin permitir que se salga de ella. Devuelve `null` cuando
 * la ruta es absoluta, contiene `..` o, tras resolverla, cae fuera: esa es la base del RECHAZO.
 */
const safeJoin = (root, rel) => {
    if (typeof rel !== 'string' || rel.length === 0)
        return null;
    if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel))
        return null;
    const normalized = path.normalize(rel).split(path.sep).join('/');
    if (normalized === '..' || normalized.startsWith('../'))
        return null;
    const abs = path.resolve(root, ...normalized.split('/'));
    const rootAbs = path.resolve(root);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep))
        return null;
    return abs;
};
const isCredential = (name) => BACKUP_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(name));
/**
 * Recorrer la raíz respaldada. Solo lectura. Determinista (orden alfabético) para que dos respaldos
 * del mismo estado produzcan el mismo manifiesto salvo timestamps.
 */
const walkSource = async (baseAbs, opts) => {
    const acc = { files: [], credentials: [], symlinks: [], excludedDirs: [], unreadable: [] };
    const visit = async (rel) => {
        const dirAbs = rel.length === 0 ? baseAbs : path.join(baseAbs, ...rel.split('/'));
        let entries;
        try {
            entries = await readdir(dirAbs, { withFileTypes: true });
        }
        catch (err) {
            acc.unreadable.push(`${rel || '.'} (${err.message})`);
            return;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const childRel = rel.length === 0 ? entry.name : `${rel}/${entry.name}`;
            const childAbs = path.join(dirAbs, entry.name);
            if (entry.isSymbolicLink()) {
                acc.symlinks.push(childRel);
                continue;
            }
            if (entry.isDirectory()) {
                if (BACKUP_EXCLUDED_DIRS.includes(entry.name)) {
                    acc.excludedDirs.push(childRel);
                    continue;
                }
                // El directorio de respaldos y la salida elegida no se respaldan a sí mismos.
                if (isInside(childAbs, opts.backupsAbs) || isInside(childAbs, opts.outAbs))
                    continue;
                await visit(childRel);
                continue;
            }
            if (!entry.isFile())
                continue;
            if (isInside(childAbs, opts.outAbs))
                continue;
            if (isCredential(entry.name)) {
                acc.credentials.push(childRel);
                continue;
            }
            try {
                const content = await readFile(childAbs);
                acc.files.push({ path: childRel, abs: childAbs, content, bytes: content.byteLength, sha256: sha256(content) });
            }
            catch (err) {
                acc.unreadable.push(`${childRel} (${err.message})`);
            }
        }
    };
    await visit('');
    return acc;
};
const gitInfo = (cwd) => {
    if (!isGitRepo(cwd))
        return { branch: null, commit: null, dirty: false };
    let commit = null;
    try {
        const out = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        commit = out.length > 0 ? out : null;
    }
    catch {
        commit = null;
    }
    return { branch: getCurrentBranch(cwd) ?? null, commit, dirty: hasUncommittedChanges(cwd) };
};
const describeSkips = (walked) => {
    const parts = [];
    if (walked.credentials.length > 0) {
        parts.push(`OMITIDOS por forma de credencial (no se guarda ningún token): ${walked.credentials.join(', ')}`);
    }
    if (walked.symlinks.length > 0) {
        parts.push(`enlaces simbólicos no seguidos: ${walked.symlinks.join(', ')}`);
    }
    if (walked.excludedDirs.length > 0) {
        parts.push(`directorios excluidos (reproducibles o ya versionados): ${[...new Set(walked.excludedDirs)].sort().join(', ')}`);
    }
    if (walked.unreadable.length > 0) {
        parts.push(`ilegibles y por tanto NO respaldados: ${walked.unreadable.join(', ')}`);
    }
    return parts.join(' · ');
};
const emptyManifest = (root, createdAt, detail) => ({
    schema: BACKUP_SCHEMA,
    createdAt,
    tool: 'open-sdd',
    version: readToolVersion(),
    root,
    files: [],
    counts: { files: 0, bytes: 0 },
    git: { branch: null, commit: null, dirty: false },
    detail,
});
/**
 * Crear el respaldo. Copia el árbol entero de `.sdd/` (menos las exclusiones declaradas arriba) y
 * escribe `manifest.json` con un sha256 por fichero, los recuentos reales y el estado de git.
 *
 * Nunca lanza por contenido ilegible: lo declara en `detail`. Se niega a escribir sobre un
 * directorio existente salvo `force` (y con `force` lo reemplaza entero, para que no queden ficheros
 * viejos mezclados con los nuevos).
 */
export const createBackup = async (input) => {
    const cwd = path.resolve(input.cwd);
    const sddDir = input.sddDir ?? (await resolveSddDir(cwd));
    const sddAbs = path.resolve(cwd, sddDir);
    const root = toPosix(path.isAbsolute(sddDir) ? path.relative(cwd, sddAbs) : sddDir);
    const now = new Date();
    const createdAt = now.toISOString();
    const outAbs = input.out
        ? path.resolve(cwd, input.out)
        : path.join(sddAbs, BACKUP_BACKUPS_DIR, backupTimestamp(now));
    const backupsAbs = path.join(sddAbs, BACKUP_BACKUPS_DIR);
    let sddStat;
    try {
        sddStat = await stat(sddAbs);
    }
    catch {
        sddStat = null;
    }
    if (!sddStat || !sddStat.isDirectory()) {
        return {
            path: outAbs,
            manifest: emptyManifest(root, createdAt, `No hay nada que respaldar: ${root}/ no existe en ${cwd}.`),
            written: false,
            detail: `No hay nada que respaldar: ${root}/ no existe en ${cwd}. Un respaldo sin estado de gobernanza no protege nada.`,
        };
    }
    const walked = await walkSource(sddAbs, { outAbs, backupsAbs });
    const totalBytes = walked.files.reduce((sum, file) => sum + file.bytes, 0);
    const skipDetail = describeSkips(walked);
    const manifest = {
        schema: BACKUP_SCHEMA,
        createdAt,
        tool: 'open-sdd',
        version: readToolVersion(),
        root,
        files: walked.files.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 })),
        counts: { files: walked.files.length, bytes: totalBytes },
        git: gitInfo(cwd),
        detail: `Respaldo de ${root}/ con ${walked.files.length} fichero(s) y ${totalBytes} byte(s).` +
            (skipDetail.length > 0 ? ` ${skipDetail}.` : ''),
    };
    let exists = false;
    try {
        await stat(outAbs);
        exists = true;
    }
    catch {
        exists = false;
    }
    if (exists && !input.force) {
        return {
            path: outAbs,
            manifest,
            written: false,
            detail: `El destino ${outAbs} ya existe: no se sobrescribe un respaldo sin --force. El manifiesto describe lo que se habría guardado (${manifest.counts.files} fichero(s)).`,
        };
    }
    if (exists)
        await rm(outAbs, { recursive: true, force: true });
    try {
        const payloadAbs = path.join(outAbs, BACKUP_PAYLOAD_DIR);
        for (const file of walked.files) {
            const dest = path.join(payloadAbs, ...file.path.split('/'));
            await mkdir(path.dirname(dest), { recursive: true });
            await writeFile(dest, file.content);
        }
        // El manifiesto va ÚLTIMO: si existe, la carga se escribió entera.
        await mkdir(outAbs, { recursive: true });
        await writeFile(path.join(outAbs, BACKUP_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    }
    catch (err) {
        return {
            path: outAbs,
            manifest,
            written: false,
            detail: `El respaldo no se pudo escribir en ${outAbs} (${err.message}): no hay respaldo que verificar.`,
        };
    }
    return {
        path: outAbs,
        manifest,
        written: true,
        detail: `Respaldo escrito en ${outAbs}: ${manifest.counts.files} fichero(s), ${manifest.counts.bytes} byte(s), sha256 por fichero${skipDetail.length > 0 ? ` · ${skipDetail}` : ''}.`,
    };
};
const readManifest = async (archiveAbs) => {
    const manifestPath = path.join(archiveAbs, BACKUP_MANIFEST_FILE);
    let raw;
    try {
        raw = await readFile(manifestPath, 'utf8');
    }
    catch (err) {
        return { manifest: null, detail: `El respaldo ${archiveAbs} no tiene ${BACKUP_MANIFEST_FILE} legible (${err.message}): sin manifiesto no hay nada que comprobar.` };
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        return { manifest: null, detail: `El manifiesto de ${archiveAbs} no es JSON válido (${err.message}).` };
    }
    const candidate = parsed;
    if (!candidate ||
        typeof candidate !== 'object' ||
        typeof candidate.root !== 'string' ||
        !Array.isArray(candidate.files) ||
        !candidate.counts ||
        typeof candidate.counts.files !== 'number' ||
        typeof candidate.counts.bytes !== 'number') {
        return { manifest: null, detail: `El manifiesto de ${archiveAbs} no tiene la forma esperada (schema, root, files, counts).` };
    }
    const files = [];
    for (const entry of candidate.files) {
        const file = entry;
        if (!file || typeof file.path !== 'string' || typeof file.bytes !== 'number' || typeof file.sha256 !== 'string') {
            return { manifest: null, detail: `El manifiesto de ${archiveAbs} declara un fichero sin path/bytes/sha256.` };
        }
        files.push({ path: file.path, bytes: file.bytes, sha256: file.sha256 });
    }
    return {
        manifest: {
            schema: typeof candidate.schema === 'string' ? candidate.schema : BACKUP_SCHEMA,
            createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : '',
            tool: typeof candidate.tool === 'string' ? candidate.tool : 'open-sdd',
            version: typeof candidate.version === 'string' ? candidate.version : 'dev',
            root: candidate.root,
            files,
            counts: { files: candidate.counts.files, bytes: candidate.counts.bytes },
            git: candidate.git ?? { branch: null, commit: null, dirty: false },
            detail: typeof candidate.detail === 'string' ? candidate.detail : '',
        },
        detail: `Manifiesto leído de ${archiveAbs}.`,
    };
};
/** Lista de ficheros regulares (POSIX, ordenada) bajo una raíz; no sigue enlaces simbólicos. */
const listRelativeFiles = async (baseAbs) => {
    const found = [];
    const visit = async (rel) => {
        const dirAbs = rel.length === 0 ? baseAbs : path.join(baseAbs, ...rel.split('/'));
        let entries;
        try {
            entries = await readdir(dirAbs, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const childRel = rel.length === 0 ? entry.name : `${rel}/${entry.name}`;
            if (entry.isSymbolicLink())
                continue;
            if (entry.isDirectory()) {
                await visit(childRel);
                continue;
            }
            if (entry.isFile())
                found.push(childRel);
        }
    };
    await visit('');
    return found.sort();
};
/**
 * Comprobar un respaldo contra su propio manifiesto. Recomputa TODOS los sha256 y reporta cada
 * discrepancia (`mismatches`) y cada fichero ausente (`missing`). Un solo fallo → `ok: false`:
 * un archivo que no supera su propio manifiesto jamás se declara bueno. Los ficheros presentes en la
 * carga pero no declarados se cuentan en `detail` (no invalidan, porque restaurar solo toca lo
 * declarado, pero se dicen).
 */
export const verifyBackup = async (input) => {
    const archiveAbs = path.resolve(input.cwd, input.archive);
    const read = await readManifest(archiveAbs);
    if (!read.manifest) {
        return { ok: false, mismatches: [], missing: [], manifest: null, detail: read.detail };
    }
    const manifest = read.manifest;
    const payloadAbs = path.join(archiveAbs, BACKUP_PAYLOAD_DIR);
    const mismatches = [];
    const missing = [];
    for (const file of manifest.files) {
        const source = safeJoin(payloadAbs, file.path);
        if (!source) {
            // Una ruta que escapa de la raíz del respaldo no es un fichero que verificar: es un rechazo.
            mismatches.push({ path: file.path, expected: file.sha256, actual: null });
            continue;
        }
        let content;
        try {
            content = await readFile(source);
        }
        catch {
            missing.push(file.path);
            continue;
        }
        const actual = sha256(content);
        if (actual !== file.sha256)
            mismatches.push({ path: file.path, expected: file.sha256, actual });
    }
    const declared = new Set(manifest.files.map((file) => file.path));
    const onDisk = await listRelativeFiles(payloadAbs);
    const extras = onDisk.filter((rel) => !declared.has(rel));
    const countsMatch = manifest.counts.files === manifest.files.length &&
        manifest.counts.bytes === manifest.files.reduce((sum, file) => sum + file.bytes, 0);
    const ok = mismatches.length === 0 && missing.length === 0;
    const problems = [];
    if (mismatches.length > 0)
        problems.push(`${mismatches.length} fichero(s) con hash que NO coincide con el manifiesto`);
    if (missing.length > 0)
        problems.push(`${missing.length} fichero(s) declarados y ausentes`);
    if (!countsMatch)
        problems.push('los recuentos del manifiesto no cuadran con su propia lista de ficheros');
    if (extras.length > 0)
        problems.push(`${extras.length} fichero(s) en la carga no declarados en el manifiesto: ${extras.slice(0, 5).join(', ')}${extras.length > 5 ? '…' : ''}`);
    return {
        ok,
        mismatches,
        missing,
        manifest,
        detail: ok
            ? `Respaldo íntegro: ${manifest.files.length} fichero(s), ${manifest.counts.bytes} byte(s), todos los sha256 coinciden con el manifiesto${extras.length > 0 ? ` (aviso: ${extras.length} fichero(s) no declarados)` : ''}.`
            : `El respaldo NO supera su propio manifiesto: ${problems.join('; ')}. No se puede tratar como bueno.`,
    };
};
const matchesOnly = (rel, only) => {
    if (!only || only.length === 0)
        return true;
    return only.some((filter) => {
        const normalized = toPosix(path.normalize(filter)).replace(/^\.\//, '').replace(/\/+$/, '');
        return rel === normalized || rel.startsWith(`${normalized}/`);
    });
};
/**
 * Restaurar un respaldo sobre el proyecto. NUNCA sobrescribe en silencio.
 *
 * Por cada fichero declarado: `restored` (escrito, o que se escribiría sin `write`) o `skipped` con
 * un motivo estable. Reglas, en orden:
 *  1. Una ruta que escapa de la raíz del respaldo, o del destino permitido, es un RECHAZO.
 *  2. Un fichero del respaldo cuyo sha256 no cuadra con el manifiesto no se restaura.
 *  3. Un destino idéntico se omite (`ya idéntico`); uno que difiere se omite con `existe y difiere`
 *     o `más reciente en disco` —nunca se pisa trabajo posterior sin decirlo.
 *  4. Sin `write` no se toca el disco: solo se informa de lo que se haría.
 *
 * `only` filtra por ruta exacta o por prefijo de directorio (`state`, `specs/foo`); lo filtrado no
 * aparece en ninguna lista.
 */
export const restoreBackup = async (input) => {
    const cwd = path.resolve(input.cwd);
    const archiveAbs = path.resolve(cwd, input.archive);
    const read = await readManifest(archiveAbs);
    if (!read.manifest)
        return { restored: [], skipped: [], detail: read.detail };
    const manifest = read.manifest;
    const payloadAbs = path.join(archiveAbs, BACKUP_PAYLOAD_DIR);
    const destRoot = safeJoin(cwd, manifest.root);
    if (!destRoot) {
        const skipped = manifest.files.map((file) => ({ path: file.path, reason: RESTORE_SKIP_REASONS.outsideAllowedRoot }));
        return {
            restored: [],
            skipped,
            detail: `RECHAZO: la raíz declarada por el respaldo (${manifest.root}) escapa del proyecto ${cwd}: no se restaura nada.`,
        };
    }
    const restored = [];
    const skipped = [];
    for (const file of manifest.files) {
        if (!matchesOnly(file.path, input.only))
            continue;
        const source = safeJoin(payloadAbs, file.path);
        if (!source) {
            skipped.push({ path: file.path, reason: RESTORE_SKIP_REASONS.escapesBackupRoot });
            continue;
        }
        const dest = safeJoin(destRoot, file.path);
        if (!dest) {
            skipped.push({ path: file.path, reason: RESTORE_SKIP_REASONS.outsideAllowedRoot });
            continue;
        }
        let content;
        try {
            content = await readFile(source);
        }
        catch {
            skipped.push({ path: file.path, reason: RESTORE_SKIP_REASONS.absentInBackup });
            continue;
        }
        if (sha256(content) !== file.sha256) {
            skipped.push({ path: file.path, reason: RESTORE_SKIP_REASONS.hashMismatch });
            continue;
        }
        let destStat;
        try {
            destStat = await stat(dest);
        }
        catch {
            destStat = null;
        }
        if (destStat) {
            if (!destStat.isFile()) {
                skipped.push({ path: file.path, reason: RESTORE_SKIP_REASONS.notAFile });
                continue;
            }
            let current;
            try {
                current = await readFile(dest);
            }
            catch {
                skipped.push({ path: file.path, reason: RESTORE_SKIP_REASONS.existsAndDiffers });
                continue;
            }
            if (sha256(current) === file.sha256) {
                skipped.push({ path: file.path, reason: RESTORE_SKIP_REASONS.alreadyIdentical });
                continue;
            }
            let sourceStat;
            try {
                sourceStat = await stat(source);
            }
            catch {
                sourceStat = null;
            }
            // Un destino MÁS RECIENTE que la copia es trabajo posterior al respaldo: se nombra aparte.
            if (sourceStat && destStat.mtimeMs > sourceStat.mtimeMs) {
                skipped.push({ path: file.path, reason: RESTORE_SKIP_REASONS.newerOnDisk });
                continue;
            }
            skipped.push({ path: file.path, reason: RESTORE_SKIP_REASONS.existsAndDiffers });
            continue;
        }
        if (!input.write) {
            restored.push(file.path);
            continue;
        }
        try {
            await mkdir(path.dirname(dest), { recursive: true });
            await writeFile(dest, content);
            restored.push(file.path);
        }
        catch (err) {
            skipped.push({ path: file.path, reason: `no se pudo escribir (${err.message})` });
        }
    }
    const verb = input.write ? 'Restaurados' : 'Se restaurarían';
    const detail = `${verb} ${restored.length} fichero(s) de ${manifest.counts.files} en ${destRoot}; ${skipped.length} omitido(s)` +
        `${input.write ? '' : ' (simulación: no se escribió nada; usa write para aplicar)'}.` +
        `${skipped.some((entry) => entry.reason === RESTORE_SKIP_REASONS.escapesBackupRoot || entry.reason === RESTORE_SKIP_REASONS.outsideAllowedRoot) ? ' Hubo RECHAZOS por rutas fuera de la raíz permitida: nada de eso se restauró.' : ''}`;
    return { restored, skipped, detail };
};
/** Re-exportado para quien componga o recompute un `manifest.json` (tests, herramientas externas). */
export { sha256 as backupSha256 };
