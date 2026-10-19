/**
 * El contrato sin callejones sin salida (REQ-STD-004, REQ-STD-009).
 *
 * El catálogo es DATO: el test lo carga entero, construye aquí los artefactos que disparan cada
 * detección y exige la propiedad sobre TODOS los hallazgos de TODAS las entradas, no sobre un
 * ejemplo elegido a mano. Un hallazgo sin remedio y sin pregunta es un bug, y este test lo pone rojo.
 */

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadStandards, runStandard } from '../src/core/standards.js';
import type { StandardArtifact, StandardEntry, StandardFinding } from '../src/core/standardsTypes.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Un documento que dispara, a propósito, cada detección del catálogo: un enunciado por diagnóstico
 * de `ears.ts`, un disparador detrás de `shall`, un encabezado sin id, una sección sin criterio, una
 * etiqueta mixta y una tecnología concreta que pertenece a `plan.md`.
 */
const GARBAGE = [
  '# Demo Requirements',
  '',
  '## Requirements',
  '',
  '### REQ-DEMO-001 — Access',
  '',
  '- Statement: The system validates the input.',
  '- Statement: WHEN a request arrives, WHILE the circuit is open, the gateway shall return 503.',
  '- Statement: WHEN a request arrives, the gateway shall log the request and shall forward it.',
  '- Statement: WHEN the batch arrives, the gateway shall log the request and validate the token and forward it to the service and notify the client.',
  '- Statement: IF the probe fails, the gateway reopens the circuit.',
  '- Statement: The gateway shall respond approximately.',
  '- Statement: when the user submits the form, the gateway shall log it.',
  '- Statement: The gateway shall return 503 when the circuit is open.',
  '- Statement: The gateway shall store the record in PostgreSQL.',
  '- Statement: The gateway shall .',
  '',
  '### REQ-DEMO-002 — Broken',
  '',
  '- Statement: When the door opens, the system is notified.',
  '',
  '### Overview',
  '',
  '### A1. Mixed labels',
  '',
].join('\n');

/** Sin ningún `IF ... THEN`: dispara la cobertura de comportamiento no deseado. */
const WITHOUT_UNWANTED = [
  '# Clean Requirements',
  '',
  '### REQ-CLEAN-001 — Health',
  '',
  '- Statement: WHEN a request arrives, the gateway shall respond with HTTP 200.',
  '- Statement: The gateway shall expose a health endpoint.',
  '',
].join('\n');

const ARTIFACTS: StandardArtifact[] = [
  { file: 'requirements.md', text: GARBAGE },
  { file: 'clean-requirements.md', text: WITHOUT_UNWANTED },
  { file: 'empty.md', text: '   \n' },
  { file: 'spec.json', text: '{ "feature": "demo" }' },
];

interface Collected {
  entry: StandardEntry;
  finding: StandardFinding;
}

const collect = (entries: readonly StandardEntry[]): Collected[] => {
  const collected: Collected[] = [];
  for (const entry of entries) {
    for (const artifact of ARTIFACTS) {
      for (const finding of runStandard(entry, artifact)) collected.push({ entry, finding });
    }
  }
  return collected;
};

describe('core/standards — every finding is a way forward', () => {
  it('never emits a finding without a remedy or a question, across the whole catalogue', async () => {
    const { entries, rejected } = await loadStandards(repoRoot);
    expect(rejected).toEqual([]);
    expect(entries.length).toBeGreaterThanOrEqual(12);

    const collected = collect(entries);
    const deadEnds = collected.filter(({ finding }) => finding.remedies.length === 0 && !finding.question);
    expect(deadEnds.map(({ entry, finding }) => `${entry.id} ${finding.file}:${finding.line}`)).toEqual([]);
  });

  it('gives every entry a trigger and a way out, so the assertion is not vacuous', async () => {
    const { entries } = await loadStandards(repoRoot);
    const collected = collect(entries);

    const silent = entries.filter((entry) => !collected.some((item) => item.entry.id === entry.id));
    expect(silent.map((entry) => entry.id)).toEqual([]);

    const noRemedy = entries.filter((entry) => entry.remedy.grades.length === 0);
    expect(noRemedy.length).toBeGreaterThan(0);
    for (const entry of noRemedy) {
      expect(entry.detect.kind, entry.id).toBe('question');
      const own = collected.filter((item) => item.entry.id === entry.id);
      expect(own.length).toBeGreaterThan(0);
      for (const { finding } of own) {
        expect(finding.remedies, entry.id).toEqual([]);
        expect(finding.question, entry.id).toBeTruthy();
      }
    }
  });

  it('positions every finding at a real file:line:column and names its rule', async () => {
    const { entries } = await loadStandards(repoRoot);
    for (const { entry, finding } of collect(entries)) {
      expect(finding.standardId, entry.id).toBe(entry.id);
      expect(finding.file.length, entry.id).toBeGreaterThan(0);
      expect(finding.line, `${entry.id} @ ${finding.file}`).toBeGreaterThanOrEqual(1);
      expect(finding.column, `${entry.id} @ ${finding.file}`).toBeGreaterThanOrEqual(1);
      expect(['error', 'warning', 'info'], entry.id).toContain(finding.severity);
    }
  });
});
