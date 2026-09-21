import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { colors } from './colors.js';
/**
 * ¿Se puede preguntar? Un CLI de gobernanza corre en CI: un prompt sin escapatoria es un defecto,
 * y un fallo de prompt que no nombra la bandera es un callejón sin salida. Por eso:
 *
 *   `--no-input`            (`setNonInteractive`) desactiva los prompts en esta ejecución.
 *   `NONINTERACTIVE=1`      lo mismo, desde el entorno.
 *   `OPEN_SDD_PROMPT=0`     lo mismo, desde el entorno.
 *
 * Y cuando un prompt no puede ejecutarse, el error NOMBRA las dos salidas (`--yes` y `--no-input`)
 * en vez del antiguo `TTY required for interactive prompts`, que no decía qué hacer.
 */
let promptDisabled = false;
/** Desactivar (o reactivar) los prompts en este proceso. Lo llama `src/index.ts` con `--no-input`. */
export const setNonInteractive = (value = true) => {
    promptDisabled = value;
};
export const isPromptDisabled = () => promptDisabled;
/** El motivo, ya nombrado, por el que el entorno prohíbe preguntar; `null` si no lo prohíbe. */
export const nonInteractiveEnvReason = (env = process.env) => {
    if (env.NONINTERACTIVE === '1')
        return '`NONINTERACTIVE=1`';
    if (env.OPEN_SDD_PROMPT === '0')
        return '`OPEN_SDD_PROMPT=0`';
    return null;
};
/** El motivo por el que no se puede preguntar (bandera o entorno); `null` si sí se puede. */
export const promptsBlocked = (env = process.env) => {
    if (promptDisabled)
        return '`--no-input`';
    return nonInteractiveEnvReason(env);
};
export const isInteractive = () => {
    if (promptsBlocked() !== null)
        return false;
    return !!(input.isTTY && output.isTTY);
};
const PROMPT_ESCAPE = 'pass `--yes` to accept the defaults, or `--no-input` to run without prompting';
/** Lanza un error accionable. Nunca el mensaje desnudo «TTY required». */
const requireInteractive = () => {
    const reason = promptsBlocked();
    if (reason !== null) {
        throw new Error(`interactive prompts are disabled by ${reason}: ${PROMPT_ESCAPE}`);
    }
    throw new Error(`no TTY for an interactive prompt: ${PROMPT_ESCAPE}`);
};
export const promptSelect = async (message, options, defaultIndex = 0) => {
    requireInteractive();
    const rl = readline.createInterface({ input, output });
    try {
        options.forEach((opt, idx) => {
            const line = `  ${idx + 1}. ${opt.label}`;
            output.write(`${colors.cyan(line)}\n`);
            if (opt.description) {
                output.write(`     ${colors.dim(opt.description)}\n`);
            }
        });
        const range = `${1}-${options.length}`;
        while (true) {
            const ans = await rl.question(`${message} [${range}] (Enter for ${defaultIndex + 1}): `);
            const trimmed = ans.trim();
            if (!trimmed)
                return options[defaultIndex].value;
            const parsed = Number.parseInt(trimmed, 10);
            if (Number.isNaN(parsed) || parsed < 1 || parsed > options.length) {
                output.write(`${colors.yellow(`Please choose a number between 1 and ${options.length}.`)}\n`);
                continue;
            }
            return options[parsed - 1].value;
        }
    }
    finally {
        rl.close();
    }
};
export const promptChoice = async (message, options, defaultIndex = 0) => {
    requireInteractive();
    const rl = readline.createInterface({ input, output });
    try {
        output.write(`${colors.cyan(message)}\n`);
        options.forEach((opt, idx) => {
            const line = `  ${idx + 1}. ${opt.label}`;
            output.write(`${colors.cyan(line)}\n`);
            if (opt.description) {
                output.write(`     ${colors.dim(opt.description)}\n`);
            }
        });
        const range = `${1}-${options.length}`;
        while (true) {
            const ans = await rl.question(`Select option [${range}] (Enter for ${defaultIndex + 1}): `);
            const trimmed = ans.trim();
            if (!trimmed)
                return options[defaultIndex].value;
            const parsed = Number.parseInt(trimmed, 10);
            if (Number.isNaN(parsed) || parsed < 1 || parsed > options.length) {
                output.write(`${colors.yellow(`Please choose a number between 1 and ${options.length}.`)}\n`);
                continue;
            }
            return options[parsed - 1].value;
        }
    }
    finally {
        rl.close();
    }
};
export const promptConfirm = async (message, defaultYes = true) => {
    requireInteractive();
    const rl = readline.createInterface({ input, output });
    try {
        const suffix = defaultYes ? '[Y/n]' : '[y/N]';
        while (true) {
            const ans = await rl.question(`${colors.cyan(message)} ${suffix} `);
            const trimmed = ans.trim().toLowerCase();
            if (!trimmed)
                return defaultYes;
            if (['y', 'yes'].includes(trimmed))
                return true;
            if (['n', 'no'].includes(trimmed))
                return false;
            output.write(`${colors.yellow('Please answer y or n.')}\n`);
        }
    }
    finally {
        rl.close();
    }
};
