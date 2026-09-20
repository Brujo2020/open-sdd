/**
 * The manuscript as an executable contract (§9.6) and the implementation-status inventory (§2.3).
 *
 * Every claim in the documentation is registered with an executable verifier whose EXIT CODE
 * decides the verdict. That yields one of five states per published sentence, and the
 * distinction between the first three and the last two is what makes the instrument usable: a
 * precisely declared limit is a known property of scope, not a failure. Conflating them creates
 * the perverse incentive to suppress the declaration so the dashboard stays green.
 *
 * Declared limit, kept visible: this demonstrates INTERNAL CONSISTENCY (prose and repository
 * agree on what exists), which is real and narrow. It CANNOT establish that what exists works —
 * it would return the same green on a harness whose controls blocked nothing. Self-audit is
 * accounting; only a third party running the risk-lab protocol would be evidence.
 */

export type ClaimStatus =
  | 'verified'
  | 'not-implemented'
  | 'not-measured'
  | 'broken'
  | 'outdated-text';

export interface ClaimStatusSpec {
  status: ClaimStatus;
  meaning: string;
  /** Only one of the five justifies halting a publication. */
  haltsPublication: boolean;
  repairedBy: 'nothing' | 'code' | 'text';
}

export const CLAIM_STATUSES: ClaimStatusSpec[] = [
  {
    status: 'verified',
    meaning: 'El repositorio sostiene la afirmación ahora mismo.',
    haltsPublication: false,
    repairedBy: 'nothing',
  },
  {
    status: 'not-implemented',
    meaning:
      'La afirmación describe una brecha declarada (control habilitado por perfil y no construido) y el verificador confirma que la brecha sigue siendo la que el texto describe.',
    haltsPublication: false,
    repairedBy: 'nothing',
  },
  {
    status: 'not-measured',
    meaning:
      'La afirmación enuncia una ausencia de evidencia y el verificador confirma que la ausencia persiste.',
    haltsPublication: false,
    repairedBy: 'nothing',
  },
  {
    status: 'broken',
    meaning:
      'El comando falla donde el texto dice que debería pasar. El manuscrito afirma algo falso: es la ÚNICA condición que justifica detener una publicación.',
    haltsPublication: true,
    repairedBy: 'code',
  },
  {
    status: 'outdated-text',
    meaning:
      'El comando pasa donde el texto afirmaba una ausencia: el sistema mejoró y la prosa se quedó atrás. Se repara editando el artículo, no el código.',
    haltsPublication: false,
    repairedBy: 'text',
  },
];

export interface Claim {
  id: string;
  /** Paper section the claim comes from. */
  section: string;
  statementEs: string;
  statementEn: string;
  /** Command whose exit code decides the verdict. */
  verifier: string;
  /**
   * What the text says the command does:
   *  - 'pass'  -> the text claims it passes.
   *  - 'fail'  -> the text declares a gap and the command confirms the gap.
   *  - 'absent'-> the text declares an absence of evidence.
   */
  expectation: 'pass' | 'fail' | 'absent';
}

export interface ClaimRun {
  claimId: string;
  /** Observed exit code of the verifier. */
  exitCode: number;
}

/**
 * Decide a claim's state from the observed exit code. Note that a `fail` expectation is
 * satisfied by a NON-ZERO exit code: a declared gap that is confirmed stays a known property,
 * and pretending otherwise is how a registry becomes a fiction.
 */
export const evaluateClaim = (claim: Claim, run: ClaimRun | undefined): ClaimStatus => {
  if (!run) return 'not-measured';
  const passed = run.exitCode === 0;

  if (claim.expectation === 'pass') return passed ? 'verified' : 'broken';
  if (claim.expectation === 'fail') return passed ? 'outdated-text' : 'not-implemented';
  // 'absent': the text says the evidence is missing; a passing command proves the gap closed.
  return passed ? 'outdated-text' : 'not-measured';
};

export interface ClaimsReport {
  total: number;
  verified: number;
  notImplemented: number;
  notMeasured: number;
  broken: number;
  outdatedText: number;
  /** A claim that exists but is never executed proves nothing beyond intent. */
  executed: number;
  halting: Claim[];
  results: { claim: Claim; status: ClaimStatus }[];
}

export const assessClaims = (claims: Claim[], runs: ClaimRun[]): ClaimsReport => {
  const byId = new Map(runs.map((r) => [r.claimId, r]));
  const results = claims.map((claim) => ({ claim, status: evaluateClaim(claim, byId.get(claim.id)) }));
  const count = (s: ClaimStatus) => results.filter((r) => r.status === s).length;

  return {
    total: claims.length,
    verified: count('verified'),
    notImplemented: count('not-implemented'),
    notMeasured: count('not-measured'),
    broken: count('broken'),
    outdatedText: count('outdated-text'),
    executed: runs.length,
    halting: results.filter((r) => r.status === 'broken').map((r) => r.claim),
    results,
  };
};

export const renderClaimsSummary = (report: ClaimsReport): string =>
  `${report.total} afirmaciones | ${report.verified} verificadas | ${report.notImplemented} declaradas | ${report.notMeasured} no medidas | ${report.broken} rotas | ${report.outdatedText} desactualizadas`;

/**
 * The generator limit, stated by the paper and repeated here because it is the difference
 * between an honest instrument and a green light: it prevents declaring enforcement where there
 * is NO code, but not where there is code that VERIFIES NOTHING. A gate whose body branches
 * counts as executable while authenticating nothing.
 */
export const CLAIMS_REGISTRY_LIMIT =
  'El registro demuestra consistencia interna; no puede establecer que lo que existe funcione. Habría devuelto el mismo verde sobre un arnés cuyos controles no bloquearan nada.';

// ---------------------------------------------------------------------------------------------
// Implementation status inventory (§2.3) — measured / built / proposed
// ---------------------------------------------------------------------------------------------

export type ImplementationStatus = 'measured' | 'built' | 'proposed';

export interface StatusSpec {
  status: ImplementationStatus;
  definition: string;
  participatesInGuarantees: boolean;
}

/**
 * Architecture papers routinely fail the audit they demand of software: they confuse what was
 * designed with what was delivered. The promotion criterion from "proposed" to "built" is the
 * same one the harness applies to code — executable evidence or it does not pass.
 */
export const IMPLEMENTATION_STATUSES: StatusSpec[] = [
  {
    status: 'measured',
    definition:
      'El componente se implementó y se ejercitó, y existe una medición con su instrumento nombrable.',
    participatesInGuarantees: true,
  },
  {
    status: 'built',
    definition:
      'El componente se implementó y se ejercitó con evidencia ejecutable; no necesariamente medido.',
    participatesInGuarantees: true,
  },
  {
    status: 'proposed',
    definition:
      'Diseño con esquema, sin implementación. NINGÚN componente propuesto participa en las garantías de seguridad que el arnés ofrece hoy.',
    participatesInGuarantees: false,
  },
];

export interface InventoryItem {
  component: string;
  status: ImplementationStatus;
  note: string;
  /** The lab bench that could refute the claim about this component. */
  refutingBench?: string;
  /**
   * Set when a component's own documentation claims it participates in today's security
   * guarantees. A `proposed` component claiming this is a leak — the defect the inventory exists
   * to catch, and one that cannot be detected without the claim being recorded.
   */
  claimsParticipationInGuarantees?: boolean;
}

export interface InventoryReport {
  measured: InventoryItem[];
  built: InventoryItem[];
  proposed: InventoryItem[];
  /** Any proposed component leaking into the guarantee set is a defect, not a nuance. */
  guaranteeLeaks: InventoryItem[];
  detail: string;
}

/**
 * Audit an inventory. The defensive reading of the inventory is the important one: no proposed
 * component participates in today's security guarantees. A `proposed` item whose documentation
 * claims otherwise is reported as a leak instead of being averaged away.
 */
export const auditInventory = (items: InventoryItem[]): InventoryReport => {
  const by = (s: ImplementationStatus) => items.filter((i) => i.status === s);
  const leaks = by('proposed').filter((i) => i.claimsParticipationInGuarantees === true);

  return {
    measured: by('measured'),
    built: by('built'),
    proposed: by('proposed'),
    guaranteeLeaks: leaks,
    detail: `${by('measured').length} medido(s), ${by('built').length} construido(s), ${by('proposed').length} propuesto(s)${
      leaks.length > 0 ? ` — ${leaks.length} propuesto(s) reclamando participar en garantías` : ''
    }.`,
  };
};
