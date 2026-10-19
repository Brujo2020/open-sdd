/**
 * El context pack: TODO lo que un host debe inyectar antes de editar, en UN objeto.
 *
 * Este módulo es la EXTRACCIÓN a `core` de lo que hasta ahora construía en exclusiva el handler MCP
 * `open_sdd_context_pack` (`src/mcp/tools.ts`). El CLI (`open-sdd context`) y el servidor MCP leen
 * el mismo repositorio con el mismo código, así que no pueden divergir: la alternativa —dos
 * implementaciones del mismo objeto— es cómo un host y una terminal acaban dando veredictos
 * distintos sobre el mismo repositorio.
 *
 * ── Compatibilidad con la superficie MCP ───────────────────────────────────────────────────────
 * `buildContextPack(...).pack` conserva EXACTAMENTE las claves y la forma del `data` que ya
 * devolvía `open_sdd_context_pack` (`root`, `sddDir`, `feature`, `complete`, `absent`,
 * `constitution`, `spec`, `moduleMap`, `rigor`). El handler MCP puede delegar mañana con una línea:
 *
 *     const { pack, isError, detail } = await buildContextPack(context.cwd, {
 *       ...(feature ? { feature } : {}),
 *       sddDir: context.sddDir,
 *     });
 *     return { data: pack, isError, detail };
 *
 * Esa edición NO se hace aquí: `src/mcp/**` lo posee otro cambio. Queda como seguimiento declarado.
 *
 * ── La regla que hereda del handler original ───────────────────────────────────────────────────
 * Cada pieza declara `present: false` y `reason` cuando falta, en vez de omitir la clave: un host
 * necesita distinguir «falta» de «no se preguntó». `complete` es false en cuanto una pieza falta, y
 * `absent` nombra las ausencias. `isError` se mantiene false para una ausencia declarada —igual que
 * en MCP—: una pieza ausente es un hecho del pack, no un fallo del transporte. Solo se degrada
 * `isError` si el propio ensamblado no puede inspeccionar (no ocurre: cada lector envuelve su fallo).
 *
 * Textos visibles en español, como el resto del motor.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildModuleMap } from './bootstrap.js';
import { principlesInForce, validateConstitution } from './constitution.js';
import { effectiveGates, loadRigorSettings } from './rigor.js';
import { resolveSddDir } from './specManager.js';
import { constitutionCandidates, findRepoRoot, focusFeature, inspectFeature, loadConstitution } from './status.js';
const errorMessage = (error) => (error instanceof Error ? error.message : String(error));
/** Leer un fichero distinguiendo «no existe» de «existe pero no se pudo leer». */
const readTextIfPresent = async (absPath) => {
    try {
        return await readFile(absPath, 'utf8');
    }
    catch {
        return null;
    }
};
/**
 * Ensamblar el context pack de un repositorio.
 *
 * Igual que el handler MCP, NUNCA lanza por artefactos ausentes: resuelve el repositorio, lee cada
 * pieza y declara las ausencias. Las únicas excepciones posibles vendrían de un fallo de sistema
 * fuera de los `try` (p. ej. `findRepoRoot`), y aun así `complete`/`absent` describen el estado.
 */
export const buildContextPack = async (cwd = process.cwd(), options = {}) => {
    const root = await findRepoRoot(cwd);
    const sddDir = options.sddDir ?? (await resolveSddDir(root));
    const requested = options.feature;
    const feature = requested ?? (await focusFeature(root, sddDir));
    const absent = [];
    // ── Constitución ────────────────────────────────────────────────────────────────────────────
    const constitutionRead = await loadConstitution(root, sddDir);
    let constitution;
    if (constitutionRead.exists && constitutionRead.constitution !== null) {
        const text = await readTextIfPresent(path.join(root, constitutionRead.path ?? ''));
        constitution = {
            present: true,
            path: constitutionRead.path,
            text: text ?? '',
            principlesInForce: principlesInForce(constitutionRead.constitution).map((principle) => ({
                id: principle.id,
                title: principle.title,
                level: principle.level,
                restriction: principle.restriction,
            })),
            issues: validateConstitution(constitutionRead.constitution),
        };
    }
    else {
        const candidate = constitutionCandidates(sddDir)[0];
        constitution = {
            present: false,
            path: candidate,
            text: '',
            principlesInForce: [],
            issues: [],
            reason: constitutionRead.exists ? 'existe pero no se pudo leer' : 'no presente',
        };
        absent.push('constitution');
    }
    // ── Especificación aplicable ────────────────────────────────────────────────────────────────
    let spec;
    if (!feature) {
        spec = {
            present: false,
            feature: null,
            path: path.join(sddDir, 'specs'),
            reason: `no hay ninguna especificación en ${path.join(sddDir, 'specs')}`,
        };
        absent.push('spec');
    }
    else {
        const inspection = await inspectFeature(root, feature, sddDir);
        const specPath = path.join(sddDir, 'specs', feature);
        if (!inspection.dirExists) {
            spec = { present: false, feature, path: specPath, reason: 'la feature no existe en el repositorio' };
            absent.push('spec');
        }
        else {
            const piece = async (file) => {
                const rel = path.join(specPath, file);
                const text = await readTextIfPresent(path.join(root, rel));
                if (text === null)
                    return { present: false, path: rel, text: null, reason: 'no presente' };
                if (text.trim().length === 0)
                    return { present: true, path: rel, text, reason: 'presente pero vacío' };
                return { present: true, path: rel, text };
            };
            const planFile = inspection.files.includes('plan.md') ? 'plan.md' : 'design.md';
            const requirements = await piece('requirements.md');
            const plan = await piece(planFile);
            const tasks = await piece('tasks.md');
            const delta = await piece('delta.md');
            if (delta.present && inspection.delta)
                delta.parsed = inspection.delta;
            for (const [key, value] of [
                ['requirements', requirements],
                ['plan', plan],
                ['tasks', tasks],
                ['delta', delta],
            ]) {
                if (value.present !== true)
                    absent.push(`spec.${key}`);
            }
            if (requirements.present !== true && plan.present !== true && tasks.present !== true)
                absent.push('spec.triad');
            spec = { present: true, feature, path: specPath, requirements, plan, tasks, delta };
        }
    }
    // ── Mapa de módulos ─────────────────────────────────────────────────────────────────────────
    let moduleMap;
    try {
        const map = await buildModuleMap(root);
        moduleMap = {
            present: map.modules.length > 0,
            modules: map.modules,
            complete: map.complete,
            detail: map.detail,
            ...(map.modules.length > 0 ? {} : { reason: 'no se observó ningún módulo en el repositorio' }),
        };
        if (map.modules.length === 0)
            absent.push('moduleMap');
    }
    catch (error) {
        moduleMap = {
            present: false,
            modules: [],
            complete: false,
            reason: `no se pudo construir: ${errorMessage(error)}`,
        };
        absent.push('moduleMap');
    }
    // ── Rigor declarado ─────────────────────────────────────────────────────────────────────────
    let rigor;
    try {
        const settings = await loadRigorSettings(root, sddDir);
        rigor = {
            present: true,
            level: settings.level,
            brownfield: settings.brownfield,
            rationale: settings.rationale,
            activeGates: effectiveGates(settings.level, settings.gates),
        };
    }
    catch (error) {
        rigor = {
            present: false,
            level: null,
            activeGates: [],
            reason: `el rigor declarado no se pudo leer (${errorMessage(error)}): no se degrada a spec-first`,
        };
        absent.push('rigor');
    }
    const pack = {
        root,
        sddDir,
        feature: feature ?? null,
        complete: absent.length === 0,
        absent,
        constitution,
        spec,
        moduleMap,
        rigor,
    };
    return {
        pack,
        isError: false,
        detail: absent.length === 0
            ? `Context pack completo: constitución, spec "${feature}", mapa de módulos y rigor declarado.`
            : `Context pack INCOMPLETO: ausente ${absent.join(', ')}. Las claves siguen presentes con present=false para que el host no confunda «falta» con «no se preguntó».`,
    };
};
/**
 * Emparejar cada nombre de `absent` con la razón que su piece declara. Una ausencia SIN razón se
 * reporta como tal: un `absent` sin causa sería el «se perdió algo» que este pack evita.
 */
export const contextAbsences = (pack) => {
    const reasonOf = {
        constitution: () => pack.constitution.reason ?? 'ausente sin razón declarada',
        spec: () => pack.spec.reason ?? 'ausente sin razón declarada',
        moduleMap: () => pack.moduleMap.reason ?? 'ausente sin razón declarada',
        rigor: () => pack.rigor.reason ?? 'ausente sin razón declarada',
    };
    return pack.absent.map((key) => {
        const specific = reasonOf[key];
        if (specific)
            return { key, reason: specific() };
        const piece = key.startsWith('spec.')
            ? pack.spec[key.slice('spec.'.length)]
            : undefined;
        return { key, reason: piece?.reason ?? 'ausente sin razón declarada' };
    });
};
