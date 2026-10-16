/**
 * `open-sdd approve` — record a human approval bound to the artifact's sha256, and check that every
 * recorded approval still covers the bytes on disk. See `core/approvals.ts` for why a boolean in
 * `spec.json` is not an approval.
 *
 *   approve <feature> --gate requirements|design|tasks [--by <name>] [--note <text>] [--json]
 *   approve <feature> [--check] [--strict] [--json]
 *
 * Exit codes follow the console contract: 0 passed · 1 a stale approval (or, with --strict, a missing
 * one) or a refused approval · 2 usage error.
 */
import { spawnSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import type { CliIO } from '../io.js';
import { colors, formatError, formatHeading } from '../ui/colors.js';
import { jsonEnvelope } from '../jsonOut.js';
import { EXIT } from './help.js';
import {
  APPROVAL_GATES,
  approveGate,
  checkApprovals,
  isApprovalGate,
  specDirOf,
  type GateApprovalStatus,
} from '../../core/approvals.js';

/** `--name value` or `--name=value`; `undefined` when absent, `''` when present without a value. */
export const flagValue = (args: readonly string[], name: string): string | undefined => {
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]!;
    if (token === name) {
      const next = args[i + 1];
      return next !== undefined && !next.startsWith('--') ? next : '';
    }
    if (token.startsWith(`${name}=`)) return token.slice(name.length + 1);
  }
  return undefined;
};

const VALUE_FLAGS = new Set(['--gate', '--by', '--note']);

const positionals = (args: readonly string[]): string[] => {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]!;
    if (token.startsWith('-')) {
      if (VALUE_FLAGS.has(token)) i += 1;
      continue;
    }
    out.push(token);
  }
  return out;
};

const gitUserName = (cwd: string): string => {
  const result = spawnSync('git', ['config', 'user.name'], { cwd, encoding: 'utf8' });
  return result.status === 0 ? (result.stdout ?? '').trim() : '';
};

const MARK: Record<GateApprovalStatus['state'], string> = {
  fresh: 'FRESH ',
  stale: 'STALE ',
  missing: 'NONE  ',
  'no-artifact': 'N/A   ',
};

const paint = (state: GateApprovalStatus['state'], text: string): string =>
  state === 'fresh' ? colors.green(text) : state === 'stale' ? colors.red(text) : colors.yellow(text);

const usage = (io: CliIO, message: string): number => {
  io.error(formatError(`error[usage]: ${message}`));
  io.error('  = help: open-sdd approve <feature> --gate requirements|design|tasks --by "<name>"');
  io.error('  = help: open-sdd approve <feature> --check [--strict]');
  return EXIT.USAGE;
};

export const handleApproveCommand = async (args: string[], io: CliIO, cwd: string): Promise<number> => {
  const json = args.includes('--json');
  const feature = positionals(args)[0];
  if (!feature) return usage(io, '`approve` needs a feature');
  const specDir = specDirOf(cwd, feature);
  if (!(await stat(specDir).catch(() => null))?.isDirectory()) {
    io.error(formatError(`error[usage]: no spec \`${feature}\` under .sdd/specs/`));
    io.error('  = help: run `open-sdd status` to list the specs');
    return EXIT.USAGE;
  }

  const gate = flagValue(args, '--gate');
  if (gate !== undefined) {
    if (!isApprovalGate(gate)) return usage(io, `unknown gate \`${gate || '(empty)'}\`: use ${APPROVAL_GATES.join(', ')}`);
    const declaredBy = flagValue(args, '--by');
    const by = (declaredBy ?? '').trim() || gitUserName(cwd);
    if (!by) return usage(io, 'an approval needs a named human: pass `--by "<name>"` (or set `git config user.name`)');
    const note = flagValue(args, '--note');
    const result = await approveGate({ root: cwd, feature, gate, by, ...(note ? { note } : {}) });
    if (json) {
      io.log(
        JSON.stringify(
          jsonEnvelope({
            command: 'approve',
            data: { feature, ...result.status, refusal: result.refusal ?? null },
            errors: result.refusal ? [{ id: `APPROVE-${gate.toUpperCase()}`, message: result.refusal.message }] : [],
            ok: result.ok,
          }),
          null,
          2,
        ),
      );
      return result.ok ? EXIT.PASSED : EXIT.GATE_FAILED;
    }
    if (!result.ok) {
      io.error(formatError(`error[approve]: ${result.refusal!.message}`));
      io.error(`  = help: ${result.refusal!.fix}`);
      return EXIT.GATE_FAILED;
    }
    io.log(`${colors.green('✓')} ${gate} of \`${feature}\` approved by ${by} — ${result.status.file} sha256 ${result.status.currentSha256!.slice(0, 12)}…`);
    io.log(colors.dim(`  recorded in .sdd/specs/${feature}/approvals.json; any later edit to ${result.status.file} makes this approval STALE`));
    return EXIT.PASSED;
  }

  // Read-only check (the default with no --gate).
  const strict = args.includes('--strict');
  const statuses = await checkApprovals(specDir);
  const stale = statuses.filter((s) => s.state === 'stale');
  const missing = statuses.filter((s) => s.state === 'missing');
  const failed = stale.length > 0 || (strict && missing.length > 0);
  if (json) {
    io.log(
      JSON.stringify(
        jsonEnvelope({
          command: 'approve --check',
          data: { feature, gates: statuses },
          errors: [
            ...stale.map((s) => ({ id: `APPROVAL-STALE-${s.gate.toUpperCase()}`, message: s.detail, artifact: s.file ?? undefined })),
            ...(strict ? missing.map((s) => ({ id: `APPROVAL-MISSING-${s.gate.toUpperCase()}`, message: s.detail })) : []),
          ],
          warnings: strict ? [] : missing.map((s) => ({ id: `APPROVAL-MISSING-${s.gate.toUpperCase()}`, message: s.detail })),
          ok: !failed,
        }),
        null,
        2,
      ),
    );
    return failed ? EXIT.GATE_FAILED : EXIT.PASSED;
  }
  io.log(formatHeading(`Approvals — ${feature}`));
  for (const s of statuses) io.log(`  ${paint(s.state, MARK[s.state])} ${s.gate.padEnd(13)} ${s.detail}`);
  for (const s of stale) {
    io.log(`  = help: re-review ${s.file}, then \`open-sdd approve ${feature} --gate ${s.gate} --by "<name>"\``);
  }
  const firstMissing = missing[0];
  if (stale.length === 0 && firstMissing) {
    io.log(`  = help: next approval: \`open-sdd approve ${feature} --gate ${firstMissing.gate} --by "<name>"\``);
  }
  return failed ? EXIT.GATE_FAILED : EXIT.PASSED;
};
