/**
 * `open-sdd biography <feature>` — la puerta de consola de la biografía de una especificación viva.
 *
 * `core/specBiography.ts` mide el RITMO de una spec con lo que git y los artefactos registran: cuándo
 * nació, cuándo se movió por última vez, si el código siguió moviéndose sin ella, qué enmiendas
 * cambiaron su comportamiento y quién ratificó la autoridad contra la que se lee. Este comando es su
 * única puerta y no añade ninguna interpretación: mide, renderiza y sale.
 *
 * ── Sin feature no hay biografía que medir ──────────────────────────────────────────────────────
 * Un nombre de feature es el sujeto de la medición; inventarlo (la primera spec, la «enfocada»)
 * mediría algo que nadie pidió y lo presentaría como la respuesta. Por eso la ausencia de feature
 * imprime el uso y sale con 1, en vez de adivinar.
 *
 * `--json` adopta el sobre estable de `cli/jsonOut.ts`: el objeto `SpecBiography` completo, sin
 * prosa, para que un script no tenga que interpretar el render humano. Los textos visibles son
 * español, como el resto del CLI (ver `src/cli/i18n.ts`).
 */
import { colors } from '../ui/colors.js';
import { jsonEnvelope } from '../jsonOut.js';
import { DEFAULT_EVENT_LIMIT, renderBiography, specBiography } from '../../core/specBiography.js';
const USAGE = 'Usage: open-sdd biography <feature> [--limit N] [--json]';
/** Valor de un flag con valor (`--limit 5` o `--limit=5`); `undefined` si no está. */
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
export const handleBiographyCommand = async (args, io, cwd = process.cwd()) => {
    const json = args.includes('--json');
    const feature = args.find((arg) => !arg.startsWith('-'));
    if (feature === undefined || feature.trim().length === 0) {
        io.error(colors.red(USAGE));
        return 1;
    }
    const rawLimit = flagValue(args, 'limit');
    const parsedLimit = rawLimit === undefined || rawLimit.length === 0 ? undefined : Number.parseInt(rawLimit, 10);
    const limit = parsedLimit !== undefined && Number.isFinite(parsedLimit) ? parsedLimit : DEFAULT_EVENT_LIMIT;
    const bio = await specBiography({ cwd, feature, limit });
    if (json) {
        io.log(JSON.stringify(jsonEnvelope({ command: 'biography', data: bio, detail: bio.detail }), null, 2));
        return 0;
    }
    for (const line of renderBiography(bio))
        io.log(line);
    return 0;
};
