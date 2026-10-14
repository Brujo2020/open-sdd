/**
 * Console for the SDD modes and the deterministic modules ported from SteelForge:
 *   modes      [--level <l>] [--brownfield] [--governance <g>] [--json]   the flows and the module matrix
 *   modes      --project <type> [--json]                                which skills, in which order, for a kind of project
 *   stages     <feature> [--json]                                         where the feature is and what it needs
 *   gherkin    <feature> [--lang es|en] [--write] [--json]                EARS criteria → acceptance.feature
 *   archive    <feature> [--confirm] [--json]                             move a finished spec to .sdd/archive/
 *   discovery  lint <feature> [--json]                                    gate over brief.md
 *   discovery  log <feature> <type> <text…>                              append to discovery.log.md
 *   steering   check [--json]                                             readiness of .sdd/steering/
 * Only `gherkin --write`, `archive --confirm` and `discovery log` write; everything else reads.
 */
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CliIO } from '../io.js';
import { jsonEnvelope } from '../jsonOut.js';
import { colors, formatHeading } from '../ui/colors.js';
import { archiveFeature } from '../../core/archive.js';
import { appendDiscoveryLog, lintBrief, LOG_TYPES } from '../../core/discoveryBrief.js';
import { buildFeatureFile, lintGherkin, type GherkinLang } from '../../core/earsGherkin.js';
import { loadRigorSettings } from '../../core/rigor.js';
import { FLOWS, LEVELS, modulesFor, projectTypes, stagesFor, type Governance, type Level } from '../../core/sddModes.js';
import { parseRequirementsMarkdown, parseTasksMarkdown, readSpecMetadata, resolveSddDir } from '../../core/specManager.js';
import { findRepoRoot } from '../../core/status.js';
import { checkSteering } from '../../core/steeringCheck.js';

const flagValue = (argv: readonly string[], name: string): string | undefined => {
  const inline = argv.find((a) => a.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};
const has = (argv: readonly string[], name: string): boolean => argv.includes(name);
const positional = (argv: readonly string[]): string[] => argv.filter((a, i) => !a.startsWith('-') && !['--level', '--governance', '--lang', '--project'].includes(argv[i - 1] ?? ''));
const readOrNull = (p: string): Promise<string | null> => readFile(p, 'utf8').catch(() => null);
const exists = async (p: string): Promise<boolean> => (await stat(p).catch(() => null)) !== null;
const STATE = { on: colors.green('on '), opt: colors.yellow('opt'), off: colors.dim('off') } as const;

const usage = (io: CliIO, message: string): number => {
  io.error(message);
  io.error('usage: open-sdd modes [--level explore|spec-first|spec-anchored|spec-as-source] [--brownfield] [--governance solo|team|enterprise] [--json]');
  io.error('       open-sdd modes --projects | --project <greenfield|brownfield-extension|legacy-untested|bug|refactor|spike|fuzzy-idea|multi-feature> [--json]');
  io.error('       open-sdd stages <feature> [--json]');
  io.error('       open-sdd gherkin <feature> [--lang es|en] [--write] [--json]');
  io.error('       open-sdd archive <feature> [--confirm] [--json]');
  io.error('       open-sdd discovery lint <feature> [--json] | discovery log <feature> <type> <text>');
  io.error('       open-sdd steering check [--json]');
  return 2;
};

const runModes = async (argv: string[], io: CliIO, cwd: string): Promise<number> => {
  const project = flagValue(argv, '--project');
  if (project !== undefined || has(argv, '--projects')) {
    const types = projectTypes(project);
    if (has(argv, '--json')) {
      io.log(JSON.stringify(jsonEnvelope({ command: 'modes --project', data: { types } }), null, 2));
      return 0;
    }
    for (const p of types) {
      io.log('');
      io.log(formatHeading(colors.bold(`${p.label} · ${p.level} · ${p.terrain}`)));
      io.log(colors.dim(`  cuándo: ${p.when}`));
      p.sequence.forEach((s, i) => io.log(`  ${colors.cyan(String(i + 1).padStart(2))}. ${s}`));
      for (const a of p.avoid) io.log(colors.yellow(`   ✗ ${a}`));
    }
    io.log('');
    return 0;
  }
  const settings = await loadRigorSettings(cwd).catch(() => null);
  const level = (flagValue(argv, '--level') ?? settings?.level ?? 'spec-first') as Level;
  if (!(LEVELS as readonly string[]).includes(level)) return usage(io, `nivel desconocido «${level}»`);
  const terrain = has(argv, '--brownfield') || settings?.brownfield ? 'brownfield' : 'greenfield';
  const governance = (flagValue(argv, '--governance') ?? 'solo') as Governance;
  const modules = modulesFor({ level, terrain, governance });
  if (has(argv, '--json')) {
    io.log(JSON.stringify(jsonEnvelope({ command: 'modes', data: { level, terrain, governance, flows: FLOWS, modules, projectTypes: projectTypes() } }), null, 2));
    return 0;
  }
  io.log('');
  io.log(formatHeading(colors.bold(`SDD modes · ${level} · ${terrain} · ${governance}`)));
  io.log(colors.bold('  Flows'));
  for (const f of FLOWS) io.log(`  ${colors.cyan(f.label.padEnd(11))} ${f.skill.padEnd(24)} writes ${f.writes.padEnd(9)} ${colors.dim(f.about)}`);
  io.log(colors.bold('  Modules'));
  for (const m of modules) io.log(`  ${STATE[m.state]} ${m.label.padEnd(13)} ${colors.dim(m.origin.padEnd(10))} ${m.run}`);
  io.log(colors.dim('  ¿Qué skills usar según el tipo de proyecto? open-sdd modes --projects'));
  io.log('');
  return 0;
};

const runStages = async (feature: string, argv: string[], io: CliIO, cwd: string): Promise<number> => {
  const root = await findRepoRoot(cwd);
  const sddDir = await resolveSddDir(root);
  const spec = path.join(root, sddDir, 'specs', feature);
  const settings = await loadRigorSettings(root).catch(() => null);
  const level = (flagValue(argv, '--level') ?? settings?.level ?? 'spec-first') as Level;
  const terrain = settings?.brownfield ? 'brownfield' : 'greenfield';
  const requirements = await readOrNull(path.join(spec, 'requirements.md'));
  const plan = (await readOrNull(path.join(spec, 'plan.md'))) ?? (await readOrNull(path.join(spec, 'design.md')));
  const tasksText = await readOrNull(path.join(spec, 'tasks.md'));
  const tasks = tasksText ? parseTasksMarkdown(tasksText) : [];
  const steering = terrain === 'brownfield' ? await checkSteering(root, path.join(root, sddDir, 'steering')) : undefined;
  const result = stagesFor({
    level,
    terrain,
    hasSddDir: await exists(path.join(root, sddDir)),
    steering: steering && { present: steering.present, ready: steering.ready },
    constitution: await exists(path.join(root, sddDir, 'steering', 'constitution.md')),
    artifacts: { tiny: await exists(path.join(spec, 'tiny.md')), requirements: requirements !== null, design: plan !== null, tasks: tasksText !== null, delta: await exists(path.join(spec, 'delta.md')) },
    meta: await readSpecMetadata(root, feature, sddDir).catch(() => null),
    tasks: { done: tasks.filter((t) => t.status === 'completed').length, total: tasks.length },
    clarify: `${requirements ?? ''}\n${plan ?? ''}`.split('[NEEDS CLARIFICATION]').length - 1,
  });
  if (has(argv, '--json')) {
    io.log(JSON.stringify(jsonEnvelope({ command: 'stages', data: { feature, level, terrain, ...result } }), null, 2));
    return 0;
  }
  io.log('');
  io.log(formatHeading(colors.bold(`Stages · ${feature} · ${level}`)));
  for (const s of result.stages) {
    const mark = s.state === 'done' ? colors.green('✔') : s.state === 'active' ? colors.yellow('▶') : colors.dim('·');
    io.log(`  ${mark} ${s.label.padEnd(13)} ${colors.dim(s.run.padEnd(34))} ${s.needs}`);
  }
  io.log('');
  return 0;
};

const runGherkin = async (feature: string, argv: string[], io: CliIO, cwd: string): Promise<number> => {
  const root = await findRepoRoot(cwd);
  const sddDir = await resolveSddDir(root);
  const rel = path.posix.join(sddDir, 'specs', feature, 'requirements.md');
  const md = await readOrNull(path.join(root, rel));
  if (md === null) {
    io.error(`no hay ${rel}`);
    return 1;
  }
  const meta = await readSpecMetadata(root, feature, sddDir).catch(() => null);
  const lang = (flagValue(argv, '--lang') ?? (meta?.language === 'es' ? 'es' : 'en')) as GherkinLang;
  if (lang !== 'es' && lang !== 'en') return usage(io, '--lang debe ser es o en');
  const built = buildFeatureFile(feature, parseRequirementsMarkdown(md), lang);
  const problems = built.converted.length ? lintGherkin(built.text) : ['ningún criterio EARS convertible'];
  const outRel = path.posix.join(sddDir, 'specs', feature, 'acceptance.feature');
  const write = has(argv, '--write') && problems.length === 0;
  if (write) await writeFile(path.join(root, outRel), built.text, 'utf8');
  if (has(argv, '--json')) {
    io.log(JSON.stringify(jsonEnvelope({ command: 'gherkin', data: { feature, lang, converted: built.converted, skipped: built.skipped, empty: built.empty, written: write ? outRel : null, feature_file: built.text }, errors: problems, warnings: built.skipped }), null, 2));
    return problems.length ? 1 : 0;
  }
  io.log(built.text);
  for (const s of built.skipped) io.log(colors.yellow(`  omitido: ${s}`));
  for (const e of built.empty) io.log(colors.dim(`  ${e}: sin criterios de aceptación`));
  for (const p of problems) io.log(colors.red(`  ${p}`));
  io.log(write ? colors.green(`  escrito ${outRel}`) : colors.dim(`  ${built.converted.length} escenario(s); --write lo guarda en ${outRel}`));
  return problems.length ? 1 : 0;
};

const runArchive = async (feature: string, argv: string[], io: CliIO, cwd: string): Promise<number> => {
  const root = await findRepoRoot(cwd);
  const r = await archiveFeature({ root, sddDir: await resolveSddDir(root), feature, confirm: has(argv, '--confirm') });
  if (has(argv, '--json')) {
    io.log(JSON.stringify(jsonEnvelope({ command: 'archive', data: r, errors: r.readiness.blockers, detail: r.detail }), null, 2));
  } else io.log(r.readiness.ready ? colors.green(`  ${r.detail}`) : colors.red(`  ${r.detail}`));
  return r.readiness.ready ? 0 : 1;
};

const runDiscovery = async (argv: string[], io: CliIO, cwd: string): Promise<number> => {
  const [sub, feature, type, ...rest] = positional(argv);
  if (!feature) return usage(io, 'discovery necesita <feature>');
  const root = await findRepoRoot(cwd);
  const dir = path.join(root, await resolveSddDir(root), 'specs', feature);
  if (sub === 'lint') {
    const md = await readOrNull(path.join(dir, 'brief.md'));
    if (md === null) {
      io.error(`no hay brief.md en ${feature}: /sdd-discovery lo escribe`);
      return 1;
    }
    const r = lintBrief(md);
    if (has(argv, '--json')) io.log(JSON.stringify(jsonEnvelope({ command: 'discovery lint', data: { feature, ...r }, errors: r.problems }), null, 2));
    else {
      io.log(r.ok ? colors.green('  brief listo para /sdd-spec-requirements') : colors.red('  el brief aún no se puede promover:'));
      for (const p of r.problems) io.log(`  - ${p}`);
    }
    return r.ok ? 0 : 1;
  }
  if (sub === 'log') {
    if (!type || rest.length === 0) return usage(io, `discovery log necesita <type> (${LOG_TYPES.join(' · ')}) y un texto`);
    if (!(await exists(dir))) {
      io.error(`no existe la spec ${feature}`);
      return 1;
    }
    try {
      io.log(await appendDiscoveryLog(path.join(dir, 'discovery.log.md'), type, rest.join(' ')));
      return 0;
    } catch (error) {
      io.error((error as Error).message);
      return 1;
    }
  }
  return usage(io, `subcomando de discovery desconocido «${sub ?? ''}»`);
};

const runSteering = async (argv: string[], io: CliIO, cwd: string): Promise<number> => {
  if (positional(argv)[0] !== 'check') return usage(io, 'steering solo admite «check»');
  const root = await findRepoRoot(cwd);
  const r = await checkSteering(root, path.join(root, await resolveSddDir(root), 'steering'));
  const errors = [...r.missing.map((m) => `falta ${m}`), ...r.files.flatMap((f) => f.errors.map((e) => `${f.file}: ${e}`))];
  const warnings = r.files.filter((f) => f.pending > 0).map((f) => `${f.file}: ${f.pending} marca(s) (inferido / NEEDS CLARIFICATION) por confirmar`);
  if (has(argv, '--json')) io.log(JSON.stringify(jsonEnvelope({ command: 'steering check', data: r, errors, warnings, ok: r.ready }), null, 2));
  else {
    io.log(r.ready ? colors.green('  steering listo') : colors.yellow('  steering aún es un borrador:'));
    for (const l of [...errors, ...warnings]) io.log(`  - ${l}`);
  }
  return r.ready ? 0 : 1;
};

/**
 * Dispatch `modes`, `stages`, `gherkin`, `archive`, `discovery` and `steering`.
 * @param cmd - top-level command.
 * @param argv - arguments after the command.
 */
export const handleModesCommand = async (cmd: string, argv: string[], io: CliIO, cwd: string = process.cwd()): Promise<number> => {
  try {
    if (cmd === 'modes') return await runModes(argv, io, cwd);
    if (cmd === 'discovery') return await runDiscovery(argv, io, cwd);
    if (cmd === 'steering') return await runSteering(argv, io, cwd);
    const feature = positional(argv)[0];
    if (!feature) return usage(io, `${cmd} necesita <feature>`);
    if (cmd === 'stages') return await runStages(feature, argv, io, cwd);
    if (cmd === 'gherkin') return await runGherkin(feature, argv, io, cwd);
    if (cmd === 'archive') return await runArchive(feature, argv, io, cwd);
    return usage(io, `comando desconocido «${cmd}»`);
  } catch (error) {
    io.error(colors.red((error as Error).message));
    return 1;
  }
};
