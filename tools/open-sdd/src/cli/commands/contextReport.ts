/**
 * `open-sdd context --report [--budget <tokens>] [--json]` — what the installed skills, commands and
 * instruction files cost an agent's context. See `core/contextBudget.ts`.
 *
 * Without `--budget` it only reports (exit 0). With `--budget N` it exits 1 when the always-loaded
 * estimate exceeds N, so CI can hold the line.
 */
import type { CliIO } from '../io.js';
import { colors, formatError, formatHeading } from '../ui/colors.js';
import { jsonEnvelope } from '../jsonOut.js';
import { EXIT } from './help.js';
import { flagValue } from './approve.js';
import { measureContextBudget } from '../../core/contextBudget.js';

export const handleContextReportCommand = async (args: string[], io: CliIO, cwd: string): Promise<number> => {
  const raw = flagValue(args, '--budget');
  let budget: number | null = null;
  if (raw !== undefined) {
    budget = Number(raw);
    if (!Number.isInteger(budget) || budget <= 0) {
      io.error(formatError(`error[usage]: \`--budget\` needs a positive integer of tokens, got \`${raw || '(empty)'}\``));
      io.error('  = help: open-sdd context --report --budget 8000');
      return EXIT.USAGE;
    }
  }
  const report = await measureContextBudget(cwd, budget);

  if (args.includes('--json')) {
    io.log(
      JSON.stringify(
        jsonEnvelope({
          command: 'context --report',
          data: report,
          errors: report.overBudget ? [{ id: 'CONTEXT-OVER-BUDGET', message: `always-loaded ≈${report.totals.always} tokens > budget ${budget}` }] : [],
        }),
        null,
        2,
      ),
    );
    return report.overBudget ? EXIT.GATE_FAILED : EXIT.PASSED;
  }

  io.log(formatHeading('Context tax of the installed AI surface'));
  if (report.surfaces.length === 0) {
    io.log('  nothing installed for any known host: 0 tokens');
  } else {
    io.log(colors.dim(`  ${'path'.padEnd(34)} ${'files'.padStart(5)} ${'always'.padStart(8)} ${'on demand'.padStart(10)}`));
    for (const s of report.surfaces) {
      io.log(`  ${s.path.padEnd(34)} ${String(s.files).padStart(5)} ${String(s.always).padStart(8)} ${String(s.onDemand).padStart(10)}`);
    }
    io.log(`  ${'TOTAL'.padEnd(34)} ${String(report.totals.files).padStart(5)} ${String(report.totals.always).padStart(8)} ${String(report.totals.onDemand).padStart(10)}`);
  }
  io.log(colors.dim(`  ${report.rule}; "always" = root instruction files + skill descriptions, loaded every session`));
  if (budget !== null) {
    io.log(
      report.overBudget
        ? colors.red(`  FAIL  always-loaded ≈${report.totals.always} tokens exceeds the budget of ${budget}`)
        : colors.green(`  PASS  always-loaded ≈${report.totals.always} tokens within the budget of ${budget}`),
    );
    if (report.overBudget) io.log('  = help: install only the skills you use (`open-sdd uninstall` then `open-sdd init . --write`), or trim the root instruction file');
  }
  return report.overBudget ? EXIT.GATE_FAILED : EXIT.PASSED;
};
