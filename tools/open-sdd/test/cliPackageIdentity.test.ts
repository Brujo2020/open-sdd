/**
 * Identidad del paquete (W0/W1, day 1).
 *
 * El defecto: el CLI anunciaba `npx open-sdd@latest` en sus mensajes de runtime, pero ese nombre
 * (sin scope) NO existe en npm. La prueba escanea el árbol de `src/` para que la forma incorrecta no
 * pueda volver, y comprueba que el comando anunciado se DERIVA del `package.json` de la raíz.
 */

import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INSTALL_COMMAND,
  PACKAGE_NAME,
  VERSION,
  readPackageIdentity,
} from '../src/cli/packageIdentity.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const srcRoot = path.resolve(here, '..', 'src');
const rootManifest = path.resolve(srcRoot, '..', '..', 'package.json');

const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
};

describe('package identity — one source for the install command', () => {
  it('derives the scoped name and the version from the root manifest', async () => {
    const root = JSON.parse(await readFile(rootManifest, 'utf8')) as { name: string; version: string };
    expect(PACKAGE_NAME).toBe('@brujo2020/open-sdd');
    expect(PACKAGE_NAME).toBe(root.name);
    expect(VERSION).toBe(root.version);
    expect(INSTALL_COMMAND).toBe(`npx ${PACKAGE_NAME}@latest`);
  });

  it('resolves the root manifest, not the private workspace manifest', () => {
    const identity = readPackageIdentity();
    expect(identity.name).toBe('@brujo2020/open-sdd');
    expect(identity.source).toContain('package.json');
  });

  it('no source file under src/ advertises the unscoped `npx open-sdd@`', async () => {
    const files = await walk(srcRoot);
    const offenders: string[] = [];
    for (const file of files) {
      const raw = await readFile(file, 'utf8');
      if (raw.includes('npx open-sdd@')) offenders.push(path.relative(srcRoot, file));
    }
    expect(offenders, `files still advertising the unscoped package: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the version the CLI prints is the derived one', async () => {
    const { runCli } = await import('../src/index.js');
    const logs: string[] = [];
    const io = { log: (m: string) => logs.push(m), error: () => {}, exit: () => {} };
    const code = await runCli(['--version'], { platform: 'darwin', env: {} }, io, {});
    expect(code).toBe(0);
    expect(logs.join('\n')).toContain(`open-sdd v${VERSION}`);
  });
});
