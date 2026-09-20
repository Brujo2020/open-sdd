/**
 * Pruebas de comportamiento del BORRADOR de constitución.
 *
 * Cada test fija una regla, no una implementación: que una práctica solo llegue a principio si el
 * código la demuestra, que una práctica ausente sea una pregunta, que el borrador NO sea autoridad
 * (ni para el pivote ni para `principlesInForce`), y que la ratificación sea una puerta humana que
 * deja rastro. Los fixtures viven en `mkdtemp` y se borran en `afterEach`: nada escribe en este
 * repositorio.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DRAFT_MARKER,
  DRAFT_VALIDATION_RULES,
  buildConstitutionDraft,
  draftPrincipleIds,
  evidencePackForHost,
  ratifyDraft,
} from '../src/core/constitutionDraft.js';
import {
  parseConstitution,
  parseEvidenceArtifact,
  principlesInForce,
  renderConstitution,
  validateConstitution,
  type Constitution,
  type ConstitutionPrinciple,
} from '../src/core/constitution.js';
import { SPEC_PRINCIPLES_MARKER, alignSpecWithConstitution } from '../src/core/specConstitution.js';

const temps: string[] = [];

const makeTemp = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A project whose code demonstrates several practices: tests, public API, module boundaries. */
const evidencedFixture = async (): Promise<string> => {
  const dir = await makeTemp('open-sdd-draft-');
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'draft-fixture',
        version: '1.0.0',
        scripts: { test: 'vitest run' },
        devDependencies: { typescript: '^5.9.3', vitest: '^4.0.18' },
      },
      null,
      2,
    ),
    'utf8',
  );
  await writeFile(path.join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3 }, null, 2), 'utf8');
  await writeFile(path.join(dir, 'tsconfig.json'), '{\n  "compilerOptions": { "strict": true }\n}\n', 'utf8');
  await mkdir(path.join(dir, 'src', 'core'), { recursive: true });
  await mkdir(path.join(dir, 'test'), { recursive: true });
  await writeFile(path.join(dir, 'src', 'index.ts'), 'export const api = true;\n', 'utf8');
  await writeFile(path.join(dir, 'src', 'core', 'engine.ts'), 'export const engine = true;\n', 'utf8');
  await writeFile(path.join(dir, 'test', 'engine.test.ts'), 'export const placeholder = true;\n', 'utf8');
  return dir;
};

/** A project whose code does NOT show the practices: no tests, nothing to cite as an oracle. */
const bareFixture = async (): Promise<string> => {
  const dir = await makeTemp('open-sdd-draft-bare-');
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'bare-fixture' }, null, 2), 'utf8');
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await writeFile(path.join(dir, 'src', 'index.ts'), 'export const api = true;\n', 'utf8');
  return dir;
};

const constitutionWith = (principles: ConstitutionPrinciple[]): Constitution => ({
  project: 'demo',
  provenance: 'descriptive',
  establishedFacts: [],
  principles,
  amendments: [],
});

const proposed = (overrides: Partial<ConstitutionPrinciple> = {}): ConstitutionPrinciple => ({
  id: 'DRAFT-OK',
  title: 'Un principio propuesto',
  level: 'SHOULD',
  restriction: 'Restricción concreta del principio propuesto.',
  pattern: 'Patrón concreto de cumplimiento.',
  justification: 'La justificación explica por qué existe la restricción en este repositorio.',
  provenance: 'descriptive',
  evidence: ['src/index.ts'],
  draft: true,
  ...overrides,
});

describe('core/constitutionDraft — el día uno no es una página en blanco', () => {
  it('solo propone lo que el código demuestra: cada evidencia de ruta existe en el repositorio', async () => {
    const dir = await evidencedFixture();
    const draft = await buildConstitutionDraft(dir);

    const withEvidence = draft.proposals.filter((proposal) => !proposal.needsHumanDecision);
    expect(withEvidence.length).toBeGreaterThan(0);
    // At least one proposal cites a real path in the fixture (the public API entry point)...
    const anyResolvablePath = withEvidence.some((proposal) =>
      proposal.evidence.some((entry) => {
        const artifact = parseEvidenceArtifact(entry, { cwd: dir });
        return artifact.file !== undefined && artifact.resolvable;
      }),
    );
    expect(anyResolvablePath).toBe(true);

    for (const proposal of withEvidence) {
      expect(proposal.principle.draft).toBe(true);
      expect(proposal.evidence.length).toBeGreaterThan(0);
      expect(proposal.principle.evidence).toEqual(proposal.evidence);

      // ...and no path-shaped reference anywhere points at something that is not there. A fact such
      // as `package manager: npm` is not path-shaped, so a path lookup cannot falsify it and it is
      // kept as-is instead of being dropped.
      for (const entry of proposal.evidence) {
        const artifact = parseEvidenceArtifact(entry, { cwd: dir });
        if (artifact.file !== undefined) expect(artifact.resolvable, `${entry} debe existir`).toBe(true);
      }
    }
  });

  it('convierte una práctica que el código no muestra en pregunta, nunca en principio', async () => {
    const dir = await bareFixture();
    const draft = await buildConstitutionDraft(dir);

    expect(draft.questions.length).toBeGreaterThan(0);
    expect(draft.questions.join(' | ')).toMatch(/regresión|oráculo/i);

    const absent = draft.proposals.find((proposal) => proposal.principle.id === 'C-REGRESSION-ORACLE');
    expect(absent).toBeDefined();
    expect(absent?.needsHumanDecision).toBe(true);
    expect(absent?.evidence).toEqual([]);
    expect(absent?.question).toBeDefined();

    // It never reaches the principles section of the document.
    expect(parseConstitution(draft.text).principles.map((principle) => principle.id)).not.toContain(
      'C-REGRESSION-ORACLE',
    );
    expect(draft.complete).toBe(false);
    expect(draft.detail).toMatch(/INCOMPLETO/i);
  });

  it('marca el documento como borrador y lo deja fuera de vigor, también tras la ida y vuelta', async () => {
    const dir = await evidencedFixture();
    const draft = await buildConstitutionDraft(dir);

    const firstLines = draft.text.split('\n').slice(0, 6).join('\n');
    expect(firstLines).toContain(DRAFT_MARKER);
    expect(firstLines).toMatch(/--ratify/);

    const reloaded = parseConstitution(draft.text);
    expect(reloaded.principles.length).toBeGreaterThan(0);
    expect(reloaded.principles.every((principle) => principle.draft === true)).toBe(true);
    // The mechanism, not a convention: no draft reaches the in-force list.
    expect(principlesInForce(reloaded)).toEqual([]);
    expect(draftPrincipleIds(reloaded).length).toBe(reloaded.principles.length);

    // And the flag survives a render/parse cycle: a reloaded draft stays a draft.
    const again = parseConstitution(renderConstitution(reloaded));
    expect(draftPrincipleIds(again)).toEqual(draftPrincipleIds(reloaded));
    expect(again.principles.map((principle) => principle.draft)).toEqual(
      reloaded.principles.map((principle) => principle.draft),
    );
  });

  it('principlesInForce excluye borradores sin tocar los principios que sí están en vigor', () => {
    const constitution = constitutionWith([
      proposed({ id: 'LIVE-DESC', draft: undefined }),
      proposed({ id: 'DRAFT-ONE', draft: true }),
      proposed({
        id: 'LIVE-NORM',
        draft: undefined,
        provenance: 'normative',
        amendment: {
          id: 'AMD-1',
          title: 'Enmienda en vigor',
          proposedBy: 'lead',
          status: 'in-force',
          migrationPlan: 'Migrar por módulo.',
        },
      }),
    ]);

    expect(principlesInForce(constitution).map((principle) => principle.id)).toEqual(['LIVE-DESC', 'LIVE-NORM']);
    expect(draftPrincipleIds(constitution)).toEqual(['DRAFT-ONE']);
  });
});

describe('core/constitutionDraft — la severidad de un problema en un borrador', () => {
  it('un borrador sin amenaza ni justificación suficiente se reporta como aviso, no como ley', () => {
    const weak = proposed({
      id: 'DRAFT-001',
      level: 'MUST',
      threatReference: undefined,
      cweReference: undefined,
      justification: 'Porque sí.',
      draft: true,
    });

    const issues = validateConstitution(constitutionWith([weak]));
    const must = issues.find((issue) => issue.code === 'MUST-THREAT');
    const rationale = issues.find((issue) => issue.code === 'RATIONALE-THREAT');

    // Decisión documentada: `warning`, no `error`. Un borrador NO es todavía la autoridad que un
    // veredicto bloqueante cita, así que declararlo inválido sería una acusación falsa; pero el
    // ratificador tiene que ver el defecto ANTES de ratificar, así que el hallazgo no se silencia.
    expect(must?.severity).toBe('warning');
    expect(must?.message).toMatch(/borrador/i);
    expect(rationale?.severity).toBe('warning');
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);

    // El mismo texto sin la marca de borrador sí es una violación de ley.
    const inForce = validateConstitution(constitutionWith([{ ...weak, draft: undefined }]));
    expect(inForce.find((issue) => issue.code === 'MUST-THREAT')?.severity).toBe('error');
    expect(inForce.find((issue) => issue.code === 'RATIONALE-THREAT')?.severity).toBe('error');
  });
});

describe('core/constitutionDraft — ratificar es una puerta humana', () => {
  const rationale = 'La evidencia observada demuestra la práctica y el equipo la acepta como principio.';

  const draftConstitution = (): Constitution =>
    constitutionWith([
      proposed({ id: 'DRAFT-OK' }),
      proposed({ id: 'DRAFT-BARE', title: 'Sin evidencia', evidence: [] }),
      proposed({ id: 'LIVE-ONE', title: 'Ya en vigor', draft: undefined }),
    ]);

  it('lanza sin persona nombrada y sin motivo, en español', () => {
    const constitution = draftConstitution();
    expect(() => ratifyDraft(constitution, { by: '   ', rationale })).toThrow(/--by/);
    expect(() => ratifyDraft(constitution, { by: 'Ada Lovelace', rationale: '   ' })).toThrow(/--rationale|motivo/i);
  });

  it('solo ratifica lo que el borrador propone y tiene evidencia, y rechaza el resto diciendo por qué', () => {
    const result = ratifyDraft(draftConstitution(), { by: 'Ada Lovelace', rationale });

    // Without --ids the selection is exactly the draft set, so an in-force principle is never even a
    // candidate; the evidence-less proposal is selected and refused.
    expect(result.ratified).toEqual(['DRAFT-OK']);
    expect(result.refused.map((refusal) => refusal.id)).toEqual(['DRAFT-BARE']);
    expect(result.refused.find((refusal) => refusal.id === 'DRAFT-BARE')?.why).toMatch(/evidencia/i);

    // Only the ratified one loses the mark; the evidence-less one stays a draft.
    expect(draftPrincipleIds(result.constitution)).toEqual(['DRAFT-BARE']);
    const promoted = result.constitution.principles.find((principle) => principle.id === 'DRAFT-OK');
    expect(promoted?.draft).toBe(false);
    expect(principlesInForce(result.constitution).map((principle) => principle.id)).toContain('DRAFT-OK');
    // An in-force principle is untouched: no amendment is invented for something that is not a draft.
    expect(result.constitution.amendments.map((amendment) => amendment.id)).toEqual(['AMD-RATIFY-DRAFT-OK']);
  });

  it('registra al ratificador y el motivo en el registro de enmiendas', () => {
    const result = ratifyDraft(draftConstitution(), { by: 'Ada Lovelace', rationale });
    const promoted = result.constitution.principles.find((principle) => principle.id === 'DRAFT-OK');

    expect(promoted?.amendment).toBeDefined();
    expect(promoted?.amendment?.proposedBy).toBe('Ada Lovelace');
    expect(promoted?.amendment?.rationale).toBe(rationale);
    expect(promoted?.amendment?.status).toBe('in-force');
    expect(promoted?.amendment?.approvals?.[0]?.actor).toBe('Ada Lovelace');
    expect(result.constitution.amendments.some((amendment) => amendment.id === promoted?.amendment?.id)).toBe(true);

    // The record survives the artifact: a ratification nobody can read afterwards is not a record.
    const reloaded = parseConstitution(renderConstitution(result.constitution));
    const roundTripped = reloaded.principles.find((principle) => principle.id === 'DRAFT-OK');
    expect(roundTripped?.draft).toBeUndefined();
    expect(roundTripped?.amendment?.proposedBy).toBe('Ada Lovelace');
    expect(roundTripped?.amendment?.rationale).toBe(rationale);
    // The promoted principle is renderable without the draft mark (the un-ratified one keeps it).
    const promotedOnly = renderConstitution({
      ...result.constitution,
      principles: result.constitution.principles.filter((principle) => principle.id === 'DRAFT-OK'),
    });
    expect(promotedOnly).not.toContain('- Draft: true');
    expect(renderConstitution(result.constitution)).toContain('- Draft: true');
  });

  it('con ids explícitos solo acepta los que están en el borrador', () => {
    const result = ratifyDraft(draftConstitution(), {
      by: 'Ada Lovelace',
      rationale,
      ids: ['DRAFT-OK', 'C-NOPE', 'LIVE-ONE'],
    });

    expect(result.ratified).toEqual(['DRAFT-OK']);
    expect(result.refused.map((refusal) => refusal.id)).toEqual(['C-NOPE', 'LIVE-ONE']);
    expect(result.refused[0].why).toMatch(/no figura/i);
    expect(result.refused[1].why).toMatch(/borrador/i);
  });
});

describe('core/constitutionDraft — el pivote no concede autoridad a un borrador', () => {
  const draftPrinciple = proposed({ id: 'C-DRAFT-API', draft: true });
  const requirements = [
    '## Requirements',
    '',
    `${SPEC_PRINCIPLES_MARKER} C-DRAFT-API_`,
    '',
    '### REQ-API-001: Compatibilidad',
    '',
    'El sistema debe preservar la compatibilidad declarada del contrato público.',
    '',
  ].join('\n');

  it('una spec que cita un principio en borrador recibe UNKNOWN_PRINCIPLE y alineación 0', () => {
    const alignment = alignSpecWithConstitution({
      feature: 'demo',
      constitution: constitutionWith([draftPrinciple]),
      requirements,
    });

    expect(alignment.declared).toContain('C-DRAFT-API');
    expect(alignment.findings.some((finding) => finding.code === 'UNKNOWN_PRINCIPLE' && finding.principleId === 'C-DRAFT-API')).toBe(true);
    expect(alignment.alignment).toBe(0);
  });

  it('el mismo principio sin la marca de borrador sí resuelve como autoridad', () => {
    const alignment = alignSpecWithConstitution({
      feature: 'demo',
      constitution: constitutionWith([{ ...draftPrinciple, draft: undefined }]),
      requirements,
    });

    expect(alignment.declared).toContain('C-DRAFT-API');
    expect(alignment.findings.some((finding) => finding.code === 'UNKNOWN_PRINCIPLE')).toBe(false);
    expect(alignment.alignment).toBe(1);
  });
});

describe('core/constitutionDraft — el paquete para el modelo anfitrión', () => {
  it('es JSON-serializable y nombra las reglas que la salida del host debe cumplir', async () => {
    const dir = await evidencedFixture();
    const draft = await buildConstitutionDraft(dir);
    const pack = evidencePackForHost(draft, { maxEvidencePerItem: 2 });

    expect(() => JSON.stringify(pack)).not.toThrow();
    const roundTripped = JSON.parse(JSON.stringify(pack)) as Record<string, unknown>;
    expect(roundTripped.kind).toBe('constitution-draft-evidence-pack');
    expect(roundTripped.project).toBe('draft-fixture');

    const codes = pack.validationCodes as string[];
    expect(codes).toEqual(DRAFT_VALIDATION_RULES.map((rule) => rule.code));
    expect(codes).toContain('ID-FORMAT');
    expect(codes).toContain('EVIDENCE-MISSING');
    expect(codes).toContain('MUST-THREAT');
    expect(codes.some((code) => code.startsWith('INJ-'))).toBe(true);

    const rules = pack.validationRules as Array<{ code: string; severity: string }>;
    expect(rules.find((rule) => rule.code === 'MUST-THREAT')?.severity).toBe('error');
    expect(rules.length).toBe(DRAFT_VALIDATION_RULES.length);

    const candidates = pack.candidates as Array<{ evidence: string[]; evidenceTotal: number; mayBecomePrinciple: boolean }>;
    expect(candidates.length).toBe(draft.proposals.length);
    expect(candidates.every((candidate) => candidate.evidence.length <= 2)).toBe(true);
    expect((pack.facts as string[]).length).toBeGreaterThan(0);
    // Un borrador no es autoridad, ni siquiera cuando el análisis está completo.
    expect(pack.inForce).toBe(false);
    expect(pack.ratificationPending).toBe(true);
    expect(JSON.stringify(pack.ratify)).toMatch(/--ratify/);
  });

  it('declara explícitamente cuándo el paquete está incompleto y qué no se pudo determinar', async () => {
    const dir = await bareFixture();
    const draft = await buildConstitutionDraft(dir);
    const pack = evidencePackForHost(draft);

    expect(draft.complete).toBe(false);
    expect(pack.complete).toBe(false);
    expect(pack.status).toBe('incomplete');
    const because = pack.incompleteBecause as string[];
    expect(because.length).toBeGreaterThan(0);
    expect(because.join(' ')).toMatch(/INCOMPLETO/i);
    expect(because.join(' ')).toMatch(/sin evidencia/i);
    expect(pack.noModelShipped).toMatch(/no embarca ningún modelo/i);
  });
});
