/**
 * Ninguna plantilla de comando puede citar un comando que el CLI no tenga.
 *
 * Las trece plantillas de `templates/commands/*.md` son el flujo que un agente ejecuta; cuando una
 * cita un verbo que el CLI no conoce, envejeció y nadie se enteró hasta que un humano la leyó. Esta
 * prueba lo convierte en un fallo de suite. El conjunto de verbos válidos se DERIVA del despachador
 * real (`src/index.ts`, sus `cmd === '…'`), no de una lista a mano: si un verbo entra o sale, la
 * prueba lo sigue sola. Extrae las invocaciones declaradas en el frontmatter (`commands:`) y las del
 * cuerpo; el `open-sdd` de una ruta o de un paquete (`npx open-sdd@latest`) no cuenta. No valida
 * sub-acciones, ni esquemas, ni secciones: existencia de comandos y nada más.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatesDir = path.join(root, 'templates', 'commands');
const dispatcherFile = path.join(root, 'src', 'index.ts');

/** Verbos que el despachador reconoce, leídos de sus propias comparaciones `cmd === '…'`. */
const cliVerbs = (): Set<string> => {
  const source = readFileSync(dispatcherFile, 'utf8');
  const start = source.indexOf('const dispatchSubcommand');
  const end = source.indexOf('export const runCli');
  const dispatch = source.slice(start, end > start ? end : undefined);
  return new Set([...dispatch.matchAll(/cmd\s*===\s*'([a-z][a-z0-9-]*)'/g)].map((match) => match[1]));
};

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** Todos los verbos `open-sdd <verbo>` que la plantilla cita: los declarados y los del cuerpo. */
const citedVerbs = (raw: string): string[] => {
  const frontmatter = raw.match(FRONTMATTER)?.[0] ?? '';
  const body = raw.slice(frontmatter.length);
  const declared = [...frontmatter.matchAll(/^\s+-\s*"?(open-sdd[^"\n]*)"?\s*$/gm)].map((match) => match[1]);
  const found = new Set<string>();
  // Only CODE counts as a citation: inline spans and fenced blocks. A sentence that happens to
  // mention the tool ("open-sdd produces real artifacts") is prose, not a command, and treating it as
  // an error made this test fail on a correct template. The declared frontmatter list stays
  // authoritative and is scanned as-is.
  const codeBlocks = [...body.matchAll(/\x60\x60\x60[\s\S]*?\x60\x60\x60/g)].map((match) => match[0]).join('\n');
  const codeSpans = [...body.matchAll(/\x60[^\x60\n]+\x60/g)].map((match) => match[0]).join('\n');
  for (const text of [declared.join('\n'), codeBlocks, codeSpans]) {
    for (const match of text.matchAll(/(^|[^\w@/.-])open-sdd[ \t]+([a-z][a-z0-9-]*)/g)) found.add(match[2]);
  }
  return [...found].sort();
};

/** Cuenta total de citas encontradas, para que el test no pueda pasar por no encontrar nada. */
const countCitations = (files) => files.reduce((total, file) => total + citationsIn(file).size, 0);

describe('templates/commands', () => {
  it('toda invocación `open-sdd …` citada existe en el despachador del CLI', () => {
    const verbs = cliVerbs();
    expect(verbs.size, 'el despachador no declaró ningún verbo: la comprobación no sería válida').toBeGreaterThan(0);

    const files = readdirSync(templatesDir).filter((name) => name.endsWith('.md')).sort();
    expect(files.length, `no hay plantillas en ${templatesDir}`).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      for (const verb of citedVerbs(readFileSync(path.join(templatesDir, file), 'utf8'))) {
        if (!verbs.has(verb)) offenders.push(`${file}: open-sdd ${verb}`);
      }
    }

    expect(
      offenders,
      `Plantillas que citan un comando inexistente en el CLI:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
