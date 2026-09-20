/**
 * `open-sdd tour` — el recorrido guiado de primera ejecución (REQ-MAT-009).
 *
 * Enseña HACIENDO: inspecciona el repositorio y, en cada paso, imprime el siguiente comando REAL,
 * una línea de por qué y la salida que ese comando produce de verdad. No es un tratado; es el
 * artefacto de curva de aprendizaje rápida.
 *
 * ── Las tres reglas que gobiernan este comando ─────────────────────────────────────────────────
 *
 *  1. SE DETIENE EN LA DECISIÓN HUMANA. Ratificar una constitución no se automatiza jamás: cuando la
 *     autoridad aún no está en vigor, el recorrido ejecuta el BORRADOR (que es una propuesta, no una
 *     autoridad), imprime cómo ratificarlo y PARA. Los pasos siguientes no se ejecutan ni se saltan
 *     en silencio: se imprimen con el prerrequisito que falta.
 *
 *  2. SOLO LEE SALVO `--write`. Por defecto ningún paso escribe: el borrador de constitución se
 *     ejecuta en modo plan (`--draft` sin `--write`), y el paso que crearía una delta exige un slug
 *     y una descripción que aporta una persona, así que nunca se inventa. Con `--write` el recorrido
 *     habilita el paso de escritura que sí puede ejecutar solo (el borrador); la ratificación sigue
 *     siendo humana y la delta sigue pidiendo sus datos.
 *
 *  3. UN PASO QUE NO PUEDE CORRER DICE QUÉ FALTA. Ejecuta los comandos a través de sus handlers
 *     reales (`brownfield`, `govern`, `status`) capturando su salida, de modo que lo que se enseña
 *     es la salida del producto, no una maqueta. Si un paso lanza, se declara; si le falta un
 *     prerrequisito, se nombra. Nunca se omite.
 *
 * ── Por qué este fichero también sirve `open-sdd context` ──────────────────────────────────────
 * El context pack y el recorrido comparten la misma capa i18n y el mismo renderizado de consola, y
 * el alcance de este cambio es crear UN fichero de comando: `tour` y `context` viven aquí, y la
 * delegación del handler MCP al `buildContextPack` de `src/core/contextPack.ts` queda declarada en
 * el header de ese módulo (no se toca `src/mcp/**`).
 *
 * La envoltura visible pasa por la capa i18n (`src/cli/i18n.ts`): `tour` y el render de `context`
 * son bilingües; el resto del CLI sigue en español, y esa frontera está declarada en el header de
 * i18n.
 */

import path from 'node:path';
import { stat } from 'node:fs/promises';
import { colors, formatHeading } from '../ui/colors.js';
import type { CliIO } from '../io.js';
import { listSpecs, resolveSddDir } from '../../core/specManager.js';
import { findRepoRoot, loadConstitution } from '../../core/status.js';
import { principlesInForce } from '../../core/constitution.js';
import { constitutionArtifactPaths } from '../../core/constitutionDraft.js';
import { buildContextPack, contextAbsences, type ContextPack } from '../../core/contextPack.js';
import { handleBrownfieldCommand } from './brownfield.js';
import { handleGovernCommand } from './paper.js';
import { handleStatusCommand } from './status.js';
import { openI18n, rejectionsReport, type Locale, type TranslationFallback, type Translator } from '../i18n.js';

const dim = (value: string): string => colors.dim(value);

/** Valores que consumen el token siguiente: el escaneo de posicionales debe saltárselos. */
const VALUE_FLAGS = new Set(['--lang', '--sdd-dir', '--kiro-dir']);

/** Posicionales de argv, ignorando flags y los valores de los flags con valor. */
const positionals = (argv: string[]): string[] => {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const name = token.split('=')[0];
      if (!token.includes('=') && VALUE_FLAGS.has(name)) i += 1;
      continue;
    }
    if (token.startsWith('-')) continue;
    out.push(token);
  }
  return out;
};

const flagValue = (argv: string[], flag: string): string | undefined => {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === flag) {
      const next = argv[i + 1];
      return next === undefined || next.startsWith('-') ? undefined : next;
    }
    if (argv[i].startsWith(`${flag}=`)) return argv[i].slice(flag.length + 1);
  }
  return undefined;
};

const isDirectory = async (target: string): Promise<boolean> => {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------------------------
// Captura de la salida real de un comando
// ---------------------------------------------------------------------------------------------

interface StepRun {
  code: number;
  lines: string[];
  error?: string;
}

/**
 * Ejecutar el handler REAL de un comando con un IO que captura lo que imprime. Así la salida que el
 * recorrido enseña es la del producto, no una descripción de la del producto. Nunca lanza: una
 * excepción se devuelve en `error` para que el paso la declare en vez de reventar el recorrido.
 */
const runCommand = async (fn: (io: CliIO) => Promise<number>): Promise<StepRun> => {
  const lines: string[] = [];
  const captured: CliIO = {
    log: (message: string) => lines.push(message),
    error: (message: string) => lines.push(message),
    exit: () => {
      // Un handler de estos devuelve su código; `exit` no debe terminar el proceso del recorrido.
    },
  };
  try {
    const code = await fn(captured);
    return { code, lines };
  } catch (error) {
    return {
      code: 1,
      lines,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

// ---------------------------------------------------------------------------------------------
// Modelo del recorrido
// ---------------------------------------------------------------------------------------------

export type TourStepId = 'recon' | 'constitution' | 'check' | 'status' | 'delta';

/** `ran` = se ejecutó; `satisfied` = el repositorio ya lo cumple; `blocked` = falta un prerrequisito;
 * `handover` = se entrega a una persona (nunca se automatiza). */
export type TourStepStatus = 'ran' | 'satisfied' | 'blocked' | 'handover';

export interface TourStepResult {
  id: TourStepId;
  title: string;
  /** Comando(s) reales que el usuario debe conocer en este paso. */
  commands: string[];
  why: string;
  status: TourStepStatus;
  /** true solo cuando el handler se ejecutó de verdad (aunque devolviera un código no cero). */
  executed: boolean;
  output: string[];
  /** Código de salida del comando, cuando se ejecutó. */
  code?: number;
  /** Qué falta cuando el paso no puede correr: se nombra, no se calla. */
  prerequisite?: string;
  /** Qué debe decidir la persona, cuando el paso es una entrega. */
  humanDecision?: string;
  /** Comando concreto de la entrega (el que la persona ejecuta a mano). */
  handoverCommand?: string;
}

export interface TourReport {
  target: string;
  /** true cuando el directorio objetivo existe y es legible. */
  targetExists: boolean;
  root: string;
  sddDir: string;
  readOnly: boolean;
  locale: Locale;
  /** Paso en el que la decisión humana detuvo el recorrido, si lo hubo. */
  haltedAt: TourStepId | null;
  steps: TourStepResult[];
  fallbacks: TranslationFallback[];
  fallbackReport: string;
  rejections: string;
}

const RATIFY_COMMAND = 'open-sdd govern constitution --ratify --by "<nombre>" --rationale "<motivo>" --write';

/**
 * Construir el recorrido. Función de orquestación sin E/S de consola: devuelve la estructura y el
 * comando la pinta. Cada paso ejecuta el handler real y captura su salida.
 */
export const planTour = async (input: {
  cwd: string;
  target?: string;
  write?: boolean;
  translator: Translator;
}): Promise<TourReport> => {
  const t = input.translator.t;
  const targetArg = input.target ?? '.';
  // El recorrido inspecciona el OBJETIVO, no el directorio desde el que se invoca: `tour <otro-repo>`
  // debe leer la constitución de `<otro-repo>`, no la del repo del llamante.
  const absTarget = path.resolve(input.cwd, targetArg);
  const targetExists = await isDirectory(absTarget);
  const root = await findRepoRoot(absTarget);
  const sddDir = await resolveSddDir(root);
  const specs = await listSpecs(root, sddDir);
  const feature = specs[0];
  const readOnly = input.write !== true;
  const steps: TourStepResult[] = [];
  let haltedAt: TourStepId | null = null;

  // ── 1. Reconocimiento ───────────────────────────────────────────────────────────────────────
  {
    const commands = [`open-sdd brownfield survey ${targetArg}`];
    const why = t('tour.recon.why');
    if (!targetExists) {
      steps.push({
        id: 'recon',
        title: t('tour.recon.title'),
        commands,
        why,
        status: 'blocked',
        executed: false,
        output: [],
        prerequisite: t('tour.target.missing', { target: targetArg }),
      });
      haltedAt = 'recon';
    } else {
      const run = await runCommand((io) => handleBrownfieldCommand(['survey', absTarget], io, root));
      steps.push({
        id: 'recon',
        title: t('tour.recon.title'),
        commands,
        why,
        status: 'ran',
        executed: true,
        output: run.lines,
        code: run.code,
        ...(run.error ? { prerequisite: t('tour.stepFailed', { error: run.error }) } : {}),
      });
    }
  }

  // ── 2. Borrador de constitución (la decisión humana) ────────────────────────────────────────
  {
    const commands = [`open-sdd brownfield constitution ${targetArg} --draft${readOnly ? '' : ' --write'}`];
    const why = t('tour.constitution.why');
    const read = await loadConstitution(root, sddDir);
    const inForce = read.exists && read.constitution !== null ? principlesInForce(read.constitution).length : 0;
    const draftPath = constitutionArtifactPaths(absTarget, sddDir).draft;
    const draftExists = (await stat(draftPath).catch(() => null)) !== null;

    if (inForce > 0) {
      steps.push({
        id: 'constitution',
        title: t('tour.constitution.title'),
        commands,
        why,
        status: 'satisfied',
        executed: false,
        output: [t('tour.constitution.satisfied', { n: inForce })],
      });
    } else if (haltedAt !== null) {
      steps.push({
        id: 'constitution',
        title: t('tour.constitution.title'),
        commands,
        why,
        status: 'blocked',
        executed: false,
        output: [],
        prerequisite: t('tour.prereq.target'),
      });
    } else {
      const run = await runCommand((io) =>
        handleBrownfieldCommand(['constitution', absTarget, '--draft', ...(readOnly ? [] : ['--write'])], io, root),
      );
      const humanDecision = t('tour.constitution.decision');
      steps.push({
        id: 'constitution',
        title: t('tour.constitution.title'),
        commands,
        why,
        status: 'handover',
        executed: true,
        output: run.lines,
        code: run.code,
        ...(run.error ? { prerequisite: t('tour.stepFailed', { error: run.error }) } : {}),
        humanDecision,
        handoverCommand: draftExists || !readOnly ? RATIFY_COMMAND : `open-sdd brownfield constitution ${targetArg} --draft --write && ${RATIFY_COMMAND}`,
      });
      haltedAt = 'constitution';
    }
  }

  // ── 3. Comprobación ─────────────────────────────────────────────────────────────────────────
  steps.push(
    haltedAt !== null
      ? {
          id: 'check',
          title: t('tour.check.title'),
          commands: ['open-sdd govern rigor'],
          why: t('tour.check.why'),
          status: 'blocked',
          executed: false,
          output: [],
          prerequisite: t('tour.prereq.constitution'),
        }
      : await (async (): Promise<TourStepResult> => {
          const run = await runCommand((io) => handleGovernCommand(['rigor'], io, root));
          return {
            id: 'check',
            title: t('tour.check.title'),
            commands: ['open-sdd govern rigor'],
            why: t('tour.check.why'),
            status: 'ran',
            executed: true,
            output: run.lines,
            code: run.code,
            ...(run.error ? { prerequisite: t('tour.stepFailed', { error: run.error }) } : {}),
          };
        })(),
  );

  // ── 4. Panel de estado ──────────────────────────────────────────────────────────────────────
  {
    const commands = [feature ? `open-sdd status ${feature}` : 'open-sdd status'];
    steps.push(
      haltedAt !== null
        ? {
            id: 'status',
            title: t('tour.status.title'),
            commands,
            why: t('tour.status.why'),
            status: 'blocked',
            executed: false,
            output: [],
            prerequisite: t('tour.prereq.constitution'),
          }
        : await (async (): Promise<TourStepResult> => {
            const run = await runCommand((io) =>
              handleStatusCommand(feature ? [feature] : [], io, root),
            );
            return {
              id: 'status',
              title: t('tour.status.title'),
              commands,
              why: t('tour.status.why'),
              status: 'ran',
              executed: true,
              output: run.lines,
              code: run.code,
              ...(run.error ? { prerequisite: t('tour.stepFailed', { error: run.error }) } : {}),
            };
          })(),
    );
  }

  // ── 5. Delta: contrato del cambio (entrega con datos humanos) ───────────────────────────────
  {
    const featureToken = feature ?? '<feature>';
    const commands = [
      `open-sdd delta init ${featureToken} "<qué cambia>"`,
      `open-sdd delta validate ${featureToken}`,
    ];
    steps.push({
      id: 'delta',
      title: t('tour.delta.title'),
      commands,
      why: t('tour.delta.why'),
      status: 'handover',
      executed: false,
      output: [],
      prerequisite: haltedAt !== null ? t('tour.prereq.constitution') : t('tour.prereq.identity'),
      humanDecision: t('tour.prereq.identity'),
      handoverCommand: commands.join(' && '),
    });
  }

  return {
    target: targetArg,
    targetExists,
    root,
    sddDir,
    readOnly,
    locale: input.translator.locale,
    haltedAt,
    steps,
    fallbacks: input.translator.fallbacks(),
    fallbackReport: input.translator.report(),
    rejections: '',
  };
};

// ---------------------------------------------------------------------------------------------
// Render humano
// ---------------------------------------------------------------------------------------------

const indent = (lines: string[]): string[] => lines.map((line) => `    ${line}`);

export const renderTour = (report: TourReport, io: CliIO, translator: Translator): void => {
  const t = translator.t;
  io.log('');
  io.log(formatHeading(t('tour.heading', { target: report.target })));
  io.log(`  ${dim(report.readOnly ? t('tour.readOnly') : t('tour.readWrite'))}`);
  if (report.rejections) io.log(colors.yellow(`  ${report.rejections}`));

  const total = report.steps.length;
  report.steps.forEach((step, index) => {
    io.log('');
    io.log(`  ${colors.bold(t('tour.step', { n: index + 1, total, title: step.title }))}`);
    for (const command of step.commands) io.log(`    ${t('tour.command', { command })}`);
    io.log(`    ${dim(t('tour.why', { why: step.why }))}`);

    if (step.status === 'satisfied') {
      io.log(`    ${colors.green('✓')} ${t('tour.satisfied', { detail: step.output.join(' ') })}`);
    }
    if (step.executed) {
      io.log(`    ${t('tour.output')}`);
      if (step.output.length === 0) io.log(`      ${dim(t('tour.noOutput'))}`);
      else for (const line of indent(step.output)) io.log(`  ${line}`);
    }
    if (step.prerequisite) {
      io.log(`    ${colors.yellow('!')} ${t('tour.prerequisite', { what: step.prerequisite })}`);
    }
    if (step.humanDecision) {
      io.log(`    ${colors.yellow('⏸')} ${t('tour.humanDecision', { what: step.humanDecision })}`);
      if (step.handoverCommand) io.log(`    ${t('tour.handover', { command: step.handoverCommand })}`);
    }
  });

  io.log('');
  if (report.haltedAt !== null) {
    io.log(`  ${colors.yellow(t('tour.halted', { step: report.haltedAt }))}`);
  }
  io.log(`  ${dim(t('tour.done'))}`);
  if (report.fallbackReport) io.log(`  ${colors.yellow(report.fallbackReport)}`);
  io.log('');
};

export const handleTourCommand = async (
  argv: string[],
  io: CliIO,
  cwd: string = process.cwd(),
): Promise<number> => {
  const json = argv.includes('--json');
  const write = argv.includes('--write');
  const target = positionals(argv)[0];
  const sddDir = flagValue(argv, '--sdd-dir') ?? flagValue(argv, '--kiro-dir');
  const { translator, resolution } = await openI18n({
    argv,
    env: process.env,
    cwd,
    ...(sddDir ? { sddDir } : {}),
  });

  const report = await planTour({
    cwd,
    ...(target ? { target } : {}),
    write,
    translator,
  });
  report.rejections = rejectionsReport(resolution);

  if (json) {
    io.log(JSON.stringify({ ...report, command: 'tour' }, null, 2));
    return report.targetExists ? 0 : 1;
  }
  renderTour(report, io, translator);
  return report.targetExists ? 0 : 1;
};

// ---------------------------------------------------------------------------------------------
// `open-sdd context <feature> [--json]`
// ---------------------------------------------------------------------------------------------

/**
 * Render humano del context pack: qué está PRESENTE y qué AUSENTE, con el motivo de cada ausencia.
 * Es el mismo objeto que sirve `open_sdd_context_pack`; aquí solo cambia la piel (y el idioma).
 */
export const renderContextPack = (pack: ContextPack, io: CliIO, translator: Translator): void => {
  const t = translator.t;
  const mark = (label: string, present: boolean): string =>
    `${present ? colors.green('✓') : colors.yellow('✕')} ${colors.bold(label)}: ${
      present ? t('context.present') : t('context.absentLabel')
    }`;

  io.log('');
  io.log(formatHeading(t('context.heading', { feature: pack.feature ?? t('context.featureNone') })));
  io.log(
    `  ${
      pack.complete
        ? colors.green(t('context.complete'))
        : colors.yellow(t('context.incomplete', { list: pack.absent.join(', ') }))
    }`,
  );
  io.log(`  ${dim(pack.feature ?? '')} ${dim(pack.sddDir)}`);
  io.log('');

  io.log(`  ${mark(t('context.constitution'), pack.constitution.present)}`);
  if (pack.constitution.present) {
    io.log(
      `      ${dim(
        `${t('context.principles', { n: pack.constitution.principlesInForce.length })}${
          pack.constitution.issues.length > 0 ? `; ${t('context.issues', { n: pack.constitution.issues.length })}` : ''
        }`,
      )}`,
    );
  } else {
    io.log(`      ${dim(t('context.reason', { reason: pack.constitution.reason ?? '—' }))}`);
  }

  io.log(`  ${mark(t('context.spec'), pack.spec.present)}`);
  if (pack.spec.present) {
    for (const key of ['requirements', 'plan', 'tasks', 'delta'] as const) {
      const piece = pack.spec[key];
      if (!piece) continue;
      io.log(
        `      ${piece.present ? colors.green('✓') : colors.yellow('✕')} ${key}${
          piece.present ? '' : ` — ${dim(t('context.reason', { reason: piece.reason ?? '—' }))}`
        }`,
      );
    }
  } else {
    io.log(`      ${dim(t('context.reason', { reason: pack.spec.reason ?? '—' }))}`);
  }

  io.log(`  ${mark(t('context.moduleMap'), pack.moduleMap.present)}`);
  if (pack.moduleMap.present) {
    io.log(`      ${dim(t('context.modules', { n: pack.moduleMap.modules.length }))}`);
  } else {
    io.log(`      ${dim(t('context.reason', { reason: pack.moduleMap.reason ?? '—' }))}`);
  }

  io.log(`  ${mark(t('context.rigor'), pack.rigor.present)}`);
  if (pack.rigor.present) {
    io.log(
      `      ${dim(
        `${pack.rigor.level ?? '—'}; ${t('context.gates', { gates: pack.rigor.activeGates.join(', ') || '(ninguno)' })}`,
      )}`,
    );
  } else {
    io.log(`      ${dim(t('context.reason', { reason: pack.rigor.reason ?? '—' }))}`);
  }

  io.log('');
  io.log(formatHeading(t('context.absentHeading')));
  const absences = contextAbsences(pack);
  if (absences.length === 0) io.log(`  ${colors.green(t('context.absentNone'))}`);
  else for (const absence of absences) io.log(`  ${colors.yellow('·')} ${absence.key}: ${t('context.reason', { reason: absence.reason })}`);
  if (translator.hasFallbacks()) io.log(`  ${colors.yellow(translator.report())}`);
  io.log('');
};

export const handleContextCommand = async (
  argv: string[],
  io: CliIO,
  cwd: string = process.cwd(),
): Promise<number> => {
  const json = argv.includes('--json');
  const feature = positionals(argv)[0];
  const sddDir = flagValue(argv, '--sdd-dir') ?? flagValue(argv, '--kiro-dir');
  const { translator, resolution } = await openI18n({
    argv,
    env: process.env,
    cwd,
    ...(sddDir ? { sddDir } : {}),
  });

  const { pack, detail, isError } = await buildContextPack(cwd, {
    ...(feature ? { feature } : {}),
    ...(sddDir ? { sddDir } : {}),
  });
  const rejections = rejectionsReport(resolution);

  if (json) {
    io.log(
      JSON.stringify(
        {
          ...pack,
          detail,
          isError,
          locale: translator.locale,
          localeSource: resolution.source,
          rejections,
          fallbacks: translator.fallbacks(),
          command: 'context',
        },
        null,
        2,
      ),
    );
    return 0;
  }

  renderContextPack(pack, io, translator);
  if (rejections) io.log(colors.yellow(`  ${rejections}`));
  return 0;
};
