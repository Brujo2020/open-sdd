/**
 * Brownfield CLI surface: delta specs and the reverse-engineered constitution.
 *
 *   delta init|validate|status      the contract of change (ADSR, delta-scoped REQ-IDs)
 *   brownfield constitution|survey  the descriptive constitution and the repo facts behind it
 *
 * These commands exist because the brownfield unit is the DELTA, not the system: a command that
 * scaffolds and validates a delta makes the correct artifact the easy one.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { colors } from '../ui/colors.js';
import type { CliIO } from '../io.js';
import { scanProject } from '../../core/reverseEngineering.js';
import { buildDescriptiveConstitution, collectRepoFacts } from '../../core/reverseConstitution.js';
import { buildConstitutionDraft, constitutionArtifactPaths, RATIFY_INSTRUCTION } from '../../core/constitutionDraft.js';
import { auditIdsAgainstBase } from '../../core/stableIds.js';
import { parseConstitution, renderConstitution, validateConstitution, principlesInForce, resolveAuthority } from '../../core/constitution.js';
import {
  deltaCounts,
  deltaSpecFileName,
  mergeDeltaIntoBase,
  parseDeltaSpec,
  renderDeltaSpec,
  strangulationReport,
  traceDelta,
  validateDeltaSpec,
  type DeltaKind,
  type DeltaSpec,
} from '../../core/deltaSpec.js';
import { parseTasksMarkdown, resolveSddDir } from '../../core/specManager.js';
import { analyzeChangeImpact, forecastImpact, type ChangeImpactReport } from '../../core/changeImpact.js';
import { repairFromSpec } from '../../core/regeneration.js';
import { contractsFileName, extractContracts, testCommandFor, verifyContracts } from '../../core/executionContract.js';
import { REUSE_FIRST_RULE, findReuseCandidates } from '../../core/reuseFirst.js';
import { planBootstrap, writeCodeIntelligence } from '../../core/bootstrap.js';
import { adaptTemplates } from '../../core/templateAdaptation.js';
import { checkConsistency } from '../../core/consistency.js';
import { analyseConvergence, appendConvergence, convergeExitCode, type ConvergenceReport } from '../../core/converge.js';
import {
  analyseEars,
  deltaStatementText,
  earsEvidencePack,
  isEarsProposalApplicable,
  mergeEarsReports,
  renderEarsReport,
  type EarsReport,
  type EarsSuggestion,
} from '../../core/earsAssistant.js';
import { assist, renderAssist } from '../../core/assistants.js';
import {
  applyAnswers,
  clarifyQuestionsFile,
  planClarify,
  readClarifyAnswers,
  type ClarifyApplyReport,
  type ClarifyQuestion,
} from '../../core/clarify.js';
import {
  SPECIFY_QUESTIONS_FILE_KIND,
  applyConstitutionAnswers,
  existingRequirementStatements,
  normalizeRequirementStatement,
  planConstitutionInterview,
  requirementArea,
  specifyFromDescription,
} from '../../core/interview.js';
import { jsonEnvelope, type FindingInput } from '../jsonOut.js';

const heading = (t: string): string => colors.bold(colors.cyan(t));
const dim = (t: string): string => colors.dim(t);

const findRepoRoot = async (cwd: string): Promise<string> => {
  let dir = cwd;
  for (let i = 0; i < 6; i += 1) {
    if ((await stat(path.join(dir, '.sdd')).catch(() => null)) !== null) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return cwd;
};

const readIfExists = async (p: string): Promise<string | null> => readFile(p, 'utf8').catch(() => null);

/** El valor de un flag, aceptando `--flag valor` y `--flag=valor`. */
const flagValue = (args: string[], flag: string): string | undefined => {
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = args.findIndex((arg) => arg === flag);
  return index >= 0 ? args[index + 1] : undefined;
};

/** Los argumentos posicionales de `args` desde `from`, saltando los valores de los flags de valor. */
const positionalsOf = (args: string[], from: number, valueFlags: string[]): string[] => {
  const words = args.slice(from);
  const flags = new Set(valueFlags);
  return words.filter((arg, index) => {
    if (arg.startsWith('-')) return false;
    const previous = words[index - 1];
    return !(previous && flags.has(previous));
  });
};

/**
 * Un fichero de respuestas de la entrevista: `{ "<id>": "<respuesta>" }`. Se aceptan además la forma
 * `{ "answers": {…} }` y una lista de `{ id, answer }`, para que un host no tenga que adivinar.
 */
const normalizeInterviewAnswers = (parsed: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  const take = (source: unknown): void => {
    if (!source || typeof source !== 'object') return;
    if (Array.isArray(source)) {
      for (const item of source) {
        if (!item || typeof item !== 'object') continue;
        const entry = item as Record<string, unknown>;
        const id = typeof entry.id === 'string' ? entry.id : undefined;
        const answer = entry.answer ?? entry.value;
        if (id && (typeof answer === 'string' || typeof answer === 'number' || typeof answer === 'boolean')) {
          out[id] = String(answer);
        }
      }
      return;
    }
    for (const [id, value] of Object.entries(source as Record<string, unknown>)) {
      if (id === 'answers' && value && typeof value === 'object') {
        take(value);
        continue;
      }
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        out[id] = String(value);
      }
    }
  };
  take(parsed);
  return out;
};

/**
 * The change under analysis, from either boundary.
 *
 * Locally that is the working tree plus the index; in CI the tree is clean and the change is the
 * pull request, so `--base <ref>` diffs against the base commit. Without this the CI step would
 * inspect nothing and pass — the exact "activation without measurement" this tool exists to catch.
 */
const changedFilesFor = (root: string, base?: string): { files: string[]; source: string } => {
  if (base) {
    const result = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`], {
      cwd: root,
      encoding: 'utf8',
    });
    if (result.status !== 0) return { files: [], source: `diff contra ${base} (falló)` };
    return {
      files: result.stdout.split('\n').map((l) => l.trim()).filter(Boolean),
      source: `diff contra ${base}`,
    };
  }

  // `--untracked-files=all`: without it git reports an untracked DIRECTORY as a single entry, and a
  // directory path reaches the file readers downstream (EISDIR) and is counted as a changed file.
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) return { files: [], source: 'árbol de trabajo (git no disponible)' };
  const files = result.stdout
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3).trim())
    .map((line) => (line.includes(' -> ') ? line.split(' -> ').pop()!.trim() : line))
    .filter((line) => line.length > 0 && !line.endsWith('/'))
    .filter((file) => {
      try {
        return statSync(path.join(root, file)).isFile();
      } catch {
        return false;
      }
    });
  return { files, source: 'árbol de trabajo e índice' };
};

const deltaPath = (root: string, feature: string): string =>
  path.join(root, '.sdd', 'specs', feature, deltaSpecFileName());

const firstSpec = async (root: string): Promise<string | null> => {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(path.join(root, '.sdd', 'specs')).catch(() => [] as string[]);
  return entries.find((e) => !e.startsWith('.')) ?? null;
};

// ---------------------------------------------------------------------------------------------
// delta
// ---------------------------------------------------------------------------------------------

const deltaTemplate = (feature: string, title: string, base?: string): string => `# Delta: ${feature} — ${title}

Status: proposed
${base ? `Base: ${base}\n` : ''}
<!--
Una delta describe SOLO lo que cambia (ADSR): ADDED, MODIFIED, REMOVED, RENAMED.
Cada entrada lleva un identificador propio del cambio: REQ-<AREA>-<NNN> (p. ej. REQ-AUTH-001),
nunca un identificador del sistema completo: eso es lo que mantiene finita la obligación.

Plantilla de entrada (descomenta y rellena):

### REQ-AUTH-001 — Título corto del cambio
- Statement: WHEN <disparo>, the <sistema> shall <respuesta>.
- Previous: comportamiento actual que se sustituye (obligatorio en MODIFIED, REMOVED, RENAMED).
- Targets: src/auth/session.ts, POST /sessions
- Contracts: test/auth.test.ts::issues a session   (obligatorio en REMOVED; recomendado en MODIFIED)
- Rationale: por qué se retira y cómo migran sus consumidores (obligatorio en REMOVED).
- Strangler: legacy | both | new

Principio rector: no "mejores" la arquitectura existente durante el descubrimiento. Refleja lo que
hay; las mejoras vienen después, como cambios explícitos y gobernados.
-->

## ADDED

## MODIFIED

## REMOVED

## RENAMED
`;

export const handleDeltaCommand = async (args: string[], io: CliIO, cwd: string): Promise<number> => {
  const sub = args[0] ?? 'status';
  const root = await findRepoRoot(cwd);
  const positional = args.slice(1).filter((a) => !a.startsWith('-'));
  const feature = positional[0] ?? (await firstSpec(root));

  if (!feature) {
    io.error(colors.red('No hay especificación. Pasa un nombre de feature o crea una spec primero.'));
    return 1;
  }

  if (sub === 'init') {
    const title = positional.slice(1).join(' ') || feature;
    const baseIdx = args.findIndex((a) => a === '--base');
    const base = baseIdx >= 0 ? args[baseIdx + 1] : undefined;
    const target = deltaPath(root, feature);

    if ((await stat(target).catch(() => null)) !== null && !args.includes('--force')) {
      io.error(colors.red(`Ya existe ${path.relative(root, target)}. Usa --force para sobrescribirlo.`));
      return 1;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, deltaTemplate(feature, title, base), 'utf8');
    io.log('');
    io.log(`  ${colors.green('✓')} delta creada: ${path.relative(root, target)}`);
    io.log(dim('    Rellena las secciones ADSR. El identificador de cada entrada es REQ-<AREA>-<NNN>.'));
    io.log('');
    return 0;
  }

  const raw = await readIfExists(deltaPath(root, feature));
  if (raw === null) {
    io.error(
      colors.red(
        `No hay delta para "${feature}". Créala con: open-sdd delta init ${feature} "<título del cambio>"`,
      ),
    );
    return 1;
  }

  const delta: DeltaSpec = parseDeltaSpec(raw);
  const counts = deltaCounts(delta);
  const strangler = strangulationReport(delta);
  const tasksRaw = await readIfExists(path.join(root, '.sdd', 'specs', feature, 'tasks.md'));
  const trace = tasksRaw === null ? null : traceDelta(delta, parseTasksMarkdown(tasksRaw));

  if (sub === 'status') {
    io.log('');
    io.log(heading(`Delta: ${delta.feature} — ${delta.title}`));
    io.log(`  estado: ${delta.status}${delta.base ? ` · base: ${delta.base}` : ''}`);
    io.log('');
    io.log(
      `  ADDED ${counts.ADDED} · MODIFIED ${counts.MODIFIED} · REMOVED ${counts.REMOVED} · RENAMED ${counts.RENAMED}  (total ${delta.entries.length})`,
    );
    io.log(`  ${dim(strangler.detail)}`);
    if (trace) io.log(`  Trazabilidad: ${trace.detail}`);
    io.log('');
    return 0;
  }

  if (sub === 'validate') {
    const issues = validateDeltaSpec(delta);
    const errors = issues.filter((i) => i.severity === 'error');
    const warnings = issues.filter((i) => i.severity === 'warning');

    io.log('');
    io.log(heading(`Validación de la delta — ${delta.feature}`));
    io.log('');
    if (delta.entries.length === 0) {
      io.log(`  ${colors.yellow('!')} La delta no tiene entradas todavía: rellena las secciones ADSR.`);
    }
    for (const issue of [...errors, ...warnings]) {
      const mark = issue.severity === 'error' ? colors.red('error') : colors.yellow('aviso');
      io.log(`  ${mark.padEnd(18)} ${issue.id.padEnd(16)} ${issue.code}`);
      io.log(`      ${dim(issue.message)}`);
    }
    if (issues.length === 0) {
      io.log(`  ${colors.green('La delta es válida')}: identificadores, EARS, objetivos y contratos en orden.`);
    }
    io.log('');
    io.log(`  ${errors.length} error(es), ${warnings.length} aviso(s).`);
    if (trace) {
      io.log(`  Trazabilidad: ${trace.detail}`);
      if (trace.unmapped.length > 0) {
        io.log(`  ${colors.yellow('!')} Requisitos de la delta sin tarea: ${trace.unmapped.join(', ')}`);
      }
      if (trace.phantomTasks.length > 0) {
        io.log(
          `  ${colors.yellow('!')} Tareas que citan ids inexistentes: ${trace.phantomTasks.map((p) => `${p.taskId}→${p.cited}`).join(', ')}`,
        );
      }
    }
    // El asistente APARECE donde ya está la ambigüedad: junto a los hallazgos que este comando
    // acaba de imprimir. No cambia el veredicto (abajo) y solo propone; nunca reescribe la delta.
    if (issues.length > 0 || (trace?.unfilledPlaceholders.length ?? 0) > 0) {
      const assistant = await assist({
        cwd: root,
        feature,
        sddDir: await resolveSddDir(root),
        findings: [
          ...issues.map((issue) => ({ code: issue.code, artifact: issue.id })),
          ...(trace?.unfilledPlaceholders ?? []).map((placeholder) => ({
            code: placeholder.code,
            artifact: placeholder.cited,
          })),
        ],
      });
      for (const line of renderAssist(assistant.suggestions)) io.log(dim(`  ${line}`));
    }
    io.log('');
    return errors.length > 0 ? 1 : 0;
  }

  if (sub === 'render') {
    io.log(renderDeltaSpec(delta));
    return 0;
  }

  if (sub === 'merge' || sub === 'merge-back') {
    // The label `merged` stops being something the author types: this is the command that actually
    // rewrites the base specification, and it refuses to write anything without `--write`.
    const write = args.includes('--write');
    const json = args.includes('--json');
    // The delta may declare a different base (`Base: <feature>`); honour it when that spec exists,
    // otherwise merge into the feature's own requirements.md.
    const declaredBase = delta.base?.trim();
    const declaredBasePath = declaredBase
      ? path.join(root, '.sdd', 'specs', declaredBase, 'requirements.md')
      : null;
    const basePath =
      declaredBasePath && (await stat(declaredBasePath).catch(() => null)) !== null
        ? declaredBasePath
        : path.join(root, '.sdd', 'specs', feature, 'requirements.md');
    const baseRaw = await readIfExists(basePath);
    if (baseRaw === null) {
      io.error(colors.red(`No hay ${path.relative(root, basePath)}: no hay especificación base que reescribir.`));
      return 1;
    }

    const report = mergeDeltaIntoBase(delta, baseRaw);

    if (report.refusals.length > 0) {
      if (json) {
        io.log(
          JSON.stringify(
            { feature: report.feature, changed: false, applied: [], unchanged: report.unchanged, refusals: report.refusals, detail: report.detail, written: false },
            null,
            2,
          ),
        );
        return 1;
      }
      io.log('');
      io.log(heading(`Fusión de la delta — ${delta.feature}`));
      io.log('');
      for (const change of report.changes) io.log(`  ${colors.red('rechazada').padEnd(18)} ${change.id.padEnd(16)} ${change.message}`);
      io.log('');
      io.log(`  ${colors.red(report.detail)}`);
      io.log('');
      return 1;
    }

    if (!write) {
      if (json) {
        io.log(
          JSON.stringify(
            { feature: report.feature, changed: report.changed, applied: report.applied, unchanged: report.unchanged, refusals: [], detail: report.detail, written: false },
            null,
            2,
          ),
        );
        return 0;
      }
      io.log('');
      io.log(heading(`Fusión de la delta — ${delta.feature}`));
      io.log('');
      for (const change of report.changes) {
        const mark = change.outcome === 'unchanged' ? colors.dim('sin cambios') : colors.green(change.outcome);
        io.log(`  ${mark.padEnd(18)} ${change.id.padEnd(16)} ${change.message}`);
      }
      io.log('');
      io.log(`  ${report.changed ? dim(report.detail) : colors.green(report.detail)}`);
      io.log(dim('  Solo resumen: añade --write para escribir requirements.md y marcar la delta como merged. Nada se ha escrito.'));
      io.log('');
      return 0;
    }

    if (!report.changed) {
      if (json) {
        io.log(
          JSON.stringify(
            { feature: report.feature, changed: false, applied: [], unchanged: report.unchanged, refusals: [], detail: report.detail, written: false },
            null,
            2,
          ),
        );
        return 0;
      }
      io.log('');
      io.log(`  ${colors.green(report.detail)}`);
      io.log('');
      return 0;
    }

    // The write happened: only now is it honest to mark the entries as merged.
    await writeFile(basePath, report.text, 'utf8');
    const appliedIds = new Set(report.applied.map((change) => change.id));
    const merged: DeltaSpec = {
      ...delta,
      status: 'merged',
      entries: delta.entries.map((entry) => (appliedIds.has(entry.id) ? { ...entry, merged: true } : entry)),
    };
    await writeFile(deltaPath(root, feature), renderDeltaSpec(merged), 'utf8');

    if (json) {
      io.log(
        JSON.stringify(
          {
            feature: report.feature,
            changed: true,
            applied: report.applied,
            unchanged: report.unchanged,
            refusals: [],
            detail: report.detail,
            written: true,
            base: path.relative(root, basePath).split(path.sep).join('/'),
            delta: path.relative(root, deltaPath(root, feature)).split(path.sep).join('/'),
          },
          null,
          2,
        ),
      );
      return 0;
    }

    io.log('');
    io.log(heading(`Fusión de la delta — ${delta.feature}`));
    io.log('');
    for (const change of report.changes) {
      const mark = change.outcome === 'unchanged' ? colors.dim('sin cambios') : colors.green(change.outcome);
      io.log(`  ${mark.padEnd(18)} ${change.id.padEnd(16)} ${change.message}`);
    }
    io.log('');
    io.log(`  ${colors.green('✓')} ${path.relative(root, basePath)} reescrito (${report.applied.length} entrada(s))`);
    io.log(`  ${colors.green('✓')} delta marcada como merged: ${appliedIds.size} entrada(s) con Merged: true`);
    io.log(`  ${dim(report.detail)}`);
    io.log('');
    return 0;
  }

  io.log(`Subcomando desconocido: ${sub}. Usa: init | validate | status | render | merge [--write] [--json]`);
  return 1;
};

// ---------------------------------------------------------------------------------------------
// brownfield
// ---------------------------------------------------------------------------------------------

/**
 * `brownfield ids <feature> --base <ref>` — el centinela de identificadores estables.
 *
 * Un `REQ-AREA-014` es una cita: si insertar un requisito renumera los siguientes, cada cita pasa a
 * significar otra cosa en silencio. Esto compara los ids y sus enunciados contra la base y reporta
 * `ID-MUTATED` (mismo id, otro significado) e `ID-LOST` (el id desapareció). La delta es el canal
 * para declararlo, así que un hallazgo no es un error del cambio: es un cambio sin declarar.
 *
 * Códigos de salida del contrato: 2 si falta la feature o la base, o si la base no se pudo leer
 * (no se puede auditar); 1 si hay hallazgos; 0 si no hay nada que declarar.
 */
const handleIdsAudit = async (args: string[], io: CliIO, root: string): Promise<number> => {
  const positional = args.filter((a) => !a.startsWith('-'));
  const feature = positional[0] === 'audit' ? positional[1] : positional[0];
  const inline = args.find((a) => a.startsWith('--base='));
  const baseIdx = args.findIndex((a) => a === '--base');
  const base = inline ? inline.slice('--base='.length) : baseIdx >= 0 ? args[baseIdx + 1] : undefined;
  const json = args.includes('--json');

  if (!feature || !base) {
    io.error(colors.red('error[usage]: `brownfield ids <feature> --base <ref>` necesita la feature y la base.'));
    io.error('  = help: open-sdd brownfield ids tool-maturity --base main');
    return 2;
  }

  const rel = path.posix.join('.sdd', 'specs', feature, 'requirements.md');
  const afterText = await readFile(path.join(root, rel), 'utf8').catch(() => null);
  const report = auditIdsAgainstBase({ cwd: root, base, requirementsRelPath: rel, afterText });

  if (json) {
    io.log(
      JSON.stringify(
        {
          ok: report.findings.length === 0 && report.problems.length === 0,
          command: 'brownfield ids',
          data: { feature, base, ...report },
        },
        null,
        2,
      ),
    );
  } else {
    io.log(colors.bold(`Ids de "${feature}" contra ${base}`));
    io.log(`  ${report.beforeCount} id(s) en la base · ${report.afterCount} en el árbol de trabajo`);
    for (const problem of report.problems) io.log(`  ${colors.yellow('!')} ${problem}`);
    for (const finding of report.findings) io.log(`  ${colors.red('✗')} ${finding.code} ${finding.id} — ${finding.detail}`);
    if (report.problems.length === 0 && report.findings.length === 0) {
      io.log(`  ${colors.green('✓')} ningún id cambió de significado ni desapareció sin declararlo`);
    }
  }

  if (report.problems.length > 0) return 2;
  return report.findings.length > 0 ? 1 : 0;
};

export const handleBrownfieldCommand = async (args: string[], io: CliIO, cwd: string): Promise<number> => {
  const sub = args[0] ?? 'survey';
  const positional = args.slice(1).filter((a) => !a.startsWith('-'));
  const target = positional[0] ? path.resolve(cwd, positional[0]) : await findRepoRoot(cwd);

  if (sub === 'ids') {
    return handleIdsAudit(args.slice(1), io, await findRepoRoot(cwd));
  }

  if (sub === 'bootstrap') {
    // El positional de `bootstrap` es una RUTA (como en survey/constitution), no un nombre de
    // feature: `target` ya resuelve `positional[0]` o, en su ausencia, la raíz del repositorio.
    const focusFlag = args.find((a) => a.startsWith('--focus='));
    const focusIdx = args.findIndex((a) => a === '--focus');
    const focus = focusFlag ? focusFlag.slice('--focus='.length) : focusIdx >= 0 ? args[focusIdx + 1] : undefined;
    const json = args.includes('--json');
    const write = args.includes('--write');

    const plan = await planBootstrap({ cwd: target, ...(focus ? { focus } : {}) });

    const failures: string[] = [];
    let intelligence: Awaited<ReturnType<typeof writeCodeIntelligence>> | null = null;
    let constitutionCreated = false;
    /** Written by `--write` because the plan promised it; reported so the plan and reality agree. */
    let deltaCreated: string | null = null;
    let deltaKept: string | null = null;
    if (write) {
      intelligence = await writeCodeIntelligence({ cwd: target, modules: plan.modules, write: true });
      if (!intelligence.written) failures.push(`no se pudo escribir ${intelligence.path}`);

      const sddDir = await resolveSddDir(target);

      // The plan lists the delta seed with action `create`, so `--write` must actually create it.
      // It reuses the same scaffold as `delta init` instead of a second template.
      if (focus) {
        const slug = focus
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
        if (slug.length > 0) {
          const deltaFile = path.join(target, sddDir, 'specs', slug, 'delta.md');
          if ((await stat(deltaFile).catch(() => null)) === null) {
            try {
              await mkdir(path.dirname(deltaFile), { recursive: true });
              await writeFile(deltaFile, deltaTemplate(slug, focus), 'utf8');
              deltaCreated = path.posix.join(sddDir, 'specs', slug, 'delta.md');
            } catch (error) {
              failures.push(`no se pudo escribir ${path.posix.join(sddDir, 'specs', slug, 'delta.md')} (${(error as Error).message})`);
            }
          } else {
            deltaKept = path.posix.join(sddDir, 'specs', slug, 'delta.md');
          }
        }
      }

      const constitutionFile = path.join(target, sddDir, 'steering', 'constitution.md');
      if ((await stat(constitutionFile).catch(() => null)) === null) {
        try {
          const project = await scanProject(target);
          const facts = await collectRepoFacts(target, project);
          const { constitution } = buildDescriptiveConstitution(facts);
          await mkdir(path.dirname(constitutionFile), { recursive: true });
          await writeFile(constitutionFile, renderConstitution(constitution), 'utf8');
          constitutionCreated = true;
        } catch (error) {
          failures.push(
            `no se pudo escribir ${path.posix.join(sddDir, 'steering', 'constitution.md')} (${(error as Error).message})`,
          );
        }
      }
    }

    if (json) {
      io.log(JSON.stringify(plan, null, 2));
      return failures.length > 0 ? 1 : 0;
    }

    io.log('');
    io.log(heading(`Bootstrap brownfield — ${plan.project.name}`));
    io.log('');
    io.log(`  raíz: ${plan.root}`);
    io.log(
      `  stack: ${plan.project.language}${plan.project.frameworks.length > 0 ? ` · ${plan.project.frameworks.join(', ')}` : ''}${plan.project.testFramework ? ` · tests: ${plan.project.testFramework}` : ''}`,
    );
    io.log('');
    io.log(`  ${colors.bold(`Mapa de módulos (${plan.modules.length})`)}`);
    for (const module of plan.modules) {
      io.log(`    ${colors.bold(module.path)}  ${dim(module.name)}`);
      io.log(`      posee: ${module.owns.length > 0 ? module.owns.join(', ') : dim('(sin directorios observados)')}`);
      io.log(
        `      responsabilidades: ${
          module.responsibilities.length > 0 ? module.responsibilities.join(' · ') : dim('(ninguna derivable de la evidencia)')
        }`,
      );
      io.log(`      depende de: ${module.dependsOn.length > 0 ? module.dependsOn.join(', ') : dim('(ninguno observado)')}`);
      if (module.testDirs.length > 0) io.log(`      tests: ${module.testDirs.join(', ')}`);
    }
    io.log('');
    io.log(`  ${colors.bold('Artefactos')}`);
    for (const artifact of plan.artifacts) {
      const mark =
        artifact.action === 'create'
          ? colors.green(artifact.action)
          : artifact.action === 'update'
            ? colors.yellow(artifact.action)
            : colors.dim(artifact.action);
      io.log(`    ${mark.padEnd(18)} ${artifact.path}`);
      io.log(`        ${dim(artifact.reason)}`);
    }
    io.log('');
    io.log(`  ${colors.bold('Pasos')}`);
    plan.steps.forEach((step, index) => io.log(`    ${index + 1}. ${step}`));
    io.log('');
    io.log(`  ${plan.complete ? colors.green(plan.detail) : colors.yellow(plan.detail)}`);

    if (write) {
      io.log('');
      if (intelligence?.written) {
        io.log(
          `  ${colors.green('✓')} ${intelligence.path} escrito (${intelligence.complete ? 'evidencia completa' : 'evidencia parcial'})`,
        );
      }
      if (constitutionCreated) {
        io.log(`  ${colors.green('✓')} constitución creada desde el código`);
      } else {
        io.log(dim('  = constitución existente: se conserva (no se sobrescribe)'));
      }
      if (deltaCreated) {
        io.log(`  ${colors.green('✓')} semilla de delta creada en ${deltaCreated}`);
      } else if (deltaKept) {
        io.log(dim(`  = semilla de delta existente en ${deltaKept}: se conserva`));
      }
      for (const failure of failures) io.log(`  ${colors.red('✗')} ${failure}`);
    } else {
      io.log('');
      io.log(dim('  Añade --write para escribir el documento de inteligencia y generar la constitución si falta.'));
    }
    io.log('');
    return failures.length > 0 ? 1 : 0;
  }

  if (sub === 'templates') {
    // Plantillas adaptadas al stack observado: el positional es una RUTA (como en survey/bootstrap).
    const write = args.includes('--write');
    const json = args.includes('--json');
    const result = await adaptTemplates({ cwd: target, write });

    if (json) {
      io.log(JSON.stringify(result, null, 2));
      return result.complete ? 0 : 1;
    }

    io.log('');
    io.log(heading(`Plantillas adaptadas — ${path.basename(target) || target}`));
    io.log('');
    io.log(`  ${dim(result.detail)}`);
    io.log('');
    for (const template of result.templates) {
      const action = result.actions.find((candidate) => candidate.path === template.path);
      const mark = action?.action === 'keep' ? colors.dim('keep') : colors.green('create');
      io.log(`  ${colors.bold(template.kind.padEnd(13))} ${mark.padEnd(18)} ${template.path}`);
      io.log(`      ${dim(template.rationale)}`);
      for (const evidence of template.adaptedFrom) io.log(`        ${dim(`adaptado: ${evidence}`)}`);
      for (const item of template.unchanged) io.log(`        ${colors.yellow('sin observar:')} ${item}`);
      io.log('');
      io.log(dim(`── ${template.kind} ──`));
      io.log(template.content.replace(/\n$/, ''));
      io.log('');
    }
    if (write) {
      for (const written of result.written) io.log(`  ${colors.green('✓')} escrita ${written}`);
      const kept = result.actions.filter((item) => item.action === 'keep');
      for (const item of kept) io.log(dim(`  = ${item.path} existía: se conserva`));
    } else {
      io.log(dim('  Añade --write para escribirlas en .sdd/settings/templates/brownfield/ (nunca sobrescribe una plantilla existente).'));
    }
    io.log('');
    return result.complete ? 0 : 1;
  }

  if (sub === 'analyze') {
    // Una sola pasada: requisitos↔tareas, objetivos de la delta↔diff, pivote constitucional,
    // contratos declarados y fronteras contra el código.
    const root = await findRepoRoot(cwd);
    const feature = positional[0] ?? (await firstSpec(root));
    if (!feature) {
      io.error(colors.red('No hay especificación que analizar. Pasa un nombre de feature.'));
      return 1;
    }
    const baseIdx = args.findIndex((a) => a === '--base');
    const base = baseIdx >= 0 ? args[baseIdx + 1] : undefined;
    const derived = changedFilesFor(root, base);
    const gitUsable = !/no disponible|falló/.test(derived.source);
    const report = await checkConsistency({
      cwd: root,
      feature,
      ...(gitUsable ? { changedFiles: derived.files } : {}),
    });

    if (args.includes('--json')) {
      io.log(JSON.stringify(report, null, 2));
      return report.findings.some((finding) => finding.severity === 'error') ? 1 : 0;
    }

    io.log('');
    io.log(heading(`Consistencia cruzada — ${report.feature}`));
    io.log('');
    if (report.findings.length === 0) {
      io.log(`  ${colors.green('Sin hallazgos')} en lo inspeccionado.`);
    }
    for (const finding of report.findings) {
      const mark =
        finding.severity === 'error'
          ? colors.red('error')
          : finding.severity === 'warning'
            ? colors.yellow('aviso')
            : colors.dim('info');
      io.log(`  ${mark.padEnd(18)} ${finding.code.padEnd(26)} ${finding.message}`);
      if (finding.artifacts.length > 0) io.log(`      ${dim(`artefactos: ${finding.artifacts.join(', ')}`)}`);
    }
    io.log('');
    io.log(`  ${colors.bold('Comprobado')} (${report.checked.length}):`);
    for (const item of report.checked) io.log(`    ✓ ${item}`);
    if (report.notChecked.length > 0) {
      io.log(`  ${colors.bold('NO comprobado')} (${report.notChecked.length}) — no cuenta como aprobado:`);
      for (const item of report.notChecked) io.log(`    ${colors.yellow('!')} ${item}`);
    }
    io.log('');
    io.log(`  ${report.complete ? colors.green(report.detail) : colors.yellow(report.detail)}`);
    io.log('');
    return report.findings.some((finding) => finding.severity === 'error') ? 1 : 0;
  }

  if (sub === 'survey' || sub === 'constitution') {
    // LA ENTREVISTA de constitución (en lenguaje natural y sin TTY): se añade `--interview` al
    // subcomando `constitution` que ya existía. Sin `--answers` imprime las preguntas y lo que la
    // evidencia YA decidió (por eso no se pregunta); con `--answers <path>` aplica las respuestas y
    // produce un BORRADOR validado. `--write` lo guarda en `constitution.draft.md` y NUNCA toca
    // `constitution.md`: la autoridad solo la da `govern constitution --ratify`.
    if (sub === 'constitution' && args.includes('--interview')) {
      const json = args.includes('--json');
      const interviewPositionals = positionalsOf(args, 1, ['--answers']);
      const interviewTarget = interviewPositionals[0]
        ? path.resolve(cwd, interviewPositionals[0])
        : await findRepoRoot(cwd);
      const answersPath = flagValue(args, '--answers');
      const interview = await planConstitutionInterview(interviewTarget, { sddDir: '.sdd' });

      if (answersPath) {
        const absolute = path.resolve(cwd, answersPath);
        const rawAnswers = await readIfExists(absolute);
        if (rawAnswers === null) {
          io.error(colors.red(`No se puede leer el fichero de respuestas: ${absolute}`));
          return 1;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawAnswers);
        } catch {
          io.error(colors.red(`El fichero de respuestas no es JSON válido: ${absolute}`));
          return 1;
        }
        const answers = normalizeInterviewAnswers(parsed);
        if (Object.keys(answers).length === 0) {
          io.error(colors.red('El fichero de respuestas no contiene ninguna respuesta reconocible (objeto { "<id>": "<texto>" }).'));
          return 1;
        }

        const application = await applyConstitutionAnswers({ answers, interview, cwd: interviewTarget });
        // La severidad la aporta el validador compartido sobre el texto producido: `issues` del core
        // es el contrato sin severidad, y el veredicto de esta puerta no puede depender de la forma.
        const blocking = validateConstitution(parseConstitution(application.text)).filter(
          (issue) => issue.severity === 'error',
        );
        const paths = constitutionArtifactPaths(interviewTarget);
        const write = args.includes('--write');
        let draftPath: string | null = null;
        if (write) {
          await mkdir(path.dirname(paths.draft), { recursive: true });
          await writeFile(paths.draft, application.text, 'utf8');
          draftPath = path.relative(interviewTarget, paths.draft).split(path.sep).join('/');
        }

        if (json) {
          io.log(
            JSON.stringify(
              jsonEnvelope({
                command: 'brownfield constitution --interview',
                data: {
                  interview,
                  answers,
                  applied: application.applied,
                  unanswered: application.unanswered,
                  issues: application.issues,
                  blocking: blocking.map((issue) => ({ id: issue.code ?? issue.id, message: issue.message })),
                  written: draftPath !== null,
                  draft: draftPath,
                  inForceTouched: false,
                  text: application.text,
                },
                errors: blocking.map((issue) => ({ id: issue.code ?? issue.id, message: issue.message })),
                ok: blocking.length === 0,
                detail:
                  draftPath !== null
                    ? `Borrador escrito en ${draftPath} (NO en vigor; constitution.md no se ha tocado).`
                    : 'Borrador producido en memoria: añade --write para guardarlo en constitution.draft.md (nunca toca constitution.md).',
              }),
              null,
              2,
            ),
          );
          return blocking.length > 0 ? 1 : 0;
        }

        io.log('');
        io.log(heading(`Entrevista de constitución — ${interview.project}`));
        io.log('');
        io.log(`  ${colors.bold('Respuestas aplicadas')} (${application.applied.length}):`);
        if (application.applied.length === 0) io.log(dim('    (ninguna)'));
        for (const entry of application.applied) io.log(`    ${colors.green('✓')} ${entry.id} → ${entry.principle}`);
        if (application.unanswered.length > 0) {
          io.log(`  ${colors.bold('Sin responder o no reconocidas')} (${application.unanswered.length}) ${dim('— no cuentan como decisiones')}:`);
          for (const id of application.unanswered) io.log(`    ${colors.yellow('?')} ${id}`);
        }
        io.log('');
        for (const issue of application.issues) io.log(`  ${dim(issue.code)}: ${dim(issue.message)}`);
        if (blocking.length > 0) {
          io.log('');
          io.log(`  ${colors.red(`${blocking.length} error(es) BLOQUEAN la ratificación`)}: el borrador se produce igual y el defecto no se oculta.`);
        }
        io.log('');
        if (write && draftPath !== null) {
          io.log(`  ${colors.green('✓')} borrador escrito en ${draftPath} (NO en vigor)`);
          const inForce = await readIfExists(paths.inForce);
          if (inForce !== null) {
            io.log(
              `  ${colors.yellow('!')} ${path.relative(interviewTarget, paths.inForce)} existe y no se ha tocado: solo --ratify lo sustituye.`,
            );
          }
          io.log('');
          io.log(dim(`  Autoridad: ${RATIFY_INSTRUCTION}`));
        } else {
          io.log(dim('  El borrador no se escribe: añade --write para guardarlo en .sdd/steering/constitution.draft.md (nunca toca constitution.md). A continuación se imprime el texto producido.'));
          io.log('');
          io.log(application.text);
        }
        io.log('');
        return blocking.length > 0 ? 1 : 0;
      }

      if (json) {
        io.log(
          JSON.stringify(
            jsonEnvelope({
              command: 'brownfield constitution --interview',
              data: interview,
              detail: interview.detail,
            }),
            null,
            2,
          ),
        );
        return 0;
      }

      io.log('');
      io.log(heading(`Entrevista de constitución — ${interview.project}`));
      io.log('');
      io.log(`  ${colors.bold('Decidido por evidencia (NO se pregunta)')} (${interview.decidedByEvidence.length}):`);
      for (const item of interview.decidedByEvidence) io.log(`    · ${item}`);
      io.log('');
      io.log(`  ${colors.bold('Preguntas que la evidencia no puede responder')} (${interview.questions.length}):`);
      for (const question of interview.questions) {
        io.log(`    ${colors.bold(question.id)} ${question.question}`);
        io.log(`        ${dim(`por qué: ${question.why}`)}`);
        if (question.default !== undefined) io.log(`        ${dim(`por defecto: ${question.default}`)}`);
        if (question.options) io.log(`        ${dim(`opciones: ${question.options.join(' | ')}`)}`);
        if (question.fromEvidence) io.log(`        ${dim(`de la evidencia: ${question.fromEvidence}`)}`);
      }
      io.log('');
      io.log(`  ${dim(interview.detail)}`);
      io.log('');
      io.log(dim('  Responde en un fichero JSON { "<id>": "<respuesta>" } y ejecuta:'));
      io.log(dim('  open-sdd brownfield constitution . --interview --answers <path> --write'));
      io.log('');
      return 0;
    }

    // `--draft` is handled BEFORE the descriptive constitution is built: the draft is a proposal, not
    // an authoritative artifact, and it must not inherit the "in force" reading of the flow below.
    if (sub === 'constitution' && args.includes('--draft')) {
      const write = args.includes('--write');
      const draft = await buildConstitutionDraft(target, { sddDir: '.sdd' });
      const draftIssues = validateConstitution(parseConstitution(draft.text));

      io.log('');
      io.log(heading(`Borrador de constitución — ${draft.project}`));
      io.log('');
      io.log(
        `  ${draft.complete ? colors.green('sin preguntas abiertas') : colors.yellow('INCOMPLETO')} ${dim('(NO en vigor: falta la ratificación de una persona nombrada)')}`,
      );
      io.log(`  ${dim(draft.detail)}`);
      io.log('');
      for (const proposal of draft.proposals) {
        const state = proposal.needsHumanDecision ? colors.yellow('pregunta') : colors.green('propuesta');
        io.log(
          `  ${colors.bold(proposal.principle.id.padEnd(22))} ${proposal.principle.level.padEnd(7)} ${state.padEnd(12)} ${proposal.principle.restriction.split('\n')[0].slice(0, 76)}`,
        );
        io.log(`      ${dim(`evidencia: ${proposal.evidence.length}`)}`);
      }
      if (draft.questions.length > 0) {
        io.log('');
        io.log(`  ${colors.bold('Preguntas para el humano')} ${dim('(prácticas que el código NO muestra; no son principios)')}:`);
        for (const question of draft.questions) io.log(`    · ${question}`);
      }
      io.log('');
      for (const issue of draftIssues) {
        const mark = issue.severity === 'error' ? colors.red('error') : colors.yellow('aviso');
        io.log(`  ${mark} ${issue.id}: ${dim(issue.message)}`);
      }

      if (!write) {
        io.log('');
        io.log(dim('  Añade --write para escribir el borrador en .sdd/steering/constitution.draft.md (plan only, nada escrito).'));
        io.log('');
        return 0;
      }

      const paths = constitutionArtifactPaths(target);
      await mkdir(path.dirname(paths.draft), { recursive: true });
      const inForce = await readIfExists(paths.inForce);
      await writeFile(paths.draft, draft.text, 'utf8');
      io.log('');
      io.log(`  ${colors.green('✓')} borrador escrito en ${path.relative(target, paths.draft)} (NO en vigor)`);
      if (inForce !== null) {
        io.log(
          `  ${colors.yellow('!')} ${path.relative(target, paths.inForce)} existe y no se ha tocado: el borrador va al lado y solo --ratify lo sustituye.`,
        );
      }
      io.log('');
      return draftIssues.some((issue) => issue.severity === 'error') ? 1 : 0;
    }

    const project = await scanProject(target);
    const facts = await collectRepoFacts(target, project);
    const { constitution, detected, deferred } = buildDescriptiveConstitution(facts);
    const issues = validateConstitution(constitution);

    if (sub === 'survey') {
      io.log('');
      io.log(heading(`Reconocimiento — ${project.name}`));
      io.log('');
      io.log(`  lenguaje: ${project.language}`);
      if (project.frameworks.length > 0) io.log(`  frameworks: ${project.frameworks.join(', ')}`);
      if (project.packageManager) io.log(`  gestor de paquetes: ${project.packageManager}`);
      if (project.buildTool) io.log(`  build: ${project.buildTool}`);
      if (project.testFramework) io.log(`  tests: ${project.testFramework}`);
      if (project.modules.length > 0) io.log(`  módulos (${project.modules.length}): ${project.modules.slice(0, 10).join(', ')}`);
      io.log('');
      io.log(`  ${colors.bold('Evidencia recogida')} (${detected.length}):`);
      for (const item of detected) io.log(`    · ${item}`);
      if (deferred.length > 0) {
        io.log('');
        io.log(`  ${colors.bold('Deseado pero no observado')} → va como enmienda propuesta, nunca como hecho:`);
        for (const item of deferred) io.log(`    · ${item}`);
      }
      io.log('');
      io.log(
        dim(
          '  Principio rector: no mejores la arquitectura durante el descubrimiento. Refleja lo que hay; las mejoras vienen después como cambios gobernados.',
        ),
      );
      io.log('');
      return 0;
    }

    const rendered = renderConstitution(constitution);
    const write = args.includes('--write');
    io.log('');
    io.log(heading(`Constitución reversa — ${project.name}`));
    io.log('');
    io.log(`  principios en vigor: ${principlesInForce(constitution).length} · enmiendas propuestas: ${constitution.amendments.length}`);
    for (const issue of issues) {
      const mark = issue.severity === 'error' ? colors.red('error') : colors.yellow('aviso');
      io.log(`  ${mark} ${issue.id}: ${dim(issue.message)}`);
    }
    io.log('');
    for (const p of constitution.principles) {
      io.log(`  ${colors.bold(p.id)} (${p.level}) — ${p.title}`);
      io.log(`      ${dim(`evidencia: ${(p.evidence ?? []).join('; ')}`)}`);
    }
    if (constitution.amendments.length > 0) {
      io.log('');
      io.log(`  ${colors.bold('Enmiendas propuestas')} (no en vigor):`);
      for (const a of constitution.amendments) io.log(`    ${a.id} — ${a.title}`);
    }

    if (write) {
      const steeringDir = path.join(target, '.sdd', 'steering');
      await mkdir(steeringDir, { recursive: true });
      const file = path.join(steeringDir, 'constitution.md');
      await writeFile(file, rendered, 'utf8');
      io.log('');
      io.log(`  ${colors.green('✓')} escrita en ${path.relative(target, file)}`);
      // Round-trip check: the artifact must be readable by the same model that wrote it.
      const roundTrip = parseConstitution(rendered);
      const same = roundTrip.principles.length === constitution.principles.length;
      io.log(
        `  ${same ? colors.green('✓') : colors.red('✗')} ida y vuelta: ${roundTrip.principles.length}/${constitution.principles.length} principios legibles`,
      );
      const authority = resolveAuthority(constitution, constitution.principles[0]?.id ?? '');
      io.log(`  ${dim(`autoridad citable: ${authority.detail}`)}`);
    } else {
      io.log('');
      io.log(dim('  Añade --write para escribirla en .sdd/steering/constitution.md'));
    }
    io.log('');
    return issues.some((i) => i.severity === 'error') ? 1 : 0;
  }

  if (sub === 'specify') {
    // DE LENGUAJE NATURAL A EARS. Headless-first: sin TTY imprime los requisitos y las preguntas (o
    // las escribe en un fichero con --questions-file). `requirements.md` se escribe SOLO con --write
    // y solo se AÑADE: los enunciados existentes se conservan y se informan como `keep`. Decidir
    // ADDED frente a MODIFIED es competencia de la delta, no de este comando.
    const feature = (positionalsOf(args, 1, ['--area', '--questions-file'])[0] ?? '').trim();
    const description = positionalsOf(args, 1, ['--area', '--questions-file']).slice(1).join(' ').trim();
    if (feature.length === 0 || description.length === 0) {
      io.error(
        colors.red(
          'Faltan argumentos: open-sdd brownfield specify <feature> "<descripción en lenguaje natural>" [--area A] [--json] [--write] [--questions-file <path>]',
        ),
      );
      return 1;
    }

    const areaFlag = flagValue(args, '--area');
    const root = await findRepoRoot(cwd);
    const sddDir = await resolveSddDir(root);
    const specDir = path.join(root, sddDir, 'specs', feature);
    const requirementsPath = path.join(specDir, 'requirements.md');
    const existing = await readIfExists(requirementsPath);
    const result = specifyFromDescription({
      feature,
      description,
      ...(areaFlag ? { area: areaFlag } : {}),
      ...(existing !== null ? { existing } : {}),
    });
    const area = requirementArea(feature, areaFlag);
    const existingStatements = new Set(
      existingRequirementStatements(existing ?? '').map(normalizeRequirementStatement),
    );
    const keep = result.requirements.filter((requirement) =>
      existingStatements.has(normalizeRequirementStatement(requirement.statement)),
    );
    const added = result.requirements.filter(
      (requirement) => !existingStatements.has(normalizeRequirementStatement(requirement.statement)),
    );

    const questionsFileFlag = flagValue(args, '--questions-file');
    let questionsFile: string | null = null;
    if (questionsFileFlag) {
      const absolute = path.resolve(cwd, questionsFileFlag);
      const payload = {
        kind: SPECIFY_QUESTIONS_FILE_KIND,
        feature,
        area,
        description,
        questions: result.questions,
        accepted: result.requirements,
        howToAnswer:
          'Responde cada pregunta ampliando la descripción (nombra el actor, el disparador y el valor medible) y vuelve a ejecutar specify: los enunciados ya presentes se conservan y no se reescriben.',
      };
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      questionsFile = path.relative(root, absolute).split(path.sep).join('/');
    }

    const write = args.includes('--write');
    let written = false;
    if (write) {
      // Guardia de no-sobrescritura: el texto producido SIEMPRE empieza por el fichero existente tal
      // cual. Si no fuera así, se rechaza en vez de reescribir requisitos que nadie revisó.
      if (existing !== null && !result.text.startsWith(existing.replace(/\s+$/, ''))) {
        io.error(colors.red('Rechazado: el texto resultante no conserva requirements.md tal cual. Nada se ha escrito.'));
        return 1;
      }
      const unchanged = existing !== null && result.text === existing;
      if (!unchanged) {
        await mkdir(specDir, { recursive: true });
        await writeFile(requirementsPath, result.text, 'utf8');
        written = true;
      }
    }

    if (args.includes('--json')) {
      io.log(
        JSON.stringify(
          jsonEnvelope({
            command: 'brownfield specify',
            data: {
              feature,
              area,
              description,
              requirements: result.requirements,
              added,
              keep: keep.map((requirement) => requirement.id),
              questions: result.questions,
              text: result.text,
              written,
              questionsFile,
              detail: result.detail,
            },
            // Una pregunta es un dato que falta: el comando no declara verde una especificación
            // incompleta. No cambia ningún veredicto de otro gate; solo dice «falta esto».
            errors: result.questions.map((question) => ({
              id: question.id,
              message: question.question,
              artifact: question.missing,
            })),
            warnings: keep.map((requirement) => ({
              id: requirement.id,
              message: `ya existe: se conserva (${requirement.statement})`,
            })),
            ok: result.questions.length === 0 && result.requirements.length > 0,
            detail: result.detail,
          }),
          null,
          2,
        ),
      );
      return result.questions.length > 0 ? 1 : 0;
    }

    io.log('');
    io.log(heading(`Especificación en lenguaje natural — ${feature}`));
    io.log('');
    io.log(`  descripción: ${description}`);
    io.log(`  área: ${area}`);
    io.log('');
    io.log(`  ${colors.bold(`Requisitos EARS (${result.requirements.length})`)}:`);
    if (result.requirements.length === 0) io.log(dim('    (ninguno: no se ha inventado ningún requisito)'));
    for (const requirement of result.requirements) {
      const already = keep.some((candidate) => candidate.id === requirement.id);
      io.log(
        `    ${already ? colors.dim('keep') : colors.green('add')} ${requirement.id} ${dim(requirement.pattern)} ${requirement.statement}`,
      );
    }
    if (result.questions.length > 0) {
      io.log('');
      io.log(
        `  ${colors.bold(`Preguntas — datos que la descripción no trae (${result.questions.length})`)} ${dim('(NO son requisitos: no se ha inventado ninguno)')}:`,
      );
      for (const question of result.questions) {
        io.log(`    ${colors.yellow('?')} ${question.id} ${dim(`[${question.missing}]`)} ${question.question}`);
      }
      io.log('');
      io.log(dim('  Responde ampliando la descripción y vuelve a ejecutar: los enunciados ya presentes se conservan.'));
    }
    io.log('');
    if (questionsFile) io.log(`  ${colors.green('✓')} preguntas escritas en ${questionsFile}`);
    if (written) {
      io.log(
        `  ${colors.green('✓')} ${path.relative(root, requirementsPath)} escrito (${added.length} añadido(s), ${keep.length} conservado(s))`,
      );
    } else if (write && result.requirements.length > 0 && keep.length === result.requirements.length) {
      io.log(dim('  = todos los requisitos derivados ya existían: requirements.md no se ha tocado'));
    } else {
      io.log(dim('  Solo previsualización: añade --write para escribir requirements.md (nunca sobrescribe un requisito existente).'));
    }
    io.log('');
    io.log(`  ${dim(result.detail)}`);
    io.log('');
    return result.questions.length > 0 ? 1 : 0;
  }

  if (sub === 'requirements') {
    // El ASISTENTE EARS sobre la spec de una feature: requirements.md y, cuando existe, los
    // enunciados de la delta. No reescribe nada por heurística: `--write` exige `--apply <índice|código>`.
    const root = await findRepoRoot(cwd);
    const words = args.slice(1);
    const valueFlags = new Set(['--apply']);
    const feature = words
      .filter((arg, index) => {
        if (arg.startsWith('-')) return false;
        const previous = words[index - 1];
        return !(previous && valueFlags.has(previous));
      })
      .map((arg) => arg.trim())
      .filter((arg) => arg.length > 0)[0] ?? (await firstSpec(root));
    if (!feature) {
      io.error(colors.red('No hay especificación que analizar. Pasa un nombre de feature o crea una spec primero.'));
      return 1;
    }

    const relative = (file: string): string => path.relative(root, file).split(path.sep).join('/');
    const specDir = path.join(root, '.sdd', 'specs', feature);
    const requirementsPath = path.join(specDir, 'requirements.md');
    const deltaFile = path.join(specDir, deltaSpecFileName());
    const requirementsRaw = await readIfExists(requirementsPath);
    const deltaRaw = await readIfExists(deltaFile);
    if (requirementsRaw === null && deltaRaw === null) {
      io.error(
        colors.red(
          `No hay ${relative(requirementsPath)} ni ${relative(deltaFile)} para "${feature}": no hay requisitos que analizar.`,
        ),
      );
      return 1;
    }

    const reports: EarsReport[] = [];
    const notes: string[] = [];
    const analysedStatements: string[] = [];
    if (requirementsRaw !== null) {
      const report = analyseEars(requirementsRaw, { source: relative(requirementsPath) });
      reports.push(report);
      analysedStatements.push(...(report.statements ?? []));
    } else {
      notes.push(`no existe ${relative(requirementsPath)}: solo se analizan los enunciados de la delta`);
    }
    if (deltaRaw !== null) {
      const deltaStatements = deltaStatementText(deltaRaw, analysedStatements);
      if (deltaStatements.statements > 0) {
        reports.push(analyseEars(deltaStatements.text, { source: relative(deltaFile) }));
      }
      if (deltaStatements.duplicates > 0) {
        notes.push(
          `${deltaStatements.duplicates} enunciado(s) de la delta repiten requirements.md: no se cuentan dos veces`,
        );
      }
    }
    const report = mergeEarsReports(reports);
    const errorSuggestions = report.suggestions.filter((suggestion) => suggestion.severity === 'error');
    const warningSuggestions = report.suggestions.filter((suggestion) => suggestion.severity === 'warning');
    const asFindings = (suggestions: EarsSuggestion[]): FindingInput[] =>
      suggestions.map((suggestion) => ({ id: suggestion.code, message: suggestion.problem, artifact: suggestion.target }));

    const json = args.includes('--json');
    const suggest = args.includes('--suggest');
    const write = args.includes('--write');
    const applyIndex = args.indexOf('--apply');
    const selection = applyIndex >= 0 ? (args[applyIndex + 1] ?? '').trim() : null;

    /** Las líneas candidatas a reescribir: requirements.md primero, la delta después. */
    const files: { path: string; rel: string; text: string }[] = [];
    if (requirementsRaw !== null) files.push({ path: requirementsPath, rel: relative(requirementsPath), text: requirementsRaw });
    if (deltaRaw !== null) files.push({ path: deltaFile, rel: relative(deltaFile), text: deltaRaw });

    const prefixOf = (line: string): string =>
      line.match(/^(\s*[-*+]\s+(?:Statement\s*:\s*)?)/i)?.[1] ?? line.match(/^(\s*)/)?.[1] ?? '';

    const selectSuggestions = (): { selected: EarsSuggestion[]; refusals: string[] } => {
      const refusals: string[] = [];
      const selected: EarsSuggestion[] = [];
      if (selection === null || selection.length === 0) return { selected, refusals };
      for (const token of selection.split(',').map((part) => part.trim()).filter(Boolean)) {
        if (/^\d+$/.test(token)) {
          const index = Number(token);
          const suggestion = report.suggestions[index - 1];
          if (!suggestion) {
            refusals.push(`--apply ${token}: no existe la sugerencia ${token} (hay ${report.suggestions.length}).`);
            continue;
          }
          selected.push(suggestion);
          continue;
        }
        const matches = report.suggestions.filter((suggestion) => suggestion.code.toUpperCase() === token.toUpperCase());
        if (matches.length === 0) {
          refusals.push(`--apply ${token}: ningún hallazgo usa el código ${token}.`);
          continue;
        }
        selected.push(...matches);
      }
      for (const suggestion of selected) {
        if (!isEarsProposalApplicable(suggestion)) {
          refusals.push(
            `${suggestion.code} en "${suggestion.target}" es una PREGUNTA, no una frase: falta un dato que no se inventa. Respóndela y reescribe el requisito a mano.`,
          );
        }
      }
      const targets = selected.map((suggestion) => suggestion.target);
      if (new Set(targets).size !== targets.length) {
        refusals.push('Dos selecciones tocan la misma línea: aplica una cada vez para no encadenar reescrituras a ciegas.');
      }
      return { selected, refusals };
    };

    if (selection !== null || write) {
      if (selection === null || selection.length === 0) {
        // Sin selección explícita no se escribe NADA: una reescritura en bloque desde una heurística
        // reescribiría requisitos que nadie revisó.
        io.error(
          colors.red(
            '--write exige una selección explícita: open-sdd brownfield requirements <feature> --apply <índice|código> --write. Nada se ha escrito.',
          ),
        );
        return 1;
      }

      const { selected, refusals } = selectSuggestions();
      if (refusals.length > 0) {
        if (json) {
          io.log(
            JSON.stringify(
              jsonEnvelope({
                command: 'brownfield requirements',
                data: { feature, report, applied: [], diff: [], written: false, refusals },
                errors: refusals.map((message) => ({ id: 'APPLY', message })),
                warnings: asFindings(warningSuggestions),
                ok: false,
                detail: 'Selección rechazada: nada se ha escrito.',
              }),
              null,
              2,
            ),
          );
          return 1;
        }
        io.log('');
        io.log(heading(`Asistente EARS — ${feature}`));
        for (const refusal of refusals) io.log(`  ${colors.red('rechazada')} ${refusal}`);
        io.log('');
        io.log(`  ${colors.red('Nada se ha escrito:')} la selección no es aplicable.`);
        io.log('');
        return 1;
      }

      // Todo o nada: si una sola línea no se encuentra, no se escribe ningún fichero.
      const diff: string[] = [];
      const applied: { index: number; code: string; target: string; file: string; added: string[] }[] = [];
      const updated = new Map<string, string>();
      const missing: string[] = [];

      for (const suggestion of selected) {
        const index = report.suggestions.indexOf(suggestion) + 1;
        const file = files.find((candidate) =>
          candidate.text.split('\n').some((line) => line.trim() === suggestion.target),
        );
        if (!file) {
          missing.push(`no se encontró la línea exacta de ${suggestion.code} en requirements.md ni en delta.md`);
          continue;
        }
        const text = updated.get(file.path) ?? file.text;
        const lines = text.split('\n');
        const lineIndex = lines.findIndex((line) => line.trim() === suggestion.target);
        if (lineIndex < 0) {
          missing.push(`${suggestion.code}: la línea ya se reescribió en esta misma ejecución.`);
          continue;
        }
        const prefix = prefixOf(lines[lineIndex]);
        const replacement = suggestion.proposal.split('\n').map((line) => `${prefix}${line.trim()}`);
        diff.push(`--- a/${file.rel}`, `+++ b/${file.rel}`, `- ${lines[lineIndex]}`);
        for (const line of replacement) diff.push(`+ ${line}`);
        lines.splice(lineIndex, 1, ...replacement);
        updated.set(file.path, lines.join('\n'));
        applied.push({ index, code: suggestion.code, target: suggestion.target, file: file.rel, added: replacement });
      }

      if (missing.length > 0) {
        if (json) {
          io.log(
            JSON.stringify(
              jsonEnvelope({
                command: 'brownfield requirements',
                data: { feature, report, applied: [], diff, written: false, refusals: missing },
                errors: missing.map((message) => ({ id: 'APPLY', message })),
                warnings: asFindings(warningSuggestions),
                ok: false,
                detail: 'Aplicación rechazada: nada se ha escrito.',
              }),
              null,
              2,
            ),
          );
          return 1;
        }
        io.log('');
        io.log(heading(`Asistente EARS — ${feature}`));
        for (const message of missing) io.log(`  ${colors.red('rechazada')} ${message}`);
        io.log('');
        io.log(`  ${colors.red('Nada se ha escrito:')} la aplicación es todo o nada.`);
        io.log('');
        return 1;
      }

      if (json) {
        io.log(
          JSON.stringify(
            jsonEnvelope({
              command: 'brownfield requirements',
              data: {
                feature,
                report,
                applied,
                diff,
                written: write,
                files: [...updated.keys()].map((file) => relative(file)),
                evidencePack: earsEvidencePack(report, { maxSuggestions: report.suggestions.length }),
              },
              errors: asFindings(errorSuggestions.filter((suggestion) => !selected.includes(suggestion))),
              warnings: asFindings(warningSuggestions.filter((suggestion) => !selected.includes(suggestion))),
              detail: write
                ? `Aplicadas ${applied.length} sugerencia(s) seleccionada(s): ${[...updated.keys()].map((file) => relative(file)).join(', ')}.`
                : `Diff de ${applied.length} sugerencia(s): sin --write no se ha escrito nada.`,
            }),
            null,
            2,
          ),
        );
        return errorSuggestions.filter((suggestion) => !selected.includes(suggestion)).length > 0 ? 1 : 0;
      }

      io.log('');
      io.log(heading(`Asistente EARS — ${feature}`));
      io.log('');
      for (const line of diff) {
        io.log(line.startsWith('- ') ? colors.red(line) : line.startsWith('+ ') ? colors.green(line) : dim(line));
      }
      io.log('');
      if (write) {
        for (const [file, text] of updated) await writeFile(file, text, 'utf8');
        io.log(`  ${colors.green('✓')} ${applied.length} sugerencia(s) aplicadas en ${[...updated.keys()].map((file) => relative(file)).join(', ')}`);
      } else {
        io.log(dim('  Solo diff: añade --write para aplicar la selección. Nada se ha escrito.'));
      }
      const remaining = errorSuggestions.filter((suggestion) => !selected.includes(suggestion));
      io.log('');
      return remaining.length > 0 ? 1 : 0;
    }

    const evidence = earsEvidencePack(report, { maxSuggestions: report.suggestions.length });
    if (json) {
      io.log(
        JSON.stringify(
          jsonEnvelope({
            command: 'brownfield requirements',
            data: { feature, report, evidencePack: evidence, notes },
            errors: asFindings(errorSuggestions),
            warnings: asFindings(warningSuggestions),
            detail: report.detail,
          }),
          null,
          2,
        ),
      );
      return errorSuggestions.length > 0 ? 1 : 0;
    }

    io.log('');
    for (const line of renderEarsReport(report, { suggest })) io.log(line);
    if (!suggest && report.suggestions.length > 0) {
      io.log('');
      io.log(dim('  Añade --suggest para ver cada propuesta con su porqué y un ejemplo real de este repositorio.'));
      // El asistente APARECE junto al hallazgo que el informe acaba de imprimir, con la propuesta
      // concreta y una única acción. No cambia el veredicto (abajo) y nunca reescribe la spec.
      io.log('');
      const assistant = await assist({
        cwd: root,
        feature,
        sddDir: await resolveSddDir(root),
        findings: report.suggestions.map((suggestion) => ({
          code: suggestion.code,
          artifact: suggestion.target,
        })),
      });
      for (const line of renderAssist(assistant.suggestions)) io.log(dim(`  ${line}`));
    }
    for (const note of notes) io.log(dim(`  ${note}`));
    io.log('');
    io.log(
      dim(
        '  Escribir exige selección: --apply <índice|código> muestra el diff; añade --write para aplicarlo. Nunca se reescribe la spec desde una heurística en bloque.',
      ),
    );
    io.log('');
    return errorSuggestions.length > 0 ? 1 : 0;
  }

  if (sub === 'impact' || sub === 'contracts' || sub === 'reuse') {
    // These three operate on THIS repository and take the feature name as their positional
    // argument, so the base directory is the repository root — not `target`, which resolves the
    // positional as a path for `survey`/`constitution`.
    const root = await findRepoRoot(cwd);
    const feature = positional[0] ?? (await firstSpec(root));
    if (!feature) {
      io.error(colors.red('No hay especificación sobre la que analizar el cambio.'));
      return 1;
    }
    const specDir = path.join(root, '.sdd', 'specs', feature);
    const deltaRaw = await readIfExists(path.join(specDir, deltaSpecFileName()));
    const delta = deltaRaw === null ? undefined : parseDeltaSpec(deltaRaw);
    if (deltaRaw === null) {
      io.log(dim('  Sin delta.md: el análisis se hace sin el contrato de cambio declarado.'));
    }

    const baseIdx = args.findIndex((a) => a === '--base');
    const base = baseIdx >= 0 ? args[baseIdx + 1] : undefined;
    const { files: changedFiles, source } = changedFilesFor(root, base);
    io.log('');
    io.log(dim(`  origen del cambio: ${source}`));
    // `contracts` publishes the ORACLE, not the diff: the contract set is a property of the
    // repository and the delta, so it exists even when the working tree is clean. Returning early
    // there hid the whole report on a fresh checkout — which is exactly where the claims registry
    // verifies `brownfield contracts <feature>` — and made the command's verdict depend on whether
    // some unrelated file happened to be dirty. `impact` and `reuse` still need a change to say
    // anything, so only they keep the early return.
    if (changedFiles.length === 0 && sub !== 'contracts') {
      io.log('');
      io.log(colors.green('Sin cambios que analizar en este origen.'));
      io.log('');
      return 0;
    }

    if (sub === 'impact') {
      const report: ChangeImpactReport = await analyzeChangeImpact({
        cwd: root,
        changedFiles,
        ...(delta ? { delta } : {}),
      });
      io.log('');
      io.log(heading(`Impacto del cambio — ${feature} (${changedFiles.length} fichero(s))`));
      io.log('');
      io.log(`  radio de impacto: ${report.blastRadius} fichero(s) alcanzable(s) desde el cambio`);
      if (report.dependents.length > 0) {
        io.log(`  dependientes directos (${report.dependents.length}): ${report.dependents.slice(0, 6).map((d) => d.file).join(', ')}`);
      }
      if (report.apiSurface.length > 0) {
        io.log(`  superficie de API tocada: ${report.apiSurface.map((a) => a.file).join(', ')}`);
      }
      if (report.integrationPoints.length > 0) {
        io.log(`  puntos de integración: ${report.integrationPoints.join(', ')}`);
      }
      io.log('');
      for (const finding of report.findings) {
        const mark =
          finding.severity === 'error'
            ? colors.red('error')
            : finding.severity === 'warning'
              ? colors.yellow('aviso')
              : colors.dim('info');
        io.log(`  ${mark.padEnd(18)} ${finding.area.padEnd(14)} ${finding.message}`);
      }
      io.log('');
      io.log(`  ${report.complete ? colors.green(report.detail) : colors.yellow(report.detail)}`);
      io.log('');
      return report.findings.some((f) => f.severity === 'error') ? 1 : 0;
    }

    if (sub === 'contracts') {
      const project = await scanProject(root);
      const set = await extractContracts({
        cwd: root,
        feature,
        changedFiles,
        ...(delta ? { delta } : {}),
        testDirs: project.testDirs,
        ...(project.testFramework ? { testFramework: project.testFramework } : {}),
      });
      const derived = testCommandFor(project.testFramework);

      io.log('');
      io.log(heading(`Contratos de ejecución — ${feature}`));
      io.log('');
      io.log(`  oráculo: ${set.contracts.length} contrato(s) · comando ${derived.command}${derived.derived ? ' (derivado, no verificado)' : ''}`);
      for (const contract of set.contracts.slice(0, 12)) {
        io.log(`    ${contract.source.padEnd(10)} ${contract.test}`);
      }
      if (set.uncoveredChanges.length > 0) {
        io.log('');
        io.log(`  ${colors.yellow('!')} cambios sin cobertura (${set.uncoveredChanges.length}): ${set.uncoveredChanges.slice(0, 8).join(', ')}`);
        io.log(dim('    Un cambio sin contrato no lo protege nadie: es el hueco que este informe hace visible.'));
      } else if (changedFiles.length === 0) {
        io.log('');
        io.log(dim('    Sin cambios pendientes en este origen: el oráculo se publica igual (el conjunto de contratos es del repositorio, no del diff) y no hay huecos de cobertura que medir.'));
      }
      io.log('');
      io.log(`  ${set.complete ? colors.green(set.detail) : colors.yellow(set.detail)}`);

      if (args.includes('--write')) {
        const file = path.join(specDir, contractsFileName());
        await writeFile(file, JSON.stringify(set, null, 2) + '\n', 'utf8');
        io.log(`  ${colors.green('✓')} escrito en ${path.relative(root, file)}`);
      }

      if (args.includes('--verify')) {
        io.log('');
        io.log(dim(`  ejecutando ${derived.command}...`));
        const run = spawnSync('bash', ['-c', derived.command], { cwd: root, encoding: 'utf8' });
        const verification = verifyContracts(set, {
          exitCode: run.status ?? 1,
          stdout: `${run.stdout ?? ''}\n${run.stderr ?? ''}`,
        });
        io.log(`  ${verification.satisfied ? colors.green(verification.detail) : colors.red(verification.detail)}`);
        if (verification.missing.length > 0) {
          io.log(`  ${colors.red('!')} contratos declarados que no existen: ${verification.missing.join(', ')}`);
        }
        io.log('');
        return verification.satisfied ? 0 : 1;
      }
      // Two different things live behind `complete: false`: a contract the delta DECLARED that does
      // not exist (fatal — the oracle is missing a protection someone promised) and a changed file no
      // test covers (a hole to report, not a reason to block a legitimate change). Separating them is
      // what makes the CI step meaningful instead of either decorative or unusable.
      // Only DISCOVERED contracts count as evidence that a declared contract exists. Building this
      // set from every contract made the check vacuous: extractContracts always emits a
      // source:'delta' contract for each declared test, so the declared test was always "present"
      // and this command could never fail — the hole it exists to report was structurally hidden.
      const discoveredTests = new Set(
        set.contracts.filter((c) => c.source === 'discovered').map((c) => c.test),
      );
      // A declared contract is missing only when it is neither DISCOVERED (a test that covers a
      // changed file) nor present on disk. Counting only discovered ones made a clean tree — where
      // nothing is "changed", so nothing is discovered — report every declared contract as absent,
      // which is the mirror image of the vacuous check this replaced.
      const declaredExists = (declared: string): boolean => {
        const file = declared.split('::')[0] ?? declared;
        try {
          return statSync(path.join(root, file)).isFile();
        } catch {
          return false;
        }
      };
      const missingDeclared = (delta?.entries ?? []).flatMap((entry) =>
        (entry.contracts ?? []).filter(
          (declared) => !discoveredTests.has(declared) && !declaredExists(declared),
        ),
      );
      if (missingDeclared.length > 0) {
        io.log('');
        io.log(`  ${colors.red('!')} contratos declarados en la delta que no existen: ${missingDeclared.join(', ')}`);
      }
      io.log('');
      return missingDeclared.length > 0 ? 1 : 0;
    }

    // reuse
    const fromIdx = args.findIndex((a) => a === '--symbols');
    const declared = fromIdx >= 0 ? (args[fromIdx + 1] ?? '').split(',').map((x) => x.trim()).filter(Boolean) : [];
    const derivedFromDelta = delta
      ? delta.entries
          .filter((e) => e.kind === 'ADDED')
          .map((e) => ({ symbol: (e.title.match(/[A-Za-z][A-Za-z0-9_]+/g) ?? []).join(''), reason: e.title }))
          .filter((r) => r.symbol.length > 2)
      : [];
    const requests = declared.length > 0 ? declared.map((symbol) => ({ symbol, reason: 'declarado en la línea de órdenes' })) : derivedFromDelta;

    if (requests.length === 0) {
      io.log('');
      io.log(
        `  ${colors.yellow('Sin símbolos que comprobar')}: no hay entradas ADDED en la delta ni se pasó --symbols A,B, así que la búsqueda de reutilización NO se ha ejecutado.`,
      );
      io.log('');
      return 0;
    }

    const project = await scanProject(root);
    const report = await findReuseCandidates({
      cwd: root,
      requests,
      sourceDirs: project.sourceDirs,
    });

    io.log('');
    io.log(heading(`Reutilización primero — ${feature}`));
    io.log('');
    io.log(dim(`  ${REUSE_FIRST_RULE.slice(0, 160)}`));
    io.log('');
    if (declared.length === 0) {
      io.log(dim('  símbolos derivados de los títulos de las entradas ADDED (derivación declarada, no verificada)'));
      io.log('');
    }
    for (const candidate of report.candidates) {
      io.log(`    ${candidate.similarity.toFixed(2)} ${candidate.kind.padEnd(12)} ${candidate.symbol}  ${colors.dim(`${candidate.file}:${candidate.line}`)}`);
    }
    if (report.violations.length > 0) {
      io.log('');
      io.log(`  ${colors.red('!')} ya existe algo reutilizable para: ${report.violations.join(', ')}`);
      io.log(dim('    Crear un símbolo nuevo aquí duplicaría lo que ya hay: es el riesgo dominante en brownfield.'));
    }
    io.log('');
    io.log(`  ${report.complete ? colors.green(report.detail) : colors.yellow(report.detail)}`);
    io.log('');
    return report.violations.length > 0 ? 1 : 0;
  }

  if (sub === 'forecast') {
    // Antes de escribir nada: qué módulos, qué símbolos reutilizables, qué tests y qué radio esperado.
    const root = await findRepoRoot(cwd);
    // `positional` keeps the VALUE of a value-taking flag as a bare word, so the description must be
    // assembled skipping both the flags and the words that belong to them.
    const valueFlags = new Set(['--symbols', '--base', '--focus', '--command', '--requirement', '--evidence', '--target']);
    const words = args.slice(1);
    const description = words
      .filter((arg, index) => {
        if (arg.startsWith('-')) return false;
        const previous = words[index - 1];
        return !(previous && valueFlags.has(previous));
      })
      .join(' ')
      .trim();
    if (description.length === 0) {
      io.error(colors.red('Falta la descripción del cambio: open-sdd brownfield forecast "<qué cambia>" [--symbols A,B]'));
      return 1;
    }
    const symbolsIdx = args.findIndex((a) => a === '--symbols');
    const symbols = symbolsIdx >= 0 ? (args[symbolsIdx + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean) : [];
    const forecast = await forecastImpact({ cwd: root, description, ...(symbols.length > 0 ? { symbols } : {}) });

    if (args.includes('--json')) {
      io.log(JSON.stringify(forecast, null, 2));
      return 0;
    }

    io.log('');
    io.log(heading('Pronóstico de impacto (antes de escribir)'));
    io.log('');
    io.log(`  descripción: ${description}`);
    io.log(`  palabras clave: ${forecast.keywords.join(', ') || dim('(ninguna significativa)')}`);
    io.log('');
    if (forecast.modules.length > 0) {
      io.log(`  ${colors.bold(`Módulos coincidentes (${forecast.modules.length}/${forecast.modulesConsidered})`)}`);
      for (const module of forecast.modules) {
        io.log(`    ${module.path}  ${dim(module.name)}  ${dim(`clave: ${module.matchedKeywords.join(', ') || '-'}`)}`);
        for (const evidence of module.matched.slice(0, 5)) io.log(`      · ${evidence}`);
      }
    } else {
      io.log(`  ${colors.yellow('Ningún módulo coincide con la descripción.')}`);
    }
    io.log('');
    io.log(`  ${colors.bold(`Radio esperado: ${forecast.expectedBlastRadius === null ? colors.yellow('DESCONOCIDO') : forecast.expectedBlastRadius + ' fichero(s)'}`)}`);
    if (forecast.candidateFiles.length > 0) {
      io.log(`    candidatos (${forecast.candidateFiles.length}): ${forecast.candidateFiles.slice(0, 8).join(', ')}`);
    }
    if (forecast.reuseCandidates.length > 0) {
      io.log('');
      io.log(`  ${colors.bold('Reutilización primero')} (${forecast.reuseCandidates.length} candidato(s)):`);
      for (const candidate of forecast.reuseCandidates.slice(0, 8)) {
        io.log(`    ${candidate.similarity.toFixed(2)} ${candidate.kind.padEnd(12)} ${candidate.symbol}  ${dim(`${candidate.file}:${candidate.line}`)}`);
      }
      if (forecast.reuseViolations.length > 0) {
        io.log(`  ${colors.red('!')} ya existe algo reutilizable para: ${forecast.reuseViolations.join(', ')}`);
      }
    }
    if (forecast.tests.length > 0) {
      io.log('');
      io.log(`  ${colors.bold(`Tests que protegerían el cambio (${forecast.tests.length})`)}`);
      for (const test of forecast.tests.slice(0, 10)) io.log(`    ${test.file}  ${dim(test.reasons.join('; '))}`);
    }
    if (forecast.unknown.length > 0) {
      io.log('');
      io.log(`  ${colors.bold('Desconocido (no se informa como cero)')}:`);
      for (const item of forecast.unknown) io.log(`    · ${item}`);
    }
    io.log('');
    io.log(`  ${forecast.complete ? colors.green(forecast.detail) : colors.yellow(forecast.detail)}`);
    io.log('');
    return 0;
  }

  if (sub === 'repair') {
    // Spec-as-source: la spec manda, la reparación se registra primero y la regeneración se declara.
    const root = await findRepoRoot(cwd);
    const feature = positional[0] ?? (await firstSpec(root));
    if (!feature) {
      io.error(colors.red('No hay especificación sobre la que reparar.'));
      return 1;
    }
    const valueOf = (flag: string): string | undefined => {
      const eq = args.find((a) => a.startsWith(`${flag}=`));
      if (eq) return eq.slice(flag.length + 1);
      const idx = args.findIndex((a) => a === flag);
      return idx >= 0 ? args[idx + 1] : undefined;
    };
    const target = valueOf('--target') ?? positional[1];
    if (!target) {
      io.error(colors.red('Falta --target <artefacto>: la reparación regenera un artefacto declarado.'));
      return 1;
    }
    const report = await repairFromSpec({
      cwd: root,
      feature,
      target,
      ...(valueOf('--command') ? { command: valueOf('--command')! } : {}),
      ...(valueOf('--requirement') ? { requirement: valueOf('--requirement')! } : {}),
      ...(valueOf('--evidence') ? { evidence: valueOf('--evidence')! } : {}),
      write: args.includes('--write'),
    });

    if (args.includes('--json')) {
      io.log(JSON.stringify(report, null, 2));
      return report.refusals.length > 0 || report.status === 'drift' ? 1 : 0;
    }

    io.log('');
    io.log(heading(`Reparación spec-as-source — ${feature}`));
    io.log('');
    io.log(`  nivel: ${report.level} · estado: ${report.status}`);
    io.log(`  artefacto: ${report.target}`);
    io.log(
      `  hash antes: ${report.beforeHash ?? dim('(ausente)')} · registrado: ${report.recordedHash ?? dim('(ninguno)')} · después: ${report.afterHash ?? dim('(sin ejecutar)')}`,
    );
    if (report.drift) io.log(`  ${colors.yellow('!')} deriva: el artefacto no coincidía con el hash que la spec registra`);
    for (const refusal of report.refusals) io.log(`  ${colors.red('✗')} ${refusal}`);
    io.log('');
    io.log(`  ${report.status === 'refused' || report.status === 'drift' ? colors.yellow(report.detail) : colors.green(report.detail)}`);
    io.log('');
    return report.refusals.length > 0 || report.status === 'drift' ? 1 : 0;
  }

  if (sub === 'clarify') {
    // La interrogación acotada. DERIVA cada pregunta del código determinista que la levanta (EARS o
    // marcador `{{…}}`), NO pregunta lo que el repositorio ya puede responder (va a `fromEvidence`) y
    // acota el lote declarándolo. Sin `--write` no toca la especificación jamás; con `--write` aplica
    // y VERIFICA re-ejecutando el análisis (antes/después por pregunta).
    const root = await findRepoRoot(cwd);
    const words = args.slice(1);
    const valueFlags = new Set(['--max', '--questions-file', '--answers']);
    const feature =
      words
        .filter((arg, index) => {
          if (arg.startsWith('-')) return false;
          const previous = words[index - 1];
          return !(previous && valueFlags.has(previous));
        })
        .map((arg) => arg.trim())
        .filter((arg) => arg.length > 0)[0] ?? (await firstSpec(root));
    if (!feature) {
      io.error(colors.red('No hay especificación que clarificar. Pasa un nombre de feature o crea una spec primero.'));
      return 1;
    }

    const valueOf = (name: string): string | undefined => {
      const inline = args.find((arg) => arg.startsWith(`${name}=`));
      if (inline) return inline.slice(name.length + 1);
      const index = args.indexOf(name);
      return index >= 0 ? args[index + 1] : undefined;
    };
    const relOf = (file: string): string => path.relative(root, file).split(path.sep).join('/');

    let max: number | undefined;
    const maxRaw = valueOf('--max');
    if (maxRaw !== undefined) {
      max = Number.parseInt(maxRaw, 10);
      if (!Number.isFinite(max) || max < 0) {
        io.error(colors.red(`--max debe ser un entero ≥ 0 (recibido: ${maxRaw}).`));
        return 1;
      }
    }

    const json = args.includes('--json');
    const write = args.includes('--write');
    const questionsFile = valueOf('--questions-file');
    const answersFile = valueOf('--answers');

    const session = await planClarify({ cwd: root, feature, ...(max !== undefined ? { max } : {}) });

    const renderQuestions = (): void => {
      io.log('');
      io.log(heading(`Clarify — ${feature}${session.truncated ? ` ${dim(`(lote recortado: ${session.remaining} sin mostrar)`)}` : ''}`));
      io.log('');
      if (session.questions.length === 0) {
        io.log(`  ${colors.green(session.detail)}`);
      } else {
        session.questions.forEach((question, index) => {
          io.log(`  [${index + 1}] ${question.severity} ${question.code} · ${question.id}`);
          io.log(`      artefacto: ${question.artifact}`);
          io.log(`      pregunta: ${question.question}`);
          io.log(`      por qué: ${question.why}`);
          if (question.template) io.log(dim(`      plantilla: ${question.template}`));
          if (question.options) for (const option of question.options) io.log(dim(`      opción: ${option}`));
        });
      }
      for (const entry of session.fromEvidence) {
        io.log(`  ${colors.green('= evidencia')} ${entry.id} ${entry.code} · ${entry.artifact}`);
        io.log(dim(`      respuesta ya computada: ${entry.answer}`));
        io.log(dim(`      ${entry.evidence}`));
      }
      for (const entry of session.unresolvable) {
        io.log(`  ${colors.yellow('!')} ${entry.code} · ${entry.artifact}`);
        io.log(dim(`      no se pregunta: ${entry.reason}`));
      }
      io.log('');
      io.log(`  ${session.detail}`);
      io.log(
        dim('  No se ha escrito nada. Ciclo no interactivo: --questions-file <ruta> → rellena answers → --answers <ruta> --write.'),
      );
    };

    if (questionsFile !== undefined && answersFile === undefined) {
      const target = path.resolve(root, questionsFile);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(clarifyQuestionsFile(session), null, 2)}\n`, 'utf8');
      if (json) {
        io.log(
          JSON.stringify(
            jsonEnvelope({
              command: 'brownfield clarify',
              data: { feature, session, questionsFile: relOf(target) },
              warnings: session.questions.map((question) => ({ id: question.id, message: question.question, artifact: question.artifact })),
              detail: session.detail,
            }),
            null,
            2,
          ),
        );
        return 0;
      }
      renderQuestions();
      io.log(`  ${colors.green('✓')} preguntas escritas en ${relOf(target)} (${session.questions.length})`);
      io.log('');
      return 0;
    }

    const applyWith = async (
      answers: Record<string, string>,
      doWrite: boolean,
    ): Promise<{ reports: { file: string; report: ClarifyApplyReport }[]; unreadable: string[]; written: number }> => {
      const groups = new Map<string, ClarifyQuestion[]>();
      for (const question of session.questions) {
        const list = groups.get(question.file) ?? [];
        list.push(question);
        groups.set(question.file, list);
      }
      const reports: { file: string; report: ClarifyApplyReport }[] = [];
      const unreadable: string[] = [];
      let written = 0;
      for (const [file, questions] of groups) {
        const text = await readIfExists(file);
        if (text === null) {
          unreadable.push(relOf(file));
          continue;
        }
        const report = applyAnswers({ text, session: { ...session, questions }, answers });
        if (doWrite && report.applied.length > 0 && report.text !== text) {
          await writeFile(file, report.text, 'utf8');
          written += 1;
        }
        reports.push({ file: relOf(file), report });
      }
      return { reports, unreadable, written };
    };

    const renderApply = (
      result: { reports: { file: string; report: ClarifyApplyReport }[]; unreadable: string[]; written: number },
      doWrite: boolean,
    ): void => {
      io.log('');
      io.log(heading(`Clarify — ${feature}`));
      io.log('');
      for (const { file, report } of result.reports) {
        for (const entry of report.applied) {
          io.log(`  ${colors.green('✓')} ${entry.id} ${doWrite ? 'aplicada' : 'lista (sin --write, no escrita)'} en ${file}`);
          io.log(`      ${colors.red(`- ${entry.before.trim()}`)}`);
          for (const line of entry.after.split('\n')) io.log(`      ${colors.green(`+ ${line.trim()}`)}`);
        }
        for (const refusal of report.refused) io.log(`  ${colors.red('rechazada')} ${refusal.id}: ${refusal.why}`);
        const verification = report.verification;
        io.log(
          `  ${file}: códigos antes ${verification.codeBefore} · después ${verification.codeAfter} · ` +
            `resueltos ${verification.resolved.length > 0 ? verification.resolved.join(', ') : '(ninguno)'} · ` +
            `siguen abiertos ${verification.stillOpen.length > 0 ? verification.stillOpen.join(', ') : '(ninguno)'}`,
        );
      }
      for (const file of result.unreadable) io.log(`  ${colors.red('✗')} no se pudo leer ${file}`);
      io.log('');
      io.log(
        `  ${result.written} fichero(s) reescrito(s). ${doWrite ? 'Todo lo demás se ha conservado byte a byte.' : 'Sin --write la especificación NO se ha tocado.'}`,
      );
      io.log(`  ${session.detail}`);
    };

    let interactiveAnswers: Record<string, string> | null = null;
    if (answersFile === undefined && !json && questionsFile === undefined && process.stdin.isTTY === true && session.questions.length > 0) {
      const readline = await import('node:readline/promises');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      interactiveAnswers = {};
      try {
        io.log('');
        io.log(heading(`Clarify — ${feature}`));
        for (const question of session.questions) {
          io.log('');
          io.log(`  [${question.severity}] ${question.id} · ${question.code}`);
          io.log(`      ${question.artifact}`);
          io.log(`      ${question.question}`);
          if (question.template) io.log(dim(`      plantilla: ${question.template}`));
          if (question.options) for (const option of question.options) io.log(dim(`      opción: ${option}`));
          const answer = await rl.question('  respuesta (vacío = no aplicar): ');
          if (answer.trim().length > 0) interactiveAnswers[question.id] = answer.trim();
        }
      } finally {
        rl.close();
      }
    }

    let answers: Record<string, string> | null = interactiveAnswers;
    if (answersFile !== undefined) {
      const target = path.resolve(root, answersFile);
      const raw = await readIfExists(target);
      if (raw === null) {
        io.error(colors.red(`No se pudo leer --answers ${relOf(target)}.`));
        return 1;
      }
      const parsed = readClarifyAnswers(raw);
      if (parsed.error) {
        io.error(colors.red(`--answers ${relOf(target)}: ${parsed.error}`));
        return 1;
      }
      answers = parsed.answers;
    }

    if (answers === null) {
      if (write) {
        io.error(
          colors.red(
            '--write exige respuestas: usa --answers <ruta> (o ejecuta en un TTY para responder una a una). Nada se ha escrito.',
          ),
        );
        return 1;
      }
      if (json) {
        io.log(
          JSON.stringify(
            jsonEnvelope({
              command: 'brownfield clarify',
              data: { feature, session },
              warnings: session.questions.map((question) => ({ id: question.id, message: question.question, artifact: question.artifact })),
              detail: session.detail,
            }),
            null,
            2,
          ),
        );
        return 0;
      }
      renderQuestions();
      return 0;
    }

    const result = await applyWith(answers, write);
    const answered = result.reports.reduce(
      (count, { report }) => count + report.applied.length + report.refused.length,
      0,
    );
    if (answered === 0) {
      io.error(
        colors.red(
          `Ninguna respuesta del fichero coincide con las ${session.questions.length} pregunta(s) de esta sesión: nada que aplicar.`,
        ),
      );
      return 1;
    }

    const refusals = result.reports.flatMap((entry) =>
      entry.report.refused.map((refusal) => ({ id: refusal.id, message: refusal.why, artifact: entry.file })),
    );
    const hasErrors = refusals.length > 0 || result.unreadable.length > 0;

    if (json) {
      io.log(
        JSON.stringify(
          jsonEnvelope({
            command: 'brownfield clarify',
            data: {
              feature,
              session,
              written: write,
              files: result.reports.map(({ file, report }) => ({ file, ...report })),
              unreadable: result.unreadable,
            },
            errors: [...refusals, ...result.unreadable.map((file) => ({ id: 'READ', message: `no se pudo leer ${file}`, artifact: file }))],
            warnings: session.questions.map((question) => ({ id: question.id, message: question.question, artifact: question.artifact })),
            ok: !hasErrors,
            detail: session.detail,
          }),
          null,
          2,
        ),
      );
      return hasErrors ? 1 : 0;
    }

    renderApply(result, write);
    io.log('');
    return hasErrors ? 1 : 0;
  }

  if (sub === 'converge') {
    // Convergencia brownfield MEDIDA: cada hallazgo lleva evidencia de máquina, el anexado es
    // APPEND-ONLY (una sola sección `## Phase N: Convergence`) e idempotente (marca
    // `_Convergence: F-<huella>_`). Sin `--write` no se toca `tasks.md`; con `--write` se anexa.
    const root = await findRepoRoot(cwd);
    const words = args.slice(1);
    const valueFlags = new Set(['--max']);
    const feature =
      words
        .filter((arg, index) => {
          if (arg.startsWith('-')) return false;
          const previous = words[index - 1];
          return !(previous && valueFlags.has(previous));
        })
        .map((arg) => arg.trim())
        .filter((arg) => arg.length > 0)[0] ?? (await firstSpec(root));
    if (!feature) {
      io.error(colors.red('No hay especificación que converger. Pasa un nombre de feature o crea una spec primero.'));
      return 1;
    }

    const valueOf = (name: string): string | undefined => {
      const inline = args.find((arg) => arg.startsWith(`${name}=`));
      if (inline) return inline.slice(name.length + 1);
      const index = args.indexOf(name);
      return index >= 0 ? args[index + 1] : undefined;
    };
    let max: number | undefined;
    const maxRaw = valueOf('--max');
    if (maxRaw !== undefined) {
      max = Number.parseInt(maxRaw, 10);
      if (!Number.isFinite(max) || max <= 0) {
        io.error(colors.red(`--max debe ser un entero > 0 (recibido: ${maxRaw}).`));
        return 1;
      }
    }

    const json = args.includes('--json');
    const write = args.includes('--write');
    const report = await analyseConvergence({
      cwd: root,
      feature,
      ...(max !== undefined ? { max } : {}),
    });

    const asFindings = (findings: ConvergenceReport['findings']): FindingInput[] =>
      findings.map((finding) => ({ id: finding.id, message: finding.remainingWork, artifact: finding.source }));

    // Prerrequisito ausente: mensaje accionable que nombra el comando a ejecutar primero y CERO
    // salida parcial. `appended === null` con cero hallazgos significa que no se pudo analizar.
    if (report.appended === null && report.findings.length === 0) {
      if (json) {
        io.log(
          JSON.stringify(
            jsonEnvelope({
              command: 'brownfield converge',
              data: report,
              errors: [{ id: 'PREREQUISITE', message: report.detail }],
              ok: false,
              detail: report.detail,
            }),
            null,
            2,
          ),
        );
        return 1;
      }
      io.error(colors.red(report.detail));
      return 1;
    }

    const high = report.findings.filter((finding) => finding.severity === 'high');
    const rest = report.findings.filter((finding) => finding.severity !== 'high');
    const exitCode = convergeExitCode(report);

    const renderConvergence = (
      written?: { written: boolean; tasksAfter: number; writeDetail: string },
    ): void => {
      io.log('');
      io.log(heading(`Convergencia brownfield — ${feature}`));
      io.log('');
      if (report.findings.length === 0) {
        io.log(
          `  ${
            report.converged
              ? colors.green('Sin huecos nuevos: tasks.md queda byte a byte intacto.')
              : colors.yellow('Sin huecos nuevos, pero hay inspecciones sin hacer: NO se declara convergencia.')
          }`,
        );
      } else {
        io.log(`  ${colors.bold('Hallazgos')} (${report.findings.length}):`);
        for (const finding of report.findings) {
          const mark =
            finding.severity === 'high'
              ? colors.red(finding.severity)
              : finding.severity === 'medium'
                ? colors.yellow(finding.severity)
                : colors.dim(finding.severity);
          io.log(`    ${colors.bold(finding.id)}  ${finding.gapType}  ${mark}  ${colors.bold(finding.source)}`);
          io.log(`        trabajo: ${finding.remainingWork}`);
          for (const item of finding.evidence) io.log(dim(`        evidencia: ${item}`));
        }
      }
      const metrics = report.metrics;
      io.log('');
      io.log(
        `  métricas: requisitos ${metrics.requirementsChecked} · tareas ${metrics.tasksChecked} · principios ${metrics.principlesChecked} · contratos ${metrics.contractsChecked}`,
      );
      io.log(
        `  por tipo: ${Object.entries(metrics.byGapType).map(([gap, count]) => `${gap} ${count}`).join(' · ')}`,
      );
      io.log(
        `  por severidad: alto ${metrics.bySeverity.high} · medio ${metrics.bySeverity.medium} · bajo ${metrics.bySeverity.low}`,
      );
      const tasksAfter = written ? written.tasksAfter : report.tasksAfter;
      io.log(
        `  tareas: ${report.tasksBefore} → ${tasksAfter}${written ? '' : ' (proyección: sin --write no se escribe)'}`,
      );
      io.log(
        `  score que debería moverse: ${
          report.scoreImpact.length === 0
            ? dim('ningún componente (no hay huecos nuevos)')
            : report.scoreImpact.map((entry) => `${entry.component} ↑`).join(', ')
        }`,
      );
      io.log('');
      io.log(`  ${colors.bold('Comprobado')} (${report.checked.length}):`);
      for (const item of report.checked) io.log(`    ${colors.green('✓')} ${item}`);
      if (report.notChecked.length > 0) {
        io.log(`  ${colors.bold('NO comprobado')} (${report.notChecked.length}) — no cuenta como aprobado:`);
        for (const item of report.notChecked) io.log(`    ${colors.yellow('!')} ${item}`);
      }
      if (written) {
        io.log('');
        io.log(`  ${written.written ? colors.green(`✓ ${written.writeDetail}`) : colors.yellow(written.writeDetail)}`);
      } else {
        io.log('');
        io.log(dim('  Sin --write no se ha tocado tasks.md.'));
      }
      io.log('');
      io.log(
        `  ${
          report.converged
            ? colors.green(report.detail)
            : high.length > 0
              ? colors.red(report.detail)
              : colors.yellow(report.detail)
        }`,
      );
      io.log('');
    };

    if (write) {
      const result = await appendConvergence({ cwd: root, feature, report, write: true });
      if (json) {
        io.log(
          JSON.stringify(
            jsonEnvelope({
              command: 'brownfield converge',
              data: { ...report, write: result },
              errors: asFindings(high),
              warnings: asFindings(rest),
              ok: high.length === 0,
              detail: `${report.detail} ${result.detail}`,
            }),
            null,
            2,
          ),
        );
        return exitCode;
      }
      renderConvergence({ written: result.written, tasksAfter: result.tasksAfter, writeDetail: result.detail });
      return exitCode;
    }

    if (json) {
      io.log(
        JSON.stringify(
          jsonEnvelope({
            command: 'brownfield converge',
            data: report,
            errors: asFindings(high),
            warnings: asFindings(rest),
            ok: high.length === 0,
            detail: report.detail,
          }),
          null,
          2,
        ),
      );
      return exitCode;
    }

    renderConvergence();
    return exitCode;
  }

  io.log(`Subcomando desconocido: ${sub}. Usa: survey | constitution [target] [--write|--draft] [--interview [--answers <ruta>] [--write] [--json]] | specify <feature> "<descripción>" [--area A] [--json] [--write] [--questions-file <ruta>] | bootstrap [target] [--focus "<texto>"] [--write] [--json] | templates [target] [--write] [--json] | requirements <feature> [--suggest] [--json] [--apply <índice|código>] [--write] | clarify <feature> [--max N] [--json] [--questions-file <ruta>] [--answers <ruta>] [--write] | converge <feature> [--write] [--json] [--max N] | analyze <feature> [--base <ref>] [--json] | impact <feature> [--base <ref>] | contracts <feature> [--write] [--verify] [--base <ref>] | reuse <feature> [--symbols A,B] [--base <ref>] | forecast "<descripción>" [--symbols A,B] [--json] | repair <feature> --target <artefacto> [--command "<cmd>"] [--requirement REQ-X] [--evidence "<texto>"] [--write] [--json]`);
  return 1;
};
