import path from 'node:path';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { agentList, getAgentDefinition } from './agents/registry.js';
import { runMcpServer } from './mcp/server.js';
import { handleDoctorCommand } from './core/doctor.js';
import { parseArgs } from './cli/args.js';
import { mergeConfigAndArgs } from './cli/config.js';
import { planFromFile } from './manifest/planner.js';
import { formatProcessedArtifacts } from './plan/printer.js';
import { executeProcessedArtifacts, } from './plan/executor.js';
import { buildFileOperations } from './plan/fileOperations.js';
import { ensureAgentSelection, printCompletionGuide } from './cli/agents.js';
import { determineCategoryPolicies, printSummary, summarizeCategories } from './cli/policies.js';
import { defaultIO } from './cli/io.js';
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
import { handleGatesCommand, handleGovernCommand, handleAssureCommand, handleWavesCommand, handleFloorCommand, } from './cli/commands/paper.js';
import { handleDeltaCommand, handleBrownfieldCommand } from './cli/commands/brownfield.js';
import { handleTourCommand, handleContextCommand } from './cli/commands/tour.js';
import { handleGitflowCommand } from './cli/commands/gitflow.js';
import { handleProgressCommand } from './cli/commands/progress.js';
import { handleBackupCommand } from './cli/commands/backup.js';
import { handleBiographyCommand } from './cli/commands/biography.js';
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
const readCliVersion = () => {
    const require = createRequire(import.meta.url);
    for (const candidate of ['../../../package.json', '../package.json']) {
        try {
            const pkg = require(candidate);
            if (typeof pkg?.version === 'string' && pkg.version.length > 0)
                return pkg.version;
        }
        catch {
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
  govern [invariants|conformance|hitl|rigor|constitution|appeal|meta-eval|budget|discipline]  Invariants, conformance, rigor and the constitution draft/ratify
  assure [threats|lab|claims|skills|memory]    OWASP/ATLAS threats, claims registry, skills and memory
  waves <feature>                             Transactional wave plan with git commands
  floor [status|install] [target] [--ci]       Enforcement floor: commit hook + PR gate matrix
  audit [bundle|sarif] [feature] [--out <dir>] [--json] [--sarif <path>]  Audit report; evidence bundle with a sha256 per artifact; SARIF 2.1.0 for code scanning
  doctor [--json] [--fix] [target]             Self-diagnosis: Node, CLI, commit gate, stop hooks, rigor, constitution, specs
  mcp                                          Model Context Protocol over stdio (a server, not a one-shot command)
  help [command]                               This help, or the help of one command
  init [target] [--agent <id>] [--level <l>] [--skills] [--mcp] [--write] [--json]  One-shot project bootstrap; "init <feature>" still creates a spec
  status [feature] [--check] [--quiet] [--json] [--celebrations]  Whole state on one screen, with the next command to run
Brownfield (existing code that is the de facto source of truth):
  brownfield [survey|bootstrap|constitution|templates|specify|requirements|clarify|converge|analyze|impact|contracts|reuse|forecast|repair]  The brownfield console
  brownfield survey [target]                    Detect the stack, boundaries and evidence
  brownfield bootstrap [target] [--focus F] [--write]  One entry point: recon + constitution + module map + code intelligence + steps
  brownfield constitution [target] [--write] [--draft]  Reverse-engineer the descriptive constitution
  brownfield templates [target] [--write] [--json]  Brownfield requirement/design/task templates
  brownfield specify <feature> "<descripción>" [--area A] [--write] [--json]  Derive EARS requirements from a description
  brownfield requirements <feature> [--suggest] [--apply <i>] [--write] [--json]  EARS assistant over requirements.md
  brownfield clarify <feature> [--max N] [--write] [--json]  Clarifying questions before specifying
  brownfield converge <feature> [--write] [--json]  Convergence of the delta against the base
  brownfield analyze <feature> [--base R] [--json]  Change impact of a feature
  brownfield impact <feature> [--base R]        Dependents, breaking changes, migrations, public API surface
  brownfield contracts <feature> [--write] [--verify]  The regression oracle: which tests protect the change
  brownfield reuse <feature> [--symbols A,B]    Search for existing symbols before creating new ones
  brownfield forecast "<descripción>" [--symbols A,B] [--json]  Expected blast radius before writing code
  brownfield repair <feature> --target <artefacto> [--write] [--json]  Repair a failing artifact with evidence
  delta [init|validate|status|render|merge]  The contract of change (brownfield: the delta, not the system)
  delta init <feature> "<title>"                Scaffold a delta spec (ADDED/MODIFIED/REMOVED/RENAMED)
  delta validate <feature>                      Validate ids, EARS, targets, contracts and traceability
  delta status <feature>                        Change counts, strangulation progress, traceability
  delta render <feature>                        Render the delta spec
  delta merge <feature> [--write]               Merge the delta into the base spec

Experience layer (bilingual: --lang es|en, or OPEN_SDD_LANG):
  tour [target] [--write] [--lang es|en] [--json]  Guided first run: recon, constitution draft, check, status, delta
  context [feature] [--lang es|en] [--json]        The context pack the MCP server serves, in the terminal

Adoption (the integration matrix and the importers):
  integrate [host] [--write] [--json] [--dry-run]  Register the MCP server, install its skills and its Stop hook
  integrate --list                                 The whole matrix: skills layout, invocation syntax, MCP path, verified?
  import [kiro|spec-kit|cc-sdd] [--write] [--json] Map an incumbent's specs into .sdd (a mapping, never a promise)
  hosts: claude-code, cursor, copilot, codex, gemini-cli, windsurf, opencode, antigravity, zed, cline

Daily drivers (read-only reports: none of these runs the gate chain):
  gitflow [--level <l>] [--greenfield] [--json]  The branch's role and what that role requires
  progress [--json] [--limit N]                 The append-only progress ledger
  progress record --kind <tipo> --summary "<una línea>" --score <0..100> --phase <1|2|3> [--evidence <p>] [--json]  Record a milestone
  backup [create|verify|restore]  The restorable backup of .sdd/ with a verifiable manifest
  backup create [--out <dir>] [--force] [--json]  A restorable copy of .sdd/ with a sha256 per file
  backup verify <archive> [--json]              Recompute every sha256 against the manifest
  backup restore <archive> [--write] [--only <ruta>] [--json]  Restore; without --write it is a dry run
  biography <feature> [--limit N] [--json]      The rhythm of a living specification (git, amendments, ratifications)
  gap <feature> [--json]                        Blast radius and gap analysis
  getspecs [focus] [--json]                     Reverse-engineer steering + roadmap + spec seeds
  verify <feature> [--json]                     Standalone integration verification gate
  impl <feature> [tasks] [--review required|inline|off]  Autonomous implementation with review

Score (one number, one door):
  open-sdd                                    Inspect the repository: composite SDD score, phase and the ONE next action
  --no-footer                                 Suppress the score footer on any command (scripts)
  --json | --quiet                            Also suppress the footer: machine and one-line output stay intact

Note: In non-TTY environments, prompt mode falls back to skip.`;
const resolveManifestPath = async (resolvedAgent, argsProfile, manifestArg, templatesBase) => {
    if (manifestArg)
        return manifestArg;
    const baseDir = path.join(templatesBase, 'manifests');
    const defaultPath = path.join(baseDir, `${resolvedAgent}.json`);
    if (argsProfile === 'minimal') {
        const minimal = path.join(baseDir, `${resolvedAgent}-min.json`);
        try {
            await stat(minimal);
            return minimal;
        }
        catch {
            return defaultPath;
        }
    }
    return defaultPath;
};
const createConflictHandler = (summaries, resolvedOverwrite) => {
    if (!isInteractive())
        return undefined;
    const remainingExisting = new Map(summaries.map((summary) => [summary.category, summary.existing]));
    const stickyDecisions = new Map();
    return async (info) => {
        const cached = stickyDecisions.get(info.category);
        if (cached)
            return cached;
        const remaining = remainingExisting.get(info.category) ?? 1;
        remainingExisting.set(info.category, Math.max(remaining - 1, 0));
        const choices = [
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
            if (applyToRest)
                stickyDecisions.set(info.category, decision);
        }
        return decision;
    };
};
const showVersion = (io) => {
    const version = readCliVersion();
    io.log(`open-sdd v${version}`);
};
const handleDryRun = async (manifestPath, resolvedConfig, io, execOpts) => {
    try {
        const plan = await planFromFile(manifestPath, resolvedConfig);
        const operations = await buildFileOperations(plan, resolvedConfig, execOpts);
        const summaries = await summarizeCategories(operations);
        printSummary(summaries, resolvedConfig, io);
        io.log(formatHeading('Artifact details:'));
        io.log(formatProcessedArtifacts(plan));
        return 0;
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        io.error(formatError(`Error: ${msg}`));
        return 1;
    }
};
const runPlanExecution = async (manifestPath, resolvedConfig, io, execOpts) => {
    try {
        const agentDef = getAgentDefinition(resolvedConfig.agent);
        const version = readCliVersion();
        io.log('');
        io.log(formatBox(`open-sdd v${version} / ${agentDef.label}`));
        const plan = await planFromFile(manifestPath, resolvedConfig);
        const operations = await buildFileOperations(plan, resolvedConfig, execOpts);
        const summaries = await summarizeCategories(operations);
        printSummary(summaries, resolvedConfig, io);
        const categoryPolicies = resolvedConfig.effectiveOverwrite === 'force'
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
    }
    catch (error) {
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
const runsGateChain = (cmd, subArgv) => (cmd === 'gates' && subArgv[0] === 'run') ||
    (cmd === 'audit' && (subArgv[0] === 'bundle' || subArgv[0] === 'sarif'));
/**
 * La puerta: `open-sdd` sin argumentos.
 *
 * NO imprime una lista de comandos como primer movimiento. Inspecciona el repositorio, dice el
 * número compuesto y la fase, da la ÚNICA acción siguiente y explica en una línea por qué ESA acción.
 * Es de SOLO LECTURA y no pregunta nunca: en un no-TTY no hay prompt que ofrecer. El catálogo
 * completo sigue a un flag de distancia (`--help`), que es donde debe estar.
 */
const runScoreDoor = async (io, cwd) => {
    try {
        const report = await computeSddScore(cwd);
        io.log(renderScoreFooter(report));
        io.log(`Por qué: ${explainNextAction(report)}`);
        io.log('todos los comandos: open-sdd --help');
        return 0;
    }
    catch (error) {
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
const dispatchSubcommand = async (cmd, subArgv, io, targetCwd) => {
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
        if (subArgv[0] === 'bundle' || subArgv[0] === 'sarif')
            return handleAuditBundleCommand(subArgv, io, targetCwd);
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
    return undefined;
};
export const runCli = async (argv, runtime = { platform: process.platform, env: process.env }, io = defaultIO, loadedConfig = {}, execOpts) => {
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
            //
            // El pie NO se reescribe con `renderCelebrationFooter`/`levelFor` (`core/celebrate.ts`): ese
            // render tiene OTRA forma (`nivel X · fase N/3 · score N/100 · racha: …`), la racha la aporta
            // el trinquete —que aquí no se ejecuta— y sustituir la línea `SDD n% · Fase n · …` rompería un
            // contrato ya fijado por `cliJsonOut`/`cliSddScore`. La celebración vive donde SÍ hay veredicto
            // medido: `status --check` la imprime antes de este pie.
            await emitScoreFooter(argv, io, targetCwd, runsGateChain(cmd, subArgv) ? { gateContext: 'external' } : {});
            return code;
        }
    }
    let parsedArgs;
    try {
        // `--no-footer` es global y `parseArgs` (camino de instalación) no lo conoce: se filtra aquí
        // para que no se lea como un flag desconocido. En los subcomandos lo lee `emitScoreFooter`.
        parsedArgs = parseArgs(argv.filter((arg) => arg !== SCORE_FOOTER_FLAG));
    }
    catch (error) {
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
