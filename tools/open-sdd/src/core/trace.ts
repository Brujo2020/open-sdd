/**
 * Requirement ↔ task traceability of one feature, rendered for people (REQ-W2-011, REQ-W2-012).
 *
 * Read-only and deterministic: it parses `requirements.md` and `tasks.md` with the parsers the rest
 * of the CLI already uses, and renders what it found — a Mermaid flowchart, a lookup for one id, a
 * self-contained HTML page. Nothing is scored or inferred; a requirement no task cites is shown as
 * uncovered, a task that cites nothing as unlinked.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseRequirementsMarkdown, parseTasksMarkdown } from './specManager.js';

export interface TraceRequirement {
  id: string;
  title: string;
  statements: string[];
}

export interface TraceTask {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
  requirements: string[];
  evidence: string[];
}

export interface FeatureTrace {
  feature: string;
  requirements: TraceRequirement[];
  tasks: TraceTask[];
  /** Requirement ids no task cites. */
  uncovered: string[];
  /** Task ids that cite no known requirement. */
  unlinked: string[];
}

const readText = async (file: string): Promise<string | null> => readFile(file, 'utf8').catch(() => null);

/** `_Requirements: REQ-A-001, 2_` → the ids it names; a bare number means the n-th requirement. */
const citedRequirements = (raw: string, requirements: TraceRequirement[]): string[] => {
  const declared = raw.match(/_Requirements:\s*([^_\n]+)_/i);
  if (!declared) return [];
  const ids = declared[1]
    .split(/[,;]/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const byId = requirements.find((req) => req.id.toLowerCase() === token.toLowerCase());
      if (byId) return byId.id;
      if (/^\d+$/.test(token)) return requirements.find((req) => req.id === `REQ-${token}`)?.id ?? requirements[Number(token) - 1]?.id ?? token;
      return token;
    });
  return [...new Set(ids)];
};

/** Evidence lines (`- _Evidence: …_`) that follow a task line, keyed by the task's position. */
const evidenceByTask = (tasksText: string): string[][] => {
  const out: string[][] = [];
  for (const line of tasksText.split('\n')) {
    const trimmed = line.trim();
    if (/^-\s*\[[ x-]\]/i.test(trimmed)) {
      out.push([]);
      continue;
    }
    const evidence = trimmed.match(/^-?\s*_Evidence:\s*(.+?)_?$/i);
    if (evidence && out.length > 0) out[out.length - 1].push(evidence[1].trim());
  }
  return out;
};

export const loadFeatureTrace = async (root: string, sddDir: string, feature: string): Promise<FeatureTrace | null> => {
  const specDir = path.join(root, sddDir, 'specs', feature);
  const requirementsText = await readText(path.join(specDir, 'requirements.md'));
  const tasksText = await readText(path.join(specDir, 'tasks.md'));
  if (requirementsText === null && tasksText === null) return null;

  const requirements: TraceRequirement[] = parseRequirementsMarkdown(requirementsText ?? '').map((req) => ({
    id: req.id,
    title: req.title.replace(/^[—–:-]\s*/, '').trim(),
    statements: req.acceptanceCriteria.map((line) => line.replace(/^Statement:\s*/i, '')),
  }));
  const evidence = evidenceByTask(tasksText ?? '');
  const tasks: TraceTask[] = parseTasksMarkdown(tasksText ?? '').map((task, index) => ({
    id: task.id,
    title: task.title
      .replace(/^[0-9.]+\s*/, '')
      .split(/\s+—\s+_Requirements:|_Requirements:/i)[0]
      .trim(),
    status: task.status,
    requirements: citedRequirements(task.raw, requirements),
    evidence: evidence[index] ?? [],
  }));
  const known = new Set(requirements.map((req) => req.id));
  const cited = new Set(tasks.flatMap((task) => task.requirements));
  return {
    feature,
    requirements,
    tasks,
    uncovered: requirements.filter((req) => !cited.has(req.id)).map((req) => req.id),
    unlinked: tasks.filter((task) => !task.requirements.some((id) => known.has(id))).map((task) => task.id),
  };
};

export const listFeatures = async (root: string, sddDir: string): Promise<string[]> =>
  (await readdir(path.join(root, sddDir, 'specs'), { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();

// ---------------------------------------------------------------------------------------------
// Mermaid
// ---------------------------------------------------------------------------------------------

const nodeId = (prefix: string, id: string): string => `${prefix}_${id.replace(/[^A-Za-z0-9]/g, '_')}`;
const label = (text: string): string => text.replace(/["`<>]/g, "'").slice(0, 60);

export const renderMermaid = (trace: FeatureTrace): string => {
  const lines = ['flowchart LR'];
  for (const req of trace.requirements) {
    lines.push(`  ${nodeId('R', req.id)}["${req.id}<br/>${label(req.title)}"]`);
  }
  for (const task of trace.tasks) {
    lines.push(`  ${nodeId('T', task.id)}(["${task.id}. ${label(task.title)}"])`);
  }
  for (const task of trace.tasks) {
    for (const id of task.requirements) {
      if (trace.requirements.some((req) => req.id === id)) lines.push(`  ${nodeId('R', id)} --> ${nodeId('T', task.id)}`);
    }
  }
  lines.push('  classDef done fill:#d1fae5,stroke:#047857;', '  classDef doing fill:#fef3c7,stroke:#b45309;', '  classDef gap fill:#fee2e2,stroke:#b91c1c;');
  const done = trace.tasks.filter((task) => task.status === 'completed').map((task) => nodeId('T', task.id));
  const doing = trace.tasks.filter((task) => task.status === 'in_progress').map((task) => nodeId('T', task.id));
  const gaps = trace.uncovered.map((id) => nodeId('R', id));
  if (done.length > 0) lines.push(`  class ${done.join(',')} done;`);
  if (doing.length > 0) lines.push(`  class ${doing.join(',')} doing;`);
  if (gaps.length > 0) lines.push(`  class ${gaps.join(',')} gap;`);
  return `${lines.join('\n')}\n`;
};

// ---------------------------------------------------------------------------------------------
// HTML report
// ---------------------------------------------------------------------------------------------

const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STATUS_LABEL: Record<TraceTask['status'], string> = { completed: 'done', in_progress: 'in progress', pending: 'pending' };

/** One self-contained page: no script, no network, prints cleanly. */
export const renderHtmlReport = (trace: FeatureTrace, meta: { generatedAt: string; score?: number }): string => {
  const done = trace.tasks.filter((task) => task.status === 'completed').length;
  const withEvidence = trace.tasks.filter((task) => task.evidence.length > 0).length;
  const reqRows = trace.requirements
    .map((req) => {
      const tasks = trace.tasks.filter((task) => task.requirements.includes(req.id));
      const cell = tasks.length > 0 ? tasks.map((task) => `<span class="pill ${task.status}">${esc(task.id)}</span>`).join(' ') : '<span class="gap">no task</span>';
      return `<tr><td class="id">${esc(req.id)}</td><td><strong>${esc(req.title)}</strong>${req.statements.length > 0 ? `<ul>${req.statements.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}</td><td>${cell}</td></tr>`;
    })
    .join('\n');
  const taskRows = trace.tasks
    .map(
      (task) =>
        `<tr><td class="id">${esc(task.id)}</td><td>${esc(task.title)}</td><td><span class="pill ${task.status}">${STATUS_LABEL[task.status]}</span></td><td>${task.requirements.map(esc).join(', ') || '<span class="gap">none</span>'}</td><td>${task.evidence.length > 0 ? task.evidence.map(esc).join('<br>') : '<span class="muted">no evidence recorded</span>'}</td></tr>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(trace.feature)} — open-sdd report</title>
<style>
:root{--bg:#fff;--fg:#111827;--muted:#6b7280;--line:#e5e7eb;--done:#047857;--doing:#b45309;--gap:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f14;--fg:#e5e7eb;--muted:#9ca3af;--line:#1f2937}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:1080px;margin:0 auto;padding:24px 16px}
h1{margin:0 0 4px}h2{margin-top:32px}.muted{color:var(--muted)}
.stats{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}.stat{border:1px solid var(--line);border-radius:8px;padding:8px 14px}
.stat b{display:block;font-size:22px}
.table{overflow-x:auto}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--line);padding:8px;text-align:left;vertical-align:top}
td.id{font-family:ui-monospace,monospace;white-space:nowrap}ul{margin:4px 0 0;padding-left:18px}
.pill{display:inline-block;border-radius:999px;padding:0 8px;font-size:12px;border:1px solid currentColor}
.completed{color:var(--done)}.in_progress{color:var(--doing)}.pending{color:var(--muted)}.gap{color:var(--gap);font-weight:600}
pre{background:rgba(127,127,127,.1);padding:12px;border-radius:8px;overflow-x:auto}
</style></head><body><main>
<h1>${esc(trace.feature)}</h1>
<p class="muted">Generated by open-sdd on ${esc(meta.generatedAt)} from requirements.md and tasks.md. Read-only: nothing here is measured beyond what those files declare.</p>
<div class="stats">
<div class="stat"><b>${trace.requirements.length}</b>requirements</div>
<div class="stat"><b>${done}/${trace.tasks.length}</b>tasks done</div>
<div class="stat"><b>${withEvidence}</b>tasks with evidence</div>
<div class="stat"><b class="${trace.uncovered.length > 0 ? 'gap' : ''}">${trace.uncovered.length}</b>uncovered requirements</div>
${meta.score !== undefined ? `<div class="stat"><b>${meta.score}%</b>SDD score</div>` : ''}
</div>
<h2>Requirements → tasks</h2>
<div class="table"><table><thead><tr><th>Id</th><th>Requirement</th><th>Tasks</th></tr></thead><tbody>
${reqRows}
</tbody></table></div>
<h2>Tasks</h2>
<div class="table"><table><thead><tr><th>Id</th><th>Task</th><th>Status</th><th>Requirements</th><th>Evidence</th></tr></thead><tbody>
${taskRows}
</tbody></table></div>
<h2>Trace graph (Mermaid source)</h2>
<pre>${esc(renderMermaid(trace))}</pre>
</main></body></html>
`;
};
