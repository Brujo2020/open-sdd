/**
 * `open-sdd up [target] [--write]` — one command from zero to a governed, verified repository
 * (EVOLUTION-PLAN W1).
 *
 * Adoption used to require knowing which of the agent ids, rigor levels, hook and CI options apply,
 * and running `init`, `floor install --ci` and `doctor` in the right order. `up` composes the
 * EXISTING commands — it re-implements none of them:
 *
 *   1. `init <target> --skills [--agent --level --lang]` — detects the host already present
 *      (`.claude/`, `.cursor/`, `.github/`, `.agents/`, …), writes rigor, the descriptive constitution,
 *      the commit hook (CLI pinned) and the host's skills;
 *   2. the CI gate matrix for the CI the repository already uses (GitHub Actions or GitLab CI,
 *      detected; `--ci none` skips it) through the same installer `floor install --ci` uses;
 *   3. `doctor` — so the LAST thing printed is a verified verdict, not a claim, and the exit code is
 *      the doctor's.
 *
 * Without `--write` nothing is written: it prints the plan of step 1 and the CI it would install.
 */
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { colors, formatError, formatHeading } from '../ui/colors.js';
import { EXIT } from './help.js';
import { flagValue } from './approve.js';
import { handleInitCommand } from './init.js';
import { installCiTemplate } from './paper.js';
import { handleDoctorCommand } from '../../core/doctor.js';
const exists = async (p) => (await stat(p).catch(() => null)) !== null;
/** The CI the repository already uses; GitLab wins when both are present (its file is explicit). */
export const detectCi = async (target) => {
    if (await exists(path.join(target, '.gitlab-ci.yml')))
        return { provider: 'gitlab', evidence: '.gitlab-ci.yml present' };
    if (await exists(path.join(target, '.github')))
        return { provider: 'github', evidence: '.github/ present' };
    return { provider: 'none', evidence: 'no CI configuration found (pass --ci github|gitlab to add one)' };
};
const VALUE_FLAGS = new Set(['--agent', '--level', '--lang', '--ci']);
export const handleUpCommand = async (args, io, cwd) => {
    const write = args.includes('--write');
    const positional = args.find((arg, i) => !arg.startsWith('-') && !VALUE_FLAGS.has(args[i - 1] ?? ''));
    const target = path.resolve(cwd, positional ?? '.');
    if (!(await exists(target))) {
        io.error(formatError(`error[usage]: target \`${positional}\` does not exist`));
        io.error('  = help: open-sdd up [target] [--write]');
        return EXIT.USAGE;
    }
    const ciFlag = flagValue(args, '--ci');
    if (ciFlag !== undefined && !['github', 'gitlab', 'none'].includes(ciFlag)) {
        io.error(formatError(`error[usage]: unknown CI \`${ciFlag || '(empty)'}\`: use github, gitlab or none`));
        return EXIT.USAGE;
    }
    const detected = await detectCi(target);
    const ci = ciFlag ?? detected.provider;
    const isGit = await exists(path.join(target, '.git'));
    const passthrough = [];
    for (const name of ['--agent', '--level', '--lang']) {
        const value = flagValue(args, name);
        if (value)
            passthrough.push(name, value);
    }
    if (args.includes('--mcp'))
        passthrough.push('--mcp');
    io.log(formatHeading(`open-sdd up — ${target}`));
    io.log(colors.dim(`  step 1/3 init (host detected, rigor, constitution, commit hook, skills)`));
    const initCode = await handleInitCommand([target, '--skills', ...passthrough, ...(write ? ['--write'] : [])], io, cwd);
    if (initCode !== EXIT.PASSED) {
        io.error(formatError('error[up]: init did not complete; nothing further was done'));
        io.error(`  = help: open-sdd init ${positional ?? '.'} --skills${write ? ' --write' : ''}  # to see the failing step on its own`);
        return initCode;
    }
    io.log('');
    io.log(colors.dim(`  step 2/3 CI gate matrix: ${ci}${ciFlag ? ' (declared)' : ` (${detected.evidence})`}`));
    if (ci !== 'none') {
        if (!isGit)
            io.log(colors.yellow('  ! not a git repository yet: the CI matrix is written, but no commit hook could be installed'));
        if (write) {
            if (!(await installCiTemplate(target, ci, io)))
                return EXIT.ENVIRONMENT;
        }
        else {
            io.log(`    would write ${ci === 'github' ? '.github/workflows/open-sdd-gates.yml' : '.gitlab/open-sdd-gates.gitlab-ci.yml'}`);
        }
    }
    if (!write) {
        io.log('');
        io.log(colors.dim('  step 3/3 doctor runs after --write'));
        io.log(`  = help: apply it with \`open-sdd up ${positional ?? '.'} --write\``);
        return EXIT.PASSED;
    }
    io.log('');
    io.log(colors.dim('  step 3/3 doctor (the verdict below is measured, not claimed)'));
    return handleDoctorCommand([], io, target);
};
