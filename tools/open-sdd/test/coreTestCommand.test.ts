/**
 * `testCommandFor` must return the command each ECOSYSTEM actually runs, not `npm test` for all of
 * them. A Go project runs `go test`; one in Rust, `cargo test`. The previous table only knew the
 * Node runners and fell back to `npm test` for everything else, which is the same family of defect
 * as an invented command presented as verified: it is wrong, and it was labelled as someone's
 * command.
 *
 * ── What this file confirms from evidence, and what it assumes ───────────────────────────────────
 *
 * CONFIRMED from `scanProject()` (fixtures below create the real manifest and read back
 * `project.testFramework`): Go → `go test`, Rust → `cargo test`, Java/Maven → `mvn test`,
 * .NET (`*.sln`) → `dotnet test`, and the Node runners Vitest, Jest and Mocha. Those labels are the
 * exact strings `reverseEngineering.ts` emits today.
 *
 * ASSUMED, not emitted by the current `scanProject()`: `pytest`. A Python fixture (`pyproject.toml`)
 * sets `language = 'Python'` but leaves `testFramework` undefined, so `scanProject` never produces
 * `pytest` today. The mapping reuses `templateAdaptation`'s `NATIVE_TEST_COMMAND`, which already
 * treats `pytest` as the native command of that ecosystem, and is covered here so the answer is
 * right if the scanner starts naming the runner — nothing more. `gradle test`, `ctest` and the
 * defensive Node labels (Playwright/Cypress/AVA/Jasmine) are supported for the same reason: they are
 * in `templateAdaptation`'s tables, and `gradle test` IS emitted by `scanProject` when a
 * `build.gradle` is the manifest, but the fixture here exercises only Maven.
 *
 * The "declared manifest script wins" case uses the optional second argument: a command read from
 * `package.json` → `scripts.test` was declared by a human, so it is reported with `derived: false`,
 * while every ecosystem table entry stays `derived: true` because it is derived from the runner's
 * name, not verified by running it.
 *
 * Fixtures live in `mkdtemp` and are removed in `afterEach`; nothing is written inside the repo.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanProject } from '../src/core/reverseEngineering.js';
import { testCommandFor } from '../src/core/executionContract.js';

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

type Project = Awaited<ReturnType<typeof scanProject>>;

/** Build a real single-manifest fixture and read back what `scanProject` actually observed. */
const scanFixture = async (prefix: string, files: Record<string, string>): Promise<Project> => {
  const root = await makeTemp(prefix);
  for (const [rel, content] of Object.entries(files)) await write(root, rel, content);
  return scanProject(root);
};

describe('testCommandFor — el comando del ecosistema lo confirma scanProject()', () => {
  it('Go: `go.mod` → `go test`', async () => {
    const project = await scanFixture('open-sdd-cmd-go-', {
      'go.mod': 'module example.com/app\n\ngo 1.22\n',
    });
    expect(project.testFramework).toBe('go test');
    expect(testCommandFor(project.testFramework)).toEqual({ command: 'go test', derived: true });
  });

  it('Rust: `Cargo.toml` → `cargo test`', async () => {
    const project = await scanFixture('open-sdd-cmd-rust-', {
      'Cargo.toml': '[package]\nname = "app"\nversion = "0.1.0"\n',
    });
    expect(project.testFramework).toBe('cargo test');
    expect(testCommandFor(project.testFramework)).toEqual({ command: 'cargo test', derived: true });
  });

  it('Java/Maven: `pom.xml` → `mvn test`', async () => {
    const project = await scanFixture('open-sdd-cmd-maven-', {
      'pom.xml': '<project><modelVersion>4.0.0</modelVersion></project>\n',
    });
    expect(project.testFramework).toBe('mvn test');
    expect(testCommandFor(project.testFramework)).toEqual({ command: 'mvn test', derived: true });
  });

  it('.NET: una solución `*.sln` → `dotnet test`', async () => {
    const project = await scanFixture('open-sdd-cmd-dotnet-', {
      'App.sln': 'Microsoft Visual Studio Solution File\n',
    });
    expect(project.testFramework).toBe('dotnet test');
    expect(testCommandFor(project.testFramework)).toEqual({ command: 'dotnet test', derived: true });
  });

  it('Vitest: dependencia declarada → `npx vitest run`', async () => {
    const project = await scanFixture('open-sdd-cmd-vitest-', {
      'package.json': JSON.stringify({ name: 'v', devDependencies: { vitest: '^1.0.0' } }),
    });
    expect(project.testFramework).toBe('Vitest');
    expect(testCommandFor(project.testFramework)).toEqual({ command: 'npx vitest run', derived: true });
  });

  it('Jest: dependencia declarada → `npx jest`', async () => {
    const project = await scanFixture('open-sdd-cmd-jest-', {
      'package.json': JSON.stringify({ name: 'j', devDependencies: { jest: '^29.0.0' } }),
    });
    expect(project.testFramework).toBe('Jest');
    expect(testCommandFor(project.testFramework)).toEqual({ command: 'npx jest', derived: true });
  });

  it('Mocha: dependencia declarada → `npx mocha`', async () => {
    const project = await scanFixture('open-sdd-cmd-mocha-', {
      'package.json': JSON.stringify({ name: 'm', devDependencies: { mocha: '^10.0.0' } }),
    });
    expect(project.testFramework).toBe('Mocha');
    expect(testCommandFor(project.testFramework)).toEqual({ command: 'npx mocha', derived: true });
  });
});

describe('testCommandFor — Python y el resto de la tabla del ecosistema', () => {
  it('Python: `scanProject` marca el lenguaje pero HOY no nombra runner; se asume `pytest`', async () => {
    // Evidencia del hueco, no una suposición disfrazada: el escáner no emite `testFramework` aquí.
    const project = await scanFixture('open-sdd-cmd-python-', {
      'pyproject.toml': '[project]\nname = "app"\n',
    });
    expect(project.language).toBe('Python');
    expect(project.testFramework).toBeUndefined();

    // Sin runner nombrado, el fallback honesto es `npm test` (derivado, nadie lo declaró)…
    expect(testCommandFor(project.testFramework)).toEqual({ command: 'npm test', derived: true });
    // …y si algún día el escáner lo nombra, la tabla ya responde `pytest`.
    expect(testCommandFor('pytest')).toEqual({ command: 'pytest', derived: true });
  });

  it('cubre la tabla de ecosistemas que `templateAdaptation` ya conocía', () => {
    const expected: [string, string][] = [
      ['Vitest', 'npx vitest run'],
      ['Jest', 'npx jest'],
      ['Mocha', 'npx mocha'],
      ['Playwright', 'npx playwright test'],
      ['Cypress', 'npx cypress run'],
      ['AVA', 'npx ava'],
      ['Jasmine', 'npx jasmine'],
      ['go test', 'go test'],
      ['cargo test', 'cargo test'],
      ['mvn test', 'mvn test'],
      ['gradle test', 'gradle test'],
      ['dotnet test', 'dotnet test'],
      ['pytest', 'pytest'],
      ['ctest', 'ctest'],
    ];
    for (const [framework, command] of expected) {
      expect(testCommandFor(framework), framework).toEqual({ command, derived: true });
    }
  });

  it('la etiqueta `AVA` no captura por accidente una palabra que solo la contiene', () => {
    expect(testCommandFor('javascript')).toEqual({ command: 'npm test', derived: true });
  });
});

describe('testCommandFor — un ecosistema desconocido cae en `npm test` como SUPOSICIÓN', () => {
  it('marca `npm test` como derivado cuando no hay framework', () => {
    expect(testCommandFor(undefined)).toEqual({ command: 'npm test', derived: true });
    expect(testCommandFor('')).toEqual({ command: 'npm test', derived: true });
    expect(testCommandFor('   ')).toEqual({ command: 'npm test', derived: true });
    expect(testCommandFor('framework-que-nadie-declara')).toEqual({ command: 'npm test', derived: true });
  });
});

describe('testCommandFor — un script declarado en el manifiesto gana al defecto del ecosistema', () => {
  it('el script de `package.json` se usa tal cual y NO se marca derivado', () => {
    expect(testCommandFor('Vitest', 'vitest run --coverage')).toEqual({
      command: 'vitest run --coverage',
      derived: false,
    });
    // También gana a un ecosistema desconocido: lo declarado manda sobre lo supuesto.
    expect(testCommandFor(undefined, 'make test')).toEqual({ command: 'make test', derived: false });
  });

  it('un script declarado vacío no sustituye al comando del ecosistema', () => {
    expect(testCommandFor('Jest', '   ')).toEqual({ command: 'npx jest', derived: true });
    expect(testCommandFor('Jest', '')).toEqual({ command: 'npx jest', derived: true });
  });

  it('integración: el script leído del manifiesto del fixture gana al runner observado', async () => {
    const root = await makeTemp('open-sdd-cmd-declared-');
    await write(
      root,
      'package.json',
      JSON.stringify({ name: 'd', devDependencies: { vitest: '^1.0.0' }, scripts: { test: 'vitest run --coverage' } }),
    );

    const project = await scanProject(root);
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(project.testFramework).toBe('Vitest');
    expect(testCommandFor(project.testFramework, manifest.scripts.test)).toEqual({
      command: 'vitest run --coverage',
      derived: false,
    });
  });
});
