/**
 * Multi-language module discovery and manifest-declared public API.
 *
 * Two rules are under test here, both of the same family — a report may only say what a manifest
 * actually declares:
 *
 *   1. A repository is not single-module just because it is not a Node workspace. Maven, Gradle,
 *      Go, Cargo, Python (uv/poetry/Poetry packages) and .NET each declare their modules somewhere,
 *      and the scan must read that declaration and label the ecosystem per module.
 *   2. When a declaration exists and cannot be read, that is the finding. The scan reports the
 *      unreadable toolchain instead of silently collapsing the repository to a single root module.
 *
 * The API-surface half is the same discipline: `package.json` `bin`/`exports`/`main`/`module`,
 * Python entry points and Cargo `[[bin]]`/`lib` are DECLARATIONS; a file named `index.ts` is a
 * guess. The guess is still available as a fallback, but it is labelled as one.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveBoundaries, scanProject } from '../src/core/reverseEngineering.js';
import { collectRepoFacts } from '../src/core/reverseConstitution.js';

const temps: string[] = [];

const makeTemp = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const write = async (dir: string, rel: string, content: string): Promise<void> => {
  const full = path.join(dir, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
};

const ecosystemsOf = (project: { declaredModules: { path: string; ecosystem: string }[] }) =>
  project.declaredModules.map((module) => `${module.path}:${module.ecosystem}`);

// --- fixtures -----------------------------------------------------------------------------------

/** Maven multi-module: the root POM declares two modules, one of which declares its own child. */
const mavenFixture = async (): Promise<string> => {
  const dir = await makeTemp('open-sdd-maven-');
  await write(
    dir,
    'pom.xml',
    [
      '<project>',
      '  <artifactId>parent</artifactId>',
      '  <modules>',
      '    <module>libs/core</module>',
      '    <module>services/api</module>',
      '  </modules>',
      '</project>',
    ].join('\n'),
  );
  await write(dir, 'libs/core/pom.xml', '<project><artifactId>core</artifactId></project>');
  await write(
    dir,
    'services/api/pom.xml',
    '<project>\n  <artifactId>api</artifactId>\n  <modules><module>web</module></modules>\n</project>',
  );
  await write(dir, 'services/api/web/pom.xml', '<project><artifactId>web</artifactId></project>');
  await write(dir, 'libs/core/src/main/java/Core.java', 'class Core {}\n');
  return dir;
};

/** Gradle multi-module: `settings.gradle.kts` declares the projects with `:` separators. */
const gradleFixture = async (): Promise<string> => {
  const dir = await makeTemp('open-sdd-gradle-');
  await write(
    dir,
    'settings.gradle.kts',
    ["rootProject.name = \"acme\"", "include(\":core\")", "include(\":services\", \":services/api\")"].join('\n'),
  );
  await write(dir, 'build.gradle.kts', 'plugins { java }\n');
  await write(dir, 'core/build.gradle.kts', 'plugins { java }\n');
  await write(dir, 'services/api/build.gradle.kts', 'plugins { java }\n');
  await write(dir, 'services/api/src/main/java/Api.java', 'class Api {}\n');
  return dir;
};

/** Go workspace: `go.work` `use` directives, block form included. */
const goWorkFixture = async (): Promise<string> => {
  const dir = await makeTemp('open-sdd-gowork-');
  await write(dir, 'go.work', ['go 1.22', '', 'use ./services/api', '', 'use (', '\t./libs/shared', ')'].join('\n'));
  await write(dir, 'services/api/go.mod', 'module example.com/api\n\ngo 1.22\n');
  await write(dir, 'libs/shared/go.mod', 'module example.com/shared\n\ngo 1.22\n');
  await write(dir, 'services/api/main.go', 'package main\n\nfunc main() {}\n');
  return dir;
};

/** Rust workspace: `[workspace] members` with a glob and an excluded member. */
const cargoFixture = async (): Promise<string> => {
  const dir = await makeTemp('open-sdd-cargo-');
  await write(
    dir,
    'Cargo.toml',
    [
      '[workspace]',
      'resolver = "2"',
      'members = ["crates/*"]',
      'exclude = ["crates/legacy"]',
      '',
      '[workspace.package]',
      'edition = "2021"',
    ].join('\n'),
  );
  await write(dir, 'crates/engine/Cargo.toml', '[package]\nname = "engine"\nversion = "0.1.0"\n');
  await write(dir, 'crates/engine/src/main.rs', 'fn main() {}\n');
  await write(dir, 'crates/legacy/Cargo.toml', '[package]\nname = "legacy"\nversion = "0.1.0"\n');
  return dir;
};

/** Python monorepo: uv workspace members plus a package only visible as a nested manifest. */
const pythonFixture = async (): Promise<string> => {
  const dir = await makeTemp('open-sdd-python-');
  await write(
    dir,
    'pyproject.toml',
    [
      '[project]',
      'name = "acme"',
      'version = "0.1.0"',
      '',
      '[tool.uv.workspace]',
      'members = ["packages/*"]',
      '',
      '[project.scripts]',
      'acme = "acme.cli:main"',
    ].join('\n'),
  );
  await write(dir, 'uv.lock', 'version = 1\n');
  await write(
    dir,
    'packages/ingest/pyproject.toml',
    '[project]\nname = "acme-ingest"\nversion = "0.1.0"\n',
  );
  await write(dir, 'packages/ingest/src/acme_ingest/pipeline.py', 'def run():\n    return 1\n');
  // A workspace member with no nested manifest of its own: uv's `members` glob is the only thing
  // that declares it, which is why the declaration is read rather than inferred from directories.
  await write(dir, 'packages/ingest/README.md', '# ingest\n');
  await write(dir, 'services/worker/setup.py', 'from setuptools import setup\nsetup(name="worker")\n');
  return dir;
};

/** npm workspace: the pre-existing Node behaviour, kept working through the same code path. */
const npmFixture = async (): Promise<string> => {
  const dir = await makeTemp('open-sdd-npm-');
  await write(
    dir,
    'package.json',
    JSON.stringify({ name: 'npm-root', private: true, workspaces: ['packages/*'] }, null, 2),
  );
  await write(
    dir,
    'packages/web/package.json',
    JSON.stringify(
      { name: '@acme/web', version: '1.0.0', devDependencies: { typescript: '^5.9.3', vitest: '^4.0.18' } },
      null,
      2,
    ),
  );
  await write(dir, 'packages/web/tsconfig.json', '{\n  "compilerOptions": {}\n}\n');
  await write(dir, 'packages/web/src/browser.ts', 'export const browser = 1;\n');
  return dir;
};

const dotnetFixture = async (): Promise<string> => {
  const dir = await makeTemp('open-sdd-dotnet-');
  await write(
    dir,
    'Acme.sln',
    [
      'Microsoft Visual Studio Solution File, Format Version 12.00',
      'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Api", "src\\Api\\Api.csproj", "{11111111-1111-1111-1111-111111111111}"',
      'EndProject',
      'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Domain", "src\\Domain\\Domain.csproj", "{22222222-2222-2222-2222-222222222222}"',
      'EndProject',
    ].join('\n'),
  );
  await write(dir, 'src/Api/Api.csproj', '<Project Sdk="Microsoft.NET.Sdk"></Project>\n');
  await write(dir, 'src/Domain/Domain.csproj', '<Project Sdk="Microsoft.NET.Sdk"></Project>\n');
  return dir;
};

// --- module discovery per ecosystem -------------------------------------------------------------

describe('core/reverseEngineering — multi-language module discovery', () => {
  it('reads a Maven multi-module tree, including a module declared by another module', async () => {
    const dir = await mavenFixture();

    const project = await scanProject(dir);

    expect(project.workspaceRoots).toEqual(['libs/core', 'services/api', 'services/api/web']);
    expect(ecosystemsOf(project)).toEqual(
      expect.arrayContaining(['libs/core:maven', 'services/api:maven', 'services/api/web:maven']),
    );
    expect(project.language).toBe('Java');
    expect(project.buildTool).toBe('maven');
    expect(project.unreadableToolchains).toEqual([]);

    const boundaries = resolveBoundaries(project);
    expect(boundaries.boundaries).toEqual([
      '.',
      'libs/core',
      'services/api',
      'services/api/web',
    ]);
    expect(boundaries.ecosystems['services/api']).toBe('maven');
    expect(boundaries.source).toBe('declared-modules');
  });

  it('reads Gradle `include` declarations from settings.gradle.kts, with and without parens', async () => {
    const dir = await gradleFixture();

    const project = await scanProject(dir);

    // `include(":services", ":services/api")` declares both the container and the leaf: Gradle has
    // no way to say "container only", so both are reported rather than the leaf being dropped.
    expect(project.workspaceRoots).toEqual(['core', 'services', 'services/api']);
    expect(ecosystemsOf(project)).toEqual(
      expect.arrayContaining(['core:gradle', 'services:gradle', 'services/api:gradle']),
    );
    expect(project.unreadableToolchains).toEqual([]);
  });

  it('reads go.work `use` directives, both single-line and block form', async () => {
    const dir = await goWorkFixture();

    const project = await scanProject(dir);

    expect(project.workspaceRoots).toEqual(['libs/shared', 'services/api']);
    expect(ecosystemsOf(project)).toEqual(
      expect.arrayContaining(['libs/shared:go', 'services/api:go']),
    );
    expect(project.language).toBe('Go');
    expect(project.testFramework).toBe('go test');
  });

  it('reads a Cargo workspace: `members` globs expanded, `exclude` honored', async () => {
    const dir = await cargoFixture();

    const project = await scanProject(dir);

    expect(project.workspaceRoots).toEqual(['crates/engine']);
    expect(project.workspaceRoots).not.toContain('crates/legacy');
    expect(ecosystemsOf(project)).toContain('crates/engine:cargo');
    expect(project.language).toBe('Rust');
    expect(project.testFramework).toBe('cargo test');
  });

  it('reads a Python monorepo: uv workspace members plus a workspace without a declaration table', async () => {
    const dir = await pythonFixture();

    const project = await scanProject(dir);

    expect(project.workspaceRoots).toEqual(['packages/ingest', 'services/worker']);
    expect(ecosystemsOf(project)).toEqual(
      expect.arrayContaining(['packages/ingest:python', 'services/worker:python']),
    );
    expect(project.language).toBe('Python');
    expect(project.packageManager).toBe('uv');
  });

  it('reads a Poetry `packages` include list as workspace members, honouring `from`', async () => {
    const dir = await makeTemp('open-sdd-poetry-');
    await write(
      dir,
      'pyproject.toml',
      [
        '[tool.poetry]',
        'name = "acme"',
        'version = "0.1.0"',
        'packages = [{ include = "acme_core", from = "libs" }, { include = "acme_api", from = "libs" }]',
      ].join('\n'),
    );
    await write(dir, 'libs/acme_core/pyproject.toml', '[project]\nname = "acme-core"\n');
    await write(dir, 'libs/acme_api/pyproject.toml', '[project]\nname = "acme-api"\n');

    const project = await scanProject(dir);

    // `from` is the directory that CONTAINS the package; reading only `include` invented a
    // top-level `acme_core` module that does not exist in the repository.
    expect(project.workspaceRoots).toEqual(['libs/acme_api', 'libs/acme_core']);
    expect(project.workspaceRoots).not.toContain('acme_core');
  });

  it('reads .NET solution projects, normalizing Windows separators', async () => {
    const dir = await dotnetFixture();

    const project = await scanProject(dir);

    expect(project.workspaceRoots).toEqual(['src/Api', 'src/Domain']);
    expect(ecosystemsOf(project)).toEqual(
      expect.arrayContaining(['src/Api:dotnet', 'src/Domain:dotnet']),
    );
    expect(project.language).toBe('C#');
  });

  it('keeps the existing npm workspace behaviour and labels its modules `node`', async () => {
    const dir = await npmFixture();

    const project = await scanProject(dir);

    // The pre-existing field still means what it meant: workspace roots, no repository root.
    expect(project.workspaceRoots).toEqual(['packages/web']);
    expect(ecosystemsOf(project)).toEqual(expect.arrayContaining(['.:node', 'packages/web:node']));
    expect(project.language).toBe('TypeScript');
    expect(project.testFramework).toBe('Vitest');
  });

  it('reports an unreadable toolchain declaration instead of pretending the repo is single-module', async () => {
    const dir = await makeTemp('open-sdd-broken-maven-');
    // A directory where the POM should be: the file exists, so the declaration is there, but it
    // cannot be read. Collapsing to one root module would be a silent lie.
    await mkdir(path.join(dir, 'pom.xml'), { recursive: true });

    const project = await scanProject(dir);

    expect(project.unreadableToolchains).toEqual(['pom.xml']);
    expect(project.workspaceRoots).toBeUndefined();
    expect(resolveBoundaries(project).source).toBe('root-only');
    expect(resolveBoundaries(project).detail).toMatch(/ningún manifiesto declaró módulos/);
  });

  it('names the unreadable declaration in the module map and marks it incomplete', async () => {
    const { buildModuleMap } = await import('../src/core/bootstrap.js');
    const dir = await makeTemp('open-sdd-broken-gradle-');
    await mkdir(path.join(dir, 'settings.gradle'), { recursive: true });

    const map = await buildModuleMap(dir);

    expect(map.complete).toBe(false);
    expect(map.detail).toMatch(/settings\.gradle/);
    expect(map.detail).toMatch(/NO se trata como un único módulo/);
  });

  it('says so when a Python root manifest cannot be read in workspace form only', async () => {
    const dir = await makeTemp('open-sdd-broken-python-');
    await mkdir(path.join(dir, 'pyproject.toml'), { recursive: true });
    await write(dir, 'packages/app/pyproject.toml', '[project]\nname = "app"\n');

    const project = await scanProject(dir);

    // The root manifest is unreadable, but the nested package IS readable: the modules that could
    // be observed are reported and the failure travels with them.
    expect(project.unreadableToolchains).toEqual(['pyproject.toml']);
    expect(project.workspaceRoots).toEqual(['packages/app']);
  });

  it('does not invent modules when no manifest declares any', async () => {
    const dir = await makeTemp('open-sdd-single-');
    await write(dir, 'src/index.ts', 'export const value = 1;\n');

    const project = await scanProject(dir);

    expect(project.workspaceRoots).toBeUndefined();
    expect(resolveBoundaries(project)).toMatchObject({
      boundaries: ['.'],
      source: 'root-only',
      ecosystems: { '.': 'unknown' },
    });
  });
});

// --- manifest-declared public API ---------------------------------------------------------------

describe('core/reverseConstitution — manifest-declared public API', () => {
  it('finds an API surface the filename heuristic would miss, and says the manifests declared it', async () => {
    const dir = await makeTemp('open-sdd-api-manifest-');
    await write(
      dir,
      'package.json',
      JSON.stringify(
        {
          name: 'api-fixture',
          main: 'lib/bootstrap.cjs',
          exports: { '.': { import: './dist/entry.mjs' }, './client': './dist/client.mjs' },
          bin: { 'api-tool': './bin/run.mjs' },
        },
        null,
        2,
      ),
    );
    // None of these matches index|main|mod|api|routes — the heuristic sees an empty surface.
    await write(dir, 'lib/bootstrap.cjs', 'module.exports = {};\n');
    await write(dir, 'dist/entry.mjs', 'export const entry = 1;\n');
    await write(dir, 'dist/client.mjs', 'export const client = 1;\n');
    await write(dir, 'bin/run.mjs', '#!/usr/bin/env node\n');

    const project = await scanProject(dir);
    const facts = await collectRepoFacts(dir, project);

    expect(facts.publicApiSource).toBe('manifest');
    expect(facts.publicApiFiles).toEqual([
      'bin/run.mjs',
      'dist/client.mjs',
      'dist/entry.mjs',
      'lib/bootstrap.cjs',
    ]);
    const declared = facts.publicApiDeclarations.map((entry) => `${entry.kind}=${entry.target}`);
    expect(declared).toContain('main=lib/bootstrap.cjs');
    expect(declared).toContain('bin:api-tool=bin/run.mjs');
    expect(declared).toContain('exports:..import=dist/entry.mjs');
    expect(declared).toContain('exports:./client=dist/client.mjs');
    expect(facts.publicApiDetail).toMatch(/declarada por manifiesto/i);
  });

  it('reads Python entry points from pyproject and resolves them to the module that holds them', async () => {
    const dir = await makeTemp('open-sdd-api-python-');
    await write(
      dir,
      'pyproject.toml',
      ['[project]', 'name = "acme"', 'version = "0.1.0"', '', '[project.scripts]', 'acme = "acme.cli:main"'].join(
        '\n',
      ),
    );
    await write(dir, 'src/acme/cli.py', 'def main():\n    return 0\n');
    // `service.py` matches no heuristic pattern: only the entry-point declaration names it.
    await write(dir, 'src/acme/service.py', 'def serve():\n    return 0\n');
    await write(dir, 'pyproject.extra.toml', 'not-a-manifest = true\n');

    const project = await scanProject(dir);
    const facts = await collectRepoFacts(dir, project);

    expect(facts.publicApiSource).toBe('manifest');
    expect(facts.publicApiFiles).toContain('src/acme/cli.py');
    expect(facts.publicApiDeclarations.map((entry) => `${entry.kind}=${entry.target}`)).toContain(
      'entry-point:acme=src/acme/cli.py',
    );
  });

  it('reads Cargo [[bin]] and [lib], honouring an explicit path and deriving the conventional one', async () => {
    const dir = await makeTemp('open-sdd-api-cargo-');
    await write(
      dir,
      'Cargo.toml',
      [
        '[package]',
        'name = "engine"',
        'version = "0.1.0"',
        '',
        '[lib]',
        'name = "engine"',
        'path = "src/lib.rs"',
        '',
        '[[bin]]',
        'name = "engine-cli"',
        'path = "src/bin/cli.rs"',
        '',
        '[[bin]]',
        'name = "engine-worker"',
      ].join('\n'),
    );
    await write(dir, 'src/lib.rs', 'pub fn run() {}\n');
    await write(dir, 'src/bin/cli.rs', 'fn main() {}\n');
    await write(dir, 'src/bin/engine-worker.rs', 'fn main() {}\n');

    const project = await scanProject(dir);
    const facts = await collectRepoFacts(dir, project);

    expect(facts.publicApiDeclarations.map((entry) => `${entry.kind}=${entry.target}`)).toEqual(
      expect.arrayContaining([
        'lib=src/lib.rs',
        'bin:engine-cli=src/bin/cli.rs',
        'bin:engine-worker=src/bin/engine-worker.rs',
      ]),
    );
    expect(facts.publicApiSource).toBe('manifest');
  });

  it('falls back to the filename heuristic ONLY when nothing is declared, and labels the fallback', async () => {
    const dir = await makeTemp('open-sdd-api-fallback-');
    await write(dir, 'package.json', JSON.stringify({ name: 'no-declared-api' }, null, 2));
    // `src/api.ts` matches the heuristic; `src/service.ts` does not.
    await write(dir, 'src/api.ts', 'export const routes = [];\n');
    await write(dir, 'src/service.ts', 'export const service = 1;\n');

    const project = await scanProject(dir);
    const facts = await collectRepoFacts(dir, project);

    expect(facts.publicApiSource).toBe('filename-heuristic');
    expect(facts.publicApiFiles).toEqual(['src/api.ts']);
    expect(facts.publicApiDeclarations).toEqual([]);
    expect(facts.publicApiDetail).toMatch(/inferida por nombre de fichero/i);
    expect(facts.publicApiDetail).toMatch(/ningún manifiesto/i);
  });

  it('labels a mixed repository as manifest + heuristic, per module', async () => {
    const dir = await makeTemp('open-sdd-api-mixed-');
    await write(
      dir,
      'package.json',
      JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] }, null, 2),
    );
    await write(
      dir,
      'packages/declared/package.json',
      JSON.stringify({ name: '@acme/declared', exports: { '.': './src/gateway.ts' } }, null, 2),
    );
    await write(dir, 'packages/declared/src/gateway.ts', 'export const gateway = 1;\n');
    await write(dir, 'packages/declared/src/index.ts', 'export const unrelated = 1;\n');
    await write(dir, 'packages/guessed/package.json', JSON.stringify({ name: '@acme/guessed' }, null, 2));
    await write(dir, 'packages/guessed/src/index.ts', 'export const guessed = 1;\n');

    const project = await scanProject(dir);
    const facts = await collectRepoFacts(dir, project);

    expect(facts.publicApiSource).toBe('manifest+filename-heuristic');
    // The declared module contributes only its declaration; the undeclared one contributes the
    // filename guess, and both are visible in the same list.
    expect(facts.publicApiFiles).toContain('packages/declared/src/gateway.ts');
    expect(facts.publicApiFiles).not.toContain('packages/declared/src/index.ts');
    expect(facts.publicApiFiles).toContain('packages/guessed/src/index.ts');
    expect(facts.publicApiDetail).toMatch(/manifiesto/i);
    expect(facts.publicApiDetail).toMatch(/sin declaración/i);
  });

  it('ignores package specifiers and subpath imports that name no file in the repository', async () => {
    const dir = await makeTemp('open-sdd-api-specifier-');
    await write(
      dir,
      'package.json',
      JSON.stringify(
        { name: 'specifier', main: 'lodash', exports: { './sub': '#internal/sub' }, bin: 'some-cli' },
        null,
        2,
      ),
    );
    await write(dir, 'src/index.ts', 'export const value = 1;\n');

    const project = await scanProject(dir);
    const facts = await collectRepoFacts(dir, project);

    // Nothing declared resolves to a file, so the labelled fallback is what remains.
    expect(facts.publicApiDeclarations).toEqual([]);
    expect(facts.publicApiSource).toBe('filename-heuristic');
    expect(facts.publicApiFiles).toEqual(['src/index.ts']);
  });
});
