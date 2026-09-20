/**
 * Absorb the incumbents: import plans for Kiro, spec-kit and cc-sdd.
 *
 * ── The honest contract ─────────────────────────────────────────────────────────────────────────
 * A conversion here is a MAPPING, never a promise of equivalence. Kiro's `requirements.md` is not
 * our EARS-checked requirements document; spec-kit's `spec.md` is not either. So every conversion
 * carries the reason it exists, every artifact we recognize but cannot map becomes an explicit
 * `skip` with its reason, and `applyImport` NEVER overwrites a file that already exists — it
 * reports the path it refused to touch. An importer that claims a perfect migration is lying, so
 * `detail` always states what was NOT converted and why.
 *
 * ── What maps ───────────────────────────────────────────────────────────────────────────────────
 *   Kiro / cc-sdd   `steering/*.md`  → `.sdd/steering/`         (copy: same role)
 *                   `specs/<f>/requirements.md` → `.sdd/specs/<f>/requirements.md`  (copy)
 *                   `specs/<f>/design.md`       → `.sdd/specs/<f>/plan.md`  (convert: rename to the
 *                       canonical name; `design.md` is a declared alias of `plan.md` in triad.ts)
 *                   `specs/<f>/tasks.md`        → `.sdd/specs/<f>/tasks.md`  (copy)
 *                   `settings/*.json`           → `.sdd/settings/*.json`  (convert when the JSON
 *                       parses; `skip` otherwise)
 *   spec-kit        `.specify/memory/constitution.md` → `.sdd/steering/constitution.md` (verbatim,
 *                       with the issues `validateConstitution` finds reported, never fixed)
 *                   `.specify/specs/**` or `specs/**` → `.sdd/specs/**`  (`spec.md` becomes
 *                       `requirements.md` with a provenance banner; `plan.md`/`tasks.md`/aux docs
 *                       copy; unknown documents skip)
 *                   templates/scripts → `skip`: ours are different by design
 *   cc-sdd          the same spec mappings as Kiro, plus its skills directory (reported and skipped:
 *                   its `kiro-*` skills are a different set from our `sdd-*` skills) and its
 *                   `_Boundary:_`/`_Depends:_` task annotations, which open-sdd already reads.
 */

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseConstitution, validateConstitution } from './constitution.js';
import { TRIAD } from './triad.js';

export type ImportSource = 'kiro' | 'spec-kit' | 'cc-sdd';

export interface ImportFound {
  kind: string;
  path: string;
}

export interface ImportConversion {
  from: string;
  to: string;
  action: 'copy' | 'convert' | 'skip';
  reason: string;
}

export interface ImportPlan {
  source: ImportSource;
  found: ImportFound[];
  conversions: ImportConversion[];
  warnings: string[];
  complete: boolean;
  detail: string;
}

export interface ImportOutcome {
  written: string[];
  skipped: string[];
  detail: string;
}

/** Where an import lands. open-sdd also reads `.kiro` in place, but an import is explicit. */
export const IMPORT_TARGET_SDD_DIR = '.sdd';

export const IMPORT_SOURCES: ImportSource[] = ['kiro', 'spec-kit', 'cc-sdd'];

const posix = (p: string): string => p.split(path.sep).join('/');

const exists = async (p: string): Promise<boolean> => (await stat(p).catch(() => null)) !== null;

const readIfExists = async (p: string): Promise<string | null> => readFile(p, 'utf8').catch(() => null);

const listEntries = async (dir: string): Promise<{ name: string; dir: boolean }[]> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => ({ name: entry.name, dir: entry.isDirectory() }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

const copy = (from: string, to: string, reason: string): ImportConversion => ({
  from,
  to,
  action: 'copy',
  reason,
});

const convert = (from: string, to: string, reason: string): ImportConversion => ({
  from,
  to,
  action: 'convert',
  reason,
});

const skip = (from: string, reason: string): ImportConversion => ({
  from,
  to: '',
  action: 'skip',
  reason,
});

/** The triad's declared alias for `plan.md`, read from the single source of truth instead of prose. */
const planAliases = (): string[] => TRIAD.find((file) => file.canonical === 'plan.md')?.aliases ?? [];

const DESIGN_ALIAS_NOTE = (): string => {
  const aliases = planAliases();
  return aliases.length > 0
    ? `\`design.md\` es alias declarado de \`plan.md\` en \`triad.ts\` (${aliases.join(', ')}); se normaliza al nombre canónico y el contenido se copia tal cual.`
    : 'Se normaliza al nombre canónico `plan.md`; el contenido se copia tal cual.';
};

/** The banner a semantically-mapped document carries: a mapping, not a conversion. */
const provenanceBanner = (from: string, extra: string): string =>
  [
    `<!-- Importado por open-sdd desde ${from}.`,
    `     Es un MAPEO de formato, no una conversión semántica: el contenido NO está en EARS ni`,
    `     validado como requisitos. ${extra}`,
    `     Revísalo y ejecútalo por la validación correspondiente antes de aprobarlo. -->`,
    '',
    '',
  ].join('\n');

// ---------------------------------------------------------------------------------------------
// Kiro and cc-sdd (the same `.kiro` layout)
// ---------------------------------------------------------------------------------------------

const KIRO_SPEC_KNOWN: Record<string, { to: string; action: 'copy' | 'convert'; reason: string }> = {
  'requirements.md': {
    to: 'requirements.md',
    action: 'copy',
    reason: 'Mismo rol (requisitos). El contenido se copia tal cual: puede no estar en EARS.',
  },
  'design.md': {
    to: 'plan.md',
    action: 'convert',
    reason: '',
  },
  'tasks.md': {
    to: 'tasks.md',
    action: 'copy',
    reason: 'Mismo rol (tríada de tareas). open-sdd lee además `_Boundary:_`/`_Depends:_`/`_Evidence:`.',
  },
};

const planKiroSpecs = async (
  cwd: string,
  specsRoot: string,
  conversions: ImportConversion[],
  found: ImportFound[],
  warnings: string[],
  options: { reportBoundaries: boolean },
): Promise<void> => {
  const features = (await listEntries(path.join(cwd, specsRoot))).filter((entry) => entry.dir);
  for (const feature of features) {
    const featureRoot = posix(path.join(specsRoot, feature.name));
    found.push({ kind: 'spec', path: featureRoot });
    const files = await listEntries(path.join(cwd, featureRoot));
    const names = new Set(files.filter((entry) => !entry.dir).map((entry) => entry.name));

    for (const [name, mapping] of Object.entries(KIRO_SPEC_KNOWN)) {
      if (!names.has(name)) continue;
      const from = posix(path.join(featureRoot, name));
      const to = posix(path.join(IMPORT_TARGET_SDD_DIR, 'specs', feature.name, mapping.to));
      if (mapping.action === 'convert') {
        conversions.push(convert(from, to, DESIGN_ALIAS_NOTE()));
      } else {
        conversions.push(copy(from, to, mapping.reason));
      }
    }

    if (!names.has('requirements.md')) {
      warnings.push(
        `La spec "${feature.name}" no trae requirements.md: se importará sin requisitos y el gate C1 la verá incompleta.`,
      );
    }
    if (names.has('spec.json')) {
      conversions.push(
        skip(
          posix(path.join(featureRoot, 'spec.json')),
          'El spec.json de Kiro/cc-sdd declara metadatos con otra forma que el spec.json de open-sdd (fase, estado, idioma): copiarlo haría que el motor leyera un metadato ajeno como propio. Recrea la spec con `open-sdd init <feature>`.',
        ),
      );
    }

    if (options.reportBoundaries && names.has('tasks.md')) {
      const content = (await readIfExists(path.join(cwd, featureRoot, 'tasks.md'))) ?? '';
      const boundaries = [...content.matchAll(/_Boundary:/g)].length;
      const depends = [...content.matchAll(/_Depends:/g)].length;
      if (boundaries + depends > 0) {
        warnings.push(
          `tasks.md de "${feature.name}" declara ${boundaries} \`_Boundary:_\` y ${depends} \`_Depends:_\`: open-sdd ya lee esas anotaciones (frontera de tarea y dependencia), pero conviene revisar que el vocabulario de rutas coincida con el repositorio.`,
        );
      }
    }
  }
};

const planKiroLike = async (
  cwd: string,
  source: 'kiro' | 'cc-sdd',
  options: { reportBoundaries: boolean },
): Promise<ImportPlan> => {
  const found: ImportFound[] = [];
  const conversions: ImportConversion[] = [];
  const warnings: string[] = [];

  // Steering: project memory, same role, same file names.
  const steeringRoot = '.kiro/steering';
  if (await exists(path.join(cwd, steeringRoot))) {
    found.push({ kind: 'steering', path: steeringRoot });
    for (const entry of await listEntries(path.join(cwd, steeringRoot))) {
      const from = posix(path.join(steeringRoot, entry.name));
      if (entry.dir || !entry.name.endsWith('.md')) {
        conversions.push(skip(from, 'Solo se importan documentos Markdown de steering; el resto se omite.'));
        continue;
      }
      conversions.push(
        copy(from, posix(path.join(IMPORT_TARGET_SDD_DIR, 'steering', entry.name)), 'Misma memoria de proyecto (steering), mismo rol y mismo nombre.'),
      );
    }
  }

  // Specs: the triad, with `design.md` normalized to `plan.md`.
  const specsRoot = '.kiro/specs';
  if (await exists(path.join(cwd, specsRoot))) {
    await planKiroSpecs(cwd, specsRoot, conversions, found, warnings, options);
  }

  // Settings: only JSON that parses maps; everything else is named and skipped.
  const settingsRoot = '.kiro/settings';
  if (await exists(path.join(cwd, settingsRoot))) {
    found.push({ kind: 'settings', path: settingsRoot });
    for (const entry of await listEntries(path.join(cwd, settingsRoot))) {
      const from = posix(path.join(settingsRoot, entry.name));
      if (entry.dir) {
        conversions.push(
          skip(from, 'Subdirectorio de settings: la forma de open-sdd no está confirmada para su contenido; revísalo a mano.'),
        );
        continue;
      }
      if (!entry.name.endsWith('.json')) {
        conversions.push(skip(from, 'Solo se importan settings JSON; el resto de formatos no tiene una forma equivalente.'));
        continue;
      }
      const content = await readIfExists(path.join(cwd, from));
      try {
        JSON.parse(content ?? '');
      } catch {
        conversions.push(
          skip(from, 'El JSON no parsea: NO se copia a ciegas, porque open-sdd lo leería como su propio settings y fallaría en silencio.'),
        );
        continue;
      }
      conversions.push(
        convert(from, posix(path.join(IMPORT_TARGET_SDD_DIR, 'settings', entry.name)), 'El JSON parsea y la forma es compatible; se importa como settings.'),
      );
    }
  }

  // cc-sdd only: its skills directory is a different skill set, not a rename of ours.
  if (source === 'cc-sdd') {
    for (const skillsRoot of ['.kiro/skills', '.claude/skills', '.agents/skills']) {
      if (!(await exists(path.join(cwd, skillsRoot)))) continue;
      const entries = await listEntries(path.join(cwd, skillsRoot));
      const foreign = entries.filter((entry) => entry.dir && !entry.name.startsWith('sdd-'));
      if (foreign.length === 0) continue;
      found.push({ kind: 'skills', path: skillsRoot });
      for (const entry of foreign) {
        conversions.push(
          skip(
            posix(path.join(skillsRoot, entry.name)),
            'Las skills de cc-sdd son otro conjunto (no un renombrado de las `sdd-*`): copiarlas al layout de open-sdd declararía capacidades que no son las nuestras. Elígela o adáptala a mano.',
          ),
        );
      }
      warnings.push(
        `Se encontraron ${foreign.length} skill(s) de cc-sdd en ${skillsRoot}: NO se importan. Las skills de open-sdd son ${'`sdd-*`'} y se instalan con el instalador del CLI.`,
      );
    }
  }

  // Two SDD roots is a real hazard: `.kiro` is read in place, so an import that also creates
  // `.sdd` leaves two layouts the user must reconcile.
  if (!(await exists(path.join(cwd, IMPORT_TARGET_SDD_DIR))) && (await exists(path.join(cwd, '.kiro')))) {
    warnings.push(
      'El proyecto no tiene `.sdd`: open-sdd ya lee `.kiro` en su sitio (resolveSddDir). Esta importación crea además `.sdd/`; elige una raíz y elimina la otra para que no haya dos fuentes de verdad.',
    );
  }

  const skipped = conversions.filter((item) => item.action === 'skip');
  const complete = found.length > 0 && skipped.length === 0 && warnings.length === 0;
  const detail =
    found.length === 0
      ? `No se observó ningún artefacto de ${source} (ni .kiro/steering, ni .kiro/specs, ni .kiro/settings).`
      : [
          `${found.length} artefacto(s) de ${source} reconocidos, ${conversions.length - skipped.length} conversión(es) y ${skipped.length} omisión(es).`,
          skipped.length > 0
            ? `NO se convierte: ${skipped.map((item) => item.from).join(', ')}. Cada omisión lleva su motivo y ninguna se escribe.`
            : 'Todo lo reconocido tiene una conversión; sigue siendo un MAPEO, no una promesa de equivalencia.',
          warnings.length > 0 ? `${warnings.length} advertencia(s) para revisar a mano.` : '',
        ]
          .filter((part) => part.length > 0)
          .join(' ');

  return { source, found, conversions, warnings, complete, detail };
};

// ---------------------------------------------------------------------------------------------
// spec-kit
// ---------------------------------------------------------------------------------------------

const SPECKIT_AUX = ['plan.md', 'tasks.md', 'research.md', 'data-model.md', 'quickstart.md'];

const planSpecKitSpec = async (
  cwd: string,
  specsRoot: string,
  feature: string,
  conversions: ImportConversion[],
): Promise<void> => {
  const featureRoot = posix(path.join(specsRoot, feature));
  const files = await listEntries(path.join(cwd, featureRoot));
  const names = new Set(files.filter((entry) => !entry.dir).map((entry) => entry.name));

  if (names.has('spec.md')) {
    conversions.push(
      convert(
        posix(path.join(featureRoot, 'spec.md')),
        posix(path.join(IMPORT_TARGET_SDD_DIR, 'specs', feature, 'requirements.md')),
        '`spec.md` de spec-kit ocupa el rol de requisitos; se importa como `requirements.md` con una banda de procedencia porque NO es EARS y nadie lo ha validado como tal.',
      ),
    );
  }
  for (const name of SPECKIT_AUX) {
    if (!names.has(name)) continue;
    conversions.push(
      copy(
        posix(path.join(featureRoot, name)),
        posix(path.join(IMPORT_TARGET_SDD_DIR, 'specs', feature, name)),
        'Documento auxiliar del mismo rol; se copia tal cual.',
      ),
    );
  }
  if (files.some((entry) => entry.dir && entry.name === 'contracts')) {
    const contractsRoot = posix(path.join(featureRoot, 'contracts'));
    for (const entry of await listEntries(path.join(cwd, contractsRoot))) {
      conversions.push(
        copy(
          posix(path.join(contractsRoot, entry.name)),
          posix(path.join(IMPORT_TARGET_SDD_DIR, 'specs', feature, 'contracts', entry.name)),
          'Contrato de spec-kit: mismo rol (interfaz ejecutable de la spec).',
        ),
      );
    }
  }
  for (const entry of files) {
    if (entry.dir) {
      if (entry.name !== 'contracts') {
        conversions.push(
          skip(posix(path.join(featureRoot, entry.name)), 'Directorio no reconocido por open-sdd: no se importa a ciegas.'),
        );
      }
      continue;
    }
    if (entry.name === 'spec.md' || SPECKIT_AUX.includes(entry.name)) continue;
    conversions.push(
      skip(posix(path.join(featureRoot, entry.name)), 'Documento de spec-kit sin equivalente declarado en la tríada ni en los auxiliares conocidos.'),
    );
  }
};

const planSpecKit = async (cwd: string): Promise<ImportPlan> => {
  const found: ImportFound[] = [];
  const conversions: ImportConversion[] = [];
  const warnings: string[] = [];

  // Constitution: imported verbatim, with the validator's findings reported and never "fixed".
  const constitutionFrom = '.specify/memory/constitution.md';
  if (await exists(path.join(cwd, constitutionFrom))) {
    found.push({ kind: 'constitution', path: constitutionFrom });
    const content = (await readIfExists(path.join(cwd, constitutionFrom))) ?? '';
    const parsed = parseConstitution(content);
    const issues = validateConstitution(parsed);
    conversions.push(
      convert(
        constitutionFrom,
        posix(path.join(IMPORT_TARGET_SDD_DIR, 'steering', 'constitution.md')),
        'Misma autoridad (constitución del proyecto). Se copia VERBATIM: open-sdd no «arregla» una constitución ajena, solo reporta lo que su validador encuentra.',
      ),
    );
    if (parsed.principles.length === 0) {
      warnings.push(
        'La constitución de spec-kit no expone ningún principio con la anatomía de open-sdd (id citable, nivel, restricción, patrón, justificación): se importa verbatim y debe reescribirse a mano antes de que un veredicto bloqueante pueda citarla.',
      );
    }
    for (const issue of issues) {
      warnings.push(
        `validateConstitution [${issue.severity}${issue.code ? ` ${issue.code}` : ''}] ${issue.id}: ${issue.message}`,
      );
    }
    if (issues.length === 0 && parsed.principles.length > 0) {
      warnings.push(
        `validateConstitution no encontró problemas en ${parsed.principles.length} principio(s), pero la importación sigue siendo un MAPEO: el contenido no se ha revisado por una persona.`,
      );
    }
  }

  // Specs: `.specify/specs/**` and, when present, a root `specs/**`.
  const specsRoots = ['.specify/specs', 'specs'];
  const seenFeatures = new Set<string>();
  for (const specsRoot of specsRoots) {
    if (!(await exists(path.join(cwd, specsRoot)))) continue;
    found.push({ kind: 'specs', path: specsRoot });
    const features = (await listEntries(path.join(cwd, specsRoot))).filter((entry) => entry.dir);
    for (const feature of features) {
      if (seenFeatures.has(feature.name)) {
        warnings.push(
          `La feature "${feature.name}" aparece en más de una raíz de specs: solo se planifica una vez; revisa cuál es la vigente.`,
        );
        continue;
      }
      seenFeatures.add(feature.name);
      found.push({ kind: 'spec', path: posix(path.join(specsRoot, feature.name)) });
      await planSpecKitSpec(cwd, specsRoot, feature.name, conversions);
    }
  }
  if (specsRoots.every((root) => !found.some((item) => item.path === root))) {
    warnings.push('No se observó ningún directorio de specs de spec-kit (`.specify/specs/` ni `specs/`).');
  }

  // Templates and scripts: ours are different by design.
  for (const dir of ['.specify/templates', '.specify/scripts']) {
    if (!(await exists(path.join(cwd, dir)))) continue;
    found.push({ kind: dir.includes('templates') ? 'templates' : 'scripts', path: dir });
    conversions.push(
      skip(
        dir,
        dir.includes('templates')
          ? 'Las plantillas de open-sdd son distintas por diseño (tríada, delta, constitución): importar las de spec-kit produciría documentos que nuestros gates no reconocen.'
          : 'Los scripts de spec-kit ejecutan su flujo, no el nuestro; no hay equivalencia.',
      ),
    );
  }

  // Other memory documents have no declared role in our steering set.
  if (await exists(path.join(cwd, '.specify/memory'))) {
    for (const entry of await listEntries(path.join(cwd, '.specify/memory'))) {
      if (entry.name === 'constitution.md' || entry.dir) continue;
      conversions.push(
        skip(
          posix(path.join('.specify/memory', entry.name)),
          'Documento de memoria de spec-kit sin rol declarado en el steering de open-sdd.',
        ),
      );
    }
  }

  const skipped = conversions.filter((item) => item.action === 'skip');
  const complete = found.length > 0 && skipped.length === 0 && warnings.length === 0;
  const detail =
    found.length === 0
      ? 'No se observó ningún artefacto de spec-kit (ni `.specify/`, ni `specs/`).'
      : [
          `${found.length} artefacto(s) de spec-kit reconocidos, ${conversions.length - skipped.length} conversión(es) y ${skipped.length} omisión(es).`,
          'La conversión de `spec.md` a `requirements.md` es un MAPEO de formato: el contenido no está en EARS ni validado.',
          skipped.length > 0
            ? `NO se convierte: ${skipped.map((item) => item.from).join(', ')}. Plantillas y scripts se omiten a propósito.`
            : 'Todo lo reconocido tiene una conversión.',
          warnings.length > 0 ? `${warnings.length} advertencia(s), incluida la validación de la constitución.` : '',
        ]
          .filter((part) => part.length > 0)
          .join(' ');

  return { source: 'spec-kit', found, conversions, warnings, complete, detail };
};

// ---------------------------------------------------------------------------------------------
// Detection and planning entry points
// ---------------------------------------------------------------------------------------------

const hasKiroEvidence = async (cwd: string): Promise<boolean> =>
  (await exists(path.join(cwd, '.kiro/steering'))) || (await exists(path.join(cwd, '.kiro/specs')));

const hasSpecKitEvidence = async (cwd: string): Promise<boolean> => {
  if (await exists(path.join(cwd, '.specify'))) return true;
  const rootSpecs = path.join(cwd, 'specs');
  if (!(await exists(rootSpecs))) return false;
  const features = (await listEntries(rootSpecs)).filter((entry) => entry.dir);
  for (const feature of features) {
    if (await exists(path.join(rootSpecs, feature.name, 'spec.md'))) return true;
  }
  return false;
};

/** cc-sdd is a `.kiro`-compatible generator: the specs are Kiro's, the marker is its own. */
const hasCcSddEvidence = async (cwd: string): Promise<boolean> => {
  const pkg = await readIfExists(path.join(cwd, 'package.json'));
  if (pkg !== null) {
    try {
      const parsed = JSON.parse(pkg) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const declared = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
      if (Object.keys(declared).some((name) => name === 'cc-sdd' || name.startsWith('cc-sdd'))) return true;
    } catch {
      // A package.json that does not parse is not evidence either way.
    }
  }
  if (await exists(path.join(cwd, '.kiro/skills'))) return true;
  for (const skillsRoot of ['.claude/skills', '.agents/skills']) {
    const entries = await listEntries(path.join(cwd, skillsRoot));
    if (entries.some((entry) => entry.dir && entry.name.startsWith('kiro-'))) return true;
  }
  return false;
};

const buildPlan = async (cwd: string, source: ImportSource): Promise<ImportPlan> => {
  if (source === 'spec-kit') return planSpecKit(cwd);
  return planKiroLike(cwd, source, { reportBoundaries: source === 'cc-sdd' });
};

/**
 * Build the import plan(s). With an explicit `source`, exactly one plan comes back even when
 * nothing was found — the CLI has to be able to say "nothing to import". Without it, only sources
 * with evidence produce a plan; an empty array means no incumbent was observed.
 */
export const planImport = async (cwd: string, source?: ImportSource): Promise<ImportPlan[]> => {
  if (source !== undefined) return [await buildPlan(cwd, source)];

  const plans: ImportPlan[] = [];
  if (await hasKiroEvidence(cwd)) plans.push(await buildPlan(cwd, 'kiro'));
  if (await hasSpecKitEvidence(cwd)) plans.push(await buildPlan(cwd, 'spec-kit'));
  if (await hasCcSddEvidence(cwd)) plans.push(await buildPlan(cwd, 'cc-sdd'));
  return plans;
};

/**
 * Apply a plan. Without `write` nothing happens at all; with it, every existing target is refused
 * and reported, so a second run is a no-op instead of a destructive one.
 */
export const applyImport = async (
  cwd: string,
  plan: ImportPlan,
  opts: { write?: boolean },
): Promise<ImportOutcome> => {
  if (opts.write !== true) {
    return {
      written: [],
      skipped: [],
      detail: 'Sin --write no se escribió nada: el plan enumera las conversiones y sus motivos.',
    };
  }

  const written: string[] = [];
  const skipped: string[] = [];

  for (const conversion of plan.conversions) {
    if (conversion.action === 'skip') {
      skipped.push(`${conversion.from} — ${conversion.reason}`);
      continue;
    }

    const source = path.join(cwd, conversion.from);
    const target = path.join(cwd, conversion.to);

    if (await exists(target)) {
      skipped.push(`${conversion.to} — ya existe: open-sdd NUNCA sobrescribe en una importación.`);
      continue;
    }

    const content = await readIfExists(source);
    if (content === null) {
      skipped.push(`${conversion.from} — no se pudo leer el origen; no se escribe nada.`);
      continue;
    }

    const payload =
      conversion.from.endsWith('spec.md') && conversion.to.endsWith('requirements.md')
        ? provenanceBanner(
            conversion.from,
            'spec-kit escribe escenarios de usuario y requisitos funcionales, no la sintaxis EARS.',
          ) + content
        : content;

    try {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, payload, 'utf8');
      written.push(conversion.to);
    } catch (error) {
      skipped.push(`${conversion.to} — no se pudo escribir (${(error as Error).message}).`);
    }
  }

  const notConverted = plan.conversions.filter((conversion) => conversion.action === 'skip');
  const detail = [
    `${written.length} fichero(s) escrito(s), ${skipped.length} omitido(s) de ${plan.conversions.length} conversión(es) planificada(s).`,
    'Ningún fichero existente se ha sobrescrito.',
    notConverted.length > 0
      ? `NO convertido: ${notConverted.map((conversion) => conversion.from).join(', ')}.`
      : 'Todo lo planificado se escribió; el mapeo no garantiza equivalencia semántica.',
    plan.warnings.length > 0 ? `${plan.warnings.length} advertencia(s) siguen pendientes de revisión humana.` : '',
  ]
    .filter((part) => part.length > 0)
    .join(' ');

  return { written, skipped, detail };
};
