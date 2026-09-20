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
import { handleInitCommand } from './cli/commands/init.js';
import { handleAuditBundleCommand, handleAuditCommand } from './cli/commands/audit.js';
import { handleGapCommand } from './cli/commands/gap.js';
import { handleGetspecsCommand } from './cli/commands/getspecs.js';
import { handleVerifyCommand } from './cli/commands/verify.js';
import { handleHelpCommand } from './cli/commands/help.js';
import { handleImplCommand } from './cli/commands/impl.js';
import { handleGatesCommand, handleGovernCommand, handleAssureCommand, handleWavesCommand, handleFloorCommand, } from './cli/commands/paper.js';
import { handleDeltaCommand, handleBrownfieldCommand } from './cli/commands/brownfield.js';
import { handleTourCommand, handleContextCommand } from './cli/commands/tour.js';
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
export const runCli = async (argv, runtime = { platform: process.platform, env: process.env }, io = defaultIO, loadedConfig = {}, execOpts) => {
    if (argv.includes('--help') || argv.includes('-h')) {
        io.log(helpText);
        return 0;
    }
    if (argv.includes('--version') || argv.includes('-v')) {
        showVersion(io);
        return 0;
    }
    // Dispatch CLI subcommands
    const firstArg = argv[0];
    if (firstArg && !firstArg.startsWith('-')) {
        const cmd = firstArg.toLowerCase();
        const subArgv = argv.slice(1);
        const targetCwd = execOpts?.cwd ?? process.cwd();
        if (cmd === 'status' || cmd === 'spec-status') {
            return handleStatusCommand(subArgv, io, targetCwd);
        }
        if (cmd === 'init' || cmd === 'spec-init') {
            return handleInitCommand(subArgv, io, targetCwd);
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
    }
    let parsedArgs;
    try {
        parsedArgs = parseArgs(argv);
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
