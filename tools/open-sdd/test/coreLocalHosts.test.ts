/**
 * Overlay local — filas privadas que nunca tocan la matriz publica.
 *
 * Lo que se prueba aqui es la disciplina, no la comodidad: una fila privada se rechaza por defecto, no
 * puede declararse verificada sin nombrar el artefacto que la evidencia, no puede pisar una fila
 * publicada, y un fichero roto se degrada en un aviso en vez de tumbar el CLI. Y las matrices siguen
 * puras: este modulo NO se carga al importarlas, solo lo hace el punto de entrada del CLI.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  LOCAL_HOSTS_ENV,
  installLocalHosts,
  loadLocalHosts,
  parseLocalHosts,
  validateLocalHost,
} from '../src/core/localHosts.js';
import { commandHostById, HOST_COMMAND_TEMPLATES } from '../src/core/commandTemplates.js';
import { HOST_INTEGRATIONS, integrationById } from '../src/core/integrations.js';

const temps: string[] = [];
const makeDir = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-overlay-'));
  temps.push(dir);
  return dir;
};
afterEach(async () => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

const row = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'host-privado',
  label: 'Private Host',
  dir: '.private/workflows',
  invocation: '/sdd-<id>',
  sourceArtifact: 'private-agent-1.0.0.vsix',
  evidence: 'verificado contra el paquete que aporta el equipo dueño',
  ...extra,
});

describe('overlay local — parseo y validacion', () => {
  it('un fichero que no parsea es un AVISO, nunca una excepcion', () => {
    const broken = parseLocalHosts('{ no soy json');
    expect(broken.rows).toEqual([]);
    expect(broken.issues.join('\n')).toContain('no parsea');
    const shape = parseLocalHosts('{"otra": []}');
    expect(shape.rows).toEqual([]);
    expect(shape.issues.join('\n')).toContain('hosts');
  });

  it('una fila privada se RECHAZA por defecto: `verified: true` exige nombrar su artefacto', () => {
    const taken = new Set<string>();
    const withoutArtifact = validateLocalHost({ id: 'x', label: 'X', dir: '.x/workflows', verified: true }, taken);
    expect(withoutArtifact.ok).toBe(false);
    if (!withoutArtifact.ok) expect(withoutArtifact.reason).toContain('sourceArtifact');

    const withoutSurface = validateLocalHost({ id: 'y', label: 'Y' }, taken);
    expect(withoutSurface.ok).toBe(false);

    const escaping = validateLocalHost({ id: 'z', label: 'Z', dir: '../../etc' }, taken);
    expect(escaping.ok).toBe(false);
  });

  it('un fichero local NO puede pisar una fila publicada', () => {
    const taken = new Set(HOST_COMMAND_TEMPLATES.map((host) => host.id));
    const collision = validateLocalHost({ id: 'cursor', label: 'Fake Cursor', dir: '.fake' }, taken);
    expect(collision.ok).toBe(false);
    if (!collision.ok) expect(collision.reason).toContain('matriz publica');
  });

  it('un `snippetRef` desconocido se rechaza nombrando los que existen', () => {
    const result = validateLocalHost(
      row({ mcp: { configPaths: { linux: '.private/mcp.json' }, snippetRef: 'inventado' } }),
      new Set<string>(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('mcpServers');
  });
});

describe('overlay local — instalacion y aislamiento', () => {
  it('instala las filas validas y salta las invalidas con su motivo', () => {
    const before = HOST_COMMAND_TEMPLATES.length;
    const report = installLocalHosts([
      row() as never,
      { id: 'roto', label: 'Roto', dir: '.roto', verified: true } as never,
    ]);
    try {
      expect(report.loaded).toEqual(['host-privado']);
      expect(report.skipped.map((s) => s.id)).toEqual(['roto']);
      expect(HOST_COMMAND_TEMPLATES.length).toBe(before + 1);
      expect(commandHostById('host-privado')?.dir).toBe('.private/workflows');
      expect(commandHostById('host-privado')?.fileName('specify')).toBe('sdd-specify.md');
      expect(commandHostById('host-privado')?.invocation('specify')).toBe('/sdd-specify');
    } finally {
      const stillThere = HOST_COMMAND_TEMPLATES.pop();
      expect(stillThere?.id).toBe('host-privado');
    }
    expect(commandHostById('host-privado')).toBeUndefined();
  });

  it('la fila de MCP entra con su forma y con el veredicto que el fichero declara', () => {
    const before = HOST_INTEGRATIONS.length;
    const report = installLocalHosts([
      row({
        mcp: {
          configPaths: { linux: '.private/mcp.json', darwin: '.private/mcp.json' },
          snippetRef: 'mcpServers',
          verified: false,
        },
      }) as never,
    ]);
    try {
      expect(report.loaded).toEqual(['host-privado']);
      const host = integrationById('host-privado')!;
      expect(HOST_INTEGRATIONS.length).toBe(before + 1);
      // Refusado por defecto: la fila no dijo `mcp.verified: true`.
      expect(host.mcp.verified).toBe(false);
      expect(host.mcp.snippet('/opt/cli.js')).toContain('mcpServers');
    } finally {
      HOST_INTEGRATIONS.pop();
    }
  });

  it('un fichero ausente es el caso normal y no dice nada; uno ilegible avisa', async () => {
    const dir = await makeDir();
    const silent = loadLocalHosts({ path: path.join(dir, 'no-existe.json') });
    // Con ruta explicita, el silencio no vale: se avisa.
    expect(silent.issues.join('\n')).toContain('no se puede leer');

    const good = loadLocalHosts({ env: {} as NodeJS.ProcessEnv, path: path.join(dir, 'tampoco.json') });
    expect(good.path).not.toBeNull();

    // Y el caso realmente normal: sin variable y sin fichero de usuario, no hay nada que reportar.
    const none = loadLocalHosts({ env: {} as NodeJS.ProcessEnv });
    expect(none.path).toBeNull();
    expect(renderIsEmpty(none.issues)).toBe(true);
  });

  it('el fichero de usuario por defecto vive FUERA del repositorio', () => {
    const target = loadLocalHosts({ env: { XDG_CONFIG_HOME: '/tmp/xdg' } as unknown as NodeJS.ProcessEnv });
    // No se puede leer (no existe), pero la ruta declarada no esta dentro de un arbol de trabajo.
    expect(target.path === null || !target.path.startsWith(process.cwd())).toBe(true);
    expect(LOCAL_HOSTS_ENV).toBe('OPEN_SDD_LOCAL_HOSTS');
  });
});

const renderIsEmpty = (issues: string[]): boolean => issues.length === 0;
