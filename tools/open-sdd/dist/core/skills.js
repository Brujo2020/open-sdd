/**
 * Skills as the unit of context AND privilege (§6.4) and the Auto-Skill Factory (§11.1).
 *
 * Principle: least privilege applied to attention. Selecting a skill is an access-control act
 * disguised as a context decision, which is why the selection is resolved from the impact graph
 * and never from the agent's own judgement — "un agente que elige sus propias capacidades es un
 * agente que negocia su propio nivel de acceso".
 *
 * HARD RULE: no skill widens the set of reachable MCP servers. Real widening exists, but it
 * lives in a registry of concessions with a named human actor, a reason and a date. A concession
 * that concedes itself does not count as a concession, and a skill declaring MCP access without
 * a matching registry entry is REJECTED while the attempt is logged.
 */
export const SKILL_CLASSES = [
    {
        klass: 'normativa',
        description: 'Cómo se hace aquí.',
        failureMode: 'Obsolescencia silenciosa.',
        widensCapability: false,
    },
    {
        klass: 'procedimental',
        description: 'Procedimiento y criterios de salida.',
        failureMode: 'Deriva respecto al procedimiento real.',
        widensCapability: false,
    },
    {
        klass: 'formato',
        description: 'Entregable de estructura fija.',
        failureMode: 'El más fácil de evaluar.',
        widensCapability: false,
    },
    {
        klass: 'instrumental',
        description: 'Instrucciones + capacidad ejecutable + servidores MCP que necesita.',
        failureMode: 'Es la única clase que amplía lo que el agente PUEDE HACER.',
        widensCapability: true,
    },
];
/** Progressive disclosure: startup reads only name + description (~100 tokens each). */
export const PROGRESSIVE_DISCLOSURE = [
    { level: 1, read: 'name + description', when: 'arranque', budget: '~100 tokens por skill' },
    { level: 2, read: 'cuerpo de SKILL.md', when: 'al activarse', budget: '—' },
    { level: 3, read: 'scripts/, references/, assets/', when: 'cuando la ejecución los invoca', budget: '—' },
];
const isExpired = (c, now) => Boolean(c.expiresAt && new Date(c.expiresAt).getTime() < now.getTime());
/**
 * Enforce the hard rule. A skill declaring MCP access without a matching concession is rejected
 * and the attempt is logged — rejection without logging teaches nothing.
 */
export const checkMcpPermissions = (declaredBySkills, concessions, now = new Date()) => {
    const undeclared = [];
    const expired = [];
    const invalid = [];
    for (const skill of declaredBySkills) {
        for (const server of skill.servers) {
            const match = concessions.find((c) => c.skill === skill.skill && c.server === server);
            if (!match) {
                undeclared.push({ skill: skill.skill, server });
                continue;
            }
            if (isExpired(match, now)) {
                expired.push({ skill: skill.skill, server });
                continue;
            }
            if (match.actor.trim().length === 0) {
                invalid.push({ skill: skill.skill, server, why: 'sin actor humano nombrado' });
                continue;
            }
            if (match.reason.trim().length === 0) {
                invalid.push({ skill: skill.skill, server, why: 'sin motivo registrado' });
            }
        }
    }
    const ok = undeclared.length === 0 && expired.length === 0 && invalid.length === 0;
    return {
        ok,
        undeclared,
        expired,
        invalid,
        detail: ok
            ? 'Toda ampliación de alcance MCP tiene concesión registrada con actor, motivo y fecha.'
            : `Ampliación de privilegio no válida: ${undeclared.length} sin concesión, ${expired.length} vencida(s), ${invalid.length} inválida(s). La skill se rechaza y el intento queda registrado.`,
    };
};
/**
 * Bidirectional permission check: the agent's list of invocable servers versus the server's list
 * of invocable agents. Discrepancies are silent failures — validate the org graph instead of
 * only declaring it.
 */
export const checkBidirectionalPermissions = (agentToServers, serverToAgents) => {
    const discrepancies = [];
    for (const a of agentToServers) {
        for (const s of a.servers) {
            const server = serverToAgents.find((x) => x.server === s);
            if (!server) {
                discrepancies.push(`El agente "${a.agent}" invoca "${s}", que no declara a nadie.`);
            }
            else if (!server.agents.includes(a.agent)) {
                discrepancies.push(`"${s}" no autoriza a "${a.agent}" en su propia lista.`);
            }
        }
    }
    for (const s of serverToAgents) {
        for (const a of s.agents) {
            const agent = agentToServers.find((x) => x.agent === a);
            if (!agent || !agent.servers.includes(s.server)) {
                discrepancies.push(`"${s.server}" autoriza a "${a}", que no lo declara alcanzable.`);
            }
        }
    }
    return { consistent: discrepancies.length === 0, discrepancies };
};
export const PROMOTION_LADDER = [
    {
        level: 1,
        name: 'Provisional',
        requirement: 'Patrón observado ≥ 2 veces.',
        effect: 'Inyección solo si se toca el fichero objetivo.',
    },
    {
        level: 2,
        name: 'Validated',
        requirement: 'Suite completa de Agentic QE limpia.',
        effect: 'Sugerencia de guía a nivel de módulo.',
    },
    {
        level: 3,
        name: 'Corporate',
        requirement: '10 iteraciones de integración limpias.',
        effect: 'Promoción a la constitución organizacional.',
    },
];
/**
 * Decide whether a factory candidate may be mounted. Output is CANDIDATES, not skills: they
 * enter the same quarantine as a memory lesson and cannot mount themselves. Every non-optional
 * constraint is checked here, because a system that fabricates skills and injects them would be
 * a privilege-escalation pipeline with good press.
 */
export const evaluateCandidate = (candidate) => {
    const reasons = [];
    if (candidate.declaresMcpServers.length > 0) {
        reasons.push('Ninguna skill fabricada puede declarar servidores MCP: la ampliación de alcance es una decisión humana registrada, nunca un efecto secundario de instalar una capacidad.');
    }
    if (candidate.evaluatedBy === candidate.generatedBy) {
        reasons.push('El juez no puede ser el autor (I4).');
    }
    if (candidate.evaluatingModelFamily.toLowerCase() === candidate.generatingModelFamily.toLowerCase()) {
        reasons.push('Heterogeneidad de familia: el evaluador no puede pertenecer a la misma familia de modelos que el generador.');
    }
    if (candidate.observations < 2) {
        reasons.push('Un patrón observado una sola vez no justifica una skill (nivel 1 exige ≥ 2).');
    }
    if (!candidate.reviewDate) {
        reasons.push('Todo candidato nace con fecha de revisión: sin ella no hay caducidad posible.');
    }
    if (!candidate.pattern || candidate.provenance.blocks.length === 0) {
        reasons.push('Falta el registro del patrón de origen (qué bloqueos y correcciones lo produjeron).');
    }
    let level = 0;
    if (reasons.length === 0)
        level = candidate.observations >= 2 ? 1 : 0;
    return {
        mountable: reasons.length === 0,
        level,
        reasons: reasons.length === 0
            ? ['Candidato válido en nivel 1 (Provisional): la primera grada no concede ningún privilegio.']
            : reasons,
    };
};
/** Expiry: two cycles without activation, or a vanished originating pattern, degrades to inactive. */
export const evaluateCandidateExpiry = (candidate, patternStillObserved, maxCyclesWithoutActivation = 2) => {
    if (!patternStillObserved) {
        return {
            action: 'retire',
            detail: 'El patrón de origen ya no se observa: la skill se degrada antes de retirarse.',
        };
    }
    if (candidate.activationCycles >= maxCyclesWithoutActivation) {
        return {
            action: 'degrade',
            detail: `${candidate.activationCycles} ciclos sin activación: se degrada a inactiva antes de retirarla.`,
        };
    }
    return { action: 'keep', detail: 'Patrón vigente y activación reciente.' };
};
/**
 * The four metrics a skill is judged by. The third is the only one that justifies keeping it;
 * the fourth must be null for anything the factory produced.
 */
export const SKILL_METRICS = [
    { metric: 'precisión y cobertura de activación', note: 'Los defectos son de la descripción y se arreglan ahí.' },
    { metric: 'coste marginal', note: 'Tokens frente a la línea base.' },
    { metric: 'efecto en el resultado', note: 'Tasa de aprobación de gates en el primer paso: la única métrica que justifica conservarla.' },
    { metric: 'privilegio concedido', note: 'Se audita como un rol, no como un fichero. Debe ser nulo.' },
];
/** Third-party policy, enforceable as a check on any imported skill. */
export const THIRD_PARTY_SKILL_POLICY = [
    'Origen declarado.',
    'Revisión antes de montarla.',
    'Ninguna skill de terceros puede, por sí sola, ampliar el conjunto de servidores MCP alcanzables.',
    'La ampliación de privilegio es una decisión humana registrada, nunca un efecto secundario de instalar una capacidad.',
];
