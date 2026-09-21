/**
 * El contrato de tipos del motor de estándares (W2), compartido por el motor, el coach de
 * requisitos (W3) y la cadena de gates.
 *
 * Vive en su propio módulo a propósito: es lo único que dos implementaciones paralelas necesitan
 * acordar sin tocar el mismo fichero. `standards.ts` implementa el cargador y el ejecutor;
 * `requirementsCoach.ts` consume estos tipos e inyecta el ejecutor, de modo que se puede probar con
 * un doble sin depender de la implementación real.
 */
export {};
