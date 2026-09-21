#!/usr/bin/env node
/**
 * Verifier for CLM-067.
 *
 * The check register in `docs/guides/requirements-quality-catalog.md` is 42 entries; the subset the
 * coach implements deterministically is what `BUILT_IN_CHECK_IDS` says, NOT a number copied into
 * prose. This script fails when the count moves without the documentation — or when the two checks
 * the QA horde exposed (`AMB-006` superlative, the multi-slash chain of `AMB-009`) stop firing, or
 * when `AMB-006` starts firing on a bound that is not a superlative.
 */
import {
  BUILT_IN_CHECK_IDS,
  countByCheck,
  reviewRequirements,
} from '../tools/open-sdd/dist/core/requirementsCoach.js';

/** Bump this together with the register and the README; the claim is what keeps them in step. */
const EXPECTED_COUNT = 32;

const review = (statement) =>
  reviewRequirements({
    feature: 'f',
    artifacts: [{ file: '.sdd/specs/f/requirements.md', text: `# Requirements\n\n${statement}\n` }],
    entries: [],
    runner: () => [],
  });

const count = (statement, id) => countByCheck(review(statement).findings)[id] ?? 0;

const problems = [];
if (BUILT_IN_CHECK_IDS.length !== EXPECTED_COUNT) {
  problems.push(`BUILT_IN_CHECK_IDS is ${BUILT_IN_CHECK_IDS.length}, expected ${EXPECTED_COUNT}`);
}
for (const id of ['AMB-006', 'AMB-009']) {
  if (!BUILT_IN_CHECK_IDS.includes(id)) problems.push(`${id} is not implemented`);
}
if (count('- The system shall use the best possible approach.', 'AMB-006') !== 1) {
  problems.push('AMB-006 does not fire exactly once on a superlative');
}
if (count('- The system shall read/write/delete the record.', 'AMB-009') !== 1) {
  problems.push('AMB-009 does not fire exactly once on a slash chain');
}
if (count('- The system shall retry at most 5 times.', 'AMB-006') !== 0) {
  problems.push('AMB-006 fires on a bounded `at most N`, which is a false positive');
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`coach checks: ${problem}`);
  process.exit(1);
}
console.log(`coach checks: ${BUILT_IN_CHECK_IDS.length} implemented; AMB-006 and AMB-009 verified`);
