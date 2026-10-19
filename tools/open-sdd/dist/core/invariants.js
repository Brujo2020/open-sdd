/**
 * Framework invariants (Table 17) and conformity levels (Table 18).
 *
 * The paper's point is that a framework which cannot be suspended is not a framework, so the
 * operational content of its definition is not the component list but these invariants and the
 * conformity levels that follow. Each invariant is written as a property checkable by
 * inspecting artifacts — never by trusting the implementer's account.
 *
 * I6 is load-bearing: an instance that violates I6 falls outside the framework however well it
 * satisfies the rest. Relaxation must be an event, not an absence.
 */
export const INVARIANTS = [
    {
        id: 'I1',
        statement: 'Todo veredicto bloqueante cita un principio constitucional o un identificador de requisito',
        prevents: 'Rechazar por reglas que nadie escribió y que al generador nunca se le dieron',
        inspection: 'Every blocking verdict carries an authority field citing a constitution principle id or an EARS requirement id.',
    },
    {
        id: 'I2',
        statement: 'Ninguna afirmación de completitud se acepta sin la salida capturada de la comprobación que la habría falsado',
        prevents: 'Que el autoinforme de un modelo sustituya a un resultado',
        inspection: 'A task marked complete is rejected unless it carries the captured stdout/stderr of the check that would have falsified it.',
    },
    {
        id: 'I3',
        statement: 'La garantía se declara por anfitrión, y el suelo está en una frontera que la organización posee',
        prevents: 'Prometer bloqueo universal sobre un hook que un proveedor puede retirar',
        inspection: 'Enforcement is reported per host tool, and the guaranteed floor resolves to commit/merge boundaries the organization owns.',
    },
    {
        id: 'I4',
        statement: 'El agente que produce un artefacto no lo certifica',
        prevents: 'Que quien implementa se corrija a sí mismo el examen',
        inspection: 'The producing identity and the certifying identity differ, and the certifying judge belongs to a different model family.',
    },
    {
        id: 'I5',
        statement: 'Las restricciones cargadas para un cambio son las que ese cambio puede violar, no el corpus entero',
        prevents: 'Documentos de gobierno degradándose más allá del presupuesto de atención en que se leen',
        inspection: 'The constraint set loaded for a change is scoped to its impact radius; the whole corpus is not loaded.',
    },
    {
        id: 'I6',
        statement: 'Toda relajación es un evento registrado con actor, motivo y el hash al que aplica',
        prevents: 'La desactivación silenciosa que deja el control presente en el informe de cumplimiento',
        inspection: 'The relaxation ledger contains an entry per relaxation with actor, reason and target hash; the ledger is non-empty when controls were relaxed.',
    },
];
export const getInvariant = (id) => INVARIANTS.find((i) => i.id === id);
export const CONFORMITY_LEVELS = [
    {
        level: 'C0',
        name: 'Declarativo',
        requires: [],
        evaluatorCheck: 'Una constitución versionada. Nada se impone; el documento existe y se enmienda deliberadamente.',
    },
    {
        level: 'C1',
        name: 'Con suelo',
        requires: ['I1', 'I2', 'I3'],
        evaluatorCheck: 'Un cambio rechazado, y el principio o identificador que citó ese rechazo.',
    },
    {
        level: 'C2',
        name: 'Mediado',
        requires: ['I1', 'I2', 'I3', 'I4', 'I6'],
        evaluatorCheck: 'El registro de una relajación: quién, por qué, contra qué hash.',
    },
    {
        level: 'C3',
        name: 'Calibrado',
        requires: ['I1', 'I2', 'I3', 'I4', 'I5', 'I6'],
        evaluatorCheck: 'El corpus etiquetado, y la tasa de desactivación junto a la de bloqueo.',
    },
];
/**
 * Assess conformity from evidence, never from assertion.
 *
 * The paper claims C2 for its own instance and states that C3 "exige mediciones que no hemos
 * hecho" because it requires a labelled corpus plus the false-positive rate alongside the
 * blocking rate. We keep that hole visible: `calibrated` is only true when a measured
 * false-positive rate is supplied.
 */
export const assessConformity = (evidence, measuredFalsePositiveRate) => {
    const byId = new Map(evidence.map((e) => [e.id, e]));
    const satisfied = (id) => byId.get(id)?.satisfied === true;
    let level = 'C0';
    for (const tier of CONFORMITY_LEVELS) {
        if (tier.requires.every(satisfied))
            level = tier.level;
    }
    const tier = CONFORMITY_LEVELS.find((t) => t.level === level);
    const idx = CONFORMITY_LEVELS.findIndex((t) => t.level === level);
    const next = idx >= 0 && idx < CONFORMITY_LEVELS.length - 1 ? CONFORMITY_LEVELS[idx + 1] : null;
    return {
        level,
        name: tier.name,
        evidence,
        // C3 requires a measured rate; a declared-but-unmeasured instance stays calibrated=false.
        calibrated: level === 'C3' && typeof measuredFalsePositiveRate === 'number',
        nextLevelRequires: next,
    };
};
/** Which invariants the active gate chain can actually produce evidence for. */
export const invariantsNotEvidenced = (assessment) => assessment.evidence.filter((e) => !e.satisfied).map((e) => e.id);
