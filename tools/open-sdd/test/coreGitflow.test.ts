/**
 * GitFlow nativo: el rol de la rama se DERIVA de las ramas que existen y decide la gobernanza.
 *
 * Cada fixture es un `mkdtemp` con un `git init` real y ramas reales; se elimina en `afterEach`.
 * Nada se escribe dentro del repositorio del proyecto: la detección se prueba contra repositorios
 * desechables, nunca contra el checkout.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  branchPolicy,
  detectGitFlow,
  renderGitFlow,
  type GitFlowState,
} from '../src/core/gitflow.js';

const temps: string[] = [];

const run = (cwd: string, args: string[]): void => {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
};

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * Un repositorio real con `main` y las ramas extra indicadas, todas sobre el mismo commit. La rama
 * actual se selecciona al final. `main` no se pasa en `branches`: siempre existe.
 */
const makeRepo = async (branches: string[], current: string, initial = 'main'): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-gitflow-'));
  temps.push(dir);
  run(dir, ['init', '-q', '-b', initial]);
  run(dir, ['config', 'user.email', 'fixture@example.com']);
  run(dir, ['config', 'user.name', 'Fixture']);
  run(dir, ['config', 'commit.gpgsign', 'false']);
  run(dir, ['config', 'tag.gpgsign', 'false']);
  await writeFile(path.join(dir, 'README.md'), '# fixture\n', 'utf8');
  run(dir, ['add', 'README.md']);
  run(dir, ['commit', '-q', '-m', 'chore: fixture']);
  for (const branch of branches) run(dir, ['branch', branch]);
  if (current !== initial) run(dir, ['checkout', '-q', current]);
  return dir;
};

const makeBareDir = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdd-gitflow-nogit-'));
  temps.push(dir);
  return dir;
};

const policyFor = (state: GitFlowState, opts?: { level?: string; brownfield?: boolean }) =>
  branchPolicy(state, opts);

describe('detectGitFlow — el modelo se lee de las ramas que existen', () => {
  it('detecta gitflow con develop+main+feature/x, rol feature y base develop', async () => {
    const dir = await makeRepo(['develop', 'feature/checkout-flow'], 'feature/checkout-flow');
    const state = await detectGitFlow(dir);

    expect(state.model).toBe('gitflow');
    expect(state.branch).toBe('feature/checkout-flow');
    expect(state.role).toBe('feature');
    expect(state.base).toBe('develop');
    expect(state.feature).toBe('checkout-flow');
    const evidence = state.evidence.join('\n');
    expect(evidence).toContain('main');
    expect(evidence).toContain('develop');
    expect(evidence).toContain('feature/checkout-flow');
  });

  it('detecta trunk cuando solo existe main', async () => {
    const dir = await makeRepo([], 'main');
    const state = await detectGitFlow(dir);

    expect(state.model).toBe('trunk');
    expect(state.branch).toBe('main');
    expect(state.role).toBe('main');
    expect(state.base).toBeNull();
    // No se afirma un modelo que no se vio: la evidencia no menciona gitflow como observado.
    expect(state.evidence.join('\n')).not.toContain('gitflow:');
  });

  it('detecta trunk con un único pivote que no se llama main', async () => {
    const dir = await makeRepo([], 'pivot', 'pivot');
    const state = await detectGitFlow(dir);

    expect(state.model).toBe('trunk');
    expect(state.role).toBe('other');
    expect(state.evidence.join('\n')).toContain('solo existe una rama');
    expect(state.evidence.join('\n')).not.toContain('gitflow:');
  });

  it('main + feature sin develop no es gitflow ni trunk: lo dice en vez de adivinar', async () => {
    const dir = await makeRepo(['feature/checkout-flow'], 'feature/checkout-flow');
    const state = await detectGitFlow(dir);

    expect(state.model).toBe('none');
    // El rol sí se lee del nombre aunque el modelo no se afirme.
    expect(state.role).toBe('feature');
    expect(state.base).toBe('main');
    expect(state.evidence.join('\n')).toContain('no es gitflow ni un trunk de una sola rama');
  });

  it('fuera de un repositorio git devuelve none/other sin lanzar', async () => {
    const dir = await makeBareDir();
    const state = await detectGitFlow(dir);

    expect(state.model).toBe('none');
    expect(state.branch).toBeNull();
    expect(state.role).toBe('other');
    expect(state.evidence.join('\n')).toContain('no es un árbol de trabajo git');
  });

  it('en HEAD desprendido no inventa una rama', async () => {
    const dir = await makeRepo(['develop', 'feature/checkout-flow'], 'feature/checkout-flow');
    run(dir, ['checkout', '-q', '--detach']);
    const state = await detectGitFlow(dir);

    expect(state.branch).toBeNull();
    expect(state.role).toBe('other');
    expect(state.evidence.join('\n')).toContain('HEAD desprendido');
  });
});

describe('detectGitFlow — rol, feature y versión salen del nombre', () => {
  it('extrae la feature de feature/<nombre>', async () => {
    const dir = await makeRepo(['develop', 'feature/payments-ledger'], 'feature/payments-ledger');
    const state = await detectGitFlow(dir);

    expect(state.role).toBe('feature');
    expect(state.feature).toBe('payments-ledger');
  });

  it('extrae la feature de feat/<nombre>', async () => {
    const dir = await makeRepo(['develop', 'feat/payments-ledger'], 'feat/payments-ledger');
    const state = await detectGitFlow(dir);

    expect(state.role).toBe('feature');
    expect(state.feature).toBe('payments-ledger');
  });

  it('bugfix/<x> es una rama de cambio (feature), no un hotfix', async () => {
    const dir = await makeRepo(['develop', 'bugfix/null-guard'], 'bugfix/null-guard');
    const state = await detectGitFlow(dir);

    expect(state.role).toBe('feature');
    expect(state.feature).toBe('null-guard');
    expect(state.version).toBeNull();
  });

  it('una rama release/<v> lleva su versión y su base es main', async () => {
    const dir = await makeRepo(['develop', 'release/1.4.0'], 'release/1.4.0');
    const state = await detectGitFlow(dir);

    expect(state.model).toBe('gitflow');
    expect(state.role).toBe('release');
    expect(state.version).toBe('1.4.0');
    expect(state.base).toBe('main');
  });

  it('una rama hotfix/<v> lleva su versión', async () => {
    const dir = await makeRepo(['develop', 'hotfix/1.4.1'], 'hotfix/1.4.1');
    const state = await detectGitFlow(dir);

    expect(state.role).toBe('hotfix');
    expect(state.version).toBe('1.4.1');
  });

  it('un prefijo desconocido es other y la política lo dice', async () => {
    const dir = await makeRepo(['develop', 'topic/cleanup'], 'topic/cleanup');
    const state = await detectGitFlow(dir);

    expect(state.role).toBe('other');
    expect(state.feature).toBeNull();
    const policy = policyFor(state);
    expect(policy.role).toBe('other');
    expect(policy.required.join('\n')).toContain('rol no reconocido');
    expect(policy.detail).toContain('no corresponde a la convención');
  });

  it('el sufijo <x>-delta declara la feature aunque no declare rol', async () => {
    const dir = await makeRepo(['develop', 'checkout-delta'], 'checkout-delta');
    const state = await detectGitFlow(dir);

    expect(state.role).toBe('other');
    expect(state.feature).toBe('checkout');
    const policy = policyFor(state);
    expect(policy.required.join('\n')).toContain('.sdd/specs/checkout/delta.md');
    expect(policy.nextStep).toBe('open-sdd delta validate checkout');
  });
});

describe('branchPolicy — el rol decide qué se exige', () => {
  it('release exige todo lo de feature MÁS changelog/versión, bundle de auditoría y CI verde', async () => {
    const featureDir = await makeRepo(['develop', 'feature/checkout-flow'], 'feature/checkout-flow');
    const releaseDir = await makeRepo(['develop', 'release/1.4.0'], 'release/1.4.0');
    const feature = policyFor(await detectGitFlow(featureDir));
    const release = policyFor(await detectGitFlow(releaseDir));

    expect(new Set(release.required)).not.toEqual(new Set(feature.required));
    expect(release.required.length).toBeGreaterThan(feature.required.length);
    for (const item of feature.required) expect(release.required).toContain(item);
    expect(release.required.join('\n')).toContain('bundle de auditoría');
    expect(release.required.join('\n')).toContain('CHANGELOG');
    expect(release.required.join('\n')).toContain('CI verde');
  });

  it('hotfix sigue exigiendo constitución y evidencia, más la delta posterior a la fusión', async () => {
    const dir = await makeRepo(['develop', 'hotfix/1.4.1'], 'hotfix/1.4.1');
    const policy = policyFor(await detectGitFlow(dir));
    const required = policy.required.join('\n');

    expect(policy.role).toBe('hotfix');
    expect(required).toContain('constitución');
    expect(required).toContain('evidencia capturada');
    expect(required).toContain('delta posterior a la fusión');
  });

  it('main es solo fusiones, con la cadena completa y sin trabajo directo', async () => {
    const dir = await makeRepo([], 'main');
    const state = await detectGitFlow(dir);
    const policy = policyFor(state);

    expect(policy.role).toBe('main');
    expect(policy.required.join('\n')).toContain('solo fusiones');
    expect(policy.gates).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']);
    expect(policy.nextStep).toBe('open-sdd gates run');
  });

  it('develop exige integración y el pivote, y difiere de feature', async () => {
    const featureDir = await makeRepo(['develop', 'feature/checkout-flow'], 'feature/checkout-flow');
    const developDir = await makeRepo(['develop', 'feature/checkout-flow'], 'develop');
    const feature = policyFor(await detectGitFlow(featureDir));
    const develop = policyFor(await detectGitFlow(developDir));

    expect(develop.role).toBe('develop');
    expect(new Set(develop.required)).not.toEqual(new Set(feature.required));
    expect(develop.required.join('\n')).toContain('integración');
  });

  it('el nivel de rigor decide los gates de una rama de cambio', async () => {
    const dir = await makeRepo(['develop', 'feature/checkout-flow'], 'feature/checkout-flow');
    const state = await detectGitFlow(dir);

    expect(policyFor(state).gates).toEqual(['C1', 'C2']);
    expect(policyFor(state, { level: 'spec-as-source' }).gates).toEqual([
      'C1',
      'C2',
      'C3',
      'C4',
      'C5',
      'C6',
    ]);
  });

  it('greenfield sustituye la delta por la tríada en el contrato de una feature', async () => {
    const dir = await makeRepo(['develop', 'feature/checkout-flow'], 'feature/checkout-flow');
    const state = await detectGitFlow(dir);

    expect(policyFor(state, { brownfield: true }).required.join('\n')).toContain('delta');
    expect(policyFor(state, { brownfield: false }).required.join('\n')).toContain('tríada viva');
  });

  it('blocking es honesto: nombra el suelo y no declara branch protection', async () => {
    const dir = await makeRepo(['develop', 'feature/checkout-flow'], 'feature/checkout-flow');
    const policy = policyFor(await detectGitFlow(dir));
    const blocking = policy.blocking.join('\n');

    expect(blocking).toContain('pre-commit');
    expect(blocking).toContain('pull_request');
    expect(blocking).toContain('open-sdd floor status');
    expect(blocking).toContain('NO instala branch protection');
  });
});

describe('renderGitFlow — una pantalla', () => {
  it('renderiza estado, requerido, bloqueo y UN siguiente paso', async () => {
    const dir = await makeRepo(['develop', 'release/1.4.0'], 'release/1.4.0');
    const state = await detectGitFlow(dir);
    const policy = policyFor(state);
    const lines = renderGitFlow(state, policy);

    expect(lines.length).toBeLessThanOrEqual(30);
    expect(lines.every((line) => typeof line === 'string')).toBe(true);
    const text = lines.join('\n');
    expect(text).toContain('modelo gitflow');
    expect(text).toContain('rol release');
    expect(text).toContain('Requerido por el rol release');
    expect(text).toContain('Bloquea hoy');
    expect(text).toContain('Siguiente paso: open-sdd gates run');
  });

  it('también renderiza un repositorio sin modelo ni rol', async () => {
    const dir = await makeBareDir();
    const state = await detectGitFlow(dir);
    const lines = renderGitFlow(state, branchPolicy(state));

    expect(lines.length).toBeLessThanOrEqual(30);
    expect(lines.join('\n')).toContain('modelo none');
    expect(lines.join('\n')).toContain('rol other');
  });
});
