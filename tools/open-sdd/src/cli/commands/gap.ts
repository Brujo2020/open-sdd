import type { CliIO } from '../io.js';
import { colors, formatHeading } from '../ui/colors.js';
import { analyzeGap } from '../../core/gapAnalyzer.js';
import { resolveSddDir } from '../../core/specManager.js';

export const handleGapCommand = async (
  argv: string[],
  io: CliIO,
  cwd: string = process.cwd(),
): Promise<number> => {
  const isJson = argv.includes('--json');
  const sddDirArg = argv.find((a) => a.startsWith('--sdd-dir='));
  const sddDir = sddDirArg ? sddDirArg.split('=')[1] : await resolveSddDir(cwd);

  const featureArg = argv.find((a) => !a.startsWith('-'));
  if (!featureArg) {
    io.error(colors.red('Usage: open-sdd gap <feature-slug> [--json]'));
    return 1;
  }

  const result = await analyzeGap(cwd, featureArg, sddDir);

  if (isJson) {
    io.log(JSON.stringify(result, null, 2));
    return 0;
  }

  io.log('');
  io.log(formatHeading(`Blast Radius & Gap Analysis: ${colors.bold(featureArg)}`));

  const impactColor =
    result.impactLevel === 'CRITICAL'
      ? colors.red
      : result.impactLevel === 'HIGH'
      ? colors.yellow
      : colors.green;

  io.log(`  Blast Radius Impact: ${impactColor(colors.bold(result.impactLevel))}`);
  io.log(`  Total File Boundaries: ${result.boundaries.length}`);

  if (result.boundaries.length > 0) {
    io.log('');
    io.log(formatHeading('File Boundaries:'));
    for (const b of result.boundaries) {
      const tag = b.status === 'create' ? colors.cyan('[CREATE]') : colors.yellow('[MODIFY]');
      io.log(`  ${tag} ${b.file}`);
    }
  }

  if (result.warnings.length > 0) {
    io.log('');
    io.log(formatHeading('Warnings:'));
    for (const w of result.warnings) {
      io.log(colors.yellow(`  ⚠ ${w}`));
    }
  }
  io.log('');
  return 0;
};
