/**
 * Pruebas de comportamiento del respaldo restaurable (`.sdd/` + manifiesto con sha256 por fichero).
 *
 * Fixtures en `os.tmpdir()` y limpieza en `afterEach`. Se fija la REGLA: el respaldo copia el árbol
 * de gobernanza y nada más (ni credenciales, ni `node_modules`/`dist`/`.git`), un manifiesto que no
 * supera sus propios hashes no es bueno, y una restauración nunca sobrescribe en silencio ni acepta
 * una ruta que escape de la raíz.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BACKUP_MANIFEST_FILE,
  BACKUP_PAYLOAD_DIR,
  RESTORE_SKIP_REASONS,
  backupSha256,
  createBackup,
  restoreBackup,
  verifyBackup,
  type BackupManifest,
} from '../src/core/backup.js';

const dirs: string[] = [];

const makeTmp = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-backup-'));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true });
});

const write = async (root: string, rel: string, content: string): Promise<void> => {
  const target = path.join(root, rel);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
};

const read = async (root: string, rel: string): Promise<string> => readFile(path.join(root, rel), 'utf8');

const exists = async (target: string): Promise<boolean> => {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
};

const readManifest = async (archive: string): Promise<BackupManifest> =>
  JSON.parse(await readFile(path.join(archive, BACKUP_MANIFEST_FILE), 'utf8')) as BackupManifest;

/** Ficheros regulares bajo una raíz, en rutas POSIX relativas. */
const listFiles = async (base: string, rel = ''): Promise<string[]> => {
  const dirAbs = rel.length === 0 ? base : path.join(base, ...rel.split('/'));
  let entries;
  try {
    entries = await readdir(dirAbs, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    const childRel = rel.length === 0 ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await listFiles(base, childRel)));
    else if (entry.isFile()) found.push(childRel);
  }
  return found.sort();
};

/**
 * Proyecto de gobernanza con lo que DEBE entrar (settings, steering, specs, state), lo que debe
 * omitirse por credencial (`.npmrc`, `.env`) y lo que debe excluirse por reproducible/versionado.
 */
const fixture = async (): Promise<string> => {
  const root = await makeTmp();
  await write(root, '.sdd/settings/rigor.json', '{"level":"spec-first"}\n');
  await write(root, '.sdd/steering/constitution.md', '# Constitución\n\nC-1 · la spec es la autoridad.\n');
  await write(root, '.sdd/specs/auth/requirements.md', '# Requirements\n\nREQ-AUTH-001 ...\n');
  await write(root, '.sdd/state/progress.json', '{"version":1,"entries":[]}\n');
  await write(root, '.sdd/notes.txt', 'nota de gobernanza\n');
  await write(root, '.sdd/.npmrc', '//registry.npmjs.org/:_authToken=SECRETO\n');
  await write(root, '.sdd/.env', 'API_KEY=SECRETO\n');
  await write(root, '.sdd/node_modules/pkg/index.js', 'module.exports = {};\n');
  await write(root, '.sdd/dist/cli.js', '#!/usr/bin/env node\n');
  await write(root, '.sdd/.git/HEAD', 'ref: refs/heads/main\n');
  return root;
};

describe('core/backup — un respaldo que se puede verificar y restaurar', () => {
  it('crea el respaldo, verifica ok con hashes que coinciden y recuentos que cuadran con la realidad', async () => {
    const root = await fixture();
    const created = await createBackup({ cwd: root });

    expect(created.written).toBe(true);
    expect(created.manifest.schema).toBe('open-sdd.backup/1');
    expect(created.manifest.root).toBe('.sdd');
    // Solo el estado de gobernanza: 5 ficheros, ni credenciales ni reproducibles.
    expect(created.manifest.files.map((file) => file.path)).toEqual([
      'notes.txt',
      'settings/rigor.json',
      'specs/auth/requirements.md',
      'state/progress.json',
      'steering/constitution.md',
    ]);
    expect(created.manifest.counts.files).toBe(created.manifest.files.length);
    expect(created.manifest.counts.bytes).toBe(
      created.manifest.files.reduce((sum, file) => sum + file.bytes, 0),
    );

    const payloadFiles = await listFiles(path.join(created.path, BACKUP_PAYLOAD_DIR));
    expect(payloadFiles).toEqual(created.manifest.files.map((file) => file.path));

    for (const file of created.manifest.files) {
      const bytes = await readFile(path.join(created.path, BACKUP_PAYLOAD_DIR, ...file.path.split('/')));
      expect(backupSha256(bytes)).toBe(file.sha256);
      expect(bytes.byteLength).toBe(file.bytes);
    }

    const verified = await verifyBackup({ cwd: root, archive: created.path });
    expect(verified.ok).toBe(true);
    expect(verified.mismatches).toEqual([]);
    expect(verified.missing).toEqual([]);
    expect(verified.manifest?.files).toHaveLength(5);
  });

  it('verify detecta un fichero MANIPULADO y no lo declara bueno', async () => {
    const root = await fixture();
    const created = await createBackup({ cwd: root });
    const target = path.join(created.path, BACKUP_PAYLOAD_DIR, 'settings', 'rigor.json');
    await writeFile(target, '{"level":"spec-as-source"}\n', 'utf8');

    const verified = await verifyBackup({ cwd: root, archive: created.path });
    expect(verified.ok).toBe(false);
    expect(verified.mismatches).toHaveLength(1);
    expect(verified.mismatches[0].path).toBe('settings/rigor.json');
    expect(verified.mismatches[0].expected).not.toBe(verified.mismatches[0].actual);
    expect(verified.mismatches[0].actual).not.toBeNull();
    expect(verified.detail).toContain('NO supera su propio manifiesto');
  });

  it('verify detecta un fichero AUSENTE', async () => {
    const root = await fixture();
    const created = await createBackup({ cwd: root });
    await rm(path.join(created.path, BACKUP_PAYLOAD_DIR, 'state', 'progress.json'));

    const verified = await verifyBackup({ cwd: root, archive: created.path });
    expect(verified.ok).toBe(false);
    expect(verified.missing).toEqual(['state/progress.json']);
    expect(verified.mismatches).toEqual([]);
  });

  it('verify no es bueno sin manifiesto', async () => {
    const root = await fixture();
    const archive = path.join(root, 'sin-manifiesto');
    await mkdir(archive, { recursive: true });

    const verified = await verifyBackup({ cwd: root, archive });
    expect(verified.ok).toBe(false);
    expect(verified.manifest).toBeNull();
    expect(verified.detail).toContain(BACKUP_MANIFEST_FILE);
  });

  it('omite .npmrc y .env y los NOMBRA en el manifiesto en vez de guardar un token', async () => {
    const root = await fixture();
    const created = await createBackup({ cwd: root });

    const paths = created.manifest.files.map((file) => file.path);
    expect(paths).not.toContain('.npmrc');
    expect(paths).not.toContain('.env');
    expect(paths.some((rel) => rel.includes('.npmrc') || rel.includes('.env'))).toBe(false);

    expect(created.manifest.detail).toContain('.npmrc');
    expect(created.manifest.detail).toContain('.env');
    expect(created.manifest.detail).toContain('credencial');

    expect(await exists(path.join(created.path, BACKUP_PAYLOAD_DIR, '.npmrc'))).toBe(false);
    expect(await exists(path.join(created.path, BACKUP_PAYLOAD_DIR, '.env'))).toBe(false);
  });

  it('no incluye node_modules, dist ni .git', async () => {
    const root = await fixture();
    const created = await createBackup({ cwd: root });

    const paths = created.manifest.files.map((file) => file.path);
    expect(paths.some((rel) => rel.startsWith('node_modules/') || rel.startsWith('dist/') || rel.startsWith('.git/'))).toBe(false);
    expect(await exists(path.join(created.path, BACKUP_PAYLOAD_DIR, 'node_modules'))).toBe(false);
    expect(await exists(path.join(created.path, BACKUP_PAYLOAD_DIR, 'dist'))).toBe(false);
    expect(await exists(path.join(created.path, BACKUP_PAYLOAD_DIR, '.git'))).toBe(false);
  });

  it('restore SIN write no cambia nada en disco', async () => {
    const root = await fixture();
    const created = await createBackup({ cwd: root });
    await rm(path.join(root, '.sdd', 'notes.txt'));

    const restored = await restoreBackup({ cwd: root, archive: created.path });
    expect(restored.restored).toContain('notes.txt');
    expect(restored.detail).toContain('simulación');
    // Nada se escribió: el fichero sigue ausente.
    expect(await exists(path.join(root, '.sdd', 'notes.txt'))).toBe(false);
    // Los que ya están idénticos se omiten con su motivo.
    expect(restored.skipped).toContainEqual({ path: 'settings/rigor.json', reason: RESTORE_SKIP_REASONS.alreadyIdentical });
  });

  it('restore CON write restaura lo ausente y se NIEGA a pisar un fichero que difiere', async () => {
    const root = await fixture();
    const created = await createBackup({ cwd: root });
    await rm(path.join(root, '.sdd', 'notes.txt'));

    const applied = await restoreBackup({ cwd: root, archive: created.path, write: true });
    expect(applied.restored).toContain('notes.txt');
    expect(await read(root, '.sdd/notes.txt')).toBe('nota de gobernanza\n');

    // El destino difiere y es MÁS ANTIGUO que la copia → «existe y difiere», sin sobrescribir.
    await write(root, '.sdd/settings/rigor.json', '{"level":"editado-a-mano"}\n');
    const past = new Date('2000-01-01T00:00:00.000Z');
    await utimes(path.join(root, '.sdd', 'settings', 'rigor.json'), past, past);
    const refused = await restoreBackup({ cwd: root, archive: created.path, write: true });
    expect(refused.skipped).toContainEqual({ path: 'settings/rigor.json', reason: RESTORE_SKIP_REASONS.existsAndDiffers });
    expect(await read(root, '.sdd/settings/rigor.json')).toBe('{"level":"editado-a-mano"}\n');

    // El destino difiere y es MÁS RECIENTE que la copia → se nombra aparte y tampoco se pisa.
    await write(root, '.sdd/state/progress.json', '{"version":1,"entries":[{"at":"futuro"}]}\n');
    const future = new Date('2035-01-01T00:00:00.000Z');
    await utimes(path.join(root, '.sdd', 'state', 'progress.json'), future, future);
    const newer = await restoreBackup({ cwd: root, archive: created.path, write: true });
    expect(newer.skipped).toContainEqual({ path: 'state/progress.json', reason: RESTORE_SKIP_REASONS.newerOnDisk });
    expect(await read(root, '.sdd/state/progress.json')).toContain('futuro');
  });

  it('restore RECHAZA una ruta que escapa de la raíz del respaldo', async () => {
    const root = await fixture();
    const archive = path.join(root, 'malicioso');
    const escapedContent = 'contenido que no debe restaurarse\n';
    await write(archive, 'evil.txt', escapedContent);
    await write(
      archive,
      BACKUP_MANIFEST_FILE,
      JSON.stringify({
        schema: 'open-sdd.backup/1',
        createdAt: new Date().toISOString(),
        tool: 'open-sdd',
        version: 'test',
        root: '.sdd',
        files: [{ path: '../evil.txt', bytes: Buffer.byteLength(escapedContent), sha256: backupSha256(escapedContent) }],
        counts: { files: 1, bytes: Buffer.byteLength(escapedContent) },
        git: { branch: null, commit: null, dirty: false },
        detail: 'manifiesto con una ruta que escapa',
      }),
    );

    const restored = await restoreBackup({ cwd: root, archive, write: true });
    expect(restored.restored).toEqual([]);
    expect(restored.skipped).toEqual([{ path: '../evil.txt', reason: RESTORE_SKIP_REASONS.escapesBackupRoot }]);
    expect(restored.detail).toContain('RECHAZO');
    // El fichero fuera de la carga sigue como estaba: no se escribió nada.
    expect(await read(archive, 'evil.txt')).toBe(escapedContent);
    expect(await exists(path.join(root, 'evil.txt'))).toBe(false);
  });

  it('restore RECHAZA una raíz de destino que escapa del proyecto', async () => {
    const root = await fixture();
    const archive = path.join(root, 'raiz-absurda');
    const content = 'x\n';
    await write(archive, `${BACKUP_PAYLOAD_DIR}/state/progress.json`, content);
    await write(
      archive,
      BACKUP_MANIFEST_FILE,
      JSON.stringify({
        schema: 'open-sdd.backup/1',
        createdAt: new Date().toISOString(),
        tool: 'open-sdd',
        version: 'test',
        root: '../../fuera',
        files: [{ path: 'state/progress.json', bytes: Buffer.byteLength(content), sha256: backupSha256(content) }],
        counts: { files: 1, bytes: Buffer.byteLength(content) },
        git: { branch: null, commit: null, dirty: false },
        detail: 'raíz que escapa',
      }),
    );

    const restored = await restoreBackup({ cwd: root, archive, write: true });
    expect(restored.restored).toEqual([]);
    expect(restored.skipped).toEqual([{ path: 'state/progress.json', reason: RESTORE_SKIP_REASONS.outsideAllowedRoot }]);
    expect(restored.detail).toContain('RECHAZO');
  });

  it('restore no restaura un fichero cuyo hash no cuadra con el manifiesto', async () => {
    const root = await fixture();
    const created = await createBackup({ cwd: root });
    await rm(path.join(root, '.sdd', 'notes.txt'));
    await writeFile(path.join(created.path, BACKUP_PAYLOAD_DIR, 'notes.txt'), 'manipulado\n', 'utf8');

    const restored = await restoreBackup({ cwd: root, archive: created.path, write: true });
    expect(restored.skipped).toContainEqual({ path: 'notes.txt', reason: RESTORE_SKIP_REASONS.hashMismatch });
    expect(await exists(path.join(root, '.sdd', 'notes.txt'))).toBe(false);
  });

  it('only filtra por ruta exacta o prefijo de directorio', async () => {
    const root = await fixture();
    const created = await createBackup({ cwd: root });
    await rm(path.join(root, '.sdd', 'notes.txt'));
    await rm(path.join(root, '.sdd', 'state', 'progress.json'));

    const restored = await restoreBackup({ cwd: root, archive: created.path, write: true, only: ['state'] });
    expect(restored.restored).toEqual(['state/progress.json']);
    expect(await exists(path.join(root, '.sdd', 'state', 'progress.json'))).toBe(true);
    // Lo filtrado ni se toca ni aparece en ninguna lista.
    expect(restored.restored).not.toContain('notes.txt');
    expect(restored.skipped.some((entry) => entry.path === 'notes.txt')).toBe(false);
    expect(await exists(path.join(root, '.sdd', 'notes.txt'))).toBe(false);
  });

  it('no sobrescribe un respaldo existente sin force, y con force lo reemplaza', async () => {
    const root = await fixture();
    const first = await createBackup({ cwd: root, out: 'copia' });
    expect(first.written).toBe(true);

    const refused = await createBackup({ cwd: root, out: 'copia' });
    expect(refused.written).toBe(false);
    expect(refused.detail).toContain('--force');

    const forced = await createBackup({ cwd: root, out: 'copia', force: true });
    expect(forced.written).toBe(true);
    expect((await verifyBackup({ cwd: root, archive: forced.path })).ok).toBe(true);
  });

  it('sin .sdd no hay respaldo que escribir, y lo dice', async () => {
    const root = await makeTmp();
    const created = await createBackup({ cwd: root });
    expect(created.written).toBe(false);
    expect(created.manifest.counts).toEqual({ files: 0, bytes: 0 });
    expect(created.detail).toContain('no existe');
    expect(await exists(created.path)).toBe(false);
  });

  it('registra el estado de git: sin repositorio, rama y commit nulos y dirty false', async () => {
    const root = await fixture();
    const created = await createBackup({ cwd: root });
    expect(created.manifest.git.branch).toBeNull();
    expect(created.manifest.git.commit).toBeNull();
    expect(created.manifest.git.dirty).toBe(false);
  });
});
