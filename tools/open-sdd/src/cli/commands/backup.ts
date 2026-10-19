/**
 * `open-sdd backup` — la puerta de consola del respaldo restaurable.
 *
 * `core/backup.ts` copia el árbol de `.sdd/` con un manifiesto verificable y sabe restaurarlo. Este
 * comando expone sus tres operaciones, cada una con su contrato intacto:
 *
 *   `backup create [--out <dir>] [--force] [--json]`   escribe el respaldo. `written: false` (no hay
 *                                                       `.sdd/`, o el destino existe sin `--force`) es
 *                                                       un ERROR: un respaldo que no se escribió no
 *                                                       protege nada y no puede parecer un éxito.
 *   `backup verify <archive> [--json]`                 recomputa todos los sha256. `ok: false` es un
 *                                                       ERROR con `mismatches`/`missing` como hallazgos.
 *   `backup restore <archive> [--write] [--only <p>]…` sin `--write` es una SIMULACIÓN y sale con 0.
 *                                                       Un motivo de omisión que empieza por «escapa» o
 *                                                       «fuera de la raíz» es un ERROR (una ruta que
 *                                                       sale del árbol es un rechazo, no una omisión);
 *                                                       los demás motivos son AVISOS.
 *
 * El comando no reimplementa ninguna comprobación: solo traduce los veredictos del módulo al sobre
 * estable de `cli/jsonOut.ts` y a texto legible. Los textos visibles son español, como el resto del
 * CLI (ver `src/cli/i18n.ts`).
 */

import { colors } from '../ui/colors.js';
import type { CliIO } from '../io.js';
import { jsonEnvelope } from '../jsonOut.js';
import { createBackup, restoreBackup, verifyBackup } from '../../core/backup.js';

const USAGE =
  'Usage: open-sdd backup create [--out <dir>] [--force] [--json] | verify <archive> [--json] | restore <archive> [--write] [--only <ruta>]… [--json]';

/** Valor de un flag con valor (`--out x` o `--out=x`); `undefined` si no está. */
const flagValue = (args: string[], name: string): string | undefined => {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const at = args.indexOf(`--${name}`);
  if (at < 0) return undefined;
  const next = args[at + 1];
  return next === undefined || next.startsWith('-') ? '' : next;
};

/** Todas las apariciones de un flag repetible (`--only a --only b`, o `--only=a`). */
const flagValues = (args: string[], name: string): string[] => {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token.startsWith(`--${name}=`)) {
      out.push(token.slice(name.length + 3));
      continue;
    }
    if (token === `--${name}`) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        out.push(next);
        i += 1;
      }
    }
  }
  return out;
};

/** Primer posicional que no es un flag ni el valor de un flag con valor. */
const positional = (args: string[]): string | undefined => {
  const valueFlags = new Set(['--out', '--only']);
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token.startsWith('-')) {
      if (valueFlags.has(token)) i += 1;
      continue;
    }
    return token;
  }
  return undefined;
};

const create = async (args: string[], io: CliIO, cwd: string): Promise<number> => {
  const json = args.includes('--json');
  const out = flagValue(args, 'out');
  const force = args.includes('--force');
  const result = await createBackup({
    cwd,
    ...(out !== undefined && out.length > 0 ? { out } : {}),
    force,
  });

  if (json) {
    io.log(
      JSON.stringify(
        jsonEnvelope({
          command: 'backup create',
          data: { path: result.path, written: result.written, manifest: result.manifest, detail: result.detail },
          errors: result.written ? [] : [{ id: 'BACKUP_NOT_WRITTEN', message: result.detail, artifact: result.path }],
          detail: result.detail,
        }),
        null,
        2,
      ),
    );
    return result.written ? 0 : 1;
  }

  if (!result.written) {
    io.error(colors.red(`El respaldo NO se escribió: ${result.detail}`));
    return 1;
  }
  io.log(colors.green(result.detail));
  io.log(`  ruta: ${result.path}`);
  io.log(`  ficheros: ${result.manifest.counts.files} · bytes: ${result.manifest.counts.bytes}`);
  return 0;
};

const verify = async (args: string[], io: CliIO, cwd: string): Promise<number> => {
  const json = args.includes('--json');
  const archive = positional(args);
  if (archive === undefined) {
    io.error(colors.red(`Falta el archivo a verificar. ${USAGE}`));
    return 1;
  }

  const result = await verifyBackup({ cwd, archive });
  const errors: { id: string; message: string; artifact?: string }[] = [
    ...result.mismatches.map((mismatch) => ({
      id: 'BACKUP_HASH_MISMATCH',
      message: `El sha256 de ${mismatch.path} NO coincide con el manifiesto (esperado ${mismatch.expected}, real ${mismatch.actual ?? 'ausente/ilegible'}).`,
      artifact: mismatch.path,
    })),
    ...result.missing.map((path) => ({
      id: 'BACKUP_FILE_MISSING',
      message: `El manifiesto declara ${path} y no está en la carga: el respaldo está incompleto.`,
      artifact: path,
    })),
  ];
  if (!result.ok && errors.length === 0) {
    errors.push({ id: 'BACKUP_MANIFEST_INVALID', message: result.detail });
  }

  if (json) {
    io.log(
      JSON.stringify(
        jsonEnvelope({
          command: 'backup verify',
          data: {
            ok: result.ok,
            archive,
            mismatches: result.mismatches,
            missing: result.missing,
            manifest: result.manifest,
            detail: result.detail,
          },
          errors,
          detail: result.detail,
        }),
        null,
        2,
      ),
    );
    return result.ok ? 0 : 1;
  }

  if (result.ok) {
    io.log(colors.green(result.detail));
    return 0;
  }
  io.error(colors.red(result.detail));
  for (const mismatch of result.mismatches) {
    io.error(colors.red(`  ✗ hash: ${mismatch.path}`));
  }
  for (const path of result.missing) {
    io.error(colors.red(`  ✗ ausente: ${path}`));
  }
  return 1;
};

const restore = async (args: string[], io: CliIO, cwd: string): Promise<number> => {
  const json = args.includes('--json');
  const write = args.includes('--write');
  const only = flagValues(args, 'only');
  const archive = positional(args);
  if (archive === undefined) {
    io.error(colors.red(`Falta el archivo a restaurar. ${USAGE}`));
    return 1;
  }

  const result = await restoreBackup({
    cwd,
    archive,
    ...(write ? { write: true } : {}),
    ...(only.length > 0 ? { only } : {}),
  });

  // Una ruta que escapa de la raíz es un RECHAZO (error); el resto de motivos son avisos honestos
  // sobre no pisar trabajo posterior. La clasificación se hace por el prefijo estable del módulo.
  const rejections = result.skipped.filter(
    (entry) => entry.reason.startsWith('escapa') || entry.reason.startsWith('fuera de la raíz'),
  );
  const warnings = result.skipped.filter((entry) => !rejections.includes(entry));
  const errors = rejections.map((entry) => ({
    id: 'BACKUP_RESTORE_REJECTED',
    message: `${entry.path}: ${entry.reason} — no se restaura.`,
    artifact: entry.path,
  }));

  if (json) {
    io.log(
      JSON.stringify(
        jsonEnvelope({
          command: 'backup restore',
          data: {
            archive,
            write,
            only,
            restored: result.restored,
            skipped: result.skipped,
            detail: result.detail,
          },
          errors,
          warnings: warnings.map((entry) => ({ id: 'BACKUP_RESTORE_SKIPPED', message: `${entry.path}: ${entry.reason}`, artifact: entry.path })),
          detail: result.detail,
        }),
        null,
        2,
      ),
    );
    return errors.length > 0 ? 1 : 0;
  }

  io.log(write ? colors.green(result.detail) : colors.yellow(result.detail));
  for (const path of result.restored) io.log(`  ${write ? '✓' : '·'} ${path}`);
  for (const entry of warnings) io.log(colors.yellow(`  ! ${entry.path}: ${entry.reason}`));
  for (const entry of rejections) io.error(colors.red(`  ✗ ${entry.path}: ${entry.reason}`));
  if (!write) io.log(colors.dim('  Simulación: no se escribió nada. Añade --write para aplicar.'));
  return errors.length > 0 ? 1 : 0;
};

export const handleBackupCommand = async (
  args: string[],
  io: CliIO,
  cwd: string = process.cwd(),
): Promise<number> => {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === 'create') return create(rest, io, cwd);
  if (sub === 'verify') return verify(rest, io, cwd);
  if (sub === 'restore') return restore(rest, io, cwd);
  io.error(colors.red(`Subcomando desconocido: ${sub ?? '(ninguno)'}. ${USAGE}`));
  return 1;
};
