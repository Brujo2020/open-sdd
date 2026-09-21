/**
 * Ayuda — UNA tabla para `--help`, `help <command>` y `help <tema>`.
 *
 * ── El defecto que esto corrige ────────────────────────────────────────────────────────────────
 * `open-sdd help` listaba 8 comandos contra los 58 de `--help`, e `help gates` ignoraba su
 * argumento. La causa era que el índice estaba escrito a mano y la ayuda por comando vivía en `if`s
 * separados. Aquí hay una sola tabla (`COMMANDS`): `renderFullHelp` la proyecta como índice y
 * `renderCommandHelp` extrae la ayuda del comando pedido. Añadir un comando sin su entrada aquí no
 * lo oculta: el despacho (`src/index.ts`) usa `KNOWN_COMMANDS` para decidir qué es un comando
 * conocido, y una prueba exige ayuda para todos los enrutados.
 *
 * ── El contrato de salida (tenet 11) ───────────────────────────────────────────────────────────
 * `EXIT` es la única definición de los códigos de salida; `help exit-codes` los documenta, incluido
 * el centinela del bucle del anfitrión (`exit 2 = bloqueado`), que NO es el `2` de uso del CLI.
 *
 * Los textos visibles son español, como el resto del CLI; los identificadores (`C1`, `gates chain`)
 * y los nombres de bandera permanecen en inglés.
 */
import { INSTALL_COMMAND } from '../packageIdentity.js';
import { SUPPORTED_LOCALES } from '../i18n.js';
import { agentList, getAgentDefinition } from '../../agents/registry.js';
import { EXECUTABLE_CHAIN, getExecutableGate } from '../../core/gateCatalog.js';
import { RIGOR_LEVELS, RIGOR_ASPECTS } from '../../core/rigor.js';
import { colors, formatHeading } from '../ui/colors.js';
// ---------------------------------------------------------------------------------------------
// Contrato de códigos de salida (tenet 11)
// ---------------------------------------------------------------------------------------------
export const EXIT = {
    /** El comando hizo lo que prometía. */
    PASSED: 0,
    /** TU repositorio falló una comprobación: un hallazgo, no un error de uso. */
    GATE_FAILED: 1,
    /** La línea de comandos estaba mal (bandera, comando o subcomando): nada se inspeccionó. */
    USAGE: 2,
    /** El entorno o la configuración faltan o son incorrectos. */
    ENVIRONMENT: 3,
    /** Un defecto de open-sdd: el fallo es nuestro, no tuyo. */
    TOOL_BUG: 4,
};
export const EXIT_CODES = [
    { code: EXIT.PASSED, name: 'passed', meaning: 'the command did what it promised' },
    { code: EXIT.GATE_FAILED, name: 'gate failed', meaning: 'your repository failed a check: a finding, not a usage mistake' },
    { code: EXIT.USAGE, name: 'usage error', meaning: 'a bad flag, command or subcommand: nothing was inspected' },
    { code: EXIT.ENVIRONMENT, name: 'environment or configuration', meaning: 'the environment or the configuration is missing or wrong' },
    { code: EXIT.TOOL_BUG, name: 'tool bug', meaning: 'open-sdd itself failed: this is our defect, not yours' },
];
export const EXIT_CODES_BODY = `${EXIT_CODES.map((entry) => `  ${entry.code}  ${entry.name.padEnd(30)} ${entry.meaning}`).join('\n')}

  = note: a usage error (2) is never reported as a governance failure (1)
  = note: host-loop sentinel — inside a Stop hook, \`exit 2\` means "do not stop" (blocked), not
          "usage error". The installed hook adapter translates ANY non-zero open-sdd exit into the
          host's 2, so a failure can never be read as a pass (fail-closed).
  = help: \`open-sdd help formatting\` · \`open-sdd explain C1\` · docs/PAPER-ALIGNMENT.md`;
export const EXIT_CODES_USAGE = `EXIT CODES — the contract\n\n${EXIT_CODES_BODY}`;
// ---------------------------------------------------------------------------------------------
// Sugerencias («did you mean») — distancia de edición con umbral y tope
// ---------------------------------------------------------------------------------------------
export const levenshtein = (a, b) => {
    const rows = a.length + 1;
    const cols = b.length + 1;
    const previous = Array.from({ length: cols }, (_, j) => j);
    for (let i = 1; i < rows; i += 1) {
        const current = [i, ...new Array(cols - 1).fill(0)];
        for (let j = 1; j < cols; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
        }
        previous.splice(0, cols, ...current);
    }
    return previous[cols - 1];
};
/**
 * Las sugerencias más cercanas: distancia ≤ `maxDistance`, ordenadas por distancia y luego
 * alfabéticamente, sin duplicados y con tope de `limit` (el contrato pide ≤ 3).
 */
export const suggestCommands = (input, candidates, maxDistance = 2, limit = 3) => {
    const needle = input.trim().toLowerCase();
    if (needle.length === 0)
        return [];
    const scored = new Map();
    for (const candidate of candidates) {
        if (candidate === input || candidate.toLowerCase() === needle)
            continue;
        const distance = levenshtein(needle, candidate.toLowerCase());
        if (distance <= maxDistance)
            scored.set(candidate, distance);
    }
    return [...scored.entries()]
        .sort(([a, da], [b, db]) => da - db || a.localeCompare(b))
        .slice(0, limit)
        .map(([candidate]) => candidate);
};
const SUB = (name, summary) => (summary ? { name, summary } : { name });
export const COMMANDS = [
    {
        name: 'templates',
        group: 'templates',
        summary: 'The 22 command templates: what each one writes and where each host reads it',
        usage: 'open-sdd templates [--json] [--host <id>]',
        indexLines: [
            '  templates [--json] [--host <id>]            List the 22 templates, what each one writes, and where each host reads them',
            `  ${INSTALL_COMMAND} init . --write          Install them as the host's own chat commands (plan only without --write)`,
            '    MCP is opt-in (--mcp); the default path needs neither MCP nor the network.',
        ],
        details: ['Read-only: it lists the templates and their installation state. Nothing is written without a separate write command.'],
        examples: ['open-sdd templates', 'open-sdd templates --host claude-code', 'open-sdd templates --json'],
    },
    {
        name: 'gates',
        group: 'console',
        summary: 'Resolve and run the Zero-Trust gate chain',
        usage: 'open-sdd gates <chain|crosswalk|list|enforcement|run> [--profile <solo|team|regulated>] [--staged|--base <ref>] [--strict]',
        indexLines: ['  gates [chain|crosswalk|list|enforcement|run]  Resolve and run the gate chain'],
        subcommands: [
            SUB('chain', 'resolve the effective chain for the profile, rigor and repository signals'),
            SUB('crosswalk', 'G1–G21 → C1–C7/O1–O7 plus the residue'),
            SUB('list', 'the executable chain with posture and whether each check inspects anything'),
            SUB('enforcement', 'levels A–D: the ceiling versus the floor'),
            SUB('run', 'run the chain (exit 1 when it fails)'),
        ],
        strictSubcommands: true,
        details: ['`gates run` resolves its own ids, profile and scope, so the score footer declares the gate component unmeasured rather than guessing.'],
        examples: ['open-sdd gates chain --profile regulated', 'open-sdd gates run --strict', 'open-sdd gates run --staged'],
    },
    {
        name: 'govern',
        group: 'console',
        summary: 'Invariants, conformance, rigor, the constitution draft and the appeals channel',
        usage: 'open-sdd govern <invariants|conformance|hitl|rigor|constitution|appeal|meta-eval|budget|discipline>',
        indexLines: [
            '  govern [invariants|conformance|hitl|rigor|constitution|appeal|meta-eval|budget|discipline]  Invariants, conformance, rigor and the constitution draft/ratify',
        ],
        subcommands: [
            SUB('invariants', 'I1–I6 with their evidence'),
            SUB('conformance', 'C0–C3 with per-invariant evidence'),
            SUB('hitl', 'quantified human-in-the-loop thresholds'),
            SUB('rigor', 'assess the repository against the declared rigor level'),
            SUB('constitution', 'matrix, draft, evidence pack and ratification'),
            SUB('appeal', 'the appeal channel for a blocking verdict'),
            SUB('meta-eval', 'evaluate the evaluator'),
            SUB('budget', 'the declared budgets'),
            SUB('discipline', '§9.7 decidable properties over the diff'),
        ],
        strictSubcommands: true,
        examples: ['open-sdd govern conformance', 'open-sdd govern rigor', 'open-sdd govern constitution --matrix'],
    },
    {
        name: 'assure',
        group: 'console',
        summary: 'Threats, the claims registry, skills and memory',
        usage: 'open-sdd assure <threats|lab|claims|skills|memory>',
        indexLines: ['  assure [threats|lab|claims|skills|memory]    OWASP/ATLAS threats, claims registry, skills and memory'],
        subcommands: [
            SUB('threats', 'OWASP/ATLAS plus the regulatory crosswalk'),
            SUB('lab', 'the adversarial lab'),
            SUB('claims', 'the claims registry (`--verify` exits 1 only on a broken claim)'),
            SUB('skills', 'the shipped skill set'),
            SUB('memory', 'the session memory ledger'),
        ],
        strictSubcommands: true,
        examples: ['open-sdd assure threats', 'open-sdd assure claims --verify'],
    },
    {
        name: 'waves',
        group: 'console',
        summary: 'Transactional wave plan with the git commands',
        usage: 'open-sdd waves <feature>',
        indexLines: ['  waves <feature>                             Transactional wave plan with git commands'],
        examples: ['open-sdd waves stripe-billing'],
    },
    {
        name: 'floor',
        group: 'console',
        summary: 'The enforcement floor: commit hook plus the PR gate matrix',
        usage: 'open-sdd floor <status|install> [target] [--ci]',
        indexLines: ['  floor [status|install] [target] [--ci]       Enforcement floor: commit hook + PR gate matrix'],
        subcommands: [
            SUB('status', 'is the commit/merge floor installed here?'),
            SUB('install', 'install the commit hook and the CI workflow'),
        ],
        strictSubcommands: true,
        examples: ['open-sdd floor status', 'open-sdd floor install . --ci'],
    },
    {
        name: 'standards',
        group: 'console',
        summary: 'The standards engine: list, show, explain, check and fix the catalogue',
        usage: 'open-sdd standards <list|show|explain|check|fix> [<id>] [--apply] [--json]',
        indexLines: ['  standards [list|show|explain|check|fix]  The machine-checkable standards catalogue: findings with a graded remedy'],
        subcommands: [
            SUB('list', 'the catalogue entries and which ones block'),
            SUB('show', 'one entry in full'),
            SUB('explain', 'one entry and what it decides'),
            SUB('check', 'run every applicable standard over the declared artifacts'),
            SUB('fix', 'apply a remedy (`--apply` only auto-applies the safe class)'),
        ],
        strictSubcommands: true,
        examples: ['open-sdd standards list', 'open-sdd standards check --json', 'open-sdd standards explain REQ-EARS-001'],
    },
    {
        name: 'requirements',
        group: 'console',
        summary: 'The requirements coach: quality review, an executable checklist and graded repairs',
        usage: 'open-sdd requirements <review|checklist|fix> <feature> [--json] [--apply <id>]',
        indexLines: [
            '  requirements [review|checklist|fix] <feature>  The requirements coach: findings with a rewrite or a question',
        ],
        subcommands: [
            SUB('review', 'run the quality checks over the requirements and propose rewrites'),
            SUB('checklist', 'run the checklist predicates and record their digests'),
            SUB('fix', 'apply a graded remedy (`--apply <id>` only auto-applies the safe class)'),
        ],
        strictSubcommands: true,
        examples: ['open-sdd requirements review stripe-billing', 'open-sdd requirements checklist stripe-billing', 'open-sdd requirements fix stripe-billing --apply REQ-RQC-001'],
    },
    {
        name: 'review',
        group: 'console',
        summary: 'One review surface for a change: requirements as word-level diffs',
        usage: 'open-sdd review <feature> --base <ref> [--json]',
        indexLines: ['  review <feature> --base <ref>                One page: added/modified/removed requirements as word-level diffs'],
        details: ['Each row carries its tasks, the tests that would fail if it changed, and a risk score; an unapproved requirement change exits non-zero.'],
        examples: ['open-sdd review stripe-billing --base main', 'open-sdd review stripe-billing --base HEAD~1 --json'],
    },
    {
        name: 'audit',
        group: 'console',
        summary: 'Audit report, evidence bundle and SARIF for code scanning',
        usage: 'open-sdd audit [<feature>] [--regulatory] [--json] | open-sdd audit <bundle|sarif> [feature] [--out <dir>] [--sarif <path>]',
        indexLines: [
            '  audit [bundle|sarif] [feature] [--out <dir>] [--json] [--sarif <path>]  Audit report; evidence bundle with a sha256 per artifact; SARIF 2.1.0 for code scanning',
        ],
        subcommands: [SUB('bundle', 'the evidence bundle with a sha256 per artifact'), SUB('sarif', 'SARIF 2.1.0 for code scanning')],
        examples: ['open-sdd audit', 'open-sdd audit stripe-billing --regulatory', 'open-sdd audit bundle stripe-billing --out .sdd/audit'],
    },
    {
        name: 'doctor',
        group: 'console',
        summary: 'Self-diagnosis: Node, CLI, commit gate, stop hooks, rigor, constitution and specs',
        usage: 'open-sdd doctor [target] [--json] [--fix]',
        indexLines: [
            '  doctor [--json] [--fix] [target]             Self-diagnosis: Node, CLI, commit gate, stop hooks, rigor, constitution, specs',
        ],
        details: ['Every `!`/`✗` check names the command that fixes it; `--fix` repairs in place only the safe, idempotent items.'],
        examples: ['open-sdd doctor', 'open-sdd doctor --json', 'open-sdd doctor --fix'],
    },
    {
        name: 'mcp',
        group: 'console',
        summary: 'Model Context Protocol over stdio (a server, not a one-shot command)',
        usage: 'open-sdd mcp',
        indexLines: ['  mcp                                          Model Context Protocol over stdio (a server, not a one-shot command)'],
        examples: ['open-sdd mcp'],
    },
    {
        name: 'help',
        group: 'console',
        summary: 'This help, the help of one command, or a topic',
        usage: 'open-sdd help [command|exit-codes|rigor|formatting]',
        indexLines: ['  help [command]                               This help, or the help of one command'],
        details: [
            '`--help` and `help` read the SAME table: a command that is routed has help, and a test enforces it.',
        ],
        examples: ['open-sdd help', 'open-sdd help gates', 'open-sdd help exit-codes'],
    },
    {
        name: 'init',
        aliases: ['spec-init'],
        group: 'console',
        summary: 'One-shot project bootstrap; `init <feature>` still creates a spec',
        usage: 'open-sdd init [target] [--agent <id>] [--level <l>] [--skills] [--mcp] [--write] [--json]',
        indexLines: [
            '  init [target] [--agent <id>] [--level <l>] [--skills] [--mcp] [--write] [--json]  One-shot project bootstrap; "init <feature>" still creates a spec',
        ],
        details: [
            'Without `--write` it plans and writes nothing. A positional that is not an existing directory and carries no project flag is still a feature slug.',
        ],
        examples: ['open-sdd init .', 'open-sdd init . --write', 'open-sdd init stripe-billing --title="Stripe billing"'],
    },
    {
        name: 'status',
        aliases: ['spec-status'],
        group: 'console',
        summary: 'Whole state on one screen, with the next command to run',
        usage: 'open-sdd status [feature] [--check] [--quiet] [--json] [--celebrations]',
        indexLines: [
            '  status [feature] [--check] [--quiet] [--json] [--celebrations]  Whole state on one screen, with the next command to run',
        ],
        examples: ['open-sdd status', 'open-sdd status stripe-billing --check', 'open-sdd status --json'],
    },
    {
        name: 'brownfield',
        group: 'brownfield',
        summary: 'The brownfield console: the existing code is the source of truth',
        usage: 'open-sdd brownfield <survey|bootstrap|constitution|templates|specify|requirements|clarify|converge|analyze|impact|contracts|reuse|ids|forecast|repair>',
        indexLines: [
            '  brownfield [survey|bootstrap|constitution|templates|specify|requirements|clarify|converge|analyze|impact|contracts|reuse|ids|forecast|repair]  The brownfield console',
            '  brownfield survey [target]                    Detect the stack, boundaries and evidence',
            '  brownfield bootstrap [target] [--focus F] [--write]  One entry point: recon + constitution + module map + code intelligence + steps',
            '  brownfield constitution [target] [--write] [--draft]  Reverse-engineer the descriptive constitution',
            '  brownfield templates [target] [--write] [--json]  Brownfield requirement/design/task templates',
            '  brownfield specify <feature> "<descripción>" [--area A] [--write] [--json]  Derive EARS requirements from a description',
            '  brownfield requirements <feature> [--suggest] [--apply <i>] [--write] [--json]  EARS assistant over requirements.md',
            '  brownfield ids <feature> --base <ref> [--json]  Stable-id audit: ID-MUTATED / ID-LOST against a base revision',
            '  brownfield clarify <feature> [--max N] [--write] [--json]  Clarifying questions before specifying',
            '  brownfield converge <feature> [--write] [--json]  Convergence of the delta against the base',
            '  brownfield analyze <feature> [--base R] [--json]  Change impact of a feature',
            '  brownfield impact <feature> [--base R]        Dependents, breaking changes, migrations, public API surface',
            '  brownfield contracts <feature> [--write] [--verify]  The regression oracle: which tests protect the change',
            '  brownfield reuse <feature> [--symbols A,B]    Search for existing symbols before creating new ones',
            '  brownfield forecast "<descripción>" [--symbols A,B] [--json]  Expected blast radius before writing code',
            '  brownfield repair <feature> --target <artefacto> [--write] [--json]  Repair a failing artifact with evidence',
        ],
        subcommands: [
            SUB('survey', 'detect the stack, boundaries and evidence'),
            SUB('bootstrap', 'recon + constitution + module map + code intelligence + steps'),
            SUB('constitution', 'reverse-engineer the descriptive constitution'),
            SUB('templates', 'brownfield requirement/design/task templates'),
            SUB('specify', 'derive EARS requirements from a description'),
            SUB('requirements', 'EARS assistant over requirements.md'),
            SUB('clarify', 'clarifying questions before specifying'),
            SUB('converge', 'convergence of the delta against the base'),
            SUB('analyze', 'change impact of a feature'),
            SUB('impact', 'dependents, breaking changes, migrations, public API surface'),
            SUB('contracts', 'the regression oracle: which tests protect the change'),
            SUB('reuse', 'search for existing symbols before creating new ones'),
            SUB('ids', 'stable-id audit: ID-MUTATED / ID-LOST against a base revision'),
            SUB('forecast', 'expected blast radius before writing code'),
            SUB('repair', 'repair a failing artifact with evidence'),
        ],
        strictSubcommands: true,
        examples: ['open-sdd brownfield survey .', 'open-sdd brownfield constitution . --write', 'open-sdd brownfield contracts stripe-billing --verify'],
    },
    {
        name: 'delta',
        group: 'brownfield',
        summary: 'The contract of change (brownfield: the delta, not the system)',
        usage: 'open-sdd delta <init|validate|status|render|merge> [feature]',
        indexLines: [
            '  delta [init|validate|status|render|merge]  The contract of change (brownfield: the delta, not the system)',
            '  delta init <feature> "<title>"                Scaffold a delta spec (ADDED/MODIFIED/REMOVED/RENAMED)',
            '  delta validate <feature>                      Validate ids, EARS, targets, contracts and traceability',
            '  delta status <feature>                        Change counts, strangulation progress, traceability',
            '  delta render <feature>                        Render the delta spec',
            '  delta merge <feature> [--write]               Merge the delta into the base spec',
        ],
        subcommands: [
            SUB('init', 'scaffold a delta spec (ADDED/MODIFIED/REMOVED/RENAMED)'),
            SUB('validate', 'validate ids, EARS, targets, contracts and traceability'),
            SUB('status', 'change counts, strangulation progress, traceability'),
            SUB('render', 'render the delta spec'),
            SUB('merge', 'merge the delta into the base spec'),
            SUB('merge-back', 'alias of `merge`'),
        ],
        strictSubcommands: true,
        examples: ['open-sdd delta init stripe-billing "Add billing"', 'open-sdd delta validate stripe-billing', 'open-sdd delta merge stripe-billing --write'],
    },
    {
        name: 'tour',
        group: 'experience',
        summary: 'Guided first run: recon, constitution draft, check, status, delta',
        usage: 'open-sdd tour [target] [--write] [--lang es|en] [--json]',
        indexLines: [
            '  tour [target] [--write] [--lang es|en] [--json]  Guided first run: recon, constitution draft, check, status, delta',
        ],
        examples: ['open-sdd tour', 'open-sdd tour --write', 'open-sdd tour --lang en'],
    },
    {
        name: 'context',
        group: 'experience',
        summary: 'The context pack the MCP server serves, in the terminal',
        usage: 'open-sdd context [feature] [--lang es|en] [--json]',
        indexLines: ['  context [feature] [--lang es|en] [--json]        The context pack the MCP server serves, in the terminal'],
        examples: ['open-sdd context', 'open-sdd context stripe-billing --json'],
    },
    {
        name: 'integrate',
        group: 'adoption',
        summary: 'Register the MCP server, install the skills and the Stop hook',
        usage: 'open-sdd integrate [host] [--list] [--write] [--json] [--dry-run]',
        indexLines: [
            '  integrate [host] [--write] [--json] [--dry-run]  Register the MCP server, install its skills and its Stop hook',
            '  integrate --list                                 The whole matrix: skills layout, invocation syntax, MCP path, verified?',
        ],
        examples: ['open-sdd integrate --list', 'open-sdd integrate claude-code --write'],
    },
    {
        name: 'import',
        group: 'adoption',
        summary: "Map an incumbent's specs into .sdd (a mapping, never a promise)",
        usage: 'open-sdd import <kiro|spec-kit|cc-sdd> [--write] [--json]',
        indexLines: [
            "  import [kiro|spec-kit|cc-sdd] [--write] [--json] Map an incumbent's specs into .sdd (a mapping, never a promise)",
        ],
        details: ['The mapping is declared and reviewable: it never claims a lossless conversion.'],
        examples: ['open-sdd import kiro', 'open-sdd import spec-kit --write'],
    },
    {
        name: 'gitflow',
        group: 'daily',
        summary: "The branch's role and what that role requires",
        usage: 'open-sdd gitflow [--level <l>] [--greenfield] [--json]',
        indexLines: ["  gitflow [--level <l>] [--greenfield] [--json]  The branch's role and what that role requires"],
        examples: ['open-sdd gitflow', 'open-sdd gitflow --json'],
    },
    {
        name: 'progress',
        group: 'daily',
        summary: 'The append-only progress ledger',
        usage: 'open-sdd progress [--json] [--limit N] | open-sdd progress record --kind <tipo> --summary "<una línea>" --score <0..100> --phase <1|2|3> [--evidence <p>] [--json]',
        indexLines: [
            '  progress [--json] [--limit N]                 The append-only progress ledger',
            '  progress record --kind <tipo> --summary "<una línea>" --score <0..100> --phase <1|2|3> [--evidence <p>] [--json]  Record a milestone',
        ],
        subcommands: [SUB('record', 'record a milestone in the ledger')],
        examples: ['open-sdd progress', 'open-sdd progress record --kind review --summary "reviewed" --score 80 --phase 2'],
    },
    {
        name: 'backup',
        group: 'daily',
        summary: 'The restorable backup of .sdd/ with a verifiable manifest',
        usage: 'open-sdd backup <create|verify|restore> [archive] [--write] [--json]',
        indexLines: [
            '  backup [create|verify|restore]  The restorable backup of .sdd/ with a verifiable manifest',
            '  backup create [--out <dir>] [--force] [--json]  A restorable copy of .sdd/ with a sha256 per file',
            '  backup verify <archive> [--json]              Recompute every sha256 against the manifest',
            '  backup restore <archive> [--write] [--only <ruta>] [--json]  Restore; without --write it is a dry run',
        ],
        subcommands: [
            SUB('create', 'a restorable copy of .sdd/ with a sha256 per file'),
            SUB('verify', 'recompute every sha256 against the manifest'),
            SUB('restore', 'restore; without `--write` it is a dry run'),
        ],
        strictSubcommands: true,
        examples: ['open-sdd backup create', 'open-sdd backup verify .sdd/backups/x', 'open-sdd backup restore .sdd/backups/x'],
    },
    {
        name: 'biography',
        group: 'daily',
        summary: 'The rhythm of a living specification (git, amendments, ratifications)',
        usage: 'open-sdd biography <feature> [--limit N] [--json]',
        indexLines: [
            '  biography <feature> [--limit N] [--json]      The rhythm of a living specification (git, amendments, ratifications)',
        ],
        examples: ['open-sdd biography stripe-billing'],
    },
    {
        name: 'gap',
        aliases: ['validate-gap'],
        group: 'daily',
        summary: 'Blast radius and gap analysis',
        usage: 'open-sdd gap <feature> [--json]',
        indexLines: ['  gap <feature> [--json]                        Blast radius and gap analysis'],
        examples: ['open-sdd gap stripe-billing'],
    },
    {
        name: 'getspecs',
        group: 'daily',
        summary: 'Reverse-engineer steering + roadmap + spec seeds',
        usage: 'open-sdd getspecs [focus] [--json]',
        indexLines: ['  getspecs [focus] [--json]                     Reverse-engineer steering + roadmap + spec seeds'],
        examples: ['open-sdd getspecs', 'open-sdd getspecs src/auth'],
    },
    {
        name: 'verify',
        aliases: ['validate-impl'],
        group: 'daily',
        summary: 'Standalone integration verification gate',
        usage: 'open-sdd verify <feature> [--json]',
        indexLines: ['  verify <feature> [--json]                     Standalone integration verification gate'],
        examples: ['open-sdd verify stripe-billing'],
    },
    {
        name: 'impl',
        group: 'daily',
        summary: 'Autonomous implementation with review',
        usage: 'open-sdd impl <feature> [tasks] [--review required|inline|off]',
        indexLines: ['  impl <feature> [tasks] [--review required|inline|off]  Autonomous implementation with review'],
        examples: ['open-sdd impl stripe-billing', 'open-sdd impl stripe-billing --review inline'],
    },
    {
        name: 'uninstall',
        group: 'reversibility',
        summary: 'Plan (and with `--write`, apply) the removal of everything a run wrote',
        usage: 'open-sdd uninstall [--write] [--purge-sdd] [--json]',
        indexLines: ['  uninstall [--write] [--purge-sdd] [--json]   Plan first; `--write` applies; `.sdd/` is kept unless --purge-sdd'],
        details: ['Without `--write` nothing is removed. `.sdd/` is the user’s data and is removed only with an explicit `--purge-sdd`.'],
        examples: ['open-sdd uninstall', 'open-sdd uninstall --write', 'open-sdd uninstall --write --purge-sdd'],
    },
    {
        name: 'restore',
        group: 'reversibility',
        summary: 'Apply the uninstall plan recorded in a receipt',
        usage: 'open-sdd restore --from <recibo> [--write]',
        indexLines: ['  restore [--from <recibo>] [--write]           Undo a run from its receipt (same safety rules as uninstall)'],
        details: ['`--from` names the receipt file. A file a human edited, or one merged into a foreign file, is refused with its reason, never deleted.'],
        examples: ['open-sdd restore --from .sdd/.open-sdd-receipt.json', 'open-sdd restore --from receipt.json --write'],
    },
    {
        name: 'open-sdd',
        group: 'score',
        summary: 'Inspect the repository: composite SDD score, phase and the ONE next action',
        usage: 'open-sdd',
        indexLines: ['  open-sdd                                    Inspect the repository: composite SDD score, phase and the ONE next action'],
        details: ['The door is read-only and never prompts. The full command catalog is one flag away (`--help`).'],
        examples: ['open-sdd', 'open-sdd --no-footer'],
    },
    {
        name: 'explain',
        group: 'console',
        summary: 'Every gate code, offline: what the check does and where to read more',
        usage: 'open-sdd explain <C1|C2|…|C7|O1|…|O7>',
        indexLines: [],
        details: ['Resolves a gate code to its name, posture and description from `core/gateCatalog.ts` (the same table `gates list` reads).'],
        examples: ['open-sdd explain C1', 'open-sdd explain C5'],
    },
];
export const COMMAND_INDEX = (() => {
    const index = {};
    for (const doc of COMMANDS) {
        index[doc.name] = doc;
        for (const alias of doc.aliases ?? [])
            index[alias] = doc;
    }
    return index;
})();
/** Todo comando enrutable por su nombre canónico o alias. */
export const KNOWN_COMMANDS = new Set(Object.keys(COMMAND_INDEX));
/** Los comandos canónicos, en el orden de la tabla (uno por ayuda). */
export const ROUTED_COMMANDS = COMMANDS.map((doc) => doc.name);
/** Subcomandos por comando, para validar el despacho y sugerir el más cercano. */
export const SUBCOMMAND_INDEX = (() => {
    const index = {};
    for (const doc of COMMANDS) {
        if (!doc.subcommands || doc.subcommands.length === 0)
            continue;
        index[doc.name] = doc.subcommands.map((sub) => sub.name);
        for (const alias of doc.aliases ?? [])
            index[alias] = index[doc.name];
    }
    return index;
})();
/** Solo los comandos cuyo primer posicional ES un subcomando: un valor desconocido es error de uso. */
export const STRICT_SUBCOMMANDS = (() => {
    const strict = {};
    for (const doc of COMMANDS) {
        if (!doc.strictSubcommands || !doc.subcommands)
            continue;
        strict[doc.name] = doc.subcommands.map((sub) => sub.name);
        for (const alias of doc.aliases ?? [])
            strict[alias] = strict[doc.name];
    }
    return strict;
})();
// ---------------------------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------------------------
const SKILLS_LINES = [
    '  /sdd-help                                   Interactive guide with real-world examples',
    '  /sdd-getspecs                               Bootstrap existing repository (Brownfield)',
    '  /sdd-discovery <idea>                       Discover and structure new initiatives',
    '  /sdd-spec-quick <feature> --auto            One-shot spec creation & approval',
    '  /sdd-impl <feature>                         Autonomous TDD implementation with review',
    '  /sdd-validate-impl <feature>                Standalone integration verification gate',
    '  /sdd-audit <feature>                        EU AI Act / NIST compliance audit report',
    '  /sdd-spec-status <feature>                  Show real-time progress and next actions',
];
const HELP_SECTIONS = [
    { group: 'templates', heading: 'Command templates (the DEFAULT integration: 22 workflows, no MCP and no network):' },
    { group: 'skills', heading: 'In-Chat Skills (The Apple-grade Experience):', staticLines: SKILLS_LINES },
    { group: 'console', heading: 'Zero-Trust console (reference architecture):' },
    { group: 'brownfield', heading: 'Brownfield (existing code that is the de facto source of truth):' },
    { group: 'experience', heading: 'Experience layer (bilingual: --lang es|en, or OPEN_SDD_LANG):' },
    {
        group: 'adoption',
        heading: 'Adoption (the integration matrix and the importers):',
        after: ['  hosts: claude-code, cursor, copilot, codex, gemini-cli, windsurf, opencode, antigravity, zed, cline'],
    },
    { group: 'daily', heading: 'Daily drivers (read-only reports: none of these runs the gate chain):' },
    { group: 'reversibility', heading: 'Reversibility (the tool is reversible — tenet 12):' },
    { group: 'score', heading: 'Score (one number, one door):' },
];
const globalOptions = () => {
    const aliasFlags = Array.from(new Set(agentList.flatMap((key) => getAgentDefinition(key).aliasFlags)));
    const aliasLine = aliasFlags.length > 0 ? [`  ${aliasFlags.join(' | ')}  Agent alias flags`] : [];
    return [
        `  --agent <${agentList.join('|')}>  Select agent`,
        ...aliasLine,
        `  --lang <${SUPPORTED_LOCALES.join('|')}>  Console locale (the only translated ones; any other value is refused by name)`,
        '  --os <auto|mac|windows|linux>               Target OS (auto uses runtime)',
        '  --sdd-dir <path>                            SDD root dir (default .sdd or .kiro)',
        '  --kiro-dir <path>                           Alias for --sdd-dir',
        '  --overwrite <prompt|skip|force>             Overwrite policy (default: prompt)',
        '                                              prompt: ask for each file',
        '                                              skip: never overwrite',
        '                                              force: always overwrite',
        '  --backup[=<dir>]                            Enable backup, optional dir',
        '  --profile <full|minimal>                    Select template profile (default: full)',
        '  --manifest <path>                           Manifest JSON path for planning',
        '  --dry-run                                   Print plan only',
        '  --yes, -y                                   Skip prompts (prompt -> force)',
        '  --no-input                                  Never prompt; a blocked prompt names --yes and --no-input',
        '  --color <auto|always|never>                 Color policy (default auto); NO_COLOR/FORCE_COLOR also honoured',
        '  --json | --quiet                            Machine output; both suppress the score footer',
        '  --no-footer                                 Suppress the score footer on any command (scripts)',
        '  -h, --help                                  Show help (or the help of one command)',
        '  -v, --version                               Show version',
    ];
};
const quickExamples = () => [
    `${INSTALL_COMMAND}                         Install Claude Code skills (default)`,
    `${INSTALL_COMMAND} --cursor-skills         Install Cursor IDE skills`,
    `${INSTALL_COMMAND} --antigravity           Install Google Antigravity skills`,
    `${INSTALL_COMMAND} --copilot-skills        Install GitHub Copilot skills`,
    `${INSTALL_COMMAND} --lang es -y            Install in Spanish without prompts`,
];
const LEARN_MORE = [
    '  · open-sdd help rigor          the three rigor levels and what each one demands',
    '  · open-sdd help exit-codes     the exit-code contract, including the host-loop sentinel',
    '  · open-sdd help formatting     color, NO_COLOR/FORCE_COLOR/--color and the machine surface',
    '  · open-sdd explain C1          what a gate code checks, offline',
    '  · docs/PAPER-ALIGNMENT.md      the normative traceability report',
];
/** El índice completo. Es la proyección de `COMMANDS`: no hay una segunda lista escrita a mano. */
export const renderFullHelp = () => {
    const lines = ['Usage: open-sdd [options] (alias: open-sdd)', '', 'Options:', ...globalOptions()];
    lines.push('', 'Quick Examples:', ...quickExamples());
    for (const section of HELP_SECTIONS) {
        lines.push('', section.heading);
        if (section.staticLines)
            lines.push(...section.staticLines);
        for (const doc of COMMANDS.filter((candidate) => candidate.group === section.group)) {
            lines.push(...doc.indexLines);
        }
        if (section.after)
            lines.push(...section.after);
    }
    lines.push('', 'LEARN MORE', ...LEARN_MORE);
    lines.push('', 'Note: In non-TTY environments, prompt mode falls back to skip.');
    return lines.join('\n');
};
/** La ayuda de UN comando, desde la misma tabla. `undefined` si el comando no está enrutado. */
export const renderCommandHelp = (name) => {
    const doc = COMMAND_INDEX[name.toLowerCase()];
    if (!doc)
        return undefined;
    const lines = ['', formatHeading(`Command: open-sdd ${doc.name}`), `  ${doc.summary}`, ''];
    if (doc.aliases && doc.aliases.length > 0)
        lines.push(`Aliases: ${doc.aliases.map((alias) => `open-sdd ${alias}`).join(', ')}`, '');
    lines.push('Usage:', `  ${doc.usage}`, '');
    if (doc.subcommands && doc.subcommands.length > 0) {
        lines.push('Subcommands:');
        const width = Math.max(...doc.subcommands.map((sub) => sub.name.length));
        for (const sub of doc.subcommands) {
            lines.push(`  ${sub.name.padEnd(width)}  ${sub.summary ?? ''}`.trimEnd());
        }
        lines.push('');
    }
    if (doc.details && doc.details.length > 0) {
        lines.push('Details:');
        for (const detail of doc.details)
            lines.push(`  ${detail}`);
        lines.push('');
    }
    lines.push(colors.bold('Examples:'));
    for (const example of doc.examples)
        lines.push(`  ${example}`);
    lines.push('');
    lines.push(colors.bold('Learn more:'));
    lines.push('  open-sdd help exit-codes    the exit-code contract, including the host-loop sentinel');
    lines.push('  open-sdd help formatting    color, machine output and diagnostics');
    if (doc.group === 'console' || doc.group === 'brownfield' || doc.group === 'daily') {
        lines.push('  open-sdd explain C1         what a gate code checks, offline');
    }
    lines.push('  docs/PAPER-ALIGNMENT.md     the normative traceability report');
    lines.push('');
    return lines.join('\n');
};
// ---------------------------------------------------------------------------------------------
// Temas
// ---------------------------------------------------------------------------------------------
const RIGOR_USAGE = () => {
    const lines = ['', formatHeading('RIGOR — the cumulative ladder'), ''];
    for (const spec of RIGOR_LEVELS) {
        lines.push(`  ${spec.level.padEnd(16)} ${spec.name} — gates ${spec.gatesActive.join(', ')}`);
        lines.push(`      ${spec.definition}`);
        lines.push(`      check: ${spec.evaluatorCheck}`);
    }
    lines.push('');
    lines.push(`  aspects: ${RIGOR_ASPECTS.join(', ')}`);
    lines.push('  = note: the levels only ADD; a higher level never lowers what the floor already checks');
    lines.push('  = note: the constitution is required at every level — a blocking verdict cites it');
    lines.push('  = help: `open-sdd govern rigor` assesses this repository against the declared level');
    lines.push('');
    return lines.join('\n');
};
const FORMATTING_USAGE = () => {
    const lines = ['', formatHeading('FORMATTING — color, diagnostics and the machine surface'), ''];
    lines.push('  Color precedence: --color=auto|always|never > FORCE_COLOR > NO_COLOR > TTY');
    lines.push('  NO_COLOR disables COLOR only (present and non-empty); bold/dim stay available');
    lines.push('  FORCE_COLOR present and not 0/false forces color even without a TTY');
    lines.push('  Every verdict keeps its glyph (✓ / ! / ✗) AND its word (PASS / WARN / FAIL):');
    lines.push('  color is never the only signal');
    lines.push('  Diagnostics are rustc-shaped: `error[code]: message`, `--> path:LL:CC`,');
    lines.push('  `= help:` for the runnable fix, `= note:` for the authority');
    lines.push('  Machine surface: JSON keys, ids (C1…C7, REQ-<AREA>-<NNN>), ruleIds and the commands');
    lines.push('  inside a fix stay English and are never localized by --lang');
    lines.push('  = help: `open-sdd help exit-codes` · `open-sdd doctor --json`');
    lines.push('');
    return lines.join('\n');
};
export const HELP_TOPICS = {
    'exit-codes': { title: 'exit-codes', render: () => `\n${formatHeading('EXIT CODES — the contract')}\n\n${EXIT_CODES_BODY}\n` },
    rigor: { title: 'rigor', render: RIGOR_USAGE },
    formatting: { title: 'formatting', render: FORMATTING_USAGE },
};
export const renderHelpTopic = (topic) => HELP_TOPICS[topic]?.render();
/** Explicar un código de gate sin red: la misma tabla que lee `gates list`. */
export const renderExplain = (code) => {
    const id = code.trim().toUpperCase();
    const gate = getExecutableGate(id);
    if (!gate) {
        return {
            ok: false,
            text: `error[usage]: unknown gate code \`${code}\``,
            suggestions: suggestCommands(id, EXECUTABLE_CHAIN.map((entry) => entry.id)),
        };
    }
    const lines = [
        '',
        formatHeading(`${gate.id} · ${gate.nameEn}`),
        `  ${gate.name}`,
        `  posture: ${gate.posture}${gate.inspects ? '' : ' · inspects nothing (reported vacant)'}${gate.requiresModel ? ' · requires a model backend' : ''}`,
        `  imposes: ${gate.imposes.join(', ')}`,
        gate.implemented === false ? '  state: declared but NOT implemented (counted, not executed)' : '',
        `  what it checks: ${gate.description}`,
        `  reference command: ${gate.command}`,
        `  = help: \`open-sdd gates list\` · \`open-sdd gates run\``,
        '',
    ].filter((line) => line.length > 0);
    return { ok: true, text: lines.join('\n'), suggestions: [] };
};
// ---------------------------------------------------------------------------------------------
// El comando `help`
// ---------------------------------------------------------------------------------------------
const usageErrorLines = (message, suggestions, helpCommand) => {
    const lines = [colors.red(`error[usage]: ${message}`)];
    for (const suggestion of suggestions) {
        lines.push(`  = help: did you mean \`${suggestion}\`? Run \`${helpCommand} ${suggestion}\``);
    }
    lines.push('  = help: run `open-sdd --help` to list every command, or `open-sdd help exit-codes`');
    return lines;
};
export const handleHelpCommand = async (argv, io) => {
    const topic = argv.find((arg) => !arg.startsWith('-'))?.toLowerCase();
    if (!topic) {
        io.log(renderFullHelp());
        return EXIT.PASSED;
    }
    const topicText = renderHelpTopic(topic);
    if (topicText) {
        io.log(topicText);
        return EXIT.PASSED;
    }
    const commandHelp = renderCommandHelp(topic);
    if (commandHelp) {
        io.log(commandHelp);
        return EXIT.PASSED;
    }
    for (const line of usageErrorLines(`unknown help topic \`${topic}\``, suggestCommands(topic, [...KNOWN_COMMANDS]), 'open-sdd help')) {
        io.error(line);
    }
    return EXIT.USAGE;
};
