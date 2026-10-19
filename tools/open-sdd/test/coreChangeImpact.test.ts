import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analyzeChangeImpact } from '../src/core/changeImpact.js';
import type { DeltaSpec } from '../src/core/deltaSpec.js';

const temps: string[] = [];

const makeTemp = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const write = async (root: string, rel: string, content: string): Promise<void> => {
  const full = path.join(root, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
};

const baseManifest = async (root: string): Promise<void> => {
  await write(root, 'package.json', JSON.stringify({ name: 'impact-fixture', devDependencies: { typescript: '^5', vitest: '^4' } }, null, 2));
};

/** Comando git dentro del fixture, con identidad local para que `commit` no dependa del entorno. */
const gitFixture = (root: string, args: string[]): void => {
  execFileSync('git', ['-c', 'user.email=fixture@example.test', '-c', 'user.name=Fixture', ...args], {
    cwd: root,
    stdio: 'pipe',
  });
};

/** Repositorio con todo lo escrito hasta ahora como revisión anterior (`HEAD`). */
const commitFixture = (root: string): void => {
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'pipe' });
  gitFixture(root, ['commit', '-q', '-m', 'fixture']);
};

const deltaOf = (entries: DeltaSpec['entries']): DeltaSpec => ({
  feature: 'auth-change',
  title: 'Cambio de autenticación',
  status: 'proposed',
  entries,
});

describe('analyzeChangeImpact — grafo de dependencias', () => {
  it('recorre los importadores transitivamente y mide el radio de impacto', async () => {
    const root = await makeTemp('open-sdd-impact-');
    await baseManifest(root);
    await write(root, 'src/a.ts', 'export const a = 1;\n');
    await write(root, 'src/b.ts', "import { a } from './a.js';\nexport const b = a;\n");
    await write(root, 'src/c.ts', "import { b } from './b.js';\nexport const c = b;\n");
    await write(root, 'src/d.ts', "import { c } from './c.js';\nexport const d = c;\n");

    const report = await analyzeChangeImpact({ cwd: root, changedFiles: ['src/a.ts'] });

    expect(report.complete).toBe(true);
    expect(report.dependents.map((d) => d.file)).toEqual(['src/b.ts', 'src/c.ts', 'src/d.ts']);
    expect(report.dependents[0].imports).toEqual(['src/a.ts']);
    expect(report.dependents[2].imports).toEqual(['src/c.ts']);
    // Radio = ficheros alcanzados distintos, sin contar el fichero cambiado (semilla).
    expect(report.blastRadius).toBe(3);
    expect(report.findings.some((f) => f.area === 'dependencies' && f.message.includes('radio de impacto'))).toBe(true);
  });

  it('respeta maxDepth al caminar hacia arriba', async () => {
    const root = await makeTemp('open-sdd-impact-depth-');
    await baseManifest(root);
    await write(root, 'src/a.ts', 'export const a = 1;\n');
    await write(root, 'src/b.ts', "import { a } from './a.js';\n");
    await write(root, 'src/c.ts', "import { b } from './b.js';\n");

    const shallow = await analyzeChangeImpact({ cwd: root, changedFiles: ['src/a.ts'], maxDepth: 1 });
    expect(shallow.blastRadius).toBe(1);
    expect(shallow.dependents.map((d) => d.file)).toEqual(['src/b.ts']);

    const deep = await analyzeChangeImpact({ cwd: root, changedFiles: ['src/a.ts'], maxDepth: 3 });
    expect(deep.blastRadius).toBe(2);
  });

  it('no inventa un radio pequeño cuando los directorios de fuente no se pueden leer', async () => {
    const root = await makeTemp('open-sdd-impact-broken-');
    await baseManifest(root);
    // `src` existe, pero es un fichero: el recorrido del grafo no puede ejecutarse.
    await writeFile(path.join(root, 'src'), 'esto es un fichero, no un directorio\n', 'utf8');

    const report = await analyzeChangeImpact({ cwd: root, changedFiles: ['src/a.ts'] });

    expect(report.complete).toBe(false);
    expect(report.findings.some((f) => f.severity === 'warning' && f.message.includes('No se pudo leer'))).toBe(true);
    expect(report.detail).toContain('Análisis incompleto');
  });

  it('marca completo:false cuando no hay ningún directorio de fuente que recorrer', async () => {
    const missing = path.join(tmpdir(), `open-sdd-impact-missing-${Date.now()}`);
    const report = await analyzeChangeImpact({ cwd: missing, changedFiles: ['src/a.ts'] });

    expect(report.complete).toBe(false);
    expect(report.findings.some((f) => f.message.includes('ningún directorio de código fuente'))).toBe(true);
  });
});

describe('analyzeChangeImpact — cambios incompatibles', () => {
  it('detecta como error una exportación anterior que ya no existe', async () => {
    const root = await makeTemp('open-sdd-impact-breaking-');
    await baseManifest(root);
    await write(root, 'src/core/util.ts', 'export const keepMe = 1;\nexport const parseThing = 2;\n');

    const report = await analyzeChangeImpact({
      cwd: root,
      changedFiles: ['src/core/util.ts'],
      previousExports: [{ file: 'src/core/util.ts', symbols: ['keepMe', 'removedThing'] }],
    });

    expect(report.breakingChanges).toEqual([
      { file: 'src/core/util.ts', symbol: 'removedThing', reason: expect.any(String) },
    ]);
    const error = report.findings.find((f) => f.area === 'breaking' && f.severity === 'error');
    expect(error).toBeDefined();
    expect(error!.artifacts).toContain('removedThing');
    expect(error!.message).toContain('incompatible');
  });

  it('no confunde «declarado sin export» con «sigue siendo exportado»', async () => {
    const root = await makeTemp('open-sdd-impact-export-');
    await baseManifest(root);
    // `dropped` sigue en el fichero, pero ya no se exporta: el cambio es incompatible igualmente.
    await write(root, 'src/core/util.ts', 'const dropped = 1;\nexport const survived = 2;\n');

    const report = await analyzeChangeImpact({
      cwd: root,
      changedFiles: ['src/core/util.ts'],
      previousExports: [{ file: 'src/core/util.ts', symbols: ['dropped', 'survived'] }],
    });

    expect(report.breakingChanges.map((b) => b.symbol)).toEqual(['dropped']);
  });

  it('lee también las listas de exportación (`export { a, b as c }`)', async () => {
    const root = await makeTemp('open-sdd-impact-export-list-');
    await baseManifest(root);
    await write(root, 'src/core/util.ts', 'const a = 1;\nconst b = 2;\nexport { a, b as renamed };\n');

    const report = await analyzeChangeImpact({
      cwd: root,
      changedFiles: ['src/core/util.ts'],
      previousExports: [{ file: 'src/core/util.ts', symbols: ['a', 'renamed', 'gone'] }],
    });

    expect(report.breakingChanges.map((b) => b.symbol)).toEqual(['gone']);
  });

  it('avisa cuando se toca un punto de entrada de la API pública', async () => {
    const root = await makeTemp('open-sdd-impact-api-');
    await baseManifest(root);
    await write(root, 'src/core/routes.ts', 'export const health = 1;\n');
    await write(root, '.env.production', 'API_URL=https://example.test\n');

    const report = await analyzeChangeImpact({
      cwd: root,
      changedFiles: ['src/core/routes.ts', '.env.production'],
    });

    expect(report.apiSurface.map((a) => a.file)).toContain('src/core/routes.ts');
    expect(report.apiSurface.find((a) => a.file === 'src/core/routes.ts')!.symbols).toContain('health');
    expect(report.integrationPoints).toContain('src/core/routes.ts');
    expect(report.integrationPoints).toContain('.env.production');
    expect(report.findings.some((f) => f.area === 'api' && f.message.includes('Superficie de API pública'))).toBe(true);
    expect(
      report.findings.some((f) => f.area === 'breaking' && f.severity === 'warning' && f.message.includes('API pública')),
    ).toBe(true);
  });

});

describe('analyzeChangeImpact — regresiones: `previous` y objetivos de directorio', () => {
  it('(a) no exige `previous` cuando el objetivo ADDED todavía no existe en la revisión anterior', async () => {
    const root = await makeTemp('open-sdd-impact-added-new-');
    await baseManifest(root);
    await write(root, 'src/core/util.ts', 'export const util = 1;\n');
    commitFixture(root);
    // El fichero del objetivo es nuevo: ni rastreado ni presente en HEAD.
    await write(root, 'src/core/brandNew.ts', 'export const brandNew = 1;\n');

    const report = await analyzeChangeImpact({
      cwd: root,
      changedFiles: ['src/core/brandNew.ts'],
      delta: deltaOf([
        {
          id: 'REQ-AUTH-010',
          kind: 'ADDED',
          title: 'Añadir un módulo nuevo',
          statement: 'Cuando se invoque, el sistema debe responder desde el módulo nuevo.',
          targets: ['src/core/brandNew.ts'],
        },
      ]),
    });

    expect(
      report.findings.some(
        (f) => f.area === 'breaking' && f.severity === 'warning' && f.message.includes('`previous`'),
      ),
    ).toBe(false);
    expect(
      report.findings.some((f) => f.message.includes('ninguna entrada MODIFIED/REMOVED/RENAMED declara')),
    ).toBe(false);
    // El objetivo SÍ se toca: no debe aparecer el aviso de objetivo no tocado.
    expect(report.findings.some((f) => f.message.includes('la delta declara un objetivo que este cambio no toca'))).toBe(false);
  });

  it('(b) conserva el aviso cuando el objetivo MODIFIED existe en la revisión anterior y no declara `previous`', async () => {
    const root = await makeTemp('open-sdd-impact-modified-tracked-');
    await baseManifest(root);
    await write(root, 'src/core/util.ts', 'export const util = 1;\n');
    commitFixture(root);

    const report = await analyzeChangeImpact({
      cwd: root,
      changedFiles: ['src/core/util.ts'],
      delta: deltaOf([
        {
          id: 'REQ-AUTH-011',
          kind: 'MODIFIED',
          title: 'Modificar la utilidad',
          statement: 'Cuando se invoque, el sistema debe responder distinto.',
          targets: ['src/core/util.ts'],
        },
      ]),
    });

    const warning = report.findings.find(
      (f) => f.area === 'breaking' && f.severity === 'warning' && f.message.includes('ninguna entrada MODIFIED/REMOVED/RENAMED declara'),
    );
    expect(warning).toBeDefined();
    expect(warning!.artifacts).toContain('src/core/util.ts');
  });

  it('sigue avisando cuando el objetivo ADDED ya existía en HEAD (no todo ADDED es nuevo)', async () => {
    const root = await makeTemp('open-sdd-impact-added-tracked-');
    await baseManifest(root);
    await write(root, 'src/core/util.ts', 'export const util = 1;\n');
    commitFixture(root);
    await write(root, 'src/core/util.ts', 'export const util = 2;\n');

    const report = await analyzeChangeImpact({
      cwd: root,
      changedFiles: ['src/core/util.ts'],
      delta: deltaOf([
        {
          id: 'REQ-AUTH-012',
          kind: 'ADDED',
          title: 'Declarar como añadido algo que ya existía',
          statement: 'Cuando se invoque, el sistema debe responder.',
          targets: ['src/core/util.ts'],
        },
      ]),
    });

    expect(
      report.findings.some(
        (f) => f.severity === 'warning' && f.message.includes('ninguna entrada MODIFIED/REMOVED/RENAMED declara'),
      ),
    ).toBe(true);
  });

  it('no afirma la violación cuando git no puede decir si el objetivo existía', async () => {
    const root = await makeTemp('open-sdd-impact-no-git-');
    await baseManifest(root);
    await write(root, 'src/core/util.ts', 'export const util = 1;\n');
    // Sin repositorio git: no se puede saber si había una revisión anterior.

    const report = await analyzeChangeImpact({
      cwd: root,
      changedFiles: ['src/core/util.ts'],
      delta: deltaOf([
        {
          id: 'REQ-AUTH-013',
          kind: 'ADDED',
          title: 'Declarar un añadido sin revisión anterior',
          statement: 'Cuando se invoque, el sistema debe responder.',
          targets: ['src/core/util.ts'],
        },
      ]),
    });

    const inconclusive = report.findings.find(
      (f) => f.area === 'breaking' && f.severity === 'info' && f.message.includes('git no está disponible'),
    );
    expect(inconclusive).toBeDefined();
    expect(
      report.findings.some(
        (f) => f.severity === 'warning' && f.message.includes('ninguna entrada MODIFIED/REMOVED/RENAMED declara'),
      ),
    ).toBe(false);
  });

  it('(c) un objetivo de directorio cubre los ficheros que hay debajo', async () => {
    const root = await makeTemp('open-sdd-impact-dir-target-');
    await baseManifest(root);
    await write(root, 'src/core/a.ts', 'export const a = 1;\n');
    await write(root, 'src/core/b.ts', 'export const b = 1;\n');
    await write(root, 'src/other.ts', 'export const other = 1;\n');

    const report = await analyzeChangeImpact({
      cwd: root,
      changedFiles: ['src/core/a.ts', 'src/core/b.ts', 'src/other.ts'],
      delta: deltaOf([
        {
          id: 'REQ-AUTH-014',
          kind: 'MODIFIED',
          title: 'Modificar la capa core',
          statement: 'Cuando se invoque, el sistema debe responder distinto.',
          targets: ['src/core'],
          previous: 'la capa core anterior',
        },
      ]),
    });

    const scope = report.findings.filter((f) => f.message.includes('cambia fuera del alcance declarado'));
    expect(scope.map((f) => f.artifacts[0])).toEqual(['src/other.ts']);
    expect(report.findings.some((f) => f.message.includes('la delta declara un objetivo que este cambio no toca'))).toBe(false);
    // El informe dice explícitamente qué se dio por cubierto con el directorio.
    expect(
      report.findings.some(
        (f) => f.severity === 'info' && f.message.includes('se interpretó como directorio') && f.message.includes('src/core/'),
      ),
    ).toBe(true);
  });

  it('(c) un objetivo terminado en `/` también cubre el árbol', async () => {
    const root = await makeTemp('open-sdd-impact-dir-slash-');
    await baseManifest(root);
    await write(root, 'src/core/a.ts', 'export const a = 1;\n');

    const report = await analyzeChangeImpact({
      cwd: root,
      changedFiles: ['src/core/a.ts'],
      delta: deltaOf([
        {
          id: 'REQ-AUTH-015',
          kind: 'MODIFIED',
          title: 'Modificar la capa core',
          statement: 'Cuando se invoque, el sistema debe responder distinto.',
          targets: ['src/core/'],
          previous: 'la capa core anterior',
        },
      ]),
    });

    expect(report.findings.some((f) => f.message.includes('cambia fuera del alcance declarado'))).toBe(false);
    expect(report.findings.some((f) => f.message.includes('la delta declara un objetivo que este cambio no toca'))).toBe(false);
  });

  it('(d) un objetivo de fichero sigue exigiendo coincidencia y no cubre a sus vecinos', async () => {
    const root = await makeTemp('open-sdd-impact-file-target-');
    await baseManifest(root);
    await write(root, 'src/core/a.ts', 'export const a = 1;\n');
    await write(root, 'src/core/b.ts', 'export const b = 1;\n');

    const report = await analyzeChangeImpact({
      cwd: root,
      changedFiles: ['src/core/a.ts', 'src/core/b.ts'],
      delta: deltaOf([
        {
          id: 'REQ-AUTH-016',
          kind: 'MODIFIED',
          title: 'Modificar solo a',
          statement: 'Cuando se invoque, el sistema debe responder distinto.',
          targets: ['src/core/a.ts'],
          previous: 'la utilidad a anterior',
        },
      ]),
    });

    const scope = report.findings.filter((f) => f.message.includes('cambia fuera del alcance declarado'));
    expect(scope.map((f) => f.artifacts[0])).toEqual(['src/core/b.ts']);
    expect(report.findings.some((f) => f.message.includes('la delta declara un objetivo que este cambio no toca'))).toBe(false);
    expect(report.findings.some((f) => f.message.includes('se interpretó como directorio'))).toBe(false);
  });

  it('(d) un objetivo sin extensión es un fichero cuando nada vive debajo', async () => {
    const root = await makeTemp('open-sdd-impact-extless-');
    await baseManifest(root);
    await write(root, 'LICENSE', 'MIT\n');
    await write(root, 'Makefile', 'all:\n');

    const report = await analyzeChangeImpact({
      cwd: root,
      changedFiles: ['LICENSE', 'Makefile'],
      delta: deltaOf([
        {
          id: 'REQ-AUTH-017',
          kind: 'MODIFIED',
          title: 'Modificar la licencia',
          statement: 'Cuando se lea, el sistema debe mostrar la licencia.',
          targets: ['LICENSE'],
          previous: 'la licencia anterior',
        },
      ]),
    });

    const scope = report.findings.filter((f) => f.message.includes('cambia fuera del alcance declarado'));
    expect(scope.map((f) => f.artifacts[0])).toEqual(['Makefile']);
    expect(report.findings.some((f) => f.message.includes('se interpretó como directorio'))).toBe(false);
  });
});

describe('analyzeChangeImpact — migraciones de base de datos', () => {
  it('reporta error en una migración cambiada sin contraparte de rollback', async () => {
    const root = await makeTemp('open-sdd-impact-db-');
    await baseManifest(root);
    await write(root, 'migrations/20240101_add_users.sql', 'ALTER TABLE users ADD COLUMN email text;\n');

    const report = await analyzeChangeImpact({ cwd: root, changedFiles: ['migrations/20240101_add_users.sql'] });

    expect(report.migrations).toEqual([{ path: 'migrations/20240101_add_users.sql', hasRollback: false }]);
    const error = report.findings.find((f) => f.area === 'database' && f.severity === 'error');
    expect(error).toBeDefined();
    expect(error!.message).toContain('rollback');
  });

  it('no reporta error cuando la reversión existe en el mismo directorio', async () => {
    const root = await makeTemp('open-sdd-impact-db-ok-');
    await baseManifest(root);
    await write(root, 'migrations/20240101_add_index.sql', 'CREATE INDEX idx_users_email ON users (email);\n');
    await write(root, 'migrations/20240101_add_index.down.sql', 'DROP INDEX idx_users_email;\n');

    const report = await analyzeChangeImpact({ cwd: root, changedFiles: ['migrations/20240101_add_index.sql'] });

    expect(report.migrations).toEqual([{ path: 'migrations/20240101_add_index.sql', hasRollback: true }]);
    expect(report.findings.some((f) => f.area === 'database' && f.severity === 'error')).toBe(false);
  });

  it('acepta el plan de reversión declarado dentro del propio fichero', async () => {
    const root = await makeTemp('open-sdd-impact-db-inline-');
    await baseManifest(root);
    await write(
      root,
      'migrations/20240103_add_orders.js',
      'exports.up = async (knex) => {};\nexports.down = async (knex) => {};\n',
    );
    await write(root, 'migrations/20240104_drop_legacy.py', 'def upgrade():\n    pass\n\ndef downgrade():\n    pass\n');

    const report = await analyzeChangeImpact({
      cwd: root,
      changedFiles: ['migrations/20240103_add_orders.js', 'migrations/20240104_drop_legacy.py'],
    });

    expect(report.migrations).toEqual([
      { path: 'migrations/20240103_add_orders.js', hasRollback: true },
      { path: 'migrations/20240104_drop_legacy.py', hasRollback: true },
    ]);
    expect(report.findings.some((f) => f.area === 'database' && f.severity === 'error')).toBe(false);
  });

  it('no confunde la reversión de otra migración con la propia', async () => {
    const root = await makeTemp('open-sdd-impact-db-other-');
    await baseManifest(root);
    await write(root, 'migrations/20240101_add_orders.sql', 'CREATE TABLE orders (id int);\n');
    await write(root, 'migrations/20240102_add_orders.down.sql', 'DROP TABLE orders;\n');

    const report = await analyzeChangeImpact({ cwd: root, changedFiles: ['migrations/20240101_add_orders.sql'] });

    expect(report.migrations).toEqual([{ path: 'migrations/20240101_add_orders.sql', hasRollback: false }]);
    expect(report.findings.some((f) => f.area === 'database' && f.severity === 'error')).toBe(true);
  });
});

describe('analyzeChangeImpact — contraste con la delta', () => {
  const delta = (): DeltaSpec =>
    deltaOf([
      {
        id: 'REQ-AUTH-001',
        kind: 'MODIFIED',
        title: 'Modificar el inicio de sesión',
        statement: 'Cuando el usuario inicie sesión, el sistema debe registrar el intento.',
        targets: ['src/core/missing.ts'],
        previous: 'el inicio de sesión anterior',
        contracts: ['test/core/missing.test.ts'],
      },
    ]);

  it('avisa de objetivos no tocados y de cambios fuera del alcance declarado', async () => {
    const root = await makeTemp('open-sdd-impact-delta-');
    await baseManifest(root);
    await write(root, 'src/core/util.ts', 'export const util = 1;\n');

    const report = await analyzeChangeImpact({
      cwd: root,
      changedFiles: ['src/core/util.ts'],
      delta: delta(),
    });

    expect(report.feature).toBe('auth-change');
    expect(report.findings.some((f) => f.message.includes('la delta declara un objetivo que este cambio no toca'))).toBe(true);
    expect(report.findings.some((f) => f.message.includes('cambia fuera del alcance declarado'))).toBe(true);
    expect(report.detail).toContain('Contraste con la delta');
  });

  it('omite el contraste y lo dice cuando no hay delta', async () => {
    const root = await makeTemp('open-sdd-impact-nodelta-');
    await baseManifest(root);
    await write(root, 'src/core/util.ts', 'export const util = 1;\n');

    const report = await analyzeChangeImpact({ cwd: root, changedFiles: ['src/core/util.ts'] });

    expect(report.findings.some((f) => f.message.includes('Sin delta no hay contraste de alcance'))).toBe(true);
    expect(report.findings.some((f) => f.message.includes('cambia fuera del alcance declarado'))).toBe(false);
    expect(report.detail).toContain('omitido');
  });

  it('cubre el objetivo declarado en `targets` y no emite el aviso de alcance', async () => {
    const root = await makeTemp('open-sdd-impact-delta-ok-');
    await baseManifest(root);
    await write(root, 'src/core/util.ts', 'export const util = 1;\n');

    const report = await analyzeChangeImpact({
      cwd: root,
      changedFiles: ['src/core/util.ts'],
      delta: deltaOf([
        {
          id: 'REQ-AUTH-002',
          kind: 'MODIFIED',
          title: 'Modificar la utilidad',
          statement: 'Cuando se invoque, el sistema debe responder distinto.',
          targets: ['src/core/util.ts'],
          previous: 'la utilidad anterior',
          contracts: ['test/core/util.test.ts'],
        },
      ]),
    });

    expect(report.findings.some((f) => f.message.includes('fuera del alcance declarado'))).toBe(false);
    expect(report.findings.some((f) => f.message.includes('no toca ningún fichero'))).toBe(false);
    expect(report.findings.some((f) => f.area === 'components' && f.severity === 'info' && f.message.includes('Componentes afectados'))).toBe(true);
  });
});
