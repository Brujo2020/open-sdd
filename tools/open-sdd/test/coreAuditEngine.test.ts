import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initSpec } from '../src/core/specManager.js';
import { auditFeature, auditAll } from '../src/core/auditEngine.js';

describe('core/auditEngine', () => {
  it('detects unmapped requirements and produces RTM', async () => {
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'sdd-test-audit-'));
    const { specDir } = await initSpec(tmpDir, 'auth-feature', { createBranch: false });

    const reqsMd = `
# Requirements
### REQ-1: Login via OAuth
- Users can login with Google
### REQ-2: Session Timeout
- Inactive sessions expire after 15m
`;
    await writeFile(path.join(specDir, 'requirements.md'), reqsMd, 'utf8');

    const tasksMd = `
# Tasks
- [x] 1. Implement Google OAuth (REQ-1) _Boundary:_ \`src/auth.ts\`
`;
    await writeFile(path.join(specDir, 'tasks.md'), tasksMd, 'utf8');

    const audit = await auditFeature(tmpDir, 'auth-feature', { regulatory: true });
    expect(audit.feature).toBe('auth-feature');
    expect(audit.rtm).toHaveLength(2);

    const req1 = audit.rtm.find((r) => r.requirementId === 'REQ-1');
    expect(req1?.mappedTasks.length).toBeGreaterThan(0);

    const req2 = audit.rtm.find((r) => r.requirementId === 'REQ-2');
    expect(req2?.mappedTasks).toHaveLength(0);

    expect(audit.issues.some((i) => i.code === 'UNMAPPED_REQUIREMENT')).toBe(true);
    expect(audit.regulatory).toBeDefined();
    expect(audit.regulatory?.compliancePercent).toBeGreaterThanOrEqual(0);
  });

  it('runs project-wide audit', async () => {
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'sdd-test-audit-all-'));
    await initSpec(tmpDir, 'spec-one', { createBranch: false });
    await initSpec(tmpDir, 'spec-two', { createBranch: false });

    const projectAudit = await auditAll(tmpDir);
    expect(projectAudit.features).toHaveLength(2);
    expect(projectAudit.overallScore).toBeGreaterThanOrEqual(0);
  });
});
