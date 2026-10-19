/**
 * Deterministic gate over the discovery `brief.md` that `/sdd-discovery` writes, plus the append-only
 * `discovery.log.md` and a secret scan for both.
 *
 * ── Why it is included (ported from SteelForge, research/SDD-PARA-OPENSDD.md §5; idea from BMAD) ──────
 * open-sdd's discovery skill writes `brief.md` but nothing checks it before `/sdd-spec-requirements` consumes
 * it, so an empty Out-of-scope, an unmeasurable outcome or an unconfirmed assumption flowed straight into the
 * requirements. The rules here are the ones that stop that, in open-sdd's own brief format:
 *   - every section the skill template defines is present and filled (template brackets do not count);
 *   - non-goals are mandatory (`Scope › Out` or `Out of Boundary`): a brief that excludes nothing has no scope;
 *   - the Desired Outcome names something observable (a number, a deadline, a count);
 *   - an assumption written as `[ASSUMPTION A1]` must be indexed in `## Assumptions` and, while any is not
 *     confirmed or discarded, the brief cannot be promoted to requirements (it blocks, it does not warn);
 *   - nothing that looks like a secret is written to discovery artifacts.
 * The decision log is append-only with typed lines, so the reasons behind a kill or a lock survive.
 */
import { appendFile, readFile } from 'node:fs/promises';

/** Sections of open-sdd's brief template (sdd-discovery SKILL.md, Path B/C). */
export const BRIEF_SECTIONS = ['Problem', 'Current State', 'Desired Outcome', 'Approach', 'Scope'] as const;

/** Typed entries of `discovery.log.md`. */
export const LOG_TYPES = ['decision', 'assumption', 'crack', 'kill', 'lock', 'source'] as const;
export type LogType = (typeof LOG_TYPES)[number];

const SECRETS = [
  /\b(?:sk|pk|ghp|gho|ghs|xox[abp])[-_][A-Za-z0-9_-]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['"]?[^\s'"]{8,}/i,
];

/**
 * Whether the text contains something shaped like a credential.
 * @param text - any artifact text.
 */
export const hasSecret = (text: string): boolean => SECRETS.some((re) => re.test(String(text)));

/** Result of the brief gate. */
export interface BriefLint {
  /** True only when the brief can be promoted to requirements. */
  ok: boolean;
  problems: string[];
  /** Assumption ids that are neither confirmed nor discarded. */
  pendingAssumptions: string[];
}

const section = (text: string, name: string): string =>
  new RegExp(`^##\\s+${name.replace(/ /g, '\\s+')}\\b[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'im').exec(text)?.[1] ?? '';

/** Lines with real content: template brackets `[...]`, comments and `...` do not count. */
const filled = (block: string): string[] =>
  block
    .split('\n')
    .map((l) => l.replace(/^[-*]\s*(?:\*\*[^*]+\*\*:?\s*)?/, '').trim())
    .filter((l) => l && !/^\[.*\]$/.test(l) && l !== '...' && !l.startsWith('<!--') && !l.startsWith('|--'));

/**
 * Checks a `brief.md` written by `/sdd-discovery`.
 * @param markdown - brief content.
 */
export const lintBrief = (markdown: string): BriefLint => {
  const text = String(markdown);
  const problems: string[] = [];
  for (const name of BRIEF_SECTIONS) if (filled(section(text, name)).length === 0) problems.push(`${name}: vacío o solo con la plantilla`);

  const scope = section(text, 'Scope');
  const out = /\*\*Out\*\*:?\s*(.*)/i.exec(scope)?.[1]?.trim() ?? '';
  const outOfBoundary = filled(section(text, 'Out of Boundary'));
  if ((!out || /^\[.*\]$/.test(out)) && outOfBoundary.length === 0) problems.push('Non-goals: ni «Scope › Out» ni «Out of Boundary» excluyen nada; un brief sin exclusiones no tiene alcance');

  const outcome = filled(section(text, 'Desired Outcome')).join(' ');
  if (outcome && !/\d|%|\b(?:all|none|zero|every|todos|ninguno|cero|cada|segundos?|minutos?|horas?|días?|seconds?|minutes?|hours?|days?|users?|usuarios?)\b/i.test(outcome)) {
    problems.push('Desired Outcome: no nombra nada observable (cifra, plazo o recuento): no se podrá saber si se cumplió');
  }

  const inline = [...text.matchAll(/\[ASSUMPTION\s+(A\d+)\]/gi)].map((m) => m[1].toUpperCase());
  const rows = [...section(text, 'Assumptions').matchAll(/^\|\s*(A\d+)\s*\|[^|]*\|\s*([^|]*?)\s*\|/gim)].map((m) => ({ id: m[1].toUpperCase(), state: m[2].toLowerCase() }));
  for (const id of new Set(inline)) if (!rows.some((r) => r.id === id)) problems.push(`[ASSUMPTION ${id}] no está en la tabla ## Assumptions`);
  // Only a finished state settles an assumption: «to confirm» / «por confirmar» contain the word and are still open.
  const settled = /^(?:confirmed|confirmad[oa]|discarded|descartad[oa]|validated|validad[oa])\b/;
  const pendingAssumptions = rows.filter((r) => !settled.test(r.state)).map((r) => r.id);
  if (pendingAssumptions.length) problems.push(`Supuestos sin confirmar: ${pendingAssumptions.join(', ')} (confírmalos o descártalos antes de escribir requisitos)`);

  if (hasSecret(text)) problems.push('El brief contiene algo con aspecto de secreto: quítalo (los artefactos de discovery se versionan)');
  return { ok: problems.length === 0, problems, pendingAssumptions };
};

/**
 * One line of the append-only decision log.
 * @param type - one of `LOG_TYPES`.
 * @param text - entry (whitespace is compacted).
 * @param at - date `YYYY-MM-DD` (today by default).
 */
export const logLine = (type: string, text: string, at: string = new Date().toISOString().slice(0, 10)): string => {
  if (!(LOG_TYPES as readonly string[]).includes(type)) throw new Error(`tipo de registro «${type}» no válido (${LOG_TYPES.join(' · ')})`);
  const body = String(text).replace(/\s+/g, ' ').trim();
  if (!body) throw new Error('la entrada del registro está vacía');
  if (hasSecret(body)) throw new Error('la entrada parece contener un secreto: no se escribe');
  return `- ${at} · ${type} · ${body}`;
};

/**
 * Appends one entry to `discovery.log.md` (created with its header when absent). Never rewrites earlier lines.
 * @param file - absolute path of the log.
 * @param type - one of `LOG_TYPES`.
 * @param text - entry text.
 * @returns the line written.
 */
export const appendDiscoveryLog = async (file: string, type: string, text: string): Promise<string> => {
  const line = logLine(type, text);
  const previous = await readFile(file, 'utf8').catch(() => null);
  await appendFile(file, `${previous === null ? '# Discovery log (append-only)\n\n' : ''}${line}\n`, 'utf8');
  return line;
};
