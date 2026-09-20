/**
 * Framing JSON-RPC 2.0 + handshake MCP sobre stdio.
 *
 * Esta pieza es deliberadamente pequeña y sin dependencias: el servidor MCP es el contrato AGNÓSTICO
 * del producto (cualquier host que hable MCP puede usarlo sin código por host), así que el transporte
 * no puede depender del SDK de nadie ni de un backend de modelo. Todo lo que hay aquí es texto de
 * entrada, texto de salida y las reglas del protocolo.
 *
 * ── Decisiones que se hacen explícitas ──────────────────────────────────────────────────────────
 *  1. UNA LÍNEA = UN MENSAJE. El framing de MCP sobre stdio es JSON delimitado por saltos de línea.
 *     `LineFramer` acumula trozos (un `chunk` de stdin no respeta fronteras) y entrega líneas
 *     completas; las líneas vacías se ignoran porque no son mensajes, no son un error del cliente.
 *  2. UN MENSAJE ROTO NO ROMPE EL FLUJO. JSON malformado produce `-32700` con `id: null` y el peer
 *     SIGUE LEYENDO. Igual con una petición de forma inválida (`-32600`) o un método desconocido
 *     (`-32601`): el cliente se equivoca, el servidor no muere.
 *  3. NOTIFICACIÓN ≠ PETICIÓN. Sin `id` no hay respuesta, ni siquiera de error: responder a una
 *     notificación inventa un `id` que el cliente no pidió. Una notificación de método desconocido se
 *     diagnostica por stderr y se descarta.
 *  4. LA VERSIÓN SE NEGOCIA, NO SE IMPONE. Si el cliente pide una versión que implementamos, se
 *     devuelve ESA; si pide otra cosa, se devuelve la por defecto (`2024-11-05`). Nunca se responde
 *     con una versión que no implementamos: prometer un subconjunto que no existe es peor que
 *     degradar de forma visible.
 *  5. DIAGNÓSTICO POR stderr. El peer recibe `onDiagnostic`; el servidor lo conecta a stderr. stdout
 *     es SOLO protocolo, porque un `console.log` perdido corrompe el stream del host.
 *
 * Los textos visibles (mensajes de error del protocolo) son español, como el resto del CLI.
 */
export const JSONRPC_VERSION = '2.0';
/** Versión MCP por defecto: la que implementa este servidor. */
export const DEFAULT_PROTOCOL_VERSION = '2024-11-05';
/**
 * Versiones que este servidor implementa de verdad. La negociación solo puede elegir de aquí: si el
 * cliente pide una versión más nueva, devolverla sería declarar capacidades que no existen.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2024-10-07'];
/** Códigos de error JSON-RPC 2.0 y el código MCP de «recurso no encontrado». */
export const RPC_ERROR_CODES = {
    parseError: -32700,
    invalidRequest: -32600,
    methodNotFound: -32601,
    invalidParams: -32602,
    internalError: -32603,
    /** MCP: el recurso pedido no existe. Se usa para «no presente», nunca para una cadena vacía. */
    resourceNotFound: -32002,
};
/**
 * Fallo deliberado de un handler: lleva el código JSON-RPC que el cliente debe ver. Un `Error`
 * normal se convierte en `-32603` (error interno), que es lo honesto: no sabemos que la culpa sea
 * del cliente.
 */
export class RpcFault extends Error {
    code;
    data;
    constructor(code, message, data) {
        super(message);
        this.name = 'RpcFault';
        this.code = code;
        if (data !== undefined)
            this.data = data;
    }
}
export const toErrorObject = (error, method) => {
    if (error instanceof RpcFault) {
        return { code: error.code, message: error.message, ...(error.data !== undefined ? { data: error.data } : {}) };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
        code: RPC_ERROR_CODES.internalError,
        message: method ? `Error interno al ejecutar "${method}": ${message}` : `Error interno: ${message}`,
    };
};
export const successResponse = (id, result) => ({
    jsonrpc: JSONRPC_VERSION,
    id,
    result,
});
export const errorResponse = (id, error) => ({
    jsonrpc: JSONRPC_VERSION,
    id,
    error,
});
/**
 * Negociar la versión: la pedida si la implementamos, la por defecto en cualquier otro caso
 * (incluido un cliente que no manda versión, que es un cliente antiguo o roto).
 */
export const negotiateProtocolVersion = (requested) => typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : DEFAULT_PROTOCOL_VERSION;
/** Resultado de `initialize`, con la versión ya negociada. */
export const buildInitializeResult = (params, info) => {
    const record = asRecord(params);
    const version = negotiateProtocolVersion(record.protocolVersion);
    return {
        protocolVersion: version,
        capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false, subscribe: false },
        },
        serverInfo: { name: info.name, version: info.version },
        ...(info.instructions ? { instructions: info.instructions } : {}),
    };
};
/** Objeto JSON seguro: cualquier otra cosa (array, null, primitivo) se trata como `{}`. */
export const asRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
// ---------------------------------------------------------------------------------------------
// Framing: una línea = un mensaje
// ---------------------------------------------------------------------------------------------
/**
 * Acumulador de líneas. Un `chunk` de stdin puede partir un mensaje por la mitad, así que el resto
 * se guarda hasta el próximo trozo (o hasta `flush`, cuando el flujo termina).
 */
export class LineFramer {
    buffer = '';
    /** Líneas COMPLETAS contenidas en el trozo; el resto queda en el buffer. */
    push(chunk) {
        this.buffer += chunk;
        const parts = this.buffer.split('\n');
        this.buffer = parts.pop() ?? '';
        return parts.map((line) => line.replace(/\r$/, '')).filter((line) => line.trim().length > 0);
    }
    /** Lo que quedó sin salto final, al cerrarse la entrada. */
    flush() {
        const rest = this.buffer;
        this.buffer = '';
        const line = rest.replace(/\r$/, '');
        return line.trim().length > 0 ? [line] : [];
    }
}
const invalidRequest = (id, message) => ({
    kind: 'invalid',
    id,
    error: { code: RPC_ERROR_CODES.invalidRequest, message },
});
/** `id` válido: string, número o null. Presente pero de otro tipo hace inválida la petición. */
const readId = (value) => {
    if (value === undefined || value === null)
        return { valid: true, id: null };
    if (typeof value === 'string' || typeof value === 'number')
        return { valid: true, id: value };
    return { valid: false, id: null };
};
/**
 * Decodificar y validar UNA línea. Nunca lanza: un JSON roto es un mensaje inválido, y el llamante
 * decide qué responder. El `id` se conserva cuando se pudo leer, para que el cliente sepa a qué
 * petición se le contesta.
 */
export const parseJsonRpcMessage = (raw) => {
    let decoded;
    try {
        decoded = JSON.parse(raw);
    }
    catch (error) {
        return {
            kind: 'invalid',
            id: null,
            error: {
                code: RPC_ERROR_CODES.parseError,
                message: `JSON malformado: ${error instanceof Error ? error.message : String(error)}`,
            },
        };
    }
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
        return invalidRequest(null, 'Una petición JSON-RPC debe ser un objeto (los lotes no están soportados).');
    }
    const message = decoded;
    const { valid, id } = readId(message.id);
    if (!valid)
        return invalidRequest(null, 'El campo "id" debe ser una cadena, un número o null.');
    if (message.jsonrpc !== JSONRPC_VERSION) {
        return invalidRequest(id, `El campo "jsonrpc" debe ser exactamente "${JSONRPC_VERSION}".`);
    }
    if (typeof message.method !== 'string' || message.method.trim().length === 0) {
        return invalidRequest(id, 'Falta el campo "method" (cadena no vacía).');
    }
    const params = 'params' in message ? message.params : undefined;
    if (Object.prototype.hasOwnProperty.call(message, 'id')) {
        return {
            kind: 'request',
            request: {
                jsonrpc: JSONRPC_VERSION,
                id,
                method: message.method,
                ...(params !== undefined ? { params } : {}),
            },
        };
    }
    return {
        kind: 'notification',
        notification: { jsonrpc: JSONRPC_VERSION, method: message.method, ...(params !== undefined ? { params } : {}) },
    };
};
/**
 * Despachador JSON-RPC. No conoce MCP: solo framing, errores y despacho. Eso es lo que lo hace
 * testeable sin arrancar un proceso y lo que garantiza que un handler que lanza no rompa el stream.
 */
export class JsonRpcPeer {
    framer = new LineFramer();
    options;
    constructor(options) {
        this.options = options;
    }
    /** Alimentar un trozo de stdin; procesa las líneas completas en orden. */
    async handleChunk(chunk) {
        for (const line of this.framer.push(chunk))
            await this.handleLine(line);
    }
    /** Procesar lo que quedó sin salto final al cerrarse la entrada. */
    async flush() {
        for (const line of this.framer.flush())
            await this.handleLine(line);
    }
    /** Procesar una línea ya completa. Nunca lanza. */
    async handleLine(raw) {
        const parsed = parseJsonRpcMessage(raw);
        if (parsed.kind === 'invalid') {
            this.diagnose(`mensaje descartado: ${parsed.error.message}`);
            this.respond(errorResponse(parsed.id, parsed.error));
            return;
        }
        if (parsed.kind === 'notification') {
            await this.dispatchNotification(parsed.notification.method, parsed.notification.params);
            return;
        }
        await this.dispatchRequest(parsed.request);
    }
    async dispatchRequest(request) {
        const handler = this.options.handlers[request.method];
        if (!handler) {
            this.respond(errorResponse(request.id, {
                code: RPC_ERROR_CODES.methodNotFound,
                message: `Método desconocido: "${request.method}".`,
            }));
            return;
        }
        try {
            const result = await handler({ id: request.id, method: request.method, params: request.params, notification: false });
            this.respond(successResponse(request.id, result === undefined ? null : result));
        }
        catch (error) {
            const fault = toErrorObject(error, request.method);
            this.diagnose(`"${request.method}" falló: ${fault.message}`);
            this.respond(errorResponse(request.id, fault));
        }
    }
    async dispatchNotification(method, params) {
        const handler = this.options.notifications?.[method];
        if (!handler) {
            this.diagnose(`notificación desconocida descartada: "${method}"`);
            return;
        }
        try {
            await handler({ id: null, method, params, notification: true });
        }
        catch (error) {
            this.diagnose(`la notificación "${method}" falló: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    respond(response) {
        this.write(JSON.stringify(response));
    }
    write(line) {
        this.options.write(line);
    }
    diagnose(message) {
        this.options.onDiagnostic?.(message);
    }
}
