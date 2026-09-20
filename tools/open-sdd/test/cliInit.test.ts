/**
 * `open-sdd init` — comportamiento del inicializador de un comando.
 *
 * Todo se ejecuta sobre fixtures en `mkdtemp` y se limpia en `afterEach`: la suite NUNCA escribe
 * dentro del repositorio. Se prueba el contrato observable (plan sin `--write` no escribe, `--write`
 * declara un rigor válido, idempotencia, `--json`, error de nivel) y, explícitamente, que el
 * contrato heredado `init <feature>` —que fija `test/cliSubcommands.test.ts`— sigue en pie.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleInitCommand, handleSpecInitCommand } from '../src/cli/commands/init.js';
import { isRigorLevel, resolveRigorSettings } from '../src/core/rigor.js';
import { parseConstitution, principlesInForce, validateConstitution } from '../src/core/constitution.js';

const tempDirs: string[] = [];

const makeRoot = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-init-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

const makeIO = () => {
  const logs: string[] = [];
  const errs: string[] = [];
  return {
    io: {
      log: (message: string) => logs.push(message),
      error: (message: string) => errs.push(message),
      exit: () => undefined,
    },
    get logs() {
      return logs;
    },
    get errs() {
      return errs;
    },
    text: () => logs.join('\n'),
  };
};

const exists = async (p: string): Promise<boolean> => (await stat(p).catch(() => null)) !== null;

const gitInit = async (dir: string): Promise<void> => {
  const result = spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' });
  expect(result.status, `git init falló: ${result.stderr}`).toBe(0);
};

/** Fixture con código real: es lo que hace que la constitución descriptiva tenga principios. */
const writeCodeFixture = async (dir: string): Promise<void> => {
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await mkdir(path.join(dir, 'test'), { recursive: true });
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'acme-orders',
        version: '1.0.0',
        dependencies: { express: '^4.0.0' },
        devDependencies: { vitest: '^4.0.0' },
        scripts: { test: 'vitest run' },
      },
      null,
      2,
    ),
    'utf8',
  );
  await writeFile(path.join(dir, 'src', 'index.ts'), "export const hello = (): string => 'hola';\n", 'utf8');
  await writeFile(
    path.join(dir, 'test', 'index.test.ts'),
    "import { hello } from '../src/index.js';\ntest('hola', () => expect(hello()).toBe('hola'));\n",
    'utf8',
  );
};

describe('init — detección del agente anfitrión', () => {
  it('detecta el anfitrión por el marcador .cursor/ y dice por qué lo eligió', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });
    const ctx = makeIO();

    const code = await handleInitCommand(['.', '--json'], ctx.io, dir);
    const plan = JSON.parse(ctx.text()) as {
      agent: { id: string; source: string; evidence: string[] };
      artifacts: { action: string }[];
    };

    expect(code).toBe(0);
    expect(plan.agent.source).toBe('detectado');
    expect(plan.agent.evidence.join(' ')).toContain('.cursor/');
    // La variante elegida es la NO desaconsejada del registro (`--cursor` lleva upgradeNotice);
    // la otra queda publicada en `alternatives` con su bandera.
    expect(plan.agent.id).toBe('cursor-skills');
  });

  it('prefiere evidencia específica (el directorio exacto del registro) y publica alternativas', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.claude', 'commands', 'sdd'), { recursive: true });
    await mkdir(path.join(dir, '.cursor'), { recursive: true });
    const ctx = makeIO();

    await handleInitCommand(['.', '--json'], ctx.io, dir);
    const plan = JSON.parse(ctx.text()) as {
      agent: { id: string; evidence: string[]; alternatives: { id: string; flag: string }[] };
    };

    expect(plan.agent.id).toBe('claude-code');
    expect(plan.agent.evidence.join(' ')).toContain('.claude/commands/sdd');
    expect(plan.agent.alternatives.map((alternative) => alternative.id)).toContain('cursor-skills');
    expect(plan.agent.alternatives.every((alternative) => alternative.flag.startsWith('--'))).toBe(true);
  });

  it('--agent manda sobre la detección', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });
    const ctx = makeIO();

    await handleInitCommand(['.', '--agent', 'antigravity-skills', '--json'], ctx.io, dir);
    const plan = JSON.parse(ctx.text()) as { agent: { id: string; source: string } };
    expect(plan.agent.id).toBe('antigravity-skills');
    expect(plan.agent.source).toBe('declarado');
  });

  it('sin marcadores usa el valor por defecto del instalador y lo declara', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();
    await handleInitCommand(['.', '--json'], ctx.io, dir);
    const plan = JSON.parse(ctx.text()) as { agent: { id: string; source: string; evidence: string[] } };
    expect(plan.agent.id).toBe('claude-code-skills');
    expect(plan.agent.source).toBe('defecto');
    expect(plan.agent.evidence.join(' ')).toContain('no se observó ningún marcador');
  });
});

describe('init — plan y escritura', () => {
  it('sin --write imprime el plan y NO crea nada', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });
    const ctx = makeIO();

    const code = await handleInitCommand(['.'], ctx.io, dir);

    expect(code).toBe(0);
    expect(await exists(path.join(dir, '.sdd'))).toBe(false);
    expect(ctx.text()).toContain('Sin --write no se ha escrito nada');
    // El plan anuncia create/keep por artefacto, como planBootstrap.
    expect(ctx.text()).toContain('create');
    expect(ctx.text()).toContain('.sdd/settings/rigor.json');
  });

  it('sin --write tampoco toca un rigor.json existente', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.sdd', 'settings'), { recursive: true });
    await writeFile(path.join(dir, '.sdd', 'settings', 'rigor.json'), '{"level":"spec-first"}\n', 'utf8');
    const ctx = makeIO();

    await handleInitCommand(['.'], ctx.io, dir);

    const raw = await readFile(path.join(dir, '.sdd', 'settings', 'rigor.json'), 'utf8');
    expect(raw).toBe('{"level":"spec-first"}\n');
    expect(ctx.text()).toContain('keep');
  });

  it('--write crea un rigor.json que el modelo de rigor acepta y con rationale NO vacío', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });
    const ctx = makeIO();

    const code = await handleInitCommand(['.', '--write'], ctx.io, dir);

    expect(code).toBe(0);
    const raw = await readFile(path.join(dir, '.sdd', 'settings', 'rigor.json'), 'utf8');
    const parsed = JSON.parse(raw) as { level: string; rationale: string };
    expect(isRigorLevel(parsed.level)).toBe(true);
    expect(parsed.rationale.trim().length).toBeGreaterThan(0);
    // El modelo rechaza (throw) una elección sin motivo: no basta con que el JSON parsee.
    expect(() => resolveRigorSettings(parsed)).not.toThrow();
    expect(ctx.text()).toContain('escrito: .sdd/settings/rigor.json');
  });

  it('--level declara el nivel pedido y publica la escalera completa', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();

    const code = await handleInitCommand(['.', '--level', 'spec-anchored', '--write'], ctx.io, dir);

    expect(code).toBe(0);
    const raw = await readFile(path.join(dir, '.sdd', 'settings', 'rigor.json'), 'utf8');
    expect((JSON.parse(raw) as { level: string }).level).toBe('spec-anchored');
    expect(ctx.text()).toContain('spec-first');
    expect(ctx.text()).toContain('spec-as-source');
    expect(ctx.text()).toContain('OBLIGATORIA');
  });

  it('--level inválido sale con 1 y lista los niveles admitidos', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();

    const code = await handleInitCommand(['.', '--level', 'spec-ultra', '--write'], ctx.io, dir);

    expect(code).toBe(1);
    expect(ctx.errs.join('\n')).toContain('spec-first, spec-anchored, spec-as-source');
    expect(await exists(path.join(dir, '.sdd'))).toBe(false);
  });

  it('--lang inválido sale con 1 y lista los idiomas admitidos', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();
    const code = await handleInitCommand(['.', '--lang', 'fr'], ctx.io, dir);
    expect(code).toBe(1);
    expect(ctx.errs.join('\n')).toContain('es, en');
  });

  it('--agent desconocido sale con 1 y lista los agentes admitidos', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();
    const code = await handleInitCommand(['.', '--agent', 'nope'], ctx.io, dir);
    expect(code).toBe(1);
    expect(ctx.errs.join('\n')).toContain('claude-code-skills');
  });

  it('--json es JSON parseable y refleja el plan', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });
    const ctx = makeIO();

    const code = await handleInitCommand(['.', '--json'], ctx.io, dir);

    expect(code).toBe(0);
    const plan = JSON.parse(ctx.text()) as {
      root: string;
      level: { level: string; ladder: unknown[] };
      artifacts: { path: string; action: string; reason: string }[];
      nextCommands: string[];
      outcome: { written: string[] };
    };
    expect(plan.root).toBe(dir);
    expect(plan.level.level).toBe('spec-first');
    expect(plan.level.ladder).toHaveLength(3);
    expect(plan.artifacts[0]).toMatchObject({ path: '.sdd/settings/rigor.json', action: 'create' });
    expect(plan.nextCommands).toHaveLength(3);
    expect(plan.nextCommands[0]).toMatch(/^open-sdd brownfield constitution /);
    expect(plan.nextCommands).toContain('open-sdd status');
    expect(plan.nextCommands).toContain('open-sdd status --check');
    expect(plan.outcome.written).toEqual([]);
  });

  it('--json con --write declara lo escrito', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();
    const code = await handleInitCommand(['.', '--json', '--write'], ctx.io, dir);
    expect(code).toBe(0);
    const plan = JSON.parse(ctx.text()) as { outcome: { written: string[]; failures: string[] } };
    expect(plan.outcome.written).toContain('.sdd/settings/rigor.json');
    expect(plan.outcome.failures).toEqual([]);
  });
});

describe('init — idempotencia', () => {
  it('ejecutar --write dos veces conserva el archivo y no lo reescribe', async () => {
    const dir = await makeRoot();
    await writeCodeFixture(dir);
    const first = makeIO();
    expect(await handleInitCommand(['.', '--write'], first.io, dir)).toBe(0);
    const afterFirst = await readFile(path.join(dir, '.sdd', 'settings', 'rigor.json'), 'utf8');

    const second = makeIO();
    expect(await handleInitCommand(['.', '--write'], second.io, dir)).toBe(0);
    const afterSecond = await readFile(path.join(dir, '.sdd', 'settings', 'rigor.json'), 'utf8');

    expect(afterSecond).toBe(afterFirst);
    expect(second.text()).toContain('conservado: .sdd/settings/rigor.json');
    expect(second.text()).toContain('conservado: .sdd/steering/constitution.md');
    // El plan de la segunda pasada promete `keep`, no `create`: plan y realidad coinciden.
    const third = makeIO();
    await handleInitCommand(['.', '--json', '--write'], third.io, dir);
    const plan = JSON.parse(third.text()) as { artifacts: { action: string }[] };
    expect(plan.artifacts.every((artifact) => artifact.action === 'keep')).toBe(true);
  });

  it('NUNCA sobrescribe un rigor.json editado a mano', async () => {
    const dir = await makeRoot();
    await writeCodeFixture(dir);
    await handleInitCommand(['.', '--write'], makeIO().io, dir);

    const edited = `${JSON.stringify(
      { level: 'spec-as-source', rationale: 'decisión del equipo: pagos auditados', brownfield: true },
      null,
      2,
    )}\n`;
    await writeFile(path.join(dir, '.sdd', 'settings', 'rigor.json'), edited, 'utf8');

    const ctx = makeIO();
    expect(await handleInitCommand(['.', '--write', '--level', 'spec-first'], ctx.io, dir)).toBe(0);

    expect(await readFile(path.join(dir, '.sdd', 'settings', 'rigor.json'), 'utf8')).toBe(edited);
    expect(ctx.text()).toContain('conservado: .sdd/settings/rigor.json');
  });

  it('--write con código genera la constitución descriptiva y es válida', async () => {
    const dir = await makeRoot();
    await writeCodeFixture(dir);
    const ctx = makeIO();

    expect(await handleInitCommand(['.', '--write'], ctx.io, dir)).toBe(0);

    const raw = await readFile(path.join(dir, '.sdd', 'steering', 'constitution.md'), 'utf8');
    const constitution = parseConstitution(raw);
    expect(validateConstitution(constitution).filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(principlesInForce(constitution).length).toBeGreaterThan(0);
    expect(constitution.establishedFacts.length).toBeGreaterThan(0);
  });

  it('sin código no inventa una constitución y lo dice', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();
    expect(await handleInitCommand(['.', '--write'], ctx.io, dir)).toBe(0);
    expect(await exists(path.join(dir, '.sdd', 'steering', 'constitution.md'))).toBe(false);
    expect(ctx.text()).toContain('No se observó código');
  });
});

describe('init — idioma', () => {
  it('detecta español en el README', async () => {
    const dir = await makeRoot();
    await writeFile(
      path.join(dir, 'README.md'),
      '# Proyecto\n\nEste repositorio contiene la documentación del producto. Las decisiones de arquitectura se registran aquí y los cambios se revisan antes de integrarlos en la rama principal.\n',
      'utf8',
    );
    const ctx = makeIO();
    await handleInitCommand(['.', '--json'], ctx.io, dir);
    const plan = JSON.parse(ctx.text()) as { language: { lang: string; source: string } };
    expect(plan.language.lang).toBe('es');
    expect(plan.language.source).toBe('docs');
  });

  it('detecta inglés en el README y cae a es cuando no hay muestra', async () => {
    const dir = await makeRoot();
    await writeFile(
      path.join(dir, 'README.md'),
      '# Project\n\nThis repository holds the product documentation. Architecture decisions are recorded here and every change is reviewed before it is merged into the main branch for release.\n',
      'utf8',
    );
    const ctx = makeIO();
    await handleInitCommand(['.', '--json'], ctx.io, dir);
    const plan = JSON.parse(ctx.text()) as { language: { lang: string; source: string } };
    expect(plan.language.lang).toBe('en');

    const empty = await makeRoot();
    const emptyCtx = makeIO();
    await handleInitCommand(['.', '--json'], emptyCtx.io, empty);
    const emptyPlan = JSON.parse(emptyCtx.text()) as { language: { lang: string; source: string } };
    expect(emptyPlan.language).toMatchObject({ lang: 'es', source: 'defecto' });
  });

  it('--lang manda sobre la detección', async () => {
    const dir = await makeRoot();
    await writeFile(path.join(dir, 'README.md'), '# Project\n\nThis repository holds the product documentation and the review process.\n', 'utf8');
    const ctx = makeIO();
    await handleInitCommand(['.', '--lang', 'es', '--json'], ctx.io, dir);
    const plan = JSON.parse(ctx.text()) as { language: { lang: string; source: string } };
    expect(plan.language).toMatchObject({ lang: 'es', source: 'declarado' });
  });
});

describe('init — hook de commit (delegado al instalador existente)', () => {
  it('--write instala el gate en un repositorio git y la segunda pasada lo conserva', async () => {
    const dir = await makeRoot();
    await gitInit(dir);
    const first = makeIO();

    expect(await handleInitCommand(['.', '--write'], first.io, dir)).toBe(0);

    const hook = path.join(dir, '.git', 'hooks', 'pre-commit');
    const installed = await readFile(hook, 'utf8');
    expect(installed).toContain('open-sdd');
    expect((await stat(hook)).mode & 0o111).not.toBe(0);
    expect(first.text()).toContain('escrito: .git/hooks/pre-commit');

    const second = makeIO();
    expect(await handleInitCommand(['.', '--write'], second.io, dir)).toBe(0);
    expect(await readFile(hook, 'utf8')).toBe(installed);
    expect(second.text()).toContain('conservado: .git/hooks/pre-commit');
  });

  it('NUNCA sobrescribe un hook ajeno: lo deja intacto y apunta al comando que lo reemplaza', async () => {
    const dir = await makeRoot();
    await gitInit(dir);
    const hooksDir = path.join(dir, '.git', 'hooks');
    await mkdir(hooksDir, { recursive: true });
    const foreign = '#!/bin/sh\necho "hook propio del equipo"\n';
    await writeFile(path.join(hooksDir, 'pre-commit'), foreign, 'utf8');
    await chmod(path.join(hooksDir, 'pre-commit'), 0o755);

    const ctx = makeIO();
    expect(await handleInitCommand(['.', '--write'], ctx.io, dir)).toBe(0);

    expect(await readFile(path.join(hooksDir, 'pre-commit'), 'utf8')).toBe(foreign);
    expect(ctx.text()).toContain('--force');
  });

  it('sin repositorio git el plan no promete un hook y lo dice', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();
    await handleInitCommand(['.', '--json'], ctx.io, dir);
    const plan = JSON.parse(ctx.text()) as { artifacts: { path: string }[] };
    expect(plan.artifacts.some((artifact) => artifact.path.includes('hooks'))).toBe(false);
  });
});

describe('init — instalación del agente (--skills), delegada al instalador existente', () => {
  it('--skills --write delega en el instalador y crea el conjunto del agente', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });
    const ctx = makeIO();

    expect(await handleInitCommand(['.', '--skills', '--write'], ctx.io, dir)).toBe(0);

    const skills = await readdir(path.join(dir, '.cursor', 'skills'), { withFileTypes: true });
    expect(skills.filter((entry) => entry.isDirectory()).length).toBeGreaterThan(0);
    expect(ctx.text()).toContain('escrito: .cursor/skills');
    // Delegación explícita: el comando exacto del instalador existente, no una copia propia.
    expect(ctx.text()).toContain('--overwrite=prompt');
  });

  it('--skills es idempotente: conserva lo editado y completa lo ausente', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });
    expect(await handleInitCommand(['.', '--skills', '--write'], makeIO().io, dir)).toBe(0);

    const skillDir = path.join(dir, '.cursor', 'skills', 'sdd-help');
    const skillFile = path.join(skillDir, 'SKILL.md');
    const original = await readFile(skillFile, 'utf8');
    await writeFile(skillFile, `${original}\n<!-- ajuste local del equipo -->\n`, 'utf8');

    const second = makeIO();
    expect(await handleInitCommand(['.', '--skills', '--write'], second.io, dir)).toBe(0);

    expect(await readFile(skillFile, 'utf8')).toContain('ajuste local del equipo');
    const third = makeIO();
    await handleInitCommand(['.', '--skills', '--json'], third.io, dir);
    const plan = JSON.parse(third.text()) as { artifacts: { path: string; action: string }[] };
    expect(plan.artifacts.find((artifact) => artifact.path === '.cursor/skills')?.action).toBe('update');
  });

  it('sin --skills no toca el conjunto del agente', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, '.cursor'), { recursive: true });
    const ctx = makeIO();
    expect(await handleInitCommand(['.', '--write'], ctx.io, dir)).toBe(0);
    expect(await exists(path.join(dir, '.cursor', 'skills'))).toBe(false);
    expect(ctx.text()).not.toContain('instalador existente');
  });
});

describe('init — contrato heredado `init <feature>` sigue en pie', () => {
  it('crea una especificación (comportamiento instalado que el CLI ya despachaba)', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();

    const code = await handleInitCommand(['payment-v2', '--title=Payment Gateway V2'], ctx.io, dir);

    expect(code).toBe(0);
    expect(ctx.text()).toContain('Initialized specification for');
    expect(await exists(path.join(dir, '.sdd', 'specs', 'payment-v2', 'requirements.md'))).toBe(true);
  });

  it('un slug inexistente sin banderas de proyecto es una feature, no un directorio objetivo', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();
    expect(await handleInitCommand(['feature-alpha'], ctx.io, dir)).toBe(0);
    expect(await exists(path.join(dir, '.sdd', 'specs', 'feature-alpha'))).toBe(true);
    expect(ctx.text()).toContain('Initialized specification for');
  });

  it('handleSpecInitCommand sigue siendo el init de spec y sin argumento da uso', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();
    expect(await handleSpecInitCommand(['payment-v3'], ctx.io, dir)).toBe(0);
    expect(await exists(path.join(dir, '.sdd', 'specs', 'payment-v3'))).toBe(true);

    const bad = makeIO();
    expect(await handleSpecInitCommand([], bad.io, dir)).toBe(1);
    expect(bad.errs.join('\n')).toContain('Usage: open-sdd init <feature-slug>');
  });
});
