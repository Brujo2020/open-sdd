/**
 * Pruebas de comportamiento del servidor MCP.
 *
 * El servidor se conduce IMPORTANDO `runMcpServer` con flujos inyectados (`PassThrough` de entrada y
 * `Writable` colectores de salida): nada se arranca como subproceso y nada se escribe dentro del
 * repositorio. Los fixtures viven en `os.tmpdir()` y se limpian en `afterEach`.
 *
 * Lo que se afirma es comportamiento, no la forma completa del protocolo: la versión negociada, el
 * catálogo de herramientas con su JSON Schema, un veredicto de delta válido e inválido, un argumento
 * que falta convertido en `isError`, un método desconocido en `-32601`, la supervivencia a una línea
 * JSON rota, recursos presentes y ausentes, el context pack nombrando lo que falta y stdout llevando
 * SOLO protocolo (con el diagnóstico por stderr).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { renderConstitution, type Constitution } from '../src/core/index.js';
import { DEFAULT_PROTOCOL_VERSION } from '../src/mcp/protocol.js';
import { runMcpServer } from '../src/mcp/server.js';

const dirs: string[] = [];

const makeTmp = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-mcp-'));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true });
});

const write = async (root: string, rel: string, content: string): Promise<void> => {
  const target = path.join(root, rel);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
};

// ---------------------------------------------------------------------------------------------
// Arnés: servidor sobre flujos en memoria
// ---------------------------------------------------------------------------------------------

interface RpcError {
  code: number;
  message: string;
}

interface RpcResponse {
  jsonrpc?: string;
  id?: unknown;
  result?: {
    protocolVersion?: string;
    capabilities?: { tools?: unknown; resources?: unknown };
    serverInfo?: { name?: string; version?: string };
    tools?: { name: string; description: string; inputSchema: { type?: string; additionalProperties?: boolean } }[];
    resources?: { uri: string; name: string; mimeType: string }[];
    contents?: { uri: string; mimeType: string; text: string; _meta?: Record<string, unknown> }[];
    content?: { type: string; text: string }[];
    isError?: boolean;
    [key: string]: unknown;
  };
  error?: RpcError;
}

const collector = (): { stream: Writable; read: () => string } => {
  let text = '';
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      text += chunk.toString('utf8');
      callback();
    },
  });
  return { stream, read: () => text };
};

const rpc = (id: number, method: string, params?: unknown): string =>
  JSON.stringify({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) });

const callTool = (id: number, name: string, args: Record<string, unknown>): string =>
  rpc(id, 'tools/call', { name, arguments: args });

/** Notificación: SIN `id`, así que el servidor no debe responder nada (ni siquiera un error). */
const notify = (method: string, params?: unknown): string =>
  JSON.stringify({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) });

interface Session {
  code: number;
  stdout: string;
  stderr: string;
  responses: RpcResponse[];
  lines: string[];
}

const runSession = async (cwd: string, input: string[]): Promise<Session> => {
  const stdin = new PassThrough();
  const out = collector();
  const err = collector();
  const done = runMcpServer({ cwd, stdin, stdout: out.stream, stderr: err.stream });
  for (const line of input) stdin.write(`${line}\n`);
  stdin.end();
  const code = await done;
  // Un macrotask para que cualquier escritura pendiente de los colectores se asiente.
  await new Promise((resolve) => setImmediate(resolve));

  const stdout = out.read();
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
  return { code, stdout, stderr: err.read(), lines, responses: lines.map((line) => JSON.parse(line) as RpcResponse) };
};

/** El payload JSON del bloque de texto de `tools/call`. */
const payload = (response: RpcResponse): { tool: string; isError: boolean; detail: string; result: any } =>
  JSON.parse(response.result!.content![0].text);

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const VALID_DELTA = [
  '# Delta: demo — persistir el borrador',
  '',
  'Status: proposed',
  '',
  '## ADDED',
  '',
  '### REQ-DEMO-001 — Persistir el borrador',
  '',
  '- Statement: When the user saves, the system shall persist the draft.',
  '- Targets: src/drafts/save.ts',
  '- Contracts: test/drafts/save.test.ts',
  '',
].join('\n');

/** Entrada que PARSEA (id válido) pero no valida: sin enunciado EARS y sin objetivos. */
const INVALID_DELTA = [
  '# Delta: demo — rota',
  '',
  '## ADDED',
  '',
  '### REQ-DEMO-002 — Sin enunciado ni objetivos',
  '',
  '- Statement: guardar el borrador',
  '',
].join('\n');

const CONSTITUTION: Constitution = {
  project: 'demo',
  provenance: 'descriptive',
  establishedFacts: ['El stack en vigor es Node.js + TypeScript ESM + vitest.'],
  principles: [
    {
      id: 'C-STACK-FACT',
      title: 'Stack en vigor',
      level: 'SHOULD',
      restriction: 'El stack en vigor (Node.js, TypeScript ESM y vitest) se declara hecho establecido.',
      pattern: 'Un cambio de stack se tramita como enmienda con plan de migración aprobado.',
      justification: 'Modernizar sin pedido destruye el comportamiento anclado que nadie autorizó a cambiar.',
      provenance: 'descriptive',
      evidence: ['package.json'],
    },
  ],
  amendments: [],
};

const REQUIRED_TOOLS = [
  'open_sdd_status',
  'open_sdd_constitution_check',
  'open_sdd_validate_delta',
  'open_sdd_contracts',
  'open_sdd_impact',
  'open_sdd_reuse_search',
  'open_sdd_module_map',
  'open_sdd_plan_bootstrap',
  'open_sdd_rigor',
  'open_sdd_gates_run',
  'open_sdd_context_pack',
];

// ---------------------------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------------------------

describe('handshake MCP', () => {
  it('negocia la versión pedida cuando la implementa', async () => {
    const dir = await makeTmp();
    const session = await runSession(dir, [
      rpc(1, 'initialize', { protocolVersion: '2024-11-05', clientInfo: { name: 'host-de-prueba', version: '9' } }),
    ]);
    const result = session.responses[0].result!;
    expect(result.protocolVersion).toBe('2024-11-05');
    expect(result.serverInfo?.name).toBe('open-sdd');
    expect(result.capabilities?.tools).toBeTruthy();
    expect(result.capabilities?.resources).toBeTruthy();
  });

  it('cae a la versión por defecto cuando el cliente pide una que no implementamos', async () => {
    const dir = await makeTmp();
    const session = await runSession(dir, [rpc(1, 'initialize', { protocolVersion: '2099-01-01' })]);
    expect(session.responses[0].result?.protocolVersion).toBe(DEFAULT_PROTOCOL_VERSION);
  });

  it('responde a ping con un resultado vacío', async () => {
    const dir = await makeTmp();
    const session = await runSession(dir, [rpc(1, 'ping')]);
    expect(session.responses[0].error).toBeUndefined();
    expect(session.responses[0].result).toEqual({});
  });
});

// ---------------------------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------------------------

describe('tools/list', () => {
  it('devuelve todas las herramientas con JSON Schema cerrado', async () => {
    const dir = await makeTmp();
    const session = await runSession(dir, [rpc(1, 'tools/list')]);
    const tools = session.responses[0].result!.tools!;
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(REQUIRED_TOOLS));
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// tools/call
// ---------------------------------------------------------------------------------------------

describe('tools/call', () => {
  it('valida una delta correcta sin isError y una incorrecta con isError', async () => {
    const dir = await makeTmp();
    await write(dir, '.sdd/specs/demo/delta.md', VALID_DELTA);

    const session = await runSession(dir, [
      callTool(1, 'open_sdd_validate_delta', { feature: 'demo' }),
      callTool(2, 'open_sdd_validate_delta', { feature: 'demo', delta: INVALID_DELTA }),
    ]);

    const valid = payload(session.responses[0]);
    expect(valid.isError).toBe(false);
    expect(session.responses[0].result!.isError).toBe(false);
    expect(valid.result.present).toBe(true);
    expect(valid.result.delta.entries).toHaveLength(1);
    expect(valid.result.issues.filter((issue: { severity: string }) => issue.severity === 'error')).toHaveLength(0);

    const invalid = payload(session.responses[1]);
    expect(invalid.isError).toBe(true);
    expect(session.responses[1].result!.isError).toBe(true);
    const codes = invalid.result.issues
      .filter((issue: { severity: string }) => issue.severity === 'error')
      .map((issue: { code: string }) => issue.code);
    expect(codes).toContain('EARS');
    expect(codes).toContain('NO_TARGETS');
  });

  it('convierte un argumento requerido ausente en isError y sigue atendiendo el stream', async () => {
    const dir = await makeTmp();
    await write(dir, '.sdd/specs/demo/delta.md', VALID_DELTA);

    const session = await runSession(dir, [
      callTool(1, 'open_sdd_validate_delta', {}),
      rpc(2, 'ping'),
    ]);

    const missing = session.responses[0];
    expect(missing.error).toBeUndefined();
    expect(missing.result!.isError).toBe(true);
    expect(payload(missing).detail).toContain('feature');
    // El stream sobrevive: la siguiente petición se contesta con normalidad.
    expect(session.responses[1].result).toEqual({});
  });

  it('devuelve el panel de estado con el nivel de rigor declarado', async () => {
    const dir = await makeTmp();
    const session = await runSession(dir, [callTool(1, 'open_sdd_status', {})]);
    const parsed = payload(session.responses[0]);
    expect(parsed.result.level).toBe('spec-first');
    expect(typeof parsed.isError).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------------------------
// Robustez del protocolo
// ---------------------------------------------------------------------------------------------

describe('robustez JSON-RPC', () => {
  it('responde -32601 a un método desconocido', async () => {
    const dir = await makeTmp();
    const session = await runSession(dir, [rpc(7, 'tools/inexistente')]);
    expect(session.responses[0].id).toBe(7);
    expect(session.responses[0].error?.code).toBe(-32601);
  });

  it('sobrevive a una línea JSON malformada y contesta la siguiente petición', async () => {
    const dir = await makeTmp();
    const session = await runSession(dir, ['{esto no es json', rpc(2, 'ping')]);
    expect(session.responses[0].error?.code).toBe(-32700);
    expect(session.responses[0].id).toBeNull();
    expect(session.responses[1].id).toBe(2);
    expect(session.responses[1].result).toEqual({});
  });

  it('escribe SOLO protocolo en stdout y manda el diagnóstico a stderr', async () => {
    const dir = await makeTmp();
    const session = await runSession(dir, [notify('notifications/desconocida'), rpc(2, 'ping')]);

    for (const line of session.lines) {
      const decoded = JSON.parse(line) as { jsonrpc?: string };
      expect(decoded.jsonrpc).toBe('2.0');
    }
    expect(session.lines).toHaveLength(1);
    expect(session.stderr).toContain('notificación desconocida');
  });

  it('cierra con 0 cuando el cliente pide shutdown', async () => {
    const dir = await makeTmp();
    const session = await runSession(dir, [rpc(1, 'shutdown')]);
    expect(session.responses[0].result).toEqual({});
    expect(session.code).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Recursos
// ---------------------------------------------------------------------------------------------

describe('resources', () => {
  it('lista sdd://status y la constitución cuando existe', async () => {
    const dir = await makeTmp();
    await write(dir, '.sdd/steering/constitution.md', renderConstitution(CONSTITUTION));
    await write(dir, '.sdd/specs/demo/requirements.md', '# Requirements\n\n### REQ-DEMO-001: Algo\n');

    const session = await runSession(dir, [rpc(1, 'resources/list')]);
    const uris = session.responses[0].result!.resources!.map((resource) => resource.uri);
    expect(uris).toContain('sdd://status');
    expect(uris).toContain('sdd://steering/constitution.md');
    expect(uris).toContain('sdd://specs/demo/requirements.md');
  });

  it('lee la constitución cuando está presente', async () => {
    const dir = await makeTmp();
    await write(dir, '.sdd/steering/constitution.md', renderConstitution(CONSTITUTION));
    const session = await runSession(dir, [rpc(1, 'resources/read', { uri: 'sdd://steering/constitution.md' })]);
    const contents = session.responses[0].result!.contents!;
    expect(contents[0].mimeType).toBe('text/markdown');
    expect(contents[0].text).toContain('C-STACK-FACT');
  });

  it('da un error claro (no cadena vacía) cuando la constitución no está', async () => {
    const dir = await makeTmp();
    const session = await runSession(dir, [rpc(1, 'resources/read', { uri: 'sdd://steering/constitution.md' })]);
    expect(session.responses[0].result).toBeUndefined();
    expect(session.responses[0].error?.code).toBe(-32002);
    expect(session.responses[0].error?.message).toMatch(/no presente/i);
  });
});

// ---------------------------------------------------------------------------------------------
// Context pack
// ---------------------------------------------------------------------------------------------

describe('open_sdd_context_pack', () => {
  it('nombra lo que falta en lugar de omitir la clave', async () => {
    const dir = await makeTmp();
    const session = await runSession(dir, [callTool(1, 'open_sdd_context_pack', {})]);
    const parsed = payload(session.responses[0]);

    expect(parsed.result.constitution.present).toBe(false);
    expect(parsed.result.constitution.reason).toBeTruthy();
    expect(parsed.result.spec.present).toBe(false);
    expect(parsed.result.spec.reason).toBeTruthy();
    expect(parsed.result.absent).toContain('constitution');
    expect(parsed.result.absent).toContain('spec');
    expect(parsed.result.complete).toBe(false);
    // Las claves existen SIEMPRE: el host no debe confundir «falta» con «no se preguntó».
    for (const key of ['constitution', 'spec', 'moduleMap', 'rigor']) {
      expect(parsed.result).toHaveProperty(key);
    }
  });

  it('inyecta constitución, spec, mapa de módulos y rigor cuando todo está presente', async () => {
    const dir = await makeTmp();
    await write(dir, '.sdd/steering/constitution.md', renderConstitution(CONSTITUTION));
    await write(dir, '.sdd/specs/demo/requirements.md', '# Requirements\n\n### REQ-DEMO-001: Algo\n');
    await write(dir, '.sdd/specs/demo/tasks.md', '- [ ] 1. Hacer algo\n');
    await write(dir, '.sdd/specs/demo/delta.md', VALID_DELTA);
    await write(dir, '.sdd/settings/rigor.json', JSON.stringify({ level: 'spec-anchored', rationale: 'prueba', brownfield: true }));

    const session = await runSession(dir, [callTool(1, 'open_sdd_context_pack', { feature: 'demo' })]);
    const parsed = payload(session.responses[0]);

    expect(parsed.result.constitution.present).toBe(true);
    expect(parsed.result.constitution.principlesInForce.map((principle: { id: string }) => principle.id)).toContain(
      'C-STACK-FACT',
    );
    expect(parsed.result.spec.present).toBe(true);
    expect(parsed.result.spec.requirements.present).toBe(true);
    expect(parsed.result.spec.delta.present).toBe(true);
    expect(parsed.result.rigor.level).toBe('spec-anchored');
    expect(parsed.result.rigor.activeGates).toEqual(expect.arrayContaining(['C1', 'C2', 'C3', 'C6']));
  });
});
