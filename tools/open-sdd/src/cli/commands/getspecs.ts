import type { CliIO } from '../io.js';
import { colors, formatHeading, formatSuccess } from '../ui/colors.js';
import { bootstrapSpecSeeds, bootstrapSteering, scanProject } from '../../core/reverseEngineering.js';
import { resolveSddDir } from '../../core/specManager.js';

export const handleGetspecsCommand = async (
  argv: string[],
  io: CliIO,
  cwd: string = process.cwd(),
): Promise<number> => {
  const isJson = argv.includes('--json');
  const sddDirArg = argv.find((a) => a.startsWith('--sdd-dir='));
  const sddDir = sddDirArg ? sddDirArg.split('=')[1] : await resolveSddDir(cwd);

  const focusArg = argv.find((a) => !a.startsWith('-'));

  try {
    const project = await scanProject(cwd);
    const steering = await bootstrapSteering(cwd, project, sddDir);
    const seeds = await bootstrapSpecSeeds(cwd, focusArg, sddDir);

    if (isJson) {
      io.log(JSON.stringify({ project, steering, seeds }, null, 2));
      return 0;
    }

    io.log('');
    io.log(formatSuccess(`Reverse-engineered repository context for "${colors.bold(project.name)}"`));
    io.log(`  Language:    ${colors.cyan(project.language)}`);
    io.log(`  Frameworks:  ${project.frameworks.length > 0 ? project.frameworks.join(', ') : 'Standard'}`);
    io.log(`  Test Runner: ${project.testFramework ?? 'Native'}`);

    io.log('');
    io.log(formatHeading(`Project Steering (${sddDir}/steering/):`));
    if (steering.filesCreated.length > 0) {
      for (const f of steering.filesCreated) {
        io.log(`  ${colors.green('+')} Created ${f}`);
      }
    } else {
      io.log(colors.dim('  Existing steering preserved.'));
    }

    io.log('');
    io.log(formatHeading(`Generated Spec Seeds (${seeds.seedsCreated.length}):`));
    for (const seed of seeds.seedsCreated) {
      io.log(`  ${colors.cyan('•')} ${seed} (${sddDir}/specs/${seed}/)`);
    }

    io.log('');
    io.log(formatHeading('Next Actions:'));
    io.log(`  1. Review generated steering in ${colors.dim(`${sddDir}/steering/`)}`);
    io.log(`  2. Review and edit spec seeds before approval (Mandatory Gate 0)`);
    io.log(`  3. In your agent chat, run: ${colors.bold(`/sdd-spec-requirements <seed-name>`)}`);
    io.log('');
    return 0;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    io.error(colors.red(`Error in getspecs: ${msg}`));
    return 1;
  }
};
