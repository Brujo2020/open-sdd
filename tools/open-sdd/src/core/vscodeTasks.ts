/**
 * `.vscode/tasks.json` entries for the open-sdd console (REQ-W2-013), so VS Code users — including
 * Cline and Axet Plugin, which run inside VS Code — reach the gates from "Run Task".
 *
 * Merge-only: an existing task keeps its bytes; ours are added by label and an existing label is
 * kept as the user left it. A file VS Code accepts but strict JSON does not (comments, trailing
 * commas) is refused rather than rewritten, because rewriting it would delete the user's comments.
 */

export const SDD_TASKS = [
  { label: 'SDD: status', type: 'shell', command: 'npx @brujo2020/open-sdd status', problemMatcher: [] },
  { label: 'SDD: gates (staged)', type: 'shell', command: 'npx @brujo2020/open-sdd gates run --staged', problemMatcher: [] },
  { label: 'SDD: doctor', type: 'shell', command: 'npx @brujo2020/open-sdd doctor', problemMatcher: [] },
  { label: 'SDD: trace', type: 'shell', command: 'npx @brujo2020/open-sdd trace ${input:sddFeature}', problemMatcher: [] },
] as const;

const SDD_INPUT = { id: 'sddFeature', type: 'promptString', description: 'Feature (folder under .sdd/specs)' };

export type VscodeTasksPlan =
  | { action: 'create' | 'update'; content: string; added: string[] }
  | { action: 'keep'; added: [] }
  | { action: 'refused'; reason: string; added: [] };

export const planVscodeTasks = (existing: string | null): VscodeTasksPlan => {
  let doc: { version?: string; tasks?: { label?: string }[]; inputs?: { id?: string }[]; [key: string]: unknown };
  if (existing === null) {
    doc = { version: '2.0.0', tasks: [] };
  } else {
    try {
      doc = JSON.parse(existing) as typeof doc;
    } catch {
      return { action: 'refused', reason: '.vscode/tasks.json no es JSON estricto (¿comentarios?): no se reescribe para no borrarlos. Añade las tareas a mano.', added: [] };
    }
    if (!Array.isArray(doc.tasks ?? [])) return { action: 'refused', reason: '`tasks` no es una lista.', added: [] };
  }
  const tasks = [...(doc.tasks ?? [])];
  const labels = new Set(tasks.map((task) => task.label));
  const added = SDD_TASKS.filter((task) => !labels.has(task.label)).map((task) => task.label);
  if (added.length === 0) return { action: 'keep', added: [] };
  const inputs = [...(doc.inputs ?? [])];
  if (!inputs.some((input) => input.id === SDD_INPUT.id)) inputs.push(SDD_INPUT);
  const next = { ...doc, version: doc.version ?? '2.0.0', tasks: [...tasks, ...SDD_TASKS.filter((task) => added.includes(task.label))], inputs };
  return { action: existing === null ? 'create' : 'update', content: `${JSON.stringify(next, null, 2)}\n`, added };
};
