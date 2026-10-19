# Constitution — @brujo2020/open-sdd

Provenance: descriptive
Generated: 2026-09-19T21:32:42.247Z

## Established facts

- Lenguaje: TypeScript
- Gestor de paquetes: npm
- Build: tsc
- Tests: Vitest
- Dependencias fijadas por tools/open-sdd/package-lock.json

## Principles

### C-STACK-FACT — El stack actual es un hecho establecido
- Level: MUST
- Threat: modernización silenciosa
- Restriction: No sustituir ni actualizar lenguaje, framework, gestor de paquetes o herramienta de build sin una enmienda gobernada.
- Pattern: Construir sobre el stack declarado; toda dependencia nueva se declara en el manifiesto y se justifica en la delta.
- Justification: Impide que el agente modernice por su cuenta código que nadie pidió modernizar, que es el modo de fallo dominante al adoptar SDD sobre un sistema en producción.
- Provenance: descriptive
- Evidence: package manager: npm; lockfile: tools/open-sdd/package-lock.json; build tool: tsc

### C-API-COMPAT — Preservar la compatibilidad de la API pública
- Level: MUST
- Threat: cambio incompatible
- Restriction: Ninguna exportación, ruta o esquema público se altera de forma incompatible sin una entrada REMOVED o MODIFIED en la delta que declare su migración.
- Pattern: Preferir cambios aditivos; marcar como obsoleto antes de retirar; toda retirada viaja con su ruta de migración y sus contratos.
- Justification: Los consumidores externos e internos del sistema no están en este repositorio y no se pueden actualizar en el mismo cambio.
- Provenance: descriptive
- Evidence: tools/open-sdd/src/core/index.ts; tools/open-sdd/src/index.ts

### C-BOUNDARIES — Seguir los límites de servicio existentes
- Level: SHOULD
- Restriction: Un cambio no cruza una frontera de módulo salvo que la delta declare explícitamente el cruce.
- Pattern: Mantener el cambio dentro de los límites declarados por el nodo del DAG de tareas; el cruce se justifica en el análisis de impacto.
- Justification: Las fronteras actuales codifican decisiones de arquitectura que siguen vigentes; ignorarlas convierte un cambio acotado en una refactorización involuntaria.
- Provenance: descriptive
- Evidence: agents; cli; constants; core; manifest; plan; resolvers; template

### C-REGRESSION-ORACLE — Los tests existentes son el oráculo de regresión
- Level: MUST
- Threat: cambio de comportamiento silencioso
- Restriction: Un comportamiento con cobertura no puede cambiar sin que sus contratos sigan pasando o se actualicen de forma explícita.
- Pattern: Toda entrada MODIFIED o REMOVED declara los contratos que cubren el comportamiento afectado; el pipeline los ejecuta.
- Justification: En brownfield el primer uso de la especificación extraída no es documentar sino proteger lo que no debe cambiar.
- Provenance: descriptive
- Evidence: Vitest; tools/open-sdd/test

## Amendments

- AMD-REUSE-FIRST — Política de reutilización primero al crear símbolos nuevos [proposed] · by: sdd-getspecs
- AMD-INCREMENTAL-DOCS — Cobertura de especificación creciente en el punto de cambio [proposed] · by: sdd-getspecs
