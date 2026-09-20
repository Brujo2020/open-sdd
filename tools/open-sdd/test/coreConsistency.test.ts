import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkConsistency } from '../src/core/consistency.js';
import { handleBrownfieldCommand } from '../src/cli/commands/brownfield.js';
import type { CliIO } from '../src/cli/io.js';

const temps: string[] = [];

const makeTemp = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const makeIO = (): { io: CliIO; logs: string[]; errors: string[] } => {
  const logs: string[] = [];
  const errors: string[] = [];
  const io: CliIO = {
    log: (msg) => logs.push(msg),
    error: (msg) => errors.push(msg),
    exit: () => undefined,
  };
  return { io, logs, errors };
};

const writeText = async (dir: string, rel: string, content: string): Promise<void> => {
  const absolute = path.join(dir, rel);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf8');
};

const writeSpec = async (
  dir: string,
  feature: string,
  files: { requirements?: string; plan?: string; tasks?: string; delta?: string },
): Promise<void> => {
  for (const [name, content] of Object.entries(files)) {
    if (content === undefined) continue;
    await writeText(dir, path.posix.join('.sdd', 'specs', feature, `${name}.md`), content);
  }
};

const writeConstitution = async (dir: string, markdown: string): Promise<void> => {
  await writeText(dir, '.sdd/steering/constitution.md', markdown);
};

/** Minimal Node project: a manifest, a source dir and a test dir the checks can observe. */
const writeProject = async (dir: string, options: { test?: boolean } = {}): Promise<void> => {
  await writeText(
    dir,
    'package.json',
    `${JSON.stringify(
      {
        name: 'consistency-fixture',
        private: true,
        scripts: { test: 'vitest run' },
        devDependencies: { typescript: '^5.9.3', vitest: '^4.0.18' },
      },
      null,
      2,
    )}\n`,
  );
  await writeText(dir, 'tsconfig.json', '{\n  "compilerOptions": {}\n}\n');
  await writeText(dir, 'src/orders.ts', 'export const createOrder = (id: string): string => id;\n');
  if (options.test === true) await writeText(dir, 'test/orders.test.ts', 'export const test = (): void => undefined;\n');
};

const deltaWith = (entries: string): string => `# Delta: demo — Cambio de pedidos

Status: proposed

## ADDED

${entries}

## MODIFIED

## REMOVED

## RENAMED
`;

const tasksWith = (lines: string): string => `# Implementation Plan — demo

## Tasks

${lines}
`;

const git = (root: string, args: string[]): void => {
  execFileSync('git', ['-c', 'user.email=fixture@example.test', '-c', 'user.name=Fixture', ...args], {
    cwd: root,
    stdio: 'pipe',
  });
};

describe('core/consistency — requirement ↔ task traceability', () => {
  it('reports an untraced requirement and a task citing a phantom id, both with artifacts', async () => {
    const dir = await makeTemp('open-sdd-consistency-');
    await writeProject(dir);
    await writeSpec(dir, 'demo', {
      delta: deltaWith(
        [
          '### REQ-ORD-001 — Crear pedido',
          '- Statement: WHEN a request arrives, the service shall create an order.',
          '- Targets: src/orders.ts',
          '- Strangler: new',
          '',
          '### REQ-ORD-002 — Listar pedidos',
          '- Statement: WHEN a query arrives, the service shall list the orders.',
          '- Targets: src/orders.ts',
          '- Strangler: new',
        ].join('\n'),
      ),
      tasks: tasksWith(
        [
          '- [ ] 1.1 Implementar la creación — _Requirements: REQ-ORD-001_ — _Boundary:_ `src`',
          '- [ ] 1.2 Implementar otra cosa — _Requirements: REQ-GHOST-999_ — _Boundary:_ `src`',
        ].join('\n'),
      ),
    });

    const report = await checkConsistency({ cwd: dir, feature: 'demo', changedFiles: ['src/orders.ts'] });

    const untraced = report.findings.find((finding) => finding.code === 'REQUIREMENT_WITHOUT_TASK')!;
    expect(untraced.severity).toBe('error');
    expect(untraced.message).toContain('REQ-ORD-002');
    expect(untraced.artifacts).toContain('.sdd/specs/demo/delta.md');
    expect(untraced.artifacts).toContain('.sdd/specs/demo/tasks.md');

    const phantom = report.findings.find((finding) => finding.code === 'PHANTOM_REQUIREMENT_ID')!;
    expect(phantom.severity).toBe('error');
    expect(phantom.message).toContain('REQ-GHOST-999');
    expect(phantom.artifacts).toContain('.sdd/specs/demo/tasks.md');

    expect(report.checked.some((item) => item.startsWith('trazabilidad requisito→tarea'))).toBe(true);
    expect(report.checked.some((item) => item.startsWith('objetivos de la delta'))).toBe(true);
    expect(report.complete).toBe(false);
    expect(report.notChecked.some((item) => item.includes('constitution.md'))).toBe(true);
  });

  it('traces requirements.md with the same matcher when there is no delta', async () => {
    const dir = await makeTemp('open-sdd-consistency-req-');
    await writeProject(dir);
    await writeSpec(dir, 'demo', {
      requirements: [
        '# Requirements — demo',
        '',
        '### REQ-ORD-001 — Crear pedido',
        '- Statement: WHEN a request arrives, the service shall create an order.',
        '',
      ].join('\n'),
      tasks: tasksWith(
        [
          '- [ ] 1.1 Implementar la creación — _Requirements: REQ-ORD-001_ — _Boundary:_ `src`',
          '- [ ] 1.2 Inventar — _Requirements: REQ-GHOST-999_ — _Boundary:_ `src`',
        ].join('\n'),
      ),
    });

    const report = await checkConsistency({ cwd: dir, feature: 'demo', changedFiles: ['src/orders.ts'] });

    expect(report.checked.some((item) => item.includes('requirements.md'))).toBe(true);
    expect(report.findings.some((finding) => finding.code === 'PHANTOM_REQUIREMENT_ID')).toBe(true);
    expect(report.findings.some((finding) => finding.code === 'REQUIREMENT_WITHOUT_TASK')).toBe(false);
    expect(report.notChecked.some((item) => /no existe delta\.md/.test(item))).toBe(true);
  });
});

describe('core/consistency — delta, contracts and boundaries', () => {
  it('flags a declared contract that does not exist and accepts one that does', async () => {
    const dir = await makeTemp('open-sdd-consistency-contract-');
    await writeProject(dir, { test: true });
    await writeSpec(dir, 'demo', {
      delta: `# Delta: demo — Contratos

Status: proposed

## ADDED

## MODIFIED

### REQ-ORD-001 — Modificar la creación
- Statement: WHEN a request arrives, the service shall create an order.
- Previous: la creación anterior
- Targets: src/orders.ts
- Contracts: test/orders.test.ts
- Strangler: both

### REQ-ORD-002 — Modificar el listado
- Statement: WHEN a query arrives, the service shall list the orders.
- Previous: el listado anterior
- Targets: src/orders.ts
- Contracts: test/ghost.test.ts
- Strangler: both

## REMOVED

## RENAMED
`,
      tasks: tasksWith(
        [
          '- [ ] 1.1 Cambiar la creación — _Requirements: REQ-ORD-001_ — _Boundary:_ `src`',
          '- [ ] 1.2 Cambiar el listado — _Requirements: REQ-ORD-002_ — _Boundary:_ `src`',
        ].join('\n'),
      ),
    });

    const report = await checkConsistency({ cwd: dir, feature: 'demo', changedFiles: ['src/orders.ts'] });

    const missing = report.findings.filter((finding) => finding.code === 'DECLARED_CONTRACT_MISSING');
    expect(missing).toHaveLength(1);
    expect(missing[0]!.severity).toBe('error');
    expect(missing[0]!.message).toContain('test/ghost.test.ts');
    expect(missing[0]!.message).not.toContain('test/orders.test.ts');
    expect(missing[0]!.artifacts).toContain('.sdd/specs/demo/delta.md');
    expect(report.checked.some((item) => item.startsWith('contratos declarados'))).toBe(true);
  });

  it('flags a boundary that covers nothing and accepts one that covers observed code', async () => {
    const dir = await makeTemp('open-sdd-consistency-boundary-');
    await writeProject(dir);
    await writeSpec(dir, 'demo', {
      delta: deltaWith(
        [
          '### REQ-ORD-001 — Crear pedido',
          '- Statement: WHEN a request arrives, the service shall create an order.',
          '- Targets: src/orders.ts',
          '- Strangler: new',
        ].join('\n'),
      ),
      tasks: tasksWith(
        [
          '- [ ] 1.1 Implementar la creación — _Requirements: REQ-ORD-001_ — _Boundary:_ `apps/ghost`',
        ].join('\n'),
      ),
    });

    const report = await checkConsistency({ cwd: dir, feature: 'demo', changedFiles: ['src/orders.ts'] });
    const empty = report.findings.find((finding) => finding.code === 'BOUNDARY_COVERS_NOTHING')!;
    expect(empty.severity).toBe('error');
    expect(empty.message).toContain('apps/ghost');
    expect(empty.artifacts).toContain('.sdd/specs/demo/tasks.md');

    // Same spec, a boundary that the code shows (a directory and a file inside an observed dir).
    await writeSpec(dir, 'demo', {
      tasks: tasksWith(
        [
          '- [ ] 1.1 Implementar la creación — _Requirements: REQ-ORD-001_ — _Boundary:_ `src`, `src/new-file.ts`',
        ].join('\n'),
      ),
    });
    const covered = await checkConsistency({ cwd: dir, feature: 'demo', changedFiles: ['src/orders.ts'] });
    expect(covered.findings.some((finding) => finding.code === 'BOUNDARY_COVERS_NOTHING')).toBe(false);
    expect(covered.checked.some((item) => item.startsWith('fronteras declaradas contra el código'))).toBe(true);
  });

  it('warns, and declares it uninspected, when the spec declares no boundary at all', async () => {
    const dir = await makeTemp('open-sdd-consistency-noboundary-');
    await writeProject(dir);
    await writeSpec(dir, 'demo', {
      delta: deltaWith(
        [
          '### REQ-ORD-001 — Crear pedido',
          '- Statement: WHEN a request arrives, the service shall create an order.',
          '- Targets: src/orders.ts',
          '- Strangler: new',
        ].join('\n'),
      ),
      tasks: tasksWith('- [ ] 1.1 Implementar — _Requirements: REQ-ORD-001_'),
    });

    const report = await checkConsistency({ cwd: dir, feature: 'demo', changedFiles: ['src/orders.ts'] });

    expect(report.findings.some((finding) => finding.code === 'NO_DECLARED_BOUNDARY' && finding.severity === 'warning')).toBe(true);
    expect(report.notChecked.some((item) => /no declara ninguna _Boundary:_/.test(item))).toBe(true);
  });
});

describe('core/consistency — the constitutional pivot is reused, not re-implemented', () => {
  const CONSTITUTION = [
    '# Constitution — fixture',
    '',
    'Provenance: descriptive',
    '',
    '## Established facts',
    '- Lenguaje: TypeScript',
    '',
    '## Principles',
    '',
    '### C-STACK-FACT — El stack actual es un hecho establecido',
    '- Level: MUST',
    '- Threat: modernización silenciosa',
    '- Restriction: No sustituir el lenguaje TypeScript ni el gestor npm sin una enmienda gobernada.',
    '- Pattern: Construir sobre el stack declarado.',
    '- Justification: Impide la modernización silenciosa.',
    '- Provenance: descriptive',
    '- Evidence: package manager: npm',
    '',
  ].join('\n');

  it('reports a requirement that contradicts a principle in force', async () => {
    const dir = await makeTemp('open-sdd-consistency-pivot-');
    await writeProject(dir);
    await writeConstitution(dir, CONSTITUTION);
    await writeSpec(dir, 'demo', {
      requirements: [
        '# Requirements — demo',
        '',
        '### REQ-ORD-001 — Migración de gestor de paquetes',
        '- Statement: WHEN se despliegue, the service shall migrar de npm a yarn.',
        '',
      ].join('\n'),
      tasks: tasksWith('- [ ] 1.1 Migrar — _Requirements: REQ-ORD-001_ — _Boundary:_ `src`'),
    });

    const report = await checkConsistency({ cwd: dir, feature: 'demo', changedFiles: ['src/orders.ts'] });

    const contradiction = report.findings.find((finding) => finding.code === 'MUST_CONTRADICTED')!;
    expect(contradiction).toBeDefined();
    expect(contradiction.severity).toBe('error');
    expect(contradiction.message).toContain('C-STACK-FACT');
    expect(contradiction.artifacts).toContain('.sdd/specs/demo/requirements.md');
    expect(report.checked.some((item) => item.startsWith('pivote constitucional'))).toBe(true);
  });

  it('declares the pivot uninspected when there is no constitution in force', async () => {
    const dir = await makeTemp('open-sdd-consistency-noconstitution-');
    await writeProject(dir);
    await writeSpec(dir, 'demo', {
      requirements: ['# Requirements — demo', '', '### REQ-ORD-001 — Crear pedido', '- Statement: WHEN a request arrives, the service shall create an order.', ''].join('\n'),
      tasks: tasksWith('- [ ] 1.1 Implementar — _Requirements: REQ-ORD-001_ — _Boundary:_ `src`'),
    });

    const report = await checkConsistency({ cwd: dir, feature: 'demo' });

    expect(report.findings.some((finding) => finding.code === 'MUST_CONTRADICTED')).toBe(false);
    expect(report.notChecked.some((item) => /pivote constitucional: no existe .*constitution\.md/.test(item))).toBe(true);
    expect(report.checked.some((item) => item.startsWith('pivote constitucional'))).toBe(false);
  });
});

describe('core/consistency — honesty and the git boundary', () => {
  it('declares every check uninspected when the artifacts are absent', async () => {
    const dir = await makeTemp('open-sdd-consistency-nochanges-');
    await writeProject(dir);
    await writeSpec(dir, 'demo', {
      delta: deltaWith(
        [
          '### REQ-ORD-001 — Crear pedido',
          '- Statement: WHEN a request arrives, the service shall create an order.',
          '- Targets: src/orders.ts',
          '- Strangler: new',
        ].join('\n'),
      ),
      tasks: tasksWith('- [ ] 1.1 Implementar — _Requirements: REQ-ORD-001_ — _Boundary:_ `src`'),
    });

    const report = await checkConsistency({ cwd: dir, feature: 'demo', changedFiles: [] });

    expect(report.notChecked.some((item) => /no hay ficheros cambiados que analizar/.test(item))).toBe(true);
    expect(report.checked.some((item) => item.startsWith('objetivos de la delta'))).toBe(false);
    expect(report.complete).toBe(false);
  });

  it('derives the changed files from git when the caller does not supply them', async () => {
    const dir = await makeTemp('open-sdd-consistency-git-');
    await writeProject(dir);
    await writeSpec(dir, 'demo', {
      delta: deltaWith(
        [
          '### REQ-ORD-001 — Crear pedido',
          '- Statement: WHEN a request arrives, the service shall create an order.',
          '- Targets: src/orders.ts',
          '- Strangler: new',
        ].join('\n'),
      ),
      tasks: tasksWith('- [ ] 1.1 Implementar — _Requirements: REQ-ORD-001_ — _Boundary:_ `src`'),
    });
    git(dir, ['init', '-q']);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'fixture']);
    // A real modification that touches NONE of the delta targets.
    await writeText(dir, 'src/unrelated.ts', 'export const unrelated = (): string => "x";\n');

    const report = await checkConsistency({ cwd: dir, feature: 'demo' });

    expect(report.checked.some((item) => item.includes('árbol de trabajo e índice (git)'))).toBe(true);
    const untouched = report.findings.find((finding) => finding.code === 'DELTA_TARGET_UNTOUCHED')!;
    expect(untouched.severity).toBe('error');
    expect(untouched.message).toContain('REQ-ORD-001');
    expect(report.notChecked.some((item) => item.includes('git no está disponible'))).toBe(false);
  });

  it('reports a missing specification as an error instead of an empty pass', async () => {
    const dir = await makeTemp('open-sdd-consistency-missing-');
    await writeProject(dir);

    const report = await checkConsistency({ cwd: dir, feature: 'ghost' });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]!.code).toBe('FEATURE_NOT_FOUND');
    expect(report.findings[0]!.severity).toBe('error');
    expect(report.checked).toEqual([]);
    expect(report.notChecked).toHaveLength(5);
    expect(report.complete).toBe(false);
  });
});

describe('cli/brownfield analyze', () => {
  it('exits 1 on an error finding and prints checked/notChecked honestly', async () => {
    const dir = await makeTemp('open-sdd-analyze-cli-');
    await writeProject(dir);
    await writeSpec(dir, 'demo', {
      delta: deltaWith(
        [
          '### REQ-ORD-001 — Crear pedido',
          '- Statement: WHEN a request arrives, the service shall create an order.',
          '- Targets: src/orders.ts',
          '- Strangler: new',
        ].join('\n'),
      ),
      tasks: tasksWith('- [ ] 1.1 Implementar otra cosa — _Requirements: REQ-GHOST-999_ — _Boundary:_ `src`'),
    });
    const { io, logs, errors } = makeIO();

    const code = await handleBrownfieldCommand(['analyze', 'demo'], io, dir);

    expect(code).toBe(1);
    expect(errors).toEqual([]);
    const output = logs.join('\n');
    expect(output).toContain('Consistencia cruzada');
    expect(output).toContain('PHANTOM_REQUIREMENT_ID');
    expect(output).toContain('NO comprobado');
  });

  it('exits 0 when nothing inspected is inconsistent, even with checks left uninspected', async () => {
    const dir = await makeTemp('open-sdd-analyze-clean-');
    await writeProject(dir, { test: true });
    await writeSpec(dir, 'demo', {
      delta: `# Delta: demo — Cambio limpio

Status: proposed

## ADDED

### REQ-ORD-001 — Crear pedido
- Statement: WHEN a request arrives, the service shall create an order.
- Targets: src/orders.ts
- Contracts: test/orders.test.ts
- Strangler: new

## MODIFIED

## REMOVED

## RENAMED
`,
      tasks: tasksWith('- [ ] 1.1 Implementar — _Requirements: REQ-ORD-001_ — _Boundary:_ `src`'),
    });
    const { io, logs } = makeIO();

    const code = await handleBrownfieldCommand(['analyze', 'demo', '--json'], io, dir);

    expect(code).toBe(0);
    const report = JSON.parse(logs.join('\n'));
    expect(report.findings.filter((finding: { severity: string }) => finding.severity === 'error')).toEqual([]);
    expect(report.notChecked.length).toBeGreaterThan(0);
  });

  it('reports a nonexistent feature as an error finding, and with no feature at all fails fast', async () => {
    const dir = await makeTemp('open-sdd-analyze-nofeature-');
    await writeProject(dir);
    const { io, logs, errors } = makeIO();

    const code = await handleBrownfieldCommand(['analyze', 'ghost'], io, dir);

    expect(code).toBe(1);
    expect(logs.join('\n')).toContain('FEATURE_NOT_FOUND');

    const empty = await makeTemp('open-sdd-analyze-nospec-');
    const second = makeIO();
    const secondCode = await handleBrownfieldCommand(['analyze'], second.io, empty);

    expect(secondCode).toBe(1);
    expect(second.errors.join('\n')).toMatch(/No hay especificación que analizar/);
  });
});
