/**
 * META-EVAL: anti-drift step, Cohen's kappa and the limits of automated judgement
 * (§7.3, §7.4, status: pilot; kappa = 0.86, n = 15).
 *
 * What the coefficient measures and what it does not. The pilot reports two significant figures
 * and no more: with n = 15 the confidence interval around a kappa of this magnitude is wide
 * enough to span "moderate" to "almost perfect" on the Landis-Koch scale, and a point estimate
 * with four decimals invites the reader to treat as settled what the sample cannot settle.
 *
 * More important: the corpus was written by the same team that built the evaluator, so what the
 * coefficient measures is INTRA-AUTHOR consistency — whether a labelling tradition agrees with
 * itself — not inter-rater reliability. It is evidence that the pipeline runs and produces
 * stable verdicts. It is NOT evidence that the verdicts are correct, and it must not be cited as
 * if it were.
 */
/** Landis-Koch: kappa >= 0.61 is the floor of "substantial" agreement. */
export const SUBSTANTIAL_KAPPA = 0.61;
/** Below this the judge stopped being comparable: triggers evaluator reset. */
export const KAPPA_RESET_THRESHOLD = 0.6;
/** Pre-registered sample size that would make the estimate informative. */
export const PREREGISTERED_N = 120;
const landisKoch = (k) => {
    if (Number.isNaN(k))
        return 'undefined';
    if (k < 0.0)
        return 'poor';
    if (k <= 0.2)
        return 'slight';
    if (k <= 0.4)
        return 'fair';
    if (k <= 0.6)
        return 'moderate';
    if (k <= 0.8)
        return 'substantial';
    return 'almost-perfect';
};
/** Cohen's kappa for two raters with binary labels. */
export const cohensKappa = (input) => {
    const { truePositive: tp, trueNegative: tn, falsePositive: fp, falseNegative: fn } = input;
    const n = tp + tn + fp + fn;
    if (n === 0) {
        return {
            kappa: Number.NaN,
            observedAgreement: Number.NaN,
            expectedAgreement: Number.NaN,
            n: 0,
            band: 'undefined',
            tooSmallToConclude: true,
            preregisteredN: PREREGISTERED_N,
            detail: 'Sin observaciones: el coeficiente queda indefinido en todos los pares.',
        };
    }
    const po = (tp + tn) / n;
    const pYes = ((tp + fp) / n) * ((tp + fn) / n);
    const pNo = ((tn + fn) / n) * ((tn + fp) / n);
    const pe = pYes + pNo;
    // Zero variance in one rater leaves kappa undefined; reporting 1.0 here would be a lie.
    const kappa = pe === 1 ? Number.NaN : (po - pe) / (1 - pe);
    const rounded = Number.isNaN(kappa) ? Number.NaN : Math.round(kappa * 100) / 100;
    return {
        kappa: rounded,
        observedAgreement: Math.round(po * 10000) / 10000,
        expectedAgreement: Math.round(pe * 10000) / 10000,
        n,
        band: landisKoch(rounded),
        tooSmallToConclude: n < PREREGISTERED_N,
        preregisteredN: PREREGISTERED_N,
        detail: Number.isNaN(rounded)
            ? 'Varianza nula en uno de los evaluadores: el coeficiente queda indefinido. Archivar esto sin reportarlo es el fallo de medición más peligroso.'
            : `κ = ${rounded.toFixed(2)} (${landisKoch(rounded)}), n = ${n}${n < PREREGISTERED_N ? ` — por debajo del n preregistrado (${PREREGISTERED_N}): señal piloto, no validación` : ''}.`,
    };
};
/** The asymmetry direction matters: 0 FP / 1 FN means the judge errs STRICT (safe). */
export const judgeErrorDirection = (input) => {
    if (input.falseNegative === 0 && input.falsePositive > 0)
        return 'lenient (dirección insegura)';
    if (input.falsePositive === 0 && input.falseNegative > 0)
        return 'strict (dirección segura)';
    if (input.falsePositive === 0 && input.falseNegative === 0)
        return 'sin errores observados';
    return 'mixta';
};
/** Monitor 1: approval rate moving average vs historical baseline, alert at > 2 sigma. */
export const checkApprovalDrift = (historical, recent, sigmaThreshold = 2) => {
    const mean = (xs) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
    const baseline = mean(historical);
    const movingAverage = mean(recent);
    const variance = historical.length < 2
        ? 0
        : historical.reduce((acc, x) => acc + (x - baseline) ** 2, 0) / (historical.length - 1);
    const sigma = Math.sqrt(variance);
    const zScore = sigma === 0 ? 0 : (movingAverage - baseline) / sigma;
    return {
        movingAverage,
        baseline,
        sigma,
        zScore,
        alert: sigma > 0 && zScore > sigmaThreshold,
        detail: sigma === 0
            ? 'Sin varianza histórica: la deriva no es medible con esta serie.'
            : `Tasa móvil ${(movingAverage * 100).toFixed(1)}% vs línea base ${(baseline * 100).toFixed(1)}% (z = ${zScore.toFixed(2)}). ${zScore > sigmaThreshold
                ? 'Alerta: la tasa de aprobación crece a medida que se acumula contexto, sin que nadie haya decidido relajar el listón.'
                : 'Sin deriva significativa.'}`,
    };
};
/** Monitor 3: blind sentinels of known quality; a bad rating forces recalibration. */
export const checkSelfPreference = (injected, correctlyRated) => {
    const allCorrect = injected > 0 && injected === correctlyRated;
    return {
        injected,
        correctlyRated,
        recalibrationForced: injected > 0 && !allCorrect,
        detail: injected === 0
            ? 'Sin centinelas ciegos inyectados: la auto-preferencia no está instrumentada.'
            : allCorrect
                ? `${injected} centinela(s) de calidad conocida evaluados correctamente.`
                : `${injected - correctlyRated} centinela(s) mal evaluados: se fuerza recalibración del juez.`,
    };
};
/**
 * The design requirement behind the judge (I4 / §7.3): META-EVAL must belong to a DIFFERENT
 * model family than the PATCH stage whose output it evaluates. A judge correlated with the
 * executor is the aligned hole that superposed defences exist to avoid, and it does not stop
 * being one for running in another process.
 */
export const checkJudgeIndependence = (input) => {
    const independent = input.judgeModelFamily.length > 0 &&
        input.patchModelFamily.length > 0 &&
        input.judgeModelFamily.toLowerCase() !== input.patchModelFamily.toLowerCase();
    return {
        independent,
        // Honest degradation: without two providers, demote the verdict to a warning and lean on
        // the decidable gates instead of pretending to have independent judgement.
        status: independent ? 'blocking' : 'advisory',
        detail: independent
            ? `Juez de familia "${input.judgeModelFamily}" distinta de PATCH ("${input.patchModelFamily}"): juicio independiente.`
            : `Juez en la misma familia que PATCH ("${input.patchModelFamily}"): segunda opinión del mismo sistema. Se degrada el veredicto de bloqueante a advertencia y se apoya en los gates decidibles (pertenencia en el grafo, presencia de evidencia, ausencia de secretos).`,
    };
};
/** Temperature zero is not determinism — and saying otherwise is easily refutable. */
export const DETERMINISM_NOTE = 'Temperatura cero no es determinismo: el agrupamiento dinámico de peticiones, el orden de reducción en punto flotante sobre GPU y el enrutamiento en arquitecturas de mezcla de expertos producen salidas distintas para la misma entrada. El determinismo de esta arquitectura no reside en el sampler sino en los gates, que son código ordinario con entradas y salidas fijas.';
/** The three documented judge biases, each with its structural mitigation. */
export const JUDGE_BIASES = [
    {
        bias: 'sesgo de posición',
        effect: 'El orden de presentación altera el veredicto.',
        mitigation: 'Barajar y re-evaluar.',
    },
    {
        bias: 'sesgo de verbosidad',
        effect: 'Premia la salida larga sobre la correcta — especialmente dañino en un sistema cuya disciplina de salida es la brevedad.',
        mitigation: 'Normalizar la longitud antes de puntuar.',
    },
    {
        bias: 'auto-preferencia',
        effect: 'El evaluador reconoce y favorece sus propias generaciones; un evaluador de la misma familia que PATCH no es un control independiente.',
        mitigation: 'Familia de modelo distinta para el juez (I4).',
    },
];
