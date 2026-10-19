/**
 * `open-sdd progress` — la puerta de consola del libro de progreso.
 *
 * `core/progress.ts` posee `.sdd/state/progress.json`, el libro APPEND-ONLY que responde «¿qué se
 * consiguió, cuándo y con qué evidencia?». Este comando es su única puerta:
 *
 *   `progress [--json] [--limit N]`   lee la cronología y la renderiza.
 *   `progress record …`               añade un hito; el `delta` lo calcula el módulo, no el llamante.
 *
 * ── Las dos reglas que este comando no puede relajar ────────────────────────────────────────────
 *  1. Un libro corrupto es un AVISO, nunca un error: el módulo no revienta y este comando tampoco.
 *     Se dice, se muestran cero entradas (no las rescatadas a medias) y se sale con 0. Un historial
 *     ilegible no es un fallo del comando que lo lee.
 *  2. `written: false` SÍ es un error, y viaja con el motivo EXACTO del módulo: un resumen vacío,
 *     partido en varias líneas o vago («se avanzó») no entra en el libro, y quien lo intentó tiene
 *     que leer por qué. Se sale con 1.
 *
 * Los textos visibles son español, como el resto del CLI (ver `src/cli/i18n.ts`).
 */

import { colors } from '../ui/colors.js';
import type { CliIO } from '../io.js';
import { jsonEnvelope } from '../jsonOut.js';
import {
  DEFAULT_PROGRESS_LIMIT,
  readProgress,
  recordProgress,
  renderProgress,
  type ProgressEntry,
} from '../../core/progress.js';

/** Valor de un flag con valor (`--kind x` o `--kind=x`); `undefined` si no está. */
const flagValue = (args: string[], name: string): string | undefined => {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const at = args.indexOf(`--${name}`);
  if (at < 0) return undefined;
  const next = args[at + 1];
  return next === undefined || next.startsWith('-') ? '' : next;
};

/** Todas las apariciones de un flag repetible (`--evidence a --evidence b`, o `--evidence=a`). */
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

const parseLimit = (raw: string | undefined): number => {
  if (raw === undefined || raw.length === 0) return DEFAULT_PROGRESS_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_PROGRESS_LIMIT;
};

const parsePhase = (raw: string | undefined): 1 | 2 | 3 | null =>
  raw === '1' ? 1 : raw === '2' ? 2 : raw === '3' ? 3 : null;

const read = async (args: string[], io: CliIO, cwd: string): Promise<number> => {
  const json = args.includes('--json');
  const limit = parseLimit(flagValue(args, 'limit'));
  const ledger = await readProgress(cwd);

  if (json) {
    const envelope = jsonEnvelope({
      command: 'progress',
      data: { entries: ledger.entries, corrupt: ledger.corrupt, limit },
      warnings: ledger.corrupt ? [{ id: 'PROGRESS_LEDGER_CORRUPT', message: ledger.detail }] : [],
      detail: ledger.detail,
    });
    io.log(JSON.stringify(envelope, null, 2));
    return 0;
  }

  if (ledger.corrupt) {
    // El aviso va ANTES de la cronología: un libro ilegible no puede leerse como una lista vacía.
    io.log(colors.yellow(`aviso: ${ledger.detail}`));
  }
  const lines = renderProgress({ entries: ledger.entries, limit });
  if (lines.length === 0) {
    io.log(ledger.corrupt ? 'sin entradas legibles: el libro no se pudo interpretar.' : ledger.detail);
    return 0;
  }
  for (const line of lines) io.log(line);
  return 0;
};

const record = async (args: string[], io: CliIO, cwd: string): Promise<number> => {
  const json = args.includes('--json');
  const kind = flagValue(args, 'kind');
  const summary = flagValue(args, 'summary');
  const scoreRaw = flagValue(args, 'score');
  const phase = parsePhase(flagValue(args, 'phase'));
  const evidence = flagValues(args, 'evidence');

  const score = scoreRaw === undefined || scoreRaw.length === 0 ? Number.NaN : Number(scoreRaw);
  const problems: string[] = [];
  if (kind === undefined || kind.trim().length === 0) problems.push('falta --kind <tipo> (spec, implement, verify, gate, backup…)');
  if (summary === undefined || summary.trim().length === 0) problems.push('falta --summary "<una línea que nombre lo conseguido>"');
  if (!Number.isFinite(score)) problems.push('falta --score <0..100>');
  if (phase === null) problems.push('falta --phase <1|2|3>');

  if (problems.length > 0) {
    const usage =
      'Usage: open-sdd progress record --kind <tipo> --summary "<una línea>" --score <0..100> --phase <1|2|3> [--evidence <p>]… [--json]';
    if (json) {
      io.log(
        JSON.stringify(
          jsonEnvelope({
            command: 'progress record',
            data: null,
            errors: problems.map((message) => ({ id: 'PROGRESS_USAGE', message })),
            detail: `${usage} — ${problems.join('; ')}`,
          }),
          null,
          2,
        ),
      );
    } else {
      io.error(colors.red(usage));
      for (const problem of problems) io.error(colors.red(`  · ${problem}`));
    }
    return 1;
  }

  const entry: Omit<ProgressEntry, 'at' | 'delta'> = {
    kind: (kind as string).trim(),
    summary: summary as string,
    score: { total: score, phase: phase as 1 | 2 | 3 },
    evidence,
  };
  const result = await recordProgress({ cwd, entry });

  if (json) {
    io.log(
      JSON.stringify(
        jsonEnvelope({
          command: 'progress record',
          data: { written: result.written, entry: result.entry, detail: result.detail },
          errors: result.written ? [] : [{ id: 'PROGRESS_NOT_WRITTEN', message: result.detail }],
          detail: result.detail,
        }),
        null,
        2,
      ),
    );
    return result.written ? 0 : 1;
  }

  if (!result.written) {
    // El motivo del módulo, íntegro: es lo que enseña por qué la frase vacía no entra en el libro.
    io.error(colors.red(`El hito NO se registró: ${result.detail}`));
    return 1;
  }
  io.log(colors.green(result.detail));
  return 0;
};

export const handleProgressCommand = async (
  args: string[],
  io: CliIO,
  cwd: string = process.cwd(),
): Promise<number> => {
  const sub = args[0];
  if (sub === 'record') return record(args.slice(1), io, cwd);
  return read(args, io, cwd);
};
