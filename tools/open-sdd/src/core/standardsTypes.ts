/**
 * El contrato de tipos del motor de estándares (W2), compartido por el motor, el coach de
 * requisitos (W3) y la cadena de gates.
 *
 * Vive en su propio módulo a propósito: es lo único que dos implementaciones paralelas necesitan
 * acordar sin tocar el mismo fichero. `standards.ts` implementa el cargador y el ejecutor;
 * `requirementsCoach.ts` consume estos tipos e inyecta el ejecutor, de modo que se puede probar con
 * un doble sin depender de la implementación real.
 */

/** Severidad de un estándar. Solo `blocking: true` con corpus medido puede detener un gate. */
export type StandardSeverity = 'error' | 'warning' | 'info';

/**
 * Aplicabilidad de un remedio. Solo `machine-applicable` se auto-aplica; `maybe-incorrect` exige
 * previsualización y `needs-human` es el caso de "pregunta a la persona" (nunca una reescritura
 * silenciosa).
 */
export type RemedyGrade = 'machine-applicable' | 'maybe-incorrect' | 'needs-human';

export interface StandardRemedy {
  grade: RemedyGrade;
  text: string;
  note?: string;
}

/**
 * Cómo detecta el estándar. `question` es la abstención explícita: el estándar no puede decidir y
 * emite una pregunta con el dato que falta en vez de un veredicto.
 */
export interface StandardDetection {
  kind: 'regex' | 'structural' | 'heuristic' | 'question';
  patterns?: string[];
}

/** Una entrada del catálogo. Un campo requerido que falte se rechaza por nombre, nunca se ignora. */
export interface StandardEntry {
  id: string;
  title: string;
  category: string;
  severity: StandardSeverity;
  blocking: boolean;
  appliesTo: string[];
  standard: string;
  source: string;
  detect: StandardDetection;
  message: string;
  remedy: { autoFixable: boolean; grades: StandardRemedy[] };
  evidence: string;
  calibrated: { corpus: string | null; recall: number | null; fpr: number | null };
}

/**
 * Un hallazgo. `remedies` o `question` son obligatorios en la práctica: un hallazgo sin ninguno de
 * los dos es un callejón sin salida y un test lo rechaza.
 */
export interface StandardFinding {
  standardId: string;
  severity: StandardSeverity;
  file: string;
  line: number;
  column: number;
  span?: string;
  message: string;
  remedies: StandardRemedy[];
  question?: string;
}

/** El ejecutor inyectable: `runStandard` en `standards.ts`, o un doble en los tests. */
export type StandardRunner = (
  entry: StandardEntry,
  artifact: { file: string; text: string },
) => StandardFinding[];

/** Artefacto sobre el que corre un estándar. */
export interface StandardArtifact {
  file: string;
  text: string;
}
