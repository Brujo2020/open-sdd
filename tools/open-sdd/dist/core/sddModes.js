/** Rigor levels: `explore` plus open-sdd's three governed rungs. */
export const LEVELS = ['explore', 'spec-first', 'spec-anchored', 'spec-as-source'];
export const FLOWS = [
    { id: 'spec', label: 'Spec', skill: '/sdd-spec-requirements', writes: 'docs+code', about: 'requirements → design → tasks, one phase at a time, each approved', why: 'new behaviour that others will build on: every phase is reviewed before the next one depends on it' },
    { id: 'quick', label: 'Quick Spec', skill: '/sdd-spec-quick', writes: 'docs', about: 'clarify, then generate requirements, design and tasks in one pass; ONE approval at the end', why: 'a well-understood feature where three separate approvals would cost more than they catch' },
    { id: 'bugfix', label: 'Bug Fix', skill: '/sdd-bugfix', writes: 'docs+code', about: 'actual · expected · what must not change; reproduce, diagnose, fix, prove', why: 'a defect is a delta on existing behaviour: the regression contract (what must NOT change) matters more than new requirements' },
    { id: 'plan', label: 'Plan only', skill: '/sdd-plan-only', writes: 'none', about: 'analyse and plan; the agent changes nothing', why: 'deciding before committing: estimates, options and risks without a single file touched' },
    { id: 'tiny', label: 'Tinyspec', skill: '/sdd-tiny', writes: 'docs+code', about: 'a three-line spec (goal · done when · out of scope) and code', why: 'a spike or POC: governance would cost more than the throwaway code, but "done when" still has to be written down' },
    { id: 'discovery', label: 'Discovery', skill: '/sdd-discovery', writes: 'docs', about: 'a fuzzy idea becomes hardened, killed or clarified (brief.md, gated by `discovery lint`)', why: 'the cheapest bug is the feature you do not build: no outcome of discovery pushes to build' },
];
export const PROJECT_TYPES = [
    { id: 'fuzzy-idea', label: 'Fuzzy idea', when: 'nobody can yet say who needs it or what "done" looks like', level: 'spec-first', terrain: 'greenfield',
        sequence: ['/sdd-discovery', 'open-sdd discovery lint <feature>', '/sdd-spec-quick or /sdd-tiny (only if the brief survives)'],
        avoid: ['/sdd-spec-requirements — requirements over an unvalidated idea just formalise a guess'] },
    { id: 'spike', label: 'Spike / POC', when: 'throwaway code to learn whether something is feasible', level: 'explore', terrain: 'greenfield',
        sequence: ['/sdd-tiny', '(implement and tick each "Done when" with evidence)', '/sdd-promote (only if it survives)'],
        avoid: ['/sdd-spec-quick, /sdd-spec-design — governance costs more than the throwaway code', '/sdd-impl — it expects approved tasks'] },
    { id: 'greenfield', label: 'New product or feature', when: 'no existing code constrains it', level: 'spec-first', terrain: 'greenfield',
        sequence: ['/sdd-steering', '/sdd-spec-init', '/sdd-spec-requirements', 'open-sdd requirements review <feature>', '/sdd-spec-design', '/sdd-spec-tasks', 'open-sdd gherkin <feature> --write', '/sdd-impl', '/sdd-validate-impl', 'open-sdd archive <feature> --confirm'],
        avoid: ['/sdd-getspecs, open-sdd brownfield … — there is no code to reverse-engineer', '/sdd-characterize — no current behaviour to freeze'] },
    { id: 'multi-feature', label: 'Several related features', when: 'a roadmap with dependencies between specs', level: 'spec-anchored', terrain: 'greenfield',
        sequence: ['/sdd-discovery (writes roadmap.md)', '/sdd-spec-batch', 'open-sdd waves', '/sdd-impl per wave'],
        avoid: ['/sdd-spec-quick one by one — loses the dependency order the batch computes'] },
    { id: 'brownfield-extension', label: 'Change to running code', when: 'the code is the source of truth and has tests', level: 'spec-anchored', terrain: 'brownfield',
        sequence: ['/sdd-getspecs (first time only)', 'open-sdd brownfield constitution . --write', 'open-sdd steering check', 'open-sdd delta init <feature> "<change>"', 'open-sdd delta validate <feature>', 'open-sdd brownfield contracts <feature>', '/sdd-spec-tasks', '/sdd-impl', 'open-sdd brownfield contracts <feature> --verify'],
        avoid: ['/sdd-spec-requirements from scratch — the unit of change is the delta, not a new spec', '/sdd-tiny — running code is never throwaway'] },
    { id: 'legacy-untested', label: 'Legacy without tests', when: 'existing code nobody dares to touch because nothing pins its behaviour', level: 'spec-anchored', terrain: 'brownfield',
        sequence: ['/sdd-getspecs', '/sdd-characterize (freeze current behaviour first)', 'open-sdd brownfield contracts <feature>', 'then /sdd-refactor, /sdd-bugfix or open-sdd delta init'],
        avoid: ['any change before /sdd-characterize — without a regression oracle a change cannot be proven safe'] },
    { id: 'bug', label: 'Bug', when: 'existing behaviour is wrong', level: 'spec-first', terrain: 'brownfield',
        sequence: ['/sdd-bugfix (actual · expected · must not change; failing test first)', 'open-sdd delta init (only if the expected behaviour changes a spec)', '/sdd-verify-completion'],
        avoid: ['/sdd-spec-quick — a full spec hides the root cause and the regression contract'] },
    { id: 'refactor', label: 'Refactor', when: 'structure changes, behaviour must not', level: 'spec-first', terrain: 'brownfield',
        sequence: ['/sdd-characterize (if the area has no tests)', '/sdd-refactor (spec_impact: none, same tests before and after)', 'open-sdd brownfield impact <feature>'],
        avoid: ['/sdd-spec-requirements — no new behaviour means no new requirements', '/sdd-bugfix — fixing while refactoring mixes two claims that need different evidence'] },
];
/**
 * The project types, or the one that matches an id.
 * @param id - project type id; all types when omitted.
 */
export const projectTypes = (id) => {
    if (!id)
        return PROJECT_TYPES;
    const t = PROJECT_TYPES.find((x) => x.id === id);
    if (!t)
        throw new Error(`tipo de proyecto desconocido «${id}» (${PROJECT_TYPES.map((x) => x.id).join(' · ')})`);
    return [t];
};
const MODULES = [
    { id: 'tiny', label: 'Tinyspec', origin: 'SteelForge', run: '/sdd-tiny', levels: ['on', 'off', 'off', 'off'], why: 'explore still writes down "done when", so a spike can fail visibly' },
    { id: 'discovery', label: 'Discovery', origin: 'BMAD', run: '/sdd-discovery + open-sdd discovery lint', levels: ['opt', 'opt', 'opt', 'on'], why: 'at spec-as-source the spec generates code: an unvalidated idea would be generated, not just written' },
    { id: 'steering', label: 'Steering', origin: 'Kiro', run: '/sdd-steering + open-sdd steering check', levels: ['opt', 'opt', 'on', 'on'], brownfield: 'on', why: 'on existing code the agent must learn the project before it changes it' },
    { id: 'constitution', label: 'Constitution', origin: 'Spec Kit', run: 'open-sdd brownfield constitution / govern', levels: ['off', 'on', 'on', 'on'], why: 'the authority every blocking verdict cites; required at every governed rung' },
    { id: 'clarify', label: 'Clarify', origin: 'Spec Kit', run: 'open-sdd requirements review', levels: ['off', 'on', 'on', 'on'], why: 'an open question in a requirement becomes a guess in the code' },
    { id: 'ears', label: 'EARS', origin: 'Kiro', run: 'open-sdd requirements review / fix', levels: ['off', 'on', 'on', 'on'], why: 'a requirement without a trigger cannot be tested' },
    { id: 'gherkin', label: 'Gherkin', origin: 'SteelForge', run: 'open-sdd gherkin <feature>', levels: ['off', 'opt', 'on', 'on'], why: 'from spec-anchored up, each requirement needs an executable acceptance scenario traced to it' },
    { id: 'design', label: 'Design', origin: 'Kiro', run: '/sdd-spec-design', levels: ['off', 'opt', 'on', 'on'], why: 'a requirement no plan names was listed, not designed' },
    { id: 'tasks', label: 'Tasks', origin: 'cc-sdd', run: '/sdd-spec-tasks', levels: ['off', 'opt', 'on', 'on'], why: 'traceable, boundary-scoped tasks are what parallel implementation needs' },
    { id: 'analyze', label: 'Analyze', origin: 'Spec Kit', run: 'open-sdd gap / brownfield / consistency', levels: ['off', 'opt', 'on', 'on'], why: 'cross-artifact drift is invisible from inside any single artifact' },
    { id: 'delta', label: 'Delta', origin: 'OpenSpec', run: 'open-sdd delta init|validate', levels: ['off', 'off', 'off', 'off'], onlyBrownfield: true, brownfield: 'on', why: 'on existing code the unit of change is the delta, not a new spec' },
    { id: 'approvals', label: 'Approvals', origin: 'Kiro', run: 'spec.json approvals', levels: ['off', 'off', 'opt', 'on'], why: 'when the spec is the source, an unapproved phase is unreviewed code' },
    { id: 'archive', label: 'Archive', origin: 'OpenSpec', run: 'open-sdd archive <feature>', levels: ['off', 'off', 'opt', 'on'], why: 'finished specs out of `.sdd/specs/` keep status and waves about live work only' },
];
/**
 * Resolves the module matrix for a configuration.
 * @param cfg - rigor level, terrain and governance.
 * @returns one row per module, in the order they are worked.
 */
export const modulesFor = (cfg) => {
    const i = LEVELS.indexOf(cfg.level);
    if (i < 0)
        throw new Error(`nivel desconocido «${cfg.level}» (${LEVELS.join(' · ')})`);
    const brown = cfg.terrain === 'brownfield';
    return MODULES.map((m) => {
        let state = m.levels[i];
        if (m.onlyBrownfield && !brown)
            state = 'off';
        else if (m.brownfield && brown && cfg.level !== 'explore')
            state = m.brownfield;
        if (m.id === 'approvals' && cfg.governance === 'enterprise' && cfg.level !== 'explore')
            state = 'on';
        return { id: m.id, label: m.label, origin: m.origin, run: m.run, state, why: m.why };
    });
};
const STEERING_FILES = ['product.md', 'tech.md', 'structure.md'];
/**
 * The stage guide: phases are sequential (the active one is the first not done), as in Kiro.
 * @param f - facts of the feature.
 * @returns ordered stages and the index of the active one (-1 when everything is done).
 */
export const stagesFor = (f) => {
    const approved = (k) => f.meta === null || f.meta.approvals?.[k] === true;
    const verified = f.meta !== null && (f.meta.phase === 'verified' || f.meta.phase === 'completed');
    const init = { id: 'init', label: 'Init', run: '/sdd-spec-init', done: f.hasSddDir, needs: 'no hay .sdd/: /sdd-spec-init' };
    const implement = { id: 'implement', label: 'Implement', run: '/sdd-impl', done: f.tasks.total > 0 && f.tasks.done === f.tasks.total, needs: f.tasks.total ? `${f.tasks.done}/${f.tasks.total} tareas` : 'sin tareas' };
    const validate = { id: 'validate', label: 'Validate', run: '/sdd-validate-impl', done: verified, needs: 'spec.json aún no está en «verified»' };
    let defs;
    if (f.level === 'explore') {
        defs = [init, { id: 'tiny', label: 'Tinyspec', run: '/sdd-tiny', done: Boolean(f.artifacts.tiny), needs: 'falta tiny.md (objetivo · hecho cuando · fuera de alcance)' }, implement, validate];
    }
    else {
        const clarify = f.clarify > 0 ? ` · ${f.clarify} [NEEDS CLARIFICATION] abiertos` : '';
        defs = [
            init,
            ...(f.terrain === 'brownfield'
                ? [{ id: 'steering', label: 'Steering', run: '/sdd-steering', done: Boolean(f.steering?.ready), needs: f.steering && f.steering.present.length === STEERING_FILES.length ? 'el steering tiene marcas sin resolver: open-sdd steering check' : `faltan ${STEERING_FILES.filter((x) => !f.steering?.present.includes(x)).join(', ')}` }]
                : []),
            { id: 'constitution', label: 'Constitution', run: f.terrain === 'brownfield' ? 'open-sdd brownfield constitution . --write' : '/sdd-steering (constitution.md)', done: f.constitution, needs: 'falta .sdd/steering/constitution.md' },
            { id: 'requirements', label: 'Requirements', run: '/sdd-spec-requirements', done: Boolean(f.artifacts.requirements) && f.clarify === 0 && approved('requirements') && (f.terrain !== 'brownfield' || Boolean(f.artifacts.delta)), needs: !f.artifacts.requirements ? 'falta requirements.md' : f.terrain === 'brownfield' && !f.artifacts.delta ? 'brownfield: falta el delta (open-sdd delta init)' : !approved('requirements') ? `sin aprobar${clarify}` : `requirements.md${clarify}` },
            { id: 'design', label: 'Design', run: '/sdd-spec-design', done: Boolean(f.artifacts.design) && approved('design'), needs: !f.artifacts.design ? 'falta plan.md / design.md' : 'diseño sin aprobar' },
            { id: 'tasks', label: 'Tasks', run: '/sdd-spec-tasks', done: Boolean(f.artifacts.tasks) && approved('tasks'), needs: !f.artifacts.tasks ? 'falta tasks.md' : 'tareas sin aprobar' },
            implement,
            validate,
        ];
    }
    const current = defs.findIndex((d) => !d.done);
    return {
        current,
        stages: defs.map((d, i) => ({ id: d.id, label: d.label, run: d.run, state: d.done && (current === -1 || i < current) ? 'done' : i === current ? 'active' : 'pending', needs: d.done ? '' : d.needs })),
    };
};
