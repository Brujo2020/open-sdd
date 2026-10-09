/**
 * Task-grammar checks for `tasks.md` (REQ-SSP-005…008), ported from the SteelForge SDD synthesis
 * (`SDD-PARA-OPENSDD.md` §3: DEPENDS, NUM, PARALLEL, ORPHAN).
 *
 * Only the rules no other module owns live here: requirement↔task coverage and phantom ids belong
 * to `traceDelta` (via `consistency.ts`), so this file never re-checks them.
 *
 * A task is its checkbox line PLUS the indented detail lines under it, because the shipped
 * `tasks.md` template writes `_Requirements:_` and `_Boundary:_` on detail bullets. Reading only the
 * checkbox line would report every template-shaped task as orphaned.
 */

import type { ConsistencyFinding } from './consistency.js';

export interface TaskBlock {
  id: string | null;
  line: number;
  text: string;
  parallel: boolean;
}

const CHECKBOX = /^\s*-\s*\[[ xX-]\]\s*\*?\s*(.+)$/;
const NUMERIC_ID = /^(\d+(?:\.\d+)*)\.?(?=\s|:|$)/;
const REQUIREMENT_ID = /\bREQ-[A-Z0-9][A-Z0-9_-]*\b/i;

/**
 * A task cites a requirement with a `REQ-…` id anywhere, or with a filled `_Requirements:_` value:
 * the shipped template numbers requirements (`Requirement 1`) and tasks cite them as `1.2`.
 * A `{{…}}` placeholder is not a citation.
 */
const citesRequirement = (text: string): boolean => {
  if (REQUIREMENT_ID.test(text)) return true;
  const withoutPlaceholders = text.replace(/\{\{[^}]*\}\}/g, ' ');
  const declared = /_Requirements:_?\s*([^_\n]*)/i.exec(withoutPlaceholders)?.[1] ?? '';
  return declared.replace(/[\s,;*`]/g, '').length > 0;
};

/** Split `tasks.md` into task blocks: the checkbox line and the non-checkbox lines that follow it. */
export const parseTaskBlocks = (markdown: string): TaskBlock[] => {
  const blocks: TaskBlock[] = [];
  let current: TaskBlock | null = null;
  markdown.split(/\r?\n/).forEach((raw, index) => {
    const match = CHECKBOX.exec(raw);
    if (match) {
      const title = match[1].trim();
      const head = title.split(/_Boundary:|_Depends:|_Requirements:/i)[0];
      current = { id: NUMERIC_ID.exec(title)?.[1] ?? null, line: index + 1, text: title, parallel: /\(P\)/.test(head) };
      blocks.push(current);
    } else if (current && /^\s+\S/.test(raw)) {
      current.text += `\n${raw.trim()}`;
    } else if (/^\S/.test(raw)) {
      current = null; // a heading or unindented prose ends the block
    }
  });
  return blocks;
};

const dependsOf = (text: string): string[] => {
  const match = /_Depends:_?\s*([^_\n]+)/i.exec(text);
  if (!match) return [];
  return match[1]
    .split(/[,;]/)
    .map((d) => d.replace(/[`"*]/g, '').trim())
    .filter(Boolean);
};

export const checkTaskGrammar = (markdown: string, artifact = 'tasks.md'): ConsistencyFinding[] => {
  const blocks = parseTaskBlocks(markdown);
  const findings: ConsistencyFinding[] = [];
  const ids = blocks.map((b) => b.id).filter((id): id is string => id !== null);
  const known = new Set(ids);

  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      findings.push({
        severity: 'error',
        code: 'TASK_DUPLICATE_ID',
        message: `La tarea ${id} aparece más de una vez en ${artifact}: dos tareas con el mismo número hacen ambiguas las dependencias y la evidencia.`,
        artifacts: [artifact],
      });
    }
    seen.add(id);
  }

  for (const block of blocks) {
    const label = block.id ?? `línea ${block.line}`;
    for (const dep of dependsOf(block.text)) {
      const normalized = dep.replace(/^task-/i, '').replace(/\.$/, '');
      if (!known.has(normalized) && !known.has(dep)) {
        findings.push({
          severity: 'error',
          code: 'TASK_DEPENDS_UNKNOWN',
          message: `La tarea ${label} depende de «${dep}», que no existe en ${artifact}: el planificador de oleadas rompería el bloqueo en silencio.`,
          artifacts: [artifact],
        });
      }
    }
    if (block.parallel && !/_Boundary:/i.test(block.text)) {
      findings.push({
        severity: 'warning',
        code: 'TASK_PARALLEL_WITHOUT_BOUNDARY',
        message: `La tarea ${label} está marcada (P) sin _Boundary:_: sin frontera declarada no se puede comprobar que no pisa los ficheros de otra tarea paralela.`,
        artifacts: [artifact],
      });
    }
    const isParent = block.id !== null && ids.some((other) => other.startsWith(`${block.id}.`));
    if (!isParent && !citesRequirement(block.text)) {
      findings.push({
        severity: 'warning',
        code: 'TASK_WITHOUT_REQUIREMENT',
        message: `La tarea ${label} no cita ningún requisito: una tarea sin requisito es trabajo que ninguna obligación pide.`,
        artifacts: [artifact],
      });
    }
  }
  return findings;
};
