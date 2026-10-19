/**
 * Constitution advisor (REQ-MAT-017): keep the constitution young.
 *
 * A constitution that ages into fiction is worse than none, because the project learns to ignore
 * the file and every verdict that cites it inherits the credibility problem. This module is the
 * "continuous improvement suggestion" assistant: it reads the constitution in force, reads the
 * repository, and reports where the document and the code have drifted apart — with the evidence it
 * actually read, a paste-ready amendment block, and (when one exists) the command that applies it.
 *
 * The design rules that keep this from becoming generic advice:
 *
 *   1. ONLY PRINCIPLES IN FORCE ARE ADVISED ON. A draft is not law. The one exception is deliberate:
 *      a proposal that has aged past the threshold without a decision is itself a finding
 *      (`amendment-aged`), because "nobody decided" is the fact that matters.
 *   2. A SIGNAL IS ONLY EMITTED FROM EVIDENCE THAT WAS READ. A path-shaped evidence entry is checked
 *      against the filesystem; a non-path entry (`package manager: npm`) is UNVERIFIABLE, never
 *      "expired". When the model stores no date for an amendment, the module says so in
 *      `notChecked` instead of inventing an age.
 *   3. `checked` AND `notChecked` ARE EXPLICIT AND `complete` IS DERIVED FROM THEM. Nothing is
 *      reported as inspected when it was not; an absent history file is a gap in the analysis, not a
 *      clean bill of health.
 *   4. NO MODEL SHIPS. The engine produces findings, evidence and a concrete example; writing the
 *      prose is the host model's job.
 *
 * The eight signals, and where each one reads from:
 *
 *   evidence-expired        principle.evidence (path-shaped) vs the filesystem
 *   practice-unstated       the code: source modules vs test files, and dependencies declared in
 *                           every readable package.json — detection method stated in the finding
 *   amendment-aged          constitution.amendments / draft principles with a stored date and no
 *                           decision, older than the threshold (default 30 days)
 *   recurring-violation     the receipts/claims/audit/adhesion history files, when they exist
 *   contradictory-principles two in-force principles: conflicting technology locks, or opposing
 *                           polarity (MUST vs MUST NOT) on the same threat/CWE target
 *   boundary-aged           the module map (the same `scanProject` reconnaissance the descriptive
 *                           constitution cites as C-BOUNDARIES) vs the boundaries the constitution
 *                           names
 *   stack-drifted           the manifest/lockfile package manager and language vs what a principle
 *                           states
 *   waiver-expiring         `.sdd/settings/security-allowlist.json` entries carrying an optional
 *                           `expires` (and `owner`) within 14 days or already past
 */

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  parseConstitution,
  parseEvidenceArtifact,
  principlesInForce,
  type Constitution,
  type ConstitutionPrinciple,
} from './constitution.js';
import { scanProject } from './reverseEngineering.js';

export type AdviceKind =
  | 'evidence-expired'
  | 'practice-unstated'
  | 'amendment-aged'
  | 'recurring-violation'
  | 'contradictory-principles'
  | 'boundary-aged'
  | 'stack-drifted'
  | 'waiver-expiring';

export type AdviceSeverity = 'error' | 'warning' | 'info';

export interface Advice {
  kind: AdviceKind;
  /** The principle the advice is about, when the signal is principle-scoped. */
  principleId?: string;
  severity: AdviceSeverity;
  title: string;
  /** Why this is a finding, in terms of the evidence that was read. */
  why: string;
  /** The concrete references the finding rests on: paths, ids, dates, counts. */
  evidence: string[];
  /**
   * A paste-ready Markdown amendment block with the six-field anatomy this project uses:
   * id, level, CWE or threat reference, restriction, pattern, justification.
   */
  example: string;
  /** The command that applies the advice, when one exists. */
  apply?: string;
  /** Age in days for time-based findings, when a date was stored. */
  ageDays?: number;
}

export interface AdviceReport {
  project: string;
  advice: Advice[];
  checked: string[];
  notChecked: string[];
  detail: string;
  complete: boolean;
}

export interface AdviceOptions {
  sddDir?: string;
  now?: Date;
  /** Age at which an undecided amendment is reported. Default 30 days. */
  thresholdDays?: number;
}

export const DEFAULT_AMENDMENT_THRESHOLD_DAYS = 30;
export const WAIVER_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Statuses that are decisions. A proposal still awaiting one is `proposed`/`under-review`. */
const UNDECIDED_STATUSES = new Set(['proposed', 'under-review']);

/**
 * History files that could carry a principle-level violation record. The list is explicit and the
 * module never invents a file: when none of them exists, `recurring-violation` is `notChecked`.
 * `.sdd/receipts.json` is the relaxation ledger (I6); the rest are the claims/audit/adhesion
 * ledgers a project may keep alongside it.
 */
export const VIOLATION_HISTORY_CANDIDATES = [
  '.sdd/receipts.json',
  '.sdd/memory/violations.json',
  '.sdd/memory/adhesion.json',
  '.sdd/audit/history.json',
];

/** Keys a history record may use to cite a principle. Anything else is not a principle reference. */
const PRINCIPLE_REFERENCE_KEYS = ['principleId', 'principle', 'principleRef', 'citation', 'rule'];

const readText = async (file: string): Promise<string | null> => readFile(file, 'utf8').catch(() => null);

const ageInDays = (iso: string, now: Date): number | undefined => {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return undefined;
  return Math.floor((now.getTime() - at) / DAY_MS);
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const mentions = (text: string, token: string): boolean =>
  new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}([^a-z0-9]|$)`, 'i').test(text);

const normalizePath = (value: string): string => value.trim().replace(/\\/g, '/').replace(/^\.\//, '');

// ---------------------------------------------------------------------------------------------
// Markdown example: the amendment a human can paste into the constitution
// ---------------------------------------------------------------------------------------------

interface ExampleInput {
  id: string;
  title: string;
  level: 'MUST' | 'SHOULD' | 'MAY';
  threat?: string;
  cweReference?: string;
  restriction: string;
  pattern: string;
  justification: string;
}

/**
 * Render a paste-ready principle/amendment block. Six fields, in the order the constitution model
 * validates: the heading carries the id, then level, the CWE or threat reference, restriction,
 * pattern and justification. `Provenance: normative` is added because an amendment that enters the
 * document through this route is authored, not observed.
 */
const amendmentExample = (input: ExampleInput): string => {
  const lines = [`### ${input.id} — ${input.title}`, `- Level: ${input.level}`];
  if (input.cweReference) lines.push(`- CWE: ${input.cweReference}`);
  else lines.push(`- Threat: ${input.threat ?? 'envejecimiento de la constitución'}`);
  lines.push(`- Restriction: ${input.restriction}`);
  lines.push(`- Pattern: ${input.pattern}`);
  lines.push(`- Justification: ${input.justification}`);
  lines.push('- Provenance: normative');
  return lines.join('\n');
};

const safeId = (value: string): string =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

// ---------------------------------------------------------------------------------------------
// Filesystem helpers (bounded, read-only)
// ---------------------------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.turbo']);

/** Recursive file listing bounded by depth and count, so a large repo cannot make this unbounded. */
const listFiles = async (root: string, dirs: string[], limit = 800): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > 5 || out.length >= limit) return;
    const entries = await readdir(path.join(root, rel), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (SKIP_DIRS.has(entry.name)) continue;
      const child = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) await walk(child, depth + 1);
      else out.push(child);
    }
  };
  for (const dir of dirs) {
    const normalized = normalizePath(dir);
    if (normalized) await walk(normalized, 0);
  }
  return out;
};

const readJson = async (file: string): Promise<unknown> => {
  const raw = await readText(file);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

// ---------------------------------------------------------------------------------------------
// Signal 1 — evidence-expired
// ---------------------------------------------------------------------------------------------

interface Ctx {
  root: string;
  sddDir: string;
  now: Date;
  thresholdDays: number;
  advice: Advice[];
  checked: string[];
  notChecked: string[];
}

/** Evidence of a principle that stopped resolving on disk is a fact the principle still asserts. */
const checkEvidenceExpired = (ctx: Ctx, inForce: ConstitutionPrinciple[]): void => {
  let pathReferences = 0;
  let unverifiable = 0;
  const unverifiablePrinciples = new Set<string>();
  const withEvidence = inForce.filter((p) => (p.evidence ?? []).length > 0);

  for (const principle of inForce) {
    const expired: string[] = [];
    for (const entry of principle.evidence ?? []) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const artifact = parseEvidenceArtifact(trimmed, { cwd: ctx.root });
      if (!artifact.file) {
        // Not path-shaped (a fact, a command, a symbol): unverifiable, NOT expired.
        unverifiable += 1;
        unverifiablePrinciples.add(principle.id);
        continue;
      }
      pathReferences += 1;
      if (!artifact.resolvable) expired.push(trimmed);
    }
    if (expired.length === 0) continue;
    ctx.advice.push({
      kind: 'evidence-expired',
      principleId: principle.id,
      severity: 'warning',
      title: `${principle.id}: ${expired.length} evidencia(s) con forma de ruta ya no resuelven`,
      why: `La evidencia de ${principle.id} se comprobó contra el sistema de ficheros y estas referencias no existen en el repositorio: ${expired.join(', ')}. Un principio descriptivo que cita un artefacto inexistente afirma un hecho que ya no se puede inspeccionar.`,
      evidence: [
        ...expired.map((entry) => `no resuelve: ${entry}`),
        `principio: ${principle.id} (${principle.level}, ${principle.provenance})`,
      ],
      example: amendmentExample({
        id: `ADV-EVIDENCE-${safeId(principle.id)}`,
        title: `Reanclar la evidencia de ${principle.id}`,
        level: 'SHOULD',
        threat: 'evidencia caducada',
        restriction:
          'Toda evidencia de un principio descriptivo debe resolver a un artefacto presente en el repositorio.',
        pattern:
          'Sustituir la referencia caducada por la ruta vigente; si no existe sustituto, degradar el principio a borrador hasta re-anclarlo.',
        justification:
          'Una prueba que ya no existe convierte un hecho observado en una afirmación no verificable y erosiona la autoridad del documento completo.',
      }),
      apply: 'open-sdd brownfield constitution . --write',
    });
  }

  if (withEvidence.length > 0) {
    ctx.checked.push(
      `evidencia de principios en vigor: ${pathReferences} referencia(s) con forma de ruta comprobada(s) contra el disco en ${withEvidence.length} principio(s)`,
    );
  } else {
    ctx.notChecked.push('evidencia de principios en vigor: ningún principio en vigor declara evidencia');
  }
  if (unverifiable > 0) {
    // Honest reporting: a fact is not a path, so it is not checked and it is definitely not expired.
    ctx.notChecked.push(
      `evidencia no verificable (no tiene forma de ruta, no se cuenta como caducada): ${unverifiable} referencia(s) en ${Array.from(unverifiablePrinciples).join(', ')}`,
    );
  }
};

// ---------------------------------------------------------------------------------------------
// Signal 2 — practice-unstated
// ---------------------------------------------------------------------------------------------

const TEST_TOPIC = /\b(test|tests|prueba|pruebas|or[aá]culo|regresi[oó]n|cobertura|coverage)\b/i;

/**
 * Detect a practice the code follows that no principle states. A guess is not allowed, so every
 * finding states the deterministic check that produced it (a ratio of observed artifacts), and only
 * a 100% ratio counts as a practice.
 */
const checkPracticeUnstated = async (ctx: Ctx, inForce: ConstitutionPrinciple[]): Promise<void> => {
  const project = await scanProject(ctx.root);
  const principlesText = inForce
    .map((p) => [p.id, p.title, p.restriction, p.pattern, p.justification, (p.evidence ?? []).join(' ')].join(' '))
    .join('\n')
    .toLowerCase();

  // Practice A: every source module ships at least one test file naming it.
  if (project.sourceDirs.length > 0 && project.testDirs.length > 0 && project.modules.length > 0) {
    const testFiles = (await listFiles(ctx.root, project.testDirs)).map((f) => f.toLowerCase());
    if (testFiles.length > 0) {
      const covered = project.modules.filter((module) => testFiles.some((file) => file.includes(module.toLowerCase())));
      if (covered.length === project.modules.length && !TEST_TOPIC.test(principlesText)) {
        ctx.advice.push({
          kind: 'practice-unstated',
          severity: 'info',
          title: `Práctica no declarada: los ${project.modules.length} módulos con código tienen test`,
          why: `Se detectó listando los ficheros de los directorios de test (${project.testDirs.join(', ')}) y comprobando que cada módulo observado aparece nombrado en al menos uno: ${covered.length}/${project.modules.length}. Ningún principio en vigor lo enuncia, así que el código sigue una práctica sin autoridad citable.`,
          evidence: [
            `módulos observados: ${project.modules.join(', ')}`,
            `ficheros de test que los nombran: ${testFiles.length}`,
            'principio en vigor que lo declare: ninguno',
          ],
          example: amendmentExample({
            id: 'ADV-PRACTICE-TEST-PER-MODULE',
            title: 'Declarar el test por módulo como práctica gobernada',
            level: 'SHOULD',
            threat: 'práctica no declarada',
            restriction: 'Todo módulo con código se acompaña de al menos un fichero de test que lo nombra.',
            pattern:
              'Añadir el test del módulo en el directorio de test y nombrarlo con el módulo, como ya hace todo el código observado.',
            justification:
              'Una práctica que el repositorio ya cumple al cien por cien es una decisión de ingeniería sin registrar; sin principio, el siguiente cambio puede abandonarla sin que nadie lo note.',
          }),
          apply: 'open-sdd govern constitution --draft --write',
        });
      } else if (covered.length < project.modules.length) {
        ctx.checked.push(
          `práctica "test por módulo": ${covered.length}/${project.modules.length} módulos nombrados en test (no es una práctica del 100%, no se aconseja)`,
        );
      } else {
        ctx.checked.push('práctica "test por módulo": ya enunciada por un principio en vigor');
      }
    } else {
      ctx.notChecked.push('práctica "test por módulo": los directorios de test observados no contienen ficheros');
    }
  } else {
    ctx.notChecked.push(
      'práctica "test por módulo": no se observaron a la vez directorios de código con submódulos y directorios de test',
    );
  }

  // Practice B: a dependency declared in 100% of the readable manifests.
  const manifestPaths = [
    'package.json',
    ...(project.workspaceRoots ?? []).map((root) => path.posix.join(root, 'package.json')),
  ].filter((rel, index, all) => all.indexOf(rel) === index && existsSync(path.join(ctx.root, rel)));

  if (manifestPaths.length >= 2) {
    const declarations: Record<string, string[]> = {};
    const readable: string[] = [];
    for (const rel of manifestPaths) {
      const pkg = asRecord(await readJson(path.join(ctx.root, rel)));
      if (!pkg) continue;
      readable.push(rel);
      const deps = new Set<string>();
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
        const declared = asRecord(pkg[field]);
        if (declared) for (const name of Object.keys(declared)) deps.add(name);
      }
      for (const name of deps) (declarations[name] ??= []).push(rel);
    }
    if (readable.length >= 2) {
      const universal = Object.entries(declarations)
        .filter(([, roots]) => roots.length === readable.length)
        .map(([name]) => name)
        .filter((name) => !principlesText.includes(name.toLowerCase()))
        .sort();
      const reported = universal.slice(0, 3);
      for (const dependency of reported) {
        ctx.advice.push({
          kind: 'practice-unstated',
          severity: 'info',
          title: `Práctica no declarada: ${dependency} está en los ${readable.length} manifiestos`,
          why: `Se detectó leyendo los ${readable.length} manifiestos legibles (${readable.join(', ')}): "${dependency}" aparece declarado en todos (${readable.length}/${readable.length}). Ningún principio en vigor lo nombra, así que una convención universal del repositorio no tiene autoridad citable.`,
          evidence: [
            `declarado en: ${declarations[dependency].join(', ')}`,
            `manifiestos leídos: ${readable.length}`,
            'principio en vigor que lo nombre: ninguno',
          ],
          example: amendmentExample({
            id: `ADV-PRACTICE-DEP-${safeId(dependency)}`,
            title: `Declarar ${dependency} como dependencia gobernada`,
            level: 'MAY',
            threat: 'práctica no declarada',
            restriction: `${dependency} se declara en el manifiesto de todo módulo que lo use, como ya ocurre en el 100% de los manifiestos observados.`,
            pattern: `Añadir ${dependency} a dependencies/devDependencies del manifiesto correspondiente y justificar su uso en la delta.`,
            justification:
              'Una dependencia presente en todos los manifiestos es una decisión transversal del proyecto; declararla permite auditar su retirada sin depender de la memoria del equipo.',
          }),
          apply: 'open-sdd govern constitution --draft --write',
        });
      }
      ctx.checked.push(
        `práctica "dependencia en el 100% de manifiestos": ${readable.length} manifiesto(s) comparados, ${universal.length} dependencia(s) universal(es) no enunciadas, ${reported.length} reportada(s)`,
      );
    } else {
      ctx.notChecked.push('práctica "dependencia en el 100% de manifiestos": menos de dos manifiestos legibles');
    }
  } else {
    ctx.notChecked.push(
      'práctica "dependencia en el 100% de manifiestos": se necesitan al menos dos manifiestos package.json legibles',
    );
  }
};

// ---------------------------------------------------------------------------------------------
// Signal 3 — amendment-aged
// ---------------------------------------------------------------------------------------------

/**
 * A proposal is not law, but a proposal nobody decides is a finding. The model has no `proposedAt`,
 * so the only stored date is the amendment's `updatedAt` (ISO of the last state change). When no
 * date is stored the module says so in `notChecked` rather than inventing an age.
 */
const checkAmendmentAged = (ctx: Ctx, constitution: Constitution): void => {
  const declared = new Set(constitution.amendments.map((a) => a.id));
  const undecided = constitution.amendments.filter((a) => UNDECIDED_STATUSES.has(a.status));
  const drafts = constitution.principles.filter((p) => p.draft === true);
  const dated: { id: string; title: string; iso: string; principleId?: string }[] = [];
  const undated: string[] = [];

  const consider = (id: string, title: string, iso: string | undefined, principleId?: string): void => {
    if (iso && !Number.isNaN(Date.parse(iso))) dated.push({ id, title, iso, ...(principleId ? { principleId } : {}) });
    else undated.push(principleId ?? id);
  };

  for (const record of undecided) {
    const linked = constitution.principles.find((p) => p.amendment?.id === record.id);
    consider(record.id, record.title, record.updatedAt ?? linked?.amendment?.updatedAt, linked?.id);
  }
  for (const principle of drafts) {
    const record = principle.amendment;
    if (record && undecided.some((a) => a.id === record.id)) continue; // already considered
    if (record && (record.status === 'proposed' || record.status === 'under-review')) {
      consider(record.id, record.title || principle.title, record.updatedAt, principle.id);
    } else {
      // A draft principle with no registrable/dated amendment: we cannot date it, so we say so.
      undated.push(principle.id);
    }
  }

  for (const item of dated) {
    const ageDays = ageInDays(item.iso, ctx.now);
    if (ageDays === undefined || ageDays <= ctx.thresholdDays) continue;
    const canPromote = declared.has(item.id);
    ctx.advice.push({
      kind: 'amendment-aged',
      principleId: item.principleId ?? item.id,
      severity: 'warning',
      title: `Enmienda ${item.id} sin decisión desde hace ${ageDays} días`,
      why: `La enmienda ${item.id} ("${item.title}") sigue sin decisión (estado de propuesta) y su último cambio registrado es ${item.iso}, hace ${ageDays} días: supera el umbral de ${ctx.thresholdDays} días. Una propuesta que envejece sin ratificarse ni rechazarse no es ley pero tampoco es una decisión, y el documento se vuelve ambiguo sobre qué está en vigor.`,
      evidence: [
        `enmienda: ${item.id} — ${item.title}`,
        `último cambio registrado: ${item.iso} (${ageDays} días, umbral ${ctx.thresholdDays})`,
      ],
      ageDays,
      example: amendmentExample({
        id: `ADV-AMENDMENT-${safeId(item.id)}`,
        title: `Decidir la enmienda ${item.id}`,
        level: 'SHOULD',
        threat: 'enmienda sin decisión',
        restriction: `Toda enmienda propuesta se ratifica o se rechaza dentro de ${ctx.thresholdDays} días desde su último cambio.`,
        pattern:
          'Ratificarla con --promote y su plan de migración, o cerrarla como rechazada con motivo escrito; la ambigüedad no es un tercer estado.',
        justification:
          'Una propuesta vieja sin decisión deja a los agentes sin saber si la regla gobierna, y el silencio se interpreta como permiso para ignorarla.',
      }),
      ...(canPromote ? { apply: `open-sdd govern constitution --promote ${item.id} --plan "<plan de migración>"` } : {}),
    });
  }

  ctx.checked.push(
    `enmiendas sin decisión: ${undecided.length} registro(s) y ${drafts.length} principio(s) en borrador; con fecha comprobable: ${dated.length}`,
  );
  if (undated.length > 0) {
    ctx.notChecked.push(
      `antigüedad de enmiendas/borradores sin fecha registrada: ${Array.from(new Set(undated)).join(', ')} (el modelo no guarda una fecha de propuesta; sin dato no se inventa una edad)`,
    );
  }
};

// ---------------------------------------------------------------------------------------------
// Signal 4 — recurring-violation
// ---------------------------------------------------------------------------------------------

interface ViolationHit {
  principleId: string;
  at: string | null;
  source: string;
  detail: string;
}

const collectViolationHits = (payload: unknown, source: string): ViolationHit[] => {
  const root = asRecord(payload);
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.violations)
      ? (root.violations as unknown[])
      : Array.isArray(root?.records)
        ? (root.records as unknown[])
        : [];

  const hits: ViolationHit[] = [];
  for (const entry of list) {
    const record = asRecord(entry);
    if (!record) continue;
    let principleId: string | undefined;
    for (const key of PRINCIPLE_REFERENCE_KEYS) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        principleId = value.trim();
        break;
      }
    }
    if (!principleId) continue;
    const at = typeof record.at === 'string' ? record.at : typeof record.date === 'string' ? record.date : null;
    const detail = typeof record.reason === 'string' ? record.reason : typeof record.detail === 'string' ? record.detail : '';
    hits.push({ principleId, at, source, detail });
  }
  return hits;
};

/**
 * Recurrence needs history. This reads the candidate ledgers that exist, matches their records to
 * in-force principle ids, and only reports a principle seen in two or more records — optionally
 * restricted to the last 90 days when the records carry dates. When no ledger exists at all, the
 * signal is `notChecked`, because absence of history is not absence of violations.
 */
const checkRecurringViolation = async (ctx: Ctx, inForce: ConstitutionPrinciple[]): Promise<void> => {
  const existing: string[] = [];
  const hits: ViolationHit[] = [];
  for (const candidate of VIOLATION_HISTORY_CANDIDATES) {
    const file = path.join(ctx.root, candidate.replace(/^\.sdd\//, `${ctx.sddDir.replace(/\/$/, '')}/`));
    if (!existsSync(file)) continue;
    existing.push(candidate);
    const payload = await readJson(file);
    if (payload === null) {
      ctx.notChecked.push(`histórico de violaciones: ${candidate} existe pero no es JSON legible`);
      continue;
    }
    hits.push(...collectViolationHits(payload, candidate));
  }

  if (existing.length === 0) {
    ctx.notChecked.push(
      `violaciones recurrentes: no existe ningún histórico de recibos/claims/auditoría/adhesión (${VIOLATION_HISTORY_CANDIDATES.join(', ')})`,
    );
    return;
  }

  const inForceIds = new Set(inForce.map((p) => p.id));
  const relevant = hits.filter((hit) => inForceIds.has(hit.principleId));
  const ignored = hits.filter((hit) => !inForceIds.has(hit.principleId));
  const windowStart = ctx.now.getTime() - 90 * DAY_MS;
  const recurring = new Map<string, ViolationHit[]>();
  for (const hit of relevant) {
    if (hit.at) {
      const at = Date.parse(hit.at);
      if (!Number.isNaN(at) && at < windowStart) continue; // outside the 90-day recency window
    }
    const list = recurring.get(hit.principleId) ?? [];
    list.push(hit);
    recurring.set(hit.principleId, list);
  }

  for (const [principleId, occurrences] of recurring) {
    if (occurrences.length < 2) continue;
    const sources = Array.from(new Set(occurrences.map((o) => o.source)));
    const principle = inForce.find((p) => p.id === principleId);
    ctx.advice.push({
      kind: 'recurring-violation',
      principleId,
      severity: 'error',
      title: `${principleId} se incumple de forma recurrente (${occurrences.length} episodios)`,
      why: `El histórico registra ${occurrences.length} episodios recientes del principio ${principleId}${principle ? ` ("${principle.title}")` : ''}. Una violación repetida no es un descuido puntual: o el principio no describe la práctica real, o la evidencia demuestra que la regla no se está aplicando.`,
      evidence: [
        ...occurrences
          .slice(0, 5)
          .map((o) => `${o.source}: ${o.principleId}${o.at ? ` @ ${o.at}` : ' (sin fecha)'}${o.detail ? ` — ${o.detail}` : ''}`),
        `fuente(s): ${sources.join(', ')}`,
      ],
      example: amendmentExample({
        id: `ADV-RECURRING-${safeId(principleId)}`,
        title: `Reforzar ${principleId} tras reincidencia`,
        level: 'MUST',
        threat: 'violación recurrente',
        restriction: `Toda desviación de ${principleId}${principle ? ` ("${principle.restriction}")` : ''} genera un recibo con motivo y un plan de corrección antes de cerrar el cambio.`,
        pattern:
          'Exigir la comprobación del principio en la puerta de cambio y registrar cada relajación con actor, motivo y resultado posterior.',
        justification:
          'Cuando el mismo principio se incumple dos o más veces, el fallo está en el control y no en la persona: el principio necesita una comprobación ejecutable o debe reescribirse.',
      }),
    });
  }

  ctx.checked.push(
    `violaciones recurrentes: ${existing.length} histórico(s) leído(s) (${existing.join(', ')}), ${relevant.length} referencia(s) a principios en vigor, ${recurring.size} principio(s) con al menos un episodio reciente`,
  );
  if (ignored.length > 0) {
    ctx.notChecked.push(
      `violaciones recurrentes: ${ignored.length} registro(s) citan identificadores que no son principios en vigor (${Array.from(new Set(ignored.map((i) => i.principleId))).join(', ')})`,
    );
  }
};

// ---------------------------------------------------------------------------------------------
// Signal 5 — contradictory-principles
// ---------------------------------------------------------------------------------------------

interface TechFamily {
  name: string;
  members: string[];
}

const TECH_FAMILIES: TechFamily[] = [
  { name: 'gestor de paquetes', members: ['npm', 'yarn', 'pnpm', 'bun'] },
  { name: 'runner de tests', members: ['vitest', 'jest', 'mocha', 'ava', 'jasmine', 'playwright', 'cypress'] },
  { name: 'empaquetador', members: ['webpack', 'vite', 'rollup', 'esbuild', 'tsup', 'parcel'] },
  { name: 'framework web', members: ['react', 'vue', 'svelte', 'angular', 'express', 'fastify', 'nestjs', 'koa'] },
  { name: 'base de datos', members: ['postgres', 'postgresql', 'mysql', 'sqlite', 'mongodb', 'oracle'] },
];

const LOCK_CUE = /\b(solo|s[oó]lo|[uú]nicamente|exclusivamente|obligatori\w*|debe\s+usar|deben\s+usar|no\s+usar|nunca|prohibid\w*|sin\s+excepci[oó]n)\b/i;
const NEGATION = /\b(no|nunca|sin|prohibid\w*|evit\w*|jam[aá]s)\b/i;

const STOPWORDS = new Set([
  'para', 'como', 'todo', 'toda', 'todos', 'todas', 'cada', 'debe', 'deben', 'puede', 'pueden',
  'sobre', 'entre', 'desde', 'hasta', 'cuando', 'donde', 'porque', 'este', 'esta', 'estos', 'estas',
  'that', 'this', 'with', 'from', 'must', 'should', 'into', 'their', 'there', 'which', 'every',
]);

const tokensOf = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4 && !STOPWORDS.has(token)),
  );

const principleText = (principle: ConstitutionPrinciple): string =>
  [principle.id, principle.title, principle.restriction, principle.pattern, principle.justification, (principle.evidence ?? []).join(' ')].join(' ');

/** Technology members a principle LOCKS: names a member and either is a MUST or says "only/never". */
const lockedMembers = (principle: ConstitutionPrinciple): { family: TechFamily; member: string }[] => {
  const text = principleText(principle);
  const locks: { family: TechFamily; member: string }[] = [];
  for (const family of TECH_FAMILIES) {
    for (const member of family.members) {
      if (!mentions(text, member)) continue;
      if (principle.level === 'MUST' || LOCK_CUE.test(principle.restriction) || LOCK_CUE.test(principle.pattern)) {
        locks.push({ family, member });
      }
    }
  }
  return locks;
};

const checkContradictoryPrinciples = (ctx: Ctx, inForce: ConstitutionPrinciple[]): void => {
  const seenPairs = new Set<string>();

  // (a) Conflicting technology locks: two principles lock different members of the same family.
  const locks = inForce.map((principle) => ({ principle, locks: lockedMembers(principle) }));
  for (let i = 0; i < locks.length; i += 1) {
    for (let j = i + 1; j < locks.length; j += 1) {
      const left = locks[i];
      const right = locks[j];
      for (const family of TECH_FAMILIES) {
        const leftMembers = left.locks.filter((l) => l.family.name === family.name).map((l) => l.member);
        const rightMembers = right.locks.filter((l) => l.family.name === family.name).map((l) => l.member);
        for (const a of leftMembers) {
          for (const b of rightMembers) {
            if (a === b) continue;
            const key = [left.principle.id, right.principle.id].sort().join('|');
            if (seenPairs.has(key)) continue;
            seenPairs.add(key);
            ctx.advice.push({
              kind: 'contradictory-principles',
              principleId: left.principle.id,
              severity: 'error',
              title: `${left.principle.id} y ${right.principle.id} fijan ${family.name} distintos (${a} vs ${b})`,
              why: `Ambos principios están en vigor y bloquean tecnología de la misma familia (${family.name}): ${left.principle.id} fija "${a}" y ${right.principle.id} fija "${b}". Las dos restricciones no pueden cumplirse a la vez en el mismo árbol de código.`,
              evidence: [
                `${left.principle.id} (${left.principle.level}): ${a}`,
                `${right.principle.id} (${right.principle.level}): ${b}`,
                `familia en conflicto: ${family.name}`,
              ],
              example: amendmentExample({
                id: `ADV-CONTRADICTION-${safeId(left.principle.id)}-${safeId(right.principle.id)}`,
                title: `Resolver la contradicción entre ${left.principle.id} y ${right.principle.id}`,
                level: 'MUST',
                threat: 'principios incompatibles',
                restriction: `Dos principios en vigor no pueden fijar miembros distintos de la misma familia tecnológica (${family.name}).`,
                pattern:
                  'Retirar o degradar uno de los dos principios, o acotar su ámbito hasta que ambas restricciones puedan cumplirse en el mismo cambio.',
                justification:
                  'Un agente que lee ambas reglas no puede obedecerlas: la contradicción garantiza que al menos un veredicto bloqueará trabajo correcto.',
              }),
            });
          }
        }
      }
    }
  }

  // (b) Opposing polarity on the same target: same threat/CWE reference, an imposition pair
  // (MUST/SHOULD) and opposite negation over a shared topic. A MAY opposes nothing.
  for (let i = 0; i < inForce.length; i += 1) {
    for (let j = i + 1; j < inForce.length; j += 1) {
      const left = inForce[i];
      const right = inForce[j];
      const sameTarget =
        (left.cweReference !== undefined && left.cweReference === right.cweReference) ||
        (left.threatReference !== undefined &&
          left.threatReference.trim().toLowerCase() === right.threatReference?.trim().toLowerCase());
      if (!sameTarget) continue;
      const pairLevels = [left.level, right.level];
      if (!pairLevels.includes('MUST')) continue;
      if (!pairLevels.every((level) => level === 'MUST' || level === 'SHOULD')) continue;
      const negLeft = NEGATION.test(left.restriction);
      const negRight = NEGATION.test(right.restriction);
      if (negLeft === negRight) continue;
      const leftTokens = tokensOf(`${left.restriction} ${left.pattern}`);
      const shared = Array.from(tokensOf(`${right.restriction} ${right.pattern}`)).filter((token) => leftTokens.has(token));
      if (shared.length === 0) continue;
      const key = [left.id, right.id].sort().join('|');
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      const target = left.cweReference ?? left.threatReference ?? '(mismo objetivo)';
      ctx.advice.push({
        kind: 'contradictory-principles',
        principleId: left.id,
        severity: 'error',
        title: `${left.id} y ${right.id} ordenan y prohíben lo mismo (${target})`,
        why: `Los dos principios están en vigor, comparten objetivo (${target}) y tienen polaridad opuesta: ${left.id} lo exige y ${right.id} lo niega o lo prohíbe sobre el mismo tema ("${shared.slice(0, 3).join(', ')}"). Ambas restricciones no pueden sostenerse a la vez.`,
        evidence: [
          `${left.id} (MUST): ${left.restriction}`,
          `${right.id} (MUST): ${right.restriction}`,
          `objetivo compartido: ${target}`,
        ],
        example: amendmentExample({
          id: `ADV-POLARITY-${safeId(left.id)}-${safeId(right.id)}`,
          title: `Resolver la polaridad opuesta entre ${left.id} y ${right.id}`,
          level: 'MUST',
          threat: 'principios incompatibles',
          restriction: `Dos principios en vigor con el mismo objetivo (${target}) no pueden exigir y prohibir a la vez la misma conducta.`,
          pattern:
            'Elegir una polaridad, degradar la otra a SHOULD con su excepción declarada, o reescribir el objetivo para que cada principio cubra un caso distinto.',
          justification:
            'Una regla que se exige y se prohíbe sobre el mismo objetivo convierte el veredicto en una moneda al aire y la constitución en un documento que no puede obedecerse.',
        }),
      });
    }
  }

  ctx.checked.push(
    `contradicciones: ${inForce.length} principio(s) en vigor comparados por familia tecnológica (${TECH_FAMILIES.length} familia(s)) y por objetivo compartido`,
  );
};

// ---------------------------------------------------------------------------------------------
// Signal 6 — boundary-aged
// ---------------------------------------------------------------------------------------------

/**
 * The boundary source is the SAME reconnaissance the descriptive constitution cites as
 * C-BOUNDARIES: `scanProject` reports the observed module directories (`modules`, falling back to
 * `sourceDirs` when a source directory has no subdirectories). No second scanner is invented here,
 * so the advisor and the constitution cannot disagree about what a boundary is.
 */
const isBoundaryToken = (value: string): boolean =>
  /^[a-z][a-z0-9_-]{1,}$/i.test(value.trim()) && !value.includes('/') && !value.includes('.') && !/\s/.test(value);

const checkBoundaryAged = async (ctx: Ctx, inForce: ConstitutionPrinciple[]): Promise<void> => {
  const project = await scanProject(ctx.root);
  const discovered = Array.from(
    new Set((project.modules.length > 0 ? project.modules : project.sourceDirs).map(normalizePath)),
  ).filter(Boolean);

  const boundaryPrinciples = inForce.filter((p) =>
    /\b(frontera|fronteras|boundary|l[ií]mite|l[ií]mites|m[oó]dulo|m[oó]dulos|module|modules|servicio|servicios)\b/i.test(
      [p.id, p.title, p.restriction, p.pattern].join(' '),
    ),
  );
  const inForceText = inForce.map((p) => principleText(p)).join('\n');

  if (discovered.length === 0 && boundaryPrinciples.length === 0) {
    ctx.notChecked.push(
      'fronteras: el mapa de módulos (scanProject) no observó módulos ni directorios de código, y ningún principio en vigor declara fronteras',
    );
    return;
  }

  const declared = new Set<string>();
  for (const principle of boundaryPrinciples) {
    for (const entry of principle.evidence ?? []) {
      if (isBoundaryToken(entry)) declared.add(normalizePath(entry));
    }
  }

  const missing = discovered.filter((boundary) => !declared.has(boundary) && !mentions(inForceText, boundary));
  const vanished = Array.from(declared).filter(
    (boundary) => !discovered.includes(boundary) && !existsSync(path.join(ctx.root, boundary)),
  );

  if (boundaryPrinciples.length === 0 && discovered.length > 0) {
    ctx.advice.push({
      kind: 'boundary-aged',
      severity: 'info',
      title: `La constitución no declara ninguna frontera (el mapa observa ${discovered.length})`,
      why: `El mapa de módulos observó ${discovered.length} frontera(s) en el código (${discovered.join(', ')}) y ningún principio en vigor las nombra, así que un cambio puede cruzar un límite sin cruzarlo contra ninguna regla citable.`,
      evidence: [`fronteras observadas: ${discovered.join(', ')}`, 'principio en vigor que las declare: ninguno'],
      example: amendmentExample({
        id: 'ADV-BOUNDARIES-UNDECLARED',
        title: 'Declarar las fronteras de módulo observadas',
        level: 'SHOULD',
        threat: 'frontera de módulo no declarada',
        restriction: `El cambio no cruza las fronteras observadas (${discovered.join(', ')}) salvo que la delta declare el cruce.`,
        pattern:
          'Añadir estas fronteras a la evidencia del principio de límites, como hace la constitución descriptiva cuando registra el mapa de módulos.',
        justification:
          'Una frontera que existe en el código y no en la constitución convierte cada cruce en una refactorización involuntaria sin autoridad que la juzgue.',
      }),
      apply: 'open-sdd brownfield constitution . --write',
    });
  }

  for (const boundary of missing) {
    if (boundaryPrinciples.length === 0) break; // already covered by the aggregate finding above
    ctx.advice.push({
      kind: 'boundary-aged',
      severity: 'info',
      title: `Frontera "${boundary}" observada y no declarada en la constitución`,
      why: `El mapa de módulos observó la frontera "${boundary}" en el código y ningún principio en vigor la nombra; la constitución quedó atrás respecto a la arquitectura real.`,
      evidence: [`fronteras observadas: ${discovered.join(', ')}`, `no declarada: ${boundary}`],
      example: amendmentExample({
        id: `ADV-BOUNDARY-${safeId(boundary)}`,
        title: `Declarar la frontera ${boundary}`,
        level: 'SHOULD',
        threat: 'frontera de módulo no declarada',
        restriction: `El cambio no cruza la frontera "${boundary}" salvo que la delta declare el cruce.`,
        pattern: `Añadir "${boundary}" a la evidencia del principio que gobierna los límites de módulo.`,
        justification:
          'Una frontera que existe en el código y no en la constitución deja el límite sin autoridad citable, y el primer cruce silencioso nadie lo nota.',
      }),
      apply: 'open-sdd brownfield constitution . --write',
    });
  }

  for (const boundary of vanished) {
    ctx.advice.push({
      kind: 'boundary-aged',
      severity: 'warning',
      title: `La constitución nombra la frontera "${boundary}", que ya no existe en disco`,
      why: `Un principio en vigor cita la frontera "${boundary}", pero ni el mapa de módulos la observa ni existe la ruta en el repositorio: la constitución describe una arquitectura que ya no está.`,
      evidence: [`citada por la constitución: ${boundary}`, `fronteras observadas hoy: ${discovered.join(', ') || '(ninguna)'}`],
      example: amendmentExample({
        id: `ADV-BOUNDARY-RETIRED-${safeId(boundary)}`,
        title: `Retirar la frontera ${boundary} de la constitución`,
        level: 'SHOULD',
        threat: 'frontera de módulo obsoleta',
        restriction: `La constitución no nombra fronteras que el mapa de módulos ya no observa, salvo que declare dónde se movieron.`,
        pattern: `Eliminar "${boundary}" de la evidencia del principio de límites o actualizarla a la ubicación vigente, dejando registro del traslado.`,
        justification:
          'Una frontera fantasma hace que los agentes busquen límites que no existen y que los veredictos citen una arquitectura que ya nadie mantiene.',
      }),
      apply: 'open-sdd brownfield constitution . --write',
    });
  }

  ctx.checked.push(
    `fronteras: ${discovered.length} observada(s) por el mapa de módulos (scanProject, la misma fuente que cita C-BOUNDARIES) frente a ${declared.size} nombrada(s) en ${boundaryPrinciples.length} principio(s) de límites`,
  );
};

// ---------------------------------------------------------------------------------------------
// Signal 7 — stack-drifted
// ---------------------------------------------------------------------------------------------

const MANAGER_FAMILY = TECH_FAMILIES[0];
const LANGUAGE_FAMILY: TechFamily = { name: 'lenguaje', members: ['typescript', 'javascript', 'python', 'go', 'rust'] };

const checkStackDrifted = (ctx: Ctx, inForce: ConstitutionPrinciple[], project: Awaited<ReturnType<typeof scanProject>>): void => {
  const managerStatements = new Map<string, string[]>(); // member -> principle ids
  const languageStatements = new Map<string, string[]>();

  for (const principle of inForce) {
    const text = principleText(principle);
    if (principle.level !== 'MUST' && !LOCK_CUE.test(text)) continue;
    for (const member of MANAGER_FAMILY.members) {
      if (!mentions(text, member)) continue;
      const ids = managerStatements.get(member) ?? [];
      ids.push(principle.id);
      managerStatements.set(member, ids);
    }
    for (const member of LANGUAGE_FAMILY.members) {
      if (!mentions(text, member)) continue;
      const ids = languageStatements.get(member) ?? [];
      ids.push(principle.id);
      languageStatements.set(member, ids);
    }
  }

  const observedManager = project.packageManager;
  if (managerStatements.size === 0) {
    ctx.notChecked.push('stack: ningún principio en vigor declara un gestor de paquetes comparable con el manifiesto');
  } else if (managerStatements.size === 1 && observedManager) {
    const [stated] = Array.from(managerStatements.keys());
    if (MANAGER_FAMILY.members.includes(observedManager) && observedManager !== stated) {
      const ids = managerStatements.get(stated) ?? [];
      ctx.advice.push({
        kind: 'stack-drifted',
        severity: 'warning',
        title: `La constitución declara ${stated} y el manifiesto fija ${observedManager}`,
        why: `El principio ${ids.join(', ')} declara el gestor de paquetes "${stated}" y la reconversión del manifiesto (lockfile) observa "${observedManager}". El principio afirma como hecho un stack que el repositorio ya no usa.`,
        evidence: [
          `principio: ${ids.join(', ')} → ${stated}`,
          `observado en el manifiesto/lockfile: ${observedManager}`,
        ],
        example: amendmentExample({
          id: 'ADV-STACK-DRIFT',
          title: `Alinear el principio con el gestor ${observedManager}`,
          level: 'MUST',
          threat: 'deriva de stack',
          restriction: `El gestor de paquetes que declara un principio debe coincidir con el que fija el lockfile del repositorio (${observedManager}).`,
          pattern: `Usar ${observedManager} en todos los manifiestos y scripts, o tramitar una enmienda que autorice el cambio y migre el lockfile con su justificación.`,
          justification:
            'Un principio que declara un gestor distinto del que el repositorio usa convierte el stack en ficción y enseña a los agentes a desconfiar de la constitución.',
        }),
        apply: 'open-sdd brownfield constitution . --write',
      });
    } else if (!MANAGER_FAMILY.members.includes(observedManager) && observedManager !== stated) {
      ctx.notChecked.push(
        `stack: el principio declara ${stated} y el gestor observado (${observedManager}) no pertenece a la misma familia comparable`,
      );
    } else {
      ctx.checked.push(`stack (gestor de paquetes): declarado ${stated} y observado ${observedManager} — coinciden`);
    }
  } else if (managerStatements.size > 1) {
    ctx.checked.push(
      `stack (gestor de paquetes): ${managerStatements.size} gestores declarados (${Array.from(managerStatements.keys()).join(', ')}); el conflicto lo reporta contradictory-principles`,
    );
  } else {
    ctx.notChecked.push('stack: no se pudo observar el gestor de paquetes del repositorio');
  }

  const observedLanguage = project.language;
  if (languageStatements.size === 0) {
    ctx.notChecked.push('stack (lenguaje): ningún principio en vigor declara un lenguaje comparable con el código');
  } else if (languageStatements.size === 1 && observedLanguage && observedLanguage !== 'unknown') {
    const [stated] = Array.from(languageStatements.keys());
    if (stated !== observedLanguage.toLowerCase()) {
      const ids = languageStatements.get(stated) ?? [];
      ctx.advice.push({
        kind: 'stack-drifted',
        severity: 'warning',
        title: `La constitución declara ${stated} y el código es ${observedLanguage}`,
        why: `El principio ${ids.join(', ')} declara el lenguaje/runtime "${stated}" y el escaneo del proyecto observa "${observedLanguage}". La constitución describe un stack distinto del que el repositorio contiene.`,
        evidence: [`principio: ${ids.join(', ')} → ${stated}`, `observado en el código: ${observedLanguage}`],
        example: amendmentExample({
          id: 'ADV-STACK-LANGUAGE',
          title: `Alinear el principio con el lenguaje ${observedLanguage}`,
          level: 'SHOULD',
          threat: 'deriva de stack',
          restriction: `El lenguaje o runtime que declara un principio debe coincidir con el que se observa en el código (${observedLanguage}).`,
          pattern: 'Actualizar el principio y su evidencia al lenguaje vigente, o declarar el cambio como enmienda gobernada.',
          justification:
            'Un lenguaje declarado que ya no es el del repositorio hace que todo principio derivado de él se lea como una aspiración incumplida, no como un hecho.',
        }),
        apply: 'open-sdd brownfield constitution . --write',
      });
    } else {
      ctx.checked.push(`stack (lenguaje): declarado ${stated} y observado ${observedLanguage} — coinciden`);
    }
  } else if (languageStatements.size > 1) {
    ctx.checked.push(
      `stack (lenguaje): ${languageStatements.size} lenguajes declarados (${Array.from(languageStatements.keys()).join(', ')})`,
    );
  }
};

// ---------------------------------------------------------------------------------------------
// Signal 8 — waiver-expiring
// ---------------------------------------------------------------------------------------------

interface AllowlistWaiver {
  path: string;
  expires: string;
  owner?: string;
}

const readWaivers = async (ctx: Ctx): Promise<{ waivers: AllowlistWaiver[]; total: number } | null> => {
  const file = path.join(ctx.root, ctx.sddDir, 'settings', 'security-allowlist.json');
  if (!existsSync(file)) return null;
  const payload = await readJson(file);
  if (payload === null) return null;
  const root = asRecord(payload);
  const list = Array.isArray(payload) ? payload : Array.isArray(root?.allow) ? (root.allow as unknown[]) : [];
  const waivers: AllowlistWaiver[] = [];
  for (const entry of list) {
    const record = asRecord(entry);
    if (!record) continue;
    const expires = typeof record.expires === 'string' ? record.expires.trim() : '';
    if (!expires) continue; // owner/expires are optional: an entry without a date is skipped
    waivers.push({
      path: typeof record.path === 'string' ? record.path : '(sin ruta)',
      expires,
      ...(typeof record.owner === 'string' && record.owner.trim() ? { owner: record.owner.trim() } : {}),
    });
  }
  return { waivers, total: list.length };
};

const checkWaiverExpiring = async (ctx: Ctx): Promise<void> => {
  const read = await readWaivers(ctx);
  if (read === null) {
    ctx.notChecked.push(
      `exenciones con caducidad: no hay ${ctx.sddDir}/settings/security-allowlist.json legible`,
    );
    return;
  }
  if (read.waivers.length === 0) {
    ctx.notChecked.push(
      `exenciones con caducidad: ninguna de las ${read.total} entrada(s) declara "expires" (owner/expires son opcionales; sin fecha no se puede juzgar la caducidad)`,
    );
    return;
  }

  for (const waiver of read.waivers) {
    const at = Date.parse(waiver.expires);
    if (Number.isNaN(at)) {
      ctx.notChecked.push(`exención ${waiver.path}: "expires" no es una fecha legible (${waiver.expires})`);
      continue;
    }
    const daysLeft = Math.ceil((at - ctx.now.getTime()) / DAY_MS);
    if (daysLeft > WAIVER_WINDOW_DAYS) continue;
    const expired = daysLeft < 0;
    ctx.advice.push({
      kind: 'waiver-expiring',
      severity: expired ? 'warning' : 'info',
      title: expired
        ? `La exención de ${waiver.path} caducó hace ${-daysLeft} días`
        : `La exención de ${waiver.path} caduca en ${daysLeft} días`,
      why: `La entrada de la lista de excepciones de seguridad para "${waiver.path}" declara expires=${waiver.expires} (${expired ? `caducada hace ${-daysLeft} días` : `quedan ${daysLeft} días`}, ventana de ${WAIVER_WINDOW_DAYS}). Una excepción sin revisar tiende a volverse permanente, que es justo lo que el registro con motivo y actor existe para evitar.`,
      evidence: [
        `exención: ${waiver.path}`,
        `expires: ${waiver.expires} (${expired ? `caducada hace ${-daysLeft} días` : `quedan ${daysLeft} días`})`,
        ...(waiver.owner ? [`responsable: ${waiver.owner}`] : ['responsable: no declarado']),
      ],
      ...(expired ? { ageDays: -daysLeft } : {}),
      example: amendmentExample({
        id: `ADV-WAIVER-${safeId(waiver.path)}`,
        title: `Renovar o retirar la exención de ${waiver.path}`,
        level: 'SHOULD',
        threat: 'exención de seguridad sin revisión',
        restriction: `Ninguna exención de la lista de seguridad llega a su fecha "expires" sin que un responsable la renueve con motivo actualizado o la retire resolviendo el hallazgo.`,
        pattern:
          'Revisar la entrada en .sdd/settings/security-allowlist.json, actualizar reason y expires con el responsable vigente, o eliminar la entrada y corregir el hallazgo que cubría.',
        justification:
          'Una excepción que caduca sin revisión se convierte en una supresión permanente: el control sigue apagado y nadie recuerda por qué se apagó.',
      }),
    });
  }

  ctx.checked.push(
    `exenciones con caducidad: ${read.waivers.length} de ${read.total} entrada(s) declaran expires (ventana de ${WAIVER_WINDOW_DAYS} días a ${ctx.now.toISOString()})`,
  );
};

// ---------------------------------------------------------------------------------------------
// Constitution read
// ---------------------------------------------------------------------------------------------

interface LoadedConstitution {
  path: string;
  constitution: Constitution;
}

const readConstitution = async (root: string, sddDir: string): Promise<LoadedConstitution | null> => {
  const candidates = [
    path.join(root, sddDir, 'steering', 'constitution.md'),
    path.join(root, sddDir, 'constitution.md'),
    path.join(root, '.kiro', 'steering', 'constitution.md'),
  ];
  for (const candidate of candidates) {
    const raw = await readText(candidate);
    if (raw === null) continue;
    return { path: candidate, constitution: parseConstitution(raw) };
  }
  return null;
};

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

const SEVERITY_ORDER: Record<AdviceSeverity, number> = { error: 0, warning: 1, info: 2 };

/**
 * Advise the constitution on its own aging. Reads only what exists; every finding carries the
 * evidence it rests on, a paste-ready amendment example and (when one exists) the command to apply
 * it. `checked`/`notChecked` are explicit and `complete` is exactly `notChecked.length === 0`.
 */
export const adviseConstitution = async (cwd: string, options: AdviceOptions = {}): Promise<AdviceReport> => {
  const root = path.resolve(cwd);
  const sddDir = options.sddDir ?? '.sdd';
  const now = options.now ?? new Date();
  const thresholdDays = options.thresholdDays ?? DEFAULT_AMENDMENT_THRESHOLD_DAYS;
  const ctx: Ctx = { root, sddDir, now, thresholdDays, advice: [], checked: [], notChecked: [] };

  const loaded = await readConstitution(root, sddDir);
  if (loaded === null) {
    return {
      project: path.basename(root) || 'project',
      advice: [],
      checked: [],
      notChecked: [
        `constitución: no se encontró ${sddDir}/steering/constitution.md ni ${sddDir}/constitution.md — sin documento en vigor no hay nada que aconsejar`,
      ],
      detail: 'No se pudo aconsejar: no hay constitución que leer. Ningún principio se inspeccionó.',
      complete: false,
    };
  }

  const constitution = loaded.constitution;
  const inForce = principlesInForce(constitution);
  ctx.checked.push(
    `constitución: ${constitution.principles.length} principio(s) (${inForce.length} en vigor, ${constitution.principles.length - inForce.length} fuera de vigor), ${constitution.amendments.length} enmienda(s), leída de ${normalizePath(path.relative(root, loaded.path))}`,
  );
  if (inForce.length === 0) {
    ctx.notChecked.push(
      'principios en vigor: la constitución no tiene ningún principio en vigor; solo un borrador viejo sin ratificar puede reportarse como amendment-aged',
    );
  }

  const project = await scanProject(root);

  checkEvidenceExpired(ctx, inForce);
  await checkPracticeUnstated(ctx, inForce);
  checkAmendmentAged(ctx, constitution);
  await checkRecurringViolation(ctx, inForce);
  checkContradictoryPrinciples(ctx, inForce);
  await checkBoundaryAged(ctx, inForce);
  checkStackDrifted(ctx, inForce, project);
  await checkWaiverExpiring(ctx);

  ctx.advice.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const errors = ctx.advice.filter((a) => a.severity === 'error').length;
  const warnings = ctx.advice.filter((a) => a.severity === 'warning').length;
  const infos = ctx.advice.filter((a) => a.severity === 'info').length;
  const complete = ctx.notChecked.length === 0;

  return {
    project: constitution.project,
    advice: ctx.advice,
    checked: ctx.checked,
    notChecked: ctx.notChecked,
    detail:
      `Consejo de constitución: ${ctx.advice.length} hallazgo(s) (${errors} error, ${warnings} aviso, ${infos} info) ` +
      `sobre ${inForce.length} principio(s) en vigor; ${ctx.checked.length} comprobación(es) hecha(s) y ` +
      `${ctx.notChecked.length} no comprobable(s)${complete ? '. Análisis completo.' : ': el análisis es INCOMPLETO.'}`,
    complete,
  };
};

/** Compact, model-free rendering: kind, severity, title, one line of evidence, apply if present. */
export const renderAdvice = (report: AdviceReport): string[] => {
  const lines: string[] = [];
  lines.push(`Consejo de constitución — ${report.project}`);
  lines.push(
    `${report.advice.length} consejo(s) · ${report.complete ? 'análisis completo' : 'INCOMPLETO (ver «no comprobado»)'} · umbral de enmienda y ventana de exención aplicados`,
  );
  lines.push('');
  if (report.advice.length === 0) {
    lines.push('  Sin envejecimiento detectado con la evidencia disponible.');
  }
  for (const advice of report.advice) {
    const scope = advice.principleId ? ` (${advice.principleId})` : '';
    const age = advice.ageDays !== undefined ? ` · ${advice.ageDays}d` : '';
    lines.push(`  [${advice.severity}] ${advice.kind}${scope}${age} — ${advice.title}`);
    lines.push(`      por qué: ${advice.why}`);
    if (advice.evidence.length > 0) lines.push(`      evidencia: ${advice.evidence[0]}`);
    if (advice.apply) lines.push(`      aplicar: ${advice.apply}`);
  }
  lines.push('');
  lines.push(`  Comprobado: ${report.checked.length > 0 ? report.checked.join(' | ') : 'nada'}`);
  lines.push(`  No comprobado: ${report.notChecked.length > 0 ? report.notChecked.join(' | ') : 'nada'}`);
  lines.push(`  ${report.detail}`);
  return lines;
};
