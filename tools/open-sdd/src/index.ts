import path from 'node:path';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { agentList, getAgentDefinition } from './agents/registry.js';
import { runMcpServer } from './mcp/server.js';
import { handleDoctorCommand } from './core/doctor.js';
import { parseArgs } from './cli/args.js';
import { mergeConfigAndArgs, type EnvRuntime, type UserConfig } from './cli/config.js';
import { planFromFile } from './manifest/planner.js';
import { formatProcessedArtifacts } from './plan/printer.js';
import {
  executeProcessedArtifacts,
  type CategoryPolicy,
  type ConflictDecision,
  type ConflictInfo,
} from './plan/executor.js';
import { buildFileOperations, type FileOperation } from './plan/fileOperations.js';
import { ensureAgentSelection, printCompletionGuide } from './cli/agents.js';
import { determineCategoryPolicies, printSummary, summarizeCategories, type CategoryPolicyMap } from './cli/policies.js';
import { defaultIO, type CliIO } from './cli/io.js';
import { colors, formatBox, formatError, formatHeading, formatSuccess, formatWarning } from './cli/ui/colors.js';
import { isInteractive, promptChoice, promptConfirm } from './cli/ui/prompt.js';
import { handleStatusCommand } from './cli/commands/status.js';
import { handleInitCommand, handleIntegrateCommand, handleImportCommand } from './cli/commands/init.js';
import { handleAuditBundleCommand, handleAuditCommand } from './cli/commands/audit.js';
import { handleGapCommand } from './cli/commands/gap.js';
import { handleGetspecsCommand } from './cli/commands/getspecs.js';
import { handleVerifyCommand } from './cli/commands/verify.js';
import { handleHelpCommand } from './cli/commands/help.js';
import { handleImplCommand } from './cli/commands/impl.js';
import {
  handleGatesCommand,
  handleGovernCommand,
  handleAssureCommand,
  handleWavesCommand,
  handleFloorCommand,
} from './cli/commands/paper.js';
import { handleDeltaCommand, handleBrownfieldCommand } from './cli/commands/brownfield.js';
import { handleTourCommand, handleContextCommand } from './cli/commands/tour.js';
import { SCORE_FOOTER_FLAG, emitScoreFooter } from './cli/jsonOut.js';
import { computeSddScore, explainNextAction, renderScoreFooter } from './core/sddScore.js';

export * from './core/index.js';

/**
 * Version of the package the user actually installed.
 *
 * The published artifact ships `tools/open-sdd/dist` and `templates` but NOT the workspace manifest,
 * so the previous `require('../package.json')` threw inside an installed package and `--version`
 * printed `vdev`. Three levels up from `dist/cli.js` is the repository root in a checkout and the
 * package root once installed, which is exactly the manifest that carries the released version.
 */
const readCliVersion = (): string => {
  const require = createRequire(import.meta.url);
  for (const candidate of ['../../../package.json', '../package.json']) {
    try {
      const pkg = require(candidate);
      if (typeof pkg?.version === 'string' && pkg.version.length > 0) return pkg.version;
    } catch {
      // try the next candidate
    }
  }
  return 'dev';
};

const agentKeys = agentList;
const aliasFlags = Array.from(new Set(agentKeys.flatMap((key) => getAgentDefinition(key).aliasFlags)));

const agentAliasLine = aliasFlags.length > 0 ? `  ${aliasFlags.join(' | ')}  Agent alias flags\n` : '';

const helpText = `Usage: open-sdd [options] (alias: open-sdd)

Options:
  --agent <${agentKeys.join('|')}>  Select agent
${agentAliasLine}  --lang <ja|en|zh-TW|zh|es|pt|de|fr|ru|it|ko|ar|el>  Language
  --os <auto|mac|windows|linux>               Target OS (auto uses runtime)
  --sdd-dir <path>                            SDD root dir (default .sdd or .kiro)
  --kiro-dir <path>                           Alias for --sdd-dir
  --overwrite <prompt|skip|force>             Overwrite policy (default: prompt)
                                              prompt: ask for each file
                                              skip: never overwrite
                                              force: always overwrite
  --backup[=<dir>]                            Enable backup, optional dir
  --profile <full|minimal>                    Select template profile (default: full)
  --manifest <path>                           Manifest JSON path for planning
  --dry-run                                   Print plan only
  --yes, -y                                   Skip prompts (prompt -> force)
  -h, --help                                  Show help
  -v, --version                               Show version

Quick Examples:
  npx open-sdd@latest                         Install Claude Code skills (default)
  npx open-sdd@latest --cursor-skills         Install Cursor IDE skills
  npx open-sdd@latest --antigravity           Install Google Antigravity skills
  npx open-sdd@latest --copilot-skills        Install GitHub Copilot skills
  npx open-sdd@latest --lang es -y            Install in Spanish without prompts

In-Chat Skills (The Apple-grade Experience):
  /sdd-help                                   Interactive guide with real-world examples
  /sdd-getspecs                               Bootstrap existing repository (Brownfield)
  /sdd-discovery <idea>                       Discover and structure new initiatives
  /sdd-spec-quick <feature> --auto            One-shot spec creation & approval
  /sdd-impl <feature>                         Autonomous TDD implementation with review
  /sdd-validate-impl <feature>                Standalone integration verification gate
  /sdd-audit <feature>                        EU AI Act / NIST compliance audit report
  /sdd-spec-status <feature>                  Show real-time progress and next actions

Zero-Trust console (reference architecture):
  gates [chain|crosswalk|list|enforcement|run]  Resolve and run the gate chain
  govern [invariants|conformance|hitl|rigor|appeal|meta-eval|budget]
  assure [threats|lab|claims|skills|memory]
  waves <feature>                             Transactional wave plan with git commands
  floor [status|install] [target] [--ci]       Enforcement floor: commit hook + PR gate matrix
  audit bundle [feature] [--out <dir>] [--json] [--sarif <path>]  Evidence bundle with a sha256 per artifact; SARIF 2.1.0 for code scanning
Brownfield (existing code that is the de facto source of truth):
  brownfield survey [target]                    Detect the stack, boundaries and evidence
  brownfield bootstrap [target] [--focus F] [--write]  One entry point: recon + constitution + module map + code intelligence + steps
  brownfield impact <feature> [--base R]        Dependents, breaking changes, migrations, public API surface
  brownfield contracts <feature> [--write] [--verify]  The regression oracle: which tests protect the change
  brownfield reuse <feature> [--symbols A,B]    Search for existing symbols before creating new ones
  status [feature] [--check] [--quiet] [--json] Whole state on one screen, with the next command to run
  brownfield constitution [target] [--write]   Reverse-engineer the descriptive constitution
  delta init <feature> "<title>"                Scaffold a delta spec (ADDED/MODIFIED/REMOVED/RENAMED)
  delta validate <feature>                      Validate ids, EARS, targets, contracts and traceability
  delta status <feature>                        Change counts, strangulation progress, traceability

Experience layer (bilingual: --lang es|en, or OPEN_SDD_LANG):
  tour [target] [--write] [--lang es|en] [--json]  Guided first run: recon, constitution draft, check, status, delta
  context [feature] [--lang es|en] [--json]        The context pack the MCP server serves, in the terminal

Adoption (the integration matrix and the importers):
  integrate [host] [--write] [--json] [--dry-run]  Register the MCP server for a host and install its skills
  integrate --list                                 The whole matrix: skills layout, invocation syntax, MCP path, verified?
  import [kiro|spec-kit|cc-sdd] [--write] [--json] Map an incumbent's specs into .sdd (a mapping, never a promise)
  hosts: claude-code, cursor, copilot, codex, gemini-cli, windsurf, opencode, antigravity, zed, cline

Score (one number, one door):
  open-sdd                                    Inspect the repository: composite SDD score, phase and the ONE next action
  --no-footer                                 Suppress the score footer on any command (scripts)
  --json | --quiet                            Also suppress the footer: machine and one-line output stay intact

Note: In non-TTY environments, prompt mode falls back to skip.`;

const resolveManifestPath = async (
  resolvedAgent: string,
  argsProfile: 'full' | 'minimal' | undefined,
  manifestArg: string | undefined,
  templatesBase: string,
): Promise<string> => {
  if (manifestArg) return manifestArg;
  const baseDir = path.join(templatesBase, 'manifests');
  const defaultPath = path.join(baseDir, `${resolvedAgent}.json`);
  if (argsProfile === 'minimal') {
    const minimal = path.join(baseDir, `${resolvedAgent}-min.json`);
    try {
      await stat(minimal);
      return minimal;
    } catch {
      return defaultPath;
    }
  }
  return defaultPath;
};

const createConflictHandler = (
  summaries: Awaited<ReturnType<typeof summarizeCategories>>,
  resolvedOverwrite: 'prompt' | 'skip' | 'force',
): ((info: ConflictInfo) => Promise<ConflictDecision>) | undefined => {
  if (!isInteractive()) return undefined;

  const remainingExisting = new Map<string, number>(
    summaries.map((summary) => [summary.category, summary.existing]),
  );
  const stickyDecisions = new Map<string, ConflictDecision>();

  return async (info: ConflictInfo): Promise<ConflictDecision> => {
    const cached = stickyDecisions.get(info.category);
    if (cached) return cached;

    const remaining = remainingExisting.get(info.category) ?? 1;
    remainingExisting.set(info.category, Math.max(remaining - 1, 0));

    const choices: { value: ConflictDecision; label: string; description?: string }[] = [
      { value: 'overwrite', label: 'Overwrite this file', description: 'Replace with the latest template content.' },
      { value: 'skip', label: 'Keep existing file', description: 'Leave the current file unchanged.' },
    ];

    if (info.category === 'project-memory' && info.sourceMode !== 'template-json') {
      choices.splice(1, 0, {
        value: 'append',
        label: 'Append template content',
        description: 'Add new sections after the existing project memory file.',
      });
    }

    const promptMessage = `Update ${info.relTargetPath}?`;
    const defaultIndex = resolvedOverwrite === 'force' ? 0 : 1;
    const decision = await promptChoice(promptMessage, choices, Math.min(defaultIndex, choices.length - 1));

    if (remaining > 1) {
      const applyToRest = await promptConfirm('Apply this choice to remaining files in this category?', true);
      if (applyToRest) stickyDecisions.set(info.category, decision);
    }

    return decision;
  };
};

const showVersion = (io: CliIO): void => {
  const version = readCliVersion();
  io.log(`open-sdd v${version}`);
};

const handleDryRun = async (
  manifestPath: string,
  resolvedConfig: ReturnType<typeof mergeConfigAndArgs>,
  io: CliIO,
  execOpts?: { cwd?: string; templatesRoot?: string },
): Promise<number> => {
  try {
    const plan = await planFromFile(manifestPath, resolvedConfig);
    const operations = await buildFileOperations(plan, resolvedConfig, execOpts);
    const summaries = await summarizeCategories(operations);
    printSummary(summaries, resolvedConfig, io);
    io.log(formatHeading('Artifact details:'));
    io.log(formatProcessedArtifacts(plan));
    return 0;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    io.error(formatError(`Error: ${msg}`));
    return 1;
  }
};

const runPlanExecution = async (
  manifestPath: string,
  resolvedConfig: ReturnType<typeof mergeConfigAndArgs>,
  io: CliIO,
  execOpts?: { cwd?: string; templatesRoot?: string },
): Promise<number> => {
  try {
    const agentDef = getAgentDefinition(resolvedConfig.agent);

    const version = readCliVersion();

    io.log('');
    io.log(formatBox(`open-sdd v${version} / ${agentDef.label}`));

    const plan = await planFromFile(manifestPath, resolvedConfig);
    const operations = await buildFileOperations(plan, resolvedConfig, execOpts);
    const summaries = await summarizeCategories(operations);
    printSummary(summaries, resolvedConfig, io);

    const categoryPolicies: CategoryPolicyMap =
      resolvedConfig.effectiveOverwrite === 'force'
        ? {}
        : await determineCategoryPolicies(summaries, resolvedConfig, io);

    const conflictHandler = createConflictHandler(summaries, resolvedConfig.effectiveOverwrite);
    if (!conflictHandler && resolvedConfig.effectiveOverwrite === 'prompt') {
      io.log(formatWarning('Prompt mode unavailable; existing files will be skipped. Use --yes or --overwrite=force.'));
    }

    const result = await executeProcessedArtifacts(plan, resolvedConfig, {
      cwd: execOpts?.cwd,
      templatesRoot: execOpts?.templatesRoot,
      operations,
      categoryPolicies,
      onConflict: conflictHandler,
      log: (message) => io.log(colors.dim(message)),
    });

    const total = result.written + result.skipped;
    io.log(formatSuccess(`  ${result.written}/${total} files written`) + (result.skipped > 0 ? colors.yellow(`, ${result.skipped} skipped`) : ''));
    io.log('');
    printCompletionGuide(resolvedConfig.agent, io, resolvedConfig.kiroDir);
    return 0;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    io.error(formatError(`Error: ${msg}`));
    return 1;
  }
};

/**
 * ¿El comando invocado ejecuta la cadena Zero-Trust por su cuenta?
 *
 * `gates run` resuelve sus propios ids, perfil, régimen y alcance (`--staged`/`--base`);
 * `audit bundle`/`audit sarif` resuelven la suya. En esos casos el pie NO puede reproducir el
 * veredicto, así que el componente de gates se declara NO MEDIDO en esa ejecución. El invariante que
 * esto protege: el pie jamás puede decir «gates OK» mientras el comando de la misma invocación dice
 * que la cadena NO pasa.
 */
const runsGateChain = (cmd: string, subArgv: string[]): boolean =>
  (cmd === 'gates' && subArgv[0] === 'run') ||
  (cmd === 'audit' && (subArgv[0] === 'bundle' || subArgv[0] === 'sarif'));

/**
 * La puerta: `open-sdd` sin argumentos.
 *
 * NO imprime una lista de comandos como primer movimiento. Inspecciona el repositorio, dice el
 * número compuesto y la fase, da la ÚNICA acción siguiente y explica en una línea por qué ESA acción.
 * Es de SOLO LECTURA y no pregunta nunca: en un no-TTY no hay prompt que ofrecer. El catálogo
 * completo sigue a un flag de distancia (`--help`), que es donde debe estar.
 */
const runScoreDoor = async (io: CliIO, cwd: string): Promise<number> => {
  try {
    const report = await computeSddScore(cwd);
    io.log(renderScoreFooter(report));
    io.log(`Por qué: ${explainNextAction(report)}`);
    io.log('todos los comandos: open-sdd --help');
    return 0;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    io.error(formatError(`Error: ${msg}`));
    return 1;
  }
};

/**
 * Despacho de subcomandos, extraído para que el pie de puntuación se emita en UN solo sitio (el
 * llamante) en vez de en cada comando. Devuelve `undefined` cuando el primer argumento no es un
 * comando conocido: entonces `runCli` conserva el camino heredado (instalación vía `parseArgs`), que
 * es exactamente lo que hacía antes cuando ningún `if` encajaba.
 */
const dispatchSubcommand = async (
  cmd: string,
  subArgv: string[],
  io: CliIO,
  targetCwd: string,
): Promise<number | undefined> => {
  if (cmd === 'status' || cmd === 'spec-status') {
    return handleStatusCommand(subArgv, io, targetCwd);
  }
  if (cmd === 'init' || cmd === 'spec-init') {
    return handleInitCommand(subArgv, io, targetCwd);
  }
  // Adoption surface: the machine-checked integration matrix (`integrate`) and the importers that
  // absorb Kiro, spec-kit and cc-sdd (`import`). Both live in the init command module.
  if (cmd === 'integrate' || cmd === 'import') {
    return cmd === 'integrate'
      ? handleIntegrateCommand(subArgv, io, targetCwd)
      : handleImportCommand(subArgv, io, targetCwd);
  }
  if (cmd === 'audit') {
    if (subArgv[0] === 'bundle' || subArgv[0] === 'sarif') return handleAuditBundleCommand(subArgv, io, targetCwd);
    return handleAuditCommand(subArgv, io, targetCwd);
  }
  if (cmd === 'gap' || cmd === 'validate-gap') {
    return handleGapCommand(subArgv, io, targetCwd);
  }
  if (cmd === 'getspecs') {
    return handleGetspecsCommand(subArgv, io, targetCwd);
  }
  if (cmd === 'verify' || cmd === 'validate-impl') {
    return handleVerifyCommand(subArgv, io, targetCwd);
  }
  if (cmd === 'impl') {
    return handleImplCommand(subArgv, io, targetCwd);
  }
  if (cmd === 'help') {
    return handleHelpCommand(subArgv, io);
  }
  // Reference architecture: the Zero-Trust chain and its supporting models.
  if (cmd === 'gates') {
    return handleGatesCommand(subArgv, io, targetCwd);
  }
  if (cmd === 'govern') {
    return handleGovernCommand(subArgv, io, targetCwd);
  }
  if (cmd === 'assure') {
    return handleAssureCommand(subArgv, io, targetCwd);
  }
  if (cmd === 'doctor') {
    // Self-diagnosis: Node range, CLI reachability, the commit gate and its version and portability,
    // declared rigor, constitution, specs and the offline posture — each with the fix to apply.
    return handleDoctorCommand(subArgv, io, targetCwd);
  }
  if (cmd === 'mcp') {
    // Model Context Protocol over stdio: the agnostic integration surface. Any modern AI host can
    // call the engine's checks and read the constitution as a resource without per-host code.
    return runMcpServer({ cwd: targetCwd });
  }
  if (cmd === 'waves') {
    return handleWavesCommand(subArgv, io, targetCwd);
  }
  if (cmd === 'floor') {
    return handleFloorCommand(subArgv, io, targetCwd);
  }
  // Brownfield: the unit of specification is the delta, not the system.
  if (cmd === 'delta') {
    return handleDeltaCommand(subArgv, io, targetCwd);
  }
  if (cmd === 'brownfield') {
    return handleBrownfieldCommand(subArgv, io, targetCwd);
  }
  // Experience layer: the guided first run and the terminal face of the MCP context pack.
  if (cmd === 'tour') {
    return handleTourCommand(subArgv, io, targetCwd);
  }
  if (cmd === 'context') {
    return handleContextCommand(subArgv, io, targetCwd);
  }
  return undefined;
};

export const runCli = async (
  argv: string[],
  runtime: EnvRuntime = { platform: process.platform, env: process.env },
  io: CliIO = defaultIO,
  loadedConfig: UserConfig = {},
  execOpts?: { cwd?: string; templatesRoot?: string },
): Promise<number> => {
  if (argv.includes('--help') || argv.includes('-h')) {
    io.log(helpText);
    return 0;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    showVersion(io);
    return 0;
  }

  // La puerta. `--no-footer` a solas sigue siendo la puerta (el pie ES la salida de la puerta).
  if (argv.length === 0 || (argv.length === 1 && argv[0] === SCORE_FOOTER_FLAG)) {
    return runScoreDoor(io, execOpts?.cwd ?? process.cwd());
  }

  // Dispatch CLI subcommands
  const firstArg = argv[0];
  if (firstArg && !firstArg.startsWith('-')) {
    const cmd = firstArg.toLowerCase();
    const subArgv = argv.slice(1);
    const targetCwd = execOpts?.cwd ?? process.cwd();
    const code = await dispatchSubcommand(cmd, subArgv, io, targetCwd);
    if (code !== undefined) {
      // El pie de puntuación se emite aquí, en el despachador, y en ningún otro sitio: ningún
      // comando tiene que acordarse. `--json`, `--quiet` y `--no-footer` lo suprimen. Cuando el
      // comando acaba de ejecutar la cadena, el pie declara los gates NO MEDIDOS en vez de arriesgar
      // un «gates OK» que el propio comando desmiente.
      await emitScoreFooter(
        argv,
        io,
        targetCwd,
        runsGateChain(cmd, subArgv) ? { gateContext: 'external' } : {},
      );
      return code;
    }
  }

  let parsedArgs;
  try {
    // `--no-footer` es global y `parseArgs` (camino de instalación) no lo conoce: se filtra aquí
    // para que no se lea como un flag desconocido. En los subcomandos lo lee `emitScoreFooter`.
    parsedArgs = parseArgs(argv.filter((arg) => arg !== SCORE_FOOTER_FLAG));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    io.error(formatError(`Error: ${msg}`));
    return 1;
  }

  parsedArgs.agent = await ensureAgentSelection(parsedArgs.agent ?? loadedConfig.agent, io);

  if (parsedArgs.agent === 'codex') {
    io.log('');
    io.log(formatError('  --codex (prompts mode) is no longer supported.'));
    io.log('');
    io.log(`  Codex no longer loads ${colors.dim('.codex/prompts/')}. Use Skills instead:`);
    io.log('');
    io.log(`  ${colors.bold('npx open-sdd@latest --codex-skills')}`);
    io.log('');
    return 1;
  }

  const resolved = mergeConfigAndArgs(parsedArgs, loadedConfig, runtime);

  const templatesBase = execOpts?.templatesRoot ? path.join(execOpts.templatesRoot, 'templates') : 'templates';
  const manifestPath = await resolveManifestPath(resolved.agent, parsedArgs.profile, parsedArgs.manifest, templatesBase);

  if (parsedArgs.dryRun) {
    return handleDryRun(manifestPath, resolved, io, execOpts);
  }

  return runPlanExecution(manifestPath, resolved, io, execOpts);
};
