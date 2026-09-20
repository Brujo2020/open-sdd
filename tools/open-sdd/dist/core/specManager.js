import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createAndCheckoutBranch, loadGitSettings } from './git.js';
export const resolveSddDir = async (cwd = process.cwd(), preferredDir = '.sdd') => {
    try {
        const sddStat = await stat(path.join(cwd, preferredDir));
        if (sddStat.isDirectory())
            return preferredDir;
    }
    catch {
        // fallback check for legacy .kiro
        try {
            const kiroStat = await stat(path.join(cwd, '.kiro'));
            if (kiroStat.isDirectory())
                return '.kiro';
        }
        catch {
            // return preferred default
        }
    }
    return preferredDir;
};
export const listSpecs = async (cwd = process.cwd(), sddDir = '.sdd') => {
    const specsDir = path.join(cwd, sddDir, 'specs');
    try {
        const entries = await readdir(specsDir, { withFileTypes: true });
        return entries
            .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
            .map((e) => e.name)
            .sort();
    }
    catch {
        return [];
    }
};
export const readSpecMetadata = async (cwd, feature, sddDir = '.sdd') => {
    const specJsonPath = path.join(cwd, sddDir, 'specs', feature, 'spec.json');
    try {
        const content = await readFile(specJsonPath, 'utf8');
        return JSON.parse(content);
    }
    catch {
        return null;
    }
};
export const writeSpecMetadata = async (cwd, feature, meta, sddDir = '.sdd') => {
    const specDir = path.join(cwd, sddDir, 'specs', feature);
    await mkdir(specDir, { recursive: true });
    const specJsonPath = path.join(specDir, 'spec.json');
    meta.updated_at = new Date().toISOString();
    await writeFile(specJsonPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
};
export const parseTasksMarkdown = (content) => {
    const lines = content.split('\n');
    const tasks = [];
    for (const line of lines) {
        const trimmed = line.trim();
        const taskMatch = trimmed.match(/^-\s*\[([ x\-])\]\s*(.+)$/i);
        if (!taskMatch)
            continue;
        const marker = taskMatch[1].toLowerCase();
        const rest = taskMatch[2].trim();
        let status = 'pending';
        if (marker === 'x')
            status = 'completed';
        else if (marker === '-')
            status = 'in_progress';
        // Parse boundary if present: _Boundary:_ `path1`, `path2`
        const boundaryMatch = rest.match(/_Boundary:_\s*([^_\n]+)/i);
        const boundary = boundaryMatch
            ? boundaryMatch[1]
                .split(/[,;]/)
                .map((p) => p.replace(/[`"]/g, '').trim())
                .filter(Boolean)
            : undefined;
        // Parse depends if present: _Depends:_ task-1, task-2
        const dependsMatch = rest.match(/_Depends:_\s*([^_\n]+)/i);
        const depends = dependsMatch
            ? dependsMatch[1]
                .split(/[,;]/)
                .map((d) => d.replace(/[`"]/g, '').trim())
                .filter(Boolean)
            : undefined;
        // Extract title (before boundary/depends)
        const title = rest.split(/_Boundary:|_Depends:/i)[0].trim();
        // Extract ID (e.g. "1.1", "task-1", or generate sequential)
        const idMatch = title.match(/^([0-9]+(?:\.[0-9]+)*|[a-zA-Z0-9_-]+):?\s*/);
        const id = idMatch ? idMatch[1] : `task-${tasks.length + 1}`;
        tasks.push({
            id,
            title,
            status,
            boundary,
            depends,
            raw: trimmed,
        });
    }
    return tasks;
};
export const parseRequirementsMarkdown = (content) => {
    const lines = content.split('\n');
    const requirements = [];
    let currentReq = null;
    for (const line of lines) {
        const trimmed = line.trim();
        // Match headers like "### REQ-1: Title" or "## Requirement 1: Title"
        const reqHeader = trimmed.match(/^#{2,4}\s*(?:REQ-([a-zA-Z0-9_-]+)|Requirement\s+([a-zA-Z0-9_-]+)):?\s*(.+)$/i);
        if (reqHeader) {
            if (currentReq)
                requirements.push(currentReq);
            const reqId = reqHeader[1] ? `REQ-${reqHeader[1]}` : `REQ-${reqHeader[2]}`;
            currentReq = {
                id: reqId,
                title: reqHeader[3].trim(),
                acceptanceCriteria: [],
            };
            continue;
        }
        if (currentReq) {
            // Capture criteria list items
            const criteriaMatch = trimmed.match(/^-\s*(.+)$/);
            if (criteriaMatch) {
                currentReq.acceptanceCriteria.push(criteriaMatch[1].trim());
            }
        }
    }
    if (currentReq)
        requirements.push(currentReq);
    return requirements;
};
export const getSpecStatus = async (cwd, feature, sddDir = '.sdd') => {
    const specDir = path.join(cwd, sddDir, 'specs', feature);
    const checkFile = async (name) => {
        try {
            await stat(path.join(specDir, name));
            return true;
        }
        catch {
            return false;
        }
    };
    const [hasBrief, hasReqs, hasDesign, hasTasks, hasAudit, meta] = await Promise.all([
        checkFile('brief.md'),
        checkFile('requirements.md'),
        checkFile('design.md'),
        checkFile('tasks.md'),
        checkFile('audit-report.md'),
        readSpecMetadata(cwd, feature, sddDir),
    ]);
    const exists = hasBrief || hasReqs || hasDesign || hasTasks || meta !== null;
    const approvals = meta?.approvals ?? { requirements: false, design: false, tasks: false };
    const phase = meta?.phase ?? 'initialized';
    let tasksCount = { total: 0, completed: 0, inProgress: 0, pending: 0, percent: 0 };
    let boundaries = [];
    if (hasTasks) {
        try {
            const taskContent = await readFile(path.join(specDir, 'tasks.md'), 'utf8');
            const parsed = parseTasksMarkdown(taskContent);
            const total = parsed.length;
            const completed = parsed.filter((t) => t.status === 'completed').length;
            const inProgress = parsed.filter((t) => t.status === 'in_progress').length;
            const pending = parsed.filter((t) => t.status === 'pending').length;
            const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
            tasksCount = { total, completed, inProgress, pending, percent };
            const boundSet = new Set();
            for (const t of parsed) {
                if (t.boundary)
                    t.boundary.forEach((b) => boundSet.add(b));
            }
            boundaries = Array.from(boundSet).sort();
        }
        catch {
            // ignore
        }
    }
    let requirementsCount = 0;
    if (hasReqs) {
        try {
            const reqContent = await readFile(path.join(specDir, 'requirements.md'), 'utf8');
            const parsedReqs = parseRequirementsMarkdown(reqContent);
            requirementsCount = parsedReqs.length;
        }
        catch {
            // ignore
        }
    }
    const checkApproval = (val) => {
        if (typeof val === 'boolean')
            return val;
        if (val && typeof val === 'object' && 'approved' in val)
            return Boolean(val.approved);
        return false;
    };
    const isApproved = checkApproval(approvals.requirements) &&
        checkApproval(approvals.design) &&
        checkApproval(approvals.tasks);
    return {
        name: feature,
        phase,
        exists,
        files: {
            brief: hasBrief,
            requirements: hasReqs,
            design: hasDesign,
            tasks: hasTasks,
            auditReport: hasAudit,
        },
        requirementsCount,
        tasks: tasksCount,
        approvals,
        boundaries,
        isApproved,
    };
};
export const initSpec = async (cwd, feature, options = {}) => {
    const sddDir = options.sddDir ?? (await resolveSddDir(cwd));
    const slug = feature
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!slug) {
        throw new Error('Invalid feature name. Please provide a descriptive slug (e.g. auth-webauthn).');
    }
    const specDir = path.join(cwd, sddDir, 'specs', slug);
    await mkdir(specDir, { recursive: true });
    const gitSettings = await loadGitSettings(cwd, sddDir);
    let branchCreated = false;
    let branchName;
    const shouldBranch = options.createBranch ?? (gitSettings.mode === 'strict' && gitSettings.auto_branch);
    if (shouldBranch) {
        branchName = `${gitSettings.branch_prefix}${slug}`;
        branchCreated = createAndCheckoutBranch(branchName, cwd);
    }
    const now = new Date().toISOString();
    const metadata = {
        name: slug,
        version: '1.0.0',
        phase: 'initialized',
        language: options.language ?? 'en',
        description: options.title ?? slug,
        approvals: {
            requirements: false,
            design: false,
            tasks: false,
        },
        created_at: now,
        updated_at: now,
    };
    await writeFile(path.join(specDir, 'spec.json'), JSON.stringify(metadata, null, 2) + '\n', 'utf8');
    // brief.md stub
    const briefContent = `# Feature Brief: ${options.title ?? slug}

## Problem Statement
Describe the customer problem, architectural friction, or new opportunity.

## Scope & Boundaries
- **Boundary Candidates**: Key modules, packages, or directories to be touched.
- **Out of Scope**: Explicit non-goals for this feature.
`;
    await writeFile(path.join(specDir, 'brief.md'), briefContent, 'utf8');
    // requirements.md stub (EARS format)
    const reqContent = `# Requirements: ${options.title ?? slug}

## User Stories & Business Value
Describe primary user personas and the expected outcome.

## Formal Specifications (EARS)

### REQ-1: Core Capability
- **Precondition**: When the system is initialized.
- **Trigger**: When the user initiates the action.
- **Response**: The system shall execute successfully.
- **Acceptance Criteria**:
  - Valid input yields expected output.
  - Edge cases return explicit structured errors.
`;
    await writeFile(path.join(specDir, 'requirements.md'), reqContent, 'utf8');
    return { specDir, branchCreated, branchName };
};
