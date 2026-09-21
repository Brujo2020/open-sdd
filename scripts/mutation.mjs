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
 * THE THRESHOLD IS PER FAMILY, not only overall. An overall ratio hides a family that is barely
 * covered: 25/27 reads as 93 % while the receipt family could be 1/3. Each family declares its own
 * bar — today every one of them is 1.00, so a single survivor anywhere fails the run.
 *
 * Usage:
 *   node scripts/mutation.mjs                  # every mutant
 *   node scripts/mutation.mjs --family coach   # one family
 *   node scripts/mutation.mjs --only M05       # one mutant
 *   node scripts/mutation.mjs --list           # the catalogue and what each mutant breaks
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.join(root, 'tools', 'open-sdd');
const SRC = 'tools/open-sdd/src';

/**
 * The bar per family. 1.00 means every mutant in that family must be killed: there is no "mostly
 * covered" for a control that decides whether a file is deleted or a gate fails.
 */
const THRESHOLDS = {
  security: 1.0,
  drift: 1.0,
  standards: 1.0,
  ids: 1.0,
  receipt: 1.0,
  coach: 1.0,
  cli: 1.0,
  enforcement: 1.0,
};
const OVERALL_THRESHOLD = 1.0;

/**
 * Each mutant names the DEFECT it introduces, not the line it edits: if the anchor moves, the run
 * fails loudly instead of quietly testing nothing.
 */
const MUTANTS = [
  // ── security ──────────────────────────────────────────────────────────────────────────────────
  {
    id: 'M01',
    family: 'security',
    breaks: 'the security scanner never finds anything',
    file: `${SRC}/core/gateRunner.ts`,
    find: 'const raw = scanSecurity(files);',
    replace: 'const raw: ReturnType<typeof scanSecurity> = [];',
    tests: ['test/coreGateRunner.test.ts'],
  },
  {
    id: 'M02',
    family: 'security',
    breaks: 'an expired exception keeps suppressing',
    file: `${SRC}/core/securityAllowlist.ts`,
    find: 'if (isExpired(entry.expires, now)) {',
    replace: 'if (false) {',
    tests: ['test/coreWaivers.test.ts'],
  },
  {
    id: 'M21',
    family: 'security',
    breaks: 'an exception for one rule suppresses a different one on the same path',
    file: `${SRC}/core/securityAllowlist.ts`,
    find: 'entries.find((e) => e.ids.includes(finding.id) && pathMatches(finding.file, e.path));',
    replace: 'entries.find((e) => pathMatches(finding.file, e.path));',
    tests: ['test/qaTier3Hard.test.ts'],
  },

  // ── drift ─────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'M03',
    family: 'drift',
    breaks: 'a drift waiver never expires',
    file: `${SRC}/core/driftCheck.ts`,
    find: 'return end.getTime() < now.getTime();',
    replace: 'return false;',
    tests: ['test/coreDriftCheck.test.ts'],
  },
  {
    id: 'M04',
    family: 'drift',
    breaks: 'every path matches every boundary',
    file: `${SRC}/core/driftCheck.ts`,
    find: 'return new RegExp(`^${out}/`).test(target);',
    replace: 'return true;',
    tests: ['test/coreDriftCheck.test.ts'],
  },
  {
    id: 'M22',
    family: 'drift',
    breaks: 'a single-segment wildcard crosses directories',
    file: `${SRC}/core/driftCheck.ts`,
    find: "out += '[^/]*';",
    replace: "out += '.*';",
    tests: ['test/coreDriftCheck.test.ts'],
  },

  // ── standards ─────────────────────────────────────────────────────────────────────────────────
  {
    id: 'M05',
    family: 'standards',
    breaks: 'a standard blocks without a measured corpus',
    file: `${SRC}/core/standards.ts`,
    find: "entry.blocking === true && typeof entry.calibrated.corpus === 'string' && entry.calibrated.corpus.trim().length > 0;",
    replace: 'true;',
    tests: ['test/qaTier3Hard.test.ts'],
  },
  {
    id: 'M06',
    family: 'standards',
    breaks: 'drift is never reported',
    file: `${SRC}/core/standardsRender.ts`,
    find: 'if (disagreeing.length === 0) continue;',
    replace: 'continue;',
    tests: ['test/coreStandardsRender.test.ts'],
  },
  {
    id: 'M07',
    family: 'standards',
    breaks: 'injection duplicates an existing block instead of replacing it',
    file: `${SRC}/core/standardsRender.ts`,
    find: 'content = content.slice(0, start) + renderEntryBlock(entry) + content.slice(stop + end.length);',
    replace: 'missing.push(entry);',
    tests: ['test/coreStandardsInject.test.ts'],
  },
  {
    id: 'M20',
    family: 'standards',
    breaks: 'the declared extension claims to be a blocking control',
    file: `${SRC}/core/gateCatalog.ts`,
    find: "posture: 'advisory',\n    imposes: [],",
    replace: "posture: 'blocking',\n    imposes: [],",
    tests: ['test/coreGateCatalog.test.ts'],
  },

  // ── ids ───────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'M08',
    family: 'ids',
    breaks: 'a changed requirement is not reported as ID-MUTATED',
    file: `${SRC}/core/stableIds.ts`,
    find: 'if (now !== statement) {',
    replace: 'if (false) {',
    tests: ['test/coreStableIds.test.ts'],
  },
  {
    id: 'M09',
    family: 'ids',
    breaks: 'identifiers are allocated from 1 and therefore renumber',
    file: `${SRC}/core/stableIds.ts`,
    find: 'const start = Math.floor(highest / size) * size + size;',
    replace: 'const start = 1;',
    tests: ['test/coreStableIds.test.ts'],
  },
  {
    id: 'M10',
    family: 'ids',
    breaks: 'the base revision is never read, so every audit is vacuous',
    file: `${SRC}/core/stableIds.ts`,
    find: "return execFileSync('git', ['show',",
    replace: 'return null;\n    return execFileSync(\'git\', [\'show\',',
    tests: ['test/coreStableIds.test.ts'],
  },

  // ── receipt ───────────────────────────────────────────────────────────────────────────────────
  {
    id: 'M11',
    family: 'receipt',
    breaks: "a human's edit is deleted by uninstall",
    file: `${SRC}/core/receipt.ts`,
    find: 'if (entry.sha256 !== null && current !== entry.sha256) {',
    replace: 'if (false) {',
    tests: ['test/coreReceipt.test.ts'],
  },
  {
    id: 'M12',
    family: 'receipt',
    breaks: 'a merged external config is deleted instead of refused',
    file: `${SRC}/core/receipt.ts`,
    find: "if (entry.action === 'merge') {",
    replace: 'if (false) {',
    tests: ['test/coreReceipt.test.ts'],
  },
  {
    id: 'M23',
    family: 'receipt',
    breaks: 'applyUninstall deletes what the plan refused',
    file: `${SRC}/core/receipt.ts`,
    find: "if (entry.state !== 'remove') continue;",
    replace: 'if (false) continue;',
    tests: ['test/coreReceipt.test.ts', 'test/qaTier3Hard.test.ts'],
  },

  // ── coach ─────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'M13',
    family: 'coach',
    breaks: 'both context guards are disabled (a negation and a comparative inside a condition)',
    file: `${SRC}/core/requirementsCoach.ts`,
    find: 'if (insideCondition(stmt.text, index)) continue;',
    replace: 'if (false) continue;',
    all: true,
    tests: ['test/qaTier2Intermediate.test.ts'],
  },
  {
    id: 'M14',
    family: 'coach',
    breaks: 'instruction-shaped content is no longer escalated',
    file: `${SRC}/core/requirementsCoach.ts`,
    find: 'escalate: true,',
    replace: 'escalate: false,',
    all: true,
    tests: ['test/qaTier2Intermediate.test.ts'],
  },
  {
    id: 'M24',
    family: 'coach',
    breaks: 'an orphan requirement stops asking which need authorises it',
    file: `${SRC}/core/requirementsCoach.ts`,
    find: 'which need or goal authorises \\`${section.id}\\`? link it or delete it',
    replace: '',
    tests: ['test/qaTier2Intermediate.test.ts'],
  },
  {
    id: 'M25',
    family: 'coach',
    breaks: 'AMB-006 flags a bounded `at most N` as a superlative',
    file: `${SRC}/core/requirementsCoach.ts`,
    find: 'if (/^(?:most|least)$/.test(token) && /\\bat\\s+$/i.test(before)) continue;',
    replace: 'if (false) continue;',
    tests: ['test/qaTier2Intermediate.test.ts'],
  },

  // ── cli ───────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'M15',
    family: 'cli',
    breaks: 'the CLI advertises the unscoped package that does not exist',
    file: `${SRC}/cli/packageIdentity.ts`,
    find: '= identity.name;',
    replace: "= 'open-sdd';",
    tests: ['test/cliPackageIdentity.test.ts'],
  },
  {
    id: 'M16',
    family: 'cli',
    breaks: 'an untranslated locale is accepted instead of refused',
    file: `${SRC}/cli/i18n.ts`,
    find: "export const SUPPORTED_LOCALES = ['es', 'en'] as const;",
    replace: "export const SUPPORTED_LOCALES = ['es', 'en', 'ja'] as const;",
    tests: ['test/cliLocale.test.ts'],
  },
  {
    id: 'M17',
    family: 'cli',
    breaks: 'a usage error is reported as a governance failure',
    file: `${SRC}/cli/commands/help.ts`,
    find: 'USAGE: 2,',
    replace: 'USAGE: 1,',
    tests: ['test/cliExitCodes.test.ts'],
  },
  {
    id: 'M18',
    family: 'cli',
    breaks: 'NO_COLOR stops disabling colour',
    file: `${SRC}/cli/ui/colors.ts`,
    find: "typeof env.NO_COLOR === 'string' && env.NO_COLOR.length > 0;",
    replace: 'false;',
    tests: ['test/cliColors.test.ts'],
  },

  // ── enforcement ───────────────────────────────────────────────────────────────────────────────
  {
    id: 'M19',
    family: 'enforcement',
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
    id: 'M26',
    family: 'enforcement',
    breaks: 'a control that inspects nothing is no longer reported as vacuous',
    file: `${SRC}/core/enforcement.ts`,
    find: 'if (observation.inspects === false) {',
    replace: 'if (false) {',
    // Igual que M19: lo protege `coreEnforcement`, no `enforcementFloor`. Elegir mal el objetivo
    // produce un superviviente falso, y un falso superviviente es un error del arnés.
    tests: ['test/coreEnforcement.test.ts'],
  },
  {
    id: 'M27',
    family: 'enforcement',
    breaks: 'a missing sensor stops being distinguishable from a clean run',
    file: `${SRC}/core/enforcement.ts`,
    find: 'if (!observation.sensorAvailable) {',
    replace: 'if (false) {',
    tests: ['test/coreEnforcement.test.ts'],
  },
];

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const mutant of MUTANTS) {
    console.log(`${mutant.id}  [${mutant.family}]  ${mutant.file.replace(`${SRC}/`, '')}`);
    console.log(`     breaks: ${mutant.breaks}`);
    console.log(`     tests:  ${mutant.tests.join(', ')}`);
  }
  const families = [...new Set(MUTANTS.map((mutant) => mutant.family))];
  console.log('\nthresholds:');
  for (const family of families) {
    const count = MUTANTS.filter((mutant) => mutant.family === family).length;
    console.log(`  ${family.padEnd(12)} ${count} mutant(s) · bar ${(THRESHOLDS[family] ?? 1).toFixed(2)}`);
  }
  console.log(`  ${'OVERALL'.padEnd(12)} ${MUTANTS.length} mutant(s) · bar ${OVERALL_THRESHOLD.toFixed(2)}`);
  process.exit(0);
}

const flagValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? '') : null;
};
const only = flagValue('--only');
const familyFilter = flagValue('--family');
let selected = MUTANTS;
if (only) selected = selected.filter((mutant) => mutant.id === only);
if (familyFilter) selected = selected.filter((mutant) => mutant.family === familyFilter);
if (selected.length === 0) {
  console.error(`no mutant matches ${only ?? familyFilter}`);
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
    console.log(`${mutant.id}  [${mutant.family}]  ${green ? 'SURVIVED ' : 'KILLED   '}  ${mutant.breaks}`);
  } finally {
    writeFileSync(abs, original, 'utf8');
  }
}

// ── The bar, per family ─────────────────────────────────────────────────────────────────────────
const families = [...new Set(results.map((result) => result.family))].sort();
console.log('\nper family:');
const belowBar = [];
for (const family of families) {
  const inFamily = results.filter((result) => result.family === family);
  const killed = inFamily.filter((result) => result.verdict === 'KILLED').length;
  const total = inFamily.length;
  const bar = familyFilter && familyFilter !== family ? (THRESHOLDS[family] ?? 1) : (THRESHOLDS[family] ?? 1);
  const ratio = total === 0 ? 1 : killed / total;
  const ok = ratio >= bar;
  if (!ok) belowBar.push(`${family} ${killed}/${total} < ${bar.toFixed(2)}`);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${family.padEnd(12)} ${killed}/${total}  bar ${bar.toFixed(2)}`);
}

const killed = results.filter((result) => result.verdict === 'KILLED').length;
const survived = results.filter((result) => result.verdict === 'SURVIVED');
const notApplied = results.filter((result) => result.verdict === 'NOT-APPLIED');
const overall = killed / results.length;

console.log(`\noverall: ${killed}/${results.length} killed (${(overall * 100).toFixed(0)} %) · bar ${OVERALL_THRESHOLD.toFixed(2)}`);
for (const mutant of survived) console.log(`  SURVIVED ${mutant.id} [${mutant.family}]: ${mutant.breaks} (targets: ${mutant.tests.join(', ')})`);
for (const mutant of notApplied) console.log(`  NOT-APPLIED ${mutant.id}: anchor missing in ${mutant.file}`);
for (const failure of belowBar) console.log(`  BELOW BAR ${failure}`);

const failed = survived.length > 0 || notApplied.length > 0 || overall < OVERALL_THRESHOLD || belowBar.length > 0;
process.exit(failed ? 1 : 0);
