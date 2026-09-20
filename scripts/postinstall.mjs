#!/usr/bin/env node
/**
 * Root postinstall.
 *
 * The previous implementation was `cd tools/open-sdd && npm install … || npm install …`, which had
 * two defects worth naming because both are silent:
 *
 *   1. If `tools/open-sdd` is missing, the shell fallback runs `npm install` in the repository root,
 *      which re-triggers this same script — an unbounded recursive process spawn (measured: 81
 *      concurrent `npm install` processes eight seconds in).
 *   2. The fallback masked real failures: it exited 0 having installed nothing.
 *
 * This script does the guarded thing instead: it installs the workspace dependencies only when
 * the workspace exists, propagates failures, and never shells out in a way that can re-enter
 * this script.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, '..', 'tools', 'open-sdd');

// Only a source checkout has anything to install. The published package ships the compiled dist
// and the templates, so a consumer install has no workspace to build and needs no message about it.
const isSourceCheckout =
  existsSync(path.join(workspace, 'package.json')) && existsSync(path.join(workspace, 'src'));

if (!isSourceCheckout) {
  process.exit(0);
}

const result = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
  cwd: workspace,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(`[open-sdd] workspace install could not start: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  // Fail loudly. A silent success here is how a repository ends up "installed" and unbuildable.
  console.error(
    `[open-sdd] workspace install failed with exit ${result.status ?? 'unknown'}. Run \`npm --prefix tools/open-sdd install\` to see the full output.`,
  );
  process.exit(result.status ?? 1);
}
