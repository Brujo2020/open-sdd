/**
 * `open-sdd gitflow` — la puerta de consola del rol de la rama.
 *
 * `core/gitflow.ts` ya sabía responder «¿qué rol juega esta rama y qué exige ese rol?» a partir de
 * las ramas que git reporta, pero no tenía puerta: la respuesta existía y nadie podía pedirla. Este
 * comando es esa puerta y NADA más: detecta el estado, deriva la política y la imprime.
 *
 * ── Report-only, a propósito ────────────────────────────────────────────────────────────────────
 * No ejecuta la cadena de gates, no escribe ningún fichero y no cambia de rama: la distancia entre
 * lo EXIGIDO por el rol y lo que HOY puede bloquear de verdad (el hook de commit y el workflow del
 * PR) es justo lo que `branchPolicy` hace visible, y este comando no la disfraza ejecutando nada.
 * Por eso `runsGateChain()` no lo conoce.
 *
 * ── Las dos formas ──────────────────────────────────────────────────────────────────────────────
 *   humana  la pantalla de `renderGitFlow` (modelo, rol, evidencia, requerido, bloquea hoy, siguiente)
 *   `--json` `{...state, policy}`: el estado medido y la política derivada, sin prosa alrededor.
 *
 * `--greenfield` declara que el contrato del cambio es la tríada viva (no la delta): el valor por
 * defecto de `branchPolicy` es brownfield, que es el caso de este producto. Los textos visibles son
 * español, como el resto del CLI (ver `src/cli/i18n.ts`).
 */

import type { CliIO } from '../io.js';
import { branchPolicy, detectGitFlow, renderGitFlow } from '../../core/gitflow.js';

/** Valor de un flag con valor (`--level x` o `--level=x`); `undefined` si no está. */
const flagValue = (args: string[], name: string): string | undefined => {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const at = args.indexOf(`--${name}`);
  if (at < 0) return undefined;
  const next = args[at + 1];
  return next === undefined || next.startsWith('-') ? '' : next;
};

export const handleGitflowCommand = async (
  args: string[],
  io: CliIO,
  cwd: string = process.cwd(),
): Promise<number> => {
  const json = args.includes('--json');
  const greenfield = args.includes('--greenfield');
  const level = flagValue(args, 'level');

  const state = await detectGitFlow(cwd);
  // `branchPolicy` valida el nivel: un `--level` desconocido cae a `DEFAULT_RIGOR_LEVEL` dentro del
  // módulo, que es donde vive esa decisión. Aquí no se reimplementa ni se adivina.
  const policy = branchPolicy(state, {
    ...(level !== undefined && level.length > 0 ? { level } : {}),
    brownfield: !greenfield,
  });

  if (json) {
    // La forma pedida: el estado medido MÁS la política derivada, plano y comparable por diff.
    io.log(JSON.stringify({ ...state, policy }, null, 2));
    return 0;
  }

  for (const line of renderGitFlow(state, policy)) io.log(line);
  return 0;
};
