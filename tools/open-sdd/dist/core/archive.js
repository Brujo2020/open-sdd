/**
 * Archive a finished feature: move `<sdd>/specs/<feature>/` to `<sdd>/archive/<YYYY-MM-DD>-<feature>/` once it is
 * provably done, so `.sdd/specs/` lists only live work and the archived triad stays as the record of what shipped.
 *
 * ── Why it is included (ported from SteelForge, research/SDD-PARA-OPENSDD.md §6; idea from OpenSpec) ──────
 * open-sdd had no end of life for a spec: finished features stayed in `.sdd/specs/` forever, inflating
 * `status`, `waves` and every scan that walks specs. OpenSpec's `archive` closes the loop; this keeps its safety
 * rules and maps "validated" onto open-sdd's own state instead of a new file:
 *   - every task in tasks.md is `[x]` (an archived spec with open work hides that work);
 *   - spec.json says `verified` or `completed` (the phases `/sdd-validate-impl` leads to) and tasks were approved;
 *   - nothing is moved without `confirm`: the default is a dry run that only reports;
 *   - an existing archive entry is never overwritten, and the move is one `rename` (no half-moved spec).
 * It does NOT apply deltas to the living spec: `delta` already owns that.
 */
import { mkdir, readFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseTasksMarkdown } from './specManager.js';
const DONE_PHASES = new Set(['verified', 'completed']);
/**
 * Checks whether a spec directory can be archived.
 * @param specDir - absolute path of `<sdd>/specs/<feature>`.
 */
export const archiveReadiness = async (specDir) => {
    const blockers = [];
    const tasksText = await readFile(path.join(specDir, 'tasks.md'), 'utf8').catch(() => null);
    let openTasks = [];
    if (tasksText === null)
        blockers.push('no hay tasks.md: no se puede demostrar que el trabajo terminó');
    else {
        const tasks = parseTasksMarkdown(tasksText);
        if (tasks.length === 0)
            blockers.push('tasks.md no tiene tareas');
        openTasks = tasks.filter((t) => t.status !== 'completed').map((t) => t.id);
        if (openTasks.length)
            blockers.push(`${openTasks.length} tarea(s) sin completar: ${openTasks.join(', ')}`);
    }
    const metaText = await readFile(path.join(specDir, 'spec.json'), 'utf8').catch(() => null);
    if (metaText === null)
        blockers.push('no hay spec.json');
    else {
        let meta = null;
        try {
            meta = JSON.parse(metaText);
        }
        catch {
            blockers.push('spec.json no es JSON válido');
        }
        if (meta) {
            if (!DONE_PHASES.has(String(meta.phase)))
                blockers.push(`spec.json está en la fase «${meta.phase ?? '?'}»: valida la implementación (/sdd-validate-impl) hasta «verified» o «completed»`);
            if (meta.approvals?.tasks !== true)
                blockers.push('las tareas no están aprobadas en spec.json');
        }
    }
    return { ready: blockers.length === 0, blockers, openTasks };
};
/**
 * Archives a feature. Without `confirm` it only reports what it would do.
 * @param input - `root`: repository root; `sddDir`: relative `.sdd` dir; `feature`; `confirm`; `today` (YYYY-MM-DD, for tests).
 */
export const archiveFeature = async (input) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.feature))
        throw new Error(`nombre de feature no válido: «${input.feature}»`);
    const specDir = path.join(input.root, input.sddDir, 'specs', input.feature);
    const day = input.today ?? new Date().toISOString().slice(0, 10);
    const destinationRel = path.posix.join(input.sddDir, 'archive', `${day}-${input.feature}`);
    const destination = path.join(input.root, destinationRel);
    if (!(await stat(specDir).catch(() => null))?.isDirectory()) {
        return { moved: false, destination: destinationRel, readiness: { ready: false, blockers: [`no existe ${path.posix.join(input.sddDir, 'specs', input.feature)}`], openTasks: [] }, detail: 'feature no encontrada' };
    }
    const readiness = await archiveReadiness(specDir);
    if (await stat(destination).catch(() => null))
        readiness.blockers.push(`ya existe ${destinationRel}: no se sobrescribe un archivo previo`);
    readiness.ready = readiness.blockers.length === 0;
    if (!readiness.ready)
        return { moved: false, destination: destinationRel, readiness, detail: `no se puede archivar: ${readiness.blockers.join('; ')}` };
    if (!input.confirm)
        return { moved: false, destination: destinationRel, readiness, detail: `lista para archivar en ${destinationRel} (repite con --confirm para moverla)` };
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(specDir, destination);
    return { moved: true, destination: destinationRel, readiness, detail: `archivada en ${destinationRel}` };
};
