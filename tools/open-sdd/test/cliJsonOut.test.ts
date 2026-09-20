/**
 * Pruebas del sobre JSON compartido (`src/cli/jsonOut.ts`).
 *
 * El sobre es un CONTRATO de forma: lo que se afirma aquí es que la forma no cambia (claves y orden),
 * que `ok` responde a los errores, que los hallazgos se normalizan vengan como cadena o como objeto,
 * y que el renderizador de una línea dice el veredicto y el recuento. Sin snapshots del JSON entero:
 * cada aserción nombra la propiedad que importa.
 */

import { describe, expect, it } from 'vitest';
import {
  findingsFromIssues,
  isEnvelopeOk,
  jsonEnvelope,
  renderJsonEnvelope,
  type JsonEnvelope,
} from '../src/cli/jsonOut.js';

describe('jsonEnvelope', () => {
  it('produce la forma estable { ok, command, data, findings, detail } en ese orden', () => {
    const envelope = jsonEnvelope({ command: 'status', data: { level: 'spec-first' } });
    expect(Object.keys(envelope)).toEqual(['ok', 'command', 'data', 'findings', 'detail']);
    expect(envelope.command).toBe('status');
    expect(envelope.data).toEqual({ level: 'spec-first' });
    expect(envelope.findings).toEqual({ errors: [], warnings: [] });
  });

  it('deriva ok de la ausencia de errores', () => {
    expect(jsonEnvelope({ command: 'delta validate', data: null }).ok).toBe(true);
    expect(jsonEnvelope({ command: 'delta validate', data: null, errors: ['roto'] }).ok).toBe(false);
    expect(jsonEnvelope({ command: 'delta validate', data: null, warnings: ['ojo'] }).ok).toBe(true);
  });

  it('respeta un ok forzado aunque haya errores declarados', () => {
    const envelope = jsonEnvelope({ command: 'gates run', data: null, errors: ['C1 falla'], ok: true });
    expect(envelope.ok).toBe(true);
    expect(envelope.findings.errors).toHaveLength(1);
  });

  it('normaliza hallazgos en cadena y en objeto, sin perder id ni artefacto', () => {
    const envelope = jsonEnvelope({
      command: 'audit',
      data: {},
      errors: ['error suelto', { id: 'C1', message: 'tríada incompleta', artifact: '.sdd/specs/demo' }],
      warnings: [{ id: 'EMPTY_SECTION', message: 'sección vacía' }],
    });
    expect(envelope.findings.errors[0]).toEqual({ message: 'error suelto' });
    expect(envelope.findings.errors[1]).toEqual({
      id: 'C1',
      message: 'tríada incompleta',
      artifact: '.sdd/specs/demo',
    });
    expect(envelope.findings.warnings).toEqual([{ id: 'EMPTY_SECTION', message: 'sección vacía' }]);
  });

  it('genera un detail legible en español y respeta el detail explícito', () => {
    const fallido = jsonEnvelope({ command: 'delta validate', data: null, errors: ['x'], warnings: ['y', 'z'] });
    expect(fallido.detail).toContain('delta validate');
    expect(fallido.detail).toContain('1 error(es)');
    expect(fallido.detail).toContain('2 aviso(s)');

    const explicito = jsonEnvelope({ command: 'status', data: null, detail: 'Panel completo.' });
    expect(explicito.detail).toBe('Panel completo.');
  });

  it('expone el helper de veredicto', () => {
    const ok: JsonEnvelope<number> = jsonEnvelope({ command: 'x', data: 1 });
    expect(isEnvelopeOk(ok)).toBe(true);
  });
});

describe('findingsFromIssues', () => {
  it('separa errores y avisos, e ignora las severidades informativas', () => {
    const findings = findingsFromIssues([
      { severity: 'error', id: 'NO_STATEMENT', message: 'falta el enunciado' },
      { severity: 'warning', id: 'EMPTY_SECTION', message: 'sección vacía' },
      { severity: 'info', id: 'NOTA', message: 'no es ni error ni aviso', artifact: 'x' },
    ]);
    expect(findings.errors).toHaveLength(1);
    expect(findings.errors[0].id).toBe('NO_STATEMENT');
    expect(findings.warnings).toHaveLength(1);
    expect(findings.warnings[0].id).toBe('EMPTY_SECTION');
  });
});

describe('renderJsonEnvelope', () => {
  it('renderiza una línea de texto plano con veredicto y recuento', () => {
    const line = renderJsonEnvelope(
      jsonEnvelope({ command: 'brownfield contracts', data: null, errors: [{ id: 'C3', message: 'sin cobertura' }], warnings: ['x'] }),
    );
    expect(line).toBe(
      'open-sdd brownfield contracts · error · 1 error(es), 1 aviso(s) · Comando «brownfield contracts» con 1 error(es) y 1 aviso(s).',
    );
    // Texto plano: nada de ANSI (un resumen con códigos de escape no se puede comparar ni registrar).
    expect(line).not.toMatch(/\u001b\[/);
  });

  it('usa el resumen humano sin avisos cuando todo va bien', () => {
    const line = renderJsonEnvelope(jsonEnvelope({ command: 'status', data: null, detail: 'Todo en orden.' }));
    expect(line).toBe('open-sdd status · ok · 0 error(es) · Todo en orden.');
  });
});
