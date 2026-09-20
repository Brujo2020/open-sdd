/**
 * Delta specs: the contract of change (brownfield objective, §12 of the reference architecture).
 *
 * In brownfield the existing code is the de facto source of truth, so the unit of specification is
 * not the system but the DELTA. A delta describes only what changes — ADDED, MODIFIED, REMOVED,
 * RENAMED (the ADSR mnemonic) — and every entry carries a DELTA-SCOPED requirement id
 * (`REQ-<AREA>-<NNN>`) rather than an identifier for the whole system. That scoping is what keeps
 * the obligation finite: a task traces to the delta's requirement, never to "everything".
 *
 * Three rules make the difference between a delta and a wish list, and all three are enforced here:
 *
 *   1. A modification must name the behaviour it replaces (`previous`), because "most work modifies
 *      existing behaviour" and a modification that cannot say what it changes is a rewrite.
 *   2. A modification or removal must name the CONTRACTS that cover that behaviour. Those contracts
 *      are the regression oracle: the extracted specification's first use is protecting what must
 *      not change, not producing documentation.
 *   3. A removal must state its rationale and migration path. Removing behaviour is a decision, and
 *      decisions are recorded (invariant I6 in spirit).
 *
 * Strangulation is modelled per entry (`legacy` → `both` → `new`), so moving a piece of the old
 * system into the new one is a change proposal with visible progress instead of a rewrite.
 */

import { validateEarsRequirement, type EarsVerdict } from './ears.js';

export type DeltaKind = 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED';

/** Where a behaviour sits while the old and the new implementation coexist. */
export type StranglerState = 'legacy' | 'both' | 'new';

export const DELTA_KINDS: DeltaKind[] = ['ADDED', 'MODIFIED', 'REMOVED', 'RENAMED'];

export interface DeltaEntry {
  /** Delta-scoped identifier, e.g. REQ-AUTH-001. */
  id: string;
  kind: DeltaKind;
  title: string;
  /** EARS statement of the resulting behaviour. */
  statement: string;
  /** Files, symbols, endpoints or schemas the change touches. */
  targets: string[];
  /** For MODIFIED / REMOVED / RENAMED: the behaviour being replaced. Required. */
  previous?: string;
  /** Contracts (test names, paths) that cover the behaviour and must keep passing. */
  contracts?: string[];
  /** For REMOVED: why, plus the migration path for whoever depended on it. */
  rationale?: string;
  strangler?: StranglerState;
  /**
   * Set by `delta merge --write` once this entry has actually been folded into the base
   * specification. It is the per-entry half of the `merged` label: without it the label was a word
   * the author typed and the base was never rewritten, and REMOVED/RENAMED entries (whose target is
   * GONE after a successful merge) could not be told apart from an entry that never had a target.
   */
  merged?: boolean;
}

export interface DeltaSpec {
  feature: string;
  title: string;
  /** Base feature or spec this delta applies to, when it is not the feature itself. */
  base?: string;
  status: 'proposed' | 'approved' | 'merged';
  entries: DeltaEntry[];
}

export type DeltaIssueCode =
  | 'ID_FORMAT'
  | 'DUPLICATE_ID'
  | 'NO_STATEMENT'
  | 'NO_TARGETS'
  | 'MISSING_PREVIOUS'
  | 'MISSING_RATIONALE'
  | 'MISSING_CONTRACTS'
  | 'EMPTY_SECTION'
  | 'NOT_A_DELTA'
  | 'EARS';

export interface DeltaIssue {
  severity: 'error' | 'warning';
  code: DeltaIssueCode;
  id: string;
  message: string;
}

/** The delta id grammar: REQ-<AREA>-<NNN>, scoped to the change rather than to the system. */
export const DELTA_ID_PATTERN = /^REQ-[A-Z0-9]+(-[A-Z0-9]+)*-\d{3}$/;

/** Above this size a "delta" is almost certainly a full-system spec in disguise. */
export const DELTA_SIZE_WARNING = 25;

/**
 * Validate a delta. Errors block; warnings are the honest signal that the artifact is drifting
 * towards a full-system specification, which is the failure mode this whole approach exists to
 * avoid.
 */
export const validateDeltaSpec = (delta: DeltaSpec): DeltaIssue[] => {
  const issues: DeltaIssue[] = [];
  const seen = new Set<string>();

  for (const kind of DELTA_KINDS) {
    if (delta.entries.length > 0 && !delta.entries.some((e) => e.kind === kind) && kind !== 'RENAMED') {
      issues.push({
        severity: 'warning',
        code: 'EMPTY_SECTION',
        id: delta.feature,
        message: `La sección ${kind} está vacía. Las deltas describen solo lo que cambia: si de verdad no cambia nada de este tipo, es correcto — pero conviene que sea una decisión y no un olvido (ADSR).`,
      });
    }
  }

  for (const entry of delta.entries) {
    if (!DELTA_ID_PATTERN.test(entry.id)) {
      issues.push({
        severity: 'error',
        code: 'ID_FORMAT',
        id: entry.id || '(sin id)',
        message:
          'El identificador de una delta es propio del cambio y con forma REQ-<ÁREA>-<NNN> (p. ej. REQ-AUTH-001). Un id del sistema completo rompe la trazabilidad fina.',
      });
    }
    if (seen.has(entry.id)) {
      issues.push({ severity: 'error', code: 'DUPLICATE_ID', id: entry.id, message: 'Identificador duplicado en la delta.' });
    }
    seen.add(entry.id);

    if (!entry.statement.trim()) {
      issues.push({
        severity: 'error',
        code: 'NO_STATEMENT',
        id: entry.id,
        message: 'Falta el enunciado: la delta debe decir qué comportamiento resulta del cambio.',
      });
    } else {
      const verdict: EarsVerdict = validateEarsRequirement(entry.statement);
      if (!verdict.conforms) {
        issues.push({
          severity: 'error',
          code: 'EARS',
          id: entry.id,
          message: `El enunciado no es EARS: ${verdict.issues.map((i) => `${i.code} (${i.message})`).join('; ')}`,
        });
      }
    }

    if (entry.targets.length === 0) {
      issues.push({
        severity: 'error',
        code: 'NO_TARGETS',
        id: entry.id,
        message: 'Sin objetivos declarados no hay análisis de impacto posible: indica ficheros, símbolos, endpoints o esquemas.',
      });
    }

    if ((entry.kind === 'MODIFIED' || entry.kind === 'REMOVED' || entry.kind === 'RENAMED') && !entry.previous?.trim()) {
      issues.push({
        severity: 'error',
        code: 'MISSING_PREVIOUS',
        id: entry.id,
        message: `Una entrada ${entry.kind} debe nombrar el comportamiento existente que sustituye: la mayor parte del trabajo modifica lo que ya hay.`,
      });
    }

    if (entry.kind === 'REMOVED') {
      if (!entry.rationale?.trim()) {
        issues.push({
          severity: 'error',
          code: 'MISSING_RATIONALE',
          id: entry.id,
          message: 'Una eliminación sin motivo ni ruta de migración es un accidente, no una decisión.',
        });
      }
      if ((entry.contracts ?? []).length === 0) {
        issues.push({
          severity: 'error',
          code: 'MISSING_CONTRACTS',
          id: entry.id,
          message:
            'Una eliminación debe declarar los contratos de ejecución que cubrían ese comportamiento: el oráculo de regresión es lo que convierte el cambio en algo revisable.',
        });
      }
    }

    if (entry.kind === 'MODIFIED' && (entry.contracts ?? []).length === 0) {
      issues.push({
        severity: 'warning',
        code: 'MISSING_CONTRACTS',
        id: entry.id,
        message:
          'Una modificación sin contratos asociados no puede demostrar que lo existente sigue intacto. Añade las pruebas que cubren el comportamiento modificado.',
      });
    }
  }

  if (delta.entries.length > DELTA_SIZE_WARNING) {
    issues.push({
      severity: 'warning',
      code: 'NOT_A_DELTA',
      id: delta.feature,
      message: `${delta.entries.length} entradas superan el umbral de ${DELTA_SIZE_WARNING}: esto empieza a parecer una especificación del sistema completo. La unidad correcta es un cambio acotado e independientemente revisable.`,
    });
  }

  return issues;
};

export const deltaCounts = (delta: DeltaSpec): Record<DeltaKind, number> => {
  const counts: Record<DeltaKind, number> = { ADDED: 0, MODIFIED: 0, REMOVED: 0, RENAMED: 0 };
  for (const entry of delta.entries) counts[entry.kind] += 1;
  return counts;
};

/** Strangulation progress: how much of the change still runs on the legacy path. */
export const strangulationReport = (
  delta: DeltaSpec,
): { total: number; byState: Record<StranglerState, number>; pending: string[]; detail: string } => {
  const byState: Record<StranglerState, number> = { legacy: 0, both: 0, new: 0 };
  const pending: string[] = [];

  for (const entry of delta.entries) {
    const state: StranglerState = entry.strangler ?? 'legacy';
    byState[state] += 1;
    if (state !== 'new') pending.push(entry.id);
  }

  const total = delta.entries.length;
  return {
    total,
    byState,
    pending,
    detail:
      total === 0
        ? 'Delta vacía.'
        : `Estrangulamiento: ${byState.new}/${total} entradas completamente en el camino nuevo; ${byState.both} conviven y ${byState.legacy} siguen en el legado.`,
  };
};

// ---------------------------------------------------------------------------------------------
// Traceability: delta REQ-ID -> task -> code
// ---------------------------------------------------------------------------------------------

export interface DeltaTask {
  id: string;
  /** Raw task line, used to find the declared requirement ids. */
  raw: string;
  boundary?: string[];
}

export interface DeltaTraceability {
  mapped: { requirementId: string; tasks: string[]; targets: string[] }[];
  unmapped: string[];
  /** Tasks that claim a delta requirement id the delta does not define. */
  phantomTasks: { taskId: string; cited: string }[];
  coverage: number;
  detail: string;
}

/**
 * Trace a delta to its tasks.
 *
 * The rule from the research document is explicit: a task carries the DELTA's requirement id, not
 * an id for the whole system. So a task citing an unknown id is reported as a phantom, and a
 * requirement with no task is reported as unmapped — both directions, because only one of them is
 * usually checked.
 */
export const traceDelta = (delta: DeltaSpec, tasks: DeltaTask[]): DeltaTraceability => {
  const ids = new Set(delta.entries.map((e) => e.id));
  const mapped: DeltaTraceability['mapped'] = [];
  const unmapped: string[] = [];
  const phantomTasks: { taskId: string; cited: string }[] = [];
  const matchedTasks = new Set<string>();

  const declaredIds = (task: DeltaTask): string[] => {
    const declared = task.raw.match(/_Requirements:\s*([^_\n]+)_/i);
    const fromMetadata = declared
      ? declared[1]
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const fromRaw = Array.from(task.raw.matchAll(/REQ-[A-Z0-9-]+-\d{3}/gi)).map((m) => m[0].toUpperCase());
    return Array.from(new Set([...fromMetadata, ...fromRaw]));
  };

  for (const entry of delta.entries) {
    const owners = tasks.filter((t) => declaredIds(t).some((cited) => cited.toUpperCase() === entry.id));
    if (owners.length === 0) {
      unmapped.push(entry.id);
    } else {
      owners.forEach((o) => matchedTasks.add(o.id));
      mapped.push({ requirementId: entry.id, tasks: owners.map((o) => o.id), targets: entry.targets });
    }
  }

  for (const task of tasks) {
    for (const cited of declaredIds(task)) {
      if (!ids.has(cited.toUpperCase())) phantomTasks.push({ taskId: task.id, cited });
    }
  }

  const coverage = delta.entries.length === 0 ? 1 : mapped.length / delta.entries.length;
  return {
    mapped,
    unmapped,
    phantomTasks,
    coverage,
    detail:
      delta.entries.length === 0
        ? 'Delta sin entradas que trazar.'
        : `${mapped.length}/${delta.entries.length} requisito(s) de la delta con tarea (${Math.round(coverage * 100)}%)${
            unmapped.length > 0 ? `; sin tarea: ${unmapped.join(', ')}` : ''
          }${phantomTasks.length > 0 ? `; tareas citando ids inexistentes: ${phantomTasks.map((p) => `${p.taskId}→${p.cited}`).join(', ')}` : ''}.`,
  };
};

// ---------------------------------------------------------------------------------------------
// Markdown round-trip
// ---------------------------------------------------------------------------------------------

const SECTION_ORDER: DeltaKind[] = ['ADDED', 'MODIFIED', 'REMOVED', 'RENAMED'];

export const renderDeltaSpec = (delta: DeltaSpec): string => {
  const lines: string[] = [];
  lines.push(`# Delta: ${delta.feature} — ${delta.title}`);
  lines.push('');
  lines.push(`Status: ${delta.status}`);
  if (delta.base) lines.push(`Base: ${delta.base}`);
  lines.push('');

  for (const kind of SECTION_ORDER) {
    lines.push(`## ${kind}`);
    for (const entry of delta.entries.filter((e) => e.kind === kind)) {
      lines.push('');
      lines.push(`### ${entry.id} — ${entry.title}`);
      lines.push(`- Statement: ${entry.statement}`);
      if (entry.previous) lines.push(`- Previous: ${entry.previous}`);
      lines.push(`- Targets: ${entry.targets.join(', ')}`);
      if ((entry.contracts ?? []).length > 0) lines.push(`- Contracts: ${(entry.contracts ?? []).join(', ')}`);
      if (entry.rationale) lines.push(`- Rationale: ${entry.rationale}`);
      lines.push(`- Strangler: ${entry.strangler ?? 'legacy'}`);
      if (entry.merged === true) lines.push('- Merged: true');
    }
    lines.push('');
  }

  return lines.join('\n');
};

export const parseDeltaSpec = (markdown: string): DeltaSpec => {
  const header = markdown.match(/^# Delta:\s*(.+?)\s*—\s*(.+)$/m);
  const status = (markdown.match(/^Status:\s*(proposed|approved|merged)$/m)?.[1] ?? 'proposed') as DeltaSpec['status'];
  const base = markdown.match(/^Base:\s*(.+)$/m)?.[1]?.trim();

  const delta: DeltaSpec = {
    feature: header?.[1]?.trim() ?? 'unknown',
    title: header?.[2]?.trim() ?? '',
    status,
    ...(base ? { base } : {}),
    entries: [],
  };

  let kind: DeltaKind | null = null;
  let current: DeltaEntry | null = null;

  const push = (): void => {
    if (current && kind) delta.entries.push(current);
    current = null;
  };

  // HTML comments are authoring guidance in the scaffold, not entries. Skipping them here keeps a
  // commented example from being parsed as a real requirement.
  let inComment = false;

  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd();

    if (inComment) {
      if (line.includes('-->')) inComment = false;
      continue;
    }
    if (line.trimStart().startsWith('<!--')) {
      if (!line.includes('-->')) inComment = true;
      continue;
    }

    const section = line.match(/^## (ADDED|MODIFIED|REMOVED|RENAMED)\s*$/);
    if (section) {
      push();
      kind = section[1] as DeltaKind;
      continue;
    }
    if (/^## /.test(line)) {
      push();
      kind = null;
      continue;
    }
    if (!kind) continue;

    const heading = line.match(/^### (REQ-[A-Z0-9-]+-\d{3})\s*—\s*(.+)$/);
    if (heading) {
      push();
      current = {
        id: heading[1],
        kind,
        title: heading[2].trim(),
        statement: '',
        targets: [],
      };
      continue;
    }

    const field = line.match(/^- (Statement|Previous|Targets|Contracts|Rationale|Strangler|Merged):\s*(.*)$/);
    if (field && current) {
      const [, key, value] = field;
      if (key === 'Statement') current.statement = value.trim();
      else if (key === 'Previous') current.previous = value.trim();
      else if (key === 'Targets') current.targets = value.split(',').map((t) => t.trim()).filter(Boolean);
      else if (key === 'Contracts') current.contracts = value.split(',').map((t) => t.trim()).filter(Boolean);
      else if (key === 'Rationale') current.rationale = value.trim();
      else if (key === 'Strangler') current.strangler = value.trim() as StranglerState;
      else if (key === 'Merged') current.merged = /^true$/i.test(value.trim());
    }
  }
  push();

  return delta;
};

/** Where a delta spec lives inside a feature directory. */
export const deltaSpecFileName = (): string => 'delta.md';

// ---------------------------------------------------------------------------------------------
// Merge-back: applying the delta to the base specification
// ---------------------------------------------------------------------------------------------

/**
 * Why this exists.
 *
 * `status: merged` was a label the author typed: nothing rewrote the base specification, so the
 * contract of change and the document the rest of the project reads could drift apart forever while
 * the label claimed they agreed. `mergeDeltaIntoBase` is the missing rewrite.
 *
 * The unit of merge is the requirement BLOCK of a `requirements.md`: a `### REQ-<ÁREA>-<NNN> — title`
 * heading plus everything up to the next level-2/level-3 heading. ADSR maps onto it directly:
 *
 *   ADDED     → insert a new block in the requirements section;
 *   MODIFIED  → rewrite the block's body with the resulting behaviour (requires `previous`);
 *   REMOVED   → delete the block;
 *   RENAMED   → change the heading only, so the behaviour's body survives byte-for-byte.
 *
 * Two properties are non-negotiable, because they are the difference between a merge and a guess:
 *
 *   1. BYTE PRESERVATION: every line outside a touched block is copied verbatim. The merge splices
 *      line ranges; it never re-renders the document.
 *   2. ALL-OR-NOTHING: one refusal means NOTHING is written. A delta is a contract; applying the half
 *      that happened to parse would rewrite the base with a contract nobody agreed to.
 *
 * Idempotency is decided by CONTENT, not by hope: an entry whose resulting block is already there is
 * reported `unchanged`, so a second merge says "sin cambios" instead of duplicating sections. The one
 * case content cannot decide is REMOVED/RENAMED, whose target is GONE after a successful merge — there
 * `entry.merged === true` (set by `delta merge --write`) or `status: merged` is what tells an
 * already-applied entry apart from an entry that never had a target in the base.
 */
export type DeltaMergeOutcome = 'added' | 'modified' | 'removed' | 'renamed' | 'unchanged' | 'withheld' | 'refused';

export interface DeltaMergeChange {
  id: string;
  kind: DeltaKind;
  outcome: DeltaMergeOutcome;
  /** The base requirement this entry touched or named, when one was resolved. */
  baseId?: string;
  message: string;
}

export interface DeltaMergeReport {
  feature: string;
  /** The new base text. When any entry was refused this is the input, unchanged. */
  text: string;
  /** True only when `text` differs from the base AND no entry was refused. */
  changed: boolean;
  changes: DeltaMergeChange[];
  /** Entries folded into the base by this call. Empty when anything was refused. */
  applied: DeltaMergeChange[];
  /** Entries the base already reflected (the idempotent second merge). */
  unchanged: DeltaMergeChange[];
  /** Entries that could not be applied, each with the reason. */
  refusals: DeltaMergeChange[];
  /** Spanish, user-visible. */
  detail: string;
}

export interface DeltaMergeOptions {
  /**
   * Treat REMOVED/RENAMED entries whose target is no longer in the base as already applied. Implied
   * by `delta.status === 'merged'`; the CLI sets that only after a real write.
   */
  assumeMerged?: boolean;
}

const MERGE_HEADING = /^###\s+(REQ-[A-Z0-9-]+-\d{3})\s*[—–-]\s*(.*)$/;

interface BaseRequirementBlock {
  id: string;
  title: string;
  headingIndex: number;
  /** Exclusive index of the first line AFTER the block; trailing blank lines excluded. */
  endIndex: number;
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();
const sameText = (a: string, b: string): boolean => collapse(a) === collapse(b);

const parseBaseRequirementBlocks = (lines: string[]): BaseRequirementBlock[] => {
  const blocks: BaseRequirementBlock[] = [];
  let headingIndex = -1;
  let id = '';
  let title = '';

  const flush = (boundary: number): void => {
    if (headingIndex < 0) return;
    let end = boundary;
    while (end > headingIndex + 1 && lines[end - 1].trim() === '') end -= 1;
    blocks.push({ id, title, headingIndex, endIndex: end });
    headingIndex = -1;
    id = '';
    title = '';
  };

  for (let i = 0; i < lines.length; i += 1) {
    const heading = lines[i].match(MERGE_HEADING);
    if (heading) {
      flush(i);
      headingIndex = i;
      id = heading[1].toUpperCase();
      title = heading[2].trim();
      continue;
    }
    // Only levels 2 and 3 close a block: `#### Acceptance criteria` belongs to the requirement above.
    if (headingIndex >= 0 && /^#{2,3}\s/.test(lines[i])) flush(i);
  }
  flush(lines.length);
  return blocks;
};

const blockStatements = (block: BaseRequirementBlock, lines: string[]): string[] =>
  lines
    .slice(block.headingIndex + 1, block.endIndex)
    .map((line) => line.match(/^- Statement:\s*(.*)$/)?.[1]?.trim())
    .filter((value): value is string => Boolean(value));

/**
 * Which base block does this entry name?
 *
 * MODIFIED/REMOVED name a block by the entry id when that id exists in the base (a delta entry may
 * reuse the system requirement id it changes); otherwise `previous` is resolved — first as a REQ id
 * inside the text, then as the block title, then as the full heading. RENAMED is different: its
 * `id` is the NEW name, so it must always resolve the OLD target from `previous`.
 */
const resolveBaseTarget = (
  blocks: BaseRequirementBlock[],
  entry: DeltaEntry,
): BaseRequirementBlock | null => {
  if (entry.kind !== 'RENAMED') {
    const byId = blocks.find((b) => b.id === entry.id.trim().toUpperCase());
    if (byId) return byId;
  }
  const previous = entry.previous?.trim();
  if (!previous) return null;

  const previousId = previous.match(/REQ-[A-Z0-9-]+-\d{3}/i)?.[0]?.toUpperCase();
  if (previousId) {
    const byPreviousId = blocks.find((b) => b.id === previousId);
    if (byPreviousId) return byPreviousId;
  }

  const byTitle = blocks.find((b) => sameText(b.title, previous));
  if (byTitle) return byTitle;

  const lead = previous.split(/[—–]/)[0]?.trim();
  if (lead) {
    const byLead = blocks.find((b) => sameText(b.title, lead));
    if (byLead) return byLead;
  }

  return blocks.find((b) => collapse(previous).includes(collapse(b.title))) ?? null;
};

/** The `## Requirements` section, or the whole document when no such heading exists. */
const requirementsSectionRange = (lines: string[]): { start: number; end: number } => {
  const start = lines.findIndex((line) => /^##\s+requirements\s*$/i.test(line.trim()));
  if (start < 0) return { start: 0, end: lines.length };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
};

/** Where a new requirement block goes: after the last block of the requirements section. */
const addedInsertionIndex = (
  lines: string[],
  blocks: BaseRequirementBlock[],
  section: { start: number; end: number },
): number => {
  const inside = blocks.filter((b) => b.headingIndex > section.start && b.headingIndex < section.end);
  if (inside.length > 0) return inside[inside.length - 1].endIndex;
  let lastContent = section.start;
  for (let i = section.start + 1; i < section.end; i += 1) {
    if (lines[i].trim() !== '') lastContent = i;
  }
  return lastContent + 1;
};

const renderRequirementBlock = (id: string, title: string, statement: string): string[] => [
  `### ${id} — ${title}`,
  `- Statement: ${statement.trim()}`,
];

export const mergeDeltaIntoBase = (
  delta: DeltaSpec,
  base: string,
  options: DeltaMergeOptions = {},
): DeltaMergeReport => {
  const lines = base.split('\n');
  const blocks = parseBaseRequirementBlocks(lines);
  const section = requirementsSectionRange(lines);
  const assumeMerged = options.assumeMerged === true || delta.status === 'merged';

  const changes: DeltaMergeChange[] = [];
  const pendingInserts: string[][] = [];
  const ops: { start: number; end: number; replacement: string[] }[] = [];

  const unchanged = (entry: DeltaEntry, message: string, baseId?: string): void => {
    changes.push({ id: entry.id, kind: entry.kind, outcome: 'unchanged', ...(baseId ? { baseId } : {}), message });
  };
  const refused = (entry: DeltaEntry, message: string, baseId?: string): void => {
    changes.push({ id: entry.id, kind: entry.kind, outcome: 'refused', ...(baseId ? { baseId } : {}), message });
  };

  for (const entry of delta.entries) {
    const id = entry.id.trim().toUpperCase();
    const statement = entry.statement.trim();
    const alreadyApplied = entry.merged === true || assumeMerged;

    if (entry.kind === 'ADDED') {
      const existing = blocks.find((b) => b.id === id);
      if (existing) {
        const statements = blockStatements(existing, lines);
        if (statements.length > 0 && statements.every((s) => sameText(s, statement))) {
          unchanged(entry, `La base ya contiene ${existing.id} con este enunciado: nada que añadir (una segunda fusión no duplica la sección).`, existing.id);
        } else {
          refused(
            entry,
            `La base ya define ${existing.id} con otro contenido: una entrada ADDED no puede añadir lo que ya existe; el cambio de lo existente es MODIFIED.`,
            existing.id,
          );
        }
        continue;
      }
      pendingInserts.push(renderRequirementBlock(id, entry.title.trim(), statement));
      changes.push({ id: entry.id, kind: entry.kind, outcome: 'added', message: `Se añade ${id} a la sección de requisitos de la base.` });
      continue;
    }

    if (entry.kind === 'MODIFIED') {
      if (!entry.previous?.trim()) {
        refused(entry, 'Una entrada MODIFIED sin `previous` no puede decir qué comportamiento sustituye: no se aplica.');
        continue;
      }
      const target = resolveBaseTarget(blocks, entry);
      if (!target) {
        if (alreadyApplied) unchanged(entry, `El objetivo de ${id} ya no está en la base y la delta consta como fusionada: se interpreta como ya aplicado.`);
        else refused(entry, `La entrada MODIFIED no encuentra en la base ni ${id} ni "${entry.previous}": no hay comportamiento que sustituir.`);
        continue;
      }
      const statements = blockStatements(target, lines);
      if (statements.length > 0 && statements.every((s) => sameText(s, statement))) {
        unchanged(entry, `${target.id} ya contiene el enunciado resultante de la delta: sin cambios.`, target.id);
        continue;
      }
      ops.push({
        start: target.headingIndex,
        end: target.endIndex,
        replacement: renderRequirementBlock(target.id, entry.title.trim() || target.title, statement),
      });
      changes.push({
        id: entry.id,
        kind: entry.kind,
        outcome: 'modified',
        baseId: target.id,
        message: `Se reescribe ${target.id} con el comportamiento resultante de la delta; el identificador del requisito se conserva (renombrarlo sería RENAMED).`,
      });
      continue;
    }

    if (entry.kind === 'REMOVED') {
      const target = resolveBaseTarget(blocks, entry);
      if (!target) {
        if (alreadyApplied) unchanged(entry, `El objetivo de ${id} ya no está en la base y la delta consta como fusionada: la eliminación ya se aplicó.`);
        else refused(entry, `La entrada REMOVED no encuentra en la base ni ${id} ni "${entry.previous ?? ''}": no se puede eliminar lo que no está.`);
        continue;
      }
      ops.push({ start: target.headingIndex, end: target.endIndex, replacement: [] });
      // Blank-line hygiene: the blank BEFORE the block already separates its neighbours, so consume
      // the blank that followed it (never the final newline of the file).
      const leadingBlank = target.headingIndex > 0 && lines[target.headingIndex - 1].trim() === '';
      if (leadingBlank && target.endIndex < lines.length - 1 && lines[target.endIndex].trim() === '') {
        ops[ops.length - 1].end = target.endIndex + 1;
      }
      changes.push({ id: entry.id, kind: entry.kind, outcome: 'removed', baseId: target.id, message: `Se elimina ${target.id} de la base.` });
      continue;
    }

    // RENAMED
    if (!entry.previous?.trim()) {
      refused(entry, 'Una entrada RENAMED sin `previous` no puede decir qué requisito renombra: no se aplica.');
      continue;
    }
    const oldBlock = resolveBaseTarget(blocks, entry);
    const newBlock = blocks.find((b) => b.id === id);
    if (newBlock && !oldBlock) {
      unchanged(entry, `${id} ya existe y el nombre anterior no: el renombrado ya se aplicó.`, newBlock.id);
      continue;
    }
    if (newBlock && oldBlock && newBlock !== oldBlock) {
      refused(
        entry,
        `Ya existen ${oldBlock.id} y ${id}: renombrar colisionaría con un requisito distinto.`,
        oldBlock.id,
      );
      continue;
    }
    if (!oldBlock) {
      if (alreadyApplied) unchanged(entry, `El objetivo de ${id} ya no está en la base y la delta consta como fusionada: el renombrado ya se aplicó.`);
      else refused(entry, `La entrada RENAMED no encuentra "${entry.previous}" en la base: no hay requisito que renombrar.`);
      continue;
    }
    ops.push({
      start: oldBlock.headingIndex,
      end: oldBlock.headingIndex + 1,
      replacement: [`### ${id} — ${entry.title.trim() || oldBlock.title}`],
    });
    changes.push({
      id: entry.id,
      kind: entry.kind,
      outcome: 'renamed',
      baseId: oldBlock.id,
      message: `Se renombra ${oldBlock.id} a ${id}; el cuerpo del requisito se conserva byte a byte (renombrar no cambia el comportamiento).`,
    });
  }

  const refusals = changes.filter((c) => c.outcome === 'refused');
  const unchangedChanges = changes.filter((c) => c.outcome === 'unchanged');

  if (refusals.length > 0) {
    // All-or-nothing: entries that WOULD have been applied are reported as withheld, never as applied,
    // because nothing was written.
    const withheld: DeltaMergeChange[] = changes.map((change) =>
      change.outcome === 'refused' || change.outcome === 'unchanged'
        ? change
        : { ...change, outcome: 'withheld', message: `${change.message} (no aplicada: la fusión es todo o nada y otra entrada fue rechazada).` },
    );
    return {
      feature: delta.feature,
      text: base,
      changed: false,
      changes: withheld,
      applied: [],
      unchanged: unchangedChanges,
      refusals,
      detail: `Fusión rechazada: ${refusals.length} de ${delta.entries.length} entrada(s) no se pueden aplicar, así que la base NO se ha tocado (la fusión es todo o nada). ${refusals
        .map((r) => `${r.id}: ${r.message}`)
        .join(' ')}`,
    };
  }

  // Block operations (replace/delete) target disjoint ranges: apply them first, from the end so the
  // indices stay valid. Insertions (ADDED) come after, with the insertion point recomputed on the
  // transformed document — an earlier splice would otherwise shift it.
  ops.sort((a, b) => b.start - a.start);
  for (const op of ops) lines.splice(op.start, op.end - op.start, ...op.replacement);

  if (pendingInserts.length > 0) {
    const sectionAfter = requirementsSectionRange(lines);
    const insertAt = addedInsertionIndex(lines, parseBaseRequirementBlocks(lines), sectionAfter);
    const inserted: string[] = [];
    pendingInserts.forEach((block, index) => {
      if (index > 0) inserted.push('');
      inserted.push(...block);
    });
    const nextIsBlank = insertAt < lines.length && lines[insertAt].trim() === '';
    const replacement = nextIsBlank ? ['', ...inserted] : ['', ...inserted, ''];
    lines.splice(insertAt, 0, ...replacement);
  }

  const text = lines.join('\n');
  if (text === base) {
    // Nothing moved: report the entries that were staged as unchanged rather than as applied. This is
    // the honest reading of "the merge produced no change", and it is what a second merge must say.
    const normalized: DeltaMergeChange[] = changes.map((change) =>
      change.outcome === 'unchanged' || change.outcome === 'refused'
        ? change
        : { ...change, outcome: 'unchanged', message: `${change.message} (la fusión no cambia el texto: ya estaba aplicado).` },
    );
    return {
      feature: delta.feature,
      text,
      changed: false,
      changes: normalized,
      applied: [],
      unchanged: normalized.filter((change) => change.outcome === 'unchanged'),
      refusals: [],
      detail: `sin cambios: la base ya refleja las ${delta.entries.length} entrada(s) de la delta; no se ha modificado nada.`,
    };
  }

  const applied = changes.filter((c) => c.outcome === 'added' || c.outcome === 'modified' || c.outcome === 'removed' || c.outcome === 'renamed');
  const counts: Record<DeltaKind, number> = { ADDED: 0, MODIFIED: 0, REMOVED: 0, RENAMED: 0 };
  for (const change of applied) counts[change.kind] += 1;
  const breakdown = DELTA_KINDS.filter((kind) => counts[kind] > 0)
    .map((kind) => `${kind} ${counts[kind]}`)
    .join(' · ');

  return {
    feature: delta.feature,
    text,
    changed: true,
    changes,
    applied,
    unchanged: unchangedChanges,
    refusals: [],
    detail: `Fusión aplicada sobre la base de "${delta.feature}": ${breakdown}${unchangedChanges.length > 0 ? ` · ${unchangedChanges.length} ya aplicada(s)` : ''}. La fusión es idempotente: repetirla informará «sin cambios».`,
  };
};
