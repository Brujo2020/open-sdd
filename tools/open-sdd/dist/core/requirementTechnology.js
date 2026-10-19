/**
 * Advisory check: a requirement states WHAT the system must do, not WHICH technology does it.
 *
 * ── Why it is included (ported from SteelForge; rule from cc-sdd) ───────────────────────────────────────
 * A requirement that names PostgreSQL, React or Kafka fixes a design decision inside the document that is supposed
 * to survive any design: the plan can no longer choose, and a change of technology becomes a "requirement change".
 * The catalogue declares the idea as `VER-004` (solution prescribed) but needs the standards catalogue loaded; this
 * is the deterministic part that runs with no catalogue, no model and no network.
 *
 * ── Why it is only a hint ───────────────────────────────────────────────────────────────────────────────
 * Sometimes the technology IS the requirement (a contract, an ADR, an existing platform). So the finding is
 * `info`, the list is limited to names that are unambiguous in prose (no `Go`, `Rails`, `Express`, `Spring`), and a
 * criterion that records the constraint (`Constraint:`, `Restricción:`, `ADR-…`, `per contract`) is left alone.
 */
import { parseRequirementsMarkdown } from './specManager.js';
/** Technology names that are unambiguous in prose. */
export const TECHNOLOGIES = [
    'PostgreSQL', 'Postgres', 'MySQL', 'MariaDB', 'MongoDB', 'SQLite', 'Redis', 'Memcached', 'Cassandra', 'DynamoDB', 'Elasticsearch', 'Kafka', 'RabbitMQ',
    'Kubernetes', 'Docker', 'Terraform', 'Ansible', 'Nginx', 'GraphQL', 'gRPC', 'WebSocket', 'Firebase', 'Supabase', 'AWS Lambda', 'S3',
    'React', 'Angular', 'Vue.js', 'Svelte', 'Next.js', 'Nuxt', 'Node.js', 'Django', 'FastAPI', 'Laravel', 'Tailwind', 'Redux',
    'TypeScript', 'JavaScript', 'Python', 'Java', 'Kotlin', 'Rust', 'PHP',
];
/** A criterion that records why the technology is imposed. */
const RECORDED_CONSTRAINT = /\b(?:constraint|restricci[oó]n|restricted by|per (?:contract|adr)|mandated|ADR-?\d+)\b/i;
const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERN = new RegExp(`(?<![\\w.])(${TECHNOLOGIES.map(escape).join('|')})(?![\\w])`, 'i');
/**
 * Finds acceptance criteria that name a technology.
 * @param requirementsMarkdown - content of requirements.md.
 * @returns one hit per criterion (the first technology it names).
 */
export const findTechnologyInRequirements = (requirementsMarkdown) => {
    const hits = [];
    for (const req of parseRequirementsMarkdown(requirementsMarkdown)) {
        for (const criterion of req.acceptanceCriteria) {
            if (RECORDED_CONSTRAINT.test(criterion))
                continue;
            const m = PATTERN.exec(criterion);
            if (m)
                hits.push({ requirementId: req.id, technology: m[1], criterion: criterion.length > 100 ? `${criterion.slice(0, 99)}…` : criterion });
        }
    }
    return hits;
};
