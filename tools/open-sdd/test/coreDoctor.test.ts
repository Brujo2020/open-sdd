/**
 * `open-sdd doctor` — autodiagnóstico.
 *
 * Fixtures en `mkdtemp` con `git init` cuando el hook importa; todo se limpia en `afterEach` y NADA
 * se escribe dentro del repositorio. Las dos decisiones que estos tests fijan, y que están
 * documentadas en `doctor.ts`:
 *
 *   · hook DESACTUALIZADO (nuestro, pero distinto de la plantilla vigente) → `warn`, no `fail`:
 *     el gate existe y corre, solo está viejo.
 *   · hook AUSENTE o AJENO → `fail`: no hay gate.
 *   · comprobación IMPOSIBLE (sin repositorio git, sin hook) → `warn` con «no se pudo comprobar».
 */

import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleDoctorCommand,
  renderDoctor,
  resolveCliExecutable,
  runDoctor,
  satisfiesRange,
  type DoctorCheck,
  type DoctorReport,
} from '../src/core/doctor.js';
import { resolveRigorSettings } from '../src/core/rigor.js';
import { parseConstitution, renderConstitution } from '../src/core/constitution.js';
import { buildDescriptiveConstitution, collectRepoFacts } from '../src/core/reverseConstitution.js';
import { scanProject } from '../src/core/reverseEngineering.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const shippedHookPath = path.resolve(here, '..', 'templates', 'hooks', 'pre-commit');
const shippedPortableHookPath = path.resolve(here, '..', 'templates', 'hooks', 'pre-commit.mjs');
const shippedTemplateContents = async (): Promise<string[]> =>
  Promise.all(
    [shippedPortableHookPath, shippedHookPath].map((candidate) => readFile(candidate, 'utf8').catch(() => '')),
  );

const tempDirs: string[] = [];

const makeRoot = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-doctor-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

const exists = async (p: string): Promise<boolean> => (await stat(p).catch(() => null)) !== null;

const makeIO = () => {
  const logs: string[] = [];
  const errs: string[] = [];
  return {
    io: {
      log: (message: string) => logs.push(message),
      error: (message: string) => errs.push(message),
      exit: () => undefined,
    },
    text: () => `${logs.join('\n')}\n${errs.join('\n')}`,
  };
};

const gitInit = async (dir: string): Promise<void> => {
  const result = spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' });
  expect(result.status, `git init falló: ${result.stderr}`).toBe(0);
};

const installHook = async (dir: string, content?: string, mode = 0o755): Promise<void> => {
  const hooks = path.join(dir, '.git', 'hooks');
  await mkdir(hooks, { recursive: true });
  const target = path.join(hooks, 'pre-commit');
  await writeFile(target, content ?? (await readFile(shippedHookPath, 'utf8')), 'utf8');
  await chmod(target, mode);
};

const check = (report: DoctorReport, id: string): DoctorCheck => {
  const found = report.checks.find((item) => item.id === id);
  expect(found, `no existe la comprobación ${id}`).toBeDefined();
  return found as DoctorCheck;
};

/** Fixture con código: es lo que da principios a la constitución descriptiva. */
const writeCodeFixture = async (dir: string, engines?: Record<string, string>): Promise<void> => {
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await mkdir(path.join(dir, 'test'), { recursive: true });
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'acme-orders',
        version: '1.0.0',
        ...(engines ? { engines } : {}),
        dependencies: { express: '^4.0.0' },
        devDependencies: { vitest: '^4.0.0' },
        scripts: { test: 'vitest run' },
      },
      null,
      2,
    ),
    'utf8',
  );
  await writeFile(path.join(dir, 'src', 'index.ts'), "export const hello = (): string => 'hola';\n", 'utf8');
  await writeFile(
    path.join(dir, 'test', 'index.test.ts'),
    "import { hello } from '../src/index.js';\ntest('hola', () => expect(hello()).toBe('hola'));\n",
    'utf8',
  );
};

const writeValidConstitution = async (dir: string): Promise<string> => {
  const project = await scanProject(dir);
  const facts = await collectRepoFacts(dir, project);
  const { constitution } = buildDescriptiveConstitution(facts);
  const rendered = `${renderConstitution(constitution)}\n`;
  await mkdir(path.join(dir, '.sdd', 'steering'), { recursive: true });
  await writeFile(path.join(dir, '.sdd', 'steering', 'constitution.md'), rendered, 'utf8');
  return rendered;
};

const writeRigor = async (dir: string, body: Record<string, unknown>): Promise<string> => {
  await mkdir(path.join(dir, '.sdd', 'settings'), { recursive: true });
  const raw = `${JSON.stringify(body, null, 2)}\n`;
  await writeFile(path.join(dir, '.sdd', 'settings', 'rigor.json'), raw, 'utf8');
  return raw;
};

const VALID_RIGOR = { level: 'spec-first', rationale: 'nivel por defecto del proyecto, con motivo declarado', brownfield: false };

describe('doctor — forma del informe', () => {
  it('emite las nueve comprobaciones con estado válido y recuentos coherentes', async () => {
    const dir = await makeRoot();
    const report = await runDoctor(dir);

    expect(report.checks.map((item) => item.id)).toEqual([
      'node',
      'cli',
      'hook',
      'hook-portability',
      'settings',
      'constitution',
      'specs',
      'model-offline',
      'environment',
    ]);
    for (const item of report.checks) {
      expect(['ok', 'warn', 'fail']).toContain(item.status);
      expect(item.detail.length).toBeGreaterThan(0);
      // Incondicional a propósito: la forma `if (status !== 'ok') expect(fix)` sólo comprueba algo
      // cuando existe un check no-ok, y sin esa precondición afirmada el test puede pasar sin mirar.
      expect(item.fix !== undefined || item.status === 'ok', `${item.id} sin fix`).toBe(true);
    }
    expect(report.counts.ok + report.counts.warn + report.counts.fail).toBe(report.checks.length);
    expect(report.ok).toBe(report.counts.fail === 0);
  });

  it('cualquier `fail` deja ok en false; los avisos no lo rompen', async () => {
    const dir = await makeRoot();
    const withFail = await runDoctor(dir);
    expect(check(withFail, 'settings').status).toBe('fail');
    expect(withFail.ok).toBe(false);
  });

  it('renderDoctor devuelve líneas con estado y la reparación concreta', async () => {
    const dir = await makeRoot();
    const report = await runDoctor(dir);
    const lines = renderDoctor(report);

    expect(lines[0]).toContain('Diagnóstico de');
    expect(lines.join('\n')).toContain('[fail]');
    expect(lines.join('\n')).toMatch(/fix: .*open-sdd/);
    expect(lines.join('\n')).toContain('Corrige');
  });

  it('renderDoctor no emite ANSI (el JSON y el render quedan planos)', async () => {
    const dir = await makeRoot();
    const lines = renderDoctor(await runDoctor(dir));
    // eslint-disable-next-line no-control-regex
    expect(lines.join('\n')).not.toMatch(/\u001b\[/);
  });
});

describe('doctor — versión de Node', () => {
  it('acepta el rango declarado en engines', async () => {
    const dir = await makeRoot();
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', engines: { node: '>=18' } }), 'utf8');
    const item = check(await runDoctor(dir), 'node');
    expect(item.status).toBe('ok');
    expect(item.detail).toContain('>=18');
  });

  it('falla cuando la versión en uso NO cumple el rango declarado', async () => {
    const dir = await makeRoot();
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', engines: { node: '>=99' } }), 'utf8');
    const item = check(await runDoctor(dir), 'node');
    expect(item.status).toBe('fail');
    expect(item.fix).toContain('Node');
  });

  it('sin ningún manifiesto que declare el rango, dice qué asumió y NO aprueba en silencio', async () => {
    const dir = await makeRoot();
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'x' }), 'utf8');
    // Seam de testabilidad: sin manifiestos, la rama «no hay rango declarado» es alcanzable.
    const item = check(await runDoctor(dir, { manifestPaths: [] }), 'node');
    expect(item.status).toBe('warn');
    expect(item.detail).toContain('no se pudo comprobar');
    expect(item.detail).toContain('Se asumió');
    expect(item.fix).toBeDefined();
  });

  it('satisfiesRange entiende rangos usuales y devuelve null ante sintaxis no soportada', () => {
    expect(satisfiesRange('26.7.0', '>=20')).toBe(true);
    expect(satisfiesRange('18.0.0', '>=20')).toBe(false);
    expect(satisfiesRange('20.1.0', '^20.0.0')).toBe(true);
    expect(satisfiesRange('21.0.0', '^20.0.0')).toBe(false);
    expect(satisfiesRange('20.0.5', '~20.0.0')).toBe(true);
    expect(satisfiesRange('20.2.0', '~20.0.0')).toBe(false);
    expect(satisfiesRange('19.0.0', '>=18 <21')).toBe(true);
    expect(satisfiesRange('22.0.0', '>=18 <21')).toBe(false);
    expect(satisfiesRange('22.0.0', '18 || 22')).toBe(true);
    expect(satisfiesRange('22.0.0', '>=abc')).toBeNull();
  });
});

describe('doctor — CLI alcanzable', () => {
  it('encuentra el CLI del propio repositorio y reporta una versión no placeholder', async () => {
    const dir = await makeRoot();
    const item = check(await runDoctor(dir), 'cli');
    expect(item.status).toBe('ok');
    expect(item.detail).toMatch(/reporta la versión \d+\.\d+\.\d+/);
  });

  it('resolveCliExecutable fija el CLI del repositorio: nunca resuelve por PATH', async () => {
    const dir = await makeRoot();
    const cli = await resolveCliExecutable(dir);
    expect(cli).not.toBeNull();
    expect(await exists(cli as string)).toBe(true);
    // Resolver por PATH encontraría una instalación global ajena (v2.0.0 en esta máquina), cuyo
    // baseline de seguridad es distinto: la sonda y el hook deben usar SIEMPRE este artefacto.
    expect(cli as string).toContain(path.join('tools', 'open-sdd', 'dist', 'cli.js'));
    expect(path.isAbsolute(cli as string)).toBe(true);
  });
});

describe('doctor — hook de commit', () => {
  it('hook ausente en un repositorio git → fail con fix ejecutable', async () => {
    const dir = await makeRoot();
    await gitInit(dir);
    const item = check(await runDoctor(dir), 'hook');
    expect(item.status).toBe('fail');
    expect(item.fix).toContain('open-sdd floor install');
    expect(item.detail).toContain('no está instalado');
  });

  it('hook instalado pero DESACTUALIZADO → warn (decisión documentada) con fix', async () => {
    const dir = await makeRoot();
    await gitInit(dir);
    await installHook(dir, `${await readFile(shippedHookPath, 'utf8')}\n# ajuste local antiguo\n`);
    const report = await runDoctor(dir);
    const item = check(report, 'hook');
    expect(item.status).toBe('warn');
    expect(item.detail).toContain('DESACTUALIZADO');
    expect(item.fix).toContain('open-sdd floor install');
    // Un hook desactualizado NO se cuenta como fallo: el gate existe y corre, solo está viejo.
    expect(report.checks.filter((entry) => entry.status === 'fail').map((entry) => entry.id)).not.toContain('hook');
  });

  it('hook ajeno (no es nuestro) → fail: el gate no está en vigor', async () => {
    const dir = await makeRoot();
    await gitInit(dir);
    await installHook(dir, '#!/bin/sh\necho "hook propio del equipo"\n');
    const item = check(await runDoctor(dir), 'hook');
    expect(item.status).toBe('fail');
    expect(item.detail).toContain('ajeno');
    expect(item.fix).toContain('--force');
  });

  it('hook instalado, ejecutable e idéntico a la plantilla → ok', async () => {
    const dir = await makeRoot();
    await gitInit(dir);
    await installHook(dir);
    const item = check(await runDoctor(dir), 'hook');
    expect(item.status).toBe('ok');
    expect(item.detail).toContain('idéntico a la plantilla vigente');
  });

  it('respeta core.hooksPath: acepta el hook en el directorio que git resuelve y dice cuál es', async () => {
    const dir = await makeRoot();
    await gitInit(dir);
    const configured = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: dir, encoding: 'utf8' });
    expect(configured.status).toBe(0);
    await mkdir(path.join(dir, '.githooks'), { recursive: true });
    const portable = await readFile(shippedPortableHookPath, 'utf8').catch(() => null);
    const content = portable ?? (await readFile(shippedHookPath, 'utf8'));
    await writeFile(path.join(dir, '.githooks', 'pre-commit'), content, 'utf8');
    await chmod(path.join(dir, '.githooks', 'pre-commit'), 0o755);

    const item = check(await runDoctor(dir), 'hook');

    expect(item.status).toBe('ok');
    // The doctor names the hook path it accepted, built with `path.relative`: the separator is the
    // platform's, so the expectation is built the same way.
    expect(item.detail).toContain(path.join('.githooks', 'pre-commit'));
    expect(item.detail).toContain('core.hooksPath=');
    // El .git/hooks del repositorio sigue vacío: reportar «no instalado» habría sido un falso fallo.
    expect(await exists(path.join(dir, '.git', 'hooks', 'pre-commit'))).toBe(false);
  });

  it('--fix no sobrescribe un hook ajeno ni siquiera cuando el directorio lo fija core.hooksPath', async () => {
    const dir = await makeRoot();
    await gitInit(dir);
    spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: dir, encoding: 'utf8' });
    await mkdir(path.join(dir, '.githooks'), { recursive: true });
    const foreign = '#!/bin/sh\necho "gate del equipo"\n';
    await writeFile(path.join(dir, '.githooks', 'pre-commit'), foreign, 'utf8');
    await chmod(path.join(dir, '.githooks', 'pre-commit'), 0o755);

    const ctx = makeIO();
    const code = await handleDoctorCommand(['--fix'], ctx.io, dir);

    expect(code).toBe(1);
    expect(await readFile(path.join(dir, '.githooks', 'pre-commit'), 'utf8')).toBe(foreign);
    expect(ctx.text()).toContain('ajeno');
  });

  it('reconoce como vigente el gate PORTÁTIL (pre-commit.mjs), no solo el POSIX', async () => {
    const dir = await makeRoot();
    await gitInit(dir);
    const portable = await readFile(shippedPortableHookPath, 'utf8').catch(() => null);
    if (portable === null) return; // instalación antigua sin la plantilla portátil
    await installHook(dir, portable);

    const report = await runDoctor(dir);
    expect(check(report, 'hook').status).toBe('ok');
    expect(check(report, 'hook').detail).toContain('pre-commit.mjs');
    // Y no depende de un shell POSIX: es justo el bloqueo de Windows que el gate portátil elimina.
    expect(check(report, 'hook-portability').detail).not.toContain('depende de un shell POSIX');
  });

  it.skipIf(process.platform === 'win32')('hook no ejecutable → fail con el chmod exacto', async () => {
    const dir = await makeRoot();
    await gitInit(dir);
    await installHook(dir, undefined, 0o644);
    const item = check(await runDoctor(dir), 'hook');
    expect(item.status).toBe('fail');
    expect(item.detail).toContain('NO es ejecutable');
    expect(item.fix).toContain('chmod +x');
  });

  it('sin repositorio git → warn con "no se pudo comprobar" (nunca un pase silencioso)', async () => {
    const dir = await makeRoot();
    const item = check(await runDoctor(dir), 'hook');
    expect(item.status).toBe('warn');
    expect(item.detail).toContain('no se pudo comprobar');
  });

  it('portabilidad: informa de la dependencia de shell POSIX y, en Windows, de `sh`', async () => {
    const dir = await makeRoot();
    await gitInit(dir);
    await installHook(dir);

    const native = check(await runDoctor(dir), 'hook-portability');
    expect(native.status).toBe('ok');
    expect(native.detail).toContain('shell POSIX');

    const windows = check(await runDoctor(dir, { platform: 'win32' }), 'hook-portability');
    expect(windows.detail).toContain('Windows');
    expect(['ok', 'fail']).toContain(windows.status);
  });

  it('portabilidad sin hook instalado → warn "no se pudo comprobar"', async () => {
    const dir = await makeRoot();
    await gitInit(dir);
    const item = check(await runDoctor(dir), 'hook-portability');
    expect(item.status).toBe('warn');
    expect(item.detail).toContain('no se pudo comprobar');
  });
});

describe('doctor — rigor declarado', () => {
  it('sin rigor.json → fail con fix', async () => {
    const dir = await makeRoot();
    const item = check(await runDoctor(dir), 'settings');
    expect(item.status).toBe('fail');
    expect(item.fix).toContain('open-sdd init');
  });

  it('JSON ilegible o no parseable → fail, sin lanzar excepción', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.sdd', 'settings'), { recursive: true });
    await writeFile(path.join(dir, '.sdd', 'settings', 'rigor.json'), '{esto no es json', 'utf8');

    const report = await runDoctor(dir);
    const item = check(report, 'settings');
    expect(item.status).toBe('fail');
    expect(item.detail).toContain('no es JSON válido');
    expect(item.fix).toBeDefined();

    // Un directorio donde se espera un archivo también se reporta, no revienta.
    const other = await makeRoot();
    await mkdir(path.join(other, '.sdd', 'settings', 'rigor.json'), { recursive: true });
    const report2 = await runDoctor(other);
    expect(check(report2, 'settings').status).toBe('fail');
  });

  it('nivel inválido → fail; rationale vacío → fail', async () => {
    const dir = await makeRoot();
    await writeRigor(dir, { level: 'spec-ultra', rationale: 'algo' });
    expect(check(await runDoctor(dir), 'settings').status).toBe('fail');

    const other = await makeRoot();
    await writeRigor(other, { level: 'spec-first', rationale: '   ' });
    const item = check(await runDoctor(other), 'settings');
    expect(item.status).toBe('fail');
    expect(item.detail).toContain('rationale');
  });

  it('rigor válido → ok, informando nivel, gates y rationale', async () => {
    const dir = await makeRoot();
    await writeRigor(dir, { level: 'spec-anchored', rationale: 'spec viva con trazabilidad y evidencia por cambio' });
    const item = check(await runDoctor(dir), 'settings');
    expect(item.status).toBe('ok');
    expect(item.detail).toContain('spec-anchored');
    expect(item.detail).toContain('C1, C2, C3, C6');
  });

  it('respeta --sdd-dir en lugar del .sdd por defecto', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.kiro', 'settings'), { recursive: true });
    await writeFile(
      path.join(dir, '.kiro', 'settings', 'rigor.json'),
      JSON.stringify({ level: 'spec-first', rationale: 'declarado en el directorio heredado' }),
      'utf8',
    );
    const item = check(await runDoctor(dir, { sddDir: '.kiro' }), 'settings');
    expect(item.status).toBe('ok');
  });
});

describe('doctor — constitución', () => {
  it('ausente → fail con fix que nombra el comando existente', async () => {
    const dir = await makeRoot();
    const item = check(await runDoctor(dir), 'constitution');
    expect(item.status).toBe('fail');
    expect(item.fix).toContain('brownfield constitution');
  });

  it('presente pero inválida → fail con los errores citados', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.sdd', 'steering'), { recursive: true });
    await writeFile(
      path.join(dir, '.sdd', 'steering', 'constitution.md'),
      `# Constitution — fixture

Provenance: descriptive

## Principles

### C-BAD — regla sin amenaza
- Level: MUST
- Restriction: algo prohibido
- Pattern: cómo cumplirlo
- Justification: una razón suficientemente larga como para no ser un eslogan de una sola línea.
- Provenance: descriptive
- Evidence: package.json
`,
      'utf8',
    );
    const item = check(await runDoctor(dir), 'constitution');
    expect(item.status).toBe('fail');
    expect(item.detail).toContain('inválida');
  });

  it('válida en forma pero sin principios en vigor → fail (no hay autoridad citable)', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.sdd', 'steering'), { recursive: true });
    await writeFile(
      path.join(dir, '.sdd', 'steering', 'constitution.md'),
      '# Constitution — fixture\n\nProvenance: descriptive\n\n## Principles\n',
      'utf8',
    );
    const item = check(await runDoctor(dir), 'constitution');
    expect(item.status).toBe('fail');
    expect(item.detail).toContain('sin principios en vigor');
  });

  it('válida con principios y enmiendas → ok, y las cuenta', async () => {
    const dir = await makeRoot();
    await writeCodeFixture(dir);
    const rendered = await writeValidConstitution(dir);
    const item = check(await runDoctor(dir), 'constitution');
    expect(item.status).toBe('ok');
    expect(item.detail).toMatch(/\d+ principio\(s\) en vigor/);
    expect(item.detail).toContain('enmienda');
    // La fixture es válida de verdad: el veredicto de doctor no es un falso aprobado.
    expect(parseConstitution(rendered).principles.length).toBeGreaterThan(0);
  });
});

describe('doctor — especificaciones', () => {
  it('sin especificaciones → ok (no hay tríada que comprobar)', async () => {
    const dir = await makeRoot();
    const item = check(await runDoctor(dir), 'specs');
    expect(item.status).toBe('ok');
    expect(item.detail).toContain('No hay especificaciones');
  });

  it('tríada incompleta → warn y nombra lo que falta', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.sdd', 'specs', 'alpha'), { recursive: true });
    await writeFile(path.join(dir, '.sdd', 'specs', 'alpha', 'requirements.md'), '# Req\n', 'utf8');
    const item = check(await runDoctor(dir), 'specs');
    expect(item.status).toBe('warn');
    expect(item.detail).toContain('plan.md');
    expect(item.detail).toContain('tasks.md');
  });

  it('tríada completa (con design.md como alias declarado) → ok', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.sdd', 'specs', 'alpha'), { recursive: true });
    for (const name of ['requirements.md', 'design.md', 'tasks.md']) {
      await writeFile(path.join(dir, '.sdd', 'specs', 'alpha', name), `# ${name}\n`, 'utf8');
    }
    const item = check(await runDoctor(dir), 'specs');
    expect(item.status).toBe('ok');
    expect(item.detail).toContain('alpha');
  });
});

describe('doctor — postura sin modelo y entorno', () => {
  it('no requiere modelo ni red: es una comprobación positiva', async () => {
    const dir = await makeRoot();
    const item = check(await runDoctor(dir), 'model-offline');
    expect(item.status).toBe('ok');
    expect(item.detail).toContain('No se requiere backend de modelo ni acceso a red');
    // Sin arreglo: no hay nada que reparar.
    expect(item.fix).toBeUndefined();
  });

  it('detecta git y la raíz del repositorio; sin repo lo reporta como warn', async () => {
    const repo = await makeRoot();
    await gitInit(repo);
    const ok = check(await runDoctor(repo), 'environment');
    expect(ok.status).toBe('ok');
    expect(ok.detail).toContain('raíz del repositorio resoluble');

    const loose = await makeRoot();
    const warn = check(await runDoctor(loose), 'environment');
    expect(warn.status).toBe('warn');
    expect(warn.detail).toContain('no se pudo comprobar');
  });
});

describe('doctor — instalación completa', () => {
  it('settings + constitución válidos y hook vigente → ok: true sin fallos', async () => {
    const dir = await makeRoot();
    await writeCodeFixture(dir, { node: '>=18' });
    await gitInit(dir);
    await installHook(dir);
    await writeValidConstitution(dir);
    await writeRigor(dir, VALID_RIGOR);

    const report = await runDoctor(dir);

    expect(check(report, 'settings').status).toBe('ok');
    expect(check(report, 'constitution').status).toBe('ok');
    expect(check(report, 'hook').status).toBe('ok');
    expect(check(report, 'node').status).toBe('ok');
    expect(report.counts.fail).toBe(0);
    expect(report.ok).toBe(true);
  });
});

describe('doctor --fix', () => {
  it.skipIf(process.platform === 'win32')('crea el rigor ausente y reinstala el hook, diciendo qué hizo', async () => {
    const dir = await makeRoot();
    await gitInit(dir);
    const ctx = makeIO();

    const before = await runDoctor(dir);
    expect(check(before, 'settings').status).toBe('fail');
    expect(check(before, 'hook').status).toBe('fail');

    const code = await handleDoctorCommand(['--fix'], ctx.io, dir);

    // La constitución sigue ausente: un fallo que --fix no debe inventar ni ocultar.
    expect(code).toBe(1);
    const settingsRaw = await readFile(path.join(dir, '.sdd', 'settings', 'rigor.json'), 'utf8');
    expect(() => resolveRigorSettings(JSON.parse(settingsRaw) as never)).not.toThrow();
    expect(JSON.parse(settingsRaw).rationale.trim().length).toBeGreaterThan(0);

    const hook = path.join(dir, '.git', 'hooks', 'pre-commit');
    const installed = await readFile(hook, 'utf8');
    expect(installed).toContain('open-sdd');
    // Exactamente una de las plantillas embarcadas: --fix instala la preferida (portátil si existe).
    expect(await shippedTemplateContents()).toContain(installed);
    expect((await stat(hook)).mode & 0o111).not.toBe(0);
    expect(check(await runDoctor(dir), 'hook').status).toBe('ok');

    expect(ctx.text()).toContain('creado .sdd/settings/rigor.json');
    expect(ctx.text()).toContain('reinstalado el hook de commit');
    expect(ctx.text()).toContain('Reparaciones de --fix');
  });

  it('NUNCA sobrescribe un rigor.json existente y es idempotente', async () => {
    const dir = await makeRoot();
    await writeCodeFixture(dir, { node: '>=18' });
    await gitInit(dir);
    await writeValidConstitution(dir);
    const edited = await writeRigor(dir, {
      level: 'spec-as-source',
      rationale: 'decisión del equipo: pagos auditados y reversibles solo por spec',
      brownfield: true,
    });

    const ctx = makeIO();
    const code = await handleDoctorCommand(['--fix'], ctx.io, dir);

    expect(code).toBe(0);
    expect(await readFile(path.join(dir, '.sdd', 'settings', 'rigor.json'), 'utf8')).toBe(edited);
    expect(ctx.text()).toContain('ya existe: se conserva sin tocar');

    // Y una segunda pasada no cambia nada.
    const second = makeIO();
    expect(await handleDoctorCommand(['--fix'], second.io, dir)).toBe(0);
    expect(await readFile(path.join(dir, '.sdd', 'settings', 'rigor.json'), 'utf8')).toBe(edited);
  });

  it('no toca un hook ajeno: lo reporta con el comando que lo reemplazaría', async () => {
    const dir = await makeRoot();
    await gitInit(dir);
    const foreign = '#!/bin/sh\necho "hook propio del equipo"\n';
    await installHook(dir, foreign);

    const ctx = makeIO();
    const code = await handleDoctorCommand(['--fix'], ctx.io, dir);

    expect(code).toBe(1);
    expect(await readFile(path.join(dir, '.git', 'hooks', 'pre-commit'), 'utf8')).toBe(foreign);
    expect(ctx.text()).toContain('ajeno');
    expect(ctx.text()).toContain('--force');
  });

  it('no reescribe un rigor.json roto (solo crea el ausente)', async () => {
    const dir = await makeRoot();
    await gitInit(dir);
    const broken = '{roto';
    await mkdir(path.join(dir, '.sdd', 'settings'), { recursive: true });
    await writeFile(path.join(dir, '.sdd', 'settings', 'rigor.json'), broken, 'utf8');

    const ctx = makeIO();
    expect(await handleDoctorCommand(['--fix'], ctx.io, dir)).toBe(1);

    expect(await readFile(path.join(dir, '.sdd', 'settings', 'rigor.json'), 'utf8')).toBe(broken);
    expect(ctx.text()).toContain('ya existe: se conserva sin tocar');
  });
});

describe('doctor — salida CLI', () => {
  it('--json es JSON parseable con checks, counts y ok', async () => {
    const dir = await makeRoot();
    await gitInit(dir);
    const ctx = makeIO();

    const code = await handleDoctorCommand(['--json'], ctx.io, dir);

    const report = JSON.parse(ctx.text()) as DoctorReport & { fixes: string[] };
    expect(typeof report.ok).toBe('boolean');
    expect(report.checks).toHaveLength(9);
    expect(report.counts.fail).toBeGreaterThan(0);
    expect(Array.isArray(report.fixes)).toBe(true);
    expect(code).toBe(1);
  });

  it('--json con --fix incluye las reparaciones realizadas', async () => {
    const dir = await makeRoot();
    await gitInit(dir);
    const ctx = makeIO();

    await handleDoctorCommand(['--json', '--fix'], ctx.io, dir);

    const report = JSON.parse(ctx.text()) as { fixes: string[] };
    expect(report.fixes.join('\n')).toContain('creado .sdd/settings/rigor.json');
  });

  it('sin fallos, sale con 0', async () => {
    const dir = await makeRoot();
    await writeCodeFixture(dir, { node: '>=18' });
    await gitInit(dir);
    await installHook(dir);
    await writeValidConstitution(dir);
    await writeRigor(dir, VALID_RIGOR);
    const ctx = makeIO();

    const code = await handleDoctorCommand([], ctx.io, dir);

    expect(code).toBe(0);
    expect(ctx.text()).toContain('sin fallos');
  });
});
