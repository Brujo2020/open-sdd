/**
 * Contratos de ejecución: el oráculo de regresión (paper §12; «SDD en Proyectos Brownfield»).
 *
 * El primer uso de la especificación extraída no es documentar: es PROTEGER lo que no debe cambiar.
 * Un contrato de ejecución es exactamente eso, escrito de forma que CI pueda ejecutarlo — la prueba
 * que cubre un comportamiento, y los ficheros que ese comportamiento protege. En modernización de
 * legacy son la diferencia entre un cambio revisable y una reescritura silenciosa.
 *
 * ── Las dos mitades, y por qué ambas importan ───────────────────────────────────────────────────
 *   DESCUBIERTOS  Un fichero de test cuyo nombre corresponde al de un fichero cambiado ya es, de
 *                 hecho, un contrato: nadie lo declaró, pero existe y CI lo ejecuta.
 *   DECLARADOS    La delta nombra las pruebas que cubren el comportamiento que toca. Una entrada
 *                 REMOVED que declara contratos que no existen en el conjunto extraído es un ERROR:
 *                 el oráculo promete una protección que no está.
 *
 * ── El agujero se informa, no se esconde ────────────────────────────────────────────────────────
 * `uncoveredChanges` es el hueco honesto del oráculo: ficheros cambiados sin ningún contrato que los
 * cubra. Esconderlo (o peor, contarlo como cubierto por el simple hecho de que la suite pasa) es el
 * fallo que este módulo existe para evitar. `verifyContracts` nunca declara satisfecho un conjunto al
 * que le faltan contratos declarados, aunque el comando haya salido con código 0.
 *
 * Los textos visibles para el usuario son español, como el resto del CLI.
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { DeltaSpec } from './deltaSpec.js';
import { scanProject } from './reverseEngineering.js';

export interface ExecutionContract {
  id: string;
  description: string;
  /** The test that protects the behaviour: "path/to/file.test.ts" or "path::test name". */
  test: string;
  /** Source files/behaviours this contract protects. */
  protects: string[];
  source: 'delta' | 'discovered';
}

export interface ContractSet {
  feature: string;
  /** The command CI runs. Detected from the project scan (testFramework). */
  testCommand: string;
  contracts: ExecutionContract[];
  /** Changed files with no covering contract: the honest hole in the oracle. */
  uncoveredChanges: string[];
  complete: boolean;
  detail: string;
}

export interface ExtractContractsInput {
  cwd: string;
  feature?: string;
  changedFiles: string[];
  delta?: DeltaSpec;
  testDirs?: string[];
  testFramework?: string;
}

export interface ContractRun {
  exitCode: number;
  stdout: string;
  failedTests?: string[];
}

export interface ContractVerification {
  satisfied: boolean;
  failed: string[];
  missing: string[];
  detail: string;
}

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|kt|rs)$/;
const TEST_FILE_RE = /\.(test|spec)\.[a-z]+$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.turbo']);
const MAX_TEST_FILES = 2000;

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');
const stem = (p: string): string => norm(p).replace(SOURCE_EXT, '');

/** Comando que CI ejecuta, derivado del framework detectado. Derivado, no verificado. */
export const testCommandFor = (testFramework?: string): { command: string; derived: boolean } => {
  const framework = (testFramework ?? '').trim();
  if (/vitest/i.test(framework)) return { command: 'npx vitest run', derived: true };
  if (/jest/i.test(framework)) return { command: 'npx jest', derived: true };
  if (/mocha/i.test(framework)) return { command: 'npx mocha', derived: true };
  return { command: 'npm test', derived: false };
};

/** Nombre del fichero donde el conjunto de contratos se publica para CI. */
export const contractsFileName = (): string => 'contracts.json';

/** Un fichero cambiado es «test» si su nombre lo dice o si vive en un directorio de tests. */
const isTestFile = (file: string, testDirs: string[]): boolean => {
  if (TEST_FILE_RE.test(file)) return true;
  return testDirs.some((dir) => {
    const d = norm(dir).replace(/\/$/, '');
    return norm(file) === d || norm(file).startsWith(`${d}/`);
  });
};

const testStemOf = (file: string): string => {
  const base = path.posix.basename(stem(file));
  return base.replace(/[._-](test|spec)$/i, '').replace(/(Test|Spec)$/, '');
};

const fileMatchesTarget = (file: string, target: string): boolean => {
  const f = norm(file);
  const t = norm(target).replace(/::.*$/, '').trim();
  if (!t) return false;
  if (f === t || f.endsWith(`/${t}`) || t.endsWith(`/${f}`)) return true;
  if (stem(f) === stem(t)) return true;
  if (f.split('/').includes(t)) return true;
  if (path.posix.basename(stem(f)) === t) return true;
  return false;
};

/**
 * ¿La prueba declarada corresponde a una prueba extraída del repositorio?
 *
 * Coincidencia por ruta (exacta, por cola o por segmento). NO se compara solo el nombre base: un
 * contrato declarado `test/auth/session.test.ts` que solo existe como `test/other/session.test.ts` no
 * está cubierto, y dar por presente la prueba equivocada vaciaría de sentido a `missing`.
 */
const declaredMatchesTest = (declared: string, extractedTest: string): boolean =>
  fileMatchesTarget(extractedTest, declared);

interface TestWalk {
  files: string[];
  unreadable: { dir: string; reason: string }[];
  truncated: boolean;
}

const walkTestDirs = async (cwd: string, testDirs: string[]): Promise<TestWalk> => {
  const files: string[] = [];
  const unreadable: { dir: string; reason: string }[] = [];
  let truncated = false;

  const walk = async (rel: string, depth: number): Promise<void> => {
    if (truncated || depth > 8) return;
    let entries;
    try {
      entries = await readdir(path.join(cwd, rel), { withFileTypes: true });
    } catch (err) {
      unreadable.push({ dir: rel, reason: (err as Error).message });
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(child, depth + 1);
      } else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
        if (files.length >= MAX_TEST_FILES) {
          truncated = true;
          return;
        }
        files.push(norm(child));
      }
    }
  };

  for (const dir of testDirs) await walk(norm(dir), 0);
  return { files, unreadable, truncated };
};

const sanitize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

/**
 * Extraer el conjunto de contratos de ejecución de un cambio.
 *
 * Honestidad sobre la cobertura: `complete` es falso cuando la extracción NO pudo inspeccionar lo que
 * debía (directorios de test ilegibles, límite de recorrido) o cuando una entrada REMOVED declara
 * contratos que no existen. Los huecos de cobertura van en `uncoveredChanges`; un MODIFIED sin
 * contratos es un aviso de que el oráculo está incompleto para esa entrada.
 */
export const extractContracts = async (input: ExtractContractsInput): Promise<ContractSet> => {
  const cwd = input.cwd;
  const notes: string[] = [];
  let complete = true;

  const project = await scanProject(cwd);
  const testDirs = input.testDirs ?? project.testDirs;
  const testFramework = input.testFramework ?? project.testFramework;
  const changedFiles = Array.from(new Set(input.changedFiles.map(norm))).sort();
  const feature = input.feature ?? input.delta?.feature ?? 'sin-feature';

  const derived = testCommandFor(testFramework);
  notes.push(
    derived.derived
      ? `Comando de test derivado del framework detectado (${testFramework}), no verificado ejecutándolo: \`${derived.command}\`.`
      : `No se detectó framework de test: se propone \`${derived.command}\` como comando por defecto; es una suposición, no una verificación.`,
  );

  // ── Contratos descubiertos ──────────────────────────────────────────────────────────────────
  const walk: TestWalk =
    testDirs.length > 0 ? await walkTestDirs(cwd, testDirs) : { files: [], unreadable: [], truncated: false };

  if (testDirs.length === 0) {
    notes.push(
      'No se detectó ningún directorio de test: no hay contratos descubiertos que extraer. Esto no es un aprobado, es la ausencia de oráculo.',
    );
  }
  for (const bad of walk.unreadable) {
    complete = false;
    notes.push(
      `No se pudo leer el directorio de test ${bad.dir} (${bad.reason}): el oráculo queda sin inspeccionar en esa parte y no se declara completo.`,
    );
  }
  if (walk.truncated) {
    complete = false;
    notes.push(`Se superó el límite de ${MAX_TEST_FILES} ficheros de test: la extracción no fue exhaustiva.`);
  }

  const changedSources = changedFiles.filter((file) => !isTestFile(file, testDirs));
  const discoveredByTest = new Map<string, Set<string>>();

  for (const test of walk.files) {
    const testStem = testStemOf(test).toLowerCase();
    for (const source of changedSources) {
      const base = path.posix.basename(stem(source)).toLowerCase();
      if (!base) continue;
      const matches = testStem === base || testStem.includes(base) || path.posix.basename(stem(test)).toLowerCase().includes(base);
      if (!matches) continue;
      const set = discoveredByTest.get(test) ?? new Set<string>();
      set.add(source);
      discoveredByTest.set(test, set);
    }
  }

  const contracts: ExecutionContract[] = [];
  for (const [test, protects] of Array.from(discoveredByTest.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const files = Array.from(protects).sort();
    contracts.push({
      id: `CT-${sanitize(test)}`,
      description: `Contrato descubierto: ${test} cubre ${files.join(', ')}.`,
      test,
      protects: files,
      source: 'discovered',
    });
  }

  // ── Contratos declarados en la delta ────────────────────────────────────────────────────────
  const declaredByTest = new Map<string, { protects: Set<string>; entries: string[] }>();
  const missingDeclared: string[] = [];
  const discoveredTests = Array.from(discoveredByTest.keys());

  if (input.delta) {
    for (const entry of input.delta.entries) {
      const declared = entry.contracts ?? [];
      if (entry.kind === 'MODIFIED' && declared.length === 0) {
        notes.push(
          `Aviso: la entrada MODIFIED ${entry.id} no declara contratos; el oráculo está incompleto para esa entrada y su comportamiento modificado no queda protegido por nada declarado.`,
        );
      }
      for (const test of declared) {
        const key = norm(test);
        const existing = declaredByTest.get(key) ?? { protects: new Set<string>(), entries: [] };
        for (const target of entry.targets) existing.protects.add(target);
        existing.entries.push(entry.id);
        declaredByTest.set(key, existing);
      }
    }

    // Una REMOVED que declara contratos inexistentes promete una protección que no está: es un error
    // de extracción, no un detalle cosmético.
    for (const entry of input.delta.entries) {
      if (entry.kind !== 'REMOVED') continue;
      for (const test of entry.contracts ?? []) {
        const backed = discoveredTests.some((extracted) => declaredMatchesTest(test, extracted));
        if (!backed) missingDeclared.push(test);
      }
    }
  }

  for (const [test, info] of Array.from(declaredByTest.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    contracts.push({
      id: `DC-${sanitize(test)}`,
      description: `Contrato declarado en la delta (${info.entries.join(', ')}): ${test}.`,
      test,
      protects: Array.from(info.protects).sort(),
      source: 'delta',
    });
  }

  if (missingDeclared.length > 0) {
    complete = false;
    notes.push(
      `ERROR: ${missingDeclared.length} contrato(s) declarado(s) por entradas REMOVED no existen en el conjunto extraído: ${Array.from(new Set(missingDeclared)).join(', ')}. La delta promete una protección que el repositorio no tiene.`,
    );
  }

  // ── El hueco: cambios sin contrato ──────────────────────────────────────────────────────────
  const uncoveredChanges = changedSources
    .filter((file) => !contracts.some((contract) => contract.protects.some((p) => fileMatchesTarget(file, p))))
    .sort();

  if (uncoveredChanges.length > 0) {
    notes.push(
      `${uncoveredChanges.length} fichero(s) cambiado(s) sin ningún contrato que los cubra: ${uncoveredChanges.join(', ')}. Es el hueco del oráculo y se informa tal cual.`,
    );
  } else if (changedSources.length > 0) {
    notes.push(`Todos los ficheros fuente cambiados (${changedSources.length}) tienen al menos un contrato.`);
  }

  if (!input.delta) {
    notes.push('Sin delta no hay contratos declarados: el conjunto solo contiene contratos descubiertos.');
  }

  const declared = contracts.filter((c) => c.source === 'delta').length;
  const discovered = contracts.length - declared;
  const detail = [
    `Contratos de ejecución de "${feature}": ${contracts.length} contrato(s) (${discovered} descubierto(s), ${declared} declarado(s)); ${uncoveredChanges.length} fichero(s) cambiado(s) sin cobertura.`,
    ...notes,
  ].join(' ');

  return { feature, testCommand: derived.command, contracts, uncoveredChanges, complete, detail };
};

/**
 * Verificar el conjunto contra el resultado de una ejecución.
 *
 * `satisfied` exige las dos cosas: que el comando haya salido con 0 Y que todos los contratos
 * declarados existan en el conjunto. Un código de salida 0 nunca convierte en aprobado un oráculo al
 * que le faltan protecciones declaradas.
 */
export const verifyContracts = (set: ContractSet, run: ContractRun): ContractVerification => {
  const declared = set.contracts.filter((c) => c.source === 'delta');
  const discovered = set.contracts.filter((c) => c.source === 'discovered');
  const declaredTests = declared.map((c) => c.test);

  const missing = Array.from(
    new Set(declaredTests.filter((test) => !discovered.some((d) => declaredMatchesTest(test, d.test)))),
  );

  const namedFailures = run.failedTests ?? [];
  const failed = Array.from(
    new Set(declaredTests.filter((test) => namedFailures.some((f) => declaredMatchesTest(test, f)))),
  );
  const unexplainedFailures = namedFailures.filter(
    (f) => !declared.some((c) => declaredMatchesTest(c.test, f)) && !discovered.some((d) => declaredMatchesTest(d.test, f)),
  );

  const satisfied = run.exitCode === 0 && missing.length === 0;
  const lines: string[] = [];

  if (run.exitCode === 0) {
    lines.push(`El comando \`${set.testCommand}\` salió con código 0.`);
  } else {
    lines.push(`El comando \`${set.testCommand}\` salió con código ${run.exitCode}: la ejecución NO pasó.`);
  }

  if (missing.length > 0) {
    lines.push(
      `Contratos declarados que no existen en el conjunto extraído: ${missing.join(', ')}. Un código de salida 0 con contratos declarados ausentes no es un aprobado.`,
    );
  }

  if (failed.length > 0) {
    lines.push(`Contratos declarados que fallaron: ${failed.join(', ')}.`);
  }

  if (namedFailures.length > 0) {
    lines.push(`Pruebas que fallaron según la ejecución: ${namedFailures.join(', ')}.`);
  } else if (run.exitCode !== 0) {
    lines.push('La salida del comando no identificó las pruebas que fallaron: no se puede nombrar el fallo, solo el código de salida.');
  } else {
    lines.push('El comando no identificó pruebas que fallaran.');
  }

  if (unexplainedFailures.length > 0) {
    lines.push(`Fallos no atribuibles a un contrato de este conjunto: ${unexplainedFailures.join(', ')}.`);
  }

  if (declared.length === 0) {
    lines.push(
      'El conjunto no declara contratos: el código de salida es la única señal disponible y no demuestra que lo que debía protegerse siga intacto.',
    );
  }

  lines.push(satisfied ? 'Veredicto: contratos satisfechos.' : 'Veredicto: contratos NO satisfechos.');

  return { satisfied, failed, missing, detail: lines.join(' ') };
};
