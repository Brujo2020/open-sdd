/**
 * Console for the requirements coach (W3): `requirements review`, `requirements checklist`,
 * `requirements fix` and the top-level `review <feature> --base <ref>`.
 *
 * Follows the house command shape (`handleXCommand(argv, io, cwd)`), emits the shared `jsonEnvelope`
 * under `--json`, and never imports the standards engine at module load: the runner is injected by
 * the caller or resolved with a dynamic `import()` inside the handler, so this file type-checks and
 * tests even while `core/standards.ts` is being written by another workstream.
 *
 * Exit codes follow the evolution plan's taxonomy: `0` passed, `1` the repository failed a check,
 * `2` usage error, `3` environment or configuration.
 *
 * The console reports what passed and what was adjudicated. It never states that a specification is
 * correct (REQ-RQC-011).
 */

import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CliIO } from '../io.js';
import { jsonEnvelope, type EnvelopeFinding } from '../jsonOut.js';
import { colors, formatHeading } from '../ui/colors.js';
import { DEFAULT_LOCALE, normalizeLocale, parseLangFlag, SUPPORTED_LOCALES } from '../i18n.js';
import { readSpecMetadata, resolveSddDir } from '../../core/specManager.js';
import type { StandardEntry, StandardRunner } from '../../core/standardsTypes.js';
import {
  applyCoachFix,
  reviewRequirements,
  summarizeReview,
  type CoachFinding,
  type ReviewReport,
} from '../../core/requirementsCoach.js';
import {
  parseChecklist,
  renderChecklistReport,
  verifyChecklist,
  type CommandOutcome,
} from '../../core/checklist.js';
import { renderSpecReview, reviewSpec, type SpecApprovalState, type SpecContractInput } from '../../core/specReview.js';

export interface RequirementsCommandDeps {
  runner?: StandardRunner;
  entries?: StandardEntry[];
  /** Injected in tests: the feature's artifacts. */
  readArtifacts?: (feature: string) => Promise<{ file: string; text: string }[]>;
  /** Injected in tests: the artifacts as they were at `base`. */
  readBaseArtifacts?: (feature: string, base: string) => Promise<{ file: string; text: string }[]>;
  /** Injected in tests: the contracts oracle's answer (tests that would fail). */
  contracts?: SpecContractInput;
  approvals?: SpecApprovalState;
  /** Injected in tests: write checklist evidence or an applied fix. */
  writeFile?: (file: string, content: string) => Promise<void>;
  /** Injected in tests: run a checklist `cmd` predicate. */
  runCommand?: (cmd: string, cwd: string) => CommandOutcome;
  /** Injected in tests: a deterministic evidence timestamp. */
  now?: () => string;
}

const ARTIFACT_NAMES = ['requirements.md', 'plan.md', 'design.md', 'tasks.md', 'brief.md'];

const SPEC_MESSAGES = {
  en: {
    reviewHeading: 'Requirements review',
    noArtifacts: 'no requirement artifact found',
    useFix: 'apply a machine-applicable remedy with',
    checklistHeading: 'Checklist',
    fixHeading: 'Apply remedy',
    reviewPage: 'Change review',
    noFinding: 'no finding matches that id',
    noFix: 'that finding carries a question or prose remedy, not a machine-applicable fix',
  },
  es: {
    reviewHeading: 'Revisión de requisitos',
    noArtifacts: 'no se encontró ningún artefacto de requisitos',
    useFix: 'aplica un remedio aplicable por máquina con',
    checklistHeading: 'Checklist',
    fixHeading: 'Aplicar remedio',
    reviewPage: 'Revisión del cambio',
    noFinding: 'ningún hallazgo coincide con ese id',
    noFix: 'ese hallazgo trae una pregunta o un remedio en prosa, no una corrección aplicable por máquina',
  },
} as const;

type ConsoleLocale = keyof typeof SPEC_MESSAGES;

const usage = (io: CliIO, message: string): number => {
  io.error(message);
  io.error('usage: open-sdd requirements review <feature> [--json] [--strict]');
  io.error('       open-sdd requirements checklist <feature> [--verify] [--json]');
  io.error('       open-sdd requirements fix <feature> --apply <id> [--json] [--dry-run] [--force]');
  io.error('       open-sdd review <feature> --base <ref> [--json]');
  return 2;
};

const flagValue = (argv: readonly string[], name: string): string | undefined => {
  const inline = argv.find((a) => a.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1];
  return undefined;
};

const hasFlag = (argv: readonly string[], name: string): boolean => argv.includes(name);

const heading = (title: string): string => formatHeading(colors.bold(title));

const findingLine = (finding: CoachFinding): string => {
  const location = `${finding.file}:${finding.line}:${finding.column}`;
  const marker = finding.escalate ? colors.red('escalate') : finding.mayBlock ? colors.yellow('may-block') : colors.dim('advisory');
  const remedy = finding.remedies[0]?.text;
  const follow = remedy ? ` → ${remedy}` : finding.question ? ` ? ${finding.question}` : '';
  return `  ${marker} ${colors.cyan(finding.standardId)} ${colors.dim(location)} ${finding.message}${follow}`;
};

const renderReview = (report: ReviewReport, io: CliIO, locale: ConsoleLocale): void => {
  const messages = SPEC_MESSAGES[locale];
  io.log('');
  io.log(heading(`${messages.reviewHeading} · ${report.feature}`));
  io.log(`  ${summarizeReview(report)}`);
  for (const finding of report.findings) io.log(findingLine(finding));
  for (const skipped of report.skipped) io.log(colors.dim(`  skipped ${skipped}`));
  io.log('');
  io.log(colors.dim(`  ${messages.useFix} open-sdd requirements fix ${report.feature} --apply <id>`));
  io.log('');
};

const toEnvelopeFindings = (report: ReviewReport): { errors: EnvelopeFinding[]; warnings: EnvelopeFinding[] } => {
  const errors: EnvelopeFinding[] = [];
  const warnings: EnvelopeFinding[] = [];
  for (const finding of report.findings) {
    const entry: EnvelopeFinding = {
      id: finding.id,
      message: `${finding.standardId} ${finding.file}:${finding.line}:${finding.column} — ${finding.message}${
        finding.remedies[0] ? ` → ${finding.remedies[0].text}` : finding.question ? ` ? ${finding.question}` : ''
      }`,
      artifact: finding.file,
    };
    if (finding.mayBlock && finding.severity === 'error') errors.push(entry);
    else warnings.push(entry);
  }
  return { errors, warnings };
};

const loadArtifacts = async (
  cwd: string,
  sddDir: string,
  feature: string,
  deps: RequirementsCommandDeps,
): Promise<{ file: string; text: string }[]> => {
  if (deps.readArtifacts) return deps.readArtifacts(feature);
  const dir = path.join(cwd, sddDir, 'specs', feature);
  const artifacts: { file: string; text: string }[] = [];
  for (const name of ARTIFACT_NAMES) {
    try {
      const content = await readFile(path.join(dir, name), 'utf8');
      artifacts.push({ file: path.posix.join(sddDir, 'specs', feature, name), text: content });
    } catch {
      // absent artifacts are simply absent; the coach reports checks it could not run as skipped
    }
  }
  return artifacts;
};

const loadBaseArtifacts = async (
  cwd: string,
  sddDir: string,
  feature: string,
  base: string,
  deps: RequirementsCommandDeps,
): Promise<{ file: string; text: string }[]> => {
  if (deps.readBaseArtifacts) return deps.readBaseArtifacts(feature, base);
  const artifacts: { file: string; text: string }[] = [];
  for (const name of ARTIFACT_NAMES) {
    const relative = path.posix.join(sddDir, 'specs', feature, name);
    try {
      const content = execFileSync('git', ['show', `${base}:${relative}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      artifacts.push({ file: relative, text: content });
    } catch {
      // the artifact did not exist at base; an addition is the honest reading
    }
  }
  return artifacts;
};

interface StandardsBundle {
  entries: StandardEntry[];
  runner: StandardRunner;
  engine: boolean;
  /** The catalogue's applicability rule, when the engine ships one. */
  appliesTo?: (entry: StandardEntry, file: string) => boolean;
}

/**
 * Resolve the standards engine. Module load never imports `standards.ts` (another workstream owns
 * it); the handler tries a dynamic import and degrades to the deterministic core when it is absent.
 */
const loadStandards = async (cwd: string, deps: RequirementsCommandDeps): Promise<StandardsBundle> => {
  if (deps.runner) return { entries: deps.entries ?? [], runner: deps.runner, engine: true };
  try {
    const specifier = ['..', 'core', 'standards.js'].join('/');
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      runStandard?: StandardRunner;
      loadStandards?: (cwd?: string, ...rest: unknown[]) => Promise<unknown> | unknown;
      STANDARD_ENTRIES?: StandardEntry[];
      appliesToArtifact?: (entry: StandardEntry, file: string) => boolean;
    };
    if (typeof mod.runStandard !== 'function') return { entries: [], runner: () => [], engine: false };
    const loaded = typeof mod.loadStandards === 'function' ? await mod.loadStandards(cwd) : mod.STANDARD_ENTRIES ?? [];
    const entries = Array.isArray(loaded)
      ? (loaded as StandardEntry[])
      : Array.isArray((loaded as { entries?: unknown } | null)?.entries)
        ? ((loaded as { entries: StandardEntry[] }).entries)
        : [];
    return {
      entries,
      runner: mod.runStandard,
      engine: true,
      ...(typeof mod.appliesToArtifact === 'function' ? { appliesTo: mod.appliesToArtifact } : {}),
    };
  } catch {
    return { entries: [], runner: () => [], engine: false };
  }
};

/** Wrap the engine runner so a catalogue entry only runs on the artifacts it declares. */
const withApplicability = (bundle: StandardsBundle): StandardRunner => {
  if (!bundle.appliesTo) return bundle.runner;
  const appliesTo = bundle.appliesTo;
  return (entry, artifact) => (appliesTo(entry, artifact.file) ? bundle.runner(entry, artifact) : []);
};

const readApprovalState = async (
  cwd: string,
  sddDir: string,
  feature: string,
  deps: RequirementsCommandDeps,
): Promise<SpecApprovalState> => {
  if (deps.approvals) return deps.approvals;
  const meta = await readSpecMetadata(cwd, feature, sddDir);
  const approvals = meta?.approvals as Record<string, unknown> | undefined;
  const accepted = (value: unknown): boolean =>
    typeof value === 'boolean' ? value : value && typeof value === 'object' && 'approved' in value ? Boolean((value as { approved?: unknown }).approved) : false;
  return {
    approved: Boolean(approvals && accepted(approvals.requirements)),
    ...(meta?.updated_at ? { approvedAt: meta.updated_at } : {}),
  };
};

const resolveLocaleOrRefuse = (argv: readonly string[], io: CliIO): ConsoleLocale | null => {
  const requested = parseLangFlag([...argv]) ?? process.env.OPEN_SDD_LANG;
  if (requested && !normalizeLocale(requested)) {
    io.error(
      `unsupported locale "${requested}" · open-sdd requirements is translated for: ${SUPPORTED_LOCALES.join(', ')}`,
    );
    return null;
  }
  return (normalizeLocale(requested) ?? DEFAULT_LOCALE) as ConsoleLocale;
};

const runReview = async (
  feature: string,
  flags: string[],
  io: CliIO,
  cwd: string,
  deps: RequirementsCommandDeps,
  locale: ConsoleLocale,
): Promise<number> => {
  const sddDir = await resolveSddDir(cwd);
  const artifacts = await loadArtifacts(cwd, sddDir, feature, deps);
  if (artifacts.length === 0) {
    io.error(`spec "${feature}" has no requirements artifact under ${sddDir}/specs/${feature}`);
    return 1;
  }
  const bundle = await loadStandards(cwd, deps);
  const { entries, engine } = bundle;
  const report = reviewRequirements({ feature, artifacts, entries, runner: withApplicability(bundle) });
  const strict = hasFlag(flags, '--strict');
  const blockingErrors = report.blocking.filter((f) => f.severity === 'error');
  const failed = strict ? report.blocking.length > 0 : blockingErrors.length > 0;

  if (hasFlag(flags, '--json')) {
    const { errors, warnings } = toEnvelopeFindings(report);
    io.log(
      JSON.stringify(
        jsonEnvelope({
          command: 'requirements review',
          data: {
            feature,
            findings: report.findings,
            checked: report.checked,
            skipped: report.skipped,
            instruments: report.instruments,
            engine,
          },
          errors,
          warnings,
          ok: !failed,
          detail: `requirements review ${feature} · ${summarizeReview(report)}`,
        }),
        null,
        2,
      ),
    );
    return failed ? 1 : 0;
  }

  renderReview(report, io, locale);
  if (!engine) {
    io.log(colors.dim('standards engine not available: the deterministic core ran, catalogue entries were not loaded'));
  }
  return failed ? 1 : 0;
};

const runChecklist = async (
  feature: string,
  flags: string[],
  io: CliIO,
  cwd: string,
  deps: RequirementsCommandDeps,
  locale: ConsoleLocale,
): Promise<number> => {
  const sddDir = await resolveSddDir(cwd);
  const relativeChecklist = path.posix.join(sddDir, 'specs', feature, 'checklist.md');
  const file = path.join(cwd, relativeChecklist);
  let markdown: string;
  try {
    markdown = await readFile(file, 'utf8');
  } catch {
    io.error(`no checklist at ${relativeChecklist}`);
    return 1;
  }

  const verify = hasFlag(flags, '--verify');
  if (!verify) {
    const parsed = parseChecklist(markdown);
    if (hasFlag(flags, '--json')) {
      io.log(
        JSON.stringify(
          jsonEnvelope({
            command: 'requirements checklist',
            data: { feature, items: parsed.items, problems: parsed.problems, verified: false },
            errors: parsed.problems.map((p) => ({ id: p.itemId, message: p.reason, artifact: file })),
            detail: `${parsed.items.length} checklist item(s), ${parsed.problems.length} problem(s)`,
          }),
          null,
          2,
        ),
      );
      return parsed.problems.length > 0 ? 1 : 0;
    }
    io.log('');
    io.log(heading(`${SPEC_MESSAGES[locale].checklistHeading} · ${feature}`));
    for (const item of parsed.items) {
      const marker = item.checked ? colors.green('[x]') : colors.dim('[ ]');
      const predicates = item.predicates.map((p) => `${p.kind}:${p.value}`).join(' · ') || colors.red('no predicate');
      io.log(`  ${marker} ${colors.cyan(item.id)} ${item.title} → ${predicates}`);
    }
    for (const problem of parsed.problems) io.log(colors.red(`  problem ${problem.itemId} line ${problem.line}: ${problem.reason}`));
    io.log('');
    return parsed.problems.length > 0 ? 1 : 0;
  }

  const artifacts = await loadArtifacts(cwd, sddDir, feature, deps);
  const result = verifyChecklist({
    markdown,
    cwd,
    artifacts,
    ...(deps.runCommand ? { runCommand: deps.runCommand } : {}),
    ...(deps.now ? { recordedAt: deps.now() } : {}),
  });
  const writer = deps.writeFile ?? ((target: string, content: string) => writeFile(path.join(cwd, target), content, 'utf8'));
  try {
    await writer(relativeChecklist, result.content);
  } catch (error) {
    io.error(`could not record checklist evidence: ${error instanceof Error ? error.message : String(error)}`);
    return 3;
  }

  if (hasFlag(flags, '--json')) {
    io.log(
      JSON.stringify(
        jsonEnvelope({
          command: 'requirements checklist',
          data: {
            feature,
            verified: true,
            passed: result.passed,
            checkedItems: result.checkedItems,
            failures: result.failures,
            stale: result.stale,
            evidenceMarker: result.evidenceMarker,
          },
          errors: result.failures.map((f) => ({ id: f.itemId, message: f.reason, artifact: file })),
          warnings: result.stale.map((f) => ({ id: f.itemId, message: f.reason, artifact: file })),
          detail: `${result.passed} checklist item(s) verified, ${result.failures.length} failure(s)`,
        }),
        null,
        2,
      ),
    );
    return result.failures.length > 0 ? 1 : 0;
  }
  io.log('');
  io.log(heading(`${SPEC_MESSAGES[locale].checklistHeading} · ${feature}`));
  io.log(renderChecklistReport(result));
  io.log('');
  return result.failures.length > 0 ? 1 : 0;
};

const runFix = async (
  feature: string,
  flags: string[],
  io: CliIO,
  cwd: string,
  deps: RequirementsCommandDeps,
  locale: ConsoleLocale,
): Promise<number> => {
  const applyId = flagValue(flags, '--apply');
  if (!applyId) return usage(io, 'requirements fix needs --apply <finding-id>');
  const sddDir = await resolveSddDir(cwd);
  const artifacts = await loadArtifacts(cwd, sddDir, feature, deps);
  const bundle = await loadStandards(cwd, deps);
  const report = reviewRequirements({ feature, artifacts, entries: bundle.entries, runner: withApplicability(bundle) });
  const finding = report.findings.find((f) => f.id === applyId || f.standardId === applyId);
  if (!finding) {
    io.error(`${SPEC_MESSAGES[locale].noFinding}: ${applyId}`);
    return 1;
  }
  const machineApplicable = finding.remedies.some((r) => r.grade === 'machine-applicable');
  const force = hasFlag(flags, '--force');
  if (!machineApplicable && !force) {
    io.error(`${SPEC_MESSAGES[locale].noFix}`);
    for (const remedy of finding.remedies) io.log(`  ${remedy.grade}: ${remedy.text}`);
    if (finding.question) io.log(`  question: ${finding.question}`);
    return 1;
  }
  const artifact = artifacts.find((a) => a.file === finding.file);
  if (!artifact) {
    io.error(`the artifact ${finding.file} is not part of the review`);
    return 3;
  }
  const applied = applyCoachFix(artifact.text, finding);
  if (!applied) {
    io.error(`finding ${applyId} carries no exact splice, so nothing was written`);
    return 1;
  }
  const dryRun = hasFlag(flags, '--dry-run');
  if (!dryRun) {
    const writer = deps.writeFile ?? ((target: string, content: string) => writeFile(path.join(cwd, target), content, 'utf8'));
    await writer(artifact.file, applied.text);
  }
  if (hasFlag(flags, '--json')) {
    io.log(
      JSON.stringify(
        jsonEnvelope({
          command: 'requirements fix',
          data: { feature, applied: finding.id, standardId: finding.standardId, file: finding.file, dryRun },
          detail: `applied ${finding.id} (${finding.standardId}) to ${finding.file}${dryRun ? ' (dry run)' : ''}`,
        }),
        null,
        2,
      ),
    );
    return 0;
  }
  io.log('');
  io.log(heading(`${SPEC_MESSAGES[locale].fixHeading} · ${finding.id} · ${finding.standardId}`));
  io.log(`  ${dryRun ? 'would write' : 'wrote'} ${finding.file}`);
  io.log('');
  return 0;
};

const runChangeReview = async (
  feature: string,
  flags: string[],
  io: CliIO,
  cwd: string,
  deps: RequirementsCommandDeps,
  locale: ConsoleLocale,
): Promise<number> => {
  const base = flagValue(flags, '--base');
  if (!base) return usage(io, 'review needs --base <ref>');
  const sddDir = await resolveSddDir(cwd);
  const artifacts = await loadArtifacts(cwd, sddDir, feature, deps);
  const baseArtifacts = await loadBaseArtifacts(cwd, sddDir, feature, base, deps);
  const bundle = await loadStandards(cwd, deps);
  const approvals = await readApprovalState(cwd, sddDir, feature, deps);
  const result = reviewSpec({
    feature,
    base,
    artifacts,
    baseArtifacts,
    contracts: deps.contracts ?? { tests: [] },
    runner: withApplicability(bundle),
    entries: bundle.entries,
    approvals,
  });

  if (hasFlag(flags, '--json')) {
    io.log(
      JSON.stringify(
        jsonEnvelope({
          command: 'review',
          data: result,
          errors: result.unapprovedChanges.map((row) => ({
            id: row.id,
            message: `requirement ${row.id} changed (${row.change}) without approval · risk ${row.risk}/100`,
          })),
          ok: result.exitCode === 0,
          detail: result.detail,
        }),
        null,
        2,
      ),
    );
    return result.exitCode;
  }
  io.log('');
  io.log(heading(`${SPEC_MESSAGES[locale].reviewPage} · ${feature}`));
  io.log(renderSpecReview(result));
  io.log('');
  return result.exitCode;
};

/**
 * Dispatch `requirements review|checklist|fix` and the top-level `review`. `argv` carries its head
 * (`['requirements', ...]` or `['review', ...]`) so both routing lines share one handler.
 */
export const handleRequirementsCommand = async (
  argv: string[],
  io: CliIO,
  cwd: string = process.cwd(),
  deps: RequirementsCommandDeps = {},
): Promise<number> => {
  const locale = resolveLocaleOrRefuse(argv, io);
  if (locale === null) return 1;

  const head = (argv[0] ?? '').toLowerCase();
  if (head === 'review') {
    const group = (argv[1] ?? '').toLowerCase();
    if (group === 'review' || group === 'checklist' || group === 'fix') {
      // `requirements review …`
      const feature = argv[2];
      const flags = argv.slice(3);
      if (!feature || feature.startsWith('-')) return usage(io, 'requirements needs a <feature>');
      if (group === 'review') return runReview(feature, flags, io, cwd, deps, locale);
      if (group === 'checklist') return runChecklist(feature, flags, io, cwd, deps, locale);
      return runFix(feature, flags, io, cwd, deps, locale);
    }
    const feature = argv[1];
    const flags = argv.slice(2);
    if (!feature || feature.startsWith('-')) return usage(io, 'review needs a <feature>');
    return runChangeReview(feature, flags, io, cwd, deps, locale);
  }

  if (head === 'requirements') {
    const group = (argv[1] ?? '').toLowerCase();
    const feature = argv[2];
    const flags = argv.slice(3);
    if (group === 'review') {
      if (!feature || feature.startsWith('-')) return usage(io, 'requirements review needs a <feature>');
      return runReview(feature, flags, io, cwd, deps, locale);
    }
    if (group === 'checklist') {
      if (!feature || feature.startsWith('-')) return usage(io, 'requirements checklist needs a <feature>');
      return runChecklist(feature, flags, io, cwd, deps, locale);
    }
    if (group === 'fix') {
      if (!feature || feature.startsWith('-')) return usage(io, 'requirements fix needs a <feature>');
      return runFix(feature, flags, io, cwd, deps, locale);
    }
    return usage(io, `unknown requirements subcommand "${group}"`);
  }

  // Tolerate the bare form `handleRequirementsCommand(['<feature>', '--base', …])`.
  const feature = argv[0];
  const flags = argv.slice(1);
  if (feature && !feature.startsWith('-') && hasFlag(flags, '--base')) {
    return runChangeReview(feature, flags, io, cwd, deps, locale);
  }
  return usage(io, 'requirements needs a subcommand: review, checklist or fix');
};
