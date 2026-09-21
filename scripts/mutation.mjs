#!/usr/bin/env node
/**
 * Mutation testing — "is the suite a net, or decoration?".
 *
 * A green suite proves nothing on its own: it proves something only if it FAILS when the behaviour it
 * claims to protect is broken. This harness introduces a documented defect into the engine, runs the
 * tests that should catch it, and restores the file. A mutant that survives is a hole in the suite.
 *
 * Three rules keep it honest:
 *   1. A mutant whose anchor cannot be found is NOT-APPLIED and fails the run — an anchor that
 *      silently stops matching would turn this into a green light over nothing.
 *   2. The baseline runs first: if the target tests are not green before any mutation, "KILLED"
 *      would be meaningless.
 *   3. The file is always restored, mutation applied or not.
 *
 * Usage:
 *   node scripts/mutation.mjs                 # every mutant
 *   node scripts/mutation.mjs --only M05      # one mutant
 *   node scripts/mutation.mjs --list          # the catalogue and what each mutant breaks
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.join(root, 'tools', 'open-sdd');
const SRC = 'tools/open-sdd/src';

/**
 * Each mutant names the DEFECT it introduces, not the line it edits: if the anchor moves, the run
 * fails loudly instead of quietly testing nothing.
 */
const MUTANTS = [
  {
    id: 'M01',
    breaks: 'the security scanner never finds anything',
    file: `${SRC}/core/gateRunner.ts`,
    find: 'const raw = scanSecurity(files);',
    replace: 'const raw: ReturnType<typeof scanSecurity> = [];',
    tests: ['test/coreGateRunner.test.ts'],
  },
  {
    id: 'M02',
    breaks: 'an expired exception keeps suppressing',
    file: `${SRC}/core/securityAllowlist.ts`,
    find: 'if (isExpired(entry.expires, now)) {',
    replace: 'if (false) {',
    tests: ['test/coreWaivers.test.ts'],
  },
  {
    id: 'M03',
    breaks: 'a drift waiver never expires',
    file: `${SRC}/core/driftCheck.ts`,
    find: 'return end.getTime() < now.getTime();',
    replace: 'return false;',
    tests: ['test/coreDriftCheck.test.ts'],
  },
  {
    id: 'M04',
    breaks: 'every path matches every boundary',
    file: `${SRC}/core/driftCheck.ts`,
    find: 'return new RegExp(`^${out}/`).test(target);',
    replace: 'return true;',
    tests: ['test/coreDriftCheck.test.ts'],
  },
  {
    id: 'M05',
    breaks: 'a standard blocks without a measured corpus',
    file: `${SRC}/core/standards.ts`,
    find: "entry.blocking === true && typeof entry.calibrated.corpus === 'string' && entry.calibrated.corpus.trim().length > 0;",
    replace: 'true;',
    tests: ['test/qaTier3Hard.test.ts'],
  },
  {
    id: 'M06',
    breaks: 'drift is never reported',
    file: `${SRC}/core/standardsRender.ts`,
    find: 'if (disagreeing.length === 0) continue;',
    replace: 'continue;',
    tests: ['test/coreStandardsRender.test.ts'],
  },
  {
    id: 'M07',
    breaks: 'injection duplicates an existing block instead of replacing it',
    file: `${SRC}/core/standardsRender.ts`,
    find: 'content = content.slice(0, start) + renderEntryBlock(entry) + content.slice(stop + end.length);',
    replace: 'missing.push(entry);',
    tests: ['test/coreStandardsInject.test.ts'],
  },
  {
    id: 'M08',
    breaks: 'a changed requirement is not reported as ID-MUTATED',
    file: `${SRC}/core/stableIds.ts`,
    find: 'if (now !== statement) {',
    replace: 'if (false) {',
    tests: ['test/coreStableIds.test.ts'],
  },
  {
    id: 'M09',
    breaks: 'identifiers are allocated from 1 and therefore renumber',
    file: `${SRC}/core/stableIds.ts`,
    find: 'const start = Math.floor(highest / size) * size + size;',
    replace: 'const start = 1;',
    tests: ['test/coreStableIds.test.ts'],
  },
  {
    id: 'M10',
    breaks: 'the base revision is never read, so every audit is vacuous',
    file: `${SRC}/core/stableIds.ts`,
    find: "return execFileSync('git', ['show',",
    replace: 'return null;\n    return execFileSync(\'git\', [\'show\',',
    tests: ['test/coreStableIds.test.ts'],
  },
  {
    id: 'M11',
    breaks: "a human's edit is deleted by uninstall",
    file: `${SRC}/core/receipt.ts`,
    find: 'if (entry.sha256 !== null && current !== entry.sha256) {',
    replace: 'if (false) {',
    tests: ['test/coreReceipt.test.ts'],
  },
  {
    id: 'M12',
    breaks: 'a merged external config is deleted instead of refused',
    file: `${SRC}/core/receipt.ts`,
    find: "if (entry.action === 'merge') {",
    replace: 'if (false) {',
    tests: ['test/coreReceipt.test.ts'],
  },
  {
    id: 'M13',
    breaks: 'both context guards are disabled (a negation and a comparative inside a condition)',
    file: `${SRC}/core/requirementsCoach.ts`,
    find: 'if (insideCondition(stmt.text, index)) continue;',
    replace: 'if (false) continue;',
    all: true,
    tests: ['test/qaTier2Intermediate.test.ts'],
  },
  {
    id: 'M14',
    breaks: 'instruction-shaped content is no longer escalated',
    file: `${SRC}/core/requirementsCoach.ts`,
    find: 'escalate: true,',
    replace: 'escalate: false,',
    all: true,
    tests: ['test/qaTier2Intermediate.test.ts'],
  },
  {
    id: 'M15',
    breaks: 'the CLI advertises the unscoped package that does not exist',
    file: `${SRC}/cli/packageIdentity.ts`,
    find: '= identity.name;',
    replace: "= 'open-sdd';",
    tests: ['test/cliPackageIdentity.test.ts'],
  },
  {
    id: 'M16',
    breaks: 'an untranslated locale is accepted instead of refused',
    file: `${SRC}/cli/i18n.ts`,
    find: "export const SUPPORTED_LOCALES = ['es', 'en'] as const;",
    replace: "export const SUPPORTED_LOCALES = ['es', 'en', 'ja'] as const;",
    tests: ['test/cliLocale.test.ts'],
  },
  {
    id: 'M17',
    breaks: 'a usage error is reported as a governance failure',
    file: `${SRC}/cli/commands/help.ts`,
    find: 'USAGE: 2,',
    replace: 'USAGE: 1,',
    tests: ['test/cliExitCodes.test.ts'],
  },
  {
    id: 'M18',
    breaks: 'NO_COLOR stops disabling colour',
    file: `${SRC}/cli/ui/colors.ts`,
    find: "typeof env.NO_COLOR === 'string' && env.NO_COLOR.length > 0;",
    replace: 'false;',
    tests: ['test/cliColors.test.ts'],
  },
  {
    id: 'M19',
    breaks: 'a gate that found something no longer fails',
    file: `${SRC}/core/enforcement.ts`,
    find: 'if (observation.fired) {',
    replace: 'if (false) {',
    // El comportamiento lo protegen los tests de la cadena, no el fichero del suelo por sí solo: la
    // primera versión de este mapeo apuntaba solo a `enforcementFloor` y el mutante "sobrevivía"
    // siendo falso. Un superviviente por un objetivo mal elegido es un error del arnés, no un hueco.
    tests: ['test/coreGateRunner.test.ts', 'test/qaTier3Hard.test.ts'],
  },
  {
    id: 'M20',
    breaks: 'the declared extension claims to be a blocking control',
    file: `${SRC}/core/gateCatalog.ts`,
    find: "posture: 'advisory',\n    imposes: [],",
    replace: "posture: 'blocking',\n    imposes: [],",
    tests: ['test/coreGateCatalog.test.ts'],
  },
];

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const mutant of MUTANTS) {
    console.log(`${mutant.id}  ${mutant.file.replace(`${SRC}/`, '')}`);
    console.log(`     breaks: ${mutant.breaks}`);
    console.log(`     tests:  ${mutant.tests.join(', ')}`);
  }
  process.exit(0);
}
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null;
const selected = only ? MUTANTS.filter((mutant) => mutant.id === only) : MUTANTS;
if (selected.length === 0) {
  console.error(`no mutant matches ${only}`);
  process.exit(2);
}

const testsPass = (tests) => {
  try {
    execFileSync('npx', ['vitest', 'run', ...tests], { cwd: workspace, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

// ── Baseline: the target tests must be green BEFORE any mutation ────────────────────────────────
const union = [...new Set(selected.flatMap((mutant) => mutant.tests))];
console.log(`baseline: ${union.length} file(s) must be green before a single mutation\n`);
if (!testsPass(union)) {
  console.error('BASELINE RED — the target tests already fail; a KILLED verdict would be meaningless.');
  process.exit(2);
}
console.log('baseline green\n');

const results = [];
for (const mutant of selected) {
  const abs = path.join(root, mutant.file);
  const original = readFileSync(abs, 'utf8');
  const occurrences = original.split(mutant.find).length - 1;
  if (occurrences === 0) {
    results.push({ ...mutant, verdict: 'NOT-APPLIED' });
    console.log(`${mutant.id}  NOT-APPLIED  anchor not found in ${mutant.file}`);
    continue;
  }
  const mutated = mutant.all ? original.split(mutant.find).join(mutant.replace) : original.replace(mutant.find, mutant.replace);
  try {
    writeFileSync(abs, mutated, 'utf8');
    const green = testsPass(mutant.tests);
    results.push({ ...mutant, verdict: green ? 'SURVIVED' : 'KILLED' });
    console.log(`${mutant.id}  ${green ? 'SURVIVED ' : 'KILLED   '}  ${mutant.breaks}`);
  } finally {
    writeFileSync(abs, original, 'utf8');
  }
}

const killed = results.filter((result) => result.verdict === 'KILLED').length;
const survived = results.filter((result) => result.verdict === 'SURVIVED');
const notApplied = results.filter((result) => result.verdict === 'NOT-APPLIED');

console.log(`\n${killed}/${results.length} killed · ${survived.length} survived · ${notApplied.length} not applied`);
for (const mutant of survived) console.log(`  SURVIVED ${mutant.id}: ${mutant.breaks} (targets: ${mutant.tests.join(', ')})`);
for (const mutant of notApplied) console.log(`  NOT-APPLIED ${mutant.id}: anchor missing in ${mutant.file}`);

process.exit(survived.length > 0 || notApplied.length > 0 ? 1 : 0);
