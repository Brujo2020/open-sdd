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
import { homedir } from 'node:os';
import path from 'node:path';
import { colors } from '../ui/colors.js';
import { INSTALL_COMMAND } from '../packageIdentity.js';
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
import {
  HOST_INTEGRATIONS,
  detectIntegration,
  integrationById,
  mcpRegistration,
  type HostIntegration,
  type SnippetFormat,
} from '../../core/integrations.js';
import { installStopHook, stopHookFor } from '../../core/stopHook.js';
import {
  COMMAND_TEMPLATE_IDS,
  commandHostById,
  hostForAgent,
  installCommandTemplates,
  planCommandTemplates,
  summarizeCommandTemplates,
  type CommandTemplateArtifact,
} from '../../core/commandTemplates.js';
import {
  IMPORT_SOURCES,
  applyImport,
  planImport,
  type ImportPlan,
  type ImportSource,
} from '../../core/importers.js';

// ---------------------------------------------------------------------------------------------
// Tipos del plan
// ---------------------------------------------------------------------------------------------

export interface InitArtifact {
  path: string;
  action: 'create' | 'keep' | 'update';
  reason: string;
  /** Qué artefacto es: permite consumir el plan por máquina sin interpretar la prosa del motivo. */
  kind: 'rigor' | 'constitution' | 'hook' | 'agent-skills' | 'command-templates' | 'mcp-config';
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
  /** Plantillas de comando del anfitrión: el camino POR DEFECTO (sin MCP, sin red). */
  commandTemplates: {
    host: string | null;
    dir: string | null;
    action: 'create' | 'update' | 'keep';
    verified: boolean;
    reason: string;
    artifacts: CommandTemplateArtifact[];
  };
  /** Registro MCP: opt-in explícito con `--mcp` (algunos anfitriones y políticas lo bloquean). */
  mcp: {
    requested: boolean;
    path: string | null;
    action: 'create' | 'update' | 'keep' | null;
    verified: boolean;
    reason: string | null;
  };
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
  /** Registro MCP explícito: el valor por defecto es NO tocar ninguna configuración MCP. */
  mcp?: boolean;
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
    const definition = getAgentDefinition(agent.id);
    const commandsDir = definition.layout.commandsDir;
    const skillsDirExists = await exists(path.join(target, commandsDir));
    artifacts.push({
      kind: 'agent-skills',
      path: commandsDir,
      action: definition.manifestId ? (skillsDirExists ? 'update' : 'create') : 'keep',
      reason: definition.manifestId
        ? skillsDirExists
          ? `el conjunto ya está presente: el instalador existente completa lo ausente y NO sobrescribe lo editado (modo prompt en no-TTY)`
          : `instalación delegada al instalador existente: open-sdd ${agent.flag} --lang ${language.lang}`
        : `sin skills para ${definition.label}: esta versión no trae su árbol de skills (brecha declarada G-35); sus plantillas de comando SÍ se instalan.`,
    });
  }

  // ── Plantillas de comando: el camino POR DEFECTO ───────────────────────────────────────────
  // Sin MCP, sin red y sin nada que una política de seguridad pueda bloquear: son archivos de
  // prompt en el directorio que el anfitrión ya lee. El anfitrión se mapea desde el agente detectado
  // y, si su convención no está verificada, se reporta `keep` con el motivo en vez de escribir a
  // ciegas (la misma regla que la matriz MCP).
  const commandHostId = hostForAgent(agent.id) ?? null;
  const commandHost = commandHostId ? commandHostById(commandHostId) : undefined;
  let commandTemplateArtifacts: CommandTemplateArtifact[] = [];
  let commandSummary: InitPlan['commandTemplates'] = {
    host: commandHostId,
    dir: commandHost?.dir ?? null,
    action: 'keep',
    verified: false,
    reason: `el anfitrión ${agent.id} no está en la matriz de plantillas de comando: no se escribe nada.`,
    artifacts: [],
  };

  if (commandHostId && commandHost) {
    try {
      commandTemplateArtifacts = await planCommandTemplates({ cwd: target, hosts: [commandHostId] });
      const summary = summarizeCommandTemplates(commandTemplateArtifacts, commandHostId);
      commandSummary = { host: commandHostId, dir: commandHost.dir, ...summary, artifacts: commandTemplateArtifacts };
      artifacts.push({
        kind: 'command-templates',
        path: summary.path,
        action: summary.action,
        reason:
          `${summary.reason} Fuente: plantillas de comando propias (${COMMAND_TEMPLATE_IDS.length}), instaladas sin MCP ni red. ` +
          `Cada workflow queda como \`${commandHost.invocation('constitution')}\` en el chat del anfitrión.`,
      });
    } catch (error) {
      commandSummary.reason = `no se pudieron planificar las plantillas de comando (${(error as Error).message}); no se escribe nada.`;
      artifacts.push({ kind: 'command-templates', path: commandHost.dir ?? '(sin directorio)', action: 'keep', reason: commandSummary.reason });
    }
  } else {
    artifacts.push({ kind: 'command-templates', path: '(anfitrión sin plantillas)', action: 'keep', reason: commandSummary.reason });
  }

  // ── MCP: opt-in explícito (`--mcp`) ────────────────────────────────────────────────────────
  let mcpSummary: InitPlan['mcp'] = { requested: input.mcp === true, path: null, action: null, verified: false, reason: null };
  if (input.mcp) {
    const integration = commandHostId ? integrationById(commandHostId) : undefined;
    if (!integration) {
      mcpSummary = {
        requested: true,
        path: null,
        action: 'keep',
        verified: false,
        reason: `no hay una entrada MCP para el anfitrión ${agent.id}: no se toca ninguna configuración.`,
      };
      artifacts.push({ kind: 'mcp-config', path: '(sin ruta documentada)', action: 'keep', reason: mcpSummary.reason! });
    } else {
      const merge = await mergeMcpConfig(integration, cliPath ?? '<ruta-al-cli-open-sdd>', target);
      mcpSummary = {
        requested: true,
        path: merge.path,
        action: merge.action,
        verified: merge.verified,
        reason: merge.reason,
      };
      artifacts.push({
        kind: 'mcp-config',
        path: merge.path ?? '(sin ruta documentada)',
        action: merge.action,
        reason: merge.reason,
      });
    }
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
    commandHostId
      ? `2. Plantillas de comando (CAMINO POR DEFECTO, sin MCP ni red): ${COMMAND_TEMPLATE_IDS.length} comandos en ${commandSummary.dir} — invócalos como \`${commandHost?.invocation('constitution') ?? '/sdd-constitution'}\`.`
      : '2. Plantillas de comando: el anfitrión no está en la matriz, así que no hay directorio verificado donde escribirlas.',
    input.mcp
      ? `3. MCP (opt-in, ya solicitado): ${mcpSummary.path ?? '(sin ruta documentada)'} — ${mcpSummary.verified ? 'forma verificada' : 'forma NO verificada, no se escribe'}. El anfitrión podrá llamar al motor directamente.`
      : '3. MCP (opt-in, NO solicitado): añade `--mcp` si tu anfitrión lo admite y tu política de seguridad no lo bloquea; el camino por defecto no lo necesita.',
    `4. Constitución (obligatoria en LOS TRES niveles: es el suelo, no un extra): \`${nextCommands[0]}\``,
    `5. Estado del repositorio en una pantalla: \`${nextCommands[1]}\``,
    `6. Gate constitucional de la spec: \`${nextCommands[2]}\``,
    '7. Diagnóstico de la instalación (hook, CLI, entorno): `open-sdd doctor`',
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
    input.mcp
      ? 'Dos caminos: plantillas de comando (por defecto) + MCP solicitado (opt-in).'
      : 'Camino por defecto: solo plantillas de comando (sin MCP, sin red). MCP es opt-in con --mcp.',
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
    commandTemplates: commandSummary,
    mcp: mcpSummary,
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

/**
 * El instalador existente, invocado por comportamiento. Es la ÚNICA forma en que este archivo
 * instala un conjunto de skills: no reimplementa la copia de plantillas. Se comparte entre
 * `init --skills` e `integrate --write`, para que ambos deleguen exactamente igual.
 *
 * `--overwrite=prompt` con stdio no interactivo es el único modo que hace lo correcto: escribe lo
 * que falta y conserva lo existente. `--overwrite=skip` NO sirve: su política de categoría también
 * salta los ficheros que NO existen, así que en un proyecto recién creado instalaría 0 de 62
 * ficheros y saldría con 0 (bug reportado, fuera del alcance de este archivo).
 */
export const installAgentSkillSet = async (
  root: string,
  agent: AgentType,
  lang: 'es' | 'en',
): Promise<{ action: 'create' | 'keep'; failure?: string; detail?: string }> => {
  const cliPath = await resolveCliExecutable(root);
  if (cliPath === null) {
    return {
      action: 'keep',
      failure:
        `no se encontró el instalador (CLI) alcanzable: la instalación del agente NO se ha ejecutado. Instálalo con \`${INSTALL_COMMAND} --version\` o compílalo con \`npm --prefix tools/open-sdd run build\`.`,
    };
  }
  const definition = getAgentDefinition(agent);
  const alias = (definition.aliasFlags[0] ?? `--${agent}`).replace(/^--/, '');
  const result = spawnSync(
    process.execPath,
    [cliPath, `--${alias}`, '--lang', lang, '--overwrite=prompt'],
    { cwd: root, encoding: 'utf8', timeout: 300_000 },
  );
  if (result.status !== 0) {
    return {
      action: 'keep',
      failure: `el instalador existente falló (código ${result.status ?? 'desconocido'}): ${(result.stderr ?? '').trim().split('\n').slice(-1)[0] ?? 'sin detalle'}`,
    };
  }
  return {
    action: 'create',
    detail: `instalado con \`open-sdd --${alias} --lang ${lang} --overwrite=prompt\` (no interactivo: crea lo ausente, conserva lo existente)`,
  };
};

const installAgentSkills = async (
  plan: InitPlan,
): Promise<{ action: 'create' | 'keep'; failure?: string; detail?: string }> => {
  if (!plan.skills) return { action: 'keep' };
  // Un anfitrión sin árbol de skills en el registro no tiene manifiesto que ejecutar: delegar
  // produciría un ENOENT y un «revisa el mensaje anterior» sin decir qué falta. Se declara como lo
  // que es — una brecha, no un fallo del usuario — y las plantillas de comando sí se instalan.
  const definition = getAgentDefinition(plan.agent.id);
  if (!definition.manifestId) {
    return {
      action: 'keep',
      detail: `sin skills para ${definition.label}: esta versión no trae su árbol de skills (brecha declarada G-35). Sus 22 plantillas de comando SÍ se instalan; la superficie de skills es el siguiente incremento.`,
    };
  }
  return installAgentSkillSet(plan.root, plan.agent.id, plan.language.lang);
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

  // Plantillas de comando: el camino por defecto. Se delega en el instalador de `commandTemplates`,
  // que nunca sobrescribe un archivo editado a mano (la firma sha256 lo detecta) y nunca escribe en
  // un anfitrión cuya convención no esté verificada.
  const templatesArtifact = plan.artifacts.find((item) => item.kind === 'command-templates');
  const templatesHost = plan.commandTemplates.host;
  if (templatesArtifact && templatesHost && plan.commandTemplates.verified) {
    const result = await installCommandTemplates({ cwd: plan.root, hosts: [templatesHost], write: true });
    outcome.written.push(...result.written);
    outcome.kept.push(...result.kept);
    outcome.failures.push(...result.failures);
    outcome.details.push(...result.details);
  } else if (templatesArtifact) {
    outcome.kept.push(templatesArtifact.path);
    if (!plan.commandTemplates.verified) outcome.details.push(templatesArtifact.reason);
  }

  // MCP: solo si se solicitó con `--mcp`. Se reutiliza el merge idempotente de `integrate`.
  if (plan.mcp.requested) {
    const mcpArtifact = plan.artifacts.find((item) => item.kind === 'mcp-config');
    const host = plan.commandTemplates.host ? integrationById(plan.commandTemplates.host) : undefined;
    if (mcpArtifact && host) {
      const merge = await mergeMcpConfig(host, (await resolveCliExecutable(plan.root)) ?? '<ruta-al-cli-open-sdd>', plan.root);
      if (merge.resolvedPath === null || merge.action === 'keep') {
        outcome.kept.push(mcpArtifact.path);
        outcome.details.push(merge.reason);
      } else {
        try {
          await mkdir(path.dirname(merge.resolvedPath), { recursive: true });
          await writeFile(merge.resolvedPath, merge.content, 'utf8');
          outcome.written.push(mcpArtifact.path);
          outcome.details.push(merge.reason);
        } catch (error) {
          outcome.failures.push(`no se pudo escribir ${merge.resolvedPath} (${(error as Error).message})`);
        }
      }
    } else if (mcpArtifact) {
      outcome.kept.push(mcpArtifact.path);
    }
  }

  return outcome;
};

// ---------------------------------------------------------------------------------------------
// Superficie CLI
// ---------------------------------------------------------------------------------------------

const PROJECT_FLAGS = new Set(['--agent', '--level', '--skills', '--write', '--json', '--yes', '--sdd-dir', '--mcp']);

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
  const mcp = args.includes('--mcp');
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
      mcp,
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

// ---------------------------------------------------------------------------------------------
// `open-sdd integrate` — la superficie de adopción, anfitrión por anfitrión
// ---------------------------------------------------------------------------------------------

/**
 * De qué anfitrión instala las skills `integrate --write`. Es la variante NO desaconsejada del
 * registro; Zed y Cline no tienen instalador de skills (modo prompt-file) y por eso no aparecen.
 */
const HOST_SKILL_AGENT: Record<string, AgentType | undefined> = {
  'claude-code': 'claude-code-skills',
  cursor: 'cursor-skills',
  copilot: 'github-copilot-skills',
  codex: 'codex-skills',
  'gemini-cli': 'gemini-cli-skills',
  windsurf: 'windsurf-skills',
  opencode: 'opencode-skills',
  antigravity: 'antigravity-skills',
  // Estos anfitriones leen `.agents/skills/` —la convención transversal que la investigación
  // confirmó en cada uno de ellos— así que los sirve UN árbol neutral en vez de una copia por
  // anfitrión. Cada fila de `integrations.ts` nombra la URL donde se leyó esa ruta.
  'factory-droid': 'agents-skills',
  'roo-code': 'agents-skills',
  'kilo-code': 'agents-skills',
  junie: 'agents-skills',
  mimocode: 'agents-skills',
  crush: 'agents-skills',
  amp: 'agents-skills',
  'kimi-code': 'agents-skills',
  warp: 'agents-skills',
  devin: 'agents-skills',
  // Estos cuatro NO leen la ruta transversal (Trae la tiene apagada por defecto; Qoder, ZCode y
  // CodeBuddy usan la suya), asi que tienen manifiesto propio — pero siguen apuntando al MISMO arbol
  // neutral: un manifiesto por anfitrion, nunca una copia de 21 ficheros por anfitrion.
  trae: 'trae-skills',
  qoder: 'qoder-skills',
  zcode: 'zcode-skills',
  codebuddy: 'codebuddy-skills',
};

export interface IntegrateArtifact {
  kind: 'mcp-config' | 'agent-skills' | 'stop-hook';
  path: string;
  /**
   * `refused` es un veredicto de primera clase: un anfitrión sin mecanismo Stop verificado NO recibe
   * un hook inventado, y esa negativa viaja en el informe en vez de desaparecer.
   */
  action: 'create' | 'update' | 'keep' | 'refused';
  reason: string;
  verified: boolean;
}

export interface IntegratePlan {
  cwd: string;
  host: {
    id: string;
    label: string;
    source: 'declarado' | 'detectado' | 'defecto';
    evidence: string[];
    alternatives: string[];
  };
  skills: HostIntegration['skills'];
  invocation: string;
  mcp: {
    /** La ruta tal y como la declara la matriz (puede ser relativa o llevar `~`). */
    path: string | null;
    /** La ruta absoluta que `--write` tocaría, o null cuando no se escribe. */
    resolvedPath: string | null;
    format: SnippetFormat;
    verified: boolean;
    snippet: string;
  };
  cliPath: string;
  language: 'es' | 'en';
  write: boolean;
  artifacts: IntegrateArtifact[];
  steps: string[];
  nextCommands: string[];
  detail: string;
  complete: boolean;
}

/** `~/x`, `%USERPROFILE%\x` y `%APPDATA%\x` son rutas reales que hay que expandir antes de escribir. */
const expandConfigPath = (declared: string, cwd: string): string => {
  if (declared.startsWith('~/') || declared === '~') {
    return path.join(homedir(), declared.slice(2));
  }
  const expandEnv = (prefix: string, base: string | undefined): string | null =>
    base === undefined ? null : path.join(base, declared.slice(prefix.length).replace(/^[\\/]+/, ''));
  if (declared.startsWith('%USERPROFILE%')) {
    return expandEnv('%USERPROFILE%', homedir()) ?? declared;
  }
  if (declared.startsWith('%APPDATA%')) {
    return expandEnv('%APPDATA%', process.env.APPDATA) ?? declared;
  }
  return path.isAbsolute(declared) ? declared : path.resolve(cwd, declared);
};

/** Fusión de un nivel: las claves ajenas del objeto sobreviven; solo se toca la nuestra. */
const mergeTopLevel = (
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    const prior = merged[key];
    const bothPlainObjects =
      prior !== null &&
      typeof prior === 'object' &&
      !Array.isArray(prior) &&
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value);
    merged[key] = bothPlainObjects
      ? { ...(prior as Record<string, unknown>), ...(value as Record<string, unknown>) }
      : value;
  }
  return merged;
};

const CODEX_TABLE = /\[mcp_servers\s*\.\s*"?open-sdd"?\s*\]/;

export interface McpMerge {
  action: 'create' | 'update' | 'keep';
  path: string | null;
  resolvedPath: string | null;
  content: string;
  reason: string;
  verified: boolean;
}

/**
 * Calcula el estado del artefacto MCP sin escribir nada. `applyIntegrate` vuelve a llamarlo para
 * obtener el contenido exacto, así que el plan y la escritura no pueden divergir.
 *
 * Reglas duras: un snippet NO verificado no se escribe jamás; un archivo que no parsea no se toca;
 * una clave ajena no se borra nunca.
 */
export const mergeMcpConfig = async (
  host: HostIntegration,
  cliPath: string,
  cwd: string,
): Promise<McpMerge> => {
  const registration = mcpRegistration(host.id, { cliPath });
  const base = { path: registration.path, verified: registration.verified };

  if (registration.path === null) {
    return {
      ...base,
      action: 'keep',
      resolvedPath: null,
      content: registration.content,
      reason:
        'el anfitrión no declara una ruta de configuración MCP conocida: open-sdd no inventa un archivo. Configúralo desde la interfaz del anfitrión; el snippet se imprime como NO VERIFICADO.',
    };
  }
  if (!registration.verified) {
    return {
      ...base,
      action: 'keep',
      resolvedPath: null,
      content: registration.content,
      reason:
        'el snippet de este anfitrión está NO VERIFICADO: open-sdd no escribe a ciegas una configuración que no puede garantizar. Cópialo y compruébalo contra la documentación del anfitrión.',
    };
  }

  const resolvedPath = expandConfigPath(registration.path, cwd);
  const existing = await readIfExists(resolvedPath);

  if (existing === null) {
    return {
      ...base,
      action: 'create',
      resolvedPath,
      content: registration.content,
      reason: `no existe: se crea con el snippet verificado (${registration.format.toUpperCase()}).`,
    };
  }

  if (registration.format === 'json') {
    try {
      const current = JSON.parse(existing) as Record<string, unknown>;
      const incoming = JSON.parse(registration.content) as Record<string, unknown>;
      const merged = mergeTopLevel(current, incoming);
      const serialized = `${JSON.stringify(merged, null, 2)}\n`;
      if (serialized === `${JSON.stringify(current, null, 2)}\n`) {
        return {
          ...base,
          action: 'keep',
          resolvedPath,
          content: serialized,
          reason: 'el servidor open-sdd ya está registrado con esta misma configuración: no se toca.',
        };
      }
      return {
        ...base,
        action: 'update',
        resolvedPath,
        content: serialized,
        reason:
          'se añade o actualiza SOLO la entrada del servidor open-sdd dentro de su objeto: el resto de claves del archivo se conserva.',
      };
    } catch (error) {
      return {
        ...base,
        action: 'keep',
        resolvedPath,
        content: registration.content,
        reason: `el archivo existe pero no parsea como JSON (${(error as Error).message}): NO se toca, porque reescribirlo borraría lo que no entendemos. Pega el snippet a mano.`,
      };
    }
  }

  if (registration.format === 'yaml') {
    // Continue's convention is ONE standalone YAML block per server inside `.continue/mcpServers/`, so
    // the file is OURS and there is nothing of the user's inside it to preserve. That is the only case
    // where refusing costs nothing: identical -> keep; anything else -> refuse, because a file with our
    // name and someone else's content is a file we must not overwrite. No YAML parser is involved, so
    // no YAML we did not write can ever be rewritten by us.
    if (existing === registration.content) {
      return {
        ...base,
        action: 'keep',
        resolvedPath,
        content: existing,
        reason: 'el bloque YAML del servidor open-sdd ya está registrado byte a byte: no se toca.',
      };
    }
    return {
      ...base,
      action: 'keep',
      resolvedPath,
      content: registration.content,
      reason:
        'el archivo existe con contenido distinto al nuestro: se CONSERVA y no se reescribe (puede ser un archivo de una persona con el mismo nombre). Compara el bloque impreso y mézclalo a mano.',
    };
  }

  if (CODEX_TABLE.test(existing)) {
    return {
      ...base,
      action: 'keep',
      resolvedPath,
      content: existing,
      reason: 'la tabla [mcp_servers.open-sdd] ya existe: no se toca.',
    };
  }
  return {
    ...base,
    action: 'update',
    resolvedPath,
    content: `${existing.replace(/\s*$/, '')}\n\n${registration.content}`,
    reason: 'se AÑADE la tabla [mcp_servers.open-sdd] al final del archivo: ninguna otra clave se modifica.',
  };
};

export interface PlanIntegrateInput {
  cwd: string;
  host?: string;
  write?: boolean;
  lang?: string;
}

export const planIntegrate = async (input: PlanIntegrateInput): Promise<IntegratePlan> => {
  const { cwd } = input;

  let host: HostIntegration;
  let source: 'declarado' | 'detectado' | 'defecto';
  let evidence: string[];
  let alternatives: string[];

  if (input.host !== undefined && input.host.trim().length > 0) {
    const declared = integrationById(input.host.trim());
    if (!declared) {
      throw new Error(
        `Anfitrión desconocido: "${input.host}". Admitidos: ${HOST_INTEGRATIONS.map((item) => item.id).join(', ')}. Consulta la matriz con \`open-sdd integrate --list\`.`,
      );
    }
    host = declared;
    source = 'declarado';
    evidence = [`host declarado: ${input.host}`];
    alternatives = [];
  } else {
    const detected = await detectIntegration(cwd);
    if (detected) {
      host = integrationById(detected.id)!;
      source = 'detectado';
      evidence = detected.evidence;
      alternatives = detected.alternatives;
    } else {
      // Same fallback as `init`: the default is proposed AND declared as a default, never as a
      // detection. `--write` still requires the user to have asked for it.
      host = integrationById('claude-code')!;
      source = 'defecto';
      evidence = [
        `no se observó ningún marcador de anfitrión (${HOST_INTEGRATIONS.flatMap((item) => item.detect).join(', ')})`,
      ];
      alternatives = [];
    }
  }

  const language: 'es' | 'en' =
    input.lang === 'es' || input.lang === 'en'
      ? input.lang
      : (await detectLanguage(cwd, await resolveSddDir(cwd))).lang;

  const resolvedCli = await resolveCliExecutable(cwd);
  const cliPath =
    resolvedCli ?? (process.argv[1]?.endsWith('cli.js') === true ? process.argv[1] : '<ruta-al-cli-open-sdd>');

  const merge = await mergeMcpConfig(host, cliPath, cwd);
  const registration = mcpRegistration(host.id, { cliPath });

  const artifacts: IntegrateArtifact[] = [
    {
      kind: 'mcp-config',
      path: merge.path ?? '(sin ruta documentada)',
      action: merge.action,
      reason: merge.reason,
      verified: merge.verified,
    },
  ];

  const agent = HOST_SKILL_AGENT[host.id];
  if (agent) {
    const definition = getAgentDefinition(agent);
    const skillsDir = definition.layout.commandsDir;
    const present = await exists(path.join(cwd, skillsDir));
    const alias = definition.aliasFlags[0] ?? `--${agent}`;
    // Cuando el instalador es el árbol transversal, el destino NO es el layout propio del anfitrión, y
    // el informe tiene que decir dónde escribe y por qué: si no, un plan que anuncia `.roo/skills/` y
    // escribe `.agents/skills/` es exactamente la clase de desmentido que este proyecto persigue.
    const shared = agent === 'agents-skills' ? ` en \`${skillsDir}\`, la ruta transversal que ${host.label} lee además de \`${host.skills.layout}\`` : '';
    artifacts.push({
      kind: 'agent-skills',
      path: skillsDir,
      action: present ? 'update' : 'create',
      reason: present
        ? `el conjunto ya está presente${shared}: el instalador existente completa lo ausente y NO sobrescribe lo editado (\`open-sdd ${alias} --lang ${language} --overwrite=prompt\`)`
        : `instalación delegada al instalador existente${shared}: \`open-sdd ${alias} --lang ${language} --overwrite=prompt\``,
      verified: true,
    });
  } else {
    // El layout puede estar VERIFICADO (documentado por el fabricante) sin que esta versión traiga su
    // instalador: son dos cosas distintas y decirlas igual sería mentir en una de las dos direcciones.
    // Si el layout está documentado se declara la brecha de instalación; si no, se declara que no hay
    // layout que escribir.
    const layoutDocumented = !/^\s*(IFLOW\.md|AGENTS\.md|\(|$)/.test(host.skills.layout);
    // Un fork HEREDA el layout de su padre; no es lo mismo que haberlo verificado en su propia
    // documentacion, y el mensaje no puede confundir las dos cosas.
    const origin = host.forkOf !== undefined ? `HEREDADO de ${host.forkOf}` : 'VERIFICADO';
    artifacts.push({
      kind: 'agent-skills',
      path: host.skills.layout,
      action: 'keep',
      reason: layoutDocumented
        ? `${host.label} tiene layout de skills ${origin} (${host.skills.layout}) pero esta versión no trae su instalador: brecha declarada G-35. No se escribe a medias.`
        : `${host.label} no documenta un layout de Agent Skills (modo ${host.skills.mode}): open-sdd no inventa uno.`,
      verified: false,
    });
  }

  // ── Stop hook: el veredicto del gate de commit, dentro del bucle del agente ─────────────────
  // Misma disciplina que el registro MCP: se calcula SIN escribir (`write: false`) para que el plan
  // y la escritura no puedan divergir, y un anfitrión sin mecanismo Stop verificado se reporta
  // `refused` con su motivo —nunca se emite un hook inventado—. El propio `installStopHook` decide.
  const stopHook = await installStopHook({ cwd, host: host.id, cliPath, write: false });
  artifacts.push({
    kind: 'stop-hook',
    path: stopHook.path.length > 0 ? path.relative(cwd, stopHook.path) || stopHook.path : '(sin mecanismo Stop verificado)',
    action: stopHook.action,
    reason: stopHook.reason,
    verified: stopHook.action !== 'refused',
  });

  const steps: string[] = [
    `1. En el chat de ${host.label}, escribe exactamente: ${host.invocation}`,
    `2. Comprueba la instalación: \`open-sdd doctor\``,
    `3. Registro MCP: ${merge.path ?? '(sin ruta documentada)'} — ${merge.verified ? 'forma verificada' : 'forma NO VERIFICADA'}`,
    stopHook.action === 'refused'
      ? `4. Stop hook: NO se instala para ${host.id} — ${stopHook.reason}`
      : `4. Stop hook: ${stopHook.action} en ${stopHook.path} — el agente no podrá declarar «terminado» mientras el gate de commit falle.`,
  ];
  if (source === 'defecto') {
    steps.push(
      `ATENCIÓN: no se observó ningún anfitrión; se propone ${host.id} por defecto (igual que \`init\`). Si usas otro, pásalo explícito: \`open-sdd integrate <host>\`.`,
    );
  }

  const created = artifacts.filter((artifact) => artifact.action === 'create').length;
  const updated = artifacts.filter((artifact) => artifact.action === 'update').length;
  const kept = artifacts.filter((artifact) => artifact.action === 'keep').length;
  const detail = [
    `Plan de integración para ${host.label} (${host.id}, ${source}) en ${cwd}: ${created} artefacto(s) por crear, ${updated} por actualizar, ${kept} conservado(s).`,
    source === 'defecto'
      ? 'No se observó ningún anfitrión: el anfitrión es un valor por defecto, no una detección.'
      : '',
    merge.verified
      ? 'El snippet MCP está verificado para este anfitrión.'
      : 'El snippet MCP NO está verificado: se imprime como NO VERIFICADO y --write no lo escribe.',
    input.write === true ? 'Se escribirá lo indicado.' : 'Sin --write no se escribe nada: este es el plan.',
  ]
    .filter((part) => part.length > 0)
    .join(' ');

  return {
    cwd,
    host: { id: host.id, label: host.label, source, evidence, alternatives },
    skills: host.skills,
    invocation: host.invocation,
    mcp: {
      path: merge.path,
      resolvedPath: merge.resolvedPath,
      format: registration.format,
      verified: merge.verified,
      snippet: merge.content,
    },
    cliPath,
    language,
    write: input.write === true,
    artifacts,
    steps,
    nextCommands: [
      `open-sdd integrate ${host.id} --write`,
      'open-sdd doctor',
      host.invocation,
    ],
    detail,
    complete: merge.verified && source !== 'defecto',
  };
};

export const applyIntegrate = async (plan: IntegratePlan, cwd: string): Promise<InitOutcome> => {
  const outcome: InitOutcome = { written: [], kept: [], failures: [], details: [] };
  const host = integrationById(plan.host.id);
  if (!host) {
    outcome.failures.push(`anfitrión desconocido al aplicar: ${plan.host.id}`);
    return outcome;
  }

  const mcpArtifact = plan.artifacts.find((artifact) => artifact.kind === 'mcp-config');
  if (mcpArtifact && (mcpArtifact.action === 'create' || mcpArtifact.action === 'update')) {
    const merge = await mergeMcpConfig(host, plan.cliPath, cwd);
    if (merge.resolvedPath === null || merge.action === 'keep') {
      outcome.kept.push(mcpArtifact.path);
      outcome.details.push(merge.reason);
    } else {
      try {
        await mkdir(path.dirname(merge.resolvedPath), { recursive: true });
        await writeFile(merge.resolvedPath, merge.content, 'utf8');
        outcome.written.push(mcpArtifact.path);
        outcome.details.push(merge.reason);
      } catch (error) {
        outcome.failures.push(`no se pudo escribir ${merge.resolvedPath} (${(error as Error).message})`);
      }
    }
  } else if (mcpArtifact) {
    outcome.kept.push(mcpArtifact.path);
    outcome.details.push(mcpArtifact.reason);
  }

  const agent = HOST_SKILL_AGENT[plan.host.id];
  const skillsArtifact = plan.artifacts.find((artifact) => artifact.kind === 'agent-skills');
  if (agent && skillsArtifact) {
    const skills = await installAgentSkillSet(cwd, agent, plan.language);
    if (skills.failure) outcome.failures.push(skills.failure);
    else if (skills.action === 'create') outcome.written.push(skillsArtifact.path);
    else outcome.kept.push(skillsArtifact.path);
    if (skills.detail) outcome.details.push(skills.detail);
  } else if (skillsArtifact) {
    outcome.kept.push(skillsArtifact.path);
    outcome.details.push(skillsArtifact.reason);
  }

  // ── Stop hook: se instala (o se conserva) con la misma disciplina que el MCP ────────────────
  // `refused` NO es un fallo del comando: es la negativa deliberada a emitir un mecanismo no
  // verificado para ese anfitrión, y su motivo entra en el informe como detalle. Un anfitrión
  // verificado cuya configuración no se pudo leer SÍ es un fallo, porque entonces el hook no quedó
  // instalado y el usuario tiene que enterarse.
  const stopArtifact = plan.artifacts.find((artifact) => artifact.kind === 'stop-hook');
  if (stopArtifact) {
    const stop = await installStopHook({ cwd, host: plan.host.id, cliPath: plan.cliPath, write: true });
    if (stop.action === 'refused') {
      outcome.kept.push(stopArtifact.path);
      outcome.details.push(`stop hook NO instalado: ${stop.reason}`);
      // Un anfitrión SIN mecanismo verificado se rechaza a propósito (detalle, no fallo). Un
      // anfitrión verificado que se rechaza es que su configuración no se pudo leer o no tiene la
      // forma documentada: entonces el hook NO quedó instalado y eso sí es un fallo que reportar.
      if (stopHookFor(plan.host.id)) {
        outcome.failures.push(`no se pudo instalar el Stop hook de ${plan.host.id}: ${stop.reason}`);
      }
    } else if (stop.action === 'keep') {
      outcome.kept.push(stopArtifact.path);
      outcome.details.push(stop.reason);
    } else {
      outcome.written.push(stopArtifact.path);
      outcome.details.push(stop.reason);
    }
  }

  return outcome;
};

const printIntegrationMatrix = (io: CliIO): number => {
  io.log('');
  io.log(formatHeading(colors.cyan('Matriz de integración open-sdd — un anfitrión por fila')));
  io.log('');
  io.log(
    `  ${'host'.padEnd(14)} ${'skills layout'.padEnd(34)} ${'invocación'.padEnd(30)} ${'MCP config'.padEnd(46)} verificado`,
  );
  for (const host of HOST_INTEGRATIONS) {
    const registration = mcpRegistration(host.id, { cliPath: '<cli>' });
    const configPath = registration.path ?? '(sin ruta documentada)';
    io.log(
      `  ${host.id.padEnd(14)} ${host.skills.layout.padEnd(34)} ${host.invocation.padEnd(30)} ${configPath.padEnd(46)} ${
        host.mcp.verified ? 'verificado' : 'NO VERIFICADA'
      }`,
    );
  }
  io.log('');
  io.log(
    colors.dim(
      '  «NO VERIFICADA» significa que este proyecto no conoce con certeza la forma o la ruta del archivo del anfitrión: se imprime para que la pegues y la compruebes, y `--write` no la escribe. Las rutas son las de la matriz; el archivo que `--write` toca puede ser el de proyecto o el de usuario según el anfitrión.',
    ),
  );
  io.log('');
  return 0;
};

export const handleIntegrateCommand = async (
  args: string[],
  io: CliIO,
  cwd: string = process.cwd(),
): Promise<number> => {
  if (args.includes('--list')) return printIntegrationMatrix(io);

  const json = args.includes('--json');
  const write = args.includes('--write') && !args.includes('--dry-run');
  const hostArg = args.find((arg) => !arg.startsWith('-'));
  const lang = flagValue(args, 'lang');

  let plan: IntegratePlan;
  try {
    plan = await planIntegrate({
      cwd,
      ...(hostArg !== undefined ? { host: hostArg } : {}),
      ...(lang !== undefined ? { lang } : {}),
      write,
    });
  } catch (error) {
    io.error(colors.red(`Error: ${(error as Error).message}`));
    return 1;
  }

  let outcome: InitOutcome = { written: [], kept: [], failures: [], details: [] };
  if (write) outcome = await applyIntegrate(plan, cwd);

  if (json) {
    io.log(JSON.stringify({ ...plan, outcome }, null, 2));
    return outcome.failures.length > 0 ? 1 : 0;
  }

  io.log('');
  io.log(formatHeading(colors.cyan(`Integración open-sdd — ${plan.host.label} (${plan.host.id})`)));
  io.log('');
  io.log(`  anfitrión: ${colors.bold(plan.host.id)} ${colors.dim(`[${plan.host.source}]`)}`);
  for (const item of plan.host.evidence) io.log(colors.dim(`      por qué: ${item}`));
  if (plan.host.alternatives.length > 0) {
    io.log(`      alternativas detectadas: ${plan.host.alternatives.join(', ')} — elige con \`open-sdd integrate <host>\``);
  }
  io.log('');
  io.log(`  skills: ${colors.bold(plan.skills.layout)} ${colors.dim(`(modo ${plan.skills.mode})`)}`);
  io.log(
    `  invocación en el chat de ${plan.host.label}: ${colors.bold(colors.cyan(plan.invocation))}`,
  );
  io.log('');
  io.log(`  ${colors.bold('MCP')} ${plan.mcp.verified ? colors.green('verificado') : colors.yellow('NO VERIFICADO')}`);
  io.log(`    ruta declarada: ${plan.mcp.path ?? '(sin ruta documentada)'}`);
  if (plan.mcp.resolvedPath) io.log(`    ruta a escribir: ${plan.mcp.resolvedPath}`);
  io.log(`    formato: ${plan.mcp.format}`);
  io.log('');
  io.log(`  ${colors.bold('Snippet')}`);
  for (const line of plan.mcp.snippet.split('\n')) io.log(`    ${line}`);

  io.log('');
  io.log(`  ${colors.bold('Artefactos')}`);
  for (const artifact of plan.artifacts) {
    const mark =
      artifact.action === 'create'
        ? colors.green(artifact.action)
        : artifact.action === 'update'
          ? colors.yellow(artifact.action)
          : colors.dim(artifact.action);
    io.log(`    ${mark.padEnd(18)} ${artifact.path} ${artifact.verified ? '' : colors.yellow('(no verificado)')}`);
    io.log(`        ${colors.dim(artifact.reason)}`);
  }

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

  if (!plan.mcp.verified) {
    io.log('');
    io.log(
      colors.yellow(
        '  ! El snippet MCP de este anfitrión está NO VERIFICADO: no se escribe automáticamente. Cópialo, compruébalo contra la documentación del anfitrión y pégalo tú.',
      ),
    );
  }

  io.log('');
  io.log(colors.dim(`  ${plan.detail}`));
  io.log('');
  return outcome.failures.length > 0 ? 1 : 0;
};

// ---------------------------------------------------------------------------------------------
// `open-sdd import` — absorber a los incumbentes (Kiro, spec-kit, cc-sdd)
// ---------------------------------------------------------------------------------------------

export const handleImportCommand = async (
  args: string[],
  io: CliIO,
  cwd: string = process.cwd(),
): Promise<number> => {
  const json = args.includes('--json');
  const write = args.includes('--write') && !args.includes('--dry-run');
  const sourceFlag = flagValue(args, 'source');
  const sourceArg = (sourceFlag && sourceFlag.length > 0 ? sourceFlag : args.find((arg) => !arg.startsWith('-'))) || undefined;

  if (sourceArg !== undefined && !(IMPORT_SOURCES as readonly string[]).includes(sourceArg)) {
    io.error(
      colors.red(`Error: fuente desconocida "${sourceArg}". Admitidas: ${IMPORT_SOURCES.join(', ')}.`),
    );
    return 1;
  }

  let plans: ImportPlan[];
  try {
    plans = await planImport(cwd, sourceArg as ImportSource | undefined);
  } catch (error) {
    io.error(colors.red(`Error: ${(error as Error).message}`));
    return 1;
  }

  const outcomes = write
    ? await Promise.all(plans.map((plan) => applyImport(cwd, plan, { write: true })))
    : [];

  if (json) {
    io.log(JSON.stringify({ cwd, write, plans, outcomes }, null, 2));
    return 0;
  }

  io.log('');
  io.log(formatHeading(colors.cyan(`Importación open-sdd — ${cwd}`)));
  io.log('');

  if (plans.length === 0) {
    io.log(
      colors.dim(
        '  No se observó ningún incumbente (Kiro, spec-kit, cc-sdd): ni `.kiro/`, ni `.specify/`, ni `specs/` con `spec.md`, ni un marcador de cc-sdd.',
      ),
    );
    io.log('');
    return 0;
  }

  plans.forEach((plan, index) => {
    const outcome = outcomes[index];
    io.log(`  ${colors.bold(plan.source)} ${plan.complete ? colors.green('(completo)') : colors.yellow('(incompleto: hay omisiones o advertencias)')}`);
    for (const item of plan.found) io.log(`      encontrado: ${item.kind} → ${item.path}`);
    if (plan.conversions.length > 0) {
      io.log(`      ${colors.bold('conversiones')}`);
      for (const conversion of plan.conversions) {
        const mark =
          conversion.action === 'skip'
            ? colors.dim('skip')
            : conversion.action === 'convert'
              ? colors.yellow('convert')
              : colors.green('copy');
        const arrow = conversion.action === 'skip' ? '' : ` → ${conversion.to}`;
        io.log(`        ${mark.padEnd(16)} ${conversion.from}${arrow}`);
        io.log(`            ${colors.dim(conversion.reason)}`);
      }
    }
    for (const warning of plan.warnings) io.log(`      ${colors.yellow('!')} ${warning}`);
    if (outcome) {
      for (const item of outcome.written) io.log(`      ${colors.green('✓')} escrito: ${item}`);
      for (const item of outcome.skipped) io.log(colors.dim(`      = omitido: ${item}`));
      io.log(colors.dim(`      · ${outcome.detail}`));
    }
    io.log(colors.dim(`      ${plan.detail}`));
    io.log('');
  });

  if (!write) {
    io.log(colors.dim('  Sin --write no se ha escrito nada: este es solo el plan. Añade --write para ejecutarlo.'));
    io.log('');
  }
  return 0;
};
