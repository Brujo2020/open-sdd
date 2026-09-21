/**
 * Render determinista de `rules/*.md` desde el catálogo de estándares (REQ-STD-002).
 *
 * Una regla y su prosa que pueden discrepar acaban discrepando: `COMPARE.md` es el precedente. Por
 * eso la prosa se GENERA desde el catálogo y `detectDrift` compara el render con lo que hay en disco,
 * nombrando las entradas que no coinciden. El catálogo es la fuente de verdad; el markdown es salida.
 *
 * Este módulo NO escribe nada por su cuenta: `renderRules` es puro y `detectDrift` solo lee. Quien
 * quiera materializar el render llama a `writeRules` explícitamente (el orquestador decide si los
 * `rules/*.md` reales pasan a forma generada; esta tarea solo reporta la deriva).
 *
 * ── Atribución de la deriva ─────────────────────────────────────────────────────────────────────
 * Cada entrada se renderiza dentro de un bloque delimitado por marcadores con su id
 * (`<!-- standards:REQ-EARS-001:begin -->` … `:end`). Así `detectDrift` puede afirmar QUÉ entrada
 * discrepa y no solo que el fichero cambió: un `rules/*.md` editado a mano nombra las entradas cuya
 * prosa ya no está.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isBlocking } from './standards.js';
export const RENDER_MARKER = 'GENERATED from .sdd/settings/standards by tools/open-sdd/src/core/standardsRender.ts; edit the catalogue entry, not this file';
const normalize = (value) => value.replace(/^\.\//, '').split('\\').join('/');
/**
 * Fichero de regla que cita una entrada. `null` cuando la fuente es una URL o no es un documento
 * markdown: una entrada que cita un estándar externo no tiene prosa que generar aquí.
 */
export const ruleFileOf = (source) => {
    const trimmed = source.trim();
    if (trimmed.length === 0)
        return null;
    if (/^(?:https?:)?\/\//i.test(trimmed))
        return null;
    const withoutAnchor = trimmed.split('#')[0];
    if (!withoutAnchor.endsWith('.md'))
        return null;
    return normalize(withoutAnchor);
};
const fileTitle = (file) => {
    const base = path.posix.basename(file, '.md').replace(/[-_]+/g, ' ').trim();
    if (base.length === 0)
        return 'Standards';
    return `${base.charAt(0).toUpperCase()}${base.slice(1)}`;
};
const beginMarker = (id) => `<!-- standards:${id}:begin -->`;
const endMarker = (id) => `<!-- standards:${id}:end -->`;
const bullet = (label, value) => `- **${label}:** ${value}`;
/**
 * Bloque determinista de UNA entrada. Es la unidad que `detectDrift` busca en disco, así que su
 * texto no depende de nada más que la entrada.
 */
export const renderEntryBlock = (entry) => {
    const lines = [];
    lines.push(beginMarker(entry.id));
    lines.push(`## ${entry.id} — ${entry.title}`);
    lines.push('');
    lines.push(bullet('Category', `\`${entry.category}\``));
    lines.push(bullet('Severity', `\`${entry.severity}\` (${isBlocking(entry) ? 'blocking, corpus measured' : 'advisory until a measured corpus exists'})`));
    lines.push(bullet('Applies to', entry.appliesTo.map((p) => `\`${p}\``).join(', ')));
    lines.push(bullet('Standard', entry.standard));
    lines.push(bullet('Source', `\`${entry.source}\``));
    const patterns = entry.detect.patterns ?? [];
    const detection = patterns.length > 0
        ? `\`${entry.detect.kind}\` — ${patterns.map((p) => `\`${p}\``).join(', ')}`
        : `\`${entry.detect.kind}\``;
    lines.push(bullet('Detection', detection));
    lines.push(bullet('Message', entry.message));
    lines.push(bullet('Evidence', `\`${entry.evidence}\``));
    const corpus = entry.calibrated.corpus;
    lines.push(bullet('Calibration', typeof corpus === 'string' && corpus.length > 0
        ? `corpus \`${corpus}\`, recall ${entry.calibrated.recall}, fpr ${entry.calibrated.fpr}`
        : 'not measured'));
    if (entry.remedy.grades.length === 0) {
        lines.push(bullet('Remedies', 'none — this standard asks for the missing datum instead of prescribing'));
    }
    else {
        lines.push('- **Remedies:**');
        for (const remedy of entry.remedy.grades) {
            const note = remedy.note === undefined ? '' : ` — ${remedy.note}`;
            lines.push(`  - \`${remedy.grade}\` — ${remedy.text}${note}`);
        }
    }
    lines.push(endMarker(entry.id));
    return lines.join('\n');
};
const entriesByFile = (entries) => {
    const grouped = new Map();
    for (const entry of entries) {
        const file = ruleFileOf(entry.source);
        if (file === null)
            continue;
        const list = grouped.get(file) ?? [];
        list.push(entry);
        grouped.set(file, list);
    }
    for (const list of grouped.values())
        list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return grouped;
};
/**
 * Renderiza un documento por cada fichero de regla citado por el catálogo. Orden determinista:
 * ficheros por ruta y entradas por id. Dos ejecuciones sobre el mismo catálogo producen el mismo
 * texto, byte a byte.
 */
export const renderRules = (entries) => {
    const grouped = entriesByFile(entries);
    const files = [...grouped.keys()].sort();
    return files.map((file) => {
        const blocks = (grouped.get(file) ?? []).map(renderEntryBlock);
        const header = [
            `<!-- ${RENDER_MARKER} -->`,
            '',
            `# ${fileTitle(file)}`,
            '',
            `> Rendered from the standards catalogue (\`.sdd/settings/standards\`); the catalogue is the source of truth.`,
            '',
            '## Standards',
            '',
        ].join('\n');
        return { file, content: `${header}${blocks.join('\n\n')}\n` };
    });
};
const readIfPresent = async (abs) => {
    try {
        return await readFile(abs, 'utf8');
    }
    catch {
        return null;
    }
};
/**
 * Deriva entre el catálogo y los `rules/*.md` en disco. Un fichero ausente se reporta como `missing`
 * con todas sus entradas; un fichero distinto se reporta como `differs` nombrando las entradas cuyo
 * bloque no aparece. Nunca lanza: un fichero ilegible cuenta como ausente.
 */
export const detectDrift = async (cwd, entries) => {
    const rendered = renderRules(entries);
    const grouped = entriesByFile(entries);
    const drifts = [];
    for (const rule of rendered) {
        const allIds = (grouped.get(rule.file) ?? []).map((entry) => entry.id);
        const onDisk = await readIfPresent(path.resolve(cwd, rule.file));
        if (onDisk === null) {
            drifts.push({ file: rule.file, reason: 'missing', entries: allIds });
            continue;
        }
        if (onDisk.trim() === rule.content.trim())
            continue;
        const disagreeing = (grouped.get(rule.file) ?? [])
            .filter((entry) => !onDisk.includes(renderEntryBlock(entry)))
            .map((entry) => entry.id);
        drifts.push({ file: rule.file, reason: 'differs', entries: disagreeing.length > 0 ? disagreeing : allIds });
    }
    return drifts;
};
/**
 * Materializa el render en disco. Es explícito y separado de `detectDrift` para que la deriva se
 * pueda REPORTAR sin sobrescribir los `rules/*.md` existentes. Devuelve las rutas escritas.
 */
export const writeRules = async (cwd, entries) => {
    const written = [];
    for (const rule of renderRules(entries)) {
        const abs = path.resolve(cwd, rule.file);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, rule.content, 'utf8');
        written.push(rule.file);
    }
    return written;
};
