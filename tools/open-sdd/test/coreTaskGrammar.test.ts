import { describe, it, expect } from 'vitest';
import { checkTaskGrammar, parseTaskBlocks } from '../src/core/taskGrammar.js';

const codes = (md: string): string[] => checkTaskGrammar(md).map((f) => f.code);

describe('parseTaskBlocks', () => {
  it('attaches indented detail lines to their task and stops at a heading', () => {
    const blocks = parseTaskBlocks('- [ ] 1.1 Do it (P)\n  - _Requirements: REQ-A-001_\n  - _Boundary: api_\n## Next\n  - _Requirements: REQ-B-001_\n');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ id: '1.1', parallel: true });
    expect(blocks[0].text).toContain('REQ-A-001');
    expect(blocks[0].text).not.toContain('REQ-B-001');
  });
});

describe('checkTaskGrammar', () => {
  it('a clean template-shaped file has no findings', () => {
    const md = [
      '- [ ] 1. Foundation',
      '- [ ] 1.1 Model (P)',
      '  - _Requirements: REQ-A-001_',
      '  - _Boundary: model_',
      '- [ ] 1.2 API',
      '  - _Requirements: REQ-A-002_',
      '  - _Depends: 1.1_',
    ].join('\n');
    expect(codes(md)).toEqual([]);
  });

  it('REQ-SSP-005: dangling _Depends:_ is an error', () => {
    const f = checkTaskGrammar('- [ ] 1. A — _Requirements: REQ-A-001_ — _Depends:_ 7\n');
    expect(f).toEqual([expect.objectContaining({ code: 'TASK_DEPENDS_UNKNOWN', severity: 'error' })]);
  });

  it('REQ-SSP-006: duplicate numeric id is an error', () => {
    expect(codes('- [ ] 1. A REQ-A-001\n- [ ] 1. B REQ-A-002\n')).toEqual(['TASK_DUPLICATE_ID']);
  });

  it('REQ-SSP-006: word ids from free-text titles are not compared', () => {
    expect(codes('- [ ] Write docs REQ-A-001\n- [ ] Write tests REQ-A-002\n')).toEqual([]);
  });

  it('REQ-SSP-007: (P) without boundary is a warning', () => {
    const f = checkTaskGrammar('- [ ] 2.1 Build (P) — _Requirements: REQ-A-001_\n');
    expect(f).toEqual([expect.objectContaining({ code: 'TASK_PARALLEL_WITHOUT_BOUNDARY', severity: 'warning' })]);
  });

  it('REQ-SSP-008: a leaf task without requirement warns, its parent does not', () => {
    expect(codes('- [ ] 1. Parent\n- [ ] 1.1 Child\n')).toEqual(['TASK_WITHOUT_REQUIREMENT']);
    expect(checkTaskGrammar('- [ ] 1. Parent\n- [ ] 1.1 Child\n')[0].message).toContain('1.1');
  });

  it('REQ-SSP-008: numeric template citations count, placeholders do not', () => {
    expect(codes('- [ ] 1. Restore — _Requirements: 1_\n')).toEqual([]);
    expect(codes('- [ ] 1. Restore\n  - _Requirements: {{REQUIREMENT_IDS}}_\n')).toEqual(['TASK_WITHOUT_REQUIREMENT']);
  });
});
