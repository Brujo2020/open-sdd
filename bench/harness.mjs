#!/usr/bin/env node
/**
 * open-sdd — synthetic incoherence bench.
 *
 * Generates N throwaway repositories, injects ONE known incoherence of a documented class into
 * each, runs THIS checkout's pinned CLI (`tools/open-sdd/dist/cli.js`) against it, and reports
 * per class: injected / caught / missed.
 *
 * ── What these numbers are ────────────────────────────────────────────────────────────────────
 * They are HONESTY numbers on SYNTHETIC repositories, not field data from real teams. Each repo
 * starts from a clean baseline and exactly one documented defect is injected; the harness asks
 * only "did the tool's own output name this class?". It does not measure precision against
 * organic noise, and it is not a benchmark of any other tool.
 *
 * ── The prompt-only baseline ─────────────────────────────────────────────────────────────────
 * A "prompt-only" workflow is a TEXT checklist: an instruction that asks a model to look for
 * these classes. It has no instrument, so it cannot verify any of them and it cannot prove a
 * negative. Its column is therefore `detectado por construcción: no` — that is a statement about
 * the ABSENCE of a verifier, not a measurement of another tool's recall. See bench/README.md.
 *
 * Usage:
 *   node bench/harness.mjs [--repos N] [--seed S] [--json] [--keep]
 *
 * Exit code: 0 when every injected incoherence was caught; 1 when any class was missed (a miss
 * is a finding, so the harness fails loudly instead of printing a comforting average).
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const CLI = path.join(REPO_ROOT, 'tools', 'open-sdd', 'dist', 'cli.js');

// ── args ─────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const raw = argv[i + 1];
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};
const REPOS = Math.max(1, Math.trunc(flag('--repos', 10)));
const SEED = Math.trunc(flag('--seed', 1));
const AS_JSON = argv.includes('--json');
const KEEP = argv.includes('--keep');

// ── deterministic PRNG (mulberry32) ──────────────────────────────────────────────────────────
const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const rng = mulberry32(SEED);
const shuffle = (list) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

// ── filesystem helpers ───────────────────────────────────────────────────────────────────────
const write = (root, rel, content) => {
  const target = path.join(root, rel);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
};

const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: NULL_DEVICE, GIT_CONFIG_SYSTEM: NULL_DEVICE };
const git = (cwd, args) =>
  spawnSync('git', ['-c', 'user.email=bench@example.test', '-c', 'user.name=bench', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: gitEnv,
  });

// ── the clean baseline every repo starts from ────────────────────────────────────────────────
const BASELINE_FILES = {
  '.sdd/settings/rigor.json': '{ "level": "spec-first" }',
  '.sdd/steering/constitution.md': [
    '# Constitution — bench',
    '',
    'Provenance: descriptive',
    'Generated: 2026-01-01T00:00:00.000Z',
    '',
    '## Principles',
    '',
    '### C-BOUNDARIES — Keep service boundaries',
    '- Level: SHOULD',
    '- Restriction: Un cambio no cruza una frontera de módulo salvo que la delta declare explícitamente el cruce.',
    '- Pattern: Mantener el cambio dentro de los límites declarados por el nodo del DAG de tareas.',
    '- Justification: Las fronteras actuales codifican decisiones de arquitectura vigentes.',
    '- Provenance: descriptive',
    '- Evidence: src',
    '',
    '## Amendments',
  ].join('\n'),
  '.sdd/specs/payments/requirements.md': [
    '# Requirements — payments',
    '',
    '### REQ-PAY-001 — Refund a captured charge',
    'The system SHALL refund a captured charge within 24 hours.',
  ].join('\n'),
  '.sdd/specs/payments/plan.md': [
    '# Plan — payments',
    '',
    'Refunds are recorded as compensating ledger entries.',
  ].join('\n'),
  '.sdd/specs/payments/delta.md': [
    '# Delta: payments — Add refunds',
    '',
    'Status: proposed',
    '',
    '## ADDED',
    '',
    '### REQ-PAY-010 — Refund a charge',
    '- Statement: WHEN a captured charge is refunded, the ledger shall record a compensating entry.',
    '- Targets: src/ledger.ts',
    '- Contracts: test/ledger.test.ts',
    '- Strangler: new',
    '',
    '## MODIFIED',
    '',
    '## REMOVED',
    '',
    '## RENAMED',
  ].join('\n'),
  '.sdd/specs/payments/tasks.md': [
    '# Tasks — payments',
    '',
    '- [ ] T1 Implement refund endpoint _Requirements: REQ-PAY-001, REQ-PAY-010_ _Boundary:_ `src`',
  ].join('\n'),
  'src/ledger.ts': 'export const refund = (id) => "refund:" + id;',
  'test/ledger.test.ts': 'export const covers = "ledger";',
};

const buildBaseline = (dir) => {
  for (const [rel, content] of Object.entries(BASELINE_FILES)) write(dir, rel, content);
  const init = git(dir, ['init', '-q']);
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  git(dir, ['add', '-A']);
  const commit = git(dir, ['commit', '-q', '-m', 'baseline']);
  if (commit.status !== 0) throw new Error(`git commit failed: ${commit.stderr}`);
};

const appendFile = (dir, rel, text) => {
  const target = path.join(dir, rel);
  writeFileSync(target, `${readFileSync(target, 'utf8')}${text}\n`, 'utf8');
};

const replaceIn = (dir, rel, from, to) => {
  const target = path.join(dir, rel);
  const next = readFileSync(target, 'utf8').split(from).join(to);
  writeFileSync(target, next, 'utf8');
};

// ── the tool, pinned and black-box ───────────────────────────────────────────────────────────
const runCli = (cwd, args) => {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', OPEN_SDD_LANG: 'en' },
    timeout: 120_000,
  });
  return {
    exitCode: result.status ?? -1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    error: result.error ? String(result.error.message) : null,
  };
};

const parseJsonOutput = (text) => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
};

// ── the documented classes ───────────────────────────────────────────────────────────────────
const CLASSES = [
  {
    id: 'untraced-requirement',
    label: 'requisito de la delta sin tarea',
    description:
      'A delta requirement (REQ-PAY-011, audit trail) exists and no task cites it: an obligation nobody will implement.',
    inject: (dir) => {
      replaceIn(
        dir,
        '.sdd/specs/payments/delta.md',
        '## MODIFIED',
        [
          '### REQ-PAY-011 — Audit trail',
          '- Statement: WHEN a refund is recorded, the system shall append an audit entry.',
          '- Targets: src/audit.ts',
          '- Strangler: new',
          '',
          '## MODIFIED',
        ].join('\n'),
      );
    },
    detect: async (dir) => {
      const run = runCli(dir, ['brownfield', 'analyze', 'payments', '--base', 'HEAD', '--json']);
      const report = parseJsonOutput(run.output);
      const caught = Boolean(
        report?.findings?.some((f) => f.code === 'REQUIREMENT_WITHOUT_TASK' && f.severity === 'error'),
      );
      return { caught, exitCode: run.exitCode, command: 'brownfield analyze payments --base HEAD --json' };
    },
  },
  {
    id: 'phantom-task-id',
    label: 'tarea que cita un id inexistente',
    description:
      'A task cites REQ-PAY-999, which the delta does not define: the task is not traceable.',
    inject: (dir) =>
      appendFile(dir, '.sdd/specs/payments/tasks.md', '- [ ] T2 Update ledger _Requirements: REQ-PAY-999_'),
    detect: async (dir) => {
      const run = runCli(dir, ['brownfield', 'analyze', 'payments', '--base', 'HEAD', '--json']);
      const report = parseJsonOutput(run.output);
      const caught = Boolean(report?.findings?.some((f) => f.code === 'PHANTOM_REQUIREMENT_ID'));
      return { caught, exitCode: run.exitCode, command: 'brownfield analyze payments --base HEAD --json' };
    },
  },
  {
    id: 'unfilled-placeholder',
    label: 'marcador {{...}} sin rellenar',
    description:
      'A task still carries the template placeholder {{REQ-AREA-002}} instead of a real requirement id.',
    inject: (dir) =>
      appendFile(dir, '.sdd/specs/payments/tasks.md', '- [ ] T3 Add tests _Requirements: {{REQ-AREA-002}}_'),
    detect: async (dir) => {
      const run = runCli(dir, ['delta', 'validate', 'payments']);
      const caught = run.output.includes('UNFILLED_REQUIREMENT_PLACEHOLDER');
      return { caught, exitCode: run.exitCode, command: 'delta validate payments' };
    },
  },
  {
    id: 'completed-task-without-evidence',
    label: 'tarea completada sin evidencia',
    description:
      'A task is marked complete with no `_Evidence:` line: a completeness claim with nothing that could falsify it.',
    inject: (dir) => replaceIn(dir, '.sdd/specs/payments/tasks.md', '- [ ] T1', '- [x] T1'),
    detect: async (dir) => {
      const run = runCli(dir, ['status', 'payments']);
      const caught = run.output.includes('evidencia 0/1 tarea(s) completada(s)');
      return { caught, exitCode: run.exitCode, command: 'status payments' };
    },
  },
  {
    id: 'declared-contract-missing',
    label: 'contrato declarado que no existe',
    description:
      'The delta declares test/missing.test.ts as the contract that protects the change, and that file does not exist.',
    inject: (dir) =>
      replaceIn(dir, '.sdd/specs/payments/delta.md', 'Contracts: test/ledger.test.ts', 'Contracts: test/missing.test.ts'),
    detect: async (dir) => {
      const run = runCli(dir, ['brownfield', 'analyze', 'payments', '--base', 'HEAD', '--json']);
      const report = parseJsonOutput(run.output);
      const caught = Boolean(report?.findings?.some((f) => f.code === 'DECLARED_CONTRACT_MISSING'));
      return { caught, exitCode: run.exitCode, command: 'brownfield analyze payments --base HEAD --json' };
    },
  },
  {
    id: 'spec-code-drift',
    label: 'deriva spec↔código',
    description:
      'A committed change touches src/other.ts while the delta declares src/ledger.ts: the change and the spec are unrelated.',
    inject: (dir) => {
      write(dir, 'src/other.ts', 'export const other = 1;');
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', 'unrelated change']);
    },
    detect: async (dir) => {
      const run = runCli(dir, ['brownfield', 'analyze', 'payments', '--base', 'HEAD~1', '--json']);
      const report = parseJsonOutput(run.output);
      const caught = Boolean(
        report?.findings?.some((f) => f.code === 'DELTA_TARGET_UNTOUCHED' && f.severity === 'error'),
      );
      return { caught, exitCode: run.exitCode, command: 'brownfield analyze payments --base HEAD~1 --json' };
    },
  },
  {
    id: 'expired-waiver',
    label: 'excepción de seguridad caducada',
    description:
      'A security allow-list entry whose `expires` is in the past still names a real finding; an expired waiver must not suppress.',
    inject: (dir) => {
      write(dir, 'src/fixture.ts', 'export const key = "AKIAIOSFODNN7EXAMPLE";');
      write(
        dir,
        '.sdd/settings/security-allowlist.json',
        JSON.stringify(
          [
            {
              path: 'src/fixture.ts',
              ids: ['aws-access-key'],
              reason: 'synthetic fixture for the bench',
              owner: 'bench',
              expires: '2020-01-01',
            },
          ],
          null,
          2,
        ),
      );
    },
    detect: async (dir) => {
      const run = runCli(dir, ['govern', 'constitution', '--advise', '--json']);
      const report = parseJsonOutput(run.output);
      const caught = Boolean(report?.advice?.some((a) => a.kind === 'waiver-expiring'));
      return { caught, exitCode: run.exitCode, command: 'govern constitution --advise --json' };
    },
  },
];

// ── assignment: every class at least once, shuffled by the seed ──────────────────────────────
const buildOrder = (count) => {
  const base = shuffle(CLASSES.map((c) => c.id));
  const order = [];
  while (order.length < count) order.push(...base);
  return order.slice(0, count);
};

const tempRoot = mkdtempSync(path.join(tmpdir(), 'open-sdd-bench-'));
const keep = (dir) => {
  if (!KEEP) rmSync(dir, { recursive: true, force: true });
};

const versionRun = runCli(REPO_ROOT, ['--version']);
const version = (versionRun.output.match(/v\d+\.\d+\.\d+/) ?? ['(unknown)'])[0];

if (!existsSync(CLI)) {
  console.error(`bench: pinned CLI not found at ${CLI}`);
  console.error('bench: build it first:  npm --prefix tools/open-sdd run build');
  process.exit(2);
}

// ── baseline sanity: the pristine repo must produce no error findings ────────────────────────
let baselineErrors = null;
{
  const dir = path.join(tempRoot, 'baseline');
  buildBaseline(dir);
  const run = runCli(dir, ['brownfield', 'analyze', 'payments', '--base', 'HEAD', '--json']);
  const report = parseJsonOutput(run.output);
  baselineErrors = report ? report.findings.filter((f) => f.severity === 'error').length : -1;
  keep(dir);
}

const order = buildOrder(REPOS);
const perClass = new Map(CLASSES.map((c) => [c.id, { injected: 0, caught: 0, missed: 0, repos: [] }]));
const repoRows = [];

for (const [index, classId] of order.entries()) {
  const cls = CLASSES.find((c) => c.id === classId);
  const dir = path.join(tempRoot, `repo-${String(index + 1).padStart(2, '0')}-${classId}`);
  buildBaseline(dir);
  cls.inject(dir);
  const result = await cls.detect(dir);
  const bucket = perClass.get(classId);
  bucket.injected += 1;
  if (result.caught) bucket.caught += 1;
  else bucket.missed += 1;
  bucket.repos.push({ repo: path.basename(dir), caught: result.caught, exitCode: result.exitCode });
  repoRows.push({ repo: path.basename(dir), class: classId, caught: result.caught, exitCode: result.exitCode, command: result.command });
  keep(dir);
}

const table = CLASSES.map((c) => {
  const b = perClass.get(c.id);
  return {
    class: c.id,
    label: c.label,
    injected: b.injected,
    caught: b.caught,
    missed: b.missed,
    promptOnly: 'detectado por construcción: no',
    detector: repoRows.find((r) => r.class === c.id)?.command ?? '',
  };
});

const totals = table.reduce(
  (acc, row) => ({ injected: acc.injected + row.injected, caught: acc.caught + row.caught, missed: acc.missed + row.missed }),
  { injected: 0, caught: 0, missed: 0 },
);

const payload = {
  tool: { name: 'open-sdd', version, cli: path.relative(REPO_ROOT, CLI).split(path.sep).join('/') },
  node: process.version,
  seed: SEED,
  repos: REPOS,
  synthetic: true,
  honesty:
    'Synthetic repositories only: each repo starts from a clean baseline and exactly one documented class is injected. Not field data from real teams.',
  baseline: { errorFindings: baselineErrors },
  table,
  totals,
  repos_detail: repoRows,
  promptOnlyBaseline:
    'A prompt-only checklist has no instrument: it cannot verify any class, so its column is "detectado por construcción: no". It is not a measurement of another tool.',
};

if (AS_JSON) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else {
  const pad = (s, n) => String(s).padEnd(n);
  console.log('');
  console.log(`open-sdd — synthetic incoherence bench`);
  console.log(`  tool     ${payload.tool.name} ${version} (${payload.tool.cli})`);
  console.log(`  node     ${process.version}   seed ${SEED}   repos ${REPOS}`);
  console.log(`  baseline ${baselineErrors === 0 ? 'clean (0 error findings)' : `UNEXPECTED: ${baselineErrors} error finding(s)`}`);
  console.log(`  temp     ${tempRoot}${KEEP ? ' (kept)' : ' (removed)'}`);
  console.log('');
  console.log(`  ${pad('class', 32)} ${pad('injected', 9)} ${pad('caught', 7)} ${pad('missed', 7)} prompt-only baseline`);
  console.log(`  ${'-'.repeat(32)} ${'-'.repeat(9)} ${'-'.repeat(7)} ${'-'.repeat(7)} ${'-'.repeat(34)}`);
  for (const row of table) {
    console.log(
      `  ${pad(row.class, 32)} ${pad(row.injected, 9)} ${pad(row.caught, 7)} ${pad(row.missed, 7)} ${row.promptOnly}`,
    );
  }
  console.log(`  ${'-'.repeat(32)} ${'-'.repeat(9)} ${'-'.repeat(7)} ${'-'.repeat(7)} ${'-'.repeat(34)}`);
  console.log(
    `  ${pad('TOTAL', 32)} ${pad(totals.injected, 9)} ${pad(totals.caught, 7)} ${pad(totals.missed, 7)}`,
  );
  console.log('');
  console.log('  Synthetic repositories: one documented class injected per repo, from a clean baseline.');
  console.log('  These are HONESTY numbers on SYNTHETIC repos — not field data from real teams.');
  console.log('');
  if (totals.missed > 0) {
    console.log('  MISSES (a miss is a finding, not a rounding error):');
    for (const row of repoRows.filter((r) => !r.caught)) {
      console.log(`    ${row.class}  ${row.repo}  (exit ${row.exitCode})`);
    }
    console.log('');
  }
}

if (baselineErrors !== 0 || totals.missed > 0) process.exit(1);
