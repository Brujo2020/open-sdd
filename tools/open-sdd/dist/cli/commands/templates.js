/**
 * `open-sdd templates` — la única puerta que LISTA lo que `init` instala.
 *
 * El camino por defecto de este proyecto son 22 plantillas de comando: workflows que el anfitrión
 * invoca desde el chat, sin MCP y sin red. Existían desde hace tres versiones y estaban probadas,
 * pero solo se descubrían leyendo el plan de `init`, `COMMAND_TEMPLATE_IDS`, el directorio
 * `templates/commands/` o la guía de integraciones. Este comando cierra esa brecha: nombra las 22,
 * dice qué escribe cada una, dónde las lee cada anfitrión y si están instaladas en ESTE repositorio.
 *
 * ── Lo que este comando no hace ─────────────────────────────────────────────────────────────────
 * No escribe nada y no ejecuta la cadena de gates: es la cara de lectura del instalador
 * (`planCommandTemplates`, el mismo módulo que usa `init`, pero sin `--write`). Por eso el recuento
 * que imprime no es una estimación: cada fila viene de la decisión real del instalador, incluida la
 * detección por sha256 de una plantilla editada a mano, que se conserva y se cuenta aparte.
 *
 * Los textos visibles son español, como el resto del CLI (ver `src/cli/i18n.ts`).
 */
import path from 'node:path';
import { colors, formatHeading } from '../ui/colors.js';
import { jsonEnvelope } from '../jsonOut.js';
import { fileExists } from '../../utils/fs.js';
import { HOST_COMMAND_TEMPLATES, planCommandTemplates, readCommandTemplateCatalogue, } from '../../core/commandTemplates.js';
/** Valor de un flag con valor (`--host x` o `--host=x`); `undefined` si no está. */
const flagValue = (args, name) => {
    const inline = args.find((arg) => arg.startsWith(`--${name}=`));
    if (inline)
        return inline.slice(name.length + 3);
    const at = args.indexOf(`--${name}`);
    if (at < 0)
        return undefined;
    const next = args[at + 1];
    return next === undefined || next.startsWith('-') ? '' : next;
};
const pad = (value, width) => (value.length >= width ? value : value + ' '.repeat(width - value.length));
/** Una descripción larga se recorta en la tabla; el texto completo vive en `--json`. */
const clip = (value, width) => value.length <= width ? value : `${value.slice(0, width - 1).trimEnd()}…`;
/** ¿Está instalado aquí, y cuántas? La respuesta sale del instalador, no de un `ls` paralelo. */
const scanInstalled = async (cwd, host, total) => {
    if (!host.verified || host.dir === null)
        return null;
    const dir = path.join(cwd, host.dir);
    if (!(await fileExists(dir)))
        return null;
    const artifacts = await planCommandTemplates({ cwd, hosts: [host.id] });
    const files = artifacts.filter((artifact) => artifact.command !== '*');
    const handEdited = files.filter((artifact) => artifact.action === 'keep' && /editad|no es una plantilla generada/.test(artifact.reason)).length;
    const stale = files.filter((artifact) => artifact.action === 'update').length;
    return {
        host: host.id,
        label: host.label,
        dir: host.dir,
        installed: files.filter((artifact) => artifact.action !== 'create').length,
        total,
        handEdited,
        stale,
    };
};
export const buildTemplatesReport = async (cwd) => {
    const templates = await readCommandTemplateCatalogue();
    const installed = [];
    for (const host of HOST_COMMAND_TEMPLATES) {
        const row = await scanInstalled(cwd, host, templates.length);
        if (row)
            installed.push(row);
    }
    return {
        templates,
        hosts: HOST_COMMAND_TEMPLATES.map((host) => ({
            id: host.id,
            label: host.label,
            dir: host.dir,
            invocation: host.invocation('specify'),
            format: host.format,
            argumentSyntax: host.argumentSyntax,
            maxChars: host.maxChars ?? null,
            verified: host.verified,
            evidence: host.evidence,
            docUrl: host.docUrl,
        })),
        installed,
        installCommand: 'npx @brujo2020/open-sdd init . --write',
    };
};
export const handleTemplatesCommand = async (args, io, cwd = process.cwd()) => {
    const json = args.includes('--json');
    const hostFilter = flagValue(args, 'host');
    const unknown = args.find((arg) => arg.startsWith('-') && !['--json', '--no-footer', '--host'].includes(arg.split('=')[0]));
    if (unknown) {
        io.error(colors.red(`Opción desconocida: ${unknown}. Usage: open-sdd templates [--host <id>] [--json]`));
        return 1;
    }
    const full = await buildTemplatesReport(cwd);
    const report = hostFilter === undefined
        ? full
        : {
            ...full,
            hosts: full.hosts.filter((host) => host.id === hostFilter),
            installed: full.installed.filter((row) => row.host === hostFilter),
        };
    if (hostFilter !== undefined && report.hosts.length === 0) {
        const known = HOST_COMMAND_TEMPLATES.map((host) => host.id).join(', ');
        io.error(colors.red(`Anfitrión desconocido: ${hostFilter}. Conocidos: ${known}`));
        return 1;
    }
    if (json) {
        io.log(JSON.stringify(jsonEnvelope({
            command: 'templates',
            data: report,
            detail: `Catálogo de ${report.templates.length} plantilla(s) de comando, sin MCP y sin red.`,
        }), null, 2));
        return 0;
    }
    io.log('');
    io.log(formatHeading(`Plantillas de comando — ${report.templates.length} workflow(s) que se instalan como comandos del anfitrión, SIN MCP y sin red`));
    io.log('');
    io.log(`  instalar:   ${report.installCommand}`);
    io.log(`  MCP:        opt-in con --mcp (el camino por defecto no lo necesita, ni la red)`);
    io.log(`  aquí:       ${await describeInstalled(report)}`);
    io.log('');
    io.log(colors.bold('  Catálogo (lo que escribe cada workflow; «—» = solo lectura)'));
    const idWidth = Math.max(...report.templates.map((entry) => entry.id.length));
    for (const [index, entry] of report.templates.entries()) {
        const writes = entry.readOnly ? '—' : entry.writes.join(', ');
        io.log(`  ${pad(String(index + 1), 3)} ${pad(entry.id, idWidth)}  ${pad(clip(writes, 34), 34)}  ${clip(entry.description, 62)}`);
    }
    io.log('');
    io.log(colors.bold('  Dónde lee cada anfitrión (y dónde NO se escribe)'));
    const hostWidth = Math.max(...report.hosts.map((host) => host.id.length));
    // Una ruta declarada pero NO verificada no es una respuesta: se marca como lo que es.
    const dirLabel = (host) => {
        if (host.dir === null)
            return '(sin directorio documentado)';
        return host.verified ? host.dir : `${host.dir} (sin verificar)`;
    };
    const dirWidth = Math.max(...report.hosts.map((host) => dirLabel(host).length));
    const argLabel = (host) => host.argumentSyntax === null ? '(instrucción)' : host.argumentSyntax;
    const argWidth = Math.max(...report.hosts.map((host) => argLabel(host).length));
    for (const host of report.hosts) {
        const verdict = host.verified ? colors.green('verificado   ') : colors.red('NO VERIFICADO');
        const limit = host.maxChars === null ? '' : `  ≤${host.maxChars.toLocaleString('en-US')} car.`;
        io.log(`  ${verdict}  ${pad(host.id, hostWidth)}  ${pad(dirLabel(host), dirWidth)}  ${pad(host.invocation, 18)}  ${pad(argLabel(host), argWidth)}${limit}`);
    }
    io.log('');
    io.log(`  «argumento» es el marcador que SU motor sustituye de verdad: las 22 plantillas se escriben una vez con «$ARGUMENTS» y el instalador lo traduce por anfitrión. «(instrucción)» = su documentación no describe ningún marcador, así que el bloque llega como frase y no como un token que nunca se expande. El límite de caracteres, cuando el fabricante lo publica, se COMPRUEBA al instalar: pasarse es un error, nunca un recorte silencioso.`);
    io.log('');
    io.log(`  «NO VERIFICADO» significa que la documentación del anfitrión no declara un directorio de comandos de proyecto: --write se niega en vez de adivinar. La prueba intentada está en --json (campo evidence / docUrl).`);
    return 0;
};
const describeInstalled = async (report) => {
    if (report.installed.length === 0) {
        return 'ninguna instalada todavía (ejecuta el comando de arriba, que sin --write solo imprime el plan).';
    }
    return report.installed
        .map((row) => {
        const notes = [];
        if (row.handEdited > 0)
            notes.push(`${row.handEdited} editada(s) a mano y conservadas`);
        if (row.stale > 0)
            notes.push(`${row.stale} desactualizada(s) y refrescables`);
        const suffix = notes.length > 0 ? ` — ${notes.join('; ')}` : '';
        return `${row.installed}/${row.total} en ${row.dir} (${row.label})${suffix}`;
    })
        .join(' · ');
};
