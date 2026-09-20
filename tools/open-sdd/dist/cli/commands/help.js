import { colors, formatHeading } from '../ui/colors.js';
export const handleHelpCommand = async (argv, io) => {
    const topic = argv.find((a) => !a.startsWith('-'))?.toLowerCase();
    if (topic === 'init') {
        io.log('');
        io.log(formatHeading('Command: open-sdd init <feature-slug>'));
        io.log('  Initializes a new specification under .sdd/specs/<feature-slug>/');
        io.log('  In Strict Git Mode, automatically creates and switches to branch feat/<feature-slug>.');
        io.log('');
        io.log(colors.bold('Examples:'));
        io.log('  open-sdd init stripe-billing');
        io.log('  open-sdd init biometric-auth --title="Passkey Biometric Auth" --git');
        io.log('');
        return 0;
    }
    if (topic === 'status') {
        io.log('');
        io.log(formatHeading('Command: open-sdd status [feature-slug]'));
        io.log('  Shows spec phase, requirements count, task progress bar, and boundary readiness.');
        io.log('  Without arguments, lists all active specifications and their progress.');
        io.log('');
        io.log(colors.bold('Examples:'));
        io.log('  open-sdd status');
        io.log('  open-sdd status stripe-billing');
        io.log('  open-sdd status stripe-billing --json');
        io.log('');
        return 0;
    }
    if (topic === 'audit') {
        io.log('');
        io.log(formatHeading('Command: open-sdd audit [feature-slug] [--regulatory]'));
        io.log('  Audits requirements traceability (RTM), detects ambient code drift,');
        io.log('  Add --regulatory for an EU AI Act / NIST AI RMF report.');
        io.log('');
        io.log(colors.bold('Examples:'));
        io.log('  open-sdd audit');
        io.log('  open-sdd audit stripe-billing');
        io.log('  open-sdd audit stripe-billing --regulatory');
        io.log('  open-sdd audit --regulatory --json');
        io.log('');
        return 0;
    }
    if (topic === 'getspecs') {
        io.log('');
        io.log(formatHeading('Command: open-sdd getspecs [focus]'));
        io.log('  Universal Brownfield Reverse-Engineering: introspects existing repositories,');
        io.log('  bootstraps .sdd/steering/ (product, tech, structure), and generates spec seeds.');
        io.log('');
        io.log(colors.bold('Examples:'));
        io.log('  open-sdd getspecs');
        io.log('  open-sdd getspecs src/auth');
        io.log('  open-sdd getspecs packages/billing-engine');
        io.log('');
        return 0;
    }
    if (topic === 'gap') {
        io.log('');
        io.log(formatHeading('Command: open-sdd gap <feature-slug>'));
        io.log('  Analyzes blast radius and checks target file boundaries (create vs modify).');
        io.log('');
        io.log(colors.bold('Examples:'));
        io.log('  open-sdd gap stripe-billing');
        io.log('  open-sdd gap stripe-billing --json');
        io.log('');
        return 0;
    }
    if (topic === 'verify') {
        io.log('');
        io.log(formatHeading('Command: open-sdd verify <feature-slug>'));
        io.log('  Validates task completion [x] and Documentary Triad approvals before release.');
        io.log('');
        io.log(colors.bold('Examples:'));
        io.log('  open-sdd verify stripe-billing');
        io.log('  open-sdd verify stripe-billing --json');
        io.log('');
        return 0;
    }
    if (topic === 'impl') {
        io.log('');
        io.log(formatHeading('Command: open-sdd impl <feature-slug> [--parallel] [--json]'));
        io.log('  Computes DAG dependency waves and schedules parallel subagents with');
        io.log('  disjoint file boundaries to execute implementation tasks with zero write collisions.');
        io.log('');
        io.log(colors.bold('Examples:'));
        io.log('  open-sdd impl stripe-billing');
        io.log('  open-sdd impl stripe-billing --parallel');
        io.log('  open-sdd impl stripe-billing --parallel --max-parallel=6');
        io.log('  open-sdd impl stripe-billing --json');
        io.log('');
        return 0;
    }
    // General help index
    io.log('');
    io.log(formatHeading('Open-SDD Engine CLI & Skills Reference'));
    io.log(`  ${colors.bold('open-sdd init <slug>')}        Initialize new feature spec & Git branch`);
    io.log(`  ${colors.bold('open-sdd status [slug]')}      View spec progress, tasks bar, and approvals`);
    io.log(`  ${colors.bold('open-sdd impl <slug>')}        Compute parallel DAG waves & disjoint execution plan`);
    io.log(`  ${colors.bold('open-sdd audit [slug]')}       Check a spec against its code`);
    io.log(`  ${colors.bold('open-sdd gap <slug>')}         Analyze blast radius and boundary modifications`);
    io.log(`  ${colors.bold('open-sdd getspecs [focus]')}   Brownfield reverse-engineering & spec seeds`);
    io.log(`  ${colors.bold('open-sdd verify <slug>')}      Validate implementation completion gate`);
    io.log(`  ${colors.bold('open-sdd help <cmd>')}         Show detailed guide for a command`);
    io.log('');
    io.log(formatHeading('Template Installer (Default Mode):'));
    io.log(`  ${colors.bold('npx open-sdd@latest')}         Install Claude Code skills`);
    io.log(`  ${colors.bold('npx open-sdd --cursor-skills')} Install Cursor IDE skills`);
    io.log(`  ${colors.bold('npx open-sdd --antigravity')}   Install Google Antigravity skills`);
    io.log(`  ${colors.bold('npx open-sdd --copilot-skills')} Install GitHub Copilot skills`);
    io.log(`  ${colors.bold('npx open-sdd --lang es -y')}   Install in Spanish without prompts`);
    io.log('');
    return 0;
};
