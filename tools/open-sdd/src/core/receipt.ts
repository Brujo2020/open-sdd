/**
 * El recibo de lo que esta herramienta escribió — la mitad que hace reversible una instalación.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────────────────────────
 * `init --write` escribe skills, comandos de chat, registros MCP, un hook de git y `.sdd/`. Hasta
 * ahora no quedaba constancia de QUÉ escribió, así que la única forma de deshacerlo era la
 * arqueología. Este módulo registra un recibo (`.sdd/.open-sdd-receipt.json`) con la ruta, la
 * acción y el sha256 del contenido en el momento de escribir, y de ahí deriva un plan de
 * desinstalación.
 *
 * ── Las tres reglas que lo mantienen honesto ───────────────────────────────────────────────────
 *  1. NO BORRA LO QUE ALGUIEN EDITÓ. Si el sha256 actual no coincide con el registrado, el fichero
 *     se RECHAZA con el motivo en vez de borrarse: una edición humana es del humano.
 *  2. NO BORRA UN FICHERO AJENO. Una entrada `merge` describe una fusión dentro de un fichero que
 *     no era nuestro (`.claude/settings.json`, `~/.codex/config.toml`); deshacerla es des-fusionar,
 *     no borrar, así que se reporta como rechazada y se deja a una persona.
 *  3. `.sdd/` ES TU DATO. Solo se elimina con `--purge-sdd` explícito; nunca como parte de una
 *     desinstalación normal.
 *
 * Un recibo corrupto NO revienta y NO autoriza nada: se reporta el problema y el plan queda vacío,
 * porque un plan de borrado construido sobre bytes ilegibles es exactamente el fallo que este
 * proyecto quita en todas partes.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const RECEIPT_SCHEMA = 'open-sdd.receipt/1';
export const RECEIPT_FILE = '.sdd/.open-sdd-receipt.json';

export type ReceiptAction = 'create' | 'merge' | 'overwrite';

export interface ReceiptEntry {
  /** Ruta relativa al repositorio, con separadores POSIX. */
  path: string;
  action: ReceiptAction;
  /** sha256 del contenido escrito, o `null` si no se pudo capturar. */
  sha256: string | null;
  at: string;
}

export interface Receipt {
  schema: string;
  entries: ReceiptEntry[];
}

export interface ReceiptRead {
  receipt: Receipt;
  /** No nulo cuando el recibo existe pero no se pudo usar: se dice, no se oculta. */
  problem: string | null;
}

export const sha256Of = (content: string | Buffer): string =>
  createHash('sha256').update(content).digest('hex');

export const receiptPath = (cwd: string): string => path.join(cwd, RECEIPT_FILE);

const emptyReceipt = (): Receipt => ({ schema: RECEIPT_SCHEMA, entries: [] });

/**
 * Normaliza una ruta a relativa-POSIX dentro del repositorio. Devuelve `null` si escapa: una ruta
 * fuera del árbol es un rechazo, nunca una ruta que se colará en un plan de borrado.
 */
export const normalizeRel = (cwd: string, target: string): string | null => {
  const abs = path.resolve(cwd, target);
  const rel = path.relative(cwd, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
};

export const readReceipt = async (cwd: string): Promise<ReceiptRead> => {
  const file = receiptPath(cwd);
  if (!existsSync(file)) return { receipt: emptyReceipt(), problem: null };
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<Receipt>;
    if (!parsed || parsed.schema !== RECEIPT_SCHEMA || !Array.isArray(parsed.entries)) {
      return {
        receipt: emptyReceipt(),
        problem: `${RECEIPT_FILE} no es un recibo ${RECEIPT_SCHEMA}: se ignora y ninguna eliminación se apoya en él.`,
      };
    }
    const entries = parsed.entries.filter(
      (entry): entry is ReceiptEntry =>
        Boolean(entry) &&
        typeof entry.path === 'string' &&
        (entry.action === 'create' || entry.action === 'merge' || entry.action === 'overwrite'),
    );
    return { receipt: { schema: RECEIPT_SCHEMA, entries }, problem: null };
  } catch (error) {
    return {
      receipt: emptyReceipt(),
      problem: `no se pudo leer ${RECEIPT_FILE} (${String(error)}): se ignora y ninguna eliminación se apoya en él.`,
    };
  }
};

/**
 * Registra lo escrito. Es idempotente por ruta: la última escritura gana, y el sha256 refleja el
 * contenido que quedó en disco. Nunca lanza por una ruta imposible: la salta y la nombra.
 */
export const recordReceipt = async (
  cwd: string,
  writes: { path: string; action: ReceiptAction; content?: string | Buffer }[],
  now: string = new Date().toISOString(),
): Promise<{ receipt: Receipt; recorded: number; skipped: { path: string; reason: string }[] }> => {
  const { receipt } = await readReceipt(cwd);
  const byPath = new Map(receipt.entries.map((entry) => [entry.path, entry]));
  const skipped: { path: string; reason: string }[] = [];

  for (const write of writes) {
    const rel = normalizeRel(cwd, write.path);
    if (!rel) {
      skipped.push({ path: write.path, reason: 'fuera del repositorio' });
      continue;
    }
    let content = write.content;
    if (content === undefined) {
      try {
        content = await readFile(path.join(cwd, rel));
      } catch {
        skipped.push({ path: rel, reason: 'no existe al registrar' });
        continue;
      }
    }
    byPath.set(rel, { path: rel, action: write.action, sha256: sha256Of(content), at: now });
  }

  const next: Receipt = {
    schema: RECEIPT_SCHEMA,
    entries: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
  await mkdir(path.dirname(receiptPath(cwd)), { recursive: true });
  await writeFile(receiptPath(cwd), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return { receipt: next, recorded: writes.length - skipped.length, skipped };
};

export type UninstallState = 'remove' | 'refused' | 'missing';

export interface UninstallPlanEntry {
  path: string;
  action: ReceiptAction;
  state: UninstallState;
  reason: string;
}

export interface UninstallPlan {
  entries: UninstallPlanEntry[];
  sddDir: { path: string; willRemove: boolean; reason: string };
  hasReceipt: boolean;
  problems: string[];
}

/**
 * Deriva el plan de desinstalación del recibo. No toca el disco salvo para leer: `--write` es lo
 * que ejecuta, y hasta entonces esto es una promesa con la evidencia delante.
 */
export const planFromReceipt = async (
  cwd: string,
  receipt: Receipt,
  options: { purgeSdd?: boolean } = {},
): Promise<UninstallPlan> => {
  const entries: UninstallPlanEntry[] = [];

  for (const entry of receipt.entries) {
    const abs = path.join(cwd, entry.path);
    if (!existsSync(abs)) {
      entries.push({ path: entry.path, action: entry.action, state: 'missing', reason: 'ya no existe' });
      continue;
    }
    if (entry.action === 'merge') {
      entries.push({
        path: entry.path,
        action: entry.action,
        state: 'refused',
        reason: 'se fusionó en un fichero que no era nuestro: se deshace a mano, no se borra',
      });
      continue;
    }
    const current = sha256Of(await readFile(abs));
    if (entry.sha256 !== null && current !== entry.sha256) {
      entries.push({
        path: entry.path,
        action: entry.action,
        state: 'refused',
        reason: 'cambió desde que se escribió (edición humana): no se borra',
      });
      continue;
    }
    entries.push({
      path: entry.path,
      action: entry.action,
      state: 'remove',
      reason:
        entry.action === 'create'
          ? 'lo creó esta herramienta y nadie lo cambió'
          : 'lo sobrescribió esta herramienta y nadie lo cambió',
    });
  }

  const purge = Boolean(options.purgeSdd);
  return {
    entries,
    sddDir: {
      path: '.sdd',
      willRemove: purge,
      reason: purge ? 'pedido explícitamente con --purge-sdd' : 'es tu dato: se conserva salvo --purge-sdd',
    },
    hasReceipt: receipt.entries.length > 0,
    problems: [],
  };
};

/** El caso normal: leer el recibo del repositorio y derivar de él el plan. */
export const planUninstall = async (
  cwd: string,
  options: { purgeSdd?: boolean } = {},
): Promise<UninstallPlan> => {
  const { receipt, problem } = await readReceipt(cwd);
  const plan = await planFromReceipt(cwd, receipt, options);
  if (problem) plan.problems = [problem, ...plan.problems];
  return plan;
};

const isDirEmpty = async (dir: string): Promise<boolean> => {
  try {
    return (await readdir(dir)).length === 0;
  } catch {
    return false;
  }
};

/** Elimina directorios que quedaron vacíos por el borrado, sin cruzar `.sdd/` ni la raíz. */
const pruneEmptyParents = async (cwd: string, removed: string[], keepSdd: boolean): Promise<string[]> => {
  const pruned: string[] = [];
  const candidates = new Set<string>();
  for (const rel of removed) {
    let dir = path.dirname(path.join(cwd, rel));
    while (path.resolve(dir) !== path.resolve(cwd)) {
      candidates.add(dir);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  const ordered = [...candidates].sort((a, b) => b.length - a.length);
  for (const dir of ordered) {
    const rel = path.relative(cwd, dir).split(path.sep).join('/');
    if (keepSdd && (rel === '.sdd' || rel.startsWith('.sdd/'))) continue;
    if (await isDirEmpty(dir)) {
      try {
        // `rm` sin recursivo lanza ERR_FS_EISDIR sobre un directorio; para un directorio vacío la
        // llamada correcta es `rmdir`.
        await rmdir(dir);
        pruned.push(rel);
      } catch {
        /* un directorio que no se pudo podar no es un fallo del plan */
      }
    }
  }
  return pruned;
};

export const applyUninstall = async (
  cwd: string,
  plan: UninstallPlan,
): Promise<{ removed: string[]; pruned: string[]; failed: { path: string; reason: string }[] }> => {
  const removed: string[] = [];
  const failed: { path: string; reason: string }[] = [];

  for (const entry of plan.entries) {
    if (entry.state !== 'remove') continue;
    try {
      await rm(path.join(cwd, entry.path), { force: true });
      removed.push(entry.path);
    } catch (error) {
      failed.push({ path: entry.path, reason: String(error) });
    }
  }

  const pruned = await pruneEmptyParents(cwd, removed, !plan.sddDir.willRemove);

  if (plan.sddDir.willRemove) {
    try {
      await rm(path.join(cwd, '.sdd'), { recursive: true, force: true });
      removed.push('.sdd/');
    } catch (error) {
      failed.push({ path: '.sdd/', reason: String(error) });
    }
  }

  return { removed, pruned, failed };
};
