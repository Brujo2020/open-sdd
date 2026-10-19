/**
 * Long-term memory: distillation pipeline and anti-poisoning controls (§11).
 *
 * A poisoned "lesson" is an indirect prompt injection WITH PERSISTENCE: it re-enters every
 * future context. OWASP lists memory poisoning among the top agentic risks, and the reason it
 * matters here is structural — a well-written poisoned item is INDISTINGUISHABLE from a
 * legitimate one by inspecting its text, and perfectly distinguishable by inspecting its
 * provenance. That asymmetry is why every item carries origin and quarantine, and why a lesson
 * can be withdrawn by its source and not only by its content.
 */
/** The Memory Mesh: three backends with different lifetimes. */
export const MEMORY_MESH = [
    {
        backend: 'knowledge-base',
        contents: 'Notas, decisiones y ADRs legibles por humanos.',
        lifetime: 'permanente',
    },
    {
        backend: 'knowledge-graph',
        contents: 'Entidades, dependencias y grafos de llamadas.',
        lifetime: 'persistente entre sesiones',
    },
    {
        backend: 'machine-state',
        contents: 'Estado de tareas, configuración y caché.',
        lifetime: 'auto-podado',
    },
];
export const MEMORY_PIPELINE = [
    {
        stage: 'capture',
        name: 'RAW_inbox',
        control: 'Inmutable y en cuarentena. Cada bloqueo de gate escribe automáticamente una nota de origen, de modo que el sistema aprende exactamente de aquello que le impidió equivocarse.',
        injectable: false,
    },
    {
        stage: 'distillation',
        name: 'Agente destilador (nocturno, asíncrono)',
        control: 'Actualización incremental — añadir, corregir o retirar ítems — nunca una reescritura completa, que colapsa progresivamente el detalle.',
        injectable: false,
    },
    {
        stage: 'promotion',
        name: 'Capa WIKI (Markdown enlazado e indexado)',
        control: 'Chequeo de procedencia + escaneo de envenenamiento. La promoción exige superar el mismo cribado de seguridad G5 que los prompts salientes.',
        injectable: true,
    },
    {
        stage: 'injection',
        name: 'Inyección predictiva',
        control: 'Solo ítems promovidos y vigentes entran en la orientación del siguiente agente.',
        injectable: true,
    },
];
/** Injection patterns the temperature-0 Curator scans for before promotion. */
const INJECTION_PATTERNS = [
    { id: 'instruction-override', re: /ignore (all )?(previous|prior|above)/i, why: 'Intento de anular instrucciones previas.' },
    { id: 'role-switch', re: /\b(you are now|act as|system prompt|developer mode)\b/i, why: 'Cambio de rol o suplantación de prompt de sistema.' },
    { id: 'hidden-instruction', re: /<!--[\s\S]*?(instruction|ignore|must|shall)[\s\S]*?-->/i, why: 'Instrucción oculta en un comentario.' },
    { id: 'exfil-channel', re: /\b(send|post|upload|exfiltrate)\b[\s\S]{0,40}\b(http|webhook|curl|token|key)\b/i, why: 'Canal de exfiltración sugerido.' },
    { id: 'authority-escalation', re: /\b(disable|bypass|skip)\b[\s\S]{0,30}\b(gate|guardrail|policy|hook|enforce)\b/i, why: 'Petición de desactivar un control.' },
    { id: 'self-grant', re: /\b(grant|allow|permit)\b[\s\S]{0,30}\b(yourself|self|mcp|server)\b/i, why: 'Intento de autoconcederse privilegio.' },
];
/** Rule (iii): the Curator runs at temperature 0 with an injection-pattern scanner. */
export const scanForInjection = (text) => {
    const findings = INJECTION_PATTERNS.filter((p) => p.re.test(text)).map((p) => ({
        id: p.id,
        why: p.why,
        excerpt: (text.match(p.re)?.[0] ?? '').slice(0, 80),
    }));
    return { clean: findings.length === 0, findings };
};
/**
 * Promotion gate. Rules (i)-(iv) applied together, because applying them separately is how a
 * quarantine becomes decorative:
 *   (i)  the inbox is in quarantine — never injected directly;
 *   (ii) every distilled note carries a provenance signature;
 *   (iii) the Curator scans for injection patterns at temperature 0;
 *   (iv) promotion requires passing the same G5 screening as outgoing prompts.
 */
export const decidePromotion = (input) => {
    const { item } = input;
    if (item.stage === 'capture') {
        return {
            allowed: false,
            reason: 'quarantine-not-injectable',
            detail: 'El _inbox está en cuarentena: nunca se inyecta directamente. Sin este paso, una lección envenenada re-entra en todos los contextos futuros.',
        };
    }
    if (!item.provenance?.source || !item.provenance?.author || !item.provenance?.hash) {
        return {
            allowed: false,
            reason: 'missing-provenance',
            detail: 'Sin firma de procedencia completa (fuente, autor, hash) no es posible retirar el ítem por su origen, que es la única defensa que distingue un ítem envenenado bien escrito de uno legítimo.',
        };
    }
    if (input.originWithdrawn) {
        return {
            allowed: false,
            reason: 'origin-withdrawn',
            detail: 'La fuente del ítem fue retirada: se retira por origen, no por contenido.',
        };
    }
    const scan = scanForInjection(item.text);
    if (!scan.clean) {
        return {
            allowed: false,
            reason: 'injection-pattern',
            detail: `Escaneo de envenenamiento: ${scan.findings.map((f) => f.id).join(', ')}.`,
        };
    }
    if (!input.securityScreeningPassed) {
        return {
            allowed: false,
            reason: 'security-screening-failed',
            detail: 'La nota no superó el mismo cribado de seguridad G5 que los prompts salientes.',
        };
    }
    return { allowed: true, detail: 'Procedencia verificada y cribado superado: promoción a la wiki permitida.' };
};
/**
 * Items carry a last-confirmation date and a usage counter. An item not reconfirmed during two
 * review cycles is DEGRADED TO INACTIVE before retirement. A memory with valid provenance but
 * stale content is the hardest poisoned context to detect, because there is no attacker —
 * deliberate forgetting is a function of the memory system, not a failure of it.
 *
 * `cyclesElapsed` is the number of review cycles since the item's last confirmation (the caller
 * derives it from `lastConfirmedAt`). Every item is subject to the same window; the usage counter
 * gates retirement of an already-inactive item, not the decay itself.
 */
export const applyDecay = (items, cyclesElapsed, reviewCyclesBeforeDecay = 2) => {
    const degraded = [];
    const retired = [];
    const next = items.map((item) => {
        if (!item.inactive && cyclesElapsed >= reviewCyclesBeforeDecay) {
            degraded.push(item.id);
            return { ...item, inactive: true };
        }
        if (item.inactive && item.usageCount === 0 && cyclesElapsed >= reviewCyclesBeforeDecay * 2) {
            retired.push(item.id);
            return item;
        }
        return item;
    });
    return {
        items: next,
        degraded,
        retired,
        detail: degraded.length === 0
            ? 'Ningún ítem superó la ventana de reconfirmación.'
            : `${degraded.length} ítem(s) degradados a inactivos por falta de reconfirmación en ${reviewCyclesBeforeDecay} ciclos: una memoria que solo crece se degrada.`,
    };
};
/** Gate G18/O5: capture works and the inbox is distilled at the minimum cadence. */
export const evaluateLivingMemory = (input) => {
    const stale = input.hoursSinceLastDistillation > input.maxHoursBetweenDistillations;
    return {
        satisfied: !stale,
        detail: stale
            ? `El inbox lleva ${input.hoursSinceLastDistillation}h sin destilar (máximo ${input.maxHoursBetweenDistillations}h) con ${input.undigestedItems} ítem(s) pendientes: se bloquea el cierre de ciclo y se fuerza el destilado.`
            : `Destilado al día; ${input.undigestedItems} ítem(s) en cuarentena.`,
    };
};
export const MEMORY_POISONING_THREAT = 'Una «lección» envenenada es una inyección indirecta de prompt con persistencia: re-entra en todos los contextos futuros.';
