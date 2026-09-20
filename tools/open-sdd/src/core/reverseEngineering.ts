import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DiscoveredProject } from './types.js';
import { initSpec, resolveSddDir } from './specManager.js';

/**
 * The toolchain that declared a module root. `unknown` is a real value, not a placeholder: it means
 * no manifest named this root as a module, and the report must be able to say that.
 */
export type ModuleEcosystem =
  | 'node'
  | 'maven'
  | 'gradle'
  | 'go'
  | 'cargo'
  | 'python'
  | 'dotnet'
  | 'unknown';

/** Human label used by the reports. */
export const ECOSYSTEM_LABEL: Record<ModuleEcosystem, string> = {
  node: 'Node/JavaScript',
  maven: 'Maven',
  gradle: 'Gradle',
  go: 'Go',
  cargo: 'Rust/Cargo',
  python: 'Python',
  dotnet: '.NET',
  unknown: 'desconocido',
};

/** A module root together with the toolchain that declared it. */
export interface DeclaredModule {
  /** Module root relative to the repository, POSIX separators. `.` is the repository root. */
  path: string;
  ecosystem: ModuleEcosystem;
  /** Manifest that declared the module, relative to the repository, when one exists. */
  manifest?: string;
}

/**
 * What `scanProject` returns: the shared `DiscoveredProject` plus the multi-language module roots.
 * `declaredModules` always includes the repository root, so a consumer can label it too.
 */
export interface ProjectScan extends DiscoveredProject {
  declaredModules: DeclaredModule[];
  /**
   * Toolchain declarations that exist but could not be read. A repository is never reported as
   * single-module when a declared toolchain simply failed to parse: the failure travels here.
   */
  unreadableToolchains: string[];
}

/** The one boundary vocabulary: module map and constitution both name these. */
export interface BoundarySet {
  /** Boundary paths, repository root first. Exactly the module paths the bootstrap map builds. */
  boundaries: string[];
  /** `declared-modules` when a workspace/toolchain named them; `root-only` when none did. */
  source: 'declared-modules' | 'root-only';
  /** Ecosystem per boundary, `unknown` when nothing declared it. */
  ecosystems: Record<string, ModuleEcosystem>;
  /** One-line account of what the boundaries are and where they came from. */
  detail: string;
}

/**
 * THE boundary vocabulary (REQ-MAT-010).
 *
 * The module responsibility map (`bootstrap.buildModuleMap`) and the descriptive constitution
 * (`reverseConstitution`, principle `C-BOUNDARIES`) used two different notions of "boundary": the
 * map listed `root + workspace roots` while the constitution listed the subdirectories of the
 * source directories. The same repository could therefore be described with two different sets of
 * boundaries. Both now derive their boundaries from this single function, so the two artifacts
 * cannot disagree about where the boundaries are.
 */
export const resolveBoundaries = (project: DiscoveredProject): BoundarySet => {
  const declared = (project as Partial<ProjectScan>).declaredModules ?? [];
  const moduleRoots = Array.from(
    new Set([...(project.workspaceRoots ?? []), ...declared.map((module) => module.path)]),
  )
    .filter((root) => root !== '.' && root !== '')
    .sort();
  const boundaries = ['.', ...moduleRoots];
  const ecosystems: Record<string, ModuleEcosystem> = {};
  for (const boundary of boundaries) {
    ecosystems[boundary] = declared.find((module) => module.path === boundary)?.ecosystem ?? 'unknown';
  }
  const source: BoundarySet['source'] = moduleRoots.length > 0 ? 'declared-modules' : 'root-only';
  const labels = Array.from(new Set(moduleRoots.map((root) => ecosystems[root]))).filter(
    (ecosystem) => ecosystem !== 'unknown',
  );
  const detail =
    source === 'declared-modules'
      ? `Fronteras: ${boundaries.length} frontera(s) (raíz + ${moduleRoots.length} módulo(s) declarado(s)` +
        `${labels.length > 0 ? `: ${labels.map((label) => ECOSYSTEM_LABEL[label]).join(', ')}` : ''}).`
      : 'Fronteras: 1 (la raíz del repositorio; ningún manifiesto declaró módulos).';
  return { boundaries, source, ecosystems, detail };
};

/** Directories that never hold a first-party manifest: build output, vendored code, caches. */
const WALK_SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  'vendor',
  'venv',
  '__pycache__',
  'obj',
]);
const MAX_WALK_ENTRIES = 5000;

const existsUnder = async (cwd: string, rel: string): Promise<boolean> =>
  (await stat(path.join(cwd, rel)).catch(() => null)) !== null;

const readTextUnder = async (cwd: string, rel: string): Promise<string | null> =>
  readFile(path.join(cwd, rel), 'utf8').catch(() => null);

/** Normalize a manifest-declared path to a repository-relative POSIX path. */
const normalizeRel = (value: string): string => {
  const parts: string[] = [];
  for (const segment of value.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join('/') || '.';
};

/** Subdirectories of `parent` that hold a manifest with the given name. */
const subdirsContaining = async (
  cwd: string,
  parent: string,
  manifestName: string,
): Promise<string[]> => {
  const base = parent === '' ? '.' : parent;
  const entries = await readdir(path.join(cwd, base), { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const rel = base === '.' ? entry.name : `${base}/${entry.name}`;
    if (await existsUnder(cwd, `${rel}/${manifestName}`)) found.push(rel);
  }
  return found;
};

/** Bounded walk for manifest files, so a monorepo is detected without scanning an entire tree. */
const walkFiles = async (
  cwd: string,
  matches: (name: string) => boolean,
  maxDepth: number,
): Promise<string[]> => {
  const found: string[] = [];
  let visited = 0;
  const walk = async (relDir: string, depth: number): Promise<void> => {
    if (depth > maxDepth || visited > MAX_WALK_ENTRIES) return;
    const entries = await readdir(path.join(cwd, relDir), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      visited += 1;
      if (visited > MAX_WALK_ENTRIES) return;
      if (entry.name.startsWith('.') || WALK_SKIP_DIRS.has(entry.name)) continue;
      const rel = relDir === '.' ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) await walk(rel, depth + 1);
      else if (matches(entry.name)) found.push(rel);
    }
  };
  await walk('.', 0);
  return found;
};

/** Expand a `members` entry that may be a literal path or a `dir/*` glob. */
const expandMember = async (
  cwd: string,
  member: string,
  manifestName: string,
): Promise<string[]> => {
  const normalized = member.replace(/\\/g, '/').replace(/\/$/, '');
  if (!normalized.includes('*')) return normalized ? [normalizeRel(normalized)] : [];
  const base = normalized.replace(/\/\*+$/, '').replace(/\*+$/, '').replace(/\/$/, '');
  return subdirsContaining(cwd, base, manifestName);
};

/**
 * Minimal TOML reading, no dependency. It is deliberately narrow: it extracts section bodies and
 * the array values this scanner needs (`members`, `packages`, `path`). A manifest shape it cannot
 * read is reported by the caller rather than guessed at.
 */
export const tomlSections = (text: string): Map<string, string> => {
  const sections = new Map<string, string>();
  let current = '';
  let lines: string[] = [];
  const flush = (): void => {
    if (current) sections.set(current, lines.join('\n'));
  };
  for (const line of text.split(/\r?\n/)) {
    // Both `[section]` and `[[array.of.tables]]` headers end the previous body: an array-of-tables
    // block must not be folded into whatever section precedes it.
    const header = line.match(/^\s*\[\[?([^\]]+)\]\]?\s*(?:#.*)?$/);
    if (header) {
      flush();
      current = header[1].trim();
      lines = [];
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
};

/** Bodies of every `[[name]]` array-of-tables block, in file order. */
export const tomlArrayTables = (text: string, name: string): string[] => {
  const bodies: string[] = [];
  let current: string[] | null = null;
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^\s*\[\[([^\]]+)\]\]\s*(?:#.*)?$/) ?? line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (header) {
      if (current) bodies.push(current.join('\n'));
      current = header[1].trim() === name ? [] : null;
      continue;
    }
    if (current) current.push(line);
  }
  if (current) bodies.push(current.join('\n'));
  return bodies;
};

/** Inner text of `key = [ ... ]` inside a TOML section, accounting for quoted strings. */
const tomlRawArray = (sectionBody: string, key: string): string | null => {
  const match = new RegExp(`(?:^|\\n)\\s*${key}\\s*=\\s*\\[`).exec(sectionBody);
  if (!match) return null;
  const start = sectionBody.indexOf('[', match.index);
  let quote = '';
  for (let i = start + 1; i < sectionBody.length; i += 1) {
    const char = sectionBody[i];
    if (quote) {
      if (char === quote && sectionBody[i - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ']') return sectionBody.slice(start + 1, i);
  }
  return null;
};

/** Quoted strings inside a TOML array (`members = ["a", "b"]`). */
const tomlStringArray = (sectionBody: string, key: string): string[] => {
  const raw = tomlRawArray(sectionBody, key);
  if (raw === null) return [];
  return Array.from(raw.matchAll(/["']([^"']*)["']/g))
    .map((match) => match[1].trim())
    .filter(Boolean);
};

/**
 * Poetry declares a package as an inline table: `{ include = "acme_core", from = "libs" }`, where
 * `from` is the directory that CONTAINS the package and `include` is the package itself. Reading
 * only `include` invented a top-level `acme_core` module that does not exist.
 */
const poetryPackageMembers = (sectionBody: string, key: string): string[] => {
  const raw = tomlRawArray(sectionBody, key);
  if (raw === null) return [];
  const members: string[] = [];
  for (const match of raw.matchAll(/\{[^}]*\}/g)) {
    const include = /include\s*=\s*["']([^"']+)["']/.exec(match[0])?.[1]?.trim();
    if (!include) continue;
    const from = /from\s*=\s*["']([^"']+)["']/.exec(match[0])?.[1]?.trim();
    members.push(from ? `${from}/${include}` : include);
  }
  return members;
};

interface DetectedModules {
  modules: DeclaredModule[];
  unreadable: string[];
}

const emptyDetection = (): DetectedModules => ({ modules: [], unreadable: [] });

/** Maven: `<modules><module>x</module></modules>`, followed one nesting level at a time. */
const detectMavenModules = async (cwd: string, rootPom = 'pom.xml'): Promise<DetectedModules> => {
  const modules: DeclaredModule[] = [];
  const unreadable: string[] = [];
  const seen = new Set<string>();
  const queue: { dir: string; depth: number }[] = [{ dir: '.', depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    if (seen.has(dir) || depth > 4) continue;
    seen.add(dir);
    const pomRel = dir === '.' ? rootPom : `${dir}/${rootPom}`;
    if (!(await existsUnder(cwd, pomRel))) continue;
    const xml = await readTextUnder(cwd, pomRel);
    if (xml === null) {
      unreadable.push(pomRel);
      continue;
    }
    for (const match of xml.matchAll(/<module>\s*([^<]+?)\s*<\/module>/g)) {
      const declared = match[1].trim();
      // A property placeholder (`${module.name}`) names nothing observable in this checkout.
      if (!declared || declared.includes('${')) continue;
      const modulePath = normalizeRel(dir === '.' ? declared : `${dir}/${declared}`);
      modules.push({ path: modulePath, ecosystem: 'maven', manifest: `${modulePath}/${rootPom}` });
      queue.push({ dir: modulePath, depth: depth + 1 });
    }
  }
  return { modules, unreadable };
};

/** Gradle: `settings.gradle[.kts]` `include ':a:b'` / `include(":a", ":b")`. */
const detectGradleModules = async (cwd: string, settingsRel: string): Promise<DetectedModules> => {
  const modules: DeclaredModule[] = [];
  if (!(await existsUnder(cwd, settingsRel))) return emptyDetection();
  const text = await readTextUnder(cwd, settingsRel);
  if (text === null) return { modules: [], unreadable: [settingsRel] };
  const declared = new Map<string, DeclaredModule>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    const match = line.match(/^include\s*[(\s]\s*(.*)$/);
    if (!match) continue;
    for (const quoted of match[1].matchAll(/['"]([^'"]+)['"]/g)) {
      const value = quoted[1].trim();
      if (!value || value.includes('$') || /\s/.test(value)) continue;
      const modulePath = normalizeRel(value.replace(/^:/, '').replace(/:/g, '/'));
      if (modulePath === '.') continue;
      declared.set(modulePath, { path: modulePath, ecosystem: 'gradle', manifest: settingsRel });
    }
  }
  return { modules: Array.from(declared.values()), unreadable: [] };
};

/** Go: `go.work` `use` directives, plus nested `go.mod` modules. */
const detectGoModules = async (cwd: string): Promise<DetectedModules> => {
  const unreadable: string[] = [];
  const declared = new Map<string, DeclaredModule>();
  const addUse = (raw: string): void => {
    const value = raw.trim().replace(/^["']|["']$/g, '');
    if (!value || value.includes('$') || value.startsWith('..')) return;
    const modulePath = normalizeRel(value);
    if (modulePath === '.') return;
    declared.set(modulePath, { path: modulePath, ecosystem: 'go', manifest: `${modulePath}/go.mod` });
  };

  if (await existsUnder(cwd, 'go.work')) {
    const text = await readTextUnder(cwd, 'go.work');
    if (text === null) unreadable.push('go.work');
    else {
      let inBlock = false;
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/\/\/.*$/, '').trim();
        if (!line) continue;
        if (inBlock) {
          if (line === ')') {
            inBlock = false;
            continue;
          }
          addUse(line);
          continue;
        }
        const match = line.match(/^use\s+(.+)$/);
        if (!match) continue;
        const value = match[1].trim();
        if (value === '(') inBlock = true;
        else addUse(value);
      }
    }
  }

  if (await existsUnder(cwd, 'go.mod')) {
    for (const mod of await walkFiles(cwd, (name) => name === 'go.mod', 4)) {
      const dir = normalizeRel(path.posix.dirname(mod));
      if (dir === '.') continue;
      declared.set(dir, { path: dir, ecosystem: 'go', manifest: mod });
    }
  }
  return { modules: Array.from(declared.values()), unreadable };
};

/** Rust: `Cargo.toml` `[workspace] members = [...]` (globs expanded). */
const detectCargoModules = async (cwd: string): Promise<DetectedModules> => {
  const modules: DeclaredModule[] = [];
  if (!(await existsUnder(cwd, 'Cargo.toml'))) return emptyDetection();
  const text = await readTextUnder(cwd, 'Cargo.toml');
  if (text === null) return { modules: [], unreadable: ['Cargo.toml'] };
  const workspace = tomlSections(text).get('workspace');
  if (!workspace) return emptyDetection();
  const excludes = new Set(tomlStringArray(workspace, 'exclude').map(normalizeRel));
  for (const member of tomlStringArray(workspace, 'members')) {
    for (const modulePath of await expandMember(cwd, member, 'Cargo.toml')) {
      if (excludes.has(modulePath)) continue;
      modules.push({ path: modulePath, ecosystem: 'cargo', manifest: `${modulePath}/Cargo.toml` });
    }
  }
  return { modules, unreadable: [] };
};

/**
 * Python: explicit `uv`/`poetry` workspace members, Poetry `packages`, and the nested
 * `pyproject.toml` / `setup.py` layouts that make a repo a monorepo without a workspace table.
 */
const detectPythonModules = async (cwd: string): Promise<DetectedModules> => {
  const modules = new Map<string, DeclaredModule>();
  const unreadable: string[] = [];
  const hasRoot = await existsUnder(cwd, 'pyproject.toml');
  if (hasRoot) {
    const text = await readTextUnder(cwd, 'pyproject.toml');
    if (text === null) unreadable.push('pyproject.toml');
    else {
      const sections = tomlSections(text);
      const memberLists: string[][] = [];
      for (const section of ['tool.uv.workspace', 'tool.poetry.workspace']) {
        const body = sections.get(section);
        if (body) memberLists.push(tomlStringArray(body, 'members'));
      }
      const poetry = sections.get('tool.poetry');
      if (poetry) memberLists.push(poetryPackageMembers(poetry, 'packages'));
      for (const list of memberLists) {
        for (const member of list) {
          for (const modulePath of await expandMember(cwd, member, 'pyproject.toml')) {
            modules.set(modulePath, {
              path: modulePath,
              ecosystem: 'python',
              manifest: `${modulePath}/pyproject.toml`,
            });
          }
        }
      }
    }
  }
  for (const manifest of await walkFiles(
    cwd,
    (name) => name === 'pyproject.toml' || name === 'setup.py',
    4,
  )) {
    const dir = normalizeRel(path.posix.dirname(manifest));
    if (dir === '.') continue;
    modules.set(dir, { path: dir, ecosystem: 'python', manifest });
  }
  return { modules: Array.from(modules.values()), unreadable };
};

/** .NET: projects referenced by a `*.sln` (classic text) or `*.slnx` (XML). */
const detectDotnetModules = async (cwd: string): Promise<DetectedModules> => {
  const modules = new Map<string, DeclaredModule>();
  const unreadable: string[] = [];
  const solutions = await walkFiles(cwd, (name) => name.endsWith('.sln') || name.endsWith('.slnx'), 2);
  for (const solution of solutions) {
    const text = await readTextUnder(cwd, solution);
    if (text === null) {
      unreadable.push(solution);
      continue;
    }
    const addProject = (raw: string): void => {
      const normalized = raw.replace(/\\/g, '/').replace(/^\//, '').trim();
      if (!normalized) return;
      const dir = normalizeRel(path.posix.dirname(normalized));
      if (dir === '.') return;
      modules.set(dir, { path: dir, ecosystem: 'dotnet', manifest: solution });
    };
    if (solution.endsWith('.slnx')) {
      for (const match of text.matchAll(/<Project\s+[^>]*Path\s*=\s*["']([^"']+)["']/g)) {
        addProject(match[1]);
      }
    } else {
      for (const match of text.matchAll(/^Project\("[^"]*"\)\s*=\s*"[^"]*"\s*,\s*"([^"]+)"/gm)) {
        addProject(match[1]);
      }
    }
  }
  if (solutions.length > 0) {
    modules.set('.', { path: '.', ecosystem: 'dotnet', manifest: solutions[0] });
  }
  return { modules: Array.from(modules.values()), unreadable };
};

/**
 * Discover what a project IS, before anyone plans a change to it.
 *
 * Two properties matter for brownfield work and both were missing:
 *
 *   1. **A repository is not always its root.** In a workspace/monorepo layout the real project
 *      lives in a nested package (`tools/open-sdd`, `packages/*`, `apps/*`). Scanning the root only
 *      made this tool report "JavaScript, no tests detected" on the very repository that ships it —
 *      a brownfield survey that lies about the project it is run on is worse than no survey.
 *   2. **Tooling is declared in config as often as in dependencies.** A language, test runner or
 *      build tool is visible through `tsconfig.json`, `vitest.config.ts`, `jest.config.js`,
 *      `go.mod` or `pyproject.toml` even when no manifest at the scanned root mentions them.
 *
 * The result is evidence, not opinion: every field below is derived from a file that exists. When
 * something cannot be determined the field stays `unknown` rather than being guessed, because a
 * descriptive constitution may only assert what the code already is.
 */
/**
 * Every module root a manifest declares, across ecosystems, with the toolchain that declared it.
 * Node detection is unchanged (workspace globs plus the conventional workspace directories); the
 * other ecosystems are additive. A declaration file that exists but cannot be read is reported in
 * `unreadable` instead of being silently reduced to a single-module repository.
 */
const detectDeclaredModules = async (
  cwd: string,
  rootPkg: Record<string, unknown> | null,
  subdirsWithManifest: (parent: string) => Promise<string[]>,
): Promise<{ declared: DeclaredModule[]; unreadable: string[] }> => {
  const declared: DeclaredModule[] = [];
  const unreadable: string[] = [];

  // --- Node: the existing behaviour, kept intact -----------------------------------------------
  if (rootPkg) declared.push({ path: '.', ecosystem: 'node', manifest: 'package.json' });
  const workspaceGlobs = (() => {
    const workspaces = rootPkg?.workspaces;
    if (Array.isArray(workspaces)) return workspaces.filter((w): w is string => typeof w === 'string');
    if (workspaces && typeof workspaces === 'object' && Array.isArray((workspaces as { packages?: unknown }).packages)) {
      return ((workspaces as { packages: unknown[] }).packages).filter((w): w is string => typeof w === 'string');
    }
    return [];
  })();
  const nodeRoots = new Set<string>();
  for (const glob of workspaceGlobs) {
    const parent = glob.replace(/\/\*+$/, '').replace(/\*+$/, '').replace(/\/$/, '');
    for (const dir of await subdirsWithManifest(parent || '.')) nodeRoots.add(dir);
  }
  for (const conventional of ['packages', 'apps', 'tools', 'services', 'libs', 'modules']) {
    for (const dir of await subdirsWithManifest(conventional)) nodeRoots.add(dir);
  }
  for (const root of Array.from(nodeRoots).sort()) {
    declared.push({ path: root, ecosystem: 'node', manifest: `${root}/package.json` });
  }

  // --- other toolchains, at the root or inside a workspace --------------------------------------
  const collect = (result: DetectedModules): void => {
    declared.push(...result.modules);
    unreadable.push(...result.unreadable);
  };

  if (await existsUnder(cwd, 'pom.xml')) {
    declared.push({ path: '.', ecosystem: 'maven', manifest: 'pom.xml' });
    collect(await detectMavenModules(cwd));
  }
  for (const settings of ['settings.gradle.kts', 'settings.gradle']) {
    if (!(await existsUnder(cwd, settings))) continue;
    declared.push({ path: '.', ecosystem: 'gradle', manifest: settings });
    collect(await detectGradleModules(cwd, settings));
    break;
  }
  if ((await existsUnder(cwd, 'go.work')) || (await existsUnder(cwd, 'go.mod'))) {
    const manifest = (await existsUnder(cwd, 'go.work')) ? 'go.work' : 'go.mod';
    declared.push({ path: '.', ecosystem: 'go', manifest });
    collect(await detectGoModules(cwd));
  }
  if (await existsUnder(cwd, 'Cargo.toml')) {
    declared.push({ path: '.', ecosystem: 'cargo', manifest: 'Cargo.toml' });
    collect(await detectCargoModules(cwd));
  }
  if (
    (await existsUnder(cwd, 'pyproject.toml')) ||
    (await existsUnder(cwd, 'setup.py')) ||
    (await existsUnder(cwd, 'setup.cfg'))
  ) {
    const manifest = (await existsUnder(cwd, 'pyproject.toml')) ? 'pyproject.toml' : 'setup.py';
    declared.push({ path: '.', ecosystem: 'python', manifest });
    collect(await detectPythonModules(cwd));
  }
  collect(await detectDotnetModules(cwd));

  // One path may be declared by two toolchains (a `package.json` and a `pyproject.toml` in the same
  // directory). Both declarations are true, so both are kept; the map picks the first and says so.
  const deduped: DeclaredModule[] = [];
  const seen = new Set<string>();
  for (const module of declared) {
    const key = `${module.path}::${module.ecosystem}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(module);
  }
  return { declared: deduped, unreadable };
};

export const scanProject = async (cwd: string = process.cwd()): Promise<ProjectScan> => {
  const checkExists = async (target: string): Promise<boolean> => {
    try {
      await stat(path.join(cwd, target));
      return true;
    } catch {
      return false;
    }
  };

  const readJson = async (rel: string): Promise<Record<string, unknown> | null> => {
    try {
      return JSON.parse(await readFile(path.join(cwd, rel), 'utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const subdirsWithManifest = async (parent: string): Promise<string[]> => {
    try {
      const entries = await readdir(path.join(cwd, parent), { withFileTypes: true });
      const found: string[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        if (await checkExists(path.join(parent, entry.name, 'package.json'))) {
          found.push(path.posix.join(parent, entry.name));
        }
      }
      return found;
    } catch {
      return [];
    }
  };

  // --- workspace/module roots, across every declared toolchain ----------------------------------
  const rootPkg = await readJson('package.json');
  const { declared: declaredModules, unreadable: unreadableToolchains } = await detectDeclaredModules(
    cwd,
    rootPkg,
    subdirsWithManifest,
  );
  const workspaceRoots = new Set(
    declaredModules.map((module) => module.path).filter((modulePath) => modulePath !== '.'),
  );

  const roots = ['.', ...Array.from(workspaceRoots).sort()];

  // --- Node/TypeScript evidence, merged across every root --------------------------------------
  let name = path.basename(cwd) || 'project';
  let language = 'unknown';
  let packageManager: string | undefined;
  let buildTool: string | undefined;
  let testFramework: string | undefined;
  const frameworks = new Set<string>();
  let sawAnyManifest = false;

  for (const root of roots) {
    const pkg = root === '.' ? rootPkg : await readJson(path.posix.join(root, 'package.json'));
    if (!pkg) continue;
    sawAnyManifest = true;

    if (root === '.' && typeof pkg.name === 'string' && pkg.name) name = pkg.name;
    else if (root !== '.' && typeof pkg.name === 'string' && pkg.name && name === path.basename(cwd)) {
      name = pkg.name;
    }

    const deps: Record<string, unknown> = {
      ...((pkg.dependencies as Record<string, unknown>) ?? {}),
      ...((pkg.devDependencies as Record<string, unknown>) ?? {}),
      ...((pkg.peerDependencies as Record<string, unknown>) ?? {}),
    };

    const hasTsConfig = await checkExists(root === '.' ? 'tsconfig.json' : path.posix.join(root, 'tsconfig.json'));
    if (deps.typescript || hasTsConfig) language = 'TypeScript';
    else if (language === 'unknown') language = 'JavaScript';

    const frameworkMap: [string, string][] = [
      ['react', 'React'],
      ['next', 'Next.js'],
      ['vue', 'Vue'],
      ['svelte', 'Svelte'],
      ['angular', 'Angular'],
      ['@angular/core', 'Angular'],
      ['express', 'Express'],
      ['fastify', 'Fastify'],
      ['@nestjs/core', 'NestJS'],
      ['nest', 'NestJS'],
      ['koa', 'Koa'],
      ['hapi', 'hapi'],
    ];
    for (const [dep, label] of frameworkMap) if (deps[dep]) frameworks.add(label);

    const testMap: [string, string][] = [
      ['vitest', 'Vitest'],
      ['jest', 'Jest'],
      ['mocha', 'Mocha'],
      ['@jasmine/core', 'Jasmine'],
      ['jasmine', 'Jasmine'],
      ['ava', 'AVA'],
      ['playwright', 'Playwright'],
      ['@playwright/test', 'Playwright'],
      ['cypress', 'Cypress'],
    ];
    for (const [dep, label] of testMap) if (!testFramework && deps[dep]) testFramework = label;

    const buildMap: [string, string][] = [
      ['typescript', 'tsc'],
      ['vite', 'Vite'],
      ['webpack', 'webpack'],
      ['esbuild', 'esbuild'],
      ['rollup', 'rollup'],
      ['tsup', 'tsup'],
      ['turbo', 'Turborepo'],
      ['nx', 'Nx'],
    ];
    for (const [dep, label] of buildMap) if (!buildTool && deps[dep]) buildTool = label;
  }

  // Config files are evidence too: a test runner or transpiler declared only by its config.
  const configProbes: [string, () => void][] = [
    ['vitest.config.ts', () => (testFramework = testFramework ?? 'Vitest')],
    ['vitest.config.js', () => (testFramework = testFramework ?? 'Vitest')],
    ['jest.config.js', () => (testFramework = testFramework ?? 'Jest')],
    ['jest.config.ts', () => (testFramework = testFramework ?? 'Jest')],
    ['playwright.config.ts', () => (testFramework = testFramework ?? 'Playwright')],
    ['cypress.config.ts', () => (testFramework = testFramework ?? 'Cypress')],
    ['tsconfig.json', () => (language = 'TypeScript')],
    ['vite.config.ts', () => (buildTool = buildTool ?? 'Vite')],
    ['turbo.json', () => (buildTool = buildTool ?? 'Turborepo')],
    ['nx.json', () => (buildTool = buildTool ?? 'Nx')],
  ];
  for (const [probe, apply] of configProbes) {
    for (const root of roots) {
      const rel = root === '.' ? probe : path.posix.join(root, probe);
      if (await checkExists(rel)) apply();
    }
  }

  // Lockfiles: the first one found anywhere decides the package manager.
  const managerProbes: [string, string][] = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['bun.lockb', 'bun'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
  ];
  for (const [probe, manager] of managerProbes) {
    if (packageManager) break;
    for (const root of roots) {
      const rel = root === '.' ? probe : path.posix.join(root, probe);
      if (await checkExists(rel)) {
        packageManager = manager;
        break;
      }
    }
  }
  if (sawAnyManifest && !packageManager) packageManager = 'npm';

  // --- other ecosystems, at the root or inside a workspace -------------------------------------
  if (!sawAnyManifest) {
    const ecosystems: [string, string, string, string][] = [
      ['Cargo.toml', 'Rust', 'cargo', 'cargo test'],
      ['go.mod', 'Go', 'go mod', 'go test'],
      ['pom.xml', 'Java', 'maven', 'mvn test'],
      ['build.gradle', 'Java', 'gradle', 'gradle test'],
      ['build.gradle.kts', 'Kotlin', 'gradle', 'gradle test'],
    ];
    for (const [manifest, lang, manager, test] of ecosystems) {
      if (await checkExists(manifest)) {
        language = lang;
        packageManager = manager;
        buildTool = manager;
        testFramework = test;
        break;
      }
    }
    if (language === 'unknown' && (await existsUnder(cwd, 'go.work'))) {
      language = 'Go';
      packageManager = 'go';
      buildTool = 'go';
      testFramework = 'go test';
    }
    if (language === 'unknown' && ((await checkExists('pyproject.toml')) || (await checkExists('requirements.txt')))) {
      language = 'Python';
      packageManager = (await checkExists('poetry.lock')) ? 'poetry' : (await checkExists('uv.lock')) ? 'uv' : 'pip';
    }
    if (language === 'unknown') {
      const dotnetSolution = (await walkFiles(cwd, (fileName) => fileName.endsWith('.sln'), 2))[0];
      if (dotnetSolution) {
        language = 'C#';
        packageManager = 'dotnet';
        buildTool = 'dotnet';
        testFramework = 'dotnet test';
      }
    }
  }

  // --- source and test directories, per root ---------------------------------------------------
  const sourceDirs: string[] = [];
  for (const root of roots) {
    for (const dir of ['src', 'lib', 'app', 'core', 'source']) {
      const rel = root === '.' ? dir : path.posix.join(root, dir);
      if (await checkExists(rel)) sourceDirs.push(rel);
    }
  }

  const testDirs: string[] = [];
  for (const root of roots) {
    for (const dir of ['test', 'tests', '__tests__', 'spec', 'e2e']) {
      const rel = root === '.' ? dir : path.posix.join(root, dir);
      if (await checkExists(rel)) testDirs.push(rel);
    }
  }

  const modules: string[] = [];
  for (const sDir of sourceDirs) {
    try {
      const entries = await readdir(path.join(cwd, sDir), { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) modules.push(entry.name);
      }
    } catch {
      // unreadable directory: reported by absence, not guessed
    }
  }
  // No fabricated fallback: a module named 'core' that nobody observed would be cited as evidence
  // of an existing boundary. When a source directory has no subdirectories the boundary is that
  // directory itself, which the constitution uses as its fallback.

  return {
    name,
    language,
    frameworks: Array.from(frameworks).sort(),
    ...(packageManager ? { packageManager } : {}),
    ...(buildTool ? { buildTool } : {}),
    ...(testFramework ? { testFramework } : {}),
    sourceDirs,
    testDirs,
    modules: Array.from(new Set(modules)).sort(),
    ...(workspaceRoots.size > 0 ? { workspaceRoots: Array.from(workspaceRoots).sort() } : {}),
    declaredModules,
    unreadableToolchains,
  };
};

export const bootstrapSteering = async (
  cwd: string = process.cwd(),
  project?: DiscoveredProject,
  sddDir?: string,
): Promise<{ steeringDir: string; filesCreated: string[] }> => {
  const resolvedDir = sddDir ?? (await resolveSddDir(cwd));
  const steeringDir = path.join(cwd, resolvedDir, 'steering');
  await mkdir(steeringDir, { recursive: true });

  const proj = project ?? (await scanProject(cwd));
  const filesCreated: string[] = [];

  const checkAndWrite = async (file: string, content: string) => {
    const fullPath = path.join(steeringDir, file);
    try {
      await stat(fullPath);
      // exists: do not overwrite existing steering
    } catch {
      await writeFile(fullPath, content, 'utf8');
      filesCreated.push(file);
    }
  };

  // product.md
  const productMd = `# Product Steering: ${proj.name}

## Mission & Purpose
Reverse-engineered architecture foundation for ${proj.name}.

## Domain Boundaries
- Core Application: ${proj.name}
- Detected Modules: ${proj.modules.length > 0 ? proj.modules.join(', ') : 'Standard architecture'}
`;
  await checkAndWrite('product.md', productMd);

  // tech.md
  const techMd = `# Technical Steering: ${proj.name}

## Architecture & Technology Stack
- **Primary Language**: ${proj.language}
- **Frameworks**: ${proj.frameworks.length > 0 ? proj.frameworks.join(', ') : 'Standard standard library'}
- **Package Manager**: ${proj.packageManager ?? 'Native'}
- **Testing Framework**: ${proj.testFramework ?? 'Native test runner'}

## Development Conventions
- Strict boundaries: modifications must stay within task \`_Boundary:_\` definitions.
- TDD required: tests written before implementation code.
- Zero-Trust validation: all specs require review and validation gates before release.
`;
  await checkAndWrite('tech.md', techMd);

  // structure.md
  const structureMd = `# Structure Steering: ${proj.name}

## Directory Topology
- Source directories: ${proj.sourceDirs.length > 0 ? proj.sourceDirs.join(', ') : 'Root'}
- Test directories: ${proj.testDirs.length > 0 ? proj.testDirs.join(', ') : 'test/'}
- Specifications: \`${resolvedDir}/specs/\`
- Persistent Steering: \`${resolvedDir}/steering/\`
`;
  await checkAndWrite('structure.md', structureMd);

  return { steeringDir, filesCreated };
};

export const bootstrapSpecSeeds = async (
  cwd: string = process.cwd(),
  focus?: string,
  sddDir?: string,
): Promise<{ seedsCreated: string[] }> => {
  const resolvedDir = sddDir ?? (await resolveSddDir(cwd));
  const proj = await scanProject(cwd);
  const targets = focus ? [focus] : proj.modules.slice(0, 5); // Limit initial batch to top 5 modules

  const seedsCreated: string[] = [];
  for (const target of targets) {
    const slug = target
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (!slug) continue;

    const res = await initSpec(cwd, slug, {
      title: `Reverse-engineered: ${target}`,
      sddDir: resolvedDir,
      createBranch: false,
    });

    seedsCreated.push(slug);
  }

  return { seedsCreated };
};
