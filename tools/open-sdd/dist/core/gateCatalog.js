/**
 * The Zero-Trust gate catalog — paper Appendix A, made machine-readable.
 *
 * Sources (verbatim from the reference architecture):
 *   - Table 33: the 21 logical gates (taxonomy), grouped by control level.
 *   - Table 34: the executable chain as declared (C1-C7, O1-O7), with posture/state.
 *   - Table 35: crosswalk implemented-check -> logical gate(s), plus retirement destinations.
 *   - Table 36: the residue of logical controls with NO executable counterpart.
 *
 * Two properties of the paper are encoded structurally rather than described:
 *
 *   1. The residue (Table 36) is COMPUTED BY SUBTRACTION, never curated. If someone adds a
 *      logical gate or wires a new executable check, both the crosswalk and the residue move
 *      on their own. The manuscript cannot claim a control that the running chain does not
 *      implement.
 *   2. `inspects` distinguishes activation from measurement (§4.9). C7/Karpathy returns success
 *      without inspecting anything; the paper says so explicitly and refuses to call it a real
 *      check. We keep that distinction visible instead of laundering it into "executable".
 */
/**
 * Table 33 — the 21 logical gates. The admission flags are our derivation from A1/A2/A3
 * (§9.3): they are shown per gate so a reader can disagree with a specific row instead of
 * with an accumulated count.
 */
export const LOGICAL_GATES = [
    {
        id: 'G1',
        name: 'Claridad de Requisitos',
        nameEn: 'Requirements clarity',
        tier: 'Hard',
        check: 'Requisitos inequívocos, conformes a EARS',
        failureSemantics: 'Bloqueo; vuelve al Redactor de Specs',
        admission: { silence: true, independence: true, costAsymmetry: true },
        state: 'executable',
    },
    {
        id: 'G2',
        name: 'Completitud de Contexto',
        nameEn: 'Context completeness',
        tier: 'Hard',
        check: 'Todo el contexto requerido cargado de memoria',
        failureSemantics: 'Bloqueo; recarga de contexto',
        admission: { silence: true, independence: true, costAsymmetry: true },
        state: 'executable',
        retiredTo: 'O6 (C8-scoped: file-reference existence)',
    },
    {
        id: 'G3',
        name: 'Resolución de Dependencias',
        nameEn: 'Dependency resolution',
        tier: 'Hard',
        check: 'Dependencias satisfechas y conocidas-buenas',
        failureSemantics: 'Bloqueo; fijar o sustituir dependencia',
        admission: { silence: true, independence: true, costAsymmetry: true },
        state: 'executable',
        retiredTo: 'O1 (Dependency Provenance / SLSA-SBOM)',
    },
    {
        id: 'G4',
        name: 'Consistencia Arquitectónica',
        nameEn: 'Architectural consistency',
        tier: 'Structural',
        check: 'El diseño respeta arquitectura/ADRs',
        failureSemantics: 'Rechazo de diff; anota el plan',
        admission: { silence: true, independence: true, costAsymmetry: true },
        state: 'executable',
        retiredTo: 'O4 (ADR Consistency)',
    },
    {
        id: 'G5',
        name: 'Línea Base de Seguridad',
        nameEn: 'Security baseline',
        tier: 'Structural',
        check: 'Sin secretos, inyecciones ni vulnerabilidades conocidas',
        failureSemantics: 'Aborta; limpia buffer; HIL',
        admission: { silence: true, independence: true, costAsymmetry: true },
        state: 'executable',
    },
    {
        id: 'G6',
        name: 'Descomposición de Tareas',
        nameEn: 'Task decomposition',
        tier: 'Structural',
        check: 'Trabajo descompuesto en DAG ejecutable',
        failureSemantics: 'Vuelve a planificación',
        admission: { silence: true, independence: true, costAsymmetry: true },
        state: 'executable',
        retiredTo: 'C1 (Triad Integrity)',
    },
    {
        id: 'G7',
        name: 'Cobertura de Riesgos',
        nameEn: 'Risk coverage',
        tier: 'Structural',
        check: 'Los riesgos identificados llevan mitigación',
        failureSemantics: 'Bloqueo hasta mitigar',
        admission: { silence: false, independence: true, costAsymmetry: false },
        state: 'retired',
        retiredTo: 'spec-checklist (histórico)',
        residueReason: 'La cobertura de riesgos exige conocer los riesgos; una verificación automática solo comprobaría que un campo de mitigación no esté vacío, lo que mide teatro de cumplimiento y no cobertura. La configuración la retira al checklist de spec justamente por eso.',
    },
    {
        id: 'G8',
        name: 'Calidad de Código',
        nameEn: 'Code quality',
        tier: 'QE',
        check: 'Lint, formato, estilo',
        failureSemantics: 'Bucle de reparación',
        admission: { silence: false, independence: true, costAsymmetry: false },
        state: 'retired',
        retiredTo: 'CI',
        residueReason: 'Retirado a CI: lint y formato ya los impone la toolchain existente del proyecto, y duplicarlos dentro del arnés agregaría latencia sin agregar control. Se lista porque la taxonomía nombra el control, no a su dueño.',
    },
    {
        id: 'G9',
        name: 'Cobertura de Tests',
        nameEn: 'Test coverage',
        tier: 'QE',
        check: 'Tests existen y pasan; umbral mantenido',
        failureSemantics: 'Fuerza tests adicionales',
        admission: { silence: true, independence: true, costAsymmetry: true },
        state: 'executable',
    },
    {
        id: 'G10',
        name: 'Integridad de Integración',
        nameEn: 'Integration integrity',
        tier: 'QE',
        check: 'Sin conflictos de merge; las oleadas integran',
        failureSemantics: 'Re-integración; re-ejecución',
        admission: { silence: false, independence: true, costAsymmetry: true },
        state: 'retired',
        retiredTo: 'CI',
        residueReason: 'Retirado a CI (conflictos, build, suite) en vez de duplicarse dentro del arnés; el gate existe en la taxonomía porque el control debe nombrarse aunque otro sistema sea su dueño.',
    },
    {
        id: 'G11',
        name: 'Seguridad de Regresión',
        nameEn: 'Regression safety',
        tier: 'QE',
        check: 'Funcionalidad existente intacta',
        failureSemantics: 'Bucle de reparación con evidencia',
        admission: { silence: false, independence: true, costAsymmetry: true },
        state: 'retired',
        retiredTo: 'suite de tests existente (evidencia validada por C3)',
        residueReason: 'La seguridad ante regresiones la sostiene la suite de tests existente, cuya evidencia valida C3, y no un gate propio; el gate de rendimiento del esquema 1 que lo habría extendido nunca se implementó y no sobrevivió a la consolidación del esquema 2, así que no reclamamos el control como impuesto por derecho propio.',
    },
    {
        id: 'G12',
        name: 'Documentación',
        nameEn: 'Documentation',
        tier: 'QE',
        check: 'Código y decisiones documentados',
        failureSemantics: 'Auto-generación; verificación',
        admission: { silence: true, independence: true, costAsymmetry: false },
        state: 'executable',
        retiredTo: 'PR-checklist + C6 (Claims Integrity)',
    },
    {
        id: 'G13',
        name: 'Chequeo de Alucinaciones',
        nameEn: 'Hallucination check',
        tier: 'Meta',
        check: 'Sin APIs/métodos/rutas inventados',
        failureSemantics: 'Inyecta log de fallo; reintento',
        admission: { silence: true, independence: true, costAsymmetry: true },
        state: 'executable',
    },
    {
        id: 'G14',
        name: 'Chequeo de Consistencia',
        nameEn: 'Consistency check',
        tier: 'Meta',
        check: 'Sin contradicciones a lo largo de la sesión',
        failureSemantics: 'Revisión META-EVAL',
        admission: { silence: true, independence: false, costAsymmetry: false },
        state: 'executable',
        retiredTo: 'C5 (Intent Alignment / Meta-Judge)',
    },
    {
        id: 'G15',
        name: 'Alineamiento de Intención',
        nameEn: 'Intent alignment',
        tier: 'Meta',
        check: 'La salida coincide con la intención/spec original',
        failureSemantics: 'Veredicto META-EVAL; HIL',
        admission: { silence: true, independence: false, costAsymmetry: true },
        state: 'executable',
    },
    {
        id: 'G16',
        name: 'Intercepción MCP',
        nameEn: 'MCP interception',
        tier: 'Meta',
        check: 'Intercepta y valida llamadas a herramientas/APIs MCP',
        failureSemantics: 'Bloqueo inmediato del payload',
        admission: { silence: true, independence: true, costAsymmetry: true },
        state: 'executable',
        retiredTo: 'O2 (MCP Proxy Validation)',
    },
    {
        id: 'G17',
        name: 'Disciplina de Salida',
        nameEn: 'Output discipline',
        tier: 'Transversal',
        check: 'Formato de salida restringido activo (gramática Caveman, Apéndice B.1)',
        failureSemantics: 'Bloqueo; reconfigurar modo de salida',
        admission: { silence: false, independence: true, costAsymmetry: false },
        state: 'retired',
        retiredTo: 'modes.yaml (ajuste de modo)',
        residueReason: 'Retirado a un ajuste de modo (configs/modes.yaml): un incumplimiento de la disciplina de salida es inmediatamente visible para quien lee y no daña ningún artefacto, así que no pasa el test de asimetría que un gate debe pasar. Es una perilla de configuración, no un control.',
    },
    {
        id: 'G18',
        name: 'Memoria Viva',
        nameEn: 'Living memory',
        tier: 'Transversal',
        check: 'La captura de lecciones funciona y el inbox se destila con frecuencia mínima',
        failureSemantics: 'Bloqueo del cierre de ciclo; forzar destilado',
        admission: { silence: true, independence: true, costAsymmetry: false },
        state: 'executable',
        retiredTo: 'O5 (Living Memory)',
    },
    {
        id: 'G19',
        name: 'Conocimiento Estructural',
        nameEn: 'Structural knowledge',
        tier: 'Transversal',
        check: 'El grafo del codebase existe y está actualizado respecto al HEAD',
        failureSemantics: 'Regenerar grafo antes de tareas de alcance amplio',
        admission: { silence: true, independence: true, costAsymmetry: false },
        state: 'executable',
        retiredTo: 'O3 (Graph Freshness)',
    },
    {
        id: 'G20',
        name: 'Integridad de Afirmaciones',
        nameEn: 'Claims integrity',
        tier: 'Transversal',
        check: 'Lo que la documentación dice que existe coincide con lo que el código contiene',
        failureSemantics: 'Bloqueo; regenerar el estado de features',
        admission: { silence: true, independence: true, costAsymmetry: true },
        state: 'executable',
        retiredTo: 'O1 (Dependency Provenance / SLSA-SBOM)',
    },
    {
        id: 'G21',
        name: 'Disciplina del Implementador',
        nameEn: 'Implementer discipline',
        tier: 'Transversal',
        check: 'Guías de Karpathy activas (Sección 4.9): pensar-primero, simplicidad, alcance quirúrgico, guiado por objetivos, incertidumbre declarada',
        failureSemantics: 'Previsto como bloqueo; no implementado: gate_C7 retorna éxito sin inspeccionar nada, y la configuración lo declara advisorio',
        admission: { silence: false, independence: false, costAsymmetry: false },
        state: 'vacuous',
    },
];
/**
 * Table 34 — the executable chain as declared. `inspects: false` for C7 is not a bug in this
 * port: it is the paper's own finding (§4.9, §7.7) that the Karpathy gate emits success
 * unconditionally, which is why the chain must publish declared-vs-executed explicitly.
 */
export const EXECUTABLE_CHAIN = [
    {
        id: 'C1',
        name: 'Triad Integrity (SDD)',
        nameEn: 'Triad integrity',
        command: 'sh-gate triad --spec',
        posture: 'advisory',
        imposes: ['G1', 'G6'],
        tier: ['Hard', 'Structural'],
        inspects: true,
        requiresModel: false,
        description: 'Documentary Triad present, approved and internally consistent; EARS conformance of requirements.',
    },
    {
        id: 'C2',
        name: 'Security Baseline',
        nameEn: 'Security baseline',
        command: 'sh-gate security',
        posture: 'blocking',
        imposes: ['G5'],
        tier: ['Structural'],
        inspects: true,
        requiresModel: false,
        description: 'No committed secrets, no destructive commands, no prompt-injection patterns in shipped artifacts.',
    },
    {
        id: 'C3',
        name: 'Evidence Validation',
        nameEn: 'Evidence validation',
        command: 'sh-gate evidence',
        posture: 'advisory',
        imposes: ['G9'],
        tier: ['QE'],
        inspects: true,
        requiresModel: false,
        description: 'Every completed task carries captured proof; no completeness claim without the output that would falsify it (I2).',
    },
    {
        id: 'C4',
        name: 'Hallucination Check (grep + graph dual-mode)',
        nameEn: 'Hallucination check',
        command: 'sh-gate hallucination',
        posture: 'advisory',
        imposes: ['G13'],
        tier: ['Meta'],
        inspects: true,
        requiresModel: false,
        description: 'Symbols referenced by a change resolve to definitions in this repository; outside the declared domain the verdict is undecidable and says so.',
    },
    {
        id: 'C5',
        name: 'Intent Alignment (Meta-Judge)',
        nameEn: 'Intent alignment',
        command: 'sh-gate intent',
        posture: 'advisory',
        imposes: ['G15', 'G14'],
        tier: ['Meta'],
        inspects: true,
        requiresModel: true,
        description: 'Intent alignment and session consistency. Requires a judge from a different model family than PATCH; without a backend it degrades to a declared heuristic and never counts as evidence.',
    },
    {
        id: 'C6',
        name: 'Claims Integrity (Doc vs Code)',
        nameEn: 'Claims integrity',
        command: 'sh-gate claims',
        posture: 'advisory',
        imposes: ['G20', 'G12'],
        tier: ['QE', 'Transversal'],
        inspects: true,
        requiresModel: false,
        description: 'Every claim in the docs is bound to an executable check; the feature-status inventory is generated from code, not transcribed.',
    },
    {
        id: 'C7',
        name: 'Karpathy Discipline',
        nameEn: 'Implementer discipline',
        command: 'sh-gate karpathy',
        posture: 'advisory',
        imposes: ['G21'],
        tier: ['Transversal'],
        inspects: false,
        requiresModel: false,
        description: 'Declared but vacuous: the reference gate returns success without inspecting anything. Activation and measurement are labelled separately, not merged.',
    },
    {
        id: 'O1',
        name: 'Dependency Provenance (SLSA/SBOM)',
        nameEn: 'Dependency provenance',
        command: 'sh-gate provenance',
        posture: 'opt-in',
        imposes: ['G3'],
        tier: ['Hard'],
        inspects: true,
        requiresModel: false,
        description: 'Dependency manifests are present and locked; provenance recorded for the resolved set.',
    },
    {
        id: 'O2',
        name: 'MCP Proxy Validation',
        nameEn: 'MCP proxy validation',
        command: 'sh-gate mcp',
        posture: 'opt-in',
        imposes: ['G16'],
        tier: ['Meta'],
        inspects: true,
        requiresModel: false,
        description: 'Declared MCP servers are checked against an explicit allow-list; unlisted servers block.',
    },
    {
        id: 'O3',
        name: 'Graph Freshness (Structural Sync)',
        nameEn: 'Graph freshness',
        command: 'sh-gate graph',
        posture: 'opt-in',
        imposes: ['G19'],
        tier: ['Transversal'],
        inspects: true,
        requiresModel: false,
        description: 'The structural index exists and is fresh against HEAD — never against the working tree (a degraded mode that always fires is a gate that is always off).',
    },
    {
        id: 'O4',
        name: 'ADR Consistency',
        nameEn: 'ADR consistency',
        command: 'sh-gate adr',
        posture: 'opt-in',
        imposes: ['G4'],
        tier: ['Structural'],
        inspects: true,
        requiresModel: false,
        description: 'Architecture decisions referenced by a change exist as ADRs and are not superseded without a successor.',
    },
    {
        id: 'O5',
        name: 'Living Memory (Obsidian)',
        nameEn: 'Living memory',
        command: 'sh-gate memory',
        posture: 'opt-in',
        imposes: ['G18'],
        tier: ['Transversal'],
        inspects: true,
        requiresModel: false,
        description: 'The lesson inbox was distilled within the declared cadence; quarantine is not injected directly.',
    },
    {
        id: 'O6',
        name: 'Context Integrity (C8-scoped: file-reference existence)',
        nameEn: 'Context integrity',
        command: 'sh-gate context',
        posture: 'opt-in',
        imposes: ['G2'],
        tier: ['Hard'],
        inspects: true,
        requiresModel: false,
        description: 'Every file referenced by the loaded context exists; missing references block instead of being silently dropped.',
    },
    {
        id: 'O7',
        name: 'Swarm Claim Overlap',
        nameEn: 'Swarm claim overlap',
        command: 'sh-gate swarm',
        posture: 'opt-in',
        imposes: [],
        tier: [],
        inspects: true,
        requiresModel: false,
        description: 'Parallel agents claim disjoint file sets with a TTL; overlapping live claims block before a race exists.',
    },
];
export const DEFAULT_SIGNALS = {
    declaresThirdPartyMcpServers: false,
    hasAdrRecords: false,
    exceedsContextWindow: false,
    hasDependencyManifest: false,
    multipleAuthors: false,
    requiresStructuralGraph: false,
    hasLivingMemory: false,
};
/** Human-readable name of the signal that activated each opt-in control. */
const SIGNAL_LABELS = {
    declaresThirdPartyMcpServers: 'declara servidores MCP de terceros',
    hasAdrRecords: 'tiene decisiones de arquitectura registradas',
    exceedsContextWindow: 'su tamaño excede la ventana de contexto',
    hasDependencyManifest: 'arrastra manifiestos de dependencias',
    multipleAuthors: 'trabaja en él más de una persona',
    requiresStructuralGraph: 'mantiene un grafo estructural',
    hasLivingMemory: 'tiene memoria viva configurada',
};
/**
 * Profile policy. The paper publishes the measured counts on its own repository (7 / 9 / 12)
 * and states the correct formulation: the core is constant, the rest is a function of signals
 * evaluated per repository. The exact signal-to-control table is not published, so we DECLARE
 * ours here — in one place, auditable — and let the counts fall out of it instead of hardcoding
 * them. On a repository matching the paper's profile this policy yields exactly 7 / 9 / 12.
 */
const PROFILE_MANDATED = {
    solo: [],
    team: ['O1', 'O5'],
    regulated: ['O1', 'O2', 'O3', 'O4', 'O5'],
};
const CONTROL_SIGNAL = {
    O1: 'hasDependencyManifest',
    O2: 'declaresThirdPartyMcpServers',
    O3: 'requiresStructuralGraph',
    O4: 'hasAdrRecords',
    O5: 'hasLivingMemory',
    O6: 'exceedsContextWindow',
    O7: 'multipleAuthors',
};
const gateById = new Map(EXECUTABLE_CHAIN.map((g) => [g.id, g]));
export const getExecutableGate = (id) => gateById.get(id);
/**
 * Resolve the chain from catalog + profile + signals (§9.5).
 *
 * The executor has no opinion: it cannot run a control the profile did not enable, and it
 * cannot silently drop one that is enabled but unimplemented. Unimplemented controls are
 * counted, not executed, and reported while the gap exists — the alternative is either
 * under-declaring the government actually exercised, or fabricating evidence with an empty
 * function that returns success.
 */
export const resolveGateChain = (profile, signals = DEFAULT_SIGNALS) => {
    const core = EXECUTABLE_CHAIN.filter((g) => g.posture !== 'opt-in').map((g) => g.id);
    const profileMandated = PROFILE_MANDATED[profile].map((id) => {
        const gate = getExecutableGate(id);
        return { id, reason: `perfil ${profile}`, ...(gate ? {} : {}) };
    });
    const mandatedIds = new Set(PROFILE_MANDATED[profile]);
    const signalActivated = [];
    // The recommended (report-only) profile resolves the constant core and nothing else: the
    // activable layer is what the team and regulated profiles switch on. This is why a repository
    // with a dependency manifest still resolves 7 controls under the recommended profile.
    if (profile !== 'solo') {
        for (const gate of EXECUTABLE_CHAIN) {
            if (gate.posture !== 'opt-in')
                continue;
            if (mandatedIds.has(gate.id))
                continue;
            const signal = CONTROL_SIGNAL[gate.id];
            if (!signal || !signals[signal])
                continue;
            signalActivated.push({ id: gate.id, reason: SIGNAL_LABELS[signal], signal });
        }
    }
    const declared = [...core, ...profileMandated.map((c) => c.id), ...signalActivated.map((c) => c.id)];
    const notImplemented = [];
    const vacuous = [];
    const executed = [];
    const advisory = [];
    const blocking = [];
    for (const id of declared) {
        const gate = gateById.get(id);
        if (!gate)
            continue;
        if (!gate.inspects) {
            vacuous.push({
                id,
                reason: 'declarado y en ejecución, pero no inspecciona nada: activación sin medición',
            });
            continue;
        }
        if (gate.implemented === false) {
            notImplemented.push({
                id,
                reason: 'habilitado por el perfil y NO implementado: se cuenta en la cadena, no se ejecuta y se reporta mientras exista la brecha',
            });
            continue;
        }
        executed.push(id);
        if (gate.posture === 'blocking')
            blocking.push(id);
        if (gate.posture === 'advisory')
            advisory.push(id);
    }
    return {
        profile,
        core,
        profileMandated,
        signalActivated,
        declared,
        executed,
        notImplemented,
        vacuous,
        advisory,
        blocking,
    };
};
export const detectSignals = (evidence) => {
    const signals = { ...DEFAULT_SIGNALS };
    const rows = [];
    for (const signal of Object.keys(DEFAULT_SIGNALS)) {
        const detail = evidence[signal];
        const value = Boolean(detail);
        signals[signal] = value;
        rows.push({ signal, value, detail: detail ?? 'no detectada' });
    }
    return { signals, evidence: rows };
};
/** Crosswalk: logical gate -> executable checks that impose it (Table 35, derived). */
export const buildCrosswalk = () => {
    const byLogical = LOGICAL_GATES.map((g) => ({
        gate: g.id,
        imposedBy: EXECUTABLE_CHAIN.filter((c) => c.imposes.includes(g.id)).map((c) => c.id),
    }));
    const byCheck = EXECUTABLE_CHAIN.map((c) => ({ check: c.id, imposes: [...c.imposes] }));
    return { byLogical, byCheck };
};
/**
 * Table 36 — the residue, computed by subtraction and never curated. A logical control is in
 * the residue when NO executable check imposes it and it is not the vacuous case (a declared
 * control that runs without inspecting is reported separately as activation without
 * measurement, because it is a different defect: one has no owner, the other has an owner and
 * no instrument).
 */
export const computeResidue = () => {
    const covered = new Set(EXECUTABLE_CHAIN.flatMap((c) => c.imposes));
    return LOGICAL_GATES.filter((g) => !covered.has(g.id) && g.state !== 'vacuous').map((g) => ({
        id: g.id,
        name: g.name,
        tier: g.tier,
        retroTo: g.retiredTo ?? '—',
        reason: g.residueReason ?? 'sin contraparte ejecutable',
    }));
};
/** Counts for the honesty inventory; generated, never transcribed. */
export const catalogSummary = () => {
    const covered = new Set(EXECUTABLE_CHAIN.flatMap((c) => c.imposes));
    return {
        logical: LOGICAL_GATES.length,
        executable: EXECUTABLE_CHAIN.filter((c) => c.inspects).length,
        vacuous: EXECUTABLE_CHAIN.filter((c) => !c.inspects).length,
        covered: LOGICAL_GATES.filter((g) => covered.has(g.id)).length,
        residue: computeResidue().length,
    };
};
