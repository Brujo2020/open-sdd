/**
 * GitFlow nativo: el ROL de la rama decide qué gobernanza se exige.
 *
 * El resto del motor ya tenía las piezas — helpers de git, oleadas transaccionales, merge-back de
 * la delta, el suelo de commit y la matriz de PR — pero no sabía en qué rama estaba. Este módulo
 * responde una sola pregunta antes de que nadie la haga: *¿qué rol juega esta rama y qué exige ese
 * rol?* La respuesta se DERIVA de lo que existe en el repositorio (las ramas que git reporta), no de
 * un archivo de configuración: un modelo de ramificación declarado pero no observado sería una
 * afirmación sin evidencia, justo lo que el resto de la consola se niega a hacer.
 *
 * ── Qué se observa y qué no se afirma ────────────────────────────────────────────────────────
 *  · `gitflow` solo se declara cuando `develop` y `main`/`master` existen A LA VEZ. El nombre de la
 *    rama actual no basta: el modelo es del repositorio, no de la rama.
 *  · `trunk` solo se declara con UNA sola rama que no sea de rol (main/master o el único pivote).
 *    `main` + ramas de feature SIN `develop` no es ni gitflow ni un trunk de una rama: se declara
 *    `none` y se dice por qué, en vez de adivinar una estrategia que no se vio.
 *  · El rol se lee del nombre con los prefijos reales; un nombre que no corresponde a ninguno es
 *    `other` y su política lo dice en lugar de suponer. `bugfix/<x>` es un alias de rama de cambio
 *    (rol `feature`): el juego de roles no tiene `bugfix`, y NO se confunde con `hotfix`, que es la
 *    reparación de una línea de release.
 *  · `blocking` separa lo que HOY puede bloquear de verdad (el suelo: hook de pre-commit nivel B y
 *    workflow de gates en pull_request nivel C) de lo que es consejo. Esta capa es pura y no lee el
 *    disco: nombra el mecanismo y el comando que verifica si está instalado (`open-sdd floor status`)
 *    en vez de declarar una branch protection que no ha visto.
 *
 * User-visible strings are Spanish, matching the rest of the CLI (see `src/cli/i18n.ts`).
 */

import { execFileSync } from 'node:child_process';
import { getCurrentBranch, isGitRepo } from './git.js';
import { EXECUTABLE_CHAIN } from './gateCatalog.js';
import { DEFAULT_RIGOR_LEVEL, effectiveGates, isRigorLevel, type SddRigorLevel } from './rigor.js';

export type GitFlowRole = 'main' | 'develop' | 'feature' | 'release' | 'hotfix' | 'other';
export type GitFlowModel = 'gitflow' | 'trunk' | 'none';

export interface GitFlowState {
  model: GitFlowModel;
  branch: string | null;
  role: GitFlowRole;
  /** The branch this one should be compared against (develop for feature, main for release…). */
  base: string | null;
  /** The feature whose spec governs this branch, when the name carries it (feat/<x>, feature/<x>, <x>-<delta>). */
  feature: string | null;
  /** A version when the branch is release/* or hotfix/*. */
  version: string | null;
  evidence: string[];
  detail: string;
}

export interface BranchPolicy {
  role: GitFlowRole;
  required: string[];
  gates: string[];
  blocking: string[];
  nextStep: string;
  detail: string;
}

/** Pivotes reconocidos. `main` gana a `master` cuando ambos existen: se dice cuál se usó. */
const DEFAULT_BRANCHES = ['main', 'master'] as const;

/** `develop` es el nombre canónico de gitflow; `development` es el alias que se observa a menudo. */
const DEVELOP_NAMES = ['develop', 'development'] as const;

/**
 * Prefijos reales. `bugfix/` se mapea a `feature` a propósito y está documentado arriba: es una rama
 * de cambio cuyo contrato es su delta, no una reparación de la línea de release (eso es `hotfix/`).
 */
const ROLE_PREFIXES: ReadonlyArray<{ prefix: string; role: Extract<GitFlowRole, 'feature' | 'release' | 'hotfix'> }> = [
  { prefix: 'feature/', role: 'feature' },
  { prefix: 'feat/', role: 'feature' },
  { prefix: 'bugfix/', role: 'feature' },
  { prefix: 'release/', role: 'release' },
  { prefix: 'hotfix/', role: 'hotfix' },
];

/** Convención `<x>-<delta>`: el nombre de la rama declara la feature aunque no declare rol. */
const DELTA_SUFFIX = /^(.+)-delta$/;

/** La cadena núcleo (C1–C7), tal como la declara el catálogo: posturas no opt-in. */
export const CORE_CHAIN_IDS: string[] = EXECUTABLE_CHAIN.filter((g) => g.posture !== 'opt-in').map((g) => g.id);

const gitOutput = (cwd: string, args: string[]): string | null => {
  try {
    const out = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.replace(/\r/g, '');
  } catch {
    return null;
  }
};

/**
 * Lista de ramas locales. `for-each-ref` en vez de `branch` para no depender del color, del pager ni
 * del formato del terminal: aquí se lee para decidir, no para mostrar.
 */
const listLocalBranches = (cwd: string): string[] => {
  const out = gitOutput(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  if (out === null) return [];
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
};

const stripDeltaSuffix = (name: string): string => {
  const match = DELTA_SUFFIX.exec(name);
  return match ? match[1] : name;
};

interface RoleReading {
  role: GitFlowRole;
  feature: string | null;
  version: string | null;
  reason: string;
}

/** Lee el rol del nombre. No completa con suposiciones: lo que no reconoce es `other` y lo dice. */
const readRole = (branch: string | null): RoleReading => {
  if (branch === null) {
    return {
      role: 'other',
      feature: null,
      version: null,
      reason: 'sin rama (HEAD desprendido o repositorio sin commits): el rol no se puede leer del nombre.',
    };
  }

  if (branch === 'main' || branch === 'master') {
    return { role: 'main', feature: null, version: null, reason: `"${branch}" es la rama pivote.` };
  }

  if ((DEVELOP_NAMES as readonly string[]).includes(branch)) {
    return {
      role: 'develop',
      feature: null,
      version: null,
      reason: `"${branch}" es la rama de integración de gitflow.`,
    };
  }

  for (const { prefix, role } of ROLE_PREFIXES) {
    if (!branch.startsWith(prefix)) continue;
    const rest = branch.slice(prefix.length);
    const feature = role === 'feature' ? stripDeltaSuffix(rest) : null;
    const version = role === 'release' || role === 'hotfix' ? rest : null;
    return {
      role,
      feature,
      version,
      reason: `el prefijo "${prefix}" nombra el rol ${role}${feature ? ` y la feature "${feature}"` : ''}${
        version ? ` y la versión "${version}"` : ''
      }.`,
    };
  }

  const deltaMatch = DELTA_SUFFIX.exec(branch);
  if (deltaMatch) {
    return {
      role: 'other',
      feature: deltaMatch[1],
      version: null,
      reason: `sin prefijo de rol, pero el sufijo "-delta" nombra la feature "${deltaMatch[1]}".`,
    };
  }

  return {
    role: 'other',
    feature: null,
    version: null,
    reason: `ni el nombre "${branch}" ni sus prefijos corresponden a la convención (feature/, feat/, release/, hotfix/, bugfix/, develop, main, master): rol no reconocido.`,
  };
};

/** ¿La rama juega algún rol distinto del pivote? Se usa para no llamar «trunk» a lo que no lo es. */
const isRoleLikeBranch = (branch: string): boolean => {
  if (branch === 'main' || branch === 'master') return false;
  if ((DEVELOP_NAMES as readonly string[]).includes(branch)) return true;
  return ROLE_PREFIXES.some((p) => branch.startsWith(p.prefix)) || DELTA_SUFFIX.test(branch);
};

const resolveBase = (input: {
  role: GitFlowRole;
  branch: string | null;
  defaultBranch: string | null;
  developBranch: string | null;
}): string | null => {
  const { role, branch, defaultBranch, developBranch } = input;
  switch (role) {
    case 'main':
      return null;
    case 'develop':
      return defaultBranch;
    case 'release':
    case 'hotfix':
      return defaultBranch;
    case 'feature':
      return developBranch ?? defaultBranch;
    case 'other': {
      if (defaultBranch !== null && defaultBranch !== branch) return defaultBranch;
      if (developBranch !== null && developBranch !== branch) return developBranch;
      return null;
    }
  }
};

/**
 * Detectar el modelo y el rol desde lo que existe. Nunca lanza: fuera de un repositorio, en un
 * repositorio sin commits o en HEAD desprendido devuelve un estado honesto con `none`/`other`.
 */
export const detectGitFlow = async (cwd: string): Promise<GitFlowState> => {
  if (!isGitRepo(cwd)) {
    return {
      model: 'none',
      branch: null,
      role: 'other',
      base: null,
      feature: null,
      version: null,
      evidence: [`"${cwd}" no es un árbol de trabajo git: no hay ramas que observar.`],
      detail: 'Sin repositorio git no se observa ningún modelo de ramificación; no se afirma ninguno.',
    };
  }

  const branches = listLocalBranches(cwd);
  const rawBranch = getCurrentBranch(cwd);
  const branch = !rawBranch || rawBranch === 'HEAD' ? null : rawBranch.replace(/^refs\/heads\//, '');

  const defaultBranch = DEFAULT_BRANCHES.find((b) => branches.includes(b)) ?? null;
  const developBranch = DEVELOP_NAMES.find((d) => branches.includes(d)) ?? null;
  const roleBranches = branches.filter((b) => ROLE_PREFIXES.some((p) => b.startsWith(p.prefix)));

  const evidence: string[] = [
    `ramas locales observadas (${branches.length}): ${branches.length > 0 ? branches.join(', ') : 'ninguna'}`,
    `rama actual: ${
      branch ?? (rawBranch === 'HEAD' ? 'HEAD desprendido' : 'sin rama (repositorio sin commits)')
    }`,
  ];

  let model: GitFlowModel;
  let modelReason: string;
  if (branches.length === 0) {
    model = 'none';
    modelReason = 'sin ramas: no hay nada que observar, así que no se afirma ningún modelo.';
  } else if (defaultBranch !== null && developBranch !== null) {
    model = 'gitflow';
    modelReason = `gitflow: "${defaultBranch}" y "${developBranch}" existen a la vez${
      roleBranches.length > 0
        ? `, y ${roleBranches.length} rama(s) siguen la convención de rol (${roleBranches.join(', ')})`
        : ' (todavía no hay ramas de rol que lo corroboren)'
    }.`;
  } else if (branches.length === 1 && !isRoleLikeBranch(branches[0])) {
    model = 'trunk';
    modelReason = `trunk: solo existe una rama, "${branches[0]}", y ninguna rama de rol ni develop.`;
  } else if (defaultBranch !== null && developBranch === null) {
    model = 'none';
    modelReason = `existe "${defaultBranch}" pero no develop, y hay más de una rama (${branches.join(
      ', ',
    )}): no es gitflow ni un trunk de una sola rama, así que no se afirma ningún modelo.`;
  } else {
    model = 'none';
    modelReason = `las ramas observadas (${branches.join(
      ', ',
    )}) no corresponden ni a gitflow (develop + main) ni a un trunk de una sola rama, así que no se afirma ningún modelo.`;
  }
  evidence.push(modelReason);

  const reading = readRole(branch);
  evidence.push(reading.reason);

  const base = resolveBase({ role: reading.role, branch, defaultBranch, developBranch });
  if (base !== null) {
    const fallback =
      reading.role === 'feature' && developBranch === null && defaultBranch !== null
        ? ` (develop no existe: la base cae a "${defaultBranch}"; no se finge un develop ausente)`
        : '';
    evidence.push(`base de comparación: "${base}"${fallback}.`);
  } else {
    evidence.push(
      reading.role === 'main'
        ? 'sin base de comparación: main es el pivote, se compara contra la release o el hotfix que fusiona.'
        : 'sin base de comparación observable: no hay develop ni pivote contra el que comparar.',
    );
  }

  const detail = `${modelReason} Rol ${reading.role}${reading.feature ? ` de "${reading.feature}"` : ''}${
    reading.version ? ` (versión "${reading.version}")` : ''
  }${base !== null ? `; base de comparación "${base}"` : '; sin base de comparación'}.`;

  return {
    model,
    branch,
    role: reading.role,
    base,
    feature: reading.feature,
    version: reading.version,
    evidence,
    detail,
  };
};

// ---------------------------------------------------------------------------------------------
// Política por rol
// ---------------------------------------------------------------------------------------------

const deltaPath = (feature: string | null): string =>
  feature ? `.sdd/specs/${feature}/delta.md` : '.sdd/specs/<feature>/delta.md';

/**
 * Lo que exige toda rama de cambio. Se enuncia sin el nombre de la feature a propósito: así la
 * política de `release` es, literalmente, la de `feature` MÁS lo suyo, y ningún test tiene que
 * comparar cadenas que difieren por un nombre. El nombre concreto aparece en `detail`.
 */
const changeContract = (brownfield: boolean): string[] => [
  brownfield
    ? 'el contrato del cambio es la delta: .sdd/specs/<feature>/delta.md con entradas ADSR y REQ-IDs propios de la delta'
    : 'el contrato del cambio es la tríada viva: requirements.md + plan.md/design.md + tasks.md (greenfield: sustituye a la delta)',
  'la spec viaja con el código: la delta y la tríada son archivos de esta misma rama, no de un wiki',
  'evidencia capturada en cada tarea completada (evidence lock): la salida de la comprobación que la habría falsado',
  'los gates se ejecutan contra la rama base, no contra el árbol de trabajo',
];

const levelOf = (opts?: { level?: string; brownfield?: boolean }): SddRigorLevel =>
  isRigorLevel(opts?.level) ? opts.level : DEFAULT_RIGOR_LEVEL;

const union = (base: string[], extra: string[]): string[] => [
  ...base,
  ...extra.filter((item) => !base.includes(item)),
];

/** El suelo: lo único que HOY puede bloquear de verdad. Se nombra el mecanismo, no se supone. */
const floorBlocking = (): string[] => [
  'El hook de pre-commit ejecuta C1/C2/C3 sobre el índice preparado (nivel B, git): el commit falla si el suelo está instalado. Compruébalo con `open-sdd floor status`.',
  'El workflow de gates corre la cadena completa en cada pull_request (nivel C, CI): la fusión del PR falla si la cadena no pasa.',
  'Esta herramienta NO instala branch protection, revisiones obligatorias ni bloqueo de push: ningún rol —tampoco main— tiene hoy un candado propio. Lo exigido que no figure en esta lista es consejo, no imposición.',
];

/**
 * La política del rol. `required` es lo que el rol exige; `blocking` es lo que de verdad lo impone
 * hoy. La distancia entre ambas listas es deliberada y visible: es la misma distinción techo/suelo
 * que hacen los niveles de imposición, y evita vender una protección que no está instalada.
 */
export const branchPolicy = (
  state: GitFlowState,
  opts?: { level?: string; brownfield?: boolean },
): BranchPolicy => {
  const level = levelOf(opts);
  const chain = effectiveGates(level);
  const brownfield = opts?.brownfield !== false;
  const base = state.base ?? 'la rama base';
  const feature = state.feature;
  const blocking = floorBlocking();

  switch (state.role) {
    case 'feature':
      return {
        role: 'feature',
        required: changeContract(brownfield),
        gates: chain,
        blocking: [
          ...blocking,
          'Bajo el perfil team o enterprise, el invariante spec_contract_present bloquea código escrito sin spec/delta aprobada; bajo solo se reporta como advisory y no bloquea.',
        ],
        nextStep: feature ? `open-sdd delta validate ${feature}` : 'open-sdd status',
        detail: `Rol feature: el contrato del cambio es la delta de ${
          feature ? `"${feature}" (${deltaPath(feature)})` : 'la feature que nombra la rama'
        }; los gates se ejecutan contra "${base}". Lo exigido que no figura en "bloquea hoy" es consejo, no candado.`,
      };

    case 'release':
      return {
        role: 'release',
        required: union(changeContract(brownfield), [
          `CHANGELOG y versión: el salto${state.version ? ` a "${state.version}"` : ''} viaja en esta rama release/*`,
          `bundle de auditoría: \`open-sdd audit bundle ${feature ?? '<feature>'}\``,
          `CI verde en el pull request antes de fusionar en ${state.base ?? 'main'}`,
          'fusión a main Y retorno a develop: una release no deja develop atrás',
        ]),
        gates: union(chain, ['C3', 'C6']),
        blocking: [
          ...blocking,
          'La CI verde del PR es lo que bloquea la fusión; el changelog, la versión y el bundle de auditoría no tienen hoy un gate que los imponga.',
        ],
        nextStep: 'open-sdd gates run',
        detail: `Rol release${
          state.version ? ` (versión "${state.version}")` : ''
        }: exige todo lo de una rama de cambio MÁS changelog/versión, bundle de auditoría y CI verde; se fusiona en ${
          state.base ?? 'main'
        } y vuelve a develop. Solo la CI del PR bloquea hoy.`,
      };

    case 'hotfix':
      return {
        role: 'hotfix',
        required: [
          'la constitución vigente: el arreglo no puede violar un principio en vigor (.sdd/steering/constitution.md)',
          'evidencia capturada: la comprobación que reproduce el fallo y la que lo cierra',
          'delta posterior a la fusión: el arreglo se escribe en la spec (delta.md) o desaparece de la especificación',
          `gates contra ${base} y fusión a main y a develop con tag de la versión${
            state.version ? ` "${state.version}"` : ''
          }`,
        ],
        gates: union(chain, ['C3']),
        blocking: [
          ...blocking,
          'El post-merge delta y la constitución no tienen hoy un gate que los imponga; el perfil team/enterprise sí bloquea código sin spec aprobada (invariante spec_contract_present).',
        ],
        nextStep: 'open-sdd gates run',
        detail: `Rol hotfix${
          state.version ? ` (versión "${state.version}")` : ''
        }: la constitución y la evidencia siguen siendo exigibles, y la delta posterior a la fusión es obligatoria para que el arreglo no desaparezca de la especificación. Nada de eso bloquea hoy por sí solo.`,
      };

    case 'main':
      return {
        role: 'main',
        required: [
          'solo fusiones: nada de trabajo directo en main',
          `el pivote en verde: la cadena completa (${CORE_CHAIN_IDS.join(', ')}) pasa en el PR antes de fusionar`,
          'la release o el hotfix fusionado conserva su versión y su changelog',
          'si main despliega, la fusión es el punto de no retorno: no hay commit directo que deshacer',
        ],
        gates: [...CORE_CHAIN_IDS],
        blocking: [
          ...blocking,
          'En main no hay candado adicional: sin branch protection instalada, un commit directo pasa; el único bloqueo real es la cadena del PR.',
        ],
        nextStep: 'open-sdd gates run',
        detail:
          'Rol main: pivote de fusiones, no de trabajo. El pivote debe pasar la cadena completa, pero hoy nada impide un commit directo en main.',
      };

    // Razón de la política de develop: es la rama de INTEGRACIÓN —exige el pivote verde y la integración de las features, pero NO el paquete de release (versión/changelog/bundle)—, y por eso difiere de feature.
    case 'develop':
      return {
        role: 'develop',
        required: [
          'integración primero: las features se fusionan aquí antes de cortar una release',
          `el pivote pasa en la integración antes de abrir release/*: \`open-sdd gates run\` contra ${base}`,
          'cada feature fusionada conserva su delta y su evidencia',
          'sin trabajo directo salvo la resolución de integración',
        ],
        gates: union(chain, ['C6']),
        blocking: [
          ...blocking,
          'En develop no hay candado adicional: el pivote se comprueba con `open-sdd gates run`, pero nada impide fusionar sin él.',
        ],
        nextStep: 'open-sdd status',
        detail:
          'Rol develop: la rama de integración. Las features se fusionan aquí y el pivote debe pasar antes de cortar una release; no hay candado propio más allá del suelo.',
      };

    case 'other':
    default:
      return {
        role: 'other',
        required: feature
          ? [
              `el contrato del cambio: ${deltaPath(feature)} (el nombre de la rama declara la feature, pero no su rol)`,
              'declara el rol en el nombre (feature/<x>, feat/<x>, release/<v>, hotfix/<v>, bugfix/<x>) para que la gobernanza sepa qué exigir',
              'mientras el rol no se reconozca, solo aplica el suelo común: el gate de commit y la cadena del PR',
            ]
          : [
              `rol no reconocido: la rama ${
                state.branch ? `"${state.branch}"` : '(sin rama)'
              } no declara rol; nómbrala feature/<x>, feat/<x>, release/<v>, hotfix/<v> o bugfix/<x>`,
              'sin rol declarado no se exige un contrato concreto: se aplica el suelo común (gate de commit y cadena del PR)',
              'si esta rama es un cambio, su spec es la de la feature que nombra; si no nombra ninguna, la gobernanza no puede saber cuál es',
            ],
        gates: chain,
        blocking: [
          ...blocking,
          'Sin rol reconocido no se puede exigir nada por encima del suelo: es el propio nombre de la rama el que decide qué bloquea.',
        ],
        nextStep: feature ? `open-sdd delta validate ${feature}` : 'open-sdd status',
        detail: feature
          ? `Rol other: el nombre declara la feature "${feature}" pero ningún rol; se aplica el suelo común y se puede validar su delta, pero no se finge una gobernanza de rol que la rama no declara.`
          : 'Rol other: el nombre no corresponde a la convención. No se adivina el rol ni se exige un contrato que la rama no declara; solo aplica el suelo.',
      };
  }
};

// ---------------------------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------------------------

/** Una pantalla: unas 25 líneas. Cualquier línea que se pase se recorta; nada se omite en silencio. */
const LINE_WIDTH = 118;
const clip = (text: string, width: number = LINE_WIDTH): string =>
  text.length > width ? `${text.slice(0, width - 1)}…` : text;

export const renderGitFlow = (state: GitFlowState, policy: BranchPolicy): string[] => {
  const lines: string[] = [];

  lines.push(
    `GitFlow — modelo ${state.model} · rama ${state.branch ?? '(sin rama)'} · rol ${policy.role}`,
  );
  lines.push(
    `  base: ${state.base ?? '—'} · feature: ${state.feature ?? '—'} · versión: ${state.version ?? '—'}`,
  );
  lines.push(`  ${clip(state.detail)}`);
  lines.push('  evidencia:');
  for (const item of state.evidence.slice(0, 5)) lines.push(`    - ${clip(item)}`);

  lines.push('');
  lines.push(`Requerido por el rol ${policy.role}:`);
  for (const item of policy.required) lines.push(`  · ${clip(item)}`);
  lines.push(`  gates: ${policy.gates.join(', ') || '—'}`);

  lines.push('');
  lines.push('Bloquea hoy (solo el suelo instalado):');
  for (const item of policy.blocking) lines.push(`  ! ${clip(item)}`);
  lines.push(`  ${clip(policy.detail)}`);

  lines.push('');
  lines.push(`Siguiente paso: ${policy.nextStep}`);
  return lines;
};
