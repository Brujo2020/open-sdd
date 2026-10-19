/**
 * Structural checks of `tasks.md` and of the plan that `consistency.ts` did not run: duplicate task numbers,
 * parallel tasks without a boundary, dependencies on tasks that do not exist, tasks that never say how they are
 * verified, and requirements the plan never mentions.
 *
 * ── Why it is included (ported from SteelForge, research/SDD-PARA-OPENSDD.md §3) ─────────────────────────
 * `consistency.ts` traces requirement ↔ task (coverage, phantom ids) but read each task only for the ids it cites.
 * These five rules come from the same sources open-sdd already answers (Spec Kit `analyze`, OpenSpec, cc-sdd) and
 * close the remaining ways a task list looks complete and is not:
 *   - TASK_DUPLICATE_ID          two tasks share a number, so `/sdd-impl 1.2` is ambiguous (OpenSpec).
 *   - PARALLEL_WITHOUT_BOUNDARY  a `(P)` task without `_Boundary:_` can collide with its sibling (cc-sdd).
 *   - DEPENDS_ON_UNKNOWN_TASK    `_Depends:_` names a task that does not exist, so the wave order is wrong (cc-sdd).
 *   - TASK_WITHOUT_VERIFICATION  the task does not say how it is checked; "done" becomes an opinion (OpenSpec).
 *   - REQUIREMENT_NOT_IN_PLAN    the plan never mentions a requirement, so it was not designed (Spec Kit).
 * Pure functions over text: no file system, no git, no model; `consistency.ts` reads and composes.
 */
import { parseTasksMarkdown } from './specManager.js';

/** Same shape as `ConsistencyFinding` (kept structural to avoid a module cycle). */
export interface TaskStructureFinding {
  severity: 'error' | 'warning' | 'info';
  code: 'TASK_DUPLICATE_ID' | 'PARALLEL_WITHOUT_BOUNDARY' | 'DEPENDS_ON_UNKNOWN_TASK' | 'TASK_WITHOUT_VERIFICATION' | 'REQUIREMENT_NOT_IN_PLAN';
  message: string;
  artifacts: string[];
}

/** Words that state how a task is verified, in English and Spanish. */
const VERIFICATION = /\b(verif(?:y|ies|ied|ication|ica|icar|icado|icación)|test(?:s|ed|ing)?|prueba(?:s)?|assert|check(?:s|ed)?|comprueba|comprobar|_Verify:_|validat(?:e|es|ion)|valida(?:r|ción)?)\b/i;
/** A parallel marker `(P)` in a task line. */
const PARALLEL = /\(P\)/;

/**
 * Runs the five checks.
 * @param input - `tasks`: tasks.md content; `plan`: plan.md (or design.md) content, null when absent;
 *   `requirementIds`: ids declared in requirements.md; `tasksRel` / `planRel`: paths cited in findings.
 * @returns findings, in the order the rules are listed above.
 */
export const checkTaskStructure = (input: {
  tasks: string;
  plan: string | null;
  requirementIds: string[];
  tasksRel: string;
  planRel: string;
}): TaskStructureFinding[] => {
  const findings: TaskStructureFinding[] = [];
  // Only numbered ids (`1`, `1.2`, `T3`) are identities: an unnumbered task gets its first word as id from
  // `parseTasksMarkdown`, and two tasks starting with "Add" are not duplicates.
  const parsed = parseTasksMarkdown(input.tasks).filter((t) => /^(?:\d+(?:\.\d+)*|T\d+(?:\.\d+)*)$/i.test(t.id));
  const tasks = [input.tasksRel];

  const seen = new Map<string, number>();
  for (const t of parsed) seen.set(t.id, (seen.get(t.id) ?? 0) + 1);
  for (const [id, n] of seen) {
    if (n > 1) findings.push({ severity: 'error', code: 'TASK_DUPLICATE_ID', message: `La tarea ${id} aparece ${n} veces: \`/sdd-impl ${id}\` no sabe cuál ejecutar. Renumera las tareas.`, artifacts: tasks });
  }

  for (const t of parsed) {
    if (PARALLEL.test(t.raw) && !(t.boundary && t.boundary.length > 0)) {
      findings.push({ severity: 'warning', code: 'PARALLEL_WITHOUT_BOUNDARY', message: `La tarea ${t.id} está marcada (P) pero no declara _Boundary:_: sin límite de archivos, dos tareas paralelas pueden pisarse.`, artifacts: tasks });
    }
  }

  const ids = new Set(parsed.map((t) => t.id));
  for (const t of parsed) {
    for (const dep of t.depends ?? []) {
      if (!ids.has(dep)) findings.push({ severity: 'error', code: 'DEPENDS_ON_UNKNOWN_TASK', message: `La tarea ${t.id} depende de ${dep}, que no existe en tasks.md: el orden por oleadas queda mal calculado.`, artifacts: tasks });
    }
  }

  for (const t of parsed) {
    if (t.status === 'completed') continue;
    if (!VERIFICATION.test(t.raw)) findings.push({ severity: 'info', code: 'TASK_WITHOUT_VERIFICATION', message: `La tarea ${t.id} no dice cómo se verifica (prueba, comprobación o \`_Verify:_\`): sin eso, «hecho» es una opinión.`, artifacts: tasks });
  }

  if (input.plan !== null) {
    const plan = input.plan.toUpperCase();
    for (const id of input.requirementIds) {
      if (!plan.includes(id.toUpperCase())) findings.push({ severity: 'warning', code: 'REQUIREMENT_NOT_IN_PLAN', message: `El plan no menciona ${id}: un requisito que el diseño no nombra no se diseñó, solo se listó.`, artifacts: [input.planRel] });
    }
  }
  return findings;
};
