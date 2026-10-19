#!/usr/bin/env node
/**
 * Install the open-sdd commit gate (enforcement level B) into this checkout.
 *
 * Wired to `npm run prepare`, so a contributor gets the floor without reading any documentation.
 * Deliberately forgiving about its environment and strict about two things: it never silently
 * replaces a hook it does not recognise, and it never claims to have installed something it did not
 * write.
 *
 * The gate it installs is `tools/open-sdd/templates/hooks/pre-commit.mjs` — the portable Node gate.
 * The POSIX `pre-commit` template next to it is a documented manual fallback (`open-sdd floor
 * install` still copies it) and is never copied here: a shell script is exactly the Windows blocker
 * this gate removes. Nothing stale is left behind, because both templates install to the same
 * `<hooksDir>/pre-commit` path and a differing copy is refreshed.
 *
 * Outcomes are distinct on purpose (Spanish, because a developer reads them mid-install):
 *
 *   - not a git repository         -> nothing to do, exit 0
 *   - template missing             -> nothing to do, exit 0
 *   - installed (nothing was there)-> exit 0, file written and made executable
 *   - already up to date           -> exit 0, NOTHING written
 *   - upgraded from an older copy  -> exit 0, file rewritten
 *   - --force                      -> exit 0, file rewritten unconditionally
 *   - foreign hook present         -> backed up to <hook>.open-sdd-backup, gate NOT installed
 *
 * `--hooks-path [dir]` opts into a repository-controlled hooks directory (default `.githooks`) and
 * sets `core.hooksPath`. That is what keeps the hook in place for a whole team: hooks under `.git/`
 * are not versioned. The default (`git init`'s `.git/hooks`) is unchanged for existing users.
 * Setting `core.hooksPath` is idempotent, and `--uninstall` reverses it (the manual equivalent is
 * `git config --unset core.hooksPath`).
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');

const HOOK_NAME = 'pre-commit';
const DEFAULT_HOOKS_PATH = '.githooks';
const GATE_TEMPLATE = ['tools', 'open-sdd', 'templates', 'hooks', 'pre-commit.mjs'];

const finish = (message, code = 0) => {
  console.log(`[open-sdd] ${message}`);
  process.exit(code);
};

const readHooksPathOption = (args) => {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--hooks-path') {
      const next = args[index + 1];
      return next !== undefined && !next.startsWith('--') ? next : DEFAULT_HOOKS_PATH;
    }
    if (token.startsWith('--hooks-path=')) {
      const value = token.slice('--hooks-path='.length).trim();
      return value.length > 0 ? value : DEFAULT_HOOKS_PATH;
    }
  }
  return null;
};

const runGit = (args) =>
  spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const configuredHooksPath = () => {
  const result = runGit(['config', '--get', 'core.hooksPath']);
  if (result.status !== 0) return null;
  const value = (result.stdout ?? '').trim();
  return value.length > 0 ? value : null;
};

const isGitRepository = () => existsSync(path.join(root, '.git'));

/*
 * git silently ignores a hook that lacks the executable bit, which is the quietest possible failure
 * of this whole mechanism. Windows has no meaningful executable bit (chmod only toggles read-only),
 * so it is treated as always executable there to keep "already up to date" honest.
 */
const isExecutable = (target) =>
  process.platform === 'win32' || (statSync(target).mode & 0o111) > 0;

const argv = process.argv.slice(2);
const force = argv.includes('--force');
const uninstall = argv.includes('--uninstall');
const wantsHelp = argv.includes('--help') || argv.includes('-h');
const hooksPath = readHooksPathOption(argv);

if (wantsHelp) {
  finish(
    'uso: node scripts/install-hooks.mjs [--force] [--hooks-path [dir]] [--uninstall]\n' +
      '  (sin banderas)            instala el gate de commit en .git/hooks/pre-commit\n' +
      '  --hooks-path [dir]        instala en un directorio versionado (por defecto .githooks) y fija core.hooksPath\n' +
      '  --force                   reescribe el hook aunque ya exista\n' +
      '  --uninstall               elimina el gate y desfija core.hooksPath si apuntaba a su directorio',
  );
}

const hookTemplate = path.join(root, ...GATE_TEMPLATE);

if (uninstall) {
  if (!isGitRepository()) {
    finish('no hay repositorio git en este directorio; no hay nada que desinstalar.');
  }

  const configured = configuredHooksPath();
  const targetDir =
    hooksPath !== null
      ? path.resolve(root, hooksPath)
      : configured !== null
        ? path.resolve(root, configured)
        : path.join(root, '.git', 'hooks');
  const hookTarget = path.join(targetDir, HOOK_NAME);
  const targetRelative = path.relative(root, hookTarget);

  if (!existsSync(hookTarget)) {
    finish(`no había ningún gate de open-sdd en ${targetRelative}; nada que desinstalar.`);
  }
  if (!readFileSync(hookTarget, 'utf8').includes('open-sdd')) {
    finish(`${targetRelative} no es un hook de open-sdd; no se toca.`);
  }

  rmSync(hookTarget, { force: true });

  let configNote = '';
  if (configured !== null && path.resolve(root, configured) === targetDir) {
    const result = runGit(['config', '--local', '--unset', 'core.hooksPath']);
    configNote =
      result.status === 0
        ? ' y core.hooksPath quedó sin fijar.'
        : ' pero core.hooksPath no se pudo desfijar (usa: git config --unset core.hooksPath).';
  }

  finish(`gate de commit eliminado de ${targetRelative}${configNote}`);
}

try {
  if (!isGitRepository()) {
    finish('no hay repositorio git en este directorio; se omite la instalación del gate de commit.');
  }

  if (!existsSync(hookTemplate)) {
    finish(
      'no se encontró la plantilla del gate de commit (pre-commit.mjs); se omite la instalación (el paquete npm ya la trae).',
    );
  }

  // A repository-controlled hooks directory must stay inside the repository: a path that escapes it
  // is not versioned by this project and would install a hook nobody can review.
  let hooksDir = path.join(root, '.git', 'hooks');
  if (hooksPath !== null) {
    hooksDir = path.resolve(root, hooksPath);
    const inside = path.relative(root, hooksDir);
    if (inside.length === 0 || inside.startsWith('..') || path.isAbsolute(inside)) {
      finish(`--hooks-path debe apuntar dentro del repositorio (recibido: ${hooksPath}).`, 1);
    }
  }

  const hookTarget = path.join(hooksDir, HOOK_NAME);
  const targetRelative = path.relative(root, hookTarget);
  const desired = readFileSync(hookTemplate, 'utf8');
  const current = existsSync(hookTarget) ? readFileSync(hookTarget, 'utf8') : null;

  /*
   * Set core.hooksPath only when the hook is actually installed. Idempotent by construction: git
   * config is asked for the current value first, and an equal value is reported as unchanged.
   */
  const applyHooksPath = () => {
    if (hooksPath === null) return;
    if (configuredHooksPath() === hooksPath) {
      console.log(`[open-sdd] core.hooksPath ya apunta a ${hooksPath}; no se cambió nada.`);
      return;
    }
    const result = runGit(['config', '--local', 'core.hooksPath', hooksPath]);
    if (result.status !== 0) {
      finish(
        `no se pudo fijar core.hooksPath en ${hooksPath} (${(result.stderr ?? '').trim()}); el hook quedó escrito igualmente.`,
        1,
      );
    }
    console.log(
      `[open-sdd] core.hooksPath fijado a ${hooksPath} (reversible con --uninstall o con: git config --unset core.hooksPath).`,
    );
  };

  // A hook that is not ours is never replaced silently. It is preserved, and the run stops having
  // written nothing — so it must not say "installed".
  if (current !== null && !current.includes('open-sdd') && !force) {
    const backup = `${hookTarget}.open-sdd-backup`;
    if (!existsSync(backup)) copyFileSync(hookTarget, backup);
    finish(
      `ya hay un hook ${HOOK_NAME} ajeno instalado; se preservó una copia en ${path.relative(root, backup)} y NO se instaló el gate de open-sdd (vuelve a ejecutar la instalación para instalarlo, o usa --force).`,
    );
  }

  if (current === null || force) {
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(hookTarget, desired, 'utf8');
    chmodSync(hookTarget, 0o755);
    applyHooksPath();
    const how = force && current !== null ? 'reescrito con --force en' : 'instalado en';
    finish(`gate de commit ${how} ${targetRelative} (nivel B: C1, C2 y C3 sobre el índice).`);
  }

  if (current === desired) {
    if (isExecutable(hookTarget)) {
      applyHooksPath();
      finish(`el gate de commit ya está actualizado en ${targetRelative}; no se escribió nada.`);
    }
    chmodSync(hookTarget, 0o755);
    applyHooksPath();
    finish(`se restauró el bit de ejecución en ${targetRelative} (el contenido ya era el actual).`);
  }

  // Present, ours, and different: an older version of this same gate must be refreshed. Skipping on
  // mere presence once left contributors running a previous version forever.
  writeFileSync(hookTarget, desired, 'utf8');
  chmodSync(hookTarget, 0o755);
  applyHooksPath();
  finish(`gate de commit actualizado en ${targetRelative} (había una versión anterior de este gate).`);
} catch (error) {
  // Never break `npm install` over hook installation; report and continue.
  const message = error instanceof Error ? error.message : String(error);
  finish(`no se pudo instalar el gate de commit (${message}). Ejecuta \`npm run hooks:install\` a mano.`);
}
