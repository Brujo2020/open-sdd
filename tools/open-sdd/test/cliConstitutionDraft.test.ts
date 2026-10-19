/**
 * Pruebas de comportamiento del borrador de constitución POR LA CLI.
 *
 * Lo que se fija aquí es la puerta: `--draft` escribe un borrador y no toca la constitución en
 * vigor; `--ratify` exige persona nombrada y motivo (sin ellos, exit 1) y, con `--write`, deja la
 * constitución en vigor sin marca de borrador y con el ratificador registrado. Todo ocurre en
 * fixtures `mkdtemp`: nada se escribe en este repositorio.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleGovernCommand } from '../src/cli/commands/paper.js';
import { handleBrownfieldCommand } from '../src/cli/commands/brownfield.js';
import { parseConstitution, principlesInForce } from '../src/core/constitution.js';
import { DRAFT_MARKER, draftPrincipleIds } from '../src/core/constitutionDraft.js';
import type { CliIO } from '../src/cli/io.js';

const temps: string[] = [];

const makeTemp = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const makeIO = (): { io: CliIO; logs: string[]; errors: string[] } => {
  const logs: string[] = [];
  const errors: string[] = [];
  const io: CliIO = {
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
    exit: () => undefined,
  };
  return { io, logs, errors };
};

/** A project whose code demonstrates practices, plus the SDD paths the commands read. */
const fixture = async (): Promise<string> => {
  const dir = await makeTemp('open-sdd-cli-draft-');
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'cli-draft-fixture',
        version: '1.0.0',
        scripts: { test: 'vitest run' },
        devDependencies: { typescript: '^5.9.3', vitest: '^4.0.18' },
      },
      null,
      2,
    ),
    'utf8',
  );
  await writeFile(path.join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3 }, null, 2), 'utf8');
  await writeFile(path.join(dir, 'tsconfig.json'), '{\n  "compilerOptions": { "strict": true }\n}\n', 'utf8');
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await mkdir(path.join(dir, 'test'), { recursive: true });
  await writeFile(path.join(dir, 'src', 'index.ts'), 'export const api = true;\n', 'utf8');
  await writeFile(path.join(dir, 'test', 'api.test.ts'), 'export const placeholder = true;\n', 'utf8');
  return dir;
};

const draftPathOf = (dir: string): string => path.join(dir, '.sdd', 'steering', 'constitution.draft.md');
const inForcePathOf = (dir: string): string => path.join(dir, '.sdd', 'steering', 'constitution.md');

const RATIONALE = 'La evidencia observada demuestra la práctica y el equipo la acepta como principio.';

describe('cli/constitutionDraft — brownfield constitution --draft', () => {
  it('--draft --write crea el borrador y NO toca una constitución en vigor existente', async () => {
    const dir = await fixture();
    await mkdir(path.join(dir, '.sdd', 'steering'), { recursive: true });
    const inForce = '# Constitution — preexistente\n\nProvenance: descriptive\n';
    await writeFile(inForcePathOf(dir), inForce, 'utf8');

    const { io, logs, errors } = makeIO();
    const code = await handleBrownfieldCommand(['constitution', dir, '--draft', '--write'], io, dir);

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(existsSync(draftPathOf(dir))).toBe(true);

    const written = await readFile(draftPathOf(dir), 'utf8');
    expect(written.split('\n').slice(0, 6).join('\n')).toContain(DRAFT_MARKER);
    expect(written).toContain('--ratify');
    const reloaded = parseConstitution(written);
    expect(reloaded.principles.length).toBeGreaterThan(0);
    expect(reloaded.principles.every((principle) => principle.draft === true)).toBe(true);
    expect(draftPrincipleIds(reloaded).length).toBe(reloaded.principles.length);

    // The in-force constitution is byte-for-byte untouched.
    expect(await readFile(inForcePathOf(dir), 'utf8')).toBe(inForce);
    expect(logs.join('\n')).toMatch(/existe y no se ha tocado/);
    // The compact proposal listing and the questions are printed.
    expect(logs.join('\n')).toContain('C-STACK-FACT');
    expect(logs.join('\n')).toMatch(/evidencia:/);
    expect(logs.join('\n')).toMatch(/Preguntas para el humano/);
  });

  it('sin --write es solo plan: exit 0 y ningún fichero', async () => {
    const dir = await fixture();
    const { io, logs, errors } = makeIO();
    const code = await handleBrownfieldCommand(['constitution', dir, '--draft'], io, dir);

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(existsSync(draftPathOf(dir))).toBe(false);
    expect(logs.join('\n')).toMatch(/plan only/i);
    expect(logs.join('\n')).toMatch(/Preguntas para el humano/);
  });
});

describe('cli/constitutionDraft — govern constitution --draft / --evidence-pack', () => {
  it('--draft --write funciona el día uno, cuando todavía no hay constitución en vigor', async () => {
    const dir = await fixture();
    const { io, errors } = makeIO();
    const code = await handleGovernCommand(['constitution', '--draft', '--write'], io, dir);

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(existsSync(draftPathOf(dir))).toBe(true);
    expect(existsSync(inForcePathOf(dir))).toBe(false);
    expect(await readFile(draftPathOf(dir), 'utf8')).toContain(DRAFT_MARKER);
  });

  it('--evidence-pack --json imprime el paquete serializable con los códigos de validación', async () => {
    const dir = await fixture();
    const { io, logs, errors } = makeIO();
    const code = await handleGovernCommand(['constitution', '--evidence-pack', '--json'], io, dir);

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    const pack = JSON.parse(logs.join('\n')) as Record<string, unknown>;
    expect(pack.kind).toBe('constitution-draft-evidence-pack');
    expect(pack.inForce).toBe(false);
    expect(pack.ratificationPending).toBe(true);
    expect(pack.validationCodes).toContain('EVIDENCE-MISSING');
    expect((pack.validationCodes as string[]).some((value) => value.startsWith('INJ-'))).toBe(true);
  });

  it('--evidence-pack sin --json resume el paquete y dice lo que queda pendiente', async () => {
    const dir = await fixture();
    const { io, logs, errors } = makeIO();
    const code = await handleGovernCommand(['constitution', '--evidence-pack'], io, dir);

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    const output = logs.join('\n');
    expect(output).toMatch(/no embarca modelo/i);
    expect(output).toMatch(/No se pudo determinar|pendiente/i);
    expect(output).toMatch(/--ratify/);
  });
});

describe('cli/constitutionDraft — govern constitution --ratify', () => {
  const writeDraft = async (dir: string): Promise<void> => {
    const { io } = makeIO();
    const code = await handleBrownfieldCommand(['constitution', dir, '--draft', '--write'], io, dir);
    expect(code).toBe(0);
    expect(existsSync(draftPathOf(dir))).toBe(true);
  };

  it('exige --by: sin persona nombrada no hay ratificación y sale 1', async () => {
    const dir = await fixture();
    await writeDraft(dir);

    const { io, errors } = makeIO();
    const code = await handleGovernCommand(
      ['constitution', '--ratify', '--rationale', RATIONALE, '--write'],
      io,
      dir,
    );

    expect(code).toBe(1);
    expect(errors.join('\n')).toMatch(/--by/);
    expect(existsSync(inForcePathOf(dir))).toBe(false);
  });

  it('exige un --rationale no vacío y tampoco escribe nada', async () => {
    const dir = await fixture();
    await writeDraft(dir);

    const { io, errors } = makeIO();
    const code = await handleGovernCommand(
      ['constitution', '--ratify', '--by', 'Ada Lovelace', '--rationale', '   ', '--write'],
      io,
      dir,
    );

    expect(code).toBe(1);
    expect(errors.join('\n')).toMatch(/--rationale|motivo/i);
    expect(existsSync(inForcePathOf(dir))).toBe(false);
  });

  it('--ratify --write promueve el borrador: sin marca y con el ratificador registrado', async () => {
    const dir = await fixture();
    await writeDraft(dir);

    const { io, logs, errors } = makeIO();
    const code = await handleGovernCommand(
      ['constitution', '--ratify', '--by', 'Ada Lovelace', '--rationale', RATIONALE, '--write'],
      io,
      dir,
    );

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(logs.join('\n')).toMatch(/ratificado por/);

    const inForce = await readFile(inForcePathOf(dir), 'utf8');
    expect(inForce).not.toContain(DRAFT_MARKER);
    expect(inForce).not.toContain('- Draft: true');
    expect(inForce).toContain('Ada Lovelace');
    expect(inForce).toContain(RATIONALE);

    const reloaded = parseConstitution(inForce);
    expect(draftPrincipleIds(reloaded)).toEqual([]);
    expect(principlesInForce(reloaded).length).toBeGreaterThan(0);
    expect(reloaded.principles.some((principle) => principle.amendment?.rationale === RATIONALE)).toBe(true);
    expect(reloaded.principles.some((principle) => principle.amendment?.proposedBy === 'Ada Lovelace')).toBe(true);

    // Without --write the same ratification is a dry run: it reports and writes nothing.
    const dir2 = await fixture();
    await writeDraft(dir2);
    const dry = makeIO();
    const dryCode = await handleGovernCommand(
      ['constitution', '--ratify', '--by', 'Ada Lovelace', '--rationale', RATIONALE],
      dry.io,
      dir2,
    );
    expect(dryCode).toBe(0);
    expect(existsSync(inForcePathOf(dir2))).toBe(false);
    expect(dry.logs.join('\n')).toMatch(/Añade --write/);
  });

  it('con --ids solo promueve los identificadores presentes en el borrador', async () => {
    const dir = await fixture();
    await writeDraft(dir);

    const first = makeIO();
    const code = await handleGovernCommand(
      ['constitution', '--ratify', '--by', 'Ada Lovelace', '--rationale', RATIONALE, '--ids', 'C-STACK-FACT,C-NOPE', '--write'],
      first.io,
      dir,
    );

    // A requested id that is not in the draft is refused, so the command reports the partial result.
    expect(code).toBe(1);
    expect(first.logs.join('\n')).toContain('C-STACK-FACT');
    expect(first.logs.join('\n')).toMatch(/C-NOPE/);

    const reloaded = parseConstitution(await readFile(inForcePathOf(dir), 'utf8'));
    expect(draftPrincipleIds(reloaded)).not.toContain('C-STACK-FACT');
    expect(principlesInForce(reloaded).map((principle) => principle.id)).toContain('C-STACK-FACT');
    // The proposals that were not named stay in draft: the id list is a selection, not a shortcut.
    expect(draftPrincipleIds(reloaded).length).toBeGreaterThan(0);
  });
});
