import { colors, formatHeading, formatSuccess } from '../ui/colors.js';
import { getSpecStatus, resolveSddDir } from '../../core/specManager.js';
import { evaluateGates, gatesPass, governanceProfiles, loadGovernanceSettings } from '../../core/governance.js';
export const handleVerifyCommand = async (argv, io, cwd = process.cwd()) => {
    const isJson = argv.includes('--json');
    const sddDirArg = argv.find((a) => a.startsWith('--sdd-dir='));
    const sddDir = sddDirArg ? sddDirArg.split('=')[1] : await resolveSddDir(cwd);
    const featureArg = argv.find((a) => !a.startsWith('-'));
    if (!featureArg) {
        io.error(colors.red('Usage: open-sdd verify <feature-slug> [--json]'));
        return 1;
    }
    const status = await getSpecStatus(cwd, featureArg, sddDir);
    if (!status.exists) {
        io.error(colors.red(`Spec "${featureArg}" not found.`));
        return 1;
    }
    const allTasksDone = status.tasks.total > 0 && status.tasks.completed === status.tasks.total;
    const isApproved = status.isApproved;
    // The verification gate is governed: which invariants actually block depends
    // on the active profile, so a solo dev is not held to enterprise evidence rules.
    const gov = await loadGovernanceSettings(cwd, sddDir);
    const gates = evaluateGates(gov, {
        driftDetected: false,
        specContractOk: isApproved,
        specContractDetail: isApproved ? 'Spec approved' : 'Spec not approved yet',
        proofsOk: allTasksDone,
        proofsDetail: allTasksDone
            ? `All tasks completed (${status.tasks.completed}/${status.tasks.total})`
            : `Tasks incomplete (${status.tasks.completed}/${status.tasks.total})`,
    });
    const passed = gatesPass(gates);
    if (isJson) {
        io.log(JSON.stringify({ feature: featureArg, passed, allTasksDone, isApproved, profile: gov.profile, mode: gov.mode, gates, status }, null, 2));
        return passed ? 0 : 1;
    }
    io.log('');
    io.log(formatHeading(`Implementation Verification: ${colors.bold(featureArg)}`));
    io.log(`  Profile:                    ${colors.cyan(gov.profile ?? 'solo')} ${colors.dim(governanceProfiles[gov.profile ?? 'solo'].summary)}`);
    io.log(`  Spec approved:              ${isApproved ? colors.green('yes') : colors.yellow('no')}`);
    io.log(`  Tasks done:                 ${allTasksDone ? colors.green(`100% (${status.tasks.completed}/${status.tasks.total})`) : colors.yellow(`${status.tasks.percent}% (${status.tasks.completed}/${status.tasks.total})`)}`);
    const advisory = gates.filter((g) => g.outcome === 'advisory');
    if (advisory.length) {
        io.log('');
        io.log(colors.dim('  Heads up (not blocking):'));
        for (const g of advisory)
            io.log(colors.dim(`    - ${g.label}: ${g.detail}`));
    }
    if (passed) {
        io.log('');
        io.log(formatSuccess(`"${featureArg}" verified. Ready for PR.`));
        io.log('');
        return 0;
    }
    io.log('');
    for (const g of gates.filter((x) => x.outcome === 'fail')) {
        io.log(colors.red(`  Blocked: ${g.label} — ${g.detail}`));
    }
    io.log(colors.yellow(`Not verified yet. Change \`profile\` in ${sddDir}/settings/governance.json to adjust what blocks.`));
    io.log('');
    return 1;
};
