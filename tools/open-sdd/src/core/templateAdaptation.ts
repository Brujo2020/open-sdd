/**
 * Templates adapted to the detected stack (spec-kit §«Creates templates adapted to specific tech
 * stack and coding style», github/spec-kit issue #1436).
 *
 * The tool ships GENERIC templates in `templates/shared/settings/templates/specs/`. A brownfield
 * repository is not generic: it has one real test runner, real source and test directories, and real
 * module roots. A template that names none of them is a template that lies — the agent reading it
 * has to guess where tests live and which command proves the change, and the guess is where the
 * discipline is lost.
 *
 * ── The rule that governs every substitution ────────────────────────────────────────────────────
 * ADAPTATION IS EVIDENCE, NOT DECORATION. Every value substituted into a template names the file that
 * demonstrates it, and that pair is recorded in `adaptedFrom` (`«comando de test: npm test» ←
 * package.json (raíz): script "test" = "vitest run"`). Everything left as a `{{PLACEHOLDER}}` is
 * listed in `unchanged`, with the reason it could not be derived. A silent placeholder is
 * indistinguishable from a decision made by mistake, so there are none.
 *
 * ── TDD only where there is an oracle ───────────────────────────────────────────────────────────
 * When a test runner is observed, the tasks template carries the red-green cycle on EVERY task line:
 * the test to write first, the command that must fail, the implementation, the command that must
 * pass — using only commands the repository declares (a `test`/`test:*` script, or the native
 * command of a non-Node toolchain such as `cargo test`). When no runner is observed, the template
 * says so and emits NO cycle: a red-green cycle whose command nobody declared is a promise with no
 * oracle behind it. When a runner IS observed but no script declares a command, the template names
 * the runner, names no command, and lists the derived candidate as explicitly NOT verified.
 *
 * ── Never overwrite ─────────────────────────────────────────────────────────────────────────────
 * `write` creates a template only where nothing exists and reports `keep` otherwise, mirroring
 * `planBootstrap`'s artifact actions. The target directory is
 * `<sddDir>/settings/templates/brownfield/`, NOT `.../templates/specs/`: the latter holds the
 * generic templates the install copied in, which are the project's own and are never replaced by an
 * adapted version without a human deciding to.
 *
 * Visible texts are Spanish, like the rest of the CLI.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildModuleMap, type ModuleMapEntry } from './bootstrap.js';
import {
  resolveBoundaries,
  scanProject,
  type BoundarySet,
  type ProjectScan,
} from './reverseEngineering.js';
import { resolveSddDir } from './specManager.js';

export type AdaptedTemplateKind = 'requirements' | 'plan' | 'tasks';

export interface AdaptedTemplate {
  kind: AdaptedTemplateKind;
  /** Repository-relative target path (POSIX separators). */
  path: string;
  content: string;
  /** Substitution → the observation that justifies it. Empty would mean a template with no evidence. */
  adaptedFrom: string[];
  /** Parts left as `{{PLACEHOLDER}}`, each with the reason it could not be derived. */
  unchanged: string[];
  rationale: string;
}

/** `create`/`keep` per template, with the reason — the same vocabulary `planBootstrap` uses. */
export interface TemplateAction {
  path: string;
  action: 'create' | 'keep';
  reason: string;
}

export interface TemplateAdaptationResult {
  templates: AdaptedTemplate[];
  /** Paths actually written by this call (only when `write: true` and nothing was there). */
  written: string[];
  actions: TemplateAction[];
  complete: boolean;
  detail: string;
}

export interface AdaptTemplatesInput {
  cwd: string;
  /** Module map from the caller, so the plan does not rebuild it. */
  modules?: ModuleMapEntry[];
  write?: boolean;
}

/**
 * Where the adapted templates land, RELATIVE to the resolved SDD directory. Deliberately not
 * `settings/templates/specs`: that directory holds the generic templates the install copied in, and
 * they are the project's own — an adapted version never replaces them without a human deciding to.
 */
export const ADAPTED_TEMPLATE_DIR = path.posix.join('settings', 'templates', 'brownfield');

/** File each kind is written to. `plan.md` is an accepted alias of `design.md` in the triad. */
export const ADAPTED_TEMPLATE_FILE: Record<AdaptedTemplateKind, string> = {
  requirements: 'requirements.md',
  plan: 'plan.md',
  tasks: 'tasks.md',
};

const exists = async (p: string): Promise<boolean> => (await stat(p).catch(() => null)) !== null;

const posix = (value: string): string => value.split(path.sep).join('/');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

interface DeclaredScript {
  /** `.` for the repository root, the module path otherwise. */
  scope: string;
  manifest: string;
  name: string;
  command: string;
}

interface DependencyHit {
  manifest: string;
  field: string;
  name: string;
}

/** `[surface in the command, canonical runner label]`. */
const RUNNER_LABELS: [RegExp, string][] = [
  [/vitest/i, 'Vitest'],
  [/jest/i, 'Jest'],
  [/\bmocha\b/i, 'Mocha'],
  [/playwright/i, 'Playwright'],
  [/cypress/i, 'Cypress'],
  [/\bava\b/i, 'AVA'],
  [/jasmine/i, 'Jasmine'],
  [/pytest/i, 'pytest'],
  [/rspec/i, 'RSpec'],
];

/** Dependency that declares each runner label, for the evidence string. */
const RUNNER_DEPENDENCIES: Record<string, string[]> = {
  Vitest: ['vitest'],
  Jest: ['jest'],
  Mocha: ['mocha'],
  Playwright: ['@playwright/test', 'playwright'],
  Cypress: ['cypress'],
  AVA: ['ava'],
  Jasmine: ['jasmine', '@jasmine/core'],
};

/**
 * Candidate command when a runner is observed in the dependencies but NO script declares it. It is
 * reported as derived and NOT verified, and never used as the red/green command.
 */
const DERIVED_RUNNER_COMMAND: Record<string, string> = {
  Vitest: 'npx vitest run',
  Jest: 'npx jest',
  Mocha: 'npx mocha',
  Playwright: 'npx playwright test',
  Cypress: 'npx cypress run',
  AVA: 'npx ava',
  Jasmine: 'npx jasmine',
};

/** Native test commands: the toolchain command is the declared interface of the ecosystem. */
const NATIVE_TEST_COMMAND = /^(go test|cargo test|mvn test|gradle test|\.?\/?gradlew test|dotnet test|pytest|ctest)$/i;

const readManifests = async (
  cwd: string,
  modules: ModuleMapEntry[],
): Promise<{ scripts: DeclaredScript[]; dependencies: DependencyHit[] }> => {
  const scripts: DeclaredScript[] = [];
  const dependencies: DependencyHit[] = [];

  const read = async (rel: string, scope: string): Promise<void> => {
    const raw = await readFile(path.join(cwd, rel), 'utf8').catch(() => null);
    if (raw === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(parsed)) return;
    if (isRecord(parsed.scripts)) {
      for (const [name, command] of Object.entries(parsed.scripts)) {
        if (typeof command === 'string' && command.trim()) {
          scripts.push({ scope, manifest: rel, name, command: command.trim() });
        }
      }
    }
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const declared = parsed[field];
      if (!isRecord(declared)) continue;
      for (const name of Object.keys(declared)) dependencies.push({ manifest: rel, field, name });
    }
  };

  await read('package.json', '.');
  for (const module of modules) {
    if (module.path === '.') continue;
    await read(`${module.path}/package.json`, module.path);
  }
  return { scripts, dependencies };
};

/** Lower rank = better test script. Watch modes are excluded: they never terminate. */
const scriptRank = (script: DeclaredScript): number | null => {
  if (/watch/i.test(script.name)) return null;
  if (/--watch\b|\s-w\b/.test(script.command)) return null;
  if (script.name === 'test') return 0;
  if (script.name === 'tests') return 1;
  if (/^test:/.test(script.name)) return 2;
  if (/(^|:)tests?(:|$)/.test(script.name)) return 3;
  return null;
};

interface RunnerInfo {
  label?: string;
  labelEvidence?: string;
  /** Command the red/green cycle uses. Absent when nothing declares it. */
  command?: string;
  commandEvidence?: string;
  /** Declared script command, verbatim, when the invocation wraps a script. */
  declaredCommand?: string;
  derivedCandidate?: string;
  /** True only when a command is available, so a cycle can be emitted honestly. */
  hasCycle: boolean;
}

const deriveInvocation = (packageManager: string, scope: string, name: string): string => {
  const pm = ['npm', 'pnpm', 'yarn', 'bun'].includes(packageManager) ? packageManager : 'npm';
  const base = name === 'test' && pm !== 'bun' ? `${pm} test` : `${pm} run ${name}`;
  return scope === '.' ? base : `(cd ${scope} && ${base})`;
};

const resolveRunner = async (
  project: ProjectScan,
  scripts: DeclaredScript[],
  dependencies: DependencyHit[],
): Promise<{ runner: RunnerInfo; discarded: string[] }> => {
  const discarded: string[] = [];
  const candidates: { script: DeclaredScript; rank: number }[] = [];
  for (const script of scripts) {
    const rank = scriptRank(script);
    if (rank === null) {
      if (/(^|:)tests?(:|$)/.test(script.name)) {
        discarded.push(`script "${script.name}" en ${script.manifest} descartado: un modo watch no termina y no sirve como rojo/verde`);
      }
      continue;
    }
    candidates.push({ script, rank });
  }
  candidates.sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.script.scope === '.' ? 0 : 1) - (b.script.scope === '.' ? 0 : 1) ||
      a.script.scope.localeCompare(b.script.scope) ||
      a.script.name.localeCompare(b.script.name),
  );

  const labelFromCommand = (command: string): string | undefined =>
    RUNNER_LABELS.find(([pattern]) => pattern.test(command))?.[1];

  const chosen = candidates[0];
  if (chosen) {
    const label = project.testFramework ?? labelFromCommand(chosen.script.command);
    const labelEvidence = project.testFramework
      ? `scanProject().testFramework = ${project.testFramework}`
      : `comando del script "${chosen.script.name}" en ${chosen.script.manifest}`;
    return {
      runner: {
        ...(label ? { label } : {}),
        labelEvidence,
        command: deriveInvocation(project.packageManager ?? 'npm', chosen.script.scope, chosen.script.name),
        commandEvidence: `${chosen.script.manifest}: script "${chosen.script.name}" = "${chosen.script.command}"`,
        declaredCommand: chosen.script.command,
        hasCycle: true,
      },
      discarded,
    };
  }

  const framework = project.testFramework;
  if (framework && NATIVE_TEST_COMMAND.test(framework.trim())) {
    const manifest = (project.declaredModules ?? []).find((module) => module.path === '.')?.manifest;
    return {
      runner: {
        label: framework,
        labelEvidence: manifest ? `manifiesto detectado: ${manifest}` : 'scanProject().testFramework',
        command: framework,
        commandEvidence: manifest
          ? `${manifest}: comando nativo del ecosistema (no es un script: lo declara la existencia del manifiesto)`
          : 'comando nativo del ecosistema (derivado de la herramienta detectada)',
        hasCycle: true,
      },
      discarded,
    };
  }

  if (framework) {
    const dependency = RUNNER_DEPENDENCIES[framework]?.find((name) =>
      dependencies.some((hit) => hit.name === name),
    );
    const hit = dependency ? dependencies.find((entry) => entry.name === dependency) : undefined;
    return {
      runner: {
        label: framework,
        labelEvidence: hit ? `${hit.manifest}: ${hit.field}.${hit.name}` : 'scanProject().testFramework',
        ...(DERIVED_RUNNER_COMMAND[framework] ? { derivedCandidate: DERIVED_RUNNER_COMMAND[framework] } : {}),
        hasCycle: false,
      },
      discarded,
    };
  }

  return { runner: { hasCycle: false }, discarded };
};

interface AdaptationFacts {
  project: ProjectScan;
  modules: ModuleMapEntry[];
  boundaries: BoundarySet;
  sddDir: string;
  runner: RunnerInfo;
  discarded: string[];
  /** Repo-relative source/test directories actually observed. */
  sources: string[];
  tests: string[];
}

const ev = (label: string, evidence: string): string => `${label} ← ${evidence}`;

/** A boundary that covers nothing the code shows is not a boundary; it is a guess. */
const observedBoundaryHint = (facts: AdaptationFacts): string =>
  facts.boundaries.boundaries.map((boundary) => `\`${boundary}\``).join(', ');

const boundaryForModule = (module: ModuleMapEntry): string => {
  const sourceOwns = module.owns.filter(
    (own) => !module.testDirs.includes(own) && !/\.(json|xml|toml|mod|py|sln|slnx)$/i.test(own),
  );
  const list = sourceOwns.length > 0 ? sourceOwns : [module.path];
  return list.map((own) => `\`${own}\``).join(', ');
};

const testDirForModule = (facts: AdaptationFacts, module: ModuleMapEntry): string | undefined =>
  module.testDirs[0] ?? (module.path === '.' ? facts.tests[0] : undefined);

/**
 * The module's OWN observed source directory. A module that owns none (a workspace root that only
 * groups packages) gets a placeholder: naming ANOTHER module's directory would be a substitution the
 * repository does not support.
 */
const sourceDirForModule = (facts: AdaptationFacts, module: ModuleMapEntry): string => {
  const owned = module.owns.find(
    (own) => !module.testDirs.includes(own) && facts.sources.includes(own),
  );
  return owned ?? '{{DIRECTORIO_DE_CÓDIGO}}';
};

const commonUnobserved = (facts: AdaptationFacts): string[] => {
  const items: string[] = [
    '`{{TÍTULO}}`, `{{DESCRIPCIÓN_DEL_CAMBIO}}`, `{{FICHERO}}` y `{{CRITERIO_VERIFICABLE}}`: no son observables desde el código; los rellena quien especifica el cambio.',
    'el id del requisito `REQ-AREA-NNN` de cada tarea: la delta del cambio lo define; sustitúyelo por el real (mientras no lo hagas, `open-sdd brownfield analyze` lo reporta como id inexistente, que es lo correcto).',
  ];
  if (!facts.runner.hasCycle) {
    items.push(
      'el ciclo rojo-verde y el comando de test: no se emiten porque ningún manifiesto declara un runner ejecutable (ver la sección «Disciplina rojo-verde»).',
    );
  }
  if (facts.project.frameworks.length === 0) {
    items.push('frameworks: no se observó ninguno en los manifiestos ni en la configuración.');
  }
  if (facts.tests.length === 0) {
    items.push('directorios de test: no se observó ninguno; el test nuevo tendrá que decidir dónde vive.');
  }
  if (facts.modules.length <= 1) {
    items.push('módulos: no se observó ningún workspace ni manifiesto anidado, así que el único módulo es la raíz.');
  }
  return items;
};

// ---------------------------------------------------------------------------------------------
// requirements
// ---------------------------------------------------------------------------------------------

const buildRequirementsTemplate = (facts: AdaptationFacts): AdaptedTemplate => {
  const { project, runner } = facts;
  const evidence: string[] = [];
  const unchanged = commonUnobserved(facts);
  const lines: string[] = [];

  lines.push(`# Plantilla de requisitos (adaptada) — ${project.name}`);
  lines.push('');
  lines.push('<!-- Adaptada por `open-sdd brownfield templates` de la evidencia observada. No es genérica:');
  lines.push('     cada valor nombra el fichero que lo demuestra. Lo no observable está al final, declarado. -->');
  lines.push('');
  lines.push('## Contexto observado');
  lines.push('');
  if (project.language !== 'unknown') {
    lines.push(`- lenguaje: ${project.language}`);
    evidence.push(ev(`«lenguaje: ${project.language}»`, 'scanProject().language (manifiestos y configuración de lenguaje)'));
  }
  if (project.frameworks.length > 0) {
    lines.push(`- frameworks: ${project.frameworks.join(', ')}`);
    evidence.push(ev(`«frameworks: ${project.frameworks.join(', ')}»`, 'scanProject().frameworks (dependencias declaradas)'));
  }
  if (project.packageManager) {
    lines.push(`- gestor de paquetes: ${project.packageManager}`);
    evidence.push(ev(`«gestor de paquetes: ${project.packageManager}»`, 'lockfile observado / package.json'));
  }
  if (project.buildTool) {
    lines.push(`- build: ${project.buildTool}`);
    evidence.push(ev(`«build: ${project.buildTool}»`, 'dependencias y configuración de build observadas'));
  }
  if (runner.label) {
    lines.push(`- runner de test: ${runner.label}${runner.command ? ` — comando \`${runner.command}\`` : ' — sin comando declarado'}`);
    evidence.push(ev(`«runner de test: ${runner.label}»`, runner.labelEvidence ?? 'scanProject().testFramework'));
    if (runner.command) {
      evidence.push(ev(`«comando de test: ${runner.command}»`, runner.commandEvidence ?? 'script declarado en un manifiesto'));
    }
  } else {
    lines.push('- runner de test: no se observó ninguno');
  }
  lines.push(
    `- directorios de código: ${facts.sources.length > 0 ? facts.sources.map((dir) => `\`${dir}\``).join(', ') : 'ninguno observado'}`,
  );
  if (facts.sources.length > 0) {
    evidence.push(ev('«directorios de código»', `scanProject().sourceDirs = ${facts.sources.join(', ')} (existen en disco)`));
  }
  lines.push(
    `- directorios de test: ${facts.tests.length > 0 ? facts.tests.map((dir) => `\`${dir}\``).join(', ') : 'ninguno observado'}`,
  );
  if (facts.tests.length > 0) {
    evidence.push(ev('«directorios de test»', `scanProject().testDirs = ${facts.tests.join(', ')} (existen en disco)`));
  }
  lines.push(`- fronteras (vocabulario único, \`resolveBoundaries\`): ${observedBoundaryHint(facts)}`);
  evidence.push(ev('«fronteras»', `resolveBoundaries(scanProject()) → ${facts.boundaries.boundaries.join(', ')}`));
  lines.push('');
  lines.push('## Formato de requisito (EARS + id de delta)');
  lines.push('');
  lines.push('En brownfield el identificador es propio del cambio: `REQ-<ÁREA>-<NNN>` (por ejemplo `REQ-AUTH-001`),');
  lines.push('nunca un identificador del sistema completo. El enunciado es EARS y cada requisito declara sus');
  lines.push('objetivos (los ficheros que toca) para que el análisis de impacto sea posible.');
  lines.push('');
  lines.push('### REQ-<ÁREA>-001 — {{TÍTULO}}');
  lines.push('- Statement: WHEN {{DISPARO}}, the {{SISTEMA}} shall {{RESPUESTA}}.');
  lines.push(
    `- Targets: \`${facts.sources[0] ?? '{{DIRECTORIO_DE_CÓDIGO}}'}/{{FICHERO}}\``,
  );
  if (runner.hasCycle) {
    lines.push(
      `- Contracts: \`${facts.tests[0] ?? '{{DIRECTORIO_DE_TEST}}'}/{{FICHERO}}.test.{{EXT}}\` — la prueba que debe existir para este enunciado`,
    );
  }
  lines.push('- Acceptance criteria:');
  lines.push('  - {{CRITERIO_VERIFICABLE}}');
  lines.push('');
  lines.push('## Fronteras donde puede caer el cambio (evidencia)');
  lines.push('');
  for (const module of facts.modules) {
    lines.push(
      `- \`${module.path}\` — ${module.name}: posee ${module.owns.length > 0 ? module.owns.join(', ') : 'nada observado'}; tests: ${module.testDirs.length > 0 ? module.testDirs.join(', ') : 'no observados'}`,
    );
  }
  lines.push('');
  lines.push('## Qué NO se pudo observar (no se inventa)');
  lines.push('');
  for (const item of unchanged) lines.push(`- ${item}`);

  const content = `${lines.join('\n')}\n`;
  return {
    kind: 'requirements',
    path: path.posix.join(facts.sddDir, ADAPTED_TEMPLATE_DIR, ADAPTED_TEMPLATE_FILE.requirements),
    content,
    adaptedFrom: evidence,
    unchanged,
    rationale:
      'Los requisitos nombran el lenguaje, el runner y los directorios de código y de test REALES, y cada requisito declara sus objetivos dentro de las fronteras observadas: sin eso el análisis de impacto y la trazabilidad se hacen sobre rutas inventadas.',
  };
};

// ---------------------------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------------------------

const buildPlanTemplate = (facts: AdaptationFacts): AdaptedTemplate => {
  const { project, runner } = facts;
  const evidence: string[] = [];
  const unchanged = [
    ...commonUnobserved(facts),
    '`{{DECISIÓN}}`, `{{ALTERNATIVA}}` y `{{RIESGO}}`: son decisiones de diseño, no hechos del código.',
    'las estimaciones y el orden de ejecución: dependen del equipo y del calendario, que no se observan.',
  ];
  const lines: string[] = [];

  lines.push(`# Plantilla de plan (adaptada) — ${project.name}`);
  lines.push('');
  lines.push('<!-- Adaptada por `open-sdd brownfield templates` de la evidencia observada. En brownfield el plan');
  lines.push('     parte de la arquitectura que YA existe: los módulos de abajo son los que el código muestra. -->');
  lines.push('');
  lines.push('## Stack observado (hechos, no propuestas)');
  lines.push('');
  lines.push('| Capa | Observado | Evidencia |');
  lines.push('|------|-----------|-----------|');
  lines.push(`| Lenguaje | ${project.language} | manifiestos y configuración de lenguaje |`);
  lines.push(`| Frameworks | ${project.frameworks.length > 0 ? project.frameworks.join(', ') : 'ninguno observado'} | dependencias declaradas |`);
  lines.push(`| Gestor de paquetes | ${project.packageManager ?? 'no observado'} | lockfile / manifiesto |`);
  lines.push(`| Build | ${project.buildTool ?? 'no observado'} | dependencias / configuración |`);
  lines.push(
    `| Tests | ${runner.label ? `${runner.label}${runner.command ? ` — \`${runner.command}\`` : ' (sin comando declarado)'}` : 'no observado'} | manifiestos |`,
  );
  evidence.push(ev('«tabla de stack»', 'scanProject(): language, frameworks, packageManager, buildTool, testFramework'));
  if (runner.command) {
    evidence.push(ev(`«comando de test: ${runner.command}»`, runner.commandEvidence ?? 'script declarado'));
  }
  lines.push('');
  lines.push('## Fronteras y módulos (mapa de responsabilidades observado)');
  lines.push('');
  for (const module of facts.modules) {
    lines.push(`### \`${module.path}\` — ${module.name} (${module.ecosystem})`);
    lines.push(`- posee: ${module.owns.length > 0 ? module.owns.map((own) => `\`${own}\``).join(', ') : 'no se observaron directorios'}`);
    lines.push(
      `- responsabilidades: ${module.responsibilities.length > 0 ? module.responsibilities.join(' · ') : 'ninguna derivable de la evidencia'}`,
    );
    lines.push(`- depende de: ${module.dependsOn.length > 0 ? module.dependsOn.join(', ') : 'ninguno observado'}`);
    lines.push(`- tests: ${module.testDirs.length > 0 ? module.testDirs.join(', ') : 'no se observó directorio de tests'}`);
    lines.push('');
  }
  evidence.push(
    ev(
      '«módulos, responsabilidades y dependsOn»',
      `buildModuleMap(cwd) → ${facts.modules.map((module) => module.path).join(', ')}`,
    ),
  );
  lines.push('## Boundary Commitments (lo que el cambio NO puede absorber)');
  lines.push('');
  lines.push('- Este cambio posee: las rutas de `_Boundary:_` declaradas en las tareas.');
  lines.push(
    `- Fuera de frontera: ${facts.modules.length > 1 ? facts.modules.map((module) => `\`${module.path}\``).join(', ') : 'la raíz del repositorio'}; cruzar una frontera exige declararlo en la delta.`,
  );
  lines.push(
    `- Fronteras observadas: ${observedBoundaryHint(facts)} (vocabulario único \`resolveBoundaries\`).`,
  );
  lines.push('');
  lines.push('## Estructura de ficheros observada');
  lines.push('');
  if (facts.sources.length > 0) {
    for (const dir of facts.sources) lines.push(`- \`${dir}/\` — directorio de código observado`);
  } else {
    lines.push('- No se observó ningún directorio de código convencional.');
  }
  if (facts.tests.length > 0) {
    for (const dir of facts.tests) lines.push(`- \`${dir}/\` — directorio de test observado: aquí vive la prueba que se escribe primero`);
  }
  lines.push('');
  lines.push('## Estrategia de verificación');
  lines.push('');
  if (runner.hasCycle) {
    lines.push(`- runner: ${runner.label}`);
    lines.push(`- comando (rojo primero, verde después): \`${runner.command}\``);
    lines.push('- ninguna decisión de diseño se cierra sin el test que la demuestra en rojo y en verde.');
  } else if (runner.label) {
    lines.push(`- runner observado (${runner.label}) pero sin script \`test\` declarado: no hay comando que ejecutar.`);
    if (runner.derivedCandidate) {
      lines.push(`- candidato derivado, NO verificado: \`${runner.derivedCandidate}\``);
    }
    lines.push('- sin comando declarado no hay oráculo: declara uno antes de dar el plan por bueno.');
  } else {
    lines.push('- No se observó runner de test: no hay oráculo de regresión que citar en el plan.');
    lines.push('- Toda verificación que el plan prometa debe nombrar cómo se ejecuta, y hoy nada lo declara.');
  }
  lines.push('');
  lines.push('## Qué NO se pudo observar (no se inventa)');
  lines.push('');
  for (const item of unchanged) lines.push(`- ${item}`);

  const content = `${lines.join('\n')}\n`;
  return {
    kind: 'plan',
    path: path.posix.join(facts.sddDir, ADAPTED_TEMPLATE_DIR, ADAPTED_TEMPLATE_FILE.plan),
    content,
    adaptedFrom: evidence,
    unchanged,
    rationale:
      'El plan describe los módulos, responsabilidades, dependencias y directorios que el repositorio ya tiene (buildModuleMap + resolveBoundaries), en lugar del árbol de ejemplo genérico, y solo nombra un comando de verificación que un manifiesto declara.',
  };
};

// ---------------------------------------------------------------------------------------------
// tasks
// ---------------------------------------------------------------------------------------------

const buildTasksTemplate = (facts: AdaptationFacts): AdaptedTemplate => {
  const { project, runner } = facts;
  const evidence: string[] = [];
  const unchanged = commonUnobserved(facts);
  const lines: string[] = [];

  lines.push(`# Plantilla de tareas (adaptada) — ${project.name}`);
  lines.push('');
  lines.push('<!-- Adaptada por `open-sdd brownfield templates` de la evidencia observada. Cada tarea lleva el');
  lines.push('     ciclo rojo-verde cuando el repositorio declara un runner; si no, se dice por qué no lo lleva. -->');
  lines.push('');
  lines.push('## Disciplina rojo-verde (TDD)');
  lines.push('');
  if (runner.hasCycle) {
    lines.push(`- runner observado: ${runner.label}`);
    lines.push(`- comando que debe FALLAR primero y pasar después: \`${runner.command}\``);
    if (runner.declaredCommand && runner.declaredCommand !== runner.command) {
      lines.push(`- comando declarado (verbatim): \`${runner.declaredCommand}\``);
    }
    lines.push(
      `- directorios de test observados: ${facts.tests.length > 0 ? facts.tests.map((dir) => `\`${dir}\``).join(', ') : 'ninguno'}`,
    );
    lines.push('- regla: ninguna tarea se cierra sin el rojo (el test nuevo falla) y el verde (el mismo comando pasa).');
    evidence.push(ev(`«comando de test: ${runner.command}»`, runner.commandEvidence ?? 'script declarado en un manifiesto'));
    evidence.push(ev(`«runner: ${runner.label}»`, runner.labelEvidence ?? 'scanProject().testFramework'));
  } else if (runner.label) {
    lines.push(`- runner observado: ${runner.label} (${runner.labelEvidence ?? 'scanProject().testFramework'})`);
    lines.push('- NO se declara ningún script `test`/`test:*` en los manifiestos, así que NO se emite el ciclo rojo-verde: un comando de test aquí sería inventado.');
    if (runner.derivedCandidate) {
      lines.push(`- candidato derivado, NO verificado: \`${runner.derivedCandidate}\`. Si el proyecto lo adopta, que se declare como script y se regenere esta plantilla.`);
    }
    evidence.push(ev(`«runner: ${runner.label}»`, runner.labelEvidence ?? 'scanProject().testFramework'));
    if (runner.derivedCandidate) {
      evidence.push(
        ev(
          `«candidato derivado (NO verificado): ${runner.derivedCandidate}»`,
          'derivación del runner observado; ningún script del repositorio lo declara, por eso no es el comando del ciclo',
        ),
      );
    }
  } else {
    lines.push('- No se observó ningún runner de test: ni script `test`/`test:*` en los manifiestos, ni framework de test en las dependencias.');
    lines.push('- Por eso esta plantilla NO lleva el ciclo rojo-verde: un ciclo sin oráculo que lo ejecute es una promesa vacía.');
  }
  for (const note of facts.discarded) lines.push(`- ${note}`);
  lines.push('');
  lines.push('## Formato de tarea');
  lines.push('');
  if (runner.hasCycle) {
    lines.push('Cada tarea es UNA línea `- [ ]` (la lee `parseTasksMarkdown`), con `_Requirements:_`, `_Boundary:_` y');
    lines.push('`_TDD:_` nombrando el comando real; debajo, el ciclo rojo-verde en cuatro pasos.');
  } else {
    lines.push('Cada tarea es UNA línea `- [ ]` (la lee `parseTasksMarkdown`), con `_Requirements:_` y `_Boundary:_`;');
    lines.push('debajo, la implementación y el cierre. Sin runner no hay paso rojo ni verde que prometer.');
  }
  lines.push('');
  lines.push('## Tareas');
  lines.push('');

  facts.modules.forEach((module, index) => {
    const number = `${index + 1}.1`;
    // The id placeholder is BARE and id-shaped: `traceDelta` reads `_Requirements:_` verbatim, so a
    // braced placeholder would be reported as a phantom id even after being filled correctly.
    const requirement = `REQ-AREA-${String(index + 1).padStart(3, '0')}`;
    const boundary = boundaryForModule(module);
    const testDir = testDirForModule(facts, module);
    lines.push(`### Módulo \`${module.path}\` — ${module.name}`);
    lines.push('');
    // Separated by a SPACE, not by ` — `: `parseTasksMarkdown` captures `_Boundary:_` up to the next
    // underscore, so an em dash before `_TDD:` would leak into the boundary value.
    const tdd = runner.hasCycle ? ` _TDD: rojo primero, verde después: \`${runner.command}\`_` : '';
    lines.push(
      `- [ ] ${number} {{DESCRIPCIÓN_DEL_CAMBIO}} — _Requirements: ${requirement}_ — _Boundary:_ ${boundary}${tdd}`,
    );
    if (runner.hasCycle) {
      if (testDir) {
        lines.push(
          `  - test primero: \`${testDir}/{{FICHERO}}.test.{{EXT}}\` debe expresar el criterio de aceptación de ${requirement} y FALLAR por la razón correcta (no por un error de sintaxis).`,
        );
      } else {
        lines.push(
          `  - test primero: \`{{RUTA_DE_TEST}}/{{FICHERO}}.test.{{EXT}}\` — este módulo no tiene directorio de test observado: decide y declara dónde vive el test antes de escribir código.`,
        );
      }
      lines.push(`  - rojo: \`${runner.command}\` debe fallar.`);
      lines.push(
        `  - implementación: \`${sourceDirForModule(facts, module)}/{{FICHERO}}.{{EXT}}\` en el módulo \`${module.path}\`.`,
      );
      lines.push(`  - verde: \`${runner.command}\` debe pasar, incluidos los tests que ya existían.`);
      if (module.dependsOn.length > 0) {
        lines.push(`  - _Depends:_ ${module.dependsOn.map((dep) => `\`${dep}\``).join(', ')}`);
      }
    } else {
      lines.push(
        `  - implementación: \`${sourceDirForModule(facts, module)}/{{FICHERO}}.{{EXT}}\` en el módulo \`${module.path}\`.`,
      );
      lines.push(
        '  - cierre: {{CÓMO_SE_VERIFICA}} — no hay comando de test declarado, así que la verificación se declara ANTES de implementar.',
      );
      if (module.dependsOn.length > 0) {
        lines.push(`  - _Depends:_ ${module.dependsOn.map((dep) => `\`${dep}\``).join(', ')}`);
      }
    }
    lines.push('');
  });

  if (facts.modules.length > 1) {
    lines.push('### Cambio que cruza módulos');
    lines.push('');
    const requirement = `REQ-AREA-${String(facts.modules.length + 1).padStart(3, '0')}`;
    const crossTdd = runner.hasCycle ? ` _TDD: rojo primero, verde después: \`${runner.command}\`_` : '';
    lines.push(
      `- [ ] ${facts.modules.length + 1}.1 {{DESCRIPCIÓN_DEL_CAMBIO_QUE_CRUZA}} — _Requirements: ${requirement}_ — _Boundary:_ ${facts.boundaries.boundaries.map((boundary) => `\`${boundary}\``).join(', ')}${crossTdd}`,
    );
    if (runner.hasCycle) {
      lines.push(
        `  - test primero: \`${facts.tests[0] ?? '{{DIRECTORIO_DE_TEST}}'}/{{FICHERO}}.test.{{EXT}}\` en el módulo que recibe la dependencia.`,
      );
      lines.push(`  - rojo: \`${runner.command}\` debe fallar.`);
      lines.push('  - implementación: el cambio cruza una frontera; la delta debe declararlo explícitamente.');
      lines.push(`  - verde: \`${runner.command}\` debe pasar.`);
    } else {
      lines.push('  - implementación: el cambio cruza una frontera; la delta debe declararlo explícitamente.');
      lines.push('  - cierre: {{CÓMO_SE_VERIFICA}} — sin runner declarado no hay comando que ejecutar.');
    }
    lines.push('');
  }

  lines.push('## Qué NO se pudo observar (no se inventa)');
  lines.push('');
  for (const item of unchanged) lines.push(`- ${item}`);

  const content = `${lines.join('\n')}\n`;
  const rationale = runner.hasCycle
    ? `Cada tarea nombra el comando REAL (\`${runner.command}\`), el directorio de test observado y el módulo del mapa, y lleva el ciclo rojo-verde incrustado; los módulos sin test observado lo dicen.`
    : runner.label
      ? 'Se observó un runner pero ningún script declara el comando, así que cada tarea lleva la implementación y el cierre, y NO un ciclo rojo-verde con un comando inventado.'
      : 'No se observó runner de test: no se emite ciclo rojo-verde y cada tarea declara cómo se verifica antes de implementar.';
  return {
    kind: 'tasks',
    path: path.posix.join(facts.sddDir, ADAPTED_TEMPLATE_DIR, ADAPTED_TEMPLATE_FILE.tasks),
    content,
    adaptedFrom: evidence,
    unchanged,
    rationale,
  };
};

// ---------------------------------------------------------------------------------------------
// adaptTemplates
// ---------------------------------------------------------------------------------------------

const unreadableResult = (detail: string): TemplateAdaptationResult => ({
  templates: [],
  written: [],
  actions: [],
  complete: false,
  detail,
});

export const adaptTemplates = async (input: AdaptTemplatesInput): Promise<TemplateAdaptationResult> => {
  const { cwd, write } = input;
  let project: ProjectScan;
  try {
    project = await scanProject(cwd);
  } catch (error) {
    return unreadableResult(`No se pudo reconocer el proyecto en ${cwd}: ${(error as Error).message}`);
  }

  let modules = input.modules;
  let mapComplete = true;
  let mapDetail = 'mapa de módulos proporcionado por el llamante (no re-verificado).';
  if (!modules) {
    try {
      const built = await buildModuleMap(cwd);
      modules = built.modules;
      mapComplete = built.complete;
      mapDetail = built.detail;
    } catch (error) {
      return unreadableResult(`No se pudo construir el mapa de módulos: ${(error as Error).message}`);
    }
  }

  const boundaries = resolveBoundaries(project);
  const { scripts, dependencies } = await readManifests(cwd, modules);
  const { runner, discarded } = await resolveRunner(project, scripts, dependencies);
  const sddDir = await resolveSddDir(cwd);

  const facts: AdaptationFacts = {
    project,
    modules,
    boundaries,
    sddDir,
    runner,
    discarded,
    sources: project.sourceDirs.map(posix),
    tests: project.testDirs.map(posix),
  };

  const templates: AdaptedTemplate[] = [
    buildRequirementsTemplate(facts),
    buildPlanTemplate(facts),
    buildTasksTemplate(facts),
  ];

  const actions: TemplateAction[] = [];
  const written: string[] = [];
  const problems: string[] = [];

  for (const template of templates) {
    const absolute = path.join(cwd, template.path);
    if (await exists(absolute)) {
      actions.push({
        path: template.path,
        action: 'keep',
        reason: 'ya existe una plantilla propia en esa ruta: nunca se sobrescribe; la adaptada solo se mostraría',
      });
      continue;
    }
    if (!write) {
      actions.push({
        path: template.path,
        action: 'create',
        reason: 'no existe: `--write` la crearía aquí sin tocar la plantilla genérica de settings/templates/specs',
      });
      continue;
    }
    try {
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, template.content, 'utf8');
      written.push(template.path);
      actions.push({ path: template.path, action: 'create', reason: 'no existía: creada con la evidencia del repositorio' });
    } catch (error) {
      problems.push(`no se pudo escribir ${template.path}: ${(error as Error).message}`);
      actions.push({ path: template.path, action: 'create', reason: `falló la escritura: ${(error as Error).message}` });
    }
  }

  const kept = actions.filter((action) => action.action === 'keep').length;
  const stackObserved = project.language !== 'unknown';
  const runnerText = runner.hasCycle
    ? `ciclo rojo-verde con el comando declarado \`${runner.command}\``
    : runner.label
      ? `runner ${runner.label} observado pero sin comando declarado: sin ciclo rojo-verde`
      : 'sin runner de test observado: sin ciclo rojo-verde';
  const detail = [
    `Plantillas adaptadas: ${templates.length} (${templates.map((template) => template.kind).join(', ')}); ${written.length} escrita(s), ${kept} conservada(s).`,
    `${stackObserved ? 'stack observado' : 'stack NO determinado'}; ${runnerText}; ${modules.length} módulo(s).`,
    mapDetail,
    ...(problems.length > 0 ? [`Problemas: ${problems.join('; ')}`] : []),
  ].join(' ');

  return {
    templates,
    written,
    actions,
    complete: stackObserved && mapComplete && problems.length === 0,
    detail,
  };
};
