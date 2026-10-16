/**
 * The approval ledger — an approval bound to the bytes that were approved.
 *
 * `spec.json` records approvals as booleans (`"requirements": true`). A boolean survives every later
 * edit, so a requirements file rewritten after its review still reads "approved": the approval is a
 * label, not a fact. The field converged on the fix independently (spec-workflow-mcp's approvals
 * ledger, the two-list review of the retired Copilot Workspace, EVOLUTION-PLAN W8.1 row 8): record
 * WHO approved WHAT, WHEN, and the sha256 of the artifact, then re-hash on every check.
 *
 * Ledger: `.sdd/specs/<feature>/approvals.json`. It is committed with the spec, so the history of
 * approvals is git history. The three gates follow the triad order — design cannot be approved before
 * a FRESH requirements approval, nor tasks before a fresh design approval — because approving a plan
 * for requirements that changed since their review approves nothing.
 *
 * Deterministic, offline, no model: every verdict is a hash comparison a reader can reproduce with
 * `sha256sum`.
 */
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const APPROVAL_GATES = ['requirements', 'design', 'tasks'];
export const APPROVALS_FILE = 'approvals.json';
/** The artifact each gate approves; the first existing candidate wins (`design.md` aliases `plan.md`). */
const GATE_FILES = {
    requirements: ['requirements.md'],
    design: ['plan.md', 'design.md'],
    tasks: ['tasks.md'],
};
export const isApprovalGate = (value) => APPROVAL_GATES.includes(value);
export const specDirOf = (root, feature) => path.join(root, '.sdd', 'specs', feature);
const sha256 = (content) => createHash('sha256').update(content).digest('hex');
const fileExists = async (p) => (await stat(p).catch(() => null))?.isFile() ?? false;
export const resolveGateArtifact = async (specDir, gate) => {
    for (const name of GATE_FILES[gate]) {
        if (await fileExists(path.join(specDir, name)))
            return name;
    }
    return null;
};
export const readApprovalLedger = async (specDir) => {
    try {
        const raw = JSON.parse(await readFile(path.join(specDir, APPROVALS_FILE), 'utf8'));
        const ledger = {};
        for (const gate of APPROVAL_GATES) {
            const entry = raw[gate];
            if (entry && typeof entry.sha256 === 'string' && typeof entry.by === 'string' && typeof entry.file === 'string') {
                ledger[gate] = {
                    by: entry.by,
                    at: typeof entry.at === 'string' ? entry.at : '',
                    file: entry.file,
                    sha256: entry.sha256,
                    ...(typeof entry.note === 'string' && entry.note.length > 0 ? { note: entry.note } : {}),
                };
            }
        }
        return ledger;
    }
    catch {
        return {};
    }
};
export const gateStatus = async (specDir, gate, ledger) => {
    const file = await resolveGateArtifact(specDir, gate);
    const record = ledger[gate] ?? null;
    if (file === null) {
        return { gate, state: 'no-artifact', file: null, record, currentSha256: null, detail: `no ${GATE_FILES[gate].join(' / ')} to approve` };
    }
    const currentSha256 = sha256(await readFile(path.join(specDir, file)));
    if (record === null) {
        return { gate, state: 'missing', file, record, currentSha256, detail: `${file} has no recorded approval` };
    }
    if (record.file !== file || record.sha256 !== currentSha256) {
        return {
            gate,
            state: 'stale',
            file,
            record,
            currentSha256,
            detail: `${file} changed after ${record.by} approved it (${record.at.slice(0, 10) || 'unknown date'}): the approval no longer covers these bytes`,
        };
    }
    return { gate, state: 'fresh', file, record, currentSha256, detail: `approved by ${record.by} on ${record.at.slice(0, 10)}` };
};
export const checkApprovals = async (specDir) => {
    const ledger = await readApprovalLedger(specDir);
    const out = [];
    for (const gate of APPROVAL_GATES)
        out.push(await gateStatus(specDir, gate, ledger));
    return out;
};
/**
 * Record an approval. Refused when the artifact is missing, or when the previous gate in the triad
 * order is not FRESHLY approved. Re-approving unchanged bytes is idempotent (the record is rewritten
 * with the new approver and date, the hash is the same).
 */
export const approveGate = async (input) => {
    const specDir = specDirOf(input.root, input.feature);
    const ledger = await readApprovalLedger(specDir);
    const index = APPROVAL_GATES.indexOf(input.gate);
    if (index > 0) {
        const previous = APPROVAL_GATES[index - 1];
        const prior = await gateStatus(specDir, previous, ledger);
        if (prior.state !== 'fresh') {
            return {
                ok: false,
                status: await gateStatus(specDir, input.gate, ledger),
                refusal: {
                    message: `cannot approve ${input.gate} while ${previous} is ${prior.state}: ${prior.detail}`,
                    fix: `open-sdd approve ${input.feature} --gate ${previous} --by "${input.by}"`,
                },
            };
        }
    }
    const file = await resolveGateArtifact(specDir, input.gate);
    if (file === null) {
        return {
            ok: false,
            status: await gateStatus(specDir, input.gate, ledger),
            refusal: {
                message: `nothing to approve: ${GATE_FILES[input.gate].join(' / ')} does not exist in .sdd/specs/${input.feature}/`,
                fix: `open-sdd status ${input.feature}`,
            },
        };
    }
    const record = {
        by: input.by,
        at: (input.now ?? new Date()).toISOString(),
        file,
        sha256: sha256(await readFile(path.join(specDir, file))),
        ...(input.note ? { note: input.note } : {}),
    };
    const next = { ...ledger, [input.gate]: record };
    await writeFile(path.join(specDir, APPROVALS_FILE), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await syncSpecJsonFlag(specDir, input.gate);
    return { ok: true, status: await gateStatus(specDir, input.gate, next) };
};
/**
 * Keep `spec.json` coherent for the skills that read its booleans: set the gate's flag to true in
 * whichever of the two shapes the file uses. Never creates `spec.json`, never touches other fields.
 */
const syncSpecJsonFlag = async (specDir, gate) => {
    const specJson = path.join(specDir, 'spec.json');
    let raw;
    try {
        raw = await readFile(specJson, 'utf8');
    }
    catch {
        return;
    }
    try {
        const parsed = JSON.parse(raw);
        if (!parsed.approvals || typeof parsed.approvals !== 'object')
            return;
        const current = parsed.approvals[gate];
        if (current !== null && typeof current === 'object')
            current.approved = true;
        else
            parsed.approvals[gate] = true;
        await writeFile(specJson, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    }
    catch {
        // A malformed spec.json is reported by `status`; the ledger stays the source of truth.
    }
};
