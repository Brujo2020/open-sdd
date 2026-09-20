/**
 * `open-sdd init` — el inicializador de un comando.
 *
 * ── Qué resuelve ────────────────────────────────────────────────────────────────────────────────
 * El objetivo del proyecto es «instalación y primer uso en minutos, en cualquier sistema operativo,
 * para enterprise y no-enterprise». Este comando recorre el arranque completo en UNA invocación
 * idempotente: detecta el agente anfitrión, declara el nivel de rigor, elige el idioma y deja el
 * repositorio listo para la primera especificación. Sin `--write` imprime el plan y no escribe nada.
 *
 * ── Idempotencia ────────────────────────────────────────────────────────────────────────────────
 * Nunca sobrescribe un artefacto existente: ni `.sdd/settings/rigor.json`, ni la constitución, ni el
 * hook. Cada artefacto se reporta con `create`/`keep`/`update` y su motivo, exactamente como
 * `planBootstrap`, para que el plan y la realidad no puedan divergir en silencio.
 *
 * ── Compatibilidad: `init <feature>` sigue siendo el init de spec ────────────────────────────────
 * El CLI ya despachaba `init` (y `spec-init`) a `handleInitCommand`, que crea una ESPECIFICACIÓN
 * (`initSpec`). Este archivo conserva ese contrato —hay un test instalado que lo fija— y añade el
 * inicializador de proyecto en la misma exportación. La heurística de despacho es explícita y está
 * en `isProjectInitInvocation`: un positional que NO es un directorio existente y sin banderas de
 * proyecto es un nombre de feature (comportamiento heredado); `.`, un directorio existente, la
 * ausencia de positional o cualquier bandera de proyecto (`--agent`, `--level`, `--skills`,
 * `--write`, `--json`, `--yes`) es una inicialización de proyecto.
 *
 * Los textos visibles son español, como el resto del CLI.
 */

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { colors } from '../ui/colors.js';
import type { CliIO } from '../io.js';
import { agentList, getAgentDefinition, type AgentType } from '../../agents/registry.js';
import {
  DEFAULT_RIGOR_LEVEL,
  RIGOR_LEVELS,
  constitutionRequired,
  effectiveGates,
  isRigorLevel,
  type SddRigorLevel,
} from '../../core/rigor.js';
import { initSpec, resolveSddDir } from '../../core/specManager.js';
import { formatHeading, formatSuccess } from '../ui/colors.js';
import { scanProject } from '../../core/reverseEngineering.js';
import { buildDescriptiveConstitution, collectRepoFacts } from '../../core/reverseConstitution.js';
import { parseConstitution, renderConstitution } from '../../core/constitution.js';
import { inspectCommitHook, resolveCliExecutable } from '../../core/doctor.js';

// ---------------------------------------------------------------------------------------------
// Tipos del plan
// ---------------------------------------------------------------------------------------------

export interface InitArtifact {
  path: string;
  action: 'create' | 'keep' | 'update';
  reason: string;
  /** Qué artefacto es: permite consumir el plan por máquina sin interpretar la prosa del motivo. */
  kind: 'rigor' | 'constitution' | 'hook' | 'agent-skills';
}

export interface InitAgentChoice {
  id: AgentType;
  label: string;
  flag: string;
  source: 'declarado' | 'detectado' | 'defecto';
  evidence: string[];
  /** Otros anfitriones observados, con la bandera con la que se eligen. */
  alternatives: { id: AgentType; label: string; flag: string; evidence: string[] }[];
}

export interface InitLanguageChoice {
  lang: 'es' | 'en';
  source: 'declarado' | 'docs' | 'defecto';
  evidence: string[];
}

export interface InitPlan {
  root: string;
  cwd: string;
  agent: InitAgentChoice;
  level: {
    level: SddRigorLevel;
    name: string;
    source: 'declarado' | 'defecto';
    gates: string[];
    rationale: string;
    /** La escalera completa, para que el usuario sepa qué acepta (y que la constitución es el suelo). */
    ladder: { level: SddRigorLevel; name: string; gates: string[]; constitutionRequired: boolean; definition: string }[];
  };
  language: InitLanguageChoice;
  skills: boolean;
  write: boolean;
  artifacts: InitArtifact[];
  steps: string[];
  nextCommands: string[];
  detail: string;
  complete: boolean;
}

export interface InitOutcome {
  written: string[];
  kept: string[];
  failures: string[];
  /** Detalle auditable de lo delegado (p. ej. el comando exacto del instalador). */
  details: string[];
}

// ---------------------------------------------------------------------------------------------
// utilidades
// ---------------------------------------------------------------------------------------------

const exists = async (p: string): Promise<boolean> => (await stat(p).catch(() => null)) !== null;

const posixJoin = (...parts: string[]): string => path.posix.join(...parts);

const flagValue = (args: string[], name: string): string | undefined => {
  const withEquals = args.find((arg) => arg.startsWith(`--${name}=`));
  if (withEquals) return withEquals.slice(`--${name}=`.length);
  const index = args.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const next = args[index + 1];
  return next && !next.startsWith('-') ? next : '';
};

const readIfExists = async (p: string): Promise<string | null> => readFile(p, 'utf8').catch(() => null);

// ---------------------------------------------------------------------------------------------
// Detección del agente anfitrión
// ---------------------------------------------------------------------------------------------

/**
 * Anfitriones reconocidos por su directorio de layout.
 *
 * Se prefiere SIEMPRE la variante no desaconsejada del registro: `--cursor`, `--claude-code`,
 * `--copilot`, `--opencode` llevan `upgradeNotice` (modos en desuso), así que la detección propone la
 * variante de skills y publica la otra como alternativa con su bandera.
 */
const HOST_DIRS: { dir: string; agent: AgentType; label: string; host: string }[] = [
  { dir: '.claude', agent: 'claude-code-skills', label: 'Claude Code', host: 'Claude Code' },
  { dir: '.cursor', agent: 'cursor-skills', label: 'Cursor IDE', host: 'Cursor IDE' },
  { dir: '.agent', agent: 'antigravity-skills', label: 'Antigravity', host: 'Google Antigravity' },
  { dir: '.agents', agent: 'codex-skills', label: 'Codex CLI', host: 'Codex CLI' },
  { dir: '.github', agent: 'github-copilot-skills', label: 'GitHub Copilot', host: 'GitHub Copilot' },
  { dir: '.gemini', agent: 'gemini-cli-skills', label: 'Gemini CLI', host: 'Gemini CLI' },
  { dir: '.windsurf', agent: 'windsurf-skills', label: 'Windsurf IDE', host: 'Windsurf IDE' },
  { dir: '.qwen', agent: 'qwen-code', label: 'Qwen Code', host: 'Qwen Code' },
  { dir: '.opencode', agent: 'opencode-skills', label: 'OpenCode', host: 'OpenCode' },
  { dir: '.codex', agent: 'codex-skills', label: 'Codex CLI', host: 'Codex CLI' },
];

/** Archivos de instrucciones: marcadores débiles, compartidos por varios anfitriones. */
const DOC_MARKERS: { file: string; agent: AgentType }[] = [
  { file: 'CLAUDE.md', agent: 'claude-code-skills' },
  { file: 'GEMINI.md', agent: 'gemini-cli-skills' },
  { file: 'QWEN.md', agent: 'qwen-code' },
  { file: '.github/copilot-instructions.md', agent: 'github-copilot-skills' },
];

const flagFor = (agent: AgentType): string => getAgentDefinition(agent).aliasFlags[0] ?? `--${agent}`;

interface AgentMatch {
  agent: AgentType;
  score: number;
  evidence: string[];
  path: string;
}

const detectAgent = async (target: string): Promise<InitAgentChoice> => {
  const matches: AgentMatch[] = [];

  // 1. La evidencia más fuerte: el directorio exacto que el registro declara para ese agente.
  for (const id of agentList) {
    const definition = getAgentDefinition(id);
    const commandsDir = definition.layout.commandsDir;
    if (await exists(path.join(target, commandsDir))) {
      matches.push({ agent: id, score: 100 + commandsDir.length, evidence: [`${commandsDir}/ existe`], path: commandsDir });
    }
  }

  // 2. Marcadores de archivo propios de un anfitrión (p. ej. las instrucciones de Copilot).
  for (const marker of DOC_MARKERS) {
    if (await exists(path.join(target, marker.file))) {
      matches.push({ agent: marker.agent, score: 90, evidence: [`${marker.file} existe`], path: marker.file });
    }
  }

  // 3. Solo el directorio del anfitrión: se propone su variante no desaconsejada.
  for (const host of HOST_DIRS) {
    if (await exists(path.join(target, host.dir))) {
      matches.push({ agent: host.agent, score: 50, evidence: [`${host.dir}/ existe`], path: host.dir });
    }
  }

  // 4. Archivo de instrucciones genérico o compartido (AGENTS.md): marcador débil.
  if (await exists(path.join(target, 'AGENTS.md'))) {
    matches.push({ agent: 'claude-code-skills', score: 30, evidence: ['AGENTS.md existe'], path: 'AGENTS.md' });
  }

  if (matches.length === 0) {
    return {
      id: 'claude-code-skills',
      label: 'Claude Code Skills',
      flag: '--claude-code-skills',
      source: 'defecto',
      evidence: ['no se observó ningún marcador de anfitrión (.claude/, .cursor/, .agent/, .github/, AGENTS.md, GEMINI.md, QWEN.md, .codex/, .opencode/)'],
      alternatives: [],
    };
  }

  // Más específico primero: puntuación, luego la ruta observada más profunda, luego el orden del registro.
  const ordered = [...matches].sort(
    (a, b) => b.score - a.score || b.path.length - a.path.length || agentList.indexOf(a.agent) - agentList.indexOf(b.agent),
  );
  const chosen = ordered[0];
  const alternatives = ordered
    .slice(1)
    .map((match) => ({
      id: match.agent,
      label: getAgentDefinition(match.agent).label,
      flag: flagFor(match.agent),
      evidence: match.evidence,
    }))
    // Un mismo agente puede aparecer por varias señales: se publica una vez.
    .filter((alternative, index, all) => all.findIndex((item) => item.id === alternative.id) === index)
    .filter((alternative) => alternative.id !== chosen.agent);

  return {
    id: chosen.agent,
    label: getAgentDefinition(chosen.agent).label,
    flag: flagFor(chosen.agent),
    source: 'detectado',
    evidence: chosen.evidence,
    alternatives,
  };
};

// ---------------------------------------------------------------------------------------------
// Detección del idioma
// ---------------------------------------------------------------------------------------------

const SPANISH_MARKERS =
  /\b(el|la|los|las|un|una|unos|unas|de|del|que|para|con|por|como|se|su|sus|es|son|no|más|también|desde|hasta|entre|sobre|cada|cuando|donde|puede|debe|este|esta|estos|estas|sin|al|lo)\b/gi;
const ENGLISH_MARKERS =
  /\b(the|and|of|to|in|is|are|for|with|that|this|from|as|on|by|be|or|not|it|its|will|can|should|must|when|where|which|each|all|any|use|run)\b/gi;

const countMatches = (text: string, pattern: RegExp): number => {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  return [...text.matchAll(global)].length;
};

const detectLanguage = async (target: string, sddDir: string): Promise<InitLanguageChoice> => {
  const candidates: string[] = [];
  const steeringDir = path.join(target, sddDir, 'steering');
  const steeringEntries = await readdir(steeringDir, { withFileTypes: true }).catch(() => []);
  for (const entry of steeringEntries) {
    if (entry.isFile() && entry.name.endsWith('.md')) candidates.push(posixJoin(sddDir, 'steering', entry.name));
  }
  for (const file of ['README.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'QWEN.md']) {
    if (await exists(path.join(target, file))) candidates.push(file);
  }

  const used: string[] = [];
  let text = '';
  for (const candidate of candidates.slice(0, 4)) {
    const content = await readIfExists(path.join(target, candidate));
    if (content === null) continue;
    text += `\n${content.slice(0, 6000)}`;
    used.push(candidate);
  }

  if (text.trim().length < 120) {
    return {
      lang: 'es',
      source: 'defecto',
      evidence: used.length > 0 ? [`muestra insuficiente en ${used.join(', ')}`] : ['sin README ni steering que inspeccionar'],
    };
  }

  const spanish = countMatches(text, SPANISH_MARKERS) + (text.match(/[áéíóúñ¿¡]/gi) ?? []).length;
  const english = countMatches(text, ENGLISH_MARKERS);
  const lang: 'es' | 'en' = english > spanish * 1.15 ? 'en' : 'es';
  return {
    lang,
    source: 'docs',
    evidence: [`marcadores en ${used.join(', ')}: ${spanish} en español · ${english} en inglés`],
  };
};

// ---------------------------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------------------------

export interface PlanInitInput {
  cwd: string;
  target: string;
  agent?: string;
  level?: string;
  lang?: string;
  skills?: boolean;
  write?: boolean;
  /** Raíz SDD declarada (`--sdd-dir`); por defecto `.sdd`, o `.kiro` si es el layout existente. */
  sddDir?: string;
}

const rationaleFor = (level: SddRigorLevel): string =>
  `Nivel declarado por \`open-sdd init\` (${level}): exige requisitos en forma comprobable (EARS) y una constitución válida, y no exige todavía delta, ligado de evidencia ni detección de drift. Se sube editando este archivo, nunca bajando lo que el suelo ya comprueba.`;

/**
 * ¿El CLI instalado soporta `brownfield constitution --draft`? Se comprueba por COMPORTAMIENTO, no
 * leyendo el código del bundle: `--help` no sirve de sonda porque el CLI intercepta `--help` antes
 * del despacho de subcomandos y devuelve la ayuda global para cualquier subcomando. La sonda no
 * escribe nada (sin `--write`) y su resultado se cachea por binario: no depende del objetivo.
 */
const draftSupportCache = new Map<string, boolean>();

const supportsBrownfieldDraft = (cwd: string, cliPath: string | null): boolean => {
  if (cliPath === null) return false;
  const cached = draftSupportCache.get(cliPath);
  if (cached !== undefined) return cached;
  const probe = spawnSync(process.execPath, [cliPath, 'brownfield', 'constitution', cwd, '--draft'], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
  });
  const supported = `${probe.stdout ?? ''}`.includes('Borrador de constitución');
  draftSupportCache.set(cliPath, supported);
  return supported;
};

export const planInit = async (input: PlanInitInput): Promise<InitPlan> => {
  const { cwd } = input;
  const target = path.resolve(cwd, input.target);

  if (!(await exists(target))) {
    throw new Error(`El directorio objetivo no existe: ${target}. Créalo antes de inicializarlo.`);
  }

  // ── Agente ──────────────────────────────────────────────────────────────────────────────────
  let agent: InitAgentChoice;
  if (input.agent !== undefined) {
    if (!(agentList as readonly string[]).includes(input.agent)) {
      throw new Error(
        `Agente desconocido: "${input.agent}". Admitidos: ${agentList.join(', ')} (o sus alias ${agentList
          .flatMap((id) => getAgentDefinition(id).aliasFlags)
          .join(', ')}).`,
      );
    }
    const id = input.agent as AgentType;
    agent = {
      id,
      label: getAgentDefinition(id).label,
      flag: flagFor(id),
      source: 'declarado',
      evidence: [`--agent ${input.agent}`],
      alternatives: [],
    };
  } else {
    agent = await detectAgent(target);
  }

  // ── Nivel de rigor ──────────────────────────────────────────────────────────────────────────
  if (input.level !== undefined && !isRigorLevel(input.level)) {
    throw new Error(
      `Nivel de rigor inválido: "${input.level}". Admitidos: ${RIGOR_LEVELS.map((level) => level.level).join(', ')}.`,
    );
  }
  const level: SddRigorLevel = input.level !== undefined ? (input.level as SddRigorLevel) : DEFAULT_RIGOR_LEVEL;
  const levelSpec = RIGOR_LEVELS.find((spec) => spec.level === level)!;

  // ── Idioma ──────────────────────────────────────────────────────────────────────────────────
  const sddDir = input.sddDir && input.sddDir.trim().length > 0 ? input.sddDir.trim() : await resolveSddDir(target);
  let language: InitLanguageChoice;
  if (input.lang !== undefined) {
    if (input.lang !== 'es' && input.lang !== 'en') {
      throw new Error(`Idioma no admitido: "${input.lang}". Admitidos: es, en.`);
    }
    language = { lang: input.lang, source: 'declarado', evidence: [`--lang ${input.lang}`] };
  } else {
    language = await detectLanguage(target, sddDir);
  }

  const project = await scanProject(target);
  const hasCode =
    project.language !== 'unknown' ||
    project.sourceDirs.length > 0 ||
    project.testDirs.length > 0 ||
    (project.workspaceRoots ?? []).length > 0;

  const rigorPath = posixJoin(sddDir, 'settings', 'rigor.json');
  const constitutionPath = posixJoin(sddDir, 'steering', 'constitution.md');

  const rigorExists = await exists(path.join(target, rigorPath));
  const constitutionExists = await exists(path.join(target, constitutionPath));

  const cliPath = await resolveCliExecutable(target);
  const draftAvailable = supportsBrownfieldDraft(target, cliPath);

  const artifacts: InitArtifact[] = [
    {
      kind: 'rigor',
      path: rigorPath,
      action: rigorExists ? 'keep' : 'create',
      reason: rigorExists
        ? 'ya existe una elección de rigor declarada: no se sobrescribe; cambiarla es editar el archivo, no reinstalar'
        : 'no existe: se declara el nivel y su motivo (una elección de rigor sin motivo no es auditable y el modelo la rechaza)',
    },
  ];

  if (hasCode) {
    artifacts.push({
      kind: 'constitution',
      path: constitutionPath,
      action: constitutionExists ? 'keep' : 'create',
      reason: constitutionExists
        ? 'ya existe una constitución: no se sobrescribe; cualquier cambio entra como enmienda gobernada'
        : 'no existe: se deriva del código (descriptiva, con evidencia) para que ningún agente «modernice» lo que nadie pidió',
    });
  }

  // ── Hook de commit: se delega en el instalador existente, nunca se reimplementa ─────────────
  const hook = await inspectCommitHook(target);
  const hookReason: Record<typeof hook.state, string> = {
    absent: 'no es un repositorio git: no hay hook que instalar todavía',
    missing: 'no hay hook instalado: se instala el gate de commit de open-sdd',
    foreign: 'hay un hook ajeno: NO se sobrescribe; sustitúyelo con `open-sdd floor install <target> --force` (hace copia de seguridad)',
    stale: 'el hook instalado es nuestro pero es una versión antigua del gate: se refresca',
    'not-executable': 'el hook instalado no es ejecutable (git lo ignora en silencio): se reinstala',
    current: 'el hook instalado ya es nuestra versión vigente: se conserva',
    unverifiable: 'el hook existe pero no se pudo comprobar si es nuestra versión: no se toca',
  };
  const hookActionFor: Record<typeof hook.state, 'create' | 'update' | 'keep' | null> = {
    absent: null,
    missing: 'create',
    foreign: 'keep',
    stale: 'update',
    'not-executable': 'update',
    current: 'keep',
    unverifiable: 'keep',
  };
  const hookAction = hookActionFor[hook.state];
  const hookDisplay = hook.hookPath
    ? path.relative(target, hook.hookPath) || '.git/hooks/pre-commit'
    : path.posix.join('.git', 'hooks', 'pre-commit');
  if (hookAction !== null) {
    artifacts.push({
      kind: 'hook',
      path: hookDisplay,
      action: hookAction,
      reason: `${hookReason[hook.state]} (instalador: open-sdd floor install)`,
    });
  }

  if (input.skills) {
    const commandsDir = getAgentDefinition(agent.id).layout.commandsDir;
    const skillsDirExists = await exists(path.join(target, commandsDir));
    artifacts.push({
      kind: 'agent-skills',
      path: commandsDir,
      action: skillsDirExists ? 'update' : 'create',
      reason: skillsDirExists
        ? `el conjunto ya está presente: el instalador existente completa lo ausente y NO sobrescribe lo editado (modo prompt en no-TTY)`
        : `instalación delegada al instalador existente: open-sdd ${agent.flag} --lang ${language.lang}`,
    });
  }

  const targetArg = path.relative(cwd, target) || '.';
  const nextCommands: string[] = [
    draftAvailable
      ? `open-sdd brownfield constitution ${targetArg} --draft`
      : `open-sdd brownfield constitution ${targetArg} --write`,
    'open-sdd status',
    'open-sdd status --check',
  ];

  const steps: string[] = [
    '1. Declara el rigor, el andamiaje de steering y el gate de commit: `open-sdd init ' +
      `${targetArg} --agent ${agent.id} --level ${level} --lang ${language.lang}${input.skills ? ' --skills' : ''} --write\``,
    `2. Constitución (obligatoria en LOS TRES niveles: es el suelo, no un extra): \`${nextCommands[0]}\``,
    `3. Estado del repositorio en una pantalla: \`${nextCommands[1]}\``,
    `4. Gate constitucional de la spec: \`${nextCommands[2]}\``,
    '5. Diagnóstico de la instalación (hook, CLI, entorno): `open-sdd doctor`',
  ];
  if (!hasCode) {
    steps.splice(
      1,
      0,
      '· No se observó código (ni manifiestos, ni directorios de origen ni de tests): no hay nada que reverse-ingeniar, así que la constitución se escribe a mano antes de especificar.',
    );
  }
  if (input.skills && cliPath === null) {
    steps.push(
      'ATENCIÓN: se pidió --skills pero no se encontró el instalador (CLI): la instalación del agente NO se puede ejecutar.',
    );
  }

  const toCreate = artifacts.filter((artifact) => artifact.action === 'create').length;
  const toUpdate = artifacts.filter((artifact) => artifact.action === 'update').length;
  const toKeep = artifacts.filter((artifact) => artifact.action === 'keep').length;
  const detail = [
    `Plan de init en ${target}: agente ${agent.id} (${agent.source}), nivel ${level} (${levelSpec.name}), idioma ${language.lang} (${language.source}).`,
    `${toCreate} artefacto(s) por crear, ${toUpdate} por actualizar, ${toKeep} conservado(s).`,
    input.write ? 'Se escribirá lo indicado.' : 'Sin --write no se escribe nada: este es el plan.',
  ].join(' ');

  return {
    root: target,
    cwd,
    agent,
    level: {
      level,
      name: levelSpec.name,
      source: input.level !== undefined ? 'declarado' : 'defecto',
      gates: effectiveGates(level),
      rationale: rationaleFor(level),
      ladder: RIGOR_LEVELS.map((spec) => ({
        level: spec.level,
        name: spec.name,
        gates: [...spec.gatesActive],
        constitutionRequired: constitutionRequired(spec.level, hasCode).required,
        definition: spec.definition,
      })),
    },
    language,
    skills: input.skills === true,
    write: input.write === true,
    artifacts,
    steps,
    nextCommands,
    detail,
    complete: true,
  };
};

// ---------------------------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------------------------

const writeRigorSettings = async (plan: InitPlan): Promise<{ action: 'create' | 'keep'; failure?: string }> => {
  const artifact = plan.artifacts.find((item) => item.kind === 'rigor');
  const resolved = path.join(plan.root, artifact?.path ?? posixJoin('.sdd', 'settings', 'rigor.json'));
  if (await exists(resolved)) return { action: 'keep' };
  try {
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(
      resolved,
      `${JSON.stringify(
        {
          level: plan.level.level,
          rationale: plan.level.rationale,
          brownfield: plan.artifacts.some((item) => item.kind === 'constitution'),
          updated_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    return { action: 'create' };
  } catch (error) {
    return { action: 'keep', failure: `no se pudo escribir ${artifact?.path ?? resolved} (${(error as Error).message})` };
  }
};

const writeConstitution = async (plan: InitPlan): Promise<{ action: 'create' | 'keep'; failure?: string; detail?: string }> => {
  const artifact = plan.artifacts.find((item) => item.kind === 'constitution');
  if (!artifact) return { action: 'keep' };
  const resolved = path.join(plan.root, artifact.path);
  if (await exists(resolved)) return { action: 'keep' };
  try {
    const project = await scanProject(plan.root);
    const facts = await collectRepoFacts(plan.root, project);
    const { constitution } = buildDescriptiveConstitution(facts);
    const rendered = renderConstitution(constitution);
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, rendered, 'utf8');
    const roundTrip = parseConstitution(rendered);
    return {
      action: 'create',
      detail: `${roundTrip.principles.length}/${constitution.principles.length} principio(s) legibles en la ida y vuelta`,
    };
  } catch (error) {
    return { action: 'keep', failure: `no se pudo escribir ${artifact.path} (${(error as Error).message})` };
  }
};

const installAgentSkills = async (
  plan: InitPlan,
): Promise<{ action: 'create' | 'keep'; failure?: string; detail?: string }> => {
  if (!plan.skills) return { action: 'keep' };
  const cliPath = await resolveCliExecutable(plan.root);
  if (cliPath === null) {
    return {
      action: 'keep',
      failure:
        'se pidió --skills pero no se encontró el instalador (CLI) alcanzable: la instalación del agente NO se ha ejecutado. Instálalo con `npx open-sdd@latest --version` o compílalo con `npm --prefix tools/open-sdd run build`.',
    };
  }
  const definition = getAgentDefinition(plan.agent.id);
  const alias = (definition.aliasFlags[0] ?? `--${plan.agent.id}`).replace(/^--/, '');
  // `--overwrite=prompt` con stdio no interactivo es el único modo que hace lo correcto:
  // escribe lo que falta y conserva lo existente. `--overwrite=skip` NO sirve: su política de
  // categoría también salta los ficheros que NO existen, así que en un proyecto recién creado
  // instalaría 0 de 62 ficheros y saldría con 0 (bug reportado, fuera del alcance de este archivo).
  const result = spawnSync(
    process.execPath,
    [cliPath, `--${alias}`, '--lang', plan.language.lang, '--overwrite=prompt'],
    { cwd: plan.root, encoding: 'utf8', timeout: 300_000 },
  );
  if (result.status !== 0) {
    return {
      action: 'keep',
      failure: `el instalador existente falló (código ${result.status ?? 'desconocido'}): ${(result.stderr ?? '').trim().split('\n').slice(-1)[0] ?? 'sin detalle'}`,
    };
  }
  return {
    action: 'create',
    detail: `instalado con \`open-sdd --${alias} --lang ${plan.language.lang} --overwrite=prompt\` (no interactivo: crea lo ausente, conserva lo existente)`,
  };
};

const applyInit = async (plan: InitPlan): Promise<InitOutcome> => {
  const outcome: InitOutcome = { written: [], kept: [], failures: [], details: [] };

  const rigorPath = plan.artifacts.find((item) => item.kind === 'rigor')!.path;
  const rigor = await writeRigorSettings(plan);
  if (rigor.failure) outcome.failures.push(rigor.failure);
  else if (rigor.action === 'create') outcome.written.push(rigorPath);
  else outcome.kept.push(rigorPath);

  const constitutionArtifact = plan.artifacts.find((item) => item.kind === 'constitution');
  if (constitutionArtifact) {
    const constitution = await writeConstitution(plan);
    if (constitution.failure) outcome.failures.push(constitution.failure);
    else if (constitution.action === 'create') outcome.written.push(constitutionArtifact.path);
    else outcome.kept.push(constitutionArtifact.path);
  }

  const hookArtifact = plan.artifacts.find((item) => item.kind === 'hook');
  if (hookArtifact && (hookArtifact.action === 'create' || hookArtifact.action === 'update')) {
    const cliPath = await resolveCliExecutable(plan.root);
    if (cliPath === null) {
      outcome.failures.push(
        `no se pudo instalar el hook de commit (${hookArtifact.path}): el instalador (CLI) no está alcanzable. Ejecútalo tú: open-sdd floor install ${plan.root}`,
      );
    } else {
      const result = spawnSync(process.execPath, [cliPath, 'floor', 'install', plan.root], {
        cwd: plan.root,
        encoding: 'utf8',
        timeout: 60_000,
      });
      if (result.status === 0) outcome.written.push(hookArtifact.path);
      else
        outcome.failures.push(
          `el instalador del hook falló (código ${result.status ?? 'desconocido'}): ${(result.stderr ?? '').trim().split('\n').slice(-1)[0] ?? 'sin detalle'}`,
        );
    }
  } else if (hookArtifact) {
    outcome.kept.push(hookArtifact.path);
  }

  if (plan.skills) {
    const skillsArtifactPath = getAgentDefinition(plan.agent.id).layout.commandsDir;
    const skills = await installAgentSkills(plan);
    if (skills.failure) outcome.failures.push(skills.failure);
    else if (skills.action === 'create') outcome.written.push(skillsArtifactPath);
    else outcome.kept.push(skillsArtifactPath);
    if (skills.detail) outcome.details.push(skills.detail);
  }

  return outcome;
};

// ---------------------------------------------------------------------------------------------
// Superficie CLI
// ---------------------------------------------------------------------------------------------

const PROJECT_FLAGS = new Set(['--agent', '--level', '--skills', '--write', '--json', '--yes', '--sdd-dir']);

/**
 * Despacho explícito entre el inicializador de proyecto y el init de spec heredado.
 * El contrato heredado que un test instalado fija es `init <feature>` → especificación.
 */
export const isProjectInitInvocation = (args: string[], cwd: string): boolean => {
  // Contrato heredado: `--title`/`--git` son banderas del init de spec y no existen en el de proyecto.
  if (args.some((arg) => arg === '--title' || arg.startsWith('--title='))) return false;
  if (args.some((arg) => arg === '--git' || arg.startsWith('--git='))) return false;

  // Cualquier bandera propia del inicializador de proyecto decide sin ambigüedad.
  if (args.some((arg) => PROJECT_FLAGS.has(arg) || arg.startsWith('--sdd-dir='))) return true;

  const positional = args.find((arg) => !arg.startsWith('-'));
  if (positional === undefined) return true;
  if (positional === '.' || positional === '..') return true;
  // Un directorio existente es un objetivo; un slug inexistente es un nombre de feature (heredado).
  return existsSync(path.resolve(cwd, positional));
};

const handleProjectInit = async (args: string[], io: CliIO, cwd: string): Promise<number> => {
  const json = args.includes('--json');
  const write = args.includes('--write');
  const skills = args.includes('--skills');
  const positional = args.find((arg) => !arg.startsWith('-'));
  const flag = (name: string): string | undefined => flagValue(args, name);

  let plan: InitPlan;
  try {
    plan = await planInit({
      cwd,
      target: positional ?? '.',
      ...(flag('agent') !== undefined ? { agent: flag('agent') as string } : {}),
      ...(flag('level') !== undefined ? { level: flag('level') as string } : {}),
      ...(flag('lang') !== undefined ? { lang: flag('lang') as string } : {}),
      ...(flag('sdd-dir') !== undefined ? { sddDir: flag('sdd-dir') as string } : {}),
      skills,
      write,
    });
  } catch (error) {
    io.error(colors.red(`Error: ${(error as Error).message}`));
    return 1;
  }

  let outcome: InitOutcome = { written: [], kept: [], failures: [], details: [] };
  if (write) outcome = await applyInit(plan);

  if (json) {
    io.log(JSON.stringify({ ...plan, outcome }, null, 2));
    return outcome.failures.length > 0 ? 1 : 0;
  }

  io.log('');
  io.log(formatHeading(colors.cyan(`Inicialización open-sdd — ${plan.root}`)));
  io.log('');

  // Agente: SIEMPRE se dice cuál se eligió y por qué, y qué alternativas había.
  io.log(
    `  agente: ${colors.bold(`${plan.agent.id} (${plan.agent.label})`)} ${colors.dim(`[${plan.agent.source}]`)}`,
  );
  for (const evidence of plan.agent.evidence) io.log(colors.dim(`      por qué: ${evidence}`));
  if (plan.agent.source === 'defecto') {
    io.log(colors.dim('      sin marcadores de anfitrión: se usa el valor por defecto del instalador'));
  }
  if (plan.agent.alternatives.length > 0) {
    io.log(
      `      alternativas detectadas: ${plan.agent.alternatives
        .map((alternative) => `${alternative.id} (${alternative.flag})`)
        .join(', ')} — elige con --agent <id>`,
    );
  }
  if (plan.agent.source !== 'declarado') {
    io.log(colors.dim(`      puedes forzarlo con: --agent ${plan.agent.id}`));
  }

  // Nivel: la escalera completa, para que se sepa qué se acepta.
  io.log('');
  io.log(
    `  rigor: ${colors.bold(`${plan.level.name} (${plan.level.level})`)} ${colors.dim(`[${plan.level.source}]`)} · gates activos: ${plan.level.gates.join(', ')}`,
  );
  for (const rung of plan.level.ladder) {
    const mark = rung.level === plan.level.level ? colors.green('→') : colors.dim(' ');
    io.log(
      `    ${mark} ${rung.level.padEnd(15)} gates ${rung.gates.join(',').padEnd(16)} constitución ${rung.constitutionRequired ? colors.bold('OBLIGATORIA') : 'recomendada'}`,
    );
  }
  io.log(
    colors.dim(
      '      La constitución es el SUELO de la escalera, obligatoria en los tres niveles: sin autoridad citable ningún veredicto bloqueante puede justificarse.',
    ),
  );

  // Idioma.
  io.log('');
  io.log(`  idioma: ${colors.bold(plan.language.lang)} ${colors.dim(`[${plan.language.source}]`)}`);
  for (const evidence of plan.language.evidence) io.log(colors.dim(`      por qué: ${evidence}`));

  // Plan de artefactos.
  io.log('');
  io.log(`  ${colors.bold('Artefactos')}`);
  for (const artifact of plan.artifacts) {
    const mark =
      artifact.action === 'create'
        ? colors.green(artifact.action)
        : artifact.action === 'update'
          ? colors.yellow(artifact.action)
          : colors.dim(artifact.action);
    io.log(`    ${mark.padEnd(18)} ${artifact.path}`);
    io.log(`        ${colors.dim(artifact.reason)}`);
  }

  // Pasos.
  io.log('');
  io.log(`  ${colors.bold('Pasos')}`);
  for (const step of plan.steps) io.log(`    ${step}`);

  if (write) {
    io.log('');
    io.log(`  ${colors.bold('Resultado de --write')}`);
    for (const item of outcome.written) io.log(`    ${colors.green('✓')} escrito: ${item}`);
    for (const item of outcome.kept) io.log(colors.dim(`    = conservado: ${item}`));
    for (const detail of outcome.details) io.log(colors.dim(`    · ${detail}`));
    for (const failure of outcome.failures) io.log(`    ${colors.red('✗')} ${failure}`);
  } else {
    io.log('');
    io.log(colors.dim('  Sin --write no se ha escrito nada: este es solo el plan. Añade --write para ejecutarlo.'));
  }

  // Próximas tres órdenes + doctor.
  io.log('');
  io.log(`  ${colors.bold('Siguientes tres órdenes')}`);
  plan.nextCommands.forEach((command, index) => io.log(`    ${index + 1}. ${colors.cyan(command)}`));
  io.log(`  ${colors.bold('Y el diagnóstico de la instalación')}`);
  io.log(`    · ${colors.cyan('open-sdd doctor')}${plan.level.level === 'spec-first' ? '' : ' (comprueba el hook, el CLI, la constitución y el entorno)'}`);

  if (!plan.artifacts.some((artifact) => artifact.kind === 'constitution')) {
    io.log('');
    io.log(
      colors.yellow(
        '  ! No se observó código: no hay constitución que derivar del repositorio. Escríbela a mano en .sdd/steering/constitution.md antes de especificar (el nivel declarado la exige).',
      ),
    );
  }
  if (plan.skills && outcome.failures.length > 0) {
    io.log('');
    io.log(colors.red('  ✗ La instalación del agente no se ejecutó: revisa el mensaje anterior.'));
  }

  io.log('');
  io.log(colors.dim(`  ${plan.detail}`));
  io.log('');
  return outcome.failures.length > 0 ? 1 : 0;
};

// ---------------------------------------------------------------------------------------------
// Init de spec heredado (`init <feature>`) — contrato instalado, se conserva
// ---------------------------------------------------------------------------------------------

export const handleSpecInitCommand = async (
  argv: string[],
  io: CliIO,
  cwd: string = process.cwd(),
): Promise<number> => {
  const featureArg = argv.find((a) => !a.startsWith('-'));

  if (!featureArg) {
    io.error(colors.red('Usage: open-sdd init <feature-slug> [--title="..."] [--lang=en] [--git]'));
    return 1;
  }

  const titleArg = argv.find((a) => a.startsWith('--title='));
  const title = titleArg ? titleArg.split('=')[1].replace(/^["']|["']$/g, '') : undefined;

  const langArg = argv.find((a) => a.startsWith('--lang='));
  const language = langArg ? langArg.split('=')[1] : 'en';

  const createBranch = argv.includes('--git');

  try {
    const sddDir = await resolveSddDir(cwd);
    const result = await initSpec(cwd, featureArg, {
      title,
      language,
      sddDir,
      createBranch,
    });

    io.log('');
    io.log(formatSuccess(`Initialized specification for "${colors.bold(featureArg)}"`));
    io.log(`  Directory: ${colors.cyan(result.specDir)}`);
    if (result.branchCreated && result.branchName) {
      io.log(`  Git Branch: ${colors.green(`Switched to ${result.branchName}`)}`);
    }

    io.log('');
    io.log(formatHeading('Next Actions:'));
    io.log(`  1. Edit requirements in: ${colors.dim(`${result.specDir}/requirements.md`)}`);
    io.log(`  2. In your agent chat, run: ${colors.bold(`/sdd-spec-requirements ${featureArg}`)}`);
    io.log(`  3. Check status anytime with: ${colors.bold(`open-sdd status ${featureArg}`)}`);
    io.log('');
    return 0;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    io.error(colors.red(`Error: ${msg}`));
    return 1;
  }
};

/**
 * Una sola exportación, dos modos, decididos por `isProjectInitInvocation`. El despacho del CLI
 * (`src/index.ts`) no cambia: `init` y `spec-init` siguen llegando aquí.
 */
export const handleInitCommand = async (
  args: string[],
  io: CliIO,
  cwd: string = process.cwd(),
): Promise<number> => {
  if (isProjectInitInvocation(args, cwd)) return handleProjectInit(args, io, cwd);
  return handleSpecInitCommand(args, io, cwd);
};
