/**
 * Transactional wave semantics over isolated worktrees (§7.2, status: built).
 *
 * The two defects of unstructured swarms — state coupling and absence of transactionality — are
 * cured by the same deliberately boring piece: git. Each DAG task runs in an isolated worktree
 * on an EPHEMERAL WAVE BRANCH, so parallel agents do not share a mutable filesystem and the race
 * condition is impossible BY CONSTRUCTION, not improbable by luck.
 *
 * Merge to the integration branch happens only when the whole wave passes, and it happens whole
 * or not at all: if task 11 of 12 fails, the worktree is discarded and the repository never knew
 * the intermediate state. Rollback requires no emergency procedure — it is simply the branch that
 * never merged.
 *
 * The third defect, algorithmic confabulation, is NOT cured by filesystem isolation: it needs
 * separation of judgement, which is META-EVAL's job and is modelled separately.
 */
/** The wave invariants, stated so their violation is observable from outside. */
export const WAVE_INVARIANTS = [
    'No shared mutable filesystem between concurrent tasks.',
    'Wave atomicity: no partial merge, ever — not n-1 of n.',
    'Observation impossibility: the intermediate state is never committed, so there is nothing to revert.',
    'Scope immutability: the declared file set is fixed at PLANNED and cannot widen mid-flight.',
    'The wave boundary is the commit boundary.',
    'Rollback is absence, not compensation.',
];
/**
 * Decide the wave's fate from its task results. This is the atomicity rule expressed as code:
 * one failing task discards every worktree of the wave, including the ones that passed.
 */
export const resolveWave = (plan, results) => {
    const failed = results.filter((r) => !r.gatesPassed);
    if (failed.length > 0) {
        return {
            state: 'discarded',
            detail: `Wave ${plan.waveIndex} descartada: ${failed.length} tarea(s) fallaron sus gates (${failed
                .map((f) => f.taskId)
                .join(', ')}). Los worktrees de toda la oleada se descartan, incluidos los que pasaron: la reversión es la rama que no llegó a fusionarse.`,
            intermediateObservable: false,
        };
    }
    return {
        state: 'merged',
        detail: `Wave ${plan.waveIndex} fusionada entera en ${plan.integrationBranch} tras pasar G10 en todas sus tareas.`,
        intermediateObservable: false,
    };
};
/** Scope gate: a task may only touch files its DAG node declared. */
export const checkScope = (task, changedFiles) => {
    const scope = task.scope.map((s) => s.replace(/^\.\//, ''));
    const violations = changedFiles.filter((f) => {
        const norm = f.replace(/^\.\//, '');
        return !scope.some((s) => norm === s || norm.startsWith(s.endsWith('/') ? s : `${s}/`));
    });
    return { ok: violations.length === 0, violations };
};
export const planWorktrees = (plan, baseDir = '.worktrees') => plan.tasks.map((t) => ({
    taskId: t.id,
    worktreePath: `${baseDir}/${plan.feature}-w${plan.waveIndex}-${t.id}`,
    branch: `${plan.waveBranch}/${t.id}`,
    identity: `${plan.feature}#w${plan.waveIndex}#${t.id}`,
}));
/**
 * The git commands that materialise the wave. Deliberately boring: choosing git primitives
 * instead of a bespoke coordination runtime is an architectural decision with a thesis —
 * multi-agent transactionality needs no new infrastructure, only discipline over the most
 * audited infrastructure in the industry.
 */
export const waveGitCommands = (plan, assignments) => ({
    create: [
        `git branch ${plan.waveBranch} ${plan.integrationBranch}`,
        ...assignments.map((a) => `git worktree add -b ${a.branch} ${a.worktreePath} ${plan.waveBranch}`),
    ],
    verify: [
        `git -C <worktree> diff --name-only ${plan.integrationBranch}...HEAD`,
        `git -C <worktree> status --porcelain`,
    ],
    // Whole wave or nothing: the wave branch is merged once, after every task passed.
    merge: [
        `git checkout ${plan.integrationBranch}`,
        `git merge --no-ff ${plan.waveBranch} -m "wave ${plan.waveIndex}: ${plan.tasks.length} task(s) verified"`,
    ],
    discard: [
        ...assignments.map((a) => `git worktree remove --force ${a.worktreePath}`),
        ...assignments.map((a) => `git branch -D ${a.branch}`),
        `git branch -D ${plan.waveBranch}`,
    ],
});
/** A claim whose TTL elapsed is reclaimable: a crashed agent must not block the swarm forever. */
export const isClaimLive = (claim, now = new Date()) => now.getTime() - new Date(claim.grantedAt).getTime() < claim.ttlMs;
/**
 * Detect overlapping live claims BEFORE a race exists. This is the advisory half of the swarm
 * discipline: it is cheap, deterministic, and it converts a filesystem race into a scheduling
 * decision.
 */
export const detectClaimConflicts = (claims, now = new Date()) => {
    const byPath = new Map();
    for (const claim of claims.filter((c) => isClaimLive(c, now))) {
        const list = byPath.get(claim.path) ?? [];
        list.push(claim);
        byPath.set(claim.path, list);
    }
    return Array.from(byPath.entries())
        .filter(([, list]) => list.length > 1)
        .map(([path, list]) => ({
        path,
        holders: list.map((c) => c.owner),
        detail: `${list.length} identidades reclaman "${path}" simultáneamente.`,
    }));
};
