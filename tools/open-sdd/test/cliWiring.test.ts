/**
 * `test/cliWiring.test.ts` — el contrato que impide que el CLI prometa más de lo que puede ejecutar.
 *
 * Seis capacidades existían con sus pruebas en verde y SIN puerta de consola: el `--help` nombraba
 * comandos que nadie podía ejecutar. Esta suite fija las puertas nuevas y, sobre todo, la última
 * prueba: **cada comando y subcomando que el `--help` nombra se despacha de verdad**. Esa prueba es
 * la que impide que el texto de ayuda vuelva a envejecer en silencio.
 *
 * Todas las fixtures son `fs.mkdtemp` y se borran en `afterEach`: NADA se escribe dentro de este
 * repositorio. Los comandos se ejecutan a través de `runCli` (el mismo camino que la CLI real) con
 * el `cwd` de la fixture, de modo que la escritura que un comando haga cae en un directorio temporal.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { runCli } from '../src/index.js';

// Los casos con git real tardan segundos bajo la contención de la suite completa.
vi.setConfig({ testTimeout: 60_000 });

const runtime = { platform: 'darwin' as NodeJS.Platform, env: {} };

const temps: string[] = [];

afterEach(async () => {
  while (temps.length > 0) {
    const dir = temps.pop();
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
    text: () => `${logs.join('\n')}\n${errs.join('\n')}`,
  };
};

const write = async (root: string, rel: string, content: string): Promise<void> => {
  const target = path.join(root, rel);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
};

const git = (cwd: string, args: string[]): void => {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
};

/**
 * Proyecto de gobernanza mínimo: rigor declarado y una spec con la tríada completa. Con `git: true`
 * además es un repositorio real con `main`, `develop` y una rama `feature/demo`, que es lo que
 * `gitflow` necesita para derivar un rol.
 */
const makeProject = async (opts: { git?: boolean } = {}): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'sdd-wiring-'));
  temps.push(root);
  await write(
    root,
    '.sdd/settings/rigor.json',
    `${JSON.stringify({ level: 'spec-first', rationale: 'nivel por defecto del proyecto, con motivo declarado', brownfield: false }, null, 2)}\n`,
  );
  await write(root, '.sdd/specs/demo/requirements.md', '# Requirements\n\nREQ-DEMO-001 The system shall record every milestone.\n');
  await write(root, '.sdd/specs/demo/plan.md', '# Plan\n\nImplementa el requisito REQ-DEMO-001.\n');
  await write(root, '.sdd/specs/demo/tasks.md', '# Tasks\n\n- [ ] T1 Escribir requirements.md\n');

  if (opts.git === true) {
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['config', 'user.email', 'fixture@example.com']);
    git(root, ['config', 'user.name', 'Fixture']);
    git(root, ['config', 'commit.gpgsign', 'false']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'chore: fixture']);
    git(root, ['branch', 'develop']);
    git(root, ['checkout', '-q', '-b', 'feature/demo']);
  }
  return root;
};

const UNKNOWN = /Unknown (?:flag|positional|argument|command)|Subcomando desconocido|comando desconocido|no se reconoce/i;

describe('cli wiring — las cuatro puertas nuevas', () => {
  it('despacha gitflow, progress, backup y biography; ninguna ejecuta la cadena de gates', async () => {
    const cwd = await makeProject({ git: true });

    const cases: { argv: string[]; marker: RegExp }[] = [
      { argv: ['gitflow'], marker: /GitFlow — modelo/ },
      { argv: ['progress'], marker: /Sin historial de progreso|·/ },
      { argv: ['backup', 'create', '--out', '.sdd/backups/wiring'], marker: /Respaldo escrito/ },
      { argv: ['biography', 'demo'], marker: /Biografía de la especificación «demo»/ },
    ];

    for (const entry of cases) {
      const ctx = makeIO();
      const code = await runCli(entry.argv, runtime, ctx.io, {}, { cwd });
      expect(code, entry.argv.join(' ')).toBe(0);
      expect(ctx.text(), entry.argv.join(' ')).toMatch(entry.marker);

      // El pie de puntuación se emite salvo que el comando ejecute la cadena por su cuenta. Si
      // `runsGateChain` lo marcara, el pie diría «no medidos en esta ejecución»: aquí NO debe.
      const footer = ctx.logs.at(-1) ?? '';
      expect(footer, `${entry.argv.join(' ')} footer`).toMatch(/^SDD \d+%/);
      expect(footer, `${entry.argv.join(' ')} footer`).not.toContain('no medidos en esta ejecución');
    }
  });

  it('gitflow --json imprime el estado medido y la política derivada', async () => {
    const cwd = await makeProject({ git: true });
    const ctx = makeIO();

    expect(await runCli(['gitflow', '--json'], runtime, ctx.io, {}, { cwd })).toBe(0);
    const parsed = JSON.parse(ctx.logs.join('\n')) as { model: string; role: string; policy: { role: string; gates: string[] } };

    expect(parsed.model).toBe('gitflow');
    expect(parsed.role).toBe('feature');
    expect(parsed.policy.role).toBe('feature');
    expect(Array.isArray(parsed.policy.gates)).toBe(true);
  });

  it('progress record rechaza un resumen vago con salida 1 y acepta uno real', async () => {
    const cwd = await makeProject();

    const vague = makeIO();
    const vagueCode = await runCli(
      ['progress', 'record', '--kind', 'spec', '--summary', 'se avanzó', '--score', '40', '--phase', '1', '--no-footer'],
      runtime,
      vague.io,
      {},
      { cwd },
    );
    expect(vagueCode).toBe(1);
    // El motivo del MÓDULO, no uno reescrito aquí: la frase vacía no entra en el libro y se explica.
    expect(vague.errs.join('\n')).toContain('no dice qué se consiguió');

    const real = makeIO();
    const realCode = await runCli(
      ['progress', 'record', '--kind', 'spec', '--summary', 'Escribí la spec de demo', '--score', '40', '--phase', '1', '--evidence', 'requirements.md', '--no-footer'],
      runtime,
      real.io,
      {},
      { cwd },
    );
    expect(realCode).toBe(0);
    const ledger = JSON.parse(await readFile(path.join(cwd, '.sdd/state/progress.json'), 'utf8')) as {
      entries: { summary: string; evidence: string[] }[];
    };
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].summary).toBe('Escribí la spec de demo');
    expect(ledger.entries[0].evidence).toEqual(['requirements.md']);
  });

  it('backup create + verify declara íntegro, y un fichero manipulado hace fallar verify con salida 1', async () => {
    const cwd = await makeProject();

    const create = makeIO();
    expect(await runCli(['backup', 'create', '--out', '.sdd/backups/wiring', '--no-footer'], runtime, create.io, {}, { cwd })).toBe(0);
    expect(create.logs.join('\n')).toContain('Respaldo escrito');

    const verify = makeIO();
    expect(await runCli(['backup', 'verify', '.sdd/backups/wiring', '--no-footer'], runtime, verify.io, {}, { cwd })).toBe(0);
    expect(verify.logs.join('\n')).toContain('Respaldo íntegro');

    // Un respaldo que no supera su propio manifiesto NUNCA se declara bueno.
    await writeFile(
      path.join(cwd, '.sdd/backups/wiring/files/specs/demo/requirements.md'),
      '# Requirements\n\nREQ-DEMO-999 manipulado\n',
      'utf8',
    );
    const tampered = makeIO();
    expect(await runCli(['backup', 'verify', '.sdd/backups/wiring', '--no-footer'], runtime, tampered.io, {}, { cwd })).toBe(1);
    expect(tampered.errs.join('\n')).toContain('NO supera su propio manifiesto');
  });

  it('backup restore sin --write es una simulación y no toca el disco', async () => {
    const cwd = await makeProject();
    expect(await runCli(['backup', 'create', '--out', '.sdd/backups/wiring', '--no-footer'], runtime, makeIO().io, {}, { cwd })).toBe(0);

    const target = path.join(cwd, '.sdd/specs/demo/requirements.md');
    const changed = '# Requirements\n\nEste texto se escribió DESPUÉS del respaldo.\n';
    await writeFile(target, changed, 'utf8');

    const restore = makeIO();
    const code = await runCli(['backup', 'restore', '.sdd/backups/wiring', '--no-footer'], runtime, restore.io, {}, { cwd });
    expect(code).toBe(0);
    expect(restore.logs.join('\n')).toContain('simulación');
    // Nada se escribió: el fichero posterior al respaldo sigue exactamente como estaba.
    expect(await readFile(target, 'utf8')).toBe(changed);
  });

  it('backup restore clasifica una ruta que escapa como ERROR, no como aviso', async () => {
    const cwd = await makeProject();
    expect(await runCli(['backup', 'create', '--out', '.sdd/backups/wiring', '--no-footer'], runtime, makeIO().io, {}, { cwd })).toBe(0);

    // Un manifiesto que declara una ruta fuera de la carga es un RECHAZO, no una omisión silenciosa.
    const manifestPath = path.join(cwd, '.sdd/backups/wiring/manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { files: { path: string; bytes: number; sha256: string }[] };
    manifest.files.push({ path: '../escape.txt', bytes: 1, sha256: 'deadbeef' });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const human = makeIO();
    expect(await runCli(['backup', 'restore', '.sdd/backups/wiring', '--no-footer'], runtime, human.io, {}, { cwd })).toBe(1);
    expect(human.errs.join('\n')).toContain('escapa de la raíz del respaldo');

    const json = makeIO();
    expect(await runCli(['backup', 'restore', '.sdd/backups/wiring', '--json'], runtime, json.io, {}, { cwd })).toBe(1);
    const envelope = JSON.parse(json.logs.join('\n')) as {
      ok: boolean;
      findings: { errors: { message: string }[] };
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.findings.errors.some((finding) => finding.message.includes('escapa'))).toBe(true);
  });

  it('biography sin feature imprime el uso y sale con 1', async () => {
    const cwd = await makeProject();
    const ctx = makeIO();

    const code = await runCli(['biography', '--no-footer'], runtime, ctx.io, {}, { cwd });
    expect(code).toBe(1);
    expect(ctx.errs.join('\n')).toContain('Usage: open-sdd biography <feature>');
  });
});

describe('cli wiring — celebraciones', () => {
  it('status --celebrations renderiza el libro y --json es JSON parseable', async () => {
    const cwd = await makeProject();
    await write(
      cwd,
      '.sdd/state/celebrations.json',
      `${JSON.stringify(
        {
          version: 1,
          entries: [
            {
              feature: 'demo',
              date: '2026-09-20T00:00:00.000Z',
              score: 88,
              phase: 3,
              ears: { conforming: 4, total: 4 },
              pivot: { alignment: 1 },
              gates: { passed: 2, total: 2 },
              streak: 3,
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const human = makeIO();
    expect(await runCli(['status', '--celebrations', '--no-color', '--no-footer'], runtime, human.io, {}, { cwd })).toBe(0);
    const text = human.logs.join('\n');
    expect(text).toContain('VALIDACIONES REGISTRADAS: 1');
    expect(text).toContain('demo');
    expect(text).toContain('score 88/100');

    const json = makeIO();
    expect(await runCli(['status', '--celebrations', '--json'], runtime, json.io, {}, { cwd })).toBe(0);
    const parsed = JSON.parse(json.logs.join('\n')) as {
      count: number;
      features: string[];
      latest: { feature: string } | null;
      achievements: unknown[];
      corrupt: boolean;
    };
    expect(parsed.count).toBe(1);
    expect(parsed.features).toEqual(['demo']);
    expect(parsed.latest?.feature).toBe('demo');
    expect(parsed.corrupt).toBe(false);
    expect(parsed.achievements.length).toBeGreaterThan(0);
  });
});

describe('cli wiring — Stop hook en integrate y doctor', () => {
  it('integrate --write instala el Stop hook de claude-code y lo RECHAZA para un anfitrión no verificado', async () => {
    const cwd = await makeProject();

    const first = makeIO();
    const firstCode = await runCli(['integrate', 'claude-code', '--write', '--json', '--no-footer'], runtime, first.io, {}, { cwd });
    expect(firstCode).toBe(0);
    const firstPlan = JSON.parse(first.logs.join('\n')) as { artifacts: { kind: string; action: string }[] };
    const created = firstPlan.artifacts.find((artifact) => artifact.kind === 'stop-hook');
    expect(created?.action).toBe('create');
    // El hook quedó escrito de verdad, en el fichero que el anfitrión documenta.
    const settings = JSON.parse(await readFile(path.join(cwd, '.claude/settings.json'), 'utf8')) as {
      hooks: { Stop: unknown[] };
    };
    expect(Array.isArray(settings.hooks.Stop)).toBe(true);
    expect(settings.hooks.Stop.length).toBeGreaterThan(0);

    // Idempotente: la segunda ejecución lo conserva, no lo duplica.
    const second = makeIO();
    await runCli(['integrate', 'claude-code', '--write', '--json', '--no-footer'], runtime, second.io, {}, { cwd });
    const secondPlan = JSON.parse(second.logs.join('\n')) as { artifacts: { kind: string; action: string }[] };
    expect(secondPlan.artifacts.find((artifact) => artifact.kind === 'stop-hook')?.action).toBe('keep');

    // Un anfitrión cuyo mecanismo Stop NO está verificado se rechaza con su motivo: no se inventa.
    const cursor = makeIO();
    await runCli(['integrate', 'cursor', '--write', '--json', '--no-footer'], runtime, cursor.io, {}, { cwd });
    const cursorPlan = JSON.parse(cursor.logs.join('\n')) as { artifacts: { kind: string; action: string; reason: string }[] };
    const refused = cursorPlan.artifacts.find((artifact) => artifact.kind === 'stop-hook');
    expect(refused?.action).toBe('refused');
    expect(refused?.reason).toContain('no tiene un mecanismo Stop verificado');
    // Y no se escribió ningún fichero de hook para ese anfitrión.
    await expect(readFile(path.join(cwd, '.cursor/hooks.json'), 'utf8')).rejects.toThrow();
  });

  it('doctor reporta si el Stop hook está instalado para los anfitriones verificados', async () => {
    const cwd = await makeProject();
    await runCli(['integrate', 'claude-code', '--write', '--no-footer'], runtime, makeIO().io, {}, { cwd });

    const ctx = makeIO();
    expect(await runCli(['doctor', '--json', '--no-footer'], runtime, ctx.io, {}, { cwd })).toBeDefined();
    const report = JSON.parse(ctx.logs.join('\n')) as {
      stopHooks: { host: string; installed: boolean; action: string }[];
    };
    const claude = report.stopHooks.find((hook) => hook.host === 'claude-code');
    expect(claude?.installed).toBe(true);
    expect(claude?.action).toBe('keep');
    const codex = report.stopHooks.find((hook) => hook.host === 'codex');
    expect(codex?.installed).toBe(false);
    // Solo se reportan los anfitriones VERIFICADOS: ningún otro aparece.
    expect(report.stopHooks.map((hook) => hook.host).sort()).toEqual(['claude-code', 'codex']);
  });
});

describe('cli wiring — la ayuda no puede envejecer', () => {
  /**
   * Extrae del `--help` cada comando y subcomando NOMBRADO. La convención del texto es estable: una
   * línea de comando empieza por dos espacios y un token en minúsculas, y la parte de uso termina
   * donde empieza la descripción (dos o más espacios). Un segundo token `[a|b|c]` son subcomandos;
   * un segundo token suelto (`brownfield survey`, `progress record`) también.
   */
  const parseHelpCommands = (help: string): string[][] => {
    const out: string[][] = [];
    for (const raw of help.split('\n')) {
      const match = /^ {2}([a-z][a-z0-9-]*)(?=\s|\[|$)/.exec(raw);
      if (!match) continue;
      const command = match[1];
      if (command === 'npx') continue; // ejemplo de instalación, no un comando de este CLI
      const usage = raw.trim().split(/\s{2,}/)[0];
      const tokens = usage.split(' ').filter(Boolean);
      if (command === 'open-sdd') {
        out.push([]); // la puerta: `open-sdd` sin argumentos
        continue;
      }
      const second = tokens[1];
      if (second === undefined) {
        out.push([command]);
        continue;
      }
      const alternatives = /^\[([a-z0-9-]+(?:\|[a-z0-9-]+)+)\]$/.exec(second);
      if (alternatives) {
        for (const sub of alternatives[1].split('|')) out.push([command, sub]);
        continue;
      }
      if (/^[a-z][a-z0-9-]*$/.test(second)) {
        out.push([command, second]);
        continue;
      }
      out.push([command]);
    }
    // Sin duplicados: una misma invocación puede aparecer en la lista y en su línea descriptiva.
    const seen = new Set<string>();
    return out.filter((invocation) => {
      const key = invocation.join(' ');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  it('cada comando y subcomando del --help se despacha: ninguno responde «desconocido»', async () => {
    const cwd = await makeProject();

    const helpCtx = makeIO();
    expect(await runCli(['--help'], runtime, helpCtx.io, {}, { cwd })).toBe(0);
    const invocations = parseHelpCommands(helpCtx.logs.join('\n'));
    // Un mínimo de cordura: si el parser dejara de ver comandos, esta prueba no probaría nada.
    expect(invocations.length).toBeGreaterThan(40);
    expect(invocations.some((invocation) => invocation.join(' ') === 'govern constitution')).toBe(true);
    expect(invocations.some((invocation) => invocation.join(' ') === 'gitflow')).toBe(true);
    expect(invocations.some((invocation) => invocation.join(' ') === 'progress record')).toBe(true);
    expect(invocations.some((invocation) => invocation.join(' ') === 'backup restore')).toBe(true);
    expect(invocations.some((invocation) => invocation.join(' ') === 'biography')).toBe(true);

    // `mcp` es un servidor stdio de vida larga: se le da un stdin ya cerrado para que termine en vez
    // de quedarse leyendo el del proceso de pruebas. No es una excepción al contrato: se despacha.
    const originalStdin = Object.getOwnPropertyDescriptor(process, 'stdin');
    const failures: string[] = [];
    try {
      for (const invocation of invocations) {
        if (invocation[0] === 'mcp') {
          const closed = new Readable({ read() { this.push(null); } });
          Object.defineProperty(process, 'stdin', { value: closed, configurable: true, writable: true });
        }
        const ctx = makeIO();
        await runCli([...invocation, '--no-footer'], runtime, ctx.io, {}, { cwd });
        if (UNKNOWN.test(ctx.text())) {
          failures.push(`${invocation.join(' ') || '(puerta)'} → ${ctx.text().split('\n').find((line) => UNKNOWN.test(line)) ?? ''}`);
        }
      }
    } finally {
      if (originalStdin) Object.defineProperty(process, 'stdin', originalStdin);
    }

    expect(failures, `comandos del --help sin despacho:\n${failures.join('\n')}`).toEqual([]);
  }, 180_000);
});
