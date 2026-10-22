/**
 * wave-2 — weaknesses closed (REQ-W2-002, 004, 005, 007, 008, 009).
 *
 * Every fixture lives in `mkdtemp`; the suite never writes into the repository.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentList, getAgentDefinition } from '../src/agents/registry.js';
import { handleInitCommand } from '../src/cli/commands/init.js';
import { HOST_INTEGRATIONS } from '../src/core/integrations.js';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(pkgRoot, '..', '..');
const manifestsDir = path.join(pkgRoot, 'templates', 'manifests');
const tempDirs: string[] = [];

const makeRoot = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-w2-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (tempDirs.length > 0) await rm(tempDirs.pop() as string, { recursive: true, force: true });
});

const makeIO = () => {
  const logs: string[] = [];
  const errs: string[] = [];
  return { io: { log: (m: string) => logs.push(m), error: (m: string) => errs.push(m), exit: () => undefined }, logs, errs };
};

describe('REQ-W2-004 — registry, manifests and template trees stay in step', () => {
  const manifests = readdirSync(manifestsDir).filter((f) => f.endsWith('.json'));
  const parsed = manifests.map((file) => ({
    file,
    json: JSON.parse(readFileSync(path.join(manifestsDir, file), 'utf8')) as {
      artifacts: { source: { fromDir?: string; from?: string } }[];
    },
  }));

  it('every manifestId in the registry has its manifest file', () => {
    for (const id of agentList) {
      const manifestId = getAgentDefinition(id).manifestId;
      if (manifestId === undefined) continue;
      expect(manifests, `${id}: manifest ${manifestId}.json missing`).toContain(`${manifestId}.json`);
    }
  });

  it('every manifest file is used by some agent', () => {
    const used = new Set(agentList.map((id) => getAgentDefinition(id).manifestId).filter(Boolean));
    for (const file of manifests) {
      expect(used.has(file.replace(/\.json$/, '')), `${file}: no agent installs it`).toBe(true);
    }
  });

  it('every agent template tree is reached by some manifest', () => {
    const sources = parsed.flatMap(({ file, json }) =>
      json.artifacts.map((a) => (a.source.fromDir ?? a.source.from ?? '').replace('{{AGENT}}', file.replace(/\.json$/, ''))),
    );
    const trees = readdirSync(path.join(pkgRoot, 'templates', 'agents')).filter((d) => d !== '_shared');
    for (const tree of trees) {
      expect(sources.some((src) => src.startsWith(`templates/agents/${tree}/`) || src === `templates/agents/${tree}`), `${tree}: orphan tree`).toBe(true);
    }
  });

  it('no template tree lives outside tools/open-sdd', () => {
    const tools = readdirSync(path.join(repoRoot, 'tools'));
    expect(tools.filter((dir) => dir !== 'open-sdd' && existsSync(path.join(repoRoot, 'tools', dir, 'templates')))).toEqual([]);
  });
});

describe('REQ-W2-005 — the committed dist/ is what src/ compiles to', () => {
  it('a fresh tsc build matches dist/ byte for byte (shebang aside)', async () => {
    const out = await makeRoot();
    const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
    execFileSync(process.execPath, [tsc, '-p', pkgRoot, '--outDir', out], { stdio: 'pipe' });
    const strip = (text: string): string => text.replace(/^#!.*\n/, '').replace(/\r\n/g, '\n');
    const walk = (dir: string, rel = ''): string[] =>
      readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(dir, path.join(rel, entry.name)) : entry.name.endsWith('.js') ? [path.join(rel, entry.name)] : [],
      );
    const stale = walk(out).filter((file) => {
      const committed = path.join(pkgRoot, 'dist', file);
      return !existsSync(committed) || strip(readFileSync(committed, 'utf8')) !== strip(readFileSync(path.join(out, file), 'utf8'));
    });
    expect(stale, 'dist/ is stale: run `npm run build` and commit dist/').toEqual([]);
  }, 120_000);
});

describe('REQ-W2-002 / 009 — init --agent', () => {
  it('an unknown agent exits 1 and lists the valid ids instead of reading it as a path', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();
    expect(await handleInitCommand(['--agent', 'nope'], ctx.io, dir)).toBe(1);
    expect(ctx.errs.join('\n')).toMatch(/Agente desconocido: "nope"/);
    expect(ctx.errs.join('\n')).toContain('cline-skills');
    // A hidden agent installs but is never advertised.
    expect(ctx.errs.join('\n')).not.toContain('axet');
    expect(ctx.errs.join('\n')).not.toMatch(/no existe/);
  });

  it('a list with one unknown id writes nothing', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();
    expect(await handleInitCommand(['.', '--agent', 'cline-skills,nope', '--write'], ctx.io, dir)).toBe(1);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('a list of valid ids plans each agent', async () => {
    const dir = await makeRoot();
    const ctx = makeIO();
    expect(await handleInitCommand(['.', '--agent', 'cline-skills,axet-skills', '--json'], ctx.io, dir)).toBe(0);
    const plans = ctx.logs.map((line) => JSON.parse(line) as { agent: { id: string } });
    expect(plans.map((plan) => plan.agent.id)).toEqual(['cline-skills', 'axet-skills']);
  });
});

describe('REQ-W2-008 — Cline and Axet', () => {
  it('both install the shared skills in their own directories', () => {
    expect(getAgentDefinition('cline-skills').layout.commandsDir).toBe('.cline/skills');
    expect(getAgentDefinition('axet-skills').layout.commandsDir).toBe('.axet-plugin/skills');
    for (const id of ['cline-skills', 'axet-skills']) {
      const manifest = JSON.parse(readFileSync(path.join(manifestsDir, `${id}.json`), 'utf8')) as {
        artifacts: { id: string; source: { fromDir?: string } }[];
      };
      expect(manifest.artifacts.find((a) => a.id === 'skills')?.source.fromDir).toBe('templates/agents/_shared/skills');
    }
    expect(getAgentDefinition('axet-skills').aliasFlags).toContain('--axet');
    expect(getAgentDefinition('cline-skills').aliasFlags).toContain('--cline');
  });

  it('init detects .axet-plugin/ and .cline/', async () => {
    for (const [marker, agent] of [['.axet-plugin', 'axet-skills'], ['.cline', 'cline-skills']] as const) {
      const dir = await makeRoot();
      await mkdir(path.join(dir, marker));
      const ctx = makeIO();
      expect(await handleInitCommand(['.', '--json'], ctx.io, dir)).toBe(0);
      expect((JSON.parse(ctx.logs.join('\n')) as { agent: { id: string } }).agent.id).toBe(agent);
    }
  });

  it('the Cline integration installs skills where Cline reads them (REQ-W2-003)', () => {
    const cline = HOST_INTEGRATIONS.find((host) => host.id === 'cline');
    expect(cline?.skills).toEqual({ layout: '.cline/skills/sdd-*/SKILL.md', mode: 'skills' });
  });
});

describe('REQ-W2-015 — Axet slash menu lists workflows, not skills', () => {
  const skills = readdirSync(path.join(pkgRoot, 'templates', 'agents', '_shared', 'skills')).sort();
  const workflowsDir = path.join(pkgRoot, 'templates', 'agents', 'axet-skills', 'workflows');

  it('ships one extensionless workflow per shared skill, so the command is exactly /<skill>', () => {
    expect(readdirSync(workflowsDir).sort()).toEqual(skills);
  });

  it('each workflow points at its own skill and nothing else', () => {
    for (const name of skills) {
      const text = readFileSync(path.join(workflowsDir, name), 'utf8');
      expect(text.startsWith(`# /${name}\n`)).toBe(true);
      expect(text).toContain(`.axet-plugin/skills/${name}/SKILL.md`);
      expect(text).toContain(`open-sdd:axet-workflow skill=${name}`);
    }
  });

  it('the axet-skills manifest installs them in .axetrules/workflows', () => {
    const manifest = JSON.parse(readFileSync(path.join(manifestsDir, 'axet-skills.json'), 'utf8')) as {
      artifacts: { id: string; source: { fromDir?: string; toDir?: string } }[];
    };
    expect(manifest.artifacts.find((a) => a.id === 'workflows')?.source).toMatchObject({
      fromDir: 'templates/agents/axet-skills/workflows',
      toDir: '.axetrules/workflows',
    });
  });
});

