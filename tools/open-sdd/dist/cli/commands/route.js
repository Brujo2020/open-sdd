import { colors, formatError, formatHeading } from '../ui/colors.js';
import { jsonEnvelope } from '../jsonOut.js';
import { EXIT } from './help.js';
import { flagValue } from './approve.js';
import { classifyChange } from '../../core/route.js';
import { forecastImpact } from '../../core/changeImpact.js';
export const handleRouteCommand = async (args, io, cwd) => {
    const json = args.includes('--json');
    const filesFlag = flagValue(args, '--files');
    const intent = args
        .filter((arg, i) => !arg.startsWith('-') && args[i - 1] !== '--files')
        .join(' ')
        .trim();
    if (!intent) {
        io.error(formatError('error[usage]: `route` needs the intent of the change'));
        io.error('  = help: open-sdd route "fix typo in README" --files README.md');
        return EXIT.USAGE;
    }
    const files = filesFlag ? filesFlag.split(',').map((f) => f.trim()).filter(Boolean) : undefined;
    let forecastFiles;
    let blastRadius = null;
    if (!files && !args.includes('--no-forecast')) {
        try {
            const forecast = await forecastImpact({ cwd, description: intent });
            forecastFiles = forecast.candidateFiles;
            blastRadius = forecast.expectedBlastRadius;
        }
        catch {
            // An unreadable repository leaves the size unknown; the classifier then refuses to say S.
        }
    }
    const decision = classifyChange({ intent, ...(files ? { files } : {}), ...(forecastFiles ? { forecastFiles } : {}), blastRadius });
    if (json) {
        io.log(JSON.stringify(jsonEnvelope({ command: 'route', data: decision, warnings: decision.unknown }), null, 2));
        return EXIT.PASSED;
    }
    const label = { S: 'S — small', M: 'M — medium', L: 'L — large' }[decision.changeClass];
    const paint = decision.changeClass === 'S' ? colors.green : decision.changeClass === 'M' ? colors.yellow : colors.red;
    io.log(formatHeading(`Route: ${paint(label)}`));
    for (const line of decision.evidence)
        io.log(`  - ${line}`);
    for (const line of decision.unknown)
        io.log(colors.dim(`  ? ${line}`));
    io.log('  needs:');
    for (const line of decision.artifacts)
        io.log(`    · ${line}`);
    io.log('  next:');
    for (const line of decision.next)
        io.log(`    ${line}`);
    return EXIT.PASSED;
};
