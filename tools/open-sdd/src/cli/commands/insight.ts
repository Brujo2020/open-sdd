/**
 * Read-only views over a feature's traceability (REQ-W2-011, REQ-W2-012):
 *
 *   trace <feature> [--mermaid] [--json]   requirement → task links, gaps named
 *   explain <REQ-ID> [--json]              where an id is defined, which tasks cite it, which files name it
 *   badge [--out <file>]                   offline SVG of the composite SDD score (stdout by default)
 *   report <feature> --html [--out <file>] one self-contained HTML page (stdout by default)
 *
 * Nothing here writes unless `--out` names a file.
 */

import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { CliIO } from '../io.js';
import { colors } from '../ui/colors.js';
import { findRepoRoot } from '../../core/status.js';
import { resolveSddDir } from '../../core/specManager.js';
import { listFeatures, loadFeatureTrace, renderHtmlReport, renderMermaid } from '../../core/trace.js';
import { computeSddScore } from '../../core/sddScore.js';
import { renderBadge } from '../../core/badge.js';

const flagValue = (args: string[], name: string): string | undefined => {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  const next = index >= 0 ? args[index + 1] : undefined;
  return next !== undefined && !next.startsWith('-') ? next : undefined;
};

const positional = (args: string[]): string | undefined =>
  args.find((arg, index) => !arg.startsWith('-') && args[index - 1] !== '--out');

const emit = async (io: CliIO, cwd: string, content: string, out: string | undefined): Promise<void> => {
  if (out === undefined) {
    io.log(content.replace(/\n$/, ''));
    return;
  }
  const target = path.resolve(cwd, out);
  await writeFile(target, content, 'utf8');
  io.log(`escrito: ${path.relative(cwd, target) || target}`);
};

const unknownFeature = (io: CliIO, feature: string | undefined, features: string[]): number => {
  io.error(colors.red(`${feature ? `No existe la especificación "${feature}".` : 'Falta <feature>.'} Disponibles: ${features.join(', ') || '(ninguna)'}`));
  return 1;
};

export const handleInsightCommand = async (cmd: string, args: string[], io: CliIO, cwd: string): Promise<number> => {
  const root = await findRepoRoot(cwd);
  const sddDir = await resolveSddDir(root);
  const json = args.includes('--json');
  const out = flagValue(args, 'out');
  if (args.includes('--out') && out === undefined) {
    io.error(colors.red('--out exige una ruta.'));
    return 1;
  }

  if (cmd === 'badge') {
    const score = await computeSddScore(root, { sddDir });
    await emit(io, cwd, renderBadge(score.total), out);
    return 0;
  }

  if (cmd === 'explain') {
    const id = positional(args);
    if (!id || !/^REQ-/i.test(id)) {
      io.error(colors.red('Uso: open-sdd explain <REQ-ID>'));
      return 1;
    }
    const hits: { feature: string; title: string; statements: string[]; tasks: { id: string; title: string; status: string }[] }[] = [];
    for (const feature of await listFeatures(root, sddDir)) {
      const trace = await loadFeatureTrace(root, sddDir, feature);
      const req = trace?.requirements.find((entry) => entry.id.toLowerCase() === id.toLowerCase());
      if (!trace || !req) continue;
      hits.push({
        feature,
        title: req.title,
        statements: req.statements,
        tasks: trace.tasks.filter((task) => task.requirements.includes(req.id)).map(({ id: taskId, title, status }) => ({ id: taskId, title, status })),
      });
    }
    // Files that name the id: tracked files only, so build output and dependencies stay out.
    const grep = spawnSync('git', ['grep', '-l', '-F', '-i', id], { cwd: root, encoding: 'utf8' });
    const files = grep.status === 0 ? grep.stdout.split('\n').filter(Boolean) : [];
    if (json) {
      io.log(JSON.stringify({ id, definitions: hits, files }, null, 2));
      return hits.length > 0 ? 0 : 1;
    }
    if (hits.length === 0) {
      io.error(colors.red(`${id} no está definido en ninguna especificación de ${sddDir}/specs.`));
      if (files.length > 0) io.log(`Aparece en: ${files.join(', ')}`);
      return 1;
    }
    for (const hit of hits) {
      io.log(`${colors.bold(id)} — ${hit.title}  ${colors.dim(`(${sddDir}/specs/${hit.feature}/requirements.md)`)}`);
      for (const statement of hit.statements) io.log(`  · ${statement}`);
      io.log(hit.tasks.length > 0 ? '  tareas:' : colors.yellow('  ninguna tarea lo cita'));
      for (const task of hit.tasks) io.log(`    ${task.status === 'completed' ? '✓' : task.status === 'in_progress' ? '…' : '○'} ${task.id}. ${task.title}`);
    }
    io.log(`  ficheros que lo nombran (${files.length}): ${files.join(', ') || '—'}`);
    return 0;
  }

  // trace / report need a feature.
  const features = await listFeatures(root, sddDir);
  const feature = positional(args);
  if (!feature || !features.includes(feature)) return unknownFeature(io, feature, features);
  const trace = await loadFeatureTrace(root, sddDir, feature);
  if (!trace) return unknownFeature(io, feature, features);

  if (cmd === 'report') {
    if (!args.includes('--html')) {
      io.error(colors.red('Uso: open-sdd report <feature> --html [--out <fichero>]'));
      return 1;
    }
    const score = await computeSddScore(root, { sddDir, feature });
    await emit(io, cwd, renderHtmlReport(trace, { generatedAt: new Date().toISOString(), score: score.total }), out);
    return 0;
  }

  // trace
  if (json) {
    io.log(JSON.stringify(trace, null, 2));
    return 0;
  }
  if (args.includes('--mermaid')) {
    await emit(io, cwd, renderMermaid(trace), out);
    return 0;
  }
  io.log(colors.bold(`Trazabilidad — ${feature}`));
  for (const req of trace.requirements) {
    const tasks = trace.tasks.filter((task) => task.requirements.includes(req.id));
    io.log(`  ${req.id.padEnd(14)} ${tasks.length > 0 ? tasks.map((task) => `${task.status === 'completed' ? '✓' : '○'}${task.id}`).join(' ') : colors.red('sin tarea')}  ${colors.dim(req.title)}`);
  }
  if (trace.unlinked.length > 0) io.log(colors.yellow(`  tareas sin requisito: ${trace.unlinked.join(', ')}`));
  io.log(colors.dim(`  ${trace.requirements.length} requisito(s) · ${trace.uncovered.length} sin cubrir · ${trace.tasks.length} tarea(s). Grafo: open-sdd trace ${feature} --mermaid`));
  return trace.uncovered.length > 0 ? 1 : 0;
};
