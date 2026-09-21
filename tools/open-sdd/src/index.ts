import path from 'node:path';
import { stat } from 'node:fs/promises';
import { getAgentDefinition } from './agents/registry.js';
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
import {
  colors,
  formatBox,
  formatError,
  formatHeading,
  formatSuccess,
  formatWarning,
  setColorMode,
  type ColorMode,
} from './cli/ui/colors.js';
import { isInteractive, promptChoice, promptConfirm, setNonInteractive } from './cli/ui/prompt.js';
import { handleStatusCommand } from './cli/commands/status.js';
import { handleInitCommand, handleIntegrateCommand, handleImportCommand } from './cli/commands/init.js';
import { handleAuditBundleCommand, handleAuditCommand } from './cli/commands/audit.js';
import { handleGapCommand } from './cli/commands/gap.js';
import { handleGetspecsCommand } from './cli/commands/getspecs.js';
import { handleVerifyCommand } from './cli/commands/verify.js';
import { handleUninstallCommand } from './cli/commands/uninstall.js';
import { handleStandardsCommand } from './cli/commands/standards.js';
import { handleRequirementsCommand } from './cli/commands/requirements.js';
import {
  EXIT,
  KNOWN_COMMANDS,
  STRICT_SUBCOMMANDS,
  handleHelpCommand,
  renderCommandHelp,
  renderExplain,
  renderFullHelp,
  suggestCommands,
} from './cli/commands/help.js';
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
import { handleGitflowCommand } from './cli/commands/gitflow.js';
import { handleProgressCommand } from './cli/commands/progress.js';
import { handleBackupCommand } from './cli/commands/backup.js';
import { handleBiographyCommand } from './cli/commands/biography.js';
import { handleTemplatesCommand } from './cli/commands/templates.js';
import { SCORE_FOOTER_FLAG, emitScoreFooter } from './cli/jsonOut.js';
import { PACKAGE_NAME, VERSION, INSTALL_COMMAND } from './cli/packageIdentity.js';
import { localeRefusal, normalizeLocale, parseLangFlag } from './cli/i18n.js';
import { computeSddScore, explainNextAction, renderScoreFooter } from './core/sddScore.js';

export * from './core/index.js';

/**
 * El `--help` completo y la ayuda por comando viven en UNA tabla (`cli/commands/help.ts`): este
 * archivo solo la proyecta. El comando de instalación que se anuncia se deriva del `package.json`
 * de la raíz (`cli/packageIdentity.ts`), nunca se escribe a mano.
 */
export { PACKAGE_NAME, VERSION, INSTALL_COMMAND };


/**
 * El comando de instalación y la versión se derivan de `cli/packageIdentity.ts`; la ayuda de
 * `cli/commands/help.ts`. Aquí no queda ninguna lista de comandos escrita a mano.
 */


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
  io.log(`open-sdd v${VERSION}`);
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

    io.log('');
    io.log(formatBox(`open-sdd v${VERSION} / ${agentDef.label}`));

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
  // Superficie de lectura del día a día: el rol de la rama, el libro de progreso, el respaldo
  // restaurable y la biografía de una especificación. Los cuatro SOLO informan: ninguno ejecuta la
  // cadena de gates (por eso `runsGateChain` no los conoce) ni cambia de rama.
  if (cmd === 'gitflow') {
    return handleGitflowCommand(subArgv, io, targetCwd);
  }
  if (cmd === 'progress') {
    return handleProgressCommand(subArgv, io, targetCwd);
  }
  if (cmd === 'backup') {
    return handleBackupCommand(subArgv, io, targetCwd);
  }
  if (cmd === 'biography') {
    return handleBiographyCommand(subArgv, io, targetCwd);
  }
  // El camino por defecto se puede LEER: las 22 plantillas, qué escribe cada una, dónde las lee cada
  // anfitrión y si ya están instaladas aquí. Solo informa: no escribe y no ejecuta la cadena.
  if (cmd === 'templates') {
    return handleTemplatesCommand(subArgv, io, targetCwd);
  }
  // El motor de estándares (W2): el catálogo se lista, se muestra, se comprueba y se repara.
  if (cmd === 'standards') {
    return handleStandardsCommand(subArgv, io, targetCwd);
  }
  // El coach de requisitos (W3): la revisión de calidad, el checklist ejecutable y la reparación.
  // `review` es la misma puerta con el subcomando delante, para que `review <feature> --base <ref>`
  // y `requirements review <feature>` compartan una sola implementación.
  if (cmd === 'requirements') {
    return handleRequirementsCommand(['requirements', ...subArgv], io, targetCwd);
  }
  if (cmd === 'review') {
    return handleRequirementsCommand(['review', ...subArgv], io, targetCwd);
  }
  // Reversibilidad (tenet 12): la salida de una herramienta invasiva. `restore` es el mismo
  // comando visto desde un recibo concreto, y el módulo lo distingue por su primer argumento.
  if (cmd === 'uninstall') {
    return handleUninstallCommand(subArgv, io, targetCwd);
  }
  if (cmd === 'restore') {
    return handleUninstallCommand(['restore', ...subArgv], io, targetCwd);
  }
  // `explain <code>`: cada código de gate resuelve offline contra la misma tabla que `gates list`.
  if (cmd === 'explain') {
    const code = subArgv.find((arg) => !arg.startsWith('-'));
    if (!code) {
      io.error(formatError('error[usage]: `explain` needs a gate code'));
      io.error(`  = help: run \`open-sdd gates list\`, or \`open-sdd explain C1\``);
      return EXIT.USAGE;
    }
    const explained = renderExplain(code);
    if (!explained.ok) {
      io.error(formatError(explained.text));
      for (const suggestion of explained.suggestions) {
        io.error(`  = help: did you mean \`${suggestion}\`? Run \`open-sdd explain ${suggestion}\``);
      }
      io.error('  = help: run `open-sdd gates list` for every code');
      return EXIT.USAGE;
    }
    io.log(explained.text);
    return EXIT.PASSED;
  }
  return undefined;
};

// ---------------------------------------------------------------------------------------------
// Contrato de consola: banderas globales, sugerencias y códigos de salida
// ---------------------------------------------------------------------------------------------

const COLOR_FLAG = '--color';
const NO_INPUT_FLAG = '--no-input';
const COLOR_MODES: readonly ColorMode[] = ['auto', 'always', 'never'];
const isColorMode = (value: string): value is ColorMode => (COLOR_MODES as readonly string[]).includes(value);

interface GlobalFlags {
  argv: string[];
  color?: ColorMode;
  noInput: boolean;
  colorError?: string;
}

/**
 * Extraer las banderas GLOBALES antes de despachar. `--color=auto|always|never` y `--no-input` son
 * del contrato de consola, no de un comando: se consumen aquí para que ningún comando tenga que
 * conocerlas y para que `parseArgs` no las lea como desconocidas.
 */
const extractGlobalFlags = (argv: readonly string[]): GlobalFlags => {
  const rest: string[] = [];
  let color: ColorMode | undefined;
  let noInput = false;
  let colorError: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (token === NO_INPUT_FLAG) {
      noInput = true;
      continue;
    }
    if (token === COLOR_FLAG) {
      const next = argv[i + 1];
      if (next !== undefined && isColorMode(next)) {
        color = next;
        i += 1;
      } else {
        colorError =
          next === undefined
            ? `\`${COLOR_FLAG}\` needs a value: auto, always or never`
            : `invalid value \`${next}\` for \`${COLOR_FLAG}\`: use auto, always or never`;
      }
      continue;
    }
    if (token.startsWith(`${COLOR_FLAG}=`)) {
      const value = token.slice(COLOR_FLAG.length + 1);
      if (isColorMode(value)) color = value;
      else colorError = `invalid value \`${value}\` for \`${COLOR_FLAG}\`: use auto, always or never`;
      continue;
    }
    rest.push(token);
  }
  return { argv: rest, color, noInput, colorError };
};

/**
 * Diagnóstico de uso. Rustc-shaped, en una sola forma: `error[usage]`, una línea `= help:` con el
 * comando que resuelve, y SIEMPRE el puntero a `--help`. Nunca un callejón sin salida.
 */
const emitUsageError = (
  io: CliIO,
  message: string,
  suggestions: string[],
  runFor: (suggestion: string) => string,
): void => {
  io.error(formatError(`error[usage]: ${message}`));
  for (const suggestion of suggestions) {
    io.error(`  = help: did you mean \`${suggestion}\`? Run \`${runFor(suggestion)}\``);
  }
  io.error('  = help: run `open-sdd --help` to list every command, or `open-sdd help exit-codes`');
};

interface UsageIssue {
  message: string;
  suggestions: string[];
  runFor: (suggestion: string) => string;
}

/**
 * Un subcomando desconocido es un error de USO (2), nunca un fallo de gobernanza (1) y nunca el
 * camino de instalación. Solo se valida el primer posicional de los comandos cuyo primer posicional
 * ES un subcomando (`STRICT_SUBCOMMANDS`): `audit <feature>` o `progress` sin subcomando siguen
 * siendo válidos.
 */
const validateSubcommand = (cmd: string, subArgv: readonly string[]): UsageIssue | null => {
  const known = STRICT_SUBCOMMANDS[cmd];
  if (!known) return null;
  const first = subArgv[0];
  if (first === undefined || first.startsWith('-')) return null;
  if (known.includes(first)) return null;
  return {
    message: `unknown subcommand \`${first}\` for \`${cmd}\``,
    suggestions: suggestCommands(first, known),
    runFor: (suggestion) => `open-sdd ${cmd} ${suggestion}`,
  };
};

export const runCli = async (
  rawArgv: string[],
  runtime: EnvRuntime = { platform: process.platform, env: process.env },
  io: CliIO = defaultIO,
  loadedConfig: UserConfig = {},
  execOpts?: { cwd?: string; templatesRoot?: string },
): Promise<number> => {
  const global = extractGlobalFlags(rawArgv);
  // Se fija por invocación (no se acumula): una llamada con `--color=never` no debe teñir la
  // siguiente, y `--no-input` no debe sobrevivir a su ejecución.
  setColorMode(global.color ?? 'auto');
  setNonInteractive(global.noInput);
  if (global.colorError !== undefined) {
    emitUsageError(io, global.colorError, [], () => 'open-sdd --help');
    return EXIT.USAGE;
  }
  const argv = global.argv;

  // La ayuda va primero: `--help` con un comando delante devuelve la ayuda DE ESE comando desde la
  // MISMA tabla que el índice (`init --help`, `doctor --help`, `integrate --help`).
  if (argv.includes('--help') || argv.includes('-h')) {
    const first = argv[0];
    if (first && !first.startsWith('-')) {
      const commandHelp = renderCommandHelp(first.toLowerCase());
      if (commandHelp) {
        io.log(commandHelp);
        return EXIT.PASSED;
      }
    }
    io.log(renderFullHelp());
    return EXIT.PASSED;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    showVersion(io);
    return EXIT.PASSED;
  }

  // Locales honestas (REQ-RQC-012): un idioma sin traducción se RECHAZA por nombre y se listan las
  // traducidas. Nunca se acepta en silencio para devolver español.
  const requestedLang = parseLangFlag(argv);
  if (requestedLang !== undefined && requestedLang.length > 0 && normalizeLocale(requestedLang) === undefined) {
    io.error(formatError(`error[usage]: ${localeRefusal(requestedLang)}`));
    io.error(`  = help: run \`open-sdd --help\` to see the translated locales, or \`open-sdd help formatting\``);
    return EXIT.USAGE;
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

    const usageIssue = validateSubcommand(cmd, subArgv);
    if (usageIssue) {
      emitUsageError(io, usageIssue.message, usageIssue.suggestions, usageIssue.runFor);
      return EXIT.USAGE;
    }

    const code = await dispatchSubcommand(cmd, subArgv, io, targetCwd);
    if (code !== undefined) {
      // El pie de puntuación se emite aquí, en el despachador, y en ningún otro sitio: ningún
      // comando tiene que acordarse. `--json`, `--quiet` y `--no-footer` lo suprimen.
      //
      // Un fallo NUNCA termina en una línea que parezca un éxito: con un código distinto de 0 el pie
      // se SUPRIME. Antes, `gates chainn` salía con 1 y acto seguido imprimía la puerta de puntuación
      // terminando en «gates OK», que es la última línea que leía el usuario.
      //
      // La única excepción es un comando que ejecuta SU PROPIA cadena (`gates run`, `audit
      // bundle|sarif`): ahí el pie NO reproduce el veredicto, declara el componente de gates como «no
      // medido en esta ejecución», y esa línea es honesta aunque el comando falle —de hecho es
      // justamente cuando importa—. Un comando así nunca puede imprimir «gates OK» tras un fallo.
      const runsChain = runsGateChain(cmd, subArgv);
      if (code === EXIT.PASSED || runsChain) {
        // El pie NO se reescribe con `renderCelebrationFooter`/`levelFor` (`core/celebrate.ts`): ese
        // render tiene OTRA forma (`nivel X · fase N/3 · score N/100 · racha: …`), la racha la aporta
        // el trinquete —que aquí no se ejecuta— y sustituir la línea `SDD n% · Fase n · …` rompería un
        // contrato ya fijado por `cliJsonOut`/`cliSddScore`. La celebración vive donde SÍ hay veredicto
        // medido: `status --check` la imprime antes de este pie.
        await emitScoreFooter(argv, io, targetCwd, runsChain ? { gateContext: 'external' } : {});
      }
      return code;
    }

    // Un comando de la tabla sin despacho es un defecto NUESTRO (4), no del usuario.
    if (KNOWN_COMMANDS.has(cmd)) {
      io.error(formatError(`error[tool]: \`${cmd}\` is routed in the help table but has no handler: this is a bug in open-sdd`));
      io.error('  = help: report it at https://github.com/Brujo2020/open-sdd/issues');
      return EXIT.TOOL_BUG;
    }

    // Comando desconocido: error de uso (2) con la sugerencia más cercana y el puntero a `--help`.
    // Nunca cae al camino de instalación (que exige banderas, no un posicional).
    emitUsageError(
      io,
      `unknown command \`${firstArg}\``,
      suggestCommands(cmd, KNOWN_COMMANDS),
      (suggestion) => `open-sdd help ${suggestion}`,
    );
    return EXIT.USAGE;
  }

  let parsedArgs;
  try {
    // `--no-footer` es global y `parseArgs` (camino de instalación) no lo conoce: se filtra aquí
    // para que no se lea como un flag desconocido. En los subcomandos lo lee `emitScoreFooter`.
    parsedArgs = parseArgs(argv.filter((arg) => arg !== SCORE_FOOTER_FLAG));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    io.error(formatError(`Error: ${msg}`));
    return EXIT.GATE_FAILED;
  }

  parsedArgs.agent = await ensureAgentSelection(parsedArgs.agent ?? loadedConfig.agent, io);

  if (parsedArgs.agent === 'codex') {
    io.log('');
    io.log(formatError('  --codex (prompts mode) is no longer supported.'));
    io.log('');
    io.log(`  Codex no longer loads ${colors.dim('.codex/prompts/')}. Use Skills instead:`);
    io.log('');
    io.log(`  ${colors.bold(`${INSTALL_COMMAND} --codex-skills`)}`);
    io.log('');
    return EXIT.GATE_FAILED;
  }

  const resolved = mergeConfigAndArgs(parsedArgs, loadedConfig, runtime);

  const templatesBase = execOpts?.templatesRoot ? path.join(execOpts.templatesRoot, 'templates') : 'templates';
  const manifestPath = await resolveManifestPath(resolved.agent, parsedArgs.profile, parsedArgs.manifest, templatesBase);

  if (parsedArgs.dryRun) {
    return handleDryRun(manifestPath, resolved, io, execOpts);
  }

  return runPlanExecution(manifestPath, resolved, io, execOpts);
};
