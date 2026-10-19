/**
 * Servidor MCP de open-sdd: stdio puro, determinista y sin red.
 *
 * `runMcpServer` lee mensajes JSON-RPC de stdin, los despacha contra el registro de herramientas y
 * recursos (`./tools.js`) y escribe SOLO protocolo en stdout; cualquier diagnóstico va a stderr. No
 * hay backend de modelo, ni claves de API, ni llamadas de red: el servidor expone el motor local de
 * open-sdd a cualquier host que hable MCP.
 *
 * ── Decisiones que el código hace explícitas ────────────────────────────────────────────────────
 *  1. LOS FLUJOS SON INYECTABLES. `stdin`/`stdout`/`stderr` se pueden pasar en las opciones; en
 *     producción son los del proceso. Eso permite conducir el servidor entero desde un test sin
 *     arrancar un subproceso y sin tocar el protocolo.
 *  2. NADA SE ESCRIBE EN stdout QUE NO SEA PROTOCOLO. `log` escribe en stderr con el prefijo
 *     `[open-sdd mcp]`. Un `console.log` perdido corrompería el stream del host.
 *  3. EL DESPACHO ES SECUENCIAL. Las líneas se encadenan en una promesa (`queue`) en el orden en que
 *     llegan, para que dos peticiones no se respondan fuera de orden ni compartan estado a medias.
 *  4. `shutdown` SE CONTESTA ANTES DE PARAR. El handler devuelve `{}`, la respuesta se escribe y
 *     SOLO DESPUÉS (en un `setImmediate`) se cierra la lectura y se resuelve con 0. Parar antes
 *     dejaría al host sin la respuesta de su propia petición.
 *  5. UN FALLO INESPERADO DEVUELVE 1, no una traza. El transporte nunca lanza hacia el llamante.
 *
 * Subconjunto MCP implementado: `initialize`, `notifications/initialized`, `ping`, `tools/list`,
 * `tools/call`, `resources/list`, `resources/read`, `shutdown` (+ `exit` como notificación de
 * cortesía) y `notifications/cancelled` como no-op. Fuera, a propósito: prompts, sampling, roots,
 * logging, progreso, suscripciones a recursos y completions — no hacen falta para exponer el motor y
 * prometerlos sin implementarlos sería declarar capacidades falsas.
 */

import { createRequire } from 'node:module';
import type { Readable, Writable } from 'node:stream';
import { findRepoRoot, resolveSddDir } from '../core/index.js';
import {
  RPC_ERROR_CODES,
  RpcFault,
  JsonRpcPeer,
  asRecord,
  buildInitializeResult,
  type McpServerInfo,
  type RpcHandler,
  type RpcNotificationHandler,
} from './protocol.js';
import { callTool, listResources, listToolDescriptors, readResource, type McpToolContext } from './tools.js';

export interface RunMcpServerOptions {
  /** Directorio desde el que se resuelve el repositorio (se sube buscando .sdd/.kiro). */
  cwd: string;
  /** Entrada del protocolo; por defecto `process.stdin`. */
  stdin?: Readable;
  /** Salida del protocolo (SOLO mensajes JSON-RPC); por defecto `process.stdout`. */
  stdout?: Writable;
  /** Diagnóstico humano; por defecto `process.stderr`. */
  stderr?: Writable;
}

const SERVER_NAME = 'open-sdd';

/** Versión del paquete instalado, sin romper en un artefacto publicado que no trae el manifiesto. */
const readServerVersion = (): string => {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../../package.json') as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : 'dev';
  } catch {
    return 'dev';
  }
};

const SERVER_INSTRUCTIONS = [
  'Antes de editar, llama a open_sdd_context_pack para recibir la constitución, la especificación aplicable, el mapa de módulos y el rigor declarado.',
  'Antes de crear cualquier clase o método, llama a open_sdd_reuse_search: crear código que ya existe es duplicación.',
  'open_sdd_constitution_check es el pivote: un veredicto bloqueante debe poder citar un principio en vigor.',
  'isError=true nunca es un detalle de transporte: significa que la comprobación subyacente reportó un error o que no se pudo inspeccionar, y eso no es un aprobado.',
].join(' ');

const serverInfo = (): McpServerInfo => ({
  name: SERVER_NAME,
  version: readServerVersion(),
  instructions: SERVER_INSTRUCTIONS,
});

const describeClient = (params: unknown): string => {
  const client = asRecord(asRecord(params).clientInfo);
  const name = typeof client.name === 'string' && client.name.length > 0 ? client.name : 'cliente sin identificar';
  const version = typeof client.version === 'string' && client.version.length > 0 ? ` ${client.version}` : '';
  return `${name}${version}`;
};

interface ServerControl {
  stop: (reason: string) => void;
  log: (message: string) => void;
}

/** Handlers de petición del subconjunto MCP implementado. */
const buildHandlers = (context: McpToolContext, control: ServerControl): Record<string, RpcHandler> => ({
  initialize: (request) => {
    const params = asRecord(request.params);
    const result = buildInitializeResult(params, serverInfo());
    control.log(`initialize de ${describeClient(params)} → protocolo ${result.protocolVersion}`);
    return result;
  },
  ping: () => ({}),
  'tools/list': () => ({ tools: listToolDescriptors() }),
  'tools/call': async (request) => {
    const params = asRecord(request.params);
    const name = typeof params.name === 'string' ? params.name.trim() : '';
    if (name.length === 0) {
      throw new RpcFault(RPC_ERROR_CODES.invalidParams, 'tools/call exige el nombre de la herramienta en "name".');
    }
    const args = asRecord(params.arguments);
    const outcome = await callTool(name, args, context);
    const payload = {
      tool: name,
      isError: outcome.isError,
      detail: outcome.detail,
      result: outcome.data,
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      isError: outcome.isError,
    };
  },
  'resources/list': async () => ({ resources: await listResources(context) }),
  'resources/read': async (request) => {
    const params = asRecord(request.params);
    const uri = typeof params.uri === 'string' ? params.uri.trim() : '';
    if (uri.length === 0) {
      throw new RpcFault(RPC_ERROR_CODES.invalidParams, 'resources/read exige la URI del recurso en "uri".');
    }
    const content = await readResource(uri, context);
    return { contents: [content] };
  },
  shutdown: () => {
    control.log('shutdown solicitado por el cliente');
    // La respuesta se escribe primero; la parada llega en el siguiente macrotask (ver nota 4).
    setImmediate(() => control.stop('shutdown completado'));
    return {};
  },
});

const buildNotifications = (control: ServerControl): Record<string, RpcNotificationHandler> => ({
  'notifications/initialized': () => {
    control.log('cliente inicializado');
  },
  'notifications/cancelled': () => {
    // No hay trabajo cancelable: las herramientas son lecturas síncronas del repositorio.
  },
  exit: () => {
    setImmediate(() => control.stop('exit recibido'));
  },
});

/**
 * Arrancar el servidor MCP. Devuelve el código de salida: 0 cuando el cliente cierra la entrada o
 * pide `shutdown`, 1 si el transporte falla de forma irrecuperable.
 */
export const runMcpServer = async (options: RunMcpServerOptions): Promise<number> => {
  const input = options.stdin ?? process.stdin;
  const output = options.stdout ?? process.stdout;
  const diagnostic = options.stderr ?? process.stderr;
  const log = (message: string): void => {
    diagnostic.write(`[open-sdd mcp] ${message}\n`);
  };

  const root = await findRepoRoot(options.cwd);
  const context: McpToolContext = { cwd: root, sddDir: await resolveSddDir(root) };

  return await new Promise<number>((resolve) => {
    let settled = false;
    let queue: Promise<void> = Promise.resolve();

    const finish = (code: number, reason: string): void => {
      if (settled) return;
      settled = true;
      log(reason);
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.removeListener('error', onError);
      resolve(code);
    };

    const peer = new JsonRpcPeer({
      write: (line) => {
        output.write(`${line}\n`);
      },
      handlers: buildHandlers(context, { stop: (reason) => finish(0, reason), log }),
      notifications: buildNotifications({ stop: (reason) => finish(0, reason), log }),
      onDiagnostic: (message) => log(message),
    });

    const onData = (chunk: Buffer | string): void => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      queue = queue
        .then(() => peer.handleChunk(text))
        .catch((error: unknown) => log(`error procesando una línea: ${error instanceof Error ? error.message : String(error)}`));
    };

    const onEnd = (): void => {
      queue = queue.then(() => peer.flush()).catch(() => undefined);
      queue.then(() => finish(0, 'stdin cerrado')).catch(() => finish(1, 'fallo procesando la entrada'));
    };

    const onError = (error: Error): void => {
      finish(1, `error de lectura en stdin: ${error.message}`);
    };

    input.on('data', onData);
    input.on('end', onEnd);
    input.on('error', onError);
    if (typeof input.resume === 'function') input.resume();
  });
};
