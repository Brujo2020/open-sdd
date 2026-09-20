import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  initSpec,
  getSpecStatus,
  listSpecs,
  parseRequirementsMarkdown,
  parseTasksMarkdown,
} from '../src/core/specManager.js';

describe('core/specManager', () => {
  it('parses tasks markdown with status, boundary, and dependencies', () => {
    const markdown = `
# Tasks
- [x] 1.1 Setup database schema _Boundary:_ \`src/db/schema.ts\`
- [-] 1.2 Implement user repository _Boundary:_ \`src/repos/user.ts\`, \`src/repos/base.ts\` _Depends:_ 1.1
- [ ] 1.3 Add authentication service _Depends:_ 1.2
`;
    const tasks = parseTasksMarkdown(markdown);
    expect(tasks).toHaveLength(3);

    expect(tasks[0].id).toBe('1.1');
    expect(tasks[0].status).toBe('completed');
    expect(tasks[0].boundary).toEqual(['src/db/schema.ts']);

    expect(tasks[1].id).toBe('1.2');
    expect(tasks[1].status).toBe('in_progress');
    expect(tasks[1].boundary).toEqual(['src/repos/user.ts', 'src/repos/base.ts']);
    expect(tasks[1].depends).toEqual(['1.1']);

    expect(tasks[2].id).toBe('1.3');
    expect(tasks[2].status).toBe('pending');
    expect(tasks[2].boundary).toBeUndefined();
    expect(tasks[2].depends).toEqual(['1.2']);
  });

  it('parses EARS requirements markdown', () => {
    const markdown = `
# Requirements

### REQ-1: Passwordless Login
- The user enters email
- System sends magic link

### REQ-AUTH-2: Biometric Verification
- Device prompts for FaceID/TouchID
- System verifies cryptographic signature
`;
    const reqs = parseRequirementsMarkdown(markdown);
    expect(reqs).toHaveLength(2);
    expect(reqs[0].id).toBe('REQ-1');
    expect(reqs[0].title).toBe('Passwordless Login');
    expect(reqs[0].acceptanceCriteria).toHaveLength(2);

    expect(reqs[1].id).toBe('REQ-AUTH-2');
    expect(reqs[1].title).toBe('Biometric Verification');
    expect(reqs[1].acceptanceCriteria).toHaveLength(2);
  });

  it('initializes a new specification and reads status', async () => {
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'sdd-test-spec-'));
    const result = await initSpec(tmpDir, 'auth-magic-link', {
      title: 'Passwordless Magic Link Auth',
      language: 'en',
      createBranch: false,
    });

    expect(result.specDir).toContain('auth-magic-link');

    const specs = await listSpecs(tmpDir);
    expect(specs).toContain('auth-magic-link');

    const status = await getSpecStatus(tmpDir, 'auth-magic-link');
    expect(status.name).toBe('auth-magic-link');
    expect(status.phase).toBe('initialized');
    expect(status.files.brief).toBe(true);
    expect(status.files.requirements).toBe(true);
    expect(status.files.design).toBe(false);
    expect(status.files.tasks).toBe(false);
    expect(status.isApproved).toBe(false);

    const briefContent = await readFile(path.join(result.specDir, 'brief.md'), 'utf8');
    expect(briefContent).toContain('Passwordless Magic Link Auth');
  });
});
