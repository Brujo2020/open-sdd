#!/usr/bin/env node
/*
 * open-sdd | pre-commit gate — enforcement level B ("commit"), portable edition.
 *
 * Level B is the floor an organization OWNS: git belongs to no vendor, so this gate ships as plain
 * Node instead of a shell script. Node is already a hard requirement of this tool, so the hook adds
 * no dependency; what it removes is the assumption that a particular shell with a particular dialect
 * exists on the machine that runs a commit.
 *
 * What it runs, in this order:
 *
 *   C1  Triad Integrity      (advisory — never blocks; presence, not sense)
 *   C2  Security Baseline    (blocking — secrets and destructive commands in the staged diff)
 *   C3  Evidence Validation  (blocking when a completed task carries no captured evidence)
 *   ...and then the DECLARED rigor level, quietly, when .sdd/settings/rigor.json exists.
 *
 * It judges the INDEX, not the working tree: --staged makes the gates read what is actually being
 * committed.
 *
 * If the CLI cannot be resolved the gate FAILS CLOSED and says how to fix it. A commit gate that
 * silently degrades to "no checks" is worse than none, because the compliance report still lists it
 * as running — the failure mode the reference architecture documents for level A.
 *
 * To relax a genuine false positive, declare it in .sdd/settings/security-allowlist.json with a
 * reason. The --no-verify flag also bypasses this hook, but that bypass is NOT recorded — the
 * allow-list is the recorded channel, and it is the one an audit can read.
 *
 * WHY THIS FILE HAS NO STATIC IMPORTS AND NO TEMPLATE LITERALS
 * ------------------------------------------------------------
 * The installer copies this file verbatim to <hooksDir>/pre-commit, where it has NO extension. Git
 * for Windows runs hooks through its bundled shell, which honours the shebang and hands the file to
 * Node; Node then decides the module system from the extension. On the declared engine floor
 * (Node 20) an extensionless file is CommonJS, and a static ESM import statement would be a
 * SyntaxError on exactly the platform this gate exists to fix. Dynamic import() is valid in both
 * CommonJS and ESM, so every dependency is loaded that way on purpose. Keep it that way: the test
 * suite asserts this file contains no shell-only constructs, because a regression here is invisible
 * on macOS and Linux and fatal on Windows.
 *
 * There is no POSIX shim and no sh invocation here: arguments are passed as an array with
 * shell: false, and no user-controlled string is ever interpolated into a command line.
 *
 * The Spanish strings are user-facing and deliberate: a developer reads them at the moment a commit
 * is refused.
 */
'use strict';

/*
 * The gate contract. The POSIX fallback template next to this file and this script must agree on
 * it; the test suite parses both and fails if the ids or the flags drift apart.
 */
const GATE_ARGS = ['gates', 'run', 'C1', 'C2', 'C3', '--staged', '--strict'];
const RIGOR_ARGS = ['govern', 'rigor', '--no-drift', '--quiet'];
const RIGOR_SETTINGS = ['.sdd', 'settings', 'rigor.json'];

const emit = (stream, text) => {
  stream.write(text + '\n');
};

const isFile = (fs, candidate) => {
  try {
    return fs.statSync(candidate).isFile();
  } catch (error) {
    return false;
  }
};

const readHead = (fs, candidate) => {
  try {
    return fs.readFileSync(candidate, 'utf8').split(/\r?\n/, 1)[0];
  } catch (error) {
    return null;
  }
};

const JS_ENTRY = /\.(?:mjs|cjs|js)$/i;
const WINDOWS_SHIM = /\.(?:cmd|bat|ps1|exe)$/i;

/*
 * A bin shim (node_modules/.bin/open-sdd, or the global one) is a launcher, not something Node can
 * execute: on POSIX it is a shell script and on Windows it is a .cmd, and handing either straight to
 * Node fails. Resolve the real cli.js the shim points at, from the layouts npm produces.
 */
const resolveShimTarget = (fs, path, shim) => {
  const dir = path.dirname(shim);
  const layouts = [
    ['..', 'open-sdd', 'tools', 'open-sdd', 'dist', 'cli.js'],
    ['..', 'open-sdd', 'dist', 'cli.js'],
    ['..', '@brujo2020', 'open-sdd', 'tools', 'open-sdd', 'dist', 'cli.js'],
    ['..', '@brujo2020', 'open-sdd', 'dist', 'cli.js'],
    ['node_modules', 'open-sdd', 'tools', 'open-sdd', 'dist', 'cli.js'],
    ['node_modules', '@brujo2020', 'open-sdd', 'tools', 'open-sdd', 'dist', 'cli.js'],
    ['..', 'lib', 'node_modules', 'open-sdd', 'tools', 'open-sdd', 'dist', 'cli.js'],
    ['..', 'lib', 'node_modules', '@brujo2020', 'open-sdd', 'tools', 'open-sdd', 'dist', 'cli.js'],
  ];
  for (const layout of layouts) {
    const candidate = path.join(dir, ...layout);
    if (isFile(fs, candidate)) return candidate;
  }
  return null;
};

/*
 * Accept a candidate only when Node can actually run it. An extensionless wrapper that already names
 * node in its shebang is a real entry point; a shell shim is resolved to the script behind it; a
 * Windows batch shim is rejected (Node cannot execute it), so the caller fails closed with a clear
 * message instead of a SyntaxError.
 */
const resolveEntry = (fs, path, candidate) => {
  if (!isFile(fs, candidate)) return null;
  if (JS_ENTRY.test(candidate)) return candidate;
  const viaShim = resolveShimTarget(fs, path, candidate);
  if (viaShim !== null) return viaShim;
  if (WINDOWS_SHIM.test(candidate)) return null;
  const head = readHead(fs, candidate);
  if (head !== null && /^#!.*\bnode\b/.test(head)) return candidate;
  return null;
};

const findOnPath = (fs, path, env, name) => {
  const dirs = (env.PATH === undefined ? '' : env.PATH).split(path.delimiter);
  const suffixes =
    process.platform === 'win32'
      ? (env.PATHEXT === undefined ? '.COM;.EXE;.BAT;.CMD' : env.PATHEXT).split(';')
      : [''];
  for (const dir of dirs) {
    if (dir.length === 0) continue;
    for (const suffix of suffixes) {
      const candidate = path.join(dir, name + suffix);
      if (isFile(fs, candidate)) return candidate;
    }
  }
  return null;
};

/*
 * Resolution order, unchanged from the shell gate: an explicit OPEN_SDD_CLI, then the checkout's own
 * compiled CLI, then the project's node_modules, then a global install. The extra layouts cover the
 * scoped package name the artifact actually ships under, and the bin shim is translated to the real
 * entry point instead of being fed to Node as a shell script.
 */
const CLI_CANDIDATES = [
  ['tools', 'open-sdd', 'dist', 'cli.js'],
  ['node_modules', 'open-sdd', 'tools', 'open-sdd', 'dist', 'cli.js'],
  ['node_modules', 'open-sdd', 'dist', 'cli.js'],
  ['node_modules', '@brujo2020', 'open-sdd', 'tools', 'open-sdd', 'dist', 'cli.js'],
  ['node_modules', '@brujo2020', 'open-sdd', 'dist', 'cli.js'],
  ['node_modules', '.bin', 'open-sdd'],
  ['node_modules', '.bin', 'open-sdd.cmd'],
];

const resolveCli = (fs, path, root, env) => {
  const declared = typeof env.OPEN_SDD_CLI === 'string' ? env.OPEN_SDD_CLI.trim() : '';
  if (declared.length > 0) {
    const resolved = resolveEntry(fs, path, path.resolve(root, declared));
    if (resolved !== null) return resolved;
  }
  for (const parts of CLI_CANDIDATES) {
    const resolved = resolveEntry(fs, path, path.join(root, ...parts));
    if (resolved !== null) return resolved;
  }
  const globalShim = findOnPath(fs, path, env, 'open-sdd');
  if (globalShim !== null) return resolveEntry(fs, path, globalShim);
  return null;
};

const gitRoot = (cp) => {
  const result = cp.spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error !== undefined && result.error !== null) return null;
  if (result.status !== 0) return null;
  const root = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  return root.length > 0 ? root : null;
};

/*
 * process.execPath, not the bare name "node": the gate was started by some Node, and that exact
 * binary must run the CLI. On Windows the shell that launched the hook is not necessarily the shell
 * whose PATH resolves "node".
 */
const spawnCli = (cp, cli, args, cwd) =>
  cp.spawnSync(process.execPath, [cli].concat(args), {
    cwd,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

const statusOf = (result) => (typeof result.status === 'number' ? result.status : 1);

const detailOf = (result) => {
  const parts = [];
  if (result.error !== undefined && result.error !== null) parts.push(String(result.error.message));
  if (typeof result.stdout === 'string') parts.push(result.stdout);
  if (typeof result.stderr === 'string') parts.push(result.stderr);
  return parts.join('\n').replace(/^\s+/, '').replace(/\s+$/, '');
};

const reportDetail = (result) => {
  const detail = detailOf(result);
  if (detail.length > 0) emit(process.stderr, detail);
};

/*
 * Fail closed. The message names every way out, because a blocked commit with no diagnosis is how a
 * gate gets bypassed instead of fixed.
 */
const printMissingCli = () => {
  const lines = [
    '',
    'open-sdd: COMMIT BLOQUEADO — el gate de commit no puede ejecutarse.',
    '  No se encontró el CLI (level B falla cerrado: un instrumento ausente no se lee como',
    '  verificación aprobada). Resuélvelo con una de estas opciones:',
    '    npm run build                  # checkout del propio open-sdd',
    '    npm install -D open-sdd        # como dependencia del proyecto',
    '    export OPEN_SDD_CLI=/ruta/al/cli.js',
    '  Un falso positivo legítimo se declara con motivo en .sdd/settings/security-allowlist.json.',
    '  Para commitear sin el gate: git commit --no-verify  (bypass NO registrado).',
    '',
  ];
  for (const line of lines) emit(process.stderr, line);
};

const main = (fs, path, cp) => {
  const root = gitRoot(cp);
  if (root === null) {
    emit(process.stderr, 'open-sdd: no es un repositorio git; se omite el gate de commit.');
    return 0;
  }

  const cli = resolveCli(fs, path, root, process.env);
  if (cli === null) {
    printMissingCli();
    return 1;
  }

  const declaresRigor = isFile(fs, path.join(root, ...RIGOR_SETTINGS));

  emit(process.stdout, 'open-sdd: gates críticos sobre el índice (C1 tríada · C2 seguridad · C3 evidencia)...');
  const gates = spawnCli(cp, cli, GATE_ARGS, root);

  let rigor = null;
  if (declaresRigor) {
    /*
     * Declaring a level is ACCEPTING its demands: from spec-anchored upward the constitution is
     * required and its absence blocks. The check only runs when the project declares a level, so
     * installing this hook into a project that has not opted in changes nothing.
     */
    emit(process.stdout, 'open-sdd: nivel de rigor declarado — comprobando la constitución y sus exigencias...');
    // --no-drift: at commit time the change being committed IS the modification, so a drift check
    // against declared boundaries is tautological and would block the very act of committing.
    // --quiet: a commit should not read like an audit; the exit code carries the verdict and the
    // full detail is one "open-sdd govern rigor" invocation away.
    rigor = spawnCli(cp, cli, RIGOR_ARGS, root);
  }

  // The rigor verdict is reported first when it fails, matching the shell gate: it is the declared
  // bar, and the developer should see the bar they must clear before the finding list.
  if (rigor !== null && statusOf(rigor) !== 0) {
    reportDetail(rigor);
    emit(process.stderr, 'open-sdd: COMMIT BLOQUEADO por el nivel de rigor declarado.');
    emit(process.stderr, '  El nivel declarado en .sdd/settings/rigor.json exige una constitución válida y los');
    emit(process.stderr, '  artefactos que ese nivel demanda (desde spec-anchored la constitución es obligatoria).');
    emit(process.stderr, '  Resuélvelo con: open-sdd brownfield constitution . --write   y revisa open-sdd govern rigor');
    return statusOf(rigor);
  }

  if (statusOf(gates) !== 0) {
    reportDetail(gates);
    emit(process.stderr, 'open-sdd: COMMIT BLOQUEADO.');
    emit(process.stderr, '  C2 bloquea ante secretos o comandos destructivos en el índice; C3 bloquea ante una');
    emit(process.stderr, '  tarea marcada como completa sin la línea _Evidence: que captura su comprobación.');
    emit(process.stderr, '  Si el hallazgo es un falso positivo legítimo, decláralo con motivo en');
    emit(process.stderr, '  .sdd/settings/security-allowlist.json (registrado y reportado, no silenciado).');
    return statusOf(gates);
  }

  return 0;
};

Promise.all([import('node:fs'), import('node:path'), import('node:child_process')])
  .then((modules) => main(modules[0], modules[1], modules[2]))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    emit(process.stderr, 'open-sdd: el gate de commit no pudo iniciarse: ' + message);
    process.exitCode = 1;
  });
