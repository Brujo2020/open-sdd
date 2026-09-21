/**
 * `open-sdd uninstall` / `open-sdd restore` — la salida de una herramienta invasiva.
 *
 * `core/receipt.ts` posee el recibo y deriva de él un plan. Este comando es su única puerta, y no
 * relaja ninguna de las reglas del módulo:
 *
 *   `uninstall [--write] [--purge-sdd]`  sin `--write` solo PLANIFICA; nada se borra.
 *   `restore [--from <recibo>] [--write]` el mismo plan desde un recibo concreto.
 *
 * Un fichero que un humano editó, o que se fusionó dentro de un fichero ajeno, se RECHAZA con su
 * motivo: nunca se borra. `.sdd/` se conserva salvo `--purge-sdd` explícito. Y sin recibo no se
 * elimina nada: se dice que no hay constancia en vez de adivinar qué era nuestro.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CliIO } from '../io.js';
import { colors, formatHeading } from '../ui/colors.js';
import { jsonEnvelope } from '../jsonOut.js';
import { stableEnvelopeDetail } from '../i18n.js';
import {
  RECEIPT_FILE,
  RECEIPT_SCHEMA,
  applyUninstall,
  planFromReceipt,
  planUninstall,
  type Receipt,
  type UninstallPlan,
} from '../../core/receipt.js';

/** Valor de un flag con valor (`--from x` o `--from=x`); `undefined` si no está. */
const flagValue = (args: string[], name: string): string | undefined => {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const at = args.indexOf(`--${name}`);
  if (at < 0) return undefined;
  const next = args[at + 1];
  return next === undefined || next.startsWith('-') ? '' : next;
};

const KNOWN_FLAGS = new Set(['--write', '--purge-sdd', '--json', '--from']);

const renderPlan = (plan: UninstallPlan, command: string): string[] => {
  const lines: string[] = [];
  const remove = plan.entries.filter((entry) => entry.state === 'remove');
  const refused = plan.entries.filter((entry) => entry.state === 'refused');
  const missing = plan.entries.filter((entry) => entry.state === 'missing');

  lines.push(formatHeading(`${command === 'restore' ? 'Restauración' : 'Desinstalación'} — recibo: ${RECEIPT_FILE}`));
  for (const problem of plan.problems) lines.push(`  ${colors.yellow('!')} ${problem}`);

  if (!plan.hasReceipt) {
    lines.push('  No hay recibo: no se elimina nada con seguridad.');
    lines.push(`  ${colors.dim('La próxima escritura lo registra; hoy no hay constancia de qué era nuestro.')}`);
    return lines;
  }

  lines.push(`  Se eliminarán (${remove.length}):`);
  if (remove.length === 0) lines.push(`    ${colors.dim('ninguno')}`);
  for (const entry of remove) lines.push(`    ${colors.green('-')} ${entry.path}  ${colors.dim(`(${entry.reason})`)}`);

  if (refused.length > 0) {
    lines.push(`  Se conservan por seguridad (${refused.length}):`);
    for (const entry of refused) lines.push(`    ${colors.yellow('!')} ${entry.path}  ${colors.dim(`(${entry.reason})`)}`);
  }
  if (missing.length > 0) {
    lines.push(`  Ya no existen (${missing.length}):`);
    for (const entry of missing) lines.push(`    ${colors.dim(`- ${entry.path}`)}`);
  }

  lines.push(`  ${plan.sddDir.willRemove ? colors.yellow('.sdd/') : '.sdd/'}  ${colors.dim(`(${plan.sddDir.reason})`)}`);
  return lines;
};

const readAlternateReceipt = async (cwd: string, from: string): Promise<Receipt | { error: string }> => {
  const abs = path.resolve(cwd, from);
  try {
    const parsed = JSON.parse(await readFile(abs, 'utf8')) as Partial<Receipt>;
    if (!parsed || parsed.schema !== RECEIPT_SCHEMA || !Array.isArray(parsed.entries)) {
      return { error: `${from} no es un recibo ${RECEIPT_SCHEMA}.` };
    }
    return { schema: RECEIPT_SCHEMA, entries: parsed.entries };
  } catch (error) {
    return { error: `no se pudo leer ${from} (${String(error)}).` };
  }
};

export const handleUninstallCommand = async (
  args: string[],
  io: CliIO,
  cwd: string = process.cwd(),
): Promise<number> => {
  const restore = args[0] === 'restore';
  const rest = restore ? args.slice(1) : args;
  const command = restore ? 'restore' : 'uninstall';

  const unknown = rest.find((arg) => arg.startsWith('-') && !KNOWN_FLAGS.has(arg.split('=')[0]));
  if (unknown) {
    io.error(`error: unrecognized option '${unknown}'`);
    io.error('  help: run `open-sdd uninstall` for the plan, or `open-sdd --help` for the command list');
    io.error('  note: exit code 2 means the command line was wrong, not that your repository failed');
    return 2;
  }

  const json = rest.includes('--json');
  const write = rest.includes('--write');
  const purgeSdd = rest.includes('--purge-sdd');

  let plan: UninstallPlan;
  if (restore) {
    const from = flagValue(rest, 'from');
    if (!from) {
      io.error("error: `restore` needs `--from <recibo>`");
      io.error(`  help: the receipt written by a run lives at ${RECEIPT_FILE}`);
      return 2;
    }
    const loaded = await readAlternateReceipt(cwd, from);
    if ('error' in loaded) {
      io.error(`error: ${loaded.error}`);
      io.error('  help: run `open-sdd uninstall` to use the receipt of this repository');
      return 2;
    }
    plan = await planFromReceipt(cwd, loaded, { purgeSdd });
  } else {
    plan = await planUninstall(cwd, { purgeSdd });
  }

  const remove = plan.entries.filter((entry) => entry.state === 'remove');

  if (!write) {
    for (const line of renderPlan(plan, command)) io.log(line);
    if (plan.hasReceipt && remove.length > 0) {
      io.log('');
      io.log(`  ${colors.dim(`Plan solamente. Aplícalo con: open-sdd ${command} --write${purgeSdd ? ' --purge-sdd' : ''}`)}`);
    }
    if (json) {
      io.log(JSON.stringify(jsonEnvelope({
        command: `${command} (plan)`,
        data: plan,
        detail: stableEnvelopeDetail({
          command: `${command} (plan)`,
          ok: true,
          warnings: plan.problems.length,
        }),
        warnings: plan.problems,
      }), null, 2));
    }
    return 0;
  }

  const result = await applyUninstall(cwd, plan);
  for (const rel of result.removed) io.log(`  ${colors.green('-')} ${rel}`);
  for (const rel of result.pruned) io.log(`  ${colors.green('-')} ${rel}/  ${colors.dim('(quedó vacío)')}`);
  for (const failure of result.failed) io.error(`  ${colors.red('!')} ${failure.path}: ${failure.reason}`);
  io.log(
    `${command}: ${result.removed.length} eliminado(s)` +
      `${result.failed.length > 0 ? `, ${result.failed.length} fallo(s)` : ''}` +
      `${plan.sddDir.willRemove ? ' · .sdd/ eliminado por --purge-sdd' : ' · .sdd/ conservado'}`,
  );
  if (json) {
    io.log(JSON.stringify(jsonEnvelope({
      command,
      data: { plan, result },
      errors: result.failed.map((failure) => `${failure.path}: ${failure.reason}`),
      warnings: plan.problems,
      detail: stableEnvelopeDetail({
        command,
        ok: result.failed.length === 0,
        errors: result.failed.length,
        warnings: plan.problems.length,
      }),
    }), null, 2));
  }
  return result.failed.length > 0 ? 1 : 0;
};
